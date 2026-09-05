// Pure lifecycle core (P5: S-CYC-03/08/09/10, G9, G10, G11, S-G14-01..03,
// S-X-05/06): the deadline regime and entry vetoes, phase-0 book
// classification into the closed G10 set, bootstrap-versus-gap planning with
// the competition provenance proof, the close-escalation ladder and the
// discriminated residue recovery policy, the declared-expiry-hold proof, the
// watchdog staleness assessment, and the ping plan. No I/O, no clock: broker
// books, journal entries, quotes, calendar facts, and explicit times are
// inputs; every decision here is applied by the shell, never made there.
import type { AccountActivityRecord } from "./alpaca-mapping.js";
import { integerUnit, lotCount } from "./domain.js";
import type { EntryCandidate, EntryLimitKind, OptionContract, OptionLeg, OptionPriceCents, OptionQuote, Quantity } from "./domain.js";
import { isWorkingBrokerStatus, netMidTwice, reversedLegs, utcIsoToEpochMs } from "./execution.js";
import type { BrokerBook, BrokerPosition, CloseAttemptRecord, EntryLifecycleRecord, LifecycleVeto } from "./execution.js";
import { isPrimaryEntryType } from "./journal.js";
import type { CloseRouteLabel, JournalDraft, JournalEntry, JournalSnapshot, ReasonCode } from "./journal.js";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// G11 — the deadline regime and the lifecycle entry vetoes (with S-G9-01)
// ---------------------------------------------------------------------------

/** `flatten` on FLATTEN_DATE itself, `post_flatten` on every later trading day (S-G11-02's Friday and beyond). */
export type DeadlineRegime = "normal" | "flatten" | "post_flatten";

/** Both dates are `YYYY-MM-DD`; the ISO shape makes lexicographic order the calendar order. */
export function deadlineRegime(tradingDay: string, flattenDate: string): DeadlineRegime {
  if (tradingDay === flattenDate) return "flatten";
  return tradingDay > flattenDate ? "post_flatten" : "normal";
}

export interface LifecycleVetoContext {
  readonly regime: DeadlineRegime;
  /** The next trading session's date (`YYYY-MM-DD`), from the shell's calendar. */
  readonly nextTradingDay: string;
}

/**
 * S-G11-01/02: on FLATTEN_DATE and after it, every entry action vetoes
 * `DEADLINE`. S-G9-01: a candidate whose expiry day is at or before the next
 * trading session would meet eviction immediately and vetoes `EXPIRY`.
 */
