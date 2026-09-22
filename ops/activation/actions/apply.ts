// Unit 8: the activation effect shell. Decisions arrive as closed WorldAction
// variants; all effects sit behind ports so tests cannot touch the host.
import { createHash } from "node:crypto";
import path from "node:path";
import { authorizeCertificateWrite, refreshCertificateWriteLease } from "../core/decide.ts";
import type { CertificateWriteAction, CertificateWriteAuthorization } from "../core/decide.ts";
import type { CheckName, CheckObservation, DigestPair, LocalInstant, Reading, TaskName, WorldAction } from "../core/types.ts";
import { inspectCertificateEnv, rewriteCertificateEnv } from "./env.ts";

export type EffectResult<T = undefined> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly effect?: "not-applied" | "unknown" };

export interface EnvFile {
  readonly text: string;
  readonly sha256: string;
}

export interface CertificateWriteGuard {
  readonly action: CertificateWriteAction;
  readonly freshChecks: Reading<Readonly<Record<CheckName, CheckObservation>>>;
}

const AUTHORIZED_ENV_REPLACE = Symbol("authorized-env-replace");

export interface EnvCompareAndSwapPrimitive {
  readonly nowAtLinearisation: () => number;
  /** Invokes authorizeAtLinearisation inside the atomic commit operation and mutates only when it returns ok. */
  readonly compareAndSwap: (file: string, expectedSha256: string, text: string, authorizeAtLinearisation: () => CertificateWriteAuthorization, signal: AbortSignal) => Promise<EffectResult<string>>;
}

export type AuthorizedEnvReplace = ((file: string, expectedSha256: string, text: string, guard: CertificateWriteGuard | null, signal: AbortSignal) => Promise<EffectResult<string>>) & {
  readonly [AUTHORIZED_ENV_REPLACE]: true;
};

/**
 * The only constructor for a certificate-capable CAS port. It gives the primitive
 * the same authorization callback to invoke inside its atomic commit operation at
 * the write's linearisation point. Concrete host binding remains unit 13.
 */
export function createAuthorizedEnvReplacePort(primitive: EnvCompareAndSwapPrimitive): AuthorizedEnvReplace {
  const replace = async (file: string, expectedSha256: string, text: string, guard: CertificateWriteGuard | null, signal: AbortSignal): Promise<EffectResult<string>> => {
    const authorizeAtLinearisation = (): CertificateWriteAuthorization => {
      if (guard === null) return { ok: true };
      let actionUtcMs: number;
      try { actionUtcMs = primitive.nowAtLinearisation(); } catch { return { ok: false, reason: "ACTION_CLOCK_INVALID" }; }
      return authorizeCertificateWrite(guard.action, actionUtcMs, guard.freshChecks);
    };
    return primitive.compareAndSwap(file, expectedSha256, text, authorizeAtLinearisation, signal);
  };
  return Object.assign(replace, { [AUTHORIZED_ENV_REPLACE]: true as const });
}

export interface DisarmRegistration {
  readonly taskPath: "\\GlassBoxTrading\\";
  readonly taskName: "GlassBoxTrading-Disarm";
  readonly fires: LocalInstant;
  readonly execute: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly userId: string;
  readonly userSid: string;
  readonly runLevel: "Highest";
  readonly logonType: "S4U";
  readonly startWhenAvailable: true;
}

export interface InstalledTaskEvidence {
  readonly checkCount: number;
  readonly actionLines: Readonly<Record<TaskName, string>>;
}

export interface ActionContext {
  readonly envFile: string;
  readonly repoRoot: string;
  readonly activationRoot: string;
  readonly anchorDay: string;
  readonly nodePath: string;
  readonly taskUserId: string;
  readonly taskUserSid: string;
  /**
   * Which platform's rules decide whether two spellings of an environment key are one
   * variable. It is a parameter rather than a read of `process.platform`, so the rule the
   * runtime applies on Windows can be stated and tested rather than inherited.
   */
  readonly platform: NodeJS.Platform;
}

