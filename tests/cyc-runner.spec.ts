// The cycle runner against the real P2 gateway in a temporary STATE_DIR and
// the deterministic fake broker: S-CYC-01/02/04/05/06, S-G13-01/03 and
// S-X-03/04 as executed shell behaviour. Every broker mutation the fake sees
// has passed the gateway; every journal line is read back from the file.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integerUnit } from "../src/core/domain.js";
import type { DecisionSnapshot } from "../src/core/domain.js";
import { epochMsToUtcIso } from "../src/core/execution.js";
import type { MarketObservation } from "../src/core/execution.js";
import { parseJournalText } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { closeAttemptId, closeLifecycleId } from "../src/core/order-identity.js";
import { runCycle } from "../src/shell/cycle-runner.js";
import type { CycleDependencies, CycleReport } from "../src/shell/cycle-runner.js";
import { readEpochStore } from "../src/shell/epoch-store.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import type { FakeBroker, FakeBrokerOptions } from "../src/shell/fake-broker.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import type { MutationGateway } from "../src/shell/mutation-gateway.js";
import { resolveStateDir } from "../src/shell/state-dir.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { LONG_CALL, SHORT_CALL, TEST_ONLY_EXECUTION_CONFIG, creditVertical } from "./execution-fixtures.js";
import { TEST_ONLY_O5_CONFIG } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN, journalSnapshot } from "./journal-fixtures.js";

