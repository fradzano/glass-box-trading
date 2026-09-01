// The composition root for a real run (P7): validate the configuration
// fail-closed (S-CYC-11), bind the role's credentials, build the Alpaca
// adapter, the calendar, the P2 gateway with the real mutation port, acquire
// writer authority, launch the verified analyst child, compute both S-ARM-01
// digests, and expose one `cycle()` that runs the P3–P6 cycle runner over the
// real world. Nothing here decides; every choice is a parameter handed to the
// core or to a shell module that already carries its tests against fakes.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CANONICAL_PAPER_TRADING_ORIGIN, runStartup } from "./startup.js";
import type { StartupOutcome } from "./startup.js";
import { epochMsToUtcIso, haltDraft } from "../core/execution.js";
import type { MarketObservation } from "../core/execution.js";
import type { AccountBinding, JournalDraft } from "../core/journal.js";
import { validateAnalystManifest, validateRuntimeLock } from "../core/startup.js";
import type { ValidatedStartup } from "../core/startup.js";
import { createAlpacaBroker } from "./alpaca-broker.js";
import type { AlpacaBroker, MarketWindow } from "./alpaca-broker.js";
import { createClaudeAnalyst } from "./analyst-claude.js";
import { launchVerifiedAnalystChild } from "./analyst-mcp-launcher.js";
import { runCycle } from "./cycle-runner.js";
import type { AnalystInput, CycleReport, LifecycleDeps, PingPort } from "./cycle-runner.js";
import { createFileDiagnosticSink } from "./diagnostic-sink.js";
import { computePolicyDigest, computeRuntimeDigest, sha256File } from "./digests.js";
import type { BrokerReadPort } from "./fake-broker.js";
import { expiriesWithin, newYorkDate, nextTradingDay, remainingSessions, sessionFor } from "./market-calendar.js";
import type { CalendarDay } from "./market-calendar.js";
import { analystOsAllowlist, analystOsEnv, createEnvironmentPorts, environmentExists } from "./mcp-environment.js";
import type { VerifiedChildHandle } from "./mcp-environment.js";
import { removeHolder } from "./epoch-store.js";
import { createMutationGateway } from "./mutation-gateway.js";
import type { MutationGateway } from "./mutation-gateway.js";
import { createPingPort } from "./ping-healthchecks.js";
import { analystEnvironmentPaths, loadEnvironment, loadPolicy, rawStartupConfig, roleCredentials, secretValues } from "./runtime-config.js";
import type { EnvRecord } from "./runtime-config.js";
import type { StatePaths } from "./state-dir.js";

export const MARKET_DATA_ORIGIN = "https://data.alpaca.markets";

export interface RuntimeOptions {
  readonly repoRoot: string;
  readonly processEnv: EnvRecord;
  readonly clock: () => number;
  readonly objective: "certificate" | "competition";
  readonly instanceId: string;
  readonly log: (line: string) => void;
}

export interface CycleOverrides {
  readonly broker?: BrokerReadPort;
  readonly flattenDate?: string;
  readonly finalCycleOfSession?: boolean;
  readonly analyst?: (input: AnalystInput) => Promise<string>;
}

export interface AgentRuntime {
  readonly config: ValidatedStartup;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly env: EnvRecord;
  readonly paths: StatePaths;
  readonly binding: AccountBinding;
  readonly broker: AlpacaBroker;
  readonly gateway: MutationGateway;
  readonly epoch: number;
  readonly days: readonly CalendarDay[];
  readonly tradingDay: string;
  readonly session: ReturnType<typeof sessionFor>;
  readonly window: MarketWindow;
  readonly child: VerifiedChildHandle;
  readonly mcpInventory: readonly string[];
  readonly runtimeDigest: string;
  readonly policyDigest: string;
  readonly secrets: readonly string[];
  readonly ping: PingPort;
  cycle(cycleIndex: number, overrides?: CycleOverrides): Promise<CycleReport>;
  market(): Promise<MarketObservation>;
  shutdown(): Promise<void>;
}

export type RuntimeBuild =
  | { readonly ok: true; readonly runtime: AgentRuntime }
  | { readonly ok: false; readonly stage: "startup" | "credentials" | "calendar" | "authority" | "analyst" | "digest"; readonly reason: string; readonly startup: StartupOutcome | null };

