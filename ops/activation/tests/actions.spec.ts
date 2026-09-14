// Unit 8: every effect is exercised only through fakes. These tests never spawn a
// process, touch the repository `.env`, contact Healthchecks, or change Task Scheduler.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { applyAction, createAuthorizedEnvReplacePort } from "../actions/apply.ts";
import type { ActionContext, ActionPorts, DisarmRegistration, EffectResult, EnvFile } from "../actions/apply.ts";
import { inspectCertificateEnv, rewriteCertificateEnv } from "../actions/env.ts";
import type { CheckName, CheckObservation, DigestPair, Reading, TaskName, WorldAction } from "../core/types.ts";

const REPO = "C:\\Users\\felix\\source\\repos\\glass-box-trading";
const ACTIVATION_ROOT = "C:\\Users\\felix\\glass-box-state\\activation-1";
const ENV_FILE = `${REPO}\\.env`;
const CERTIFICATE = "C:\\Users\\felix\\glass-box-state\\dev\\certificate-run-4.json";
const OBSERVED = Date.UTC(2026, 8, 22, 12, 54, 58);
const SCHEDULE_DEADLINE = Date.UTC(2026, 8, 22, 12, 55, 0);
const DIGESTS: DigestPair = { runtimeDigest: "runtime-digest", policyDigest: "policy-digest" };

function hash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function ok<T = undefined>(value = undefined as T): EffectResult<T> {
  return { ok: true, value };
}

function check(fingerprint: string): CheckObservation {
  return { fingerprint, status: "up", lastPingUtcMs: OBSERVED - 60_000, flips: [] };
}

const CHECKS: Readonly<Record<CheckName, CheckObservation>> = {
  liveness: check("hc:liveness"),
  readiness: check("hc:readiness"),
  watchdog: check("hc:watchdog"),
};

function writeAction(overrides: Partial<Extract<WorldAction, { readonly kind: "write-certificate-line" }>> = {}): Extract<WorldAction, { readonly kind: "write-certificate-line" }> {
  return { kind: "write-certificate-line", path: CERTIFICATE, observedAtUtcMs: OBSERVED, leaseNotAfterUtcMs: OBSERVED + 5_000, scheduleNotAfterUtcMs: SCHEDULE_DEADLINE, expectedChecks: CHECKS, expectedDigests: DIGESTS, ...overrides };
}

const CONTEXT: ActionContext = {
  envFile: ENV_FILE,
  repoRoot: REPO,
  activationRoot: ACTIVATION_ROOT,
  anchorDay: "2026-09-22",
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  taskUserId: "DESKTOP-V6EGFDV\\felix",
  taskUserSid: "S-1-5-21-1000",
};

interface FakeOptions {
  readonly now?: number;
  readonly checks?: Reading<Readonly<Record<CheckName, CheckObservation>>>;
  readonly env?: string;
  readonly failTask?: TaskName;
  readonly hangTask?: TaskName;
  readonly failureReason?: string;
  readonly failReplace?: boolean;
  readonly badReread?: boolean;
  readonly commitNow?: number;
  readonly certificateDigests?: DigestPair;
  readonly deploymentDigests?: DigestPair;
  readonly postWriteCertificateDigests?: DigestPair;
  readonly postWriteDeploymentDigests?: DigestPair;
  readonly throwClock?: boolean;
  readonly failReplaceAfterWrite?: boolean;
  readonly lateReplaceAck?: boolean;
  readonly conflictEnv?: string;
  readonly clearFailures?: readonly string[];
}

