// Process-level entry point for the S-G14 tests: the watchdog as its own OS
// process over the same STATE_DIR and epoch store as the writer it may fence.
//   node watchdog-cli.js <stateDir> <instanceId> <nowMs> <opensAtMs> <closesAtMs> <deadManBoundMs>
// It assesses journal staleness, fences via the shared epoch store when
// stale, appends the WATCHDOG_TAKEOVER halt, and prints one JSON report.
// The broker-facing recovery runs in-process tests; this entry proves the
// process seam: same store, same gateway, no bypass.
import { runWatchdog } from "./watchdog.js";
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
const now = Number(nowArgument);
const report = await runWatchdog({
  paths: paths.value,
  secrets: [],
  clock: () => now,
  instanceId,
  lockTakeoverBoundMs: 60_000,
  deadManBoundMs: Number(boundArgument),
  closeEscalationStepCents: 1,
  session: { isTradingDay: true, opensAt: Number(opensArgument), closesAt: Number(closesArgument) },
  binding: null,
  broker: null,
  market: null,
  profile: "dev",
  calendar: { isTradingDay: true, opensAt: Number(opensArgument), closesAt: Number(closesArgument) },
  tradingDay: "cli",
  ping: null,
});
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(0);
