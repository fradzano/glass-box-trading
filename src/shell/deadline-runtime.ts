// The composition root for one Friday deadline entry (S-G11-03/04). It builds
// the same ports the agent's and the watchdog's composition roots build — the
// §0-validated configuration, the role credentials, the real Alpaca adapter,
// the account-bound mutation port (S-J-06), the ping port and the calendar —
// and hands them to `runDeadlineReconciliation` / `runTerminal` as
// `DeadlineDependencies`. Until this module existed those two entries had no
// caller outside the tests: the Friday story could only have been told by
// writing code on Friday, which the S-ARM-01 runtime digest forbids.
//
// Three invariants shape it. It decides nothing: every value is read,
// validated by the pure core, or handed to a shell module that carries its own
// tests. It fences before broker truth: authority is acquired through the same
// epoch-store mechanics the agent runtime uses (kernel mutex, compare-and-
// increment, holder heartbeat, `releaseHolder` on exit), and the adapter is
// constructed unused so no request leaves the process before that. And it
// never races: a live writer suppresses this invocation and it refuses without
// appending anything at all — unlike a scheduled cycle it does not even leave
// a SUPPRESSED witness, because the Friday entries are one-shot owner actions
// whose only correct answer to "someone else is writing" is to stop.
import path from "node:path";
import type { MarketObservation } from "../core/execution.js";
import type { AccountBinding, JournalEntry } from "../core/journal.js";
import { terminalEntry } from "../core/lifecycle.js";
import { redactedViolationSummary, validateStartupConfig } from "../core/startup.js";
import type { ValidatedStartup } from "../core/startup.js";
import { createAccountBoundBrokerPort } from "./account-bound-broker.js";
import { createAlpacaBroker } from "./alpaca-broker.js";
import type { AlpacaCredentials, MarketWindow } from "./alpaca-broker.js";
import type { PingPort } from "./cycle-runner.js";
import type { DeadlineDependencies } from "./deadline.js";
import { releaseHolder } from "./epoch-store.js";
import type { BrokerReadPort } from "./fake-broker.js";
import { newYorkDate, sessionFor } from "./market-calendar.js";
import { closingWindow } from "./market-window.js";
import type { CalendarDay } from "./market-calendar.js";
import { createMutationGateway } from "./mutation-gateway.js";
import type { BrokerMutationPort } from "./mutation-gateway.js";
import { createPingPort } from "./ping-healthchecks.js";
import { loadEnvironment, loadPolicy, rawStartupConfig, roleCredentials, secretValues } from "./runtime-config.js";
import type { EnvRecord } from "./runtime-config.js";
import { ALERT_SLA_MS, CANONICAL_PAPER_TRADING_ORIGIN } from "./startup.js";
import { resolveStateDir } from "./state-dir.js";
import type { StatePaths } from "./state-dir.js";

/**
 * The market-data origin, deliberately duplicated from `agent-runtime.ts`'s
 * `MARKET_DATA_ORIGIN` for the same reason `watchdog-runtime.ts` duplicates
 * it: that module loads the analyst's Claude Agent SDK at import time, and the
 * deadline entries must run in deployments (and compiled scratch trees) where
 * that dependency does not resolve. It is a validated allowlist entry, never
 * an order-capable origin — only `ALPACA_TRADING_ORIGIN` can carry orders.
 */
const MARKET_DATA_ORIGIN = "https://data.alpaca.markets";
/** Calendar window around today, wide enough for every expiry a position can still carry (mirrors the runner's window). */
const CALENDAR_LOOKBACK_DAYS = -7;
const CALENDAR_LOOKAHEAD_DAYS = 60;

/** The entry types that advance the cycle counter, exactly as `agent-cli.ts` counts them. */
const CYCLE_COUNTING_TYPES = ["CYCLE", "BOOTSTRAP", "GAP", "SKIP"];

/**
 * The broker surface this composition needs. `createAlpacaBroker`'s result
 * satisfies it structurally, and so does a test double over the fake broker —
 * neither has to know about the other.
 */
export interface DeadlineBrokerAdapter {
  readonly read: BrokerReadPort;
  readonly port: BrokerMutationPort;
  readonly market: (window: MarketWindow, deadlineAtMs?: number) => Promise<MarketObservation>;
  readonly calendar: (startDate: string, endDate: string) => Promise<readonly CalendarDay[]>;
}