export interface ActionPorts {
  /**
   * Every asynchronous port must honor AbortSignal, settle after abort, and
   * guarantee that no new effect can occur after settlement. The shell waits for
   * that quiescence before it compensates or returns.
   */
  readonly now: () => number;
  readonly readChecks: (signal: AbortSignal) => Promise<Reading<Readonly<Record<CheckName, CheckObservation>>>>;
  readonly readEnv: (file: string, signal: AbortSignal) => Promise<EffectResult<EnvFile>>;
  /** Returns digests only after the runtime certificate validator accepts the entire file. */
  readonly validateCertificate: (file: string, signal: AbortSignal) => Promise<EffectResult<DigestPair>>;
  readonly readDeploymentDigests: (signal: AbortSignal) => Promise<EffectResult<DigestPair>>;
  /**
   * Atomic compare-and-swap of the whole file. With a guard, the port samples its
   * clock at linearisation and calls authorizeCertificateWrite with the same
   * action/check reading; it must refuse before mutation if that answer is red.
   */
  readonly replaceEnv: AuthorizedEnvReplace;
  readonly setTaskEnabled: (task: TaskName, enabled: boolean, signal: AbortSignal) => Promise<EffectResult>;
  readonly installTasks: (coverageThroughDate: string, signal: AbortSignal) => Promise<EffectResult>;
  readonly verifyInstalledTasks: (signal: AbortSignal) => Promise<EffectResult<InstalledTaskEvidence>>;
  readonly registerDisarm: (registration: DisarmRegistration, signal: AbortSignal) => Promise<EffectResult>;
  readonly deleteDisarm: (signal: AbortSignal) => Promise<EffectResult>;
  readonly restart: (signal: AbortSignal) => Promise<EffectResult>;
  readonly clearReadiness: (signal: AbortSignal) => Promise<EffectResult>;
  readonly pingSuccess: (check: "liveness" | "watchdog", signal: AbortSignal) => Promise<EffectResult>;
}

export interface AppliedAction {
  readonly kind: WorldAction["kind"];
  /** Restart is intent-only; a caller must not append its result before a later post-boot observation. */
  readonly completion: "record-result" | "await-post-boot";
  readonly detail: Readonly<Record<string, unknown>>;
}

const POWERSHELL_ACTION_TIMEOUT_MS = 130_000;
// compareAndSwapEnv may need one 30 s process-identity probe plus four 30 s
// owner probes before it reaches the atomic rename. Keep the shell outside that
// complete child budget, including filesystem overhead.
const ENV_REPLACE_TIMEOUT_MS = 180_000;

function failed(reason: string): EffectResult<AppliedAction> {
  return { ok: false, reason };
}

function applied(kind: WorldAction["kind"], detail: Readonly<Record<string, unknown>> = {}): EffectResult<AppliedAction> {
  return { ok: true, value: { kind, completion: kind === "restart" ? "await-post-boot" : "record-result", detail } };
}

