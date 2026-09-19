// The stop contract across process boundaries (`docs/P12-STOP-AND-LOG-CONTRACTS.md`,
// SC-2 to SC-4).
//
// SC-3 is a claim about two processes and one world, and the finding behind it (R2-03)
// was only ever reproduced as two real processes against the real single-instance lock.
// An in-process test of it proves the wiring, not the property, so this file runs the
// real CLI as a real child: `node ops/activation/cli.ts`, the real store, the real files.
//
// The one thing it cannot show is an action taking effect, because the action ports are
// null until unit 13 binds them. What it shows instead is the decision every port call
// passes through: with the mark on disk, a second process holding the lease and about to
// arm refuses, and says whose stop stopped it.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { readStopMark } from "../store/stop-mark.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const CLI = path.join(REPO, "ops", "activation", "cli.ts");
const ANCHOR = "2026-09-22";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async item => { await rm(item, { recursive: true, force: true, maxRetries: 3 }); }));
});

async function root(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "gbt-stop-xp-"));
  roots.push(created);
  return created;
}

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(argv: readonly string[], options: { readonly cwd?: string } = {}): Promise<Run> {
  return new Promise<Run>((resolve, reject) => {
    const child = spawn(process.execPath, argv, { cwd: options.cwd ?? REPO, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", code => { resolve({ exitCode: code ?? -1, stdout, stderr }); });
  });
}

describe("a stop typed in one process, seen by another", () => {
  it("survives the process that typed it, and status in a second process reports it", async () => {
    const stateRoot = await root();

    const abort = await run([CLI, "abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]);
    // Exit 1: the attempt is over. It applied nothing, because this deployment has no
    // host bindings, and the line says so rather than claiming a teardown.
    expect(abort.exitCode).toBe(1);
    expect(`${abort.stdout}${abort.stderr}`).toContain("OWNER_ABORT_NO_ATTEMPT");

    const mark = await readStopMark(stateRoot);
    expect(mark.kind).toBe("present");
    if (mark.kind !== "present") throw new Error("the mark did not survive the process");
    expect(mark.mark.operator).toBe("felix");

    const status = await run([CLI, "status", "--state-root", stateRoot]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("STOPPED");
    expect(status.stdout).toContain("felix");

    const opened = await run([CLI, "open", "--state-root", stateRoot, "--anchor-day", ANCHOR, "--operator", "felix"]);
    expect(opened.exitCode).toBe(0);
    expect((await readStopMark(stateRoot)).kind).toBe("absent");
  });

  // The shape of R2-03, as far as this deployment can be driven today: one process holds
  // the activation lease and is between its decision and its arming action; the owner's
  // stop lands in another process; the holder refuses.
  it("refuses an arming action in a process that already held the lease when the stop landed", async () => {
    const stateRoot = await root();
    const holderScript = path.join(stateRoot, "holder.mjs");
    const reportFile = path.join(stateRoot, "holder-report.json");
    const storeUrl = pathToFileURL(path.join(REPO, "ops", "activation", "store", "stop-mark.ts")).href;
    const invokeUrl = pathToFileURL(path.join(REPO, "ops", "activation", "cli", "invoke.ts")).href;
    const ledgerUrl = pathToFileURL(path.join(REPO, "ops", "activation", "store", "ledger-store.ts")).href;

    await writeFile(holderScript, [
      `import { readStopMark, stopMarkPath } from ${JSON.stringify(storeUrl)};`,
      `import { applyAll } from ${JSON.stringify(invokeUrl)};`,
      `import { withActivationLedger, currentLedgerLockOwner } from ${JSON.stringify(ledgerUrl)};`,
      "import { writeFileSync, existsSync } from 'node:fs';",
      `const root = ${JSON.stringify(stateRoot)};`,
      "await withActivationLedger({ root, owner: currentLedgerLockOwner(), makeSystemDraft: () => { throw new Error('no system draft here'); } }, async () => {",
      // The lease is held from here. The stop has to land while it is.
      "  writeFileSync(root + '\\\\holder-ready', 'ready');",
      `  const deadline = Date.now() + 20000;`,
      "  while (Date.now() < deadline && !existsSync(stopMarkPath(root))) await new Promise(r => setTimeout(r, 25));",
      "  const context = { envFile: root + '\\\\.env', repoRoot: root, activationRoot: root, anchorDay: '2026-09-22', nodePath: '', taskUserId: '', taskUserSid: '', platform: process.platform };",
      "  const reports = await applyAll([{ kind: 'enable-tasks', tasks: ['cycle', 'watchdog'] }], { ports: null, context, dryRun: false, print: () => undefined, stopAtFirstFailure: true, readStop: () => readStopMark(root) });",
      `  writeFileSync(${JSON.stringify(reportFile)}, JSON.stringify(reports));`,
      "  return 1;",
      "});",
    ].join("\n"), "utf8");

    const holder = run([holderScript]);
    const readyAt = Date.now() + 20_000;
    while (Date.now() < readyAt) {
      const ready = await readFile(path.join(stateRoot, "holder-ready"), "utf8").catch(() => null);
      if (ready !== null) break;
      await new Promise(resolve => { setTimeout(resolve, 25); });
    }

    const abort = await run([CLI, "abort", "--confirm", "--state-root", stateRoot, "--operator", "felix"]);
    const holderRun = await holder;

    expect(holderRun.exitCode).toBe(0);
    const reports = JSON.parse(await readFile(reportFile, "utf8")) as readonly { readonly applied: boolean; readonly reason: string }[];
    expect(reports[0]?.applied).toBe(false);
    expect(reports[0]?.reason).toContain("STOPPED_BY_OWNER");
    expect(reports[0]?.reason).toContain("felix");

    // And the stop itself: it disarmed and marked before it ever asked for the lease, so
    // the holder saw it. Whether it could also confirm under the lease depends on who let
    // go first, and the exit code says which of the two happened — never 0.
    expect([1, 4]).toContain(abort.exitCode);
    expect((await readStopMark(stateRoot)).kind).toBe("present");
  }, 40_000);
});
