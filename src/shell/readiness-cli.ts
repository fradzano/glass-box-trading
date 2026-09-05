// Report trading readiness without running a cycle:
// `node dist/shell/readiness-cli.js`.
//
// S-G14-05 / R43-B8. The cycle wrapper fires across a padded trigger window and
// skips outside the exchange session, so readiness used to be reported only on
// the firings that actually ran a cycle — a set whose local times move by an
// hour in the week between the European and American clock changes. Any single
// expected-ping schedule for that set is therefore wrong for part of the run,
// and the one first written into the runbook produced false alarms at both ends
// of every day.
//
// This makes readiness as regular as liveness: every firing reports, whether or
// not a cycle ran. It runs no cycle, reaches no broker and appends nothing — it
// reads the standing impediment and the durability of the state directory, and
// pings. A halt at three in the morning is then worth knowing before the open
// rather than after it.
//
// What the two signals claim, kept apart on purpose (A31):
//   liveness  — the scheduled invocation happened at all.
//   readiness — no impediment stands. Market-closed is not an impediment; a
//               halt, an unreleased credential fence and a state directory that
//               cannot be written are.
import { standingImpediment } from "./halt-state.js";
import { probeStateDurability, resolveStateDir } from "./state-dir.js";
import { loadEnvironment } from "./runtime-config.js";
import { createPingPort } from "./ping-healthchecks.js";

const env = loadEnvironment(process.cwd(), process.env);
const paths = resolveStateDir(env["STATE_DIR"] ?? "");
if (!paths.ok) {
  process.stderr.write(`readiness: STATE_DIR is unusable: ${paths.detail}\n`);
  process.exit(2);
}

const standing = standingImpediment(paths.value);
const durability = probeStateDurability(paths.value);
const conditions = [
  ...(standing === null ? [] : [`HALT_STANDING:${standing.reason}`, ...(standing.fencePending ? ["CREDENTIAL_FENCE_UNRELEASED"] : [])]),
  ...(durability.ok ? [] : [`STATE_NOT_DURABLE:${durability.reason}`]),
];

const ping = createPingPort({ url: env["HEALTHCHECK_PING_URL"] ?? null, recordFile: null, clock: () => Date.now(), timeoutMs: 10_000 });
try {
  if (conditions.length > 0) {
    await ping.fail(conditions);
    process.stdout.write(`readiness: fail (${conditions.join(", ")})\n`);
  } else {
    // Success here says only "no impediment stands", which is what this process
    // is able to observe. S-G14-03's append precondition governs a CYCLE's
    // success — a cycle that could not journal may not claim all-clear — and
    // that rule is enforced where it belongs, in planPing's
    // `durableAppendLanded`. This process runs no cycle and claims no liveness.
    await ping.success();
    process.stdout.write("readiness: success (no halt, no fence, state writable)\n");
  }
} catch (error) {
  process.stderr.write(`readiness: signal undelivered: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
process.exit(0);
