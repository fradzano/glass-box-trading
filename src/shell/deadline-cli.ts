// The S-G11-03/04 entry point — the two Friday entries as their own one-shot
// OS process over the configured STATE_DIR and the shared epoch store:
//   node dist/shell/deadline-cli.js reconciliation --revision <journal revision id> [--now <ms>]
//   node dist/shell/deadline-cli.js terminal [--now <ms>]
// `--now` is a test and rehearsal seam; without it the real clock is injected
// at this boundary and nowhere else. The STATE_DIR is never a command-line
// argument: it comes from the validated §0 configuration, so this process
// cannot write a Friday entry into a deployment it was not configured for.
//
// One JSON line on stdout, every diagnostic on stderr, and exit 0 only when
// the entry actually landed in the journal. A TERMINAL that reports a
// risk-bearing remainder is a success of this process, not a failure: the
// remainder is the content of the entry the owner is handed in writing
// (S-G11-04), and the fail-ping is what raises it. Exit codes are
// distinguishable on purpose: 2 usage, 3 a live writer, 4 a TERMINAL that
// already stands, 1 everything else. That table is pure and lives in
// `cli-exit-codes.ts` next to the other two entry points' tables, because
// S-G12-01 defines them against each other.
import { deadlineCliExitCode } from "./cli-exit-codes.js";
import { admitDeadlineEntry, composeDeadline, parseDeadlineCommand } from "./deadline-runtime.js";
import { DEADLINE_ENTRY_NOT_JOURNALED, runDeadlineReconciliation, runTerminal } from "./deadline.js";

const parsed = parseDeadlineCommand(process.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(`refusing: ${parsed.reason}\n`);
  process.exit(deadlineCliExitCode({ kind: "usage_refused" }));
}
const fixedNowMs = parsed.nowMs;
const clock = fixedNowMs === null ? (): number => Date.now() : (): number => fixedNowMs;
const composed = await composeDeadline({
  repoRoot: process.cwd(),
  processEnv: process.env,
  clock,
  instanceId: `deadline-${String(process.pid)}`,
  log: line => process.stderr.write(`${line}\n`),
});
if (!composed.ok) {
  process.stderr.write(`refused at ${composed.stage}: ${composed.reason}\n`);
  process.exit(deadlineCliExitCode({ kind: "composition_refused", stage: composed.stage }));
}
const admission = admitDeadlineEntry(parsed.command, composed.entries);
if (!admission.ok) {
  await composed.release();
  process.stderr.write(`refusing: ${admission.reason}\n`);
  process.exit(deadlineCliExitCode({ kind: "entry_already_stands" }));
}
try {
  const report = parsed.command === "reconciliation"
    ? await runDeadlineReconciliation(composed.deps, parsed.revision)
    : await runTerminal(composed.deps);
  process.stdout.write(`${JSON.stringify({
    command: parsed.command,
    acquired: composed.acquired,
    epoch: composed.epoch,
    stateDir: composed.paths.root,
    profile: composed.profile,
    tradingDay: composed.deps.tradingDay,
    cycleIndex: composed.deps.cycleIndex,
    ...report,
  })}\n`);
  await composed.release();
  process.exit(deadlineCliExitCode({ kind: "entry_finished", appended: report.appended }));
} catch (error) {
  // A broker read or a journal read that throws is the third way an entry can
  // fail to exist. `deadline.ts` raises the fail-signal for the two it can
  // see; this one only surfaces here, and it may not be quieter than those.
  const detail = error instanceof Error ? error.message : String(error);
  try {
    await composed.deps.ping?.fail([`${DEADLINE_ENTRY_NOT_JOURNALED}:ENTRY_ABORTED:${detail}`]);
  } catch {
    // Delivery is best effort; stderr and the exit code carry it regardless.
  }
  await composed.release();
  process.stderr.write(`deadline entry aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(deadlineCliExitCode({ kind: "entry_aborted" }));
}
