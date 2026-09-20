import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

async function script(name: string): Promise<string> {
  return readFile(path.join(ROOT, "tools", name), "utf8");
}

async function reader(name: string): Promise<string> {
  return readFile(path.join(ROOT, "ops", "activation", "readers", name), "utf8");
}

describe("scheduled-task executable trust boundary", () => {
  it("the installer derives Node from the pinned runtime and rejects any other existing file, including notepad.exe", async () => {
    const text = await script("install-scheduled-task.ps1");
    expect(text).toContain("process.stdout.write(process.execPath)");
    expect(text).toContain("Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1");
    expect(text).toContain("$NodePath -ine $expectedNodePath");
    expect(text).toContain("is not the pinned runtime");
    expect(text).not.toContain("New-ScheduledTaskAction -Execute 'powershell.exe'");
    // The old Test-Path-only rule accepted any leaf, including notepad.exe.
    const oldRuleAcceptsNotepad = (exists: boolean): boolean => exists;
    const newRuleAcceptsNotepad = (candidate: string, expected: string): boolean => candidate.toLowerCase() === expected.toLowerCase();
    expect(oldRuleAcceptsNotepad(true)).toBe(true);
    expect(newRuleAcceptsNotepad("C:\\Windows\\System32\\notepad.exe", "C:\\Program Files\\nodejs\\node.exe")).toBe(false);
    expect(text).toContain("$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()");
    expect(text).toContain("$expectedUserSid = $currentIdentity.User.Value");
    expect(text).toContain("Security.Principal.SecurityIdentifier");
    expect(text).toContain("$candidateUserSid -ne $expectedUserSid");
    expect(text).toContain("is not the current Windows identity");
    expect(text).toContain("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(text).not.toContain("Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'");
  });

  it("the read-only verifier binds Node, PowerShell, principal SID, RunLevel and WorkingDirectory by exact value", async () => {
    const text = await script("verify-scheduled-tasks.ps1");
    expect(text).toContain("$resolvedNodePath -ieq $expectedNodePath");
    expect(text).toContain("Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1");
    expect(text).toContain("$executable -ieq $expectedPowerShellPath");
    expect(text).toContain("$task.Principal.UserId");
    expect(text).toContain("$task.Principal.RunLevel");
    expect(text).toContain("$logonType -eq 'S4U'");
    expect(text).not.toContain("$logonType -eq 'Password'");
    expect(text).toContain("passes every parameter at most once");
    expect(text).toContain("Group-Object -Property Name");
    expect(text).toContain('-Ok ($duplicates.Count -eq 0)');
    expect(text).toContain("working directory is the checkout");
    expect(text).toContain("$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()");
    expect(text).toContain("$expectedUserSid = $currentIdentity.User.Value");
    expect(text).toContain("Security.Principal.SecurityIdentifier");
    expect(text).toContain("$observedUserSid -eq $expectedUserSid");
    expect(text).toContain("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(text).not.toContain("$expectedUserId = \"$env:USERDOMAIN\\$env:USERNAME\"");
  });

  it("the production reader derives its user from Windows APIs and uses the fixed trusted PowerShell path", async () => {
    const text = await reader("host-ports.ts");
    expect(text).toContain("taskUserId,");
    expect(text).toContain("taskUserSid,");
    expect(text).toContain("[Security.Principal.WindowsIdentity]::GetCurrent().User.Value");
    expect(text).toContain("powerShellPath: TRUSTED_WINDOWS_POWERSHELL");
    expect(text).not.toContain('process.env["USERDOMAIN"]');
    expect(text).not.toContain('process.env["SystemRoot"]');
  });

  // R3-17, and the reason it is a test rather than a comment: `Write-RunLog`'s guard against a
  // failed write works only because the script-wide `$ErrorActionPreference = 'Stop'` makes
  // `Add-Content` throw. Measured: under `Stop` the catch fires, under `Continue` it does not.
  // Both wrappers open short `Continue` windows around their node invocation, and every one of
  // them is closed in a `finally` before the next log line — today. A single moved line would
  // put a log call inside such a window and make the guard silent again, which is the class of
  // defect it repairs. The compensating control may not be the reader's memory.
  //
  // What this checks: no `Write-RunLog` call may stand between a `'Continue'` assignment and the
  // restoration that closes it. What it does not check: whether the restoration is correct, or
  // whether a call reached through a helper sits in the window.
  for (const wrapper of ["cycle-run.ps1", "watchdog-run.ps1"]) {
    it(`keeps every Write-RunLog call out of a Continue window in ${wrapper}`, async () => {
      const text = await readFile(path.join(ROOT, "tools", wrapper), "utf8");
      const lines = text.split(/\r?\n/u);
      let openedAt: number | null = null;
      const offenders: string[] = [];
      lines.forEach((line, index) => {
        if (/\$ErrorActionPreference\s*=\s*'Continue'/u.test(line)) openedAt = index + 1;
        else if (openedAt !== null && /\$ErrorActionPreference\s*=\s*\$previous/u.test(line)) openedAt = null;
        else if (openedAt !== null && /\bWrite-RunLog\b/u.test(line)) offenders.push(`line ${String(index + 1)} (window opened at ${String(openedAt)}): ${line.trim()}`);
      });
      expect(offenders).toEqual([]);
      // And the windows themselves must still be the shape this guard assumes: opened and
      // closed. A file with an unclosed window would make the check vacuous from its last
      // opening onwards, which is worse than no check.
      expect(openedAt).toBeNull();
    });
  }

  // The second half of the same guard. The activation's own parameter check reds the test
  // seam in a registered task (see decide.spec.ts); the scheduler verifier reaches the
  // same conclusion by a different route — it resolves a task's parameters against a fixed
  // list of the ones the wrappers declare for production, and reports anything it cannot
  // resolve. Two independent checks, because a seam whose absence rests on one check is a
  // seam that rests on that check not being edited.
  it("the scheduler verifier does not know the wrappers' test clock", async () => {
    const text = await script("verify-scheduled-tasks.ps1");
    const declared = /\$WRAPPER_PARAMETERS = @\(([^)]*)\)/u.exec(text)?.[1] ?? "";
    expect(declared).not.toContain("TestClockUtc");
    expect(declared).not.toContain("TestBootstrapPath");
    // An unresolvable parameter is reported rather than ignored, which is what makes the
    // omission above load-bearing.
    expect(text).toContain("UNKNOWN:$Token");
    expect(text).toContain("$_.Name -like 'UNKNOWN:*'");
  });

  it("R4-14 binds the independent watchdog bootstrap before either task can change", async () => {
    const installer = await script("install-scheduled-task.ps1");
    const watchdog = await script("watchdog-run.ps1");
    const verifier = await script("verify-scheduled-tasks.ps1");
    const module = await script("watchdog-bootstrap.psm1");

    expect(installer).toContain("Install-WatchdogBootstrap -Url $configuredWatchdogUrl -TaskUserSid $expectedUserSid");
    expect(installer.indexOf("Install-WatchdogBootstrap -Url $configuredWatchdogUrl")).toBeLessThan(installer.lastIndexOf("Remove-ExistingTask -Name $CycleTaskName"));
    expect(installer).toContain("Read-SingleDotEnvValue");
    expect(installer).toContain("$bootstrapResult.Fingerprint -ne $configuredWatchdogFingerprint");
    expect(installer).toContain("[switch]$BootstrapOnly");

    expect(watchdog).toContain("Read-WatchdogBootstrap -Path $bootstrapPath");
    expect(watchdog.indexOf("Read-WatchdogBootstrap -Path $bootstrapPath")).toBeLessThan(watchdog.indexOf("Get-DotEnvValue -EnvFilePath"));
    expect(watchdog).toContain("watchdog endpoint fingerprint mismatch");
    expect(watchdog).not.toContain('return "undelivered: $($_.Exception.Message)"');

    expect(verifier).toContain("Test-WatchdogBootstrap");
    expect(verifier).toContain("ACL-tight and bound to the configured endpoint");
    expect(module).toContain("SetAccessRuleProtection($true, $false)");
    expect(module).toContain("[System.IO.File]::Replace($temporary, $Path, $backup, $true)");
    expect(module).toContain("temporary file did not read back exactly");

    const s4uProbe = await readFile(path.join(ROOT, "ops", "activation", "probes", "prove-watchdog-bootstrap-s4u.ps1"), "utf8");
    expect(s4uProbe).toContain("$ExpectedFingerprint -notmatch '^hc:[0-9a-f]{8}$'");
    expect(s4uProbe.indexOf("$ExpectedFingerprint -notmatch")).toBeLessThan(s4uProbe.indexOf("New-ScheduledTaskAction"));
  });

  for (const wrapper of ["cycle-run.ps1", "watchdog-run.ps1"]) {
    it(`declares the test clock as a parameter and routes every clock read through it in ${wrapper}`, async () => {
      const text = await script(wrapper);
      expect(text).toContain("[string]$TestClockUtc = ''");
      expect(text).toContain("function Get-NowUtc");
      // The point of the seam is that it is the *only* clock: a rule that still reads
      // `[System.DateTime]::UtcNow` directly would be a rule the probe cannot reach, and
      // the three watchdog cases that used to skip on a weekend are exactly those rules.
      const reads = text.split("\n").filter(line => line.includes("[System.DateTime]::UtcNow") && !line.trim().startsWith("#"));
      expect(reads).toHaveLength(1);
      expect(reads[0]).toContain("return [System.DateTime]::UtcNow");
    });
  }

  it("the task inventory resolves each scheduled principal to a canonical Windows SID", async () => {
    const text = await readFile(path.join(ROOT, "ops", "activation", "readers", "host", "read-tasks.ps1"), "utf8");
    expect(text).toContain("UserSid            = $userSid");
    expect(text).toContain("Translate([Security.Principal.SecurityIdentifier])");
  });
});


