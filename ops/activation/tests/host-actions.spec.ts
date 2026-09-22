import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareAndSwapEnv, createActivationPager, createHostActionPorts } from "../actions/host.ts";

const roots: string[] = [];
const SELF_STARTED_AT = "2026-09-21T22:00:00.0000000Z";

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3 })));
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function options(repoRoot: string, overrides: Partial<Parameters<typeof createHostActionPorts>[0]> = {}): Parameters<typeof createHostActionPorts>[0] {
  return {
    repoRoot,
    activationRoot: path.join(repoRoot, "activation"),
    devStateDir: path.join(repoRoot, "dev"),
    devDiagnosticSink: path.join(repoRoot, "dev", "diagnostics"),
    canonicalTradingOrigin: "https://paper-api.alpaca.markets",
    ...overrides,
  };
}

function inspectStarts(entries: Readonly<Record<number, string | null>> = {}) {
  return (pid: number) => Promise.resolve({ ok: true as const, value: pid === process.pid ? SELF_STARTED_AT : entries[pid] ?? null });
}

function processStartCommand(_file: string, args: readonly string[]) {
  const pid = Number(args.at(-1));
  return Promise.resolve({ exitCode: 0, stdout: pid === process.pid ? `${SELF_STARTED_AT}\n` : "ABSENT\n", stderr: "" });
}

