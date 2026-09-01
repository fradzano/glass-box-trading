// Pure Alpaca wire mapping (P7): broker JSON in, the closed P3 record shapes
// out; every parse fails closed (null) instead of guessing. The shell fetches
// and submits; what a broker document MEANS is decided here, so the mapping
// is testable without a network. Money and prices are exact decimal strings
// on the wire and integer cents in the core; an average fill price with
// sub-cent precision is rounded half away from zero (the only rounding in
// this module, applied to nothing else).
import { integerUnit } from "./domain.js";
import type { EntryLimitKind, LegSide, OptionContract, OptionRight, StrikeCents } from "./domain.js";
import { utcIsoToEpochMs } from "./execution.js";
import type { BrokerOrderLeg, BrokerOrderRecord, BrokerPosition } from "./execution.js";

type Raw = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exact decimal text to cents; more than two fraction digits (beyond trailing zeros) or malformed text is null. */
export function dollarsToCents(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? dollarsToCents(value.toString()) : null;
  if (typeof value !== "string") return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] as string;
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  if (fraction.length > 2) return null;
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return cents === 0 ? 0 : sign * cents;
}

/** Decimal text to cents rounded half away from zero — only for broker-reported average fill prices. */
export function dollarsToCentsRounded(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? dollarsToCentsRounded(value.toString()) : null;
  if (typeof value !== "string") return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const whole = match[2] as string;
  const fraction = match[3] ?? "";
  const twoDigits = Number((fraction + "00").slice(0, 2));
  const rest = fraction.slice(2);
  const roundUp = rest.length > 0 && Number(rest[0]) >= 5;
  const cents = Number(whole) * 100 + twoDigits + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return cents === 0 ? 0 : sign * cents;
}

export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

function integerText(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Broker timestamps carry nanoseconds; the core's UTC ISO grammar takes at most milliseconds. Truncated, never rounded. */
export function normalizeBrokerIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return null;
  const fraction = (match[2] ?? "").slice(0, 3).padEnd(3, "0");
  const zone = match[3] as string;
  const local = `${match[1] as string}.${fraction}Z`;
  if (zone === "Z") return utcIsoToEpochMs(local) === null ? null : local;
  // An offset timestamp is shifted to UTC arithmetically (the core has no clock or locale).
  const base = utcIsoToEpochMs(local);
  if (base === null) return null;
  const sign = zone.startsWith("-") ? -1 : 1;
  const offsetHours = Number(zone.slice(1, 3));
  const offsetMinutePart = Number(zone.slice(4, 6));
  if (offsetHours > 14 || offsetMinutePart > 59) return null;
  const offsetMinutes = sign * (offsetHours * 60 + offsetMinutePart);
  return epochMsToIso(base - offsetMinutes * 60_000);
}

function epochMsToIso(ms: number): string {
  // Proleptic Gregorian arithmetic; the core may not construct a Date.
  const days = Math.floor(ms / 86_400_000);
  const rest = ms - days * 86_400_000;
  let z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  z = m <= 2 ? y + 1 : y;
  const hours = Math.floor(rest / 3_600_000);
  const minutes = Math.floor((rest % 3_600_000) / 60_000);
  const seconds = Math.floor((rest % 60_000) / 1000);
  const millis = rest % 1000;
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  return `${pad(z, 4)}-${pad(m, 2)}-${pad(d, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`;
}

export interface AccountDocument {
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly createdAt: string | null;
  readonly status: string;
}

export function mapAccount(raw: unknown): AccountDocument | null {
  if (!isRecord(raw)) return null;
  const accountId = raw["account_number"];
  const cashCents = dollarsToCents(raw["cash"]);
  const equityCents = dollarsToCents(raw["equity"]);
  if (typeof accountId !== "string" || accountId.length === 0 || cashCents === null || equityCents === null) return null;
  return { accountId, cashCents, equityCents, createdAt: normalizeBrokerIso(raw["created_at"]), status: typeof raw["status"] === "string" ? raw["status"] : "" };
}

export function mapPosition(raw: unknown): BrokerPosition | null {
  if (!isRecord(raw)) return null;
  const contractId = raw["symbol"];
  const quantity = integerText(raw["qty"]);
  const avgEntryPriceCents = dollarsToCentsRounded(raw["avg_entry_price"]);
  const side = raw["side"];
  if (typeof contractId !== "string" || contractId.trim().length === 0 || quantity === null || avgEntryPriceCents === null || (side !== "long" && side !== "short")) return null;
  // The side and the sign must agree: a long position is positive, a short one negative (G5-L6).
  if (side === "long" && quantity <= 0) return null;
  if (side === "short" && quantity === 0) return null;
  const signed = side === "short" && quantity > 0 ? -quantity : quantity;
  return { contractId, quantity: signed, avgEntryPriceCents: Math.abs(avgEntryPriceCents) };
}

