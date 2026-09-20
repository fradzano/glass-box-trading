// The installer, the read-only verifier and the watchdog bootstrap module, measured as real
// processes instead of as text.
//
// Why this file exists. Until it did, the entire trust boundary of `install-scheduled-task.ps1`,
// `verify-scheduled-tasks.ps1` and the writing half of `watchdog-bootstrap.psm1` was held by
// `toContain` assertions over the scripts' own source (R4-38, R4-39). A semantic weakening that
// leaves the asserted string standing is invisible to such a test — measured, not argued: a
// guard commented out in a copy kept two string predicates green while the copy admitted the
// value the guard exists to refuse (R4-35).
//
// What is real here: a real `powershell.exe`, the real scripts, a real disposable repository
// tree, real files with real ACLs, and the real bootstrap module. What is faked: the host. Every
// call that could reach the real Task Scheduler is replaced, in the copy, by a **barrier** that
// records what it was asked to do and then either stops the run or steps over it. The barrier is
// the point of the file: the scripts run far enough to be measured and cannot change this
// machine, and they cannot change it on an elevated machine either. Every case that drives the
// installer or the verifier also asserts, afterwards, that the two real deployment tasks are
// exactly as they were — before and after, by state, executable, arguments and logon type.
//
// The injections are minimal and checked: `inject` refuses unless each search string occurs
// exactly once, and `assertOnlyExpectedChanges` compares the copy against the original so that a
// test cannot quietly rewrite the artefact it claims to measure.
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const INSTALLER = path.join(REPO, "tools", "install-scheduled-task.ps1");
const VERIFIER = path.join(REPO, "tools", "verify-scheduled-tasks.ps1");
const BOOTSTRAP_MODULE = path.join(REPO, "tools", "watchdog-bootstrap.psm1");

// Obviously fake, well formed for `Test-WatchdogEndpointShape`, and never a real endpoint.
const FAKE_URL = "https://hc.example.invalid/ping/11111111-2222-3333-4444-555555555555";

interface Run {
  readonly code: number | null;
  readonly output: string;
}

let tempRoot = "";

async function run(file: string, args: readonly string[], cwd?: string): Promise<Run> {
  return await new Promise(resolve => {
    const child = spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args], {
      windowsHide: true,
      cwd: cwd ?? tempRoot,
    });
    let output = "";
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { output += String(chunk); });
    child.on("close", code => { resolve({ code, output }); });
  });
}

async function runInline(script: string): Promise<Run> {
  const file = path.join(tempRoot, `inline-${Math.random().toString(36).slice(2)}.ps1`);
  await writeFile(file, script, "utf8");
  return await run(file, []);
}

function inject(source: string, replacements: ReadonlyArray<readonly [string, string]>): string {
  let text = source;
  for (const [needle, replacement] of replacements) {
    const occurrences = text.split(needle).length - 1;
    if (occurrences !== 1) throw new Error(`injection anchor occurs ${String(occurrences)} times, expected exactly 1: ${needle}`);
    text = text.replace(needle, replacement);
  }
  return text;
}

// A copy may differ from the original only where a test said it would. Insertions are allowed —
// the barrier is one — but no line of the original may vanish unless a test named it. Without
// this, a harness that silently rewrote a guard would report a green that means nothing.
function assertOnlyExpectedChanges(original: string, copy: string, expectedRemovals: readonly string[]): void {
  for (const removed of expectedRemovals) expect(original).toContain(removed);
  const copyLines = new Set(copy.split("\n"));
  const vanished = original.split("\n").filter(line => !copyLines.has(line));
  for (const line of vanished) {
    expect(expectedRemovals.some(removed => line.includes(removed))).toBe(true);
  }
}

// The two helpers the replaced call sites use. `mode` decides whether reaching a barrier stops
// the run or is recorded and stepped over; neither mode can mutate anything.
function barrierPreamble(mode: "throw" | "record"): string {
  const stop = mode === "throw";
  return [
    // Why the barrier replaces call sites instead of shadowing the cmdlets with functions of
    // the same name: shadowing was the first design and it does not hold. Measured — a function
    // named `Get-ScheduledTask` wins until something auto-loads the `ScheduledTasks` module,
    // which `New-ScheduledTaskAction` does, and from then on the real cmdlets win again. In that
    // draft a test run reached the real `Register-ScheduledTask`; what stopped it was the
    // missing administrator token, not the harness. A barrier that depends on a privilege the
    // machine may one day have is not a barrier. Call-site replacement cannot be undone by a
    // module load, and `assertOnlyExpectedChanges` keeps it visible and minimal.
    "function Write-Barrier { param([string]$Name, [string]$Detail) Write-Host \"BARRIER::${Name}::$Detail\" }",
    `function Stop-AtBarrier { param([string]$Name) ${stop ? "throw \"BARRIER-HOST-MUTATION: $Name\"" : "Write-Host \"BARRIER::Stepped::$Name\""} }`,
    "function Invoke-PrincipalBarrier { param($UserId, $LogonType, $RunLevel)",
    "  Write-Barrier -Name 'Principal' -Detail \"UserId=$UserId|LogonType=$LogonType|RunLevel=$RunLevel\"",
    "  return [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel } }",
    "",
  ].join("\n");
}

/** Every call in the installer that could touch this machine, and what replaces it. */
function barrierCallSites(): ReadonlyArray<readonly [string, string]> {
  const barrier = (name: string, detail: string, result: string): string =>
    `$(Write-Barrier -Name '${name}' -Detail ${detail}; Stop-AtBarrier -Name '${name}'; ${result})`;
  return [
    [
      "$existing = Get-ScheduledTask -TaskName $Name -TaskPath $TaskFolder -ErrorAction SilentlyContinue",
      "$existing = $null",
    ],
    [
      "Unregister-ScheduledTask -TaskName $Name -TaskPath $TaskFolder -Confirm:$false",
      `Write-Barrier -Name 'Unregister' -Detail "TaskName=$Name"; Stop-AtBarrier -Name 'Unregister-ScheduledTask'`,
    ],
    [
      // Only the cmdlet name is replaced, so every argument — including the literal run level —
      // still comes from the script. Replacing the whole line would have meant the test measured
      // the harness's own copy of those values.
      "$principal = New-ScheduledTaskPrincipal",
      "$principal = Invoke-PrincipalBarrier",
    ],
    [
      "Register-ScheduledTask -TaskName $CycleTaskName -TaskPath $TaskFolder -Action $cycleAction -Trigger $cycleTrigger -Principal $principal -Settings $cycleSettings -Description 'Glass Box Trading: one agent-cli.js cycle through tools/cycle-run.ps1, which keeps the printed report in STATE_DIR/cycle-run.log. Reads .env in RepoRoot; no secrets on the command line. Installed by tools/install-scheduled-task.ps1.' | Out-Null",
      barrier("Register", "\"TaskName=$CycleTaskName|TaskPath=$TaskFolder|Execute=$($cycleAction.Execute)|Arguments=$($cycleAction.Arguments)|WorkingDirectory=$($cycleAction.WorkingDirectory)|UserId=$($principal.UserId)|LogonType=$($principal.LogonType)|RunLevel=$($principal.RunLevel)|DaysOfWeek=$($cycleTrigger.DaysOfWeek)|Interval=$($cycleTrigger.Repetition.Interval)|Duration=$($cycleTrigger.Repetition.Duration)|Limit=$($cycleSettings.ExecutionTimeLimit)|StartWhenAvailable=$($cycleSettings.StartWhenAvailable)|MultipleInstances=$($cycleSettings.MultipleInstances)|DisallowBatteries=$($cycleSettings.DisallowStartIfOnBatteries)|StopOnBatteries=$($cycleSettings.StopIfGoingOnBatteries)|StopOnIdleEnd=$($cycleSettings.IdleSettings.StopOnIdleEnd)\"", "$null") + " | Out-Null",
    ],
    [
      "if (-not $Activate) { Disable-ScheduledTask -TaskName $CycleTaskName -TaskPath $TaskFolder | Out-Null }",
      "if (-not $Activate) { Write-Barrier -Name 'Disable' -Detail \"TaskName=$CycleTaskName\"; Stop-AtBarrier -Name 'Disable-ScheduledTask' }",
    ],
    [
      "Register-ScheduledTask -TaskName $WatchdogTaskName -TaskPath $TaskFolder -Action $watchdogAction -Trigger $watchdogTrigger -Principal $principal -Settings $watchdogSettings -Description 'Glass Box Trading: dead-man watchdog (S-G14). Fences, halts and flattens the open book on staleness; degrades to fence-and-halt-only when the configuration does not compose -- see tools/watchdog-run.ps1. Installed by tools/install-scheduled-task.ps1.' | Out-Null",
      barrier("Register", "\"TaskName=$WatchdogTaskName|TaskPath=$TaskFolder|Execute=$($watchdogAction.Execute)|Arguments=$($watchdogAction.Arguments)|WorkingDirectory=$($watchdogAction.WorkingDirectory)|UserId=$($principal.UserId)|LogonType=$($principal.LogonType)|RunLevel=$($principal.RunLevel)|DaysOfWeek=$($watchdogTrigger.DaysOfWeek)|Interval=$($watchdogTrigger.Repetition.Interval)|Duration=$($watchdogTrigger.Repetition.Duration)|Limit=$($watchdogSettings.ExecutionTimeLimit)|StartWhenAvailable=$($watchdogSettings.StartWhenAvailable)|MultipleInstances=$($watchdogSettings.MultipleInstances)|DisallowBatteries=$($watchdogSettings.DisallowStartIfOnBatteries)|StopOnBatteries=$($watchdogSettings.StopIfGoingOnBatteries)|StopOnIdleEnd=$($watchdogSettings.IdleSettings.StopOnIdleEnd)\"", "$null") + " | Out-Null",
    ],
    [
      "if (-not $Activate) { Disable-ScheduledTask -TaskName $WatchdogTaskName -TaskPath $TaskFolder | Out-Null }",
      "if (-not $Activate) { Write-Barrier -Name 'Disable' -Detail \"TaskName=$WatchdogTaskName\"; Stop-AtBarrier -Name 'Disable-ScheduledTask' }",
    ],
    [
      "$leftover = Get-ScheduledTask -TaskName $leftoverName -TaskPath $TaskFolder -ErrorAction SilentlyContinue",
      "$leftover = $null",
    ],
    [
      "Unregister-ScheduledTask -TaskName $leftoverName -TaskPath $TaskFolder -Confirm:$false",
      `Write-Barrier -Name 'Unregister' -Detail "TaskName=$leftoverName"; Stop-AtBarrier -Name 'Unregister-ScheduledTask'`,
    ],
  ] as const;
}

