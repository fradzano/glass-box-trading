// Exchange calendar arithmetic for the shell (S-G6-03: session boundaries come
// from the calendar's actual times, never from a hardcoded 09:30/16:00).
// Alpaca reports session times as wall-clock `HH:MM` in America/New_York;
// the conversion to epoch milliseconds needs the platform's time-zone
// tables, which is why it lives here and not in the core.
import type { DecisionSnapshot } from "../core/domain.js";
import { integerUnit } from "../core/domain.js";

export interface CalendarDay {
  readonly date: string;
  /** Wall-clock `HH:MM` in America/New_York. */
  readonly open: string;
  readonly close: string;
}

const NEW_YORK = "America/New_York";

function zoneOffsetMinutes(utcMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: NEW_YORK, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map(part => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]), Number(parts["hour"]), Number(parts["minute"]), Number(parts["second"]));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** New York wall-clock date + `HH:MM` to epoch milliseconds (DST-correct through the platform's zone tables). */
export function newYorkToEpochMs(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = zoneOffsetMinutes(guess);
  const first = guess - offset * 60_000;
  // Re-check the offset at the candidate instant (transition days).
  const second = zoneOffsetMinutes(first);
  return second === offset ? first : guess - second * 60_000;
}

/** The trading date (New York wall-clock date) that contains `utcMs`. */
export function newYorkDate(utcMs: number): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK, year: "numeric", month: "2-digit", day: "2-digit" });
  return formatter.format(new Date(utcMs));
}

export function sessionFor(days: readonly CalendarDay[], date: string): DecisionSnapshot["calendar"] {
  const day = days.find(item => item.date === date);
  if (day === undefined) {
    return { isTradingDay: false, opensAt: integerUnit(0, "EpochMilliseconds"), closesAt: integerUnit(0, "EpochMilliseconds") };
  }
  return { isTradingDay: true, opensAt: integerUnit(newYorkToEpochMs(day.date, day.open), "EpochMilliseconds"), closesAt: integerUnit(newYorkToEpochMs(day.date, day.close), "EpochMilliseconds") };
}

/** The first calendar session strictly after `date`. */
export function nextTradingDay(days: readonly CalendarDay[], date: string): string | null {
  const later = days.map(item => item.date).filter(item => item > date).sort();
  return later[0] ?? null;
}

/** Remaining sessions from `date` (exclusive) to `expiry` (inclusive): the S-G8/G9 `remainingTradingSessions` an analyst must state. */
export function remainingSessions(days: readonly CalendarDay[], date: string, expiry: string): number {
  return days.filter(item => item.date > date && item.date <= expiry).length;
}

/** Expiries whose remaining-session count lies inside `[min, max]`, in calendar order. */
export function expiriesWithin(days: readonly CalendarDay[], date: string, min: number, max: number): readonly string[] {
  return days.map(item => item.date).filter(item => {
    const remaining = remainingSessions(days, date, item);
    return remaining >= min && remaining <= max;
  }).sort();
}