describe("unit 13 host action bindings", () => {
  it("delivers the activation page and clear without returning the endpoint", async () => {
    const root = await tempRoot("gbt-page-");
    const secret = "https://example.test/a-secret-endpoint";
    await writeFile(path.join(root, ".env"), `HEALTHCHECK_ACTIVATION_URL=${secret}\n`, "utf8");
    const calls: { readonly url: string; readonly method: string; readonly body: string }[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method: init?.method ?? "GET", body });
      return Promise.resolve(new Response("", { status: 200 }));
    };
    const pager = createActivationPager(options(root, { fetchImpl }));

    const failure = await pager.fail("ACTIVATION_ABORTED", new AbortController().signal);
    const cleared = await pager.success(new AbortController().signal);

    expect(failure).toEqual({ ok: true, value: undefined });
    expect(cleared).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([
      { url: `${secret}/fail`, method: "POST", body: "ACTIVATION_ABORTED" },
      { url: secret, method: "GET", body: "" },
    ]);
    expect(JSON.stringify([failure, cleared])).not.toContain("a-secret-endpoint");
  });

  it("reduces a page transport failure to an error class", async () => {
    const root = await tempRoot("gbt-page-error-");
    const secret = "https://example.test/credential-shaped-secret";
    await writeFile(path.join(root, ".env"), `HEALTHCHECK_ACTIVATION_URL=${secret}\n`, "utf8");
    const fetchImpl: typeof fetch = () => Promise.reject(new Error(`failed at ${secret}`));
    const pager = createActivationPager(options(root, { fetchImpl }));

    const result = await pager.fail("ACTIVATION_ABORTED", new AbortController().signal);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("refuses an invalid or process-overridden activation endpoint before transport", async () => {
    const root = await tempRoot("gbt-page-invalid-");
    await writeFile(path.join(root, ".env"), "HEALTHCHECK_ACTIVATION_URL=http://example.test/not-tls\n", "utf8");
    let calls = 0;
    const fetchImpl: typeof fetch = () => { calls += 1; return Promise.resolve(new Response("", { status: 200 })); };
    const previous = process.env["HEALTHCHECK_ACTIVATION_URL"];
    process.env["HEALTHCHECK_ACTIVATION_URL"] = "https://redirect.example.test/secret";
    try {
      const result = await createActivationPager(options(root, { fetchImpl })).fail("ACTIVATION_ABORTED", new AbortController().signal);
      expect(result).toMatchObject({ ok: false, reason: "ENDPOINT_INVALID" });
      expect(calls).toBe(0);
    } finally {
      if (previous === undefined) delete process.env["HEALTHCHECK_ACTIVATION_URL"];
      else process.env["HEALTHCHECK_ACTIVATION_URL"] = previous;
    }
  });

  it("replaces .env only while its expected digest still matches", async () => {
    const root = await tempRoot("gbt-env-cas-");
    const envFile = path.join(root, ".env");
    await writeFile(envFile, "ALPACA_PROFILE=dev\n", "utf8");
    const ports = createHostActionPorts(options(root, { envFile, runCommand: processStartCommand }));
    const before = await readFile(envFile, "utf8");
    const digest = createHash("sha256").update(before).digest("hex");

    const replaced = await ports.replaceEnv(envFile, digest, `${before}PRE_ARM_CERTIFICATE=x\n`, null, new AbortController().signal);
    const stale = await ports.replaceEnv(envFile, digest, before, null, new AbortController().signal);

    expect(replaced.ok).toBe(true);
    expect(stale).toMatchObject({ ok: false, effect: "not-applied" });
    expect(await readFile(envFile, "utf8")).toContain("PRE_ARM_CERTIFICATE=x");
  });

  it("rechecks the digest and authorization at the CAS linearisation boundary", async () => {
    const root = await tempRoot("gbt-env-linearisation-");
    const envFile = path.join(root, ".env");
    const before = "ALPACA_PROFILE=dev\n";
    await writeFile(envFile, before, "utf8");
    const digest = createHash("sha256").update(before).digest("hex");
    let authorizationCalls = 0;

    const changed = await compareAndSwapEnv(envFile, digest, `${before}PRE_ARM_CERTIFICATE=x\n`, () => {
      authorizationCalls += 1;
      return { ok: true };
    }, new AbortController().signal, {
      beforeFinalCheck: async () => { await writeFile(envFile, "ALPACA_PROFILE=changed\n", "utf8"); },
      inspectProcessStartUtc: inspectStarts(),
    });
    expect(changed).toMatchObject({ ok: false, reason: "ENV_CHANGED" });
    expect(authorizationCalls).toBe(0);

    await writeFile(envFile, before, "utf8");
    const denied = await compareAndSwapEnv(envFile, digest, `${before}PRE_ARM_CERTIFICATE=x\n`, () => {
      authorizationCalls += 1;
      return { ok: false, reason: "GATE_CLOSED" };
    }, new AbortController().signal, { inspectProcessStartUtc: inspectStarts() });
    expect(denied).toMatchObject({ ok: false, reason: "GATE_CLOSED" });
    expect(authorizationCalls).toBe(1);
    expect(await readFile(envFile, "utf8")).toBe(before);
  });

  it("recovers only a lock whose recorded process is definitely dead", async () => {
    const root = await tempRoot("gbt-env-stale-lock-");
    const envFile = path.join(root, ".env");
    const before = "ALPACA_PROFILE=dev\n";
    await writeFile(envFile, before, "utf8");
    const digest = createHash("sha256").update(before).digest("hex");
    await writeFile(`${envFile}.activation.lock`, `${JSON.stringify({ pid: 2_147_483_647, startedAtUtc: "2026-09-20T00:00:00.0000000Z", token: "dead" })}\n`, "utf8");

    const recovered = await compareAndSwapEnv(envFile, digest, `${before}X=1\n`, () => ({ ok: true }), new AbortController().signal, { inspectProcessStartUtc: inspectStarts() });
    expect(recovered.ok).toBe(true);

    const afterDead = `${before}X=1\n`;
    await writeFile(`${envFile}.activation.lock`, `${JSON.stringify({ pid: 4242, startedAtUtc: "2026-09-20T00:00:00.0000000Z", token: "recycled" })}\n`, "utf8");
    const recycled = await compareAndSwapEnv(envFile, createHash("sha256").update(afterDead).digest("hex"), `${before}X=2\n`, () => ({ ok: true }), new AbortController().signal, {
      inspectProcessStartUtc: inspectStarts({ 4242: "2026-09-22T00:00:00.0000000Z" }),
    });
    expect(recycled.ok).toBe(true);

    await writeFile(`${envFile}.activation.lock`, `${JSON.stringify({ pid: 4242, startedAtUtc: "2026-09-22T00:00:00.0000000Z", token: "live" })}\n`, "utf8");
    const live = await compareAndSwapEnv(envFile, createHash("sha256").update(`${before}X=2\n`).digest("hex"), `${before}X=3\n`, () => ({ ok: true }), new AbortController().signal, {
      inspectProcessStartUtc: inspectStarts({ 4242: "2026-09-22T00:00:00.0000000Z" }),
    });
    expect(live).toMatchObject({ ok: false, reason: "ENV_LOCKED" });

    await writeFile(`${envFile}.activation.lock`, "not-a-lock-record\n", "utf8");
    const refused = await compareAndSwapEnv(envFile, createHash("sha256").update(`${before}X=2\n`).digest("hex"), `${before}X=3\n`, () => ({ ok: true }), new AbortController().signal, { inspectProcessStartUtc: inspectStarts() });
    expect(refused).toMatchObject({ ok: false, reason: "ENV_LOCK_CORRUPT" });
    expect(await readFile(`${envFile}.activation.lock`, "utf8")).toBe("not-a-lock-record\n");
  });

  it("never removes a successor lock while releasing its own CAS lease", async () => {
    const root = await tempRoot("gbt-env-successor-lock-");
    const envFile = path.join(root, ".env");
    const before = "ALPACA_PROFILE=dev\n";
    await writeFile(envFile, before, "utf8");
    const digest = createHash("sha256").update(before).digest("hex");
    const successor = `${JSON.stringify({ pid: process.pid, startedAtUtc: SELF_STARTED_AT, token: "successor" })}\n`;

    const result = await compareAndSwapEnv(envFile, digest, `${before}X=1\n`, () => ({ ok: true }), new AbortController().signal, {
      beforeFinalCheck: async () => { await writeFile(`${envFile}.activation.lock`, successor, "utf8"); },
      inspectProcessStartUtc: inspectStarts(),
    });

    expect(result.ok).toBe(true);
    expect(await readFile(`${envFile}.activation.lock`, "utf8")).toBe(successor);
  });

  it("uses fixed scripts and never activates trading tasks while installing", async () => {
    const root = await tempRoot("gbt-host-command-");
    const calls: { readonly file: string; readonly args: readonly string[] }[] = [];
    const runCommand = (file: string, args: readonly string[]) => {
      calls.push({ file, args: [...args] });
      const joined = args.join(" ");
      if (joined.includes("verify-scheduled-tasks.ps1")) return Promise.resolve({ exitCode: 0, stdout: "SCHEDULER CHECK PASSED: 58 checks.\n" });
      if (joined.includes("read-tasks.ps1")) {
        return Promise.resolve({ exitCode: 0, stdout: JSON.stringify([
          { TaskName: "GlassBoxTrading-AgentCycle", State: "Disabled", Actions: [{ Execute: "powershell.exe", Arguments: "cycle" }], Triggers: [], RunLevel: "Highest", LogonType: "S4U", UserId: "u", UserSid: "s", StartWhenAvailable: true },
          { TaskName: "GlassBoxTrading-Watchdog", State: "Disabled", Actions: [{ Execute: "powershell.exe", Arguments: "watchdog" }], Triggers: [], RunLevel: "Highest", LogonType: "S4U", UserId: "u", UserSid: "s", StartWhenAvailable: true },
        ]) });
      }
      return Promise.resolve({ exitCode: 0, stdout: "" });
    };
    const ports = createHostActionPorts(options(root, { runCommand }));
    const signal = new AbortController().signal;

    await ports.installTasks("2026-12-16", signal);
    await ports.setTaskEnabled("watchdog", false, signal);
    const evidence = await ports.verifyInstalledTasks(signal);

    const install = calls.find(call => call.args.some(arg => arg.endsWith("install-scheduled-task.ps1")));
    expect(install?.args).toContain("-CoverageThroughDate");
    expect(install?.args).not.toContain("-Activate");
    const stateChange = calls.find(call => call.args.includes("SetTradingTaskEnabled"));
    expect(stateChange?.args).toEqual(expect.arrayContaining(["-TradingTask", "watchdog", "-Enabled", "false"]));
    expect(evidence).toEqual({ ok: true, value: { checkCount: 58, actionLines: { cycle: "powershell.exe cycle", watchdog: "powershell.exe watchdog" } } });
  });

  it("keeps a reduced credential-free host refusal from stderr", async () => {
    const root = await tempRoot("gbt-host-refusal-");
    const runCommand = () => Promise.resolve({
      exitCode: 1,
      stdout: "",
      stderr: "C:\\repo\\tools\\activation-task.ps1 : Registered activation task definition differs.\nSECRET12345678901234567890\n",
    });
    const ports = createHostActionPorts(options(root, { runCommand }));

    const result = await ports.setTaskEnabled("watchdog", false, new AbortController().signal);

    expect(result).toMatchObject({
      ok: false,
      reason: "HOST_COMMAND_FAILED:Registered activation task definition differs. (1 further stderr line suppressed)",
    });
    expect(JSON.stringify(result)).not.toContain("SECRET12345678901234567890");
  });

  it("binds the remaining fixed host commands, clock, local reads, and check endpoints", async () => {
    const root = await tempRoot("gbt-host-ports-");
    const envFile = path.join(root, ".env");
    const certificate = path.join(root, "invalid-certificate.json");
    await writeFile(envFile, [
      "HEALTHCHECK_IO_API_KEY=",
      "HEALTHCHECK_PING_URL=https://example.test/readiness",
      "HEALTHCHECK_LIVENESS_URL=https://example.test/liveness",
      "HEALTHCHECK_WATCHDOG_URL=https://example.test/watchdog",
      "",
    ].join("\n"), "utf8");
    await writeFile(certificate, "{}\n", "utf8");
    const commands: { readonly file: string; readonly args: readonly string[] }[] = [];
    const fetches: string[] = [];
    const runCommand = (file: string, args: readonly string[]) => {
      commands.push({ file, args: [...args] });
      if (args.some(arg => arg.endsWith("certificate-cli.js"))) {
        return Promise.resolve({ exitCode: 0, stdout: `${JSON.stringify({ profile: "dev", mcpTools: 1, runtimeDigest: "r", policyDigest: "p" }, null, 2)}\n` });
      }
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
    };
    const fetchImpl: typeof fetch = input => {
      fetches.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return Promise.resolve(new Response("", { status: 200 }));
    };
    const previousKey = process.env["HEALTHCHECK_IO_API_KEY"];
    process.env["HEALTHCHECK_IO_API_KEY"] = "ambient-key-must-not-authorize-activation";
    try {
      const ports = createHostActionPorts(options(root, { envFile, runCommand, fetchImpl, now: () => 123 }));
      const signal = new AbortController().signal;
      expect(ports.now()).toBe(123);
      expect((await ports.readEnv(envFile, signal)).ok).toBe(true);
      expect(await ports.validateCertificate(certificate, signal)).toMatchObject({ ok: false, reason: "CERTIFICATE_INVALID" });
      expect(await ports.readDeploymentDigests(signal)).toEqual({ ok: true, value: { runtimeDigest: "r", policyDigest: "p" } });
      expect(await ports.readChecks(signal)).toEqual({ known: false, reason: "healthchecks API key unset" });
      await ports.registerDisarm({
        taskPath: "\\GlassBoxTrading\\", taskName: "GlassBoxTrading-Disarm",
        fires: { date: "2026-09-29", minute: 15 * 60 + 5 }, execute: process.execPath,
        arguments: ["cli.ts", "disarm"], workingDirectory: root,
        userId: "DOMAIN\\felix", userSid: "S-1-5-21-1", runLevel: "Highest", logonType: "S4U", startWhenAvailable: true,
      }, signal);
      await ports.deleteDisarm(signal);
      await ports.restart(signal);
      await ports.clearReadiness(signal);
      await ports.pingSuccess("liveness", signal);
      await ports.pingSuccess("watchdog", signal);
    } finally {
      if (previousKey === undefined) delete process.env["HEALTHCHECK_IO_API_KEY"];
      else process.env["HEALTHCHECK_IO_API_KEY"] = previousKey;
    }

    expect(commands.some(call => call.args.includes("RegisterDisarm") && call.args.includes("2026-09-29T15:05:00"))).toBe(true);
    expect(commands.some(call => call.args.includes("DeleteDisarm"))).toBe(true);
    expect(commands).toContainEqual(expect.objectContaining({
      file: "C:\\Windows\\System32\\shutdown.exe",
      args: ["/r", "/t", "0", "/d", "p:4:1", "/c", "Glass Box Trading activation reboot"],
    }));
    expect(fetches).toEqual([
      "https://example.test/readiness", "https://example.test/liveness", "https://example.test/watchdog",
    ]);
  });
});