const temporaryDirectories: string[] = [];
const journalsToUnlock: string[] = [];
afterEach(() => {
  for (const file of journalsToUnlock.splice(0)) { try { chmodSync(file, 0o666); } catch { /* already writable or gone */ } }
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;
const NOW = TEST_ONLY_AT_MS + 60_000;
const CANDIDATE_JSON = JSON.stringify({ candidates: [creditVertical()] });
const FAR_CALL = "SPY260904C00510000";
/** A second, distinct structure (505/510 credit vertical) so one cycle can approve two plans. */
const SECOND_CANDIDATE = creditVertical({
  candidateId: "candidate-second-vertical",
  rationale: "SPY vertical_credit call spread 505/510 sells a second slice of income drift.",
  legs: [
    { ...creditVertical().legs[1]!, side: "sell" },
    { ...creditVertical().legs[1]!, contractId: FAR_CALL, strikeCents: integerUnit(51_000, "StrikeCents"), side: "buy" },
  ],
});
const TWO_CANDIDATES_JSON = JSON.stringify({ candidates: [creditVertical(), SECOND_CANDIDATE] });

function freshPaths(): StatePaths {
  const directory = mkdtempSync(path.join(tmpdir(), "gbt-p3-"));
  temporaryDirectories.push(directory);
  const paths = resolveStateDir(directory);
  if (!paths.ok) throw new Error(paths.reason);
  return paths.value;
}

function entriesOf(paths: StatePaths): readonly JournalEntry[] {
  return existsSync(paths.journal) ? parseJournalText(readFileSync(paths.journal, "utf8")).entries : [];
}

function types(paths: StatePaths): readonly string[] {
  return entriesOf(paths).map(entry => (entry["action"] === "close" ? "INTENT(close)" : entry.type));
}

function marketNow(clock: () => number): () => Promise<MarketObservation> {
  return () => Promise.resolve({
    quotesByContract: {
      [SHORT_CALL]: { bidCents: 300, askCents: 302, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      [LONG_CALL]: { bidCents: 100, askCents: 102, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
      [FAR_CALL]: { bidCents: 50, askCents: 52, bidSize: 20, askSize: 20, quotedAtMs: clock(), brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
    },
    contractsById: {
      [SHORT_CALL]: { contractId: SHORT_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call" },
      [LONG_CALL]: { contractId: LONG_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_500, right: "call" },
      [FAR_CALL]: { contractId: FAR_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 51_000, right: "call" },
    },
    spotCentsByUnderlying: { SPY: 50_000, QQQ: 60_000 },
  });
}

const calendar: DecisionSnapshot["calendar"] = {
  isTradingDay: true,
  opensAt: integerUnit(NOW - 3_600_000, "EpochMilliseconds"),
  closesAt: integerUnit(NOW + 3_600_000, "EpochMilliseconds"),
};

interface Harness {
  readonly paths: StatePaths;
  readonly gateway: MutationGateway;
  readonly fake: FakeBroker;
  readonly clock: { now: number };
  cycle(overrides?: Partial<CycleDependencies> & { readonly cycleIndex?: number }): Promise<CycleReport>;
  readonly analystCalls: { count: number };
}

async function harness(options: { readonly broker?: Partial<FakeBrokerOptions>; readonly analyst?: CycleDependencies["analyst"]; readonly seedEntries?: readonly Record<string, unknown>[] } = {}): Promise<Harness> {
  const paths = freshPaths();
  const clock = { now: NOW };
  const fake = createFakeBroker({ accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 10_000_000, equityCents: 10_000_000, clock: () => clock.now, ...options.broker });
  const gateway = createMutationGateway({ paths, secrets: ["TEST_ONLY_SECRET_KEY"], clock: () => clock.now, brokerPort: fake.port, instanceId: "runner", lockTakeoverBoundMs: 60_000, binding: BINDING });
  const acquired = await gateway.acquireAuthority({ account: "virgin" });
  if (acquired.kind !== "WON") throw new Error(`fixture acquisition failed: ${JSON.stringify(acquired)}`);
  const priorSample = { bidCents: 99, askCents: 101, bidSize: 20, askSize: 20, quotedAt: TEST_ONLY_AT, brokerQuotedAt: "2026-08-31T13:29:59.871234567Z" };
  const bootstrap = { at: TEST_ONLY_AT, epoch: 1, type: "BOOTSTRAP", snapshot: journalSnapshot({ quoteSamples: { SPY: { [SHORT_CALL]: priorSample, [LONG_CALL]: priorSample, [FAR_CALL]: { ...priorSample, bidCents: 49, askCents: 51 } } } }), epochSeeded: true };
  for (const draft of [bootstrap, ...(options.seedEntries ?? [])]) {
    const result = await gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: draft } });
    if (!result.ok) throw new Error(`fixture seed append failed: ${result.reason} for ${JSON.stringify(draft)}`);
  }
  const analystCalls = { count: 0 };
  const analyst: CycleDependencies["analyst"] = options.analyst ?? (() => Promise.resolve(CANDIDATE_JSON));
  let cycleIndex = 1;
  return {
    paths, gateway, fake, clock, analystCalls,
    cycle: overrides => {
      const index = overrides?.cycleIndex ?? cycleIndex++;
      return runCycle({
        gateway, epoch: 1, paths, binding: BINDING, broker: fake.read, market: marketNow(() => clock.now),
        analyst: input => { analystCalls.count += 1; return (overrides?.analyst ?? analyst)(input); },
        analystTimeoutMs: 200, clock: () => clock.now, calendar, tradingDay: "2026-08-31", profile: "dev",
        decisionConfig: TEST_ONLY_O5_CONFIG, executionConfig: TEST_ONLY_EXECUTION_CONFIG,
        ...overrides,
        cycleIndex: index,
      });
    },
  };
}

function lockJournal(paths: StatePaths): void {
  if (!existsSync(paths.journal)) writeFileSync(paths.journal, "", "utf8");
  chmodSync(paths.journal, 0o444);
  journalsToUnlock.push(paths.journal);
}

function unlockJournal(paths: StatePaths): void {
  chmodSync(paths.journal, 0o666);
}

describe("S-CYC-01 analyst failure is management-only, never a retry or a relaunch", () => {
  it("S-CYC-01 an analyst error and an analyst timeout each leave a CYCLE with ANALYST_SKIP, zero candidates, zero orders, and exactly one analyst invocation", async () => {
    const failing = await harness({ analyst: () => Promise.reject(new Error("analyst HTTP 429 TEST_ONLY_SECRET_KEY")) });
    const report = await failing.cycle();
    expect(report).toMatchObject({ primary: "CYCLE", analystSkip: expect.stringContaining("429"), actions: [] });
    expect(failing.analystCalls.count).toBe(1);
    const entries = entriesOf(failing.paths);
    expect(types(failing.paths)).toEqual(["BOOTSTRAP", "CYCLE"]);
    const cycle = entries[1]!;
    expect(cycle["batchVerdicts"]).toEqual([{ code: "ANALYST_SKIP", reason: expect.stringContaining("[REDACTED]") }]);
    expect(cycle["candidateVerdicts"]).toEqual([]);
    expect(JSON.stringify(entries)).not.toContain("TEST_ONLY_SECRET_KEY");
    expect(failing.fake.mutations).toHaveLength(0);

    const hanging = await harness({ analyst: () => new Promise<string>(() => { /* never resolves */ }) });
    const timedOut = await hanging.cycle();
    expect(timedOut).toMatchObject({ primary: "CYCLE", analystSkip: expect.stringContaining("timeout"), actions: [] });
    expect(hanging.analystCalls.count).toBe(1);
    expect(types(hanging.paths)).toEqual(["BOOTSTRAP", "CYCLE"]);
    // The snapshot phase ran: the CYCLE carries the account summary and quote samples for the next cycle's history.
    expect((entriesOf(hanging.paths)[1]!["snapshot"] as { quoteSamples: Record<string, unknown> }).quoteSamples).toHaveProperty("SPY");
  });
});

describe("S-CYC-02 a half-answering broker produces abstention", () => {
  it("S-CYC-02 positions OK but orders failing → SKIP WORLD_PARTIAL with no snapshot, no analyst call, no order; everything failing → WORLD_UNREACHABLE", async () => {
    const partial = await harness();
    partial.fake.failNextReads(["orders"]);
    const report = await partial.cycle();
    expect(report).toMatchObject({ primary: "SKIP", reasonCodes: ["WORLD_PARTIAL"], actions: [] });
    expect(partial.analystCalls.count).toBe(0);
    expect(partial.fake.mutations).toHaveLength(0);
    expect(entriesOf(partial.paths)[1]).toMatchObject({ type: "SKIP", reasonCodes: ["WORLD_PARTIAL"], snapshot: null });

    const dark = await harness();
    dark.fake.failNextReads(["account", "positions", "orders"]);
    const unreachable = await dark.cycle({ market: () => Promise.reject(new Error("market data unreachable")) });
    expect(unreachable).toMatchObject({ primary: "SKIP", reasonCodes: ["WORLD_UNREACHABLE"] });
    expect(entriesOf(dark.paths)[1]).toMatchObject({ type: "SKIP", reasonCodes: ["WORLD_UNREACHABLE"], snapshot: null });

    // The next cycle, with the world back, runs normally: the SKIP left a hole the age rule handles, the BOOTSTRAP sample still qualifies.
    const recovered = await partial.cycle();
    expect(recovered).toMatchObject({ primary: "CYCLE", actions: [{ result: "SUBMITTED", status: "filled" }] });
  });
});

describe("S-X-01/03/04 through the runner: INTENT before order, OUTCOME after, every mutation through the gateway", () => {
  it("S-X-01 the happy path journals CYCLE → INTENT → OUTCOME filled at the submitted limit, and the fake saw exactly one gateway-bound submit", async () => {
    const run = await harness();
    const report = await run.cycle();
    expect(report).toMatchObject({ primary: "CYCLE", actions: [{ result: "SUBMITTED", status: "filled" }], entriesBlocked: [] });
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME"]);
    const [, , intent, outcome] = entriesOf(run.paths);
    expect(intent).toMatchObject({ action: "entry", submittedLimit: { kind: "credit", priceCents: 198 }, reservedMaxLossCents: 30_200, binding: BINDING });
    expect(outcome).toMatchObject({ status: "filled", filledQuantity: 1, avgFillPriceCents: 198, brokerOrderId: "fake-1", binding: BINDING, reasonCodes: [] });
    expect(run.fake.mutations).toHaveLength(1);
    expect(run.fake.mutations[0]).toMatchObject({ kind: "submit_order", clientOrderId: intent!["clientOrderId"], binding: BINDING, payload: { limit: { kind: "credit", priceCents: 198 }, intent: "entry" } });
    const positions = await run.fake.read.positions();
    expect(positions).toEqual([{ contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 198 }, { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 198 }]);
    // The next cycle sees the filled exposure and the same structure again is a fresh identity (different cycle) but G4/G2 still count the first.
    const second = await run.cycle();
    expect(second.primary).toBe("CYCLE");
    const secondCycle = entriesOf(run.paths).find(entry => entry.type === "CYCLE" && entry["cycleIndex"] === 2)!;
    expect((secondCycle["snapshot"] as { positions: unknown[] }).positions).toHaveLength(2);
  });

  it("S-X-03 a synchronous rejection lands as OUTCOME rejected with the broker's reason and nothing is held", async () => {
    const run = await harness({ broker: { onSubmit: () => ({ kind: "reject", reason: "insufficient options buying power" }) } });
    const report = await run.cycle();
    expect(report.actions).toEqual([{ clientOrderId: expect.stringMatching(/^entry:/), result: "SUBMITTED", status: "rejected", detail: null }]);
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME"]);
    expect(entriesOf(run.paths)[3]).toMatchObject({ status: "rejected", brokerReason: "insufficient options buying power", brokerOrderId: null, filledQuantity: 0, avgFillPriceCents: null });
    expect(await run.fake.read.positions()).toEqual([]);
  });

  it("S-X-04 an asynchronous rejection is picked up by the post-submit status check or by the next cycle's phase 0, and until then the order counts as fillable exposure", async () => {
    const immediate = await harness({ broker: { onSubmit: () => ({ kind: "accept_then_reject", reason: "unmarketable limit" }) } });
    expect((await immediate.cycle()).actions[0]).toMatchObject({ result: "SUBMITTED", status: "rejected" });
    expect(entriesOf(immediate.paths)[3]).toMatchObject({ type: "OUTCOME", status: "rejected", brokerReason: "unmarketable limit" });

    const resting = await harness({ broker: { onSubmit: () => ({ kind: "accept" }) } });
    const first = await resting.cycle();
    expect(first.actions[0]).toMatchObject({ result: "SUBMITTED", status: null, detail: "working" });
    expect(types(resting.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT"]);
    const clientOrderId = first.actions[0]!.clientOrderId;
    // While it rests, the next cycle's phase 0 records it as matched-working and G2 still counts its reservation.
    const quiet = (): Promise<string> => Promise.resolve(JSON.stringify({ candidates: [] }));
    const second = await resting.cycle({ analyst: quiet });
    expect(second.resolved).toEqual([{ clientOrderId, result: "MATCHED_WORKING" }]);
    expect(types(resting.paths).slice(3, 5)).toEqual(["RECONCILIATION", "CYCLE"]);
    const cycleTwo = entriesOf(resting.paths)[4]!;
    expect((cycleTwo["snapshot"] as { openOrders: { clientOrderId: string }[] }).openOrders.map(order => order.clientOrderId)).toEqual([clientOrderId]);
    // The broker rejects it overnight; phase 0 of the following cycle journals the rejection before any new order.
    resting.fake.transitionOrder(clientOrderId, { status: "rejected", reason: "rejected after acceptance" });
    const third = await resting.cycle({ analyst: quiet });
    expect(third.resolved).toEqual([{ clientOrderId, result: "OUTCOME:rejected" }]);
    const outcome = entriesOf(resting.paths).find(entry => entry.type === "OUTCOME" && entry["clientOrderId"] === clientOrderId)!;
    expect(outcome).toMatchObject({ status: "rejected", brokerReason: "rejected after acceptance" });
    expect(entriesOf(resting.paths).indexOf(outcome)).toBeLessThan(entriesOf(resting.paths).findIndex(entry => entry.type === "CYCLE" && entry["cycleIndex"] === 3));
  });
});

describe("S-CYC-04 a lost acknowledgement is resolved by client order ID before any new order", () => {
  it("S-CYC-04 timeout after send → OUTCOME confirmation_unclear, reservation retained; the next cycle's phase 0 finds the order and journals the resolution first", async () => {
    const run = await harness({ broker: { onSubmit: () => ({ kind: "lose_ack" }) } });
    const first = await run.cycle();
    expect(first.actions[0]).toMatchObject({ result: "SUBMITTED", status: "confirmation_unclear" });
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME"]);
    const unclear = entriesOf(run.paths)[3]!;
    expect(unclear).toMatchObject({ status: "confirmation_unclear", brokerOrderId: null, brokerReason: expect.stringContaining("TIMEOUT after send") });
    const clientOrderId = String(unclear["clientOrderId"]);
    // The order exists at the broker, resting.
    expect(await run.fake.read.orderByClientId(clientOrderId)).toMatchObject({ status: "accepted" });

    run.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    const second = await run.cycle();
    expect(second.resolved).toEqual([{ clientOrderId, result: "MATCHED_WORKING" }]);
    const sequence = types(run.paths);
    expect(sequence.indexOf("RECONCILIATION")).toBeLessThan(sequence.lastIndexOf("CYCLE"));
    // The resolved (working) reservation still counts, so the second cycle's identical structure is a different identity but the sleeve carries both.
    const reconciliation = entriesOf(run.paths).find(entry => entry.type === "RECONCILIATION")!;
    expect(reconciliation).toMatchObject({ reasonCodes: [], items: [{ kind: "entry_order", clientOrderId, classification: "MATCHED_WORKING", brokerOrderId: "fake-1" }] });
    expect(run.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toHaveLength(2);

    // Never sent at all: phase 0 finds nothing and releases the reservation as NOT_SUBMITTED.
    const neverSent = await harness({ broker: { onSubmit: () => ({ kind: "lose_ack_never_sent" }) } });
    await neverSent.cycle();
    expect(types(neverSent.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME"]);
    neverSent.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    const resolved = await neverSent.cycle();
    expect(resolved.resolved[0]).toMatchObject({ result: "NOT_AT_BROKER" });
    expect(entriesOf(neverSent.paths).find(entry => entry.type === "RECONCILIATION")).toMatchObject({ reasonCodes: ["NOT_SUBMITTED"], items: [{ classification: "NOT_AT_BROKER" }] });
  });

  it("S-CYC-04 / S-G7-02 a replayed client order ID is adopted from the broker's duplicate answer, never re-sent under a fresh ID", async () => {
    const run = await harness();
    // Pre-plant the exact entry ID this cycle will derive by running one cycle, then replaying the same cycle index.
    const first = await run.cycle({ cycleIndex: 1 });
    const clientOrderId = first.actions[0]!.clientOrderId;
    const replay = await run.cycle({ cycleIndex: 1 });
    // G7 in decide already vetoes the planned duplicate because the INTENT is in submittedOrderIds — the ID never reaches the broker twice.
    expect(replay.actions).toEqual([]);
    expect(run.fake.mutations.filter(mutation => mutation.clientOrderId === clientOrderId)).toHaveLength(1);
    const replayCycle = entriesOf(run.paths).filter(entry => entry.type === "CYCLE").at(-1)!;
    expect((replayCycle["candidateVerdicts"] as { gateVector: { gate: string; passed: boolean }[] }[])[0]!.gateVector[6]).toMatchObject({ gate: "G7", passed: false });
  });
});

describe("S-CYC-05 revalidation against fresh broker truth immediately before submit", () => {
  it("S-CYC-05 / BEQ-3 a human trade between approval and submit voids the action with the claimset and the violated claim journaled; nothing reaches the broker", async () => {
    const run = await harness();
    const report = await run.cycle({
      analyst: () => {
        // The developer closes something by hand in the broker UI while the analyst is thinking (scenario #8).
        run.fake.setPositions([{ contractId: "QQQ260904P00400000", quantity: 3, avgEntryPriceCents: 150 }]);
        return Promise.resolve(CANDIDATE_JSON);
      },
    });
    expect(report.actions).toEqual([{ clientOrderId: expect.stringMatching(/^entry:/), result: "VOIDED", status: null, detail: "POSITIONS_UNCHANGED" }]);
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "RECONCILIATION"]);
    const voided = entriesOf(run.paths)[3]!;
    expect(voided).toMatchObject({ reasonCodes: ["REVALIDATION_VOID"], items: [{ kind: "entry_order", classification: "REVALIDATION_VOID", violated: [{ claim: "POSITIONS_UNCHANGED" }] }] });
    expect((voided["items"] as { claimset: { claim: string }[] }[])[0]!.claimset.map(claim => claim.claim)).toEqual(["ACCOUNT_BOUND", "EQUITY_ABOVE_KILL_THRESHOLD", "POSITIONS_UNCHANGED", "OPEN_ORDERS_UNCHANGED", "CONTROL_EPOCH", "NOT_HALTED", "LIMIT_AND_RESERVE_UNCHANGED", "GATES_G1_G4_PASS"]);
    expect(run.fake.mutations).toHaveLength(0);
  });

  it("S-CYC-05 / KGV-5 equity crossing the kill threshold between snapshot and submit voids the action and runs S-G13-01 in the same cycle", async () => {
    const run = await harness();
    const report = await run.cycle({
      analyst: () => {
        run.fake.setEquity(TEST_ONLY_EXECUTION_CONFIG.killEquityThresholdCents - 1);
        return Promise.resolve(CANDIDATE_JSON);
      },
    });
    expect(report.actions).toEqual([{ clientOrderId: expect.stringMatching(/^entry:/), result: "VOIDED", status: null, detail: "EQUITY_ABOVE_KILL_THRESHOLD" }]);
    expect(report.kill).toMatchObject({ haltDurable: true, canceled: [], closes: [], flat: true });
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "RECONCILIATION", "HALT", "KILL"]);
    expect(entriesOf(run.paths)[4]).toMatchObject({ type: "HALT", reason: "KILL", sticky: true });
    expect(entriesOf(run.paths)[5]).toMatchObject({ type: "KILL", equityCents: 9_199_999, thresholdCents: 9_200_000 });
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "KILL", sticky: true });
    expect(run.fake.mutations).toHaveLength(0);
    // S-G13-03: recovering equity does not un-halt, and the human path is refused as sticky.
    run.fake.setEquity(10_000_000);
    const next = await run.cycle();
    expect(next.actions).toEqual([]);
    expect(next.entriesBlocked).toEqual([]);
    expect(entriesOf(run.paths).at(-1)).toMatchObject({ type: "CYCLE", batchVerdicts: [{ code: "HALT" }] });
    expect(await run.gateway.dispatchManualUnhalt({ operator: "felix", reason: "equity recovered" })).toMatchObject({ ok: false, reason: "HALT_IS_STICKY" });
  });

  it("S-J-06 at submit: a broker reporting a foreign account ID fails the ACCOUNT_BOUND claim; the order is void before the port", async () => {
    const run = await harness({ broker: { accountId: "PA_NOT_THE_EXPECTED_ONE" } });
    const report = await run.cycle();
    // The snapshot itself is assembled from the foreign account; revalidation refuses it explicitly.
    expect(report.actions[0]).toMatchObject({ result: "VOIDED", detail: expect.stringContaining("ACCOUNT_BOUND") });
    expect(run.fake.mutations).toHaveLength(0);
  });
});

describe("S-G13-01 kill management under the valid fence", () => {
  async function heldSpread(options: { readonly onCancel?: FakeBrokerOptions["onCancel"]; readonly extraOrder?: "entry" | "close" } = {}): Promise<Harness & { readonly exposureLifecycleId: string; readonly restingEntryId: string | null }> {
    const run = await harness({ broker: options.onCancel === undefined ? {} : { onCancel: options.onCancel } });
    const first = await run.cycle();
    const exposureLifecycleId = String(entriesOf(run.paths).find(entry => entry.type === "INTENT")!["exposureLifecycleId"]);
    expect(first.actions[0]).toMatchObject({ status: "filled" });
    let restingEntryId: string | null = null;
    if (options.extraOrder === "entry") {
      // A second lifecycle whose entry is resting at the broker: the risk-increasing order the kill must cancel first.
      run.fake.setSubmitBehaviour(() => ({ kind: "accept" }));
      const second = await run.cycle();
      restingEntryId = second.actions[0]!.clientOrderId;
      expect(second.actions[0]).toMatchObject({ status: null, detail: "working" });
    }
    if (options.extraOrder === "close") {
      // A protective close already resting under our deterministic attempt ID, with its close INTENT journaled.
      const lifecycleId = closeLifecycleId(exposureLifecycleId, "kill");
      const attemptId = closeAttemptId(lifecycleId, integerUnit(0, "Quantity"));
      const legs = creditVertical().legs.map(optionLeg => ({ ...optionLeg, side: optionLeg.side === "buy" ? "sell" : "buy" }));
      const intent = { at: epochMsToUtcIso(run.clock.now), epoch: 1, type: "INTENT", action: "close", clientOrderId: attemptId, exposureLifecycleId, closeLifecycleId: lifecycleId, route: "ordinary", generation: 0, legs, quantity: 1, submittedLimit: { kind: "debit", priceCents: 204 }, reason: "test-only resting protective close", binding: BINDING };
      expect(await run.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: intent } })).toMatchObject({ ok: true });
      run.fake.setSubmitBehaviour(() => ({ kind: "accept" }));
      expect(await run.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: attemptId, binding: BINDING, payload: { legs, quantity: 1, limit: { kind: "debit", priceCents: 204 }, intent: "close" } } } })).toMatchObject({ ok: true });
    }
    run.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    return { ...run, exposureLifecycleId, restingEntryId };
  }

  it("S-G13-01 sets the sticky halt, cancels the resting entry, reconciles the cancel, flattens the held spread whole through a journaled close, and reports KILL only when broker truth is flat", async () => {
    const run = await heldSpread({ extraOrder: "entry" });
    run.fake.setEquity(9_000_000);
    const report = await run.cycle();
    expect(report.kill).toMatchObject({ haltDurable: true, canceled: [run.restingEntryId], cancelRaces: { [run.restingEntryId!]: "CANCELED" }, adopted: [], emergency: [], flat: true });
    expect(report.kill!.closes).toEqual([closeAttemptId(closeLifecycleId(run.exposureLifecycleId, "kill"), integerUnit(0, "Quantity"))]);
    const sequence = types(run.paths);
    const haltIndex = sequence.indexOf("HALT");
    expect(sequence[haltIndex]).toBe("HALT");
    expect(sequence.slice(haltIndex)).toEqual(["HALT", "OUTCOME", "RECONCILIATION", "INTENT(close)", "OUTCOME", "KILL", "CYCLE"]);
    const entries = entriesOf(run.paths);
    expect(entries[haltIndex]).toMatchObject({ reason: "KILL", sticky: true });
    expect(entries[haltIndex + 1]).toMatchObject({ type: "OUTCOME", clientOrderId: run.restingEntryId, status: "canceled" });
    expect(entries[haltIndex + 2]).toMatchObject({ items: [{ kind: "kill_cancel", clientOrderId: run.restingEntryId, reconciliation: "CANCELED" }] });
    expect(entries[haltIndex + 3]).toMatchObject({ action: "close", route: "kill", exposureLifecycleId: run.exposureLifecycleId, quantity: 1, submittedLimit: { kind: "debit" } });
    expect(entries[haltIndex + 4]).toMatchObject({ type: "OUTCOME", status: "filled", clientOrderId: entries[haltIndex + 3]!["clientOrderId"] });
    expect(entries[haltIndex + 5]).toMatchObject({ type: "KILL", equityCents: 9_000_000 });
    expect(await run.fake.read.positions()).toEqual([]);
    const mutationKinds = run.fake.mutations.map(mutation => `${mutation.kind}:${mutation.clientOrderId.split(":")[0]!}`);
    expect(mutationKinds).toEqual(["submit_order:entry", "submit_order:entry", "cancel_order:entry", "submit_order:close"]);
    expect(run.fake.mutations.every(mutation => mutation.binding.accountId === TEST_ONLY_ACCOUNT_ID)).toBe(true);
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "KILL", sticky: true });
  });

  it("S-G13-01 a fill during cancel becomes reconciled exposure and is flattened too; a lost cancel acknowledgement keeps fillable exposure and never reports flat", async () => {
    const raced = await heldSpread({ extraOrder: "entry", onCancel: () => "fill_before_cancel" });
    raced.fake.setEquity(9_000_000);
    const report = await raced.cycle();
    expect(report.kill).toMatchObject({ cancelRaces: { [raced.restingEntryId!]: "FILLED_DURING_CANCEL" }, canceled: [], flat: true });
    expect(report.kill!.closes).toHaveLength(2);
    expect(entriesOf(raced.paths).find(entry => entry.type === "OUTCOME" && entry["clientOrderId"] === raced.restingEntryId)).toMatchObject({ status: "filled" });
    expect(await raced.fake.read.positions()).toEqual([]);
    expect(types(raced.paths).at(-2)).toBe("KILL");

    const lost = await heldSpread({ extraOrder: "entry", onCancel: () => "lose_cancel_ack" });
    lost.fake.setEquity(9_000_000);
    const unclear = await lost.cycle();
    expect(unclear.kill).toMatchObject({ cancelRaces: { [lost.restingEntryId!]: "CANCEL_UNCLEAR" }, canceled: [], flat: false });
    expect(types(lost.paths)).not.toContain("KILL");
    expect(readHaltState(lost.paths)).toMatchObject({ halted: true, reason: "KILL", sticky: true });
    // The unclear order still rests as fillable exposure at the broker.
    expect(await lost.fake.read.orderByClientId(lost.restingEntryId!)).toMatchObject({ status: "pending_cancel" });
  });

  it("S-G13-01 a pre-existing protective close is adopted, neither canceled nor duplicated; the partial-fill race is reconciled by broker ID", async () => {
    const run = await heldSpread({ extraOrder: "close" });
    run.fake.setEquity(9_000_000);
    const report = await run.cycle();
    const attemptId = closeAttemptId(closeLifecycleId(run.exposureLifecycleId, "kill"), integerUnit(0, "Quantity"));
    expect(report.kill).toMatchObject({ adopted: [attemptId], canceled: [], closes: [attemptId], flat: false });
    // Exactly one close mutation ever reached the broker for this lifecycle: the pre-existing one.
    expect(run.fake.mutations.filter(mutation => mutation.clientOrderId.startsWith("close:"))).toHaveLength(1);
    expect(run.fake.mutations.filter(mutation => mutation.kind === "cancel_order")).toHaveLength(0);
    expect(types(run.paths).filter(type => type === "INTENT(close)")).toHaveLength(1);

    const partial = await heldSpread({ extraOrder: "entry", onCancel: () => "partial_before_cancel" });
    partial.fake.setEquity(9_000_000);
    const raced = await partial.cycle();
    expect(raced.kill).toMatchObject({ cancelRaces: { [partial.restingEntryId!]: "PARTIALLY_FILLED_DURING_CANCEL" } });
    expect(entriesOf(partial.paths).find(entry => entry.type === "OUTCOME" && entry["clientOrderId"] === partial.restingEntryId)).toMatchObject({ status: "partially_filled", filledQuantity: 1 });
  });
});