async function safe<T>(operation: (signal: AbortSignal) => Promise<EffectResult<T>>, label: string, timeoutMs = 30_000): Promise<EffectResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = Symbol("timed-out");
  try {
    const pending = operation(controller.signal);
    const timeout = new Promise<typeof timedOut>(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(timedOut);
      }, timeoutMs);
    });
    const result = await Promise.race([pending, timeout]);
    if (result === timedOut) {
      try {
        const settled = await pending;
        return { ok: false, reason: `${label}_TIMEOUT`, effect: settled.ok ? "unknown" : settled.effect ?? "unknown" };
      } catch {
        return { ok: false, reason: `${label}_TIMEOUT`, effect: "unknown" };
      }
    }
    // Only the concrete host adapter's explicitly reduced diagnostic classes may
    // cross the credential boundary. Arbitrary/fake port reasons stay opaque.
    const rawReason = result.ok ? "" : result.reason;
    const exactSafeReasons = new Set([
      "ACTION_CLOCK_INVALID", "ACTION_CONTRACT_INVALID", "SCHEDULE_DEADLINE_EXPIRED",
      "CHECK_LEASE_EXPIRED", "CHECKS_UNKNOWN", "CHECK_CHANGED",
      "ENV_ABORTED", "ENV_CHANGED", "ENV_LOCKED", "ENV_LOCK_CORRUPT", "ENV_LOCK_CONTENDED",
    ]);
    const reducedReason = /^(?:HOST_COMMAND_FAILED|INSTALL_COMMAND_FAILED|PREFLIGHT_FAILED):/.test(rawReason)
      ? rawReason
      : exactSafeReasons.has(rawReason)
        ? rawReason
        : rawReason.startsWith("ENV_LOCK_RECOVERY_") || rawReason.startsWith("ENV_LOCK_")
          ? "ENV_LOCK_FAILED"
          : rawReason.startsWith("ENV_CAS_")
            ? "ENV_CAS_FAILED"
            : "PORT_REFUSED";
    return result.ok ? result : { ok: false, reason: reducedReason, effect: result.effect ?? "unknown" };
  } catch {
    return { ok: false, reason: `${label}_THREW` };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function readClock(ports: ActionPorts): EffectResult<number> {
  try {
    const value = ports.now();
    return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, reason: "ACTION_CLOCK_INVALID" };
  } catch {
    return { ok: false, reason: "ACTION_CLOCK_THREW" };
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function compensateUnverifiedCertificateWrite(ports: ActionPorts, context: ActionContext): Promise<string> {
  const failures: string[] = [];
  const current = await safe(signal => ports.readEnv(context.envFile, signal), "ROLLBACK_READ_ENV");
  if (!current.ok || sha256(current.value.text) !== current.value.sha256) {
    failures.push("env:STATE_UNKNOWN");
  } else {
    const cleaned = rewriteCertificateEnv(current.value.text, null, context.platform);
    if (!cleaned.ok) {
      failures.push(`env:${cleaned.reason}`);
    } else {
      const rollback = await safe(signal => ports.replaceEnv(context.envFile, current.value.sha256, cleaned.text, null, signal), "ROLLBACK_ENV", ENV_REPLACE_TIMEOUT_MS);
      if (!rollback.ok || rollback.value !== sha256(cleaned.text)) failures.push(`env:${rollback.ok ? "DIGEST_MISMATCH" : rollback.reason}`);
    }
  }
  for (const task of ["cycle", "watchdog"] as const) {
    const disabled = await safe(signal => ports.setTaskEnabled(task, false, signal), `SAFETY_DISABLE_${task.toUpperCase()}`, POWERSHELL_ACTION_TIMEOUT_MS);
    if (!disabled.ok) failures.push(`${task}:${disabled.reason}`);
  }
  return failures.length === 0 ? "COMPENSATED" : `COMPENSATION_INCOMPLETE:${failures.join(",")}`;
}

function sameDigests(actual: DigestPair, expected: DigestPair): boolean {
  return actual.runtimeDigest === expected.runtimeDigest && actual.policyDigest === expected.policyDigest;
}

async function validateWriteInputs(action: CertificateWriteAction, ports: ActionPorts): Promise<EffectResult> {
  const certificate = await safe(signal => ports.validateCertificate(action.path, signal), "VALIDATE_CERTIFICATE");
  if (!certificate.ok) return certificate;
  if (!sameDigests(certificate.value, action.expectedDigests)) return { ok: false, reason: "CERTIFICATE_DIGEST_CHANGED" };
  // This is the real dev --preflight, including the verified analyst child. Its own
  // deadline is three minutes; the shell must not kill it at safe()'s generic 30 s.
  const deployment = await safe(signal => ports.readDeploymentDigests(signal), "READ_DEPLOYMENT_DIGESTS", 330_000);
  if (!deployment.ok) return deployment;
  return sameDigests(deployment.value, action.expectedDigests) ? { ok: true, value: undefined } : { ok: false, reason: "DEPLOYMENT_DIGEST_CHANGED" };
}

async function replaceCertificate(action: Extract<WorldAction, { readonly kind: "write-certificate-line" | "remove-certificate-line" }>, ports: ActionPorts, context: ActionContext): Promise<EffectResult<AppliedAction>> {
  const before = await safe(signal => ports.readEnv(context.envFile, signal), "READ_ENV");
  if (!before.ok) return failed(`READ_ENV:${before.reason}`);
  if (sha256(before.value.text) !== before.value.sha256) return failed("READ_ENV:DIGEST_MISMATCH");
  const certificatePath = action.kind === "write-certificate-line" ? action.path : null;
  const rewritten = rewriteCertificateEnv(before.value.text, certificatePath, context.platform);
  if (!rewritten.ok) return failed(rewritten.reason);

  let guard: CertificateWriteGuard | null = null;
  if (action.kind === "write-certificate-line") {
    const inputs = await validateWriteInputs(action, ports);
    if (!inputs.ok) return failed(inputs.reason);
    // The management API reads the list, three flip histories and an independent
    // channel endpoint with bounded retries. Keep this outside the generic 30 s too.
    const freshChecks = await safe(async signal => ({ ok: true as const, value: await ports.readChecks(signal) }), "READ_CHECKS", 210_000);
    if (!freshChecks.ok) return failed(`READ_CHECKS:${freshChecks.reason}`);
    const clock = readClock(ports);
    if (!clock.ok) return failed(clock.reason);
    const refreshed = refreshCertificateWriteLease(action, clock.value, freshChecks.value);
    if (!refreshed.ok) return failed(refreshed.reason);
    guard = { action: refreshed.value, freshChecks: freshChecks.value };
  }

  const replaced = await safe(signal => ports.replaceEnv(context.envFile, before.value.sha256, rewritten.text, guard, signal), "REPLACE_ENV", ENV_REPLACE_TIMEOUT_MS);
  const expectedHash = sha256(rewritten.text);
  if (!replaced.ok) {
    const compensation = action.kind === "write-certificate-line" && replaced.effect !== "not-applied" ? await compensateUnverifiedCertificateWrite(ports, context) : "NOT_REQUIRED";
    return failed(`REPLACE_ENV:${replaced.reason}:${compensation}`);
  }
  if (replaced.value !== expectedHash) {
    const compensation = await compensateUnverifiedCertificateWrite(ports, context);
    return failed(`REPLACE_ENV:DIGEST_MISMATCH:${compensation}`);
  }

  const after = await safe(signal => ports.readEnv(context.envFile, signal), "REREAD_ENV");
  if (!after.ok) {
    const compensation = await compensateUnverifiedCertificateWrite(ports, context);
    return failed(`REREAD_ENV:${after.reason}:${compensation}`);
  }
  const inspection = inspectCertificateEnv(after.value.text, context.platform);
  const valueMatches = certificatePath === null ? inspection.occurrences === 0 : inspection.occurrences === 1 && inspection.value === certificatePath;
  if (after.value.sha256 !== expectedHash || sha256(after.value.text) !== expectedHash || !valueMatches) {
    const compensation = await compensateUnverifiedCertificateWrite(ports, context);
    return failed(`REREAD_ENV:VERIFICATION_FAILED:${compensation}`);
  }
  if (action.kind === "write-certificate-line") {
    const inputs = await validateWriteInputs(action, ports);
    if (!inputs.ok) {
      const compensation = await compensateUnverifiedCertificateWrite(ports, context);
      return failed(`POST_WRITE_VALIDATION:${inputs.reason}:${compensation}`);
    }
  }
  return applied(action.kind, { envSha256: expectedHash });
}

async function setTasks(action: Extract<WorldAction, { readonly kind: "enable-tasks" | "disable-tasks" }>, ports: ActionPorts): Promise<EffectResult<AppliedAction>> {
  const enabled = action.kind === "enable-tasks";
  const failures: string[] = [];
  for (const task of action.tasks) {
    const result = await safe(signal => ports.setTaskEnabled(task, enabled, signal), `${enabled ? "ENABLE" : "DISABLE"}_${task.toUpperCase()}`, POWERSHELL_ACTION_TIMEOUT_MS);
    if (!result.ok) failures.push(`${task}:${result.reason}`);
  }
  if (failures.length > 0 && enabled) {
    for (const task of action.tasks) {
      const rollback = await safe(signal => ports.setTaskEnabled(task, false, signal), `ROLLBACK_${task.toUpperCase()}`, POWERSHELL_ACTION_TIMEOUT_MS);
      if (!rollback.ok) failures.push(`rollback-${task}:${rollback.reason}`);
    }
  }
  return failures.length > 0 ? failed(`${enabled ? "ENABLE_TASKS" : "DISABLE_TASKS"}:${failures.join(",")}`) : applied(action.kind, { tasks: action.tasks });
}

function disarmRegistration(action: Extract<WorldAction, { readonly kind: "register-disarm" }>, context: ActionContext): DisarmRegistration {
  return {
    taskPath: "\\GlassBoxTrading\\",
    taskName: "GlassBoxTrading-Disarm",
    fires: action.at,
    execute: context.nodePath,
    arguments: [path.join(context.repoRoot, "ops", "activation", "cli.ts"), "disarm", "--state-root", context.activationRoot, "--anchor-day", context.anchorDay],
    workingDirectory: context.repoRoot,
    userId: context.taskUserId,
    userSid: context.taskUserSid,
    runLevel: "Highest",
    logonType: "S4U",
    startWhenAvailable: true,
  };
}

export async function applyAction(action: WorldAction, ports: ActionPorts, context: ActionContext): Promise<EffectResult<AppliedAction>> {
  switch (action.kind) {
    case "remove-certificate-line":
    case "write-certificate-line":
      return replaceCertificate(action, ports, context);
    case "enable-tasks":
    case "disable-tasks":
      return setTasks(action, ports);
    case "install-tasks": {
      // Installation verifies the protected watchdog bootstrap and schedule coverage
      // before registering two disabled tasks. It has a five-minute child deadline.
      const installed = await safe(signal => ports.installTasks(action.coverageThroughDate, signal), "INSTALL_TASKS", 330_000);
      if (!installed.ok) return failed(`INSTALL_TASKS:${installed.reason}`);
      // The concrete verifier has a 180 s verifier child followed by a 120 s
      // task-definition read; the outer deadline must not pre-empt either.
      const verified = await safe(signal => ports.verifyInstalledTasks(signal), "VERIFY_TASKS", 330_000);
      return verified.ok ? applied(action.kind, { coverageThroughDate: action.coverageThroughDate, checkCount: verified.value.checkCount, actionLines: verified.value.actionLines }) : failed(`VERIFY_TASKS:${verified.reason}`);
    }
    case "register-disarm": {
      if (action.at.date !== context.anchorDay) return failed("REGISTER_DISARM:ANCHOR_DAY_MISMATCH");
      const registered = await safe(signal => ports.registerDisarm(disarmRegistration(action, context), signal), "REGISTER_DISARM", POWERSHELL_ACTION_TIMEOUT_MS);
      return registered.ok ? applied(action.kind, { fires: action.at }) : failed(`REGISTER_DISARM:${registered.reason}`);
    }
    case "delete-disarm": {
      const deleted = await safe(signal => ports.deleteDisarm(signal), "DELETE_DISARM", POWERSHELL_ACTION_TIMEOUT_MS);
      return deleted.ok ? applied(action.kind) : failed(`DELETE_DISARM:${deleted.reason}`);
    }
    case "restart": {
      const restarted = await safe(signal => ports.restart(signal), "RESTART");
      return restarted.ok ? applied(action.kind) : failed(`RESTART:${restarted.reason}`);
    }
    case "clear-checks": {
      const failures: string[] = [];
      const readiness = await safe(signal => ports.clearReadiness(signal), "CLEAR_READINESS");
      if (!readiness.ok) failures.push(`readiness:${readiness.reason}`);
      for (const check of ["liveness", "watchdog"] as const) {
        const ping = await safe(signal => ports.pingSuccess(check, signal), `PING_${check.toUpperCase()}`);
        if (!ping.ok) failures.push(`${check}:${ping.reason}`);
      }
      return failures.length > 0 ? failed(`CLEAR_CHECKS:${failures.join(",")}`) : applied(action.kind, { checks: ["readiness", "liveness", "watchdog"] });
    }
  }
}
