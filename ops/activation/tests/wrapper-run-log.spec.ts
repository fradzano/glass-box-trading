// The wrapper log contract (`docs/P12-STOP-AND-LOG-CONTRACTS.md`, part II), measured
// against whole wrapper processes.
//
// Nothing in here is a unit test, and that is the point: both files are PowerShell that
// the live scheduled tasks execute every five and every fifteen minutes, and until this
// file existed no automated test crossed either of them. Five findings of one evening
// (R3-13 to R3-17) lived in the gap.
//
// What is real here: a real `powershell.exe`, the real wrapper scripts, a real HTTP
// endpoint that records every ping, a real child process, a real read-only file and a
// real exclusive lock held by another process. What is faked: the repository around
// them — a temporary tree with the two files copied in, a `.env`, a `policy.json`, a
// `deployment.json` and a stub CLI in `dist\shell`. The wrappers are driven against a
// copy, never against the checkout other measurements read.
import { createServer } from "node:http";
import type { Server } from "node:http";
import { spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

interface Ping {
  readonly url: string;
  readonly body: string;
}

let server: Server;
let pings: Ping[] = [];
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>(resolve => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", chunk => chunks.push(chunk as Buffer));
      request.on("end", () => {
        pings.push({ url: request.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(200);
        response.end("ok");
      });
    });
    server.listen(0, "127.0.0.1", () => { resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the ping recorder did not bind a port");
  baseUrl = `http://127.0.0.1:${String(address.port)}/hc`;
});

afterAll(async () => {
  await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
});

const trees: string[] = [];

afterEach(async () => {
  pings = [];
  await Promise.all(trees.splice(0).map(async tree => {
    // A read-only log is part of several cases; the tree cannot be removed while it stands.
    await rm(tree, { recursive: true, force: true, maxRetries: 3 }).catch(async () => {
      await chmod(path.join(tree, "state", "watchdog-run.log"), 0o666).catch(() => undefined);
      await chmod(path.join(tree, "state", "cycle-run.log"), 0o666).catch(() => undefined);
      await rm(tree, { recursive: true, force: true, maxRetries: 3 });
    });
  }));
});

interface Tree {
  readonly root: string;
  readonly repoRoot: string;
  readonly stateDir: string;
}

/**
 * A deployment the wrappers accept: both state-directory assertions pass, the policy and
 * the declaration are readable, and `dist\shell` holds a stub for whichever CLI the
 * wrapper starts. The stub is a real node program, so the child is a real child.
 */
async function tree(): Promise<Tree> {
  const root = await mkdtemp(path.join(os.tmpdir(), "gbt-wrapper-"));
  trees.push(root);
  const repoRoot = path.join(root, "repo");
  const stateDir = path.join(root, "state");
  await mkdir(path.join(repoRoot, "tools"), { recursive: true });
  await mkdir(path.join(repoRoot, "config"), { recursive: true });
  await mkdir(path.join(repoRoot, "dist", "shell"), { recursive: true });
  await mkdir(stateDir, { recursive: true });

  for (const file of ["cycle-run.ps1", "watchdog-run.ps1", "run-log.psm1"]) {
    await copyFile(path.join(REPO, "tools", file), path.join(repoRoot, "tools", file));
  }
  await writeFile(path.join(repoRoot, "config", "policy.json"), JSON.stringify({ DEAD_MAN_BOUND_MS: 3_000_000 }), "utf8");
  await writeFile(path.join(repoRoot, "config", "deployment.json"), JSON.stringify({ longRunStateDir: stateDir, devStateDir: path.join(root, "dev"), devDiagnosticSink: path.join(root, "dev", "diagnostics") }), "utf8");
  await writeFile(
    path.join(repoRoot, ".env"),
    [
      `STATE_DIR=${stateDir}`,
      `HEALTHCHECK_WATCHDOG_URL=${baseUrl}`,
      `HEALTHCHECK_LIVENESS_URL=${baseUrl}`,
      "",
    ].join("\n"),
    "utf8",
  );

  // Writes a marker and prints on both streams, so "the child really ran" is a fact on
  // disk rather than an inference from the wrapper's own log — which is the file these
  // tests make unwritable.
  const stub = [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(process.env.GBT_STUB_MARKER, process.argv.slice(2).join(' '));",
    "process.stdout.write('stub stdout line\\n');",
    "process.stderr.write('stub stderr line\\n');",
    "process.exitCode = Number(process.env.GBT_STUB_EXIT ?? '0');",
  ].join("\n");
  for (const entry of ["watchdog-cli.js", "agent-cli.js"]) {
    await writeFile(path.join(repoRoot, "dist", "shell", entry), stub, "utf8");
  }
  await writeFile(path.join(repoRoot, "dist", "shell", "readiness-cli.js"), "process.stdout.write('readiness: stub\\n');", "utf8");
  return { root, repoRoot, stateDir };
}

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `forceInSession` is the one deviation from the registered invocation, and it exists
 * because of a property of the host rather than of the test: with `-File`, Windows
 * PowerShell 5.1 hands every argument to the script as a string, and a `[bool]`
 * parameter refuses a string — "Boolean parameters accept only Boolean values or numbers
 * such as $True, $False, 1 or 0", measured. So `-SkipOutsideSession $false` cannot be
 * passed through `-File` at all, and the cycle wrapper's in-session path is only
 * reachable from `-Command`. The installer does not pass the flag either; it relies on
 * the default. Every watchdog case below, and the cycle wrapper's skip case, use the
 * exact `-File` form the scheduled task is registered with.
 */
async function runWrapper(
  wrapper: "watchdog-run.ps1" | "cycle-run.ps1",
  context: Tree,
  options: { readonly childExit?: number; readonly extra?: readonly string[]; readonly forceInSession?: boolean; readonly env?: Readonly<Record<string, string>> } = {},
): Promise<Run> {
  const marker = path.join(context.root, `${wrapper}.marker`);
  const script = path.join(context.repoRoot, "tools", wrapper);
  const quoted = (value: string): string => `'${value.replace(/'/gu, "''")}'`;
  const argv = options.forceInSession === true
    ? [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-Command",
      `& ${quoted(script)} -RepoRoot ${quoted(context.repoRoot)} -NodePath ${quoted(process.execPath)} -SkipOutsideSession $false${(options.extra ?? []).map(item => ` ${item}`).join("")}; exit $LASTEXITCODE`,
    ]
    : [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script,
      "-RepoRoot", context.repoRoot,
      "-NodePath", process.execPath,
      ...(options.extra ?? []),
    ];
  return await new Promise<Run>((resolve, reject) => {
    const child = spawn(POWERSHELL, argv, {
      cwd: context.repoRoot,
      env: {
        ...process.env,
        GBT_STUB_MARKER: marker,
        GBT_STUB_EXIT: String(options.childExit ?? 0),
        // The wrappers prefer the process environment over `.env`; both must come from
        // the temporary tree, or a real host value would decide the test.
        STATE_DIR: "",
        HEALTHCHECK_WATCHDOG_URL: "",
        HEALTHCHECK_LIVENESS_URL: "",
        ...options.env,
      },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", code => { resolve({ exitCode: code ?? -1, stdout, stderr }); });
  });
}

async function logText(context: Tree, name: string): Promise<string> {
  return await readFile(path.join(context.stateDir, name), "utf8").catch(() => "");
}

/** The one shape that makes every `Add-Content` to this path fail, deterministically. */
async function makeUnwritable(file: string): Promise<void> {
  await writeFile(file, "", "utf8");
  await chmod(file, 0o444);
}

/** An exclusive lock held by a second process for a bounded time — S-LOG-1, as measured. */
function holdLock(file: string, milliseconds: number): Promise<void> {
  const script = `$f=[System.IO.File]::Open('${file.replace(/'/gu, "''")}','OpenOrCreate','ReadWrite','None'); Start-Sleep -Milliseconds ${String(milliseconds)}; $f.Close()`;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    child.on("error", reject);
    child.on("close", () => { resolve(); });
  });
}

/**
 * The watchdog wrapper decides for itself whether today is a trading day — that gate is
 * the R1-14 stop-gap and it takes no parameter, deliberately: a switch that turns the
 * closure table off would be a switch that re-arms the defect it repairs. So the branch
 * this suite measures depends on the day it runs, and the two branches are split here
 * rather than blurred into assertions that hold for both.
 *
 * THE LIMIT, said rather than hidden: on a weekend the full run path of the watchdog is
 * not measured by this file. It is measured on every weekday run, including the
 * certificate day itself.
 */
const easternNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
const tradingWeekday = easternNow.getDay() !== 0 && easternNow.getDay() !== 6;

/**
 * A Monday inside the American session, as an instant.
 *
 * Until 2026-09-19 the three cases below only ran on a weekday, so the watchdog's whole
 * run path — the one the dead man depends on — went unmeasured on exactly the days
 * somebody is most likely to be working on it. `-TestClockUtc` supplies the instant every
 * trading-day and session rule in the wrapper already reads; it changes no rule, and a
 * registered task carrying it is red in both the activation's own parameter check and the
 * scheduler verifier.
 */
const TRADING_MONDAY = "2026-09-21T17:00:00Z";


async function runPowerShell(script: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    let text = "";
    child.stdout.on("data", chunk => { text += String(chunk); });
    child.stderr.on("data", chunk => { text += String(chunk); });
    child.on("error", reject);
    child.on("close", () => { resolve(text); });
  });
}

