// S-J-09 — the judge-facing performance projection is a pure fold over one
// committed journal revision and an explicit cutoff (WIN-1's S-J-09 half):
// entries newer than the cutoff are rejected; start equity is the BOOTSTRAP's
// broker-recorded value checked against INITIAL_CAPITAL; realized and
// unrealized P&L are joined to INTENT lifecycles through journaled fills and
// quote samples; the S-CYC-06 emergency close links to its AUDIT_GAP
// reconciliation; whatever does not reconcile is UNATTRIBUTED; milestones not
// yet observed are null. Also the S-CYC-12 projection over the same fold.
import { describe, expect, it } from "vitest";
import { validateJournalEntry } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { assessFreshness, projectPerformance, splitAtCutoff } from "../src/core/projection.js";
import type { ProjectionExpectations } from "../src/core/projection.js";
import { projectQualification, qualifyingFills } from "../src/core/qualification.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_ORIGIN, bootstrapEntry, cycleEntry, intentEntry, journalSnapshot } from "./journal-fixtures.js";

const CONTRACT = "SPY260904C00500000";
const BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID };
const COMPETITION_BINDING = { ...BINDING, profile: "competition" };

function at(minutes: number): string {
  return `2026-08-31T${String(13 + Math.trunc(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00.000Z`;
}

function outcomeEntry(seq: number, clientOrderId: string, minutes: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return { seq, at: at(minutes), epoch: 1, type: "OUTCOME", clientOrderId, status: "filled", brokerOrderId: `broker-${String(seq)}`, brokerTimestamps: { filled_at: at(minutes) }, filledQuantity: 1, avgFillPriceCents: 101, reasonCodes: [], binding: BINDING, ...overrides } as unknown as JournalEntry;
}

