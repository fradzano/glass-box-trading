// Unit 13: concrete host bindings for the action shell. Every outward operation
// is a fixed executable plus a fixed argument vocabulary; child output and
// endpoint values never become ledger reasons.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as CertificateCore from "../../../src/core/certificate.ts";
import { createAuthorizedEnvReplacePort } from "./apply.ts";
import type { ActionPorts, DisarmRegistration, EffectResult, EnvFile, InstalledTaskEvidence } from "./apply.ts";
import type { TaskName } from "../core/types.ts";
import { childRefusal, parseDotEnvAsRuntime, parsePreflightOutput, parseTasks, parseVerifierOutput, powerShellRefusal } from "../readers/parse.ts";
import { TRUSTED_WINDOWS_POWERSHELL } from "../readers/observe.ts";
import { readHealthchecks } from "../readers/healthchecks-io.ts";
import { combineChecks } from "../readers/parse-healthchecks.ts";

const TASK_PATH = "\\GlassBoxTrading\\";
const TASK_NAMES = { cycle: "GlassBoxTrading-AgentCycle", watchdog: "GlassBoxTrading-Watchdog", disarm: "GlassBoxTrading-Disarm" } as const;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

interface CommandOutput {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr?: string;
}

export interface HostActionOptions {
  readonly repoRoot: string;
  readonly activationRoot: string;
  readonly devStateDir: string;
  readonly devDiagnosticSink: string;
  readonly canonicalTradingOrigin: string;
  readonly envFile?: string;
  readonly runCommand?: (file: string, args: readonly string[], options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly signal: AbortSignal; readonly timeoutMs: number }) => Promise<CommandOutput>;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export interface ActivationPager {
  readonly fail: (reason: string, signal: AbortSignal) => Promise<EffectResult>;
  readonly success: (signal: AbortSignal) => Promise<EffectResult>;
}

function ok<T>(value: T): EffectResult<T> {
  return { ok: true, value };
}

function refused<T>(reason: string, effect: "not-applied" | "unknown" = "not-applied"): EffectResult<T> {
  return { ok: false, reason, effect };
}

function codeOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code;
  return error instanceof Error ? error.name : "FAILED";
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function defaultRun(file: string, args: readonly string[], options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly signal: AbortSignal; readonly timeoutMs: number }): Promise<CommandOutput> {
  return new Promise(resolve => {
    execFile(file, [...args], {
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: options.env }),
      signal: options.signal,
      timeout: options.timeoutMs,
      windowsHide: true,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      resolve({ exitCode: error === null ? 0 : typeof error.code === "number" && error.killed !== true ? error.code : null, stdout, stderr });
    });
  });
}

function psArgs(script: string, args: readonly string[]): readonly string[] {
  return ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args];
}

async function readEnvFile(file: string): Promise<EffectResult<EnvFile>> {
  try {
    const bytes = await readFile(file);
    return ok({ text: bytes.toString("utf8"), sha256: sha256(bytes) });
  } catch (error) {
    return refused(`ENV_READ_${codeOf(error)}`);
  }
}

function dotEnvValue(text: string, key: string): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } {
  const parsed = parseDotEnvAsRuntime(text);
  if (parsed.duplicateKeys.some(candidate => candidate.toUpperCase() === key)) return { ok: false, reason: "ENDPOINT_KEY_DUPLICATE" };
  return { ok: true, value: parsed.values[key] ?? "" };
}

function endpoint(text: string, key: string): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly reason: string } {
  // Paging destinations are deployment configuration. A process environment
  // override must not be able to redirect activation evidence elsewhere.
  const loaded = dotEnvValue(text, key);
  if (!loaded.ok) return loaded;
  if (loaded.value.trim().length === 0) return { ok: false, reason: "ENDPOINT_UNSET" };
  try {
    const url = new URL(loaded.value);
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.hash.length > 0) return { ok: false, reason: "ENDPOINT_INVALID" };
    return { ok: true, value: url.toString().replace(/\/$/u, "") };
  } catch {
    return { ok: false, reason: "ENDPOINT_INVALID" };
  }
}

