import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, exposure, snapshot } from "./fixtures.js";

describe("G3 and G4 exact risk caps", () => {
  it("S-G3-01 passes equality and vetoes one cent above the position cap", () => {
    const config = { ...TEST_ONLY_O5_CONFIG, convexBudgetCents: integerUnit(100_000, "MoneyCents"), maxLossPerPositionBps: integerUnit(1_000, "BasisPoints") };
    const equality = candidate({ entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const above = candidate({ candidateId: "above", entryLimit: { kind: "debit", priceCents: integerUnit(101, "OptionPriceCents") } });
    expect(decide(snapshot(), { kind: "candidates", candidates: [equality] }, config, TEST_ONLY_NOW).candidateVerdicts[0]?.gateVector[2]).toMatchObject({ passed: true });
    expect(decide(snapshot(), { kind: "candidates", candidates: [above] }, config, TEST_ONLY_NOW).candidateVerdicts[0]?.gateVector[2]).toMatchObject({ passed: false, code: "POSITION_SIZE" });
  });

  it("S-G4-01 counts filled and reserved exposure across sleeves with equality inclusive", () => {
    const config = { ...TEST_ONLY_O5_CONFIG, maxUnderlyingExposureCents: integerUnit(20_000, "MoneyCents") };
    const existing = exposure({ risk: [{ kind: "filled", maxLossCents: integerUnit(5_000, "MoneyCents") }, { kind: "entry", state: "fillable", maxLossCents: integerUnit(5_000, "MoneyCents") }] });
    const equality = candidate({ entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") } });
    const above = candidate({ entryLimit: { kind: "debit", priceCents: integerUnit(101, "OptionPriceCents") } });
    expect(decide(snapshot({ exposureLifecycles: [existing] }), { kind: "candidates", candidates: [equality] }, config, TEST_ONLY_NOW).candidateVerdicts[0]?.gateVector[3]).toMatchObject({ passed: true });
    expect(decide(snapshot({ exposureLifecycles: [existing] }), { kind: "candidates", candidates: [above] }, config, TEST_ONLY_NOW).candidateVerdicts[0]?.gateVector[3]).toMatchObject({ passed: false, code: "CONCENTRATION" });
  });
});
