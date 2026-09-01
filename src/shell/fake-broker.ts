// A deterministic fake broker for P3 (fills, partial fills, synchronous and
// asynchronous rejection, lost acknowledgements, duplicate client order IDs,
// cancel/fill races). It implements the read side the cycle runner fetches
// from and the `BrokerMutationPort` behind the P2 gateway; nothing in it
// reaches a network. Every mutation it receives has therefore already passed
// the gateway's authority check — the fake records them so tests can prove it.
//
// Honesty note on the model: cash and equity are set by the test, not derived
// from fills — the paper environment's own accounting is what P7 observes.
import type { EntryLimitKind, OptionLeg } from "../core/domain.js";
import { isWorkingBrokerStatus } from "../core/execution.js";
import type { BrokerOrderRecord, BrokerPosition } from "../core/execution.js";
import { BrokerHttpError } from "./broker-errors.js";
import type { BrokerMutation, BrokerMutationPort, BrokerMutationResult } from "./mutation-gateway.js";

export interface SubmitPayload {
  readonly legs: readonly OptionLeg[];
  readonly quantity: number;
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: number };
  readonly intent: "entry" | "close";
}

export interface AccountView {
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
}

export interface BrokerReadPort {
  account(deadlineAtMs?: number): Promise<AccountView>;
  positions(deadlineAtMs?: number): Promise<readonly BrokerPosition[]>;
  openOrders(deadlineAtMs?: number): Promise<readonly BrokerOrderRecord[]>;
  orderByClientId(clientOrderId: string, deadlineAtMs?: number): Promise<BrokerOrderRecord | null>;
}

export type SubmitBehaviour =
  | { readonly kind: "fill"; readonly avgFillPriceCents?: number }
  | { readonly kind: "partial"; readonly filledQuantity: number; readonly avgFillPriceCents?: number }
  | { readonly kind: "accept" }
  | { readonly kind: "reject"; readonly reason: string }
  | { readonly kind: "accept_then_reject"; readonly reason: string }
  | { readonly kind: "accept_then_fill"; readonly avgFillPriceCents?: number }
  /** The order is created at the broker, but the port throws before the acknowledgement arrives. */
  | { readonly kind: "lose_ack" }
  /** The port throws and the order never existed. */
  | { readonly kind: "lose_ack_never_sent" };

export type CancelBehaviour = "cancel" | "fill_before_cancel" | "partial_before_cancel" | "lose_cancel_ack";

export type ReadKind = "account" | "positions" | "orders";

export interface FakeBrokerOptions {
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positions?: readonly BrokerPosition[];
  readonly clock: () => number;
  readonly onSubmit?: (payload: SubmitPayload, clientOrderId: string) => SubmitBehaviour;
  readonly onCancel?: (order: BrokerOrderRecord) => CancelBehaviour;
}

export interface FakeBroker {
  readonly read: BrokerReadPort;
  readonly port: BrokerMutationPort;
  /** Every mutation that reached the port, in order. */
  readonly mutations: readonly BrokerMutation[];
  allOrders(): readonly BrokerOrderRecord[];
  setEquity(equityCents: number): void;
  setPositions(positions: readonly BrokerPosition[]): void;
  /** The named reads throw on their next call (S-CYC-02 half-answers). */
  failNextReads(kinds: readonly ReadKind[]): void;
  /** The named reads throw a `BrokerHttpError` with this status until cleared with `null` (S-G12-06 credential fence). */
  setReadHttpFailure(kinds: readonly ReadKind[], status: number | null): void;
  setSubmitBehaviour(behaviour: (payload: SubmitPayload, clientOrderId: string) => SubmitBehaviour): void;
  setCancelBehaviour(behaviour: (order: BrokerOrderRecord) => CancelBehaviour): void;
  /** Moves a resting order to a new status between cycles (the broker acting while nobody watches, S-X-04). */
  transitionOrder(clientOrderId: string, transition: { readonly status: "rejected" | "canceled" | "expired"; readonly reason: string | null } | { readonly status: "filled"; readonly avgFillPriceCents?: number }): void;
}

interface MutableOrder {
  brokerOrderId: string;
  clientOrderId: string;
  status: string;
  filledQuantity: number;
  avgFillPriceCents: number | null;
  avgFillPriceRaw: string | null;
  brokerTimestamps: Record<string, string>;
  brokerReason: string | null;
  legs: readonly { contractId: string; side: "buy" | "sell"; ratio: number }[];
  quantity: number;
  limit: { kind: EntryLimitKind; priceCents: number };
  /** Applied on the next read: an asynchronous status change (S-X-04). */
  onNextRead: { status: string; reason: string | null; fill?: { quantity: number; priceCents: number } } | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactDollarsFromCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  return `${String(whole)}.${String(cents % 100).padStart(2, "0")}`;
}