describe("LC-1 and LC-3 — an unwritable log never stops the firing, and both facts survive", () => {
  it("the watchdog runs its child, reports the child's exit code and the log failure in one ping, and exits 9", async () => {
    const context = await tree();
    await makeUnwritable(path.join(context.stateDir, "watchdog-run.log"));

    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-TestClockUtc", TRADING_MONDAY] });

    // LC-1: the child ran although nothing could be written about it.
    const marker = await readFile(path.join(context.root, "watchdog-run.ps1.marker"), "utf8");
    expect(marker).toContain(context.stateDir);

    // LC-4: exactly one ping, and it is the failing one.
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    // LC-3: the child's verdict and the log failure, in the same body.
    expect(pings[0]?.body).toContain("watchdog exit 0");
    expect(pings[0]?.body).toContain("the run log could not be written");
    // LC-2: the body names the file and what was lost, so the drill can tell this
    // silence from a disabled task.
    expect(pings[0]?.body).toContain("watchdog-run.log");
    expect(pings[0]?.body).toContain("lines lost:");

    // The firing completed; its log did not. 9 says exactly that in the task history.
    expect(run.exitCode).toBe(9);
    expect(await logText(context, "watchdog-run.log")).toBe("");
  }, 30_000);

  it("keeps the child's non-zero exit code as the wrapper's verdict, with the log failure beside it", async () => {
    const context = await tree();
    await makeUnwritable(path.join(context.stateDir, "watchdog-run.log"));

    const run = await runWrapper("watchdog-run.ps1", context, { childExit: 3, extra: ["-TestClockUtc", TRADING_MONDAY] });

    expect(run.exitCode).toBe(3);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    expect(pings[0]?.body).toContain("watchdog exit 3");
    expect(pings[0]?.body).toContain("the run log could not be written");
  }, 30_000);

  // A skipped firing sends nothing when all is well — the check is expected to be silent
  // on a day the exchange is shut. A skip whose line could not be written is not a
  // silent day but an unrecorded firing, which is the signature step 6 reads as a
  // disabled task, so it must speak.
  it.runIf(!tradingWeekday)("makes even a skipped watchdog firing report a log it could not write", async () => {
    const context = await tree();
    await makeUnwritable(path.join(context.stateDir, "watchdog-run.log"));

    const run = await runWrapper("watchdog-run.ps1", context);

    expect(run.exitCode).toBe(9);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    expect(pings[0]?.body).toContain("watchdog skipped this firing");
    expect(pings[0]?.body).toContain("the run log could not be written");
    expect(pings[0]?.body).toContain("watchdog-run.log");
  }, 30_000);

  it.runIf(!tradingWeekday)("and stays silent on a skip whose line landed, which is what a closed day owes", async () => {
    const context = await tree();

    const run = await runWrapper("watchdog-run.ps1", context);

    expect(run.exitCode).toBe(0);
    expect(pings).toHaveLength(0);
    expect(await logText(context, "watchdog-run.log")).toContain("skip: weekend");
  }, 30_000);

  it("does the same for the cycle wrapper", async () => {
    const context = await tree();
    await makeUnwritable(path.join(context.stateDir, "cycle-run.log"));

    const run = await runWrapper("cycle-run.ps1", context, { forceInSession: true });

    // The child ran: the stub wrote its marker although nothing could be logged.
    const marker = await readFile(path.join(context.root, "cycle-run.ps1.marker"), "utf8");
    expect(marker).toBe("");
    expect(run.exitCode).toBe(9);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    expect(pings[0]?.body).toContain("cycle exit 0");
    expect(pings[0]?.body).toContain("the run log could not be written");
  }, 30_000);

  // The form the scheduled task is actually registered with, on the branch it takes
  // outside the session. Which branch that is depends on the clock, so this case asserts
  // only what both branches owe — and that is the whole contract for this scenario:
  // one ping, the log failure in its body, and an exit code that is not 0.
  it("reports a log failure on the registered -File invocation, whichever branch the clock puts it on", async () => {
    const context = await tree();
    await makeUnwritable(path.join(context.stateDir, "cycle-run.log"));

    const run = await runWrapper("cycle-run.ps1", context);

    expect(run.exitCode).toBe(9);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    expect(pings[0]?.body).toContain("the run log could not be written");
    expect(pings[0]?.body).toContain("cycle-run.log");
  });
});

