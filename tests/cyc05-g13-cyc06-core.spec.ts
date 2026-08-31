import { describe, expect, it } from "vitest";
import { decide, parseAnalystOutput } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { EntryActionPlan } from "../src/core/domain.js";
import {
  assembleDecisionSnapshot,
  buildClaimset,
  classifyWorkingOrder,
  emergencyCloseEligibility,
  foldLifecycles,
  haltDraft,
  intentDraft,
  isBookFlat,
  killTriggered,
  planKillManagement,
  priceAndDecide,
  reconcileCancel,
  revalidateClaimset,
  revalidationVoidDraft,
  validateKillThreshold,
} from "../src/core/execution.js";
import type { BrokerBook, MarketObservation, RevalidationEvidence } from "../src/core/execution.js";
import { haltStateAfter, haltStateFrom, validateJournalEntry } from "../src/core/journal.js";
import type { JournalEntry, JournalSnapshot } from "../src/core/journal.js";
import { LONG_CALL, SHORT_CALL, TEST_ONLY_EXECUTION_CONFIG, book, brokerOrder, creditVertical, creditVerticalQuotes, position } from "./execution-fixtures.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, marketFor, snapshot } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_ORIGIN, cycleEntry, intentEntry, journalSnapshot } from "./journal-fixtures.js";

const BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;
const PASS_VECTOR = Array.from({ length: 8 }, (_, index) => ({ gate: `G${String(index + 1)}` as "G1", passed: true, code: "PASS" as const, reasons: [] }));

function seqd(entries: readonly Record<string, unknown>[]): readonly JournalEntry[] {
  return entries.map((entry, index) => {
    const validated = validateJournalEntry({ seq: index + 1, ...entry });
    if (!validated.ok) throw new Error(`fixture entry ${String(index + 1)} invalid: ${validated.reason}`);
    return validated.entry;
  });
}

function decisionMarket() {
  const value = creditVertical();
  const market = marketFor(value);
  return { value, market: { ...market, accountId: TEST_ONLY_ACCOUNT_ID, quotesByContract: { ...market.quotesByContract, ...creditVerticalQuotes() } } };
}

