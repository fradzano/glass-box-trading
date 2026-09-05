// Pure journal core: closed entry schemas (S-J-03/04), the line codec with
// torn-tail detection (S-J-01), UTC timestamp discipline (S-J-02), secret
// redaction (S-J-05), the halt transition (S-G12-03..05), and the journal
// folds the shell needs (prior quote samples, staleness clock). No I/O, no
// clock: timestamps arrive as strings the shell formatted and are validated
// here; `seq` is assigned by `planAppend` from the tail the shell read.
//
// The closed sets are functions returning fresh literals: the architecture
// gate forbids module-scope non-primitive state in src/core/**, and a fresh
// array per call is the honest way to have no shared mutable object at all.

export type JournalEntryType =
  | "CYCLE" | "BOOTSTRAP" | "INTENT" | "OUTCOME" | "RECONCILIATION" | "HUMAN_ACTION" | "GAP" | "SKIP"
  | "SUPPRESSED" | "FENCED_OUT" | "HALT" | "UNHALT" | "KILL" | "DEADLINE_RECONCILIATION" | "TERMINAL"
  | "MANAGEMENT_REFUSAL";

export function journalEntryTypes(): readonly JournalEntryType[] {
  return [
    "CYCLE", "BOOTSTRAP", "INTENT", "OUTCOME", "RECONCILIATION", "HUMAN_ACTION", "GAP", "SKIP",
    "SUPPRESSED", "FENCED_OUT", "HALT", "UNHALT", "KILL", "DEADLINE_RECONCILIATION", "TERMINAL",
    "MANAGEMENT_REFUSAL",
  ];
}

export type WitnessEntryType = "SUPPRESSED" | "FENCED_OUT";

/**
 * The witness class (authority-free, staleness-neutral, no success ping) is
 * defined here and nowhere else (S-G12-07, KGV-1-REG). The gateway and the
 * staleness fold derive from this function.
 */
export function witnessEntryTypes(): readonly WitnessEntryType[] {
  return ["SUPPRESSED", "FENCED_OUT"];
}

/** Primary entries: exactly one per scheduled invocation, CYCLE or its substitute (S-J-03, KGV-11). */
export function primaryEntryTypes(): readonly JournalEntryType[] {
  return ["CYCLE", "BOOTSTRAP", "GAP", "SKIP", "SUPPRESSED", "FENCED_OUT"];
}

export type ReasonCode =
  | "WORLD_UNREACHABLE" | "WORLD_PARTIAL" | "STALE_SNAPSHOT" | "AUTH_FAILURE" | "REVALIDATION_VOID" | "SCHEMA_VETO" | "NOT_SUBMITTED"
  | "CONFIG_INVALID" | "CONFIG_INVALID_STATE_DIR" | "PROVENANCE_BROKEN" | "AUDIT_GAP_EMERGENCY_CLOSE" | "DECLARED_EXPIRY_HOLD"
  | "COMPETITIVENESS_AT_RISK" | "WINNING_ACCEPTANCE_FAILED" | "BROKER_PRICE_BREACH";

export function reasonCodes(): readonly ReasonCode[] {
  return [
    "WORLD_UNREACHABLE", "WORLD_PARTIAL", "STALE_SNAPSHOT", "AUTH_FAILURE", "REVALIDATION_VOID", "SCHEMA_VETO", "NOT_SUBMITTED",
    "CONFIG_INVALID", "CONFIG_INVALID_STATE_DIR", "PROVENANCE_BROKEN", "AUDIT_GAP_EMERGENCY_CLOSE", "DECLARED_EXPIRY_HOLD",
    "COMPETITIVENESS_AT_RISK", "WINNING_ACCEPTANCE_FAILED", "BROKER_PRICE_BREACH",
  ];
}

export type OutcomeStatus = "filled" | "partially_filled" | "rejected" | "canceled" | "expired" | "confirmation_unclear";

export function outcomeStatuses(): readonly OutcomeStatus[] {
  return ["filled", "partially_filled", "rejected", "canceled", "expired", "confirmation_unclear"];
}

export type HaltReason =
  | "MANUAL" | "GAP" | "EPOCH_STORE_RESET" | "ACCOUNT_BINDING_MISMATCH" | "KILL" | "AUTH_FAILURE" | "PROVENANCE_BROKEN"
  | "RESIDUE_UNRESOLVED" | "CONFIG_INVALID" | "BROKER_PRICE_BREACH" | "WATCHDOG_TAKEOVER" | "DEADLINE_FLATTEN_FAILED"
  | "EXPIRY_EVICTION_STUCK" | "CLOSE_LADDER_CAPPED";

