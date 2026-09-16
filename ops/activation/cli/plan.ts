// What one invocation of the activation CLI writes, and how it ends (unit 10).
//
// `decide()` answers what the *activation* should do; this module answers what the
// *invocation* should do with that answer: which observations it is allowed to spend,
// which ledger lines it appends, how it classifies a store failure, and which exit code
// the owner — or the scheduled task's history — sees. Nothing here performs I/O; the
// clock, the zone and the process identity all arrive as parameters.
import type { LedgerDraft, LedgerTail } from "../core/ledger.ts";
import { nextStep } from "../core/steps.ts";
import { stepDone } from "../core/fold.ts";
import type { LedgerFold } from "../core/fold.ts";
import type { AppliedAction } from "../actions/apply.ts";
import type { ObservationPlan } from "../readers/observe.ts";
import type { LedgerSystemEvent } from "../store/ledger-store.ts";
import type { Decision, LedgerEntry, Outcome, StepId, WorldAction } from "../core/types.ts";

/** A moment as the ledger wants it: local time with its offset, and the same instant in UTC ms. */
export interface Stamp {
  readonly at: string;
  readonly atUtcMs: number;
}

/** The shell's clock and zone, supplied rather than called. */
export type StampAt = (utcMs: number) => Stamp;

/** One action as the shell reported it back after `applyAction` — or refused to run it at all. */
export interface ActionReport {
  readonly kind: WorldAction["kind"];
  readonly applied: boolean;
  /** `applyAction`'s detail when it applied; the credential-free reason when it did not. */
  readonly detail: Readonly<Record<string, unknown>> | null;
  readonly reason: string | null;
  readonly completion: AppliedAction["completion"] | null;
}

export type InvocationOutcome =
  | { readonly kind: "acted"; readonly step: StepId; readonly outcome: Outcome; readonly deferred: boolean }
  | { readonly kind: "recorded"; readonly step: StepId; readonly outcome: Outcome }
  | { readonly kind: "waited"; readonly reason: string; readonly noted: boolean }
  | { readonly kind: "opened"; readonly attempt: string; readonly found: string }
  | { readonly kind: "aborted"; readonly step: StepId | null; readonly reason: string; readonly teardown: boolean; readonly nextOwnerAction: string }
  | { readonly kind: "ended"; readonly seq: number; readonly reason: string }
  | { readonly kind: "done"; readonly reason: string }
  | { readonly kind: "yielded"; readonly reason: string }
  | { readonly kind: "reported" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "work-failed"; readonly reason: string }
  | { readonly kind: "ledger-defect"; readonly stage: string; readonly reason: string };

/**
 * 0 is "nothing is wrong", 1 is "the attempt is over", 2 is "I did not start", 3 is
 * "the record itself is unreliable" and 4 is "I failed part way through". The scheduled
 * task's history shows only this number for months, so each one has to mean something on
 * its own — and 3 and 4 have to be different numbers, or a defect in the ledger and a
 * defect in this CLI would be indistinguishable a week later (review residual G2).
 */
export function exitCodeFor(outcome: InvocationOutcome): number {
  switch (outcome.kind) {
    case "aborted":
      return 1;
    case "refused":
      return 2;
    case "ledger-defect":
      return 3;
    case "work-failed":
      return 4;
    case "acted":
      return outcome.outcome === "ok" || outcome.outcome === "already_in_target_state" ? 0 : 1;
    case "recorded":
    case "waited":
    case "opened":
    case "ended":
    case "done":
    case "yielded":
    case "reported":
      return 0;
  }
}

/** Every abort pages, and so does a defect in the record (spec §4, §5; catalogue invariant 4). */
export function pages(outcome: InvocationOutcome): boolean {
  return outcome.kind === "aborted" || outcome.kind === "ledger-defect" || outcome.kind === "work-failed";
}

/**
 * Which readings this invocation may spend (unit 7's contract). The preflight is taken at
 * steps 1 and 2 and on every invocation from step 2 onwards, because the core compares
 * digests from then on; the live-token probe is spent at step 0 and at the gate, and only
 * where the preflight ran, since a probe on an analyst that did not start proves nothing;
 * the dev account's book is read at step 3. A reading outside the plan reads unknown and
 * says so, which is never green.
 */
