// The cross-check of gate condition 4 (owner ruling and review, 2026-09-14). The
// story below is the real one in shape: the three checks went down at 22:01 on
// 2026-09-11, the alert arrived a minute later, an hourly reminder arrived after
// midnight, and the checks came back up at 01:30. The exact receipt times are the
// owner's to type; these are test values, and an earlier drill on 2026-09-05 sits in
// the flip history to prove that an old down flip cannot carry a new claim.
import { describe, expect, it } from "vitest";
import { crossCheckAlerts, REMINDER_PERIOD_MS } from "../core/confirmation.ts";
import type { AlertClaim } from "../core/confirmation.ts";
import type { CheckFlip, CheckName } from "../core/types.ts";

const DOWN = Date.UTC(2026, 8, 11, 20, 1);
const ALERT = Date.UTC(2026, 8, 11, 20, 2);
const REMINDER = Date.UTC(2026, 8, 11, 22, 58);
const UP = Date.UTC(2026, 8, 11, 23, 30, 1);
const EARLIER_DOWN = Date.UTC(2026, 8, 5, 22, 3);
const EARLIER_UP = Date.UTC(2026, 8, 5, 22, 40);

function history(): readonly CheckFlip[] {
  return [{ utcMs: UP, up: true }, { utcMs: DOWN, up: false }, { utcMs: EARLIER_UP, up: true }, { utcMs: EARLIER_DOWN, up: false }];
}

function flipsOf(each: readonly CheckFlip[]): Readonly<Record<CheckName, readonly CheckFlip[]>> {
  return { liveness: each, readiness: each, watchdog: each };
}

function claim(overrides: Partial<AlertClaim> = {}): AlertClaim {
  return {
    operator: "felix",
    alertReceivedUtcMs: { liveness: ALERT, readiness: ALERT, watchdog: ALERT },
    bundledAlert: false,
    reminderReceivedUtcMs: REMINDER,
    reminderListed: ["liveness", "readiness", "watchdog"],
    ...overrides,
  };
}

function reasonsOf(result: ReturnType<typeof crossCheckAlerts>): readonly string[] {
  return result.ok ? [] : result.reasons;
}

describe("confirmation — the cross-check of gate condition 4", () => {
  it("assigns each check the down flip its alert belongs to and dates the confirmation by the oldest receipt", () => {
    expect(crossCheckAlerts(claim(), flipsOf(history()))).toEqual({ ok: true, downFlipUtcMs: { liveness: DOWN, readiness: DOWN, watchdog: DOWN }, oldestReceiptUtcMs: ALERT });
  });

  it("dates by the oldest of all receipts when the alerts arrived at different times", () => {
    const result = crossCheckAlerts(claim({ alertReceivedUtcMs: { liveness: ALERT + 120_000, readiness: ALERT, watchdog: ALERT + 60_000 } }), flipsOf(history()));
    expect(result.ok && result.oldestReceiptUtcMs).toBe(ALERT);
  });

  it("does not let an old down flip carry the claim when the check came back up in between", () => {
    const beforeTheRealDown = crossCheckAlerts(claim({ alertReceivedUtcMs: { liveness: DOWN - 60_000, readiness: ALERT, watchdog: ALERT } }), flipsOf(history()));
    expect(reasonsOf(beforeTheRealDown)).toEqual(["liveness.up-flip-before-reminder"]);
  });

  it("refuses a check with no down flip before its alert", () => {
    expect(reasonsOf(crossCheckAlerts(claim(), { ...flipsOf(history()), watchdog: [] }))).toEqual(["watchdog.no-down-flip-before-alert"]);
  });

  it("refuses when the check came back up before the reminder arrived", () => {
    const earlyUp: readonly CheckFlip[] = [{ utcMs: REMINDER - 60_000, up: true }, { utcMs: DOWN, up: false }];
    expect(reasonsOf(crossCheckAlerts(claim(), { ...flipsOf(history()), readiness: earlyUp }))).toEqual(["readiness.up-flip-before-reminder"]);
  });

  it("requires the reminder a full period after the down flip, and accepts it at exactly one period", () => {
    expect(reasonsOf(crossCheckAlerts(claim({ reminderReceivedUtcMs: DOWN + REMINDER_PERIOD_MS - 1 }), flipsOf(history())))).toEqual([
      "liveness.reminder-within-one-period-of-down", "readiness.reminder-within-one-period-of-down", "watchdog.reminder-within-one-period-of-down",
    ]);
    expect(crossCheckAlerts(claim({ reminderReceivedUtcMs: DOWN + REMINDER_PERIOD_MS }), flipsOf(history())).ok).toBe(true);
  });

  it("refuses a reminder before an alert", () => {
    expect(reasonsOf(crossCheckAlerts(claim({ alertReceivedUtcMs: { liveness: ALERT, readiness: REMINDER + 60_000, watchdog: ALERT } }), flipsOf(history())))).toContain("readiness.reminder-before-alert");
  });

  it("requires the reminder to list all three checks", () => {
    expect(reasonsOf(crossCheckAlerts(claim({ reminderListed: ["liveness", "readiness"] }), flipsOf(history())))).toEqual(["reminder.does-not-list:watchdog"]);
  });

  it("accepts one bundled alert mail only with one time for all three checks", () => {
    expect(crossCheckAlerts(claim({ bundledAlert: true }), flipsOf(history())).ok).toBe(true);
    expect(reasonsOf(crossCheckAlerts(claim({ bundledAlert: true, alertReceivedUtcMs: { liveness: ALERT, readiness: ALERT, watchdog: ALERT + 60_000 } }), flipsOf(history())))).toEqual(["alert.bundled-but-times-differ"]);
  });

  it("refuses a confirmation without an operator", () => {
    expect(reasonsOf(crossCheckAlerts(claim({ operator: "  " }), flipsOf(history())))).toEqual(["operator.missing"]);
  });

  it("does not depend on the order of the flips", () => {
    expect(crossCheckAlerts(claim(), flipsOf([...history()].reverse())).ok).toBe(true);
  });
});
