// Pure execution core (P3: S-X-01..04, S-CYC-01/02/04/05/06, G13): limit
// pricing from the decision's own quotes, fill classification against the
// submitted limit, the mapping of broker observations onto the closed OUTCOME
// status set, the typed revalidation claimset, the kill predicate and
// kill-management plan, emergency-close eligibility, the journal fold that
// rebuilds every entry and close lifecycle, and the validating adapter that
// assembles a DecisionSnapshot (RES-P1-01a..d). No I/O, no clock: broker
// observations, journal entries, quotes, and explicit times are inputs, and
// every unit is constructed through `integerUnit`/`lotCount`, never cast.

import { decide, definedRiskAt } from "./decision.js";
import { integerUnit, lotCount } from "./domain.js";
import type {
  AnalystBatch,
  CandidateVerdict,
  DecisionConfig,
  DecisionResult,
  DecisionSnapshot,
  EntryActionPlan,
  EntryCandidate,
  EntryLimitKind,
  EntryReservationState,
  ReleasedEntryState,
  EpochMilliseconds,
  ExposureLifecycle,
  ExposureRiskComponent,
  LegSide,
  MoneyCents,
  OptionContract,
  OptionLeg,
  OptionPriceCents,
  OptionQuote,
  Quantity,
  Sleeve,
  StrikeCents,
} from "./domain.js";
import { isUtcIsoTimestamp, latestQuoteSamples } from "./journal.js";
import type { AccountBinding, CloseRouteLabel, JournalDraft, JournalEntry, JournalQuoteSample, JournalSnapshot, OutcomeStatus, ReasonCode } from "./journal.js";
import { closeAttemptId, closeLifecycleId } from "./order-identity.js";