function closeIntentEntry(seq: number, minutes: number, overrides: Record<string, unknown> = {}): JournalEntry {
  return {
    seq, at: at(minutes), epoch: 1, type: "INTENT", action: "close", clientOrderId: "close:exposure-1:ordinary:0", exposureLifecycleId: "exposure-1", closeLifecycleId: "close:exposure-1:ordinary", route: "ordinary", generation: 0,
    legs: [{ contractId: CONTRACT, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call", side: "sell", ratio: 1 }],
    quantity: 1, submittedLimit: { kind: "credit", priceCents: 114 }, reason: "take profit", binding: BINDING, ...overrides,
  } as unknown as JournalEntry;
}

const VETO_VERDICT = {
  candidateId: "candidate-naked", candidateRationale: "SPY naked short call — vetoed.", decision: "VETO", reservedMaxLossCents: null,
  gateVector: [{ gate: "G1", passed: false, code: "DEFINED_RISK", reasons: ["uncovered short leg"] }, { gate: "G2", passed: true, code: "PASS", reasons: [] }],
};
const PASS_VERDICT = { candidateId: "candidate-long", candidateRationale: "SPY long call.", decision: "PASS", reservedMaxLossCents: 10_100, gateVector: [{ gate: "G1", passed: true, code: "PASS", reasons: [] }] };

/**
 * The fixture journal: bootstrap at $100,000; one vetoed and one approved
 * candidate; the approved long call fills at 1.01 (cash -10,100), marks at
 * 1.10/1.12 (+1,000 unrealized), closes at 1.15 (+1,400 realized); a second
 * long call fills at 1.01 and is emergency-closed at 0.90 while the journal
 * is down (-1,100 realized, linked only to the AUDIT_GAP reconciliation);
 * then the Friday deadline and terminal entries. Every equity figure is the
 * exact broker-side consequence, so the fold must reconcile to the cent.
 */
function fixtureJournal(): readonly JournalEntry[] {
  const quotes = (bid: number, ask: number) => ({ SPY: { [CONTRACT]: { bidCents: bid, askCents: ask, bidSize: 20, askSize: 20, quotedAt: at(0), brokerQuotedAt: at(0) } } });
  return [
    bootstrapEntry(1, { at: at(0) }),
    cycleEntry(2, { at: at(15), cycleIndex: 1, snapshot: journalSnapshot({ snapshotAt: at(15), quoteSamples: quotes(100, 102) }), candidateVerdicts: [VETO_VERDICT, PASS_VERDICT] }),
    intentEntry(3, { at: at(16), clientOrderId: "entry-1", exposureLifecycleId: "exposure-1", binding: BINDING }),
    outcomeEntry(4, "entry-1", 17),
    cycleEntry(5, { at: at(30), cycleIndex: 2, snapshot: journalSnapshot({ snapshotAt: at(30), cashCents: 9_989_900, equityCents: 10_001_000, positions: [{ contractId: CONTRACT, quantity: 1, avgEntryPriceCents: 101 }], quoteSamples: quotes(110, 112) }) }),
    closeIntentEntry(6, 31),
    outcomeEntry(7, "close:exposure-1:ordinary:0", 32, { avgFillPriceCents: 115 }),
    cycleEntry(8, { at: at(45), cycleIndex: 3, snapshot: journalSnapshot({ snapshotAt: at(45), cashCents: 10_001_400, equityCents: 10_001_400, quoteSamples: quotes(110, 112) }) }),
    intentEntry(9, { at: at(46), clientOrderId: "entry-2", exposureLifecycleId: "exposure-2", binding: BINDING }),
    outcomeEntry(10, "entry-2", 47),
    {
      seq: 11, at: at(60), epoch: 1, type: "RECONCILIATION", reasonCodes: ["AUDIT_GAP_EMERGENCY_CLOSE"],
      items: [{ kind: "emergency_close", attemptId: "close:exposure-2:emergency:0", closeLifecycleId: "close:exposure-2:emergency", exposureLifecycleId: "exposure-2", generation: 0, legs: [{ contractId: CONTRACT, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call", side: "sell", ratio: 1 }], quantity: 1, submittedLimit: { kind: "credit", priceCents: 90 }, brokerOrderId: "broker-em", status: "filled", filledQuantity: 1, avgFillPriceCents: 90, brokerTimestamps: {}, journalFailureClass: "APPEND_UNAVAILABLE", priorIntent: "NONE_DURABLE: the journal could not be appended when this risk-reducing close was submitted" }],
    } as unknown as JournalEntry,
    cycleEntry(12, { at: at(75), cycleIndex: 4, snapshot: journalSnapshot({ snapshotAt: at(75), cashCents: 10_000_300, equityCents: 10_000_300, quoteSamples: quotes(110, 112) }) }),
    { seq: 13, at: "2026-09-04T15:00:00.000Z", epoch: 1, type: "DEADLINE_RECONCILIATION", reasonCodes: [], snapshot: journalSnapshot({ snapshotAt: "2026-09-04T15:00:00.000Z", cashCents: 10_000_300, equityCents: 10_000_300 }), reference: "sha256:deadbeef" } as unknown as JournalEntry,
    { seq: 14, at: "2026-09-04T20:00:00.000Z", epoch: 1, type: "TERMINAL", reasonCodes: [], snapshot: journalSnapshot({ snapshotAt: "2026-09-04T20:00:00.000Z", cashCents: 10_000_300, equityCents: 10_000_300 }) } as unknown as JournalEntry,
  ];
}

const EXPECTATIONS: ProjectionExpectations = { initialCapitalCents: 10_000_000, expectedAccountId: TEST_ONLY_ACCOUNT_ID, flattenDate: "2026-09-03", profile: "dev", qualification: null };
const PRESENTATION = { at: at(75), kind: "presentation" as const };
const DEADLINE = { at: "2026-09-04T20:00:00.000Z", kind: "deadline" as const };

describe("S-J-09 — the fixture journal validates against the closed schemas", () => {
  it("every fixture entry is a valid journal entry (the fold is tested on real shapes, not on a private dialect)", () => {
    for (const entry of fixtureJournal()) {
      const verdict = validateJournalEntry(entry);
      expect(verdict.ok, `seq ${String(entry.seq)}: ${verdict.ok ? "" : verdict.reason}`).toBe(true);
    }
  });
});

describe("S-J-09 — one revision, one explicit cutoff", () => {
  it("rejects entries newer than the cutoff and counts them; the deadline cutoff folds them", () => {
    const presentation = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, EXPECTATIONS);
    expect(presentation.entriesFolded).toBe(12);
    expect(presentation.entriesBeyondCutoff).toBe(2);
    expect(presentation.lastSeq).toBe(12);
    expect(presentation.milestones.deadlineAt).toBeNull();
    expect(presentation.milestones.terminalAt).toBeNull();
    const deadline = projectPerformance(fixtureJournal(), "rev-A", DEADLINE, EXPECTATIONS);
    expect(deadline.entriesFolded).toBe(14);
    expect(deadline.entriesBeyondCutoff).toBe(0);
    expect(deadline.milestones.deadlineAt).toBe("2026-09-04T15:00:00.000Z");
    expect(deadline.milestones.terminalAt).toBe("2026-09-04T20:00:00.000Z");
    expect(splitAtCutoff(fixtureJournal(), -1).folded).toEqual([]);
  });

  it("names the revision, cutoff kind, submitted account ID, and the broker-recorded start equity checked against INITIAL_CAPITAL", () => {
    const projection = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, EXPECTATIONS);
    expect(projection.journalRevision).toBe("rev-A");
    expect(projection.cutoff).toEqual(PRESENTATION);
    expect(projection.accountId).toBe(TEST_ONLY_ACCOUNT_ID);
    expect(projection.startEquityCents).toBe(10_000_000);
    expect(projection.startEquityMatchesInitialCapital).toBe(true);
    const wrongCapital = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, { ...EXPECTATIONS, initialCapitalCents: 9_999_999 });
    expect(wrongCapital.startEquityMatchesInitialCapital).toBe(false);
    expect(wrongCapital.discrepancies.some(item => item.startsWith("START_EQUITY_NOT_INITIAL_CAPITAL"))).toBe(true);
    const wrongAccount = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, { ...EXPECTATIONS, expectedAccountId: "PA_OTHER" });
    expect(wrongAccount.discrepancies.some(item => item.startsWith("ACCOUNT_ID_UNEXPECTED"))).toBe(true);
  });

  it("reconciles absolute and percentage P&L, realized and unrealized, and the sleeve attribution back to the joined broker components", () => {
    const mid = projectPerformance(fixtureJournal(), "rev-A", { at: at(30), kind: "presentation" }, EXPECTATIONS);
    // One open long call filled at 1.01, marked at mid 1.11: unrealized +1,000; nothing realized yet.
    expect(mid.currentEquityCents).toBe(10_001_000);
    expect(mid.pnlAbsoluteCents).toBe(1_000);
    expect(mid.pnlBps).toBe(1); // 0.01%
    expect(mid.realizedCents).toBe(0);
    expect(mid.unrealizedCents).toBe(1_000);
    expect(mid.unattributedCents).toBe(0);
    expect(mid.sleeves.convex).toMatchObject({ realizedCents: 0, unrealizedCents: 1_000, budgetAtRiskCents: 10_100, lifecycleCount: 1 });
    expect(mid.sleeves.income).toMatchObject({ realizedCents: 0, unrealizedCents: 0, budgetAtRiskCents: 0, lifecycleCount: 0 });
    expect(mid.flatState).toBe("not_flat");
    const end = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, EXPECTATIONS);
    // Closed at 1.15 (+1,400) and emergency-closed at 0.90 (-1,100): realized +300, nothing open, nothing unattributed.
    expect(end.realizedCents).toBe(300);
    expect(end.unrealizedCents).toBe(0);
    expect(end.pnlAbsoluteCents).toBe(300);
    expect(end.unattributedCents).toBe(0);
    expect(end.discrepancies).toEqual([]);
    expect(end.flatState).toBe("flat");
    expect(end.sleeves.convex).toMatchObject({ realizedCents: 300, unrealizedCents: 0, budgetAtRiskCents: 0, lifecycleCount: 2 });
  });

  it("tracks the running peak and maximum drawdown over the journaled equity series", () => {
    const projection = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, EXPECTATIONS);
    expect(projection.equitySeries.map(point => point.equityCents)).toEqual([10_000_000, 10_000_000, 10_001_000, 10_001_400, 10_000_300]);
    expect(projection.peakEquityCents).toBe(10_001_400);
    expect(projection.maxDrawdownCents).toBe(1_100);
    expect(projection.maxDrawdownBps).toBe(1);
  });

  it("links every ordinary lifecycle INTENT → OUTCOME → closes, and the emergency close only to its AUDIT_GAP reconciliation with no prior intent", () => {
    const projection = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, EXPECTATIONS);
    const [first, second] = projection.lifecycles;
    expect(first).toMatchObject({ exposureLifecycleId: "exposure-1", intentSeq: 3, outcomeSeq: 4, resolution: "filled", brokerOrderId: "broker-4", filledQuantity: 1, closedQuantity: 1, openQuantity: 0, realizedCents: 1_400 });
    expect(first?.closes).toMatchObject([{ attemptId: "close:exposure-1:ordinary:0", route: "ordinary", intentSeq: 6, outcomeSeq: 7, reconciliationSeq: null, cashCents: 11_500 }]);
    expect(second).toMatchObject({ exposureLifecycleId: "exposure-2", intentSeq: 9, outcomeSeq: 10, realizedCents: -1_100 });
    expect(second?.closes).toMatchObject([{ attemptId: "close:exposure-2:emergency:0", route: "emergency", intentSeq: null, outcomeSeq: null, reconciliationSeq: 11, status: "filled", cashCents: 9_000 }]);
    expect(projection.emergencyCloses).toHaveLength(1);
    expect(projection.emergencyCloses[0]?.reconciliationSeq).toBe(11);
  });

  it("keeps an unexplained equity delta visible as UNATTRIBUTED and a discrepancy; an open leg without a journaled quote is unattributed, never inferred", () => {
    const withFee = fixtureJournal().map(entry => (entry.seq === 12 ? { ...entry, snapshot: journalSnapshot({ snapshotAt: at(75), cashCents: 10_000_250, equityCents: 10_000_250 }) } : entry));
    const fee = projectPerformance(withFee, "rev-A", PRESENTATION, EXPECTATIONS);
    expect(fee.realizedCents).toBe(300);
    expect(fee.unattributedCents).toBe(-50);
    expect(fee.discrepancies).toEqual([expect.stringContaining("UNATTRIBUTED: -50")]);
    const noQuote = fixtureJournal().map(entry => (entry.seq === 5 ? { ...entry, snapshot: journalSnapshot({ snapshotAt: at(30), cashCents: 9_989_900, equityCents: 10_001_000, positions: [{ contractId: CONTRACT, quantity: 1, avgEntryPriceCents: 101 }], quoteSamples: {} }) } : entry));
    const blind = projectPerformance(noQuote, "rev-A", { at: at(30), kind: "presentation" }, EXPECTATIONS);
    expect(blind.unrealizedCents).toBeNull();
    expect(blind.lifecycles[0]?.unrealizedCents).toBeNull();
    expect(blind.unattributedCents).toBe(1_000);
    expect(blind.discrepancies.some(item => item.startsWith("UNREALIZED_UNATTRIBUTED: exposure-1"))).toBe(true);
    expect(blind.sleeves.convex.unrealizedCents).toBeNull();
    expect(blind.sleeves.convex.unrealizedUnattributedLifecycles).toEqual(["exposure-1"]);
  });

  it("reports every cycle's proposal or no-trade result with its gate vector, and the milestones actually observed (future ones null)", () => {
    const projection = projectPerformance(fixtureJournal(), "rev-A", PRESENTATION, EXPECTATIONS);
    expect(projection.cycles.map(cycle => [cycle.seq, cycle.result])).toEqual([[1, "bootstrap"], [2, "proposal"], [5, "no_trade"], [8, "proposal"], [12, "no_trade"]]);
    expect(projection.cycles[1]?.candidateVerdicts).toHaveLength(2);
    expect(projection.cycles[1]?.intentSeqs).toEqual([3]);
    expect(projection.cycles[2]?.closeIntentSeqs).toEqual([6]);
    expect(projection.milestones).toEqual({ firstArmAt: at(0), firstTradeAt: at(17), flattenAt: null, deadlineAt: null, terminalAt: null });
    const deadline = projectPerformance(fixtureJournal(), "rev-A", DEADLINE, EXPECTATIONS);
    expect(deadline.milestones.flattenAt).toBeNull(); // no entry carries a trading day on or after FLATTEN_DATE in this fixture
  });

  it("projects the halt state and reports a fold failure instead of guessing", () => {
    const orphanOutcome = [...fixtureJournal().slice(0, 2), outcomeEntry(3, "never-intended", 20)];
    const projection = projectPerformance(orphanOutcome, "rev-A", PRESENTATION, EXPECTATIONS);
    expect(projection.foldFailure).toContain("references no INTENT");
    expect(projection.discrepancies[0]).toMatch(/^FOLD_FAILED/u);
    expect(projection.lifecycles).toEqual([]);
    expect(projection.halt.halted).toBe(false);
  });
});

