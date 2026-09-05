// S-G11-03/04: the dedicated Friday entries. `runDeadlineReconciliation`
// appends the 17:00 CEST DEADLINE_RECONCILIATION (full broker snapshot plus
// the submitted-revision reference); `runTerminal` appends the Friday
// US-close TERMINAL entry — the controlled end of scheduler and dead-man
// expectation. A still-risk-bearing remainder is recorded explicitly and
// raises the active fail-signal: the story hands over to the owner in
// writing, never in silence. A valid DECLARED_EXPIRY_HOLD is recorded as a
// non-flat, zero-additional-liability terminal residue, distinct from the
// failure path.
//
// A Friday entry that cannot be written is the one case where the journal is
// unavailable as a channel, and it is exactly the case in which silence would
// be worst. Both entry points therefore end in one of two states and never in
// a third: the entry landed, or the active fail-signal was raised with the
// reason named in `DeadlineEntryReport.failure`. Two things can prevent the
// entry — a snapshot the pure assembly refuses, and an append the gateway
// refuses — and both take that path.
import { assembleDecisionSnapshot, epochMsToUtcIso } from "../core/execution.js";
import type { BrokerBook, MarketObservation } from "../core/execution.js";
import type { JournalDraft, ReasonCode } from "../core/journal.js";
import { assertFlattened, deadlineReconciliationDraft, declaredExpiryHolds, planPing, terminalDraft } from "../core/lifecycle.js";
import type { PingPlan, TerminalRemainder } from "../core/lifecycle.js";
import type { CycleDependencies, PingPort } from "./cycle-runner.js";
import type { MutationGateway } from "./mutation-gateway.js";
import { heldOptionContractIds } from "./market-window.js";
import { standingImpediment } from "./halt-state.js";

export type DeadlineDependencies = Pick<CycleDependencies, "gateway" | "epoch" | "broker" | "market" | "clock" | "profile" | "calendar" | "tradingDay" | "cycleIndex" | "paths"> & {
  readonly ping: PingPort | null;
  /** S-X-07: which position rows are share residue rather than option identities. */
  readonly underlyingUniverse: readonly string[];
};

/** The alarm condition a Friday entry raises when it could not be written; the detail follows the failure class. */
export const DEADLINE_ENTRY_NOT_JOURNALED = "DEADLINE_ENTRY_NOT_JOURNALED";

/**
 * Why no entry landed. Closed on purpose: these are the only two states in
 * which the journal is unavailable and the ping is the whole handover.
 */
export type DeadlineFailure =
  | { readonly kind: "SNAPSHOT_NOT_ASSEMBLED"; readonly detail: string }
  | { readonly kind: "ENTRY_NOT_JOURNALED"; readonly detail: string };

export interface DeadlineEntryReport {
  readonly appended: boolean;
  readonly holdVisible: boolean;
  readonly remainder: TerminalRemainder | null;
  readonly ping: "success" | "fail" | "none" | null;
  /** `null` exactly when the entry landed; otherwise the reason, also carried to the dead-man check. */
  readonly failure: DeadlineFailure | null;
}

function notJournaledCondition(failure: DeadlineFailure): string {
  return `${DEADLINE_ENTRY_NOT_JOURNALED}:${failure.kind}:${failure.detail}`;
}

/** Deliver what the pure `planPing` decided. Delivery is best effort; the report carries the plan either way. */
async function deliverPing(deps: DeadlineDependencies, plan: PingPlan): Promise<"success" | "fail" | "none" | null> {
  if (deps.ping === null) return null;
  try {
    if (plan.kind === "fail") await deps.ping.fail(plan.conditions);
    if (plan.kind === "success") await deps.ping.success();
  } catch {
    // Best-effort delivery.
  }
  return plan.kind;
}

/** No entry could be written: raise the active fail-signal and name the reason. This is the handover, in place of the journal. */
async function handOverWithoutEntry(deps: DeadlineDependencies, failure: DeadlineFailure): Promise<DeadlineEntryReport> {
  const plan = planPing({ durableAppendLanded: false, alarmConditions: [notJournaledCondition(failure)] });
  return { appended: false, holdVisible: false, remainder: null, ping: await deliverPing(deps, plan), failure };
}

