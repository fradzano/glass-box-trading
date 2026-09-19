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

/**
 * What a teardown **did**, in one clause, built from the reports and from nothing else.
 *
 * This is the single builder, and it exists because the alternative has now failed twice.
 * A sentence about a teardown used to be selected from whether one was *owed*: the console
 * line said "both tasks are disabled and the certificate line is unset" while the ledger
 * entry beside it recorded four actions as `applied: false, reason: NO_HOST_BINDINGS`. That
 * one line was repaired; the same sentence, chosen the same way, survived in the
 * append-only `next_owner_action`, in three refusal strings and in the disarm's own line —
 * which is what a class of defects looks like when only its loudest instance is fixed.
 * Every caller that says anything about a teardown now says it from here.
 *
 * `null` when there are no reports at all, deliberately: "nothing was attempted" and
 * "nothing was owed" are different facts, and only the caller knows which one it holds.
 */
export function teardownClause(reports: readonly ActionReport[]): string | null {
  if (reports.length === 0) return null;
  const failed = reports.filter(report => !report.applied);
  if (failed.length === 0) return `the teardown ran: ${reports.map(report => report.kind).join(", ")}`;
  // "Nothing was attempted" and "something was attempted and failed" are different facts,
  // and one sentence used to give both at once: a stop on a deployment without host
  // bindings said "the world is as it was" and, two clauses later, "the teardown did NOT
  // complete — check the world by hand". Measured by a gate on 2026-09-20 in a live
  // `next_owner_action`, which is append-only and can never be withdrawn. The list of
  // reasons that mean "not attempted" is the one `stopVerdict` uses, so the two cannot
  // drift apart again.
  const attempted = failed.filter(report => !NOT_ATTEMPTED.includes(report.reason ?? ""));
  if (attempted.length === 0) {
    return `nothing was applied: ${failed.map(report => `${report.kind} (${report.reason ?? "no reason given"})`).join("; ")}. The world is as it was`;
  }
  return `the teardown did NOT complete — ${attempted.map(report => `${report.kind} (${report.reason ?? "no reason given"})`).join("; ")}. Check the world by hand before anything else`;
}

/**
 * Reasons that mean "nothing was attempted", as opposed to "something was attempted and
 * failed". It lives here because two callers decide on it — the sentence above and the
 * stop's verdict — and the defect it closes was the two of them disagreeing.
 */
export const NOT_ATTEMPTED: readonly string[] = ["NO_HOST_BINDINGS", "DRY_RUN"];

/** The same clause where a sentence needs one whatever happened, including "nothing was attempted". */
export function teardownClauseOrSilence(reports: readonly ActionReport[]): string {
  return teardownClause(reports) ?? "no teardown action was attempted";
}

/** The `actions` evidence of an entry that records a teardown — the machine-readable half of the same fact. */
export function teardownEvidence(reports: readonly ActionReport[]): readonly { readonly kind: string; readonly applied: boolean; readonly reason: string | null }[] {
  return reports.map(report => ({ kind: report.kind, applied: report.applied, reason: report.reason }));
}

export type InvocationOutcome =
  | { readonly kind: "acted"; readonly step: StepId; readonly outcome: Outcome; readonly deferred: boolean }
  | { readonly kind: "recorded"; readonly step: StepId; readonly outcome: Outcome }
  | { readonly kind: "waited"; readonly reason: string; readonly noted: boolean }
  /**
   * `stopStanding` names the stop this continuation could **not** lift. The attempt is
   * open, and nothing will arm while that mark stands, so the invocation may not report
   * success: the scheduled task's history shows nothing but the exit code for months, and
   * a deployment that cannot arm reported 0 indefinitely (measured by a gate, 2026-09-20).
   */
  | { readonly kind: "opened"; readonly attempt: string; readonly found: string; readonly stopStanding?: string | null }
  /**
   * `teardown` is what the teardown **did**, one report per action, not what it owed.
   * It used to be the core's boolean, and `report.ts` turned that boolean into the
   * sentence "both tasks are disabled and the certificate line is unset" — which the
   * CLI printed on a run where nothing had been applied at all, because no host
   * bindings existed. The owner reads that sentence at 15:06 and acts on it; it now
   * says what happened.
   */
  | { readonly kind: "aborted"; readonly step: StepId | null; readonly reason: string; readonly teardown: readonly ActionReport[]; readonly nextOwnerAction: string }
  | { readonly kind: "ended"; readonly seq: number; readonly reason: string }
  | { readonly kind: "done"; readonly reason: string }
  | { readonly kind: "yielded"; readonly reason: string }
  | { readonly kind: "reported" }
  | { readonly kind: "refused"; readonly reason: string }
  /**
   * `teardown` carries what a teardown did on the way out, when one ran before the failure
   * was classified. The A4 teardown at step 10 runs inside the lease and the store failure
   * is then rethrown, so without this field the owner is told the invocation failed and
   * never that both tasks were disabled and the certificate line removed.
   */
  | { readonly kind: "work-failed"; readonly reason: string; readonly teardown?: readonly ActionReport[] }
  /**
   * `teardown` carries the same thing here, and it has to (SC-7). The A4 reporting path
   * was wired to `work-failed` alone, and a genuine append failure never produces one:
   * every failure inside `session.append` leaves the store as a `LedgerStoreError`,
   * `withActivationLedger` rethrows it unchanged, and the invocation ends here instead.
   * So the invocation that had just disabled both tasks and removed the certificate line
   * told the owner only that the record was unreliable (R3-09).
   */
  | { readonly kind: "ledger-defect"; readonly stage: string; readonly reason: string; readonly teardown?: readonly ActionReport[] };

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
    case "opened":
      return outcome.stopStanding === undefined || outcome.stopStanding === null ? 0 : 4;
    case "acted":
      return outcome.outcome === "ok" || outcome.outcome === "already_in_target_state" ? 0 : 1;
    case "recorded":
    case "waited":
    case "ended":
    case "done":
    case "yielded":
    case "reported":
      return 0;
  }
}