/**
 * Which halt reasons are irreversible. A sticky halt is not cleared by the
 * ordinary manual release; it needs the deployment to be reconciled and
 * re-certified. The rule lives here because three places used to restate it:
 * `haltDraft` when it builds an entry, the gateway when it maps a durable
 * mark, and the manual release when it decides whether it may proceed.
 */
export function haltIsSticky(reason: string): boolean {
  return reason === "KILL" || reason === "PROVENANCE_BROKEN";
}

/**
 * The stronger of two stops, for the merge of journal, projection and durable
 * mark. A gate executed what a missing merge costs: an `AUTH_FAILURE` halt was
 * journaled and marked, a `KILL` was then requested and its append failed, and
 * because the mark was already set and the journal knew only the soft halt,
 * an ordinary manual release cleared both. Strength, not order of arrival,
 * decides -- sticky outranks non-sticky, and a halt outranks no halt.
 */
export function strongerHalt(left: HaltState, right: HaltState): HaltState {
  if (!left.halted) return right;
  if (!right.halted) return left;
  if (left.sticky && !right.sticky) return left;
  if (right.sticky && !left.sticky) return right;
  return left;
}

export function haltReasons(): readonly HaltReason[] {
  return [
    "MANUAL", "GAP", "EPOCH_STORE_RESET", "ACCOUNT_BINDING_MISMATCH", "KILL", "AUTH_FAILURE", "PROVENANCE_BROKEN",
    "RESIDUE_UNRESOLVED", "CONFIG_INVALID", "BROKER_PRICE_BREACH", "WATCHDOG_TAKEOVER", "DEADLINE_FLATTEN_FAILED",
    "EXPIRY_EVICTION_STUCK", "CLOSE_LADDER_CAPPED",
  ];
}

export type SuppressionReason = "LOCK_HELD" | "EPOCH_UNREADABLE" | "EPOCH_CHANGED";

export function suppressionReasons(): readonly SuppressionReason[] {
  return ["LOCK_HELD", "EPOCH_UNREADABLE", "EPOCH_CHANGED"];
}

export type RequestClass = "authoritative" | "witness";

export interface JournalQuoteSample {
  readonly bidCents: number;
  readonly askCents: number;
  readonly bidSize: number;
  readonly askSize: number;
  readonly quotedAt: string;
  readonly brokerQuotedAt: string;
}

export interface JournalSnapshot {
  readonly accountId: string;
  readonly snapshotAt: string;
  readonly cashCents: number;
  readonly equityCents: number;
  readonly positions: readonly { readonly contractId: string; readonly quantity: number; readonly avgEntryPriceCents: number }[];
  readonly openOrders: readonly { readonly brokerOrderId: string; readonly clientOrderId: string; readonly status: string; readonly brokerSubmittedAt: string }[];
  readonly quoteSamples: Readonly<Record<string, Readonly<Record<string, JournalQuoteSample>>>>;
}

export interface AccountBinding {
  readonly profile: string;
  readonly tradingOrigin: string;
  readonly accountId: string;
}

export interface JournalEnvelope {
  readonly seq: number;
  readonly at: string;
  readonly epoch: number | null;
  readonly type: JournalEntryType;
  readonly corrects?: number;
}

/** A validated entry. Type-specific fields are reachable after narrowing on `type`; the schema table below is the authority. */
export type JournalEntry = JournalEnvelope & Readonly<Record<string, unknown>>;
export type JournalDraft = Omit<JournalEntry, "seq">;

export interface HaltState {
  readonly halted: boolean;
  readonly reason: string | null;
  readonly sticky: boolean;
}

export function notHalted(): HaltState {
  return { halted: false, reason: null, sticky: false };
}

export type Validation<T> = { readonly ok: true; readonly entry: T } | { readonly ok: false; readonly reason: string };

export function isWitnessEntryType(type: string): type is WitnessEntryType {
  return (witnessEntryTypes() as readonly string[]).includes(type);
}

export function isPrimaryEntryType(type: string): boolean {
  return (primaryEntryTypes() as readonly string[]).includes(type);
}

export function requestClassOf(type: JournalEntryType): RequestClass {
  return isWitnessEntryType(type) ? "witness" : "authoritative";
}

