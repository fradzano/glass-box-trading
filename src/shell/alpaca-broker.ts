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
  mapAccountActivity,
  mapLatestQuote,
  mapOptionContract,
  mapOrder,
  mapPosition,
  nextActivityPageAfter,
  nextOrderPageAfter,
  spotFromQuote,
} from "../core/alpaca-mapping.js";
import type { AccountActivityRecord, AccountDocument, RawQuoteObservation } from "../core/alpaca-mapping.js";
import { isPaperTradingHost } from "../core/authority.js";
import { isWorkingBrokerStatus } from "../core/execution.js";
import type { BrokerOrderRecord, BrokerPosition, MarketObservation } from "../core/execution.js";
import { BrokerHttpError } from "./broker-errors.js";
import { readSubmitPayload } from "./broker-ports.js";
import type { AccountView, BrokerReadPort } from "./broker-ports.js";
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
  /** Every transport wait is bounded below the configured cycle walltime. */
  readonly requestTimeoutMs?: number;
}

export interface MarketWindow {
  readonly underlyings: readonly string[];
  /** Expiries (YYYY-MM-DD) whose remaining sessions lie inside the policy bounds; the shell selects the nearest few. */
  readonly expiries: readonly string[];
  /** Strike window as a fraction of spot, e.g. 300 bps keeps strikes within 3% of spot. */
  readonly strikeWindowBps: number;
  /**
   * Contract identities that must be quoted whatever the expiry and strike
   * bounds above select (S-X-07, A29): the contracts the account holds. They
   * are resolved one by one against the contract endpoint and quoted with the
   * walked chain, so a held structure stays priceable after its expiry has
   * come nearer than `EXPIRY_MIN_SESSIONS` or the underlying has drifted out
   * of the walked band. Build windows through `market-window.ts`, never here.
   */
  readonly heldContractIds: readonly string[];
}

export interface FullSnapshot {
  readonly at: string;
  readonly account: AccountDocument;
  readonly positions: readonly BrokerPosition[];
  readonly orders: readonly BrokerOrderRecord[];
  readonly nonTerminalOrders: readonly string[];
  readonly orderPagesFetched: number;
  readonly pagesComplete: boolean;
  /** Number of consecutive identical complete reads used to establish this snapshot. */
  readonly consistentReads: number;
}

/** One fully paginated listing as the S-CYC-09 proof reads it: `complete` is false whenever a page could be missing. */
export interface HistoryEvidence {
  readonly complete: boolean;
  readonly items: number;
}

export interface ActivityListing {
  readonly activities: readonly AccountActivityRecord[];
  readonly pages: number;
  readonly complete: boolean;
}

/**
 * The S-CYC-09 competition provenance bundle exactly as the pure proof
 * (`validateCompetitionProvenance`) reads it. Every field is observed, none is
 * assumed: the role follows from the origin the adapter is bound to (only the
 * canonical paper host arms at all, S-CYC-11), the opening money is the account
 * document's own cash and equity — meaningful as "opening" precisely because
 * the same bundle proves the ledger untouched — and each listing carries its
 * own pagination completeness, so a missing page fails closed instead of
 * reading as an empty account.
 *
 * The activity ledger travels as the mapped records, not as a count: a virgin
 * Alpaca paper account already carries the `JNLC` journal that funded it, so
 * only the pure core can tell an opening funding journal from prior use. The
 * adapter classifies nothing.
 */
export interface ProvenanceBundle {
  readonly accountRole: string;
  readonly accountId: string;
  readonly createdAt: string | null;
  readonly openingCashCents: number;
  readonly openingEquityCents: number;
  readonly positionCount: number;
  readonly nonTerminalOrderCount: number;
  readonly orderHistory: HistoryEvidence;
  readonly fillHistory: HistoryEvidence;
  readonly activityLedger: { readonly complete: boolean; readonly activities: readonly AccountActivityRecord[] };
}

export interface AlpacaBroker {
  readonly read: BrokerReadPort;
  readonly port: BrokerMutationPort;
  readonly accountDocument: (deadlineAtMs?: number) => Promise<AccountDocument>;
  readonly market: (window: MarketWindow, deadlineAtMs?: number) => Promise<MarketObservation>;
  readonly calendar: (startDate: string, endDate: string) => Promise<readonly CalendarDay[]>;
  readonly clockIsOpen: () => Promise<boolean>;
  readonly ordersByStatus: (status: "open" | "closed" | "all", deadlineAtMs?: number) => Promise<{ readonly orders: readonly BrokerOrderRecord[]; readonly pages: number; readonly complete: boolean }>;
  readonly accountActivities: (activityTypes: readonly string[], deadlineAtMs?: number) => Promise<ActivityListing>;
  readonly fullSnapshot: (deadlineAtMs?: number) => Promise<FullSnapshot>;
  readonly provenanceBundle: (deadlineAtMs?: number) => Promise<ProvenanceBundle>;
}