describe("LC-4 — one verdict ping per firing", () => {
  it("a healthy watchdog firing writes its lines and sends one success ping", async () => {
    const context = await tree();

    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-TestClockUtc", TRADING_MONDAY] });

    expect(run.exitCode).toBe(0);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc");
    expect(pings[0]?.body).toBe("watchdog exit 0");

    const log = await logText(context, "watchdog-run.log");
    expect(log).toContain("run: instanceId=watchdog-");
    // The rehearsal says so in its own evidence, so no reader mistakes it for a real firing.
    expect(log).toContain("testClockUtc=");
    expect(log).toContain("output: stub stdout line");
    expect(log).toContain("output: stub stderr line");
    expect(log).toContain("exit: 0");
    expect(log).toContain("heartbeat: sent");

    // The log calls return whether the line landed; an uncaptured return would print
    // `True` into the task's own output stream, where an operator reads it as a fact.
    expect(run.stdout).not.toContain("True");
    expect(run.stdout).not.toContain("False");
  }, 30_000);

  it("never prints the writer's return value into the task's own output stream", async () => {
    const context = await tree();

    const run = await runWrapper("watchdog-run.ps1", context);

    expect(run.stdout).not.toContain("True");
    expect(run.stdout).not.toContain("False");
  }, 30_000);

  it("a healthy cycle firing does the same on its own endpoint", async () => {
    const context = await tree();

    const run = await runWrapper("cycle-run.ps1", context, { forceInSession: true });

    expect(run.exitCode).toBe(0);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc");
    expect(pings[0]?.body).toBe("cycle exit 0");
    const log = await logText(context, "cycle-run.log");
    expect(log).toContain("run: pid=");
    expect(log).toContain("output: stub stdout line");
    expect(log).toContain("exit: 0");
    expect(log).toContain("liveness: sent");
    // The cycle report the wrapper exists to keep must not be joined by the writer's own
    // return value: an operator reading the task output would take `True` for a fact
    // about the cycle.
    expect(run.stdout).not.toContain("True");
    expect(run.stdout).not.toContain("False");
  });
});

