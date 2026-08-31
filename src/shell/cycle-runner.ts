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
import type { CloseAttemptSnapshot, CloseLifecycleSnapshot, DecisionSnapshot, DecisionConfig, EntryActionPlan, OptionLeg, Quantity } from "../core/domain.js";
import {
  assembleDecisionSnapshot,
  auditGapDraft,
  buildClaimset,
  cancelReconciliationDraft,
  closeIntentDraft,
  cycleDraft,
  emergencyCloseEligibility,
  entryResolutionDraft,
  epochMsToUtcIso,
  haltDraft,
  intentDraft,
  isBookFlat,
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
  CancelReconciliation,
  CloseAttemptRecord,
  EntryLifecycleRecord,
  ExecutionConfig,
  FlattenTarget,
  MarketObservation,
  OutcomeContext,
  PricedDecision,
  SubmitObservation,
} from "../core/execution.js";
import type { AccountBinding, JournalDraft, JournalEntry, OutcomeStatus, ReasonCode } from "../core/journal.js";
import { closeAttemptId, closeLifecycleId, planCloseLifecycle } from "../core/order-identity.js";
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
}

export interface CycleDependencies {
  readonly gateway: MutationGateway;
  /** The epoch this process acquired through `gateway.acquireAuthority`; every append and mutation carries it. */
  readonly epoch: number;
  readonly paths: StatePaths;
  readonly binding: AccountBinding;
  readonly broker: BrokerReadPort;
  readonly market: () => Promise<MarketObservation>;
  /** Returns the analyst's raw text; may throw or hang — it is invoked at most once per cycle (S-CYC-01). */
  readonly analyst: (input: AnalystInput) => Promise<string>;
  readonly analystTimeoutMs: number;
  readonly clock: () => number;
  readonly calendar: DecisionSnapshot["calendar"];
  readonly tradingDay: string;
  readonly cycleIndex: number;
  readonly profile: "dev" | "competition";
  readonly decisionConfig: DecisionConfig;
  readonly executionConfig: ExecutionConfig;
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

export interface CycleReport {
  readonly primary: "CYCLE" | "SKIP" | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly journalFailure: string | null;
  readonly entriesBlocked: readonly string[];
  readonly resolved: readonly { readonly clientOrderId: string; readonly result: string }[];
  readonly auditGaps: readonly string[];
  readonly analystSkip: string | null;
  readonly snapshotRejected: string | null;
  readonly actions: readonly ActionReport[];
  readonly kill: KillReport | null;
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

  async function append(draft: JournalDraft): Promise<boolean> {
    const result = await gateway.dispatch({ class: "authoritative", epoch, action: { kind: "journal_append", entry: draft } });
    if (result.ok) return true;
    failure.journal = failure.journal ?? `${String(draft["type"])}: ${result.reason}`;
    return false;
  }

  async function mutate(mutation: BrokerMutation): Promise<DispatchResult> {
    return gateway.dispatch({ class: "authoritative", epoch, action: { kind: "broker_mutation", mutation } });
  }

  async function fetchBook(): Promise<Fetched<BrokerBook> & { readonly partial?: boolean }> {
    const [account, positions, openOrders] = await Promise.all([fetched(() => deps.broker.account()), fetched(() => deps.broker.positions()), fetched(() => deps.broker.openOrders())]);
    if (!account.ok || !positions.ok || !openOrders.ok) {
      const failed = [account, positions, openOrders].flatMap(result => (result.ok ? [] : [result]));
      const authStatus = failed.map(result => result.httpStatus).find(status => classifyBrokerFailure(status) === "AUTH_FAILURE") ?? null;
      return { ok: false, error: [account, positions, openOrders].map(result => (result.ok ? "ok" : result.error)).join("; "), httpStatus: authStatus, partial: failed.length < 3 };
    }
    return { ok: true, value: { accountId: account.value.accountId, cashCents: account.value.cashCents, equityCents: account.value.equityCents, positions: positions.value, openOrders: openOrders.value, observedAtMs: deps.clock() } };
  }