const ORDER_PAGE_LIMIT = 500;
const ACTIVITY_PAGE_LIMIT = 100;
const QUOTE_BATCH = 100;
/** Alpaca reports every execution — full or partial — under the `FILL` trade-activity type. */
const FILL_ACTIVITY_TYPES = ["FILL"];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAlpacaBroker(options: AlpacaBrokerOptions): AlpacaBroker {
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new RangeError("requestTimeoutMs must be a positive integer");
  const headers = { "APCA-API-KEY-ID": options.credentials.keyId, "APCA-API-SECRET-KEY": options.credentials.secretKey, "Content-Type": "application/json", Accept: "application/json" };

  function assertBeforeDeadline(deadlineAtMs?: number): void {
    if (deadlineAtMs !== undefined && options.clock() >= deadlineAtMs) throw new Error("CYCLE_WALLTIME_EXCEEDED");
  }

  async function request(origin: string, path: string, init: { readonly method?: string; readonly body?: unknown; readonly deadlineAtMs?: number } = {}): Promise<{ readonly status: number; readonly json: unknown }> {
    const remainingMs = init.deadlineAtMs === undefined ? requestTimeoutMs : Math.min(requestTimeoutMs, init.deadlineAtMs - options.clock());
    if (remainingMs <= 0) throw new Error("CYCLE_WALLTIME_EXCEEDED");
    const controller = new AbortController();
    const fetchPromise = Promise.resolve().then(() => fetchImpl(`${origin}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? null : JSON.stringify(init.body), redirect: "error", signal: controller.signal }));
    let rejectTimeout: (reason: Error) => void = () => undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
        controller.abort();
        rejectTimeout(new Error(`BROKER_TIMEOUT after ${String(remainingMs)} ms`));
    }, remainingMs);
    let response: Response;
    let text: string;
    try {
      response = await Promise.race([fetchPromise, timeout]);
      // A fetch resolves when headers arrive; the same deadline must cover a stalled response body as well.
      text = await Promise.race([response.text(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { message: text };
      }
    }
    assertBeforeDeadline(init.deadlineAtMs);
    return { status: response.status, json };
  }

  async function get(origin: string, path: string, deadlineAtMs?: number): Promise<unknown> {
    const { status, json } = await request(origin, path, deadlineAtMs === undefined ? {} : { deadlineAtMs });
    if (status < 200 || status >= 300) throw new BrokerHttpError(status, `${String(status)} ${isRecord(json) && typeof json["message"] === "string" ? json["message"] : "request failed"}`);
    return json;
  }

  async function ordersPage(status: string, after: string | null, deadlineAtMs?: number): Promise<readonly BrokerOrderRecord[]> {
    const query = new URLSearchParams({ status, limit: String(ORDER_PAGE_LIMIT), direction: "asc", nested: "true" });
    if (after !== null) query.set("after", after);
    const json = await get(options.tradingOrigin, `/v2/orders?${query.toString()}`, deadlineAtMs);
    if (!Array.isArray(json)) throw new Error("ORDERS_DOCUMENT_INVALID");
    const mapped = json.map(item => {
      const mapped = mapOrder(item);
      if (mapped === null) throw new Error("ORDER_DOCUMENT_INVALID");
      return mapped;
    });
    assertBeforeDeadline(deadlineAtMs);
    return mapped;
  }

  async function ordersByStatus(status: "open" | "closed" | "all", deadlineAtMs?: number): Promise<{ readonly orders: readonly BrokerOrderRecord[]; readonly pages: number; readonly complete: boolean }> {
    const orders: BrokerOrderRecord[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    let pages = 0;
    for (;;) {
      const page = await ordersPage(status, after, deadlineAtMs);
      pages += 1;
      for (const order of page) {
        if (seen.has(order.brokerOrderId)) continue;
        seen.add(order.brokerOrderId);
        orders.push(order);
      }
      assertBeforeDeadline(deadlineAtMs);
      const next = nextOrderPageAfter(page, ORDER_PAGE_LIMIT);
      if (next.kind === "end") return { orders, pages, complete: true };
      if (next.kind === "unpageable" || next.after === after || pages > 200) return { orders, pages, complete: false };
      after = next.after;
    }
  }

  async function activitiesPage(activityTypes: readonly string[], after: string | null, deadlineAtMs?: number): Promise<readonly AccountActivityRecord[]> {
    const query = new URLSearchParams({ page_size: String(ACTIVITY_PAGE_LIMIT), direction: "asc" });
    if (activityTypes.length > 0) query.set("activity_types", activityTypes.join(","));
    if (after !== null) query.set("page_token", after);
    const json = await get(options.tradingOrigin, `/v2/account/activities?${query.toString()}`, deadlineAtMs);
    if (!Array.isArray(json)) throw new Error("ACTIVITIES_DOCUMENT_INVALID");
    const mapped = json.map(item => {
      const activity = mapAccountActivity(item);
      if (activity === null) throw new Error("ACTIVITY_DOCUMENT_INVALID");
      return activity;
    });
    assertBeforeDeadline(deadlineAtMs);
    return mapped;
  }

  /** The account-activity ledger, paged to the end; an empty `activityTypes` reads every type. */
  async function accountActivities(activityTypes: readonly string[], deadlineAtMs?: number): Promise<ActivityListing> {
    const activities: AccountActivityRecord[] = [];
    const seen = new Set<string>();
    let after: string | null = null;
    let pages = 0;
    for (;;) {
      const page = await activitiesPage(activityTypes, after, deadlineAtMs);
      pages += 1;
      for (const activity of page) {
        if (seen.has(activity.id)) continue;
        seen.add(activity.id);
        activities.push(activity);
      }
      assertBeforeDeadline(deadlineAtMs);
      const next = nextActivityPageAfter(page, ACTIVITY_PAGE_LIMIT);
      if (next.kind === "end") return { activities, pages, complete: true };
      if (next.kind === "unpageable" || next.after === after || pages > 200) return { activities, pages, complete: false };
      after = next.after;
    }
  }

  async function accountDocument(deadlineAtMs?: number): Promise<AccountDocument> {
    const mapped = mapAccount(await get(options.tradingOrigin, "/v2/account", deadlineAtMs));
    if (mapped === null) throw new Error("ACCOUNT_DOCUMENT_INVALID");
    assertBeforeDeadline(deadlineAtMs);
    return mapped;
  }

  const read: BrokerReadPort = {
    async account(deadlineAtMs?: number): Promise<AccountView> {
      const document = await accountDocument(deadlineAtMs);
      return { accountId: document.accountId, cashCents: document.cashCents, equityCents: document.equityCents };
    },
    async positions(deadlineAtMs?: number): Promise<readonly BrokerPosition[]> {
      const json = await get(options.tradingOrigin, "/v2/positions", deadlineAtMs);
      if (!Array.isArray(json)) throw new Error("POSITIONS_DOCUMENT_INVALID");
      const mapped = json.map(item => {
        const mapped = mapPosition(item);
        if (mapped === null) throw new Error("POSITION_DOCUMENT_INVALID");
        return mapped;
      });
      assertBeforeDeadline(deadlineAtMs);
      return mapped;
    },
    async openOrders(deadlineAtMs?: number): Promise<readonly BrokerOrderRecord[]> {
      const result = await ordersByStatus("open", deadlineAtMs);
      if (!result.complete) throw new Error("OPEN_ORDERS_PAGINATION_INCOMPLETE");
      return result.orders;
    },
    async orderByClientId(clientOrderId: string, deadlineAtMs?: number): Promise<BrokerOrderRecord | null> {
      const { status, json } = await request(options.tradingOrigin, `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`, deadlineAtMs === undefined ? {} : { deadlineAtMs });
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
        const { status, json } = await request(options.tradingOrigin, "/v2/orders", { method: "POST", body, ...(mutation.notAfterMs === undefined ? {} : { deadlineAtMs: mutation.notAfterMs }) });
        const message = isRecord(json) && typeof json["message"] === "string" ? json["message"] : "";
        if (status === 401 || status === 403) throw new BrokerHttpError(status, `${String(status)} ${message}`);
        if (status === 422 && /client_order_id|client order id/i.test(message) && /unique|exist|duplicate/i.test(message)) return { ok: false, reason: "DUPLICATE_CLIENT_ORDER_ID" };
        if (status === 422 || status === 400) return { ok: false, reason: `REJECTED:${message.length === 0 ? `HTTP ${String(status)}` : message}` };
        if (status < 200 || status >= 300) throw new BrokerHttpError(status, `${String(status)} ${message}`);
        const mapped = mapOrder(json);
        if (mapped === null) throw new Error("ORDER_DOCUMENT_INVALID");
        if (mapped.status === "rejected") return { ok: false, reason: `REJECTED:${message.length === 0 ? "broker rejected the order" : message}` };
        return { ok: true, brokerOrderId: mapped.brokerOrderId };
      }
      if (mutation.kind === "cancel_order") {
        const existing = await read.orderByClientId(mutation.clientOrderId, mutation.notAfterMs);
        if (existing === null) return { ok: false, reason: "NOT_FOUND" };
        const { status, json } = await request(options.tradingOrigin, `/v2/orders/${encodeURIComponent(existing.brokerOrderId)}`, { method: "DELETE", ...(mutation.notAfterMs === undefined ? {} : { deadlineAtMs: mutation.notAfterMs }) });
        if (status === 401 || status === 403) throw new BrokerHttpError(status, `${String(status)} cancel refused`);
        if (status === 204 || status === 200) return { ok: true, brokerOrderId: existing.brokerOrderId };
        const message = isRecord(json) && typeof json["message"] === "string" ? json["message"] : `HTTP ${String(status)}`;
        return { ok: false, reason: `REJECTED:${message}` };
      }
      return { ok: false, reason: "CLOSE_POSITION_NOT_SUPPORTED: every close is a limit order through submit_order" };
    },
  };

  async function latestQuotes(path: string, symbols: readonly string[], deadlineAtMs?: number): Promise<Record<string, RawQuoteObservation>> {
    const out: Record<string, RawQuoteObservation> = {};
    for (let index = 0; index < symbols.length; index += QUOTE_BATCH) {
      const batch = symbols.slice(index, index + QUOTE_BATCH);
      const json = await get(options.dataOrigin, `${path}${encodeURIComponent(batch.join(","))}`, deadlineAtMs);
      const quotes = isRecord(json) ? json["quotes"] : null;
      if (!isRecord(quotes)) throw new Error("QUOTES_DOCUMENT_INVALID");
      for (const [symbol, raw] of Object.entries(quotes)) {
        const mapped = mapLatestQuote(raw);
        if (mapped !== null) out[symbol] = mapped;
      }
    }
    return out;
  }

  async function contractsFor(underlying: string, expiry: string, strikeLowCents: number, strikeHighCents: number, deadlineAtMs?: number): Promise<readonly OptionContract[]> {
    const out: OptionContract[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ underlying_symbols: underlying, expiration_date: expiry, strike_price_gte: (strikeLowCents / 100).toFixed(2), strike_price_lte: (strikeHighCents / 100).toFixed(2), limit: "1000", status: "active" });
      if (pageToken !== null) query.set("page_token", pageToken);
      const json = await get(options.tradingOrigin, `/v2/options/contracts?${query.toString()}`, deadlineAtMs);
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

  /**
   * One held contract by its identity (S-X-07). The chain walk only finds what
   * the expiry and strike bounds select; a contract the account holds must be
   * priceable whatever those bounds say, so it is resolved directly. Unlike
   * the walk this does not require `tradable`: an untradable held contract is
   * a fact the management step must see, not one the observation may hide.
   */
  async function contractById(contractId: string, deadlineAtMs?: number): Promise<OptionContract | null> {
    const json = await get(options.tradingOrigin, `/v2/options/contracts/${encodeURIComponent(contractId)}`, deadlineAtMs);
    const raw = isRecord(json) && isRecord(json["option_contract"]) ? json["option_contract"] : json;
    return mapOptionContract(raw);
  }

  async function market(window: MarketWindow, deadlineAtMs?: number): Promise<MarketObservation> {
    const spotQuotes = await latestQuotes("/v2/stocks/quotes/latest?feed=iex&symbols=", window.underlyings, deadlineAtMs);
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
        for (const contract of await contractsFor(underlying, expiry, spot - halfWindow, spot + halfWindow, deadlineAtMs)) contractsById[contract.contractId] = contract;
      }
    }
    // Held identities the walk did not already produce. A lookup that fails is
    // not fatal: the management step then reports a missing price for that
    // contract, which is journaled (S-X-08) instead of vanishing silently.
    for (const contractId of window.heldContractIds) {
      if (contractsById[contractId] !== undefined || window.underlyings.includes(contractId)) continue;
      try {
        const held = await contractById(contractId, deadlineAtMs);
        if (held !== null) contractsById[contractId] = held;
      } catch {
        continue;
      }
    }
    const optionSymbols = Object.keys(contractsById).filter(id => !window.underlyings.includes(id));
    const optionQuotes = await latestQuotes("/v1beta1/options/quotes/latest?feed=indicative&symbols=", optionSymbols, deadlineAtMs);
    for (const [symbol, quote] of Object.entries(optionQuotes)) quotesByContract[symbol] = quote;
    // Contracts without a quote are dropped: the gate would veto them anyway (S-G5-03), and the journal sample stays compact.
    // Contracts without a quote are dropped (see above), except a held identity:
    // it stays in the observation so the management step reports a missing
    // price for a contract it holds rather than one it has never heard of.
    const quotedContracts = Object.fromEntries(Object.entries(contractsById).filter(([symbol]) => window.underlyings.includes(symbol) || window.heldContractIds.includes(symbol) || optionQuotes[symbol] !== undefined));
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

  function snapshotFingerprint(snapshot: Omit<FullSnapshot, "consistentReads">): string {
    const positions = [...snapshot.positions].map(item => ({ contractId: item.contractId, quantity: item.quantity, avgEntryPriceCents: item.avgEntryPriceCents })).sort((a, b) => a.contractId.localeCompare(b.contractId));
    const orders = [...snapshot.orders].map(item => ({ brokerOrderId: item.brokerOrderId, clientOrderId: item.clientOrderId, status: item.status, filledQuantity: item.filledQuantity, avgFillPriceCents: item.avgFillPriceCents, avgFillPriceRaw: item.avgFillPriceRaw })).sort((a, b) => a.brokerOrderId.localeCompare(b.brokerOrderId));
    return JSON.stringify({ account: snapshot.account, positions, orders, pagesComplete: snapshot.pagesComplete });
  }

  async function readFullSnapshotOnce(deadlineAtMs?: number): Promise<Omit<FullSnapshot, "consistentReads">> {
    const [account, positions, all] = await Promise.all([accountDocument(deadlineAtMs), read.positions(deadlineAtMs), ordersByStatus("all", deadlineAtMs)]);
    const snapshot = {
      at: new Date(options.clock()).toISOString(),
      account,
      positions,
      orders: all.orders,
      nonTerminalOrders: all.orders.filter(order => isWorkingBrokerStatus(order.status)).map(order => order.clientOrderId),
      orderPagesFetched: all.pages,
      pagesComplete: all.complete,
    };
    assertBeforeDeadline(deadlineAtMs);
    return snapshot;
  }

  async function fullSnapshot(deadlineAtMs?: number): Promise<FullSnapshot> {
    let previous = await readFullSnapshotOnce(deadlineAtMs);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assertBeforeDeadline(deadlineAtMs);
      const current = await readFullSnapshotOnce(deadlineAtMs);
      const stable = snapshotFingerprint(previous) === snapshotFingerprint(current);
      assertBeforeDeadline(deadlineAtMs);
      if (stable) return { ...current, consistentReads: 2 };
      previous = current;
    }
    throw new Error("FULL_SNAPSHOT_UNSTABLE");
  }

  /**
   * S-CYC-09: everything the competition bootstrap must prove before its first
   * order, read fully paginated in one pass. The adapter only fetches; whether
   * the account is virgin is decided by the pure proof in src/core/lifecycle.ts.
   */
  async function provenanceBundle(deadlineAtMs?: number): Promise<ProvenanceBundle> {
    const snapshot = await fullSnapshot(deadlineAtMs);
    const [activities, fills] = await Promise.all([accountActivities([], deadlineAtMs), accountActivities(FILL_ACTIVITY_TYPES, deadlineAtMs)]);
    assertBeforeDeadline(deadlineAtMs);
    return {
      accountRole: isPaperTradingHost(options.tradingOrigin) ? "paper" : "unknown",
      accountId: snapshot.account.accountId,
      createdAt: snapshot.account.createdAt,
      openingCashCents: snapshot.account.cashCents,
      openingEquityCents: snapshot.account.equityCents,
      positionCount: snapshot.positions.length,
      nonTerminalOrderCount: snapshot.nonTerminalOrders.length,
      orderHistory: { complete: snapshot.pagesComplete, items: snapshot.orders.length },
      fillHistory: { complete: fills.complete, items: fills.activities.length },
      activityLedger: { complete: activities.complete, activities: activities.activities },
    };
  }

  return { read, port, accountDocument, market, calendar, clockIsOpen, ordersByStatus, accountActivities, fullSnapshot, provenanceBundle };
}