export function lifecycleEntryVeto(candidate: EntryCandidate, context: LifecycleVetoContext): LifecycleVeto | null {
  if (context.regime !== "normal") {
    return { candidateId: candidate.candidateId, code: "DEADLINE", reason: "entry actions are vetoed on and after FLATTEN_DATE; no position is opened on or after the day everything must die" };
  }
  const nearest = candidate.legs.map(optionLeg => optionLeg.expiry).sort()[0];
  if (nearest !== undefined && nearest <= context.nextTradingDay) {
    return { candidateId: candidate.candidateId, code: "EXPIRY", reason: `expiry ${nearest} is at or before the next trading session ${context.nextTradingDay}; the position would meet eviction immediately` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// G10 — phase-0 classification of every broker position and order
// ---------------------------------------------------------------------------

export type BookItemClass = "MATCHED" | "RESIDUE" | "HUMAN_ACTION" | "UNKNOWN_ORDER" | "CONFIRMATION_UNCLEAR";
export type ResidueKind = "bounded_long" | "unbounded_short";

export interface PositionClassification {
  readonly kind: "position";
  readonly contractId: string;
  readonly quantity: number;
  readonly class: "MATCHED" | "RESIDUE" | "HUMAN_ACTION";
  readonly residueKind: ResidueKind | null;
  readonly detail: string;
}

export interface OrderClassification {
  readonly kind: "order";
  readonly clientOrderId: string;
  readonly class: "MATCHED" | "UNKNOWN_ORDER" | "CONFIRMATION_UNCLEAR";
  readonly detail: string;
}

export interface BookClassification {
  readonly positions: readonly PositionClassification[];
  readonly orders: readonly OrderClassification[];
  readonly nonMatched: readonly (PositionClassification | OrderClassification)[];
}

interface IntactStructure {
  readonly record: EntryLifecycleRecord;
  readonly closingLegs: readonly OptionLeg[];
  readonly quantity: Quantity;
}

/**
 * Subtracts every journaled filled structure whose legs are all still held
 * from the book; what remains is unexplained. The subtraction guarantees a
 * residue is never also part of a whole-structure close (S-G14-02).
 */
function subtractIntact(book: BrokerBook, lifecycles: readonly EntryLifecycleRecord[]): { readonly intact: readonly IntactStructure[]; readonly remaining: ReadonlyMap<string, number> } {
  const remaining = new Map<string, number>();
  for (const position of book.positions) if (position.quantity !== 0) remaining.set(position.contractId, position.quantity);
  const intact: IntactStructure[] = [];
  for (const record of lifecycles) {
    if (record.state !== "filled" || record.filledQuantity === 0) continue;
    const covered = record.candidate.legs.every(optionLeg => {
      const held = remaining.get(optionLeg.contractId) ?? 0;
      const needed = optionLeg.ratio * record.filledQuantity;
      return optionLeg.side === "buy" ? held >= needed : held <= -needed;
    });
    if (!covered) continue;
    for (const optionLeg of record.candidate.legs) {
      const held = remaining.get(optionLeg.contractId) ?? 0;
      const needed = optionLeg.ratio * record.filledQuantity;
      remaining.set(optionLeg.contractId, optionLeg.side === "buy" ? held - needed : held + needed);
    }
    intact.push({ record, closingLegs: reversedLegs(record.candidate.legs), quantity: record.filledQuantity });
  }
  return { intact, remaining };
}

/**
 * The discrimination rule (documented decision, DECISIONS.md P5): a leftover
 * piece is `RESIDUE` when its contract appears in a journaled structure's
 * legs, or when it is share stock of an underlying the journal traded —
 * assignment mechanics can only touch what we held. A wholly foreign
 * contract can only come from a manual intervention and is `HUMAN_ACTION`.
 * Discrimination of residue: any short piece is unbounded (S-X-06); a long
 * piece is bounded by its zero floor.
 */
export function classifyBook(book: BrokerBook, lifecycles: readonly EntryLifecycleRecord[], closes: readonly CloseAttemptRecord[], unresolvedClientOrderIds: readonly string[]): BookClassification {
  const { intact, remaining } = subtractIntact(book, lifecycles);
  const journaledContracts = new Set(lifecycles.flatMap(record => record.candidate.legs.map(optionLeg => optionLeg.contractId)));
  const journaledUnderlyings = new Set(lifecycles.map(record => record.underlying));
  const matchedByStructure = new Set(intact.flatMap(structure => structure.record.candidate.legs.map(optionLeg => optionLeg.contractId)));

  const positions: PositionClassification[] = [];
  for (const position of book.positions) {
    if (position.quantity === 0) continue;
    const leftover = remaining.get(position.contractId) ?? 0;
    if (leftover === 0) {
      positions.push({ kind: "position", contractId: position.contractId, quantity: position.quantity, class: "MATCHED", residueKind: null, detail: matchedByStructure.has(position.contractId) ? "explained by journaled intact structure(s)" : "explained by journaled structure legs" });
      continue;
    }
    const assignmentPlausible = journaledContracts.has(position.contractId) || journaledUnderlyings.has(position.contractId);
    const residueKind: ResidueKind = leftover < 0 ? "unbounded_short" : "bounded_long";
    if (assignmentPlausible) {
      positions.push({ kind: "position", contractId: position.contractId, quantity: leftover, class: "RESIDUE", residueKind, detail: leftover < 0 ? "short piece outside any intact journaled structure (orphan short leg or assigned short stock)" : "long piece outside any intact journaled structure (orphan long leg or assigned shares)" });
    } else {
      positions.push({ kind: "position", contractId: position.contractId, quantity: leftover, class: "HUMAN_ACTION", residueKind, detail: "contract appears in no journaled structure; only a manual intervention explains it" });
    }
  }

  const knownOrderIds = new Set([...lifecycles.map(record => record.clientOrderId), ...closes.map(close => close.attemptId)]);
  const unresolved = new Set(unresolvedClientOrderIds);
  const orders: OrderClassification[] = [];
  for (const order of book.openOrders) {
    if (!isWorkingBrokerStatus(order.status)) continue;
    if (unresolved.has(order.clientOrderId)) {
      orders.push({ kind: "order", clientOrderId: order.clientOrderId, class: "CONFIRMATION_UNCLEAR", detail: "intent without resolved outcome (S-G10-04)" });
    } else if (knownOrderIds.has(order.clientOrderId)) {
      orders.push({ kind: "order", clientOrderId: order.clientOrderId, class: "MATCHED", detail: "journaled lifecycle order" });
    } else {
      orders.push({ kind: "order", clientOrderId: order.clientOrderId, class: "UNKNOWN_ORDER", detail: "working order with a client order ID the journal never issued" });
    }
  }
  for (const clientOrderId of unresolved) {
    if (!orders.some(order => order.clientOrderId === clientOrderId)) {
      orders.push({ kind: "order", clientOrderId, class: "CONFIRMATION_UNCLEAR", detail: "journaled intent could not be resolved against the broker (S-CYC-10)" });
    }
  }

  const nonMatched = [...positions.filter(item => item.class !== "MATCHED"), ...orders.filter(item => item.class !== "MATCHED")];
  return { positions, orders, nonMatched };
}

/** Every intact journaled structure plus the leftover residue pieces — the whole-book closure basis of G11/G14. */
export function planBookClosure(book: BrokerBook, lifecycles: readonly EntryLifecycleRecord[]): { readonly intact: readonly IntactStructure[]; readonly residue: readonly BrokerPosition[] } {
  const { intact, remaining } = subtractIntact(book, lifecycles);
  const residue = [...remaining.entries()].filter(([, quantity]) => quantity !== 0).map(([contractId, quantity]) => {
    const position = book.positions.find(candidate => candidate.contractId === contractId);
    return { contractId, quantity, avgEntryPriceCents: position?.avgEntryPriceCents ?? 0 };
  });
  return { intact, residue };
}

/** S-G9-02: intact journaled structures whose nearest leg expiry is at or before the next trading session. */
export function evictionTargets(book: BrokerBook, lifecycles: readonly EntryLifecycleRecord[], nextTradingDay: string): readonly IntactStructure[] {
  return planBookClosure(book, lifecycles).intact.filter(structure =>
    structure.record.candidate.legs.some(optionLeg => optionLeg.expiry <= nextTradingDay));
}

// ---------------------------------------------------------------------------
// S-G10-02 — the residue session clock (BEQ-9)
// ---------------------------------------------------------------------------

/** Distinct trading days on which a non-MATCHED reconciliation was journaled; the fail-signal fires beyond RESIDUE_MAX_SESSIONS. */
export function unresolvedReconciliationSessions(entries: readonly JournalEntry[]): readonly string[] {
  const days = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "RECONCILIATION") continue;
    const items = entry["items"];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!isRecord(item) || (item["kind"] !== "position" && item["kind"] !== "order")) continue;
      if (item["class"] === "MATCHED") continue;
      const tradingDay = item["tradingDay"];
      if (typeof tradingDay === "string" && tradingDay.length > 0) days.add(tradingDay);
    }
  }
  return [...days].sort();
}

