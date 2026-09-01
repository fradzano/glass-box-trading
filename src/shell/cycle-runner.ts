// The cycle runner (CONCEPT §3 phases 0–5, tested against fakes in P3):
// 0 reconcile own lifecycles by client order ID → 1 snapshot → 2 analyst
// (at most once) → 3 price and decide → primary CYCLE entry → 4 execute
// (INTENT, revalidate, submit, OUTCOME) → kill management when the kill
// predicate fires. The shell here fetches, appends, and submits; which entry
// lands, whether an action is void, what a broker answer means, and what
// "flat" is are all decided by the pure core (`src/core/execution.ts`).
// Every append and every broker mutation goes through the P2 gateway under
// the epoch this process won; the runner holds no order state in memory.
import { decide, parseAnalystOutput } from "../core/decision.js";
import { integerUnit } from "../core/domain.js";
import type { CloseAttemptSnapshot, CloseLifecycleSnapshot, DecisionSnapshot, DecisionConfig, EntryActionPlan, OptionContract, OptionLeg, OptionQuote, Quantity } from "../core/domain.js";
import {
  assembleDecisionSnapshot,
  auditGapDraft,
  buildClaimset,
  cancelReconciliationDraft,
  closeIntentDraft,
  classifyWorkingOrder,
  cycleDraft,
  emergencyCloseEligibility,
  entryResolutionDraft,
  epochMsToUtcIso,
  haltDraft,
  intentDraft,
  isBookFlat,
  isWorkingBrokerStatus,
  killDraft,
  killTriggered,
  outcomeFromOrder,
  outcomeFromSubmit,
  planKillManagement,
  priceAndDecide,
  priceCloseLimit,
  reconcileCancel,
  revalidateClaimset,
  revalidationVoidDraft,
  skipDraft,
} from "../core/execution.js";
import type {
  BrokerBook,
  BrokerOrderRecord,
  BrokerPosition,
  CancelReconciliation,
  CloseAttemptRecord,
  EntryLifecycleRecord,
  ExecutionConfig,
  FlattenTarget,
  LifecycleVeto,
  MarketObservation,
  OutcomeContext,
  PricedDecision,
  RunnerHaltReason,
  SubmitObservation,
} from "../core/execution.js";
import type { AccountBinding, JournalDraft, JournalEntry, OutcomeStatus, ReasonCode } from "../core/journal.js";
import {
  assertFlattened,
  bookReconciliationDraft,
  bootstrapDraft,
  classifyBook,
  closeCapFor,
  deadlineRegime,
  declaredExpiryHolds,
  escalateCloseLimit,
  evaluateExpiryHold,
  evictionTargets,
  expiryHoldDraft,
  gapDraft,
  humanActionDraft,
  lastPrimaryAtMs,
  lifecycleEntryVeto,
  marketableCloseLimit,
  planBookClosure,
  planPing,
  planPrimaryEntry,
  residueClosingLeg,
  unresolvedReconciliationSessions,
  validateCompetitionProvenance,
} from "../core/lifecycle.js";
import type { BookClassification, CloseCap, DeadlineRegime, PingPlan } from "../core/lifecycle.js";
import { closeAttemptId, closeLifecycleId, planCloseLifecycle } from "../core/order-identity.js";
import { liveEntryLifecycles, projectQualification, qualificationBrief, qualificationEntryVeto, qualificationReasonCodes } from "../core/qualification.js";
import type { QualificationBrief, QualificationConfig } from "../core/qualification.js";
import { classifyBrokerFailure } from "../core/startup.js";
import { httpStatusOf } from "./broker-errors.js";
import { readEpochStore } from "./epoch-store.js";
import type { BrokerReadPort, SubmitPayload } from "./fake-broker.js";
import { readHaltState } from "./halt-state.js";
import type { BrokerMutation, DispatchResult, MutationGateway } from "./mutation-gateway.js";
import type { StatePaths } from "./state-dir.js";

export interface AnalystInput {
  readonly tradingDay: string;
  readonly cycleIndex: number;
  readonly underlyings: readonly string[];
  /** S-CYC-12: the qualification window's prioritisation hint and cap — never a gate parameter. */
  readonly qualification: QualificationBrief;
  /**
   * P7: the very observation the gates will judge — contracts, their quotes,
   * and spot — so the analyst proposes from what the core can price. A
   * candidate outside this set is vetoed for a missing quote (S-G5-03); the
   * analyst gains no gate influence by seeing it.
   */
  readonly market: {
    readonly contracts: readonly OptionContract[];
    readonly quotesByContract: Readonly<Record<string, OptionQuote>>;
    readonly spotCentsByUnderlying: Readonly<Record<string, number>>;
  };
}

/** The dead-man check's two endpoints (S-G14-03). The runner decides which to hit through the pure `planPing`. */
export interface PingPort {
  success(deadlineAtMs?: number): Promise<void>;
  fail(conditions: readonly string[], deadlineAtMs?: number): Promise<void>;
}

export interface LifecycleDeps {
  /** `FLATTEN_DATE` (§0): the day everything must die (G11). */
  readonly flattenDate: string;
  /** The next trading session's date, from the shell's calendar (S-G9-01/02). */
  readonly nextTradingDay: string;
  /** `RESIDUE_MAX_SESSIONS` (§0): sessions until unresolved residue alarms (S-G10-02). */
  readonly residueMaxSessions: number;
  /** `CLOSE_ESCALATION_STEP` (§0): the per-cycle ladder re-price step (S-X-05). */
  readonly closeEscalationStepCents: number;
  /** True when no further cycle is scheduled before this session's close (S-G9-02, S-G11-01 assertions). */
  readonly finalCycleOfSession: boolean;
  /** Competition bootstrap only (S-CYC-09): the fully paginated provenance bundle before any order. */
  readonly provenance?: () => Promise<unknown>;
  readonly competitionStartMs?: number;
  readonly initialCapitalCents?: number;
  /** S-X-06 expiry hold: broker-confirmed protection from automatic exercise for one contract. */
  readonly confirmExerciseProtection?: (contractId: string) => Promise<boolean>;
  /** S-CYC-12: the qualifying checkpoint, window end, and loss cap (§0); absent on a dev wiring without the competition calendar. */
  readonly qualification?: QualificationConfig;
}

export interface CycleDependencies {
  readonly gateway: MutationGateway;
  /** The epoch this process acquired through `gateway.acquireAuthority`; every append and mutation carries it. */
  readonly epoch: number;
  readonly paths: StatePaths;
  readonly binding: AccountBinding;
  readonly broker: BrokerReadPort;
  readonly market: (deadlineAtMs?: number) => Promise<MarketObservation>;
  /** Returns the analyst's raw text; may throw or hang — it is invoked at most once per cycle (S-CYC-01). */
  readonly analyst: (input: AnalystInput) => Promise<string>;
  readonly analystTimeoutMs: number;
  readonly clock: () => number;
  /** Absolute shell wall-clock deadline. Every gateway action and real broker request inherits it. */
  readonly cycleDeadlineMs?: number;
  readonly calendar: DecisionSnapshot["calendar"];
  readonly tradingDay: string;
  readonly cycleIndex: number;
  readonly profile: "dev" | "competition";
  readonly decisionConfig: DecisionConfig;
  readonly executionConfig: ExecutionConfig;
  /**
   * The P5 lifecycle surface (G9–G11, G10 classification, S-CYC-08/09, the
   * ladder, the ping). `null` marks a pre-P5-scope run: the P3/P4 suites
   * exercise the executor path without the lifecycle layer; every production
   * wiring supplies the full record (decision in DECISIONS.md, P5).
   */
  readonly lifecycle: LifecycleDeps | null;
  readonly ping: PingPort | null;
  /** Production defers delivery until the aggregate cycle work has won its deadline race. */
  readonly deferPingDelivery?: boolean;
}

export interface ActionReport {
  readonly clientOrderId: string;
  readonly result: "SUBMITTED" | "VOIDED" | "NOT_SENT";
  readonly status: OutcomeStatus | null;
  readonly detail: string | null;
}