function approved(): { readonly plan: EntryActionPlan; readonly priced: ReturnType<typeof priceAndDecide>; readonly market: ReturnType<typeof decisionMarket>["market"] } {
  const { value, market } = decisionMarket();
  const priced = priceAndDecide(market, { kind: "candidates", candidates: [value] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
  const plan = priced.result.actions[0];
  if (plan === undefined) throw new Error("fixture plan vetoed");
  return { plan, priced, market };
}

/** Evidence for a fresh book: `decide` re-run with the INTENT already durable, so G7 vetoes while G1–G4 still pass. */
function evidenceFor(plan: EntryActionPlan, market: ReturnType<typeof decisionMarket>["market"], freshBook: BrokerBook, overrides: Partial<RevalidationEvidence> = {}): RevalidationEvidence {
  const candidate = creditVertical({ entryLimit: plan.submittedLimit });
  const fresh = { ...market, equityCents: integerUnit(freshBook.equityCents, "MoneyCents"), submittedOrderIds: [plan.clientOrderId] };
  return {
    book: freshBook,
    brokerReportedAccountId: freshBook.accountId,
    epoch: 1,
    halted: false,
    recheck: decide(fresh, { kind: "candidates", candidates: [candidate] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW),
    ...overrides,
  };
}

describe("S-CYC-05 pre-submit revalidation via typed claimset", () => {
  it("S-CYC-05 carries every claim the verdict rested on — account, kill predicate, positions, orders, epoch, halt, limit/reserve, G1–G4 — and passes when broker truth still agrees", () => {
    const { plan, market } = approved();
    const initial = book({ accountId: TEST_ONLY_ACCOUNT_ID });
    const claimset = buildClaimset(plan, initial, BINDING, 1, TEST_ONLY_EXECUTION_CONFIG);
    expect(claimset.claims.map(claim => claim.claim)).toEqual(["ACCOUNT_BOUND", "EQUITY_ABOVE_KILL_THRESHOLD", "POSITIONS_UNCHANGED", "OPEN_ORDERS_UNCHANGED", "CONTROL_EPOCH", "NOT_HALTED", "LIMIT_AND_RESERVE_UNCHANGED", "GATES_G1_G4_PASS"]);
    const evidence = evidenceFor(plan, market, initial);
    expect(evidence.recheck.candidateVerdicts[0]?.gateVector[6]).toMatchObject({ gate: "G7", passed: false });
    expect(revalidateClaimset(claimset, evidence)).toEqual({ ok: true });
  });

  it("S-CYC-05 / BEQ-3 a human trade, a fill meanwhile, a stale epoch, a halt, or a changed reserve voids the action and is journaled with claimset and violated claim (KGV-6)", () => {
    const { plan, market } = approved();
    const initial = book({ accountId: TEST_ONLY_ACCOUNT_ID });
    const claimset = buildClaimset(plan, initial, BINDING, 1, TEST_ONLY_EXECUTION_CONFIG);

    const humanTraded = revalidateClaimset(claimset, evidenceFor(plan, market, book({ accountId: TEST_ONLY_ACCOUNT_ID, positions: [position({ contractId: "QQQ260904P00400000", quantity: 5 })] })));
    expect(humanTraded).toMatchObject({ ok: false, killTriggered: false, violated: [{ claim: "POSITIONS_UNCHANGED" }] });

    const filledMeanwhile = revalidateClaimset(claimset, evidenceFor(plan, market, book({ accountId: TEST_ONLY_ACCOUNT_ID, openOrders: [brokerOrder({ clientOrderId: "entry:other", status: "partially_filled", filledQuantity: 1 })] })));
    expect(filledMeanwhile).toMatchObject({ ok: false, violated: [{ claim: "OPEN_ORDERS_UNCHANGED" }] });

    const staleEpoch = revalidateClaimset(claimset, evidenceFor(plan, market, initial, { epoch: 2 }));
    expect(staleEpoch).toMatchObject({ ok: false, violated: [{ claim: "CONTROL_EPOCH", epoch: 1 }] });
    expect(revalidateClaimset(claimset, evidenceFor(plan, market, initial, { epoch: null }))).toMatchObject({ ok: false });

    const halted = revalidateClaimset(claimset, evidenceFor(plan, market, initial, { halted: true }));
    expect(halted).toMatchObject({ ok: false, violated: [{ claim: "NOT_HALTED" }] });

    const foreignAccount = revalidateClaimset(claimset, evidenceFor(plan, market, book({ accountId: "PA_SOMEBODY_ELSE" }), { brokerReportedAccountId: "PA_SOMEBODY_ELSE" }));
    expect(foreignAccount.ok ? [] : foreignAccount.violated.map(claim => claim.claim)).toContain("ACCOUNT_BOUND");
    expect(revalidateClaimset(claimset, evidenceFor(plan, market, initial, { brokerReportedAccountId: undefined })).ok).toBe(false);

    // The reserve moved (a re-priced verdict) → LIMIT_AND_RESERVE_UNCHANGED; a sleeve consumed meanwhile → G2 fails on recheck.
    const evidence = evidenceFor(plan, market, initial);
    const differentReserve: RevalidationEvidence = { ...evidence, recheck: { ...evidence.recheck, candidateVerdicts: evidence.recheck.candidateVerdicts.map(verdict => ({ ...verdict, reservedMaxLossCents: integerUnit(1, "MoneyCents") })) } };
    expect(revalidateClaimset(claimset, differentReserve)).toMatchObject({ ok: false, violated: [{ claim: "LIMIT_AND_RESERVE_UNCHANGED" }] });
    const consumed = { ...market, submittedOrderIds: [plan.clientOrderId], exposureLifecycles: [{ exposureLifecycleId: "x", underlying: "SPY", sleeve: "income" as const, risk: [{ kind: "filled" as const, maxLossCents: TEST_ONLY_O5_CONFIG.incomeBudgetCents }] }] };
    const budgetGone: RevalidationEvidence = { ...evidence, recheck: decide(consumed, { kind: "candidates", candidates: [creditVertical({ entryLimit: plan.submittedLimit })] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW) };
    expect(revalidateClaimset(claimset, budgetGone)).toMatchObject({ ok: false, violated: [{ claim: "GATES_G1_G4_PASS" }] });

    const voided = revalidationVoidDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, claimset, humanTraded.ok ? [] : humanTraded.violated);
    expect(voided).toMatchObject({ type: "RECONCILIATION", reasonCodes: ["REVALIDATION_VOID"], items: [{ kind: "entry_order", classification: "REVALIDATION_VOID", claimset: claimset.claims, violated: [{ claim: "POSITIONS_UNCHANGED" }] }] });
    expect(validateJournalEntry({ seq: 3, ...voided })).toMatchObject({ ok: true });
    const intent = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: PASS_VECTOR }, market, BINDING);
    expect(foldLifecycles(seqd([intent, voided]))).toMatchObject({ ok: true, entries: [{ state: "canceled" }] });
  });

  it("S-CYC-05 / KGV-5 equity crossing the kill threshold between snapshot and submit voids the action AND reports the kill for the same cycle; equality does not trigger", () => {
    const { plan, market } = approved();
    const claimset = buildClaimset(plan, book({ accountId: TEST_ONLY_ACCOUNT_ID }), BINDING, 1, TEST_ONLY_EXECUTION_CONFIG);
    const crossed = revalidateClaimset(claimset, evidenceFor(plan, market, book({ accountId: TEST_ONLY_ACCOUNT_ID, equityCents: TEST_ONLY_EXECUTION_CONFIG.killEquityThresholdCents - 1 })));
    expect(crossed).toMatchObject({ ok: false, killTriggered: true, violated: [{ claim: "EQUITY_ABOVE_KILL_THRESHOLD", thresholdCents: 9_200_000 }] });
    const atThreshold = revalidateClaimset(claimset, evidenceFor(plan, market, book({ accountId: TEST_ONLY_ACCOUNT_ID, equityCents: TEST_ONLY_EXECUTION_CONFIG.killEquityThresholdCents })));
    expect(atThreshold).toEqual({ ok: true });
  });
});

describe("G13 drawdown kill-switch (pure decisions)", () => {
  it("S-G13-01 the predicate is strict <, the plan cancels risk-increasing working orders, adopts risk-reducing ones, flattens intact structures whole, and names residue; races reconcile by broker record", () => {
    expect(killTriggered(9_200_000, 9_200_000)).toBe(false);
    expect(killTriggered(9_199_999, 9_200_000)).toBe(true);

    const { plan, market } = approved();
    const intent = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: PASS_VECTOR }, market, BINDING);
    const filled = { at: TEST_ONLY_AT, epoch: 1, type: "OUTCOME", clientOrderId: plan.clientOrderId, status: "filled", brokerOrderId: "b-1", brokerTimestamps: {}, filledQuantity: 1, avgFillPriceCents: 198, reasonCodes: [], binding: BINDING, brokerReason: null };
    const fold = foldLifecycles(seqd([intent, filled]));
    if (!fold.ok) throw new Error(fold.reason);
    const held: BrokerBook = book({
      accountId: TEST_ONLY_ACCOUNT_ID,
      positions: [position({ contractId: SHORT_CALL, quantity: -1 }), position({ contractId: LONG_CALL, quantity: 1 }), position({ contractId: "SPY260904P00480000", quantity: 2 })],
      openOrders: [
        brokerOrder({ clientOrderId: "entry:2026-08-31:8:new", status: "accepted", legs: [{ contractId: "SPY260904C00510000", side: "buy", ratio: 1 }] }),
        brokerOrder({ clientOrderId: "close:existing:g0", status: "accepted", legs: [{ contractId: SHORT_CALL, side: "buy", ratio: 1 }, { contractId: LONG_CALL, side: "sell", ratio: 1 }] }),
        brokerOrder({ clientOrderId: "entry:done", status: "filled", filledQuantity: 1 }),
      ],
    });
    expect(classifyWorkingOrder(held.openOrders[0]!, held.positions)).toBe("risk_increasing");
    expect(classifyWorkingOrder(held.openOrders[1]!, held.positions)).toBe("risk_reducing");
    const plan13 = planKillManagement(held, fold.entries);
    expect(plan13.cancel).toEqual(["entry:2026-08-31:8:new"]);
    expect(plan13.adopt).toEqual(["close:existing:g0"]);
    expect(plan13.flatten).toEqual([{ exposureLifecycleId: plan.exposureLifecycleId, route: "kill", quantity: 1, closingLegs: [expect.objectContaining({ contractId: SHORT_CALL, side: "buy" }), expect.objectContaining({ contractId: LONG_CALL, side: "sell" })] }]);
    expect(plan13.residue).toEqual([{ contractId: "SPY260904P00480000", quantity: 2, avgEntryPriceCents: 300 }]);
    // A structure whose short leg was assigned away is not intact: it is residue, never legged out as a spread.
    const broken = planKillManagement({ ...held, positions: [position({ contractId: LONG_CALL, quantity: 1 })] }, fold.entries);
    expect(broken.flatten).toEqual([]);
    expect(broken.residue).toEqual([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 300 }]);

    expect(reconcileCancel(brokerOrder({ status: "canceled" }))).toBe("CANCELED");
    expect(reconcileCancel(brokerOrder({ status: "filled", filledQuantity: 1 }))).toBe("FILLED_DURING_CANCEL");
    expect(reconcileCancel(brokerOrder({ status: "canceled", filledQuantity: 1, quantity: 2 }))).toBe("PARTIALLY_FILLED_DURING_CANCEL");
    expect(reconcileCancel(brokerOrder({ status: "pending_cancel" }))).toBe("CANCEL_UNCLEAR");
    expect(reconcileCancel(null)).toBe("CANCEL_UNCLEAR");

    expect(isBookFlat(book())).toBe(true);
    expect(isBookFlat(book({ positions: [position()] }))).toBe(false);
    expect(isBookFlat(book({ openOrders: [brokerOrder({ status: "pending_cancel" })] }))).toBe(false);
    expect(isBookFlat(book({ positions: [position({ contractId: SHORT_CALL, quantity: -1 })], openOrders: [brokerOrder({ status: "accepted", legs: [{ contractId: SHORT_CALL, side: "buy", ratio: 1 }] })] }))).toBe(false);
    expect(isBookFlat(book({ openOrders: [brokerOrder({ status: "filled", filledQuantity: 1 })] }))).toBe(true);
  });

  it("S-G13-02 the threshold prices in the convex sleeve's planned decay: losing the full convex budget alone must not trigger", () => {
    expect(validateKillThreshold(TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_O5_CONFIG)).toEqual({ ok: true });
    expect(killTriggered(TEST_ONLY_EXECUTION_CONFIG.initialCapitalCents - TEST_ONLY_O5_CONFIG.convexBudgetCents, TEST_ONLY_EXECUTION_CONFIG.killEquityThresholdCents)).toBe(false);
    expect(validateKillThreshold({ ...TEST_ONLY_EXECUTION_CONFIG, killEquityThresholdCents: integerUnit(9_200_001, "MoneyCents") }, TEST_ONLY_O5_CONFIG)).toEqual({ ok: false, violations: ["KILL_THRESHOLD_IGNORES_CONVEX_DECAY"] });
    expect(validateKillThreshold({ ...TEST_ONLY_EXECUTION_CONFIG, killEquityThresholdCents: integerUnit(0, "MoneyCents") }, TEST_ONLY_O5_CONFIG)).toEqual({ ok: false, violations: ["KILL_THRESHOLD_NOT_POSITIVE"] });
  });

  it("S-G13-03 the kill halt is sticky: recovering equity or a human UNHALT does not clear it", () => {
    const halt = haltDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, "KILL", "equity below threshold");
    expect(validateJournalEntry({ seq: 1, ...halt })).toMatchObject({ ok: true, entry: { sticky: true } });
    const state = haltStateFrom(seqd([halt]));
    expect(state).toEqual({ halted: true, reason: "KILL", sticky: true });
    const afterUnhalt = haltStateAfter(state, seqd([halt, { at: TEST_ONLY_AT, epoch: 1, type: "UNHALT", operator: "felix", reason: "equity recovered", actor: "human" }])[1]!);
    expect(afterUnhalt).toEqual({ halted: true, reason: "KILL", sticky: true });
    const recovered = decide({ ...snapshot(), halt: true, equityCents: integerUnit(10_000_000, "MoneyCents") }, { kind: "candidates", candidates: [creditVertical()] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(recovered.actions).toEqual([]);
    expect(recovered.batchVerdicts).toContainEqual(expect.objectContaining({ code: "HALT" }));
  });
});