async function assembleForEntry(deps: DeadlineDependencies): Promise<{ readonly gateway: MutationGateway; readonly snapshot: ReturnType<typeof assembleDecisionSnapshot>; readonly book: BrokerBook; readonly entriesHolds: readonly string[] }> {
  // S-X-07: the book is read before the observation so every held contract is
  // quoted by identity, not only by the close-oriented window's bounds.
  const [account, positions, openOrders] = await Promise.all([
    deps.broker.account(),
    deps.broker.positions(),
    deps.broker.openOrders(),
  ]);
  const market = await deps.market(heldOptionContractIds(positions, deps.underlyingUniverse));
  const book: BrokerBook = { accountId: account.accountId, cashCents: account.cashCents, equityCents: account.equityCents, positions, openOrders, observedAtMs: deps.clock() };
  const opened = await deps.gateway.openJournal();
  const marketObservation: MarketObservation = market;
  const snapshot = assembleDecisionSnapshot({ broker: book, market: marketObservation, journal: opened.entries, halt: opened.halt.halted, profile: deps.profile, calendar: deps.calendar, tradingDay: deps.tradingDay, cycleIndex: deps.cycleIndex });
  return { gateway: deps.gateway, snapshot, book, entriesHolds: declaredExpiryHolds(opened.entries) };
}

async function appendAndPing(deps: DeadlineDependencies, draft: JournalDraft, alarmConditions: readonly string[]): Promise<{ readonly appended: boolean; readonly ping: "success" | "fail" | "none" | null; readonly failure: DeadlineFailure | null }> {
  const result = await deps.gateway.dispatch({ class: "authoritative", epoch: deps.epoch, action: { kind: "journal_append", entry: draft } });
  // A refused append is an alarm condition of its own, so `planPing` can never
  // answer "none" here: the entry the owner was promised does not exist.
  const failure: DeadlineFailure | null = result.ok ? null : { kind: "ENTRY_NOT_JOURNALED", detail: result.reason };
  // R43-B5: a deadline entry landing is not permission to call the deployment
  // ready. All four combinations of {journaled halt, marker-only fence} x
  // {reconciliation, terminal} used to send a readiness SUCCESS over a standing
  // halt, which is precisely what another process may not do (A31, #78).
  const plan = planPing({
    durableAppendLanded: result.ok,
    alarmConditions: failure === null ? alarmConditions : [...alarmConditions, notJournaledCondition(failure)],
    standingHalt: standingImpediment(deps.paths),
  });
  return { appended: result.ok, ping: await deliverPing(deps, plan), failure };
}

/** S-G11-03: the dedicated Fri 17:00 CEST entry — full broker snapshot plus the submitted-revision reference. */
export async function runDeadlineReconciliation(deps: DeadlineDependencies, submittedRevision: string): Promise<DeadlineEntryReport> {
  const assembled = await assembleForEntry(deps);
  if (!assembled.snapshot.ok) return handOverWithoutEntry(deps, { kind: "SNAPSHOT_NOT_ASSEMBLED", detail: assembled.snapshot.reason });
  const context = { atIso: epochMsToUtcIso(deps.clock()), epoch: deps.epoch };
  const { appended, ping, failure } = await appendAndPing(deps, deadlineReconciliationDraft(context, assembled.snapshot.journalSnapshot, submittedRevision, []), []);
  return { appended, holdVisible: assertFlattened(assembled.book, assembled.entriesHolds).holdVisible, remainder: null, ping, failure };
}

/** S-G11-04: the Friday US-close TERMINAL entry; a risk-bearing remainder is recorded explicitly and fail-signalled. */
export async function runTerminal(deps: DeadlineDependencies): Promise<DeadlineEntryReport> {
  const assembled = await assembleForEntry(deps);
  if (!assembled.snapshot.ok) return handOverWithoutEntry(deps, { kind: "SNAPSHOT_NOT_ASSEMBLED", detail: assembled.snapshot.reason });
  const context = { atIso: epochMsToUtcIso(deps.clock()), epoch: deps.epoch };
  const assertion = assertFlattened(assembled.book, assembled.entriesHolds);
  const reasonCodes: ReasonCode[] = assertion.holdVisible ? ["DECLARED_EXPIRY_HOLD"] : [];
  let remainder: TerminalRemainder | null = null;
  const alarmConditions: string[] = [];
  if (!assertion.satisfied) {
    // The S-G11-02 failure path is STILL risk-bearing at Friday close: structure, loss statement, expiry consequence — in writing.
    remainder = {
      positions: assembled.book.positions.filter(position => position.quantity !== 0 && !assembled.entriesHolds.includes(position.contractId)).map(position => ({ contractId: position.contractId, quantity: position.quantity })),
      maxLossStatement: `open remainder at terminal close: ${assertion.violations.join("; ")}`,
      expiryConsequence: "the remainder is exposed to expiry mechanics after the controlled end; owner intervention required",
    };
    alarmConditions.push("TERMINAL_REMAINDER_RISK_BEARING");
  }
  const { appended, ping, failure } = await appendAndPing(deps, terminalDraft(context, assembled.snapshot.journalSnapshot, reasonCodes, remainder), alarmConditions);
  return { appended, holdVisible: assertion.holdVisible, remainder, ping, failure };
}
