// Shared S-ARM-01 certificate fixtures: one coherent dev live-test run
// (journal, broker observations, fence drill, flat final snapshot) that the
// pure core turns into a PASS certificate. Both the core suite and the shell
// arming-gate suite build from this single fixture, so a change to the
// certificate contract cannot pass one suite while the other keeps a stale copy.
import type { CertificateInputs, OrderObservation } from "../src/core/certificate.js";
import type { BrokerOrderRecord } from "../src/core/execution.js";
import type { JournalEntry } from "../src/core/journal.js";

export const ORIGIN = "https://paper-api.alpaca.markets";
export const ACCOUNT = "PA349COOGKZ1";
export const SHORT = "SPY260904C00770000";
export const LONG = "SPY260904C00772000";
export const DIGEST_A = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);

export function sample(bid: number, ask: number) {
  // `quotedAt` is the broker instant truncated to milliseconds, exactly as `mapLatestQuote` derives it.
  return { bidCents: bid, askCents: ask, bidSize: 25, askSize: 30, quotedAt: "2026-09-01T14:00:00.000Z", brokerQuotedAt: "2026-09-01T14:00:00.000456789Z" };
}

export function snapshot(positions: readonly { contractId: string; quantity: number }[]) {
  return {
    accountId: ACCOUNT,
    snapshotAt: "2026-09-01T14:00:00.000Z",
    cashCents: 10_000_000,
    equityCents: 10_000_000,
    positions: positions.map(position => ({ ...position, avgEntryPriceCents: 0 })),
    openOrders: [],
    quoteSamples: { SPY: { [SHORT]: sample(50, 52), [LONG]: sample(30, 32) } },
  };
}

export function entry(seq: number, type: string, fields: Record<string, unknown>): JournalEntry {
  const price = fields["avgFillPriceCents"];
  const withExactFill = type === "OUTCOME" && typeof price === "number" && !Object.hasOwn(fields, "avgFillPriceRaw")
    ? { ...fields, avgFillPriceRaw: `${String(Math.floor(price / 100))}.${String(price % 100).padStart(2, "0")}` }
    : fields;
  return { seq, at: `2026-09-01T14:${String(seq).padStart(2, "0")}:00.000Z`, epoch: 1, type, ...withExactFill } as JournalEntry;
}

export const LEGS = [
  { contractId: SHORT, underlying: "SPY", expiry: "2026-09-04", strikeCents: 77_000, right: "call", side: "sell", ratio: 1 },
  { contractId: LONG, underlying: "SPY", expiry: "2026-09-04", strikeCents: 77_200, right: "call", side: "buy", ratio: 1 },
];

export function gateVector(g5Passed: boolean) {
  return ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"].map(gate => ({ gate, passed: gate === "G5" ? g5Passed : true, code: "PASS", reasons: [] }));
}

export function passingJournal(overrides: { readonly g5?: boolean; readonly outcomeStatus?: string; readonly reconciled?: boolean; readonly fence?: boolean; readonly unhalt?: boolean } = {}): readonly JournalEntry[] {
  const journal: JournalEntry[] = [
    entry(1, "BOOTSTRAP", { snapshot: snapshot([]), epochSeeded: true }),
    entry(2, "CYCLE", { cycleIndex: 1, tradingDay: "2026-09-01", reasonCodes: [], snapshot: snapshot([]), batchVerdicts: [], candidateVerdicts: [] }),
    entry(3, "INTENT", { action: "entry", clientOrderId: "entry:credit", exposureLifecycleId: "exposure:credit", sleeve: "income", structureType: "vertical_credit", legs: LEGS, quantity: 1, submittedLimit: { kind: "credit", priceCents: 18 }, reservedMaxLossCents: 18_200, gateVector: gateVector(overrides.g5 ?? true), rationale: { paidFrom: "income_drift", snapshotReferences: ["x"], text: "SPY vertical_credit" }, binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT } }),
    entry(4, "OUTCOME", { clientOrderId: "entry:credit", status: overrides.outcomeStatus ?? "filled", brokerOrderId: "broker-1", brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z", [(overrides.outcomeStatus ?? "filled") === "canceled" ? "canceled_at" : "filled_at"]: "2026-09-01T14:03:05.000Z" }, filledQuantity: (overrides.outcomeStatus ?? "filled") === "filled" ? 1 : 0, avgFillPriceCents: (overrides.outcomeStatus ?? "filled") === "filled" ? 19 : null, reasonCodes: [], binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT }, brokerReason: null }),
    entry(5, "CYCLE", { cycleIndex: 2, tradingDay: "2026-09-01", reasonCodes: [], snapshot: snapshot((overrides.reconciled ?? true) ? [{ contractId: SHORT, quantity: -1 }, { contractId: LONG, quantity: 1 }] : []), batchVerdicts: [], candidateVerdicts: [] }),
  ];
  if (overrides.fence ?? true) journal.push(entry(6, "HALT", { reason: "AUTH_FAILURE", detail: "broker credential rejected (401)", sticky: false }));
  if ((overrides.fence ?? true) && (overrides.unhalt ?? true)) journal.push(entry(7, "UNHALT", { actor: "human", operator: "certificate-driver", reason: "fence drill complete" }));
  return journal;
}

export function order(status: string, filled: boolean): BrokerOrderRecord {
  return { brokerOrderId: "broker-1", clientOrderId: "entry:credit", status, filledQuantity: filled ? 1 : 0, avgFillPriceCents: filled ? 19 : null, avgFillPriceRaw: filled ? "0.19" : null, brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z" }, brokerReason: null, legs: [{ contractId: SHORT, side: "sell", ratio: 1 }, { contractId: LONG, side: "buy", ratio: 1 }], quantity: 1, limit: { kind: "credit", priceCents: 18 } };
}

export function observations(): readonly OrderObservation[] {
  return [{ observedAt: "2026-09-01T14:03:01.000Z", order: order("accepted", false) }, { observedAt: "2026-09-01T14:03:06.000Z", order: order("filled", true) }];
}

export function inputs(overrides: Partial<CertificateInputs> = {}): CertificateInputs {
  return {
    accountId: ACCOUNT,
    tradingOrigin: ORIGIN,
    canonicalTradingOrigin: ORIGIN,
    window: { startedAt: "2026-09-01T13:35:00.000Z", endedAt: "2026-09-01T15:10:00.000Z" },
    runtimeDigest: DIGEST_A,
    policyDigest: DIGEST_B,
    mcpInventoryAccepted: true,
    journal: passingJournal(),
    orderObservations: observations(),
    harnessCancels: [],
    fence: { httpStatus: 401, haltSeq: 6, unhaltSeq: 7, workingOrdersAtFence: [], canceledAtFence: [] },
    finalSnapshot: { at: "2026-09-01T15:09:00.000Z", accountId: ACCOUNT, cashCents: 10_000_100, equityCents: 10_000_100, positions: [], nonTerminalOrders: [], orderPagesFetched: 1, pagesComplete: true, consistentReads: 2 },
    ...overrides,
  };
}
