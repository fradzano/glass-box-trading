// The composition root for a real run (P7): validate the configuration
// fail-closed (S-CYC-11), bind the role's credentials, build the Alpaca
// adapter without calling it, acquire writer authority before broker truth,
// then bind the account, read the calendar, launch the verified analyst child, compute both S-ARM-01
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
import { createAccountBoundBrokerPort, verifyActiveAccount } from "./account-bound-broker.js";
import { ARMING_CERTIFICATE_INVALID, evaluateArmingGate } from "./arming-gate.js";
import { createClaudeAnalyst } from "./analyst-claude.js";
import { launchVerifiedAnalystChild, MCP_CHILD_OPERATION_TIMEOUT_MS } from "./analyst-mcp-launcher.js";
import { runCycle } from "./cycle-runner.js";
import { runWithinCycleWalltime } from "./cycle-walltime.js";
import type { AnalystInput, CycleReport, LifecycleDeps, PingPort } from "./cycle-runner.js";
import { createFileDiagnosticSink } from "./diagnostic-sink.js";
import { computePolicyDigest, computeRuntimeDigest, sha256File } from "./digests.js";
import type { BrokerReadPort } from "./fake-broker.js";
import { newYorkDate, nextTradingDay, remainingSessions, sessionFor } from "./market-calendar.js";
import { cycleWindow, entryWindow } from "./market-window.js";
import type { WindowConfig } from "./market-window.js";
import type { CalendarDay } from "./market-calendar.js";
import { analystOsAllowlist, analystOsEnv, createEnvironmentPorts, environmentExists } from "./mcp-environment.js";
import type { VerifiedChildHandle } from "./mcp-environment.js";
import { releaseHolder } from "./epoch-store.js";
import { createMutationGateway } from "./mutation-gateway.js";
import type { MutationGateway } from "./mutation-gateway.js";
import { createPingPort } from "./ping-healthchecks.js";
import { httpStatusOf } from "./broker-errors.js";
import { analystEnvironmentPaths, loadEnvironment, loadPolicy, rawStartupConfig, roleCredentials, secretValues } from "./runtime-config.js";
import type { EnvRecord } from "./runtime-config.js";
import type { StatePaths } from "./state-dir.js";
import { withOperationTimeout } from "./operation-timeout.js";

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
  readonly instanceId: string;
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
  /** The ad-hoc observation of the certificate driver and the CLI probe; held identities default to none. */
  market(heldContractIds?: readonly string[]): Promise<MarketObservation>;
  shutdown(): Promise<void>;
}

export type RuntimeBuild =
  | { readonly ok: true; readonly runtime: AgentRuntime }
  | { readonly ok: false; readonly stage: "startup" | "credentials" | "suppressed" | "account_binding" | "calendar" | "authority" | "analyst" | "digest" | "arming"; readonly reason: string; readonly startup: StartupOutcome | null };

/**
 * The cycle's market port (S-X-07): the observation is rebuilt per call around
 * the identities the caller's book holds. Named and exported so the forwarding
 * itself is measurable — R41-C2 found this seam and three like it passing the
 * whole suite with the identities replaced by an empty list.
 */
/**
 * What the deferred delivery must send for a finished cycle (S-G14-05). Named
 * and exported because the binding that used to do this inline shipped a real
 * defect: it delivered `alarmConditions`, so a fenced cycle POSTed an empty
 * alert body and the operator would have been woken by a signal that said
 * nothing. A one-line binding to a tested function is the smallest shape that
 * cannot repeat it.
 */
export function readinessDelivery(report: { readonly ping: "success" | "fail" | "none" | null; readonly pingConditions: readonly string[] }): { readonly kind: "success" } | { readonly kind: "fail"; readonly conditions: readonly string[] } | null {
  if (report.ping === "success") return { kind: "success" };
  if (report.ping === "fail") return { kind: "fail", conditions: report.pingConditions };
  return null;
}

