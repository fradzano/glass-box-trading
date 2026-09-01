// The S-ARM-01 entry point: `node dist/shell/certificate-cli.js --owner-go`.
// Externally stateful — it places real orders on the DEV paper account — so
// it refuses to start without the explicit flag, without ALPACA_PROFILE=dev,
// and outside market hours. The certificate lands under evidence/pre-arm/.
import { buildRuntime } from "./agent-runtime.js";
import { runCertificate } from "./certificate-run.js";
import { admitCertificateCommand, CERTIFICATE_RUN_LIMITS } from "./certificate-command-guard.js";
import { loadEnvironment } from "./runtime-config.js";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const preflight = args.includes("--preflight");
const smokeCycle = args.includes("--smoke-cycle");
const commandAdmission = admitCertificateCommand({
  profile: loadEnvironment(process.cwd(), process.env)["ALPACA_PROFILE"],
  ownerGo: args.includes("--owner-go"),
  preflight,
});
if (!commandAdmission.ok) {
  process.stderr.write(`refusing: ${commandAdmission.reason}\n`);
  process.exit(2);
}
const log = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };
const clock = (): number => Date.now();
let built: Awaited<ReturnType<typeof buildRuntime>>;
try {
  built = await buildRuntime({ repoRoot: process.cwd(), processEnv: process.env, clock, objective: "certificate", instanceId: `certificate-${String(process.pid)}`, log });
} catch (error) {
  process.stderr.write(`runtime construction failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
}
if (!built.ok) {
  process.stderr.write(`refused at ${built.stage}: ${built.reason}\n`);
  process.exit(1);
}
const runtime = built.runtime;
if (preflight) {
  // Everything up to the first order: validation, credentials, calendar, authority, the verified analyst child, both digests.
  process.stdout.write(`${JSON.stringify({ profile: runtime.config.profile, accountId: runtime.binding.accountId, tradingDay: runtime.tradingDay, session: runtime.session, expiries: runtime.window.expiries, mcpTools: runtime.mcpInventory.length, runtimeDigest: runtime.runtimeDigest, policyDigest: runtime.policyDigest, epoch: runtime.epoch }, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(0);
}
if (smokeCycle) {
  // One real cycle with no order possible: outside the session G6 vetoes every action; inside it this is the owner's call, not a smoke test.
  if (runtime.session.isTradingDay && clock() >= runtime.session.opensAt && clock() <= runtime.session.closesAt) {
    process.stderr.write("refusing: --smoke-cycle runs only outside the session (inside it a cycle can place orders)\n");
    await runtime.shutdown();
    process.exit(2);
  }
  const report = await runtime.cycle(1);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(0);
}
if (!runtime.session.isTradingDay || clock() < runtime.session.opensAt || clock() > runtime.session.closesAt) {
  process.stderr.write("refusing: outside the exchange session for today; the live test needs market hours\n");
  await runtime.shutdown();
  process.exit(2);
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
      const token = `CLEAR-HALT ${String(facts.haltSeq)}`;
      process.stdout.write(`Fence reconciliation is stably flat after HTTP ${String(facts.httpStatus)}. Working orders: ${facts.workingOrders.join(",") || "none"}; confirmed canceled: ${facts.canceledOrders.join(",") || "none"}.\n`);
      const readline = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await readline.question(`Human checkpoint: type exactly '${token}' to clear this AUTH_FAILURE halt: `, { signal });
        if (answer.trim() !== token) return null;
        return { operator: process.env["USERNAME"] ?? "owner", reason: `human confirmed stable flat fence reconciliation for AUTH_FAILURE halt seq ${String(facts.haltSeq)}` };
      } finally {
        readline.close();
      }
    },
  });
  process.stdout.write(`${JSON.stringify({ verdict: result.certificate.verdict, file: result.file, failures: result.certificate.failures }, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(result.certificate.verdict === "PASS" ? 0 : 1);
} catch (error) {
  process.stderr.write(`certificate run aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await runtime.shutdown();
  process.exit(1);
}
