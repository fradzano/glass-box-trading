import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { EntryActionPlan } from "../src/core/domain.js";
import {
  classifyFillPrice,
  entryAcknowledgementDraft,
  entryResolutionDraft,
  epochMsToUtcIso,
  exposureLifecyclesFrom,
  foldLifecycles,
  intentDraft,
  isWorkingBrokerStatus,
  outcomeFromOrder,
  outcomeFromSubmit,
  priceAndDecide,
  priceCloseLimit,
  priceEntryLimit,
  reversedLegs,
  utcIsoToEpochMs,
} from "../src/core/execution.js";
import type { OutcomeContext } from "../src/core/execution.js";
import { planAppend, validateJournalEntry } from "../src/core/journal.js";
import type { JournalEntry } from "../src/core/journal.js";
import { LONG_CALL, SHORT_CALL, TEST_ONLY_EXECUTION_CONFIG, brokerOrder, creditVertical, creditVerticalQuotes } from "./execution-fixtures.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, marketFor, quote, snapshot } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT, TEST_ONLY_ORIGIN } from "./journal-fixtures.js";

const BINDING = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;

function seqd(entries: readonly Record<string, unknown>[]): readonly JournalEntry[] {
  return entries.map((entry, index) => {
    const validated = validateJournalEntry({ seq: index + 1, ...entry });
    if (!validated.ok) throw new Error(`fixture entry ${String(index + 1)} invalid: ${validated.reason}`);
    return validated.entry;
  });
}