async function ping(envFile: string, key: string, failReason: string | null, fetchImpl: typeof fetch, signal: AbortSignal): Promise<EffectResult> {
  let text: string;
  try {
    text = await readFile(envFile, "utf8");
  } catch (error) {
    return refused(`ENDPOINT_ENV_${codeOf(error)}`);
  }
  const target = endpoint(text, key);
  if (!target.ok) return refused(target.reason);
  try {
    const response = await fetchImpl(failReason === null ? target.value : `${target.value}/fail`, {
      method: failReason === null ? "GET" : "POST",
      ...(failReason === null ? {} : { body: failReason, headers: { "Content-Type": "text/plain" } }),
      signal,
    });
    return response.ok ? ok(undefined) : refused(`PING_HTTP_${String(response.status)}`);
  } catch (error) {
    return refused(`PING_${codeOf(error)}`, signal.aborted ? "unknown" : "not-applied");
  }
}

export function createActivationPager(options: HostActionOptions): ActivationPager {
  const envFile = options.envFile ?? path.join(options.repoRoot, ".env");
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    fail: (reason, signal) => ping(envFile, "HEALTHCHECK_ACTIVATION_URL", reason, fetchImpl, signal),
    success: signal => ping(envFile, "HEALTHCHECK_ACTIVATION_URL", null, fetchImpl, signal),
  };
}

interface EnvLockLease {
  readonly handle: Awaited<ReturnType<typeof open>>;
  readonly token: string;
}

export interface EnvCasTestHooks {
  readonly beforeFinalCheck?: () => Promise<void>;
  readonly inspectProcessStartUtc?: (pid: number, signal: AbortSignal) => Promise<EffectResult<string | null>>;
}

