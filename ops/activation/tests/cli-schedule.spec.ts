// The attempt's schedule, derived from the anchor day (unit 10). The core only compares
// these fields, so a wrong one is silent: it does not throw, it makes a step's result
// stop counting or a window sit in the past. The gate deadline is checked against the
// real Europe/Berlin zone and against a converter that lies, because 14:55 on the anchor
// day is the one instant in this system that may not move by an hour.
import { describe, expect, it } from "vitest";
import { buildSchedule, GATE_DEADLINE_MINUTE, previousDay, resolveLocalInstant, stampFactory } from "../cli/schedule.ts";
import type { DeploymentFacts, ToLocal } from "../cli/schedule.ts";
import { planLedgerAppend } from "../core/ledger.ts";
import { berlinLocal } from "../readers/parse.ts";
import type { LocalInstant } from "../core/types.ts";

const FACTS: DeploymentFacts = {
  repoRoot: "C:\\Users\\felix\\source\\repos\\glass-box-trading",
  activationRoot: "C:\\Users\\felix\\glass-box-state\\activation-1",
  longRunStateDir: "C:\\Users\\felix\\glass-box-state\\longrun-2026-09-22",
  longRunAccountMasked: "PA3L…U97",
  coverageThroughDate: "2026-12-16",
  expectedHostPreconditions: { HiberbootEnabled: "0", DisableAutomaticRestartSignOn: "1" },
  minFreeDiskBytes: 10_000_000_000,
};

function scheduleOf(anchorDay: string, toLocal: ToLocal = berlinLocal) {
  const built = buildSchedule(anchorDay, FACTS, toLocal);
  if (!built.ok) throw new Error(built.reason);
  return built.schedule;
}

describe("the day before the anchor", () => {
  it("is the calendar day before it", () => {
    expect(previousDay("2026-09-22")).toBe("2026-09-21");
  });

  it("crosses a month, a year and a leap day without a Date", () => {
    expect(previousDay("2026-10-01")).toBe("2026-09-30");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2026-05-01")).toBe("2026-04-30");
  });
});