export function cycleMarketPort(
  market: (window: MarketWindow, deadlineAtMs?: number) => Promise<MarketObservation>,
  days: readonly CalendarDay[],
  tradingDay: string,
  config: WindowConfig,
): (heldContractIds?: readonly string[], deadlineAtMs?: number) => Promise<MarketObservation> {
  return (heldContractIds = [], deadlineAtMs) => market(cycleWindow(days, tradingDay, config, heldContractIds), deadlineAtMs);
}

function isoDate(ms: number, offsetDays: number): string {
  return new Date(ms + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function runtimeCleanupErrors(child: Pick<VerifiedChildHandle, "stop">, paths: StatePaths, holderId: string, stopTimeoutMs: number): Promise<unknown[]> {
  const [stopped, released] = await Promise.allSettled([
    withOperationTimeout(() => child.stop(), stopTimeoutMs, "MCP_STOP_TIMEOUT"),
    Promise.resolve().then(() => releaseHolder(paths, holderId)),
  ]);
  const errors: unknown[] = [];
  if (stopped.status === "rejected") errors.push(stopped.reason as unknown);
  if (released.status === "rejected") errors.push(released.reason as unknown);
  return errors;
}

/** The read the S-CYC-09 provenance port issues; `AlpacaBroker` satisfies it, and a test double can too. */
export interface ProvenanceSource {
  readonly provenanceBundle: (deadlineAtMs?: number) => Promise<unknown>;
}

/** Every lifecycle value the runner needs, plus the profile and the source that decides whether a provenance port exists. */
export interface LifecycleComposition {
  readonly profile: "dev" | "competition";
  readonly flattenDate: string;
  readonly nextTradingDay: string;
  readonly residueMaxSessions: number;
  readonly closeEscalationStepCents: number;
  readonly finalCycleOfSession: boolean;
  /** `COMPETITION_START` as epoch milliseconds — the instant the competition account may not predate. */
  readonly competitionStartMs: number;
  /** `INITIAL_CAPITAL_CENTS` — the exact opening cash and equity the proof demands. */
  readonly initialCapitalCents: number;
  readonly qualification: NonNullable<LifecycleDeps["qualification"]>;
  readonly provenanceSource: ProvenanceSource;
  /** The absolute cycle deadline every provenance request inherits. */
  readonly cycleDeadlineMs: number;
}

/**
 * The lifecycle dependency record for one cycle. Pure: it wires ports, it
 * calls none. S-CYC-09 lives in the profile branch — only a competition run
 * carries a `provenance` port at all, so on the dev profile the property is
 * absent and no bundle read can be issued from any path. The expectations
 * (competition start, initial capital) come from the already-validated §0
 * configuration; the expected account ID is the runner's own binding.
 */
export function buildLifecycleDeps(input: LifecycleComposition): LifecycleDeps {
  const base: LifecycleDeps = {
    flattenDate: input.flattenDate,
    nextTradingDay: input.nextTradingDay,
    residueMaxSessions: input.residueMaxSessions,
    closeEscalationStepCents: input.closeEscalationStepCents,
    finalCycleOfSession: input.finalCycleOfSession,
    competitionStartMs: input.competitionStartMs,
    initialCapitalCents: input.initialCapitalCents,
    qualification: input.qualification,
  };
  if (input.profile !== "competition") return base;
  return { ...base, provenance: () => input.provenanceSource.provenanceBundle(input.cycleDeadlineMs) };
}

/** Once a verified child exists, every exceptional construction exit owns its cleanup. */
export async function withVerifiedChildFailureCleanup<T>(child: Pick<VerifiedChildHandle, "stop">, paths: StatePaths, holderId: string, work: () => Promise<T> | T, stopTimeoutMs = MCP_CHILD_OPERATION_TIMEOUT_MS): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const cleanupErrors = await runtimeCleanupErrors(child, paths, holderId, stopTimeoutMs);
    if (cleanupErrors.length > 0) throw new AggregateError([error, ...cleanupErrors], "runtime construction failed and cleanup was incomplete", { cause: error });
    throw error;
  }
}