// ---------------------------------------------------------------------------
// S-CYC-08 / S-CYC-09 — bootstrap versus gap
// ---------------------------------------------------------------------------

export type PrimaryPlan =
  | { readonly kind: "BOOTSTRAP" }
  | { readonly kind: "FOREIGN_BOOK_GAP"; readonly detail: string }
  | { readonly kind: "GAP"; readonly sinceMs: number; readonly detail: string }
  | { readonly kind: "CYCLE" };

export interface PrimaryPlanInput {
  readonly journalEmpty: boolean;
  /** Broker truth: zero positions AND zero non-terminal orders. */
  readonly bookVirgin: boolean;
  readonly lastPrimaryAtMs: number | null;
  readonly nowMs: number;
  readonly cycleIntervalMs: number;
}

/** The most recent primary entry's timestamp, or null on an empty journal. */
export function lastPrimaryAtMs(entries: readonly JournalEntry[]): number | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry !== undefined && isPrimaryEntryType(entry.type)) {
      const ms = utcIsoToEpochMs(entry.at);
      if (ms !== null) return ms;
    }
  }
  return null;
}

/**
 * An empty journal is the bootstrap state ONLY over a virgin account
 * (S-CYC-09); facing a non-empty account it is a gap with unknown prior
 * state and a foreign book that is never adopted. A journal whose last
 * primary entry is more than two cycle intervals old marks the first cycle
 * after a gap (S-CYC-08; threshold decision in DECISIONS.md P5).
 */
export function planPrimaryEntry(input: PrimaryPlanInput): PrimaryPlan {
  if (input.journalEmpty) {
    return input.bookVirgin
      ? { kind: "BOOTSTRAP" }
      : { kind: "FOREIGN_BOOK_GAP", detail: "empty journal facing a non-empty account: unknown prior state; every broker item is non-MATCHED by definition and the book is never adopted as a baseline" };
  }
  if (input.lastPrimaryAtMs !== null && input.nowMs - input.lastPrimaryAtMs > 2 * input.cycleIntervalMs) {
    return { kind: "GAP", sinceMs: input.lastPrimaryAtMs, detail: `no primary entry for ${String(input.nowMs - input.lastPrimaryAtMs)} ms (bound: ${String(2 * input.cycleIntervalMs)} ms); state re-derived from the broker` };
  }
  return { kind: "CYCLE" };
}

// ---------------------------------------------------------------------------
// S-CYC-09 — the competition provenance proof
// ---------------------------------------------------------------------------

export interface ProvenanceExpectations {
  readonly expectedAccountId: string;
  readonly competitionStartMs: number;
  readonly initialCapitalCents: number;
}

export interface PaginatedHistoryEvidence {
  /** True only when every page was fetched to the end; a missing page fails closed. */
  readonly complete: boolean;
  readonly items: number;
}

/** The activity ledger as the proof classifies it: the mapped records plus the completeness of their pagination. */
export interface OpeningLedgerEvidence {
  readonly complete: boolean;
  readonly activities: readonly AccountActivityRecord[];
}

export type ProvenanceVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly string[]; readonly reuseEvidence: boolean };

function historyOf(value: unknown): PaginatedHistoryEvidence | null {
  if (!isRecord(value) || typeof value["complete"] !== "boolean" || !isNonnegativeSafeInteger(value["items"])) return null;
  return { complete: value["complete"], items: value["items"] };
}

/** The mapped record shape, re-read structurally: the proof trusts the bundle shape no more than the bundle content. */
function activityRecordOf(value: unknown): AccountActivityRecord | null {
  if (!isRecord(value)) return null;
  const id = value["id"];
  const activityType = value["activityType"];
  const status = value["status"];
  const netAmountCents = value["netAmountCents"];
  const currency = value["currency"];
  const occurredAt = value["occurredAt"];
  if (typeof id !== "string" || id.length === 0) return null;
  if (typeof activityType !== "string" || activityType.length === 0) return null;
  if (status !== null && typeof status !== "string") return null;
  if (netAmountCents !== null && !Number.isSafeInteger(netAmountCents)) return null;
  if (currency !== null && typeof currency !== "string") return null;
  if (occurredAt !== null && typeof occurredAt !== "string") return null;
  return { id, activityType, status, netAmountCents: netAmountCents === null ? null : (netAmountCents as number), currency, occurredAt };
}

function openingLedgerOf(value: unknown): OpeningLedgerEvidence | null {
  if (!isRecord(value) || typeof value["complete"] !== "boolean") return null;
  const raw = value["activities"];
  if (!Array.isArray(raw)) return null;
  const activities: AccountActivityRecord[] = [];
  for (const item of raw) {
    const record = activityRecordOf(item);
    if (record === null) return null;
    activities.push(record);
  }
  return { complete: value["complete"], activities };
}

/**
 * The one activity a virgin competition account legitimately carries: the
 * broker own opening capital journal. Recorded on the dev paper account on
 * 2026-09-02 as an executed USD cash journal-in (`JNLC`) with a positive exact
 * net amount. Only such a journal counts toward the funding sum. It is not
 * guaranteed to exist yet — see `validateCompetitionProvenance`.
 */
function isOpeningFundingJournal(activity: AccountActivityRecord): boolean {
  return activity.activityType === "JNLC" && activity.status === "executed" && activity.currency === "USD" && activity.netAmountCents !== null && activity.netAmountCents > 0;
}

/**
 * Cash that LEFT the account. An executed negative cash journal is prior use,
 * not merely an uncountable record — it is graded with the foreign activity
 * types rather than with the benign uncountable journals below.
 */
function isCashJournalOut(activity: AccountActivityRecord): boolean {
  return activity.activityType === "JNLC" && activity.status === "executed" && activity.netAmountCents !== null && activity.netAmountCents < 0;
}

