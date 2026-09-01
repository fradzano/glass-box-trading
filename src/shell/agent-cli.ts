// One scheduled invocation of the agent: `node dist/shell/agent-cli.js`.
// The scheduler (CONCEPT §3: a Windows Scheduled Task every CYCLE_INTERVAL
// during the session) starts this process; it validates, acquires authority,
// runs exactly one cycle, prints the report, and exits. Overlap is handled by
// the P2 gateway's fencing, not by this file. Competition arming additionally
// requires the S-ARM-01 certificate (S-CYC-11); this entry never bypasses it.
import { buildRuntime } from "./agent-runtime.js";

const log = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };
const clock = (): number => Date.now();
const built = await buildRuntime({ repoRoot: process.cwd(), processEnv: process.env, clock, objective: "competition", instanceId: `agent-${String(process.pid)}`, log });
if (!built.ok) {
  const suppressed = built.stage === "suppressed";
  (suppressed ? process.stdout : process.stderr).write(`${suppressed ? "suppressed" : "refused"} at ${built.stage}: ${built.reason}\n`);
  process.exit(suppressed ? 0 : 1);
}
const runtime = built.runtime;
try {
  const entries = (await runtime.gateway.openJournal()).entries;
  const cycleIndex = entries.filter(entry => entry.type === "CYCLE" || entry.type === "BOOTSTRAP" || entry.type === "GAP" || entry.type === "SKIP").length + 1;
  const report = await runtime.cycle(cycleIndex);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await runtime.shutdown();
  process.exit(report.journalFailure === null ? 0 : 1);
} catch (error) {
  process.stderr.write(`cycle aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await runtime.shutdown();
  process.exit(1);
}
