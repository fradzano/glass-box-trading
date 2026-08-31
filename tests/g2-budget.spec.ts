import { describe, expect, it } from "vitest";
import { decide, reconcilePartialFillRisk } from "../src/core/decision.js";
import { integerUnit, lotCount } from "../src/core/domain.js";
import type { DecisionConfig, EntryCandidate, ExposureRiskComponent, MoneyCents, ReleasedEntryState } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, exposure, leg, snapshot } from "./fixtures.js";

function run(candidateValues: readonly EntryCandidate[], decisionSnapshot = snapshot(), config: DecisionConfig = TEST_ONLY_O5_CONFIG) {
  return decide(decisionSnapshot, { kind: "candidates", candidates: candidateValues }, config, TEST_ONLY_NOW);
}

describe("G2 sleeve budgets", () => {
  it("S-G2-01 passes exact equality with the remaining income budget", () => {
    expect(() => integerUnit(-1, "MoneyCents")).toThrow("MoneyCents must be non-negative");
    const malformedSnapshot = snapshot({
      exposureLifecycles: [exposure({ sleeve: "convex", risk: [{ kind: "filled", maxLossCents: -1 as MoneyCents }] })],
    });
    expect(run([candidate()], malformedSnapshot).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false, code: "BUDGET" });
    const value = candidate({ sleeve: "income", declaredStructureType: "long_option", entryLimit: { kind: "debit", priceCents: integerUnit(12_000, "OptionPriceCents") } });
    const config = { ...TEST_ONLY_O5_CONFIG, incomeBudgetCents: integerUnit(1_200_000, "MoneyCents"), structureWhitelist: [...TEST_ONLY_O5_CONFIG.structureWhitelist, "long_option"] };
    expect(run([value], snapshot(), config).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: true });
  });

  it("S-G2-02 vetoes a candidate that exceeds the sleeve by one cent", () => {
    const config = { ...TEST_ONLY_O5_CONFIG, convexBudgetCents: integerUnit(10_000, "MoneyCents") };
    const value = candidate({ entryLimit: { kind: "debit", priceCents: integerUnit(101, "OptionPriceCents") } });
    expect(run([value], snapshot(), config).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false, code: "BUDGET" });
  });

  it("S-G2-03 reserves an approved candidate before evaluating the next", () => {
    const config = { ...TEST_ONLY_O5_CONFIG, convexBudgetCents: integerUnit(15_000, "MoneyCents") };
    const first = candidate({ candidateId: "first", entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const second = candidate({ candidateId: "second", entryLimit: { kind: "debit", priceCents: integerUnit(60, "OptionPriceCents") } });
    const verdicts = run([first, second], snapshot(), config).candidateVerdicts;
    expect(verdicts.map(verdict => verdict.gateVector[1]?.passed)).toEqual([true, false]);
  });

  it("S-G2-04 counts a fillable entry order before any fill", () => {
    const decisionSnapshot = snapshot({ exposureLifecycles: [exposure({ sleeve: "convex", risk: [{ kind: "entry", state: "fillable", maxLossCents: integerUnit(795_000, "MoneyCents") }] })] });
    expect(run([candidate()], decisionSnapshot).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false });
  });

  it("S-G2-05 keeps confirmation-unclear entry risk reserved", () => {
    const decisionSnapshot = snapshot({ exposureLifecycles: [exposure({ sleeve: "convex", risk: [{ kind: "entry", state: "confirmation_unclear", maxLossCents: integerUnit(795_000, "MoneyCents") }] })] });
    expect(run([candidate()], decisionSnapshot).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false });
  });

  it("S-G2-06 splits partial fills into actual fill risk and remaining limit reservation exactly once", () => {
    const tenLot = candidate({ quantity: lotCount(10), entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const reconciled = reconcilePartialFillRisk(tenLot, integerUnit(4, "Quantity"), integerUnit(80, "OptionPriceCents"), integerUnit(6, "Quantity"));
    expect(reconciled.components).toEqual([
      { kind: "filled", maxLossCents: 32_000 },
      { kind: "entry", state: "fillable", maxLossCents: 60_000 },
    ]);
    expect(reconciled.totalMaxLossCents).toBe(92_000);
    expect(() => reconcilePartialFillRisk(
      tenLot,
      integerUnit(4, "Quantity"),
      integerUnit(120, "OptionPriceCents"),
      integerUnit(6, "Quantity"),
    )).toThrow("broker fill price is worse than the approved entry limit");
    const creditTenLot = candidate({
      declaredStructureType: "vertical_credit",
      sleeve: "income",
      quantity: lotCount(10),
      entryLimit: { kind: "credit", priceCents: integerUnit(100, "OptionPriceCents") },
      legs: [
        leg({ contractId: "short-call", side: "sell", strikeCents: integerUnit(50_000, "StrikeCents") }),
        leg({ contractId: "long-call", side: "buy", strikeCents: integerUnit(50_500, "StrikeCents") }),
      ],
    });
    expect(() => reconcilePartialFillRisk(
      creditTenLot,
      integerUnit(4, "Quantity"),
      integerUnit(80, "OptionPriceCents"),
      integerUnit(6, "Quantity"),
    )).toThrow("broker fill price is worse than the approved entry limit");
  });

  it("S-G2-06/07 keeps every approved unit accounted: a partial-fill report that loses a unit is rejected, never silently released", () => {
    const tenLot = candidate({ quantity: lotCount(10), entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const fill = integerUnit(80, "OptionPriceCents");
    // 4 filled + 5 resting = 9 of 10: the tenth unit has no observed terminal state and cannot vanish from the reservation.
    expect(() => reconcilePartialFillRisk(tenLot, integerUnit(4, "Quantity"), fill, integerUnit(5, "Quantity"))).toThrow(RangeError);
    expect(() => reconcilePartialFillRisk(tenLot, integerUnit(0, "Quantity"), fill, integerUnit(9, "Quantity"))).toThrow(RangeError);
    // Complete reports still reconcile exactly once.
    expect(reconcilePartialFillRisk(tenLot, integerUnit(0, "Quantity"), fill, integerUnit(10, "Quantity")).totalMaxLossCents).toBe(100_000);
    expect(reconcilePartialFillRisk(tenLot, integerUnit(10, "Quantity"), fill, integerUnit(0, "Quantity")).totalMaxLossCents).toBe(80_000);
    expect(reconcilePartialFillRisk(tenLot, integerUnit(4, "Quantity"), fill, integerUnit(6, "Quantity")).totalMaxLossCents).toBe(92_000);
  });

  it("S-G2-07 releases entry reservation on every terminal path and never reserves exits", () => {
    const releasedStates: readonly ReleasedEntryState[] = ["rejected", "canceled", "expired"];
    for (const state of releasedStates) {
      const decisionSnapshot = snapshot({ exposureLifecycles: [exposure({ sleeve: "convex", risk: [{ kind: "entry", state, maxLossCents: integerUnit(800_000, "MoneyCents") }, { kind: "exit", state: "fillable", maxLossCents: integerUnit(800_000, "MoneyCents") }] })] });
      expect(run([candidate()], decisionSnapshot).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: true });
    }
    const filledPosition = snapshot({ exposureLifecycles: [exposure({ sleeve: "convex", risk: [{ kind: "filled", maxLossCents: integerUnit(800_000, "MoneyCents") }] })] });
    expect(run([candidate()], filledPosition).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false, code: "BUDGET" });
  });

  it("S-G2-08 keeps income and convex budgets disjoint", () => {
    const incomeFull = snapshot({ exposureLifecycles: [exposure({ risk: [{ kind: "filled", maxLossCents: integerUnit(1_200_000, "MoneyCents") }] })] });
    expect(run([candidate()], incomeFull).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: true });
    const incomeCandidate = candidate({ sleeve: "income" });
    expect(run([incomeCandidate], incomeFull).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false });
  });

  it("S-G2-07 counts every entry component that is not released, even when its state lies outside the open set", () => {
    const forged = { kind: "entry", state: "filled", maxLossCents: integerUnit(800_000, "MoneyCents") } as unknown as ExposureRiskComponent;
    const consumed = snapshot({ exposureLifecycles: [exposure({ sleeve: "convex", risk: [forged] })] });
    const result = run([candidate()], consumed);
    expect(result.candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false, code: "BUDGET" });
    expect(result.actions).toEqual([]);
  });
});