/** Distinct activity types, so a violation message names what was actually seen. */
function distinctTypes(activities: readonly AccountActivityRecord[]): readonly string[] {
  const seen: string[] = [];
  for (const activity of activities) if (!seen.includes(activity.activityType)) seen.push(activity.activityType);
  return seen;
}

/**
 * The fully paginated provenance bundle a competition bootstrap requires
 * before any order: paper role and expected ID, creation at or after
 * COMPETITION_START, opening cash and equity exactly INITIAL_CAPITAL, zero
 * positions and non-terminal orders, an empty complete order and fill history,
 * and an activity ledger whose ONLY entries are opening funding journals.
 * A non-empty ledger is not by itself reuse: an Alpaca paper account carries
 * the `JNLC` journal that funded it (recorded on the dev account 2026-09-02),
 * so the countable journals present must sum to exactly INITIAL_CAPITAL.
 *
 * The funding journal is posted ASYNCHRONOUSLY, though, not at account
 * creation: read-only probes of the competition account minutes after its
 * creation (`PA376WIK2ATL`, created 2026-09-02T09:54:41Z) returned an empty
 * activity ledger under every filter while cash and equity already stood at
 * exactly $100,000. Requiring the journal would therefore block arming for as
 * long as the broker takes to post it. So an EMPTY, complete ledger is itself
 * accepted as virgin evidence — but only when every other clause of this proof
 * already holds, above all opening cash AND equity at exactly INITIAL_CAPITAL
 * with complete, empty order and fill histories: on a virgin snapshot the
 * balance is the funding evidence. Where that snapshot is off in any way, the
 * empty ledger proves nothing and the funding evidence stays incomplete.
 *
 * Deliberately NOT checked: any ordering between the funding journal instant
 * and the account creation instant. The two timestamps come from different
 * broker subsystems and no recorded pair establishes their order, so a
 * tolerance would be an invented constant; it would also add no safety, since
 * the account creation instant is already bounded by COMPETITION_START and a
 * journal cannot fund an account that does not exist.
 *
 * Missing pages, reset/reuse evidence, or an allowed-looking $100k snapshot
 * without creation/funding proof fails closed.
 */
export function validateCompetitionProvenance(bundle: unknown, expectations: ProvenanceExpectations): ProvenanceVerdict {
  const violations: string[] = [];
  let reuseEvidence = false;
  if (!isRecord(bundle)) return { ok: false, violations: ["bundle is not a record"], reuseEvidence: false };
  if (bundle["accountRole"] !== "paper") violations.push("account role is not 'paper'");
  if (bundle["accountId"] !== expectations.expectedAccountId || typeof bundle["accountId"] !== "string" || bundle["accountId"].length === 0) violations.push("account ID does not equal EXPECTED_ACCOUNT_ID");
  const createdAt = typeof bundle["createdAt"] === "string" ? utcIsoToEpochMs(bundle["createdAt"]) : null;
  if (createdAt === null) {
    violations.push("creation timestamp missing or not UTC ISO");
  } else if (createdAt < expectations.competitionStartMs) {
    violations.push("account was created before COMPETITION_START");
    reuseEvidence = true;
  }
  if (bundle["openingCashCents"] !== expectations.initialCapitalCents) violations.push("opening cash is not exactly INITIAL_CAPITAL");
  if (bundle["openingEquityCents"] !== expectations.initialCapitalCents) violations.push("opening equity is not exactly INITIAL_CAPITAL");
  if (bundle["positionCount"] !== 0) { violations.push("account holds positions"); reuseEvidence = true; }
  if (bundle["nonTerminalOrderCount"] !== 0) { violations.push("account has non-terminal orders"); reuseEvidence = true; }
  for (const key of ["orderHistory", "fillHistory"]) {
    const history = historyOf(bundle[key]);
    if (history === null) {
      violations.push(`${key} evidence missing or malformed`);
      continue;
    }
    if (!history.complete) violations.push(`${key} pagination is incomplete; missing pages fail closed`);
    if (history.items > 0) { violations.push(`${key} is not empty from creation through the snapshot`); reuseEvidence = true; }
  }
  const ledger = openingLedgerOf(bundle["activityLedger"]);
  if (ledger === null) {
    violations.push("activityLedger evidence missing or malformed");
    return { ok: false, violations, reuseEvidence };
  }
  if (!ledger.complete) violations.push("activityLedger pagination is incomplete; missing pages fail closed");
  const funding = ledger.activities.filter(activity => isOpeningFundingJournal(activity));
  // Graded, not lumped together. A foreign activity type or cash journalled OUT is prior use and latches the
  // irreversible halt. A cash journal that merely fails to count — cancelled, non-USD, amount absent — blocks
  // the bootstrap without that latch: it is an unreadable record, not proof that the account was spent, and an
  // irreversible latch on a benign funding retry would cost the whole competition week.
  const spent = ledger.activities.filter(activity => activity.activityType !== "JNLC" || isCashJournalOut(activity));
  const uncountable = ledger.activities.filter(activity => activity.activityType === "JNLC" && !isCashJournalOut(activity) && !isOpeningFundingJournal(activity));
  if (spent.length > 0) {
    violations.push(`activity ledger carries entries beyond the opening funding journal: ${distinctTypes(spent).join(", ")}`);
    reuseEvidence = true;
  }
  if (uncountable.length > 0) violations.push(`activity ledger carries ${String(uncountable.length)} cash journal(s) that are not an executed positive USD credit and cannot be counted as funding`);
  const fundedCents = funding.reduce((sum, activity) => sum + (activity.netAmountCents ?? 0), 0);
  if (funding.length === 0) {
    // An empty COMPLETE ledger is the virgin state the broker shows before it posts the opening journal, but it
    // carries that meaning only on an otherwise perfect snapshot: `violations.length === 0` here means opening cash
    // and equity are exactly INITIAL_CAPITAL, both histories are complete and empty, there are no positions and no
    // non-terminal orders, the role/ID/creation clauses hold, and the ledger page itself is complete. Then the
    // balance IS the funding evidence and nothing is missing. Otherwise the funding evidence is incomplete — which
    // is not proof of reuse either way (a ledger that was not observed is not a spent account), so this blocks
    // retryably (GAP) and never latches PROVENANCE_BROKEN. The two leading conjuncts are subsumed by that same
    // `violations.length === 0` today — an incomplete page and any non-empty ledger without a countable journal
    // each push their own violation above — and are kept deliberately: they state the rule at its own site, so a
    // later reordering of the checks above cannot silently widen what counts as the virgin empty ledger.
    const balanceIsFundingEvidence = ledger.complete && ledger.activities.length === 0 && violations.length === 0;
    if (!balanceIsFundingEvidence) violations.push("activity ledger carries no opening funding journal; funding evidence is incomplete");
  } else if (!Number.isSafeInteger(fundedCents)) {
    violations.push("opening funding journals do not sum within the exact-cent integer range");
  } else if (fundedCents !== expectations.initialCapitalCents) {
    violations.push(`opening funding journals sum to ${String(fundedCents)} cents, not exactly INITIAL_CAPITAL`);
    reuseEvidence = true;
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations, reuseEvidence };
}