describe("S-J-07 — freshness is stated relative to the render instant", () => {
  it("fresh within one cycle interval, lagging within the dead-man bound, stale beyond it, stale without any entry", () => {
    const last = at(75);
    const lastMs = Date.parse(last);
    expect(assessFreshness(last, lastMs + 60_000, 900_000, 3_000_000).state).toBe("fresh");
    expect(assessFreshness(last, lastMs + 1_000_000, 900_000, 3_000_000).state).toBe("lagging");
    expect(assessFreshness(last, lastMs + 4_000_000, 900_000, 3_000_000).state).toBe("stale");
    expect(assessFreshness(null, lastMs, 900_000, 3_000_000)).toMatchObject({ state: "stale", ageMs: null });
  });
});

describe("S-CYC-12 — the qualification projection over the same fold", () => {
  const config = { checkpointMs: Date.parse(at(70)), windowEndMs: Date.parse(at(120)), maxLossCents: 50_000 };

  it("a dev-profile fill is not a qualifying activity; a competition-profile entry fill joined to INTENT and OUTCOME is", () => {
    expect(qualifyingFills(fixtureJournal())).toEqual([]);
    const competition = fixtureJournal().map(entry => (entry.type === "INTENT" && entry["action"] !== "close" ? { ...entry, binding: COMPETITION_BINDING } : entry));
    const fills = qualifyingFills(competition);
    expect(fills.map(fill => [fill.clientOrderId, fill.intentSeq, fill.outcomeSeq])).toEqual([["entry-1", 3, 4], ["entry-2", 9, 10]]);
    expect(projectQualification(competition, Date.parse(at(75)), config, "competition")).toMatchObject({ state: "QUALIFIED", windowOpen: false });
  });

  it("NOT_DUE before the checkpoint, COMPETITIVENESS_AT_RISK from the checkpoint, WINNING_ACCEPTANCE_FAILED from the window end, NOT_APPLICABLE on dev", () => {
    const empty = [bootstrapEntry(1, { at: at(0) })];
    expect(projectQualification(empty, Date.parse(at(60)), config, "competition")).toMatchObject({ state: "NOT_DUE", windowOpen: false });
    expect(projectQualification(empty, Date.parse(at(70)), config, "competition")).toMatchObject({ state: "COMPETITIVENESS_AT_RISK", windowOpen: true });
    expect(projectQualification(empty, Date.parse(at(120)), config, "competition")).toMatchObject({ state: "WINNING_ACCEPTANCE_FAILED", windowOpen: false });
    expect(projectQualification(empty, Date.parse(at(120)), config, "dev").state).toBe("NOT_APPLICABLE");
    expect(projectQualification(empty, Date.parse(at(120)), null, "competition").state).toBe("NOT_APPLICABLE");
    const projection = projectPerformance(empty, "rev-A", { at: at(80), kind: "latest" }, { ...EXPECTATIONS, profile: "competition", qualification: config });
    expect(projection.qualification.state).toBe("COMPETITIVENESS_AT_RISK");
  });

  it("a fill after the cutoff does not qualify the projection at that cutoff", () => {
    const competition = fixtureJournal().map(entry => (entry.type === "INTENT" && entry["action"] !== "close" ? { ...entry, binding: COMPETITION_BINDING } : entry));
    expect(projectQualification(competition, Date.parse(at(16)), { ...config, checkpointMs: Date.parse(at(10)) }, "competition").state).toBe("COMPETITIVENESS_AT_RISK");
  });
});