function isJournalEntryType(value: unknown): value is JournalEntryType {
  return typeof value === "string" && (journalEntryTypes() as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plain records only: an inherited enumerable key would reach the schema without being an own property. */
function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  for (const key in value) if (!Object.hasOwn(value, key)) return false;
  return true;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function digitsAt(text: string, start: number, count: number): number | null {
  if (start + count > text.length) return null;
  let value = 0;
  for (let index = start; index < start + count; index += 1) {
    const code = text.charCodeAt(index);
    if (!isDigit(code)) return null;
    value = value * 10 + (code - 0x30);
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** `YYYY-MM-DDTHH:MM:SS(.fff)?Z` — UTC only, calendar-valid, at most millisecond precision (S-J-02). */
export function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const year = digitsAt(value, 0, 4);
  const month = digitsAt(value, 5, 2);
  const day = digitsAt(value, 8, 2);
  const hour = digitsAt(value, 11, 2);
  const minute = digitsAt(value, 14, 2);
  const second = digitsAt(value, 17, 2);
  if (year === null || month === null || day === null || hour === null || minute === null || second === null) return false;
  if (value.charAt(4) !== "-" || value.charAt(7) !== "-" || value.charAt(10) !== "T" || value.charAt(13) !== ":" || value.charAt(16) !== ":") return false;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) return false;
  let cursor = 19;
  if (value.charAt(cursor) === ".") {
    const fraction = digitsAt(value, cursor + 1, 3);
    if (fraction === null) return false;
    cursor += 4;
  }
  return value.charAt(cursor) === "Z" && value.length === cursor + 1;
}

function hasExactKeys(record: Readonly<Record<string, unknown>>, required: readonly string[], optional: readonly string[] = []): string | null {
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) return "UNEXPECTED_KEY";
  }
  for (const key of required) if (!keys.includes(key)) return `MISSING_KEY:${key}`;
  return null;
}

function validateQuoteSample(value: unknown): boolean {
  if (!isPlainRecord(value) || hasExactKeys(value, ["bidCents", "askCents", "bidSize", "askSize", "quotedAt", "brokerQuotedAt"]) !== null) return false;
  return isNonnegativeInteger(value["bidCents"]) && isNonnegativeInteger(value["askCents"]) && isNonnegativeInteger(value["bidSize"]) && isNonnegativeInteger(value["askSize"])
    && isUtcIsoTimestamp(value["quotedAt"]) && typeof value["brokerQuotedAt"] === "string";
}

function validateSnapshot(value: unknown): string | null {
  if (!isPlainRecord(value)) return "SNAPSHOT_INVALID";
  const keyIssue = hasExactKeys(value, ["accountId", "snapshotAt", "cashCents", "equityCents", "positions", "openOrders", "quoteSamples"]);
  if (keyIssue !== null) return `SNAPSHOT_${keyIssue}`;
  if (!isNonEmptyString(value["accountId"])) return "SNAPSHOT_ACCOUNT_ID_INVALID";
  if (!isUtcIsoTimestamp(value["snapshotAt"])) return "SNAPSHOT_AT_NOT_UTC_ISO";
  if (!isSafeInteger(value["cashCents"]) || !isSafeInteger(value["equityCents"])) return "SNAPSHOT_MONEY_NOT_INTEGER";
  const positions = value["positions"];
  if (!Array.isArray(positions) || !positions.every(position => isPlainRecord(position)
    && hasExactKeys(position, ["contractId", "quantity", "avgEntryPriceCents"]) === null
    && isNonEmptyString(position["contractId"]) && isSafeInteger(position["quantity"]) && isNonnegativeInteger(position["avgEntryPriceCents"]))) return "SNAPSHOT_POSITIONS_INVALID";
  const openOrders = value["openOrders"];
  if (!Array.isArray(openOrders) || !openOrders.every(order => isPlainRecord(order)
    && hasExactKeys(order, ["brokerOrderId", "clientOrderId", "status", "brokerSubmittedAt"]) === null
    && typeof order["brokerOrderId"] === "string" && typeof order["clientOrderId"] === "string" && typeof order["status"] === "string" && typeof order["brokerSubmittedAt"] === "string")) return "SNAPSHOT_OPEN_ORDERS_INVALID";
  const samples = value["quoteSamples"];
  if (!isPlainRecord(samples)) return "SNAPSHOT_QUOTE_SAMPLES_INVALID";
  for (const byContract of Object.values(samples)) {
    if (!isPlainRecord(byContract)) return "SNAPSHOT_QUOTE_SAMPLES_INVALID";
    for (const sample of Object.values(byContract)) if (!validateQuoteSample(sample)) return "SNAPSHOT_QUOTE_SAMPLES_INVALID";
  }
  return null;
}

function validateReasonCodes(value: unknown): string | null {
  if (!Array.isArray(value)) return "REASON_CODES_INVALID";
  const known: readonly string[] = reasonCodes();
  for (const code of value) if (typeof code !== "string" || !known.includes(code)) return "UNKNOWN_REASON_CODE";
  return null;
}

function validateBinding(value: unknown): string | null {
  if (!isPlainRecord(value) || hasExactKeys(value, ["profile", "tradingOrigin", "accountId"]) !== null) return "BINDING_INVALID";
  if (!isNonEmptyString(value["profile"]) || !isNonEmptyString(value["tradingOrigin"]) || !isNonEmptyString(value["accountId"])) return "BINDING_INVALID";
  return null;
}

