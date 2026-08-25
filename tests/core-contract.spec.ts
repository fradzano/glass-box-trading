import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, snapshot } from "./fixtures.js";

describe("pure decision contract", () => {
  it("S-CORE-01 returns deeply equal outputs for identical inputs", () => {
    const decisionSnapshot = snapshot();
    const candidates = { kind: "candidates" as const, candidates: [candidate()] };
    expect(decide(decisionSnapshot, candidates, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW)).toEqual(
      decide(decisionSnapshot, candidates, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW),
    );
  });

  it("S-CORE-02 voids every action when the snapshot is stale", () => {
    const staleSnapshot = snapshot({
      snapshotAt: integerUnit(TEST_ONLY_NOW - TEST_ONLY_O5_CONFIG.snapshotStalenessBoundMs - 1, "EpochMilliseconds"),
    });
    const result = decide(staleSnapshot, { kind: "candidates", candidates: [candidate()] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(result.actions).toEqual([]);
    expect(result.batchVerdicts).toContainEqual(expect.objectContaining({ code: "STALE_SNAPSHOT" }));
  });

  it("S-CORE-03 records G1 through G8 even when an early gate vetoes", () => {
    const nakedShort = candidate({
      candidateId: "naked-short",
      legs: [{ ...candidate().legs[0]!, side: "sell" }],
    });
    const result = decide(snapshot(), { kind: "candidates", candidates: [nakedShort] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(result.candidateVerdicts[0]?.gateVector.map(verdict => verdict.gate)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
    expect(result.candidateVerdicts[0]?.gateVector.find(verdict => verdict.gate === "G8")).toBeDefined();
    expect(result.actions).toEqual([]);
  });
});