export function observationPlanFor(fold: LedgerFold): ObservationPlan {
  const step = nextStep(fold);
  const preflight = step === "0-preflight" || step === "1-install" || step === "2-certificate" || stepDone(fold, "2-certificate");
  const analystProbe = preflight && (step === "0-preflight" || step === "10-gate");
  return { preflight, analystProbe, devAccount: step === "3-flat" };
}

function draft(input: {
  readonly stamp: Stamp;
  readonly attempt: string;
  readonly anchorDay: string;
  readonly step: StepId | null;
  readonly kind: LedgerDraft["kind"];
  readonly outcome: Outcome | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly nextOwnerAction: string | null;
}): LedgerDraft {
  return {
    at: input.stamp.at,
    atUtcMs: input.stamp.atUtcMs,
    attempt: input.attempt,
    anchorDay: input.anchorDay,
    step: input.step,
    kind: input.kind,
    outcome: input.outcome,
    evidence: input.evidence,
    nextOwnerAction: input.nextOwnerAction,
  };
}

/** The `intent` an `act` writes before it touches anything: what it is about to do, and why. */
export function intentDraft(decision: Extract<Decision, { kind: "act" }>, attempt: string, anchorDay: string, stamp: Stamp): LedgerDraft {
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: decision.step,
    kind: "intent",
    outcome: null,
    evidence: { ...decision.evidence, actions: decision.actions.map(action => action.kind) },
    nextOwnerAction: null,
  });
}

/**
 * The `result` that closes an `act` — `ok` only when every action applied. A restart is
 * intent-only: it reports `await-post-boot`, and the invocation that ordered it must not
 * write its own result, because the machine it would describe is going down. The first
 * invocation after the boot closes step 8 instead.
 */
export function resultDraft(
  decision: Extract<Decision, { kind: "act" }>,
  reports: readonly ActionReport[],
  attempt: string,
  anchorDay: string,
  stamp: Stamp,
): LedgerDraft | null {
  const allApplied = reports.length === decision.actions.length && reports.every(report => report.applied);
  if (allApplied && reports.some(report => report.completion === "await-post-boot")) return null;
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: decision.step,
    kind: "result",
    outcome: allApplied ? "ok" : "failed",
    evidence: {
      ...decision.evidence,
      actions: reports.map(report => (report.applied
        ? { kind: report.kind, applied: true, detail: report.detail ?? {} }
        : { kind: report.kind, applied: false, reason: report.reason ?? "UNKNOWN" })),
    },
    nextOwnerAction: null,
  });
}

/** The `result` a `record` decision writes: nothing to change, and that is itself the finding. */
export function recordDraft(decision: Extract<Decision, { kind: "record" }>, attempt: string, anchorDay: string, stamp: Stamp): LedgerDraft {
  return draft({ stamp, attempt, anchorDay, step: decision.step, kind: "result", outcome: decision.outcome, evidence: decision.evidence, nextOwnerAction: null });
}

/** The entry that ends the attempt. It always names what the owner must do; the codec refuses it otherwise. */
export function abortDraft(decision: Extract<Decision, { kind: "abort" }>, attempt: string, anchorDay: string, stamp: Stamp): LedgerDraft {
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: decision.step,
    kind: "abort",
    outcome: null,
    evidence: { ...decision.evidence, reason: decision.reason, teardown: decision.teardown },
    nextOwnerAction: decision.nextOwnerAction,
  });
}

/**
 * A `wait` records nothing unless the reason is new. Five-minute invocations across an
 * eight-hour evening would otherwise write a hundred identical lines and bury the two
 * that matter — but the *first* time a reason appears it is evidence, so it is written.
 */
export function waitNoteDraft(reason: string, fold: LedgerFold, attempt: string, anchorDay: string, stamp: Stamp): LedgerDraft | null {
  const last = fold.lastEntry;
  if (last !== null && last.kind === "note" && last.evidence["waiting"] === reason) return null;
  return draft({ stamp, attempt, anchorDay, step: null, kind: "note", outcome: null, evidence: { waiting: reason }, nextOwnerAction: null });
}

