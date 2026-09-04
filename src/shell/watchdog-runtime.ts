// The composition root for one scheduled watchdog invocation (P8). It builds
// the same ports the agent's composition root builds — the §0-validated
// configuration, the role credentials, the real Alpaca adapter, the
// account-bound mutation port (S-J-06) and the market observation — and hands
// them to `runWatchdog` as `WatchdogDependencies`, so a scheduled watchdog can
// recover an open book instead of only fencing and halting.
//
// Two invariants shape this module. It decides nothing: every value is read,
// validated by the pure core, or handed to a shell module that carries its own
// tests. And it calls nothing: the ports are constructed unused, so the first
// broker read still happens inside `runWatchdog`, after the atomic epoch
// increment — the fence-first rule of S-G14-02 is not weakened by composing
// broker access. Any configuration, credential or binding problem degrades to
// exactly the fence-and-halt ports the CLI passed before this module existed
// (broker null, market null): the watchdog still fences the writer, sets the
// takeover halt and fail-pings. The fail-ping is why the ping port is composed
// from the environment BEFORE the first branch that can degrade — degrading
// book recovery must never also degrade the active alarm (S-G14-02/03).
// Nothing in here throws at the caller.
import path from "node:path";
import type { MarketObservation } from "../core/execution.js";
import type { SessionWindow } from "../core/lifecycle.js";
import type { AccountBinding } from "../core/journal.js";
import { classifyBrokerFailure, redactedViolationSummary, validateStartupConfig } from "../core/startup.js";
import type { ValidatedStartup } from "../core/startup.js";
import { createAccountBoundBrokerPort } from "./account-bound-broker.js";
import { createAlpacaBroker } from "./alpaca-broker.js";
import type { AlpacaCredentials, MarketWindow } from "./alpaca-broker.js";
import { httpStatusOf } from "./broker-errors.js";
import type { PingPort } from "./cycle-runner.js";
import type { BrokerReadPort } from "./fake-broker.js";
import { expiriesWithin, newYorkDate } from "./market-calendar.js";
import type { CalendarDay } from "./market-calendar.js";
import type { BrokerMutationPort } from "./mutation-gateway.js";
import { createPingPort } from "./ping-healthchecks.js";
import { loadEnvironment, loadPolicy, rawStartupConfig, roleCredentials, secretValues } from "./runtime-config.js";
import type { EnvRecord } from "./runtime-config.js";
import { recordStartupBrokerFence } from "./startup-broker-fence.js";
import { ALERT_SLA_MS, CANONICAL_PAPER_TRADING_ORIGIN } from "./startup.js";
import { resolveStateDir } from "./state-dir.js";
import type { StatePaths } from "./state-dir.js";
import type { WatchdogDependencies } from "./watchdog.js";

/**
 * The market-data origin, deliberately duplicated from
 * `agent-runtime.ts`'s `MARKET_DATA_ORIGIN` rather than imported: that module
 * loads the analyst's Claude Agent SDK at import time, and the watchdog must
 * start in deployments (and compiled scratch trees) where that dependency does
 * not resolve. It is a validated allowlist entry, never an order-capable
 * origin — only `ALPACA_TRADING_ORIGIN` can carry orders (S-CYC-11, S-J-06).
 */
const MARKET_DATA_ORIGIN = "https://data.alpaca.markets";
/** The lock-takeover bound the fence-and-halt-only path has always used; the composed path takes the validated one. */
const FENCE_ONLY_LOCK_TAKEOVER_BOUND_MS = 60_000;
/** Likewise the escalation step: without a validated configuration there is nothing to escalate anyway. */
const FENCE_ONLY_CLOSE_ESCALATION_STEP_CENTS = 1;
/** Calendar window around today, wide enough for every expiry a position can carry (mirrors the runner's window). */
const CALENDAR_LOOKBACK_DAYS = -7;
const CALENDAR_LOOKAHEAD_DAYS = 60;
/** The ping bound that holds before a validated walltime budget exists — the same 10 s `createPingPort` defaults to. */
const DEFAULT_PING_TIMEOUT_MS = 10_000;

/**
 * The broker surface this composition needs. `createAlpacaBroker`'s result
 * satisfies it structurally, and so does a test double over the fake broker —
 * neither has to know about the other.
 */
export interface WatchdogBrokerAdapter {
  readonly read: BrokerReadPort;
  readonly port: BrokerMutationPort;
  readonly market: (window: MarketWindow, deadlineAtMs?: number) => Promise<MarketObservation>;
  readonly calendar: (startDate: string, endDate: string) => Promise<readonly CalendarDay[]>;
}