/** Prices and decides the credit vertical under the standard quotes; returns the single approved plan. */
function approvedCreditPlan(): { readonly plan: EntryActionPlan; readonly context: OutcomeContext } {
  const value = creditVertical();
  const market = marketFor(value);
  const decisionSnapshot = { ...market, quotesByContract: { ...market.quotesByContract, ...creditVerticalQuotes() } };
  const priced = priceAndDecide(decisionSnapshot, { kind: "candidates", candidates: [value] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
  const plan = priced.result.actions[0];
  if (plan === undefined) throw new Error(`fixture plan was vetoed: ${JSON.stringify(priced.result.candidateVerdicts)}`);
  return { plan, context: { clientOrderId: plan.clientOrderId, limit: plan.submittedLimit, binding: BINDING, epoch: 1, atIso: TEST_ONLY_AT } };
}

describe("S-X-01 every order is a limit order priced from the decision's quotes", () => {
  it("S-X-01 derives the submitted net limit from mid ± LIMIT_TOLERANCE at the penny tick and G1–G4 reserve from that very value", () => {
    const debit = priceEntryLimit(candidate(), { SPY260904C00500000: quote({ bidCents: integerUnit(100, "OptionPriceCents"), askCents: integerUnit(103, "OptionPriceCents") }) }, TEST_ONLY_EXECUTION_CONFIG);
    // mid 101.5 rounds up to 102 for a debit, plus tolerance 2.
    expect(debit).toMatchObject({ ok: true, candidate: { entryLimit: { kind: "debit", priceCents: 104 } }, netMidTwiceCents: 203 });

    const credit = priceEntryLimit(creditVertical(), creditVerticalQuotes(), TEST_ONLY_EXECUTION_CONFIG);
    // net mid 200 credit minus tolerance 2.
    expect(credit).toMatchObject({ ok: true, candidate: { entryLimit: { kind: "credit", priceCents: 198 } } });

    const { plan } = approvedCreditPlan();
    expect(plan.submittedLimit).toEqual({ kind: "credit", priceCents: 198 });
    // width 500 minus the credit actually submitted (198), per share, times 100 shares.
    expect(plan.reservedMaxLossCents).toBe((500 - 198) * 100);

    // LIMIT_TOLERANCE is configuration, never a constant (BEQ-10).
    const wider = priceEntryLimit(creditVertical(), creditVerticalQuotes(), { ...TEST_ONLY_EXECUTION_CONFIG, limitToleranceCents: integerUnit(10, "OptionPriceCents") });
    expect(wider).toMatchObject({ ok: true, candidate: { entryLimit: { priceCents: 190 } } });
  });

  it("S-X-01 refuses to price what the quotes contradict or cannot support", () => {
    expect(priceEntryLimit(creditVertical(), { [SHORT_CALL]: creditVerticalQuotes()[SHORT_CALL]! }, TEST_ONLY_EXECUTION_CONFIG)).toEqual({ ok: false, reason: "QUOTE_MISSING" });
    expect(priceEntryLimit(creditVertical({ entryLimit: { kind: "debit", priceCents: integerUnit(200, "OptionPriceCents") } }), creditVerticalQuotes(), TEST_ONLY_EXECUTION_CONFIG)).toEqual({ ok: false, reason: "LIMIT_KIND_CONTRADICTS_QUOTES" });
    const flat = creditVerticalQuotes({ [LONG_CALL]: creditVerticalQuotes()[SHORT_CALL]! });
    expect(priceEntryLimit(creditVertical(), flat, TEST_ONLY_EXECUTION_CONFIG)).toEqual({ ok: false, reason: "NET_PREMIUM_ZERO" });
    const thin = creditVerticalQuotes({ [LONG_CALL]: quote({ bidCents: integerUnit(299, "OptionPriceCents"), askCents: integerUnit(301, "OptionPriceCents") }) });
    expect(priceEntryLimit(creditVertical(), thin, TEST_ONLY_EXECUTION_CONFIG)).toEqual({ ok: false, reason: "CREDIT_LIMIT_NOT_POSITIVE" });
    // A close never asks for less than one cent of credit, so it remains a limit order.
    expect(priceCloseLimit(reversedLegs(creditVertical().legs), thin, TEST_ONLY_EXECUTION_CONFIG)).toMatchObject({ ok: true, limit: { kind: "debit" } });
    const closeCredit = priceCloseLimit(reversedLegs(candidate().legs), { SPY260904C00500000: quote({ bidCents: integerUnit(1, "OptionPriceCents"), askCents: integerUnit(2, "OptionPriceCents") }) }, TEST_ONLY_EXECUTION_CONFIG);
    expect(closeCredit).toEqual({ ok: true, limit: { kind: "credit", priceCents: 1 } });
  });

  it("S-X-01 / WIN-11 a target that passes at mid is vetoed when the least-favourable submitted limit exceeds the budget, and a re-price recomputes all four gates atomically", () => {
    const value = candidate();
    const market = marketFor(value);
    // Mid 101 would reserve 10 100; the submitted limit 103 reserves 10 300. A budget of 10 200 passes the target and fails the limit.
    const tight = { ...TEST_ONLY_O5_CONFIG, convexBudgetCents: integerUnit(10_200, "MoneyCents") };
    const atMid = decide(market, { kind: "candidates", candidates: [{ ...value, entryLimit: { kind: "debit", priceCents: integerUnit(101, "OptionPriceCents") } }] }, tight, TEST_ONLY_NOW);
    expect(atMid.actions).toHaveLength(1);
    const priced = priceAndDecide(market, { kind: "candidates", candidates: [value] }, tight, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
    expect(priced.result.actions).toHaveLength(0);
    expect(priced.result.candidateVerdicts[0]?.gateVector[1]).toMatchObject({ gate: "G2", passed: false, code: "BUDGET" });
    expect(priced.result.candidateVerdicts[0]?.reservedMaxLossCents).toBe(10_300);

    // Re-price on fresh quotes: the limit, the reservation, and every gate come from the new quotes in one pass.
    const cheaper = { ...market, quotesByContract: { SPY260904C00500000: quote({ bidCents: integerUnit(90, "OptionPriceCents"), askCents: integerUnit(92, "OptionPriceCents") }) } };
    const repriced = priceAndDecide(cheaper, { kind: "candidates", candidates: [value] }, tight, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
    expect(repriced.result.actions[0]).toMatchObject({ submittedLimit: { kind: "debit", priceCents: 93 }, reservedMaxLossCents: 9_300 });
    expect(repriced.pricedCandidates[value.candidateId]?.entryLimit.priceCents).toBe(93);

    // An unpriceable candidate never reaches decide and is recorded as such.
    const noQuotes = priceAndDecide({ ...market, quotesByContract: {} }, { kind: "candidates", candidates: [value] }, tight, TEST_ONLY_EXECUTION_CONFIG, TEST_ONLY_NOW);
    expect(noQuotes.result.candidateVerdicts).toHaveLength(0);
    expect(noQuotes.unpriceable).toEqual([{ candidateId: value.candidateId, reason: "QUOTE_MISSING" }]);
  });
});

describe("S-X-02 a fill is judged against the submitted limit", () => {
  it("S-X-02 classifies at-limit, improved, and impossible worse-than-limit records; a breach is journaled verbatim with BROKER_PRICE_BREACH and reserves the actual exposure", () => {
    expect(classifyFillPrice({ kind: "debit", priceCents: 104 }, 104)).toBe("AT_LIMIT");
    expect(classifyFillPrice({ kind: "debit", priceCents: 104 }, 103)).toBe("PRICE_IMPROVED");
    expect(classifyFillPrice({ kind: "debit", priceCents: 104 }, 105)).toBe("BROKER_PRICE_BREACH");
    expect(classifyFillPrice({ kind: "credit", priceCents: 198 }, 199)).toBe("PRICE_IMPROVED");
    expect(classifyFillPrice({ kind: "credit", priceCents: 198 }, 197)).toBe("BROKER_PRICE_BREACH");

    const { plan, context } = approvedCreditPlan();
    const improved = outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "filled", filledQuantity: 1, avgFillPriceCents: 199, brokerTimestamps: { filled_at: "2026-08-31T09:31:00.1234567-04:00" } }));
    expect(improved).toMatchObject({ status: "filled", terminal: true, fill: "PRICE_IMPROVED", draft: { reasonCodes: [], avgFillPriceCents: 199, brokerTimestamps: { filled_at: "2026-08-31T09:31:00.1234567-04:00" } } });
    const breach = outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "filled", filledQuantity: 1, avgFillPriceCents: 150 }));
    expect(breach).toMatchObject({ status: "filled", fill: "BROKER_PRICE_BREACH", draft: { reasonCodes: ["BROKER_PRICE_BREACH"], avgFillPriceCents: 150 } });
    expect(validateJournalEntry({ seq: 2, ...breach!.draft })).toMatchObject({ ok: true });

    const decisionSnapshot = snapshot();
    const intent = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: Array.from({ length: 8 }, (_, index) => ({ gate: `G${String(index + 1)}` as "G1", passed: true, code: "PASS" as const, reasons: [] })) }, decisionSnapshot, BINDING);
    const fold = foldLifecycles(seqd([intent, breach!.draft]));
    expect(fold).toMatchObject({ ok: true, entries: [{ state: "filled", priceBreach: true, avgFillPriceCents: 150 }] });
    if (!fold.ok) throw new Error(fold.reason);
    const exposure = exposureLifecyclesFrom(fold.entries);
    // The reservation was (500 − 198) × 100 = 30 200; the actual fill at 150 credit leaves (500 − 150) × 100 = 35 000 at risk.
    expect(exposure).toMatchObject({ ok: true, lifecycles: [{ risk: [{ kind: "filled", maxLossCents: 35_000 }] }] });
  });
});

