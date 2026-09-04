// The broker port contracts shared by every broker adapter (P3 fake, P7
// real Alpaca): the read port shape, the submit-payload wire format, and the
// pure `readSubmitPayload` guard that turns an untrusted mutation payload
// into a typed `SubmitPayload` or `null`. Nothing here reaches a network or
// holds state — both `fake-broker.ts` and `alpaca-broker.ts` depend on this
// module, never on each other.
import type { EntryLimitKind, OptionLeg } from "../core/domain.js";
import type { BrokerOrderRecord, BrokerPosition } from "../core/execution.js";

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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
