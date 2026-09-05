// One scheduled invocation of the agent: `node dist/shell/agent-cli.js`.
// The scheduler (CONCEPT §3: a Windows Scheduled Task every CYCLE_INTERVAL
// during the session) starts this process; it validates, acquires authority,
// runs exactly one cycle, prints the report, and exits. Overlap is handled by
// the P2 gateway's fencing, not by this file. Competition arming additionally
// requires the S-ARM-01 certificate (S-CYC-11); this entry never bypasses it.
import { buildRuntime } from "./agent-runtime.js";
import { agentBuildRefusalChannel, agentCliExitCode } from "./cli-exit-codes.js";
import { createPingPort } from "./ping-healthchecks.js";
import { loadEnvironment } from "./runtime-config.js";

const log = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };
const clock = (): number => Date.now();
const built = await buildRuntime({ repoRoot: process.cwd(), processEnv: process.env, clock, objective: "competition", instanceId: `agent-${String(process.pid)}`, log });
if (!built.ok) {
  const channel = agentBuildRefusalChannel(built.stage);
  (channel.stream === "stdout" ? process.stdout : process.stderr).write(`${channel.prefix} at ${built.stage}: ${built.reason}\n`);
  // R43-B6: a refusal before the runtime exists still has to reach the
  // operator as a NAMED readiness condition. It used to send nothing at all —
  // an analyst manifest that had gone missing durably journaled its
  // CONFIG_INVALID halt and the readiness endpoint saw zero requests, leaving
  // only the wrapper's generic non-zero exit, which is liveness and not the
  // same claim. S-G14-03 permits a failure-only ping before any journal
  // exists, and this is exactly the S-CYC-11 case it names.
  // R44-B7: exactly one readiness signal per invocation. The startup
  // validator sends its own CONFIG_INVALID failure before returning, and this
  // used to add a second POST under a different name for the same refusal —
  // two alerts, one incident, and a check that flaps twice.
  if (!(built.startup?.failurePinged ?? false)) {
    try {
      const env = loadEnvironment(process.cwd(), process.env);
      const ping = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: null, clock, timeoutMs: 10_000 });
      await ping.fail([`STARTUP_REFUSED:${built.stage}`, built.reason]);
    } catch {
      // Best effort: the exit code and the printed reason carry it regardless.
    }
  }
  process.exit(agentCliExitCode({ kind: "build_refused", stage: built.stage }));
}
const runtime = built.runtime;
try {
  const entries = (await runtime.gateway.openJournal()).entries;
  const cycleIndex = entries.filter(entry => entry.type === "CYCLE" || entry.type === "BOOTSTRAP" || entry.type === "GAP" || entry.type === "SKIP").length + 1;
  const report = await runtime.cycle(cycleIndex);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await runtime.shutdown();
  process.exit(agentCliExitCode({ kind: "cycle_finished", journalFailed: report.journalFailure !== null }));
} catch (error) {
  process.stderr.write(`cycle aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  // Same duty on the abort path: the cycle never reached its own ping plan.
  try {
    await runtime.ping.fail(["CYCLE_ABORTED", error instanceof Error ? error.message : String(error)]);
  } catch {
    // Best effort.
  }
  await runtime.shutdown();
  process.exit(agentCliExitCode({ kind: "cycle_aborted" }));
}
