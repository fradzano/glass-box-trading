// The dead-man watchdog (S-G14-01..03): a SEPARATE process entry point that
// shares the authoritative epoch store and cannot bypass the mutation
// gateway. Market-hours-aware; in-session journal staleness beyond
// DEAD_MAN_BOUND first FENCES the (possibly still-hanging) writer via the
// S-G12-07 epoch, then performs full phase-0 classification, sets halt,
// closes MATCHED intact structures whole via mleg, dispatches every residue
// through the S-G10-03 discrimination (unbounded → uncapped marketable with
// immediate fail-ping; bounded long → zero floor), and fail-pings. Every
// decision lives in the pure core; this shell fetches, appends, and submits
// through the gateway under the epoch it won.
import { integerUnit } from "../core/domain.js";
import { BrokerHttpError, httpStatusOf } from "./broker-errors.js";
import type { OptionLeg, Quantity } from "../core/domain.js";
import {
  assembleDecisionSnapshot,
  closeIntentDraft,
  emergencyCloseEligibility,
  epochMsToUtcIso,
  haltDraft,
  outcomeFromSubmit,
  utcIsoToEpochMs,
} from "../core/execution.js";
import type { BrokerBook, CloseAttemptRecord, MarketObservation, SnapshotAssemblyResult, SubmitObservation } from "../core/execution.js";
import { journalStaleness, redactSecrets } from "../core/journal.js";
import type { AccountBinding, JournalDraft } from "../core/journal.js";
import {
  assessStaleness,
  authorityRefusalAlarms,
  classifyBook,
  closeCapFor,
  deploymentTerminal,
  escalateCloseLimit,
  marketableCloseLimit,
  planBookClosure,
  planPing,
  residueClosingLeg,
} from "../core/lifecycle.js";
import type { BookClassification, CloseCap, PingPlan, SessionWindow, StalenessAssessment } from "../core/lifecycle.js";
import { closeAttemptId, closeLifecycleId, planCloseLifecycle } from "../core/order-identity.js";
import type { PingPort } from "./cycle-runner.js";
import type { BrokerReadPort } from "./fake-broker.js";
import { createMutationGateway, NO_BROKER_PORT } from "./mutation-gateway.js";
import type { BrokerMutationPort, MutationGateway } from "./mutation-gateway.js";
import type { StatePaths } from "./state-dir.js";
import { heldOptionContractIds } from "./market-window.js";
import { standingImpediment } from "./halt-state.js";

export interface WatchdogDependencies {
  readonly paths: StatePaths;
  readonly secrets: readonly string[];
  readonly clock: () => number;
  readonly instanceId: string;
  readonly lockTakeoverBoundMs: number;
  readonly deadManBoundMs: number;
  readonly closeEscalationStepCents: number;
  readonly session: SessionWindow;
  readonly binding: AccountBinding | null;
  /** Broker read side and mutation port; null runs the fence-and-halt path without book recovery (the CLI entry). */
  readonly broker: { readonly read: BrokerReadPort; readonly port: BrokerMutationPort } | null;
  /**
   * S-X-07: the recovery observation is built around the book of this very
   * firing, so the book is read first and its held identities are passed in.
   * The close-oriented window alone is a band, and the flattener is the last
   * place that may lose a contract to a band.
   */
  readonly market: ((heldContractIds: readonly string[]) => Promise<MarketObservation>) | null;
  /** Which position rows are share residue rather than option identities (S-X-07). */
  readonly underlyingUniverse: readonly string[];
  readonly profile: "dev" | "competition";
  readonly calendar: { readonly isTradingDay: boolean; readonly opensAt: Quantity | number; readonly closesAt: Quantity | number };
  readonly tradingDay: string;
  readonly ping: PingPort | null;
}

export interface WatchdogReport {
  readonly assessment: StalenessAssessment;
  readonly acquired: string | null;
  readonly epoch: number | null;
  readonly halted: boolean;
  readonly classification: BookClassification | null;
  readonly closes: readonly { readonly attemptId: string; readonly subject: string }[];
  readonly alarmConditions: readonly string[];
  readonly ping: "success" | "fail" | "none" | null;
}