function isoDate(ms: number, offsetDays: number): string {
  return new Date(ms + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export async function buildRuntime(options: RuntimeOptions): Promise<RuntimeBuild> {
  const { repoRoot, clock, log } = options;
  const env = loadEnvironment(repoRoot, options.processEnv);
  const raw = rawStartupConfig(loadPolicy(repoRoot), env);
  const secrets = secretValues(env);

  // ---- S-CYC-11: validate before any broker call; the refusal paths journal/ping through a broker-less gateway ----
  const startup = await runStartup({
    rawConfig: raw,
    openSink: name => createFileDiagnosticSink(name),
    failPing: async code => {
      const ping = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: null, clock });
      await ping.fail([code]);
    },
    journal: {
      async append(paths, draft): Promise<boolean> {
        const gateway = createMutationGateway({ paths, secrets, clock, brokerPort: { mutate: () => Promise.resolve({ ok: false, reason: "STARTUP_HAS_NO_BROKER" }) }, instanceId: `${options.instanceId}-startup`, lockTakeoverBoundMs: 60_000 });
        const acquired = await gateway.acquireAuthority({ account: "unknown" });
        if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") return false;
        const result = await gateway.dispatch({ class: "authoritative", epoch: acquired.epoch, action: { kind: "journal_append", entry: draft({ atIso: epochMsToUtcIso(clock()), epoch: acquired.epoch }) } });
        return result.ok;
      },
    },
    clock,
  });
  if (!startup.armed || startup.config === null || startup.paths === null) {
    return { ok: false, stage: "startup", reason: `refused to arm: ${startup.refusal ?? "unknown"} ${startup.violations.map(item => `${item.field}:${item.code}`).join("; ")}`, startup };
  }
  const config = startup.config;
  const paths = startup.paths;
  const credentials = roleCredentials(env, config.profile);
  if (credentials.keyId.length === 0 || credentials.secretKey.length === 0) return { ok: false, stage: "credentials", reason: `no credentials for the ${config.profile} role`, startup };
  const expectedAccountId = config.binding.expectedAccountId;
  if (expectedAccountId === undefined || expectedAccountId.length === 0) return { ok: false, stage: "credentials", reason: "EXPECTED_ACCOUNT_ID is absent after validation", startup };
  const binding: AccountBinding = { profile: config.profile, tradingOrigin: config.binding.canonicalTradingOrigin, accountId: expectedAccountId };
  const broker = createAlpacaBroker({ credentials: { keyId: credentials.keyId, secretKey: credentials.secretKey }, tradingOrigin: config.binding.canonicalTradingOrigin, dataOrigin: MARKET_DATA_ORIGIN, clock });

  // ---- calendar (S-G6-03): the session and the expiry window come from the exchange calendar ----
  const now = clock();
  const days = await broker.calendar(isoDate(now, -7), isoDate(now, 60));
  const tradingDay = newYorkDate(now);
  const session = sessionFor(days, tradingDay);
  const next = nextTradingDay(days, tradingDay);
  if (next === null) return { ok: false, stage: "calendar", reason: "no next trading day in the calendar window", startup };
  const expiries = expiriesWithin(days, tradingDay, config.decision.expiryMinSessions, config.decision.expiryMaxSessions).slice(0, 3);
  const window: MarketWindow = { underlyings: config.decision.underlyingUniverse, expiries, strikeWindowBps: Math.min(config.decision.maxStrikeDistanceBps, 300) };

  // ---- writer authority through the P2 gateway with the real mutation port ----
  const gateway = createMutationGateway({ paths, secrets, clock, brokerPort: broker.port, instanceId: options.instanceId, lockTakeoverBoundMs: config.scheduling.lockTakeoverBoundMs, binding });
  const [positions, openOrders] = await Promise.all([broker.read.positions(), broker.read.openOrders()]);
  const virgin = positions.every(position => position.quantity === 0) && openOrders.length === 0;
  const acquired = await gateway.acquireAuthority({ account: virgin ? "virgin" : "non_virgin" });
  if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") return { ok: false, stage: "authority", reason: `authority not acquired: ${JSON.stringify(acquired)}`, startup };
  const epoch = acquired.epoch;
  log(`authority epoch ${String(epoch)} (${acquired.kind}); trading day ${tradingDay}; expiries ${expiries.join(",")}`);

  /** A refusal after acquisition journals the reason and releases the holder record; a crash leaves it to age out (S-G12-01). */
  async function haltForAnalyst(detail: string): Promise<void> {
    const draft: JournalDraft = haltDraft({ atIso: epochMsToUtcIso(clock()), epoch }, "CONFIG_INVALID", detail);
    await gateway.dispatch({ class: "authoritative", epoch, action: { kind: "journal_append", entry: draft } });
    removeHolder(paths);
  }

  // ---- the analyst boundary: pinned build/launch verification, exact inventory, then the Claude session over the proxied child ----
  const manifestPath = path.join(repoRoot, config.manifestPath);
  const lockPath = path.join(repoRoot, config.runtimeLockPath);
  const manifest = validateAnalystManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const lock = validateRuntimeLock(JSON.parse(readFileSync(lockPath, "utf8")));
  if (!manifest.ok || !lock.ok) {
    await haltForAnalyst("analyst manifest or runtime lock invalid");
    return { ok: false, stage: "analyst", reason: [...(manifest.ok ? [] : manifest.issues), ...(lock.ok ? [] : lock.issues)].join("; "), startup };
  }
  const environment = analystEnvironmentPaths(env);
  if (environment === null || !environmentExists(environment)) {
    await haltForAnalyst("dedicated analyst environment is not configured or absent");
    return { ok: false, stage: "analyst", reason: "ANALYST_MCP_ENVIRONMENT_ROOT / ANALYST_PYTHON_RUNTIME / ANALYST_PYTHON_LAUNCHER must name the dedicated environment", startup };
  }
  const devCredentials = roleCredentials(env, "dev");
  const ports = createEnvironmentPorts(environment);
  const launch = await launchVerifiedAnalystChild({
    lock: lock.value,
    manifest: manifest.value,
    credentials: { devKeyId: devCredentials.keyId, devSecretKey: devCredentials.secretKey },
    osEnvAllowlist: analystOsAllowlist(),
    osEnv: analystOsEnv(options.processEnv, environment),
    evidence: ports.evidence,
    child: ports.child,
  });
  if (!launch.ok) {
    const detail = `analyst launch refused at ${launch.stage}: ${[...launch.violations.map(item => `${item.code}: ${item.detail}`), ...launch.issues].join("; ")}`;
    await haltForAnalyst(detail);
    return { ok: false, stage: "analyst", reason: detail, startup };
  }
  const child = launch.child as VerifiedChildHandle;
  const observation = ports.lastObservation();
  const extra = ports.extra();
  if (observation === null) {
    await child.stop();
    removeHolder(paths);
    return { ok: false, stage: "digest", reason: "no launch observation was recorded", startup };
  }
  const runtime = computeRuntimeDigest(repoRoot, {
    lockSha256: sha256File(lockPath),
    manifestSha256: sha256File(manifestPath),
    sourceRepository: observation.sourceRepository,
    sourceCommit: observation.sourceCommit,
    packageName: observation.packageName,
    packageVersion: observation.packageVersion,
    interpreterLauncherSha256: observation.interpreterLauncherSha256,
    interpreterRuntimeSha256: observation.interpreterRuntimeSha256,
    launchArtifactsSha256: extra.launchArtifactsSha256,
  });
  const policy = computePolicyDigest(raw, CANONICAL_PAPER_TRADING_ORIGIN);
  if (!runtime.ok || !policy.ok) {
    await child.stop();
    removeHolder(paths);
    return { ok: false, stage: "digest", reason: `${runtime.ok ? "" : runtime.reason} ${policy.ok ? "" : policy.reason}`.trim(), startup };
  }
  log(`runtimeDigest ${runtime.digest} policyDigest ${policy.digest}; analyst inventory ${String(launch.inventory.length)} tools`);

  const oauthToken = env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "";
  if (oauthToken.length === 0) {
    await child.stop();
    removeHolder(paths);
    return { ok: false, stage: "analyst", reason: "CLAUDE_CODE_OAUTH_TOKEN is not set", startup };
  }
  const analystDirectory = path.join(paths.root, "analyst");
  mkdirSync(analystDirectory, { recursive: true });
  const analyst = createClaudeAnalyst({
    child,
    oauthToken,
    model: env["ANALYST_MODEL"] ?? "claude-sonnet-5",
    decisionConfig: config.decision,
    workingDirectory: analystDirectory,
    maxTurns: 16,
    timeoutMs: Math.max(config.analystTimeoutMs - 5_000, 10_000),
    objective: options.objective,
    processEnv: options.processEnv,
    sessionsUntil: expiry => (days.some(day => day.date === expiry) ? remainingSessions(days, tradingDay, expiry) : null),
    log,
  });
  const ping = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: path.join(paths.root, "pings.log"), clock });

  const lifecycle = (overrides: CycleOverrides): LifecycleDeps => ({
    flattenDate: overrides.flattenDate ?? config.flattenDate,
    nextTradingDay: next,
    residueMaxSessions: config.residueMaxSessions,
    closeEscalationStepCents: config.closeEscalationStepCents,
    finalCycleOfSession: overrides.finalCycleOfSession ?? (clock() + config.decision.cycleIntervalMs > session.closesAt),
    competitionStartMs: Date.parse(config.competitionStartIso),
    initialCapitalCents: config.execution.initialCapitalCents,
    // The validated bundle carries ISO instants; the S-CYC-12 core takes epoch milliseconds.
    qualification: { checkpointMs: Date.parse(config.qualification.checkpointIso), windowEndMs: Date.parse(config.qualification.windowEndIso), maxLossCents: config.qualification.maxLossCents },
  });

  return {
    ok: true,
    runtime: {
      config, raw, env, paths, binding, broker, gateway, epoch, days, tradingDay, session, window, child,
      mcpInventory: launch.inventory, runtimeDigest: runtime.digest, policyDigest: policy.digest, secrets, ping,
      market: () => broker.market(window),
      cycle: (cycleIndex, overrides = {}) => runCycle({
        gateway,
        epoch,
        paths,
        binding,
        broker: overrides.broker ?? broker.read,
        market: () => broker.market(window),
        analyst: overrides.analyst ?? analyst,
        analystTimeoutMs: config.analystTimeoutMs,
        clock,
        calendar: session,
        tradingDay,
        cycleIndex,
        profile: config.profile,
        decisionConfig: config.decision,
        executionConfig: config.execution,
        lifecycle: lifecycle(overrides),
        ping,
      }),
      shutdown: async () => {
        await child.stop();
        removeHolder(paths);
      },
    },
  };
}