  // ---- phase 0: reconcile our own lifecycles against broker truth before any new order (S-CYC-04) ----
  const opened = await gateway.openJournal();
  let entries: readonly JournalEntry[] = opened.entries;
  const firstFold = assembleFold(entries);
  if (firstFold === null) return { primary: null, reasonCodes: [], journalFailure: "journal lifecycles cannot be reconstructed", entriesBlocked: ["LIFECYCLE_FOLD"], resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill };

  for (const record of firstFold.lifecycles) {
    // Every lifecycle without a terminal status is re-read from the broker: an unsubmitted INTENT, a lost
    // acknowledgement (S-CYC-04), and a resting order whose asynchronous fate arrived meanwhile (S-X-04).
    if (record.state !== "intent" && record.state !== "confirmation_unclear" && record.state !== "fillable") continue;
    const lookup = await fetched(() => deps.broker.orderByClientId(record.clientOrderId));
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
      const lookup = await fetched(() => deps.broker.orderByClientId(attemptId));
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
  const [bookFetch, marketFetch] = await Promise.all([fetchBook(), fetched(() => deps.market())]);
  if (!bookFetch.ok || !marketFetch.ok) {
    // S-G12-06: a broker 401/403 is a credential fence — a distinguishable AUTH_FAILURE that halts, never generic
    // world unavailability. Market-data failures stay in the S-CYC-02 world classes; only the broker port fences.
    if (!bookFetch.ok && isAuthFailure(bookFetch)) await haltForAuthFailure(bookFetch.error);
    const brokerAuthFailure = entriesBlocked.includes("AUTH_FAILURE");
    const anySucceeded = (bookFetch.ok || bookFetch.partial === true) || marketFetch.ok;
    const reasonCodes: readonly ReasonCode[] = brokerAuthFailure ? ["AUTH_FAILURE"] : [anySucceeded ? "WORLD_PARTIAL" : "WORLD_UNREACHABLE"];
    await append(skipDraft(context(), reasonCodes, null));
    return { primary: journalFailure() === null ? "SKIP" : null, reasonCodes, journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill };
  }
  const book = bookFetch.value;
  const reopened = await gateway.openJournal();
  entries = reopened.entries;
  const halt = readHaltState(deps.paths);
  const assembled = assembleDecisionSnapshot({ broker: book, market: marketFetch.value, journal: entries, halt: halt.halted, profile: deps.profile, calendar: deps.calendar, tradingDay: deps.tradingDay, cycleIndex: deps.cycleIndex });
  if (!assembled.ok) {
    // RES-P1-01a..c: a snapshot the core would throw on never reaches `decide`; the cycle abstains and journals it.
    await append(skipDraft(context(), ["WORLD_PARTIAL"], null));
    return { primary: journalFailure() === null ? "SKIP" : null, reasonCodes: ["WORLD_PARTIAL"], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: assembled.reason, actions, kill };
  }
  const { snapshot, journalSnapshot, lifecycles, closes } = assembled;

  // ---- G13 at the snapshot: the kill predicate on fresh equity ----
  if (killTriggered(book.equityCents, deps.executionConfig.killEquityThresholdCents)) {
    kill = await killManagement(book, lifecycles, closes);
    entriesBlocked.push("KILL");
  }
  if (journalDownSincePhaseZero) return { primary: null, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip: null, snapshotRejected: null, actions, kill };

  // ---- phase 2: the analyst, at most once, bounded, never retried in-process (S-CYC-01) ----
  let analystSkip: string | null = null;
  let batch = parseAnalystOutput("{\"candidates\":[]}");
  const managementOnly = halt.halted || entriesBlocked.length > 0;
  if (!managementOnly) {
    try {
      const raw = await withTimeout(deps.analyst({ tradingDay: deps.tradingDay, cycleIndex: deps.cycleIndex, underlyings: deps.decisionConfig.underlyingUniverse }), deps.analystTimeoutMs);
      batch = parseAnalystOutput(raw);
    } catch (error) {
      analystSkip = messageOf(error);
    }
  }

  // ---- phase 3: price from the decision's own quotes, then decide ----
  const decision: PricedDecision = priceAndDecide(snapshot, batch, deps.decisionConfig, deps.executionConfig, deps.clock());

  // ---- primary entry first: the decision is recorded before any order exists (A5, A7) ----
  const primaryOk = await append(cycleDraft(context(), { cycleIndex: deps.cycleIndex, tradingDay: deps.tradingDay, journalSnapshot, decision, analystSkip, reasonCodes: [] }));
  if (!primaryOk) {
    // S-CYC-06: no entry order this cycle. The only mutation that may follow is the emergency close inside kill management.
    return { primary: null, reasonCodes: [], journalFailure: journalFailure(), entriesBlocked: [...entriesBlocked, "JOURNAL_UNAVAILABLE"], resolved, auditGaps, analystSkip, snapshotRejected: null, actions, kill };
  }

  // ---- phase 4: execute every approved action through INTENT → revalidation → gateway → OUTCOME ----
  for (const plan of decision.result.actions) {
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
      const later = await fetched(() => deps.broker.orderByClientId(plan.clientOrderId));
      if (later.ok && later.value !== null) derived = outcomeFromOrder({ ...outcomeContext, atIso: context().atIso }, later.value);
    }
    if (derived !== null) await append(derived.draft);
    actions.push({ clientOrderId: plan.clientOrderId, result: "SUBMITTED", status: derived?.status ?? null, detail: derived === null ? "working" : null });
    if (derived?.fill === "BROKER_PRICE_BREACH") {
      await haltForPriceBreach(plan.clientOrderId);
      entriesBlocked.push("BROKER_PRICE_BREACH");
    }
  }

