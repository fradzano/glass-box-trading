// P7 — the pure Alpaca wire mapping, exercised against documents recorded
// from the dev paper account on 2026-09-01 (shapes, not secrets). Every
// parse fails closed; the credit sign convention is the one the broker
// accepted on the dev account (negative net limit = credit).
import { describe, expect, it } from "vitest";
import {
  buildOrderRequest,
  centsToDollars,
  dollarsToCents,
  dollarsToCentsRounded,
  mapAccount,
  mapLatestQuote,
  mapOptionContract,
  mapOrder,
  mapPosition,
  nextOrderPageAfter,
  normalizeBrokerIso,
  spotFromQuote,
} from "../src/core/alpaca-mapping.js";

const RECORDED_ORDER = {
  id: "d178a115-a95d-4038-af03-298791751f1e",
  client_order_id: "entry:test",
  created_at: "2026-08-24T20:17:03.11527Z",
  submitted_at: "2026-08-24T20:17:03.11527Z",
  filled_at: null,
  canceled_at: "2026-08-24T20:17:14.343891Z",
  qty: "1",
  filled_qty: "0",
  filled_avg_price: null,
  order_class: "mleg",
  type: "limit",
  limit_price: "-0.05",
  status: "canceled",
  legs: [
    { symbol: "SPY260828C00765000", side: "sell", position_intent: "sell_to_open", ratio_qty: "1", status: "canceled" },
    { symbol: "SPY260828C00770000", side: "buy", position_intent: "buy_to_open", ratio_qty: "1", status: "canceled" },
  ],
};

