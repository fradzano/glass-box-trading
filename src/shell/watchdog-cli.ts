// Process-level entry point for the S-G14 tests and for the scheduled
// watchdog: the watchdog as its own OS process over the same STATE_DIR and
// epoch store as the writer it may fence.
//   node watchdog-cli.js <stateDir> <instanceId> <nowMs> <opensAtMs> <closesAtMs> <deadManBoundMs>
// It assesses journal staleness, fences via the shared epoch store when
// stale, appends the WATCHDOG_TAKEOVER halt, recovers the open book through
// the composed broker and market ports (src/shell/watchdog-runtime.ts), and
// prints one JSON report on stdout. Everything else — the composition log, a
// degraded composition, a failed run — goes to stderr, so stdout stays a
// single machine-readable line. A configuration, credential or binding
// problem is fail-closed, not fatal: the composition degrades to the
// fence-and-halt-only ports and this process still fences, halts and pings.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWatchdog } from "./watchdog.js";
import { composeWatchdog } from "./watchdog-runtime.js";
import { parseWatchdogCliNumbers } from "./watchdog-cli-args.js";
import { resolveStateDir } from "./state-dir.js";

const [stateDirArgument, instanceId, nowArgument, opensArgument, closesArgument, boundArgument] = process.argv.slice(2);
if (stateDirArgument === undefined || instanceId === undefined || nowArgument === undefined || opensArgument === undefined || closesArgument === undefined || boundArgument === undefined) {
  process.stderr.write("usage: watchdog-cli <stateDir> <instanceId> <nowMs> <opensAtMs> <closesAtMs> <deadManBoundMs>\n");
  process.exit(2);
}
const paths = resolveStateDir(stateDirArgument);
if (!paths.ok) {
  process.stderr.write(`${paths.reason}: ${paths.detail}\n`);
  process.exit(2);
}
const numeric = parseWatchdogCliNumbers(nowArgument, opensArgument, closesArgument, boundArgument);
if (!numeric.ok) {
  process.stderr.write(`${numeric.reason}: numeric times must be safe integers, opensAtMs must precede closesAtMs, and deadManBoundMs must be positive\n`);
  process.exit(2);
}
const { now, opensAt, closesAt, deadManBoundMs } = numeric.value;
// The checkout this entry point was launched from, not the process working
// directory: a scheduled task's working directory is not a promise.
// dist/shell/watchdog-cli.js -> dist -> the repository root.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const composition = await composeWatchdog({
  paths: paths.value,
  repoRoot,
  processEnv: process.env,
  clock: () => now,
  instanceId,
  // The wrapper-supplied window is a fallback for a composition that cannot reach the
  // exchange. A live composition replaces it with Alpaca's actual calendar session.
  session: { isTradingDay: true, opensAt, closesAt },
  deadManBoundMs,
  log: line => process.stderr.write(`${line}\n`),
});
try {
  const report = await runWatchdog(composition.deps);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (composition.preRunFailure !== null) {
    process.stderr.write(`watchdog composition failed (${composition.preRunFailure}); the durable credential fence and takeover halt stand\n`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  // The takeover halt is already durable when the recovery branch throws; the
  // credential fence adds the S-G12-06 distinction and the alert.
  const classification = await composition.recordCredentialFence(error);
  process.stderr.write(`watchdog run failed (${classification}): ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
