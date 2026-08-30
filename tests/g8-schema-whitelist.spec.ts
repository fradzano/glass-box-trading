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
    const invalid = candidate({ candidateId: "outside", legs: [leg({ underlying: "IWM" })] });
    const valid = candidate({ candidateId: "valid" });
    const semantic = run([invalid, valid]);
    expect(semantic.candidateVerdicts).toHaveLength(2);
    expect(semantic.actions.map(action => action.candidateId)).toEqual(["valid"]);

    const loneSurrogate = { ...candidate(), candidateId: "\uD800" };
    expect(parseAnalystOutput(JSON.stringify({ candidates: [loneSurrogate] }))).toMatchObject({ kind: "structural_failure" });

    const duplicateIds = [candidate(), candidate({ legs: [leg({ contractId: "ANOTHER-CONTRACT" })] })];
    expect(parseAnalystOutput(JSON.stringify({ candidates: duplicateIds }))).toMatchObject({ kind: "structural_failure" });
    expect(decide(snapshot(), { kind: "candidates", candidates: duplicateIds }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW)).toMatchObject({
      actions: [],
      candidateVerdicts: [],
      batchVerdicts: [expect.objectContaining({ code: "SCHEMA_VETO" })],
    });

    const negativeStrikeRaw = JSON.stringify({ candidates: [{ ...candidate(), legs: [{ ...leg(), strikeCents: -1 }] }] });
    expect(() => parseAnalystOutput(negativeStrikeRaw)).not.toThrow();
    expect(parseAnalystOutput(negativeStrikeRaw)).toMatchObject({ kind: "structural_failure" });
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
      candidate({ candidateId: "underlying", legs: [leg({ contractId: "OUT-UNDERLYING", underlying: "IWM" })] }),
      candidate({ candidateId: "structure", declaredStructureType: "calendar", legs: [leg({ contractId: "OUT-STRUCTURE" })] }),
      candidate({ candidateId: "expiry", remainingTradingSessions: integerUnit(TEST_ONLY_O5_CONFIG.expiryMaxSessions + 1, "Quantity"), legs: [leg({ contractId: "OUT-EXPIRY" })] }),
      candidate({ candidateId: "strike", legs: [leg({ contractId: "OUT-STRIKE", strikeCents: integerUnit(60_001, "StrikeCents") })] }),
      candidate({ candidateId: "qty", quantity: integerUnit(TEST_ONLY_O5_CONFIG.maxCandidateQuantity + 1, "Quantity"), legs: [leg({ contractId: "OUT-QTY" })] }),
    ];
    const decisionSnapshot = outside.reduce((current, value) => marketFor(value, current), snapshot());
    const result = run(outside, decisionSnapshot);
    for (const verdict of result.candidateVerdicts) expect(verdict.gateVector[7]).toMatchObject({ passed: false, code: "WHITELIST" });

    const hugeRaw = JSON.stringify({
      candidates: [
        { ...candidate(), candidateId: "huge", quantity: Number.MAX_SAFE_INTEGER },
        { ...candidate(), candidateId: "after-huge" },
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

    const forged = candidate({
      declaredStructureType: "vertical_credit",
      sleeve: "income",
      entryLimit: { kind: "credit", priceCents: integerUnit(100, "OptionPriceCents") },
      legs: [
        leg({ contractId: "CHAIN-C1", side: "sell", strikeCents: integerUnit(50_000, "StrikeCents") }),
        leg({ contractId: "CHAIN-C2", side: "buy", strikeCents: integerUnit(50_500, "StrikeCents") }),
      ],
    });
    const forgedMarket = marketFor(forged);
    const authoritativeSnapshot = {
      ...forgedMarket,
      contractsById: {
        "CHAIN-C1": { contractId: "CHAIN-C1", underlying: "SPY", expiry: "2026-09-04", strikeCents: integerUnit(40_000, "StrikeCents"), right: "put" as const },
        "CHAIN-C2": { contractId: "CHAIN-C2", underlying: "SPY", expiry: "2026-09-04", strikeCents: integerUnit(50_000, "StrikeCents"), right: "put" as const },
      },
    } as DecisionSnapshot;
    const mismatch = run([forged], authoritativeSnapshot);
    expect(mismatch.actions).toEqual([]);
    expect(mismatch.candidateVerdicts[0]?.gateVector[7]).toMatchObject({ passed: false, code: "UNKNOWN_CONTRACT" });

    for (const prototypeKey of ["__proto__", "constructor", "toString"]) {
      const valid = candidate({ candidateId: `valid-after-${prototypeKey}` });
      const prototypeCandidates = [
        { ...candidate({ candidateId: `contract-${prototypeKey}` }), legs: [{ ...leg(), contractId: prototypeKey }] },
        { ...candidate({ candidateId: `underlying-${prototypeKey}` }), legs: [{ ...leg(), contractId: `MISSING-${prototypeKey}`, underlying: prototypeKey }] },
      ];
      for (const prototypeCandidate of prototypeCandidates) {
        const parsed = parseAnalystOutput(JSON.stringify({ candidates: [prototypeCandidate, valid] }));
        expect(() => decide(snapshot(), parsed, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW)).not.toThrow();
        const prototypeResult = decide(snapshot(), parsed, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
        expect(prototypeResult.candidateVerdicts).toHaveLength(2);
        expect(prototypeResult.candidateVerdicts[0]?.gateVector).toHaveLength(8);
        expect(prototypeResult.candidateVerdicts[0]?.decision).toBe("VETO");
        expect(prototypeResult.candidateVerdicts[1]?.gateVector).toHaveLength(8);
        expect(prototypeResult.actions.map(action => action.candidateId)).toEqual([valid.candidateId]);
      }
    }
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
