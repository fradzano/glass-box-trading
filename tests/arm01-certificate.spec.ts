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
  return { bidCents: bid, askCents: ask, bidSize: 25, askSize: 30, quotedAt: "2026-09-01T14:00:00.000Z", brokerQuotedAt: "2026-09-01T14:00:00.123456789Z" };
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
    entry(4, "OUTCOME", { clientOrderId: "entry:credit", status: overrides.outcomeStatus ?? "filled", brokerOrderId: "broker-1", brokerTimestamps: { submitted_at: "2026-09-01T14:03:00.000Z", filled_at: "2026-09-01T14:03:05.000Z" }, filledQuantity: (overrides.outcomeStatus ?? "filled") === "filled" ? 1 : 0, avgFillPriceCents: (overrides.outcomeStatus ?? "filled") === "filled" ? 19 : null, reasonCodes: [], binding: { profile: "dev", tradingOrigin: ORIGIN, accountId: ACCOUNT }, brokerReason: null }),
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
    finalSnapshot: { at: "2026-09-01T15:09:00.000Z", accountId: ACCOUNT, cashCents: 10_000_100, equityCents: 10_000_100, positions: [], nonTerminalOrders: [], orderPagesFetched: 1, pagesComplete: true },
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
    expect(certificate.evidence.finalSnapshot).toMatchObject({ positionCount: 0, nonTerminalOrderCount: 0, pagesComplete: true, accountId: ACCOUNT });
    expect(successfulDevLiveTestAt(certificate)).toBe("2026-09-01T15:10:00.000Z");
    expect(certificate.fieldClassificationVersion).toBe(CONFIG_FIELD_CLASSIFICATION_VERSION);
  });

  it("a fill that outran the first observation still proves acceptance: the filled record is a positive broker state", () => {
    const certificate = buildCertificate(inputs({ orderObservations: [{ observedAt: "2026-09-01T14:03:06.000Z", order: order("filled", true) }] }));
    expect(certificate.verdict).toBe("PASS");
    expect(certificate.evidence.creditAcceptance).toMatchObject({ acceptedStatus: "filled", terminalStatus: "filled" });
    expect(buildCertificate(inputs({ orderObservations: [] })).failures).toContain("no credit entry lifecycle reached a positive broker acceptance followed by a filled or harness-canceled OUTCOME");
  });

  it("a harness-canceled credit still counts as acceptance evidence, but a fill from another entry is still required", () => {
    const journal = passingJournal({ outcomeStatus: "canceled", reconciled: false });
    const canceled = buildCertificate(inputs({ journal, harnessCancels: ["entry:credit"], orderObservations: [{ observedAt: "t", order: order("accepted", false) }, { observedAt: "t", order: order("canceled", false) }] }));
    expect(canceled.evidence.creditAcceptance).toMatchObject({ terminalStatus: "canceled", harnessRequestedCancel: true });
    expect(canceled.verdict).toBe("FAIL");
    expect(canceled.failures).toContain("no minimal defined-risk entry was filled and reconciled through a later broker snapshot");
    const unrequested = buildCertificate(inputs({ journal, harnessCancels: [], orderObservations: [{ observedAt: "t", order: order("accepted", false) }] }));
    expect(unrequested.failures).toContain("credit lifecycle entry:credit was canceled without a harness request");
  });

  it("any broker rejection — synchronous or asynchronous — makes the certificate FAIL (WIN-7)", () => {
    const rejected = buildCertificate(inputs({ journal: passingJournal({ outcomeStatus: "rejected", reconciled: false }) }));
    expect(rejected.verdict).toBe("FAIL");
    expect(rejected.failures.some(item => item.includes("broker rejection"))).toBe(true);
    expect(rejected.failures).toContain("credit lifecycle entry:credit was rejected by the broker");
    expect(rejected.evidence.creditAcceptance).toBeNull();
  });

  it("a fill that no later snapshot reconciles, a credit without a passed G5 verdict, or a missing quote sample all FAIL", () => {
    expect(buildCertificate(inputs({ journal: passingJournal({ reconciled: false }) })).failures).toContain("no minimal defined-risk entry was filled and reconciled through a later broker snapshot");
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
    expect(buildCertificate(inputs({ journal: wrongSign })).failures).toContain("no minimal defined-risk entry was filled and reconciled through a later broker snapshot");
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

  it("the fence drill needs a 401/403 observation, a journaled AUTH_FAILURE halt, and the manual un-halt after it", () => {
    expect(buildCertificate(inputs({ fence: null })).failures).toContain("the credential-fence drill was not performed");
    expect(buildCertificate(inputs({ fence: { httpStatus: 500, workingOrdersAtFence: [], canceledAtFence: [] } })).failures.some(item => item.includes("HTTP 500"))).toBe(true);
    expect(buildCertificate(inputs({ journal: passingJournal({ fence: false }) })).failures).toContain("no AUTH_FAILURE halt was journaled by the fence drill");
    expect(buildCertificate(inputs({ journal: passingJournal({ unhalt: false }) })).failures.some(item => item.includes("was not cleared"))).toBe(true);
  });

  it("the final snapshot must be flat, fully paginated, and on the bound account; the inventory must have been accepted; the window ordered", () => {
    const base = inputs();
    const final = base.finalSnapshot;
    if (final === null) throw new Error("fixture");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, positions: [{ contractId: SHORT, quantity: -1, avgEntryPriceCents: 0 }] } })).failures).toContain("the final snapshot holds 1 open position(s)");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, nonTerminalOrders: ["x"] } })).failures).toContain("the final snapshot holds 1 non-terminal order(s)");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, pagesComplete: false } })).failures).toContain("the final order history pagination is incomplete");
    expect(buildCertificate(inputs({ finalSnapshot: { ...final, accountId: "PA000000" } })).failures).toContain("the final snapshot reports a different account than the certificate binds");
    expect(buildCertificate(inputs({ finalSnapshot: null })).failures).toContain("no final fully paginated dev snapshot was taken");
    expect(buildCertificate(inputs({ mcpInventoryAccepted: false })).failures).toContain("the pinned MCP runtime/inventory verification did not pass");
    expect(buildCertificate(inputs({ window: { startedAt: "2026-09-01T16:00:00.000Z", endedAt: "2026-09-01T15:00:00.000Z" } })).failures).toContain("the test window is not a pair of ordered UTC instants");
    expect(buildCertificate(inputs({ tradingOrigin: "https://api.alpaca.markets" })).failures).toContain("the trading origin is not the canonical paper origin");
    expect(successfulDevLiveTestAt(buildCertificate(inputs({ finalSnapshot: null })))).toBeNull();
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
    expect(dev.material).toContain("\"fieldClassificationVersion\":1");
    expect(dev.digest).toBe(createHash("sha256").update(dev.material, "utf8").digest("hex"));
  });

  it("a single policy value change, an unknown field, or a non-canonical origin changes or refuses the digest", () => {
    const base = policyDigest(raw, { canonicalTradingOrigin: ORIGIN });
    const changed = policyDigest({ ...raw, MAX_CANDIDATE_QTY: 6 }, { canonicalTradingOrigin: ORIGIN });
    expect(base.ok && changed.ok && base.digest !== changed.digest).toBe(true);
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
    expect(violationsOf({ ...serialized, manual: true })).toContain("certificate schema mismatch: unexpected or missing fields");
    expect(violationsOf({ ...serialized, fieldClassificationVersion: 2 })).toContain("certificate field-classification version differs from this build");
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
    expect(violationsOf({ ...serialized, evidence: { ...evidence, finalSnapshot: { ...(evidence["finalSnapshot"] as Record<string, unknown>), positionCount: 1 } } })).toContain("certificate final snapshot is not flat and fully paginated");
    expect(violationsOf({ ...serialized, evidence: { ...evidence, fence: { ...(evidence["fence"] as Record<string, unknown>), httpStatus: 500 } } })).toContain("certificate fence evidence is not a credential rejection");
    // G3-N2: clause fields are typed, and every evidence instant must lie inside the certificate window.
    expect(violationsOf({ ...serialized, evidence: { ...evidence, fill: { ...(evidence["fill"] as Record<string, unknown>), filledQuantity: "1" } } })).toContain("certificate fill.filledQuantity has the wrong type");
    expect(violationsOf({ ...serialized, window: { startedAt: "2030-01-01T13:35:00.000Z", endedAt: "2030-01-01T15:10:00.000Z" } })).toContain("certificate fill.filledAt lies outside the certificate window");
    expect(violationsOf({ ...serialized, evidence: { ...evidence, fence: { ...(evidence["fence"] as Record<string, unknown>), canceledAtFence: [1] } } })).toContain("certificate fence.canceledAtFence has the wrong type");
  });
});