describe("the gate deadline as a UTC instant", () => {
  it("is 14:55 Berlin on the anchor day, in summer time", () => {
    expect(scheduleOf("2026-09-22").gateNotAfterUtcMs).toBe(Date.UTC(2026, 8, 22, 12, 55));
  });

  it("is 14:55 Berlin on the anchor day, in winter time", () => {
    expect(scheduleOf("2026-12-15").gateNotAfterUtcMs).toBe(Date.UTC(2026, 11, 15, 13, 55));
  });

  it("converts back to the local time it was asked for", () => {
    for (const day of ["2026-09-22", "2026-03-30", "2026-10-26", "2027-01-04"]) {
      expect(berlinLocal(scheduleOf(day).gateNotAfterUtcMs)).toEqual({ date: day, minute: GATE_DEADLINE_MINUTE });
    }
  });

  it("refuses a local time that does not exist, rather than shifting it into the gap", () => {
    // Europe/Berlin jumps 02:00 → 03:00 on 2026-03-29; 02:30 is never on the clock.
    expect(resolveLocalInstant("2026-03-29", 150, berlinLocal)).toEqual({ ok: false, reason: "LOCAL_TIME_DOES_NOT_EXIST" });
  });

  it("refuses a local time that happens twice, rather than picking the first", () => {
    // 2026-10-25 runs 02:00 → 03:00 → 02:00; 02:30 is two distinct instants.
    expect(resolveLocalInstant("2026-10-25", 150, berlinLocal)).toEqual({ ok: false, reason: "LOCAL_TIME_IS_AMBIGUOUS" });
  });

  it("refuses to build a schedule whose gate deadline is not a single instant", () => {
    const stuck: ToLocal = () => ({ date: "1970-01-01", minute: 0 });
    const built = buildSchedule("2026-09-22", FACTS, stuck);
    expect(built).toEqual({ ok: false, reason: "the gate deadline 14:55 on 2026-09-22 is not a single instant: LOCAL_TIME_DOES_NOT_EXIST" });
  });

  it("takes the converter's word, not this host's zone", () => {
    // A converter in UTC+0 must produce 14:55 UTC, even though the real zone is not.
    const utc: ToLocal = utcMs => {
      const value = new Date(utcMs);
      const date = `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
      return { date, minute: value.getUTCHours() * 60 + value.getUTCMinutes() } satisfies LocalInstant;
    };
    expect(scheduleOf("2026-09-22", utc).gateNotAfterUtcMs).toBe(Date.UTC(2026, 8, 22, 14, 55));
  });
});

describe("the schedule of one attempt", () => {
  it("puts the certificate run and the drills on the evening before the anchor", () => {
    const schedule = scheduleOf("2026-09-22");
    expect(schedule.certificateDay).toBe("2026-09-21");
    expect(schedule.drillNightDay).toBe("2026-09-22");
    expect(schedule.anchorDay).toBe("2026-09-22");
  });

  it("moves the certificate day with the anchor when the run slips a week", () => {
    expect(scheduleOf("2026-09-29").certificateDay).toBe("2026-09-28");
  });

  it("carries the deployment facts through unchanged", () => {
    const schedule = scheduleOf("2026-09-22");
    expect(schedule.repoRoot).toBe(FACTS.repoRoot);
    expect(schedule.activationRoot).toBe(FACTS.activationRoot);
    expect(schedule.longRunAccountMasked).toBe(FACTS.longRunAccountMasked);
    expect(schedule.coverageThroughDate).toBe("2026-12-16");
    expect(schedule.expectedHostPreconditions).toEqual(FACTS.expectedHostPreconditions);
    expect(schedule.minFreeDiskBytes).toBe(10_000_000_000);
  });
});

describe("the moment a ledger line carries", () => {
  const stamp = stampFactory(berlinLocal);

  it("writes local time with its own offset, in summer", () => {
    expect(stamp(Date.UTC(2026, 8, 22, 12, 55, 3, 42))).toEqual({
      at: "2026-09-22T14:55:03.042+02:00",
      atUtcMs: Date.UTC(2026, 8, 22, 12, 55, 3, 42),
    });
  });

  it("writes the winter offset without being told the zone changed", () => {
    expect(stamp(Date.UTC(2026, 11, 15, 13, 55)).at).toBe("2026-12-15T14:55:00.000+01:00");
  });

  it("writes both sides of a daylight-saving change correctly", () => {
    // 2026-10-25 02:00 CEST steps back to 02:00 CET: same wall clock, two offsets.
    expect(stamp(Date.UTC(2026, 9, 25, 0, 30)).at).toBe("2026-10-25T02:30:00.000+02:00");
    expect(stamp(Date.UTC(2026, 9, 25, 1, 30)).at).toBe("2026-10-25T02:30:00.000+01:00");
  });

  it("writes a west-of-Greenwich offset with its minus sign", () => {
    // The factory claims to work off whatever converter it is given, not off Europe.
    const newYork: ToLocal = utcMs => {
      const shifted = new Date(utcMs - 5 * 60 * 60 * 1_000);
      const date = `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
      return { date, minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
    };
    expect(stampFactory(newYork)(Date.UTC(2026, 8, 22, 12, 55)).at).toBe("2026-09-22T07:55:00.000-05:00");
  });

  it("round-trips through the codec that will store it", () => {
    for (const utcMs of [Date.UTC(2026, 8, 22, 12, 55), Date.UTC(2026, 11, 15, 13, 55, 59, 999), Date.UTC(2026, 2, 29, 1, 30)]) {
      const made = stamp(utcMs);
      const planned = planLedgerAppend({ lastSeq: 0, lastAtUtcMs: null }, {
        at: made.at,
        atUtcMs: made.atUtcMs,
        attempt: "2026-09-22.1",
        anchorDay: "2026-09-22",
        step: null,
        kind: "note",
        outcome: null,
        evidence: {},
        nextOwnerAction: null,
      });
      if (!planned.ok) throw new Error(`${made.at}: ${planned.reason}`);
      expect(planned.entry.atUtcMs).toBe(utcMs);
    }
  });
});
