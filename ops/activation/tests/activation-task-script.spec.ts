import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

describe("activation scheduled-task script", () => {
  it("pins the two five-minute windows and keeps installation disabled by default", async () => {
    const text = await readFile(path.join(REPO_ROOT, "tools", "activation-task.ps1"), "utf8");

    expect(text).toContain("${CertificateDay}T15:30:00");
    expect(text).toContain("New-TimeSpan -Hours 9 -Minutes 15");
    expect(text).toContain("${AnchorDay}T13:25:00");
    expect(text).toContain("New-TimeSpan -Hours 2 -Minutes 40");
    expect(text.match(/New-TimeSpan -Minutes 5/gu)).toHaveLength(2);
    expect(text).toContain("-MultipleInstances IgnoreNew");
    expect(text).toContain("-StartWhenAvailable");
    expect(text).toContain("-LogonType S4U -RunLevel Highest");
    const disable = text.indexOf("-DontStopIfGoingOnBatteries -Disable");
    const register = text.indexOf("Register-ScheduledTask -TaskName $ActivationTaskName");
    const verify = text.indexOf("Assert-CommonDefinition -Task $registered -ExpectedArguments $activationAction.Arguments");
    const enable = text.indexOf("if ($Activate) { Enable-ScheduledTask -TaskName $ActivationTaskName");
    expect(disable).toBeGreaterThan(0);
    expect(register).toBeGreaterThan(disable);
    expect(verify).toBeGreaterThan(register);
    expect(enable).toBeGreaterThan(verify);
    expect(text).toContain("Registered activation task was not disabled before verification");
    expect(text).toContain("registeredSid -ne $UserSid");
  });

  it("has no operation that installs and enables the trading tasks", async () => {
    const text = await readFile(path.join(REPO_ROOT, "tools", "activation-task.ps1"), "utf8");

    expect(text).not.toMatch(/install-scheduled-task\.ps1/iu);
    expect(text).not.toMatch(/Enable-ScheduledTask[^\r\n]*GlassBoxTrading-(?:AgentCycle|Watchdog)/iu);
    expect(text).toContain("[ValidateSet('cycle', 'watchdog')]");
    expect(text).toContain("[ValidateSet('true', 'false')]");
  });
});
