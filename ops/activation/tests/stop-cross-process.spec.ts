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
const CLI = path.join(REPO, "ops", "activation", "tests", "support", "isolated-cli.ts");
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

// The competing **effects**, not only the competing decisions (R4-01, and the reviewer's
// note that the first cross-process case ran with `ports: null` and therefore measured a
// refusal rather than a world).
//
// Two real processes, one real activation lease, one world in a file that both of them
// write. The arming effect takes time on purpose: a real `Enable-ScheduledTask` is not
// instantaneous, and the interval it occupies is the whole of R2-03. Nothing in the
// harness decides who wins that interval.
describe("two processes, one world, and the stop that has to survive it", () => {
  const COMPETE = path.join(REPO, "ops", "activation", "tests", "support", "compete.mjs");

  it("leaves the deployment disarmed although an arming effect landed in the middle of the stop", async () => {
    const stateRoot = await root();
    const worldFile = path.join(stateRoot, "world.json");
    const readyFile = path.join(stateRoot, "holder-ready");
    await writeFile(worldFile, JSON.stringify({ tasks: { cycle: false, watchdog: false }, disarmRegistered: true, certificateLine: null, effects: [], enableDelayMs: 1500 }, null, 2), "utf8");
    // A real `.env` with the arming credential in it: the production removal path verifies
    // the digest it read, the digest it wrote and the content it re-reads, so the double
    // has to be a file rather than a remembered string.
    await writeFile(path.join(stateRoot, ".env"), ["PRE_ARM_CERTIFICATE=C:\\evidence\\pre-arm\\x.json", ""].join("\n"), "utf8");

    // The tick takes the lease and starts arming.
    const arming = run([COMPETE, "hold-and-arm", stateRoot, worldFile, readyFile]);
    const readyBy = Date.now() + 20_000;
    while (Date.now() < readyBy) {
      const ready = await readFile(readyFile, "utf8").catch(() => null);
      if (ready !== null) break;
      await new Promise(resolve => { setTimeout(resolve, 20); });
    }
    // Inside the arming window, the owner types the stop in another process.
    await new Promise(resolve => { setTimeout(resolve, 200); });
    const stop = await run([COMPETE, "stop", stateRoot, worldFile, "felix"]);
    const armingRun = await arming;

    expect(armingRun.exitCode).toBe(0);
    expect(stop.exitCode).toBe(0);

    const world = JSON.parse(await readFile(worldFile, "utf8")) as { readonly tasks: Record<string, boolean>; readonly effects: readonly string[]; readonly disarmRegistered: boolean; readonly certificateLine: string | null };

    // The property the contract owes, stated as the world rather than as a report: after
    // the owner's stop, nothing is armed. Not "the stop printed that it disarmed".
    expect(world.tasks["cycle"]).toBe(false);
    expect(world.tasks["watchdog"]).toBe(false);
    expect(world.disarmRegistered).toBe(false);
    expect(await readFile(path.join(stateRoot, ".env"), "utf8")).not.toContain("PRE_ARM_CERTIFICATE");

    // And the record says how it got there. Either the arming effect was refused before
    // it landed, or it landed and the stop's confirming pass under the lease undid it —
    // both are legal, and which one happened is in the effects, in order.
    const armed = world.effects.some(effect => effect.startsWith("hold-and-arm:") && effect.endsWith("=true"));
    if (armed) {
      // The effect landed, so something had to take it back. Whoever did it, the last word
      // on each task is "disabled" — and in practice it is the arming process itself, which
      // is the point of SC-3a: it holds the lease the stop is waiting for, so it is the only
      // one that can undo its own effect in that window.
      for (const task of ["cycle", "watchdog"]) {
        expect(world.effects.filter(effect => effect.includes(`${task}=`)).at(-1)).toBe(
          world.effects.filter(effect => effect.includes(`${task}=`)).at(-1)?.startsWith("stop:") ? `stop:${task}=false` : `hold-and-arm:${task}=false`,
        );
        expect(world.effects.filter(effect => effect.includes(`${task}=`)).at(-1)).toContain("=false");
      }
      // Whichever of the two got there last, an undo by the arming process itself must be
      // in the record: that is the mechanism SC-3a adds, and without it the world depended
      // on the stop winning a race it does not control.
      expect(world.effects.some(effect => effect === "hold-and-arm:cycle=false")).toBe(true);
      // And it is on the record, not only in the world: the arming process reports the
      // undo it applied, with the action it compensates named in the detail.
      const armReports = JSON.parse(await readFile(path.join(stateRoot, "arm-reports.json"), "utf8")) as readonly { readonly kind: string; readonly applied: boolean; readonly detail: Record<string, unknown> | null }[];
      const undo = armReports.find(report => report.kind === "disable-tasks" && report.applied);
      expect(undo).toBeDefined();
      expect(undo?.detail?.["compensates"]).toBe("enable-tasks");
    }

    // The stop's own report is read last, and only to check that it agrees with the world.
    const reported = JSON.parse(await readFile(path.join(stateRoot, "stop-result.json"), "utf8")) as { readonly outcome: { readonly kind: string; readonly reason?: string } };
    // Two outcomes are legal here and which one occurs depends on who lets go of the lease
    // first, so the test asserts what holds in both rather than the one that happened to
    // win this time: the stop either recorded itself (`aborted`) or said plainly that it
    // could not (`work-failed`). What it must never be is a silent success — and the world
    // above is disarmed either way, which is the property that does not depend on the race.
    expect(["aborted", "work-failed"]).toContain(reported.outcome.kind);
    if (reported.outcome.kind === "work-failed") {
      expect(reported.outcome.reason).toContain("neither confirmed under the lease nor recorded");
    }
    expect((await readStopMark(stateRoot)).kind).toBe("present");
  }, 60_000);

  it("refuses the arming effect outright when the stop is already standing", async () => {
    const stateRoot = await root();
    const worldFile = path.join(stateRoot, "world.json");
    const readyFile = path.join(stateRoot, "holder-ready");
    await writeFile(worldFile, JSON.stringify({ tasks: { cycle: false, watchdog: false }, disarmRegistered: true, certificateLine: null, effects: [], enableDelayMs: 0 }, null, 2), "utf8");
    await writeFile(path.join(stateRoot, ".env"), "", "utf8");

    // The stop first, and it completes: the mark is on disk before the tick starts.
    await run([COMPETE, "stop", stateRoot, worldFile, "felix"]);
    const armingRun = await run([COMPETE, "hold-and-arm", stateRoot, worldFile, readyFile]);

    expect(armingRun.exitCode).toBe(0);
    const world = JSON.parse(await readFile(worldFile, "utf8")) as { readonly tasks: Record<string, boolean>; readonly effects: readonly string[] };
    expect(world.tasks["cycle"]).toBe(false);
    expect(world.tasks["watchdog"]).toBe(false);
    // Nothing was even attempted by the tick: no effect of its label touched a task.
    expect(world.effects.filter(effect => effect.startsWith("hold-and-arm:") && effect.includes("="))).toEqual([]);
  }, 60_000);
});