function mapLeg(raw: unknown): BrokerOrderLeg | null {
  if (!isRecord(raw)) return null;
  const contractId = raw["symbol"];
  const side = raw["side"];
  const ratio = integerText(raw["ratio_qty"] ?? "1");
  if (typeof contractId !== "string" || contractId.length === 0 || (side !== "buy" && side !== "sell") || ratio === null || ratio < 1) return null;
  return { contractId, side, ratio };
}

function timestampFields(): readonly string[] {
  return ["created_at", "submitted_at", "updated_at", "filled_at", "canceled_at", "expired_at", "failed_at"];
}

export function mapOrder(raw: unknown): BrokerOrderRecord | null {
  if (!isRecord(raw)) return null;
  const brokerOrderId = raw["id"];
  const clientOrderId = raw["client_order_id"];
  const status = raw["status"];
  const quantity = integerText(raw["qty"]);
  const filledQuantity = integerText(raw["filled_qty"] ?? "0");
  if (typeof brokerOrderId !== "string" || brokerOrderId.trim().length === 0 || typeof clientOrderId !== "string" || clientOrderId.trim().length === 0 || typeof status !== "string" || status.trim().length === 0 || quantity === null || filledQuantity === null) return null;
  // A broker order record with a non-positive quantity, a negative fill, or a fill beyond the order is malformed, not partial.
  if (quantity < 1 || filledQuantity < 0 || filledQuantity > quantity) return null;
  const legsRaw = raw["legs"];
  // A multi-leg document without its legs is a partial record, never a single-leg order (G5-L6).
  if (raw["order_class"] === "mleg" && (!Array.isArray(legsRaw) || legsRaw.length === 0)) return null;
  let legs: BrokerOrderLeg[];
  if (Array.isArray(legsRaw) && legsRaw.length > 0) {
    const mapped: BrokerOrderLeg[] = [];
    for (const item of legsRaw) {
      const leg = mapLeg(item);
      if (leg === null) return null;
      mapped.push(leg);
    }
    legs = mapped;
  } else {
    const single = mapLeg({ symbol: raw["symbol"], side: raw["side"], ratio_qty: "1" });
    if (single === null) return null;
    legs = [single];
  }
  const limitRaw = raw["limit_price"];
  const limitCents = limitRaw === null || limitRaw === undefined ? null : dollarsToCents(limitRaw);
  if (limitRaw !== null && limitRaw !== undefined && limitCents === null) return null;
  const limitKind: EntryLimitKind = limitCents !== null && limitCents < 0 ? "credit" : "debit";
  const limit = limitCents === null ? null : { kind: limitKind, priceCents: Math.abs(limitCents) };
  const avgRaw = raw["filled_avg_price"];
  const avg = avgRaw === null || avgRaw === undefined ? null : dollarsToCentsRounded(avgRaw);
  if (avgRaw !== null && avgRaw !== undefined && avg === null) return null;
  const brokerTimestamps: Record<string, string> = {};
  for (const field of timestampFields()) {
    const normalized = normalizeBrokerIso(raw[field]);
    if (normalized !== null) brokerTimestamps[field] = normalized;
  }
  return {
    brokerOrderId,
    clientOrderId,
    status,
    filledQuantity,
    avgFillPriceCents: avg === null ? null : Math.abs(avg),
    brokerTimestamps,
    brokerReason: null,
    legs,
    quantity,
    limit,
  };
}

export interface OrderPayloadInput {
  readonly clientOrderId: string;
  readonly legs: readonly { readonly contractId: string; readonly side: LegSide; readonly ratio: number }[];
  readonly quantity: number;
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: number };
  readonly intent: "entry" | "close";
}