describe("S-CYC-06 the emergency exception is mechanically risk-reducing or nothing", () => {
  it("S-CYC-06 admits a whole close of a held structure or a held residue leg and refuses anything that opens, exceeds, or reverses", () => {
    const held = [position({ contractId: SHORT_CALL, quantity: -1 }), position({ contractId: LONG_CALL, quantity: 1 }), position({ contractId: "SPY260904P00480000", quantity: 2 })];
    expect(emergencyCloseEligibility(held, [{ contractId: SHORT_CALL, side: "buy", quantity: 1 }, { contractId: LONG_CALL, side: "sell", quantity: 1 }])).toEqual({ eligible: true });
    expect(emergencyCloseEligibility(held, [{ contractId: "SPY260904P00480000", side: "sell", quantity: 2 }])).toEqual({ eligible: true });
    expect(emergencyCloseEligibility([position({ contractId: SHORT_CALL, quantity: -3 })], [{ contractId: SHORT_CALL, side: "buy", quantity: 2 }])).toEqual({ eligible: true });
    expect(emergencyCloseEligibility(held, [{ contractId: SHORT_CALL, side: "buy", quantity: 1 }, { contractId: "SPY260904C00510000", side: "buy", quantity: 1 }])).toEqual({ eligible: false, reason: "OPENS_A_LEG" });
    expect(emergencyCloseEligibility(held, [{ contractId: SHORT_CALL, side: "sell", quantity: 1 }])).toEqual({ eligible: false, reason: "OPENS_A_LEG" });
    expect(emergencyCloseEligibility(held, [{ contractId: LONG_CALL, side: "sell", quantity: 2 }])).toEqual({ eligible: false, reason: "EXCEEDS_HELD_QUANTITY" });
    expect(emergencyCloseEligibility(held, [])).toEqual({ eligible: false, reason: "NO_LEGS" });
    expect(emergencyCloseEligibility(held, [{ contractId: LONG_CALL, side: "sell", quantity: 0 }])).toEqual({ eligible: false, reason: "QUANTITY_INVALID" });
    expect(emergencyCloseEligibility(held, [{ contractId: LONG_CALL, side: "sell", quantity: 1 }, { contractId: LONG_CALL, side: "sell", quantity: 1 }])).toEqual({ eligible: false, reason: "QUANTITY_INVALID" });
  });
});