describe("S-CYC-06 journal failure blocks every new risk; the sole exception is the emergency close", () => {
  it("S-CYC-06 with the journal unwritable no entry order is submitted, and the primary entry cannot be claimed", async () => {
    const run = await harness();
    lockJournal(run.paths);
    const report = await run.cycle();
    expect(report).toMatchObject({ primary: null, journalFailure: expect.stringContaining("CYCLE"), actions: [] });
    expect(report.entriesBlocked).toContain("JOURNAL_UNAVAILABLE");
    expect(run.fake.mutations).toHaveLength(0);
    unlockJournal(run.paths);
    expect(types(run.paths)).toEqual(["BOOTSTRAP"]);
  });

  it("S-CYC-06 kill with the journal unwritable: the held spread is closed through the gateway without an INTENT, and the first successful append is an AUDIT_GAP_EMERGENCY_CLOSE reconciliation stating no durable prior INTENT", async () => {
    const run = await harness();
    const first = await run.cycle();
    expect(first.actions[0]).toMatchObject({ status: "filled" });
    const exposureLifecycleId = String(entriesOf(run.paths).find(entry => entry.type === "INTENT")!["exposureLifecycleId"]);
    lockJournal(run.paths);
    run.fake.setEquity(9_000_000);
    const report = await run.cycle();
    const attemptId = closeAttemptId(closeLifecycleId(exposureLifecycleId, "emergency"), integerUnit(0, "Quantity"));
    expect(report.kill).toMatchObject({ haltDurable: false, emergency: [attemptId], closes: [], flat: true });
    expect(report.primary).toBeNull();
    const closeMutation = run.fake.mutations.find(mutation => mutation.clientOrderId === attemptId);
    expect(closeMutation).toMatchObject({ kind: "submit_order", binding: BINDING, payload: { intent: "close", quantity: 1 } });
    expect(await run.fake.read.positions()).toEqual([]);
    // No entry, no INTENT, no KILL could be written while the journal was down.
    unlockJournal(run.paths);
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME"]);

    const recovered = await run.cycle();
    expect(recovered.auditGaps).toEqual([attemptId]);
    const audit = entriesOf(run.paths).find(entry => entry.type === "RECONCILIATION")!;
    expect(audit).toMatchObject({ reasonCodes: ["AUDIT_GAP_EMERGENCY_CLOSE"], items: [{ kind: "emergency_close", attemptId, brokerOrderId: "fake-2", status: "filled", filledQuantity: 1, priorIntent: expect.stringContaining("NONE_DURABLE") }] });
    expect(types(run.paths).indexOf("RECONCILIATION")).toBeLessThan(types(run.paths).lastIndexOf("CYCLE"));
    // The halt was never durable (the flag never changed), so the recovered cycle is not halted by the flag; equity is still below the threshold, so the kill fires again and now lands durably.
    expect(recovered.kill).toMatchObject({ haltDurable: true, flat: true });
    expect(types(run.paths).slice(-3)).toEqual(["HALT", "KILL", "CYCLE"]);
  });

  it("S-CYC-06 the emergency route adopts a sufficient resting close instead of creating a parallel child, and refuses every mutation when the epoch store is unreadable", async () => {
    const run = await harness();
    await run.cycle();
    const exposureLifecycleId = String(entriesOf(run.paths).find(entry => entry.type === "INTENT")!["exposureLifecycleId"]);
    const lifecycleId = closeLifecycleId(exposureLifecycleId, "emergency");
    const attemptId = closeAttemptId(lifecycleId, integerUnit(0, "Quantity"));
    const legs = creditVertical().legs.map(optionLeg => ({ ...optionLeg, side: optionLeg.side === "buy" ? "sell" : "buy" }));
    run.fake.setSubmitBehaviour(() => ({ kind: "accept" }));
    expect(await run.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: attemptId, binding: BINDING, payload: { legs, quantity: 1, limit: { kind: "debit", priceCents: 204 }, intent: "close" } } } })).toMatchObject({ ok: true });
    lockJournal(run.paths);
    run.fake.setEquity(9_000_000);
    const report = await run.cycle();
    expect(report.kill).toMatchObject({ haltDurable: false, emergency: [], flat: false });
    expect(run.fake.mutations.filter(mutation => mutation.clientOrderId.startsWith("close:"))).toHaveLength(1);
    unlockJournal(run.paths);

    const fenced = await harness();
    await fenced.cycle();
    lockJournal(fenced.paths);
    writeFileSync(fenced.paths.epoch, "{not json", "utf8");
    fenced.fake.setEquity(9_000_000);
    const refused = await fenced.cycle();
    expect(refused.kill).toMatchObject({ haltDurable: false, emergency: [], closes: [] });
    expect(fenced.fake.mutations.filter(mutation => mutation.clientOrderId.startsWith("close:"))).toHaveLength(0);
    expect(readEpochStore(fenced.paths)).toMatchObject({ kind: "unreadable" });
    unlockJournal(fenced.paths);
  });
});

