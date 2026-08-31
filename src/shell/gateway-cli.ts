// Process-level driver for the fencing and serialization tests: each
// invocation is one real OS process contending for the same STATE_DIR.
//   node gateway-cli.js <stateDir> <instanceId> takeover
//   node gateway-cli.js <stateDir> <instanceId> write <count>
//   node gateway-cli.js <stateDir> <instanceId> witness
// `takeover` prints the acquisition result. `write` acquires first (it must
// WIN, otherwise it exits 1) and appends <count> CYCLE lines under the epoch
// it won. `witness` appends one SUPPRESSED line without any authority.
// It prints one JSON result to stdout and exits non-zero on any failure.
import { readHolder } from "./epoch-store.js";
import { createMutationGateway, NO_BROKER_PORT } from "./mutation-gateway.js";
import { resolveStateDir } from "./state-dir.js";

const [stateDirArgument, instanceId, command, countArgument] = process.argv.slice(2);
if (stateDirArgument === undefined || instanceId === undefined || command === undefined) {
  process.stderr.write("usage: gateway-cli <stateDir> <instanceId> takeover | write <count> | witness\n");
  process.exit(2);
}
const paths = resolveStateDir(stateDirArgument);
if (!paths.ok) {
  process.stderr.write(`${paths.reason}: ${paths.detail}\n`);
  process.exit(2);
}
const gateway = createMutationGateway({ paths: paths.value, secrets: [], clock: () => Date.now(), brokerPort: NO_BROKER_PORT, instanceId, lockTakeoverBoundMs: 60_000 });

function emit(value: unknown, code: number): never {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(code);
}

if (command === "takeover") {
  emit(await gateway.acquireAuthority({ account: "unknown" }), 0);
}

if (command === "write") {
  const count = Number(countArgument);
  const acquired = await gateway.acquireAuthority({ account: "unknown" });
  if (acquired.kind !== "WON") emit({ acquired }, 1);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const result = await gateway.dispatch({
      class: "authoritative",
      epoch: acquired.epoch,
      action: {
        kind: "journal_append",
        entry: {
          at: new Date().toISOString(),
          epoch: acquired.epoch,
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
    if (!result.ok) emit({ acquired, results }, 1);
  }
  emit({ acquired, results }, 0);
}

if (command === "witness") {
  const holder = readHolder(paths.value);
  const result = await gateway.dispatch({
    class: "witness",
    action: {
      kind: "journal_append",
      entry: { at: new Date().toISOString(), epoch: null, type: "SUPPRESSED", instanceId, holderId: holder?.holderId ?? "", reason: "LOCK_HELD" },
    },
  });
  emit(result, result.ok ? 0 : 1);
}

process.stderr.write(`unknown command ${command}\n`);
process.exit(2);
