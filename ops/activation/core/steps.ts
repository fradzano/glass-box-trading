// The step table (spec §5) as data: when each step may run, in which order, and
// what the world is expected to look like after each phase.
//
// Two review findings live here. Every step carries a `notValidAfter`, so an
// invocation that arrives late — a catch-up after a slow reboot, a restart after a
// crash — does not act (round 2, A2). And `0-resume` judges the world against the
// expectation of the phase the ledger says we are in, not against absolutes: an
// enabled task is red before step 4 and expected after it, a certificate line is
// red between step 0 and step 10 and expected after it (round 4, B3).
//
// Pure. Dates are the schedule's strings; times are minutes since local midnight.
import type { LedgerFold } from "./fold.ts";
import { stepDone } from "./fold.ts";
import type { LocalInstant, Schedule, StepId, TaskName } from "./types.ts";

export function localAt(date: string, hour: number, minute: number): LocalInstant {
  return { date, minute: hour * 60 + minute };
}

/** Negative when `a` is earlier, positive when later, zero when equal. `YYYY-MM-DD` strings order correctly. */
export function compareLocal(a: LocalInstant, b: LocalInstant): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.minute - b.minute;
}

export interface StepWindow {
  /** The earliest moment the step may act; null when it has no earliest time. */
  readonly opens: LocalInstant | null;
  /** The last moment the step may begin; an invocation after it aborts instead of acting. */
  readonly notValidAfter: LocalInstant;
}

/**
 * The windows of spec §5, rev 6. Steps 0 and 1 have no clock of their own but gate
 * step 2, so they expire with it. The drill phases share their drill's window; the
 * first phase of each drill carries the tighter start bound the detection
 * arithmetic needs (5a: a watchdog firing by 22:25 so the check is down by 22:45;
 * 6a: a ping by 23:15 so readiness is down by 00:20).
 *
 * Closing the reboot's result is not bound by `8-reboot`'s window: the first
 * invocation after the boot closes it, which may be past 13:45 but must happen
 * before `7-rearm` expires.
 */
export function stepWindow(step: StepId, schedule: Schedule): StepWindow {
  const certificate = schedule.certificateDay;
  const night = schedule.drillNightDay;
  const anchor = schedule.anchorDay;
  switch (step) {
    case "0-preflight":
    case "1-install":
      return { opens: null, notValidAfter: localAt(certificate, 22, 40) };
    case "2-certificate":
      return { opens: localAt(certificate, 15, 35), notValidAfter: localAt(certificate, 22, 40) };
    case "3-flat":
      return { opens: localAt(certificate, 15, 35), notValidAfter: localAt(certificate, 22, 45) };
    case "4-enable":
      return { opens: localAt(certificate, 22, 5), notValidAfter: localAt(certificate, 22, 20) };
    case "5a-watchdog-disable":
      return { opens: localAt(certificate, 22, 15), notValidAfter: localAt(certificate, 22, 25) };
    case "5b-watchdog-down":
    case "5c-watchdog-reenable":
    case "5d-watchdog-up":
      return { opens: localAt(certificate, 22, 15), notValidAfter: localAt(certificate, 22, 50) };
    case "6a-silence-disable":
      return { opens: localAt(certificate, 22, 50), notValidAfter: localAt(certificate, 23, 15) };
    case "6b-silence-down":
    case "6c-silence-clear":
      return { opens: localAt(certificate, 22, 50), notValidAfter: localAt(night, 0, 30) };
    case "8-reboot":
      return { opens: localAt(anchor, 13, 30), notValidAfter: localAt(anchor, 13, 45) };
    case "7-rearm":
      return { opens: localAt(anchor, 13, 50), notValidAfter: localAt(anchor, 13, 59) };
    case "9-proof":
      return { opens: localAt(anchor, 14, 5), notValidAfter: localAt(anchor, 14, 35) };
    case "10-gate":
      return { opens: localAt(anchor, 14, 35), notValidAfter: localAt(anchor, 14, 55) };
    case "11-anchor":
      return { opens: localAt(anchor, 15, 20), notValidAfter: localAt(anchor, 16, 0) };
  }
}

/** The order the steps run in: by the clock, which puts the reboot (8) before the re-arm (7). */
export function executionOrder(): readonly StepId[] {
  return [
    "0-preflight", "1-install", "2-certificate", "3-flat", "4-enable",
    "5a-watchdog-disable", "5b-watchdog-down", "5c-watchdog-reenable", "5d-watchdog-up",
    "6a-silence-disable", "6b-silence-down", "6c-silence-clear",
    "8-reboot", "7-rearm", "9-proof", "10-gate", "11-anchor",
  ];
}

/**
 * Every step requires all steps before it in execution order. That is stricter
 * than a hand-picked list and closes round 5's A3 by construction: step 4 cannot
 * run on an evening whose certificate or flat check did not come back `ok`.
 */
export function prerequisites(step: StepId): readonly StepId[] {
  const order = executionOrder();
  return order.slice(0, order.indexOf(step));
}

/** The first step in execution order that is not done for the current attempt, or null when all are. */
export function nextStep(fold: LedgerFold): StepId | null {
  return executionOrder().find(step => !stepDone(fold, step)) ?? null;
}

export type TaskExpectation = "enabled" | "disabled";

/** What both task states should be, given what the ledger says is done. */
export function expectedTasks(fold: LedgerFold): Readonly<Record<TaskName, TaskExpectation>> {
  if (stepDone(fold, "7-rearm")) return { cycle: "enabled", watchdog: "enabled" };
  if (stepDone(fold, "6a-silence-disable")) return { cycle: "disabled", watchdog: "disabled" };
  if (stepDone(fold, "4-enable")) {
    const watchdogDrilled = stepDone(fold, "5a-watchdog-disable") && !stepDone(fold, "5c-watchdog-reenable");
    return { cycle: "enabled", watchdog: watchdogDrilled ? "disabled" : "enabled" };
  }
  return { cycle: "disabled", watchdog: "disabled" };
}

export type CertificateLineExpectation = "absent" | "present" | "any";

/**
 * Whether `PRE_ARM_CERTIFICATE` should be in `.env`. Before step 0 the host carries
 * a stale line and removing it is step 0's own job, so no expectation holds yet.
 * Between step 0 and a green gate it must be absent — that absence is the latch.
 * After step 10 it must be present.
 */
export function expectedCertificateLine(fold: LedgerFold): CertificateLineExpectation {
  if (stepDone(fold, "10-gate")) return "present";
  if (stepDone(fold, "0-preflight")) return "absent";
  return "any";
}