// ---------------------------------------------------------------------------
// S-X-05 / S-X-06 — the close-escalation ladder and the discriminated residue policy
// ---------------------------------------------------------------------------

export type CloseCap =
  | { readonly kind: "width_debit_cap"; readonly widthCents: number }
  | { readonly kind: "zero_floor" }
  | { readonly kind: "uncapped_marketable" };

/**
 * The cap follows the structure's own defined-risk arithmetic (S-X-05): a
 * credit structure's close debit never exceeds the width its maxLoss was
 * computed from; a debit structure or long option never accepts a close
 * credit below zero. Non-intact subjects do not use this function.
 */
export function closeCapFor(candidate: EntryCandidate): CloseCap {
  if (candidate.entryLimit.kind === "debit") return { kind: "zero_floor" };
  if (candidate.declaredStructureType === "iron_condor") {
    const puts = candidate.legs.filter(optionLeg => optionLeg.right === "put").map(optionLeg => optionLeg.strikeCents).sort((left, right) => left - right);
    const calls = candidate.legs.filter(optionLeg => optionLeg.right === "call").map(optionLeg => optionLeg.strikeCents).sort((left, right) => left - right);
    const putWidth = puts.length === 2 ? (puts[1] ?? 0) - (puts[0] ?? 0) : 0;
    const callWidth = calls.length === 2 ? (calls[1] ?? 0) - (calls[0] ?? 0) : 0;
    return { kind: "width_debit_cap", widthCents: Math.max(putWidth, callWidth) };
  }
  const strikes = candidate.legs.map(optionLeg => optionLeg.strikeCents);
  const width = strikes.length >= 2 ? Math.max(...strikes) - Math.min(...strikes) : 0;
  return { kind: "width_debit_cap", widthCents: width };
}

export interface EscalatedLimit {
  readonly limit: { readonly kind: EntryLimitKind; readonly priceCents: OptionPriceCents };
  /** True when the unclamped price reached or passed the cap: the order rests AT the cap and the alarm fires (S-X-05). */
  readonly atCap: boolean;
}

export type EscalationResult = ({ readonly ok: true } & EscalatedLimit) | { readonly ok: false; readonly reason: string };

function clampToPrice(value: bigint): number | null {
  if (value > 9_007_199_254_740_991n) return null;
  return Number(value);
}

/**
 * Generation 0 starts at the closing legs' net mid; every later generation
 * re-prices by `stepCents` toward — and past — the opposing quote, remaining
 * a limit order at all times. A debit close is capped at the structure's
 * width; a credit close never goes below its zero floor (the order rests at
 * one cent, the smallest legal credit at the floor). (S-X-05)
 */
export function escalateCloseLimit(closingLegs: readonly OptionLeg[], quotesByContract: Readonly<Record<string, OptionQuote>>, generation: number, stepCents: number, cap: CloseCap): EscalationResult {
  if (!isNonnegativeSafeInteger(generation) || !isNonnegativeSafeInteger(stepCents) || stepCents < 1) return { ok: false, reason: "ESCALATION_INPUT_INVALID" };
  const pricing = netMidTwice(closingLegs, quotesByContract);
  if (pricing === "QUOTE_MISSING" || pricing === "NET_PREMIUM_ZERO") return { ok: false, reason: pricing };
  const magnitude = pricing.netMidTwiceCents < 0n ? -pricing.netMidTwiceCents : pricing.netMidTwiceCents;
  const step = BigInt(generation) * BigInt(stepCents);
  if (pricing.kind === "debit") {
    const escalated = (magnitude + 1n) / 2n + step;
    if (cap.kind === "width_debit_cap") {
      const bounded = escalated >= BigInt(cap.widthCents) ? BigInt(cap.widthCents) : escalated;
      const price = clampToPrice(bounded);
      if (price === null || price < 1) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
      return { ok: true, limit: { kind: "debit", priceCents: integerUnit(price, "OptionPriceCents") }, atCap: escalated >= BigInt(cap.widthCents) };
    }
    const price = clampToPrice(escalated);
    if (price === null || price < 1) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
    return { ok: true, limit: { kind: "debit", priceCents: integerUnit(price, "OptionPriceCents") }, atCap: false };
  }
  const escalated = magnitude / 2n - step;
  const atFloor = escalated <= 0n;
  const price = atFloor ? 1 : clampToPrice(escalated);
  if (price === null) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
  return { ok: true, limit: { kind: "credit", priceCents: integerUnit(Math.max(price, 1), "OptionPriceCents") }, atCap: cap.kind !== "uncapped_marketable" && atFloor };
}

