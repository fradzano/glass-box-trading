import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const HARNESS = path.join(REPO_ROOT, "ops", "activation", "tests", "support", "task-scheduler-harness.ps1");
const SCRIPT = path.join(REPO_ROOT, "tools", "activation-task.ps1");

interface HarnessResult {
  readonly events: readonly string[];
  readonly state: string;
  readonly returnedUserId: string;
  readonly requestedUserId: string;
}

async function runHarness(activate: boolean, activationScript = SCRIPT, extraArgs: readonly string[] = []): Promise<HarnessResult> {
  const { stdout } = await execFileAsync(POWERSHELL, [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", HARNESS,
    "-ActivationScript", activationScript, "-RepoRoot", REPO_ROOT, "-NodePath", process.execPath,
    ...(activate ? ["-Activate"] : []),
    ...extraArgs,
  ], { cwd: REPO_ROOT, windowsHide: true, timeout: 30_000 });
  return JSON.parse(stdout.trim()) as HarnessResult;
}

async function failureStderr(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string") return error.stderr;
    throw error;
  }
  throw new Error("expected the harness invocation to fail");
}

describe.runIf(process.platform === "win32")("activation task process barrier", () => {
  it("registers disabled and verifies the normalized principal by SID", async () => {
    const result = await runHarness(false);
    expect(result.state).toBe("Disabled");
    expect(result.events).toEqual(["register:True", "get:Disabled"]);
    expect(result.returnedUserId).not.toBe(result.requestedUserId);
  });

  it("enables only after the disabled registration has been read back", async () => {
    const result = await runHarness(true);
    expect(result.state).toBe("Ready");
    expect(result.events).toEqual(["register:True", "get:Disabled", "enable:Disabled"]);
  });

  it("registers the 15:05 disarm one-shot enabled and verifies its trigger", async () => {
    const result = await runHarness(false, SCRIPT, ["-Operation", "RegisterDisarm"]);
    expect(result.state).toBe("Ready");
    expect(result.events).toEqual(["register:False", "get:Ready"]);
  });

  it("rejects the same short principal name when it resolves to a different SID", async () => {
    expect(await failureStderr(runHarness(false, SCRIPT, ["-ResolvePrincipalToWrongSid"])))
      .toContain("Registered task principal SID differs from the requested identity");
  });

  it("refuses an unreviewed ScheduledTasks command before executing the subject", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gbt-activation-task-mutant-"));
    try {
      const mutant = path.join(root, "activation-task.ps1");
      await writeFile(mutant, `${await readFile(SCRIPT, "utf8")}\nGet-ScheduledTask -TaskName 'unreviewed'\n`, "utf8");
      expect(await failureStderr(runHarness(false, mutant)))
        .toContain("HARNESS_UNREVIEWED_SCHEDULED_TASK_COMMAND");
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