function fake(options: FakeOptions = {}): { readonly ports: ActionPorts; readonly calls: string[]; readonly registrations: DisarmRegistration[]; readonly taskState: Record<TaskName, boolean>; env: string } {
  const state = { env: options.env ?? "ALPACA_PROFILE=competition\r\nSTATE_DIR=C:\\state\r\n" };
  const calls: string[] = [];
  const registrations: DisarmRegistration[] = [];
  const taskState: Record<TaskName, boolean> = { cycle: false, watchdog: false };
  let replaced = false;
  const replaceEnv = createAuthorizedEnvReplacePort({
    nowAtLinearisation: () => options.commitNow ?? options.now ?? OBSERVED + 1_000,
    compareAndSwap: (file, expectedSha256, text, authorizeAtLinearisation, signal) => {
      calls.push(`replace-env:${file}`);
      if (options.failReplace === true && !replaced) return Promise.resolve({ ok: false as const, reason: "CAS_REFUSED", effect: "not-applied" as const });
      if (options.conflictEnv !== undefined && !replaced) state.env = options.conflictEnv;
      if (hash(state.env) !== expectedSha256) return Promise.resolve({ ok: false as const, reason: "CAS_CHANGED", effect: "not-applied" as const });
      const authorization = authorizeAtLinearisation();
      if (!authorization.ok) return Promise.resolve({ ok: false as const, reason: authorization.reason, effect: "not-applied" as const });
      state.env = text;
      const wasFirstReplace = !replaced;
      replaced = true;
      if (options.lateReplaceAck === true && wasFirstReplace) return new Promise(resolve => {
        signal.addEventListener("abort", () => { setTimeout(() => { resolve(ok(hash(text))); }, 1); }, { once: true });
      });
      if (options.failReplaceAfterWrite === true && wasFirstReplace) return Promise.resolve({ ok: false as const, reason: "FSYNC_FAILED", effect: "unknown" as const });
      return Promise.resolve(ok(hash(text)));
    },
  });
  const ports: ActionPorts = {
    now: () => { calls.push("now"); if (options.throwClock === true) throw new Error("clock secret"); return options.now ?? OBSERVED + 1_000; },
    readChecks: () => { calls.push("read-checks"); return Promise.resolve(options.checks ?? { known: true, value: CHECKS }); },
    readEnv: file => {
      calls.push(`read-env:${file}`);
      const text = replaced && options.badReread === true ? `${state.env}# changed\r\n` : state.env;
      return Promise.resolve(ok<EnvFile>({ text, sha256: hash(text) }));
    },
    validateCertificate: () => { calls.push("validate-certificate"); return Promise.resolve(ok(replaced ? options.postWriteCertificateDigests ?? DIGESTS : options.certificateDigests ?? DIGESTS)); },
    readDeploymentDigests: () => { calls.push("read-deployment-digests"); return Promise.resolve(ok(replaced ? options.postWriteDeploymentDigests ?? DIGESTS : options.deploymentDigests ?? DIGESTS)); },
    replaceEnv,
    setTaskEnabled: (task, enabled, signal) => {
      calls.push(`${enabled ? "enable" : "disable"}:${task}`);
      if (options.hangTask === task) return new Promise(resolve => {
        const late = setTimeout(() => { taskState[task] = enabled; resolve(ok()); }, 30_001);
        signal.addEventListener("abort", () => { clearTimeout(late); setTimeout(() => { resolve({ ok: false, reason: "ABORTED", effect: "not-applied" }); }, 1); }, { once: true });
      });
      taskState[task] = enabled;
      return Promise.resolve(options.failTask === task ? { ok: false as const, reason: options.failureReason ?? "TASK_REFUSED" } : ok());
    },
    installTasks: coverage => { calls.push(`install:${coverage}`); return Promise.resolve(ok()); },
    verifyInstalledTasks: () => { calls.push("verify-installed"); return Promise.resolve(ok({ checkCount: 53, actionLines: { cycle: "cycle action", watchdog: "watchdog action" } })); },
    registerDisarm: registration => { calls.push("register-disarm"); registrations.push(registration); return Promise.resolve(ok()); },
    deleteDisarm: () => { calls.push("delete-disarm"); return Promise.resolve(ok()); },
    restart: () => { calls.push("restart"); return Promise.resolve(ok()); },
    clearReadiness: () => { calls.push("clear:readiness"); return Promise.resolve(options.clearFailures?.includes("readiness") === true ? { ok: false as const, reason: "REFUSED" } : ok()); },
    pingSuccess: checkName => { calls.push(`clear:${checkName}`); return Promise.resolve(options.clearFailures?.includes(checkName) === true ? { ok: false as const, reason: "REFUSED" } : ok()); },
  };
  return { ports, calls, registrations, taskState, get env() { return state.env; }, set env(value: string) { state.env = value; } };
}

