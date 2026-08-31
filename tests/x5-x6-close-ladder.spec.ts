// S-X-05 (close-escalation ladder) and S-X-06 (discriminated recovery policy
// for unbounded residues, declared expiry hold) as pure-core behaviour, plus
// the runner-level ladder mechanics: every re-price journaled, resting AT the
// cap with halt and alarm, and the ladder never opening exposure.
import { afterEach, describe, expect, it } from "vitest";
import { integerUnit, lotCount } from "../src/core/domain.js";
import type { OptionLeg, OptionQuote } from "../src/core/domain.js";
import {
  closeCapFor,
  equityLegExpirySentinel,
  escalateCloseLimit,
  evaluateExpiryHold,
  marketableCloseLimit,
  residueClosingLeg,
} from "../src/core/lifecycle.js";
import type { ExpiryHoldEvidence } from "../src/core/lifecycle.js";
import { leg, quote, candidate as longCandidate, contract } from "./fixtures.js";
import { LONG_CALL, SHORT_CALL, creditVertical } from "./execution-fixtures.js";
import { cleanupLifecycleDirs, defaultLifecycleDeps, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

/** Closing legs of the filled credit vertical: buy back the 500 call, sell the 505 call — a debit close, net mid 200. */
function closingLegs(): readonly OptionLeg[] {
  return [
    leg({ contractId: SHORT_CALL, strikeCents: integerUnit(50_000, "StrikeCents"), side: "buy" }),
    leg({ contractId: LONG_CALL, strikeCents: integerUnit(50_500, "StrikeCents"), side: "sell" }),
  ];
}

function closeQuotes(): Record<string, OptionQuote> {
  return {
    [SHORT_CALL]: quote({ bidCents: integerUnit(300, "OptionPriceCents"), askCents: integerUnit(302, "OptionPriceCents") }),
    [LONG_CALL]: quote({ bidCents: integerUnit(100, "OptionPriceCents"), askCents: integerUnit(102, "OptionPriceCents") }),
  };
}

describe("S-X-05 — the close-escalation ladder is a capped limit order at every generation", () => {
  it("S-X-05 starts at mid, steps by CLOSE_ESCALATION_STEP per generation, and stays a limit order", () => {
    const cap = closeCapFor(creditVertical());
    expect(cap).toEqual({ kind: "width_debit_cap", widthCents: 500 });
    const generationZero = escalateCloseLimit(closingLegs(), closeQuotes(), 0, 25, cap);
    expect(generationZero).toMatchObject({ ok: true, atCap: false, limit: { kind: "debit", priceCents: 200 } });
    const generationThree = escalateCloseLimit(closingLegs(), closeQuotes(), 3, 25, cap);
    expect(generationThree).toMatchObject({ ok: true, atCap: false, limit: { kind: "debit", priceCents: 275 } });
  });

  it("S-X-05 / KGV-16 the close debit of a credit structure never exceeds the width: the order rests AT the cap", () => {
    const cap = closeCapFor(creditVertical());
    const beyond = escalateCloseLimit(closingLegs(), closeQuotes(), 2, 300, cap);
    expect(beyond).toMatchObject({ ok: true, atCap: true, limit: { kind: "debit", priceCents: 500 } });
    const exactlyAt = escalateCloseLimit(closingLegs(), closeQuotes(), 1, 300, cap);
    expect(exactlyAt).toMatchObject({ ok: true, atCap: true, limit: { kind: "debit", priceCents: 500 } });
  });

  it("S-X-05 a debit structure's close credit never goes below zero: the zero floor rests at one cent", () => {
    const longClose: readonly OptionLeg[] = [leg({ side: "sell" })];
    const quotes = { SPY260904C00500000: quote({ bidCents: integerUnit(10, "OptionPriceCents"), askCents: integerUnit(12, "OptionPriceCents") }) };
    const capped = closeCapFor(longCandidate());
    expect(capped).toEqual({ kind: "zero_floor" });
    const midway = escalateCloseLimit(longClose, quotes, 1, 4, capped);
    expect(midway).toMatchObject({ ok: true, atCap: false, limit: { kind: "credit", priceCents: 7 } });
    const floored = escalateCloseLimit(longClose, quotes, 5, 4, capped);
    expect(floored).toMatchObject({ ok: true, atCap: true, limit: { kind: "credit", priceCents: 1 } });
  });

  it("S-X-05 iron condor caps at the widest wing", () => {
    const condor = creditVertical({
      declaredStructureType: "iron_condor",
      entryLimit: { kind: "credit", priceCents: integerUnit(150, "OptionPriceCents") },
      legs: [
        leg({ contractId: "P1", strikeCents: integerUnit(48_000, "StrikeCents"), right: "put", side: "buy" }),
        leg({ contractId: "P2", strikeCents: integerUnit(48_500, "StrikeCents"), right: "put", side: "sell" }),
        leg({ contractId: "C1", strikeCents: integerUnit(51_000, "StrikeCents"), right: "call", side: "sell" }),
        leg({ contractId: "C2", strikeCents: integerUnit(51_800, "StrikeCents"), right: "call", side: "buy" }),
      ],
    });
    expect(closeCapFor(condor)).toEqual({ kind: "width_debit_cap", widthCents: 800 });
  });

  it("S-X-05 missing quotes refuse the escalation instead of guessing", () => {
    expect(escalateCloseLimit(closingLegs(), {}, 1, 2, closeCapFor(creditVertical()))).toEqual({ ok: false, reason: "QUOTE_MISSING" });
    expect(escalateCloseLimit(closingLegs(), closeQuotes(), 1, 0, closeCapFor(creditVertical()))).toEqual({ ok: false, reason: "ESCALATION_INPUT_INVALID" });
  });
});

describe("S-X-06 — unbounded residues close as requoted marketable limits with no cap", () => {
  it("S-X-06 a short-option buy-back prices at or past the ask and escalates without a cap", () => {
    const buyBack: readonly OptionLeg[] = [leg({ contractId: SHORT_CALL, side: "buy" })];
    const quotes = { [SHORT_CALL]: quote({ bidCents: integerUnit(300, "OptionPriceCents"), askCents: integerUnit(302, "OptionPriceCents") }) };
    expect(marketableCloseLimit(buyBack, quotes, 0, 10)).toMatchObject({ ok: true, atCap: false, limit: { kind: "debit", priceCents: 302 } });
    expect(marketableCloseLimit(buyBack, quotes, 4, 10)).toMatchObject({ ok: true, atCap: false, limit: { kind: "debit", priceCents: 342 } });
    // The escalated debit may exceed any structure width: there is no cap on the recovery of an unbounded residue.
    expect(marketableCloseLimit(buyBack, quotes, 100, 10)).toMatchObject({ ok: true, limit: { kind: "debit", priceCents: 1302 } });
  });

  it("S-X-06 assigned short stock travels as the equity sentinel leg", () => {
    const journaledUnderlyings = new Set(["SPY"]);
    const shareLeg = residueClosingLeg({ contractId: "SPY", quantity: -100, avgEntryPriceCents: 0 }, [], journaledUnderlyings);
    expect(shareLeg).toMatchObject({ contractId: "SPY", underlying: "SPY", expiry: equityLegExpirySentinel(), side: "buy", ratio: 1 });
    const foreign = residueClosingLeg({ contractId: "TSLA", quantity: -100, avgEntryPriceCents: 0 }, [], journaledUnderlyings);
    expect(foreign).toBeNull();
    const knownLeg = residueClosingLeg({ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 0 }, creditVertical().legs, journaledUnderlyings);
    expect(knownLeg).toMatchObject({ contractId: LONG_CALL, side: "sell" });
  });
});

describe("S-X-06 / KGV-7 / WIN-3 — the declared expiry hold demands the full same-cycle proof", () => {
  const holdContract = contract({ contractId: LONG_CALL, strikeCents: integerUnit(50_500, "StrikeCents") });
  const zeroBid = quote({ bidCents: integerUnit(0, "OptionPriceCents"), askCents: integerUnit(2, "OptionPriceCents"), quotedAt: integerUnit(1_000_000, "EpochMilliseconds") });
  const evidence: ExpiryHoldEvidence = { contract: holdContract, quantity: 1, quote: zeroBid, spotCents: 50_000, pairedShortOrLiability: false, exerciseProtectionConfirmed: true };

  it("KGV-7 the complete proof passes and records every input plus the zero-liability statement", () => {
    const verdict = evaluateExpiryHold(evidence, 1_030_000, 60_000);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.proof).toMatchObject({ kind: "declared_expiry_hold", contractId: LONG_CALL, bidCents: 0, spotCents: 50_000, exerciseProtectionConfirmed: true, statement: "hold to expiry, zero additional liability" });
    }
  });

  it("KGV-7 every missing element keeps escalation and alarm active", () => {
    const failures: { readonly tweak: Partial<typeof evidence>; readonly reason: string }[] = [
      { tweak: { quantity: -1 }, reason: "positive long" },
      { tweak: { pairedShortOrLiability: true }, reason: "paired short" },
      { tweak: { quote: null }, reason: "no complete fresh option quote" },
      { tweak: { quote: quote({ bidCents: integerUnit(1, "OptionPriceCents"), quotedAt: integerUnit(1_000_000, "EpochMilliseconds") }) }, reason: "bid is not exactly zero" },
      { tweak: { spotCents: null }, reason: "no fresh underlying quote" },
      { tweak: { spotCents: 51_000 }, reason: "not out-of-the-money" },
      { tweak: { exerciseProtectionConfirmed: false }, reason: "exercise protection" },
    ];
    for (const failure of failures) {
      const verdict = evaluateExpiryHold({ ...evidence, ...failure.tweak }, 1_030_000, 60_000);
      expect(verdict.ok, failure.reason).toBe(false);
    }
    // A stale quote fails even with a zero bid.
    const stale = evaluateExpiryHold(evidence, 2_000_000, 60_000);
    expect(stale.ok).toBe(false);
  });
});

