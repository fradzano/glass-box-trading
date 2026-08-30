import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { EntryCandidate, OptionLeg } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, leg, marketFor, quote, snapshot } from "./fixtures.js";

function gateOne(candidateValue: EntryCandidate, decisionSnapshot = marketFor(candidateValue)) {
  return decide(decisionSnapshot, { kind: "candidates", candidates: [candidateValue] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW).candidateVerdicts[0]!;
}

function verticalLegs(): readonly [OptionLeg, OptionLeg] {
  return [
    leg({ contractId: "SPY-C-500", strikeCents: integerUnit(50_000, "StrikeCents"), side: "buy" }),
    leg({ contractId: "SPY-C-505", strikeCents: integerUnit(50_500, "StrikeCents"), side: "sell" }),
  ];
}

describe("G1 defined risk", () => {
  it("S-G1-01 accepts a vertical debit and derives max loss from the submitted debit", () => {
    const value = candidate({ declaredStructureType: "vertical_debit", legs: verticalLegs(), quantity: integerUnit(2, "Quantity"), entryLimit: { kind: "debit", priceCents: integerUnit(125, "OptionPriceCents") } });
    expect(gateOne(value).reservedMaxLossCents).toBe(25_000);

    const [lowerLong, higherShort] = verticalLegs();
    const reversedPayoff = candidate({
      declaredStructureType: "vertical_debit",
      legs: [{ ...lowerLong, side: "sell" }, { ...higherShort, side: "buy" }],
      entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") },
    });
    expect(gateOne(reversedPayoff).gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
  });

  it("S-G1-02 accepts a vertical credit and derives width minus submitted credit", () => {
    const [longLeg, shortLeg] = verticalLegs();
    const value = candidate({ declaredStructureType: "vertical_credit", sleeve: "income", legs: [{ ...longLeg, side: "sell" }, { ...shortLeg, side: "buy" }], quantity: integerUnit(2, "Quantity"), entryLimit: { kind: "credit", priceCents: integerUnit(150, "OptionPriceCents") } });
    const base = marketFor(value);
    const decisionSnapshot = snapshot({ ...base, quotesByContract: { ...base.quotesByContract, [value.legs[0]!.contractId]: quote({ bidCents: integerUnit(250, "OptionPriceCents"), askCents: integerUnit(252, "OptionPriceCents") }) } });
    expect(gateOne(value, decisionSnapshot).reservedMaxLossCents).toBe(70_000);

    const equality = candidate({
      declaredStructureType: "vertical_credit",
      sleeve: "income",
      legs: [{ ...longLeg, side: "sell" }, { ...shortLeg, side: "buy" }],
      entryLimit: { kind: "credit", priceCents: integerUnit(500, "OptionPriceCents") },
    });
    expect(gateOne(equality)).toMatchObject({ reservedMaxLossCents: 0, gateVector: [expect.objectContaining({ passed: true, code: "PASS" })] });
  });

  it("S-G1-03 accepts an iron condor and uses the wider wing", () => {
    const legs: OptionLeg[] = [
      leg({ contractId: "P-490", right: "put", strikeCents: integerUnit(49_000, "StrikeCents"), side: "buy" }),
      leg({ contractId: "P-495", right: "put", strikeCents: integerUnit(49_500, "StrikeCents"), side: "sell" }),
      leg({ contractId: "C-505", strikeCents: integerUnit(50_500, "StrikeCents"), side: "sell" }),
      leg({ contractId: "C-512", strikeCents: integerUnit(51_200, "StrikeCents"), side: "buy" }),
    ];
    const value = candidate({ declaredStructureType: "iron_condor", sleeve: "income", legs, entryLimit: { kind: "credit", priceCents: integerUnit(200, "OptionPriceCents") } });
    const base = marketFor(value);
    const decisionSnapshot = snapshot({ ...base, quotesByContract: { ...base.quotesByContract, "P-495": quote({ bidCents: integerUnit(220, "OptionPriceCents"), askCents: integerUnit(222, "OptionPriceCents") }), "C-505": quote({ bidCents: integerUnit(220, "OptionPriceCents"), askCents: integerUnit(222, "OptionPriceCents") }) } });
    expect(gateOne(value, decisionSnapshot).reservedMaxLossCents).toBe(50_000);

    const equality = candidate({
      declaredStructureType: "iron_condor",
      sleeve: "income",
      legs,
      entryLimit: { kind: "credit", priceCents: integerUnit(700, "OptionPriceCents") },
    });
    expect(gateOne(equality)).toMatchObject({ reservedMaxLossCents: 0, gateVector: [expect.objectContaining({ passed: true, code: "PASS" })] });
  });

  it("S-G1-04 accepts a long option and uses the submitted buy limit", () => {
    expect(gateOne(candidate({ quantity: integerUnit(3, "Quantity"), entryLimit: { kind: "debit", priceCents: integerUnit(75, "OptionPriceCents") } })).reservedMaxLossCents).toBe(22_500);
  });

  it("S-G1-05 vetoes every naked short pattern", () => {
    const value = candidate({ legs: [leg({ side: "sell" })], sleeve: "income", entryLimit: { kind: "credit", priceCents: integerUnit(100, "OptionPriceCents") } });
    expect(gateOne(value).gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
  });

  it("S-G1-06 vetoes a ratio spread with a net short side", () => {
    const [longLeg, shortLeg] = verticalLegs();
    const value = candidate({ declaredStructureType: "vertical_credit", sleeve: "income", legs: [longLeg, { ...shortLeg, ratio: integerUnit(2, "Quantity") }], entryLimit: { kind: "credit", priceCents: integerUnit(100, "OptionPriceCents") } });
    expect(gateOne(value).gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
  });

  it("S-G1-07 vetoes a leg pattern whose maximum loss cannot be computed", () => {
    const value = candidate({ declaredStructureType: "calendar", legs: [leg(), leg({ contractId: "SPY-C-NEXT", expiry: "2026-09-11", side: "sell" })] });
    expect(gateOne(value).gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
  });

  it("S-G1-08 vetoes a degenerate spread with the same contract twice", () => {
    const same = leg();
    const value = candidate({ declaredStructureType: "vertical_debit", legs: [same, { ...same, side: "sell" }] });
    expect(gateOne(value).gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
  });
});