describe("unit 8 — certificate environment rewrite", () => {
  it("preserves unrelated CRLF bytes while replacing or removing the one certificate line", () => {
    const original = "A=1\r\nPRE_ARM_CERTIFICATE=old\r\n# keep me\r\n";
    const written = rewriteCertificateEnv(original, CERTIFICATE);
    expect(written).toEqual({ ok: true, text: `A=1\r\n# keep me\r\nPRE_ARM_CERTIFICATE="${CERTIFICATE}"\r\n` });
    if (!written.ok) throw new Error(written.reason);
    expect(inspectCertificateEnv(written.text)).toEqual({ occurrences: 1, value: CERTIFICATE });
    expect(rewriteCertificateEnv(written.text, null)).toEqual({ ok: true, text: "A=1\r\n# keep me\r\n" });
  });

  it("refuses duplicate keys and paths that could inject another line", () => {
    expect(rewriteCertificateEnv("PRE_ARM_CERTIFICATE=a\nPRE_ARM_CERTIFICATE=b\n", CERTIFICATE)).toEqual({ ok: false, reason: "CERTIFICATE_KEY_DUPLICATE" });
    expect(rewriteCertificateEnv("A=1\n", "safe\nALPACA_PROFILE=dev")).toEqual({ ok: false, reason: "CERTIFICATE_PATH_INVALID" });
  });
});

