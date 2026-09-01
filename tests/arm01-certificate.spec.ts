// S-ARM-01 — the dev live-test certificate (P7): the pure evidence
// extraction and PASS/FAIL evaluation over a journal plus broker
// observations, the role-neutral policy digest and the runtime digest
// (WIN-17: an identity-only switch preserves the proof, a policy or code
// change invalidates it, unknown fields are rejected, secrets never enter),
// and the arming-time validation (WIN-7, WIN-10: an incomplete, rejected,
// digest-mismatched, or non-PASS certificate never arms).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONFIG_FIELD_CLASSIFICATION_VERSION,
  buildCertificate,
  canonicalJson,
  classifyConfig,
  policyDigest,
  runtimeDigest,
  successfulDevLiveTestAt,
  validateArmingCertificate,
} from "../src/core/certificate.js";
import type { CertificateInputs, OrderObservation } from "../src/core/certificate.js";
import type { BrokerOrderRecord } from "../src/core/execution.js";
import type { JournalEntry } from "../src/core/journal.js";
import { sha256Text } from "../src/core/sha256.js";
import { validStartupConfig } from "./startup-fixtures.js";

const ORIGIN = "https://paper-api.alpaca.markets";
const ACCOUNT = "PA349COOGKZ1";
const SHORT = "SPY260904C00770000";
const LONG = "SPY260904C00772000";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function sample(bid: number, ask: number) {
  // `quotedAt` is the broker instant truncated to milliseconds, exactly as `mapLatestQuote` derives it.
  return { bidCents: bid, askCents: ask, bidSize: 25, askSize: 30, quotedAt: "2026-09-01T14:00:00.000Z", brokerQuotedAt: "2026-09-01T14:00:00.000456789Z" };
}

