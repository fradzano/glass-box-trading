// The S-ARM-01 entry point: `node dist/shell/certificate-cli.js --owner-go`.
// Externally stateful — it places real orders on the DEV paper account — so
// it refuses to start without the explicit flag, without ALPACA_PROFILE=dev,
// and outside market hours. The certificate lands under evidence/pre-arm/.
import { buildRuntime } from "./agent-runtime.js";
import { runCertificate } from "./certificate-run.js";
import { admitCertificateInvocation } from "./certificate-admission.js";
import { CERTIFICATE_RUN_LIMITS } from "./certificate-command-guard.js";
import { certificateCliExitCode } from "./cli-exit-codes.js";
import { isInsideSession } from "../core/session-window.js";
import { fenceUnhaltApproval, fenceUnhaltToken } from "../core/fence-unhalt.js";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const preflight = args.includes("--preflight");
const smokeCycle = args.includes("--smoke-cycle");
const { admission: commandAdmission, environment } = admitCertificateInvocation({ repoRoot: process.cwd(), processEnv: process.env, args, platform: process.platform });
if (!commandAdmission.ok) {
  process.stderr.write(`refusing: ${commandAdmission.reason}\n`);
  process.exit(certificateCliExitCode({ kind: "command_refused" }));
}
const log = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };
const clock = (): number => Date.now();
let built: Awaited<ReturnType<typeof buildRuntime>>;
try {
  built = await buildRuntime({ repoRoot: process.cwd(), processEnv: process.env, environment, clock, objective: "certificate", instanceId: `certificate-${String(process.pid)}`, log });
} catch (error) {
  process.stderr.write(`runtime construction failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(certificateCliExitCode({ kind: "runtime_construction_failed" }));
}
if (!built.ok) {
  // By S-G12-01 this stays 1 even for `suppressed`: the owner asked for a run that did not happen.
  process.stderr.write(`refused at ${built.stage}: ${built.reason}\n`);
  process.exit(certificateCliExitCode({ kind: "build_refused", stage: built.stage }));
}
const runtime = built.runtime;
if (preflight) {
  // Everything up to the first order: validation, credentials, calendar, authority, the verified analyst child, both digests.
  process.stdout.write(`${JSON.stringify({ profile: runtime.config.profile, accountId: runtime.binding.accountId, tradingDay: runtime.tradingDay, session: runtime.session, expiries: runtime.window.expiries, mcpTools: runtime.mcpInventory.length, runtimeDigest: runtime.runtimeDigest, policyDigest: runtime.policyDigest, epoch: runtime.epoch }, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(certificateCliExitCode({ kind: "preflight_reported" }));
}
if (smokeCycle) {
  // One real cycle with no order possible: outside the session G6 vetoes every action; inside it this is the owner's call, not a smoke test.
  if (isInsideSession(clock(), runtime.session)) {
    process.stderr.write("refusing: --smoke-cycle runs only outside the session (inside it a cycle can place orders)\n");
    await runtime.shutdown();
    process.exit(certificateCliExitCode({ kind: "smoke_cycle_inside_session" }));
  }
  const report = await runtime.cycle(1);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(certificateCliExitCode({ kind: "smoke_cycle_finished" }));
}
if (!isInsideSession(clock(), runtime.session)) {
  process.stderr.write("refusing: outside the exchange session for today; the live test needs market hours\n");
  await runtime.shutdown();
  process.exit(certificateCliExitCode({ kind: "outside_session" }));
}
try {
  const result = await runCertificate({
    runtime,
    repoRoot: process.cwd(),
    clock,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log,
    ...CERTIFICATE_RUN_LIMITS,
    approveFenceUnhalt: async (facts, signal) => {
      process.stdout.write(`Fence reconciliation is stably flat after HTTP ${String(facts.httpStatus)}. Working orders: ${facts.workingOrders.join(",") || "none"}; confirmed canceled: ${facts.canceledOrders.join(",") || "none"}.\n`);
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await readline.question(`Human checkpoint: type exactly '${fenceUnhaltToken(facts.haltSeq)}' to clear this AUTH_FAILURE halt: `, { signal });
        return fenceUnhaltApproval(answer, facts.haltSeq, process.env["USERNAME"] ?? "owner");
      } finally {
        readline.close();
      }
    },
  });
  process.stdout.write(`${JSON.stringify({ verdict: result.certificate.verdict, file: result.file, failures: result.certificate.failures }, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(certificateCliExitCode({ kind: "certificate_finished", verdict: result.certificate.verdict }));
} catch (error) {
  process.stderr.write(`certificate run aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await runtime.shutdown();
  process.exit(certificateCliExitCode({ kind: "run_aborted" }));
}