describe("S-X-02 a broker record worse than the submitted limit halts new entries", () => {
  it("S-X-02 a fill below the submitted credit limit is journaled BROKER_PRICE_BREACH, reserves the actual exposure, and lands a non-sticky HALT that blocks the next cycle until a human reconciles", async () => {
    const run = await harness({ broker: { onSubmit: () => ({ kind: "fill", avgFillPriceCents: 150 }) } });
    const report = await run.cycle();
    expect(report.actions[0]).toMatchObject({ result: "SUBMITTED", status: "filled" });
    expect(report.entriesBlocked).toEqual(["BROKER_PRICE_BREACH"]);
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "OUTCOME", "HALT"]);
    const [, , , outcome, halt] = entriesOf(run.paths);
    expect(outcome).toMatchObject({ status: "filled", avgFillPriceCents: 150, reasonCodes: ["BROKER_PRICE_BREACH"] });
    expect(halt).toMatchObject({ reason: "BROKER_PRICE_BREACH", sticky: false });
    expect(readHaltState(run.paths)).toEqual({ halted: true, reason: "BROKER_PRICE_BREACH", sticky: false });
    run.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    const next = await run.cycle();
    expect(next.actions).toEqual([]);
    const cycleTwo = entriesOf(run.paths).at(-1)!;
    expect(cycleTwo).toMatchObject({ type: "CYCLE", batchVerdicts: [{ code: "HALT" }] });
    // Halted cycles are management-only: the analyst is not even asked (S-CYC-01 semantics under S-G12-03).
    expect(run.analystCalls.count).toBe(1);
    expect(run.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toHaveLength(1);
    // Not sticky: after reconciliation a human may clear it (S-G12-04), unlike a kill halt.
    expect(await run.gateway.dispatchManualUnhalt({ operator: "felix", reason: "breach reconciled against the broker ledger" })).toMatchObject({ ok: true });
  });
});