function snapshot(positions: readonly { contractId: string; quantity: number }[]) {
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

function entry(seq: number, type: string, fields: Record<string, unknown>): JournalEntry {
  return { seq, at: `2026-09-01T14:${String(seq).padStart(2, "0")}:00.000Z`, epoch: 1, type, ...fields } as JournalEntry;
}

const LEGS = [
  { contractId: SHORT, underlying: "SPY", expiry: "2026-09-04", strikeCents: 77_000, right: "call", side: "sell", ratio: 1 },
  { contractId: LONG, underlying: "SPY", expiry: "2026-09-04", strikeCents: 77_200, right: "call", side: "buy", ratio: 1 },
];

function gateVector(g5Passed: boolean) {
  return ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"].map(gate => ({ gate, passed: gate === "G5" ? g5Passed : true, code: "PASS", reasons: [] }));
}

function passingJournal(overrides: { readonly g5?: boolean; readonly outcomeStatus?: string; readonly reconciled?: boolean; readonly fence?: boolean; readonly unhalt?: boolean } = {}): readonly JournalEntry[] {
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

function order(status: string, filled: boolean): BrokerOrderRecord {
  return { brokerOrderId: "broker-1", clientOrderId: "entry:credit", status, filledQuantity: filled ? 1 : 0, avgFillPriceCents: filled ? 19 : null, brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z" }, brokerReason: null, legs: [{ contractId: SHORT, side: "sell", ratio: 1 }, { contractId: LONG, side: "buy", ratio: 1 }], quantity: 1, limit: { kind: "credit", priceCents: 18 } };
}

function observations(): readonly OrderObservation[] {
  return [{ observedAt: "2026-09-01T14:03:01.000Z", order: order("accepted", false) }, { observedAt: "2026-09-01T14:03:06.000Z", order: order("filled", true) }];
}

function inputs(overrides: Partial<CertificateInputs> = {}): CertificateInputs {
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
    fence: { httpStatus: 401, workingOrdersAtFence: [], canceledAtFence: [] },
    finalSnapshot: { at: "2026-09-01T15:09:00.000Z", accountId: ACCOUNT, cashCents: 10_000_100, equityCents: 10_000_100, positions: [], nonTerminalOrders: [], orderPagesFetched: 1, pagesComplete: true, consistentReads: 2 },
    ...overrides,
  };
}

describe("S-ARM-01 — the certificate is PASS only when every clause is evidenced", () => {
  it("a complete run yields PASS with liquidity inputs, credit acceptance, a reconciled fill, the fence drill, and a flat final snapshot", () => {
    const certificate = buildCertificate(inputs());
    expect(certificate.failures).toEqual([]);
    expect(certificate.verdict).toBe("PASS");
    expect(certificate.evidence.liquidity.map(item => item.contractId).sort()).toEqual([LONG, SHORT].sort());
    expect(certificate.evidence.liquidity.every(item => item.bidSize > 0 && item.askSize > 0 && item.brokerQuotedAt.length > 0 && item.snapshotSeq === 2)).toBe(true);
    expect(certificate.evidence.creditAcceptance).toMatchObject({ clientOrderId: "entry:credit", acceptedStatus: "accepted", terminalStatus: "filled", intentSeq: 3, outcomeSeq: 4, brokerOrderId: "broker-1", harnessRequestedCancel: false });
    expect(certificate.evidence.fill).toMatchObject({ clientOrderId: "entry:credit", filledQuantity: 1, avgFillPriceCents: 19, outcomeSeq: 4, reconciledSnapshotSeq: 5, filledAt: "2026-09-01T14:03:05.000Z" });
    expect(certificate.evidence.fence).toEqual({ httpStatus: 401, haltSeq: 6, unhaltSeq: 7, workingOrdersAtFence: [], canceledAtFence: [] });
    expect(certificate.evidence.finalSnapshot).toMatchObject({ positionCount: 0, nonTerminalOrderCount: 0, pagesComplete: true, consistentReads: 2, accountId: ACCOUNT });
    expect(successfulDevLiveTestAt(certificate)).toBe("2026-09-01T15:10:00.000Z");
    expect(certificate.fieldClassificationVersion).toBe(CONFIG_FIELD_CLASSIFICATION_VERSION);
  });

  it("a fill that outran the first observation still proves acceptance: the filled record is a positive broker state", () => {
    const certificate = buildCertificate(inputs({ orderObservations: [{ observedAt: "2026-09-01T14:03:06.000Z", order: order("filled", true) }] }));
    expect(certificate.verdict).toBe("PASS");
    expect(certificate.evidence.creditAcceptance).toMatchObject({ acceptedStatus: "filled", terminalStatus: "filled" });
    expect(buildCertificate(inputs({ orderObservations: [] })).failures).toContain("no credit entry lifecycle reached a positive broker acceptance followed by a filled or harness-canceled OUTCOME");
  });

  it("binds acceptance to the exact intended broker Mleg, quantity, limit, and terminal broker identity", () => {
    const wrongShape = observations().map(item => ({ ...item, order: { ...item.order, quantity: 5, limit: { kind: "debit" as const, priceCents: 99 }, legs: [item.order.legs[0]!] } }));
    const shapeCertificate = buildCertificate(inputs({ orderObservations: wrongShape }));
    expect(shapeCertificate.verdict).toBe("FAIL");
    expect(shapeCertificate.failures.some(item => item.includes("does not equal the journaled credit Mleg"))).toBe(true);

    const foreignOutcomeIdentity = passingJournal().map(item => item.seq === 4 ? { ...item, brokerOrderId: "broker-other" } : item);
    const identityCertificate = buildCertificate(inputs({ journal: foreignOutcomeIdentity }));
    expect(identityCertificate.verdict).toBe("FAIL");
    expect(identityCertificate.failures.some(item => item.includes("does not equal the terminal OUTCOME"))).toBe(true);
  });

  it("requires an exact one-lot quantitative reconciliation, not merely matching position signs", () => {
    const oversizedPositions = passingJournal().map(item => item.seq === 5 ? { ...item, snapshot: snapshot([{ contractId: SHORT, quantity: -100 }, { contractId: LONG, quantity: 100 }]) } : item);
    expect(buildCertificate(inputs({ journal: oversizedPositions })).failures.some(item => item.includes("was not filled as exactly one lot"))).toBe(true);

    const fiveLotJournal = passingJournal().map(item => {
      if (item.seq === 3) return { ...item, quantity: 5 };
      if (item.seq === 4) return { ...item, filledQuantity: 5 };
      if (item.seq === 5) return { ...item, snapshot: snapshot([{ contractId: SHORT, quantity: -5 }, { contractId: LONG, quantity: 5 }]) };
      return item;
    });
    const fiveLotObservations = observations().map(item => ({ ...item, order: { ...item.order, quantity: 5, filledQuantity: item.order.status === "filled" ? 5 : 0 } }));
    expect(buildCertificate(inputs({ journal: fiveLotJournal, orderObservations: fiveLotObservations })).failures.some(item => item.includes("was not filled as exactly one lot"))).toBe(true);
  });

  it("a harness-canceled credit still counts as acceptance evidence, but only that accepted credit lifecycle can supply the fill", () => {
    const journal = passingJournal({ outcomeStatus: "canceled", reconciled: false });
    const canceled = buildCertificate(inputs({ journal, harnessCancels: ["entry:credit"], orderObservations: [{ observedAt: "t", order: order("accepted", false) }, { observedAt: "t", order: order("canceled", false) }] }));
    expect(canceled.evidence.creditAcceptance).toMatchObject({ terminalStatus: "canceled", harnessRequestedCancel: true });
    expect(canceled.verdict).toBe("FAIL");
    expect(canceled.failures.some(item => item.includes("was not filled as exactly one lot"))).toBe(true);
    const unrequested = buildCertificate(inputs({ journal, harnessCancels: [], orderObservations: [{ observedAt: "t", order: order("accepted", false) }] }));
    expect(unrequested.failures).toContain("credit lifecycle entry:credit was canceled without a harness request");

    const unrelatedDebit = [
      ...journal.filter(item => item.seq <= 5),
      entry(6, "INTENT", { action: "entry", clientOrderId: "entry:debit", exposureLifecycleId: "exposure:debit", sleeve: "tactical", structureType: "vertical_debit", legs: LEGS, quantity: 1, submittedLimit: { kind: "debit", priceCents: 20 }, reservedMaxLossCents: 2_000, gateVector: gateVector(true), rationale: { paidFrom: "tactical", snapshotReferences: ["x"], text: "SPY vertical_debit" }, binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT } }),
      entry(7, "OUTCOME", { clientOrderId: "entry:debit", status: "filled", brokerOrderId: "broker-debit", brokerTimestamps: { submitted_at: "2026-09-01T14:06:00.000Z", filled_at: "2026-09-01T14:06:05.000Z" }, filledQuantity: 1, avgFillPriceCents: 20, reasonCodes: [], binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT }, brokerReason: null }),
      entry(8, "CYCLE", { cycleIndex: 3, tradingDay: "2026-09-01", reasonCodes: [], snapshot: snapshot([{ contractId: SHORT, quantity: -1 }, { contractId: LONG, quantity: 1 }]), batchVerdicts: [], candidateVerdicts: [] }),
      entry(9, "HALT", { reason: "AUTH_FAILURE", detail: "x", sticky: false }),
      entry(10, "UNHALT", { actor: "human", operator: "certificate-driver", reason: "x" }),
    ];
    const unrelated = buildCertificate(inputs({ journal: unrelatedDebit, harnessCancels: ["entry:credit"], orderObservations: [{ observedAt: "t", order: order("accepted", false) }, { observedAt: "t", order: { ...order("canceled", false), brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z", canceled_at: "2026-09-01T14:03:05.000Z" } } }] }));
    expect(unrelated.verdict).toBe("FAIL");
    expect(unrelated.evidence.creditAcceptance).toMatchObject({ clientOrderId: "entry:credit" });
    expect(unrelated.evidence.fill).toBeNull();
  });

  it("any broker rejection — synchronous or asynchronous — makes the certificate FAIL (WIN-7)", () => {
    const rejected = buildCertificate(inputs({ journal: passingJournal({ outcomeStatus: "rejected", reconciled: false }) }));
    expect(rejected.verdict).toBe("FAIL");
    expect(rejected.failures.some(item => item.includes("broker rejection"))).toBe(true);
    expect(rejected.failures).toContain("credit lifecycle entry:credit was rejected by the broker");
    expect(rejected.evidence.creditAcceptance).toBeNull();
  });

  it("a fill that no later snapshot reconciles, a credit without a passed G5 verdict, or a missing quote sample all FAIL", () => {
    expect(buildCertificate(inputs({ journal: passingJournal({ reconciled: false }) })).failures.some(item => item.includes("was not filled as exactly one lot"))).toBe(true);
    expect(buildCertificate(inputs({ journal: passingJournal({ g5: false }) })).failures).toContain("the credit INTENT does not carry a passed G5 liquidity verdict");
    const noSamples = passingJournal().map(item => (item.seq === 2 ? { ...item, snapshot: { ...snapshot([]), quoteSamples: {} } } : item));
    expect(buildCertificate(inputs({ journal: noSamples })).failures).toContain("the snapshot consumed by the liquidity gate lacks a quote sample with sizes and timestamps for every credit leg");
  });

  it("gate findings G1-F1/G1-F2: a duplicate sample for one leg does not cover the other, and acceptance must precede the terminal instant", () => {
    const duplicated = passingJournal().map(item => (item.seq === 2 ? { ...item, snapshot: { ...snapshot([]), quoteSamples: { SPY: { [SHORT]: sample(50, 52) }, QQQ: { [SHORT]: sample(50, 52) } } } } : item));
    expect(buildCertificate(inputs({ journal: duplicated })).failures).toContain("the snapshot consumed by the liquidity gate lacks a quote sample with sizes and timestamps for every credit leg");
    const late = buildCertificate(inputs({ orderObservations: [{ observedAt: "2026-09-01T16:00:00.000Z", order: { ...order("accepted", false), brokerTimestamps: { submitted_at: "2026-09-01T16:00:00.000Z" } } }] }));
    expect(late.verdict).toBe("FAIL");
    expect(late.failures.some(item => item.includes("does not precede the terminal instant"))).toBe(true);
  });

  it("gate findings G2: instants are compared as instants, every clause lies inside the window, a credit needs a bought leg and G1, OUTCOME follows INTENT, reconciliation respects the leg sign", () => {
    // G2-F1: one millisecond late is late, whatever the textual precision.
    const lateByMs = buildCertificate(inputs({ orderObservations: [{ observedAt: "t", order: { ...order("accepted", false), brokerTimestamps: { submitted_at: "2026-09-01T14:03:05.001Z" } } }], journal: passingJournal().map(item => (item.seq === 4 ? { ...item, brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z", filled_at: "2026-09-01T14:03:05Z" } } : item)) }));
    expect(lateByMs.failures.some(item => item.includes("does not precede the terminal instant"))).toBe(true);
    // G2-F4a: evidence dated outside the window.
    const future = buildCertificate(inputs({ window: { startedAt: "2030-01-01T13:35:00.000Z", endedAt: "2030-01-01T15:10:00.000Z" } }));
    expect(future.verdict).toBe("FAIL");
    expect(future.failures.some(item => item.includes("outside the test window"))).toBe(true);
    // G2-F4b: a single-leg "credit" is not defined-risk.
    const naked = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [LEGS[0]] } : item));
    expect(buildCertificate(inputs({ journal: naked })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    const noG1 = passingJournal().map(item => (item.seq === 3 ? { ...item, gateVector: gateVector(true).map(gate => (gate.gate === "G1" ? { ...gate, passed: false } : gate)) } : item));
    expect(buildCertificate(inputs({ journal: noG1 })).failures.some(item => item.includes("passed G1"))).toBe(true);
    // G2-F4c: an OUTCOME that precedes its INTENT in the journal is not that lifecycle's outcome.
    const swapped = passingJournal().map(item => (item.seq === 3 ? { ...item, seq: 4 } : item.seq === 4 ? { ...item, seq: 3 } : item)).sort((a, b) => a.seq - b.seq);
    expect(buildCertificate(inputs({ journal: swapped })).verdict).toBe("FAIL");
    // G2-F4d: the reconciled position must carry the sign the leg side implies.
    const wrongSign = passingJournal().map(item => (item.seq === 5 ? { ...item, snapshot: snapshot([{ contractId: SHORT, quantity: 1 }, { contractId: LONG, quantity: 1 }]) } : item));
    expect(buildCertificate(inputs({ journal: wrongSign })).failures.some(item => item.includes("was not filled as exactly one lot"))).toBe(true);
    // A window that is textually well-formed but not a real instant is malformed.
    expect(buildCertificate(inputs({ window: { startedAt: "2026-02-30T13:35:00.000Z", endedAt: "2026-02-30T15:10:00.000Z" } })).failures).toContain("the test window is not a pair of ordered UTC instants");
  });

  it("gate findings G3: observations must agree on the submission instant, legs share underlying and expiry with balanced sides, quote instants lie inside the window", () => {
    const disagreeing = buildCertificate(inputs({ orderObservations: [...observations(), { observedAt: "t", order: { ...order("accepted", false), brokerTimestamps: { submitted_at: "2026-09-01T14:03:05.001Z" } } }] }));
    expect(disagreeing.failures.some(item => item.includes("disagree on the submission instant"))).toBe(true);
    const crossUnderlying = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [LEGS[0], { ...LEGS[1], contractId: "QQQ260904P00600000", underlying: "QQQ", right: "put" }] } : item));
    expect(buildCertificate(inputs({ journal: crossUnderlying })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    const crossExpiry = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [LEGS[0], { ...LEGS[1], expiry: "2026-09-11" }] } : item));
    expect(buildCertificate(inputs({ journal: crossExpiry })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    const twoSellsOneBuy = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [LEGS[0], LEGS[0], LEGS[1]] } : item));
    expect(buildCertificate(inputs({ journal: twoSellsOneBuy })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    const oldQuotes = passingJournal().map(item => (item.seq === 2 ? { ...item, snapshot: { ...snapshot([]), quoteSamples: { SPY: { [SHORT]: { ...sample(50, 52), quotedAt: "2025-09-01T14:00:00.000Z", brokerQuotedAt: "2025-09-01T14:00:00.123456789Z" }, [LONG]: sample(30, 32) } } } } : item));
    expect(buildCertificate(inputs({ journal: oldQuotes })).failures).toContain("a liquidity quote sample carries a timestamp outside the test window");
  });

  it("gate findings G4: broker timestamps are required, ratios must be covered per right, the recorded quote instant equals the broker's, the certificate carries a self-digest", () => {
    const noBrokerTimes = buildCertificate(inputs({ orderObservations: [{ observedAt: "2026-09-01T14:03:01.000Z", order: { ...order("accepted", false), brokerTimestamps: {} } }], journal: passingJournal().map(item => (item.seq === 4 ? { ...item, brokerTimestamps: {} } : item)) }));
    expect(noBrokerTimes.failures.some(item => item.includes("local times do not substitute"))).toBe(true);
    const ratioSpread = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [{ ...LEGS[0], ratio: 2 }, LEGS[1]] } : item));
    expect(buildCertificate(inputs({ journal: ratioSpread })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    const crossRight = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [LEGS[0], { ...LEGS[1], contractId: "SPY260904P00770000", right: "put" }] } : item));
    expect(buildCertificate(inputs({ journal: crossRight })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    const skewedQuote = passingJournal().map(item => (item.seq === 2 ? { ...item, snapshot: { ...snapshot([]), quoteSamples: { SPY: { [SHORT]: { ...sample(50, 52), brokerQuotedAt: "2026-09-01T14:30:00.000000000Z" }, [LONG]: sample(30, 32) } } } } : item));
    expect(buildCertificate(inputs({ journal: skewedQuote })).failures).toContain("a liquidity quote sample's recorded instant does not equal its broker timestamp");
    const certificate = buildCertificate(inputs());
    expect(certificate.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    const edited = JSON.parse(JSON.stringify(certificate)) as Record<string, unknown>;
    (edited["evidence"] as Record<string, unknown>)["liquidity"] = [{ ...(certificate.evidence.liquidity[0] as object), brokerQuotedAt: "2026-09-01T14:00:00.123456789Z" }, certificate.evidence.liquidity[1]];
    const verdict = validateArmingCertificate(edited, { runtimeDigest: DIGEST_A, policyDigest: DIGEST_B, canonicalTradingOrigin: ORIGIN });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.violations).toContain("certificate evidence digest mismatch: the certificate was edited after it was produced");
  });

  it("gate findings G5: an unrelated naked fill is no fill evidence, ratio sums are exact, blank identities are absent", () => {
    // A harness-canceled credit plus an unrelated single-leg fill must not PASS.
    const nakedFill = [
      ...passingJournal({ outcomeStatus: "canceled", reconciled: false }).filter(item => item.seq <= 5),
      entry(6, "INTENT", { action: "entry", clientOrderId: "entry:naked", exposureLifecycleId: "exposure:naked", sleeve: "income", structureType: "long_option", legs: [LEGS[0]], quantity: 1, submittedLimit: { kind: "credit", priceCents: 50 }, reservedMaxLossCents: 0, gateVector: gateVector(true), rationale: { paidFrom: "income_drift", snapshotReferences: ["x"], text: "SPY long_option" }, binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT } }),
      entry(7, "OUTCOME", { clientOrderId: "entry:naked", status: "filled", brokerOrderId: "broker-2", brokerTimestamps: { submitted_at: "2026-09-01T14:06:00.000Z", filled_at: "2026-09-01T14:06:05.000Z" }, filledQuantity: 1, avgFillPriceCents: 50, reasonCodes: [], binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT }, brokerReason: null }),
      entry(8, "CYCLE", { cycleIndex: 3, tradingDay: "2026-09-01", reasonCodes: [], snapshot: snapshot([{ contractId: SHORT, quantity: -1 }]), batchVerdicts: [], candidateVerdicts: [] }),
      entry(9, "HALT", { reason: "AUTH_FAILURE", detail: "x", sticky: false }),
      entry(10, "UNHALT", { actor: "human", operator: "certificate-driver", reason: "x" }),
    ];
    const canceledObservations = [{ observedAt: "t", order: order("accepted", false) }, { observedAt: "t", order: { ...order("canceled", false), brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z", canceled_at: "2026-09-01T14:03:05.000Z" } } }];
    const certificate = buildCertificate(inputs({ journal: nakedFill, orderObservations: canceledObservations, harnessCancels: ["entry:credit"] }));
    expect(certificate.verdict).toBe("FAIL");
    expect(certificate.evidence.fill).toBeNull();
    // Ratio sums are exact integers, never floating sums that round.
    const overflow = passingJournal().map(item => (item.seq === 3 ? { ...item, legs: [{ ...LEGS[0], ratio: Number.MAX_SAFE_INTEGER }, { ...LEGS[0], contractId: "SPY260904C00771000", ratio: 1 }, { ...LEGS[1], ratio: Number.MAX_SAFE_INTEGER }, { ...LEGS[1], contractId: "SPY260904C00773000", ratio: 2 }] } : item));
    expect(buildCertificate(inputs({ journal: overflow })).failures.some(item => item.includes("not defined-risk"))).toBe(true);
    // Blank identities are absent identities.
    const blankBroker = passingJournal().map(item => (item.seq === 4 ? { ...item, brokerOrderId: " " } : item));
    expect(buildCertificate(inputs({ journal: blankBroker })).evidence.fill).toBeNull();
    // At arming, an unrequested cancel never arms even with a recomputed self-digest.
    const passing = buildCertificate(inputs());
    const serialized = JSON.parse(JSON.stringify(passing)) as Record<string, unknown>;
    const evidence = serialized["evidence"] as Record<string, unknown>;
    const forged = { ...serialized, evidence: { ...evidence, creditAcceptance: { ...(evidence["creditAcceptance"] as Record<string, unknown>), terminalStatus: "canceled", harnessRequestedCancel: false } } };
    const verdict = validateArmingCertificate(forged, { runtimeDigest: DIGEST_A, policyDigest: DIGEST_B, canonicalTradingOrigin: ORIGIN });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.violations).toContain("certificate credit acceptance ended in a cancel the harness did not request");
  });

  it("the fence drill needs a 401/403 observation, a journaled AUTH_FAILURE halt, and the manual un-halt after it", () => {
    expect(buildCertificate(inputs({ fence: null })).failures).toContain("the credential-fence drill was not performed");
    expect(buildCertificate(inputs({ fence: { httpStatus: 500, workingOrdersAtFence: [], canceledAtFence: [] } })).failures.some(item => item.includes("HTTP 500"))).toBe(true);
    expect(buildCertificate(inputs({ journal: passingJournal({ fence: false }) })).failures).toContain("no AUTH_FAILURE halt was journaled by the fence drill");
    expect(buildCertificate(inputs({ journal: passingJournal({ unhalt: false }) })).failures.some(item => item.includes("was not cleared"))).toBe(true);
    expect(buildCertificate(inputs({ fence: { httpStatus: 401, workingOrdersAtFence: ["resting"], canceledAtFence: [] } })).failures).toContain("the fence drill left working order(s) without confirmed cancellation: resting");
  });

  it("the final snapshot must be flat, fully paginated, and on the bound account; the inventory must have been accepted; the window ordered", () => {
    const base = inputs();
    const final = base.finalSnapshot;
    if (final === null) throw new Error("fixture");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, positions: [{ contractId: SHORT, quantity: -1, avgEntryPriceCents: 0 }] } })).failures).toContain("the final snapshot holds 1 open position(s)");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, nonTerminalOrders: ["x"] } })).failures).toContain("the final snapshot holds 1 non-terminal order(s)");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, pagesComplete: false } })).failures).toContain("the final order history pagination is incomplete");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, consistentReads: 1 } })).failures).toContain("the final snapshot was not confirmed by two consecutive identical broker reads");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, accountId: "PA000000" } })).failures).toContain("the final snapshot reports a different account than the certificate binds");
    expect(buildCertificate(inputs({ finalSnapshot: null })).failures).toContain("no final fully paginated dev snapshot was taken");
    expect(buildCertificate(inputs({ mcpInventoryAccepted: false })).failures).toContain("the pinned MCP runtime/inventory verification did not pass");
    expect(buildCertificate(inputs({ window: { startedAt: "2026-09-01T16:00:00.000Z", endedAt: "2026-09-01T15:00:00.000Z" } })).failures).toContain("the test window is not a pair of ordered UTC instants");
    expect(buildCertificate(inputs({ tradingOrigin: "https://api.alpaca.markets" })).failures).toContain("the trading origin is not the canonical paper origin");
    expect(successfulDevLiveTestAt(buildCertificate(inputs({ finalSnapshot: null })))).toBeNull();
  });

  it("a retry judges only journal facts inside its own certificate window", () => {
    const historicalReject = { ...entry(0, "OUTCOME", { clientOrderId: "old", status: "rejected", brokerOrderId: "old", brokerTimestamps: {}, filledQuantity: 0, avgFillPriceCents: null, reasonCodes: [], binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT }, brokerReason: "old" }), at: "2026-08-31T14:00:00.000Z" } as JournalEntry;
    const certificate = buildCertificate(inputs({ journal: [historicalReject, ...passingJournal()] }));
    expect(certificate.verdict).toBe("PASS");
    expect(certificate.failures).toEqual([]);
  });
});

