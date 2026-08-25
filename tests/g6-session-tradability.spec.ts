import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { DecisionSnapshot, EntryCandidate } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, leg, quote, snapshot } from "./fixtures.js";

function sessionGate(decisionSnapshot: DecisionSnapshot, candidateValue = candidate()) {
  return decide(decisionSnapshot, { kind: "candidates", candidates: [candidateValue] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW).candidateVerdicts[0]!.gateVector[5]!;
}

describe("G6 session and tradability", () => {
  it("S-G6-01 permits orders only when the calendar is open and now is inside its session", () => {
    expect(sessionGate(snapshot())).toMatchObject({ passed: true });
  });

  it("S-G6-02 vetoes weekends, holidays, and after-hours while preserving verdict output", () => {
    const closedSnapshots = [
      snapshot({ calendar: { isTradingDay: false, opensAt: integerUnit(TEST_ONLY_NOW - 1, "EpochMilliseconds"), closesAt: integerUnit(TEST_ONLY_NOW + 1, "EpochMilliseconds") } }),
      snapshot({ calendar: { isTradingDay: true, opensAt: integerUnit(TEST_ONLY_NOW + 1, "EpochMilliseconds"), closesAt: integerUnit(TEST_ONLY_NOW + 10_000, "EpochMilliseconds") } }),
      snapshot({ calendar: { isTradingDay: true, opensAt: integerUnit(TEST_ONLY_NOW - 10_000, "EpochMilliseconds"), closesAt: TEST_ONLY_NOW } }),
    ];
    for (const closed of closedSnapshots) expect(sessionGate(closed)).toMatchObject({ passed: false, code: "SESSION" });
  });

  it("S-G6-03 honors a half-day close from the supplied calendar instead of hardcoded hours", () => {
    const halfDayClose = integerUnit(TEST_ONLY_NOW - 1, "EpochMilliseconds");
    expect(sessionGate(snapshot({ calendar: { isTradingDay: true, opensAt: integerUnit(TEST_ONLY_NOW - 4 * 3_600_000, "EpochMilliseconds"), closesAt: halfDayClose } }))).toMatchObject({ passed: false });
  });

  it("S-G6-04 accepts the supplied normal-session fixture for Monday August 31 2026", () => {
    expect(snapshot().tradingDay).toBe("2026-08-31");
    expect(sessionGate(snapshot())).toMatchObject({ passed: true });
  });

  it("S-G6-05 detects stale or frozen markets and scopes missing or over-age history per underlying", () => {
    const stale = snapshot({ quotesByContract: { SPY260904C00500000: quote({ quotedAt: integerUnit(TEST_ONLY_NOW - TEST_ONLY_O5_CONFIG.quoteMaxAgeMs - 1, "EpochMilliseconds") }) } });
    expect(sessionGate(stale).reasons).toContainEqual(expect.stringContaining("stale"));

    const frozenQuote = quote();
    const frozen = snapshot({
      quotesByContract: { SPY260904C00500000: frozenQuote },
      priorQuotesByUnderlying: { SPY: { observedAt: integerUnit(TEST_ONLY_NOW - 900_000, "EpochMilliseconds"), quotesByContract: { SPY260904C00500000: { ...frozenQuote, quotedAt: integerUnit(TEST_ONLY_NOW - 900_000, "EpochMilliseconds") } } } },
    });
    expect(sessionGate(frozen)).toMatchObject({ passed: false, reasons: [expect.stringContaining("frozen")] });

    const qqqCandidate: EntryCandidate = candidate({ candidateId: "qqq", structureIdentity: "qqq", legs: [leg({ contractId: "QQQ-C-600", underlying: "QQQ", strikeCents: integerUnit(60_000, "StrikeCents") })] });
    const scoped = snapshot({
      quotesByContract: { ...snapshot().quotesByContract, "QQQ-C-600": quote() },
      knownContractIds: [...snapshot().knownContractIds, "QQQ-C-600"],
      priorQuotesByUnderlying: { SPY: snapshot().priorQuotesByUnderlying.SPY! },
    });
    const result = decide(scoped, { kind: "candidates", candidates: [candidate(), qqqCandidate] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(result.candidateVerdicts.map(verdict => verdict.gateVector[5]?.passed)).toEqual([true, false]);

    const overAge = snapshot({ priorQuotesByUnderlying: { SPY: { observedAt: integerUnit(TEST_ONLY_NOW - 2 * TEST_ONLY_O5_CONFIG.cycleIntervalMs - 1, "EpochMilliseconds"), quotesByContract: snapshot().priorQuotesByUnderlying.SPY!.quotesByContract } } });
    expect(sessionGate(overAge).reasons).toContainEqual(expect.stringContaining("history"));
  });
});
