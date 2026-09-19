// One competitor in the two-process race over one world.
//
// It is a separate entry point rather than a function the test calls, because the
// property under test is about **operating-system processes**: two of them, one ledger
// lock, one world file, and no shared memory to make the interleaving convenient.
//
// Usage (both roles take the same first three arguments):
//   node compete.mjs hold-and-arm <state root> <world file> <ready file>
//   node compete.mjs stop         <state root> <world file> <operator>
//
// `hold-and-arm` is a tick inside `act`: it takes the real activation lease, says so,
// and applies an arming action whose effect takes time. `stop` is the owner's typed
// abort, through the production `invoke`, with the same file-backed ports.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = async (relative) => import(pathToFileURL(path.join(here, relative)).href);

const { applyAll, invoke } = await load("../../cli/invoke.ts");
const { stampFactory } = await load("../../cli/schedule.ts");
const { berlinLocal } = await load("../../readers/parse.ts");
const { currentLedgerLockOwner, readActivationLedger, withActivationLedger } = await load("../../store/ledger-store.ts");
const { readStopMark } = await load("../../store/stop-mark.ts");
const { createFileActionPorts } = await load("./file-action-ports.ts");

const [role, stateRoot, worldFile, fourth] = process.argv.slice(2);
const ports = createFileActionPorts(worldFile, role);
const context = {
  envFile: path.join(stateRoot, ".env"),
  repoRoot: stateRoot,
  activationRoot: stateRoot,
  anchorDay: "2026-09-22",
  nodePath: "",
  taskUserId: "",
  taskUserSid: "",
  platform: process.platform,
};

if (role === "hold-and-arm") {
  await withActivationLedger({
    root: stateRoot,
    owner: currentLedgerLockOwner(),
    makeSystemDraft: () => { throw new Error("this competitor writes no system draft"); },
  }, async () => {
    writeFileSync(fourth, "ready", "utf8");
    // The arming action starts now and takes time. The stop lands inside it: that is the
    // window R2-03 lived in, and no barrier in this file decides who wins it.
    const reports = await applyAll([{ kind: "enable-tasks", tasks: ["cycle", "watchdog"] }], {
      ports,
      context,
      dryRun: false,
      print: () => undefined,
      stopAtFirstFailure: true,
      readStop: () => readStopMark(stateRoot),
    });
    // What the arming process *reported* is a separate fact from what it did, and the
    // contract owes both: an undo that happens and is not recorded understates the world.
    writeFileSync(path.join(stateRoot, "arm-reports.json"), JSON.stringify(reports, null, 2), "utf8");
    return 1;
  });
  process.exit(0);
}

if (role === "hold-and-hang") {
  // A process that dies at a critical boundary: it holds the activation lease, has already
  // applied one real effect, and then stops existing. Nothing about that is graceful --
  // the test kills it -- which is the point: the lock file, the world and the ledger are
  // left exactly as a power cut would leave them.
  await withActivationLedger({
    root: stateRoot,
    owner: currentLedgerLockOwner(),
    makeSystemDraft: () => { throw new Error("this competitor writes no system draft"); },
  }, async () => {
    await applyAll([{ kind: "disable-tasks", tasks: ["cycle"] }], {
      ports,
      context,
      dryRun: false,
      print: () => undefined,
      stopAtFirstFailure: true,
      readStop: () => readStopMark(stateRoot),
    });
    writeFileSync(fourth, "ready", "utf8");
    await new Promise(() => { /* until killed */ });
    return 1;
  });
  process.exit(0);
}

if (role === "stop") {
  const result = await invoke(
    { command: "abort", stateRoot, anchorDay: null, operator: fourth, confirm: true, dryRun: false },
    {
      now: () => Date.now(),
      stampAt: stampFactory(berlinLocal),
      toLocal: berlinLocal,
      owner: currentLedgerLockOwner(),
      repoRoot: stateRoot,
      activationRoot: stateRoot,
      facts: null,
      envFile: path.join(stateRoot, ".env"),
      observe: () => { throw new Error("a stop takes no observation"); },
      actions: ports,
      print: () => undefined,
      readLedger: root => readActivationLedger(root),
    },
  );
  writeFileSync(path.join(stateRoot, "stop-result.json"), JSON.stringify({ outcome: result.outcome, applied: result.applied }, null, 2), "utf8");
  process.exit(0);
}

process.stderr.write(`unknown role ${String(role)}\n`);
process.exit(2);