/** Every abort pages, and so does a defect in the record (spec §4, §5; catalogue invariant 4). */
export function pages(outcome: InvocationOutcome): boolean {
  if (outcome.kind === "opened") return outcome.stopStanding !== undefined && outcome.stopStanding !== null;
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
    // The kinds, not the whole actions: the record says what the abort owed the world,
    // in two words a reader can check against the world a week later. It used to be a
    // boolean, which said that something was owed without saying what — and the shell
    // owed less than the boolean implied.
    evidence: { ...decision.evidence, reason: decision.reason, teardown: decision.teardown.map(action => action.kind) },
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

/**
 * The owner's own abort (ACT-27): a deliberate stop must not be readable as a crash.
 *
 * It takes the reports rather than a ready-made evidence record, so that the two halves of
 * the same fact cannot drift: the `actions` evidence and the sentence the owner acts on are
 * built here, from one argument. They used to be two — the caller assembled the evidence and
 * this function asserted, in a fixed string, that both tasks were disabled and the
 * certificate line removed. On a host with no bindings that string was false in the same
 * entry that recorded four `applied: false` actions, and the entry is append-only.
 */
export function ownerAbortDraft(operator: string, attempt: string, anchorDay: string, stamp: Stamp, applied: readonly ActionReport[], confirming: readonly ActionReport[] = []): LedgerDraft {
  const all = [...applied, ...confirming];
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: null,
    kind: "abort",
    outcome: null,
    // Two passes, two fields (SC-4): what the stop applied before it took the lease, and
    // what it re-applied while holding it. A reader a week later can tell a world that
    // was already safe from one that a racing invocation had re-armed in between, and
    // that difference is exactly what the second pass exists to catch.
    evidence: { actions: teardownEvidence(applied), confirming: teardownEvidence(confirming), reason: "OWNER_ABORT", operator },
    nextOwnerAction: `The owner stopped this attempt: ${teardownClauseOrSilence(all)}. Open a new attempt when the run is to continue.`,
  });
}

/**
 * A stop typed against an attempt that is already ended (SC-5).
 *
 * It is a note, not a second terminal entry: the attempt was ended once and ending it
 * twice would be a falsehood in an append-only record. What was **not** a falsehood
 * before this entry existed is what the record said about the world — nothing at all.
 * The invocation applied four actions and pinged three checks, exited 0, did not page,
 * and told the owner "Nothing was done" (R3-08).
 */
export function ownerAbortRepeatDraft(
  operator: string,
  attempt: string,
  anchorDay: string,
  stamp: Stamp,
  applied: readonly ActionReport[],
  confirming: readonly ActionReport[],
  endedAtSeq: number,
): LedgerDraft {
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: null,
    kind: "note",
    outcome: null,
    evidence: { actions: teardownEvidence(applied), confirming: teardownEvidence(confirming), ownerAbort: "ATTEMPT_ALREADY_ENDED", endedAtSeq, operator },
    // The CLI's page says "the reason is above and in the ledger's next_owner_action", so
    // this field may not be null on a branch that pages. Measured by a gate on 2026-09-20:
    // an operator following the page's own instruction found nothing here.
    nextOwnerAction: `This attempt was already ended at seq ${String(endedAtSeq)}; the stop was applied to the world again and changed nothing about that. ${teardownClauseOrSilence([...applied, ...confirming])} Open a new attempt when the run is to continue.`,
  });
}

/** What a stop's verdict means, in the words the owner reads (SC-4, SC-6). */
export function stopVerdictClause(verdict: "confirmed" | "no-bindings" | "unconfirmed", markFailure: string | null): string {
  if (markFailure !== null) return `the stop mark could NOT be written (${markFailure}), so a concurrent invocation could not see this stop`;
  switch (verdict) {
    case "confirmed":
      return "the stop is confirmed: it was re-applied under the lease and everything it attempted applied";
    case "no-bindings":
      return "the stop changed nothing, because this deployment has no host bindings: it decided and recorded, and the world is as it was";
    case "unconfirmed":
      return "the stop is NOT confirmed: at least one action it attempted did not apply";
  }
}

/**
 * The owner's abort against a ledger with no open attempt. The teardown has already been
 * applied by then — it runs before the lease, deliberately — and the command used to append
 * nothing at all, so the one record of a deliberate stop was a console line in a scheduled
 * context that may never show one. A note is not a terminal entry: there is no attempt to
 * end, and claiming one would be a second falsehood.
 */
export function ownerAbortWithoutAttemptDraft(operator: string, attempt: string, anchorDay: string, stamp: Stamp, applied: readonly ActionReport[], confirming: readonly ActionReport[] = []): LedgerDraft {
  return draft({
    stamp,
    attempt,
    anchorDay,
    step: null,
    kind: "note",
    outcome: null,
    evidence: { actions: teardownEvidence(applied), confirming: teardownEvidence(confirming), ownerAbort: "NO_ATTEMPT_OPEN", operator },
    nextOwnerAction: `No attempt was open in this state root, so nothing was ended — but the stop was applied to the world. ${teardownClauseOrSilence([...applied, ...confirming])} Check that this is the state root you meant.`,
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
export function classifyStoreFailure(stage: string, reason: string, teardown: readonly ActionReport[] = []): InvocationOutcome {
  if (stage === "callback" && reason === "WORK_FAILED") {
    return { kind: "work-failed", reason: "the invocation failed inside the ledger lease; the ledger itself is intact", teardown };
  }
  return { kind: "ledger-defect", stage, reason, teardown };
}