describe("LC-5 — a transient lock costs a retry, not a firing", () => {
  // Measured at the module rather than through a whole wrapper process, for a measurement
  // reason: a wrapper takes hundreds of milliseconds to start, so a lock held for the
  // 200 ms of the finding is long gone before its first write, and a mutation that removed
  // the retry entirely survived that version of this case.
  //
  // The holder is a script file rather than a command line, and it announces itself before
  // it sleeps; the write waits for that announcement. Both details were learned by getting
  // them wrong: a quoted `-Command` came through mangled, and without the handshake the
  // probe measured process startup instead of the retry.
  async function lockingProbe(context: Tree, holdMs: number, extra: readonly string[]): Promise<string> {
    const log = path.join(context.stateDir, "probe.log");
    const marker = `${log}.locked`;
    const holderScript = path.join(context.stateDir, "holder.ps1");
    await writeFile(holderScript, [
      `$f = [System.IO.File]::Open('${log}', 'OpenOrCreate', 'ReadWrite', 'None')`,
      `Set-Content -LiteralPath '${marker}' -Value 'locked'`,
      `Start-Sleep -Milliseconds ${String(holdMs)}`,
      "$f.Close()",
      "",
    ].join("\n"), "utf8");

    return await runPowerShell([
      `Import-Module '${path.join(REPO, "tools", "run-log.psm1")}' -Force`,
      `Initialize-RunLog -Path '${log}'`,
      `$holder = Start-Process -FilePath '${POWERSHELL}' -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${holderScript}') -PassThru -WindowStyle Hidden`,
      `$deadline = (Get-Date).AddSeconds(10)`,
      `while (-not (Test-Path -LiteralPath '${marker}') -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 10 }`,
      `Write-Output ('holder=' + $(if (Test-Path -LiteralPath '${marker}') { 'present' } else { 'absent' }))`,
      ...extra,
    ].join("; "));
  }

  it("writes the line anyway when a foreign process holds the log briefly", async () => {
    const context = await tree();
    const output = await lockingProbe(context, 300, [
      "$landed = Write-RunLog 'a line written while the file was held'",
      "$holder.WaitForExit()",
      "Write-Output \"landed=$landed\"",
      "Write-Output \"failed=$((Get-RunLogStatus).Failed)\"",
    ]);

    expect(output).toContain("holder=present");
    expect(output).toContain("landed=True");
    expect(output).toContain("failed=False");
    expect(await readFile(path.join(context.stateDir, "probe.log"), "utf8")).toContain("a line written while the file was held");
  }, 30_000);

  it("gives up inside a bounded budget rather than waiting out a permanent lock", async () => {
    const context = await tree();
    const output = await lockingProbe(context, 6_000, [
      "$started = [System.Diagnostics.Stopwatch]::StartNew()",
      "$landed = Write-RunLog 'a line nobody can write'",
      "$started.Stop()",
      "Stop-Process -Id $holder.Id -Force",
      "Write-Output \"landed=$landed\"",
      "Write-Output \"elapsed=$($started.ElapsedMilliseconds)\"",
    ]);

    expect(output).toContain("holder=present");
    expect(output).toContain("landed=False");
    const elapsed = Number(/elapsed=(\d+)/u.exec(output)?.[1] ?? "0");
    // Bounded, and far below the five-minute firing interval it has to fit inside: four
    // attempts across roughly 450 ms.
    expect(elapsed).toBeGreaterThan(300);
    expect(elapsed).toBeLessThan(2_000);
  }, 30_000);
});