/**
 * S-X-06: an unbounded residue closes as a requoted marketable limit — for
 * buys at or past the ask, for sells at or below the bid — re-priced every
 * cycle by `stepCents` to remain marketable until flat, with no price cap.
 * The realized cost MAY exceed the structure's original maxLoss.
 */
export function marketableCloseLimit(closingLegs: readonly OptionLeg[], quotesByContract: Readonly<Record<string, OptionQuote>>, generation: number, stepCents: number): EscalationResult {
  if (!isNonnegativeSafeInteger(generation) || !isNonnegativeSafeInteger(stepCents) || stepCents < 1) return { ok: false, reason: "ESCALATION_INPUT_INVALID" };
  let signed = 0n;
  for (const optionLeg of closingLegs) {
    const quote = Object.hasOwn(quotesByContract, optionLeg.contractId) ? quotesByContract[optionLeg.contractId] : undefined;
    if (quote === undefined) return { ok: false, reason: "QUOTE_MISSING" };
    const marketable = optionLeg.side === "buy" ? BigInt(quote.askCents) : -BigInt(quote.bidCents);
    signed += marketable * BigInt(optionLeg.ratio);
  }
  const step = BigInt(generation) * BigInt(stepCents);
  if (signed >= 0n) {
    const price = clampToPrice(signed + step);
    if (price === null) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
    return { ok: true, limit: { kind: "debit", priceCents: integerUnit(Math.max(price, 1), "OptionPriceCents") }, atCap: false };
  }
  const credit = -signed - step;
  const price = credit <= 1n ? 1 : clampToPrice(credit);
  if (price === null) return { ok: false, reason: "LIMIT_OUT_OF_RANGE" };
  return { ok: true, limit: { kind: "credit", priceCents: integerUnit(price, "OptionPriceCents") }, atCap: false };
}

/**
 * The order shape carries option legs; assigned share stock travels through
 * it as an equity sentinel leg (expiry `1970-01-01`, strike 0, right `call`)
 * whose contract ID is the share symbol. The broker adapter maps a sentinel
 * leg onto an equity order; the journal reason text names the share residue.
 * (Decision in DECISIONS.md, P5.)
 */
export function equityLegExpirySentinel(): string {
  return "1970-01-01";
}

/** A residue close is leg-wise by construction (the structure is already broken); the leg's side offsets the held sign. */
export function residueClosingLeg(position: BrokerPosition, knownLegs: readonly OptionLeg[], journaledUnderlyings: ReadonlySet<string>): OptionLeg | null {
  const known = knownLegs.find(optionLeg => optionLeg.contractId === position.contractId);
  const side = position.quantity > 0 ? "sell" as const : "buy" as const;
  if (known !== undefined) return { ...known, side };
  if (journaledUnderlyings.has(position.contractId)) {
    return {
      contractId: position.contractId,
      underlying: position.contractId,
      expiry: equityLegExpirySentinel(),
      strikeCents: integerUnit(0, "StrikeCents"),
      right: "call",
      side,
      ratio: lotCount(1),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// S-X-06 — the declared expiry hold (KGV-7, WIN-3)
// ---------------------------------------------------------------------------

export interface ExpiryHoldEvidence {
  readonly contract: OptionContract;
  /** Signed broker quantity of the residue piece. */
  readonly quantity: number;
  readonly quote: OptionQuote | null;
  readonly spotCents: number | null;
  /** True when any short option or share liability is paired with this piece on the same underlying. */
  readonly pairedShortOrLiability: boolean;
  /** Broker-confirmed protection from automatic exercise, or an accepted do-not-exercise instruction. */
  readonly exerciseProtectionConfirmed: boolean;
}

export type ExpiryHoldVerdict =
  | { readonly ok: true; readonly proof: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * A long residue reaches terminal `DECLARED_EXPIRY_HOLD` only after
 * zero-floor close attempts remain unfilled and one same-cycle proof shows:
 * complete fresh quotes, positive long quantity with no paired liability,
 * bid exactly zero, out-of-the-money economics, and confirmed protection
 * from automatic exercise. Any missing element keeps escalation and alarm
 * active. The caller supplies same-cycle observations only.
 */
export function evaluateExpiryHold(evidence: ExpiryHoldEvidence, nowMs: number, quoteMaxAgeMs: number): ExpiryHoldVerdict {
  const reasons: string[] = [];
  if (!Number.isSafeInteger(evidence.quantity) || evidence.quantity <= 0) reasons.push("quantity is not a positive long position");
  if (evidence.pairedShortOrLiability) reasons.push("a paired short option or share liability exists");
  if (evidence.quote === null) {
    reasons.push("no complete fresh option quote");
  } else {
    const age = nowMs - evidence.quote.quotedAt;
    if (age < 0 || age > quoteMaxAgeMs) reasons.push("option quote is stale");
    if (evidence.quote.bidCents !== 0) reasons.push("bid is not exactly zero");
  }
  if (evidence.spotCents === null || !isNonnegativeSafeInteger(evidence.spotCents) || evidence.spotCents <= 0) {
    reasons.push("no fresh underlying quote");
  } else {
    const otm = evidence.contract.right === "call" ? evidence.contract.strikeCents > evidence.spotCents : evidence.contract.strikeCents < evidence.spotCents;
    if (!otm) reasons.push("economics are not out-of-the-money");
  }
  if (!evidence.exerciseProtectionConfirmed) reasons.push("exercise protection is not broker-confirmed");
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    proof: {
      kind: "declared_expiry_hold",
      contractId: evidence.contract.contractId,
      underlying: evidence.contract.underlying,
      expiry: evidence.contract.expiry,
      strikeCents: evidence.contract.strikeCents,
      right: evidence.contract.right,
      quantity: evidence.quantity,
      bidCents: evidence.quote?.bidCents ?? null,
      askCents: evidence.quote?.askCents ?? null,
      spotCents: evidence.spotCents,
      exerciseProtectionConfirmed: true,
      statement: "hold to expiry, zero additional liability",
    },
  };
}

/** Contract IDs already journaled as `DECLARED_EXPIRY_HOLD`; a valid hold is never re-enqueued (S-G9-02) but stays visibly not-flat. */
export function declaredExpiryHolds(entries: readonly JournalEntry[]): readonly string[] {
  const holds = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "RECONCILIATION") continue;
    const reasonCodes = entry["reasonCodes"];
    if (!Array.isArray(reasonCodes) || !reasonCodes.includes("DECLARED_EXPIRY_HOLD")) continue;
    const items = entry["items"];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (isRecord(item) && item["kind"] === "declared_expiry_hold" && typeof item["contractId"] === "string") holds.add(item["contractId"]);
    }
  }
  return [...holds].sort();
}