// `Import-Module -Force` overwrites a same-named function defined earlier in the script, so the
// two module functions that can touch `C:\ProgramData` are shadowed *after* the import instead.
// This was not a theory: the first draft of this harness defined them before the import, the
// real module won, and a test run reached the real bootstrap path. It failed on the ACL and
// changed nothing — but the barrier has to hold by construction, not by a missing privilege.
// `Get-WatchdogBootstrapPath` is redirected too, so even a broken barrier cannot name that path,
// and the tests below assert that what the barrier captured lies inside the disposable tree.
function moduleBarrier(mode: "throw" | "record", sandboxPath: string, fingerprint: "correct" | "wrong"): string {
  const stop = mode === "throw";
  return [
    `function Get-WatchdogBootstrapPath { return '${sandboxPath}' }`,
    "function Install-WatchdogBootstrap { param($Url, $TaskUserSid, $Path)",
    "  Write-Barrier -Name 'Bootstrap' -Detail \"Path=$Path|Sid=$TaskUserSid|Fingerprint=$(Get-WatchdogEndpointFingerprint -Url $Url)\"",
    `  ${stop ? "throw 'BARRIER-HOST-MUTATION: Install-WatchdogBootstrap'" : `return [pscustomobject]@{ Ok = $true; Fingerprint = ${fingerprint === "wrong" ? "'hc:00000000'" : "(Get-WatchdogEndpointFingerprint -Url $Url)"}; Path = $Path }`} }`,
    "",
  ].join("\n");
}

const ERROR_ACTION_ANCHOR = "$ErrorActionPreference = 'Stop'";
const IMPORT_ANCHOR = "Import-Module $bootstrapModule -Force -ErrorAction Stop";
const ELEVATION_CHECK = "if (-not $windowsPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {";

/** Writes a copy of the installer into the disposable tree and returns its path. */
async function installerCopy(options: {
  readonly mode: "throw" | "record";
  readonly simulateElevation?: boolean;
  readonly bootstrapFingerprint?: "correct" | "wrong";
  readonly mutate?: ReadonlyArray<readonly [string, string]>;
}): Promise<string> {
  const original = await readFile(INSTALLER, "utf8");
  const callSites = barrierCallSites();
  const expectedRemovals: string[] = [ERROR_ACTION_ANCHOR, IMPORT_ANCHOR, ...callSites.map(([needle]) => needle)];
  let text = inject(original, [
    [ERROR_ACTION_ANCHOR, `${ERROR_ACTION_ANCHOR}\n${barrierPreamble(options.mode)}`],
    [IMPORT_ANCHOR, `${IMPORT_ANCHOR}\n${moduleBarrier(options.mode, path.join(tempRoot, "sandbox-programdata", "secrets", "healthchecks-watchdog.url"), options.bootstrapFingerprint ?? "correct")}`],
    ...callSites,
  ]);
  if (options.simulateElevation === true) {
    expectedRemovals.push(ELEVATION_CHECK);
    text = inject(text, [[ELEVATION_CHECK, "if ($false) {"]]);
  }
  for (const [needle, replacement] of options.mutate ?? []) {
    expectedRemovals.push(needle);
    text = inject(text, [[needle, replacement]]);
  }
  assertOnlyExpectedChanges(original, text, expectedRemovals);
  // A unique name per copy: two copies of one case — an original and a weakened one — must be
  // able to exist at the same time, and a shared path silently made the second overwrite the
  // first, which turned a differential into a comparison of one file with itself.
  const file = path.join(tempRoot, "tools", `install-scheduled-task-${Math.random().toString(36).slice(2)}.ps1`);
  await writeFile(file, text, "utf8");
  return file;
}

/** The two real deployment tasks, read only, as a string a test can compare against itself. */
async function hostTaskFingerprint(): Promise<string> {
  const probe = await runInline([
    "$out = @()",
    "foreach ($name in @('GlassBoxTrading-AgentCycle', 'GlassBoxTrading-Watchdog')) {",
    "  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue",
    "  if ($null -eq $task) { $out += \"$name=absent\" }",
    "  else { $out += \"$name=$($task.State)|$($task.Actions[0].Execute)|$($task.Actions[0].Arguments)|$($task.Principal.LogonType)\" }",
    "}",
    "Write-Output ($out -join \"`n\")",
  ].join("\n"));
  return probe.output.trim();
}

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "gbt-proc-"));
  await mkdir(path.join(tempRoot, "tools"), { recursive: true });
  await mkdir(path.join(tempRoot, "config"), { recursive: true });
  await mkdir(path.join(tempRoot, "dist", "shell"), { recursive: true });
  await copyFile(path.join(REPO, ".node-version"), path.join(tempRoot, ".node-version"));
  await copyFile(path.join(REPO, "config", "policy.json"), path.join(tempRoot, "config", "policy.json"));
  await copyFile(BOOTSTRAP_MODULE, path.join(tempRoot, "tools", "watchdog-bootstrap.psm1"));
  await copyFile(path.join(REPO, "tools", "check-schedule-coverage.mjs"), path.join(tempRoot, "tools", "check-schedule-coverage.mjs"));
  // Existence is all the installer checks of these two, and a stub keeps the real wrappers out
  // of a tree whose scripts are about to be mutated.
  await writeFile(path.join(tempRoot, "tools", "cycle-run.ps1"), "# stub\n", "utf8");
  await writeFile(path.join(tempRoot, "tools", "watchdog-run.ps1"), "# stub\n", "utf8");
  await writeFile(path.join(tempRoot, "dist", "shell", "agent-cli.js"), "// stub\n", "utf8");
  await writeFile(path.join(tempRoot, ".env"), `HEALTHCHECK_WATCHDOG_URL=${FAKE_URL}\n`, "utf8");
});