describe("LC-7 — a second sink, so that no line anywhere means no firing", () => {
  it("writes what the primary log refused into the fallback beside it", async () => {
    const context = await tree();
    await makeUnwritable(path.join(context.stateDir, "watchdog-run.log"));

    await runWrapper("watchdog-run.ps1", context);

    // Branch-neutral on purpose: whichever path the day puts this firing on, every line
    // it could not write has to be somewhere, and the ping has to name where.
    const fallback = await logText(context, "watchdog-run.log.fallback");
    expect(fallback).toContain("heartbeat:");
    expect(fallback.split(/\r?\n/u).filter(line => line.trim() !== "").length).toBeGreaterThanOrEqual(2);
    expect(pings[0]?.body).toContain("watchdog-run.log.fallback");
  });
});

describe("LC-8 — one implementation, and the watchdog log rotates like the cycle log", () => {
  it("rotates the watchdog log at its bound, which it never had before", async () => {
    const context = await tree();
    const log = path.join(context.stateDir, "watchdog-run.log");
    await writeFile(log, "x".repeat(4096), "utf8");

    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-MaxLogBytes", "1024"] });

    expect(run.exitCode).toBe(0);
    const rotated = await stat(`${log}.1`);
    expect(rotated.size).toBe(4096);
    const fresh = await logText(context, "watchdog-run.log");
    expect(fresh).toMatch(/^\uFEFF?\d{4}-\d{2}-\d{2}T/u);
    expect(fresh).not.toContain("xxxx");
  }, 30_000);

  it("neither wrapper carries its own copy of the writer any more", async () => {
    for (const wrapper of ["cycle-run.ps1", "watchdog-run.ps1"]) {
      const text = await readFile(path.join(REPO, "tools", wrapper), "utf8");
      expect(text).toContain("Import-Module (Join-Path $PSScriptRoot 'run-log.psm1')");
      // The only definition left is the degradation stub inside the import's catch —
      // one line, which is what distinguishes it from the implementation that used to
      // stand here in two hand-synchronised copies.
      const definitions = text.split(/\r?\n/u).filter(line => /^\s*function Write-RunLog\b/u.test(line));
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toContain("return $false");
    }
  });
});