describe("S-X-03 / S-X-04 broker rejection is an OUTCOME with the broker's reason, never an execution", () => {
  it("S-X-03 a synchronous rejection becomes OUTCOME rejected carrying the reason verbatim, releases the reservation, and can never validate as filled", () => {
    const { plan, context } = approvedCreditPlan();
    const rejected = outcomeFromSubmit(context, { kind: "rejected", brokerReason: "insufficient options buying power", brokerTimestamps: { rejected_at: "2026-08-31T09:30:01Z" } });
    expect(rejected).toMatchObject({ status: "rejected", terminal: true, draft: { status: "rejected", brokerReason: "insufficient options buying power", brokerOrderId: null, filledQuantity: 0, avgFillPriceCents: null } });
    expect(validateJournalEntry({ seq: 2, ...rejected!.draft })).toMatchObject({ ok: true });
    expect(validateJournalEntry({ seq: 2, ...rejected!.draft, brokerReason: "" })).toMatchObject({ ok: false, reason: "REJECTION_WITHOUT_BROKER_REASON" });
    expect(validateJournalEntry({ seq: 2, ...rejected!.draft, filledQuantity: 1, avgFillPriceCents: 198 })).toMatchObject({ ok: false, reason: "REJECTION_CARRIES_FILL" });
    const silent = outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "rejected", brokerReason: null }));
    expect(silent?.draft["brokerReason"]).toBe("BROKER_REASON_ABSENT");

    const intent = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: Array.from({ length: 8 }, (_, index) => ({ gate: `G${String(index + 1)}` as "G1", passed: true, code: "PASS" as const, reasons: [] })) }, snapshot(), BINDING);
    const fold = foldLifecycles(seqd([intent, rejected!.draft]));
    if (!fold.ok) throw new Error(fold.reason);
    expect(fold.entries[0]).toMatchObject({ state: "rejected" });
    const exposure = exposureLifecyclesFrom(fold.entries);
    if (!exposure.ok) throw new Error(exposure.reason);
    // Released: the component is present for the record but counts nothing (S-G2-07).
    expect(exposure.lifecycles[0]?.risk).toEqual([{ kind: "entry", state: "rejected", maxLossCents: plan.reservedMaxLossCents }]);
    const afterRelease = decide({ ...snapshot(), exposureLifecycles: exposure.lifecycles }, { kind: "candidates", candidates: [] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(afterRelease.actions).toHaveLength(0);
  });

  it("S-X-04 an accepted order yields no OUTCOME and keeps counting as fillable exposure until its terminal status is seen; the later rejection is journaled as in S-X-03", () => {
    const { plan, context } = approvedCreditPlan();
    expect(outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "accepted" }))).toBeNull();
    expect(outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "pending_new" }))).toBeNull();
    expect(isWorkingBrokerStatus("some_status_the_closed_set_does_not_name")).toBe(true);
    const intent = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: Array.from({ length: 8 }, (_, index) => ({ gate: `G${String(index + 1)}` as "G1", passed: true, code: "PASS" as const, reasons: [] })) }, snapshot(), BINDING);
    const working = foldLifecycles(seqd([intent, entryAcknowledgementDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan.clientOrderId, brokerOrder({ clientOrderId: plan.clientOrderId, status: "accepted" }))]));
    if (!working.ok) throw new Error(working.reason);
    expect(working.entries[0]).toMatchObject({ state: "fillable", brokerOrderId: "broker-1" });
    const counted = exposureLifecyclesFrom(working.entries);
    expect(counted).toMatchObject({ ok: true, lifecycles: [{ risk: [{ kind: "entry", state: "fillable", maxLossCents: plan.reservedMaxLossCents }] }] });

    const laterRejected = outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "rejected", brokerReason: "options level insufficient", brokerTimestamps: { failed_at: "2026-08-31T13:31:00Z" } }));
    expect(laterRejected).toMatchObject({ status: "rejected", draft: { brokerReason: "options level insufficient" } });
    const released = foldLifecycles(seqd([intent, laterRejected!.draft]));
    expect(released).toMatchObject({ ok: true, entries: [{ state: "rejected" }] });

    // A cancel after a partial fill is a terminal partially_filled outcome: filled portion stays, the rest is released.
    const partial = outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "canceled", filledQuantity: 1, avgFillPriceCents: 198 }));
    expect(partial).toMatchObject({ status: "partially_filled", terminal: true, draft: { filledQuantity: 1 } });
  });

  it("S-CYC-04 a lost acknowledgement is journaled CONFIRMATION_UNCLEAR with its reservation retained, and phase 0 resolves it by client order ID", () => {
    const { plan, context } = approvedCreditPlan();
    const unclear = outcomeFromSubmit(context, { kind: "acknowledgement_lost", detail: "timeout after send" });
    expect(unclear).toMatchObject({ status: "confirmation_unclear", terminal: false, draft: { status: "confirmation_unclear", brokerOrderId: null, brokerReason: "timeout after send" } });
    expect(validateJournalEntry({ seq: 2, ...unclear!.draft })).toMatchObject({ ok: true });
    const intent = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: Array.from({ length: 8 }, (_, index) => ({ gate: `G${String(index + 1)}` as "G1", passed: true, code: "PASS" as const, reasons: [] })) }, snapshot(), BINDING);
    const pending = foldLifecycles(seqd([intent, unclear!.draft]));
    if (!pending.ok) throw new Error(pending.reason);
    expect(pending.entries[0]).toMatchObject({ state: "confirmation_unclear" });
    expect(exposureLifecyclesFrom(pending.entries)).toMatchObject({ ok: true, lifecycles: [{ risk: [{ kind: "entry", state: "confirmation_unclear", maxLossCents: plan.reservedMaxLossCents }] }] });
    // Also an INTENT with nothing after it (crash between append and submit) keeps counting until phase 0 resolves it.
    const orphanIntent = foldLifecycles(seqd([intent]));
    expect(orphanIntent).toMatchObject({ ok: true, entries: [{ state: "intent" }] });

    // Phase 0 resolution: found working proves identity but does not terminate
    // lost-ack uncertainty; found terminal → OUTCOME; not found stays uncertain.
    const foundWorking = entryResolutionDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan.clientOrderId, brokerOrder({ clientOrderId: plan.clientOrderId, status: "new" }));
    expect(foldLifecycles(seqd([intent, foundWorking]))).toMatchObject({ ok: true, entries: [{ state: "confirmation_unclear" }] });
    expect(foldLifecycles(seqd([intent, unclear!.draft, foundWorking]))).toMatchObject({ ok: true, entries: [{ state: "confirmation_unclear" }] });
    const foundFilled = outcomeFromOrder(context, brokerOrder({ clientOrderId: plan.clientOrderId, status: "filled", filledQuantity: 1, avgFillPriceCents: 198 }));
    expect(foldLifecycles(seqd([intent, unclear!.draft, foundFilled!.draft]))).toMatchObject({ ok: true, entries: [{ state: "filled", filledQuantity: 1 }] });
    const notFound = entryResolutionDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan.clientOrderId, null);
    expect(notFound).toMatchObject({ reasonCodes: ["NOT_SUBMITTED"], items: [{ classification: "NOT_AT_BROKER" }] });
    expect(foldLifecycles(seqd([intent, unclear!.draft, notFound]))).toMatchObject({ ok: true, entries: [{ state: "confirmation_unclear" }] });
    // A duplicate response on replay adopts the existing order instead of erroring or re-sending (S-G7-02).
    const duplicate = outcomeFromSubmit(context, { kind: "duplicate", order: brokerOrder({ clientOrderId: plan.clientOrderId, status: "filled", filledQuantity: 1, avgFillPriceCents: 198 }) });
    expect(duplicate).toMatchObject({ status: "filled", draft: { brokerOrderId: "broker-1" } });
    expect(outcomeFromSubmit(context, { kind: "duplicate", order: null })).toMatchObject({ status: "confirmation_unclear" });
  });
});