export interface DeadlineAdapterInput {
  readonly credentials: AlpacaCredentials;
  readonly tradingOrigin: string;
  readonly dataOrigin: string;
  readonly clock: () => number;
  readonly requestTimeoutMs: number;
}

export interface DeadlineRuntimeOptions {
  readonly repoRoot: string;
  readonly processEnv: EnvRecord;
  /** Injected at the shell boundary: the real clock in production, a fixed instant under `--now`. */
  readonly clock: () => number;
  readonly instanceId: string;
  readonly log: (line: string) => void;
  /** Test seam: the adapter bound instead of the real Alpaca adapter. Production omits it. */
  readonly brokerAdapter?: (input: DeadlineAdapterInput) => DeadlineBrokerAdapter;
}

/** Why a composition refused. Every stage but `suppressed` means the deployment is unusable; `suppressed` means it is in use. */
export type DeadlineRefusalStage = "configuration" | "state_dir" | "credentials" | "binding" | "suppressed" | "authority" | "calendar";

export type DeadlineComposition =
  | {
    readonly ok: true;
    readonly deps: DeadlineDependencies;
    readonly paths: StatePaths;
    readonly profile: "dev" | "competition";
    readonly acquired: "WON" | "GAP_HALT";
    readonly epoch: number;
    /**
     * The journal as it stood under this process's own authority, read once so
     * the admission guard and the cycle counter see the same truth. Nothing
     * else can write between this read and the entry: the epoch is ours.
     */
    readonly entries: readonly JournalEntry[];
    /** Give up writer ownership. A crash instead lets the holder record age out (S-G12-01). */
    release(): Promise<void>;
  }
  | { readonly ok: false; readonly stage: DeadlineRefusalStage; readonly reason: string };

export type DeadlineCommandName = "reconciliation" | "terminal";

export type DeadlineCommand =
  | { readonly ok: true; readonly command: "reconciliation"; readonly revision: string; readonly nowMs: number | null }
  | { readonly ok: true; readonly command: "terminal"; readonly nowMs: number | null }
  | { readonly ok: false; readonly reason: string };

export const DEADLINE_CLI_USAGE = "usage: deadline-cli reconciliation --revision <journal revision id> [--now <ms>] | deadline-cli terminal [--now <ms>]";

/**
 * The whole command surface of the CLI as a pure function: which entry, which
 * revision reference, which instant. It lives here rather than in the entry
 * point so the argument rules are testable without spawning a process — the
 * same split `certificate-command-guard.ts` makes for the certificate CLI.
 */
export function parseDeadlineCommand(argv: readonly string[]): DeadlineCommand {
  const [name, ...rest] = argv;
  if (name !== "reconciliation" && name !== "terminal") {
    return { ok: false, reason: `unknown command ${name === undefined ? "(none)" : JSON.stringify(name)}; ${DEADLINE_CLI_USAGE}` };
  }
  let revision: string | null = null;
  let nowMs: number | null = null;
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (value === undefined) return { ok: false, reason: `${String(flag)} requires a value; ${DEADLINE_CLI_USAGE}` };
    if (flag === "--revision") {
      if (revision !== null) return { ok: false, reason: "--revision was given twice" };
      if (value.trim().length === 0) return { ok: false, reason: "--revision must name a non-empty journal revision id" };
      revision = value;
      continue;
    }
    if (flag === "--now") {
      if (nowMs !== null) return { ok: false, reason: "--now was given twice" };
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) return { ok: false, reason: "--now must be a positive integer count of epoch milliseconds" };
      nowMs = parsed;
      continue;
    }
    return { ok: false, reason: `unknown option ${String(flag)}; ${DEADLINE_CLI_USAGE}` };
  }
  if (name === "terminal") {
    if (revision !== null) return { ok: false, reason: "terminal takes no --revision; the TERMINAL entry references nothing but the book" };
    return { ok: true, command: "terminal", nowMs };
  }
  if (revision === null) return { ok: false, reason: `reconciliation requires --revision; ${DEADLINE_CLI_USAGE}` };
  return { ok: true, command: "reconciliation", revision, nowMs };
}