function validateLeg(value: unknown): boolean {
  return isPlainRecord(value) && hasExactKeys(value, ["contractId", "underlying", "expiry", "strikeCents", "right", "side", "ratio"]) === null
    && isNonEmptyString(value["contractId"]) && isNonEmptyString(value["underlying"]) && isNonEmptyString(value["expiry"])
    && isNonnegativeInteger(value["strikeCents"]) && (value["right"] === "call" || value["right"] === "put")
    && (value["side"] === "buy" || value["side"] === "sell") && isPositiveInteger(value["ratio"]);
}

function validateGateVector(value: unknown): string | null {
  if (!Array.isArray(value)) return "GATE_VECTOR_INVALID";
  if (value.length !== 8) return "GATE_VECTOR_INCOMPLETE";
  for (const [index, verdict] of value.entries()) {
    if (!isPlainRecord(verdict) || hasExactKeys(verdict, ["gate", "passed", "code", "reasons"]) !== null) return "GATE_VECTOR_INVALID";
    if (verdict["gate"] !== `G${String(index + 1)}` || typeof verdict["passed"] !== "boolean" || !isNonEmptyString(verdict["code"]) || !isStringArray(verdict["reasons"])) return "GATE_VECTOR_INVALID";
  }
  return null;
}

function validateRationale(value: unknown, legs: readonly Readonly<Record<string, unknown>>[], structureType: string): string | null {
  if (!isPlainRecord(value) || hasExactKeys(value, ["paidFrom", "snapshotReferences", "text"]) !== null) return "RATIONALE_INVALID";
  if (value["paidFrom"] !== "income_drift" && value["paidFrom"] !== "convex_tail") return "RATIONALE_PAID_FROM_INVALID";
  const references = value["snapshotReferences"];
  if (!isStringArray(references) || references.length === 0 || references.some(reference => reference.length === 0)) return "RATIONALE_WITHOUT_SNAPSHOT_REFERENCE";
  const text = value["text"];
  if (!isNonEmptyString(text)) return "RATIONALE_INVALID";
  const underlyings = new Set(legs.map(leg => String(leg["underlying"])));
  for (const underlying of underlyings) if (!text.includes(underlying)) return "RATIONALE_NOT_CANDIDATE_SPECIFIC";
  if (!text.includes(structureType)) return "RATIONALE_NOT_CANDIDATE_SPECIFIC";
  return null;
}

function validateVerdictList(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => isPlainRecord(item));
}



interface EntrySchema {
  readonly required: readonly string[];
  /** Keys that may be present; absent keys are not defaulted. */
  readonly optional?: readonly string[];
  readonly check: (body: Readonly<Record<string, unknown>>) => string | null;
}

export type CloseRouteLabel = "ordinary" | "emergency" | "expiry" | "kill" | "watchdog" | "residue" | "deadline";

export function closeRouteLabels(): readonly CloseRouteLabel[] {
  return ["ordinary", "emergency", "expiry", "kill", "watchdog", "residue", "deadline"];
}

/**
 * A close INTENT (A5: every ordinary close has a durable intent before
 * submission) is the INTENT type with `action: "close"`. It names the
 * exposure it reduces, its route-independent close lifecycle and attempt
 * generation (S-G7-01), the closing legs, the submitted limit, and a reason;
 * it reserves nothing (S-G2-07) and carries no entry gate vector.
 */
function closeIntentSchema(): EntrySchema {
  return {
    required: ["action", "clientOrderId", "exposureLifecycleId", "closeLifecycleId", "route", "generation", "legs", "quantity", "submittedLimit", "reason", "binding"],
    check: body => {
      if (!isNonEmptyString(body["clientOrderId"]) || !isNonEmptyString(body["exposureLifecycleId"]) || !isNonEmptyString(body["closeLifecycleId"])) return "INTENT_IDENTITY_INVALID";
      if (typeof body["route"] !== "string" || !(closeRouteLabels() as readonly string[]).includes(body["route"])) return "INTENT_ROUTE_INVALID";
      if (!isNonnegativeInteger(body["generation"])) return "INTENT_GENERATION_INVALID";
      const legs = body["legs"];
      if (!Array.isArray(legs) || legs.length === 0 || !legs.every(validateLeg)) return "INTENT_LEGS_INVALID";
      if (!isPositiveInteger(body["quantity"])) return "INTENT_QUANTITY_INVALID";
      const limit = body["submittedLimit"];
      if (!isPlainRecord(limit) || hasExactKeys(limit, ["kind", "priceCents"]) !== null || (limit["kind"] !== "debit" && limit["kind"] !== "credit") || !isNonnegativeInteger(limit["priceCents"])) return "INTENT_LIMIT_INVALID";
      if (!isNonEmptyString(body["reason"])) return "INTENT_REASON_INVALID";
      return validateBinding(body["binding"]);
    },
  };
}

