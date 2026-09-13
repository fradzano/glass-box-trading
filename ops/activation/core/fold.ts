// The fold (spec §4, §5): from the ledger to what the current attempt has done.
//
// Three rules carry it, and each answers a finding of the spec's review rounds:
// - An `abort` entry ends its attempt. No later invocation of that attempt may
//   act, whatever the world then looks like (round 5, A3).
// - Steps 0 to 3 are facts about the artefact — the host, the installation, the
//   certificate, the flat dev account — and carry over from any attempt. Every
//   later step asserts something about one attempt's day and counts only inside
//   that attempt, so a retry can never inherit yesterday's reboot proof (round 5,
//   A2). An attempt has exactly one anchor day; scoping to the attempt is the
//   stricter form of scoping to the day.
// - An intent without a following result is an interrupted step, never a done one.
//
// Pure: the ledger is already parsed, and nothing here reads a clock.
import type { ParsedLedger } from "./ledger.ts";
import { ledgerIntegrity } from "./ledger.ts";
import type { LedgerEntry, Outcome, StepId } from "./types.ts";

export interface StepState {
  readonly step: StepId;
  readonly attempt: string;
  readonly intentSeq: number | null;
  readonly intentAtUtcMs: number | null;
  readonly resultSeq: number | null;
  readonly outcome: Outcome | null;
  readonly resultEvidence: Readonly<Record<string, unknown>> | null;
}

export interface CurrentAttempt {
  readonly id: string;
  readonly anchorDay: string;
  readonly firstSeq: number;
}

export interface AttemptEnd {
  readonly seq: number;
  readonly step: StepId | null;
  /** The owner's own abort carries no step: it ends the attempt from outside the table. */
  readonly byOwner: boolean;
}

export interface LedgerFold {
  readonly integrity: "intact" | "torn" | "corrupt";
  readonly empty: boolean;
  readonly lastEntry: LedgerEntry | null;
  readonly currentAttempt: CurrentAttempt | null;
  readonly attemptEnded: AttemptEnd | null;
  /** The state of each step as it counts for the current attempt. */
  readonly steps: Readonly<Partial<Record<StepId, StepState>>>;
  /** The latest step of the current attempt whose intent has no result after it. */
  readonly interrupted: StepState | null;
  /** The `seq` values that correction entries name as damaged. */
  readonly corrections: readonly number[];
  /** Ledger shapes that make the phase ambiguous even though every line parsed. */
  readonly inconsistencies: readonly string[];
}

/** The steps whose results are facts about the artefact rather than about one day. */
export function carriesOver(step: StepId): boolean {
  return step === "0-preflight" || step === "1-install" || step === "2-certificate" || step === "3-flat";
}

function correctedSeq(entry: LedgerEntry): number | null {
  const value = entry.evidence["corrects"];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function withIntent(previous: StepState | undefined, entry: LedgerEntry, step: StepId): StepState {
  return {
    step,
    attempt: entry.attempt,
    intentSeq: entry.seq,
    intentAtUtcMs: entry.atUtcMs,
    resultSeq: previous?.attempt === entry.attempt ? previous.resultSeq : null,
    outcome: previous?.attempt === entry.attempt ? previous.outcome : null,
    resultEvidence: previous?.attempt === entry.attempt ? previous.resultEvidence : null,
  };
}

function withResult(previous: StepState | undefined, entry: LedgerEntry, step: StepId): StepState {
  const sameAttempt = previous?.attempt === entry.attempt;
  return {
    step,
    attempt: entry.attempt,
    intentSeq: sameAttempt ? previous.intentSeq : null,
    intentAtUtcMs: sameAttempt ? previous.intentAtUtcMs : null,
    resultSeq: entry.seq,
    outcome: entry.outcome,
    resultEvidence: entry.evidence,
  };
}

export function foldLedger(parsed: ParsedLedger): LedgerFold {
  const entries = parsed.entries;
  const lastEntry = entries.at(-1) ?? null;
  const corrections: number[] = [];
  const inconsistencies: string[] = [];

  if (lastEntry === null) {
    return { integrity: ledgerIntegrity(parsed), empty: true, lastEntry: null, currentAttempt: null, attemptEnded: null, steps: {}, interrupted: null, corrections, inconsistencies };
  }

  // Attempts must be contiguous runs, each with one anchor day.
  const closedAttempts: string[] = [];
  const anchorDayOf: Record<string, string> = {};
  let runAttempt: string | null = null;
  for (const entry of entries) {
    if (entry.kind === "correction") {
      const target = correctedSeq(entry);
      if (target !== null) corrections.push(target);
    }
    const knownDay = anchorDayOf[entry.attempt];
    if (knownDay === undefined) {
      anchorDayOf[entry.attempt] = entry.anchorDay;
    } else if (knownDay !== entry.anchorDay) {
      inconsistencies.push(`ATTEMPT_ANCHOR_DAY_CHANGED:${entry.attempt}@${String(entry.seq)}`);
    }
    if (entry.attempt !== runAttempt) {
      if (closedAttempts.includes(entry.attempt)) inconsistencies.push(`ATTEMPT_INTERLEAVED:${entry.attempt}@${String(entry.seq)}`);
      if (runAttempt !== null) closedAttempts.push(runAttempt);
      runAttempt = entry.attempt;
    }
  }

  const currentId = lastEntry.attempt;
  const firstOfCurrent = entries.find(entry => entry.attempt === currentId);
  const currentAttempt: CurrentAttempt = { id: currentId, anchorDay: lastEntry.anchorDay, firstSeq: firstOfCurrent?.seq ?? lastEntry.seq };

  const steps: Partial<Record<StepId, StepState>> = {};
  let attemptEnded: AttemptEnd | null = null;
  for (const entry of entries) {
    const inCurrent = entry.attempt === currentId;
    if (entry.kind === "abort" && inCurrent && attemptEnded === null) {
      attemptEnded = { seq: entry.seq, step: entry.step, byOwner: entry.step === null };
    }
    const step = entry.step;
    if (step === null) continue;
    if (!carriesOver(step) && !inCurrent) continue;
    if (entry.kind === "intent") steps[step] = withIntent(steps[step], entry, step);
    if (entry.kind === "result") steps[step] = withResult(steps[step], entry, step);
  }

  let interrupted: StepState | null = null;
  for (const state of Object.values(steps)) {
    if (state.attempt !== currentId || state.intentSeq === null) continue;
    const open = state.resultSeq === null || state.resultSeq < state.intentSeq;
    if (open && (interrupted === null || (interrupted.intentSeq ?? 0) < state.intentSeq)) interrupted = state;
  }

  return { integrity: ledgerIntegrity(parsed), empty: false, lastEntry, currentAttempt, attemptEnded, steps, interrupted, corrections, inconsistencies };
}

/** Whether a step counts as done for the current attempt. `already_in_target_state` is done; `unknown` is not (A1). */
export function stepDone(fold: LedgerFold, step: StepId): boolean {
  const state = fold.steps[step];
  if (state === undefined || state.resultSeq === null) return false;
  if (state.intentSeq !== null && state.resultSeq < state.intentSeq) return false;
  return state.outcome === "ok" || state.outcome === "already_in_target_state";
}
