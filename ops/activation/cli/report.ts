// What the owner reads (unit 10). Pure string building: the caller decides where the
// lines go and what the clock says.
//
// The audience is an owner at 22:00 who has not looked at this ledger for a week, and a
// task history that will show nothing but an exit code in three months. Both need the
// same thing from every line: what is true now, and what it means for the next step.
import { executionOrder, nextStep, stepWindow } from "../core/steps.ts";
import type { LedgerFold } from "../core/fold.ts";
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
  if (reports.length === 0) return "the armed run was left as it is; tearing it down is the owner's decision";
  const failed = reports.filter(report => !report.applied);
  if (failed.length === 0) return "the teardown ran: " + reports.map(report => report.kind).join(", ");
  return `the teardown did NOT complete — ${failed.map(report => `${report.kind} (${report.reason ?? "no reason given"})`).join("; ")}. Check the world by hand before anything else.`;
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
    case "opened":
      return [`opened attempt ${outcome.attempt}; the ledger was ${outcome.found}`];
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
    case "work-failed":
      return [`FAILED: ${outcome.reason}`];
    case "ledger-defect":
      return [`LEDGER DEFECT ${outcome.stage}:${outcome.reason}`, "the record itself cannot be trusted; do not start another attempt before reading it"];
  }
}