async function acquireEnvLock(lockFile: string, signal: AbortSignal, inspectProcessStartUtc: NonNullable<EnvCasTestHooks["inspectProcessStartUtc"]>): Promise<EffectResult<EnvLockLease>> {
  const self = await inspectProcessStartUtc(process.pid, signal);
  if (!self.ok || self.value === null) return refused("ENV_LOCK_IDENTITY_UNAVAILABLE", "unknown");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = randomUUID();
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(lockFile, "wx");
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAtUtc: self.value, token })}\n`, "utf8");
      await handle.sync();
      return ok({ handle, token });
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (handle !== null) {
        await unlink(lockFile).catch(() => undefined);
        return refused(`ENV_LOCK_${codeOf(error)}`, "unknown");
      }
      if (codeOf(error) !== "EEXIST") return refused(`ENV_LOCK_${codeOf(error)}`, "unknown");
    }

    let ownerPid: number | null = null;
    let ownerStartedAtUtc: string | null = null;
    try {
      const raw = (await readFile(lockFile, "utf8")).trim();
      if (/^[0-9]+$/u.test(raw)) ownerPid = Number(raw);
      else {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === "object" && parsed !== null && Number.isSafeInteger((parsed as { readonly pid?: unknown }).pid) && typeof (parsed as { readonly startedAtUtc?: unknown }).startedAtUtc === "string") {
          ownerPid = (parsed as { readonly pid: number }).pid;
          ownerStartedAtUtc = (parsed as { readonly startedAtUtc: string }).startedAtUtc;
        }
      }
    } catch (error) {
      if (codeOf(error) === "ENOENT") continue;
      return refused("ENV_LOCK_CORRUPT");
    }
    if (ownerPid === null || ownerStartedAtUtc === null) return refused("ENV_LOCK_CORRUPT");
    const owner = await inspectProcessStartUtc(ownerPid, signal);
    if (!owner.ok) return refused("ENV_LOCK_IDENTITY_UNAVAILABLE", "unknown");
    if (owner.value === ownerStartedAtUtc) return refused("ENV_LOCKED");

    const staleFile = `${lockFile}.stale-${randomUUID()}`;
    try {
      await rename(lockFile, staleFile);
      await unlink(staleFile);
    } catch (error) {
      if (codeOf(error) === "ENOENT") continue;
      return refused(`ENV_LOCK_RECOVERY_${codeOf(error)}`, "unknown");
    }
  }
  return refused("ENV_LOCK_CONTENDED");
}

async function releaseEnvLock(lockFile: string, lease: EnvLockLease): Promise<void> {
  await lease.handle.close().catch(() => undefined);
  try {
    const raw = JSON.parse((await readFile(lockFile, "utf8")).trim()) as unknown;
    if (typeof raw === "object" && raw !== null && (raw as { readonly token?: unknown }).token === lease.token) {
      await unlink(lockFile);
    }
  } catch {
    // A missing or replaced lock is not ours to delete.
  }
}

export async function compareAndSwapEnv(file: string, expectedSha256: string, text: string, authorize: () => { readonly ok: true } | { readonly ok: false; readonly reason: string }, signal: AbortSignal, hooks: EnvCasTestHooks = {}): Promise<EffectResult<string>> {
  const lockFile = `${file}.activation.lock`;
  const tempFile = path.join(path.dirname(file), `.${path.basename(file)}.activation-${String(process.pid)}-${randomUUID()}.tmp`);
  let lease: EnvLockLease | null = null;
  let tempCreated = false;
  try {
    const inspectProcessStartUtc = hooks.inspectProcessStartUtc ?? (() => Promise.resolve(refused("PROCESS_IDENTITY_UNAVAILABLE", "unknown")));
    const acquired = await acquireEnvLock(lockFile, signal, inspectProcessStartUtc);
    if (!acquired.ok) return acquired;
    lease = acquired.value;
    signal.throwIfAborted();
    const current = await readFile(file);
    if (sha256(current) !== expectedSha256) return refused("ENV_CHANGED");
    const temp = await open(tempFile, "wx");
    tempCreated = true;
    try {
      await temp.writeFile(text, "utf8");
      await temp.sync();
    } finally {
      await temp.close();
    }
    signal.throwIfAborted();
    await hooks.beforeFinalCheck?.();
    const finalCurrent = await readFile(file);
    if (sha256(finalCurrent) !== expectedSha256) return refused("ENV_CHANGED");
    const authorized = authorize();
    if (!authorized.ok) return refused(authorized.reason);
    signal.throwIfAborted();
    await rename(tempFile, file);
    tempCreated = false;
    return ok(sha256(text));
  } catch (error) {
    return refused(`ENV_CAS_${codeOf(error)}`, "unknown");
  } finally {
    if (tempCreated) await unlink(tempFile).catch(() => undefined);
    if (lease !== null) await releaseEnvLock(lockFile, lease);
  }
}

async function importCertificateCore(repoRoot: string): Promise<typeof CertificateCore> {
  return (await import(pathToFileURL(path.join(repoRoot, "dist", "core", "certificate.js")).href)) as typeof CertificateCore;
}

export function createHostActionPorts(options: HostActionOptions): ActionPorts {
  const run = options.runCommand ?? defaultRun;
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.now ?? (() => Date.now());
  const envFile = options.envFile ?? path.join(options.repoRoot, ".env");
  const activationScript = path.join(options.repoRoot, "tools", "activation-task.ps1");
  const processStartScript = path.join(options.repoRoot, "ops", "activation", "readers", "host", "read-process-start.ps1");
  const runPs = (script: string, args: readonly string[], signal: AbortSignal, timeoutMs = 120_000) => run(TRUSTED_WINDOWS_POWERSHELL, psArgs(script, args), { cwd: options.repoRoot, signal, timeoutMs });
  const inspectProcessStartUtc = async (pid: number, signal: AbortSignal): Promise<EffectResult<string | null>> => {
    const output = await runPs(processStartScript, ["-TargetProcessId", String(pid)], signal, 30_000);
    if (output.exitCode !== 0) return refused("PROCESS_IDENTITY_UNAVAILABLE", "unknown");
    const value = output.stdout.trim();
    if (value === "ABSENT") return ok(null);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)) return refused("PROCESS_IDENTITY_INVALID", "unknown");
    return ok(value);
  };
  const simplePs = async (args: readonly string[], signal: AbortSignal): Promise<EffectResult> => {
    const output = await runPs(activationScript, args, signal);
    const diagnostic = powerShellRefusal(output.stderr ?? "") ?? "no credential-free diagnostic";
    return output.exitCode === 0 ? ok(undefined) : refused(`HOST_COMMAND_FAILED:${diagnostic}`, output.exitCode === null ? "unknown" : "not-applied");
  };

  return {
    now: clock,
    readChecks: async signal => {
      if (signal.aborted) return { known: false, reason: "healthchecks read aborted" };
      let apiKey: string;
      try {
        // The deployment file is the only activation authority. Ambient process
        // state must not fill in or replace its healthchecks credential.
        const loaded = dotEnvValue(await readFile(envFile, "utf8"), "HEALTHCHECK_IO_API_KEY");
        if (!loaded.ok) return { known: false, reason: loaded.reason };
        if (loaded.value.trim().length === 0) return { known: false, reason: "healthchecks API key unset" };
        apiKey = loaded.value;
      } catch (error) {
        return { known: false, reason: `healthchecks environment ${codeOf(error)}` };
      }
      const health = await readHealthchecks({
        apiKey,
        fetchImpl: async (url, init) => fetchImpl(url, { ...init, signal: AbortSignal.any([init.signal, signal]) }),
        sleep: ms => new Promise<void>((resolve, reject) => {
          if (signal.aborted) { reject(new Error("ABORTED")); return; }
          const timer = setTimeout(resolve, ms);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("ABORTED")); }, { once: true });
        }),
      });
      return combineChecks(health.summaries, health.flips);
    },
    readEnv: (file, signal) => signal.aborted ? Promise.resolve(refused("ENV_ABORTED")) : readEnvFile(file),
    validateCertificate: async (file, signal) => {
      if (signal.aborted) return refused("CERTIFICATE_ABORTED");
      try {
        const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return refused("CERTIFICATE_INVALID");
        const record = raw as Readonly<Record<string, unknown>>;
        const runtimeDigest = record["runtimeDigest"];
        const policyDigest = record["policyDigest"];
        if (typeof runtimeDigest !== "string" || typeof policyDigest !== "string") return refused("CERTIFICATE_INVALID");
        const core = await importCertificateCore(options.repoRoot);
        const validation = core.validateArmingCertificate(raw, { runtimeDigest, policyDigest, canonicalTradingOrigin: options.canonicalTradingOrigin });
        return validation.ok ? ok({ runtimeDigest, policyDigest }) : refused("CERTIFICATE_INVALID");
      } catch (error) {
        return refused(`CERTIFICATE_${codeOf(error)}`);
      }
    },
    readDeploymentDigests: async signal => {
      const output = await run(process.execPath, [path.join(options.repoRoot, "dist", "shell", "certificate-cli.js"), "--preflight"], {
        cwd: options.repoRoot,
        signal,
        timeoutMs: 180_000,
        env: { ...process.env, ALPACA_PROFILE: "dev", STATE_DIR: options.devStateDir, BOOTSTRAP_DIAGNOSTIC_SINK: options.devDiagnosticSink, HEALTHCHECK_PING_URL: "", HEALTHCHECK_LIVENESS_URL: "", HEALTHCHECK_WATCHDOG_URL: "", HEALTHCHECK_ACTIVATION_URL: "" },
      });
      if (output.exitCode !== 0) return refused(`PREFLIGHT_FAILED:${childRefusal(output.stderr ?? "") ?? "no credential-free diagnostic"}`, output.exitCode === null ? "unknown" : "not-applied");
      const parsed = parsePreflightOutput(output.stdout);
      return parsed.known ? ok(parsed.value.digests) : refused("PREFLIGHT_INVALID");
    },
    replaceEnv: createAuthorizedEnvReplacePort({
      nowAtLinearisation: clock,
      compareAndSwap: (file, expectedSha256, text, authorize, signal) => compareAndSwapEnv(file, expectedSha256, text, authorize, signal, { inspectProcessStartUtc }),
    }),
    setTaskEnabled: (task: TaskName, enabled: boolean, signal: AbortSignal) => simplePs(["-Operation", "SetTradingTaskEnabled", "-TradingTask", task, "-Enabled", String(enabled), "-TaskPath", TASK_PATH], signal),
    installTasks: async (coverageThroughDate, signal) => {
      const output = await runPs(path.join(options.repoRoot, "tools", "install-scheduled-task.ps1"), ["-RepoRoot", options.repoRoot, "-NodePath", process.execPath, "-CoverageThroughDate", coverageThroughDate, "-TaskFolder", TASK_PATH], signal, 300_000);
      return output.exitCode === 0 ? ok(undefined) : refused(`INSTALL_COMMAND_FAILED:${powerShellRefusal(output.stderr ?? "") ?? "no credential-free diagnostic"}`, output.exitCode === null ? "unknown" : "not-applied");
    },
    verifyInstalledTasks: async signal => {
      const verified = await runPs(path.join(options.repoRoot, "tools", "verify-scheduled-tasks.ps1"), ["-RepoRoot", options.repoRoot, "-TaskFolder", TASK_PATH], signal, 180_000);
      if (verified.exitCode === null) return refused("VERIFY_COMMAND_FAILED", "unknown");
      const verdict = parseVerifierOutput(verified.stdout, verified.exitCode);
      if (!verdict.known || !verdict.value.passed) return refused("VERIFY_COMMAND_FAILED");
      const tasksOutput = await runPs(path.join(options.repoRoot, "ops", "activation", "readers", "host", "read-tasks.ps1"), ["-TaskPath", TASK_PATH], signal);
      if (tasksOutput.exitCode !== 0) return refused("TASK_READ_FAILED", tasksOutput.exitCode === null ? "unknown" : "not-applied");
      const tasks = parseTasks(tasksOutput.stdout, TASK_NAMES);
      if (!tasks.known) return refused("TASK_READ_INVALID");
      const value: InstalledTaskEvidence = {
        checkCount: verdict.value.checkCount,
        actionLines: {
          cycle: `${tasks.value.cycle.execute} ${tasks.value.cycle.argumentLine}`.trim(),
          watchdog: `${tasks.value.watchdog.execute} ${tasks.value.watchdog.argumentLine}`.trim(),
        },
      };
      return ok(value);
    },
    registerDisarm: (registration: DisarmRegistration, signal: AbortSignal) => {
      const hour = Math.floor(registration.fires.minute / 60);
      const minute = registration.fires.minute % 60;
      const at = `${registration.fires.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
      return simplePs(["-Operation", "RegisterDisarm", "-RepoRoot", options.repoRoot, "-ActivationRoot", options.activationRoot, "-AnchorDay", registration.fires.date, "-NodePath", registration.execute, "-UserId", registration.userId, "-UserSid", registration.userSid, "-DisarmAt", at, "-TaskPath", registration.taskPath], signal);
    },
    deleteDisarm: signal => simplePs(["-Operation", "DeleteDisarm", "-TaskPath", TASK_PATH], signal),
    restart: async signal => {
      const output = await run("C:\\Windows\\System32\\shutdown.exe", ["/r", "/t", "0", "/d", "p:4:1", "/c", "Glass Box Trading activation reboot"], { cwd: options.repoRoot, signal, timeoutMs: 10_000 });
      return output.exitCode === 0 ? ok(undefined) : refused("RESTART_COMMAND_FAILED", "unknown");
    },
    clearReadiness: signal => ping(envFile, "HEALTHCHECK_PING_URL", null, fetchImpl, signal),
    pingSuccess: (check, signal) => ping(envFile, check === "liveness" ? "HEALTHCHECK_LIVENESS_URL" : "HEALTHCHECK_WATCHDOG_URL", null, fetchImpl, signal),
  };
}
