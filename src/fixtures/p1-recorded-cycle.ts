import { integerUnit } from "../core/domain.js";
import type { AnalystBatch, DecisionConfig, DecisionSnapshot } from "../core/domain.js";

export const TEST_ONLY_P1_NOW = integerUnit(1_788_197_400_000, "EpochMilliseconds");

export const TEST_ONLY_P1_O5_CONFIG: DecisionConfig = {
  incomeBudgetCents: integerUnit(1_200_000, "MoneyCents"),
  convexBudgetCents: integerUnit(800_000, "MoneyCents"),
  maxLossPerPositionBps: integerUnit(2_500, "BasisPoints"),
  maxUnderlyingExposureCents: integerUnit(1_500_000, "MoneyCents"),
  maxRelativeSpreadBps: integerUnit(500, "BasisPoints"),
  minQuoteSize: integerUnit(10, "Quantity"),
  quoteMaxAgeMs: integerUnit(60_000, "EpochMilliseconds"),
  snapshotStalenessBoundMs: integerUnit(120_000, "EpochMilliseconds"),
  cycleIntervalMs: integerUnit(900_000, "EpochMilliseconds"),
  underlyingUniverse: ["SPY"],
  structureWhitelist: ["long_option"],
  expiryMinSessions: integerUnit(2, "Quantity"),
  expiryMaxSessions: integerUnit(10, "Quantity"),
  maxStrikeDistanceBps: integerUnit(1_000, "BasisPoints"),
  maxCandidateQuantity: integerUnit(2, "Quantity"),
};

export const P1_RECORDED_SNAPSHOT: DecisionSnapshot = {
  accountId: "TEST_ONLY_RECORDED_ACCOUNT",
  profile: "dev",
  cashCents: integerUnit(10_000_000, "MoneyCents"),
  equityCents: integerUnit(10_000_000, "MoneyCents"),
  exposureLifecycles: [],
  halt: false,
  calendar: {
    isTradingDay: true,
    opensAt: integerUnit(TEST_ONLY_P1_NOW - 3_600_000, "EpochMilliseconds"),
    closesAt: integerUnit(TEST_ONLY_P1_NOW + 3_600_000, "EpochMilliseconds"),
  },
  quotesByContract: {
    "SPY-PASS": {
      bidCents: integerUnit(100, "OptionPriceCents"),
      askCents: integerUnit(102, "OptionPriceCents"),
      bidSize: integerUnit(25, "Quantity"),
      askSize: integerUnit(25, "Quantity"),
      quotedAt: TEST_ONLY_P1_NOW,
    },
    "SPY-VETO": {
      bidCents: integerUnit(210, "OptionPriceCents"),
      askCents: integerUnit(212, "OptionPriceCents"),
      bidSize: integerUnit(25, "Quantity"),
      askSize: integerUnit(25, "Quantity"),
      quotedAt: TEST_ONLY_P1_NOW,
    },
  },
  priorQuotesByUnderlying: {
    SPY: {
      observedAt: integerUnit(TEST_ONLY_P1_NOW - 900_000, "EpochMilliseconds"),
      quotesByContract: {
        "SPY-PASS": {
          bidCents: integerUnit(99, "OptionPriceCents"),
          askCents: integerUnit(101, "OptionPriceCents"),
          bidSize: integerUnit(24, "Quantity"),
          askSize: integerUnit(24, "Quantity"),
          quotedAt: integerUnit(TEST_ONLY_P1_NOW - 900_000, "EpochMilliseconds"),
        },
        "SPY-VETO": {
          bidCents: integerUnit(209, "OptionPriceCents"),
          askCents: integerUnit(211, "OptionPriceCents"),
          bidSize: integerUnit(24, "Quantity"),
          askSize: integerUnit(24, "Quantity"),
          quotedAt: integerUnit(TEST_ONLY_P1_NOW - 900_000, "EpochMilliseconds"),
        },
      },
    },
  },
  spotCentsByUnderlying: { SPY: integerUnit(50_000, "StrikeCents") },
  knownContractIds: ["SPY-PASS", "SPY-VETO"],
  submittedOrderIds: [],
  tradingDay: "2026-08-31",
  cycleIndex: integerUnit(7, "Quantity"),
  snapshotAt: TEST_ONLY_P1_NOW,
};

export const P1_RECORDED_CANDIDATES: AnalystBatch = {
  kind: "candidates",
  candidates: [
    {
      candidateId: "convex-pass",
      structureIdentity: "SPY:2026-09-04:long-call-500",
      declaredStructureType: "long_option",
      sleeve: "convex",
      quantity: integerUnit(1, "Quantity"),
      remainingTradingSessions: integerUnit(5, "Quantity"),
      rationale: "Buy one capped SPY call around the scheduled event; premium is the complete risk.",
      entryLimit: { kind: "debit", priceCents: integerUnit(102, "OptionPriceCents") },
      legs: [{ contractId: "SPY-PASS", underlying: "SPY", expiry: "2026-09-04", strikeCents: integerUnit(50_000, "StrikeCents"), right: "call", side: "buy", ratio: integerUnit(1, "Quantity") }],
    },
    {
      candidateId: "naked-short-veto",
      structureIdentity: "SPY:2026-09-04:naked-short-call-505",
      declaredStructureType: "long_option",
      sleeve: "income",
      quantity: integerUnit(1, "Quantity"),
      remainingTradingSessions: integerUnit(5, "Quantity"),
      rationale: "Collect premium by selling one uncovered call; the loss is not fixed at entry.",
      entryLimit: { kind: "credit", priceCents: integerUnit(210, "OptionPriceCents") },
      legs: [{ contractId: "SPY-VETO", underlying: "SPY", expiry: "2026-09-04", strikeCents: integerUnit(50_500, "StrikeCents"), right: "call", side: "sell", ratio: integerUnit(1, "Quantity") }],
    },
  ],
};
