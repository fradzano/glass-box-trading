import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

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

  it("the task inventory resolves each scheduled principal to a canonical Windows SID", async () => {
    const text = await readFile(path.join(ROOT, "ops", "activation", "readers", "host", "read-tasks.ps1"), "utf8");
    expect(text).toContain("UserSid            = $userSid");
    expect(text).toContain("Translate([Security.Principal.SecurityIdentifier])");
  });
});