describe("S-X-05 at the runner: every re-price is journaled, the cap halts and alarms, attempts continue AT the cap", () => {
  it("S-X-05 the resting eviction close is canceled and re-submitted one step further each cycle; the cap rests, halts, and alarms", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills under the normal calendar: the credit vertical is on the book
    // The following session is the expiry session: eviction begins (S-G9-02), with a coarse 300-cent ladder step.
    const eviction = defaultLifecycleDeps({ nextTradingDay: "2026-09-04", closeEscalationStepCents: 300 });
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const first = await harness.cycle({ lifecycle: eviction });
    expect(first.managementCloses).toMatchObject([{ route: "expiry", generation: 0, limitPriceCents: 200, atCap: false }]);
    const second = await harness.cycle({ lifecycle: eviction });
    // Generation 1 at step 300 reaches the 500-cent width: the order rests AT the cap.
    expect(second.managementCloses).toMatchObject([{ route: "expiry", generation: 1, limitPriceCents: 500, atCap: true }]);
    expect(second.alarmConditions.some(item => item.startsWith("CLOSE_LADDER_AT_CAP"))).toBe(true);
    expect(second.ping).toBe("fail");
    const entries = harness.entries();
    const closeIntents = entries.filter(entry => entry.type === "INTENT" && entry["action"] === "close");
    expect(closeIntents.map(entry => (entry["submittedLimit"] as { priceCents: number }).priceCents)).toEqual([200, 500]);
    expect(entries.some(entry => entry.type === "HALT" && entry["reason"] === "CLOSE_LADDER_CAPPED")).toBe(true);
    // Attempts continue at the cap: the next cycle adopts/re-submits, still capped at 500, never beyond.
    const third = await harness.cycle({ lifecycle: eviction });
    const capped = third.managementCloses.filter(item => item.route === "expiry");
    for (const item of capped) expect(item.limitPriceCents).toBeLessThanOrEqual(500);
  });

  it("S-X-05 the ladder never opens exposure: a close whose legs no longer offset held positions is refused", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills under the normal calendar
    const eviction = defaultLifecycleDeps({ nextTradingDay: "2026-09-04" });
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    // The short leg vanishes (assignment): the whole-structure close would OPEN a short — eligibility refuses it;
    // the leftover long leg is handled leg-wise by the residue policy instead.
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 }]);
    const report = await harness.cycle({ lifecycle: eviction });
    expect(report.managementCloses.every(item => item.route !== "expiry")).toBe(true);
    const residueCloses = report.managementCloses.filter(item => item.route === "residue");
    expect(residueCloses).toHaveLength(1);
    for (const mutation of harness.fake.mutations.filter(item => item.kind === "submit_order")) {
      const payload = mutation.payload as { legs: readonly { contractId: string; side: string }[]; intent: string };
      if (payload.intent !== "close") continue;
      expect(payload.legs).toHaveLength(1);
      expect(payload.legs[0]).toMatchObject({ contractId: LONG_CALL, side: "sell" });
    }
  });
});

