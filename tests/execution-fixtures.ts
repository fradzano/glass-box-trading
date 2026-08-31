import { integerUnit, lotCount } from "../src/core/domain.js";
import type { EntryCandidate, OptionQuote } from "../src/core/domain.js";
import type { BrokerBook, BrokerOrderRecord, BrokerPosition, ExecutionConfig } from "../src/core/execution.js";
import { TEST_ONLY_NOW, leg, quote } from "./fixtures.js";

export const TEST_ONLY_EXECUTION_CONFIG: ExecutionConfig = {
  limitToleranceCents: integerUnit(2, "OptionPriceCents"),
  killEquityThresholdCents: integerUnit(9_200_000, "MoneyCents"),
  initialCapitalCents: integerUnit(10_000_000, "MoneyCents"),
};

export const SHORT_CALL = "SPY260904C00500000";
export const LONG_CALL = "SPY260904C00505000";

/** A credit call vertical: sell the 500 call, buy the 505 call; width 500 cents. */
export function creditVertical(overrides: Partial<EntryCandidate> = {}): EntryCandidate {
  return {
    candidateId: "candidate-credit-vertical",
    declaredStructureType: "vertical_credit",
    sleeve: "income",
    quantity: lotCount(1),
    remainingTradingSessions: integerUnit(5, "Quantity"),
    rationale: "SPY vertical_credit call spread 500/505 sells income drift into the Sep 4 expiry.",
    entryLimit: { kind: "credit", priceCents: integerUnit(200, "OptionPriceCents") },
    legs: [
      leg({ contractId: SHORT_CALL, strikeCents: integerUnit(50_000, "StrikeCents"), side: "sell" }),
      leg({ contractId: LONG_CALL, strikeCents: integerUnit(50_500, "StrikeCents"), side: "buy" }),
    ],
    ...overrides,
  };
}

/** Quotes under which the credit vertical's net mid is 200 cents: short call 300/302, long call 100/102. */
export function creditVerticalQuotes(overrides: Partial<Record<string, OptionQuote>> = {}): Record<string, OptionQuote> {
  return {
    [SHORT_CALL]: quote({ bidCents: integerUnit(300, "OptionPriceCents"), askCents: integerUnit(302, "OptionPriceCents") }),
    [LONG_CALL]: quote({ bidCents: integerUnit(100, "OptionPriceCents"), askCents: integerUnit(102, "OptionPriceCents") }),
    ...overrides,
  };
}

export function position(overrides: Partial<BrokerPosition> = {}): BrokerPosition {
  return { contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 300, ...overrides };
}

export function brokerOrder(overrides: Partial<BrokerOrderRecord> = {}): BrokerOrderRecord {
  return {
    brokerOrderId: "broker-1",
    clientOrderId: "entry:2026-08-31:7:x",
    status: "accepted",
    filledQuantity: 0,
    avgFillPriceCents: null,
    brokerTimestamps: { submitted_at: "2026-08-31T13:30:00.123456789Z" },
    brokerReason: null,
    legs: [{ contractId: SHORT_CALL, side: "sell", ratio: 1 }, { contractId: LONG_CALL, side: "buy", ratio: 1 }],
    quantity: 1,
    limit: { kind: "credit", priceCents: 198 },
    ...overrides,
  };
}

export function book(overrides: Partial<BrokerBook> = {}): BrokerBook {
  return {
    accountId: "TEST_ONLY_ACCOUNT",
    cashCents: 10_000_000,
    equityCents: 10_000_000,
    positions: [],
    openOrders: [],
    observedAtMs: TEST_ONLY_NOW,
    ...overrides,
  };
}