// R4-35. The two text assertions above pin the guard's wording and its position in the
// file, and a gate measured what that is worth: with the guard line commented out -- the
// asserted substring still present, still ahead of `New-ScheduledTaskAction` -- both
// predicates pass, while the same copy run as a process admits a URL-shaped value. A test
// that cannot go red for the defect it guards measures nothing. What follows runs the
// script, and it carries its own mutant so that its own redness is measured on every run
// rather than assumed.
describe("R4-35 the S4U probe refuses a malformed fingerprint as a process, not as a substring", () => {
  const PROBE = path.join(ROOT, "ops", "activation", "probes", "prove-watchdog-bootstrap-s4u.ps1");
  const GUARD = "if ($ExpectedFingerprint -notmatch '^hc:[0-9a-f]{8}$') { throw";
  // Stands where the first ScheduledTasks cmdlet is, so no copy can register anything on
  // an elevated host. Both copies carry it: the only difference between them is the guard.
  const BARRIER = "throw 'REACHED-SCHEDULEDTASKS'; $action = New-ScheduledTaskAction";
  const REFUSAL = "ExpectedFingerprint must be exactly hc:";
  // Obviously fake, and shaped like the thing that must never reach a task definition.
  const URL_SHAPED = "https://hc.example.invalid/ping/00000000-0000-0000-0000-000000000000";

  const ELEVATION = "if (-not $principalNow.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'the S4U proof parent must run elevated' }";

  let tempRoot = "";
  let original = "";
  let mutant = "";
  // The same copy with the elevation test neutralised, so that a case about *order* cannot be
  // satisfied by the run stopping at a privilege this session happens not to have. The barrier
  // still stands ahead of every ScheduledTasks call, so nothing can be registered.
  let elevated = "";

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "gbt-r435-"));
    const source = await readFile(PROBE, "utf8");
    expect(source).toContain(GUARD);
    expect(source).toContain("$action = New-ScheduledTaskAction");
    expect(source).toContain(ELEVATION);
    const barriered = source.replace("$action = New-ScheduledTaskAction", BARRIER);
    original = path.join(tempRoot, "original.ps1");
    mutant = path.join(tempRoot, "mutant.ps1");
    elevated = path.join(tempRoot, "elevated.ps1");
    await writeFile(original, barriered, "utf8");
    await writeFile(mutant, barriered.replace(GUARD, "if ($false) { throw"), "utf8");
    await writeFile(elevated, barriered.replace(ELEVATION, "# elevation test neutralised by the suite"), "utf8");
  });

  afterAll(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  async function runProbe(script: string, fingerprint: string): Promise<{ readonly code: number | null; readonly output: string }> {
    const resultPath = path.join(tempRoot, `result-${Math.random().toString(36).slice(2)}.txt`);
    return await new Promise(resolve => {
      const child = spawn(POWERSHELL, [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", script,
        "-RepoRoot", ROOT,
        "-ResultPath", resultPath,
        "-ExpectedFingerprint", fingerprint,
      ], { windowsHide: true });
      let output = "";
      child.stdout.on("data", chunk => { output += String(chunk); });
      child.stderr.on("data", chunk => { output += String(chunk); });
      child.on("close", code => { resolve({ code, output }); });
    });
  }

  it("refuses every malformed shape before it can reach a task definition", async () => {
    for (const malformed of [URL_SHAPED, "hc:abcdef1", "hc:abcdef123", "deadbeef", `hc:abcd1234" -Note "${URL_SHAPED}`]) {
      const run = await runProbe(original, malformed);

      expect(run.code).not.toBe(0);
      expect(run.output).toContain(REFUSAL);
      expect(run.output).not.toContain("REACHED-SCHEDULEDTASKS");
    }
  }, 60_000);

  it("never echoes the value it refused, so a mistyped endpoint does not leak through the refusal", async () => {
    const run = await runProbe(original, URL_SHAPED);

    expect(run.output).toContain(REFUSAL);
    expect(run.output).not.toContain("hc.example.invalid");
  }, 30_000);

  // R4-37. This case used to assert `toMatch(/must run elevated|REACHED-SCHEDULEDTASKS/)`,
  // a disjunction satisfied in every possible arrangement — the left branch on a non-elevated
  // host, the barrier on an elevated one — so it stayed green in all five variants a gate drove,
  // including the two where the guard had been moved. What it claimed to hold, it did not hold.
  //
  // The same gate settled what the boundary actually is, by measuring rather than reading:
  // moving the guard *below the elevation test* does not reopen the defect, because the guard
  // still stands ahead of the argument interpolation and no URL reaches a task definition;
  // moving it below `New-ScheduledTaskAction` does reopen it. So the claim worth pinning is that
  // a well-formed value reaches the ScheduledTasks barrier and a malformed one never does, and
  // it is pinned against a copy in which elevation cannot be the thing that stops the run.
  it("lets a well-formed fingerprint reach the ScheduledTasks barrier, where a malformed one never arrives", async () => {
    const wellFormed = await runProbe(elevated, "hc:deadbeef");
    const malformed = await runProbe(elevated, URL_SHAPED);

    expect(wellFormed.output).toContain("REACHED-SCHEDULEDTASKS");
    expect(wellFormed.output).not.toContain(REFUSAL);
    expect(malformed.output).toContain(REFUSAL);
    expect(malformed.output).not.toContain("REACHED-SCHEDULEDTASKS");
  }, 60_000);

  // R4-40. The calibration used to assert only that the mutant admits the value, and promised in
  // its own comment to say so if the two copies ever stopped differing — which it could not,
  // because it never looked at the original. It is a difference now.
  it("distinguishes the original from a copy whose guard is disabled, in one run", async () => {
    const againstOriginal = await runProbe(original, URL_SHAPED);
    const againstMutant = await runProbe(mutant, URL_SHAPED);

    expect(againstOriginal.output).toContain(REFUSAL);
    expect(againstMutant.output).not.toContain(REFUSAL);
  }, 60_000);
});