export interface KillReport {
  readonly equityCents: number;
  readonly thresholdCents: number;
  readonly haltDurable: boolean;
  readonly canceled: readonly string[];
  readonly cancelRaces: Readonly<Record<string, CancelReconciliation>>;
  readonly adopted: readonly string[];
  readonly closes: readonly string[];
  /** Attempt IDs submitted without a durable INTENT because the journal was unavailable (S-CYC-06). */
  readonly emergency: readonly string[];
  readonly flat: boolean | null;
}

export interface ManagementCloseReport {
  readonly attemptId: string;
  readonly route: string;
  readonly generation: number;
  readonly limitPriceCents: number;
  readonly atCap: boolean;
}

export interface CycleReport {
  readonly primary: "CYCLE" | "SKIP" | "BOOTSTRAP" | "GAP" | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly journalFailure: string | null;
  readonly entriesBlocked: readonly string[];
  readonly resolved: readonly { readonly clientOrderId: string; readonly result: string }[];
  readonly auditGaps: readonly string[];
  readonly analystSkip: string | null;
  readonly snapshotRejected: string | null;
  readonly actions: readonly ActionReport[];
  readonly kill: KillReport | null;
  /** P5 lifecycle surface; empty/null on a `lifecycle: null` run. */
  readonly classification: BookClassification | null;
  readonly lifecycleVetoes: readonly LifecycleVeto[];
  readonly managementCloses: readonly ManagementCloseReport[];
  readonly declaredHolds: readonly string[];
  readonly alarmConditions: readonly string[];
  readonly ping: PingPlan["kind"] | null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`analyst timeout after ${String(ms)} ms`)); }, ms);
    work.then(value => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); });
  });
}

type Fetched<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string; readonly httpStatus: number | null };

async function fetched<T>(work: () => Promise<T>): Promise<Fetched<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, error: messageOf(error), httpStatus: httpStatusOf(error) };
  }
}

function isAuthFailure<T>(result: Fetched<T>): boolean {
  return !result.ok && classifyBrokerFailure(result.httpStatus) === "AUTH_FAILURE";
}

function closeStateOf(order: BrokerOrderRecord | null): CloseAttemptSnapshot["state"] {
  if (order === null) return "confirmation_unclear";
  switch (order.status) {
    case "new":
    case "accepted":
    case "pending_new":
    case "pending_cancel":
      return "accepted";
    case "partially_filled":
    case "filled":
    case "rejected":
    case "canceled":
    case "expired":
      return order.status;
    default:
      return "confirmation_unclear";
  }
}

