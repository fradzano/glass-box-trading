// Process-level driver for the fencing and serialization tests: each
// invocation is one real OS process contending for the same STATE_DIR.
//   node gateway-cli.js <stateDir> <instanceId> takeover
//   node gateway-cli.js <stateDir> <instanceId> append <count> <epoch>
// It prints one JSON result to stdout and exits non-zero on any failure.
import { createMutationGateway, NO_BROKER_PORT } from "./mutation-gateway.js";
import { resolveStateDir } from "./state-dir.js";

const [stateDirArgument, instanceId, command, countArgument, epochArgument] = process.argv.slice(2);
if (stateDirArgument === undefined || instanceId === undefined || command === undefined) {
  process.stderr.write("usage: gateway-cli <stateDir> <instanceId> takeover | append <count> <epoch>\n");
  process.exit(2);
}
const paths = resolveStateDir(stateDirArgument);
if (!paths.ok) {
  process.stderr.write(`${paths.reason}: ${paths.detail}\n`);
  process.exit(2);
}
const gateway = createMutationGateway({ paths: paths.value, secrets: [], clock: () => Date.now(), brokerPort: NO_BROKER_PORT, instanceId, lockTakeoverBoundMs: 60_000 });

if (command === "takeover") {
  const result = await gateway.acquireAuthority({ account: "unknown" });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}

if (command === "append") {
  const count = Number(countArgument);
  const epoch = Number(epochArgument);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const result = await gateway.dispatch({
      class: "authoritative",
      epoch,
      action: {
        kind: "journal_append",
        entry: {
          at: new Date().toISOString(),
          epoch,
          type: "CYCLE",
          cycleIndex: index,
          tradingDay: instanceId,
          reasonCodes: [],
          snapshot: { accountId: "TEST_ONLY_CLI_ACCOUNT", snapshotAt: new Date().toISOString(), cashCents: 0, equityCents: 0, positions: [], openOrders: [], quoteSamples: {} },
          batchVerdicts: [],
          candidateVerdicts: [],
        },
      },
    });
    results.push(result);
    if (!result.ok) {
      process.stdout.write(`${JSON.stringify(results)}\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`${JSON.stringify(results)}\n`);
  process.exit(0);
}

process.stderr.write(`unknown command ${command}\n`);
process.exit(2);
