// The `Schedule` of one attempt, derived from the anchor day (unit 10).
//
// No `Schedule` was constructed anywhere in this repository outside the unit-6 simulator
// until now, so every field here is a first production derivation and every one of them
// has a pinning test. The core only ever *compares* these values, which is what makes a
// wrong one so quiet: a certificate day one day off does not throw, it makes step 2's
// result stop counting and the attempt wait for a window that has passed.
//
// Time zones are the shell's business. This module converts a local wall-clock time into
// a UTC instant by *asking* a supplied converter and checking its answer, so the rule
// stays testable without `Intl` and without this host's zone database.
import type { LocalInstant, Schedule } from "../core/types.ts";
import type { Stamp, StampAt } from "./plan.ts";

/** The deployment facts an attempt does not derive: they are the same on every anchor day. */
export interface DeploymentFacts {
  readonly repoRoot: string;
  readonly activationRoot: string;
  /** The masked id of the long-run account the gate expects. */
  readonly longRunAccountMasked: string;
  /** The coverage date the installer is given (spec §5, step 1). */
  readonly coverageThroughDate: string;
  /** Spec §3, as step 0 must find them. */
  readonly expectedHostPreconditions: Readonly<Record<string, string>>;
  readonly minFreeDiskBytes: number;
}

export type BuiltSchedule =
  | { readonly ok: true; readonly schedule: Schedule }
  | { readonly ok: false; readonly reason: string };

/** Step 10's authority ends at 14:55 local on the anchor day (spec §5); equality is still valid. */
export const GATE_DEADLINE_MINUTE = 14 * 60 + 55;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(value: number, width: number): string {
  let text = String(value);
  while (text.length < width) text = `0${text}`;
  return text;
}

interface CivilDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function civilOf(date: string): CivilDay {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

function dateOf(civil: CivilDay): string {
  return `${pad(civil.year, 4)}-${pad(civil.month, 2)}-${pad(civil.day, 2)}`;
}

/**
 * The calendar day before `date`. Integer arithmetic rather than a `Date`, because a
 * `Date` would carry this host's zone into a pure function and turn a day boundary into
 * a question about where the process runs.
 */
export function previousDay(date: string): string {
  const civil = civilOf(date);
  if (civil.day > 1) return dateOf({ ...civil, day: civil.day - 1 });
  if (civil.month > 1) return dateOf({ year: civil.year, month: civil.month - 1, day: daysInMonth(civil.year, civil.month - 1) });
  return dateOf({ year: civil.year - 1, month: 12, day: 31 });
}

/** Days since 1970-01-01, by Howard Hinnant's `days_from_civil`. */
function daysFromCivil(civil: CivilDay): number {
  const year = civil.year - (civil.month <= 2 ? 1 : 0);
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (civil.month + (civil.month > 2 ? -3 : 9)) + 2) / 5) + civil.day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The UTC instant of a local wall-clock time, as far as the supplied converter is concerned. */
export type ToLocal = (utcMs: number) => LocalInstant;

export type ResolvedInstant =
  | { readonly ok: true; readonly utcMs: number }
  | { readonly ok: false; readonly reason: "LOCAL_TIME_DOES_NOT_EXIST" | "LOCAL_TIME_IS_AMBIGUOUS" };

/**
 * A local wall-clock moment as a UTC instant, found by trying every offset a European
 * zone can have and keeping the candidates the converter agrees with. Two survivors mean
 * the hour occurs twice (the October fallback) and none means it does not occur at all
 * (the March gap); both fail closed rather than pick one. The gate's 14:55 is in neither,
 * but a deadline that silently moved by an hour is exactly the defect that would only
 * show on the one day it matters.
 */
export function resolveLocalInstant(date: string, minute: number, toLocal: ToLocal): ResolvedInstant {
  const base = daysFromCivil(civilOf(date)) * 86_400_000 + minute * 60_000;
  const matches: number[] = [];
  for (const offsetMinutes of [0, 60, 120, 180]) {
    const candidate = base - offsetMinutes * 60_000;
    const local = toLocal(candidate);
    if (local.date === date && local.minute === minute && !matches.includes(candidate)) matches.push(candidate);
  }
  if (matches.length === 0) return { ok: false, reason: "LOCAL_TIME_DOES_NOT_EXIST" };
  if (matches.length > 1) return { ok: false, reason: "LOCAL_TIME_IS_AMBIGUOUS" };
  return { ok: true, utcMs: matches[0] as number };
}

/**
 * The ledger's time format, derived from the converter rather than from a second zone
 * table: local time with its own offset, never `Z` (spec §4, and the codec refuses `Z`).
 * The offset is *computed* from the difference between the local wall clock and the
 * instant, so a summer stamp carries `+02:00` and a winter one `+01:00` without this
 * module knowing anything about Europe.
 */
export function stampFactory(toLocal: ToLocal): StampAt {
  return (utcMs: number): Stamp => {
    const local = toLocal(utcMs);
    const localMs = daysFromCivil(civilOf(local.date)) * 86_400_000 + local.minute * 60_000;
    const flooredUtcMs = Math.floor(utcMs / 60_000) * 60_000;
    const offsetMinutes = (localMs - flooredUtcMs) / 60_000;
    const sign = offsetMinutes < 0 ? "-" : "+";
    const absolute = Math.abs(offsetMinutes);
    const withinMinute = utcMs - flooredUtcMs;
    const at = `${local.date}T${pad(Math.floor(local.minute / 60), 2)}:${pad(local.minute % 60, 2)}`
      + `:${pad(Math.floor(withinMinute / 1_000), 2)}.${pad(withinMinute % 1_000, 3)}`
      + `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
    return { at, atUtcMs: utcMs };
  };
}

/**
 * The attempt's schedule for one anchor day. The certificate run and the drills are the
 * evening before: steps 4 to 6 run from 22:05 on the certificate day into the night that
 * ends on the anchor day, which is why `drillNightDay` is the anchor day itself (the
 * unit-6 simulator has encoded the same relation since the sequences were written).
 */
export function buildSchedule(anchorDay: string, facts: DeploymentFacts, toLocal: ToLocal): BuiltSchedule {
  const gate = resolveLocalInstant(anchorDay, GATE_DEADLINE_MINUTE, toLocal);
  if (!gate.ok) {
    return { ok: false, reason: `the gate deadline 14:55 on ${anchorDay} is not a single instant: ${gate.reason}` };
  }
  const certificateDay = previousDay(anchorDay);
  return {
    ok: true,
    schedule: {
      certificateDay,
      drillNightDay: anchorDay,
      anchorDay,
      gateNotAfterUtcMs: gate.utcMs,
      longRunAccountMasked: facts.longRunAccountMasked,
      coverageThroughDate: facts.coverageThroughDate,
      expectedHostPreconditions: facts.expectedHostPreconditions,
      minFreeDiskBytes: facts.minFreeDiskBytes,
      repoRoot: facts.repoRoot,
      activationRoot: facts.activationRoot,
    },
  };
}
