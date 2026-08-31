// S-G11-03/04: the dedicated Friday entries. `runDeadlineReconciliation`
// appends the 17:00 CEST DEADLINE_RECONCILIATION (full broker snapshot plus
// the submitted-revision reference); `runTerminal` appends the Friday
// US-close TERMINAL entry — the controlled end of scheduler and dead-man
// expectation. A still-risk-bearing remainder is recorded explicitly and
// raises the active fail-signal: the story hands over to the owner in
// writing, never in silence. A valid DECLARED_EXPIRY_HOLD is recorded as a
// non-flat, zero-additional-liability terminal residue, distinct from the
// failure path.
import { assembleDecisionSnapshot, epochMsToUtcIso } from "../core/execution.js";
import type { BrokerBook, MarketObservation } from "../core/execution.js";
import type { JournalDraft, ReasonCode } from "../core/journal.js";
import { assertFlattened, deadlineReconciliationDraft, declaredExpiryHolds, planPing, terminalDraft } from "../core/lifecycle.js";
import type { TerminalRemainder } from "../core/lifecycle.js";
import type { CycleDependencies, PingPort } from "./cycle-runner.js";
import type { MutationGateway } from "./mutation-gateway.js";

export type DeadlineDependencies = Pick<CycleDependencies, "gateway" | "epoch" | "broker" | "market" | "clock" | "profile" | "calendar" | "tradingDay" | "cycleIndex"> & {
  readonly ping: PingPort | null;
};

export interface DeadlineEntryReport {
  readonly appended: boolean;
  readonly holdVisible: boolean;
  readonly remainder: TerminalRemainder | null;
  readonly ping: "success" | "fail" | "none" | null;
}

async function assembleForEntry(deps: DeadlineDependencies): Promise<{ readonly gateway: MutationGateway; readonly snapshot: ReturnType<typeof assembleDecisionSnapshot>; readonly book: BrokerBook; readonly entriesHolds: readonly string[] } | null> {
  const [account, positions, openOrders, market] = await Promise.all([
    deps.broker.account(),
    deps.broker.positions(),
    deps.broker.openOrders(),
    deps.market(),
  ]);
  const book: BrokerBook = { accountId: account.accountId, cashCents: account.cashCents, equityCents: account.equityCents, positions, openOrders, observedAtMs: deps.clock() };
  const opened = await deps.gateway.openJournal();
  const marketObservation: MarketObservation = market;
  const snapshot = assembleDecisionSnapshot({ broker: book, market: marketObservation, journal: opened.entries, halt: opened.halt.halted, profile: deps.profile, calendar: deps.calendar, tradingDay: deps.tradingDay, cycleIndex: deps.cycleIndex });
  return { gateway: deps.gateway, snapshot, book, entriesHolds: declaredExpiryHolds(opened.entries) };
}

async function appendAndPing(deps: DeadlineDependencies, draft: JournalDraft, alarmConditions: readonly string[]): Promise<{ readonly appended: boolean; readonly ping: "success" | "fail" | "none" | null }> {
  const result = await deps.gateway.dispatch({ class: "authoritative", epoch: deps.epoch, action: { kind: "journal_append", entry: draft } });
  const plan = planPing({ durableAppendLanded: result.ok, alarmConditions });
  if (deps.ping !== null) {
    try {
      if (plan.kind === "fail") await deps.ping.fail(plan.conditions);
      if (plan.kind === "success") await deps.ping.success();
    } catch {
      // Best-effort delivery.
    }
  }
  return { appended: result.ok, ping: deps.ping === null ? null : plan.kind };
}

/** S-G11-03: the dedicated Fri 17:00 CEST entry — full broker snapshot plus the submitted-revision reference. */
export async function runDeadlineReconciliation(deps: DeadlineDependencies, submittedRevision: string): Promise<DeadlineEntryReport> {
  const assembled = await assembleForEntry(deps);
  if (assembled === null || !assembled.snapshot.ok) return { appended: false, holdVisible: false, remainder: null, ping: null };
  const context = { atIso: epochMsToUtcIso(deps.clock()), epoch: deps.epoch };
  const { appended, ping } = await appendAndPing(deps, deadlineReconciliationDraft(context, assembled.snapshot.journalSnapshot, submittedRevision, []), []);
  return { appended, holdVisible: assertFlattened(assembled.book, assembled.entriesHolds).holdVisible, remainder: null, ping };
}

/** S-G11-04: the Friday US-close TERMINAL entry; a risk-bearing remainder is recorded explicitly and fail-signalled. */
export async function runTerminal(deps: DeadlineDependencies): Promise<DeadlineEntryReport> {
  const assembled = await assembleForEntry(deps);
  if (assembled === null || !assembled.snapshot.ok) return { appended: false, holdVisible: false, remainder: null, ping: null };
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
  const { appended, ping } = await appendAndPing(deps, terminalDraft(context, assembled.snapshot.journalSnapshot, reasonCodes, remainder), alarmConditions);
  return { appended, holdVisible: assertion.holdVisible, remainder, ping };
}