// ---------------------------------------------------------------------------
// UTC time conversion without the host clock (civil-from-days / days-from-civil)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): { readonly year: number; readonly month: number; readonly day: number } {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365);
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shiftedMonth = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shiftedMonth + 2) / 5) + 1;
  const month = shiftedMonth + (shiftedMonth < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return { year, month, day };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Epoch milliseconds of a validated `YYYY-MM-DDTHH:MM:SS(.fff)?Z` string, or null when it is not one (S-J-02 shape). */
export function utcIsoToEpochMs(iso: string): EpochMilliseconds | null {
  if (!isUtcIsoTimestamp(iso)) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const hour = Number(iso.slice(11, 13));
  const minute = Number(iso.slice(14, 16));
  const second = Number(iso.slice(17, 19));
  const fraction = iso.length === 24 ? Number(iso.slice(20, 23)) : 0;
  const ms = daysFromCivil(year, month, day) * MS_PER_DAY + hour * 3_600_000 + minute * 60_000 + second * 1000 + fraction;
  return Number.isSafeInteger(ms) && ms >= 0 ? integerUnit(ms, "EpochMilliseconds") : null;
}

/** The S-J-02 timestamp form of an epoch-millisecond value; always millisecond precision. */
export function epochMsToUtcIso(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError("epoch milliseconds must be a non-negative safe integer");
  const days = Math.floor(ms / MS_PER_DAY);
  const remainder = ms - days * MS_PER_DAY;
  const { year, month, day } = civilFromDays(days);
  const hour = Math.floor(remainder / 3_600_000);
  const minute = Math.floor((remainder % 3_600_000) / 60_000);
  const second = Math.floor((remainder % 60_000) / 1000);
  const milli = remainder % 1000;
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}.${pad(milli, 3)}Z`;
}

// ---------------------------------------------------------------------------
// Configuration (§0 symbols that P3 consumes; O5 values arrive as parameters)
// ---------------------------------------------------------------------------

export interface ExecutionConfig {
  /** `LIMIT_TOLERANCE`: buys at mid plus this, sells at mid minus this (S-X-01, BEQ-10). */
  readonly limitToleranceCents: OptionPriceCents;
  /** `KILL_EQUITY_THRESHOLD` (S-G13-01; strict less-than). */
  readonly killEquityThresholdCents: MoneyCents;
  /** `INITIAL_CAPITAL`, the basis of S-G13-02. */
  readonly initialCapitalCents: MoneyCents;
}

export type KillThresholdViolation = "KILL_THRESHOLD_NOT_POSITIVE" | "KILL_THRESHOLD_IGNORES_CONVEX_DECAY";

/** S-G13-02: losing the whole convex budget alone must not trigger, so the threshold sits at or below capital minus that budget. */
export function validateKillThreshold(execution: ExecutionConfig, decision: DecisionConfig): { readonly ok: true } | { readonly ok: false; readonly violations: readonly KillThresholdViolation[] } {
  const violations: KillThresholdViolation[] = [];
  if (!Number.isSafeInteger(execution.killEquityThresholdCents) || execution.killEquityThresholdCents <= 0) violations.push("KILL_THRESHOLD_NOT_POSITIVE");
  if (BigInt(execution.killEquityThresholdCents) > BigInt(execution.initialCapitalCents) - BigInt(decision.convexBudgetCents)) violations.push("KILL_THRESHOLD_IGNORES_CONVEX_DECAY");
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// ---------------------------------------------------------------------------
// S-X-01 — every order is a limit order priced from the decision's own quotes
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function ownValue<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isRuntimeQuote(value: unknown): value is OptionQuote {
  return isRecord(value) && [value["bidCents"], value["askCents"], value["bidSize"], value["askSize"], value["quotedAt"]].every(isNonnegativeSafeInteger);
}

export type PricingFailure = "QUOTE_MISSING" | "NET_PREMIUM_ZERO" | "LIMIT_KIND_CONTRADICTS_QUOTES" | "CREDIT_LIMIT_NOT_POSITIVE" | "LIMIT_OUT_OF_RANGE";

export interface NetPricing {
  readonly kind: EntryLimitKind;
  /** Twice the signed net mid in cents; the sign decides debit (paying) versus credit (receiving). */
  readonly netMidTwiceCents: bigint;
}

/** Exported for the S-X-05 escalation ladder (P5): the ladder starts at this mid and steps from it. */
export function netMidTwice(legs: readonly OptionLeg[], quotesByContract: Readonly<Record<string, OptionQuote>>): NetPricing | "QUOTE_MISSING" | "NET_PREMIUM_ZERO" {
  let signed = 0n;
  for (const optionLeg of legs) {
    const optionQuote = ownValue(quotesByContract, optionLeg.contractId);
    if (!isRuntimeQuote(optionQuote)) return "QUOTE_MISSING";
    const midTwice = (BigInt(optionQuote.bidCents) + BigInt(optionQuote.askCents)) * BigInt(optionLeg.ratio);
    signed += optionLeg.side === "buy" ? midTwice : -midTwice;
  }
  if (signed === 0n) return "NET_PREMIUM_ZERO";
  return { kind: signed > 0n ? "debit" : "credit", netMidTwiceCents: signed };
}

/**
 * Tick-rounded limit at the penny tick of the ETF universe: a debit rounds its
 * mid up and adds the tolerance (the most we pay), a credit rounds its mid down
 * and subtracts it (the least we accept). The value may be non-positive for a
 * credit; callers decide what that means for them.
 */
function limitFromNetMid(pricing: NetPricing, toleranceCents: number): bigint {
  const magnitude = pricing.netMidTwiceCents < 0n ? -pricing.netMidTwiceCents : pricing.netMidTwiceCents;
  const roundedUp = (magnitude + 1n) / 2n;
  const roundedDown = magnitude / 2n;
  return pricing.kind === "debit" ? roundedUp + BigInt(toleranceCents) : roundedDown - BigInt(toleranceCents);
}

export type PricingResult =
  | { readonly ok: true; readonly candidate: EntryCandidate; readonly netMidTwiceCents: number }
  | { readonly ok: false; readonly reason: PricingFailure };

/**
 * Replaces the analyst's stated limit by the executable net limit derived
 * from the decision's quotes (S-X-01). The result is the candidate `decide`
 * must see, so G1–G4 reserve from the very value the executor submits; a
 * re-price is simply this function on fresh quotes followed by `decide`.
 */
export function priceEntryLimit(candidate: EntryCandidate, quotesByContract: Readonly<Record<string, OptionQuote>>, config: ExecutionConfig): PricingResult {
  const pricing = netMidTwice(candidate.legs, quotesByContract);
  if (pricing === "QUOTE_MISSING" || pricing === "NET_PREMIUM_ZERO") return { ok: false, reason: pricing };
  if (pricing.kind !== candidate.entryLimit.kind) return { ok: false, reason: "LIMIT_KIND_CONTRADICTS_QUOTES" };
  const limit = limitFromNetMid(pricing, config.limitToleranceCents);
  if (pricing.kind === "credit" && limit <= 0n) return { ok: false, reason: "CREDIT_LIMIT_NOT_POSITIVE" };
  if (limit > 9_007_199_254_740_991n || pricing.netMidTwiceCents > 9_007_199_254_740_991n || pricing.netMidTwiceCents < -9_007_199_254_740_991n) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
  return {
    ok: true,
    candidate: { ...candidate, entryLimit: { kind: pricing.kind, priceCents: integerUnit(Number(limit), "OptionPriceCents") } },
    netMidTwiceCents: Number(pricing.netMidTwiceCents),
  };
}

export type CloseLimitResult =
  | { readonly ok: true; readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: OptionPriceCents } }
  | { readonly ok: false; readonly reason: "QUOTE_MISSING" | "NET_PREMIUM_ZERO" | "LIMIT_OUT_OF_RANGE" };

/**
 * A plain S-X-01 close limit for already-reversed closing legs (the tier-1
 * kill close; the S-X-05 ladder arrives with P5). A credit close never asks
 * for less than one cent, so it stays a limit order in every case.
 */
export function priceCloseLimit(closingLegs: readonly OptionLeg[], quotesByContract: Readonly<Record<string, OptionQuote>>, config: ExecutionConfig): CloseLimitResult {
  const pricing = netMidTwice(closingLegs, quotesByContract);
  if (pricing === "QUOTE_MISSING" || pricing === "NET_PREMIUM_ZERO") return { ok: false, reason: pricing };
  const raw = limitFromNetMid(pricing, config.limitToleranceCents);
  const limit = pricing.kind === "credit" && raw < 1n ? 1n : raw;
  if (limit > 9_007_199_254_740_991n) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
  return { ok: true, limit: { kind: pricing.kind, priceCents: integerUnit(Number(limit), "OptionPriceCents") } };
}

export function reversedLegs(legs: readonly OptionLeg[]): readonly OptionLeg[] {
  return legs.map(optionLeg => ({ ...optionLeg, side: optionLeg.side === "buy" ? "sell" : "buy" }));
}

// ---------------------------------------------------------------------------
// S-X-02 — a fill is judged against the submitted limit, never assumed
// ---------------------------------------------------------------------------

export type FillClassification = "AT_LIMIT" | "PRICE_IMPROVED" | "BROKER_PRICE_BREACH";

export function classifyFillPrice(limit: { readonly kind: EntryLimitKind; readonly priceCents: number }, avgFillPriceCents: number): FillClassification {
  if (avgFillPriceCents === limit.priceCents) return "AT_LIMIT";
  if (limit.kind === "debit") return avgFillPriceCents > limit.priceCents ? "BROKER_PRICE_BREACH" : "PRICE_IMPROVED";
  return avgFillPriceCents < limit.priceCents ? "BROKER_PRICE_BREACH" : "PRICE_IMPROVED";
}

// ---------------------------------------------------------------------------
// Broker observations (what the shell fetched; nothing here is trusted beyond its shape)
// ---------------------------------------------------------------------------

export interface BrokerPosition {
  readonly contractId: string;
  /** Signed: long positive, short negative. */
  readonly quantity: number;
  readonly avgEntryPriceCents: number;
}

export interface BrokerOrderLeg {
  readonly contractId: string;
  readonly side: LegSide;
  readonly ratio: number;
}

export interface BrokerOrderRecord {
  readonly brokerOrderId: string;
  readonly clientOrderId: string;
  /** The broker's own status string, recorded verbatim; the closed sets below interpret it. */
  readonly status: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly brokerTimestamps: Readonly<Record<string, string>>;
  readonly brokerReason: string | null;
  readonly legs: readonly BrokerOrderLeg[];
  readonly quantity: number;
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: number } | null;
}

export interface BrokerBook {
  readonly accountId: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positions: readonly BrokerPosition[];
  /** Every non-terminal order the broker reports, fully paginated by the shell. */
  readonly openOrders: readonly BrokerOrderRecord[];
  readonly observedAtMs: number;
}

export function isTerminalBrokerStatus(status: string): boolean {
  return status === "filled" || status === "rejected" || status === "canceled" || status === "expired";
}

/** Anything the closed terminal set does not name keeps counting as fillable exposure (A23 counting rule). */
export function isWorkingBrokerStatus(status: string): boolean {
  return !isTerminalBrokerStatus(status);
}

// ---------------------------------------------------------------------------
// S-X-03 / S-X-04 / S-CYC-04 — broker answers become OUTCOME entries or nothing yet
// ---------------------------------------------------------------------------

export type SubmitObservation =
  | { readonly kind: "acknowledged"; readonly order: BrokerOrderRecord }
  | { readonly kind: "rejected"; readonly brokerReason: string; readonly brokerTimestamps: Readonly<Record<string, string>> }
  | { readonly kind: "acknowledgement_lost"; readonly detail: string }
  | { readonly kind: "duplicate"; readonly order: BrokerOrderRecord | null };

export interface OutcomeDerivation {
  readonly draft: JournalDraft;
  readonly status: OutcomeStatus;
  readonly terminal: boolean;
  readonly fill: FillClassification | null;
}

const BROKER_REASON_ABSENT = "BROKER_REASON_ABSENT";

function outcomeDraft(fields: {
  readonly atIso: string;
  readonly epoch: number;
  readonly clientOrderId: string;
  readonly status: OutcomeStatus;
  readonly brokerOrderId: string | null;
  readonly brokerTimestamps: Readonly<Record<string, string>>;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly binding: AccountBinding;
  readonly brokerReason: string | null;
}): JournalDraft {
  return {
    at: fields.atIso,
    epoch: fields.epoch,
    type: "OUTCOME",
    clientOrderId: fields.clientOrderId,
    status: fields.status,
    brokerOrderId: fields.brokerOrderId,
    brokerTimestamps: fields.brokerTimestamps,
    filledQuantity: fields.filledQuantity,
    avgFillPriceCents: fields.avgFillPriceCents,
    reasonCodes: fields.reasonCodes,
    binding: fields.binding,
    brokerReason: fields.brokerReason,
  };
}

export interface OutcomeContext {
  readonly clientOrderId: string;
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: number };
  readonly binding: AccountBinding;
  readonly epoch: number;
  readonly atIso: string;
}

/**
 * A broker order record becomes an OUTCOME once it is terminal; a working
 * order yields nothing and keeps counting as exposure until its terminal
 * status is seen (S-X-04). A rejection carries the broker's reason verbatim
 * (S-X-03); a fill is classified against the submitted limit and a record
 * worse than that limit is flagged `BROKER_PRICE_BREACH` (S-X-02).
 */
export function outcomeFromOrder(context: OutcomeContext, order: BrokerOrderRecord): OutcomeDerivation | null {
  if (!isTerminalBrokerStatus(order.status)) return null;
  const base = { atIso: context.atIso, epoch: context.epoch, clientOrderId: context.clientOrderId, brokerOrderId: order.brokerOrderId, brokerTimestamps: order.brokerTimestamps, binding: context.binding };
  if (order.status === "rejected") {
    const brokerReason = order.brokerReason === null || order.brokerReason.length === 0 ? BROKER_REASON_ABSENT : order.brokerReason;
    return { status: "rejected", terminal: true, fill: null, draft: outcomeDraft({ ...base, status: "rejected", filledQuantity: 0, avgFillPriceCents: null, reasonCodes: [], brokerReason }) };
  }
  const filledQuantity = isNonnegativeSafeInteger(order.filledQuantity) ? order.filledQuantity : 0;
  const price = filledQuantity > 0 && isNonnegativeSafeInteger(order.avgFillPriceCents) ? order.avgFillPriceCents : null;
  const fill = price === null ? null : classifyFillPrice(context.limit, price);
  const reasonCodes: readonly ReasonCode[] = fill === "BROKER_PRICE_BREACH" ? ["BROKER_PRICE_BREACH"] : [];
  if (order.status === "filled") {
    if (filledQuantity === 0 || price === null) return { status: "confirmation_unclear", terminal: false, fill: null, draft: outcomeDraft({ ...base, status: "confirmation_unclear", filledQuantity: 0, avgFillPriceCents: null, reasonCodes: [], brokerReason: order.brokerReason }) };
    return { status: "filled", terminal: true, fill, draft: outcomeDraft({ ...base, status: "filled", filledQuantity, avgFillPriceCents: price, reasonCodes, brokerReason: order.brokerReason }) };
  }
  const status: OutcomeStatus = filledQuantity > 0 && price !== null ? "partially_filled" : order.status === "expired" ? "expired" : "canceled";
  return { status, terminal: true, fill, draft: outcomeDraft({ ...base, status, filledQuantity: status === "partially_filled" ? filledQuantity : 0, avgFillPriceCents: status === "partially_filled" ? price : null, reasonCodes, brokerReason: order.brokerReason }) };
}

/** The executor's view right after a submit: synchronous rejection, lost acknowledgement, duplicate, or an acknowledged record. */
export function outcomeFromSubmit(context: OutcomeContext, observation: SubmitObservation): OutcomeDerivation | null {
  switch (observation.kind) {
    case "rejected":
      return {
        status: "rejected",
        terminal: true,
        fill: null,
        draft: outcomeDraft({ atIso: context.atIso, epoch: context.epoch, clientOrderId: context.clientOrderId, status: "rejected", brokerOrderId: null, brokerTimestamps: observation.brokerTimestamps, filledQuantity: 0, avgFillPriceCents: null, reasonCodes: [], binding: context.binding, brokerReason: observation.brokerReason.length === 0 ? BROKER_REASON_ABSENT : observation.brokerReason }),
      };
    case "acknowledgement_lost":
      return {
        status: "confirmation_unclear",
        terminal: false,
        fill: null,
        draft: outcomeDraft({ atIso: context.atIso, epoch: context.epoch, clientOrderId: context.clientOrderId, status: "confirmation_unclear", brokerOrderId: null, brokerTimestamps: {}, filledQuantity: 0, avgFillPriceCents: null, reasonCodes: [], binding: context.binding, brokerReason: observation.detail }),
      };
    case "duplicate":
      return observation.order === null
        ? outcomeFromSubmit(context, { kind: "acknowledgement_lost", detail: "duplicate client order ID reported but the order could not be looked up" })
        : outcomeFromOrder(context, observation.order);
    case "acknowledged":
      return outcomeFromOrder(context, observation.order);
  }
}

// ---------------------------------------------------------------------------
// Journal fold — every entry and close lifecycle is rebuilt from the journal, never from memory
// ---------------------------------------------------------------------------

export interface EntryLifecycleRecord {
  readonly clientOrderId: string;
  readonly exposureLifecycleId: string;
  readonly sleeve: Sleeve;
  readonly underlying: string;
  readonly candidate: EntryCandidate;
  readonly reservedMaxLossCents: MoneyCents;
  readonly state: EntryReservationState;
  readonly filledQuantity: Quantity;
  readonly avgFillPriceCents: OptionPriceCents | null;
  readonly brokerOrderId: string | null;
  readonly priceBreach: boolean;
}

export interface CloseAttemptRecord {
  readonly attemptId: string;
  readonly closeLifecycleId: string;
  readonly exposureLifecycleId: string;
  readonly route: CloseRouteLabel;
  readonly generation: Quantity;
  readonly legs: readonly OptionLeg[];
  readonly quantity: Quantity;
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: OptionPriceCents };
  readonly status: OutcomeStatus | "submitted";
  readonly filledQuantity: Quantity;
}

export type LifecycleFold =
  | { readonly ok: true; readonly entries: readonly EntryLifecycleRecord[]; readonly closes: readonly CloseAttemptRecord[] }
  | { readonly ok: false; readonly reason: string };

/** The closed set of classifications an entry-order reconciliation item may carry; anything else fails the fold (RES-P1-01c). */
export type EntryOrderClassification = "MATCHED_WORKING" | "NOT_AT_BROKER" | "REVALIDATION_VOID";

function isLeg(value: unknown): value is { contractId: string; underlying: string; expiry: string; strikeCents: number; right: "call" | "put"; side: LegSide; ratio: number } {
  return isRecord(value)
    && typeof value["contractId"] === "string" && typeof value["underlying"] === "string" && typeof value["expiry"] === "string"
    && isNonnegativeSafeInteger(value["strikeCents"]) && (value["right"] === "call" || value["right"] === "put")
    && (value["side"] === "buy" || value["side"] === "sell") && isNonnegativeSafeInteger(value["ratio"]) && value["ratio"] >= 1;
}

function legsFrom(value: unknown): readonly OptionLeg[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const legs: OptionLeg[] = [];
  for (const item of value) {
    if (!isLeg(item)) return null;
    legs.push({ contractId: item.contractId, underlying: item.underlying, expiry: item.expiry, strikeCents: integerUnit(item.strikeCents, "StrikeCents"), right: item.right, side: item.side, ratio: lotCount(item.ratio) });
  }
  return legs;
}

function limitFrom(value: unknown): { readonly kind: EntryLimitKind; readonly priceCents: OptionPriceCents } | null {
  if (!isRecord(value) || (value["kind"] !== "debit" && value["kind"] !== "credit") || !isNonnegativeSafeInteger(value["priceCents"])) return null;
  return { kind: value["kind"], priceCents: integerUnit(value["priceCents"], "OptionPriceCents") };
}

function entryRecordFrom(entry: JournalEntry): EntryLifecycleRecord | null {
  const clientOrderId = entry["clientOrderId"];
  const exposureLifecycleId = entry["exposureLifecycleId"];
  const sleeve = entry["sleeve"];
  const structureType = entry["structureType"];
  const legs = legsFrom(entry["legs"]);
  const quantity = entry["quantity"];
  const limit = limitFrom(entry["submittedLimit"]);
  const reserved = entry["reservedMaxLossCents"];
  const rationale = entry["rationale"];
  if (typeof clientOrderId !== "string" || typeof exposureLifecycleId !== "string" || (sleeve !== "income" && sleeve !== "convex") || typeof structureType !== "string"
    || legs === null || !isNonnegativeSafeInteger(quantity) || quantity < 1 || limit === null || !isNonnegativeSafeInteger(reserved) || !isRecord(rationale) || typeof rationale["text"] !== "string") return null;
  const underlying = legs[0]?.underlying;
  if (underlying === undefined) return null;
  return {
    clientOrderId,
    exposureLifecycleId,
    sleeve,
    underlying,
    candidate: {
      candidateId: clientOrderId,
      declaredStructureType: structureType,
      sleeve,
      quantity: lotCount(quantity),
      remainingTradingSessions: integerUnit(0, "Quantity"),
      rationale: rationale["text"],
      entryLimit: limit,
      legs,
    },
    reservedMaxLossCents: integerUnit(reserved, "MoneyCents"),
    state: "intent",
    filledQuantity: integerUnit(0, "Quantity"),
    avgFillPriceCents: null,
    brokerOrderId: null,
    priceBreach: false,
  };
}

function closeRecordFrom(entry: JournalEntry): CloseAttemptRecord | null {
  const attemptId = entry["clientOrderId"];
  const lifecycleId = entry["closeLifecycleId"];
  const exposureLifecycleId = entry["exposureLifecycleId"];
  const route = entry["route"];
  const generation = entry["generation"];
  const legs = legsFrom(entry["legs"]);
  const quantity = entry["quantity"];
  const limit = limitFrom(entry["submittedLimit"]);
  if (typeof attemptId !== "string" || typeof lifecycleId !== "string" || typeof exposureLifecycleId !== "string"
    || (route !== "ordinary" && route !== "emergency" && route !== "expiry" && route !== "kill" && route !== "watchdog" && route !== "residue" && route !== "deadline")
    || !isNonnegativeSafeInteger(generation) || legs === null || !isNonnegativeSafeInteger(quantity) || quantity < 1 || limit === null) return null;
  return { attemptId, closeLifecycleId: lifecycleId, exposureLifecycleId, route, generation: integerUnit(generation, "Quantity"), legs, quantity: integerUnit(quantity, "Quantity"), limit, status: "submitted", filledQuantity: integerUnit(0, "Quantity") };
}

function isOutcomeStatus(value: unknown): value is OutcomeStatus {
  return value === "filled" || value === "partially_filled" || value === "rejected" || value === "canceled" || value === "expired" || value === "confirmation_unclear";
}

/**
 * Risk-increasing entry lifecycles that still lack broker-authoritative
 * terminal truth. NOT_AT_BROKER is deliberately not terminal after a lost
 * acknowledgement; only a pre-submit REVALIDATION_VOID can release that case.
 */
export function unresolvedEntryLifecycleIds(entries: readonly JournalEntry[]): readonly string[] {
  const unresolved = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "INTENT" && entry["action"] !== "close" && typeof entry["clientOrderId"] === "string") {
      unresolved.add(entry["clientOrderId"]);
      continue;
    }
    if (entry.type === "OUTCOME" && typeof entry["clientOrderId"] === "string") {
      const status = entry["status"];
      if (status === "filled" || status === "partially_filled" || status === "rejected" || status === "canceled" || status === "expired") unresolved.delete(entry["clientOrderId"]);
      else if (status === "confirmation_unclear") unresolved.add(entry["clientOrderId"]);
      continue;
    }
    if (entry.type !== "RECONCILIATION" || !Array.isArray(entry["items"])) continue;
    for (const item of entry["items"]) {
      if (isRecord(item) && item["kind"] === "entry_order" && item["classification"] === "REVALIDATION_VOID" && typeof item["clientOrderId"] === "string") unresolved.delete(item["clientOrderId"]);
    }
  }
  return [...unresolved].sort();
}

function applyOutcomeToEntry(record: EntryLifecycleRecord, entry: JournalEntry): EntryLifecycleRecord | null {
  const status = entry["status"];
  const filled = entry["filledQuantity"];
  const price = entry["avgFillPriceCents"];
  const brokerOrderId = entry["brokerOrderId"];
  const reasonCodes = entry["reasonCodes"];
  if (!isOutcomeStatus(status) || !isNonnegativeSafeInteger(filled) || (price !== null && !isNonnegativeSafeInteger(price)) || (brokerOrderId !== null && typeof brokerOrderId !== "string")) return null;
  const breach = Array.isArray(reasonCodes) && reasonCodes.includes("BROKER_PRICE_BREACH");
  const state: EntryReservationState = status === "partially_filled" ? "filled" : status;
  return {
    ...record,
    state,
    filledQuantity: integerUnit(filled, "Quantity"),
    avgFillPriceCents: price === null ? null : integerUnit(price, "OptionPriceCents"),
    brokerOrderId,
    priceBreach: record.priceBreach || breach,
  };
}

/**
 * Rebuilds the state of every entry and close lifecycle from the journal:
 * INTENT opens it, OUTCOME moves it into the closed status set, and a
 * RECONCILIATION item for its client order ID resolves an unclear or
 * unsubmitted state (S-CYC-04). An item whose classification lies outside
 * the closed set, or an INTENT whose fields cannot be reconstructed through
 * the unit constructors, fails the fold instead of guessing (RES-P1-01c).
 */
export function foldLifecycles(entries: readonly JournalEntry[]): LifecycleFold {
  const entryRecords = new Map<string, EntryLifecycleRecord>();
  const closeRecords = new Map<string, CloseAttemptRecord>();
  for (const entry of entries) {
    if (entry.type === "INTENT") {
      if (entry["action"] === "close") {
        const record = closeRecordFrom(entry);
        if (record === null) return { ok: false, reason: `close INTENT seq ${String(entry.seq)} cannot be reconstructed` };
        closeRecords.set(record.attemptId, record);
      } else {
        const record = entryRecordFrom(entry);
        if (record === null) return { ok: false, reason: `INTENT seq ${String(entry.seq)} cannot be reconstructed` };
        entryRecords.set(record.clientOrderId, record);
      }
      continue;
    }
    if (entry.type === "OUTCOME") {
      const clientOrderId = entry["clientOrderId"];
      if (typeof clientOrderId !== "string") return { ok: false, reason: `OUTCOME seq ${String(entry.seq)} has no client order ID` };
      const entryRecord = entryRecords.get(clientOrderId);
      if (entryRecord !== undefined) {
        const updated = applyOutcomeToEntry(entryRecord, entry);
        if (updated === null) return { ok: false, reason: `OUTCOME seq ${String(entry.seq)} cannot be applied` };
        entryRecords.set(clientOrderId, updated);
        continue;
      }
      const closeRecord = closeRecords.get(clientOrderId);
      if (closeRecord !== undefined) {
        const status = entry["status"];
        const filled = entry["filledQuantity"];
        if (!isOutcomeStatus(status) || !isNonnegativeSafeInteger(filled)) return { ok: false, reason: `OUTCOME seq ${String(entry.seq)} cannot be applied` };
        closeRecords.set(clientOrderId, { ...closeRecord, status, filledQuantity: integerUnit(filled, "Quantity") });
        continue;
      }
      return { ok: false, reason: `OUTCOME seq ${String(entry.seq)} references no INTENT` };
    }
    if (entry.type === "RECONCILIATION") {
      const items = entry["items"];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (isRecord(item) && item["kind"] === "emergency_close") {
          // S-CYC-06: the first successful append after an emergency close records the attempt the journal never saw coming.
          const attemptId = item["attemptId"];
          const status = item["status"];
          const record = closeRecordFrom({ ...entry, clientOrderId: attemptId, closeLifecycleId: item["closeLifecycleId"], exposureLifecycleId: item["exposureLifecycleId"], route: "emergency", generation: item["generation"], legs: item["legs"], quantity: item["quantity"], submittedLimit: item["submittedLimit"] });
          if (record === null) return { ok: false, reason: `RECONCILIATION seq ${String(entry.seq)} emergency_close item cannot be reconstructed` };
          const filled = item["filledQuantity"];
          closeRecords.set(record.attemptId, { ...record, status: isOutcomeStatus(status) ? status : "submitted", filledQuantity: isNonnegativeSafeInteger(filled) ? integerUnit(filled, "Quantity") : record.filledQuantity });
          continue;
        }
        if (!isRecord(item) || item["kind"] !== "entry_order") continue;
        const clientOrderId = item["clientOrderId"];
        const classification = item["classification"];
        if (typeof clientOrderId !== "string") return { ok: false, reason: `RECONCILIATION seq ${String(entry.seq)} entry_order item has no client order ID` };
        const record = entryRecords.get(clientOrderId);
        if (record === undefined) return { ok: false, reason: `RECONCILIATION seq ${String(entry.seq)} references unknown entry ${clientOrderId}` };
        if (classification === "MATCHED_WORKING") {
          const filled = item["filledQuantity"];
          const price = item["avgFillPriceCents"];
          const brokerOrderId = item["brokerOrderId"];
          entryRecords.set(clientOrderId, {
            ...record,
            state: "fillable",
            filledQuantity: isNonnegativeSafeInteger(filled) ? integerUnit(filled, "Quantity") : record.filledQuantity,
            avgFillPriceCents: isNonnegativeSafeInteger(price) ? integerUnit(price, "OptionPriceCents") : record.avgFillPriceCents,
            brokerOrderId: typeof brokerOrderId === "string" ? brokerOrderId : record.brokerOrderId,
          });
        } else if (classification === "NOT_AT_BROKER") {
          // A negative lookup cannot distinguish a never-sent request from a
          // delayed broker effect after a lost acknowledgement. Keep the
          // reservation and exact-ID reconciliation active until terminal
          // broker truth exists.
          entryRecords.set(clientOrderId, { ...record, state: "confirmation_unclear" });
        } else if (classification === "REVALIDATION_VOID") {
          entryRecords.set(clientOrderId, { ...record, state: "canceled" });
        } else {
          return { ok: false, reason: `RECONCILIATION seq ${String(entry.seq)} carries unknown classification ${String(classification)}` };
        }
      }
    }
  }
  return { ok: true, entries: [...entryRecords.values()], closes: [...closeRecords.values()] };
}

function isReleased(state: EntryReservationState): state is ReleasedEntryState {
  return state === "rejected" || state === "canceled" || state === "expired";
}

/** The exposure lifecycles the core counts (G2–G4, A23), one identity per entry, filled and resting portions split exactly once. */
export function exposureLifecyclesFrom(records: readonly EntryLifecycleRecord[]): { readonly ok: true; readonly lifecycles: readonly ExposureLifecycle[] } | { readonly ok: false; readonly reason: string } {
  const lifecycles: ExposureLifecycle[] = [];
  for (const record of records) {
    const risk: ExposureRiskComponent[] = [];
    const approved = record.candidate.quantity;
    if (isReleased(record.state)) {
      risk.push({ kind: "entry", state: record.state, maxLossCents: record.reservedMaxLossCents });
    } else if (record.state === "intent" || record.state === "confirmation_unclear") {
      risk.push({ kind: "entry", state: record.state, maxLossCents: record.reservedMaxLossCents });
    } else {
      const filledQuantity = integerUnit(Math.min(record.filledQuantity, approved), "Quantity");
      if (filledQuantity > 0) {
        if (record.avgFillPriceCents === null) return { ok: false, reason: `${record.clientOrderId}: filled without a fill price` };
        const filledRisk = definedRiskAt(record.candidate, filledQuantity, record.avgFillPriceCents);
        if (filledRisk === null) return { ok: false, reason: `${record.clientOrderId}: filled risk unavailable` };
        risk.push({ kind: "filled", maxLossCents: filledRisk });
      }
      const remaining = integerUnit(approved - filledQuantity, "Quantity");
      if (record.state === "fillable" && remaining > 0) {
        const remainingRisk = definedRiskAt(record.candidate, remaining, record.candidate.entryLimit.priceCents);
        if (remainingRisk === null) return { ok: false, reason: `${record.clientOrderId}: remaining risk unavailable` };
        risk.push({ kind: "entry", state: "fillable", maxLossCents: remainingRisk });
      }
    }
    lifecycles.push({ exposureLifecycleId: record.exposureLifecycleId, underlying: record.underlying, sleeve: record.sleeve, risk });
  }
  return { ok: true, lifecycles };
}

// ---------------------------------------------------------------------------
// The DecisionSnapshot adapter (RES-P1-01a..d): validated shapes and constructed units only
// ---------------------------------------------------------------------------

export interface MarketObservation {
  /** contractId → { bidCents, askCents, bidSize, askSize, quotedAtMs, brokerQuotedAt } as fetched; validated here. */
  readonly quotesByContract: Readonly<Record<string, unknown>>;
  readonly contractsById: Readonly<Record<string, unknown>>;
  readonly spotCentsByUnderlying: Readonly<Record<string, unknown>>;
}

export interface SnapshotAssembly {
  readonly broker: BrokerBook;
  readonly market: MarketObservation;
  readonly journal: readonly JournalEntry[];
  readonly halt: boolean;
  readonly profile: "dev" | "competition";
  readonly calendar: DecisionSnapshot["calendar"];
  readonly tradingDay: string;
  readonly cycleIndex: number;
}

export type SnapshotAssemblyResult =
  | { readonly ok: true; readonly snapshot: DecisionSnapshot; readonly journalSnapshot: JournalSnapshot; readonly lifecycles: readonly EntryLifecycleRecord[]; readonly closes: readonly CloseAttemptRecord[] }
  | { readonly ok: false; readonly reason: string };

interface ValidatedQuote {
  readonly quote: OptionQuote;
  readonly brokerQuotedAt: string;
}

function validateQuote(value: unknown): ValidatedQuote | null {
  if (!isRecord(value)) return null;
  const bid = value["bidCents"];
  const ask = value["askCents"];
  const bidSize = value["bidSize"];
  const askSize = value["askSize"];
  const quotedAtMs = value["quotedAtMs"];
  const brokerQuotedAt = value["brokerQuotedAt"];
  if (![bid, ask, bidSize, askSize, quotedAtMs].every(isNonnegativeSafeInteger) || typeof brokerQuotedAt !== "string") return null;
  return {
    quote: {
      bidCents: integerUnit(bid as number, "OptionPriceCents"),
      askCents: integerUnit(ask as number, "OptionPriceCents"),
      bidSize: integerUnit(bidSize as number, "Quantity"),
      askSize: integerUnit(askSize as number, "Quantity"),
      quotedAt: integerUnit(quotedAtMs as number, "EpochMilliseconds"),
    },
    brokerQuotedAt,
  };
}

function validateContract(key: string, value: unknown): OptionContract | null {
  if (!isRecord(value)) return null;
  const contractId = value["contractId"];
  const underlying = value["underlying"];
  const expiry = value["expiry"];
  const strikeCents = value["strikeCents"];
  const right = value["right"];
  if (contractId !== key || typeof underlying !== "string" || underlying.length === 0 || typeof expiry !== "string" || !isNonnegativeSafeInteger(strikeCents) || (right !== "call" && right !== "put")) return null;
  return { contractId: key, underlying, expiry, strikeCents: integerUnit(strikeCents, "StrikeCents"), right };
}

function priorQuoteFromSample(sample: JournalQuoteSample): OptionQuote | null {
  const quotedAt = utcIsoToEpochMs(sample.quotedAt);
  if (quotedAt === null || ![sample.bidCents, sample.askCents, sample.bidSize, sample.askSize].every(isNonnegativeSafeInteger)) return null;
  return {
    bidCents: integerUnit(sample.bidCents, "OptionPriceCents"),
    askCents: integerUnit(sample.askCents, "OptionPriceCents"),
    bidSize: integerUnit(sample.bidSize, "Quantity"),
    askSize: integerUnit(sample.askSize, "Quantity"),
    quotedAt,
  };
}

/**
 * Assembles the typed snapshot `decide` trusts. Every contract, quote, spot,
 * broker figure, prior sample, and reconstructed lifecycle is checked here and
 * built through the unit constructors; any shape the core would otherwise
 * throw on — or pass without a veto — is refused before `decide` is reachable.
 */
export function assembleDecisionSnapshot(input: SnapshotAssembly): SnapshotAssemblyResult {
  const contractsById: Record<string, OptionContract> = {};
  for (const [key, value] of Object.entries(input.market.contractsById)) {
    const contract = validateContract(key, value);
    if (contract === null) return { ok: false, reason: `CONTRACT_INVALID:${key}` };
    contractsById[key] = contract;
  }
  const quotesByContract: Record<string, OptionQuote> = {};
  const quoteSamples: Record<string, Record<string, JournalQuoteSample>> = {};
  for (const [key, value] of Object.entries(input.market.quotesByContract)) {
    const validated = validateQuote(value);
    if (validated === null) return { ok: false, reason: `QUOTE_INVALID:${key}` };
    const contract = ownValue(contractsById, key);
    if (contract === undefined) return { ok: false, reason: `QUOTE_FOR_UNKNOWN_CONTRACT:${key}` };
    quotesByContract[key] = validated.quote;
    const sample: JournalQuoteSample = {
      bidCents: validated.quote.bidCents,
      askCents: validated.quote.askCents,
      bidSize: validated.quote.bidSize,
      askSize: validated.quote.askSize,
      quotedAt: epochMsToUtcIso(validated.quote.quotedAt),
      brokerQuotedAt: validated.brokerQuotedAt,
    };
    quoteSamples[contract.underlying] = { ...(quoteSamples[contract.underlying] ?? {}), [key]: sample };
  }
  const spotCentsByUnderlying: Record<string, StrikeCents> = {};
  for (const [underlying, value] of Object.entries(input.market.spotCentsByUnderlying)) {
    if (!isNonnegativeSafeInteger(value)) return { ok: false, reason: `SPOT_INVALID:${underlying}` };
    spotCentsByUnderlying[underlying] = integerUnit(value, "StrikeCents");
  }
  const priorQuotesByUnderlying: Record<string, DecisionSnapshot["priorQuotesByUnderlying"][string]> = {};
  for (const [underlying, sample] of Object.entries(latestQuoteSamples(input.journal))) {
    const observedAt = utcIsoToEpochMs(sample.observedAt);
    if (observedAt === null) return { ok: false, reason: `PRIOR_SAMPLE_INVALID:${underlying}` };
    const priorQuotes: Record<string, OptionQuote> = {};
    for (const [contractId, priorSample] of Object.entries(sample.quotesByContract)) {
      const priorQuote = isRecord(priorSample) ? priorQuoteFromSample(priorSample) : null;
      if (priorQuote === null) return { ok: false, reason: `PRIOR_SAMPLE_INVALID:${underlying}:${contractId}` };
      priorQuotes[contractId] = priorQuote;
    }
    priorQuotesByUnderlying[underlying] = { observedAt, quotesByContract: priorQuotes };
  }
  const broker = input.broker;
  if (!Number.isSafeInteger(broker.cashCents) || !Number.isSafeInteger(broker.equityCents) || broker.equityCents < 0 || broker.cashCents < 0) return { ok: false, reason: "BROKER_MONEY_INVALID" };
  if (typeof broker.accountId !== "string" || broker.accountId.length === 0) return { ok: false, reason: "BROKER_ACCOUNT_ID_INVALID" };
  if (!isNonnegativeSafeInteger(broker.observedAtMs)) return { ok: false, reason: "BROKER_OBSERVED_AT_INVALID" };
  for (const position of broker.positions) {
    if (typeof position.contractId !== "string" || position.contractId.length === 0 || !Number.isSafeInteger(position.quantity) || !isNonnegativeSafeInteger(position.avgEntryPriceCents)) return { ok: false, reason: "BROKER_POSITION_INVALID" };
  }
  const fold = foldLifecycles(input.journal);
  if (!fold.ok) return { ok: false, reason: `LIFECYCLE_FOLD:${fold.reason}` };
  const exposures = exposureLifecyclesFrom(fold.entries);
  if (!exposures.ok) return { ok: false, reason: `LIFECYCLE_RISK:${exposures.reason}` };
  if (!isNonnegativeSafeInteger(input.cycleIndex)) return { ok: false, reason: "CYCLE_INDEX_INVALID" };
  const submittedOrderIds = [...new Set([...fold.entries.map(record => record.clientOrderId), ...broker.openOrders.map(order => order.clientOrderId)])];
  const journalSnapshot: JournalSnapshot = {
    accountId: broker.accountId,
    snapshotAt: epochMsToUtcIso(broker.observedAtMs),
    cashCents: broker.cashCents,
    equityCents: broker.equityCents,
    positions: broker.positions.map(position => ({ contractId: position.contractId, quantity: position.quantity, avgEntryPriceCents: position.avgEntryPriceCents })),
    openOrders: broker.openOrders.map(order => ({ brokerOrderId: order.brokerOrderId, clientOrderId: order.clientOrderId, status: order.status, brokerSubmittedAt: ownValue(order.brokerTimestamps, "submitted_at") ?? "" })),
    quoteSamples,
  };
  const snapshot: DecisionSnapshot = {
    accountId: broker.accountId,
    profile: input.profile,
    cashCents: integerUnit(broker.cashCents, "MoneyCents"),
    equityCents: integerUnit(broker.equityCents, "MoneyCents"),
    exposureLifecycles: exposures.lifecycles,
    halt: input.halt,
    calendar: input.calendar,
    quotesByContract,
    priorQuotesByUnderlying,
    spotCentsByUnderlying,
    contractsById,
    submittedOrderIds,
    tradingDay: input.tradingDay,
    cycleIndex: integerUnit(input.cycleIndex, "Quantity"),
    snapshotAt: integerUnit(broker.observedAtMs, "EpochMilliseconds"),
  };
  return { ok: true, snapshot, journalSnapshot, lifecycles: fold.entries, closes: fold.closes };
}

// ---------------------------------------------------------------------------
// Phase 3 — price every candidate from the decision's quotes, then decide (S-X-01, WIN-11)
// ---------------------------------------------------------------------------

export interface PricedDecision {
  readonly result: DecisionResult;
  readonly pricedCandidates: Readonly<Record<string, EntryCandidate>>;
  readonly unpriceable: readonly { readonly candidateId: string; readonly reason: PricingFailure }[];
}

export function priceAndDecide(snapshot: DecisionSnapshot, batch: AnalystBatch, decision: DecisionConfig, execution: ExecutionConfig, nowMs: number): PricedDecision {
  if (batch.kind !== "candidates") return { result: decide(snapshot, batch, decision, nowMs), pricedCandidates: {}, unpriceable: [] };
  const priced: EntryCandidate[] = [];
  const pricedCandidates: Record<string, EntryCandidate> = {};
  const unpriceable: { candidateId: string; reason: PricingFailure }[] = [];
  for (const candidate of batch.candidates) {
    const pricing = priceEntryLimit(candidate, snapshot.quotesByContract, execution);
    if (pricing.ok) {
      priced.push(pricing.candidate);
      pricedCandidates[candidate.candidateId] = pricing.candidate;
    } else {
      unpriceable.push({ candidateId: candidate.candidateId, reason: pricing.reason });
    }
  }
  return { result: decide(snapshot, { kind: "candidates", candidates: priced }, decision, nowMs), pricedCandidates, unpriceable };
}

// ---------------------------------------------------------------------------
// S-CYC-05 — the typed revalidation claimset, checked against fresh broker truth before submit
// ---------------------------------------------------------------------------

export type RevalidationClaim =
  | { readonly claim: "ACCOUNT_BOUND"; readonly accountId: string }
  | { readonly claim: "EQUITY_ABOVE_KILL_THRESHOLD"; readonly thresholdCents: number }
  | { readonly claim: "POSITIONS_UNCHANGED"; readonly fingerprint: string }
  | { readonly claim: "OPEN_ORDERS_UNCHANGED"; readonly fingerprint: string }
  | { readonly claim: "CONTROL_EPOCH"; readonly epoch: number }
  | { readonly claim: "NOT_HALTED" }
  | { readonly claim: "LIMIT_AND_RESERVE_UNCHANGED"; readonly submittedLimit: EntryActionPlan["submittedLimit"]; readonly reservedMaxLossCents: number }
  | { readonly claim: "GATES_G1_G4_PASS" };

export interface RevalidationClaimset {
  readonly clientOrderId: string;
  readonly candidateId: string;
  readonly claims: readonly RevalidationClaim[];
}

export function positionsFingerprint(positions: readonly BrokerPosition[]): string {
  return positions.filter(position => position.quantity !== 0).map(position => `${position.contractId}:${String(position.quantity)}`).sort().join("|");
}

export function openOrdersFingerprint(orders: readonly BrokerOrderRecord[]): string {
  return orders.map(order => `${order.clientOrderId}:${order.status}:${String(order.filledQuantity)}`).sort().join("|");
}

export function buildClaimset(plan: EntryActionPlan, book: BrokerBook, binding: AccountBinding, epoch: number, config: ExecutionConfig): RevalidationClaimset {
  return {
    clientOrderId: plan.clientOrderId,
    candidateId: plan.candidateId,
    claims: [
      { claim: "ACCOUNT_BOUND", accountId: binding.accountId },
      { claim: "EQUITY_ABOVE_KILL_THRESHOLD", thresholdCents: config.killEquityThresholdCents },
      { claim: "POSITIONS_UNCHANGED", fingerprint: positionsFingerprint(book.positions) },
      { claim: "OPEN_ORDERS_UNCHANGED", fingerprint: openOrdersFingerprint(book.openOrders) },
      { claim: "CONTROL_EPOCH", epoch },
      { claim: "NOT_HALTED" },
      { claim: "LIMIT_AND_RESERVE_UNCHANGED", submittedLimit: plan.submittedLimit, reservedMaxLossCents: plan.reservedMaxLossCents },
      { claim: "GATES_G1_G4_PASS" },
    ],
  };
}

export interface RevalidationEvidence {
  readonly book: BrokerBook;
  readonly brokerReportedAccountId: string | undefined;
  /** The epoch the store holds right now as the gateway reports it, or null when it is unreadable/absent. */
  readonly epoch: number | null;
  readonly halted: boolean;
  /** `decide` re-run on the fresh book with the same priced candidate; G7 may veto (the INTENT is durable), G1–G4 must still pass. */
  readonly recheck: DecisionResult;
}

export type RevalidationVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly violated: readonly RevalidationClaim[]; readonly killTriggered: boolean };

export function killTriggered(equityCents: number, thresholdCents: number): boolean {
  return equityCents < thresholdCents;
}

function claimHolds(claim: RevalidationClaim, claimset: RevalidationClaimset, evidence: RevalidationEvidence): boolean {
  const verdict: CandidateVerdict | undefined = evidence.recheck.candidateVerdicts.find(candidate => candidate.candidateId === claimset.candidateId);
  switch (claim.claim) {
    case "ACCOUNT_BOUND":
      return evidence.brokerReportedAccountId !== undefined && evidence.brokerReportedAccountId.length > 0 && evidence.brokerReportedAccountId === claim.accountId && evidence.book.accountId === claim.accountId;
    case "EQUITY_ABOVE_KILL_THRESHOLD":
      return !killTriggered(evidence.book.equityCents, claim.thresholdCents);
    case "POSITIONS_UNCHANGED":
      return positionsFingerprint(evidence.book.positions) === claim.fingerprint;
    case "OPEN_ORDERS_UNCHANGED":
      return openOrdersFingerprint(evidence.book.openOrders) === claim.fingerprint;
    case "CONTROL_EPOCH":
      return evidence.epoch === claim.epoch;
    case "NOT_HALTED":
      return !evidence.halted;
    case "LIMIT_AND_RESERVE_UNCHANGED":
      return verdict !== undefined && verdict.reservedMaxLossCents === claim.reservedMaxLossCents;
    case "GATES_G1_G4_PASS":
      return verdict !== undefined && verdict.gateVector.filter(gate => gate.gate === "G1" || gate.gate === "G2" || gate.gate === "G3" || gate.gate === "G4").every(gate => gate.passed) && verdict.gateVector.length === 8;
  }
}

/** Any violated claim voids the action; a kill-predicate breach is reported so the same cycle runs S-G13-01 (KGV-5). */
export function revalidateClaimset(claimset: RevalidationClaimset, evidence: RevalidationEvidence): RevalidationVerdict {
  const violated = claimset.claims.filter(claim => !claimHolds(claim, claimset, evidence));
  if (violated.length === 0) return { ok: true };
  return { ok: false, violated, killTriggered: violated.some(claim => claim.claim === "EQUITY_ABOVE_KILL_THRESHOLD") };
}

// ---------------------------------------------------------------------------
// S-CYC-06 — the sole journal-failure exception is a mechanically risk-reducing close
// ---------------------------------------------------------------------------

export interface CloseLegRequest {
  readonly contractId: string;
  readonly side: LegSide;
  readonly quantity: number;
}

export type EmergencyEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: "NO_LEGS" | "QUANTITY_INVALID" | "OPENS_A_LEG" | "EXCEEDS_HELD_QUANTITY" };

/** Every leg must offset a held position of the opposite sign by at most its size; anything else could open risk and is refused. */
export function emergencyCloseEligibility(positions: readonly BrokerPosition[], closeLegs: readonly CloseLegRequest[]): EmergencyEligibility {
  if (closeLegs.length === 0) return { eligible: false, reason: "NO_LEGS" };
  const seen = new Set<string>();
  for (const closeLeg of closeLegs) {
    if (!isNonnegativeSafeInteger(closeLeg.quantity) || closeLeg.quantity < 1 || seen.has(closeLeg.contractId)) return { eligible: false, reason: "QUANTITY_INVALID" };
    seen.add(closeLeg.contractId);
    const held = positions.find(position => position.contractId === closeLeg.contractId);
    if (held === undefined || held.quantity === 0) return { eligible: false, reason: "OPENS_A_LEG" };
    if ((held.quantity > 0 && closeLeg.side !== "sell") || (held.quantity < 0 && closeLeg.side !== "buy")) return { eligible: false, reason: "OPENS_A_LEG" };
    if (closeLeg.quantity > Math.abs(held.quantity)) return { eligible: false, reason: "EXCEEDS_HELD_QUANTITY" };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// G13 — the kill predicate, the kill-management plan, cancel/fill race reconciliation, and flatness
// ---------------------------------------------------------------------------

export type OrderRisk = "risk_increasing" | "risk_reducing";

/** Mechanical, not by label: an order whose every leg offsets a held position reduces risk; anything else can increase it. */
export function classifyWorkingOrder(order: BrokerOrderRecord, positions: readonly BrokerPosition[]): OrderRisk {
  const legs = order.legs.map(optionLeg => ({ contractId: optionLeg.contractId, side: optionLeg.side, quantity: optionLeg.ratio * Math.max(order.quantity - order.filledQuantity, 0) }));
  return emergencyCloseEligibility(positions, legs).eligible ? "risk_reducing" : "risk_increasing";
}

export interface FlattenTarget {
  readonly exposureLifecycleId: string;
  readonly route: "kill";
  readonly closingLegs: readonly OptionLeg[];
  readonly quantity: Quantity;
}

export interface KillPlan {
  /** Working orders that can increase risk: canceled first, races reconciled by broker ID. */
  readonly cancel: readonly string[];
  /** Working orders that already reduce risk: adopted, never canceled or duplicated. */
  readonly adopt: readonly string[];
  /** Whole-structure closes for every journaled lifecycle whose legs are all still held. */
  readonly flatten: readonly FlattenTarget[];
  /** Held contracts no intact lifecycle explains: closed leg by leg at plain limits in P3 (S-X-06 residue policy is P5). */
  readonly residue: readonly BrokerPosition[];
}

export function planKillManagement(book: BrokerBook, lifecycles: readonly EntryLifecycleRecord[]): KillPlan {
  const cancel: string[] = [];
  const adopt: string[] = [];
  for (const order of book.openOrders) {
    if (!isWorkingBrokerStatus(order.status)) continue;
    (classifyWorkingOrder(order, book.positions) === "risk_reducing" ? adopt : cancel).push(order.clientOrderId);
  }
  const remaining = new Map<string, number>();
  for (const position of book.positions) if (position.quantity !== 0) remaining.set(position.contractId, position.quantity);
  const flatten: FlattenTarget[] = [];
  for (const record of lifecycles) {
    if (record.state !== "filled" || record.filledQuantity === 0) continue;
    const intact = record.candidate.legs.every(optionLeg => {
      const held = remaining.get(optionLeg.contractId) ?? 0;
      const needed = optionLeg.ratio * record.filledQuantity;
      return optionLeg.side === "buy" ? held >= needed : held <= -needed;
    });
    if (!intact) continue;
    for (const optionLeg of record.candidate.legs) {
      const held = remaining.get(optionLeg.contractId) ?? 0;
      const needed = optionLeg.ratio * record.filledQuantity;
      remaining.set(optionLeg.contractId, optionLeg.side === "buy" ? held - needed : held + needed);
    }
    flatten.push({ exposureLifecycleId: record.exposureLifecycleId, route: "kill", closingLegs: reversedLegs(record.candidate.legs), quantity: record.filledQuantity });
  }
  const residue = [...remaining.entries()].filter(([, quantity]) => quantity !== 0).map(([contractId, quantity]) => {
    const position = book.positions.find(candidate => candidate.contractId === contractId);
    return { contractId, quantity, avgEntryPriceCents: position?.avgEntryPriceCents ?? 0 };
  });
  return { cancel, adopt, flatten, residue };
}

export type CancelReconciliation = "CANCELED" | "FILLED_DURING_CANCEL" | "PARTIALLY_FILLED_DURING_CANCEL" | "CANCEL_UNCLEAR";

/** After a cancel request the broker record decides: a lost or still-pending cancel leaves fillable exposure (S-G13-01). */
export function reconcileCancel(order: BrokerOrderRecord | null): CancelReconciliation {
  if (order === null || !isTerminalBrokerStatus(order.status)) return "CANCEL_UNCLEAR";
  if (order.status === "filled") return "FILLED_DURING_CANCEL";
  return order.filledQuantity > 0 ? "PARTIALLY_FILLED_DURING_CANCEL" : "CANCELED";
}

/** Flat means broker truth shows zero risk-bearing positions and zero working orders that could increase risk. */
export function isBookFlat(book: BrokerBook): boolean {
  return book.positions.every(position => position.quantity === 0)
    && book.openOrders.every(order => !isWorkingBrokerStatus(order.status) || classifyWorkingOrder(order, book.positions) === "risk_reducing");
}

// ---------------------------------------------------------------------------
// Journal drafts the shell appends verbatim (every field decided here, none invented at the boundary)
// ---------------------------------------------------------------------------

export interface DraftContext {
  readonly atIso: string;
  readonly epoch: number;
}

export function skipDraft(context: DraftContext, reasonCodes: readonly ReasonCode[], snapshot: JournalSnapshot | null): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "SKIP", reasonCodes, snapshot };
}

export interface LifecycleVeto {
  readonly candidateId: string;
  /**
   * S-G9-01 (`EXPIRY`) and S-G11-01/02 (`DEADLINE`): entry vetoes decided by the P5 lifecycle core after the gate vector;
   * S-CYC-12 (`QUALIFICATION_*`): the P6 qualification window's one-lot, cap, and one-live vetoes, after both.
   */
  readonly code: "EXPIRY" | "DEADLINE" | "QUALIFICATION_CAP" | "QUALIFICATION_ONE_LOT" | "QUALIFICATION_ONE_LIVE";
  readonly reason: string;
}

export interface CycleDraftInput {
  readonly cycleIndex: number;
  readonly tradingDay: string;
  readonly journalSnapshot: JournalSnapshot;
  readonly decision: PricedDecision;
  /** Why the analyst produced no batch this cycle (timeout, error, 429), or null when it answered (S-CYC-01). */
  readonly analystSkip: string | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly lifecycleVetoes?: readonly LifecycleVeto[];
}

export function cycleDraft(context: DraftContext, input: CycleDraftInput): JournalDraft {
  const batchVerdicts: unknown[] = [...input.decision.result.batchVerdicts];
  if (input.analystSkip !== null) batchVerdicts.push({ code: "ANALYST_SKIP", reason: input.analystSkip });
  const candidateVerdicts: unknown[] = [
    ...input.decision.result.candidateVerdicts,
    ...input.decision.unpriceable.map(item => ({ candidateId: item.candidateId, decision: "VETO", pricing: item.reason })),
    ...(input.lifecycleVetoes ?? []).map(item => ({ candidateId: item.candidateId, decision: "VETO", code: item.code, reason: item.reason })),
  ];
  return {
    at: context.atIso,
    epoch: context.epoch,
    type: "CYCLE",
    cycleIndex: input.cycleIndex,
    tradingDay: input.tradingDay,
    reasonCodes: input.reasonCodes,
    snapshot: input.journalSnapshot,
    batchVerdicts,
    candidateVerdicts,
  };
}

function quoteReference(contractId: string, optionQuote: OptionQuote): string {
  return `quote:${contractId}:bid=${String(optionQuote.bidCents)},ask=${String(optionQuote.askCents)}@${epochMsToUtcIso(optionQuote.quotedAt)}`;
}

/** The entry INTENT of S-J-04: the plan, its gate vector, and a rationale that names its snapshot data, paid-from sleeve, underlying and structure. */
export function intentDraft(context: DraftContext, plan: EntryActionPlan, candidate: EntryCandidate, verdict: CandidateVerdict, snapshot: DecisionSnapshot, binding: AccountBinding): JournalDraft {
  const references = candidate.legs.map(optionLeg => {
    const optionQuote = ownValue(snapshot.quotesByContract, optionLeg.contractId);
    return optionQuote === undefined ? `quote:${optionLeg.contractId}:absent` : quoteReference(optionLeg.contractId, optionQuote);
  });
  return {
    at: context.atIso,
    epoch: context.epoch,
    type: "INTENT",
    action: "entry",
    clientOrderId: plan.clientOrderId,
    exposureLifecycleId: plan.exposureLifecycleId,
    sleeve: plan.sleeve,
    structureType: candidate.declaredStructureType,
    legs: plan.legs.map(optionLeg => ({ ...optionLeg })),
    quantity: plan.quantity,
    submittedLimit: { kind: plan.submittedLimit.kind, priceCents: plan.submittedLimit.priceCents },
    reservedMaxLossCents: plan.reservedMaxLossCents,
    gateVector: verdict.gateVector.map(gate => ({ gate: gate.gate, passed: gate.passed, code: gate.code, reasons: [...gate.reasons] })),
    rationale: {
      paidFrom: plan.sleeve === "income" ? "income_drift" : "convex_tail",
      snapshotReferences: references,
      text: `${candidate.rationale} [${plan.underlying} ${candidate.declaredStructureType} ${plan.clientOrderId}]`,
    },
    binding: { ...binding },
  };
}

export interface CloseIntentInput {
  readonly exposureLifecycleId: string;
  readonly route: CloseRouteLabel;
  readonly generation: Quantity;
  readonly closingLegs: readonly OptionLeg[];
  readonly quantity: Quantity;
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: OptionPriceCents };
  readonly reason: string;
}

export function closeIntentDraft(context: DraftContext, input: CloseIntentInput, binding: AccountBinding): JournalDraft {
  const lifecycleId = closeLifecycleId(input.exposureLifecycleId, input.route);
  return {
    at: context.atIso,
    epoch: context.epoch,
    type: "INTENT",
    action: "close",
    clientOrderId: closeAttemptId(lifecycleId, input.generation),
    exposureLifecycleId: input.exposureLifecycleId,
    closeLifecycleId: lifecycleId,
    route: input.route,
    generation: input.generation,
    legs: input.closingLegs.map(optionLeg => ({ ...optionLeg })),
    quantity: input.quantity,
    submittedLimit: { kind: input.limit.kind, priceCents: input.limit.priceCents },
    reason: input.reason,
    binding: { ...binding },
  };
}

export function revalidationVoidDraft(context: DraftContext, claimset: RevalidationClaimset, violated: readonly RevalidationClaim[]): JournalDraft {
  return {
    at: context.atIso,
    epoch: context.epoch,
    type: "RECONCILIATION",
    reasonCodes: ["REVALIDATION_VOID"],
    items: [{ kind: "entry_order", clientOrderId: claimset.clientOrderId, classification: "REVALIDATION_VOID", claimset: claimset.claims, violated }],
  };
}

export function entryResolutionDraft(context: DraftContext, clientOrderId: string, order: BrokerOrderRecord | null): JournalDraft {
  return order === null
    ? { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: ["NOT_SUBMITTED"], items: [{ kind: "entry_order", clientOrderId, classification: "NOT_AT_BROKER" }] }
    : { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: [], items: [{ kind: "entry_order", clientOrderId, classification: "MATCHED_WORKING", brokerOrderId: order.brokerOrderId, status: order.status, filledQuantity: order.filledQuantity, avgFillPriceCents: order.avgFillPriceCents }] };
}

export type RunnerHaltReason =
  | "KILL" | "BROKER_PRICE_BREACH" | "AUTH_FAILURE" | "CONFIG_INVALID"
  | "GAP" | "RESIDUE_UNRESOLVED" | "PROVENANCE_BROKEN" | "WATCHDOG_TAKEOVER" | "DEADLINE_FLATTEN_FAILED"
  | "EXPIRY_EVICTION_STUCK" | "CLOSE_LADDER_CAPPED";

/**
 * A kill halt is sticky (S-G13-03), and so is a broken competition provenance
 * (S-CYC-09: un-halt cannot clear it). The other reasons block new entries
 * pending reconciliation and a manual un-halt: a price breach (S-X-02), a
 * credential fence (S-G12-06 — re-arm only under halt after full
 * reconciliation), an invalid configuration (S-CYC-11), an unexplained book
 * (G10), a journal gap over a foreign book (S-CYC-09), a watchdog takeover
 * (S-G14-02), and a failed Thursday flatten assertion (S-G11-01).
 */
export function haltDraft(context: DraftContext, reason: RunnerHaltReason, detail: string): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "HALT", reason, detail, sticky: reason === "KILL" || reason === "PROVENANCE_BROKEN" };
}

export function killDraft(context: DraftContext, equityCents: number, thresholdCents: number): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "KILL", equityCents, thresholdCents };
}

export function auditGapDraft(context: DraftContext, items: readonly Readonly<Record<string, unknown>>[]): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: ["AUDIT_GAP_EMERGENCY_CLOSE"], items: [...items] };
}

export function cancelReconciliationDraft(context: DraftContext, items: readonly Readonly<Record<string, unknown>>[]): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: [], items: [...items] };
}