  return { primary: "CYCLE", reasonCodes: [], journalFailure: journalFailure(), entriesBlocked, resolved, auditGaps, analystSkip, snapshotRejected: null, actions, kill };

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
      const found = await fetched(() => deps.broker.orderByClientId(clientOrderId));
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

  async function closeLifecycleSnapshot(target: FlattenTarget, route: CloseLifecycleSnapshot["route"], currentExposure: Quantity, journaledCloses: readonly CloseAttemptRecord[]): Promise<CloseLifecycleSnapshot> {
    const lifecycleId = closeLifecycleId(target.exposureLifecycleId, route);
    const attempts: CloseAttemptSnapshot[] = [];
    const generations = journaledCloses.filter(close => close.closeLifecycleId === lifecycleId).map(close => close.generation);
    const highest = generations.length === 0 ? -1 : Math.max(...generations);
    // Every journaled generation plus the next one (an unjournaled emergency attempt) is reloaded from the broker.
    for (let generation = 0; generation <= highest + 1; generation += 1) {
      const attemptId = closeAttemptId(lifecycleId, integerUnit(generation, "Quantity"));
      const known = journaledCloses.find(close => close.attemptId === attemptId);
      const lookup = await fetched(() => deps.broker.orderByClientId(attemptId));
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
    return { exposureLifecycleId: target.exposureLifecycleId, route, currentExposureQuantity: currentExposure, attempts };
  }

  async function submitClose(target: FlattenTarget, route: CloseLifecycleSnapshot["route"], legs: readonly OptionLeg[], quantity: Quantity, book: BrokerBook, journaledCloses: readonly CloseAttemptRecord[], journalAvailable: boolean): Promise<{ readonly attemptId: string | null; readonly emergency: boolean }> {
    const lifecycle = await closeLifecycleSnapshot(target, route, quantity, journaledCloses);
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
      const after = await fetched(() => deps.broker.orderByClientId(clientOrderId));
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
