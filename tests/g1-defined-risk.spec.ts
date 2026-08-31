import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit, lotCount } from "../src/core/domain.js";
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
    const value = candidate({ declaredStructureType: "vertical_debit", legs: verticalLegs(), quantity: lotCount(2), entryLimit: { kind: "debit", priceCents: integerUnit(125, "OptionPriceCents") } });
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
    const value = candidate({ declaredStructureType: "vertical_credit", sleeve: "income", legs: [{ ...longLeg, side: "sell" }, { ...shortLeg, side: "buy" }], quantity: lotCount(2), entryLimit: { kind: "credit", priceCents: integerUnit(150, "OptionPriceCents") } });
    const base = marketFor(value);
    const decisionSnapshot = snapshot({ ...base, quotesByContract: { ...base.quotesByContract, [value.legs[0]!.contractId]: quote({ bidCents: integerUnit(250, "OptionPriceCents"), askCents: integerUnit(252, "OptionPriceCents") }) } });
    expect(gateOne(value, decisionSnapshot).reservedMaxLossCents).toBe(70_000);

    const equality = candidate({
      declaredStructureType: "vertical_credit",
      sleeve: "income",
      legs: [{ ...longLeg, side: "sell" }, { ...shortLeg, side: "buy" }],
      entryLimit: { kind: "credit", priceCents: integerUnit(500, "OptionPriceCents") },
    });
    const equalityVerdict = gateOne(equality);
    expect(equalityVerdict.reservedMaxLossCents).toBe(0);
    expect(equalityVerdict.gateVector[0]).toMatchObject({ passed: true, code: "PASS" });
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
    const equalityVerdict = gateOne(equality);
    expect(equalityVerdict.reservedMaxLossCents).toBe(0);
    expect(equalityVerdict.gateVector[0]).toMatchObject({ passed: true, code: "PASS" });
  });

  it("S-G1-04 accepts a long option and uses the submitted buy limit", () => {
    expect(gateOne(candidate({ quantity: lotCount(3), entryLimit: { kind: "debit", priceCents: integerUnit(75, "OptionPriceCents") } })).reservedMaxLossCents).toBe(22_500);
  });

  it("S-G1-05 vetoes every naked short pattern", () => {
    const value = candidate({ legs: [leg({ side: "sell" })], sleeve: "income", entryLimit: { kind: "credit", priceCents: integerUnit(100, "OptionPriceCents") } });
    expect(gateOne(value).gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
  });

  it("S-G1-06 vetoes a ratio spread with a net short side", () => {
    const [longLeg, shortLeg] = verticalLegs();
    const value = candidate({ declaredStructureType: "vertical_credit", sleeve: "income", legs: [longLeg, { ...shortLeg, ratio: lotCount(2) }], entryLimit: { kind: "credit", priceCents: integerUnit(100, "OptionPriceCents") } });
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

  it("S-G1-03 vetoes an iron condor whose wings overlap instead of reserving one wing", () => {
    const legs: OptionLeg[] = [
      leg({ contractId: "P-90", right: "put", strikeCents: integerUnit(9_000, "StrikeCents"), side: "buy" }),
      leg({ contractId: "P-100", right: "put", strikeCents: integerUnit(10_000, "StrikeCents"), side: "sell" }),
      leg({ contractId: "C-50", strikeCents: integerUnit(5_000, "StrikeCents"), side: "sell" }),
      leg({ contractId: "C-60", strikeCents: integerUnit(6_000, "StrikeCents"), side: "buy" }),
    ];
    const value = candidate({ declaredStructureType: "iron_condor", sleeve: "income", legs, entryLimit: { kind: "credit", priceCents: integerUnit(0, "OptionPriceCents") } });
    const overlapping = gateOne(value);
    expect(overlapping.gateVector[0]).toMatchObject({ passed: false, code: "DEFINED_RISK" });
    expect(overlapping.reservedMaxLossCents).toBeNull();
  });

  it("S-G1-01..03 reserve exactly the independent expiry-payoff maximum loss", () => {
    const expiryMaxLossCents = (value: EntryCandidate): number => {
      const strikes = value.legs.map(optionLeg => optionLeg.strikeCents);
      const points = [0, ...strikes, Math.max(...strikes) + 1_000_000];
      const premium = value.entryLimit.kind === "debit" ? -Number(value.entryLimit.priceCents) : Number(value.entryLimit.priceCents);
      const pnlAt = (spot: number) => value.legs.reduce((total, optionLeg) => {
        const intrinsic = optionLeg.right === "call" ? Math.max(spot - optionLeg.strikeCents, 0) : Math.max(optionLeg.strikeCents - spot, 0);
        return total + (optionLeg.side === "buy" ? intrinsic : -intrinsic) * optionLeg.ratio;
      }, premium);
      return Math.max(0, -Math.min(...points.map(pnlAt))) * 100 * value.quantity;
    };
    const [longLeg, shortLeg] = verticalLegs();
    const structures = [
      candidate({ declaredStructureType: "vertical_debit", legs: verticalLegs(), quantity: lotCount(2), entryLimit: { kind: "debit", priceCents: integerUnit(125, "OptionPriceCents") } }),
      candidate({ declaredStructureType: "vertical_credit", sleeve: "income", legs: [{ ...longLeg, side: "sell" }, { ...shortLeg, side: "buy" }], quantity: lotCount(3), entryLimit: { kind: "credit", priceCents: integerUnit(150, "OptionPriceCents") } }),
      candidate({
        declaredStructureType: "iron_condor",
        sleeve: "income",
        legs: [
          leg({ contractId: "P-490", right: "put", strikeCents: integerUnit(49_000, "StrikeCents"), side: "buy" }),
          leg({ contractId: "P-495", right: "put", strikeCents: integerUnit(49_500, "StrikeCents"), side: "sell" }),
          leg({ contractId: "C-505", strikeCents: integerUnit(50_500, "StrikeCents"), side: "sell" }),
          leg({ contractId: "C-512", strikeCents: integerUnit(51_200, "StrikeCents"), side: "buy" }),
        ],
        entryLimit: { kind: "credit", priceCents: integerUnit(200, "OptionPriceCents") },
      }),
    ];
    for (const value of structures) {
      expect(gateOne(value).reservedMaxLossCents).toBe(expiryMaxLossCents(value));
    }
  });
});
