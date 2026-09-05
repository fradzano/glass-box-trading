// S-X-05 (close-escalation ladder) and S-X-06 (discriminated recovery policy
// for unbounded residues, declared expiry hold) as pure-core behaviour, plus
// the runner-level ladder mechanics: every re-price journaled, resting AT the
// cap with halt and alarm, and the ladder never opening exposure.
import { afterEach, describe, expect, it } from "vitest";
import { integerUnit, lotCount } from "../src/core/domain.js";
import type { OptionLeg, OptionQuote } from "../src/core/domain.js";
import { foldLifecycles, isWorkingBrokerStatus, remainingCloseExposure } from "../src/core/execution.js";
import {
  closeCapFor,
  equityLegExpirySentinel,
  escalateCloseLimit,
  evaluateExpiryHold,
  marketableCloseLimit,
  residueClosingLeg,
} from "../src/core/lifecycle.js";
import type { ExpiryHoldEvidence } from "../src/core/lifecycle.js";
import type { BrokerReadPort } from "../src/shell/fake-broker.js";
import { leg, quote, candidate as longCandidate, contract } from "./fixtures.js";
import { LONG_CALL, SHORT_CALL, creditVertical } from "./execution-fixtures.js";
import { CANDIDATE_JSON, cleanupLifecycleDirs, defaultLifecycleDeps, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";
import type { LifecycleHarness } from "./lifecycle-fixtures.js";

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

describe("S-X-05 — the remainder after a ladder cancel is subtracted from the fresh exposure exactly once", () => {
  it("a partially filled resting close leaves the fresh exposure alone: what filled is already missing from it", () => {
    // A resting close for 2 filled 1 during the analyst step; the management step's own book read afterwards
    // reports the single remaining lot. Subtracting the fill again would defer that lot by a whole cycle.
    expect(remainingCloseExposure(1, { quantity: 2, filledQuantity: 1 })).toBe(1);
    expect(remainingCloseExposure(2, { quantity: 2, filledQuantity: 0 })).toBe(2);
  });

  it("the attempt's unfilled part caps the remainder, so a fill after the book read is never over-closed", () => {
    // Read at 2, then the resting close filled 1 while it was being canceled: only one lot may still be closed.
    expect(remainingCloseExposure(2, { quantity: 2, filledQuantity: 1 })).toBe(1);
    expect(remainingCloseExposure(2, { quantity: 2, filledQuantity: 2 })).toBe(0);
    // A residue that grew past the attempt is closed up to what the attempt covered; the next generation takes the rest.
    expect(remainingCloseExposure(3, { quantity: 2, filledQuantity: 0 })).toBe(2);
  });

  it("numbers the closed shape does not permit plan no close at all", () => {
    expect(remainingCloseExposure(-1, { quantity: 2, filledQuantity: 0 })).toBe(0);
    expect(remainingCloseExposure(1.5, { quantity: 2, filledQuantity: 0 })).toBe(0);
    expect(remainingCloseExposure(2, { quantity: Number.NaN, filledQuantity: 0 })).toBe(0);
    expect(remainingCloseExposure(2, { quantity: 2, filledQuantity: 3 })).toBe(0);
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
    // The next cycle does not re-enqueue the hold (S-G9-02) and raises no alarm
    // of its own; the position is still not-flat. Readiness stays red on
    // purpose (S-G14-05, changed 2026-09-05): the RESIDUE_UNRESOLVED halt from
    // the declaring cycle still stands, so this deployment cannot open a
    // position, and a check that said "success" here told the operator the
    // opposite for as long as the hold lasted. The alarm lifting and the
    // deployment being able to trade are two different claims.
    const after = await harness.cycle({ lifecycle: withProof, market: lifecycleMarket(() => harness.clock.now, holdMarket) });
    expect(after.managementCloses).toEqual([]);
    expect(after.alarmConditions).toEqual([]);
    expect(after.ping).toBe("fail");
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

describe("S-CYC-05 at the management ladder — closes plan and submit against a freshly read book", () => {
  /** The one resting close attempt at the fake broker; the ladder's next step would adopt or re-price it. */
  function restingCloseAttempt(harness: LifecycleHarness): string {
    const resting = harness.fake.allOrders().find(order => order.clientOrderId.startsWith("close:") && isWorkingBrokerStatus(order.status));
    if (resting === undefined) throw new Error("fixture expects exactly one resting close attempt");
    return resting.clientOrderId;
  }

  function closeSubmissions(harness: LifecycleHarness): readonly string[] {
    return harness.fake.mutations.filter(mutation => mutation.kind === "submit_order" && mutation.clientOrderId.startsWith("close:")).map(mutation => mutation.clientOrderId);
  }

  /** Every close order that crossed the gateway, with the quantity it actually asked the broker for. */
  function closePayloads(harness: LifecycleHarness): readonly { readonly clientOrderId: string; readonly quantity: number }[] {
    return harness.fake.mutations
      .filter(mutation => mutation.kind === "submit_order" && mutation.clientOrderId.startsWith("close:"))
      .map(mutation => ({ clientOrderId: mutation.clientOrderId, quantity: (mutation.payload as { readonly quantity: number }).quantity }));
  }

  /** Close INTENT lines: the ladder writes one per attempt, so their absence proves no attempt was made. */
  function closeIntents(harness: LifecycleHarness): readonly string[] {
    return harness.entries().filter(entry => entry.type === "INTENT" && entry["action"] === "close").map(entry => String(entry["route"]));
  }

  /**
   * A read port that lets one effect land AFTER this cycle's phase-1 snapshot:
   * the snapshot sees the old world, every later read the new one. That is the
   * S-CYC-05 window on the close side — the analyst step is minutes wide.
   */
  function brokerMovingAfterSnapshot(harness: LifecycleHarness, effect: () => void): BrokerReadPort {
    let armed = true;
    return {
      ...harness.fake.read,
      positions: async deadlineAtMs => {
        const value = await harness.fake.read.positions(deadlineAtMs);
        if (armed) {
          armed = false;
          effect();
        }
        return value;
      },
    };
  }

  const flattenDay = { tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) };
  const evictionDay = { lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) };

  it("A11/A13 route deadline: a resting close that fills during the analyst step ends the ladder instead of opening a new position", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills under the normal calendar
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const first = await harness.cycle(flattenDay);
    expect(first.managementCloses).toMatchObject([{ route: "deadline", generation: 0 }]);
    const resting = restingCloseAttempt(harness);
    // The close fills at the broker while the analyst runs: from here on the phase-1 book is a lie.
    const second = await harness.cycle({
      ...flattenDay,
      analyst: () => { harness.fake.transitionOrder(resting, { status: "filled" }); return Promise.resolve(CANDIDATE_JSON); },
    });
    expect(await harness.fake.read.positions()).toEqual([]);
    expect(second.managementCloses).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([resting]);
    expect(second.alarmConditions).toEqual([]);
    expect(harness.entries().some(entry => entry.type === "HALT")).toBe(false);
  });

  it("A11/A13 route expiry: a resting eviction close that fills during the analyst step ends the ladder too", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const first = await harness.cycle(evictionDay);
    expect(first.managementCloses).toMatchObject([{ route: "expiry", generation: 0 }]);
    const resting = restingCloseAttempt(harness);
    const second = await harness.cycle({
      ...evictionDay,
      analyst: () => { harness.fake.transitionOrder(resting, { status: "filled" }); return Promise.resolve(CANDIDATE_JSON); },
    });
    expect(await harness.fake.read.positions()).toEqual([]);
    expect(second.managementCloses).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([resting]);
    expect(harness.entries().some(entry => entry.type === "HALT")).toBe(false);
  });

  it("a management book refresh that fails submits no close at all and names the condition", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const report = await harness.cycle({
      ...flattenDay,
      analyst: () => { harness.fake.failNextReads(["positions"]); return Promise.resolve(CANDIDATE_JSON); },
    });
    expect(report.managementCloses).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([]);
    expect(report.alarmConditions.some(condition => condition.startsWith("MANAGEMENT_BOOK_UNREADABLE"))).toBe(true);
    expect(report.ping).toBe("fail");
  });

  it("S-G12-06 a 401 on the management book refresh goes through the credential fence", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const report = await harness.cycle({
      ...flattenDay,
      analyst: () => { harness.fake.setReadHttpFailure(["positions"], 401); return Promise.resolve(CANDIDATE_JSON); },
    });
    expect(report.managementCloses).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([]);
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "AUTH_FAILURE")).toBe(true);
  });

  it("S-G10-03 a residue that vanished after the phase-1 snapshot is never planned: no attempt and no refusal", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    // The short leg was assigned away: at the phase-1 snapshot the orphan long is classified residue …
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 }]);
    // … and the orphan itself is gone by the time the ladder plans. Selling it now would OPEN a short.
    const broker = brokerMovingAfterSnapshot(harness, () => { harness.fake.setPositions([]); });
    const report = await harness.cycle({ broker });
    expect(report.managementCloses).toEqual([]);
    // The residue targets are re-derived from the management step's own book, so nothing is planned at all —
    // the eligibility gate is never asked, and no refused attempt is recorded (iterating the phase-1
    // classification would plan the vanished lot and land a refusal here).
    expect(report.managementRefusals).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([]);
    expect(closeIntents(harness)).toEqual([]);
    expect(await harness.fake.read.positions()).toEqual([]);
  });

  it("S-G10-03 a residue that shrank after the phase-1 snapshot closes at the fresh quantity only", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    // Phase 1 sees two orphan long lots after the short leg was assigned away …
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 2, avgEntryPriceCents: 100 }]);
    // … one of which leaves the book before the management step. A close for two would exceed what is held.
    const broker = brokerMovingAfterSnapshot(harness, () => { harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 }]); });
    const report = await harness.cycle({ broker });
    expect(report.managementRefusals).toEqual([]);
    expect(report.managementCloses).toMatchObject([{ route: "residue", generation: 0 }]);
    expect(closePayloads(harness)).toMatchObject([{ quantity: 1 }]);
  });

  it("A11/A13 route deadline: a structure that vanished after the phase-1 snapshot is never planned", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills under the normal calendar
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    // The whole structure leaves the book between the phase-1 snapshot and the management step.
    const broker = brokerMovingAfterSnapshot(harness, () => { harness.fake.setPositions([]); });
    const report = await harness.cycle({ ...flattenDay, broker });
    expect(report.managementCloses).toEqual([]);
    // Planning the flatten closure from the phase-1 book would plan a whole-structure close and record its refusal.
    expect(report.managementRefusals).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([]);
    expect(closeIntents(harness)).toEqual([]);
  });

  it("A11/A13 route expiry: an eviction target that vanished after the phase-1 snapshot is never planned", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const broker = brokerMovingAfterSnapshot(harness, () => { harness.fake.setPositions([]); });
    const report = await harness.cycle({ ...evictionDay, broker });
    expect(report.managementCloses).toEqual([]);
    expect(report.managementRefusals).toEqual([]);
    expect(closeSubmissions(harness)).toEqual([]);
    expect(closeIntents(harness)).toEqual([]);
  });

  it("S-X-05 a refused ladder step is recorded, not swallowed: a resting close larger than the fresh exposure vetoes visibly", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 3, avgEntryPriceCents: 100 }]);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const first = await harness.cycle();
    expect(first.managementRefusals).toEqual([]);
    expect(closePayloads(harness)).toMatchObject([{ quantity: 3 }]);
    // Two of the three lots leave the book while the close for three rests: its child is now larger than the exposure.
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 }]);
    const report = await harness.cycle();
    expect(report.managementCloses).toEqual([]);
    expect(report.managementRefusals).toMatchObject([{ exposureLifecycleId: `residue:${LONG_CALL}`, route: "residue", generation: null }]);
    expect(closePayloads(harness)).toHaveLength(1); // the refusal sent nothing new
  });

  it("S-X-05 a resting close that partially filled before the management read closes its remainder in the same cycle", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills
    // Two orphan long lots: the residue route carries a two-lot exposure that the one-lot entry rule never produces.
    harness.fake.setPositions([{ contractId: LONG_CALL, quantity: 2, avgEntryPriceCents: 100 }]);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "partial", filledQuantity: 1 } : { kind: "fill" }));
    const resting = await harness.cycle();
    expect(resting.managementCloses).toMatchObject([{ route: "residue", generation: 0 }]);
    expect(closePayloads(harness)).toMatchObject([{ quantity: 2 }]);
    // One lot filled: the book now holds one, and the resting attempt reports one of two filled.
    expect(await harness.fake.read.positions()).toMatchObject([{ contractId: LONG_CALL, quantity: 1 }]);

    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const report = await harness.cycle();
    expect(report.managementRefusals).toEqual([]);
    // The remainder is the fresh exposure, not the fresh exposure minus the fill it already excludes.
    expect(report.managementCloses).toMatchObject([{ route: "residue", generation: 1 }]);
    expect(closePayloads(harness).filter(item => item.clientOrderId.endsWith(":g1"))).toMatchObject([{ quantity: 1 }]);
  });
});