function snapshotBearing(body: Readonly<Record<string, unknown>>): string | null {
  return validateReasonCodes(body["reasonCodes"]) ?? validateSnapshot(body["snapshot"]);
}

function optionalSnapshotBearing(body: Readonly<Record<string, unknown>>): string | null {
  return validateReasonCodes(body["reasonCodes"]) ?? (body["snapshot"] === null ? null : validateSnapshot(body["snapshot"]));
}

function schemaFor(type: JournalEntryType, body: Readonly<Record<string, unknown>>): EntrySchema {
  if (type === "INTENT" && body["action"] === "close") return closeIntentSchema();
  switch (type) {
    case "CYCLE":
      return {
        required: ["cycleIndex", "tradingDay", "reasonCodes", "snapshot", "batchVerdicts", "candidateVerdicts"],
        check: body => {
          if (!isNonnegativeInteger(body["cycleIndex"]) || !isNonEmptyString(body["tradingDay"])) return "CYCLE_INVALID";
          if (!validateVerdictList(body["batchVerdicts"]) || !validateVerdictList(body["candidateVerdicts"])) return "CYCLE_VERDICTS_INVALID";
          return snapshotBearing(body);
        },
      };
    case "BOOTSTRAP":
      return {
        required: ["snapshot", "epochSeeded"],
        check: body => typeof body["epochSeeded"] === "boolean" ? validateSnapshot(body["snapshot"]) : "BOOTSTRAP_INVALID",
      };
    case "INTENT":
      return {
        required: ["clientOrderId", "exposureLifecycleId", "sleeve", "structureType", "legs", "quantity", "submittedLimit", "reservedMaxLossCents", "gateVector", "rationale", "binding"],
        // An entry INTENT may say so explicitly; any other action label is refused (the close variant is selected above).
        optional: ["action"],
        check: body => {
          if (Object.hasOwn(body, "action") && body["action"] !== "entry") return "INTENT_ACTION_INVALID";
          if (!isNonEmptyString(body["clientOrderId"]) || !isNonEmptyString(body["exposureLifecycleId"])) return "INTENT_IDENTITY_INVALID";
          if (body["sleeve"] !== "income" && body["sleeve"] !== "convex") return "INTENT_SLEEVE_INVALID";
          const structureType = body["structureType"];
          if (!isNonEmptyString(structureType)) return "INTENT_STRUCTURE_INVALID";
          const legs = body["legs"];
          if (!Array.isArray(legs) || legs.length === 0 || !legs.every(validateLeg)) return "INTENT_LEGS_INVALID";
          if (!isPositiveInteger(body["quantity"])) return "INTENT_QUANTITY_INVALID";
          const limit = body["submittedLimit"];
          if (!isPlainRecord(limit) || hasExactKeys(limit, ["kind", "priceCents"]) !== null || (limit["kind"] !== "debit" && limit["kind"] !== "credit") || !isNonnegativeInteger(limit["priceCents"])) return "INTENT_LIMIT_INVALID";
          if (!isNonnegativeInteger(body["reservedMaxLossCents"])) return "INTENT_RESERVED_MAX_LOSS_INVALID";
          return validateGateVector(body["gateVector"]) ?? validateRationale(body["rationale"], legs as readonly Readonly<Record<string, unknown>>[], structureType) ?? validateBinding(body["binding"]);
        },
      };
    case "OUTCOME":
      return {
        required: ["clientOrderId", "status", "brokerOrderId", "brokerTimestamps", "filledQuantity", "avgFillPriceCents", "reasonCodes", "binding"],
        // S-X-03: a rejection carries the broker's reason verbatim; other statuses may carry one or null.
        optional: ["brokerReason", "avgFillPriceRaw"],
        check: body => {
          if (!isNonEmptyString(body["clientOrderId"])) return "OUTCOME_IDENTITY_INVALID";
          const status = body["status"];
          if (typeof status !== "string" || !(outcomeStatuses() as readonly string[]).includes(status)) return "UNKNOWN_OUTCOME_STATUS";
          if (body["brokerOrderId"] !== null && typeof body["brokerOrderId"] !== "string") return "OUTCOME_BROKER_ID_INVALID";
          const timestamps = body["brokerTimestamps"];
          if (!isPlainRecord(timestamps) || !Object.values(timestamps).every(stamp => typeof stamp === "string")) return "OUTCOME_BROKER_TIMESTAMPS_INVALID";
          const filled = body["filledQuantity"];
          const price = body["avgFillPriceCents"];
          if (!isNonnegativeInteger(filled) || (price !== null && !isNonnegativeInteger(price))) return "OUTCOME_FILL_INVALID";
          const rawPrice = body["avgFillPriceRaw"];
          if (Object.hasOwn(body, "avgFillPriceRaw") && rawPrice !== null && (typeof rawPrice !== "string" || !/^-?\d+(?:\.\d+)?$/.test(rawPrice.trim()))) return "OUTCOME_FILL_INVALID";
          if (price === null && rawPrice !== null && rawPrice !== undefined) return "OUTCOME_FILL_INVALID";
          if (price !== null && typeof rawPrice !== "string") return "OUTCOME_FILL_INVALID";
          if (status === "rejected" && (filled !== 0 || price !== null)) return "REJECTION_CARRIES_FILL";
          if ((status === "filled" || status === "partially_filled") && filled === 0) return "OUTCOME_FILL_INVALID";
          const brokerReason = body["brokerReason"];
          if (Object.hasOwn(body, "brokerReason") && brokerReason !== null && typeof brokerReason !== "string") return "OUTCOME_BROKER_REASON_INVALID";
          if (status === "rejected" && !isNonEmptyString(brokerReason)) return "REJECTION_WITHOUT_BROKER_REASON";
          return validateReasonCodes(body["reasonCodes"]) ?? validateBinding(body["binding"]);
        },
      };
    case "RECONCILIATION":
      return {
        required: ["reasonCodes", "items"],
        check: body => validateReasonCodes(body["reasonCodes"]) ?? (Array.isArray(body["items"]) && body["items"].every(item => isPlainRecord(item)) ? null : "RECONCILIATION_ITEMS_INVALID"),
      };
    // S-X-08: a close the management step planned and did not submit. Closed
    // like every other shape — an exposure identity, a known close route, a
    // non-negative generation or `null` when the plan itself was vetoed, and a
    // non-empty reason.
    case "MANAGEMENT_REFUSAL":
      return {
        required: ["exposureLifecycleId", "route", "generation", "reason"],
        check: body => {
          if (!isNonEmptyString(body["exposureLifecycleId"]) || !isNonEmptyString(body["reason"])) return "MANAGEMENT_REFUSAL_INVALID";
          if (typeof body["route"] !== "string" || !(closeRouteLabels() as readonly string[]).includes(body["route"])) return "MANAGEMENT_REFUSAL_ROUTE_INVALID";
          const generation = body["generation"];
          return generation === null || isNonnegativeInteger(generation) ? null : "MANAGEMENT_REFUSAL_INVALID";
        },
      };
    case "HUMAN_ACTION":
      return {
        required: ["operator", "description"],
        check: body => isNonEmptyString(body["operator"]) && typeof body["description"] === "string" ? null : "HUMAN_ACTION_INVALID",
      };
    case "GAP":
      return {
        required: ["reasonCodes", "snapshot", "detail"],
        check: body => typeof body["detail"] === "string" ? optionalSnapshotBearing(body) : "GAP_INVALID",
      };
    case "SKIP":
      return { required: ["reasonCodes", "snapshot"], check: optionalSnapshotBearing };
    case "SUPPRESSED":
      return {
        required: ["instanceId", "holderId", "reason"],
        check: body => isNonEmptyString(body["instanceId"]) && typeof body["holderId"] === "string" && typeof body["reason"] === "string" && (suppressionReasons() as readonly string[]).includes(body["reason"]) ? null : "SUPPRESSED_INVALID",
      };
    case "FENCED_OUT":
      return {
        required: ["instanceId", "staleEpoch", "observedEpoch"],
        check: body => isNonEmptyString(body["instanceId"]) && isPositiveInteger(body["staleEpoch"]) && (body["observedEpoch"] === null || isPositiveInteger(body["observedEpoch"])) ? null : "FENCED_OUT_INVALID",
      };
    case "HALT":
      return {
        required: ["reason", "detail", "sticky"],
        check: body => typeof body["reason"] === "string" && (haltReasons() as readonly string[]).includes(body["reason"]) && typeof body["detail"] === "string" && typeof body["sticky"] === "boolean" ? null : "HALT_INVALID",
      };
    case "UNHALT":
      return {
        required: ["operator", "reason", "actor"],
        check: body => isNonEmptyString(body["operator"]) && isNonEmptyString(body["reason"]) && body["actor"] === "human" ? null : "UNHALT_INVALID",
      };
    case "KILL":
      return {
        required: ["equityCents", "thresholdCents"],
        check: body => isSafeInteger(body["equityCents"]) && isSafeInteger(body["thresholdCents"]) ? null : "KILL_INVALID",
      };
    case "DEADLINE_RECONCILIATION":
      // S-G11-03: the dedicated entry may name the submitted revision it references.
      return {
        required: ["reasonCodes", "snapshot"],
        optional: ["reference"],
        check: body => (Object.hasOwn(body, "reference") && !isNonEmptyString(body["reference"]) ? "REFERENCE_INVALID" : snapshotBearing(body)),
      };
    case "TERMINAL":
      // S-G11-04: a still-risk-bearing remainder is recorded explicitly (structure, max loss, expiry consequence).
      return {
        required: ["reasonCodes", "snapshot"],
        optional: ["remainder"],
        check: body => (Object.hasOwn(body, "remainder") && !isPlainRecord(body["remainder"]) ? "REMAINDER_INVALID" : snapshotBearing(body)),
      };
  }
}