describe("RES-P1-01 the adapter validates every shape before decide is reachable", () => {
  const market: MarketObservation = {
    quotesByContract: { [SHORT_CALL]: { bidCents: 300, askCents: 302, bidSize: 20, askSize: 20, quotedAtMs: TEST_ONLY_NOW, brokerQuotedAt: "2026-08-31T13:29:59.871234567Z" } },
    contractsById: { [SHORT_CALL]: { contractId: SHORT_CALL, underlying: "SPY", expiry: "2026-09-04", strikeCents: 50_000, right: "call" } },
    spotCentsByUnderlying: { SPY: 50_000 },
  };
  const base = { broker: book({ accountId: TEST_ONLY_ACCOUNT_ID }), market, journal: [] as readonly JournalEntry[], halt: false, profile: "dev" as const, calendar: snapshot().calendar, tradingDay: "2026-08-31", cycleIndex: 7 };

  it("RES-P1-01a a null or non-object contract record is rejected, and a quote for a contract outside the chain too", () => {
    expect(assembleDecisionSnapshot({ ...base, market: { ...market, contractsById: { [SHORT_CALL]: null } } })).toEqual({ ok: false, reason: `CONTRACT_INVALID:${SHORT_CALL}` });
    expect(assembleDecisionSnapshot({ ...base, market: { ...market, contractsById: { [SHORT_CALL]: "SPY" } } })).toEqual({ ok: false, reason: `CONTRACT_INVALID:${SHORT_CALL}` });
    expect(assembleDecisionSnapshot({ ...base, market: { ...market, contractsById: { [SHORT_CALL]: { ...(market.contractsById[SHORT_CALL] as object), strikeCents: 500.5 } } } })).toEqual({ ok: false, reason: `CONTRACT_INVALID:${SHORT_CALL}` });
    expect(assembleDecisionSnapshot({ ...base, market: { ...market, quotesByContract: { ...market.quotesByContract, [LONG_CALL]: market.quotesByContract[SHORT_CALL] } } })).toEqual({ ok: false, reason: `QUOTE_FOR_UNKNOWN_CONTRACT:${LONG_CALL}` });
    expect(assembleDecisionSnapshot({ ...base, market: { ...market, quotesByContract: { [SHORT_CALL]: { bidCents: -1 } } } })).toEqual({ ok: false, reason: `QUOTE_INVALID:${SHORT_CALL}` });
    expect(assembleDecisionSnapshot({ ...base, market: { ...market, spotCentsByUnderlying: { SPY: "500" } } })).toEqual({ ok: false, reason: "SPOT_INVALID:SPY" });
  });

  it("RES-P1-01b a prior history sample with a null or malformed quote record is rejected instead of reaching decide", () => {
    const malformedPrior = { ...cycleEntry(1, { snapshot: journalSnapshot({ quoteSamples: { SPY: { [SHORT_CALL]: null } } as unknown as JournalSnapshot["quoteSamples"] }) }) } as JournalEntry;
    expect(assembleDecisionSnapshot({ ...base, journal: [malformedPrior] })).toEqual({ ok: false, reason: `PRIOR_SAMPLE_INVALID:SPY:${SHORT_CALL}` });
    const nonUtc = { ...cycleEntry(1, { snapshot: journalSnapshot({ snapshotAt: "2026-08-31T15:30:00+02:00" }) }) } as JournalEntry;
    expect(assembleDecisionSnapshot({ ...base, journal: [nonUtc] })).toEqual({ ok: false, reason: "PRIOR_SAMPLE_INVALID:SPY" });
    const cycleBody = Object.fromEntries(Object.entries(cycleEntry(1)).filter(([key]) => key !== "seq"));
    const good = assembleDecisionSnapshot({ ...base, journal: seqd([cycleBody]) });
    expect(good).toMatchObject({ ok: true, snapshot: { priorQuotesByUnderlying: { SPY: { observedAt: 1_788_183_000_000, quotesByContract: { [SHORT_CALL]: { bidCents: 100, askCents: 102, quotedAt: 1_788_183_000_000 } } } } } });
  });

  it("RES-P1-01c a lifecycle reconstructed with an unknown state, or an INTENT with a non-integer reserve, is rejected", () => {
    const intent = intentEntry(1);
    const unknownState = { seq: 2, at: TEST_ONLY_AT, epoch: 1, type: "RECONCILIATION", reasonCodes: [], items: [{ kind: "entry_order", clientOrderId: intent["clientOrderId"], classification: "SOMETHING_ELSE" }] } as unknown as JournalEntry;
    expect(assembleDecisionSnapshot({ ...base, journal: [intent, unknownState] })).toMatchObject({ ok: false, reason: expect.stringMatching(/^LIFECYCLE_FOLD:.*unknown classification SOMETHING_ELSE/) });
    const fractionalReserve = { ...intent, reservedMaxLossCents: 101.5 } as JournalEntry;
    expect(assembleDecisionSnapshot({ ...base, journal: [fractionalReserve] })).toMatchObject({ ok: false, reason: expect.stringMatching(/^LIFECYCLE_FOLD:/) });
    const orphanOutcome = { seq: 1, at: TEST_ONLY_AT, epoch: 1, type: "OUTCOME", clientOrderId: "entry:nobody", status: "filled", brokerOrderId: "b", brokerTimestamps: {}, filledQuantity: 1, avgFillPriceCents: 1, reasonCodes: [], binding: BINDING } as unknown as JournalEntry;
    expect(assembleDecisionSnapshot({ ...base, journal: [orphanOutcome] })).toMatchObject({ ok: false, reason: expect.stringMatching(/references no INTENT/) });
    const valid = assembleDecisionSnapshot({ ...base, journal: [intent] });
    expect(valid).toMatchObject({ ok: true, snapshot: { exposureLifecycles: [{ exposureLifecycleId: "exposure-1", risk: [{ kind: "entry", state: "intent", maxLossCents: 10_100 }] }], submittedOrderIds: ["entry:2026-08-31:7:abc"] } });
    expect(assembleDecisionSnapshot({ ...base, broker: book({ accountId: TEST_ONLY_ACCOUNT_ID, equityCents: 1.5 }) })).toEqual({ ok: false, reason: "BROKER_MONEY_INVALID" });
    expect(assembleDecisionSnapshot({ ...base, broker: book({ accountId: TEST_ONLY_ACCOUNT_ID, positions: [position({ quantity: 0.5 })] }) })).toEqual({ ok: false, reason: "BROKER_POSITION_INVALID" });
  });

  it("RES-P1-01d candidates enter only as raw analyst text through the validating parser; a forged unit is a structural failure, never a cast", () => {
    const forgedQuantity = JSON.stringify({ candidates: [{ ...creditVertical(), quantity: 0 }] });
    expect(parseAnalystOutput(forgedQuantity)).toEqual({ kind: "structural_failure", issue: "candidate schema mismatch or non-candidate text" });
    const forgedPrice = JSON.stringify({ candidates: [{ ...creditVertical(), entryLimit: { kind: "credit", priceCents: -1 } }] });
    expect(parseAnalystOutput(forgedPrice)).toEqual({ kind: "structural_failure", issue: "candidate schema mismatch or non-candidate text" });
    const { market: decisionSnapshot } = decisionMarket();
    const priced = priceAndDecide(decisionSnapshot, parseAnalystOutput(forgedQuantity), TEST_ONLY_O5_CONFIG, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
    expect(priced.result).toMatchObject({ batchVerdicts: [{ code: "SCHEMA_VETO" }], actions: [] });
    const genuine = priceAndDecide(decisionSnapshot, parseAnalystOutput(JSON.stringify({ candidates: [creditVertical()] })), TEST_ONLY_O5_CONFIG, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
    expect(genuine.result.actions).toHaveLength(1);
  });
});
