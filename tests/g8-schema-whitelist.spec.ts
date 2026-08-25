import { describe, expect, it } from "vitest";
import { decide, parseAnalystOutput } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { DecisionConfig, DecisionSnapshot, EntryCandidate } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, leg, marketFor, quote, snapshot } from "./fixtures.js";

function run(candidateValues: readonly EntryCandidate[], decisionSnapshot: DecisionSnapshot = snapshot(), config: DecisionConfig = TEST_ONLY_O5_CONFIG) {
  return decide(decisionSnapshot, { kind: "candidates", candidates: candidateValues }, config, TEST_ONLY_NOW);
}

describe("G8 schema and whitelist", () => {
  it("S-G8-01 drops structural failure wholesale while semantic failure drops only its candidate", () => {
    for (const raw of ["not-json", "{\"candidates\":[", "{\"wrong\":[]}"]) {
      const result = decide(snapshot(), parseAnalystOutput(raw), TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
      expect(result).toMatchObject({ actions: [], candidateVerdicts: [], batchVerdicts: [expect.objectContaining({ code: "SCHEMA_VETO" })] });
    }
    const invalid = candidate({ candidateId: "outside", structureIdentity: "outside", legs: [leg({ underlying: "IWM" })] });
    const valid = candidate({ candidateId: "valid", structureIdentity: "valid" });
    const semantic = run([invalid, valid]);
    expect(semantic.candidateVerdicts).toHaveLength(2);
    expect(semantic.actions.map(action => action.candidateId)).toEqual(["valid"]);

    const loneSurrogate = { ...candidate(), structureIdentity: "\uD800" };
    expect(parseAnalystOutput(JSON.stringify({ candidates: [loneSurrogate] }))).toMatchObject({ kind: "structural_failure" });
  });

  it("S-G8-02 treats refusal prose and non-candidate text as structural failure", () => {
    expect(parseAnalystOutput("I cannot provide candidates.")).toMatchObject({ kind: "structural_failure" });
    expect(parseAnalystOutput(JSON.stringify({ candidates: ["No trade today"] }))).toMatchObject({ kind: "structural_failure" });
  });

  it("S-G8-03 applies inclusive whitelist bounds and vetoes one unit beyond each", () => {
    const equality = candidate({ quantity: TEST_ONLY_O5_CONFIG.maxCandidateQuantity, remainingTradingSessions: TEST_ONLY_O5_CONFIG.expiryMaxSessions, legs: [leg({ strikeCents: integerUnit(60_000, "StrikeCents") })] });
    const equalitySnapshot = marketFor(equality, snapshot({ spotCentsByUnderlying: { SPY: integerUnit(50_000, "StrikeCents") } }));
    expect(run([equality], equalitySnapshot).candidateVerdicts[0]?.gateVector[7]).toMatchObject({ passed: true });

    const outside: EntryCandidate[] = [
      candidate({ candidateId: "underlying", structureIdentity: "underlying", legs: [leg({ underlying: "IWM" })] }),
      candidate({ candidateId: "structure", structureIdentity: "structure", declaredStructureType: "calendar" }),
      candidate({ candidateId: "expiry", structureIdentity: "expiry", remainingTradingSessions: integerUnit(TEST_ONLY_O5_CONFIG.expiryMaxSessions + 1, "Quantity") }),
      candidate({ candidateId: "strike", structureIdentity: "strike", legs: [leg({ strikeCents: integerUnit(60_001, "StrikeCents") })] }),
      candidate({ candidateId: "qty", structureIdentity: "qty", quantity: integerUnit(TEST_ONLY_O5_CONFIG.maxCandidateQuantity + 1, "Quantity") }),
    ];
    const decisionSnapshot = marketFor(outside[3]!, snapshot({ knownContractIds: [...snapshot().knownContractIds, ...outside.flatMap(value => value.legs.map(optionLeg => optionLeg.contractId))] }));
    const result = run(outside, decisionSnapshot);
    for (const verdict of result.candidateVerdicts) expect(verdict.gateVector[7]).toMatchObject({ passed: false, code: "WHITELIST" });

    const hugeRaw = JSON.stringify({
      candidates: [
        { ...candidate(), candidateId: "huge", structureIdentity: "huge", quantity: Number.MAX_SAFE_INTEGER },
        { ...candidate(), candidateId: "after-huge", structureIdentity: "after-huge" },
      ],
    });
    const hugeResult = decide(snapshot(), parseAnalystOutput(hugeRaw), TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(hugeResult.candidateVerdicts).toHaveLength(2);
    expect(hugeResult.candidateVerdicts[0]?.gateVector).toHaveLength(8);
    expect(hugeResult.candidateVerdicts[0]?.gateVector[7]).toMatchObject({ passed: false, code: "WHITELIST" });
    expect(hugeResult.actions.map(action => action.candidateId)).toEqual(["after-huge"]);
  });

  it("S-G8-04 vetoes rather than repairing out-of-range values", () => {
    const oversized = candidate({ quantity: integerUnit(TEST_ONLY_O5_CONFIG.maxCandidateQuantity + 1, "Quantity") });
    const result = run([oversized]);
    expect(result.actions).toEqual([]);
    expect(result.candidateVerdicts[0]?.gateVector[7]?.reasons).toContainEqual(expect.stringContaining("quantity"));
  });

  it("S-G8-05 vetoes contracts absent from the fetched chain", () => {
    const unknown = candidate({ legs: [leg({ contractId: "SPY-TYPO" })] });
    expect(run([unknown]).candidateVerdicts[0]?.gateVector[7]).toMatchObject({ passed: false, code: "UNKNOWN_CONTRACT" });
  });

  it("S-G8-06 derives sleeve economics from leg quotes despite a contradictory declared type", () => {
    const creditLegs = [
      leg({ contractId: "SPY-C-500-S", side: "sell", strikeCents: integerUnit(50_000, "StrikeCents") }),
      leg({ contractId: "SPY-C-505-B", side: "buy", strikeCents: integerUnit(50_500, "StrikeCents") }),
    ];
    const creditTaggedConvex = candidate({ declaredStructureType: "vertical_debit", sleeve: "convex", legs: creditLegs });
    const creditMarket = marketFor(creditTaggedConvex);
    const creditSnapshot = snapshot({ ...creditMarket, quotesByContract: { ...creditMarket.quotesByContract, "SPY-C-500-S": quote({ bidCents: integerUnit(220, "OptionPriceCents"), askCents: integerUnit(222, "OptionPriceCents") }), "SPY-C-505-B": quote({ bidCents: integerUnit(100, "OptionPriceCents"), askCents: integerUnit(102, "OptionPriceCents") }) } });
    expect(run([creditTaggedConvex], creditSnapshot).candidateVerdicts[0]?.gateVector[7]).toMatchObject({ passed: false, code: "SLEEVE_MISMATCH" });

    const debitTaggedIncome = candidate({ declaredStructureType: "vertical_credit", sleeve: "income", legs: creditLegs.map(optionLeg => ({ ...optionLeg, side: optionLeg.side === "sell" ? "buy" as const : "sell" as const })) });
    const debitMarket = marketFor(debitTaggedIncome);
    const debitSnapshot = snapshot({ ...debitMarket, quotesByContract: creditSnapshot.quotesByContract });
    expect(run([debitTaggedIncome], debitSnapshot).candidateVerdicts[0]?.gateVector[7]).toMatchObject({ passed: false, code: "SLEEVE_MISMATCH" });
  });
});
