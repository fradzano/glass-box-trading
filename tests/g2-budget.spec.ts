import { describe, expect, it } from "vitest";
import { decide, reconcilePartialFillRisk } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { DecisionConfig, EntryCandidate, EntryReservationState } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, exposure, snapshot } from "./fixtures.js";

function run(candidateValues: readonly EntryCandidate[], decisionSnapshot = snapshot(), config: DecisionConfig = TEST_ONLY_O5_CONFIG) {
  return decide(decisionSnapshot, { kind: "candidates", candidates: candidateValues }, config, TEST_ONLY_NOW);
}

describe("G2 sleeve budgets", () => {
  it("S-G2-01 passes exact equality with the remaining income budget", () => {
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
    const first = candidate({ candidateId: "first", structureIdentity: "first", entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const second = candidate({ candidateId: "second", structureIdentity: "second", entryLimit: { kind: "debit", priceCents: integerUnit(60, "OptionPriceCents") } });
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
    const tenLot = candidate({ quantity: integerUnit(10, "Quantity"), entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const reconciled = reconcilePartialFillRisk(tenLot, integerUnit(4, "Quantity"), integerUnit(80, "OptionPriceCents"), integerUnit(6, "Quantity"));
    expect(reconciled.components).toEqual([
      { kind: "filled", state: "filled", maxLossCents: 32_000 },
      { kind: "entry", state: "fillable", maxLossCents: 60_000 },
    ]);
    expect(reconciled.totalMaxLossCents).toBe(92_000);
  });

  it("S-G2-07 releases entry reservation on every terminal path and never reserves exits", () => {
    const terminalStates: readonly EntryReservationState[] = ["filled", "rejected", "canceled", "expired"];
    for (const state of terminalStates) {
      const decisionSnapshot = snapshot({ exposureLifecycles: [exposure({ sleeve: "convex", risk: [{ kind: "entry", state, maxLossCents: integerUnit(800_000, "MoneyCents") }, { kind: "exit", state: "fillable", maxLossCents: integerUnit(800_000, "MoneyCents") }] })] });
      expect(run([candidate()], decisionSnapshot).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: true });
    }
  });

  it("S-G2-08 keeps income and convex budgets disjoint", () => {
    const incomeFull = snapshot({ exposureLifecycles: [exposure({ risk: [{ kind: "filled", state: "filled", maxLossCents: integerUnit(1_200_000, "MoneyCents") }] })] });
    expect(run([candidate()], incomeFull).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: true });
    const incomeCandidate = candidate({ sleeve: "income" });
    expect(run([incomeCandidate], incomeFull).candidateVerdicts[0]?.gateVector[1]).toMatchObject({ passed: false });
  });
});