export function validateJournalEntry(value: unknown): Validation<JournalEntry> {
  if (!isPlainRecord(value)) return { ok: false, reason: "ENTRY_NOT_A_RECORD" };
  const type = value["type"];
  if (!isJournalEntryType(type)) return { ok: false, reason: "UNKNOWN_ENTRY_TYPE" };
  const schema = schemaFor(type, value);
  const keyIssue = hasExactKeys(value, ["seq", "at", "epoch", "type", ...schema.required], ["corrects", ...(schema.optional ?? [])]);
  if (keyIssue !== null) return { ok: false, reason: keyIssue };
  if (!isPositiveInteger(value["seq"])) return { ok: false, reason: "SEQ_INVALID" };
  if (!isUtcIsoTimestamp(value["at"])) return { ok: false, reason: "at: NOT_UTC_ISO" };
  const epoch = value["epoch"];
  if (isWitnessEntryType(type)) {
    if (epoch !== null) return { ok: false, reason: "WITNESS_CARRIES_NO_EPOCH" };
  } else if (!isPositiveInteger(epoch)) {
    return { ok: false, reason: "EPOCH_REQUIRED" };
  }
  if (Object.hasOwn(value, "corrects") && !isPositiveInteger(value["corrects"])) return { ok: false, reason: "CORRECTION_TARGET_INVALID" };
  const bodyIssue = schema.check(value);
  if (bodyIssue !== null) return { ok: false, reason: bodyIssue };
  return { ok: true, entry: value as JournalEntry };
}