// ---------------------------------------------------------------------------
// G11 — the flatten assertion
// ---------------------------------------------------------------------------

export interface FlattenAssertion {
  /** True when zero risk-bearing positions and zero non-terminal orders remain (declared holds excepted). */
  readonly satisfied: boolean;
  /** True when a currently valid declared expiry hold keeps the broker book non-empty: the account is called not-flat. */
  readonly holdVisible: boolean;
  readonly violations: readonly string[];
}

/** By Thursday close: zero risk-bearing positions AND zero non-terminal orders; the only permitted nonzero position is a declared hold. */
export function assertFlattened(book: BrokerBook, declaredHoldContractIds: readonly string[]): FlattenAssertion {
  const holds = new Set(declaredHoldContractIds);
  const violations: string[] = [];
  let holdVisible = false;
  for (const position of book.positions) {
    if (position.quantity === 0) continue;
    if (holds.has(position.contractId) && position.quantity > 0) {
      holdVisible = true;
      continue;
    }
    violations.push(`position ${position.contractId} (${String(position.quantity)}) is still open`);
  }
  for (const order of book.openOrders) {
    if (isWorkingBrokerStatus(order.status)) violations.push(`order ${order.clientOrderId} is still non-terminal`);
  }
  return { satisfied: violations.length === 0, holdVisible, violations };
}

/**
 * The `TERMINAL` entry, if one stands (S-G11-04). It is the controlled end of
 * the run: after it the scheduler stops, the artifacts are frozen, and a
 * journal that no longer grows is the intended outcome rather than evidence of
 * a hung writer. The fold is here so that every consumer — the watchdog's
 * staleness assessment, the deadline CLI's once-only admission — reads the
 * same fact from the same entries instead of re-deciding what "ended" means.
 */
export function terminalEntry(entries: readonly JournalEntry[]): JournalEntry | null {
  return entries.find(entry => entry.type === "TERMINAL") ?? null;
}

/** Whether the controlled end already stands; the boolean form the staleness assessment takes. */
export function deploymentTerminal(entries: readonly JournalEntry[]): boolean {
  return terminalEntry(entries) !== null;
}

// ---------------------------------------------------------------------------
// G14 — watchdog staleness and the ping plan
// ---------------------------------------------------------------------------

export interface SessionWindow {
  readonly isTradingDay: boolean;
  readonly opensAt: number;
  readonly closesAt: number;
}

export type StalenessAssessment =
  | { readonly kind: "quiet"; readonly reason: "OUTSIDE_SESSION" | "FRESH" | "NO_JOURNAL" | "DEPLOYMENT_TERMINAL" }
  | { readonly kind: "stale"; readonly ageMs: number };

/**
 * Market-hours-aware (S-G14-01): outside a session, any heartbeat gap is
 * normal and triggers nothing. Inside a session, journal staleness beyond
 * `DEAD_MAN_BOUND` triggers the takeover (S-G14-02). An empty journal is not
 * a hung writer — the external dead-man check owns that alarm — so the
 * watchdog stays quiet on it (decision in DECISIONS.md P5). Witness appends
 * never feed `lastAuthoritativeAtMs` (the caller derives it via
 * `journalStaleness`, which is witness-neutral).
 *
 * `deploymentTerminal` outranks every other reason (S-G11-04): once the
 * `TERMINAL` entry stands, the run ended on purpose and its silence is the
 * expected outcome. Treating that as a hung writer would fence a writer that
 * finished, halt an account that is flat, and fail-ping an owner whose story
 * already closed in writing. The caller derives the flag from the journal fold
 * (`deploymentTerminal`); this function never reads a journal.
 */
export function assessStaleness(nowMs: number, session: SessionWindow, lastAuthoritativeAtMs: number | null, deadManBoundMs: number, deploymentTerminal: boolean): StalenessAssessment {
  if (deploymentTerminal) return { kind: "quiet", reason: "DEPLOYMENT_TERMINAL" };
  if (!session.isTradingDay || nowMs < session.opensAt || nowMs >= session.closesAt) return { kind: "quiet", reason: "OUTSIDE_SESSION" };
  if (lastAuthoritativeAtMs === null) return { kind: "quiet", reason: "NO_JOURNAL" };
  const ageMs = nowMs - lastAuthoritativeAtMs;
  if (ageMs > deadManBoundMs) return { kind: "stale", ageMs };
  return { kind: "quiet", reason: "FRESH" };
}

export type PingPlan =
  | { readonly kind: "success" }
  | { readonly kind: "fail"; readonly conditions: readonly string[] }
  | { readonly kind: "none"; readonly detail: string };

/**
 * S-G14-03: the success ping fires only AFTER a durable local journal
 * append; an active fail-ping is failure-only, may precede any journal, and
 * never refreshes liveness. A cycle that journals an alarm-worthy condition
 * sends the fail-ping INSTEAD of the success ping.
 */