describe("unit 8 — certificate action", () => {
  it("reads checks then the clock immediately before the compare-and-swap write, and verifies the result", async () => {
    const host = fake();
    const result = await applyAction(writeAction(), host.ports, CONTEXT);
    expect(result).toMatchObject({ ok: true, value: { kind: "write-certificate-line" } });
    expect(host.calls).toEqual([`read-env:${ENV_FILE}`, "validate-certificate", "read-deployment-digests", "read-checks", "now", `replace-env:${ENV_FILE}`, `read-env:${ENV_FILE}`, "validate-certificate", "read-deployment-digests"]);
    expect(inspectCertificateEnv(host.env)).toEqual({ occurrences: 1, value: CERTIFICATE });
  });

  it.each([
    ["absolute schedule deadline", SCHEDULE_DEADLINE + 1, { known: true, value: CHECKS } as const, {}, "SCHEDULE_DEADLINE_EXPIRED"],
    ["healthchecks lease", OBSERVED + 5_001, { known: true, value: CHECKS } as const, { scheduleNotAfterUtcMs: SCHEDULE_DEADLINE + 60_000 }, "CHECK_LEASE_EXPIRED"],
    ["unknown fresh check read", OBSERVED + 1, { known: false, reason: "API_UNREACHABLE" } as const, { scheduleNotAfterUtcMs: SCHEDULE_DEADLINE + 60_000 }, "CHECKS_UNKNOWN"],
  ])("does not write after %s", async (_name, now, checks, actionOverrides, reason) => {
    const host = fake({ now, checks });
    expect(await applyAction(writeAction(actionOverrides), host.ports, CONTEXT)).toEqual({ ok: false, reason });
    expect(host.calls).not.toContain(`replace-env:${ENV_FILE}`);
    expect(inspectCertificateEnv(host.env).occurrences).toBe(0);
  });

  it("allows equality at each upper boundary and refuses the millisecond after it", async () => {
    const scheduleEqual = fake({ now: SCHEDULE_DEADLINE });
    expect((await applyAction(writeAction(), scheduleEqual.ports, CONTEXT)).ok).toBe(true);
    const leaseEqual = fake({ now: OBSERVED + 5_000 });
    expect((await applyAction(writeAction({ scheduleNotAfterUtcMs: SCHEDULE_DEADLINE + 60_000 }), leaseEqual.ports, CONTEXT)).ok).toBe(true);
  });

  it("does not write when a fresh check changed", async () => {
    const changed = { ...CHECKS, readiness: { ...CHECKS.readiness, lastPingUtcMs: OBSERVED } };
    const host = fake({ checks: { known: true, value: changed } });
    expect(await applyAction(writeAction(), host.ports, CONTEXT)).toEqual({ ok: false, reason: "CHECK_CHANGED" });
    expect(host.calls).not.toContain(`replace-env:${ENV_FILE}`);
  });

  it("binds authorization to write linearisation and validates both digests before and after it", async () => {
    const late = fake({ now: SCHEDULE_DEADLINE, commitNow: SCHEDULE_DEADLINE + 1 });
    expect((await applyAction(writeAction(), late.ports, CONTEXT)).ok).toBe(false);
    expect(inspectCertificateEnv(late.env).occurrences).toBe(0);
    const changed = fake({ postWriteCertificateDigests: { ...DIGESTS, runtimeDigest: "changed" } });
    expect((await applyAction(writeAction(), changed.ports, CONTEXT)).ok).toBe(false);
    expect(inspectCertificateEnv(changed.env).occurrences).toBe(0);
  });

  it("fails closed when the clock throws or a replace reports failure after mutation", async () => {
    const clock = fake({ throwClock: true });
    expect(await applyAction(writeAction(), clock.ports, CONTEXT)).toEqual({ ok: false, reason: "ACTION_CLOCK_THREW" });
    const uncertain = fake({ failReplaceAfterWrite: true });
    expect((await applyAction(writeAction(), uncertain.ports, CONTEXT)).ok).toBe(false);
    expect(inspectCertificateEnv(uncertain.env).occurrences).toBe(0);
    expect(uncertain.calls).toContain("disable:cycle");
    expect(uncertain.calls).toContain("disable:watchdog");
  });

  it("compensates a write that committed before its acknowledgement timed out", async () => {
    vi.useFakeTimers();
    try {
      const host = fake({ lateReplaceAck: true });
      const pending = applyAction(writeAction(), host.ports, CONTEXT);
      await vi.advanceTimersByTimeAsync(30_001);
      expect((await pending).ok).toBe(false);
      expect(inspectCertificateEnv(host.env).occurrences).toBe(0);
      expect(host.calls).toContain("disable:cycle");
      expect(host.calls).toContain("disable:watchdog");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on a compare-and-swap refusal or a mismatching reread", async () => {
    const conflict = fake({ failReplace: true });
    expect(await applyAction(writeAction(), conflict.ports, CONTEXT)).toEqual({ ok: false, reason: "REPLACE_ENV:PORT_REFUSED:NOT_REQUIRED" });
    const mismatch = fake({ badReread: true });
    expect(await applyAction(writeAction(), mismatch.ports, CONTEXT)).toEqual({ ok: false, reason: "REREAD_ENV:VERIFICATION_FAILED:COMPENSATION_INCOMPLETE:env:PORT_REFUSED" });
    expect(mismatch.calls).toContain("disable:cycle");
    expect(mismatch.calls).toContain("disable:watchdog");
  });

  it("removes the certificate line without reading Healthchecks", async () => {
    const host = fake({ env: `A=1\nPRE_ARM_CERTIFICATE="${CERTIFICATE}"\nPRE_ARM_CERTIFICATE=stale\n` });
    expect((await applyAction({ kind: "remove-certificate-line" }, host.ports, CONTEXT)).ok).toBe(true);
    expect(inspectCertificateEnv(host.env).occurrences).toBe(0);
    expect(host.calls).not.toContain("read-checks");
  });

  it("preserves a concurrent env change when the guarded compare-and-swap did not apply", async () => {
    const concurrent = "ALPACA_PROFILE=competition\r\nOPERATOR_SETTING=keep\r\n";
    const host = fake({ conflictEnv: concurrent });
    expect((await applyAction(writeAction(), host.ports, CONTEXT)).ok).toBe(false);
    expect(host.env).toBe(concurrent);
  });
});

describe("unit 8 — task, disarm, reboot, install and check actions", () => {
  it("rolls back an incomplete enable, while disable still attempts every requested task", async () => {
    const enable = fake({ failTask: "watchdog" });
    expect((await applyAction({ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }, enable.ports, CONTEXT)).ok).toBe(false);
    expect(enable.calls).toEqual(["enable:cycle", "enable:watchdog", "disable:cycle", "disable:watchdog"]);
    const disable = fake({ failTask: "cycle" });
    expect((await applyAction({ kind: "disable-tasks", tasks: ["cycle", "watchdog"] }, disable.ports, CONTEXT)).ok).toBe(false);
    expect(disable.calls).toEqual(["disable:cycle", "disable:watchdog"]);
  });

  it("bounds a hanging port and never exposes an arbitrary port reason", async () => {
    vi.useFakeTimers();
    try {
      const hanging = fake({ hangTask: "cycle" });
      const pending = applyAction({ kind: "disable-tasks", tasks: ["cycle"] }, hanging.ports, CONTEXT);
      let settled = false;
      void pending.finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: false, reason: "DISABLE_TASKS:cycle:DISABLE_CYCLE_TIMEOUT" });
      expect(hanging.taskState.cycle).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    const secret = fake({ failTask: "cycle", failureReason: "https://hc.example/SECRET" });
    expect(await applyAction({ kind: "disable-tasks", tasks: ["cycle"] }, secret.ports, CONTEXT)).toEqual({ ok: false, reason: "DISABLE_TASKS:cycle:PORT_REFUSED" });
    const token = fake({ failTask: "cycle", failureReason: "SUPERSECRETAPIKEY123" });
    expect(await applyAction({ kind: "disable-tasks", tasks: ["cycle"] }, token.ports, CONTEXT)).toEqual({ ok: false, reason: "DISABLE_TASKS:cycle:PORT_REFUSED" });
  });

  it("registers the disarm one-shot with the exact unattended elevated identity and command", async () => {
    const host = fake();
    const fires = { date: "2026-09-22", minute: 15 * 60 + 5 };
    expect((await applyAction({ kind: "register-disarm", at: fires }, host.ports, CONTEXT)).ok).toBe(true);
    expect(host.registrations).toEqual([{
      taskPath: "\\GlassBoxTrading\\", taskName: "GlassBoxTrading-Disarm", fires,
      execute: CONTEXT.nodePath,
      arguments: [`${REPO}\\ops\\activation\\cli.ts`, "disarm", "--state-root", ACTIVATION_ROOT, "--anchor-day", "2026-09-22"],
      workingDirectory: REPO, userId: CONTEXT.taskUserId, userSid: CONTEXT.taskUserSid,
      runLevel: "Highest", logonType: "S4U", startWhenAvailable: true,
    }]);
  });

  it("refuses a disarm action whose firing day differs from the invocation's anchor", async () => {
    const host = fake();
    expect(await applyAction({ kind: "register-disarm", at: { date: "2026-09-23", minute: 15 * 60 + 5 } }, host.ports, CONTEXT)).toEqual({ ok: false, reason: "REGISTER_DISARM:ANCHOR_DAY_MISMATCH" });
    expect(host.calls).not.toContain("register-disarm");
  });

  it("installs then verifies, and exposes delete and restart as separate effects", async () => {
    const host = fake();
    expect(await applyAction({ kind: "install-tasks", coverageThroughDate: "2026-12-16" }, host.ports, CONTEXT)).toMatchObject({ ok: true, value: { completion: "record-result", detail: { checkCount: 53, actionLines: { cycle: "cycle action", watchdog: "watchdog action" } } } });
    expect((await applyAction({ kind: "delete-disarm" }, host.ports, CONTEXT)).ok).toBe(true);
    expect(await applyAction({ kind: "restart" }, host.ports, CONTEXT)).toMatchObject({ ok: true, value: { kind: "restart", completion: "await-post-boot" } });
    expect(host.calls).toEqual(["install:2026-12-16", "verify-installed", "delete-disarm", "restart"]);
  });

  it("attempts all three check clears and reports every refusal without credentials", async () => {
    const host = fake({ clearFailures: ["readiness", "watchdog"] });
    expect(await applyAction({ kind: "clear-checks" }, host.ports, CONTEXT)).toEqual({ ok: false, reason: "CLEAR_CHECKS:readiness:PORT_REFUSED,watchdog:PORT_REFUSED" });
    expect(host.calls).toEqual(["clear:readiness", "clear:liveness", "clear:watchdog"]);
  });
});
