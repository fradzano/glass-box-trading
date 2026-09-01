// The real Alpaca adapter (P7): the read side the runner fetches from, the
// mutation port behind the P2 gateway, the market observation for the
// decision core, the exchange calendar, and the fully paginated snapshots
// the certificate and the provenance bundle need. Nothing here decides: every
// document goes through the pure mapping (`src/core/alpaca-mapping.ts`), every
// HTTP failure becomes the one `BrokerHttpError` shape the runner classifies.
// Only the role-bound canonical paper origin is ever used for orders.
import type { OptionContract } from "../core/domain.js";
import {
  buildOrderRequest,
  mapAccount,
  mapLatestQuote,
  mapOptionContract,
  mapOrder,
  mapPosition,
  nextOrderPageAfter,
  spotFromQuote,
} from "../core/alpaca-mapping.js";
import type { AccountDocument, RawQuoteObservation } from "../core/alpaca-mapping.js";
import { isWorkingBrokerStatus } from "../core/execution.js";
import type { BrokerOrderRecord, BrokerPosition, MarketObservation } from "../core/execution.js";
import { BrokerHttpError } from "./broker-errors.js";
import { readSubmitPayload } from "./fake-broker.js";
import type { AccountView, BrokerReadPort } from "./fake-broker.js";
import type { CalendarDay } from "./market-calendar.js";
import type { BrokerMutation, BrokerMutationPort, BrokerMutationResult } from "./mutation-gateway.js";

export interface AlpacaCredentials {
  readonly keyId: string;
  readonly secretKey: string;
}

export interface AlpacaBrokerOptions {
  readonly credentials: AlpacaCredentials;
  /** The validated canonical paper origin (§0); the adapter never derives or falls back. */
  readonly tradingOrigin: string;
  /** The market-data origin (validated separately from the order-capable origin, S-CYC-11). */
  readonly dataOrigin: string;
  readonly clock: () => number;
  readonly fetchImpl?: typeof fetch;
}

export interface MarketWindow {
  readonly underlyings: readonly string[];
  /** Expiries (YYYY-MM-DD) whose remaining sessions lie inside the policy bounds; the shell selects the nearest few. */
  readonly expiries: readonly string[];
  /** Strike window as a fraction of spot, e.g. 300 bps keeps strikes within 3% of spot. */
  readonly strikeWindowBps: number;
}

export interface FullSnapshot {
  readonly at: string;
  readonly account: AccountDocument;
  readonly positions: readonly BrokerPosition[];
  readonly orders: readonly BrokerOrderRecord[];
  readonly nonTerminalOrders: readonly string[];
  readonly orderPagesFetched: number;
  readonly pagesComplete: boolean;
}

export interface AlpacaBroker {
  readonly read: BrokerReadPort;
  readonly port: BrokerMutationPort;
  readonly accountDocument: () => Promise<AccountDocument>;
  readonly market: (window: MarketWindow) => Promise<MarketObservation>;
  readonly calendar: (startDate: string, endDate: string) => Promise<readonly CalendarDay[]>;
  readonly clockIsOpen: () => Promise<boolean>;
  readonly ordersByStatus: (status: "open" | "closed" | "all") => Promise<{ readonly orders: readonly BrokerOrderRecord[]; readonly pages: number; readonly complete: boolean }>;
  readonly fullSnapshot: () => Promise<FullSnapshot>;
}

