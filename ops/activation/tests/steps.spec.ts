// Spec §5, revision 6: the step table as data. Every window below is copied from the
// spec's table on purpose, because three of the review rounds found a deadline that
// contradicted the arithmetic it depended on — step 4 running to 22:40 while step 5
// needed its firing by 22:25, the re-arm valid until 14:30 when the proof needs the
// 14:00 firing, the silence drill's midnight crossing — and each of those must fail
// a test the moment it comes back.
import { describe, expect, it } from "vitest";
import { foldLedger } from "../core/fold.ts";
import { parseLedgerText, planLedgerAppend } from "../core/ledger.ts";
import { compareLocal, executionOrder, expectedCertificateLine, expectedTasks, localAt, nextStep, prerequisites, stepWindow } from "../core/steps.ts";
import type { Schedule, StepId } from "../core/types.ts";

const SCHEDULE: Schedule = {
  certificateDay: "2026-09-21",
  drillNightDay: "2026-09-22",
  anchorDay: "2026-09-22",
  gateNotAfterUtcMs: Date.UTC(2026, 8, 22, 12, 55),
  longRunAccountMasked: "PA3L…U97",
  coverageThroughDate: "2026-12-16",
  expectedHostPreconditions: {},
  minFreeDiskBytes: 0,
  repoRoot: "repo",
  activationRoot: "state",
};

function foldOf(done: readonly StepId[]) {
  let text = "";
  let tail = { lastSeq: 0, lastAtUtcMs: null as number | null };
  let clock = 1_789_990_000_000;
  for (const step of done) {
    for (const kind of ["intent", "result"] as const) {
      clock += 1_000;
      const planned = planLedgerAppend(tail, {
        at: new Date(clock + 2 * 60 * 60 * 1_000).toISOString().replace("Z", "+02:00"),
        atUtcMs: clock,
        attempt: "a1",
        anchorDay: SCHEDULE.anchorDay,
        step,
        kind,
        outcome: kind === "result" ? "ok" : null,
        evidence: {},
        nextOwnerAction: null,
      });
      if (!planned.ok) throw new Error(planned.reason);
      text += planned.line;
      tail = { lastSeq: planned.entry.seq, lastAtUtcMs: planned.entry.atUtcMs };
    }
  }
  return foldLedger(parseLedgerText(text));
}

function upTo(step: StepId): readonly StepId[] {
  const order = executionOrder();
  return order.slice(0, order.indexOf(step) + 1);
}

describe("activation steps — the windows of spec §5", () => {
  const MON = SCHEDULE.certificateDay;
  const TUE = SCHEDULE.anchorDay;
  const table: readonly (readonly [StepId, string | null, number | null, string, number])[] = [
    ["0-preflight", null, null, MON, 22 * 60 + 40],
    ["1-install", null, null, MON, 22 * 60 + 40],
    ["2-certificate", MON, 15 * 60 + 35, MON, 22 * 60 + 40],
    ["3-flat", MON, 15 * 60 + 35, MON, 22 * 60 + 45],
    ["4-enable", MON, 22 * 60 + 5, MON, 22 * 60 + 20],
    ["5a-watchdog-disable", MON, 22 * 60 + 15, MON, 22 * 60 + 25],
    ["5b-watchdog-down", MON, 22 * 60 + 15, MON, 22 * 60 + 50],
    ["5c-watchdog-reenable", MON, 22 * 60 + 15, MON, 22 * 60 + 50],
    ["5d-watchdog-up", MON, 22 * 60 + 15, MON, 22 * 60 + 50],
    ["6a-silence-disable", MON, 22 * 60 + 50, MON, 23 * 60 + 15],
    ["6b-silence-down", MON, 22 * 60 + 50, TUE, 30],
    ["6c-silence-clear", MON, 22 * 60 + 50, TUE, 30],
    ["8-reboot", TUE, 13 * 60 + 30, TUE, 13 * 60 + 45],
    ["7-rearm", TUE, 13 * 60 + 50, TUE, 13 * 60 + 59],
    ["9-proof", TUE, 14 * 60 + 5, TUE, 14 * 60 + 35],
    ["10-gate", TUE, 14 * 60 + 35, TUE, 14 * 60 + 55],
    ["11-anchor", TUE, 15 * 60 + 20, TUE, 16 * 60],
  ];

  for (const [step, opensDate, opensMinute, lastDate, lastMinute] of table) {
    it(`${step} opens ${opensDate === null ? "without an earliest time" : `${opensDate} +${String(opensMinute)}min`} and is not valid after ${lastDate} +${String(lastMinute)}min`, () => {
      const window = stepWindow(step, SCHEDULE);
      expect(window.opens).toEqual(opensDate === null ? null : { date: opensDate, minute: opensMinute });
      expect(window.notValidAfter).toEqual({ date: lastDate, minute: lastMinute });
    });
  }

  it("covers every step exactly once", () => {
    expect([...table.map(row => row[0])].sort()).toEqual([...executionOrder()].sort());
  });
});