/**
 * S-G14-05 / A31: the READINESS decision. `success` claims the deployment is
 * able to trade, so a standing halt or an unreleased credential fence has to
 * outrank a landed append — before this, a cycle that correctly halted on
 * `AUTH_FAILURE` reported success because its own entry had been written, and
 * the operator's check stayed green while the account did nothing (#78).
 * A standing impediment re-reports itself on every invocation, for as long as
 * it stands, until a human clears it. Liveness is a separate signal and is not
 * decided here.
 */
export function planPing(input: { readonly durableAppendLanded: boolean; readonly alarmConditions: readonly string[]; readonly standingHalt?: { readonly reason: string; readonly fencePending: boolean } | null }): PingPlan {
  const standing = input.standingHalt ?? null;
  const haltConditions = standing === null
    ? []
    : [`HALT_STANDING:${standing.reason}`, ...(standing.fencePending ? ["CREDENTIAL_FENCE_UNRELEASED"] : [])];
  const conditions = [...haltConditions, ...input.alarmConditions];
  if (conditions.length > 0) return { kind: "fail", conditions };
  if (input.durableAppendLanded) return { kind: "success" };
  return { kind: "none", detail: "no durable authoritative append landed and no alarm condition exists" };
}

/**
 * The ways an epoch acquisition can end without authority, mirrored from the
 * gateway's `AcquisitionResult` (the core cannot import the shell). Only these
 * three reach the watchdog's refusal branch: `WON` and `GAP_HALT` are the
 * authoritative outcomes.
 */
export type AuthorityRefusal =
  | { readonly kind: "SUPPRESSED"; readonly holderId: string }
  | { readonly kind: "LOST"; readonly observedEpoch: number | null }
  | { readonly kind: "REFUSED"; readonly reason: string };

/**
 * S-G14-02/03: in-session staleness beyond `DEAD_MAN_BOUND` that could NOT be
 * fenced. Observing staleness is not authority, and authority comes only from
 * the atomic epoch increment — so this run may not halt, may not journal and
 * may not touch the book. What remains is the alarm, and it is the only active
 * one this state has: a live holder whose heartbeat is fresh while its journal
 * stopped growing is exactly the hung writer the dead man exists for, and
 * leaving it to the passive missed-ping SLA is what S-G14-03 refuses. The
 * conditions are closed (never empty), so `planPing` can only turn them into a
 * fail-ping, and they name both the age of the silence and who or what denied
 * the fence.
 */
export function authorityRefusalAlarms(refusal: AuthorityRefusal, ageMs: number): readonly string[] {
  const staleness = `WATCHDOG_NO_AUTHORITY:staleness ${String(ageMs)} ms`;
  switch (refusal.kind) {
    case "SUPPRESSED":
      return [staleness, `WRITER_HUNG_LOCK_HELD:${refusal.holderId}`];
    case "LOST":
      return [staleness, `WATCHDOG_AUTHORITY_LOST:${refusal.observedEpoch === null ? "unknown" : String(refusal.observedEpoch)}`];
    case "REFUSED":
      return [staleness, `WATCHDOG_AUTHORITY_REFUSED:${refusal.reason}`];
  }
}

// ---------------------------------------------------------------------------
// Journal drafts the shell appends verbatim
// ---------------------------------------------------------------------------

export interface DraftContext {
  readonly atIso: string;
  readonly epoch: number;
}

export function bootstrapDraft(context: DraftContext, snapshot: JournalSnapshot, epochSeeded: boolean): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "BOOTSTRAP", snapshot, epochSeeded };
}

export function gapDraft(context: DraftContext, snapshot: JournalSnapshot | null, detail: string): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "GAP", reasonCodes: [], snapshot, detail };
}

/** The G10 reconciliation entry: every classified item, with the trading day for the residue session clock (BEQ-9). */
export function bookReconciliationDraft(context: DraftContext, tradingDay: string, classification: BookClassification): JournalDraft {
  const items = [...classification.positions, ...classification.orders].map(item => ({ ...item, tradingDay }));
  return { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: [], items };
}

/** S-G10-05: a manual human trade is visible as exactly that, never absorbed into agent reasoning. */
export function humanActionDraft(context: DraftContext, description: string): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "HUMAN_ACTION", operator: "phase0-detection", description };
}

export function expiryHoldDraft(context: DraftContext, proof: Readonly<Record<string, unknown>>): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: ["DECLARED_EXPIRY_HOLD"], items: [proof] };
}

export function deadlineReconciliationDraft(context: DraftContext, snapshot: JournalSnapshot, reference: string, reasonCodes: readonly ReasonCode[]): JournalDraft {
  return { at: context.atIso, epoch: context.epoch, type: "DEADLINE_RECONCILIATION", reasonCodes, snapshot, reference };
}

export interface TerminalRemainder {
  readonly positions: readonly { readonly contractId: string; readonly quantity: number }[];
  readonly maxLossStatement: string;
  readonly expiryConsequence: string;
}

export function terminalDraft(context: DraftContext, snapshot: JournalSnapshot, reasonCodes: readonly ReasonCode[], remainder: TerminalRemainder | null): JournalDraft {
  const base: JournalDraft = { at: context.atIso, epoch: context.epoch, type: "TERMINAL", reasonCodes, snapshot };
  return remainder === null ? base : { ...base, remainder: { positions: remainder.positions.map(position => ({ ...position })), maxLossStatement: remainder.maxLossStatement, expiryConsequence: remainder.expiryConsequence } };
}

/** The ladder journals every re-price (S-X-05); the route label names the driver of the close. */
export function ladderRouteLabel(route: "expiry" | "deadline" | "residue" | "watchdog" | "kill" | "ordinary"): CloseRouteLabel {
  return route;
}