describe("LC-6 — the failure path does not rest on an ambient setting", () => {
  it("reports a failed write under $ErrorActionPreference = 'Continue'", async () => {
    const context = await tree();
    const log = path.join(context.stateDir, "probe.log");
    await makeUnwritable(log);

    const script = [
      `Import-Module '${path.join(context.repoRoot, "tools", "run-log.psm1")}' -Force`,
      "$ErrorActionPreference = 'Continue'",
      `Initialize-RunLog -Path '${log}'`,
      "$landed = Write-RunLog 'a line that cannot be written'",
      "Write-Output \"landed=$landed\"",
      "Write-Output \"failed=$((Get-RunLogStatus).Failed)\"",
      "Write-Output \"clause=$(Get-RunLogFailureClause)\"",
    ].join("; ");

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
      let text = "";
      child.stdout.on("data", chunk => { text += String(chunk); });
      child.stderr.on("data", chunk => { text += String(chunk); });
      child.on("error", reject);
      child.on("close", () => { resolve(text); });
    });

    expect(output).toContain("landed=False");
    expect(output).toContain("failed=True");
    expect(output).toContain("the run log could not be written");
  });
});

describe("LC-10 — a log that cannot be rotated is not a log that is fine (R4-04)", () => {
  it("fails the verdict and names the bound it is growing past", async () => {
    const context = await tree();
    const log = path.join(context.stateDir, "watchdog-run.log");
    await writeFile(log, "x".repeat(4096), "utf8");
    // The rotation TARGET is what is unavailable here, not the log: the primary stays
    // writable, every line lands, and the only thing that fails is the bound. Measured
    // before this case existed: verdict green, clause empty, log grew past MaxBytes.
    const holder = holdLock(`${log}.1`, 4_000);

    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-MaxLogBytes", "1024", "-TestClockUtc", TRADING_MONDAY] });
    await holder;

    expect(run.exitCode).toBe(9);
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    expect(pings[0]?.body).toContain("could not be rotated");
    expect(pings[0]?.body).toContain("growing past its bound");
    // And the firing still did its work: the child ran and its lines are in the log.
    expect(await logText(context, "watchdog-run.log")).toContain("exit: 0");
  }, 30_000);

  it("bounds the fallback sink too, because nobody is watching that one either", async () => {
    const context = await tree();
    const log = path.join(context.stateDir, "watchdog-run.log");
    await makeUnwritable(log);
    await writeFile(`${log}.fallback`, "y".repeat(4096), "utf8");

    await runWrapper("watchdog-run.ps1", context, { extra: ["-MaxLogBytes", "1024", "-TestClockUtc", TRADING_MONDAY] });

    // The bound holds inside one firing as well as across firings: with a 1 KiB bound and
    // a whole firing's lines going to the fallback, it rotates more than once, and that is
    // the behaviour that keeps this storage finite over a quarter. What must be true is
    // that a generation was rotated away and the live sink is under its bound.
    const rotated = await stat(`${log}.fallback.1`);
    expect(rotated.size).toBeGreaterThan(0);
    const fresh = await logText(context, "watchdog-run.log.fallback");
    expect(fresh).not.toContain("yyyy");
    expect(Buffer.byteLength(fresh, "utf8")).toBeLessThanOrEqual(2048);
  }, 30_000);
});