describe("activation steps — order and prerequisites", () => {
  it("runs the reboot before the re-arm, by the clock", () => {
    const order = executionOrder();
    expect(order.indexOf("8-reboot")).toBeLessThan(order.indexOf("7-rearm"));
    expect(order.indexOf("7-rearm")).toBeLessThan(order.indexOf("9-proof"));
  });

  it("makes step 4 require the certificate and the flat check (round 5, A3)", () => {
    expect(prerequisites("4-enable")).toEqual(["0-preflight", "1-install", "2-certificate", "3-flat"]);
    expect(prerequisites("0-preflight")).toEqual([]);
  });

  it("compares local instants across midnight", () => {
    expect(compareLocal(localAt("2026-09-21", 23, 50), localAt("2026-09-22", 0, 10))).toBeLessThan(0);
    expect(compareLocal(localAt("2026-09-22", 0, 10), localAt("2026-09-21", 23, 50))).toBeGreaterThan(0);
    expect(compareLocal(localAt("2026-09-22", 13, 59), localAt("2026-09-22", 13, 59))).toBe(0);
  });

  it("names the first step that is not done", () => {
    expect(nextStep(foldOf([]))).toBe("0-preflight");
    expect(nextStep(foldOf(["0-preflight", "1-install", "2-certificate", "3-flat"]))).toBe("4-enable");
    expect(nextStep(foldOf(upTo("6c-silence-clear")))).toBe("8-reboot");
    expect(nextStep(foldOf(executionOrder()))).toBeNull();
  });
});

describe("activation steps — what the world should look like in each phase", () => {
  it("expects both tasks disabled until step 4 enables them", () => {
    expect(expectedTasks(foldOf(upTo("3-flat")))).toEqual({ cycle: "disabled", watchdog: "disabled" });
    expect(expectedTasks(foldOf(upTo("4-enable")))).toEqual({ cycle: "enabled", watchdog: "enabled" });
  });

  it("expects only the watchdog disabled between its drill's disable and re-enable", () => {
    expect(expectedTasks(foldOf(upTo("5b-watchdog-down")))).toEqual({ cycle: "enabled", watchdog: "disabled" });
    expect(expectedTasks(foldOf(upTo("5c-watchdog-reenable")))).toEqual({ cycle: "enabled", watchdog: "enabled" });
  });

  it("expects both tasks disabled from the silence drill until the re-arm", () => {
    expect(expectedTasks(foldOf(upTo("6a-silence-disable")))).toEqual({ cycle: "disabled", watchdog: "disabled" });
    expect(expectedTasks(foldOf(upTo("8-reboot")))).toEqual({ cycle: "disabled", watchdog: "disabled" });
    expect(expectedTasks(foldOf(upTo("7-rearm")))).toEqual({ cycle: "enabled", watchdog: "enabled" });
  });

  it("expects no particular certificate line before step 0, none until the gate, and one after it", () => {
    expect(expectedCertificateLine(foldOf([]))).toBe("any");
    expect(expectedCertificateLine(foldOf(["0-preflight"]))).toBe("absent");
    expect(expectedCertificateLine(foldOf(upTo("9-proof")))).toBe("absent");
    expect(expectedCertificateLine(foldOf(upTo("10-gate")))).toBe("present");
  });
});
