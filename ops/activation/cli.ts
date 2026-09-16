// `activation` — the CLI of the activation script (unit 10).
//
//   node ops/activation/cli.ts status  --state-root <activation root>
//   node ops/activation/cli.ts run     --state-root <root> --anchor-day <YYYY-MM-DD> [--dry-run]
//   node ops/activation/cli.ts open    --state-root <root> --anchor-day <YYYY-MM-DD> --operator <name>
//   node ops/activation/cli.ts abort   --confirm --state-root <root> --operator <name> [--dry-run]
//   node ops/activation/cli.ts disarm  --state-root <root> --anchor-day <YYYY-MM-DD> [--dry-run]
//
// This file is the thin I/O around `cli/invoke.ts`, in the same shape as
// `confirm-alerts.ts`: it builds the clock, the process identity, the readers and the
// deployment facts, hands them over, prints what came back and sets the exit code.
//
// The disarm one-shot is registered with exactly the argument vector above, and
// `disarmFindings` compares it by value (spec §6). Changing the spelling of a flag here
// changes what the core expects to find on the host.
//
// Exit codes: 0 nothing wrong; 1 the attempt ended; 2 the invocation refused to start;
// 3 the ledger itself is unreliable; 4 the invocation failed part way through.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { parseInvocation } from "./cli/args.ts";
import { parseDeploymentFacts } from "./cli/deployment.ts";
import { stampFactory } from "./cli/schedule.ts";
import { invoke } from "./cli/invoke.ts";
import type { InvocationDeps } from "./cli/invoke.ts";
import { exitCodeFor, pages } from "./cli/plan.ts";
import { outcomeLines, statusLines } from "./cli/report.ts";
import { createHostPorts } from "./readers/host-ports.ts";
import { readObservations } from "./readers/observe.ts";
import type { ObservationPlan } from "./readers/observe.ts";
import { berlinLocal } from "./readers/parse.ts";
import { currentLedgerLockOwner, readActivationLedger } from "./store/ledger-store.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DEPLOYMENT_FILE = path.join(REPO_ROOT, "ops", "activation", "deployment.json");
const TASK_PATH = "\\GlassBoxTrading\\";
const CANONICAL_TRADING_ORIGIN = "https://paper-api.alpaca.markets";
const LONG_RUN_STATE_DIR = path.join(path.dirname(path.dirname(REPO_ROOT)), "glass-box-state", "longrun-1");

async function main(): Promise<number> {
  const parsed = parseInvocation(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`refusing: ${parsed.reason}\n`);
    return 2;
  }
  const invocation = parsed.invocation;
  const activationRoot = path.resolve(invocation.stateRoot);

  let deploymentText: string;
  try {
    deploymentText = await readFile(DEPLOYMENT_FILE, "utf8");
  } catch {
    process.stderr.write(`refusing: ${DEPLOYMENT_FILE} could not be read. Copy deployment.example.json and fill it from this host.\n`);
    return 2;
  }
  const deployment = parseDeploymentFacts(deploymentText, REPO_ROOT, activationRoot);
  if (!deployment.ok) {
    process.stderr.write(`refusing: ${DEPLOYMENT_FILE}: ${deployment.reason}\n`);
    return 2;
  }

  const observe = async (plan: ObservationPlan) => {
    const ports = await createHostPorts({
      repoRoot: REPO_ROOT,
      activationRoot,
      taskPath: TASK_PATH,
      canonicalTradingOrigin: CANONICAL_TRADING_ORIGIN,
      devStateDir: path.join(path.dirname(LONG_RUN_STATE_DIR), "dev"),
      devDiagnosticSink: path.join(path.dirname(LONG_RUN_STATE_DIR), "dev", "diagnostics"),
    });
    return readObservations(ports, {
      repoRoot: REPO_ROOT,
      activationRoot,
      longRunStateDir: LONG_RUN_STATE_DIR,
      taskNames: { cycle: "GlassBoxTrading-AgentCycle", watchdog: "GlassBoxTrading-Watchdog", disarm: "GlassBoxTrading-Disarm" },
      canonicalTradingOrigin: CANONICAL_TRADING_ORIGIN,
    }, plan);
  };

  const deps: InvocationDeps = {
    now: () => Date.now(),
    stampAt: stampFactory(berlinLocal),
    toLocal: berlinLocal,
    owner: currentLedgerLockOwner(),
    facts: deployment.facts,
    envFile: path.join(REPO_ROOT, ".env"),
    observe,
    // Unit 8 left the concrete host bindings to unit 13 (DECISIONS, 2026-09-14). Until
    // they exist the CLI reads, decides and records, and refuses to claim any action it
    // cannot perform — it never reports an unbound action as applied.
    actions: null,
    print: line => process.stdout.write(`${line}\n`),
    readLedger: root => readActivationLedger(root),
  };

  const result = await invoke(invocation, deps);
  if (result.fold !== null && invocation.command === "status") {
    for (const line of statusLines(result.fold, result.schedule)) process.stdout.write(`${line}\n`);
  }
  const lines = outcomeLines(result.outcome);
  const sink = pages(result.outcome) || result.outcome.kind === "refused" ? process.stderr : process.stdout;
  for (const line of lines) sink.write(`${line}\n`);
  if (pages(result.outcome)) {
    // D-10.1 is open: the spec says "page" and does not say through what. Until the
    // owner decides on a channel, the page is this line and the ledger's
    // `next_owner_action` — loud, credential-free, and never silently swallowed.
    process.stderr.write("PAGE: the activation needs the owner. The reason is above and in the ledger's next_owner_action.\n");
  }
  return exitCodeFor(result.outcome);
}

process.exitCode = await main();