describe("S-J-02 UTC conversion without the host clock", () => {
  it("converts both ways at millisecond precision and refuses non-UTC shapes", () => {
    expect(epochMsToUtcIso(1_788_183_000_000)).toBe("2026-08-31T13:30:00.000Z");
    expect(utcIsoToEpochMs("2026-08-31T13:30:00.000Z")).toBe(1_788_183_000_000);
    expect(utcIsoToEpochMs("2026-08-31T13:30:00Z")).toBe(1_788_183_000_000);
    expect(epochMsToUtcIso(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(epochMsToUtcIso(951_782_400_000)).toBe("2000-02-29T00:00:00.000Z");
    for (const ms of [0, 86_399_999, 951_782_400_000, 1_788_183_000_123, 4_102_444_800_000]) expect(utcIsoToEpochMs(epochMsToUtcIso(ms))).toBe(ms);
    expect(utcIsoToEpochMs("2026-08-31T15:30:00+02:00")).toBeNull();
    expect(utcIsoToEpochMs("2026-02-30T00:00:00Z")).toBeNull();
    expect(() => epochMsToUtcIso(-1)).toThrow(RangeError);
  });

  it("INTENT drafts built by the core pass the S-J-04 floor through planAppend", () => {
    const { plan } = approvedCreditPlan();
    const draft = intentDraft({ atIso: TEST_ONLY_AT, epoch: 1 }, plan, creditVertical({ entryLimit: plan.submittedLimit }), { candidateId: plan.candidateId, candidateRationale: "r", decision: "PASS", reservedMaxLossCents: plan.reservedMaxLossCents, gateVector: Array.from({ length: 8 }, (_, index) => ({ gate: `G${String(index + 1)}` as "G1", passed: true, code: "PASS" as const, reasons: [] })) }, { ...snapshot(), quotesByContract: creditVerticalQuotes() }, BINDING);
    expect(planAppend({ lastSeq: 0, priorIntentRationales: [] }, draft, [])).toMatchObject({ ok: true, entry: { type: "INTENT", rationale: { paidFrom: "income_drift" } } });
    expect((draft["rationale"] as { snapshotReferences: string[] }).snapshotReferences[0]).toMatch(/^quote:SPY260904C00500000:bid=300,ask=302@2026-/);
  });
});
