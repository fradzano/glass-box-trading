import type { DecisionConfig, DecisionSnapshot, EntryCandidate, ExposureLifecycle, OptionLeg, OptionQuote } from "../src/core/domain.js";
import { integerUnit } from "../src/core/domain.js";

export const TEST_ONLY_NOW = integerUnit(1_788_197_400_000, "EpochMilliseconds");

export const TEST_ONLY_O5_CONFIG: DecisionConfig = {
  incomeBudgetCents: integerUnit(1_200_000, "MoneyCents"),
  convexBudgetCents: integerUnit(800_000, "MoneyCents"),
  maxLossPerPositionBps: integerUnit(10_000, "BasisPoints"),
  maxUnderlyingExposureCents: integerUnit(2_000_000, "MoneyCents"),
  maxRelativeSpreadBps: integerUnit(500, "BasisPoints"),
  minQuoteSize: integerUnit(10, "Quantity"),
  quoteMaxAgeMs: integerUnit(60_000, "EpochMilliseconds"),
  snapshotStalenessBoundMs: integerUnit(120_000, "EpochMilliseconds"),
  cycleIntervalMs: integerUnit(900_000, "EpochMilliseconds"),
  underlyingUniverse: ["SPY", "QQQ"],
  structureWhitelist: ["vertical_debit", "vertical_credit", "iron_condor", "long_option"],
  expiryMinSessions: integerUnit(2, "Quantity"),
  expiryMaxSessions: integerUnit(30, "Quantity"),
  maxStrikeDistanceBps: integerUnit(2_000, "BasisPoints"),
  maxCandidateQuantity: integerUnit(10, "Quantity"),
};

export function quote(overrides: Partial<OptionQuote> = {}): OptionQuote {
  return {
    bidCents: integerUnit(100, "OptionPriceCents"),
    askCents: integerUnit(102, "OptionPriceCents"),
    bidSize: integerUnit(20, "Quantity"),
    askSize: integerUnit(20, "Quantity"),
    quotedAt: TEST_ONLY_NOW,
    ...overrides,
  };
}

export function leg(overrides: Partial<OptionLeg> = {}): OptionLeg {
  return {
    contractId: "SPY260904C00500000",
    underlying: "SPY",
    expiry: "2026-09-04",
    strikeCents: integerUnit(50_000, "StrikeCents"),
    right: "call",
    side: "buy",
    ratio: integerUnit(1, "Quantity"),
    ...overrides,
  };
}

export function candidate(overrides: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    candidateId: "candidate-long-spy",
    structureIdentity: "SPY:2026-09-04:long-call-500",
    declaredStructureType: "long_option",
    sleeve: "convex",
    quantity: integerUnit(1, "Quantity"),
    remainingTradingSessions: integerUnit(5, "Quantity"),
    rationale: "Test-only scheduled-event convexity fixture.",
    entryLimit: { kind: "debit", priceCents: integerUnit(100, "OptionPriceCents") },
    legs: [leg()],
    ...overrides,
  };
}

export function snapshot(overrides: Partial<DecisionSnapshot> = {}): DecisionSnapshot {
  const currentQuote = quote();
  const priorQuote = quote({
    bidCents: integerUnit(99, "OptionPriceCents"),
    askCents: integerUnit(101, "OptionPriceCents"),
    quotedAt: integerUnit(TEST_ONLY_NOW - 900_000, "EpochMilliseconds"),
  });
  return {
    accountId: "TEST_ONLY_ACCOUNT",
    profile: "dev",
    cashCents: integerUnit(10_000_000, "MoneyCents"),
    equityCents: integerUnit(10_000_000, "MoneyCents"),
    exposureLifecycles: [],
    halt: false,
    calendar: {
      isTradingDay: true,
      opensAt: integerUnit(TEST_ONLY_NOW - 3_600_000, "EpochMilliseconds"),
      closesAt: integerUnit(TEST_ONLY_NOW + 3_600_000, "EpochMilliseconds"),
    },
    quotesByContract: { SPY260904C00500000: currentQuote },
    priorQuotesByUnderlying: {
      SPY: {
        observedAt: integerUnit(TEST_ONLY_NOW - 900_000, "EpochMilliseconds"),
        quotesByContract: { SPY260904C00500000: priorQuote },
      },
    },
    spotCentsByUnderlying: { SPY: integerUnit(50_000, "StrikeCents"), QQQ: integerUnit(60_000, "StrikeCents") },
    knownContractIds: ["SPY260904C00500000"],
    submittedOrderIds: [],
    tradingDay: "2026-08-31",
    cycleIndex: integerUnit(7, "Quantity"),
    snapshotAt: TEST_ONLY_NOW,
    ...overrides,
  };
}

export function marketFor(candidateValue: EntryCandidate, base = snapshot()): DecisionSnapshot {
  const current: Record<string, OptionQuote> = { ...base.quotesByContract };
  const prior: Record<string, OptionQuote> = {};
  for (const optionLeg of candidateValue.legs) {
    current[optionLeg.contractId] = quote();
    prior[optionLeg.contractId] = quote({
      bidCents: integerUnit(99, "OptionPriceCents"),
      askCents: integerUnit(101, "OptionPriceCents"),
      quotedAt: integerUnit(TEST_ONLY_NOW - 900_000, "EpochMilliseconds"),
    });
  }
  return {
    ...base,
    quotesByContract: current,
    knownContractIds: [...new Set([...base.knownContractIds, ...candidateValue.legs.map(optionLeg => optionLeg.contractId)])],
    priorQuotesByUnderlying: {
      ...base.priorQuotesByUnderlying,
      [candidateValue.legs[0]?.underlying ?? "SPY"]: {
        observedAt: integerUnit(TEST_ONLY_NOW - 900_000, "EpochMilliseconds"),
        quotesByContract: prior,
      },
    },
  };
}

export function exposure(overrides: Partial<ExposureLifecycle> = {}): ExposureLifecycle {
  return {
    exposureLifecycleId: "existing-exposure",
    underlying: "SPY",
    sleeve: "income",
    risk: [],
    ...overrides,
  };
}