function quiet(assessment: StalenessAssessment): WatchdogReport {
  return { assessment, acquired: null, epoch: null, halted: false, classification: null, closes: [], alarmConditions: [], ping: null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runWatchdog(deps: WatchdogDependencies): Promise<WatchdogReport> {
  const gateway: MutationGateway = createMutationGateway({
    paths: deps.paths,
    secrets: deps.secrets,
    clock: deps.clock,
    brokerPort: deps.broker?.port ?? NO_BROKER_PORT,
    instanceId: deps.instanceId,
    lockTakeoverBoundMs: deps.lockTakeoverBoundMs,
    ...(deps.binding === null ? {} : { binding: deps.binding }),
  });
  const opened = await gateway.openJournal();
  const staleness = journalStaleness(opened.entries);
  const lastMs = staleness.lastAuthoritativeAt === null ? null : utcIsoToEpochMs(staleness.lastAuthoritativeAt);
  // S-G11-04: a run that ended on purpose is not a hung writer. The fold is
  // taken from the same journal read the staleness clock uses, so the two can
  // never disagree about which entries they saw.
  const assessment = assessStaleness(deps.clock(), deps.session, lastMs, deps.deadManBoundMs, deploymentTerminal(opened.entries));
  if (assessment.kind === "quiet") return quiet(assessment);

  /** Best-effort delivery of a planned ping; the report carries the plan either way. */
  async function deliver(plan: PingPlan): Promise<"success" | "fail" | "none" | null> {
    if (deps.ping === null) return null;
    try {
      if (plan.kind === "fail") await deps.ping.fail(plan.conditions);
      if (plan.kind === "success") await deps.ping.success();
    } catch {
      // A ping that could not be delivered is not a reason to abandon the report.
    }
    return plan.kind;
  }

  // Fence FIRST (S-G14-02): authority comes only from the atomic epoch increment, never from observing staleness.
  const acquired = await gateway.acquireAuthority({ account: "unknown" });
  if (acquired.kind !== "WON" && acquired.kind !== "GAP_HALT") {
    // The journal is stale past DEAD_MAN_BOUND inside a session and this run
    // could not fence: a live holder still heartbeats (a hung writer holding
    // the lock), a rival taker won the race, or the store refused. Without an
    // epoch nothing may be halted, journaled or closed — so the fail-ping is
    // the only thing left, and it must fire: "stale AND unfenceable" is the
    // developer-must-look state of S-G14-02/03, not a quiet one, and silence
    // here would leave only the passive missed-ping SLA.
    const alarmConditions = authorityRefusalAlarms(acquired, assessment.ageMs);
    const ping = await deliver(planPing({ durableAppendLanded: false, alarmConditions }));
    return { assessment, acquired: acquired.kind, epoch: null, halted: false, classification: null, closes: [], alarmConditions, ping };
  }
  const epoch = acquired.epoch;
  const alarmConditions: string[] = [`WATCHDOG_TAKEOVER:staleness ${String(assessment.ageMs)} ms`];
  const context = (): { readonly atIso: string; readonly epoch: number } => ({ atIso: epochMsToUtcIso(deps.clock()), epoch });
  const appended = { durable: false };

  async function append(draft: JournalDraft): Promise<boolean> {
    const result = await gateway.dispatch({ class: "authoritative", epoch, action: { kind: "journal_append", entry: draft } });
    if (result.ok) appended.durable = true;
    return result.ok;
  }

  // `halted` is a claim about durable state, not about intent: the CLI prints
  // this report as the operator-facing line, and a halt nothing journaled must
  // never be reported as one. It is true when a halt already stood before the
  // takeover, or when this run's HALT append landed. An append that did not
  // land also raises its own alarm condition, so the fail-ping says which of
  // the two things the fence produced is missing.
  let halted = opened.halt.halted;
  if (!halted) {
    halted = await append(haltDraft(context(), "WATCHDOG_TAKEOVER", `journal stale for ${String(assessment.ageMs)} ms during a session; writer fenced at epoch ${String(epoch)}; phase-0 recovery follows`));
    if (!halted) alarmConditions.push("HALT_NOT_JOURNALED");
  }

  let classification: BookClassification | null = null;
  const closes: { attemptId: string; subject: string }[] = [];

  if (deps.broker !== null && deps.market !== null && deps.binding !== null) {
    const binding = deps.binding;
    const brokerRead = deps.broker.read;
    const marketPort = deps.market;
    // A refused snapshot (bad quotes, unreconstructable lifecycles, ...) or a
    // broker/market read that throws must not surface as a silent no-op: the
    // fence and halt above already stand, but nothing here closed anything,
    // and the operator sees only the takeover unless this names the reason.
    let book: BrokerBook | null = null;
    let assembled: SnapshotAssemblyResult;
    try {
      const [account, positions, openOrders] = await Promise.all([
        brokerRead.account(),
        brokerRead.positions(),
        brokerRead.openOrders(),
      ]);
      const market = await marketPort(heldOptionContractIds(positions, deps.underlyingUniverse));
      book = { accountId: account.accountId, cashCents: account.cashCents, equityCents: account.equityCents, positions, openOrders, observedAtMs: deps.clock() };
      const reopened = await gateway.openJournal();
      assembled = assembleDecisionSnapshot({
        broker: book,
        market,
        journal: reopened.entries,
        halt: true,
        profile: deps.profile,
        calendar: { isTradingDay: deps.calendar.isTradingDay, opensAt: integerUnit(Number(deps.calendar.opensAt), "EpochMilliseconds"), closesAt: integerUnit(Number(deps.calendar.closesAt), "EpochMilliseconds") },
        tradingDay: deps.tradingDay,
        cycleIndex: 0,
      });
    } catch (error) {
      // A credential rejection is the fence, not a skipped recovery: it must escape to the
      // composition's recordCredentialFence (S-G12-06) exactly as before this guard existed.
      const status = httpStatusOf(error);
      if (status === 401 || status === 403) throw error;
      assembled = { ok: false, reason: `RECOVERY_READ_FAILED:${messageOf(error)}` };
    }
    if (assembled.ok && book !== null) {
      const activeBook = book;
      const { snapshot, lifecycles, closes: journaledCloses } = assembled;
      classification = classifyBook(activeBook, lifecycles, journaledCloses, []);
      const closure = planBookClosure(activeBook, lifecycles);

      async function submitWatchdogClose(exposureLifecycleId: string, closingLegs: readonly OptionLeg[], quantity: Quantity, cap: CloseCap, reason: string): Promise<void> {
        // Adoption before submission: an existing active attempt is never duplicated (S-G7, WIN-8 "no duplicate action").
        const lifecycleId = closeLifecycleId(exposureLifecycleId, "watchdog");
        const generations = journaledCloses.filter(close => close.closeLifecycleId === lifecycleId).map((close: CloseAttemptRecord) => close.generation);
        const highest = generations.length === 0 ? -1 : Math.max(...generations);
        const attempts = [];
        for (let generation = 0; generation <= highest + 1; generation += 1) {
          const attemptId = closeAttemptId(lifecycleId, integerUnit(generation, "Quantity"));
          const order = await brokerRead.orderByClientId(attemptId);
          const known = journaledCloses.find(close => close.attemptId === attemptId);
          if (order === null && known === undefined) continue;
          const state = order === null
            ? (known !== undefined && known.status !== "submitted" ? known.status : "confirmation_unclear")
            : (order.status === "new" || order.status === "accepted" || order.status === "pending_new" || order.status === "pending_cancel" ? "accepted" : order.status);
          attempts.push({ attemptId, generation: integerUnit(generation, "Quantity"), requestedQuantity: integerUnit(order?.quantity ?? known?.quantity ?? 0, "Quantity"), filledQuantity: integerUnit(order?.filledQuantity ?? known?.filledQuantity ?? 0, "Quantity"), state: state as "accepted" });
        }
        const plan = planCloseLifecycle({ exposureLifecycleId, route: "watchdog", currentExposureQuantity: quantity, attempts });
        if (plan.kind !== "SUBMIT") return;
        const priced = cap.kind === "uncapped_marketable"
          ? marketableCloseLimit(closingLegs, snapshot.quotesByContract, plan.generation, deps.closeEscalationStepCents)
          : escalateCloseLimit(closingLegs, snapshot.quotesByContract, plan.generation, deps.closeEscalationStepCents, cap);
        if (!priced.ok) return;
        const eligibility = emergencyCloseEligibility(activeBook.positions, closingLegs.map(optionLeg => ({ contractId: optionLeg.contractId, side: optionLeg.side, quantity: optionLeg.ratio * plan.quantity })));
        if (!eligibility.eligible) return;
        if (!await append(closeIntentDraft(context(), { exposureLifecycleId, route: "watchdog", generation: plan.generation, closingLegs, quantity: plan.quantity, limit: priced.limit, reason }, binding))) return;
        const dispatched = await gateway.dispatch({ class: "authoritative", epoch, action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: plan.attemptId, binding, payload: { legs: closingLegs, quantity: plan.quantity, limit: priced.limit, intent: "close" } } } });
        let observation: SubmitObservation | null = null;
        if (dispatched.ok && "broker" in dispatched && dispatched.broker.ok) {
          const order = await brokerRead.orderByClientId(plan.attemptId);
          observation = order === null ? { kind: "acknowledgement_lost", detail: "acknowledged but not found on read-back" } : { kind: "acknowledged", order };
        } else if (!dispatched.ok && dispatched.source === "broker_port") {
          // R44-B5: a 401 or 403 on the close is a credential rejection, not a
          // lost acknowledgement. Swallowing it here left WATCHDOG_TAKEOVER
          // standing with no fence mark, so the operator was never handed the
          // S-G12-06 procedure -- and the very next close would be rejected
          // the same way. It escapes to the composition's
          // recordCredentialFence, exactly as the recovery read above does.
          const status = "httpStatus" in dispatched ? dispatched.httpStatus : null;
          if (status === 401 || status === 403) {
            throw new BrokerHttpError(status, `watchdog close rejected: ${dispatched.reason}`);
          }
          observation = { kind: "acknowledgement_lost", detail: dispatched.reason };
        }
        const derived = observation === null ? null : outcomeFromSubmit({ clientOrderId: plan.attemptId, limit: priced.limit, binding, epoch, atIso: context().atIso }, observation);
        if (derived !== null) await append(derived.draft);
        closes.push({ attemptId: plan.attemptId, subject: exposureLifecycleId });
      }

      // MATCHED intact structures close whole via mleg (S-G14-02) — never leg-wise (A11).
      for (const structure of closure.intact) {
        await submitWatchdogClose(structure.record.exposureLifecycleId, structure.closingLegs, structure.quantity, closeCapFor(structure.record.candidate), `watchdog whole-structure close of ${structure.record.exposureLifecycleId} after writer staleness`);
      }
      // Every residue dispatches through S-G10-03; the subtraction above guarantees no residue is also closed whole.
      const journaledUnderlyings = new Set(lifecycles.map(record => record.underlying));
      for (const residue of closure.residue) {
        const closingLeg = residueClosingLeg(residue, lifecycles.flatMap(record => record.candidate.legs), journaledUnderlyings);
        if (closingLeg === null) continue;
        const cap: CloseCap = residue.quantity < 0 ? { kind: "uncapped_marketable" } : { kind: "zero_floor" };
        if (residue.quantity < 0) alarmConditions.push(`UNBOUNDED_RESIDUE_RECOVERY:${residue.contractId}`);
        await submitWatchdogClose(`residue:${residue.contractId}`, [closingLeg], integerUnit(Math.abs(residue.quantity), "Quantity"), cap, residue.quantity < 0 ? `watchdog uncapped marketable-limit close of unbounded residue ${residue.contractId} (S-X-06)` : `watchdog zero-floor close of bounded residue ${residue.contractId} (S-G10-03)`);
      }
    } else if (!assembled.ok) {
      alarmConditions.push(`WATCHDOG_RECOVERY_SKIPPED:${redactSecrets(assembled.reason, deps.secrets)}`);
    }
  }

  // R43-C2: the takeover condition alone left the operator without the reason
  // the deployment is stopped. Health was correctly red; the diagnosis was not.
  const ping = await deliver(planPing({ durableAppendLanded: appended.durable, alarmConditions, standingHalt: standingImpediment(deps.paths) }));
  return { assessment, acquired: acquired.kind, epoch, halted, classification, closes, alarmConditions, ping };
}
