import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { integerUnit } from "../src/core/domain.js";
import type { OptionQuote } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, quote, snapshot } from "./fixtures.js";

function liquidityVerdict(optionQuote: OptionQuote | undefined) {
  const quotesByContract = optionQuote === undefined ? {} : { SPY260904C00500000: optionQuote };
  return decide(snapshot({ quotesByContract }), { kind: "candidates", candidates: [candidate()] }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW).candidateVerdicts[0]!.gateVector[4]!;
}

describe("G5 liquidity", () => {
  it("S-G5-01 passes when every exact per-leg criterion passes", () => {
    expect(liquidityVerdict(quote())).toMatchObject({ passed: true, code: "PASS" });
  });

  it("S-G5-02 vetoes the whole structure when one leg fails any criterion and names it", () => {
    const failures = [
      quote({ bidCents: integerUnit(0, "OptionPriceCents") }),
      quote({ bidCents: integerUnit(103, "OptionPriceCents"), askCents: integerUnit(102, "OptionPriceCents") }),
      quote({ bidCents: integerUnit(50, "OptionPriceCents"), askCents: integerUnit(100, "OptionPriceCents") }),
      quote({ bidSize: integerUnit(9, "Quantity") }),
      quote({ quotedAt: integerUnit(TEST_ONLY_NOW - TEST_ONLY_O5_CONFIG.quoteMaxAgeMs - 1, "EpochMilliseconds") }),
    ];
    for (const failingQuote of failures) {
      expect(liquidityVerdict(failingQuote)).toMatchObject({ passed: false, code: "LIQUIDITY", reasons: expect.arrayContaining([expect.stringContaining("SPY260904C00500000")]) });
    }
  });

  it("S-G5-03 treats a missing quote as a veto", () => {
    expect(liquidityVerdict(undefined)).toMatchObject({ passed: false, code: "LIQUIDITY" });
  });
});
