// The S-ARM-01 entry point: `node dist/shell/certificate-cli.js --owner-go`.
// Externally stateful — it places real orders on the DEV paper account — so
// it refuses to start without the explicit flag, without ALPACA_PROFILE=dev,
// and outside market hours. The certificate lands under evidence/pre-arm/.
import { buildRuntime } from "./agent-runtime.js";
import { runCertificate } from "./certificate-run.js";

const args = process.argv.slice(2);
const preflight = args.includes("--preflight");
const smokeCycle = args.includes("--smoke-cycle");
if (!args.includes("--owner-go") && !preflight && !smokeCycle) {
  process.stderr.write("refusing: the dev live test starts only with an explicit owner go (--owner-go)\n");
  process.exit(2);
}
const log = (line: string): void => { process.stdout.write(`${new Date().toISOString()} ${line}\n`); };
const clock = (): number => Date.now();
const built = await buildRuntime({ repoRoot: process.cwd(), processEnv: process.env, clock, objective: "certificate", instanceId: `certificate-${String(process.pid)}`, log });
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
if (runtime.config.profile !== "dev") {
  process.stderr.write("refusing: the certificate run uses the dev account only\n");
  await runtime.shutdown();
  process.exit(2);
}
if (!runtime.session.isTradingDay || clock() < runtime.session.opensAt || clock() > runtime.session.closesAt) {
  process.stderr.write("refusing: outside the exchange session for today; the live test needs market hours\n");
  await runtime.shutdown();
  process.exit(2);
}
const minutes = (value: string | undefined, fallback: number): number => (value === undefined ? fallback : Number(value)) * 60_000;
try {
  const result = await runCertificate({
    runtime,
    repoRoot: process.cwd(),
    clock,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log,
    maxEntryCycles: Number(process.env["CERTIFICATE_MAX_ENTRY_CYCLES"] ?? "8"),
    entryIntervalMs: minutes(process.env["CERTIFICATE_ENTRY_INTERVAL_MIN"], 3),
    patienceCycles: Number(process.env["CERTIFICATE_PATIENCE_CYCLES"] ?? "3"),
    maxFlattenCycles: Number(process.env["CERTIFICATE_MAX_FLATTEN_CYCLES"] ?? "20"),
    flattenIntervalMs: minutes(process.env["CERTIFICATE_FLATTEN_INTERVAL_MIN"], 1),
  });
  process.stdout.write(`${JSON.stringify({ verdict: result.certificate.verdict, file: result.file, failures: result.certificate.failures }, null, 2)}\n`);
  await runtime.shutdown();
  process.exit(result.certificate.verdict === "PASS" ? 0 : 1);
} catch (error) {
  process.stderr.write(`certificate run aborted: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  await runtime.shutdown();
  process.exit(1);
}