export function readSubmitPayload(payload: unknown): SubmitPayload | null {
  if (!isRecord(payload)) return null;
  const legs = payload["legs"];
  const quantity = payload["quantity"];
  const limit = payload["limit"];
  const intent = payload["intent"];
  if (!Array.isArray(legs) || legs.length === 0 || !Number.isSafeInteger(quantity) || (quantity as number) < 1 || !isRecord(limit) || (intent !== "entry" && intent !== "close")) return null;
  if ((limit["kind"] !== "debit" && limit["kind"] !== "credit") || !Number.isSafeInteger(limit["priceCents"])) return null;
  for (const optionLeg of legs) {
    if (!isRecord(optionLeg) || typeof optionLeg["contractId"] !== "string" || (optionLeg["side"] !== "buy" && optionLeg["side"] !== "sell") || !Number.isSafeInteger(optionLeg["ratio"])) return null;
  }
  return { legs: legs as readonly OptionLeg[], quantity: quantity as number, limit: { kind: limit["kind"], priceCents: limit["priceCents"] as number }, intent };
}

export function createFakeBroker(options: FakeBrokerOptions): FakeBroker {
  const orders = new Map<string, MutableOrder>();
  const positions = new Map<string, { quantity: number; avgEntryPriceCents: number }>();
  for (const position of options.positions ?? []) positions.set(position.contractId, { quantity: position.quantity, avgEntryPriceCents: position.avgEntryPriceCents });
  let equityCents = options.equityCents;
  const failing = new Set<ReadKind>();
  const httpFailing = new Map<ReadKind, number>();
  const mutations: BrokerMutation[] = [];
  let onSubmit: (payload: SubmitPayload, clientOrderId: string) => SubmitBehaviour = options.onSubmit ?? (() => ({ kind: "fill" }));
  let onCancel: (order: BrokerOrderRecord) => CancelBehaviour = options.onCancel ?? (() => "cancel");
  let nextBrokerId = 1;

  const stamp = (): string => new Date(options.clock()).toISOString().replace("Z", "123456Z");

  function applyFill(order: MutableOrder, quantity: number, priceCents: number): void {
    for (const optionLeg of order.legs) {
      const current = positions.get(optionLeg.contractId) ?? { quantity: 0, avgEntryPriceCents: 0 };
      const delta = (optionLeg.side === "buy" ? 1 : -1) * optionLeg.ratio * quantity;
      positions.set(optionLeg.contractId, { quantity: current.quantity + delta, avgEntryPriceCents: priceCents });
    }
    order.filledQuantity += quantity;
    order.avgFillPriceCents = priceCents;
    order.avgFillPriceRaw = exactDollarsFromCents(priceCents);
    order.brokerTimestamps["filled_at"] = stamp();
    order.status = order.filledQuantity >= order.quantity ? "filled" : "partially_filled";
  }

  function view(order: MutableOrder): BrokerOrderRecord {
    if (order.onNextRead !== null) {
      const pending = order.onNextRead;
      order.onNextRead = null;
      if (pending.fill !== undefined) applyFill(order, pending.fill.quantity, pending.fill.priceCents);
      else {
        order.status = pending.status;
        order.brokerReason = pending.reason;
        order.brokerTimestamps["updated_at"] = stamp();
      }
    }
    return {
      brokerOrderId: order.brokerOrderId,
      clientOrderId: order.clientOrderId,
      status: order.status,
      filledQuantity: order.filledQuantity,
      avgFillPriceCents: order.avgFillPriceCents,
      avgFillPriceRaw: order.avgFillPriceRaw,
      brokerTimestamps: { ...order.brokerTimestamps },
      brokerReason: order.brokerReason,
      legs: order.legs.map(optionLeg => ({ ...optionLeg })),
      quantity: order.quantity,
      limit: { ...order.limit },
    };
  }

  function failIfArmed(kind: ReadKind): void {
    const status = httpFailing.get(kind);
    if (status !== undefined) throw new BrokerHttpError(status, `fake broker: ${kind} endpoint answered ${String(status)}`);
    if (failing.has(kind)) {
      failing.delete(kind);
      throw new Error(`fake broker: ${kind} endpoint unavailable`);
    }
  }

  function submit(mutation: BrokerMutation): BrokerMutationResult {
    const payload = readSubmitPayload(mutation.payload);
    if (payload === null) return { ok: false, reason: "REJECTED:malformed order payload" };
    if (orders.has(mutation.clientOrderId)) return { ok: false, reason: "DUPLICATE_CLIENT_ORDER_ID" };
    const behaviour = onSubmit(payload, mutation.clientOrderId);
    if (behaviour.kind === "reject") return { ok: false, reason: `REJECTED:${behaviour.reason}` };
    if (behaviour.kind === "lose_ack_never_sent") throw new Error("TIMEOUT before send");
    const order: MutableOrder = {
      brokerOrderId: `fake-${String(nextBrokerId++)}`,
      clientOrderId: mutation.clientOrderId,
      status: "accepted",
      filledQuantity: 0,
      avgFillPriceCents: null,
      avgFillPriceRaw: null,
      brokerTimestamps: { submitted_at: stamp() },
      brokerReason: null,
      legs: payload.legs.map(optionLeg => ({ contractId: optionLeg.contractId, side: optionLeg.side, ratio: optionLeg.ratio })),
      quantity: payload.quantity,
      limit: { ...payload.limit },
      onNextRead: null,
    };
    orders.set(order.clientOrderId, order);
    switch (behaviour.kind) {
      case "fill":
        applyFill(order, order.quantity, behaviour.avgFillPriceCents ?? order.limit.priceCents);
        break;
      case "partial":
        applyFill(order, Math.min(behaviour.filledQuantity, order.quantity), behaviour.avgFillPriceCents ?? order.limit.priceCents);
        break;
      case "accept":
        break;
      case "accept_then_reject":
        order.onNextRead = { status: "rejected", reason: behaviour.reason };
        break;
      case "accept_then_fill":
        order.onNextRead = { status: "filled", reason: null, fill: { quantity: order.quantity, priceCents: behaviour.avgFillPriceCents ?? order.limit.priceCents } };
        break;
      case "lose_ack":
        throw new Error("TIMEOUT after send");
    }
    return { ok: true, brokerOrderId: order.brokerOrderId };
  }

  function cancel(mutation: BrokerMutation): BrokerMutationResult {
    const order = orders.get(mutation.clientOrderId);
    if (order === undefined) return { ok: false, reason: "REJECTED:unknown order" };
    if (!isWorkingBrokerStatus(order.status)) return { ok: false, reason: `REJECTED:order is ${order.status}` };
    const behaviour = onCancel(view(order));
    switch (behaviour) {
      case "cancel":
        order.status = "canceled";
        order.brokerTimestamps["canceled_at"] = stamp();
        return { ok: true, brokerOrderId: order.brokerOrderId };
      case "fill_before_cancel":
        applyFill(order, order.quantity - order.filledQuantity, order.limit.priceCents);
        return { ok: false, reason: "REJECTED:order already filled" };
      case "partial_before_cancel":
        applyFill(order, 1, order.limit.priceCents);
        order.status = "canceled";
        order.brokerTimestamps["canceled_at"] = stamp();
        return { ok: true, brokerOrderId: order.brokerOrderId };
      case "lose_cancel_ack":
        order.status = "pending_cancel";
        throw new Error("TIMEOUT after cancel request");
    }
  }

  return {
    read: {
      account: () => {
        failIfArmed("account");
        return Promise.resolve({ accountId: options.accountId, cashCents: options.cashCents, equityCents });
      },
      positions: () => {
        failIfArmed("positions");
        return Promise.resolve([...positions.entries()].filter(([, held]) => held.quantity !== 0).map(([contractId, held]) => ({ contractId, quantity: held.quantity, avgEntryPriceCents: held.avgEntryPriceCents })));
      },
      openOrders: () => {
        failIfArmed("orders");
        return Promise.resolve([...orders.values()].map(view).filter(order => isWorkingBrokerStatus(order.status)));
      },
      orderByClientId: clientOrderId => {
        failIfArmed("orders");
        const order = orders.get(clientOrderId);
        return Promise.resolve(order === undefined ? null : view(order));
      },
    },
    port: {
      mutate: mutation => {
        mutations.push(mutation);
        if (mutation.kind === "submit_order") return Promise.resolve(submit(mutation));
        if (mutation.kind === "cancel_order") return Promise.resolve(cancel(mutation));
        return Promise.resolve({ ok: false, reason: "REJECTED:close_position is not used; closes are limit orders" });
      },
    },
    mutations,
    allOrders: () => [...orders.values()].map(view),
    setEquity: value => { equityCents = value; },
    setPositions: next => {
      positions.clear();
      for (const position of next) positions.set(position.contractId, { quantity: position.quantity, avgEntryPriceCents: position.avgEntryPriceCents });
    },
    failNextReads: kinds => { for (const kind of kinds) failing.add(kind); },
    setReadHttpFailure: (kinds, status) => {
      for (const kind of kinds) {
        if (status === null) httpFailing.delete(kind);
        else httpFailing.set(kind, status);
      }
    },
    setSubmitBehaviour: behaviour => { onSubmit = behaviour; },
    setCancelBehaviour: behaviour => { onCancel = behaviour; },
    transitionOrder: (clientOrderId, transition) => {
      const order = orders.get(clientOrderId);
      if (order === undefined) throw new Error(`fake broker: unknown order ${clientOrderId}`);
      if (transition.status === "filled") applyFill(order, order.quantity - order.filledQuantity, transition.avgFillPriceCents ?? order.limit.priceCents);
      else {
        order.status = transition.status;
        order.brokerReason = transition.reason;
        order.brokerTimestamps["updated_at"] = stamp();
      }
    },
  };
}