/** Replaces every occurrence of every known secret. Secrets must be non-empty: an empty secret would erase everything. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret.length === 0) throw new RangeError("empty secret cannot be redacted");
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function redactDeep(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map(item => redactDeep(item, secrets));
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) output[redactSecrets(key, secrets)] = redactDeep(inner, secrets);
    return output;
  }
  return value;
}

export type EncodeResult = { readonly ok: true; readonly line: string; readonly entry: JournalEntry } | { readonly ok: false; readonly reason: string };

/** One JSON line, redacted first and checked after encoding: a secret that survives escaping still refuses the line (S-J-05). */
export function encodeJournalLine(entry: JournalEntry, secrets: readonly string[]): EncodeResult {
  const redacted = redactDeep(entry, secrets);
  const validated = validateJournalEntry(redacted);
  if (!validated.ok) return validated;
  const body = JSON.stringify(validated.entry);
  for (const secret of secrets) if (body.includes(secret)) return { ok: false, reason: "SECRET_LEAK" };
  if (body.includes("\n") || body.includes("\r")) return { ok: false, reason: "LINE_BREAK_IN_ENTRY" };
  return { ok: true, line: `${body}\n`, entry: validated.entry };
}

export interface JournalTail {
  readonly lastSeq: number;
  readonly priorIntentRationales: readonly string[];
}

/** Assigns `seq`, checks the correction target and the INTENT rationale floor, and encodes. */
export function planAppend(tail: JournalTail, draft: JournalDraft, secrets: readonly string[]): EncodeResult {
  if (!isPlainRecord(draft)) return { ok: false, reason: "ENTRY_NOT_A_RECORD" };
  if (Object.hasOwn(draft, "seq")) return { ok: false, reason: "SEQ_ASSIGNED_BY_GATEWAY" };
  if (!isNonnegativeInteger(tail.lastSeq) || tail.lastSeq >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: "SEQ_EXHAUSTED" };
  const seq = tail.lastSeq + 1;
  const candidate: Record<string, unknown> = { seq, ...draft };
  const validated = validateJournalEntry(candidate);
  if (!validated.ok) return validated;
  const corrects = validated.entry.corrects;
  if (corrects !== undefined && (corrects < 1 || corrects > tail.lastSeq)) return { ok: false, reason: "CORRECTION_TARGET_INVALID" };
  if (validated.entry.type === "INTENT") {
    const rationale = validated.entry["rationale"];
    const text = isRecord(rationale) ? rationale["text"] : undefined;
    if (typeof text === "string" && tail.priorIntentRationales.includes(text)) return { ok: false, reason: "RATIONALE_DUPLICATE" };
  }
  return encodeJournalLine(validated.entry, secrets);
}

