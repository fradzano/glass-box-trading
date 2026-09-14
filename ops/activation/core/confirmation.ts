// The cross-check behind `activation confirm-alerts` (owner ruling 2026-09-14,
// sharpened by the owner's review the same day).
//
// The owner's statement that the alerts and a reminder reached his device is the
// evidence — catalogue invariant 16: a precondition confirmation comes from a
// human, never from the script. This function only refuses statements the checks'
// own flip history makes impossible, check by check, because three checks send
// three down notifications and one typed time cannot stand for all of them unless
// the owner states that one mail named all three.
//
// For each check there must be one contiguous down interval that carries the story:
// - it went down before that check's alert arrived (the interval starts at the
//   latest down flip before the alert, not at any down flip of some earlier day);
// - it did not come back up before the reminder arrived;
// - the alert arrived no later than the reminder;
// - the reminder arrived at least one reminder period after the down flip.
// The reminder must list all three checks. The confirmation is dated by the oldest
// receipt it rests on, as an exact instant.
//
// Pure: instants are UTC milliseconds; the flips need not be sorted.
import type { CheckFlip, CheckName } from "./types.ts";

/** The account's reminder setting is hourly (DECISIONS, 2026-09-11 23:54). */
export const REMINDER_PERIOD_MS = 3_600_000;

export interface AlertClaim {
  readonly operator: string;
  /** When each check's alert mail arrived. With `bundledAlert` one mail named all three, and the three times are that mail's. */
  readonly alertReceivedUtcMs: Readonly<Record<CheckName, number>>;
  readonly bundledAlert: boolean;
  readonly reminderReceivedUtcMs: number;
  /** The checks the reminder mail listed as down. */
  readonly reminderListed: readonly CheckName[];
}

export type AlertCrossCheck =
  | { readonly ok: true; readonly downFlipUtcMs: Readonly<Record<CheckName, number>>; readonly oldestReceiptUtcMs: number }
  | { readonly ok: false; readonly reasons: readonly string[] };

function checkNames(): readonly CheckName[] {
  return ["liveness", "readiness", "watchdog"];
}

/** The start of the down interval an alert belongs to: the latest down flip strictly before it, or null. */
function downFlipBefore(flips: readonly CheckFlip[], alertUtcMs: number): number | null {
  let latest: number | null = null;
  for (const flip of flips) {
    if (!flip.up && flip.utcMs < alertUtcMs && (latest === null || flip.utcMs > latest)) latest = flip.utcMs;
  }
  return latest;
}

export function crossCheckAlerts(claim: AlertClaim, flips: Readonly<Record<CheckName, readonly CheckFlip[]>>): AlertCrossCheck {
  const reasons: string[] = [];
  if (claim.operator.trim().length === 0) reasons.push("operator.missing");
  for (const name of checkNames()) {
    if (!claim.reminderListed.includes(name)) reasons.push(`reminder.does-not-list:${name}`);
  }
  const alerts = claim.alertReceivedUtcMs;
  if (claim.bundledAlert && (alerts.readiness !== alerts.liveness || alerts.watchdog !== alerts.liveness)) reasons.push("alert.bundled-but-times-differ");

  const found: { liveness: number | null; readiness: number | null; watchdog: number | null } = { liveness: null, readiness: null, watchdog: null };
  for (const name of checkNames()) {
    const alertUtcMs = alerts[name];
    if (claim.reminderReceivedUtcMs < alertUtcMs) {
      reasons.push(`${name}.reminder-before-alert`);
      continue;
    }
    const down = downFlipBefore(flips[name], alertUtcMs);
    if (down === null) {
      reasons.push(`${name}.no-down-flip-before-alert`);
      continue;
    }
    if (flips[name].some(flip => flip.up && flip.utcMs > down && flip.utcMs <= claim.reminderReceivedUtcMs)) {
      reasons.push(`${name}.up-flip-before-reminder`);
      continue;
    }
    if (claim.reminderReceivedUtcMs - down < REMINDER_PERIOD_MS) {
      reasons.push(`${name}.reminder-within-one-period-of-down`);
      continue;
    }
    found[name] = down;
  }

  if (reasons.length > 0 || found.liveness === null || found.readiness === null || found.watchdog === null) return { ok: false, reasons };
  const oldestReceiptUtcMs = Math.min(alerts.liveness, alerts.readiness, alerts.watchdog, claim.reminderReceivedUtcMs);
  return { ok: true, downFlipUtcMs: { liveness: found.liveness, readiness: found.readiness, watchdog: found.watchdog }, oldestReceiptUtcMs };
}