/** The first entry of a new attempt: what the invocation found, so the ledger says why the attempt exists. */
export function openingDraft(found: string, attempt: string, anchorDay: string, stamp: Stamp, evidence: Readonly<Record<string, unknown>> = {}): LedgerDraft {
  return draft({ stamp, attempt, anchorDay, step: null, kind: "note", outcome: null, evidence: { ...evidence, opened: found }, nextOwnerAction: null });
}

/** The owner's own abort (ACT-27): a deliberate stop must not be readable as a crash. */
export function ownerAbortDraft(operator: string, attempt: string, anchorDay: string, stamp: Stamp, evidence: Readonly<Record<string, unknown>>): LedgerDraft {
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: null,
    kind: "abort",
    outcome: null,
    evidence: { ...evidence, reason: "OWNER_ABORT", operator },
    nextOwnerAction: "The owner stopped this attempt. Both tasks are disabled and the certificate line is removed; open a new attempt when the run is to continue.",
  });
}

/**
 * The attempt id for a new attempt on this anchor day: the day, then how many attempts
 * that day has already seen. It is in the ledger's attempt alphabet, it sorts, and it
 * says at a glance which day an entry belongs to when the file is read by eye.
 */
export function nextAttemptId(entries: readonly LedgerEntry[], anchorDay: string): string {
  const seen: string[] = [];
  for (const entry of entries) {
    if (entry.anchorDay === anchorDay && !seen.includes(entry.attempt)) seen.push(entry.attempt);
  }
  return `${anchorDay}.${String(seen.length + 1)}`;
}

/**
 * A stamp the ledger will accept after `tail`: the codec refuses a clock that runs
 * backwards, and a lease held across midnight or a host whose clock was corrected
 * would otherwise turn one late append into a refused line and an aborted attempt.
 */
export function monotonicStamp(stamp: Stamp, tail: LedgerTail, stampAt: StampAt): Stamp {
  if (tail.lastAtUtcMs === null || stamp.atUtcMs >= tail.lastAtUtcMs) return stamp;
  return stampAt(tail.lastAtUtcMs);
}

/**
 * The store's system events as ledger drafts. The store checks by value that the draft
 * covers the event, so every field of the event is copied verbatim; a `torn-tail` is a
 * `correction`, the other two are notes, and none of them carries a step or an outcome.
 */
export function systemDraftFactory(options: {
  readonly nowUtcMs: number;
  readonly stampAt: StampAt;
  readonly attempt: string;
  readonly anchorDay: string;
}) {
  return (event: LedgerSystemEvent, tail: LedgerTail, context: { readonly attempt: string; readonly anchorDay: string } | null): LedgerDraft => {
    const stamp = monotonicStamp(options.stampAt(options.nowUtcMs), tail, options.stampAt);
    const attempt = context?.attempt ?? options.attempt;
    const anchorDay = context?.anchorDay ?? options.anchorDay;
    if (event.kind === "torn-tail") {
      return draft({
        stamp,
        attempt,
        anchorDay,
        step: null,
        kind: "correction",
        outcome: null,
        evidence: { kind: event.kind, segment: event.segment, damagedSeq: event.damagedSeq, correctedSeq: event.damagedSeq },
        nextOwnerAction: null,
      });
    }
    const evidence = event.kind === "live-lock"
      ? { kind: event.kind, owner: event.owner, contender: event.contender, claimId: event.claimId }
      : { kind: event.kind, owner: event.owner };
    return draft({ stamp, attempt, anchorDay, step: null, kind: "note", outcome: null, evidence, nextOwnerAction: null });
  };
}

/**
 * A store failure as this CLI reads it. `callback` / `WORK_FAILED` is the CLI's own typed
 * abort travelling back out through the lease (review residual G2, closed 2026-09-16);
 * every other stage is a defect in the record itself, which pages and exits 3. Confusing
 * the two would page a deliberate stop as a ledger defect, and hide a real one behind a
 * routine abort.
 */
export function classifyStoreFailure(stage: string, reason: string): InvocationOutcome {
  if (stage === "callback" && reason === "WORK_FAILED") {
    return { kind: "work-failed", reason: "the invocation failed inside the ledger lease; the ledger itself is intact" };
  }
  return { kind: "ledger-defect", stage, reason };
}