/** Stop the verified child and release writer ownership independently. */
export async function shutdownRuntimeResources(child: Pick<VerifiedChildHandle, "stop">, paths: StatePaths, holderId: string, stopTimeoutMs = MCP_CHILD_OPERATION_TIMEOUT_MS): Promise<void> {
  const cleanupErrors = await runtimeCleanupErrors(child, paths, holderId, stopTimeoutMs);
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "runtime shutdown cleanup was incomplete");
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
      const ping = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: null, clock, timeoutMs: 10_000 });
      await ping.fail([code]);
    },
    journal: {
      async append(paths, draft): Promise<boolean> {
        const startupInstanceId = `${options.instanceId}-startup`;
        const gateway = createMutationGateway({ paths, secrets, clock, brokerPort: { mutate: () => Promise.resolve({ ok: false, reason: "STARTUP_HAS_NO_BROKER" }) }, instanceId: startupInstanceId, lockTakeoverBoundMs: 60_000 });
        try {
          const acquired = await gateway.acquireAuthority({ account: "unknown" });
          if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") return false;
          const result = await gateway.dispatch({ class: "authoritative", epoch: acquired.epoch, action: { kind: "journal_append", entry: draft({ atIso: epochMsToUtcIso(clock()), epoch: acquired.epoch }) } });
          return result.ok;
        } finally {
          await releaseHolder(paths, startupInstanceId);
        }
      },
    },
    clock,
  });
  if (!startup.armed || startup.config === null || startup.paths === null) {
    return { ok: false, stage: "startup", reason: `refused to arm: ${startup.refusal ?? "unknown"} ${startup.violations.map(item => `${item.field}:${item.code}`).join("; ")}`, startup };
  }
  const config = startup.config;
  const paths = startup.paths;
  const expectedAccountId = config.binding.expectedAccountId;
  if (expectedAccountId === undefined || expectedAccountId.trim().length === 0) return { ok: false, stage: "startup", reason: "validated startup omitted EXPECTED_ACCOUNT_ID", startup };
  const credentials = roleCredentials(env, config.profile);
  if (credentials.keyId.length === 0 || credentials.secretKey.length === 0) return { ok: false, stage: "credentials", reason: `no credentials for the ${config.profile} role`, startup };
  const broker = createAlpacaBroker({ credentials: { keyId: credentials.keyId, secretKey: credentials.secretKey }, tradingOrigin: config.binding.canonicalTradingOrigin, dataOrigin: MARKET_DATA_ORIGIN, clock, requestTimeoutMs: Math.min(config.scheduling.cycleWalltimeBudgetMs, 30_000) });
  const expectedBinding: AccountBinding = { profile: config.profile, tradingOrigin: config.binding.canonicalTradingOrigin, accountId: expectedAccountId };
  const bindingObservation = {
    profile: config.profile,
    requestedOrigin: config.binding.canonicalTradingOrigin,
    observedOrigin: config.binding.canonicalTradingOrigin,
    config: config.binding,
    brokerReportedAccountId: async (deadlineAtMs?: number): Promise<string | undefined> => (await broker.read.account(deadlineAtMs)).accountId,
  };
  const startupBrokerPing = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: path.join(paths.root, "pings.log"), clock, timeoutMs: Math.min(config.scheduling.cycleWalltimeBudgetMs, 10_000) });
  const boundBrokerPort = createAccountBoundBrokerPort({ ...bindingObservation, expectedBinding, delegate: broker.port, clock });
  const gateway = createMutationGateway({ paths, secrets, clock, brokerPort: boundBrokerPort, instanceId: options.instanceId, lockTakeoverBoundMs: config.scheduling.lockTakeoverBoundMs, binding: expectedBinding });

  // Fence before broker truth: a live rival suppresses this invocation before
  // account, calendar, position, or order I/O (S-G12-01). A reset/absent store
  // takes the fail-closed GAP_HALT path because virginity cannot be learned
  // before authority without violating the same invariant.
  const acquired = await gateway.acquireAuthority({ account: "unknown" });
  if (acquired.kind === "SUPPRESSED" || acquired.kind === "LOST") {
    const holderId = acquired.kind === "SUPPRESSED" ? acquired.holderId : "epoch-changed";
    const reason = acquired.kind === "SUPPRESSED" ? acquired.reason : "EPOCH_CHANGED" as const;
    const witnessed = await gateway.dispatch({
      class: "witness",
      action: { kind: "journal_append", entry: { at: epochMsToUtcIso(clock()), epoch: null, type: "SUPPRESSED", instanceId: options.instanceId, holderId, reason } },
    });
    if (!witnessed.ok) return { ok: false, stage: "authority", reason: `suppression witness failed before broker I/O: ${witnessed.reason}`, startup };
    return { ok: false, stage: "suppressed", reason: `authority suppressed before broker I/O: ${JSON.stringify(acquired)}`, startup };
  }
  if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") return { ok: false, stage: "authority", reason: `authority not acquired: ${JSON.stringify(acquired)}`, startup };
  const epoch = acquired.epoch;

  const releaseAndRefuse = async (stage: "account_binding" | "calendar", reason: string): Promise<RuntimeBuild> => {
    await releaseHolder(paths, options.instanceId);
    return { ok: false, stage, reason, startup };
  };
  const persistBrokerFence = async (reason: "AUTH_FAILURE" | "ACCOUNT_BINDING_MISMATCH", detail: string): Promise<void> => {
    await gateway.dispatchSafetyHalt({ reason, detail });
    try {
      await startupBrokerPing.fail([reason]);
    } catch {
      // The durable halt is the authority; alert delivery is best effort.
    }
  };

  let verifiedBinding: Awaited<ReturnType<typeof verifyActiveAccount>>;
  try {
    verifiedBinding = await verifyActiveAccount(bindingObservation);
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 401 || status === 403) {
      await persistBrokerFence("AUTH_FAILURE", `active credentials were rejected while observing broker account identity (HTTP ${String(status)})`);
    }
    return releaseAndRefuse("account_binding", `broker account identity could not be observed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!verifiedBinding.ok) {
    await persistBrokerFence("ACCOUNT_BINDING_MISMATCH", verifiedBinding.reason);
    return releaseAndRefuse("account_binding", verifiedBinding.reason);
  }
  const binding: AccountBinding = verifiedBinding.binding;

  // ---- calendar (S-G6-03): the session and the expiry window come from the exchange calendar ----
  const now = clock();
  let days: readonly CalendarDay[];
  try {
    days = await broker.calendar(isoDate(now, -7), isoDate(now, 60));
  } catch (error) {
    const status = httpStatusOf(error);
    if (status === 401 || status === 403) {
      await persistBrokerFence("AUTH_FAILURE", `active credentials were rejected while observing the broker calendar (HTTP ${String(status)})`);
    }
    return releaseAndRefuse("calendar", `broker calendar could not be observed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tradingDay = newYorkDate(now);
  const session = sessionFor(days, tradingDay);
  const next = nextTradingDay(days, tradingDay);
  if (next === null) return releaseAndRefuse("calendar", "no next trading day in the calendar window");
  // The entry window is discovery only; the contracts the book holds are added
  // per cycle from that cycle's own book read (S-X-07, A29).
  const window = entryWindow(days, tradingDay, config.decision);
  const expiries = window.expiries;

  log(`authority epoch ${String(epoch)} (${acquired.kind}); trading day ${tradingDay}; expiries ${expiries.join(",")}`);

  /** A refusal after acquisition journals the reason and releases the holder record; a crash leaves it to age out (S-G12-01). */
  async function haltForAnalyst(detail: string): Promise<void> {
    const draft: JournalDraft = haltDraft({ atIso: epochMsToUtcIso(clock()), epoch }, "CONFIG_INVALID", detail);
    await gateway.dispatch({ class: "authoritative", epoch, action: { kind: "journal_append", entry: draft } });
    await releaseHolder(paths, options.instanceId);
  }

  // ---- the analyst boundary: pinned build/launch verification, exact inventory, then the Claude session over the proxied child ----
  const manifestPath = path.join(repoRoot, config.manifestPath);
  const lockPath = path.join(repoRoot, config.runtimeLockPath);
  let manifest: ReturnType<typeof validateAnalystManifest>;
  let lock: ReturnType<typeof validateRuntimeLock>;
  try {
    manifest = validateAnalystManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    lock = validateRuntimeLock(JSON.parse(readFileSync(lockPath, "utf8")));
  } catch (error) {
    const detail = `analyst manifest or runtime lock could not be read: ${error instanceof Error ? error.message : String(error)}`;
    await haltForAnalyst(detail);
    return { ok: false, stage: "analyst", reason: detail, startup };
  }
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
  let launch: Awaited<ReturnType<typeof launchVerifiedAnalystChild>>;
  try {
    launch = await launchVerifiedAnalystChild({
      lock: lock.value,
      manifest: manifest.value,
      credentials: { devKeyId: devCredentials.keyId, devSecretKey: devCredentials.secretKey },
      osEnvAllowlist: analystOsAllowlist(),
      osEnv: analystOsEnv(options.processEnv, environment),
      evidence: ports.evidence,
      child: ports.child,
    });
  } catch (error) {
    const detail = `analyst launch failed exceptionally: ${error instanceof Error ? error.message : String(error)}`;
    await haltForAnalyst(detail);
    return { ok: false, stage: "analyst", reason: detail, startup };
  }
  if (!launch.ok) {
    const detail = `analyst launch refused at ${launch.stage}: ${[...launch.violations.map(item => `${item.code}: ${item.detail}`), ...launch.issues].join("; ")}`;
    await haltForAnalyst(detail);
    return { ok: false, stage: "analyst", reason: detail, startup };
  }
  const child = launch.child as VerifiedChildHandle;
  try {
    return await withVerifiedChildFailureCleanup(child, paths, options.instanceId, async () => {
      const observation = ports.lastObservation();
      const extra = ports.extra();
      if (observation === null) {
        await shutdownRuntimeResources(child, paths, options.instanceId);
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
        await shutdownRuntimeResources(child, paths, options.instanceId);
        return { ok: false, stage: "digest", reason: `${runtime.ok ? "" : runtime.reason} ${policy.ok ? "" : policy.reason}`.trim(), startup };
      }
      log(`runtimeDigest ${runtime.digest} policyDigest ${policy.digest}; analyst inventory ${String(launch.inventory.length)} tools`);
      // S-ARM-01 (WIN-7, WIN-10): a competition runtime arms only under a certificate that names this exact
      // runtime and policy. The gate is profile-aware, so the dev runtime reads nothing; a refusal halts
      // durably under CONFIG_INVALID and releases the child and the holder like every other post-launch exit.
      const arming = evaluateArmingGate({ profile: config.profile, repoRoot, rawConfig: raw, runtimeDigest: runtime.digest, policyDigest: policy.digest, canonicalTradingOrigin: CANONICAL_PAPER_TRADING_ORIGIN });
      if (!arming.armed) {
        const detail = `${ARMING_CERTIFICATE_INVALID}: ${arming.reasons.join("; ")}`;
        await gateway.dispatch({ class: "authoritative", epoch, action: { kind: "journal_append", entry: haltDraft({ atIso: epochMsToUtcIso(clock()), epoch }, "CONFIG_INVALID", detail) } });
        await shutdownRuntimeResources(child, paths, options.instanceId);
        return { ok: false, stage: "arming", reason: detail, startup };
      }

      const oauthToken = env["CLAUDE_CODE_OAUTH_TOKEN"] ?? "";
      if (oauthToken.length === 0) {
        await shutdownRuntimeResources(child, paths, options.instanceId);
        return { ok: false, stage: "analyst", reason: "CLAUDE_CODE_OAUTH_TOKEN is not set", startup };
      }
      const analystDirectory = path.join(paths.root, "analyst");
      mkdirSync(analystDirectory, { recursive: true });
      const analyst = createClaudeAnalyst({
    child,
    oauthToken,
    model: config.analystModel,
    decisionConfig: config.decision,
    workingDirectory: analystDirectory,
    maxTurns: 16,
    timeoutMs: Math.max(config.analystTimeoutMs - 5_000, 10_000),
    objective: options.objective,
    processEnv: options.processEnv,
    sessionsUntil: expiry => (days.some(day => day.date === expiry) ? remainingSessions(days, tradingDay, expiry) : null),
    log,
  });
      const ping = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: path.join(paths.root, "pings.log"), clock, timeoutMs: Math.min(config.scheduling.cycleWalltimeBudgetMs, 10_000) });

      const lifecycle = (overrides: CycleOverrides, cycleDeadlineMs: number): LifecycleDeps => buildLifecycleDeps({
    profile: config.profile,
    flattenDate: overrides.flattenDate ?? config.flattenDate,
    nextTradingDay: next,
    residueMaxSessions: config.residueMaxSessions,
    closeEscalationStepCents: config.closeEscalationStepCents,
    finalCycleOfSession: overrides.finalCycleOfSession ?? (clock() + config.decision.cycleIntervalMs > session.closesAt),
    competitionStartMs: Date.parse(config.competitionStartIso),
    initialCapitalCents: config.execution.initialCapitalCents,
    // The validated bundle carries ISO instants; the S-CYC-12 core takes epoch milliseconds.
    qualification: { checkpointMs: Date.parse(config.qualification.checkpointIso), windowEndMs: Date.parse(config.qualification.windowEndIso), maxLossCents: config.qualification.maxLossCents },
    // S-CYC-09: the competition bootstrap's fully paginated bundle comes from the real adapter, bounded by this cycle's deadline.
    provenanceSource: broker,
    cycleDeadlineMs,
  });

      return {
    ok: true,
    runtime: {
      instanceId: options.instanceId, config, raw, env, paths, binding, broker, gateway, epoch, days, tradingDay, session, window, child,
      mcpInventory: launch.inventory, runtimeDigest: runtime.digest, policyDigest: policy.digest, secrets, ping,
      market: cycleMarketPort(broker.market, days, tradingDay, config.decision),
      cycle: async (cycleIndex, overrides = {}) => {
        let deadlineAtMs = 0;
        const report = await runWithinCycleWalltime(config.scheduling.cycleWalltimeBudgetMs, clock, cycleDeadlineMs => {
          deadlineAtMs = cycleDeadlineMs;
          return runCycle({
          gateway,
          epoch,
          paths,
          binding,
          broker: overrides.broker ?? broker.read,
          market: cycleMarketPort(broker.market, days, tradingDay, config.decision),
          analyst: overrides.analyst ?? analyst,
          analystTimeoutMs: config.analystTimeoutMs,
          clock,
          cycleDeadlineMs,
          calendar: session,
          tradingDay,
          cycleIndex,
          profile: config.profile,
          decisionConfig: config.decision,
          executionConfig: config.execution,
          lifecycle: lifecycle(overrides, cycleDeadlineMs),
          ping,
          deferPingDelivery: true,
          });
        });
        // A timed-out cycle never reaches this point, so its background
        // continuation cannot emit a late success. The concrete adapter caps
        // delivery to the remaining absolute deadline as well.
        try {
          const delivery = readinessDelivery(report);
          if (delivery?.kind === "success") await ping.success(deadlineAtMs);
          if (delivery?.kind === "fail") await ping.fail(delivery.conditions, deadlineAtMs);
        } catch {
          // Delivery is best effort; a missed success is visible to the dead-man check.
        }
        return report;
      },
      shutdown: async () => {
        await shutdownRuntimeResources(child, paths, options.instanceId);
      },
    },
      };
    });
  } catch (error) {
    return { ok: false, stage: "digest", reason: `post-launch runtime construction failed: ${error instanceof Error ? error.message : String(error)}`, startup };
  }
}