describe("S-ARM-01 — digests (WIN-17): identity switches preserve the proof, policy and code changes invalidate it", () => {
  const raw = validStartupConfig("C:\\state\\dev", "C:\\state\\dev-sink.jsonl", { EXPECTED_ACCOUNT_ID: ACCOUNT });

  it("classifies every known field exactly once and rejects unknown fields", () => {
    const classified = classifyConfig(raw);
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    expect(Object.keys(classified.identity).sort()).toEqual(["ALPACA_PROFILE", "EXPECTED_ACCOUNT_ID"]);
    expect(Object.keys(classified.deployment).sort()).toEqual(["BOOTSTRAP_DIAGNOSTIC_SINK", "STATE_DIR"]);
    expect(Object.keys(classified.policy)).toContain("FLATTEN_DATE");
    expect(classifyConfig({ ...raw, EXTRA_KNOB: 1 })).toEqual({ ok: false, unknownFields: ["EXTRA_KNOB"] });
  });

  it("the policy digest is identical for dev and competition identities and different deployment locations, and excludes every identity value", () => {
    const dev = policyDigest(raw, { canonicalTradingOrigin: ORIGIN });
    const competition = policyDigest({ ...raw, ALPACA_PROFILE: "competition", EXPECTED_ACCOUNT_ID: "PA999COMP", STATE_DIR: "D:\\state\\competition", BOOTSTRAP_DIAGNOSTIC_SINK: "D:\\state\\comp-sink.jsonl", PRE_ARM_CERTIFICATE: "evidence/pre-arm/x.json" }, { canonicalTradingOrigin: ORIGIN });
    expect(dev.ok && competition.ok && dev.digest === competition.digest).toBe(true);
    if (!dev.ok) return;
    expect(dev.material).not.toContain(ACCOUNT);
    expect(dev.material).not.toContain("C:\\\\state");
    expect(dev.material).toContain(`"fieldClassificationVersion":${String(CONFIG_FIELD_CLASSIFICATION_VERSION)}`);
    expect(dev.digest).toBe(createHash("sha256").update(dev.material, "utf8").digest("hex"));
  });

  it("a single policy value change, an unknown field, or a non-canonical origin changes or refuses the digest", () => {
    const base = policyDigest(raw, { canonicalTradingOrigin: ORIGIN });
    const changed = policyDigest({ ...raw, MAX_CANDIDATE_QTY: 6 }, { canonicalTradingOrigin: ORIGIN });
    expect(base.ok && changed.ok && base.digest !== changed.digest).toBe(true);
    const changedModel = policyDigest({ ...raw, ANALYST_MODEL: "claude-opus-5" }, { canonicalTradingOrigin: ORIGIN });
    expect(base.ok && changedModel.ok && base.digest !== changedModel.digest).toBe(true);
    expect(policyDigest({ ...raw, EXTRA: true }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    // Gate finding G1-F3: undefined never collides with null.
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: undefined }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    const withNull = policyDigest({ ...raw, MAX_CANDIDATE_QTY: null }, { canonicalTradingOrigin: ORIGIN });
    expect(withNull.ok && base.ok && withNull.digest !== base.digest).toBe(true);
    expect(() => canonicalJson({ a: undefined })).toThrow(RangeError);
    // G2-F3: NaN and infinities never collide with null either.
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: Number.NaN }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: Number.POSITIVE_INFINITY }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(() => canonicalJson([Number.NaN])).toThrow(RangeError);
    // G3-N3: boxed primitives, functions, and exotic objects are not canonical; the string "NaN" is.
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: new Number(Number.NaN) }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: () => 5 }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: new Date(0) }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: "NaN" }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(true);
    // G4-K3: Map, Set, RegExp, class instances, and null-prototype objects are not records.
    expect(policyDigest({ ...raw, UNDERLYING_UNIVERSE: new Map([["x", 1]]) }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, UNDERLYING_UNIVERSE: [1, new Set([1])] }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: /x/ }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: Object.create(null) as object }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
    expect(policyDigest({ ...raw, MAX_CANDIDATE_QTY: { nested: { deep: [1, "two", null, true] } } }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(true);
    expect(policyDigest({ ...raw, ALPACA_TRADING_ORIGIN: "https://api.alpaca.markets" }, { canonicalTradingOrigin: ORIGIN }).ok).toBe(false);
  });

  it("the runtime digest covers file contents and the analyst runtime identity, sorted by path, and rejects malformed input", () => {
    const analystRuntime = { lockSha256: DIGEST_A, manifestSha256: DIGEST_B, sourceRepository: "https://github.com/alpacahq/alpaca-mcp-server.git", sourceCommit: "872abbf28dab6cdde7d341fc13ac139b8002d1d9", packageName: "alpaca-mcp-server", packageVersion: "2.3.0", interpreterLauncherSha256: DIGEST_A, interpreterRuntimeSha256: DIGEST_B, launchArtifactsSha256: DIGEST_A };
    const files = [{ path: "src/core/decision.ts", sha256: DIGEST_A }, { path: "config/policy.json", sha256: DIGEST_B }];
    const one = runtimeDigest({ files, analystRuntime });
    const reordered = runtimeDigest({ files: [...files].reverse(), analystRuntime });
    const edited = runtimeDigest({ files: [{ path: "src/core/decision.ts", sha256: DIGEST_B }, files[1] as { path: string; sha256: string }], analystRuntime });
    const lockDrift = runtimeDigest({ files, analystRuntime: { ...analystRuntime, lockSha256: DIGEST_B } });
    expect(one.ok && reordered.ok && one.digest === reordered.digest).toBe(true);
    expect(one.ok && edited.ok && one.digest !== edited.digest).toBe(true);
    expect(one.ok && lockDrift.ok && one.digest !== lockDrift.digest).toBe(true);
    expect(runtimeDigest({ files: [], analystRuntime }).ok).toBe(false);
    expect(runtimeDigest({ files: [files[0] as { path: string; sha256: string }, files[0] as { path: string; sha256: string }], analystRuntime }).ok).toBe(false);
    expect(runtimeDigest({ files, analystRuntime: { ...analystRuntime, launchArtifactsSha256: "short" } }).ok).toBe(false);
    expect(runtimeDigest({ files, analystRuntime: { ...analystRuntime, sourceRepository: undefined as unknown as string } }).ok).toBe(false);
    expect(runtimeDigest({ files, analystRuntime: { ...analystRuntime, sourceRepository: "" } }).ok).toBe(false);
  });

  it("the core's SHA-256 and canonical JSON agree with node:crypto on the vectors the digests depend on", () => {
    for (const text of ["", "abc", "{\"a\":1}", "\u00e9\u2192\ud834\udd1e", "x".repeat(1000)]) expect(sha256Text(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(canonicalJson({ b: [1, { d: null, c: "x" }], a: true })).toBe("{\"a\":true,\"b\":[1,{\"c\":\"x\",\"d\":null}]}");
  });
});