describe("S-G13-01 a kill found mid-cycle blocks every later plan of that cycle", () => {
  it("S-G13-01 with two approved plans, the first one's re-check trips the kill; the second is NOT_SENT — no second INTENT, no second void, nothing at the port", async () => {
    const run = await harness();
    const report = await run.cycle({
      analyst: () => {
        run.fake.setEquity(TEST_ONLY_EXECUTION_CONFIG.killEquityThresholdCents - 1);
        return Promise.resolve(TWO_CANDIDATES_JSON);
      },
    });
    expect(report.actions).toHaveLength(2);
    expect(report.actions[0]).toMatchObject({ result: "VOIDED", detail: "EQUITY_ABOVE_KILL_THRESHOLD" });
    expect(report.actions[1]).toMatchObject({ result: "NOT_SENT", detail: expect.stringContaining("KILL") });
    expect(types(run.paths)).toEqual(["BOOTSTRAP", "CYCLE", "INTENT", "RECONCILIATION", "HALT", "KILL"]);
    expect(run.fake.mutations).toHaveLength(0);
  });
});

describe("RES-P1-01d at the runner boundary", () => {
  it("RES-P1-01d the runner accepts only raw analyst text; a forged unit in that text is a SCHEMA_VETO and never a plan", async () => {
    const run = await harness({ analyst: () => Promise.resolve(JSON.stringify({ candidates: [{ ...creditVertical(), quantity: 0 }] })) });
    const report = await run.cycle();
    expect(report.actions).toEqual([]);
    expect(entriesOf(run.paths)[1]).toMatchObject({ type: "CYCLE", batchVerdicts: [{ code: "SCHEMA_VETO" }], candidateVerdicts: [] });
    expect(run.fake.mutations).toHaveLength(0);
  });
});