describe("S-X-06 at the runner — the declared expiry hold ends escalation, lifts the ping, and stays visibly not-flat", () => {
  it("KGV-7 / WIN-3 a bid-zero orphan long with full proof is journaled DECLARED_EXPIRY_HOLD, never re-enqueued, and reported not-flat", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills the credit vertical
    // The short leg is gone; the orphan long is worthless: bid exactly zero, OTM, no paired liability.
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 }]);
    const holdMarket = { quotes: { [LONG_CALL]: { bidCents: 0, askCents: 2, bidSize: 20, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" } } };
    const withProof = defaultLifecycleDeps({ confirmExerciseProtection: () => Promise.resolve(true) });
    const declared = await harness.cycle({ lifecycle: withProof, market: lifecycleMarket(() => harness.clock.now, holdMarket) });
    expect(declared.declaredHolds).toContain(LONG_CALL);
    expect(declared.managementCloses).toEqual([]); // escalation ended by proof, not by hope
    const holdEntry = harness.entries().find(entry => entry.type === "RECONCILIATION" && Array.isArray(entry["reasonCodes"]) && (entry["reasonCodes"] as unknown[]).includes("DECLARED_EXPIRY_HOLD"));
    expect(holdEntry).toBeDefined();
    const proof = (holdEntry?.["items"] as readonly Record<string, unknown>[])[0];
    expect(proof).toMatchObject({ contractId: LONG_CALL, bidCents: 0, statement: "hold to expiry, zero additional liability" });
    // The next cycle does not re-enqueue the hold (S-G9-02) and the fail-ping stays lifted; the position is still not-flat.
    const after = await harness.cycle({ lifecycle: withProof, market: lifecycleMarket(() => harness.clock.now, holdMarket) });
    expect(after.managementCloses).toEqual([]);
    expect(after.ping).toBe("success");
    expect(after.declaredHolds).toContain(LONG_CALL);
    expect(await harness.fake.read.positions()).toMatchObject([{ contractId: LONG_CALL, quantity: 1 }]);
  });

  it("KGV-7 without broker-confirmed exercise protection the escalation and alarm stay active", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 }]);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const holdMarket = { quotes: { [LONG_CALL]: { bidCents: 0, askCents: 2, bidSize: 20, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" } } };
    const noProof = defaultLifecycleDeps({ confirmExerciseProtection: () => Promise.resolve(false) });
    const report = await harness.cycle({ lifecycle: noProof, market: lifecycleMarket(() => harness.clock.now, holdMarket) });
    expect(report.declaredHolds).toEqual([]);
    expect(report.managementCloses).toMatchObject([{ route: "residue" }]);
  });
});

describe("lotCount guard", () => {
  it("the equity sentinel leg carries a constructed unit ratio", () => {
    expect(lotCount(1)).toBe(1);
  });
});