/**
 * Whether this entry may still be written, decided purely from the journal.
 * `TERMINAL` is the controlled end of scheduler and dead-man expectation
 * (S-G11-04) and artifacts are frozen thereafter, so a second one would
 * reopen a story that was closed in writing; `DEADLINE_RECONCILIATION` is a
 * snapshot and may legitimately be repeated.
 */
export function admitDeadlineEntry(command: DeadlineCommandName, entries: readonly JournalEntry[]): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (command !== "terminal") return { ok: true };
  const terminal = terminalEntry(entries);
  if (terminal === null) return { ok: true };
  return { ok: false, reason: `a TERMINAL entry already stands at seq ${String(terminal.seq)}; the run ended there and is not reopened by a second one` };
}

/** The cycle index this entry carries, counted exactly as a scheduled invocation counts it. */
export function deadlineCycleIndex(entries: readonly JournalEntry[]): number {
  return entries.filter(entry => CYCLE_COUNTING_TYPES.includes(entry.type)).length + 1;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `YYYY-MM-DD` a whole number of days away from `ms` — the calendar request window, as the runner computes it. */
function isoDate(ms: number, offsetDays: number): string {
  return new Date(ms + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The market observation for a deadline entry: the same `AlpacaBroker.market`
 * the cycle runner observes through, over the closing window the watchdog
 * uses. A book that must be reported on can hold anything that was openable
 * once, so the window starts at zero remaining sessions and uses the full
 * configured strike distance. The calendar is the one already read after the
 * fence — a deadline entry issues no second calendar request.
 */
function marketObservation(adapter: DeadlineBrokerAdapter, config: ValidatedStartup, days: readonly CalendarDay[], clock: () => number): (heldContractIds: readonly string[], deadlineAtMs?: number) => Promise<MarketObservation> {
  return (heldContractIds: readonly string[], deadlineAtMs?: number): Promise<MarketObservation> => {
    return adapter.market(closingWindow(days, newYorkDate(clock()), config.decision, heldContractIds), deadlineAtMs);
  };
}

/**
 * Build the dependency record for one deadline entry. Every refusal is
 * fail-closed and silent in the journal: nothing is appended on any path that
 * returns `ok: false`, so an operator can retry a refused invocation without
 * having polluted the record the judges read.
 */
export async function composeDeadline(options: DeadlineRuntimeOptions): Promise<DeadlineComposition> {
  const env = loadEnvironment(options.repoRoot, options.processEnv);
  let raw: Readonly<Record<string, unknown>>;
  try {
    raw = rawStartupConfig(loadPolicy(options.repoRoot), env);
  } catch (error) {
    return { ok: false, stage: "configuration", reason: `configuration could not be assembled: ${messageOf(error)}` };
  }
  const secrets = secretValues(env);

  const validation = validateStartupConfig(raw, { canonicalTradingOrigin: CANONICAL_PAPER_TRADING_ORIGIN, alertSlaMs: ALERT_SLA_MS });
  if (!validation.ok) return { ok: false, stage: "configuration", reason: `configuration refused to arm: ${redactedViolationSummary(validation.violations)}` };
  const config = validation.value;

  // The deployment is the configured one, never a command-line one: a Friday
  // entry written into a foreign STATE_DIR would be a lie about which account
  // ended flat.
  const resolved = resolveStateDir(config.stateDir);
  if (!resolved.ok) return { ok: false, stage: "state_dir", reason: `configured STATE_DIR is unusable: ${resolved.detail}` };
  const paths = resolved.value;

  const credentials = roleCredentials(env, config.profile);
  if (credentials.keyId.length === 0 || credentials.secretKey.length === 0) {
    return { ok: false, stage: "credentials", reason: `no credentials for the ${config.profile} role` };
  }
  const expectedAccountId = config.binding.expectedAccountId;
  if (expectedAccountId === undefined || expectedAccountId.trim().length === 0) {
    return { ok: false, stage: "binding", reason: "validated startup omitted EXPECTED_ACCOUNT_ID" };
  }

  // Constructed, not called: no request leaves this process before the fence.
  const adapterFactory: (input: DeadlineAdapterInput) => DeadlineBrokerAdapter = options.brokerAdapter ?? createAlpacaBroker;
  const adapter = adapterFactory({
    credentials: { keyId: credentials.keyId, secretKey: credentials.secretKey },
    tradingOrigin: config.binding.canonicalTradingOrigin,
    dataOrigin: MARKET_DATA_ORIGIN,
    clock: options.clock,
    requestTimeoutMs: Math.min(config.scheduling.cycleWalltimeBudgetMs, 30_000),
  });
  const binding: AccountBinding = { profile: config.profile, tradingOrigin: config.binding.canonicalTradingOrigin, accountId: expectedAccountId };
  // S-J-06 at the mutation boundary. A deadline entry submits nothing, but the
  // gateway is the real one and gets the real bound port: the entry is written
  // by a writer that could not have mutated a foreign account either.
  const brokerPort = createAccountBoundBrokerPort({
    profile: config.profile,
    requestedOrigin: config.binding.canonicalTradingOrigin,
    observedOrigin: config.binding.canonicalTradingOrigin,
    config: config.binding,
    brokerReportedAccountId: async (deadlineAtMs?: number): Promise<string | undefined> => (await adapter.read.account(deadlineAtMs)).accountId,
    expectedBinding: binding,
    delegate: adapter.port,
    clock: options.clock,
  });
  const gateway = createMutationGateway({
    paths,
    secrets,
    clock: options.clock,
    brokerPort,
    instanceId: options.instanceId,
    lockTakeoverBoundMs: config.scheduling.lockTakeoverBoundMs,
    binding,
  });
  const ping: PingPort = createPingPort({
    url: env["HEALTHCHECK_PING_URL"] ?? null,
    recordFile: path.join(paths.root, "pings.log"),
    clock: options.clock,
    timeoutMs: Math.min(config.scheduling.cycleWalltimeBudgetMs, 10_000),
  });

  // Fence before broker truth (S-G12-01), through the shared epoch store and
  // the same kernel mutex every other writer takes. A live rival ends this
  // invocation here: the deadline entries are authoritative appends and there
  // is no version of them worth racing a running cycle for.
  const acquired = await gateway.acquireAuthority({ account: "unknown" });
  if (acquired.kind === "SUPPRESSED") {
    return { ok: false, stage: "suppressed", reason: `a live writer holds authority (holder ${acquired.holderId}, ${acquired.reason}); refusing to race it` };
  }
  if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") {
    return { ok: false, stage: "authority", reason: `authority not acquired: ${JSON.stringify(acquired)}` };
  }
  const epoch = acquired.epoch;
  const release = async (): Promise<void> => { await releaseHolder(paths, options.instanceId); };

  // ---- everything below runs under our own epoch: the first broker read is here, never earlier ----
  const now = options.clock();
  const tradingDay = newYorkDate(now);
  let days: readonly CalendarDay[];
  try {
    days = await adapter.calendar(isoDate(now, CALENDAR_LOOKBACK_DAYS), isoDate(now, CALENDAR_LOOKAHEAD_DAYS));
  } catch (error) {
    await release();
    return { ok: false, stage: "calendar", reason: `broker calendar could not be observed: ${messageOf(error)}` };
  }

  let entries: readonly JournalEntry[];
  try {
    entries = (await gateway.openJournal()).entries;
  } catch (error) {
    await release();
    return { ok: false, stage: "authority", reason: `journal could not be opened under the acquired epoch: ${messageOf(error)}` };
  }

  const cycleIndex = deadlineCycleIndex(entries);
  options.log(`deadline composed for the ${config.profile} profile over ${paths.root}; epoch ${String(epoch)} (${acquired.kind}); trading day ${tradingDay}; cycle index ${String(cycleIndex)}`);
  return {
    ok: true,
    paths,
    profile: config.profile,
    acquired: acquired.kind,
    epoch,
    entries,
    release,
    deps: {
      gateway,
      epoch,
      broker: adapter.read,
      market: marketObservation(adapter, config, days, options.clock),
      underlyingUniverse: config.decision.underlyingUniverse,
      clock: options.clock,
      profile: config.profile,
      calendar: sessionFor(days, tradingDay),
      tradingDay,
      cycleIndex,
      ping,
    },
  };
}