/** The exact POST /v2/orders body: every order is a day limit order; a credit is a negative net price (observed on the dev account, DECISIONS.md P7). */
export function buildOrderRequest(input: OrderPayloadInput): Readonly<Record<string, unknown>> {
  const netPrice = centsToDollars(input.limit.kind === "credit" ? -input.limit.priceCents : input.limit.priceCents);
  const intentOf = (side: LegSide): string => (input.intent === "entry" ? (side === "buy" ? "buy_to_open" : "sell_to_open") : (side === "buy" ? "buy_to_close" : "sell_to_close"));
  if (input.legs.length === 1) {
    const only = input.legs[0];
    if (only === undefined) return {};
    return {
      symbol: only.contractId,
      side: only.side,
      position_intent: intentOf(only.side),
      qty: String(input.quantity * only.ratio),
      type: "limit",
      time_in_force: "day",
      limit_price: centsToDollars(input.limit.priceCents),
      client_order_id: input.clientOrderId,
    };
  }
  return {
    order_class: "mleg",
    qty: String(input.quantity),
    type: "limit",
    time_in_force: "day",
    limit_price: netPrice,
    client_order_id: input.clientOrderId,
    legs: input.legs.map(leg => ({ symbol: leg.contractId, ratio_qty: String(leg.ratio), side: leg.side, position_intent: intentOf(leg.side) })),
  };
}

export function mapOptionContract(raw: unknown): OptionContract | null {
  if (!isRecord(raw)) return null;
  const contractId = raw["symbol"];
  const underlying = raw["underlying_symbol"];
  const expiry = raw["expiration_date"];
  const type = raw["type"];
  const strike = dollarsToCents(raw["strike_price"]);
  if (typeof contractId !== "string" || typeof underlying !== "string" || typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || utcIsoToEpochMs(`${expiry}T00:00:00.000Z`) === null || (type !== "call" && type !== "put") || strike === null || strike <= 0) return null;
  const right: OptionRight = type;
  return { contractId, underlying, expiry, strikeCents: integerUnit(strike, "StrikeCents"), right };
}

export interface RawQuoteObservation {
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidSize: number;
  readonly askSize: number;
  readonly quotedAtMs: number;
  readonly brokerQuotedAt: string;
}

/** A latest-quote document (`bp`, `bs`, `ap`, `as`, `t`) as the runner's market observation carries it. */
export function mapLatestQuote(raw: unknown): RawQuoteObservation | null {
  if (!isRecord(raw)) return null;
  const bidCents = dollarsToCentsRounded(raw["bp"]);
  const askCents = dollarsToCentsRounded(raw["ap"]);
  const bidSize = integerText(raw["bs"]);
  const askSize = integerText(raw["as"]);
  const brokerQuotedAt = typeof raw["t"] === "string" ? raw["t"] : null;
  const normalized = normalizeBrokerIso(brokerQuotedAt);
  const quotedAtMs = normalized === null ? null : utcIsoToEpochMs(normalized);
  if (bidCents === null || askCents === null || bidSize === null || askSize === null || brokerQuotedAt === null || quotedAtMs === null) return null;
  if (bidCents < 0 || askCents < 0 || bidSize < 0 || askSize < 0) return null;
  return { bidCents, askCents, bidSize, askSize, quotedAtMs, brokerQuotedAt };
}

/** Spot for the strike-distance gate: the quote mid, floored to the cent. */
export function spotFromQuote(quote: RawQuoteObservation): StrikeCents {
  return integerUnit(Math.floor((quote.bidCents + quote.askCents) / 2), "StrikeCents");
}

export type OrderPagePlan = { readonly kind: "end" } | { readonly kind: "after"; readonly after: string } | { readonly kind: "unpageable" };

/**
 * Order pagination (`limit` per page, ascending by submission): a short page ends the listing; a full page continues
 * strictly after its last `submitted_at`; a full page whose last record carries no usable `submitted_at` cannot be
 * paged and is reported as such — never as complete (gate finding G2-F5, P7).
 */
export function nextOrderPageAfter(page: readonly BrokerOrderRecord[], pageLimit: number): OrderPagePlan {
  if (page.length < pageLimit) return { kind: "end" };
  const lastInstant = page[page.length - 1]?.brokerTimestamps["submitted_at"];
  if (lastInstant === undefined || lastInstant.length === 0) return { kind: "unpageable" };
  // The broker cursor is strictly-after by instant, and several orders may share one instant across the page
  // boundary. The next page therefore starts after the last instant that is strictly earlier than the page's last
  // one, so the tie group is re-read in full (the shell drops duplicates by broker order ID); a page that is one
  // single tie cannot be paged through at all (gate finding G3-N6, P7).
  const earlier = page.map(order => order.brokerTimestamps["submitted_at"]).filter((value): value is string => value !== undefined && value.length > 0 && value < lastInstant);
  const cursor = earlier.reduce<string | null>((best, value) => (best === null || value > best ? value : best), null);
  return cursor === null ? { kind: "unpageable" } : { kind: "after", after: cursor };
}