describe("money and timestamps", () => {
  it("parses exact decimal strings to cents and refuses sub-cent precision except where rounding is declared", () => {
    expect(dollarsToCents("100000")).toBe(10_000_000);
    expect(dollarsToCents("125.91")).toBe(12_591);
    expect(dollarsToCents("-0.01")).toBe(-1);
    expect(dollarsToCents("0.0400")).toBe(4);
    expect(dollarsToCents("1.235")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(Object.is(dollarsToCents("-0.00"), 0)).toBe(true);
    expect(Object.is(dollarsToCentsRounded("-0.001"), 0)).toBe(true);
    expect(dollarsToCentsRounded("1.235")).toBe(124);
    expect(dollarsToCentsRounded("1.234")).toBe(123);
    expect(dollarsToCentsRounded("-1.235")).toBe(-124);
    expect(centsToDollars(-5)).toBe("-0.05");
    expect(centsToDollars(12_591)).toBe("125.91");
  });

  it("truncates nanosecond broker timestamps to the core's millisecond grammar and shifts offsets to UTC", () => {
    expect(normalizeBrokerIso("2026-08-31T19:59:58.548252035Z")).toBe("2026-08-31T19:59:58.548Z");
    expect(normalizeBrokerIso("2026-08-31T20:29:24.230427647-04:00")).toBe("2026-09-01T00:29:24.230Z");
    expect(normalizeBrokerIso("2026-03-08T01:30:00+05:30")).toBe("2026-03-07T20:00:00.000Z");
    expect(normalizeBrokerIso("yesterday")).toBeNull();
    // Gate finding G1-F5: a 60-minute offset component is malformed, not arithmetic.
    expect(normalizeBrokerIso("2026-01-01T00:00:00+00:60")).toBeNull();
    expect(normalizeBrokerIso("2026-01-01T00:00:00+15:00")).toBeNull();
    expect(normalizeBrokerIso("2026-12-31T23:59:59.9999+00:30")).toBe("2026-12-31T23:29:59.999Z");
  });
});

describe("documents", () => {
  it("maps the account by account_number with exact cents", () => {
    expect(mapAccount({ account_number: "PA349COOGKZ1", cash: "100000", equity: "100000", created_at: "2026-08-24T20:04:31.996074Z", status: "ACTIVE" })).toEqual({ accountId: "PA349COOGKZ1", cashCents: 10_000_000, equityCents: 10_000_000, createdAt: "2026-08-24T20:04:31.996Z", status: "ACTIVE" });
    expect(mapAccount({ id: "uuid", cash: "1" })).toBeNull();
  });

  it("maps positions with a signed quantity and rounded entry price; a malformed position is null, never guessed", () => {
    expect(mapPosition({ symbol: "SPY260904C00645000", qty: "-1", side: "short", avg_entry_price: "1.235" })).toEqual({ contractId: "SPY260904C00645000", quantity: -1, avgEntryPriceCents: 124 });
    expect(mapPosition({ symbol: "SPY260904C00645000", qty: "2", side: "short", avg_entry_price: "1.00" })).toEqual({ contractId: "SPY260904C00645000", quantity: -2, avgEntryPriceCents: 100 });
    expect(mapPosition({ symbol: "", qty: "1", avg_entry_price: "1" })).toBeNull();
  });

  it("maps a recorded mleg order: credit sign, legs with ratios, non-null timestamps only, no invented reason", () => {
    const mapped = mapOrder(RECORDED_ORDER);
    expect(mapped).not.toBeNull();
    expect(mapped?.limit).toEqual({ kind: "credit", priceCents: 5 });
    expect(mapped?.legs).toEqual([{ contractId: "SPY260828C00765000", side: "sell", ratio: 1 }, { contractId: "SPY260828C00770000", side: "buy", ratio: 1 }]);
    expect(mapped?.brokerTimestamps).toEqual({ created_at: "2026-08-24T20:17:03.115Z", submitted_at: "2026-08-24T20:17:03.115Z", canceled_at: "2026-08-24T20:17:14.343Z" });
    expect(mapped?.brokerReason).toBeNull();
    expect(mapped?.avgFillPriceCents).toBeNull();
    expect(mapOrder({ ...RECORDED_ORDER, legs: [{ symbol: "X", side: "hold" }] })).toBeNull();
    expect(mapOrder({ ...RECORDED_ORDER, limit_price: "0.005" })).toBeNull();
    // Gate finding G1-F5: non-positive quantities and impossible fills are malformed records.
    expect(mapOrder({ ...RECORDED_ORDER, qty: "0" })).toBeNull();
    expect(mapOrder({ ...RECORDED_ORDER, qty: "-1" })).toBeNull();
    expect(mapOrder({ ...RECORDED_ORDER, qty: "1", filled_qty: "2" })).toBeNull();
  });

  it("maps a filled debit single-leg order with a rounded average fill", () => {
    const mapped = mapOrder({ id: "o", client_order_id: "c", symbol: "SPY260904C00645000", side: "buy", qty: "1", filled_qty: "1", filled_avg_price: "1.2350", limit_price: "1.25", status: "filled", filled_at: "2026-09-01T14:00:00.5Z" });
    expect(mapped).toMatchObject({ status: "filled", filledQuantity: 1, avgFillPriceCents: 124, limit: { kind: "debit", priceCents: 125 }, legs: [{ contractId: "SPY260904C00645000", side: "buy", ratio: 1 }], brokerTimestamps: { filled_at: "2026-09-01T14:00:00.500Z" } });
  });

  it("maps contracts and quotes; spot is the floored mid", () => {
    expect(mapOptionContract({ symbol: "SPY260903C00640000", underlying_symbol: "SPY", expiration_date: "2026-09-03", type: "call", strike_price: "640" })).toEqual({ contractId: "SPY260903C00640000", underlying: "SPY", expiry: "2026-09-03", strikeCents: 64_000, right: "call" });
    expect(mapOptionContract({ symbol: "X", underlying_symbol: "SPY", expiration_date: "2026-09-03", type: "swap", strike_price: "640" })).toBeNull();
    // G2-F6: an impossible calendar date is not an expiry.
    expect(mapOptionContract({ symbol: "X", underlying_symbol: "SPY", expiration_date: "2026-02-31", type: "call", strike_price: "640" })).toBeNull();
    const quote = mapLatestQuote({ ap: 125.91, as: 2, bp: 121.56, bs: 1, t: "2026-08-31T19:59:58.548252035Z" });
    expect(quote).toEqual({ bidCents: 12_156, askCents: 12_591, bidSize: 1, askSize: 2, quotedAtMs: Date.parse("2026-08-31T19:59:58.548Z"), brokerQuotedAt: "2026-08-31T19:59:58.548252035Z" });
    expect(spotFromQuote({ bidCents: 76_710, askCents: 76_724, bidSize: 1, askSize: 1, quotedAtMs: 0, brokerQuotedAt: "t" })).toBe(76_717);
    expect(mapLatestQuote({ ap: 1, bp: 1, bs: 1, t: "2026-08-31T19:59:58Z" })).toBeNull();
  });
});

describe("order requests and pagination", () => {
  it("builds the exact mleg body: day limit, negative net price for a credit, position intents from side and intent", () => {
    const body = buildOrderRequest({ clientOrderId: "entry:x", quantity: 1, intent: "entry", limit: { kind: "credit", priceCents: 35 }, legs: [{ contractId: "A", side: "sell", ratio: 1 }, { contractId: "B", side: "buy", ratio: 1 }] });
    expect(body).toEqual({ order_class: "mleg", qty: "1", type: "limit", time_in_force: "day", limit_price: "-0.35", client_order_id: "entry:x", legs: [{ symbol: "A", ratio_qty: "1", side: "sell", position_intent: "sell_to_open" }, { symbol: "B", ratio_qty: "1", side: "buy", position_intent: "buy_to_open" }] });
    const close = buildOrderRequest({ clientOrderId: "close:x", quantity: 2, intent: "close", limit: { kind: "debit", priceCents: 40 }, legs: [{ contractId: "A", side: "buy", ratio: 1 }, { contractId: "B", side: "sell", ratio: 1 }] });
    expect(close).toMatchObject({ limit_price: "0.40", qty: "2", legs: [{ symbol: "A", side: "buy", position_intent: "buy_to_close" }, { symbol: "B", side: "sell", position_intent: "sell_to_close" }] });
    const single = buildOrderRequest({ clientOrderId: "close:r", quantity: 3, intent: "close", limit: { kind: "credit", priceCents: 12 }, legs: [{ contractId: "A", side: "sell", ratio: 1 }] });
    expect(single).toEqual({ symbol: "A", side: "sell", position_intent: "sell_to_close", qty: "3", type: "limit", time_in_force: "day", limit_price: "0.12", client_order_id: "close:r" });
  });

  it("pages ascending by submission time and stops on a short page", () => {
    const full = Array.from({ length: 3 }, (_, index) => ({ ...(mapOrder(RECORDED_ORDER) as NonNullable<ReturnType<typeof mapOrder>>), brokerTimestamps: { submitted_at: `2026-08-24T20:17:0${String(index)}.000Z` } }));
    expect(nextOrderPageAfter(full, 3)).toEqual({ kind: "after", after: "2026-08-24T20:17:02.000Z" });
    expect(nextOrderPageAfter(full, 500)).toEqual({ kind: "end" });
    // G2-F5: a full page without a usable cursor is unpageable, never complete.
    expect(nextOrderPageAfter(full.map(item => ({ ...item, brokerTimestamps: {} })), 3)).toEqual({ kind: "unpageable" });
  });
});