export interface ParsedJournal {
  readonly entries: readonly JournalEntry[];
  /** The bytes of an unterminated last line (power cut mid-append), or null. */
  readonly torn: string | null;
  readonly corrupt: readonly { readonly line: number; readonly reason: string }[];
}

/** Splits JSONL text; a final segment without its newline is torn, a terminated but invalid line is corrupt (S-J-01). */
export function parseJournalText(text: string): ParsedJournal {
  const entries: JournalEntry[] = [];
  const corrupt: { line: number; reason: string }[] = [];
  const segments = text.split("\n");
  const torn = segments.at(-1) ?? "";
  const terminated = segments.slice(0, -1);
  let expectedSeq = 1;
  for (const [index, segment] of terminated.entries()) {
    const lineNumber = index + 1;
    if (corrupt.length > 0) {
      // History is a chain: nothing after the first corrupt line is trusted.
      corrupt.push({ line: lineNumber, reason: "AFTER_CORRUPT_LINE" });
      continue;
    }
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(segment);
    } catch {
      corrupt.push({ line: lineNumber, reason: "NOT_JSON" });
      continue;
    }
    const validated = validateJournalEntry(parsedValue);
    if (!validated.ok) {
      corrupt.push({ line: lineNumber, reason: validated.reason });
      continue;
    }
    if (validated.entry.seq !== expectedSeq) {
      corrupt.push({ line: lineNumber, reason: "SEQ_NOT_CONTIGUOUS" });
      continue;
    }
    entries.push(validated.entry);
    expectedSeq += 1;
  }
  return { entries, torn: torn.length === 0 ? null : torn, corrupt };
}

/** HALT sets; a human UNHALT clears unless the halt is sticky; nothing else touches the flag (S-G12-04). */
export function haltStateAfter(current: HaltState, entry: JournalEntry): HaltState {
  if (entry.type === "HALT") {
    // Sticky halts are the strongest terminal safety state. Later, weaker
    // interlocks remain journal evidence but cannot rewrite their cause.
    if (current.sticky) return current;
    const reason = entry["reason"];
    const sticky = entry["sticky"];
    return { halted: true, reason: typeof reason === "string" ? reason : "UNKNOWN", sticky: (typeof sticky === "boolean" && sticky) || current.sticky };
  }
  if (entry.type === "UNHALT" && entry["actor"] === "human" && !current.sticky) return notHalted();
  return current;
}

export function haltStateFrom(entries: readonly JournalEntry[]): HaltState {
  let state = notHalted();
  for (const entry of entries) state = haltStateAfter(state, entry);
  return state;
}

export interface JournalStaleness {
  readonly lastAuthoritativeAt: string | null;
  readonly lastAuthoritativeSeq: number | null;
  readonly lastAt: string | null;
}

/** Witness appends are staleness-neutral: they never advance the authoritative clock (S-G12-01, S-G14-02). */
export function journalStaleness(entries: readonly JournalEntry[]): JournalStaleness {
  let lastAuthoritativeAt: string | null = null;
  let lastAuthoritativeSeq: number | null = null;
  let lastAt: string | null = null;
  for (const entry of entries) {
    lastAt = entry.at;
    if (!isWitnessEntryType(entry.type)) {
      lastAuthoritativeAt = entry.at;
      lastAuthoritativeSeq = entry.seq;
    }
  }
  return { lastAuthoritativeAt, lastAuthoritativeSeq, lastAt };
}

export interface LatestQuoteSample {
  readonly observedAt: string;
  readonly quotesByContract: Readonly<Record<string, JournalQuoteSample>>;
}

/** The most recent snapshot-bearing entry per underlying; snapshot-less entries leave a hole (S-J-03, KGV-11). */
export function latestQuoteSamples(entries: readonly JournalEntry[]): Readonly<Record<string, LatestQuoteSample>> {
  const latest: Record<string, LatestQuoteSample> = {};
  for (const entry of entries) {
    const snapshot = entry["snapshot"];
    if (!isRecord(snapshot)) continue;
    const observedAt = snapshot["snapshotAt"];
    const samples = snapshot["quoteSamples"];
    if (typeof observedAt !== "string" || !isRecord(samples)) continue;
    for (const [underlying, byContract] of Object.entries(samples)) {
      if (isRecord(byContract)) latest[underlying] = { observedAt, quotesByContract: byContract as Readonly<Record<string, JournalQuoteSample>> };
    }
  }
  return latest;
}

export function intentRationaleTexts(entries: readonly JournalEntry[]): readonly string[] {
  const texts: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "INTENT") continue;
    const rationale = entry["rationale"];
    if (isRecord(rationale) && typeof rationale["text"] === "string") texts.push(rationale["text"]);
  }
  return texts;
}
