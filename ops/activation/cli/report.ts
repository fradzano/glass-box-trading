// What the owner reads (unit 10). Pure string building: the caller decides where the
// lines go and what the clock says.
//
// The audience is an owner at 22:00 who has not looked at this ledger for a week, and a
// task history that will show nothing but an exit code in three months. Both need the
// same thing from every line: what is true now, and what it means for the next step.
import { executionOrder, nextStep, stepWindow } from "../core/steps.ts";
import type { LedgerFold } from "../core/fold.ts";
import { teardownClause } from "./plan.ts";
import type { ActionReport, InvocationOutcome } from "./plan.ts";
import type { LocalInstant, Schedule } from "../core/types.ts";

function localText(instant: LocalInstant): string {
  const hour = Math.floor(instant.minute / 60);
  const minute = instant.minute % 60;
  return `${instant.date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * The fold as a page of text: the attempt, whether it is still open, every step that has
 * run, and the step that is next with the window it may run in. A step with no result is
 * printed as such rather than omitted — an omitted step reads as "fine" at a glance.
 */
export function statusLines(fold: LedgerFold, schedule: Schedule | null): readonly string[] {
  const lines: string[] = [];
  lines.push(`ledger      ${fold.integrity}${fold.empty ? " (empty)" : ""}`);
  if (fold.corrections.length > 0) lines.push(`corrections ${fold.corrections.map(seq => `seq ${String(seq)}`).join(", ")}`);
  for (const inconsistency of fold.inconsistencies) lines.push(`INCONSISTENT ${inconsistency}`);

  const attempt = fold.currentAttempt;
  if (attempt === null) {
    lines.push("attempt     none open");
    return lines;
  }
  lines.push(`attempt     ${attempt.id} for anchor day ${attempt.anchorDay}, from seq ${String(attempt.firstSeq)}`);
  if (fold.attemptEnded !== null) {
    lines.push(`ENDED       at seq ${String(fold.attemptEnded.seq)}${fold.attemptEnded.byOwner ? " by the owner" : ""}; no later invocation of this attempt may act`);
  }

  for (const step of executionOrder()) {
    const state = fold.steps[step];
    if (state === undefined) continue;
    const outcome = state.outcome ?? (state.resultSeq === null ? "no result yet" : "unknown");
    lines.push(`  ${step.padEnd(22)} ${outcome}${state.attempt === attempt.id ? "" : ` (carried from attempt ${state.attempt})`}`);
  }
  if (fold.interrupted !== null) {
    lines.push(`INTERRUPTED ${fold.interrupted.step}: its intent at seq ${String(fold.interrupted.intentSeq ?? 0)} has no result`);
  }

  const next = nextStep(fold);
  if (next === null) {
    lines.push("next        nothing: every step of this attempt has a result");
    return lines;
  }
  if (schedule === null) {
    lines.push(`next        ${next}`);
    return lines;
  }
  const window = stepWindow(next, schedule);
  lines.push(`next        ${next}, valid ${window.opens === null ? "from the start of the attempt" : `from ${localText(window.opens)}`} until ${localText(window.notValidAfter)}`);
  return lines;
}

/**
 * The one sentence the owner acts on after an abort, built from what the teardown
 * actually did rather than from what it owed.
 *
 * The distinction is not pedantic. The previous version chose this line from the core's
 * `teardown` boolean, so a run with no host bindings printed "both tasks are disabled and
 * the certificate line is unset" while its own ledger entry recorded four actions as
 * `applied: false, reason: NO_HOST_BINDINGS` two fields away. An owner reading a task log
 * at 15:06 would have been told the deployment was torn down when nothing had been
 * touched — and the entry is append-only, so the false sentence could never be withdrawn.
 */
function teardownLine(reports: readonly ActionReport[]): string {
  // An empty list means something specific here and only here: after the gate, an abort
  // owes nothing (spec §5), so there is nothing to report rather than nothing attempted.
  return teardownClause(reports) ?? "the armed run was left as it is; tearing it down is the owner's decision";
}

/** One line per invocation for the log, and the sentence the owner acts on when there is one. */
export function outcomeLines(outcome: InvocationOutcome): readonly string[] {
  switch (outcome.kind) {
    case "acted":
      return [`acted on ${outcome.step}: ${outcome.outcome}${outcome.deferred ? "; its result is left for the first invocation after the boot" : ""}`];
    case "recorded":
      return [`recorded ${outcome.step}: ${outcome.outcome}`];
    case "waited":
      return [`waiting: ${outcome.reason}${outcome.noted ? " (noted in the ledger)" : ""}`];
    case "opened": {
      const opened = `opened attempt ${outcome.attempt}; the ledger was ${outcome.found}`;
      if (outcome.stopStanding === undefined || outcome.stopStanding === null) return [opened];
      return [
        opened,
        `the owner's stop was NOT lifted (${outcome.stopStanding}), so nothing will be armed`,
        "next owner action: read `activation status`, then run `open` again once the stop that stands there is the one you mean to lift",
      ];
    }
    case "aborted":
      return [
        `ABORTED${outcome.step === null ? "" : ` at ${outcome.step}`}: ${outcome.reason}`,
        teardownLine(outcome.teardown),
        `next owner action: ${outcome.nextOwnerAction}`,
      ];
    case "ended":
      return [`this attempt ended at seq ${String(outcome.seq)}: ${outcome.reason}. Nothing was done.`];
    case "done":
      return [outcome.reason];
    case "yielded":
      return [outcome.reason];
    case "reported":
      return [];
    case "refused":
      return [`refusing: ${outcome.reason}`];
    case "work-failed": {
      // A failure that tore something down on its way out says so. The A4 teardown at step
      // 10 runs inside the lease and the store failure is rethrown afterwards, so this line
      // is the only place the owner is told that both tasks were disabled and the
      // certificate line removed by the invocation that just reported a failure.
      const clause = teardownClause(outcome.teardown ?? []);
      return clause === null ? [`FAILED: ${outcome.reason}`] : [`FAILED: ${outcome.reason}`, clause];
    }
    case "ledger-defect": {
      // A defect in the record does not mean nothing happened to the world. When a
      // teardown ran on the way out — which is exactly what axiom A4 asks for at the gate
      // — the owner is told about it here, in the same three lines he reads at 14:36.
      const clause = teardownClause(outcome.teardown ?? []);
      const lines = [`LEDGER DEFECT ${outcome.stage}:${outcome.reason}`, "the record itself cannot be trusted; do not start another attempt before reading it"];
      return clause === null ? lines : [lines[0] as string, clause, lines[1] as string];
    }
  }
}