describe("the closure gate, on any day of the week (R4-05's other half)", () => {
  it("skips a full-day closure and says which table decided, whatever today is", async () => {
    const context = await tree();

    // Thanksgiving 2026, inside the measurement period: the day that produced the live
    // defect this table was written for.
    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-TestClockUtc", "2026-11-26T17:00:00Z"] });

    expect(run.exitCode).toBe(0);
    expect(pings).toHaveLength(0);
    const log = await logText(context, "watchdog-run.log");
    expect(log).toContain("skip: exchange closed on 2026-11-26");
    // The child must NOT have run: a firing on a closed market is what fenced the epoch
    // store and raised a standing halt.
    await expect(readFile(path.join(context.root, "watchdog-run.ps1.marker"), "utf8")).rejects.toThrow();
  }, 30_000);

  it("runs the child on the early-close day and hands the CLI the real 13:00 close", async () => {
    const context = await tree();

    // 2026-11-27, the day after Thanksgiving: a trading day that ends at 13:00 New York.
    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-TestClockUtc", "2026-11-27T16:00:00Z"] });

    expect(run.exitCode).toBe(0);
    const log = await logText(context, "watchdog-run.log");
    expect(log).toContain("earlyClose=13:00ET");
    const marker = await readFile(path.join(context.root, "watchdog-run.ps1.marker"), "utf8");
    expect(marker).toContain(context.stateDir);
  }, 30_000);
});