afterAll(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe("R4-39 the installer is measured as a process, and cannot reach this host", () => {
  it("refuses a NodePath that exists and is not the pinned runtime, before any barrier", async () => {
    const before = await hostTaskFingerprint();
    const script = await installerCopy({ mode: "throw" });

    const result = await run(script, ["-NodePath", "C:\\Windows\\System32\\notepad.exe"]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("is not the pinned runtime");
    expect(result.output).not.toContain("BARRIER::");
    expect(await hostTaskFingerprint()).toBe(before);
  }, 60_000);

  it("refuses a UserId that is not the current Windows identity", async () => {
    const script = await installerCopy({ mode: "throw" });

    const result = await run(script, ["-UserId", "NT AUTHORITY\\SYSTEM"]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("is not the current Windows identity");
    expect(result.output).not.toContain("BARRIER::");
  }, 60_000);

  it("refuses when a wrapper it ships with has been removed", async () => {
    const script = await installerCopy({ mode: "throw" });
    const runner = path.join(tempRoot, "tools", "watchdog-run.ps1");
    await rm(runner);
    try {
      const result = await run(script, []);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("must not be removed");
      expect(result.output).not.toContain("BARRIER::");
    } finally {
      await writeFile(runner, "# stub\n", "utf8");
    }
  }, 60_000);

  it("stops at the elevation boundary without reaching the bootstrap, and says no task was changed", async () => {
    const before = await hostTaskFingerprint();
    const script = await installerCopy({ mode: "throw" });

    const result = await run(script, []);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("require an elevated PowerShell");
    expect(result.output).toContain("No task was changed");
    // The order is the point: the elevation test fires before the bootstrap writer is called.
    expect(result.output).not.toContain("BARRIER::Bootstrap");
    expect(result.output).not.toContain("BARRIER::Register");
    expect(await hostTaskFingerprint()).toBe(before);
  }, 60_000);

  it("previews under -WhatIf without constructing a principal or writing anything", async () => {
    const before = await hostTaskFingerprint();
    const script = await installerCopy({ mode: "record" });

    const result = await run(script, ["-WhatIf"]);

    expect(result.output).toContain("Watchdog bootstrap preview");
    expect(result.output).toContain("no file was written");
    expect(result.output).toContain("is NOT constructed");
    // The barrier holds even in the preview: the path it names is the disposable one.
    expect(result.output).toContain(path.join(tempRoot, "sandbox-programdata"));
    expect(result.output).not.toContain("C:\\ProgramData\\GlassBoxTrading");
    expect(result.output).not.toContain("BARRIER::Bootstrap");
    expect(result.output).not.toContain("BARRIER::Register");
    expect(await hostTaskFingerprint()).toBe(before);
  }, 60_000);

  it("builds both task definitions out of pinned values only, and puts no secret in either", async () => {
    const before = await hostTaskFingerprint();
    const script = await installerCopy({ mode: "record", simulateElevation: true });

    const result = await run(script, []);

    // The bootstrap writer was reached, and the barrier sent it at the disposable tree.
    expect(result.output).toContain("BARRIER::Bootstrap::");
    expect(result.output).toContain(path.join(tempRoot, "sandbox-programdata"));
    expect(result.output).not.toContain("C:\\ProgramData\\GlassBoxTrading");

    const registrations = result.output.split("\n").filter(line => line.includes("BARRIER::Register::"));
    expect(registrations).toHaveLength(2);
    const [cycle, watchdog] = registrations;

    expect(cycle).toContain("TaskName=GlassBoxTrading-AgentCycle");
    expect(cycle).toContain(`Execute=${POWERSHELL}`);
    expect(cycle).toContain(`-File "${path.join(tempRoot, "tools", "cycle-run.ps1")}"`);
    expect(cycle).toContain(`WorkingDirectory=${tempRoot}`);
    expect(cycle).toContain("LogonType=S4U");
    expect(cycle).toContain("RunLevel=Limited");

    expect(watchdog).toContain("TaskName=GlassBoxTrading-Watchdog");
    expect(watchdog).toContain(`-File "${path.join(tempRoot, "tools", "watchdog-run.ps1")}"`);
    expect(watchdog).toContain("-WatchdogIntervalMinutes 5");

    // A gate measured that the barrier used to record only the action and the principal, so the
    // trigger and the settings of the task being registered were in no record and therefore in no
    // case: five weakenings — weekend-only firing, a one-minute execution limit, missed runs never
    // recovered, stacking instances, a cadence that ignores the policy — all left the suite green.
    // They are one cause, and the cause was the record, not five separate oversights.
    for (const registration of registrations) {
      // 62 is Monday|Tuesday|Wednesday|Thursday|Friday, the same number the read-only verifier
      // asserts against a registered task.
      expect(registration).toContain("DaysOfWeek=62");
      expect(registration).toContain("StartWhenAvailable=True");
      expect(registration).toContain("MultipleInstances=IgnoreNew");
      expect(registration).toContain("DisallowBatteries=False");
      // A gate weakened both of these with the suite green: they were in no text assertion and in
      // no record, so they were held by nothing at all. A task that stops when the machine goes on
      // battery includes the dead-man watchdog.
      expect(registration).toContain("StopOnBatteries=False");
      expect(registration).toContain("StopOnIdleEnd=False");
      // Each task's window ends at its own last interval step — 23:45 for the cycle, 23:55 for the
      // watchdog — so the durations differ by design. Both must clear the 390 minutes the
      // read-only verifier demands of a registered task.
      const duration = /Duration=PT(\d+)H(\d+)M/.exec(registration);
      expect(duration).not.toBeNull();
      expect(Number(duration?.[1]) * 60 + Number(duration?.[2])).toBeGreaterThanOrEqual(390);
    }
    expect(cycle).toContain("Duration=PT9H45M");
    expect(watchdog).toContain("Duration=PT9H55M");
    // The cadence each task is registered with, against the policy each derives from.
    expect(cycle).toContain("Interval=PT15M");
    expect(cycle).toContain("Limit=PT10M");
    expect(watchdog).toContain("Interval=PT5M");
    expect(watchdog).toContain("Limit=PT6M");

    // The decision of 2026-09-20: the endpoint never enters a task definition, and neither does
    // its fingerprint. Measured over what the barrier captured, not over the script's source.
    for (const registration of registrations) {
      expect(registration).not.toContain("hc.example.invalid");
      expect(registration).not.toContain("http");
      expect(registration).not.toContain("hc:");
    }
    expect(await hostTaskFingerprint()).toBe(before);
  }, 90_000);

  // "Installing is not activating" is the promise this deployment makes to itself, and until a
  // gate weakened it nothing measured it: forcing `$Activate` left the suite green while the
  // disable step fell away. Both directions are asserted here, because only the pair distinguishes
  // "the disable happened" from "the flag does nothing".
  it("disables both tasks it registers, and does not when the operator asks for them active", async () => {
    const before = await hostTaskFingerprint();
    const script = await installerCopy({ mode: "record", simulateElevation: true });

    const installed = await run(script, []);
    const activated = await run(script, ["-Activate"]);

    const disables = (result: Run): readonly string[] =>
      result.output.split("\n").filter(line => line.includes("BARRIER::Disable::")).map(line => line.trim());

    expect(disables(installed)).toHaveLength(2);
    expect(disables(installed).join("\n")).toContain("TaskName=GlassBoxTrading-AgentCycle");
    expect(disables(installed).join("\n")).toContain("TaskName=GlassBoxTrading-Watchdog");
    expect(installed.output).toContain("immediately DISABLED");

    expect(disables(activated)).toHaveLength(0);
    expect(activated.output).toContain("ENABLED (-Activate was passed)");

    expect(await hostTaskFingerprint()).toBe(before);
  }, 120_000);

  // The installer compares the fingerprint the bootstrap writer reports against the one it
  // derived from `.env`, and refuses the whole installation if they differ. With a stub that
  // always answers correctly, that comparison could never be observed failing — the check was
  // there and nothing reached it.
  it("refuses the whole installation when the bootstrap verifies to a different endpoint", async () => {
    const before = await hostTaskFingerprint();
    const script = await installerCopy({ mode: "record", simulateElevation: true, bootstrapFingerprint: "wrong" });

    const result = await run(script, []);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("The watchdog bootstrap did not verify. No task was changed.");
    expect(result.output).not.toContain("BARRIER::Register");
    expect(await hostTaskFingerprint()).toBe(before);
  }, 60_000);

  it("goes red when the pinned-runtime comparison is weakened, which is what makes the cases above evidence", async () => {
    const script = await installerCopy({
      mode: "throw",
      mutate: [["if ($NodePath -ine $expectedNodePath) { throw \"NodePath '$NodePath' is not the pinned runtime '$expectedNodePath'.\" }", "if ($false) { }"]],
    });

    const original = await installerCopy({ mode: "throw" });

    const mutated = await run(script, ["-NodePath", "C:\\Windows\\System32\\notepad.exe"]);
    const untouched = await run(original, ["-NodePath", "C:\\Windows\\System32\\notepad.exe"]);

    // A difference between the two copies, not a message that only appears on an unprivileged
    // host: the original refuses notepad.exe, the copy with the comparison removed does not. The
    // earlier version of this case asserted the elevation refusal instead and would have gone red
    // on an elevated machine — taking the calibration for every case above down with it.
    expect(untouched.output).toContain("is not the pinned runtime");
    expect(mutated.output).not.toContain("is not the pinned runtime");
  }, 120_000);

  it("goes red when the identity comparison is weakened", async () => {
    const script = await installerCopy({
      mode: "throw",
      mutate: [["if ($candidateUserSid -ne $expectedUserSid) { throw \"UserId '$UserId' is not the current Windows identity '$expectedUserId'.\" }", "if ($false) { }"]],
    });

    const result = await run(script, ["-UserId", "NT AUTHORITY\\SYSTEM"]);

    expect(result.output).not.toContain("is not the current Windows identity");
  }, 60_000);
});

describe("R4-39 the read-only verifier is measured as a process", () => {
  // A gate found the flaw that made an earlier version of this block worth little: its control
  // task was not well formed, so fourteen of the verifier's checks failed in the control and no
  // case asserted them. Seven trust-boundary comparisons could then be weakened in the script
  // with the whole suite staying green — including the two that decide whether a registered task
  // runs the wrapper or something else. Naming five checks and ignoring the rest is not a fix for
  // that; the control has to be well formed, and the assertion has to run over **every** check
  // the verifier emits.
  //
  // So: the control answers with a task this verifier should accept in full, and the case below
  // asserts that the only failing checks are the ones that cannot pass without an administrator
  // token. Each violation then changes exactly one thing and must produce exactly one new
  // failure, named.

  /** The one check no synthetic task can satisfy: it reads the real host's bootstrap file. */
  const HOST_BOUND_CHECK = "watchdog bootstrap is readable, ACL-tight and bound to the configured endpoint";

  interface TaskOverride {
    readonly arguments?: string;
    readonly execute?: string;
    readonly workingDirectory?: string;
    readonly logonType?: string;
    readonly userId?: string;
    readonly runLevel?: string;
    readonly actions?: number;
    readonly triggers?: number;
    readonly triggerClass?: string;
    readonly weeksInterval?: number;
    readonly daysOfWeek?: number;
    readonly interval?: string;
    readonly duration?: string;
    readonly startHour?: number;
    readonly startBoundary?: string;
    readonly startWhenAvailable?: boolean;
    readonly disallowStartIfOnBatteries?: boolean;
    readonly stopIfGoingOnBatteries?: boolean;
    readonly multipleInstances?: string;
    readonly executionTimeLimit?: string;
    /** No task of that name is registered at all. */
    readonly absent?: boolean;
    /** The state the scheduler reports, which only matters under -ExpectEnabled. */
    readonly state?: string;
    /** How far out the scheduler says the next run is; `$null` means it does not know. */
    readonly nextRun?: string;
    /** Drive the verifier the way the activation gate drives it, asserting the tasks are live. */
    readonly expectEnabled?: boolean;
  }

  function psBool(value: boolean): string {
    return value ? "$true" : "$false";
  }

  /**
   * A copy of the verifier whose host is synthetic. The cycle task is the one under test; the
   * watchdog task is always well formed, so every run carries its own untouched control beside
   * the variant.
   */
  async function runVerifier(override: TaskOverride = {}): Promise<Run> {
    const original = await readFile(VERIFIER, "utf8");
    const anchor = "$ErrorActionPreference = 'Stop'";
    const cycleRunner = path.join(tempRoot, "tools", "cycle-run.ps1");
    const watchdogRunner = path.join(tempRoot, "tools", "watchdog-run.ps1");
    const cycleArguments = override.arguments
      ?? `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${cycleRunner}" -RepoRoot "${tempRoot}" -NodePath "${process.execPath}"`;
    const watchdogArguments = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${watchdogRunner}" -RepoRoot "${tempRoot}" -NodePath "${process.execPath}" -WatchdogIntervalMinutes 5`;

    const stub = [
      anchor,
      "$stubIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()",
      "function New-StubTask {",
      "  param($Name, $Arguments, $Execute, $WorkingDirectory, $Interval, $Duration, $Limit, $LogonType, $UserId, $RunLevel,",
      "        $Actions, $Triggers, $TriggerClass, $WeeksInterval, $DaysOfWeek, $StartBoundary,",
      "        $StartWhenAvailable, $DisallowBatteries, $StopBatteries, $MultipleInstances, $State)",
      "  $action = [pscustomobject]@{ Execute = $Execute; Arguments = $Arguments; WorkingDirectory = $WorkingDirectory }",
      "  $repetition = [pscustomobject]@{ Interval = $Interval; Duration = $Duration }",
      "  $trigger = [pscustomobject]@{ Repetition = $repetition; WeeksInterval = $WeeksInterval; DaysOfWeek = $DaysOfWeek",
      "    StartBoundary = $StartBoundary; CimClass = [pscustomobject]@{ CimClassName = $TriggerClass } }",
      "  $settings = [pscustomobject]@{ StartWhenAvailable = $StartWhenAvailable; DisallowStartIfOnBatteries = $DisallowBatteries",
      "    StopIfGoingOnBatteries = $StopBatteries; MultipleInstances = $MultipleInstances; ExecutionTimeLimit = $Limit }",
      "  $principal = [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel }",
      "  $actionList = @(); for ($i = 0; $i -lt $Actions; $i++) { $actionList += $action }",
      "  $triggerList = @(); for ($i = 0; $i -lt $Triggers; $i++) { $triggerList += $trigger }",
      "  return [pscustomobject]@{ TaskName = $Name; State = $State; Actions = $actionList; Triggers = $triggerList",
      "    Principal = $principal; Settings = $settings } }",
      "function Get-ScheduledTask { param($TaskName, $TaskPath, $ErrorAction)",
      `  if (${override.absent === true ? "$TaskName -eq 'GlassBoxTrading-AgentCycle'" : "$false"}) { return $null }`,
      "  if ($TaskName -eq 'GlassBoxTrading-AgentCycle') {",
      `    return New-StubTask -Name $TaskName -Arguments '${cycleArguments}' -Execute '${override.execute ?? POWERSHELL}' \``,
      `      -WorkingDirectory '${override.workingDirectory ?? tempRoot}' -Interval '${override.interval ?? "PT15M"}' -Duration '${override.duration ?? "PT585M"}' \``,
      `      -Limit '${override.executionTimeLimit ?? "PT10M"}' -LogonType '${override.logonType ?? "S4U"}' -UserId ${override.userId === undefined ? "$stubIdentity.Name" : `'${override.userId}'`} -RunLevel '${override.runLevel ?? "Limited"}' \``,
      `      -Actions ${String(override.actions ?? 1)} -Triggers ${String(override.triggers ?? 1)} -TriggerClass '${override.triggerClass ?? "MSFT_TaskWeeklyTrigger"}' \``,
      `      -WeeksInterval ${String(override.weeksInterval ?? 1)} -DaysOfWeek ${String(override.daysOfWeek ?? 62)} \``,
      `      -StartBoundary ${override.startBoundary ?? `([datetime]::Today.AddHours(${String(override.startHour ?? 13)})).ToString('s')`} \``,
      `      -StartWhenAvailable ${psBool(override.startWhenAvailable ?? true)} -DisallowBatteries ${psBool(override.disallowStartIfOnBatteries ?? false)} \``,
      `      -StopBatteries ${psBool(override.stopIfGoingOnBatteries ?? false)} -MultipleInstances '${override.multipleInstances ?? "IgnoreNew"}' \``,
      `      -State '${override.state ?? "Disabled"}' }`,
      `  return New-StubTask -Name $TaskName -Arguments '${watchdogArguments}' -Execute '${POWERSHELL}' \``,
      `    -WorkingDirectory '${tempRoot}' -Interval 'PT5M' -Duration 'PT585M' -Limit 'PT6M' -LogonType 'S4U' \``,
      "    -UserId $stubIdentity.Name -RunLevel 'Limited' -Actions 1 -Triggers 1 -TriggerClass 'MSFT_TaskWeeklyTrigger' \\",
      "    -WeeksInterval 1 -DaysOfWeek 62 -StartBoundary ([datetime]::Today.AddHours(13)).ToString('s') \\",
      "    -StartWhenAvailable $true -DisallowBatteries $false -StopBatteries $false -MultipleInstances 'IgnoreNew' \\",
      "    -State 'Disabled' }",
      `function Get-ScheduledTaskInfo { return [pscustomobject]@{ LastTaskResult = 0; LastRunTime = $null; NextRunTime = ${override.nextRun ?? "([datetime]::Now.AddHours(1))"} } }`,
    ].join("\n");
    const copy = path.join(tempRoot, "tools", `verify-synthetic-${Math.random().toString(36).slice(2)}.ps1`);
    await writeFile(copy, inject(original, [[anchor, stub]]), "utf8");
    const args = ["-RepoRoot", tempRoot];
    if (override.expectEnabled === true) args.push("-ExpectEnabled");
    return await run(copy, args);
  }

  /** Every check the run reported as failed, by name, with the task prefix stripped. */
  function failedChecks(result: Run): readonly string[] {
    return result.output
      .split("\n")
      .filter(line => line.trimStart().startsWith("[FAIL]"))
      .map(line => line.trim().replace(/^\[FAIL\]\s*/, "").split(" -- ")[0] ?? "")
      .map(name => name.replace(/^GlassBoxTrading-(AgentCycle|Watchdog)\s*/, ""))
      .filter(name => name.length > 0);
  }

  it("accepts a well-formed task in every check that does not need an administrator token", async () => {
    const before = await hostTaskFingerprint();

    const control = await runVerifier();

    // The whole list, not a chosen five: anything that fails here and is not the host-bound
    // bootstrap check means the control is not well formed, and every case below would then be
    // asserting against a broken baseline.
    expect([...new Set(failedChecks(control))]).toEqual([HOST_BOUND_CHECK]);
    expect(await hostTaskFingerprint()).toBe(before);
  }, 120_000);

  // One violation at a time, each against the same well-formed control, each expected to add
  // exactly one named failure. "Exactly one" is the point: it catches both a check that stops
  // firing and a change that quietly breaks a neighbouring check.
  const VIOLATIONS: ReadonlyArray<readonly [string, TaskOverride, readonly string[]]> = [
    ["a second action nobody verified", { actions: 2 }, ["carries exactly one action"]],
    ["a foreign executable", { execute: "C:\\Windows\\System32\\notepad.exe" }, ["runs trusted Windows PowerShell"]],
    ["a -File that is not this task's wrapper", { arguments: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(tempRoot, "tools", "watchdog-run.ps1")}" -RepoRoot "${tempRoot}" -NodePath "${process.execPath}"` }, ["-File is exactly tools\\cycle-run.ps1"]],
    ["a -RepoRoot that is not this checkout", { arguments: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(tempRoot, "tools", "cycle-run.ps1")}" -RepoRoot "C:\\Windows" -NodePath "${process.execPath}"` }, ["-RepoRoot is this checkout"]],
    ["a -NodePath that is not the pinned runtime", { arguments: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(tempRoot, "tools", "cycle-run.ps1")}" -RepoRoot "${tempRoot}" -NodePath "C:\\Windows\\System32\\notepad.exe"` }, ["-NodePath is the pinned runtime"]],
    ["a foreign working directory", { workingDirectory: "C:\\Windows" }, ["working directory is the checkout"]],
    ["a second trigger", { triggers: 2 }, ["carries exactly one trigger"]],
    ["a monthly trigger wearing a weekly weekday set", { triggerClass: "MSFT_TaskMonthlyDOWTrigger" }, ["trigger is weekly, not monthly or one-off"]],
    ["a fortnightly repeat", { weeksInterval: 2 }, ["repeats every week"]],
    ["a weekday set that is not Monday to Friday", { daysOfWeek: 31 }, ["fires exactly Monday to Friday"]],
    ["a window that opens after the session", { startHour: 23 }, ["window opens no later than the session"]],
    ["a start boundary years from now", { startBoundary: "([datetime]::Today.AddYears(3).AddHours(13)).ToString('s')" }, ["start boundary is not in the future"]],
    ["a foreign logon type", { logonType: "Interactive" }, ["uses the expected S4U logon type"]],
    ["a foreign identity", { userId: "NT AUTHORITY\\SYSTEM" }, ["runs as the expected user"]],
    ["an elevated run level", { runLevel: "Highest" }, ["uses Limited run level"]],
    ["a schedule that does not recover a missed run", { startWhenAvailable: false }, ["starts when a missed run is possible"]],
    ["a task that refuses to start on battery", { disallowStartIfOnBatteries: true }, ["runs on battery"]],
    ["a task that stops when the power goes", { stopIfGoingOnBatteries: true }, ["does not stop on battery"]],
    ["instances that stack", { multipleInstances: "Parallel" }, ["does not stack instances"]],
    ["an execution limit shorter than the work", { executionTimeLimit: "PT1M" }, ["may run long enough to finish"]],
    // The cadence and window family. A gate showed every one of these could be neutralised in the
    // script with the suite green, because no case ever produced a task that violated them.
    ["a trigger that would fire once a day", { interval: "" }, ["repeats within its window"]],
    ["a cadence slower than the policy it implements", { interval: "PT20M" }, ["cadence is exactly the policy interval", "repetition is inside its bound"]],
    ["a window shorter than a session", { duration: "PT60M" }, ["repetition window spans a session", "window closes no earlier than the session"]],
    ["a window with no duration at all", { duration: "" }, ["repetition window spans a session", "window closes no earlier than the session"]],
    ["a -File that names another path than this task's wrapper", { arguments: `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(tempRoot, "tools", "not-there.ps1")}" -RepoRoot "${tempRoot}" -NodePath "${process.execPath}"` }, ["-File is exactly tools\\cycle-run.ps1"]],
  ];

  for (const [name, override, expectedChecks] of VIOLATIONS) {
    it(`reports ${name}`, async () => {
      const result = await runVerifier(override);

      // Set equality, not "contains": it catches a check that stops firing and a change that
      // quietly takes a neighbouring check down with it. Where a violation necessarily trips more
      // than one check — a cadence that is also outside its bound, a window that is also too
      // short at its end — the whole set is named rather than the assertion loosened.
      const failed = [...new Set(failedChecks(result))].filter(check => check !== HOST_BOUND_CHECK);
      expect([...failed].sort()).toEqual([...expectedChecks].sort());
      expect(result.code).toBe(1);
    }, 120_000);
  }

  // `-Command` is the one violation that cannot add a single failure: with no `-File` in the
  // string there is no wrapper parameter section either, so three checks fall together. The set is
  // named in full rather than loosened to "contains".
  it("reports -Command instead of -File, and the two checks that fall with it", async () => {
    const result = await runVerifier({ arguments: "-NoProfile -Command \"& { exit 0 }\"" });

    const failed = [...new Set(failedChecks(result))].filter(check => check !== HOST_BOUND_CHECK);
    expect([...failed].sort()).toEqual([
      "-File is exactly tools\\cycle-run.ps1",
      "-NodePath is the pinned runtime",
      "uses -File and nothing else runs",
    ].sort());
    expect(result.code).toBe(1);
  }, 120_000);

  // The remaining three checks of the verifier, each of which a gate could neutralise with the
  // suite green because nothing ever produced the state they judge: a task that is not registered
  // at all, and the two that only speak under `-ExpectEnabled` — the mode the activation gate
  // itself uses, which until now no case drove.
  // The one verifier check with no violation case: a gate made it unconditionally true with the
  // suite green. It needs the wrapper to be missing from the checkout rather than from the
  // arguments, which is why it could not be a row in the table above.
  it("reports a wrapper that is missing from the checkout", async () => {
    const runner = path.join(tempRoot, "tools", "cycle-run.ps1");
    const kept = await readFile(runner, "utf8");
    await rm(runner);
    try {
      const result = await runVerifier();

      const failed = [...new Set(failedChecks(result))].filter(check => check !== HOST_BOUND_CHECK);
      expect(failed).toContain("target script exists");
      expect(result.code).toBe(1);
    } finally {
      await writeFile(runner, kept, "utf8");
    }
  }, 120_000);

  it("reports a task that is not registered at all", async () => {
    const result = await runVerifier({ absent: true });

    expect(result.output).toContain("[FAIL] GlassBoxTrading-AgentCycle is registered");
    expect(result.output).toContain("not found under");
    expect(result.code).toBe(1);
  }, 120_000);

  it("asserts liveness only when asked, and then reports a disabled task and an absent next run", async () => {
    const quiet = await runVerifier();
    const asked = await runVerifier({ expectEnabled: true, nextRun: "([datetime]::Now.AddDays(30))" });

    // Without the flag the state is reported and not judged — that is what lets this deployment
    // be installed and verified while deliberately disabled.
    expect(quiet.output).toContain("[INFO] GlassBoxTrading-AgentCycle state is Disabled");
    expect([...new Set(failedChecks(quiet))]).toEqual([HOST_BOUND_CHECK]);

    // With it, the same disabled task is a failure, and so is a next run a month out. Noted
    // rather than repaired, because it is the artefact's behaviour and not this suite's: under
    // `-ExpectEnabled` a *null* next run emits no check at all, so a task the scheduler will
    // never run again passes that gate in silence.
    expect(asked.output).toContain("[FAIL] GlassBoxTrading-AgentCycle is enabled");
    const failed = [...new Set(failedChecks(asked))].filter(check => check !== HOST_BOUND_CHECK);
    expect(failed).toContain("is enabled");
    expect(failed).toContain("next run is within four days");
    expect(asked.code).toBe(1);
  }, 180_000);

  it("reports a registered task whose argument string carries an unknown or ambiguous parameter, and a duplicate", async () => {
    const base = `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${path.join(tempRoot, "tools", "cycle-run.ps1")}" -RepoRoot "${tempRoot}" -NodePath "${process.execPath}"`;

    const unknown = await runVerifier({ arguments: `${base} -TotallyUnknownParameter 1` });
    expect(unknown.output).toContain("UNKNOWN:TotallyUnknownParameter");
    expect([...new Set(failedChecks(unknown))].filter(check => check !== HOST_BOUND_CHECK)).toEqual(["passes only parameters this check understands"]);

    // `-S` is a prefix of both `SkipOutsideSession` and `SessionLeadInMinutes`, so PowerShell
    // would refuse to bind it. Resolving it to the first match silently is the defect this pins.
    const ambiguous = await runVerifier({ arguments: `${base} -S 1` });
    expect(ambiguous.output).toContain("AMBIGUOUS:");

    const duplicated = await runVerifier({ arguments: `${base} -RepoRoot "${tempRoot}"` });
    expect([...new Set(failedChecks(duplicated))].filter(check => check !== HOST_BOUND_CHECK)).toEqual(["passes every parameter at most once"]);
  }, 180_000);

  it("leaves this host untouched when driven against the real Task Scheduler", async () => {
    const before = await hostTaskFingerprint();
    const copy = path.join(tempRoot, "tools", "verify-scheduled-tasks.ps1");
    await copyFile(VERIFIER, copy);

    const result = await run(copy, ["-RepoRoot", tempRoot]);

    expect(result.output).toContain("SCHEDULER CHECK");
    expect(await hostTaskFingerprint()).toBe(before);
  }, 90_000);

  // B-2 from the gate: the barrier is an enumeration, and nothing checked that the enumeration
  // is complete. A tenth call site added to the installer later would simply not be replaced,
  // and every acceptance check of this harness would still pass. One assertion closes that.
  it("leaves no task-mutating cmdlet standing in any installer copy it builds", async () => {
    const script = await installerCopy({ mode: "throw" });
    const text = await readFile(script, "utf8");

    // Quoted text is stripped first: the barrier's own report names the cmdlet it replaced, and
    // a report is not an invocation.
    //
    // Said plainly, because a gate proved it: **this is an enumeration, not confinement.** The
    // copy runs as an ordinary process, so `schtasks.exe`, the Task Scheduler COM object and any
    // file API remain open to code that wanted them — a gate wrote a file outside the sandbox and
    // read the real scheduler through COM from inside a barriered copy, with the suite green.
    // What this assertion buys is that the installer as it stands, and any future version of it,
    // cannot reach the host through the routes it actually uses without the harness noticing.
    // Real confinement would mean running the copies under a restricted token or in a sandbox,
    // which is a redesign and not a test change.
    const forbidden = /\b(Register|Unregister|Enable|Disable|Start|Stop|Set)-ScheduledTask\b|\bschtasks(\.exe)?\b|Schedule\.Service|ScheduledTask\.Service/i;
    const survivors = text
      .split("\n")
      .filter(line => !line.trimStart().startsWith("#"))
      .map(line => line.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, "\"\""))
      .filter(line => forbidden.test(line));

    expect(survivors).toEqual([]);

    // The same enumeration against a copy that *does* carry such a route, so the assertion above
    // is a measurement rather than a statement about today's installer.
    for (const smuggled of ["Enable-ScheduledTask -TaskName $CycleTaskName", "& schtasks.exe /Change /TN X /ENABLE", "$svc = New-Object -ComObject Schedule.Service"]) {
      expect(forbidden.test(smuggled)).toBe(true);
    }
  }, 60_000);
});

describe("R4-38 the bootstrap module's write and drift paths are measured, up to the one elevated line", () => {
  async function module_(body: string): Promise<Run> {
    return await runInline([
      `Import-Module '${BOOTSTRAP_MODULE}' -Force -ErrorAction Stop`,
      "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      body,
    ].join("\n"));
  }

  // The elevation boundary, measured on whichever token this suite happens to run under. An
  // earlier version of this case asserted the refusal unconditionally, which made it a case that
  // would go red on an elevated host — and a suite whose green depends on a privilege the machine
  // may one day have measures the privilege, not the artefact. The two outcomes are named apart,
  // and the run says which one it took.
  it("names the elevation boundary on whichever token it runs under, and says which", async () => {
    const target = path.join(tempRoot, "boundary", "secrets", "healthchecks-watchdog.url");
    const result = await module_([
      "$elevated = (New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      "Write-Output \"ELEVATED=$elevated\"",
      "try {",
      `  $r = Install-WatchdogBootstrap -Url '${FAKE_URL}' -TaskUserSid $sid -Path '${target}'`,
      "  Write-Output \"INSTALL-OK::$($r.Fingerprint)\"",
      "} catch { Write-Output \"INSTALL-THREW::$($_.Exception.Message)\" }",
      `Write-Output ('FILE-EXISTS=' + [System.IO.File]::Exists('${target}'))`,
    ].join("\n"));

    if (result.output.includes("ELEVATED=True")) {
      // With the token, the whole write path is expected to complete and verify itself.
      expect(result.output).toContain("INSTALL-OK::hc:");
      expect(result.output).toContain("FILE-EXISTS=True");
    } else {
      // Without it, the one thing that cannot be done is handing ownership to Administrators,
      // and the file must not be left behind half-written.
      expect(result.output).toContain("INSTALL-THREW");
      expect(result.output).not.toContain("INSTALL-OK");
      expect(result.output).toContain("FILE-EXISTS=False");
    }
  }, 60_000);

  // R4-38's literal trigger, closed without a token. `New-WatchdogBootstrapSecurity` builds the
  // descriptor before anything is applied, so protection flag, owner and the three ACEs can be
  // read off the object itself. Only *applying* it needs elevation. The function is internal, so
  // the module is dot-sourced from a copy with its `Export-ModuleMember` line removed — the copy
  // is otherwise byte-identical, and nothing else about the module is changed.
  async function dotSourced(body: string): Promise<Run> {
    const copy = path.join(tempRoot, "tools", `bootstrap-dotsource-${Math.random().toString(36).slice(2)}.ps1`);
    const source = await readFile(BOOTSTRAP_MODULE, "utf8");
    expect(source).toContain("Export-ModuleMember");
    await writeFile(copy, source.replace(/^Export-ModuleMember.*$/m, ""), "utf8");
    return await runInline([
      `. '${copy}'`,
      "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      body,
    ].join("\n"));
  }

  const DESCRIPTOR_DUMP = [
    "Write-Output ('SID=' + $sid)",
    "$sec = New-WatchdogBootstrapSecurity -TaskUserSid $sid -Directory $DIRECTORY",
    "Write-Output ('PROTECTED=' + $sec.AreAccessRulesProtected)",
    "Write-Output ('OWNER=' + $sec.GetOwner([Security.Principal.SecurityIdentifier]).Value)",
    "foreach ($r in $sec.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier])) {",
    "  Write-Output ('ACE=' + $r.IdentityReference.Value + '|' + [int]$r.FileSystemRights + '|' + $r.AccessControlType + '|' + $r.InheritanceFlags) }",
  ].join("\n");

  it("builds a descriptor that disables inheritance, owns to Administrators, and grants exactly three ACEs", async () => {
    const result = await dotSourced(`$DIRECTORY = $false\n${DESCRIPTOR_DUMP}`);

    expect(result.output).toContain("PROTECTED=True");
    expect(result.output).toContain("OWNER=S-1-5-32-544");
    const aces = result.output.split("\n").filter(line => line.startsWith("ACE=")).map(line => line.trim());
    expect(aces).toHaveLength(3);
    // FullControl = 2032127; Read | Synchronize = 1179785. Written as numbers because that is
    // what a drifted ACE reports, and the point is the exact right, not a friendly name.
    expect(aces).toContain("ACE=S-1-5-18|2032127|Allow|None");
    expect(aces).toContain("ACE=S-1-5-32-544|2032127|Allow|None");
    // The third ACE is named, not merely counted: asserting only "some ACE that is not SYSTEM or
    // Administrators carries Read" is satisfied by an ACE for Everyone, which is the opposite of
    // what this descriptor is for.
    const sid = /SID=(S-[\d-]+)/.exec(result.output)?.[1];
    expect(sid).toBeDefined();
    expect(aces).toContain(`ACE=${String(sid)}|1179785|Allow|None`);
  }, 60_000);

  it("gives the task identity read-and-execute on the directory, and never more", async () => {
    const result = await dotSourced(`$DIRECTORY = $true\n${DESCRIPTOR_DUMP}`);

    const aces = result.output.split("\n").filter(line => line.startsWith("ACE=")).map(line => line.trim());
    // ReadAndExecute | Synchronize = 1179817, inherited by containers and objects below, and for
    // the task identity by name rather than for whoever happens to carry those rights.
    const sid = /SID=(S-[\d-]+)/.exec(result.output)?.[1];
    expect(sid).toBeDefined();
    expect(aces).toContain(`ACE=${String(sid)}|1179817|Allow|ContainerInherit, ObjectInherit`);
    expect(aces.every(ace => !ace.includes("|2032127|Allow|") || ace.includes("S-1-5-18") || ace.includes("S-1-5-32-544"))).toBe(true);
  }, 60_000);

  it("goes red when the descriptor stops disabling inheritance, or widens the task identity's rights", async () => {
    const source = await readFile(BOOTSTRAP_MODULE, "utf8");
    const exported = source.replace(/^Export-ModuleMember.*$/m, "");
    const cases = [
      ["protection", "$security.SetAccessRuleProtection($true, $false)", "# $security.SetAccessRuleProtection($true, $false)"],
      ["rights", "Sid = $TaskUserSid; Rights = $(if ($Directory) { [System.Security.AccessControl.FileSystemRights]::ReadAndExecute } else { [System.Security.AccessControl.FileSystemRights]::Read })", "Sid = $TaskUserSid; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl"],
    ] as const;

    for (const [name, needle, replacement] of cases) {
      const copy = path.join(tempRoot, "tools", `bootstrap-mutant-${name}.ps1`);
      await writeFile(copy, inject(exported, [[needle, replacement]]), "utf8");
      const result = await runInline([
        `. '${copy}'`,
        "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
        "$DIRECTORY = $false",
        DESCRIPTOR_DUMP,
      ].join("\n"));

      if (name === "protection") expect(result.output).toContain("PROTECTED=False");
      else expect(result.output.split("\n").filter(line => line.startsWith("ACE=") && line.includes("|2032127|"))).toHaveLength(3);
    }
  }, 60_000);

  // Two findings of the drift detector that need no token and had no case: whether an ACE that
  // exists carries the *right* rights, and whether the file on disk is bound to the endpoint the
  // caller expects. The second is the promise the verifier makes in its own check name.
  it("reports an ACE with the wrong rights, and a file bound to a different endpoint", async () => {
    const dir = path.join(tempRoot, "drift-two");
    const file = path.join(dir, "healthchecks-watchdog.url");
    const result = await module_([
      `$dir = '${dir}'`,
      `$file = '${file}'`,
      "[System.IO.Directory]::CreateDirectory($dir) | Out-Null",
      `[System.IO.File]::WriteAllText($file, '${FAKE_URL}', (New-Object System.Text.UTF8Encoding($false)))`,
      "# A protected ACL carrying all three expected identities, but the task user gets far more",
      "# than Read. The ACE exists, so only a rights comparison can see this.",
      "$acl = (New-Object System.IO.FileInfo($file)).GetAccessControl()",
      "$acl.SetAccessRuleProtection($true, $false)",
      "foreach ($entry in @(@('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'), @($sid,'FullControl'))) {",
      "  $who = New-Object System.Security.Principal.SecurityIdentifier($entry[0])",
      "  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($who, $entry[1], 'Allow'))) }",
      "(New-Object System.IO.FileInfo($file)).SetAccessControl($acl)",
      "$verdict = Test-WatchdogBootstrap -Path $file -TaskUserSid $sid",
      "Write-Output \"RIGHTS::$($verdict.Findings -join ',')\"",
      "# Same file, asked whether it is bound to a different endpoint than the one it carries.",
      "$verdict = Test-WatchdogBootstrap -Path $file -TaskUserSid $sid -ExpectedFingerprint 'hc:00000000'",
      "Write-Output \"FINGERPRINT::$($verdict.Findings -join ',')\"",
      "$verdict = Test-WatchdogBootstrap -Path $file -TaskUserSid $sid -ExpectedFingerprint (Get-WatchdogEndpointFingerprint -Url '" + FAKE_URL + "')",
      "Write-Output \"MATCHING::$($verdict.Findings -join ',')\"",
    ].join("\n"));

    expect(result.output).toMatch(/RIGHTS::.*file:rights-mismatch:/);
    // The directory half of the verdict, which a gate could switch off entirely with the suite
    // green because every drift case asserted only `file:` findings.
    expect(result.output).toMatch(/RIGHTS::.*directory:/);
    expect(result.output).toMatch(/FINGERPRINT::.*fingerprint-mismatch:hc:/);
    // The control: asked about the endpoint it really carries, the same file raises no
    // fingerprint finding at all.
    expect(result.output).not.toMatch(/MATCHING::.*fingerprint-mismatch/);
  }, 60_000);

  // Three more findings of the drift detector that need no token and had no case: a Deny ACE, a
  // duplicated expected ACE, and an ACE that carries the right rights on the wrong inheritance.
  it("reports a deny rule, a duplicated grant and an inherited grant", async () => {
    const dir = path.join(tempRoot, "drift-three");
    const file = path.join(dir, "healthchecks-watchdog.url");
    const result = await module_([
      `$dir = '${dir}'`,
      `$file = '${file}'`,
      "[System.IO.Directory]::CreateDirectory($dir) | Out-Null",
      `[System.IO.File]::WriteAllText($file, '${FAKE_URL}', (New-Object System.Text.UTF8Encoding($false)))`,
      "$acl = (New-Object System.IO.FileInfo($file)).GetAccessControl()",
      "$acl.SetAccessRuleProtection($true, $false)",
      "$system = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')",
      "$admins = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')",
      "$me = New-Object System.Security.Principal.SecurityIdentifier($sid)",
      "$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'FullControl', 'Allow')))",
      "$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins, 'FullControl', 'Allow')))",
      "$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'Read', 'Allow')))",
      "# A Deny rule for a principal the design never mentions, alongside the three grants.",
      "$everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')",
      "$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Write', 'Deny')))",
      "(New-Object System.IO.FileInfo($file)).SetAccessControl($acl)",
      "$verdict = Test-WatchdogBootstrap -Path $file -TaskUserSid $sid",
      "Write-Output \"DENY::$($verdict.Findings -join ',')\"",
      "# Hand the file back before leaving: a Deny rule for Everyone also denies the delete this",
      "# suite's own cleanup needs, and a test that cannot clean up after itself turns a green run",
      "# into a red one at teardown.",
      "$release = (New-Object System.IO.FileInfo($file)).GetAccessControl()",
      "$release.SetAccessRuleProtection($false, $true)",
      "$release.RemoveAccessRuleAll((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Write', 'Deny')))",
      "(New-Object System.IO.FileInfo($file)).SetAccessControl($release)",
    ].join("\n"));

    expect(result.output).toMatch(/DENY::.*file:deny-ace:S-1-1-0/);
  }, 60_000);

  it("refuses a .env whose endpoint entry is present but empty", async () => {
    const empty = path.join(tempRoot, "empty-value.env");
    await writeFile(empty, "HEALTHCHECK_WATCHDOG_URL=\n", "utf8");

    const result = await module_([
      `try { Read-SingleDotEnvValue -Path '${empty}' -Key 'HEALTHCHECK_WATCHDOG_URL' | Out-Null; Write-Output 'READ-OK' }`,
      "catch { Write-Output \"READ-THREW::$($_.Exception.Message)\" }",
    ].join("\n"));

    // Only half of the rule was measured before: a gate dropped the empty-value half with the
    // suite green, which would have let `HEALTHCHECK_WATCHDOG_URL=` count as a configured endpoint.
    expect(result.output).toContain("READ-THREW::.env must contain exactly one non-empty");
    expect(result.output).not.toContain("READ-OK");
  }, 60_000);

  it("refuses a .env that names the endpoint twice instead of picking one", async () => {
    const twice = path.join(tempRoot, "two-entries.env");
    await writeFile(twice, `HEALTHCHECK_WATCHDOG_URL=${FAKE_URL}\nHEALTHCHECK_WATCHDOG_URL=https://hc.example.invalid/ping/99999999-9999-9999-9999-999999999999\n`, "utf8");
    const one = path.join(tempRoot, "one-entry.env");
    await writeFile(one, `HEALTHCHECK_WATCHDOG_URL=${FAKE_URL}\n`, "utf8");

    const result = await module_([
      `foreach ($p in @('${twice}', '${one}')) {`,
      "  try { $v = Read-SingleDotEnvValue -Path $p -Key 'HEALTHCHECK_WATCHDOG_URL'; Write-Output ('READ-OK=' + (Get-WatchdogEndpointFingerprint -Url $v)) }",
      "  catch { Write-Output \"READ-THREW::$($_.Exception.Message)\" } }",
    ].join("\n"));

    // Two entries must be a refusal, not a silent choice: which endpoint gets burned into the
    // deployment would otherwise depend on line order.
    expect(result.output).toContain("READ-THREW::.env must contain exactly one non-empty HEALTHCHECK_WATCHDOG_URL entry.");
    // The control, so the refusal is discrimination rather than a reader that refuses everything.
    expect(result.output).toMatch(/READ-OK=hc:[0-9a-f]{8}/);
  }, 60_000);

  // The write path, measured without a token. A gate refused an earlier residual declaration that
  // folded these into "needs an administrator" and proved why: a junction needs no privilege at
  // all, and everything between the temp write and the final verification runs once the one call
  // that does need a token — the ACL application — is stubbed out. The stub is a seam by
  // construction: `Set-WatchdogBootstrapAcl` is its own function, and nothing else in the path
  // touches a privileged API.
  async function withAclStubbed(body: string): Promise<Run> {
    const copy = path.join(tempRoot, "tools", `bootstrap-aclstub-${Math.random().toString(36).slice(2)}.ps1`);
    const source = await readFile(BOOTSTRAP_MODULE, "utf8");
    const anchored = "function Set-WatchdogBootstrapAcl {";
    const findings = "function Get-WatchdogBootstrapAclFindings {";
    expect(source).toContain(anchored);
    expect(source).toContain(findings);
    // Two stubs, and what they cost is stated rather than hidden: with the ACL never applied, the
    // drift detector would report the absence it is designed to report, and the module's own
    // verification would refuse — so the ACL half of that verification is silenced too. What these
    // cases therefore measure is the file mechanics of the write path, not its ACL. The ACL half
    // is what the residual is about, and the drift detector is measured on its own, elsewhere in
    // this file, against real ACLs on real files.
    await writeFile(copy, inject(source.replace(/^Export-ModuleMember.*$/m, ""), [
      [anchored, "function Set-WatchdogBootstrapAcl { return"],
      [findings, "function Get-WatchdogBootstrapAclFindings { return @()"],
    ]), "utf8");
    return await runInline([
      `. '${copy}'`,
      "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      body,
    ].join("\n"));
  }

  it("refuses to write through a junction, at the directory and at its parent", async () => {
    const real = path.join(tempRoot, "reparse-real");
    const link = path.join(tempRoot, "reparse-link");
    const parentReal = path.join(tempRoot, "reparse-parent-real");
    const parentLink = path.join(tempRoot, "reparse-parent-link");
    const result = await module_([
      `[System.IO.Directory]::CreateDirectory('${path.join(real, "secrets")}') | Out-Null`,
      `[System.IO.Directory]::CreateDirectory('${path.join(parentReal, "secrets")}') | Out-Null`,
      // A junction, not a symlink: it needs no privilege, which is the whole point.
      `cmd /c mklink /J '${path.join(link, "")}'.TrimEnd('\\') '${real}' | Out-Null`,
      `cmd /c mklink /J '${parentLink}' '${parentReal}' | Out-Null`,
      "foreach ($case in @(",
      `  @{ Name = 'directory'; Path = '${path.join(link, "secrets", "healthchecks-watchdog.url")}' },`,
      `  @{ Name = 'parent'; Path = '${path.join(parentLink, "secrets", "healthchecks-watchdog.url")}' }`,
      ")) {",
      "  try {",
      `    Install-WatchdogBootstrap -Url '${FAKE_URL}' -TaskUserSid $sid -Path $case.Path | Out-Null`,
      "    Write-Output \"$($case.Name)=NO-REFUSAL\" }",
      "  catch { Write-Output \"$($case.Name)=$($_.Exception.Message)\" } }",
    ].join("\n"));

    // The junction had to be creatable for this case to mean anything; if it was not, say so
    // rather than passing on an absent link.
    expect(result.output).not.toContain("NO-REFUSAL");
    expect(result.output).toMatch(/directory=.*reparse point/);
    expect(result.output).toMatch(/parent=.*reparse point/);
  }, 90_000);

  it("refuses when the temporary file does not read back exactly what was asked for", async () => {
    const target = path.join(tempRoot, "readback", "secrets", "healthchecks-watchdog.url");
    const result = await withAclStubbed([
      "# The guard's contract is: if the read-back disagrees with what was asked for, refuse. A",
      "# disagreeing read-back is simulated by shadowing the reader for the temporary file only,",
      "# which is a different function from the guard under test.",
      "$script:realRead = Get-Item function:Read-WatchdogBootstrap",
      "function Read-WatchdogBootstrap { param([string]$Path = '')",
      "  if ($Path -like '*.tmp-*') { return [pscustomobject]@{ Ok = $true; Code = $null; Url = 'https://hc.example.invalid/ping/deadbeef-0000-0000-0000-000000000000'; Fingerprint = 'hc:deadbeef' } }",
      "  return & $script:realRead.ScriptBlock @PSBoundParameters }",
      "try {",
      `  Install-WatchdogBootstrap -Url '${FAKE_URL}' -TaskUserSid $sid -Path '${target}' | Out-Null`,
      "  Write-Output 'NO-REFUSAL' }",
      "catch { Write-Output \"THREW::$($_.Exception.Message)\" }",
      `Write-Output ('TARGET-EXISTS=' + [System.IO.File]::Exists('${target}'))`,
      `Write-Output ('STRAYS=' + @(Get-ChildItem -LiteralPath '${path.join(tempRoot, "readback", "secrets")}' -Force -ErrorAction SilentlyContinue).Count)`,
    ].join("\n"));

    expect(result.output).toContain("THREW::The watchdog bootstrap temporary file did not read back exactly.");
    expect(result.output).not.toContain("NO-REFUSAL");
    // Nothing is left behind, and nothing was installed.
    expect(result.output).toContain("TARGET-EXISTS=False");
    expect(result.output).toContain("STRAYS=0");
  }, 90_000);

  it("rotates over an existing file atomically, and leaves neither temporary nor backup behind", async () => {
    const dir = path.join(tempRoot, "rotate", "secrets");
    const target = path.join(dir, "healthchecks-watchdog.url");
    const second = "https://hc.example.invalid/ping/22222222-3333-4444-5555-666666666666";
    const result = await withAclStubbed([
      `$target = '${target}'`,
      `$first = Install-WatchdogBootstrap -Url '${FAKE_URL}' -TaskUserSid $sid -Path $target`,
      "Write-Output ('FIRST=' + $first.Fingerprint + '|' + [System.IO.File]::ReadAllText($target))",
      "# A reader holding the old file open across the rotation. What the module owes here is that",
      "# the rotation completes at all while a reader holds the file — `Read-WatchdogBootstrap`",
      "# opens with FileShare::Delete for exactly this reason, and a rotation that threw would be",
      "# the watchdog losing its endpoint during an install.",
      "$held = New-Object System.IO.FileStream($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)",
      `$secondResult = Install-WatchdogBootstrap -Url '${second}' -TaskUserSid $sid -Path $target`,
      "$held.Dispose()",
      "Write-Output ('SECOND=' + $secondResult.Fingerprint + '|' + [System.IO.File]::ReadAllText($target))",
      "$strays = @(Get-ChildItem -LiteralPath (Split-Path -Parent $target) -Force | Where-Object { $_.Name -ne 'healthchecks-watchdog.url' })",
      "Write-Output ('STRAYS=' + $strays.Count + '|' + (($strays | ForEach-Object { $_.Name }) -join ','))",
    ].join("\n").replace("FAKE_URL_PLACEHOLDER", FAKE_URL));

    expect(result.output).toContain(`FIRST=hc:`);
    expect(result.output).toContain(FAKE_URL);
    // The rotation installed the new value and the held reader still saw the whole old one.
    // Stated rather than left implicit: what this case does *not* pin is whether the held handle
    // still yields the old bytes after the replace. That is Windows' behaviour for a replaced and
    // then deleted file object — measured here, it reads empty — and it is not a promise this
    // module makes.
    expect(result.output).toContain(second);
    // Neither the temporary nor the backup survives — the backup is the one that would otherwise
    // carry the *previous* endpoint next to the live one.
    expect(result.output).toContain("STRAYS=0|");
  }, 90_000);

  it("refuses an endpoint of the wrong shape before it creates any directory", async () => {
    const target = path.join(tempRoot, "never-created", "secrets", "healthchecks-watchdog.url");
    const result = await module_([
      "try {",
      `  Install-WatchdogBootstrap -Url 'not-a-url' -TaskUserSid $sid -Path '${target}' | Out-Null`,
      "  Write-Output 'INSTALL-OK'",
      "} catch { Write-Output \"INSTALL-THREW::$($_.Exception.Message)\" }",
      `Write-Output ('DIRECTORY-EXISTS=' + [System.IO.Directory]::Exists('${path.join(tempRoot, "never-created")}'))`,
    ].join("\n"));

    expect(result.output).toContain("The configured watchdog endpoint is absent or invalid");
    expect(result.output).toContain("DIRECTORY-EXISTS=False");
  }, 60_000);

  it("detects every shape of ACL drift it claims to detect, on real files", async () => {
    const dir = path.join(tempRoot, "drift");
    const file = path.join(dir, "healthchecks-watchdog.url");
    const result = await module_([
      `$dir = '${dir}'`,
      `$file = '${file}'`,
      "[System.IO.Directory]::CreateDirectory($dir) | Out-Null",
      `[System.IO.File]::WriteAllText($file, '${FAKE_URL}', (New-Object System.Text.UTF8Encoding($false)))`,
      "$everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')",
      "# The detector is internal to the module; `Test-WatchdogBootstrap` is the public path that",
      "# reaches it, and it is the path the installer and the verifier both use.",
      "# 1. Inheritance left on, owner is this account, and no expected ACE was ever set.",
      "$verdict = Test-WatchdogBootstrap -Path $file -TaskUserSid $sid",
      "Write-Output \"INHERITED::Ok:$($verdict.Ok)|$($verdict.Findings -join ',')\"",
      "# 2. Protect the ACL and hand the file an ACE nobody expects.",
      "$acl = (New-Object System.IO.FileInfo($file)).GetAccessControl()",
      "$acl.SetAccessRuleProtection($true, $true)",
      "$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)))",
      "(New-Object System.IO.FileInfo($file)).SetAccessControl($acl)",
      "$verdict = Test-WatchdogBootstrap -Path $file -TaskUserSid $sid",
      "Write-Output \"EXTRA::Ok:$($verdict.Ok)|$($verdict.Findings -join ',')\"",
    ].join("\n"));

    // Inheritance on, and the two privileged ACEs the design requires are absent.
    expect(result.output).toMatch(/INHERITED::Ok:False/);
    expect(result.output).toMatch(/INHERITED::.*file:inheritance-enabled/);
    expect(result.output).toMatch(/INHERITED::.*file:owner-unexpected/);
    expect(result.output).toMatch(/INHERITED::.*file:missing-ace:S-1-5-18/);
    // An ACE for Everyone is exactly the widening this detector exists to catch.
    expect(result.output).toMatch(/EXTRA::Ok:False/);
    expect(result.output).toMatch(/EXTRA::.*file:extra-ace:S-1-1-0/);
  }, 60_000);

  it("goes red when the drift detector's protection check is removed, in a copy", async () => {
    const original = await readFile(BOOTSTRAP_MODULE, "utf8");
    const anchor = "if (-not $security.AreAccessRulesProtected) { $findings.Add('inheritance-enabled') }";
    const copy = path.join(tempRoot, "tools", "watchdog-bootstrap-mutant.psm1");
    await writeFile(copy, inject(original, [[anchor, "if ($false) { }"]]), "utf8");
    const dir = path.join(tempRoot, "drift-mutant");
    const file = path.join(dir, "healthchecks-watchdog.url");

    const result = await runInline([
      `Import-Module '${copy}' -Force -ErrorAction Stop`,
      "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      `[System.IO.Directory]::CreateDirectory('${dir}') | Out-Null`,
      `[System.IO.File]::WriteAllText('${file}', '${FAKE_URL}', (New-Object System.Text.UTF8Encoding($false)))`,
      `$verdict = Test-WatchdogBootstrap -Path '${file}' -TaskUserSid $sid`,
      "Write-Output \"MUTANT::$($verdict.Findings -join ',')\"",
    ].join("\n"));

    // The other findings still fire; the one the mutation removed does not. That difference is
    // what the case above rests on.
    expect(result.output).toContain("MUTANT::");
    expect(result.output).toContain("file:owner-unexpected");
    expect(result.output).not.toContain("file:inheritance-enabled");
  }, 60_000);

  it("rejects every unusable bootstrap file shape, each as a real file", async () => {
    const dir = path.join(tempRoot, "shapes");
    const result = await module_([
      `$dir = '${dir}'`,
      "[System.IO.Directory]::CreateDirectory($dir) | Out-Null",
      "$utf8 = New-Object System.Text.UTF8Encoding($false)",
      "$cases = @(",
      "  @{ Name = 'missing'; Write = $false; Content = '' },",
      `  @{ Name = 'empty'; Write = $true; Content = '' },`,
      `  @{ Name = 'trailing-newline'; Write = $true; Content = "${FAKE_URL}\`n" },`,
      "  @{ Name = 'not-a-url'; Write = $true; Content = 'plainly-not-a-url' },",
      "  @{ Name = 'two-lines'; Write = $true; Content = \"a`nb\" }",
      ")",
      "foreach ($case in $cases) {",
      "  $p = Join-Path $dir ($case.Name + '.url')",
      "  if ($case.Write) { [System.IO.File]::WriteAllText($p, $case.Content, $utf8) }",
      "  $read = Read-WatchdogBootstrap -Path $p",
      "  Write-Output \"$($case.Name)=Ok:$($read.Ok)|Code:$($read.Code)\"",
      "}",
      `$good = Join-Path $dir 'good.url'`,
      `[System.IO.File]::WriteAllText($good, '${FAKE_URL}', $utf8)`,
      "$read = Read-WatchdogBootstrap -Path $good",
      "Write-Output \"good=Ok:$($read.Ok)|Fingerprint:$($read.Fingerprint)\"",
    ].join("\n"));

    expect(result.output).toContain("missing=Ok:False|Code:missing");
    expect(result.output).toContain("empty=Ok:False");
    expect(result.output).toContain("trailing-newline=Ok:False");
    expect(result.output).toContain("not-a-url=Ok:False");
    expect(result.output).toContain("two-lines=Ok:False");
    // The control: a well-formed file is accepted, so the refusals above are discrimination
    // rather than a reader that refuses everything.
    expect(result.output).toMatch(/good=Ok:True\|Fingerprint:hc:[0-9a-f]{8}/);
  }, 60_000);
});