const ORDER_PAGE_LIMIT = 500;
const QUOTE_BATCH = 100;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAlpacaBroker(options: AlpacaBrokerOptions): AlpacaBroker {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { "APCA-API-KEY-ID": options.credentials.keyId, "APCA-API-SECRET-KEY": options.credentials.secretKey, "Content-Type": "application/json", Accept: "application/json" };

  async function request(origin: string, path: string, init: { readonly method?: string; readonly body?: unknown } = {}): Promise<{ readonly status: number; readonly json: unknown }> {
    const response = await fetchImpl(`${origin}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? null : JSON.stringify(init.body), redirect: "error" });
    const text = await response.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { message: text };
      }
    }
    return { status: response.status, json };
  }

  async function get(origin: string, path: string): Promise<unknown> {
    const { status, json } = await request(origin, path);
    if (status < 200 || status >= 300) throw new BrokerHttpError(status, `${String(status)} ${isRecord(json) && typeof json["message"] === "string" ? json["message"] : "request failed"}`);
    return json;
  }

  async function ordersPage(status: string, after: string | null): Promise<readonly BrokerOrderRecord[]> {
    const query = new URLSearchParams({ status, limit: String(ORDER_PAGE_LIMIT), direction: "asc", nested: "true" });
    if (after !== null) query.set("after", after);
    const json = await get(options.tradingOrigin, `/v2/orders?${query.toString()}`);
    if (!Array.isArray(json)) throw new Error("ORDERS_DOCUMENT_INVALID");
    return json.map(item => {
      const mapped = mapOrder(item);
      if (mapped === null) throw new Error("ORDER_DOCUMENT_INVALID");
      return mapped;
    });
  }

  async function ordersByStatus(status: "open" | "closed" | "all"): Promise<{ readonly orders: readonly BrokerOrderRecord[]; readonly pages: number; readonly complete: boolean }> {
    const orders: BrokerOrderRecord[] = [];
    let after: string | null = null;
    let pages = 0;
    for (;;) {
      const page = await ordersPage(status, after);
      pages += 1;
      orders.push(...page);
      const next = nextOrderPageAfter(page, ORDER_PAGE_LIMIT);
      if (next === null) return { orders, pages, complete: true };
      if (next === after || pages > 200) return { orders, pages, complete: false };
      after = next;
    }
  }

  async function accountDocument(): Promise<AccountDocument> {
    const mapped = mapAccount(await get(options.tradingOrigin, "/v2/account"));
    if (mapped === null) throw new Error("ACCOUNT_DOCUMENT_INVALID");
    return mapped;
  }

  const read: BrokerReadPort = {
    async account(): Promise<AccountView> {
      const document = await accountDocument();
      return { accountId: document.accountId, cashCents: document.cashCents, equityCents: document.equityCents };
    },
    async positions(): Promise<readonly BrokerPosition[]> {
      const json = await get(options.tradingOrigin, "/v2/positions");
      if (!Array.isArray(json)) throw new Error("POSITIONS_DOCUMENT_INVALID");
      return json.map(item => {
        const mapped = mapPosition(item);
        if (mapped === null) throw new Error("POSITION_DOCUMENT_INVALID");
        return mapped;
      });
    },
    async openOrders(): Promise<readonly BrokerOrderRecord[]> {
      const result = await ordersByStatus("open");
      if (!result.complete) throw new Error("OPEN_ORDERS_PAGINATION_INCOMPLETE");
      return result.orders;
    },
    async orderByClientId(clientOrderId: string): Promise<BrokerOrderRecord | null> {
      const { status, json } = await request(options.tradingOrigin, `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
      if (status === 404) return null;
      if (status < 200 || status >= 300) throw new BrokerHttpError(status, `${String(status)} order lookup failed`);
      const mapped = mapOrder(json);
      if (mapped === null) throw new Error("ORDER_DOCUMENT_INVALID");
      return mapped;
    },
  };

  const port: BrokerMutationPort = {
    async mutate(mutation: BrokerMutation): Promise<BrokerMutationResult> {
      if (mutation.kind === "submit_order") {
        const payload = readSubmitPayload(mutation.payload);
        if (payload === null) return { ok: false, reason: "REJECTED:submit payload malformed" };
        const body = buildOrderRequest({ clientOrderId: mutation.clientOrderId, legs: payload.legs.map(leg => ({ contractId: leg.contractId, side: leg.side, ratio: leg.ratio })), quantity: payload.quantity, limit: payload.limit, intent: payload.intent });
        const { status, json } = await request(options.tradingOrigin, "/v2/orders", { method: "POST", body });
        const message = isRecord(json) && typeof json["message"] === "string" ? json["message"] : "";
        if (status === 401) throw new BrokerHttpError(status, `401 ${message}`);
        if (status === 422 && /client_order_id|client order id/i.test(message) && /unique|exist|duplicate/i.test(message)) return { ok: false, reason: "DUPLICATE_CLIENT_ORDER_ID" };
        if (status === 422 || status === 400 || status === 403) return { ok: false, reason: `REJECTED:${message.length === 0 ? `HTTP ${String(status)}` : message}` };
        if (status < 200 || status >= 300) throw new BrokerHttpError(status, `${String(status)} ${message}`);
        const mapped = mapOrder(json);
        if (mapped === null) throw new Error("ORDER_DOCUMENT_INVALID");
        if (mapped.status === "rejected") return { ok: false, reason: `REJECTED:${message.length === 0 ? "broker rejected the order" : message}` };
        return { ok: true, brokerOrderId: mapped.brokerOrderId };
      }
      if (mutation.kind === "cancel_order") {
        const existing = await read.orderByClientId(mutation.clientOrderId);
        if (existing === null) return { ok: false, reason: "NOT_FOUND" };
        const { status, json } = await request(options.tradingOrigin, `/v2/orders/${encodeURIComponent(existing.brokerOrderId)}`, { method: "DELETE" });
        if (status === 401) throw new BrokerHttpError(status, "401 cancel refused");
        if (status === 204 || status === 200) return { ok: true, brokerOrderId: existing.brokerOrderId };
        const message = isRecord(json) && typeof json["message"] === "string" ? json["message"] : `HTTP ${String(status)}`;
        return { ok: false, reason: `REJECTED:${message}` };
      }
      return { ok: false, reason: "CLOSE_POSITION_NOT_SUPPORTED: every close is a limit order through submit_order" };
    },
  };

  async function latestQuotes(path: string, symbols: readonly string[]): Promise<Record<string, RawQuoteObservation>> {
    const out: Record<string, RawQuoteObservation> = {};
    for (let index = 0; index < symbols.length; index += QUOTE_BATCH) {
      const batch = symbols.slice(index, index + QUOTE_BATCH);
      const json = await get(options.dataOrigin, `${path}${encodeURIComponent(batch.join(","))}`);
      const quotes = isRecord(json) ? json["quotes"] : null;
      if (!isRecord(quotes)) throw new Error("QUOTES_DOCUMENT_INVALID");
      for (const [symbol, raw] of Object.entries(quotes)) {
        const mapped = mapLatestQuote(raw);
        if (mapped !== null) out[symbol] = mapped;
      }
    }
    return out;
  }

  async function contractsFor(underlying: string, expiry: string, strikeLowCents: number, strikeHighCents: number): Promise<readonly OptionContract[]> {
    const out: OptionContract[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ underlying_symbols: underlying, expiration_date: expiry, strike_price_gte: (strikeLowCents / 100).toFixed(2), strike_price_lte: (strikeHighCents / 100).toFixed(2), limit: "1000", status: "active" });
      if (pageToken !== null) query.set("page_token", pageToken);
      const json = await get(options.tradingOrigin, `/v2/options/contracts?${query.toString()}`);
      const contracts = isRecord(json) ? json["option_contracts"] : null;
      if (!Array.isArray(contracts)) throw new Error("CONTRACTS_DOCUMENT_INVALID");
      for (const raw of contracts) {
        const mapped = mapOptionContract(raw);
        if (mapped !== null && isRecord(raw) && raw["tradable"] === true) out.push(mapped);
      }
      const next = isRecord(json) ? json["next_page_token"] : null;
      if (typeof next !== "string" || next.length === 0) break;
      pageToken = next;
    }
    return out;
  }

  async function market(window: MarketWindow): Promise<MarketObservation> {
    const spotQuotes = await latestQuotes("/v2/stocks/quotes/latest?feed=iex&symbols=", window.underlyings);
    const contractsById: Record<string, OptionContract> = {};
    const spotCentsByUnderlying: Record<string, number> = {};
    const quotesByContract: Record<string, unknown> = {};
    for (const underlying of window.underlyings) {
      const spotQuote = spotQuotes[underlying];
      if (spotQuote === undefined) continue;
      const spot = spotFromQuote(spotQuote);
      spotCentsByUnderlying[underlying] = spot;
      // The equity pseudo-contract for share residue closes (P5 decision): quoted like a contract, never a candidate leg.
      contractsById[underlying] = { contractId: underlying, underlying, expiry: "1970-01-01", strikeCents: spotFromQuote({ ...spotQuote, bidCents: 0, askCents: 0 }), right: "call" };
      quotesByContract[underlying] = spotQuote;
      const halfWindow = Math.floor((spot * window.strikeWindowBps) / 10_000);
      for (const expiry of window.expiries) {
        for (const contract of await contractsFor(underlying, expiry, spot - halfWindow, spot + halfWindow)) contractsById[contract.contractId] = contract;
      }
    }
    const optionSymbols = Object.keys(contractsById).filter(id => !window.underlyings.includes(id));
    const optionQuotes = await latestQuotes("/v1beta1/options/quotes/latest?feed=indicative&symbols=", optionSymbols);
    for (const [symbol, quote] of Object.entries(optionQuotes)) quotesByContract[symbol] = quote;
    // Contracts without a quote are dropped: the gate would veto them anyway (S-G5-03), and the journal sample stays compact.
    const quotedContracts = Object.fromEntries(Object.entries(contractsById).filter(([symbol]) => window.underlyings.includes(symbol) || optionQuotes[symbol] !== undefined));
    return { quotesByContract, contractsById: quotedContracts, spotCentsByUnderlying };
  }

  async function calendar(startDate: string, endDate: string): Promise<readonly CalendarDay[]> {
    const json = await get(options.tradingOrigin, `/v2/calendar?start=${startDate}&end=${endDate}`);
    if (!Array.isArray(json)) throw new Error("CALENDAR_DOCUMENT_INVALID");
    return json.flatMap(item => (isRecord(item) && typeof item["date"] === "string" && typeof item["open"] === "string" && typeof item["close"] === "string" ? [{ date: item["date"], open: item["open"], close: item["close"] }] : []));
  }

  async function clockIsOpen(): Promise<boolean> {
    const json = await get(options.tradingOrigin, "/v2/clock");
    return isRecord(json) && json["is_open"] === true;
  }

  async function fullSnapshot(): Promise<FullSnapshot> {
    const [account, positions, all] = await Promise.all([accountDocument(), read.positions(), ordersByStatus("all")]);
    return {
      at: new Date(options.clock()).toISOString(),
      account,
      positions,
      orders: all.orders,
      nonTerminalOrders: all.orders.filter(order => isWorkingBrokerStatus(order.status)).map(order => order.clientOrderId),
      orderPagesFetched: all.pages,
      pagesComplete: all.complete,
    };
  }

  return { read, port, accountDocument, market, calendar, clockIsOpen, ordersByStatus, fullSnapshot };
}