export async function runCycle(deps: CycleDependencies): Promise<CycleReport> {
  const { gateway, epoch, binding } = deps;
  const context = (): { readonly atIso: string; readonly epoch: number } => ({ atIso: epochMsToUtcIso(deps.clock()), epoch });
  // Held in a record, not a local, because it is assigned from nested helpers and read by control flow here.
  const failure: { journal: string | null } = { journal: null };
  const journalFailure = (): string | null => failure.journal;
  const entriesBlocked: string[] = [];
  const resolved: { clientOrderId: string; result: string }[] = [];
  const auditGaps: string[] = [];
  const actions: ActionReport[] = [];
  let kill: KillReport | null = null;
  // ---- P5 lifecycle state ----
  const alarmConditions: string[] = [];
  const lifecycleVetoes: LifecycleVeto[] = [];
  const managementCloses: ManagementCloseReport[] = [];
  let classification: BookClassification | null = null;
  let declaredHolds: readonly string[] = [];
  const appended = { durable: false };

  async function heartbeatBoundary(phase: string): Promise<void> {
    if (deps.cycleDeadlineMs === undefined) return;
    if (deps.clock() >= deps.cycleDeadlineMs) throw new Error(`CYCLE_WALLTIME_EXCEEDED before ${phase}`);
    if (!await gateway.heartbeat()) throw new Error(`WRITER_HEARTBEAT_FAILED at ${phase}`);
  }

  /** Every exit funnels here: the ping decision is pure and fires exactly once per invocation (S-G14-03). */
  async function finish(partial: Omit<CycleReport, "classification" | "lifecycleVetoes" | "managementCloses" | "declaredHolds" | "alarmConditions" | "ping">): Promise<CycleReport> {
    await heartbeatBoundary("phase 5");
    const plan = planPing({ durableAppendLanded: appended.durable && journalFailure() === null, alarmConditions });
    // A cycle under an aggregate deadline only computes the ping plan here.
    // Its composition root delivers after the work Promise wins the outer
    // deadline race; a losing background continuation can therefore never
    // emit liveness. Deadline-free test/watchdog compositions deliver here.
    if (deps.ping !== null && deps.cycleDeadlineMs === undefined && deps.deferPingDelivery !== true) {
      try {
        if (plan.kind === "success") await deps.ping.success(deps.cycleDeadlineMs);
        if (plan.kind === "fail") await deps.ping.fail(plan.conditions, deps.cycleDeadlineMs);
      } catch {
        // The check is best-effort delivery; a failed ping never blocks the cycle result.
      }
    }
    return { ...partial, classification, lifecycleVetoes, managementCloses, declaredHolds, alarmConditions, ping: deps.ping === null ? null : plan.kind };
  }

  async function append(draft: JournalDraft): Promise<boolean> {
    const result = await gateway.dispatch({ class: "authoritative", epoch, ...(deps.cycleDeadlineMs === undefined ? {} : { deadlineAtMs: deps.cycleDeadlineMs }), action: { kind: "journal_append", entry: draft } });
    if (result.ok) {
      appended.durable = true;
      return true;
    }
    failure.journal = failure.journal ?? `${String(draft["type"])}: ${result.reason}`;
    return false;
  }

  /** One durable, non-stacked halt for a P5 condition; the pure `haltDraft` decides stickiness. */
  async function haltFor(reason: RunnerHaltReason, detail: string): Promise<void> {
    if (readHaltState(deps.paths).halted) return;
    await append(haltDraft(context(), reason, detail));
  }

  async function mutate(mutation: BrokerMutation): Promise<DispatchResult> {
    const boundedMutation = deps.cycleDeadlineMs === undefined ? mutation : { ...mutation, notAfterMs: deps.cycleDeadlineMs };
    const result = await gateway.dispatch({ class: "authoritative", epoch, ...(deps.cycleDeadlineMs === undefined ? {} : { deadlineAtMs: deps.cycleDeadlineMs }), action: { kind: "broker_mutation", mutation: boundedMutation } });
    if (!result.ok && classifyBrokerFailure(result.httpStatus ?? null) === "AUTH_FAILURE") await haltForAuthFailure(result.reason);
    return result;
  }

  async function fetchBook(): Promise<Fetched<BrokerBook> & { readonly partial?: boolean }> {
    const [account, positions, openOrders] = await Promise.all([fetched(() => deps.broker.account(deps.cycleDeadlineMs)), fetched(() => deps.broker.positions(deps.cycleDeadlineMs)), fetched(() => deps.broker.openOrders(deps.cycleDeadlineMs))]);
    if (!account.ok || !positions.ok || !openOrders.ok) {
      const failed = [account, positions, openOrders].flatMap(result => (result.ok ? [] : [result]));
      const authStatus = failed.map(result => result.httpStatus).find(status => classifyBrokerFailure(status) === "AUTH_FAILURE") ?? null;
      return { ok: false, error: [account, positions, openOrders].map(result => (result.ok ? "ok" : result.error)).join("; "), httpStatus: authStatus, partial: failed.length < 3 };
    }
    return { ok: true, value: { accountId: account.value.accountId, cashCents: account.value.cashCents, equityCents: account.value.equityCents, positions: positions.value, openOrders: openOrders.value, observedAtMs: deps.clock() } };
  }

  // ---- phase 0: reconcile our own lifecycles against broker truth before any new order (S-CYC-04) ----
  await heartbeatBoundary("phase 0");
  const opened = await gateway.openJournal();
  let entries: readonly JournalEntry[] = opened.entries;
  const firstFold = assembleFold(entries);
  if (firstFold === null) return finish({ primary: null, reasonCodes: [], journalFailure: "journal lifecycles cannot be reconstructed", entriesBlocked: ["LIFECYCLE_FOLD"], resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill });

  for (const record of firstFold.lifecycles) {
    // Every lifecycle without a terminal status is re-read from the broker: an unsubmitted INTENT, a lost
    // acknowledgement (S-CYC-04), and a resting order whose asynchronous fate arrived meanwhile (S-X-04).
    if (record.state !== "intent" && record.state !== "confirmation_unclear" && record.state !== "fillable") continue;
    const lookup = await fetched(() => deps.broker.orderByClientId(record.clientOrderId, deps.cycleDeadlineMs));
    if (!lookup.ok) {
      if (isAuthFailure(lookup)) await haltForAuthFailure(lookup.error);
      entriesBlocked.push(`UNRESOLVED:${record.clientOrderId}`);
      resolved.push({ clientOrderId: record.clientOrderId, result: "UNRESOLVED" });
      continue;
    }
    const order = lookup.value;
    if (order === null && record.state === "fillable") {
      // An order the broker once confirmed as working cannot simply vanish; fail closed and keep it counted.
      entriesBlocked.push(`UNRESOLVED:${record.clientOrderId}`);
      resolved.push({ clientOrderId: record.clientOrderId, result: "VANISHED" });
      continue;
    }
    const outcomeContext: OutcomeContext = { clientOrderId: record.clientOrderId, limit: record.candidate.entryLimit, binding, epoch, atIso: context().atIso };
    const derived = order === null ? null : outcomeFromOrder(outcomeContext, order);
    if (derived === null && order !== null && record.state === "fillable") {
      resolved.push({ clientOrderId: record.clientOrderId, result: "STILL_WORKING" });
      continue;
    }
    const draft = derived === null ? entryResolutionDraft(context(), record.clientOrderId, order) : derived.draft;
    if (!await append(draft)) break;
    resolved.push({ clientOrderId: record.clientOrderId, result: derived === null ? (order === null ? "NOT_AT_BROKER" : "MATCHED_WORKING") : `OUTCOME:${derived.status}` });
    if (derived === null && order === null) entriesBlocked.push(`UNRESOLVED:${record.clientOrderId}`);
    if (derived?.fill === "BROKER_PRICE_BREACH") await haltForPriceBreach(record.clientOrderId);
  }
  // An emergency close the journal never saw (S-CYC-06): the next attempt ID of every filled lifecycle is probed at the broker.
  if (journalFailure() === null) {
    for (const record of firstFold.lifecycles) {
      if (record.state !== "filled") continue;
      const lifecycleId = closeLifecycleId(record.exposureLifecycleId, "emergency");
      const journaledGenerations = firstFold.closes.filter(close => close.closeLifecycleId === lifecycleId).map(close => close.generation);
      const nextGeneration = journaledGenerations.length === 0 ? 0 : Math.max(...journaledGenerations) + 1;
      const attemptId = closeAttemptId(lifecycleId, integerUnit(nextGeneration, "Quantity"));
      const lookup = await fetched(() => deps.broker.orderByClientId(attemptId, deps.cycleDeadlineMs));
      if (!lookup.ok || lookup.value === null) continue;
      const order = lookup.value;
      const item = {
        kind: "emergency_close",
        attemptId,
        closeLifecycleId: lifecycleId,
        exposureLifecycleId: record.exposureLifecycleId,
        generation: nextGeneration,
        legs: order.legs.map(optionLeg => {
          const known = record.candidate.legs.find(candidateLeg => candidateLeg.contractId === optionLeg.contractId);
          return { contractId: optionLeg.contractId, underlying: known?.underlying ?? record.underlying, expiry: known?.expiry ?? "", strikeCents: known?.strikeCents ?? 0, right: known?.right ?? "call", side: optionLeg.side, ratio: optionLeg.ratio };
        }),
        quantity: order.quantity,
        submittedLimit: order.limit ?? { kind: "debit", priceCents: 0 },
        brokerOrderId: order.brokerOrderId,
        status: closeStateOf(order),
        filledQuantity: order.filledQuantity,
        avgFillPriceCents: order.avgFillPriceCents,
        brokerTimestamps: order.brokerTimestamps,
        journalFailureClass: "APPEND_UNAVAILABLE",
        priorIntent: "NONE_DURABLE: the journal could not be appended when this risk-reducing close was submitted; no rationale is invented retroactively",
      };
      if (!await append(auditGapDraft(context(), [item]))) break;
      auditGaps.push(attemptId);
    }
  }
  // A journal that already failed in phase 0 blocks every entry; the cycle still takes its snapshot, because the
  // kill predicate must be evaluated and the S-CYC-06 emergency close of existing exposure must stay reachable.
  const journalDownSincePhaseZero = journalFailure() !== null;
  if (journalDownSincePhaseZero) entriesBlocked.push("JOURNAL_UNAVAILABLE");

  // ---- phase 1: one snapshot; a half-answer is an abstention (S-CYC-02) ----
  await heartbeatBoundary("phase 1");
  const [bookFetch, marketFetch] = await Promise.all([fetchBook(), fetched(() => deps.market(deps.cycleDeadlineMs))]);
  if (!bookFetch.ok || !marketFetch.ok) {
    // S-G12-06: a broker 401/403 is a credential fence — a distinguishable AUTH_FAILURE that halts, never generic
    // world unavailability. Market-data failures stay in the S-CYC-02 world classes; only the broker port fences.
    if (!bookFetch.ok && isAuthFailure(bookFetch)) await haltForAuthFailure(bookFetch.error);
    const brokerAuthFailure = entriesBlocked.includes("AUTH_FAILURE");
    const anySucceeded = (bookFetch.ok || bookFetch.partial === true) || marketFetch.ok;
    const reasonCodes: readonly ReasonCode[] = brokerAuthFailure ? ["AUTH_FAILURE"] : [anySucceeded ? "WORLD_PARTIAL" : "WORLD_UNREACHABLE"];
    // S-CYC-03: the entry is written even though no broker data exists — as soon as the append is possible.
    await append(skipDraft(context(), reasonCodes, null));
    return finish({ primary: journalFailure() === null ? "SKIP" : null, reasonCodes, journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill });
  }
  const book = bookFetch.value;
  const reopened = await gateway.openJournal();
  entries = reopened.entries;
  const halt = readHaltState(deps.paths);
  const assembled = assembleDecisionSnapshot({ broker: book, market: marketFetch.value, journal: entries, halt: halt.halted, profile: deps.profile, calendar: deps.calendar, tradingDay: deps.tradingDay, cycleIndex: deps.cycleIndex });
  if (!assembled.ok) {
    // RES-P1-01a..c: a snapshot the core would throw on never reaches `decide`; the cycle abstains and journals it.
    await append(skipDraft(context(), ["WORLD_PARTIAL"], null));
    return finish({ primary: journalFailure() === null ? "SKIP" : null, reasonCodes: ["WORLD_PARTIAL"], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: assembled.reason, actions, kill });
  }
  const { snapshot, journalSnapshot, lifecycles, closes } = assembled;

  // ---- G13 at the snapshot: the kill predicate on fresh equity ----
  if (killTriggered(book.equityCents, deps.executionConfig.killEquityThresholdCents)) {
    kill = await killManagement(book, lifecycles, closes);
    entriesBlocked.push("KILL");
  }
  if (journalDownSincePhaseZero) return finish({ primary: null, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill });

  // ---- P5: bootstrap versus gap (S-CYC-08/09), then the G10 classification of the whole book ----
  const lifecycleDeps = deps.lifecycle;
  const regime: DeadlineRegime = lifecycleDeps === null ? "normal" : deadlineRegime(deps.tradingDay, lifecycleDeps.flattenDate);
  declaredHolds = declaredExpiryHolds(entries);
  const bookVirgin = book.positions.every(position => position.quantity === 0) && book.openOrders.every(order => !isWorkingBrokerStatus(order.status));
  const primaryPlan = lifecycleDeps === null
    ? { kind: "CYCLE" as const }
    : planPrimaryEntry({ journalEmpty: entries.length === 0, bookVirgin, lastPrimaryAtMs: lastPrimaryAtMs(entries), nowMs: deps.clock(), cycleIntervalMs: deps.decisionConfig.cycleIntervalMs });

  if (primaryPlan.kind === "FOREIGN_BOOK_GAP") {
    // S-CYC-09 / GV-1 / AUS-1: a foreign book is never adopted as an opening baseline.
    await append(gapDraft(context(), journalSnapshot, primaryPlan.detail));
    classification = classifyBook(book, lifecycles, closes, []);
    await append(bookReconciliationDraft(context(), deps.tradingDay, classification));
    await haltFor("GAP", "empty journal facing a non-empty account: unknown prior state; reconcile before un-halt");
    alarmConditions.push("FOREIGN_BOOK_GAP");
    entriesBlocked.push("RECONCILIATION");
    return finish({ primary: journalFailure() === null ? "GAP" : null, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill });
  }

  let primaryType: "CYCLE" | "BOOTSTRAP" = "CYCLE";
  if (primaryPlan.kind === "BOOTSTRAP" && lifecycleDeps !== null) {
    if (deps.profile === "competition") {
      // S-CYC-09: before any order, the competition bootstrap requires the fully paginated provenance bundle.
      const bundle = lifecycleDeps.provenance === undefined ? null : await fetched(() => (lifecycleDeps.provenance as () => Promise<unknown>)());
      const verdict = bundle !== null && bundle.ok && lifecycleDeps.competitionStartMs !== undefined && lifecycleDeps.initialCapitalCents !== undefined
        ? validateCompetitionProvenance(bundle.value, { expectedAccountId: binding.accountId, competitionStartMs: lifecycleDeps.competitionStartMs, initialCapitalCents: lifecycleDeps.initialCapitalCents })
        : { ok: false as const, violations: ["provenance bundle unavailable or provenance expectations not configured"], reuseEvidence: false };
      if (!verdict.ok) {
        await append(gapDraft(context(), journalSnapshot, `competition bootstrap provenance failed closed: ${verdict.violations.join("; ")}`));
        // Reset/reuse evidence latches the irreversible provenance halt; incomplete evidence halts retryably (decision in DECISIONS.md P5).
        await haltFor(verdict.reuseEvidence ? "PROVENANCE_BROKEN" : "GAP", `competition provenance proof failed: ${verdict.violations.join("; ")}`);
        alarmConditions.push("COMPETITION_PROVENANCE_FAILED");
        entriesBlocked.push("PROVENANCE");
        return finish({ primary: journalFailure() === null ? "GAP" : null, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill });
      }
    }
    // The broker snapshot is the opening baseline; no "state then" exists and none is fabricated (S-CYC-09).
    const store = readEpochStore(deps.paths);
    await append(bootstrapDraft(context(), journalSnapshot, store.kind === "present" && store.seedPending));
    primaryType = "BOOTSTRAP";
  }

  const gapCycle = primaryPlan.kind === "GAP";
  if (primaryPlan.kind === "GAP") {
    // S-CYC-08: journal the gap (from–to, state then versus now); the invocation behaves as exactly one
    // reconciliation-focused cycle — no catch-up trading, entries resume with the next scheduled cycle.
    await append(gapDraft(context(), journalSnapshot, `GAP from ${epochMsToUtcIso(primaryPlan.sinceMs)} to ${context().atIso}: ${primaryPlan.detail}`));
    entriesBlocked.push("GAP_RECOVERY");
  }

  const unresolvedIds = entriesBlocked.filter(item => item.startsWith("UNRESOLVED:")).map(item => item.slice("UNRESOLVED:".length));
  if (lifecycleDeps !== null && primaryType !== "BOOTSTRAP") {
    classification = classifyBook(book, lifecycles, closes, unresolvedIds);
    // A declared expiry hold is a TERMINAL residue state (S-X-06): visible and not-flat, but no longer unresolved.
    const holdSet = new Set(declaredHolds);
    const unresolved = classification.nonMatched.filter(item => !(item.kind === "position" && holdSet.has(item.contractId)));
    // Our own intent-without-resolved-outcome blocks transiently through the phase-0 UNRESOLVED mechanism
    // (S-CYC-10: only a successful classification unblocks — a durable halt would demand a human instead).
    const hard = unresolved.filter(item => item.class !== "CONFIRMATION_UNCLEAR");
    if (unresolved.length > 0) {
      await append(bookReconciliationDraft(context(), deps.tradingDay, classification));
      const humans = classification.positions.filter(item => item.class === "HUMAN_ACTION");
      for (const item of humans) {
        // S-G10-05: visible to the judge as exactly that, never absorbed into agent reasoning.
        await append(humanActionDraft(context(), `manual trade detected: ${item.contractId} quantity ${String(item.quantity)}`));
      }
      if (humans.length > 0 && deps.profile === "competition") {
        await haltFor("PROVENANCE_BROKEN", "manual competition activity detected; the provenance latch is irreversible (S-G10-05, S-CYC-09)");
        alarmConditions.push("PROVENANCE_BROKEN");
      }
      if (hard.length > 0) {
        await haltFor("RESIDUE_UNRESOLVED", `unexplained broker state: ${String(hard.length)} non-MATCHED item(s); new entries halt while risk-reducing resolution continues`);
      }
      entriesBlocked.push("RECONCILIATION");
      // BEQ-9: beyond RESIDUE_MAX_SESSIONS the condition raises the active fail-signal while attempts and halt continue.
      const sessions = new Set([...unresolvedReconciliationSessions(entries), deps.tradingDay]);
      if (sessions.size > lifecycleDeps.residueMaxSessions) alarmConditions.push(`RESIDUE_UNRESOLVED_BEYOND_MAX_SESSIONS:${String(sessions.size)}`);
    }
  }

  // ---- phase 2: the analyst, at most once, bounded, never retried in-process (S-CYC-01) ----
  await heartbeatBoundary("phase 2");
  let analystSkip: string | null = null;
  let batch = parseAnalystOutput("{\"candidates\":[]}");
  const managementOnly = halt.halted || entriesBlocked.length > 0 || gapCycle;
  // ---- S-CYC-12: the qualification state at this instant (pure), its analyst brief, and its reason codes ----
  const qualificationConfig = lifecycleDeps?.qualification ?? null;
  const qualification = projectQualification(entries, deps.clock(), qualificationConfig, deps.profile);
  const qualificationCodes = qualificationReasonCodes(qualification);
  if (qualification.state === "COMPETITIVENESS_AT_RISK" || qualification.state === "WINNING_ACCEPTANCE_FAILED") alarmConditions.push(qualification.state);
  if (!managementOnly) {
    try {
      const raw = await withTimeout(deps.analyst({
        tradingDay: deps.tradingDay,
        cycleIndex: deps.cycleIndex,
        // Copies, never aliases: the analyst boundary reaches no policy array and no gate input (gate findings G1-F6, G2-F7, P7).
        underlyings: [...deps.decisionConfig.underlyingUniverse],
        qualification: structuredClone(qualificationBrief(qualification, qualificationConfig)),
        // A deep copy: the analyst boundary must not be able to reach the snapshot the gates judge (gate finding G1-F6, P7).
        market: structuredClone({ contracts: Object.values(snapshot.contractsById), quotesByContract: snapshot.quotesByContract, spotCentsByUnderlying: snapshot.spotCentsByUnderlying }),
      }), deps.cycleDeadlineMs === undefined ? deps.analystTimeoutMs : Math.max(1, Math.min(deps.analystTimeoutMs, deps.cycleDeadlineMs - deps.clock())));
      batch = parseAnalystOutput(raw);
    } catch (error) {
      analystSkip = messageOf(error);
    }
  }

  // ---- phase 3: price from the decision's own quotes, then decide ----
  await heartbeatBoundary("phase 3");
  const decision: PricedDecision = priceAndDecide(snapshot, batch, deps.decisionConfig, deps.executionConfig, deps.clock());

  // ---- P5 lifecycle entry vetoes: EXPIRY (S-G9-01) and DEADLINE (S-G11-01/02), after the gate vector ----
  let approvedActions = decision.result.actions;
  if (lifecycleDeps !== null) {
    const remaining: typeof decision.result.actions[number][] = [];
    for (const plan of decision.result.actions) {
      const candidate = decision.pricedCandidates[plan.candidateId];
      const veto = candidate === undefined ? null : lifecycleEntryVeto(candidate, { regime, nextTradingDay: lifecycleDeps.nextTradingDay });
      if (veto === null) {
        remaining.push(plan);
      } else {
        lifecycleVetoes.push(veto);
        actions.push({ clientOrderId: plan.clientOrderId, result: "NOT_SENT", status: null, detail: `${veto.code}: ${veto.reason}` });
      }
    }
    approvedActions = remaining;
  }

  // ---- S-CYC-12 qualification window: one lot, at or below the cap, one live attempt — after the unchanged gates and lifecycle vetoes ----
  if (qualification.windowOpen) {
    const remaining: typeof approvedActions[number][] = [];
    let live = liveEntryLifecycles(lifecycles).length;
    for (const plan of approvedActions) {
      const veto = qualificationEntryVeto({ candidateId: plan.candidateId, quantity: plan.quantity, reservedMaxLossCents: plan.reservedMaxLossCents }, qualification, qualificationConfig, live);
      if (veto === null) {
        remaining.push(plan);
        live += 1;
      } else {
        lifecycleVetoes.push(veto);
        actions.push({ clientOrderId: plan.clientOrderId, result: "NOT_SENT", status: null, detail: `${veto.code}: ${veto.reason}` });
      }
    }
    approvedActions = remaining;
  }

  // ---- primary entry first: the decision is recorded before any order exists (A5, A7) ----
  // A BOOTSTRAP or GAP invocation already carries its primary substitute (S-J-03: exactly one primary per invocation).
  const primaryOk = primaryType === "BOOTSTRAP" || gapCycle
    ? journalFailure() === null
    : await append(cycleDraft(context(), { cycleIndex: deps.cycleIndex, tradingDay: deps.tradingDay, journalSnapshot, decision, analystSkip, reasonCodes: qualificationCodes, lifecycleVetoes }));
  if (!primaryOk) {
    // S-CYC-06: no entry order this cycle. The only mutation that may follow is the emergency close inside kill management.
    return finish({ primary: null, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked: [...entriesBlocked, "JOURNAL_UNAVAILABLE"], resolved, auditGaps, analystSkip, snapshotRejected: null, actions, kill });
  }

  // ---- phase 4: execute every approved action through INTENT → revalidation → gateway → OUTCOME ----
  await heartbeatBoundary("phase 4");
  for (const plan of approvedActions) {
    if (entriesBlocked.length > 0 || journalFailure() !== null) {
      actions.push({ clientOrderId: plan.clientOrderId, result: "NOT_SENT", status: null, detail: entriesBlocked.length > 0 ? entriesBlocked.join(",") : journalFailure() });
      continue;
    }
    const candidate = decision.pricedCandidates[plan.candidateId];
    const verdict = decision.result.candidateVerdicts.find(item => item.candidateId === plan.candidateId);
    if (candidate === undefined || verdict === undefined) {
      actions.push({ clientOrderId: plan.clientOrderId, result: "NOT_SENT", status: null, detail: "plan without priced candidate" });
      continue;
    }
    if (!await append(intentDraft(context(), plan, candidate, verdict, snapshot, binding))) {
      actions.push({ clientOrderId: plan.clientOrderId, result: "NOT_SENT", status: null, detail: journalFailure() });
      continue;
    }
    // S-CYC-05: refetch broker truth and re-check every claim the verdict rested on.
    const claimset = buildClaimset(plan, book, binding, epoch, deps.executionConfig);
    const freshBook = await fetchBook();
    // S-G12-06 (P4 gate finding G1-F1): a 401/403 on the re-check fetch is the credential fence, not generic
    // revalidation evidence — the halt lands here, the void below still documents the failed claims, and the
    // AUTH_FAILURE block keeps every later plan of this cycle from reaching the port.
    if (!freshBook.ok && isAuthFailure(freshBook)) await haltForAuthFailure(freshBook.error);
    const refreshed = await gateway.openJournal();
    const store = readEpochStore(deps.paths);
    const freshHalt = readHaltState(deps.paths);
    const evidenceBook: BrokerBook = freshBook.ok ? freshBook.value : { ...book, accountId: "" };
    const reassembled = assembleDecisionSnapshot({ broker: evidenceBook, market: marketFetch.value, journal: refreshed.entries, halt: freshHalt.halted, profile: deps.profile, calendar: deps.calendar, tradingDay: deps.tradingDay, cycleIndex: deps.cycleIndex });
    const recheck = reassembled.ok
      ? decide(reassembled.snapshot, { kind: "candidates", candidates: [candidate] }, deps.decisionConfig, deps.clock())
      : { batchVerdicts: [], candidateVerdicts: [], actions: [] };
    const verdictNow = revalidateClaimset(claimset, {
      book: evidenceBook,
      brokerReportedAccountId: freshBook.ok ? freshBook.value.accountId : undefined,
      epoch: store.kind === "present" && !store.resetPending ? store.epoch : null,
      halted: freshHalt.halted,
      recheck,
    });
    if (!verdictNow.ok) {
      await append(revalidationVoidDraft(context(), claimset, verdictNow.violated));
      actions.push({ clientOrderId: plan.clientOrderId, result: "VOIDED", status: null, detail: verdictNow.violated.map(claim => claim.claim).join(",") });
      if (verdictNow.killTriggered && kill === null && freshBook.ok) {
        // The freshest possible evidence of a kill state runs S-G13-01 in this same cycle (KGV-5).
        kill = await killManagement(freshBook.value, lifecycles, closes);
        entriesBlocked.push("KILL");
      }
      continue;
    }
    const payload: SubmitPayload = { legs: plan.legs, quantity: plan.quantity, limit: plan.submittedLimit, intent: "entry" };
    const dispatched = await mutate({ kind: "submit_order", clientOrderId: plan.clientOrderId, binding, payload });
    const outcomeContext: OutcomeContext = { clientOrderId: plan.clientOrderId, limit: plan.submittedLimit, binding, epoch, atIso: context().atIso };
    const observation = await submitObservation(dispatched, plan.clientOrderId);
    if (observation === null) {
      actions.push({ clientOrderId: plan.clientOrderId, result: "NOT_SENT", status: null, detail: dispatched.ok ? null : dispatched.reason });
      continue;
    }
    let derived = outcomeFromSubmit(outcomeContext, observation);
    if (derived === null) {
      // Post-submit status check (S-X-04): an asynchronous rejection or fill that arrived meanwhile is picked up now.
      const later = await fetched(() => deps.broker.orderByClientId(plan.clientOrderId, deps.cycleDeadlineMs));
      if (later.ok && later.value !== null) derived = outcomeFromOrder({ ...outcomeContext, atIso: context().atIso }, later.value);
    }
    if (derived !== null) await append(derived.draft);
    actions.push({ clientOrderId: plan.clientOrderId, result: "SUBMITTED", status: derived?.status ?? null, detail: derived === null ? "working" : null });
    // S-CYC-04 applies inside the batch too. If the port answer cannot prove
    // whether this submit exists at the broker, no sibling plan may cross the
    // gateway until a later cycle's phase 0 reconciles this exact client ID.
    if (derived?.status === "confirmation_unclear" && !entriesBlocked.includes("CONFIRMATION_UNCLEAR")) entriesBlocked.push("CONFIRMATION_UNCLEAR");
    if (derived?.fill === "BROKER_PRICE_BREACH") {
      await haltForPriceBreach(plan.clientOrderId);
      entriesBlocked.push("BROKER_PRICE_BREACH");
    }
  }

  // ---- P5 management actions: eviction (G9), deadline flatten (G11), residue recovery (G10/S-X-06).
  // They are management actions: they run under halt (S-G12-03) and on Friday (S-G9-03). ----
  if (lifecycleDeps !== null && journalFailure() === null && primaryType !== "BOOTSTRAP") {
    await runManagementActions(lifecycleDeps);
  }

  return finish({ primary: gapCycle ? "GAP" : primaryType, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip, snapshotRejected: null, actions, kill });

  // ---- helpers bound to this cycle ----

  /** S-X-02: a broker record worse than the submitted limit is impossible for a limit order; new entries stop until a human reconciles. */
  async function haltForPriceBreach(clientOrderId: string): Promise<void> {
    if (readHaltState(deps.paths).halted) return;
    await append(haltDraft(context(), "BROKER_PRICE_BREACH", `${clientOrderId}: broker fill worse than the submitted limit; actual exposure reserved; reconcile before un-halt`));
  }

  /** S-G12-06: an auth failure blocks all orders; re-arm only under halt, after full reconciliation and the documented fence procedure. */
  async function haltForAuthFailure(detail: string): Promise<void> {
    if (!entriesBlocked.includes("AUTH_FAILURE")) entriesBlocked.push("AUTH_FAILURE");
    if (readHaltState(deps.paths).halted) return;
    await append(haltDraft(context(), "AUTH_FAILURE", `broker credential rejected (401/403): ${detail}; all orders blocked; run the fence procedure (working-order check/cancel in the broker dashboard) before un-halt`));
  }

  function assembleFold(journal: readonly JournalEntry[]): { readonly lifecycles: readonly EntryLifecycleRecord[]; readonly closes: readonly CloseAttemptRecord[] } | null {
    const assembly = assembleDecisionSnapshot({
      broker: { accountId: binding.accountId, cashCents: 0, equityCents: 0, positions: [], openOrders: [], observedAtMs: deps.clock() },
      market: { quotesByContract: {}, contractsById: {}, spotCentsByUnderlying: {} },
      journal,
      halt: false,
      profile: deps.profile,
      calendar: deps.calendar,
      tradingDay: deps.tradingDay,
      cycleIndex: deps.cycleIndex,
    });
    return assembly.ok ? { lifecycles: assembly.lifecycles, closes: assembly.closes } : null;
  }

  async function submitObservation(dispatched: DispatchResult, clientOrderId: string): Promise<SubmitObservation | null> {
    const lookup = async (): Promise<BrokerOrderRecord | null> => {
      const found = await fetched(() => deps.broker.orderByClientId(clientOrderId, deps.cycleDeadlineMs));
      return found.ok ? found.value : null;
    };
    if (dispatched.ok) {
      if (!("broker" in dispatched)) return null;
      if (dispatched.broker.ok) {
        const order = await lookup();
        return order === null ? { kind: "acknowledgement_lost", detail: "acknowledged but not found on read-back" } : { kind: "acknowledged", order };
      }
      return { kind: "acknowledgement_lost", detail: dispatched.broker.reason };
    }
    // The gateway refused before the port: nothing was sent.
    if (dispatched.source !== "broker_port") return null;
    if (dispatched.reason.startsWith("REJECTED:")) return { kind: "rejected", brokerReason: dispatched.reason.slice("REJECTED:".length), brokerTimestamps: { rejected_at: epochMsToUtcIso(deps.clock()) } };
    if (dispatched.reason === "DUPLICATE_CLIENT_ORDER_ID") return { kind: "duplicate", order: await lookup() };
    // A thrown port error or any other answer: the order may exist; only broker truth can say (S-CYC-04).
    return { kind: "acknowledgement_lost", detail: dispatched.reason };
  }

  async function closeLifecycleSnapshot(exposureLifecycleId: string, route: CloseLifecycleSnapshot["route"], currentExposure: Quantity, journaledCloses: readonly CloseAttemptRecord[]): Promise<CloseLifecycleSnapshot> {
    const lifecycleId = closeLifecycleId(exposureLifecycleId, route);
    const attempts: CloseAttemptSnapshot[] = [];
    const generations = journaledCloses.filter(close => close.closeLifecycleId === lifecycleId).map(close => close.generation);
    const highest = generations.length === 0 ? -1 : Math.max(...generations);
    // Every journaled generation plus the next one (an unjournaled emergency attempt) is reloaded from the broker.
    for (let generation = 0; generation <= highest + 1; generation += 1) {
      const attemptId = closeAttemptId(lifecycleId, integerUnit(generation, "Quantity"));
      const known = journaledCloses.find(close => close.attemptId === attemptId);
      const lookup = await fetched(() => deps.broker.orderByClientId(attemptId, deps.cycleDeadlineMs));
      const order = lookup.ok ? lookup.value : null;
      if (known === undefined && order === null) continue;
      attempts.push({
        attemptId,
        generation: integerUnit(generation, "Quantity"),
        requestedQuantity: integerUnit(order?.quantity ?? known?.quantity ?? 0, "Quantity"),
        filledQuantity: integerUnit(order?.filledQuantity ?? known?.filledQuantity ?? 0, "Quantity"),
        state: order === null && known !== undefined && known.status !== "submitted" ? known.status : closeStateOf(order),
      });
    }
    return { exposureLifecycleId, route, currentExposureQuantity: currentExposure, attempts };
  }

  async function submitClose(target: FlattenTarget, route: CloseLifecycleSnapshot["route"], legs: readonly OptionLeg[], quantity: Quantity, book: BrokerBook, journaledCloses: readonly CloseAttemptRecord[], journalAvailable: boolean): Promise<{ readonly attemptId: string | null; readonly emergency: boolean }> {
    const lifecycle = await closeLifecycleSnapshot(target.exposureLifecycleId, route, quantity, journaledCloses);
    const plan = planCloseLifecycle(lifecycle);
    if (plan.kind !== "SUBMIT") return { attemptId: plan.kind === "ADOPT" ? plan.attemptId : null, emergency: false };
    const quotes = assembled.ok ? assembled.snapshot.quotesByContract : {};
    const priced = priceCloseLimit(legs, quotes, deps.executionConfig);
    if (!priced.ok) return { attemptId: null, emergency: false };
    const eligibility = emergencyCloseEligibility(book.positions, legs.map(optionLeg => ({ contractId: optionLeg.contractId, side: optionLeg.side, quantity: optionLeg.ratio * plan.quantity })));
    if (!eligibility.eligible) return { attemptId: null, emergency: false };
    if (journalAvailable) {
      const ok = await append(closeIntentDraft(context(), { exposureLifecycleId: target.exposureLifecycleId, route, generation: plan.generation, closingLegs: legs, quantity: plan.quantity, limit: priced.limit, reason: `${route} close of ${target.exposureLifecycleId}: kill predicate breached` }, binding));
      if (!ok) return { attemptId: null, emergency: false };
    }
    const payload: SubmitPayload = { legs, quantity: plan.quantity, limit: priced.limit, intent: "close" };
    const dispatched = await mutate({ kind: "submit_order", clientOrderId: plan.attemptId, binding, payload });
    if (!dispatched.ok && dispatched.source !== "broker_port") return { attemptId: null, emergency: false };
    if (journalAvailable) {
      const observation = await submitObservation(dispatched, plan.attemptId);
      const derived = observation === null ? null : outcomeFromSubmit({ clientOrderId: plan.attemptId, limit: priced.limit, binding, epoch, atIso: context().atIso }, observation);
      if (derived !== null) await append(derived.draft);
    }
    return { attemptId: plan.attemptId, emergency: !journalAvailable };
  }

  async function refreshCloses(previous: readonly CloseAttemptRecord[]): Promise<readonly CloseAttemptRecord[]> {
    const fold = assembleFold((await gateway.openJournal()).entries);
    return fold?.closes ?? previous;
  }

  /**
   * One S-X-05 ladder step for one close lifecycle: adopt-and-re-price (the
   * resting attempt is canceled, the race reconciled by broker record, and
   * the next generation submitted one escalation step further) or a first
   * submission at the generation's escalated price. Every re-price lands as
   * its own close INTENT; reaching the cap halts and alarms while the order
   * rests AT the cap. The ladder never opens exposure: every submission
   * passes `emergencyCloseEligibility` against broker positions.
   */
  async function ladderClose(exposureLifecycleId: string, closingLegs: readonly OptionLeg[], quantity: Quantity, route: "expiry" | "deadline" | "residue", cap: CloseCap, journaledCloses: readonly CloseAttemptRecord[], reason: string, stepCents: number): Promise<{ readonly attemptId: string | null; readonly atCap: boolean }> {
    let closesNow = journaledCloses;
    let exposureNow = quantity;
    const lifecycleSnap = await closeLifecycleSnapshot(exposureLifecycleId, route, exposureNow, closesNow);
    let plan = planCloseLifecycle(lifecycleSnap);
    if (plan.kind === "COMPLETE" || plan.kind === "VETO") return { attemptId: null, atCap: false };
    if (plan.kind === "ADOPT") {
      const restingId = plan.attemptId;
      await mutate({ kind: "cancel_order", clientOrderId: restingId, binding });
      const after = await fetched(() => deps.broker.orderByClientId(restingId, deps.cycleDeadlineMs));
      const record = after.ok ? after.value : null;
      const reconciliation = reconcileCancel(record);
      if (record !== null) {
        const known = closesNow.find(close => close.attemptId === restingId);
        const limit = known?.limit ?? record.limit ?? { kind: "debit" as const, priceCents: 0 };
        const derived = outcomeFromOrder({ clientOrderId: restingId, limit, binding, epoch, atIso: context().atIso }, record);
        if (derived !== null) await append(derived.draft);
      }
      // A fill during the cancel reduced the exposure through its own OUTCOME; an unclear cancel keeps the
      // attempt counted as fillable — no parallel child is ever created (S-G7, S-X-05).
      if (reconciliation === "CANCEL_UNCLEAR" || reconciliation === "FILLED_DURING_CANCEL") return { attemptId: restingId, atCap: false };
      const filledMeanwhile = record?.filledQuantity ?? 0;
      const remaining = Math.max(exposureNow - filledMeanwhile, 0);
      if (remaining === 0) return { attemptId: restingId, atCap: false };
      exposureNow = integerUnit(remaining, "Quantity");
      closesNow = await refreshCloses(closesNow);
      const reSnap = await closeLifecycleSnapshot(exposureLifecycleId, route, exposureNow, closesNow);
      plan = planCloseLifecycle(reSnap);
      if (plan.kind !== "SUBMIT") return { attemptId: restingId, atCap: false };
    }
    const priced = cap.kind === "uncapped_marketable"
      ? marketableCloseLimit(closingLegs, snapshot.quotesByContract, plan.generation, stepCents)
      : escalateCloseLimit(closingLegs, snapshot.quotesByContract, plan.generation, stepCents, cap);
    if (!priced.ok) return { attemptId: null, atCap: false };
    const eligibility = emergencyCloseEligibility(book.positions, closingLegs.map(optionLeg => ({ contractId: optionLeg.contractId, side: optionLeg.side, quantity: optionLeg.ratio * plan.quantity })));
    if (!eligibility.eligible) return { attemptId: null, atCap: false };
    if (priced.atCap) {
      alarmConditions.push(`CLOSE_LADDER_AT_CAP:${plan.attemptId}`);
      await haltFor("CLOSE_LADDER_CAPPED", `${exposureLifecycleId}: the escalated close rests AT its defined-risk cap; attempts continue at the cap (S-X-05)`);
    }
    if (!await append(closeIntentDraft(context(), { exposureLifecycleId, route, generation: plan.generation, closingLegs, quantity: plan.quantity, limit: priced.limit, reason: `${reason} [generation ${String(plan.generation)}]` }, binding))) {
      return { attemptId: null, atCap: priced.atCap };
    }
    const payload: SubmitPayload = { legs: closingLegs, quantity: plan.quantity, limit: priced.limit, intent: "close" };
    const dispatched = await mutate({ kind: "submit_order", clientOrderId: plan.attemptId, binding, payload });
    const observation = await submitObservation(dispatched, plan.attemptId);
    const derived = observation === null ? null : outcomeFromSubmit({ clientOrderId: plan.attemptId, limit: priced.limit, binding, epoch, atIso: context().atIso }, observation);
    if (derived !== null) await append(derived.draft);
    managementCloses.push({ attemptId: plan.attemptId, route, generation: plan.generation, limitPriceCents: priced.limit.priceCents, atCap: priced.atCap });
    return { attemptId: plan.attemptId, atCap: priced.atCap };
  }

  /** Eviction (S-G9-02), deadline flatten (S-G11-01/02), and residue recovery (S-G10-02/03, S-X-06) — every cycle, also under halt. */
  async function runManagementActions(lifecycle: LifecycleDeps): Promise<void> {
    const step = lifecycle.closeEscalationStepCents;
    const journalNow = assembleFold((await gateway.openJournal()).entries);
    const lifecyclesNow = journalNow?.lifecycles ?? lifecycles;
    let closesNow = journalNow?.closes ?? closes;
    const holds = new Set(declaredHolds);

    if (regime === "normal") {
      // S-G9-02: whole-structure eviction closes, regardless of P&L, tracked to a terminal state via the ladder.
      const targets = evictionTargets(book, lifecyclesNow, lifecycle.nextTradingDay);
      for (const target of targets) {
        await ladderClose(target.record.exposureLifecycleId, target.closingLegs, target.quantity, "expiry", closeCapFor(target.record.candidate), closesNow, `expiry eviction of ${target.record.exposureLifecycleId}: expiry at or before the next trading session ${lifecycle.nextTradingDay}`, step);
        closesNow = await refreshCloses(closesNow);
      }
      if (targets.length > 0 && lifecycle.finalCycleOfSession) {
        const fresh = await fetchBook();
        const still = fresh.ok ? evictionTargets(fresh.value, lifecyclesNow, lifecycle.nextTradingDay) : targets;
        if (still.length > 0) {
          await haltFor("EXPIRY_EVICTION_STUCK", "an eviction close is still unfilled with no further cycle before this session's close; attempts continue (S-G9-02)");
          alarmConditions.push("EXPIRY_EVICTION_UNFILLED_AT_SESSION_CLOSE");
        }
      }
    } else {
      // S-G11-01: cancel every working order that could increase risk; resting closes are re-priced by the ladder itself.
      for (const order of book.openOrders) {
        if (!isWorkingBrokerStatus(order.status) || classifyWorkingOrder(order, book.positions) !== "risk_increasing") continue;
        await mutate({ kind: "cancel_order", clientOrderId: order.clientOrderId, binding });
        const after = await fetched(() => deps.broker.orderByClientId(order.clientOrderId, deps.cycleDeadlineMs));
        const record = after.ok ? after.value : null;
        const entryRecord = lifecyclesNow.find(item => item.clientOrderId === order.clientOrderId);
        if (record !== null && entryRecord !== undefined) {
          const derived = outcomeFromOrder({ clientOrderId: order.clientOrderId, limit: entryRecord.candidate.entryLimit, binding, epoch, atIso: context().atIso }, record);
          if (derived !== null) await append(derived.draft);
        }
      }
      // S-G11-01/02: whole-structure closes for every open position — from the first FLATTEN_DATE cycle onward,
      // and on Friday as the journaled failure path when Thursday did not end flat. Never leg-wise on intact structures.
      const closure = planBookClosure(book, lifecyclesNow);
      for (const structure of closure.intact) {
        await ladderClose(structure.record.exposureLifecycleId, structure.closingLegs, structure.quantity, "deadline", closeCapFor(structure.record.candidate), closesNow, `${regime === "flatten" ? "FLATTEN_DATE" : "post-deadline failure-path"} whole-structure close of ${structure.record.exposureLifecycleId}`, step);
        closesNow = await refreshCloses(closesNow);
      }
    }

    // G10 residue recovery with the S-X-06 discrimination — leg-wise, because the structure is already broken.
    for (const item of classification?.positions ?? []) {
      if (item.class === "MATCHED" || holds.has(item.contractId)) continue;
      const position: BrokerPosition = { contractId: item.contractId, quantity: item.quantity, avgEntryPriceCents: 0 };
      const journaledUnderlyings = new Set(lifecyclesNow.map(record => record.underlying));
      const closingLeg = residueClosingLeg(position, lifecyclesNow.flatMap(record => record.candidate.legs), journaledUnderlyings);
      if (closingLeg === null) continue; // a foreign contract without metadata stays halted for the human (S-G10-02: a genuine "developer must look" state)
      const absQuantity = integerUnit(Math.abs(item.quantity), "Quantity");
      if (item.residueKind === "bounded_long") {
        // The narrow expiry-hold exception (S-X-06/KGV-7): full same-cycle proof ends escalation, not hope.
        const contract = Object.hasOwn(snapshot.contractsById, item.contractId) ? snapshot.contractsById[item.contractId] : undefined;
        if (contract !== undefined) {
          const quote = Object.hasOwn(snapshot.quotesByContract, item.contractId) ? snapshot.quotesByContract[item.contractId] : undefined;
          const spot = Object.hasOwn(snapshot.spotCentsByUnderlying, contract.underlying) ? snapshot.spotCentsByUnderlying[contract.underlying] : undefined;
          const paired = (classification?.positions ?? []).some(other => {
            if (other.contractId === item.contractId || other.quantity >= 0) return false;
            const otherContract = Object.hasOwn(snapshot.contractsById, other.contractId) ? snapshot.contractsById[other.contractId] : undefined;
            const otherUnderlying = otherContract?.underlying ?? other.contractId;
            return otherUnderlying === contract.underlying;
          });
          const protection = lifecycle.confirmExerciseProtection === undefined ? false : await lifecycle.confirmExerciseProtection(item.contractId);
          const holdVerdict = evaluateExpiryHold({ contract, quantity: item.quantity, quote: quote ?? null, spotCents: spot ?? null, pairedShortOrLiability: paired, exerciseProtectionConfirmed: protection }, deps.clock(), deps.decisionConfig.quoteMaxAgeMs);
          if (holdVerdict.ok) {
            if (await append(expiryHoldDraft(context(), holdVerdict.proof))) {
              declaredHolds = [...declaredHolds, item.contractId];
              continue; // the fail-ping lifts for this item; the position stays broker-visible and every judge surface says not-flat
            }
          }
        }
        await ladderClose(`residue:${item.contractId}`, [closingLeg], absQuantity, "residue", { kind: "zero_floor" }, closesNow, `bounded long residue close of ${item.contractId} (zero-floor ladder, S-G10-03)`, step);
      } else {
        // S-X-06: the realized cost MAY exceed the original maxLoss — the journaled assignment exception to A23's constructive worst case.
        alarmConditions.push(`UNBOUNDED_RESIDUE_RECOVERY:${item.contractId}`);
        await ladderClose(`residue:${item.contractId}`, [closingLeg], absQuantity, "residue", { kind: "uncapped_marketable" }, closesNow, `unbounded short residue of ${item.contractId}: requoted marketable-limit close with no price cap (S-X-06 assignment exception to A23's constructive worst case)`, step);
      }
      closesNow = await refreshCloses(closesNow);
    }

    // S-G11-01: by Thursday close the assertion is zero risk-bearing positions AND zero non-terminal orders.
    if (regime === "flatten" && lifecycle.finalCycleOfSession) {
      const fresh = await fetchBook();
      if (fresh.ok) {
        const assertion = assertFlattened(fresh.value, declaredHolds);
        if (!assertion.satisfied) {
          await haltFor("DEADLINE_FLATTEN_FAILED", `Thursday flatten assertion failed: ${assertion.violations.join("; ")}`);
          alarmConditions.push("DEADLINE_FLATTEN_FAILED");
        }
      }
    }
  }

  /**
   * S-G13-01 under the valid fence: sticky halt first, then cancel every
   * risk-increasing working order, reconcile the cancel/fill races by broker
   * ID, reload, flatten the post-cancel book through the close lifecycle, and
   * journal KILL only when broker truth shows flat. If the halt cannot be made
   * durable the journal is unavailable and only the S-CYC-06 emergency close
   * of existing exposure may follow — never an entry.
   */
  async function killManagement(startBook: BrokerBook, lifecycleRecords: readonly EntryLifecycleRecord[], journaledCloses: readonly CloseAttemptRecord[]): Promise<KillReport> {
    const threshold = deps.executionConfig.killEquityThresholdCents;
    const haltDurable = await append(haltDraft(context(), "KILL", `equity ${String(startBook.equityCents)} below KILL_EQUITY_THRESHOLD ${String(threshold)}; kill management: cancel risk-increasing orders, then flatten`));
    const journalAvailable = haltDurable;
    const plan = planKillManagement(startBook, lifecycleRecords);
    const canceled: string[] = [];
    const cancelRaces: Record<string, CancelReconciliation> = {};
    const raceItems: Record<string, unknown>[] = [];
    // G1-F1 (P3 gate): a cancel is a broker mutation that would leave no durable record while the journal is down, and
    // it is not the S-CYC-06 exception (a close of existing exposure through the S-G7 lifecycle). Without a durable HALT
    // the resting entry stays untouched — it remains counted as fillable exposure — and is canceled by the next cycle
    // that can journal the kill. Only the emergency close may follow below.
    for (const clientOrderId of journalAvailable ? plan.cancel : []) {
      const dispatched = await mutate({ kind: "cancel_order", clientOrderId, binding });
      const after = await fetched(() => deps.broker.orderByClientId(clientOrderId, deps.cycleDeadlineMs));
      const reconciliation = reconcileCancel(after.ok ? after.value : null);
      cancelRaces[clientOrderId] = reconciliation;
      if (reconciliation === "CANCELED") canceled.push(clientOrderId);
      const record = after.ok ? after.value : null;
      raceItems.push({ kind: "kill_cancel", clientOrderId, brokerOrderId: record?.brokerOrderId ?? null, reconciliation, status: record?.status ?? null, filledQuantity: record?.filledQuantity ?? null, avgFillPriceCents: record?.avgFillPriceCents ?? null, brokerTimestamps: record?.brokerTimestamps ?? {}, dispatched: dispatched.ok ? "ok" : dispatched.reason });
      // A filled-during-cancel entry becomes journaled exposure through its own OUTCOME.
      if (record !== null && (reconciliation === "FILLED_DURING_CANCEL" || reconciliation === "PARTIALLY_FILLED_DURING_CANCEL" || reconciliation === "CANCELED")) {
        const entryRecord = lifecycleRecords.find(item => item.clientOrderId === clientOrderId);
        if (entryRecord !== undefined && journalAvailable) {
          const derived = outcomeFromOrder({ clientOrderId, limit: entryRecord.candidate.entryLimit, binding, epoch, atIso: context().atIso }, record);
          if (derived !== null) await append(derived.draft);
        }
      }
    }
    if (journalAvailable && raceItems.length > 0) await append(cancelReconciliationDraft(context(), raceItems));

    // Reload broker truth and the journal: the post-cancel book decides what is flattened.
    const reloaded = await fetchBook();
    const bookNow = reloaded.ok ? reloaded.value : startBook;
    const journalNow = journalAvailable ? assembleFold((await gateway.openJournal()).entries) : null;
    const recordsNow = journalNow?.lifecycles ?? lifecycleRecords;
    const closesNow = journalNow?.closes ?? journaledCloses;
    const planNow = planKillManagement(bookNow, recordsNow);
    const closes: string[] = [];
    const emergency: string[] = [];
    for (const target of planNow.flatten) {
      const submitted = await submitClose(target, journalAvailable ? "kill" : "emergency", target.closingLegs, target.quantity, bookNow, closesNow, journalAvailable);
      if (submitted.attemptId !== null) (submitted.emergency ? emergency : closes).push(submitted.attemptId);
    }
    for (const residue of planNow.residue) {
      const side = residue.quantity > 0 ? "sell" : "buy";
      const known = recordsNow.flatMap(record => record.candidate.legs).find(optionLeg => optionLeg.contractId === residue.contractId);
      if (known === undefined) continue;
      const residueLeg: OptionLeg = { ...known, side };
      const target: FlattenTarget = { exposureLifecycleId: `residue:${residue.contractId}`, route: "kill", closingLegs: [residueLeg], quantity: integerUnit(Math.abs(residue.quantity), "Quantity") };
      const submitted = await submitClose(target, journalAvailable ? "kill" : "emergency", [residueLeg], target.quantity, bookNow, closesNow, journalAvailable);
      if (submitted.attemptId !== null) (submitted.emergency ? emergency : closes).push(submitted.attemptId);
    }
    const finalBook = await fetchBook();
    const flat = finalBook.ok ? isBookFlat(finalBook.value) : null;
    if (flat === true && journalAvailable) await append(killDraft(context(), startBook.equityCents, threshold));
    return { equityCents: startBook.equityCents, thresholdCents: threshold, haltDurable, canceled, cancelRaces, adopted: planNow.adopt, closes, emergency, flat };
  }
}

/** Convenience for tests and drivers: a plan's submit payload as the gateway carries it. */
export function entryPayload(plan: EntryActionPlan): SubmitPayload {
  return { legs: plan.legs, quantity: plan.quantity, limit: plan.submittedLimit, intent: "entry" };
}