// The two defects an independent gate found in this contract on 2026-09-20, as tests
// rather than as prose. Both were measured against the code as it stood; neither was
// reachable through any case that existed here, which is the more useful half of what
// the gate reported.
describe("LC-1, at the one place it could still be broken (D-1)", () => {
  it("runs the child even when no sink of any kind can be built", async () => {
    const context = await tree();
    // Every candidate destroyed: the primary log and the fallback beside it are
    // directories, so `Add-Content` cannot write either, and TEMP names a drive letter
    // this session does not have, which is what used to make `Join-Path` throw out of a
    // function whose own header promises it never throws.
    await mkdir(path.join(context.stateDir, "watchdog-run.log"), { recursive: true });
    await mkdir(path.join(context.stateDir, "watchdog-run.log.fallback"), { recursive: true });

    const run = await runWrapper("watchdog-run.ps1", context, {
      extra: ["-TestClockUtc", TRADING_MONDAY],
      env: { TEMP: "Z:\\no-such-temp-dir", TMP: "Z:\\no-such-temp-dir" },
    });

    // The dead man ran. That is the whole clause: a diagnostic file may not decide
    // whether the watchdog assesses, fences and halts.
    const marker = await readFile(path.join(context.root, "watchdog-run.ps1.marker"), "utf8");
    expect(marker).toContain(context.stateDir);
    // And it was not silent about it.
    expect(pings).toHaveLength(1);
    expect(pings[0]?.url).toBe("/hc/fail");
    expect(pings[0]?.body).toContain("no fallback sink took it either");
    expect(run.exitCode).toBe(9);
  }, 30_000);
});

describe("LC-2, above the point where the log has a name (D-2)", () => {
  it("tells the truth about where a refusal's line went", async () => {
    const context = await tree();
    // A refusal that happens before `Initialize-RunLog`: the entry point is missing, which
    // is one of the two most ordinary ones on this deployment — the other is an unbuilt
    // dist, which is the same branch.
    await rm(path.join(context.repoRoot, "dist", "shell", "watchdog-cli.js"));

    const run = await runWrapper("watchdog-run.ps1", context, { extra: ["-TestClockUtc", TRADING_MONDAY] });

    expect(run.exitCode).not.toBe(0);
    expect(pings).toHaveLength(1);
    const body = pings[0]?.body ?? "";
    expect(body).toContain("watchdog-cli.js");
    // The three statements that used to be false, each measured against the sink itself.
    expect(body).not.toContain("lines lost: 0");
    expect(body).toContain("refusing:");
    expect(body).toContain(".fallback");
    const sink = /written to '([^']+)'/u.exec(body)?.[1];
    expect(sink).toBeDefined();
    expect(await readFile(sink as string, "utf8")).toContain("watchdog-cli.js");
    await rm(sink as string, { force: true });
  }, 30_000);
});

describe("LC-11 — the firing has a bound, not only the line (D-6)", () => {
  it("stops retrying once the firing has spent its budget, instead of being killed by the scheduler", async () => {
    const context = await tree();
    const log = path.join(context.stateDir, "probe.log");
    await mkdir(log, { recursive: true });

    // A hundred and twenty lines against a log that can never be written. Measured on this
    // host: an unbounded firing costs about 475 ms per lost line, so this is roughly a
    // minute of pure retrying for a watchdog whose task is killed at six minutes -- and the
    // fence and the halt have already happened by then, so what the kill takes is the
    // verdict ping. The bound is what keeps a bad log from eating the firing that owns it.
    const output = await runPowerShell([
      `Import-Module '${path.join(REPO, "tools", "run-log.psm1")}' -Force`,
      `Initialize-RunLog -Path '${log}'`,
      "$w = [System.Diagnostics.Stopwatch]::StartNew()",
      "1..120 | ForEach-Object { $null = Write-RunLog \"line $_\" }",
      "$w.Stop()",
      "Write-Output \"elapsed=$($w.ElapsedMilliseconds)\"",
      "Write-Output \"lost=$((Get-RunLogStatus).LostLines)\"",
      "Write-Output \"exhausted=$((Get-RunLogStatus).BudgetExhausted)\"",
      "Write-Output \"clause=$(Get-RunLogFailureClause)\"",
    ].join("; "));

    expect(output).toContain("lost=120");
    expect(output).toContain("exhausted=True");
    expect(output).toContain("stopped retrying");
    const elapsed = Number(/elapsed=(\d+)/u.exec(output)?.[1] ?? "0");
    // The budget is 30 s; without it these sixty lines would cost far more, and with it
    // the tail of the firing runs at one attempt per line.
    expect(elapsed).toBeLessThan(45_000);
  }, 120_000);
});