export interface WatchdogAdapterInput {
  readonly credentials: AlpacaCredentials;
  readonly tradingOrigin: string;
  readonly dataOrigin: string;
  readonly clock: () => number;
  readonly requestTimeoutMs: number;
}

export interface WatchdogRuntimeOptions {
  /** The already-resolved STATE_DIR the CLI was invoked for; the fence and the halt always land here. */
  readonly paths: StatePaths;
  readonly repoRoot: string;
  readonly processEnv: EnvRecord;
  readonly clock: () => number;
  readonly instanceId: string;
  /** The session window the caller computed; the watchdog takes it as an argument, it does not resolve it. */
  readonly session: SessionWindow;
  readonly deadManBoundMs: number;
  readonly log: (line: string) => void;
  /** Test seam: the adapter bound instead of the real Alpaca adapter. Production omits it. */
  readonly brokerAdapter?: (input: WatchdogAdapterInput) => WatchdogBrokerAdapter;
}

export interface WatchdogComposition {
  readonly deps: WatchdogDependencies;
  /** Why the book-recovery ports are absent, or null when broker, market and binding are live. */
  readonly degraded: string | null;
  /**
   * The runner's credential fence (S-G12-06) for a failure that escaped the
   * watchdog run: an HTTP 401/403 becomes a durable `AUTH_FAILURE` halt plus a
   * fail-ping, every other failure stays world degradation and is only
   * reported. Resolves to the classification; it never throws.
   */
  recordCredentialFence(error: unknown): Promise<"AUTH_FAILURE" | "WORLD_DEGRADED">;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `YYYY-MM-DD` a whole number of days away from `ms` — the calendar request window, as the runner computes it. */
function isoDate(ms: number, offsetDays: number): string {
  return new Date(ms + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The dead-man ping port (S-G14-03). Its URL comes from the ENVIRONMENT, never
 * from the validated configuration, so the port can be — and is — built before
 * the first branch that can degrade. That ordering is the point: a takeover's
 * fail-ping is the only ACTIVE alarm a fenced deployment raises, and losing it
 * together with book recovery would leave nothing but the passive 45–60 min
 * missed-ping SLA (S-G14-02/03).
 */
function pingPort(options: WatchdogRuntimeOptions, env: EnvRecord, timeoutMs: number): PingPort {
  return createPingPort({
    url: env["HEALTHCHECK_PING_URL"] ?? null,
    recordFile: path.join(options.paths.root, "pings.log"),
    clock: options.clock,
    timeoutMs,
  });
}

/** What the runner's credential fence (S-G12-06) needs from a validated configuration; the fence-only defaults stand in for it. */
interface FenceParameters {
  readonly secrets: readonly string[];
  readonly lockTakeoverBoundMs: number;
}

/** Exactly the dependency record the CLI passed before this module existed — minus the ping, which every path keeps: fence, halt, fail-ping, no book recovery. */
function fenceOnlyDeps(options: WatchdogRuntimeOptions, ping: PingPort): WatchdogDependencies {
  return {
    paths: options.paths,
    secrets: [],
    clock: options.clock,
    instanceId: options.instanceId,
    lockTakeoverBoundMs: FENCE_ONLY_LOCK_TAKEOVER_BOUND_MS,
    deadManBoundMs: options.deadManBoundMs,
    closeEscalationStepCents: FENCE_ONLY_CLOSE_ESCALATION_STEP_CENTS,
    session: options.session,
    binding: null,
    broker: null,
    market: null,
    profile: "dev",
    calendar: { isTradingDay: true, opensAt: options.session.opensAt, closesAt: options.session.closesAt },
    tradingDay: "cli",
    ping,
  };
}

function credentialFence(options: WatchdogRuntimeOptions, fence: FenceParameters, ping: PingPort): WatchdogComposition["recordCredentialFence"] {
  return async (error: unknown): Promise<"AUTH_FAILURE" | "WORLD_DEGRADED"> => {
    const status = httpStatusOf(error);
    if (classifyBrokerFailure(status) !== "AUTH_FAILURE") return "WORLD_DEGRADED";
    try {
      await recordStartupBrokerFence({
        paths: options.paths,
        secrets: fence.secrets,
        clock: options.clock,
        instanceId: options.instanceId,
        lockTakeoverBoundMs: fence.lockTakeoverBoundMs,
        reason: "AUTH_FAILURE",
        detail: `active credentials were rejected during watchdog book recovery (HTTP ${String(status ?? 0)})`,
        ping,
      });
    } catch (fenceError) {
      // The takeover halt already stands; the fence is an added distinction, never a precondition.
      options.log(`watchdog credential fence could not be journaled: ${messageOf(fenceError)}`);
    }
    return "AUTH_FAILURE";
  };
}

/**
 * Degrade to fencing and halting only — but never to silence. `ping` is the
 * port the environment yielded; it is null in exactly one case, spelled out at
 * the caller, and then a local-only recorder stands in — for the takeover's own
 * fail-ping and for the credential fence alike. The record file derives from
 * the INVOKED `STATE_DIR`, which this invocation was handed as an argument, so
 * it survives the very failure that lost the URL.
 */
function degrade(options: WatchdogRuntimeOptions, reason: string, ping: PingPort | null, fence?: FenceParameters): WatchdogComposition {
  options.log(`watchdog book recovery unavailable, fencing and halting only: ${reason}`);
  const localOnlyPing: PingPort = ping ?? createPingPort({ url: null, recordFile: path.join(options.paths.root, "pings.log"), clock: options.clock });
  return {
    deps: fenceOnlyDeps(options, localOnlyPing),
    degraded: reason,
    recordCredentialFence: credentialFence(options, fence ?? { secrets: [], lockTakeoverBoundMs: FENCE_ONLY_LOCK_TAKEOVER_BOUND_MS }, localOnlyPing),
  };
}

/**
 * The market observation for the recovery branch: the same
 * `AlpacaBroker.market` the cycle runner observes through, over a window built
 * for closing rather than for entering. The runner asks for the expiries a new
 * position may be opened at (`EXPIRY_MIN_SESSIONS`..`EXPIRY_MAX_SESSIONS`,
 * nearest three) inside a 300 bps strike band; a book that must be flattened
 * can hold anything that was openable once, so this window starts at zero
 * remaining sessions (a position entered at the minimum is nearer today) and
 * uses the full configured strike distance. It is called from inside
 * `runWatchdog`, after the fence — never during composition.
 */
function marketObservation(adapter: WatchdogBrokerAdapter, config: ValidatedStartup, clock: () => number): () => Promise<MarketObservation> {
  return async (): Promise<MarketObservation> => {
    const now = clock();
    const days = await adapter.calendar(isoDate(now, CALENDAR_LOOKBACK_DAYS), isoDate(now, CALENDAR_LOOKAHEAD_DAYS));
    const window: MarketWindow = {
      underlyings: config.decision.underlyingUniverse,
      expiries: expiriesWithin(days, newYorkDate(now), 0, config.decision.expiryMaxSessions),
      strikeWindowBps: config.decision.maxStrikeDistanceBps,
    };
    return adapter.market(window);
  };
}

/**
 * Build the watchdog's dependency record. Returns the composed ports when the
 * configuration, the credentials and the account binding are all present and
 * consistent; otherwise it returns the fence-and-halt-only record with the
 * reason. It never throws: a watchdog that cannot compose must still fence.
 */
export async function composeWatchdog(options: WatchdogRuntimeOptions): Promise<WatchdogComposition> {
  // The alarm port comes first, before anything that can refuse to compose:
  // reading the environment is the only step it needs, and a takeover under a
  // degraded composition must still ping (S-G14-03).
  let env: EnvRecord;
  let ping: PingPort;
  try {
    env = loadEnvironment(options.repoRoot, options.processEnv);
    ping = pingPort(options, env, DEFAULT_PING_TIMEOUT_MS);
  } catch (error) {
    // The only branch that loses the ping URL: it lives in the environment, and
    // there is none. The record FILE does not — it derives from the invoked
    // STATE_DIR, which this invocation was handed — so `degrade` substitutes a
    // local-only recorder and the takeover still leaves durable local evidence.
    // What is genuinely gone is the REMOTE alarm: for that only the passive
    // 45–60 min missed-ping SLA remains (S-G14-03).
    return degrade(options, `environment could not be read, no remote alarm URL: ${messageOf(error)}`, null);
  }
  try {
    return await Promise.resolve(compose(options, env, ping));
  } catch (error) {
    return degrade(options, `composition failed exceptionally: ${messageOf(error)}`, ping);
  }
}

function compose(options: WatchdogRuntimeOptions, env: EnvRecord, ping: PingPort): WatchdogComposition {
  const raw = rawStartupConfig(loadPolicy(options.repoRoot), env);
  const secrets = secretValues(env);

  const validation = validateStartupConfig(raw, { canonicalTradingOrigin: CANONICAL_PAPER_TRADING_ORIGIN, alertSlaMs: ALERT_SLA_MS });
  if (!validation.ok) return degrade(options, `configuration refused to arm: ${redactedViolationSummary(validation.violations)}`, ping);
  const config = validation.value;
  // From here the validated walltime budget is known, so the alarm port is
  // re-bound to it: an armed watchdog may not spend more of a cycle's budget on
  // its ping than a cycle would. Same URL, same record file — only the bound
  // tightens, and it never loosens past the pre-validation default.
  const armedPing = pingPort(options, env, Math.min(config.scheduling.cycleWalltimeBudgetMs, DEFAULT_PING_TIMEOUT_MS));

  // The deployment the configuration describes must be the deployment this
  // invocation was pointed at. Recovering a book in one STATE_DIR while
  // fencing the writer of another would be worse than not recovering at all.
  const configured = resolveStateDir(config.stateDir);
  if (!configured.ok) return degrade(options, `configured STATE_DIR is unusable: ${configured.detail}`, armedPing);
  if (configured.value.root !== options.paths.root) {
    return degrade(options, "the invoked STATE_DIR is not the configured STATE_DIR; refusing to recover a book in a foreign deployment", armedPing);
  }

  const fence: FenceParameters = { secrets, lockTakeoverBoundMs: config.scheduling.lockTakeoverBoundMs };

  const credentials = roleCredentials(env, config.profile);
  if (credentials.keyId.length === 0 || credentials.secretKey.length === 0) {
    return degrade(options, `no credentials for the ${config.profile} role`, armedPing, fence);
  }
  const expectedAccountId = config.binding.expectedAccountId;
  if (expectedAccountId === undefined || expectedAccountId.trim().length === 0) {
    return degrade(options, "validated startup omitted EXPECTED_ACCOUNT_ID", armedPing, fence);
  }

  // Constructed, not called: no request leaves this process before the fence.
  const adapterFactory: (input: WatchdogAdapterInput) => WatchdogBrokerAdapter = options.brokerAdapter ?? createAlpacaBroker;
  const adapter = adapterFactory({
    credentials: { keyId: credentials.keyId, secretKey: credentials.secretKey },
    tradingOrigin: config.binding.canonicalTradingOrigin,
    dataOrigin: MARKET_DATA_ORIGIN,
    clock: options.clock,
    requestTimeoutMs: Math.min(config.scheduling.cycleWalltimeBudgetMs, 30_000),
  });
  const binding: AccountBinding = { profile: config.profile, tradingOrigin: config.binding.canonicalTradingOrigin, accountId: expectedAccountId };
  // S-J-06 at the mutation boundary: the identity the active credentials report
  // is re-observed before every close the watchdog submits, exactly as in the
  // runner. A mismatch throws and the gateway turns it into the binding halt.
  const port = createAccountBoundBrokerPort({
    profile: config.profile,
    requestedOrigin: config.binding.canonicalTradingOrigin,
    observedOrigin: config.binding.canonicalTradingOrigin,
    config: config.binding,
    brokerReportedAccountId: async (deadlineAtMs?: number): Promise<string | undefined> => (await adapter.read.account(deadlineAtMs)).accountId,
    expectedBinding: binding,
    delegate: adapter.port,
    clock: options.clock,
  });

  options.log(`watchdog composed for the ${config.profile} profile over ${options.paths.root}; book recovery armed`);
  return {
    deps: {
      paths: options.paths,
      secrets,
      clock: options.clock,
      instanceId: options.instanceId,
      lockTakeoverBoundMs: config.scheduling.lockTakeoverBoundMs,
      deadManBoundMs: options.deadManBoundMs,
      closeEscalationStepCents: config.closeEscalationStepCents,
      session: options.session,
      binding,
      broker: { read: adapter.read, port },
      market: marketObservation(adapter, config, options.clock),
      profile: config.profile,
      calendar: { isTradingDay: options.session.isTradingDay, opensAt: options.session.opensAt, closesAt: options.session.closesAt },
      tradingDay: newYorkDate(options.clock()),
      ping: armedPing,
    },
    degraded: null,
    recordCredentialFence: credentialFence(options, fence, armedPing),
  };
}