describe("S-CYC-04 at the close side — phase 0 resolves close attempts the ladder no longer visits", () => {
  const flattenDay = { tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) };

  function restingCloseAttempt(harness: LifecycleHarness): string {
    const resting = harness.fake.allOrders().find(order => order.clientOrderId.startsWith("close:") && isWorkingBrokerStatus(order.status));
    if (resting === undefined) throw new Error("fixture expects exactly one resting close attempt");
    return resting.clientOrderId;
  }

  /** The close attempt as the journal fold sees it — the projection's own view of the close lifecycle. */
  function foldedClose(harness: LifecycleHarness, attemptId: string) {
    const fold = foldLifecycles(harness.entries());
    if (!fold.ok) throw new Error(`fold failed: ${fold.reason}`);
    return fold.closes.find(close => close.attemptId === attemptId);
  }

  function outcomesFor(harness: LifecycleHarness, attemptId: string): readonly Record<string, unknown>[] {
    return harness.entries().filter(entry => entry.type === "OUTCOME" && entry["clientOrderId"] === attemptId);
  }

  it("A5 / S-J-09 the close that filled unobserved gets its OUTCOME in the next cycle's phase 0, and the fold turns terminal", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the credit vertical fills under the normal calendar
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    await harness.cycle(flattenDay); // the deadline close rests at the broker
    const resting = restingCloseAttempt(harness);
    // The A1 scenario: the resting close fills while the analyst step runs, so no ladder step ever looks at it again.
    await harness.cycle({ ...flattenDay, analyst: () => { harness.fake.transitionOrder(resting, { status: "filled" }); return Promise.resolve(CANDIDATE_JSON); } });
    expect(foldedClose(harness, resting)?.status).toBe("submitted");

    const report = await harness.cycle(flattenDay);
    expect(report.resolved).toContainEqual({ clientOrderId: resting, result: "OUTCOME:filled" });
    expect(outcomesFor(harness, resting)).toMatchObject([{ status: "filled", filledQuantity: 1, avgFillPriceCents: 200 }]);
    expect(foldedClose(harness, resting)).toMatchObject({ status: "filled", filledQuantity: 1 });
    expect(report.entriesBlocked).toEqual([]);
  });

  it("A5 a resting close canceled at the broker is journaled canceled in phase 0, before the ladder's next generation", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    await harness.cycle(flattenDay);
    const resting = restingCloseAttempt(harness);
    // Canceled at the broker while nobody was looking (a venue action or a human in the dashboard).
    harness.fake.transitionOrder(resting, { status: "canceled", reason: "canceled at the venue" });

    const report = await harness.cycle(flattenDay);
    expect(report.resolved).toContainEqual({ clientOrderId: resting, result: "OUTCOME:canceled" });
    expect(outcomesFor(harness, resting)).toMatchObject([{ status: "canceled", filledQuantity: 0 }]);
    expect(foldedClose(harness, resting)?.status).toBe("canceled");
    // Phase 0 runs before management: the outcome is journaled ahead of the next generation's close INTENT.
    const types = harness.entries().map(entry => `${entry.type}:${typeof entry["clientOrderId"] === "string" ? entry["clientOrderId"] : ""}`);
    const outcomeAt = types.indexOf(`OUTCOME:${resting}`);
    const nextIntentAt = types.findIndex(item => item.startsWith("INTENT:close:") && item.endsWith(":g1"));
    expect(outcomeAt).toBeGreaterThanOrEqual(0);
    expect(nextIntentAt).toBeGreaterThan(outcomeAt);
  });

  it("S-CYC-04 a failed lookup invents no outcome: the attempt stays non-terminal and blocks entries", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    await harness.cycle(flattenDay);
    const resting = restingCloseAttempt(harness);
    const broker: BrokerReadPort = {
      ...harness.fake.read,
      orderByClientId: (clientOrderId, deadlineAtMs) => (clientOrderId === resting
        ? Promise.reject(new Error("fake broker: orders endpoint unavailable"))
        : harness.fake.read.orderByClientId(clientOrderId, deadlineAtMs)),
    };

    const report = await harness.cycle({ ...flattenDay, broker });
    expect(outcomesFor(harness, resting)).toEqual([]);
    expect(foldedClose(harness, resting)?.status).toBe("submitted");
    expect(report.entriesBlocked).toContain(`UNRESOLVED:${resting}`);
    expect(report.resolved).toContainEqual({ clientOrderId: resting, result: "UNRESOLVED" });
  });

  it("S-CYC-04 a close attempt the broker does not know stays reserved and blocking, cycle after cycle", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    // The port throws before the order is created: the close INTENT is durable, the attempt's existence is not.
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "lose_ack_never_sent" } : { kind: "fill" }));
    const lost = await harness.cycle(flattenDay);
    const attemptId = lost.managementCloses[0]?.attemptId ?? "";
    expect(foldedClose(harness, attemptId)?.status).toBe("confirmation_unclear");

    const report = await harness.cycle(flattenDay);
    expect(outcomesFor(harness, attemptId)).toHaveLength(1); // the submit-time OUTCOME, never a second one
    expect(foldedClose(harness, attemptId)?.status).toBe("confirmation_unclear");
    expect(report.entriesBlocked).toContain(`UNRESOLVED:${attemptId}`);
    expect(report.resolved).toContainEqual({ clientOrderId: attemptId, result: "NOT_AT_BROKER" });
  });

  it("an already terminal close attempt is never queried again", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    // The close fills on submit: its OUTCOME is journaled inside the same cycle, the attempt is terminal.
    const closed = await harness.cycle(flattenDay);
    const attemptId = closed.managementCloses[0]?.attemptId;
    expect(attemptId).toBeDefined();
    expect(foldedClose(harness, attemptId ?? "")?.status).toBe("filled");

    const lookups: string[] = [];
    const broker: BrokerReadPort = {
      ...harness.fake.read,
      orderByClientId: (clientOrderId, deadlineAtMs) => { lookups.push(clientOrderId); return harness.fake.read.orderByClientId(clientOrderId, deadlineAtMs); },
    };
    await harness.cycle({ ...flattenDay, broker });
    expect(lookups.filter(clientOrderId => clientOrderId === attemptId)).toEqual([]);
  });
});

describe("lotCount guard", () => {
  it("the equity sentinel leg carries a constructed unit ratio", () => {
    expect(lotCount(1)).toBe(1);
  });
});