describe("S-ARM-01 / S-CYC-11 — arming validation (WIN-7, WIN-10): only an intact PASS certificate with matching digests arms", () => {
  const certificate = buildCertificate(inputs());
  const expectations = { runtimeDigest: DIGEST_A, policyDigest: DIGEST_B, canonicalTradingOrigin: ORIGIN };

  it("accepts the certificate the core produced and derives successful_dev_live_test_at from it", () => {
    expect(validateArmingCertificate(JSON.parse(JSON.stringify(certificate)), expectations)).toEqual({ ok: true, successfulDevLiveTestAt: "2026-09-01T15:10:00.000Z" });
  });

  it("refuses a runtime or policy digest mismatch, a FAIL verdict, a tampered or extended document, and a foreign origin", () => {
    const serialized = JSON.parse(JSON.stringify(certificate)) as Record<string, unknown>;
    const violationsOf = (raw: unknown, override = expectations): readonly string[] => {
      const verdict = validateArmingCertificate(raw, override);
      return verdict.ok ? [] : verdict.violations;
    };
    expect(violationsOf(serialized, { ...expectations, runtimeDigest: DIGEST_B })).toContain("runtimeDigest mismatch: a covered runtime change invalidates the certificate");
    expect(violationsOf(serialized, { ...expectations, policyDigest: DIGEST_A })).toContain("policyDigest mismatch: a role-neutral policy change invalidates the certificate");
    expect(violationsOf({ ...serialized, verdict: "FAIL" })).toContain("certificate verdict is not PASS");
    expect(violationsOf({ ...serialized, failures: ["x"] })).toContain("certificate carries failures");
    expect(violationsOf({ ...serialized, verdict: "FAIL" })).toContain("certificate evidence digest mismatch: the certificate was edited after it was produced");
    expect(violationsOf({ ...serialized, failures: ["x"] })).toContain("certificate evidence digest mismatch: the certificate was edited after it was produced");
    expect(violationsOf({ ...serialized, manual: true })).toContain("certificate schema mismatch: unexpected or missing fields");
    expect(violationsOf({ ...serialized, fieldClassificationVersion: CONFIG_FIELD_CLASSIFICATION_VERSION + 1 })).toContain("certificate field-classification version differs from this build");
    expect(violationsOf({ ...serialized, tradingOrigin: "https://api.alpaca.markets" })).toContain("certificate origin is not the canonical paper origin");
    expect(violationsOf({ ...serialized, role: "competition" })).toContain("certificate role is not the dev role");
    expect(violationsOf(buildCertificate(inputs({ finalSnapshot: null })))).toContain("certificate verdict is not PASS");
    expect(violationsOf("not an object")).toEqual(["certificate is not an object"]);
    // Gate finding G1-F4: the nested structure is validated, not only the top-level keys.
    expect(violationsOf({ ...serialized, evidence: null })).toContain("certificate evidence is malformed");
    expect(violationsOf({ ...serialized, evidence: { ...(serialized["evidence"] as Record<string, unknown>), fill: null } })).toContain("certificate fill evidence is absent or malformed");
    expect(violationsOf({ ...serialized, accountId: "" })).toContain("certificate account ID is malformed");
    expect(violationsOf({ ...serialized, window: { startedAt: "2026-09-01T13:35:00.000Z", endedAt: "not-an-iso" } })).toContain("certificate window is malformed");
    expect(violationsOf({ ...serialized, window: { startedAt: "2026-09-01T16:00:00.000Z", endedAt: "2026-09-01T15:10:00.000Z" } })).toContain("certificate window is malformed");
    expect(violationsOf({ ...serialized, failures: { "0": "failure", length: 1 } })).toContain("certificate failures is not an array");
    // G2-F2: the window must denote real instants; empty clause objects are not evidence; the final snapshot must be flat.
    expect(violationsOf({ ...serialized, window: { startedAt: "2026-02-30T13:35:00.000Z", endedAt: "2026-02-30T15:10:00.000Z" } })).toContain("certificate window is malformed");
    expect(violationsOf({ ...serialized, evidence: { liquidity: [{}], creditAcceptance: {}, fill: {}, fence: {}, finalSnapshot: {} } })).toContain("certificate fill evidence is absent or malformed");
    const evidence = serialized["evidence"] as Record<string, unknown>;
    expect(violationsOf({ ...serialized, evidence: { ...evidence, finalSnapshot: { ...(evidence["finalSnapshot"] as Record<string, unknown>), positionCount: 1 } } })).toContain("certificate final snapshot is not flat, stable, and fully paginated");
    expect(violationsOf({ ...serialized, evidence: { ...evidence, fence: { ...(evidence["fence"] as Record<string, unknown>), httpStatus: 500 } } })).toContain("certificate fence evidence is not a credential rejection");
    // G3-N2: clause fields are typed, and every evidence instant must lie inside the certificate window.
    expect(violationsOf({ ...serialized, evidence: { ...evidence, fill: { ...(evidence["fill"] as Record<string, unknown>), filledQuantity: "1" } } })).toContain("certificate fill.filledQuantity has the wrong type");
    expect(violationsOf({ ...serialized, window: { startedAt: "2030-01-01T13:35:00.000Z", endedAt: "2030-01-01T15:10:00.000Z" } })).toContain("certificate fill.filledAt lies outside the certificate window");
    expect(violationsOf({ ...serialized, evidence: { ...evidence, fence: { ...(evidence["fence"] as Record<string, unknown>), canceledAtFence: [1] } } })).toContain("certificate fence.canceledAtFence has the wrong type");
    // G4-K2: typed but semantically impossible values do not arm (and every edit trips the self-digest as well).
    const withEdit = (clause: string, patch: Record<string, unknown>): readonly string[] => violationsOf({ ...serialized, evidence: { ...evidence, [clause]: { ...(evidence[clause] as Record<string, unknown>), ...patch } } });
    expect(withEdit("fill", { filledQuantity: -1 })).toContain("certificate fill quantity or price is not a real fill");
    expect(withEdit("finalSnapshot", { accountId: "DIFFERENT-ACCOUNT" })).toContain("certificate final snapshot is not on the certificate's account or was not paginated");
    expect(withEdit("creditAcceptance", { terminalStatus: "forged-terminal" })).toContain("certificate credit acceptance states are not the positive/terminal states S-ARM-01 names");
    expect(withEdit("creditAcceptance", { intentSeq: 9 })).toContain("certificate credit acceptance sequence is not ordered");
    expect(withEdit("fill", { clientOrderId: "entry:other" })).toContain("certificate fill is not the accepted credit lifecycle and broker order");
    expect(withEdit("fill", { brokerOrderId: "broker-other" })).toContain("certificate fill is not the accepted credit lifecycle and broker order");
    expect(withEdit("fence", { unhaltSeq: 1 })).toContain("certificate fence sequence is not ordered");
    expect(withEdit("fill", { filledQuantity: -1 })).toContain("certificate evidence digest mismatch: the certificate was edited after it was produced");
  });
});
