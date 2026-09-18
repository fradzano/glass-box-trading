// Unit 6: the activation core run against a simulated world, invocation by
// invocation, from an opened attempt to its end. Unit 5 showed that each answer is
// right for its ledger and its world; these tests show that the answers compose —
// that applying every decision the way the shell will walks the step table in order,
// and that every abort path ends where spec §5 says, with nothing left able to trade.
//
// Every sequence is also held to the catalogue's invariants 1 and 3: the cycle task is
// never enabled beside a certificate line unless the gate is recorded, a tearing abort
// leaves both tasks disabled and no line, and an aborted attempt only ever answers
// `ended` afterwards.
import { describe, expect, it } from "vitest";
import { stepDone } from "../core/fold.ts";
import { executionOrder } from "../core/steps.ts";
import type { Decision, StepId } from "../core/types.ts";
import { CERT_PATH, foldOfWorld, freshWorld, openAttempt, ownerAbort, ownerPausesChecks, runUntil, scheduleFor, utcOf } from "./simulator.ts";
import type { SimWorld, Trace } from "./simulator.ts";



const MON = "2026-09-21";
const TUE = "2026-09-22";
const NEXT_MON = "2026-09-28";
const NEXT_TUE = "2026-09-29";
const SCHEDULE = scheduleFor(MON, TUE);

function started(): SimWorld {
  const world = freshWorld(utcOf(MON, 15, 0));
  openAttempt(world, "a1", TUE);
  return world;
}

function clock(entry: Trace): string {
  const hours = String(Math.floor(entry.local.minute / 60)).padStart(2, "0");
  const minutes = String(entry.local.minute % 60).padStart(2, "0");
  return `${entry.local.date} ${hours}:${minutes}`;
}

function reason(decision: Decision): string | null {
  return decision.kind === "abort" ? decision.reason : null;
}

/** The steps in the order they first acted or recorded. */
function stepsInOrder(trace: readonly Trace[]): readonly StepId[] {
  const seen: StepId[] = [];
  for (const entry of trace) {
    const decision = entry.decision;
    if ((decision.kind === "act" || decision.kind === "record") && !seen.includes(decision.step)) seen.push(decision.step);
  }
  return seen;
}

function firstAt(trace: readonly Trace[], step: StepId): string | null {
  const entry = trace.find(item => (item.decision.kind === "act" || item.decision.kind === "record") && item.decision.step === step);
  return entry === undefined ? null : clock(entry);
}

function onlyAbort(trace: readonly Trace[]): { readonly entry: Trace; readonly index: number } {
  const indices = trace.flatMap((entry, index) => (entry.decision.kind === "abort" ? [index] : []));
  const index = indices[0];
  const entry = index === undefined ? undefined : trace[index];
  if (entry === undefined || index === undefined) throw new Error("expected an abort");
  return { entry, index };
}

function expectSafe(trace: readonly Trace[]): void {
  const ended = new Set<string>();
  for (const entry of trace) {
    const decision = entry.decision;
    if (entry.attempt !== null && ended.has(entry.attempt)) expect(decision.kind, `attempt ${entry.attempt} acted after its abort at ${clock(entry)}`).toBe("ended");
    if (entry.certificateLine !== null && entry.cycleEnabled) expect(entry.gateDone, `cycle enabled beside a certificate line without a gate at ${clock(entry)}`).toBe(true);
    // `teardown` is a list now, and an empty list is truthy in JavaScript: guarding on
    // the value alone made this fire on every abort after the gate, which owes nothing.
    if (decision.kind === "abort" && decision.teardown.length > 0) expect([entry.cycleEnabled, entry.watchdogEnabled, entry.certificateLine], `teardown incomplete at ${clock(entry)}`).toEqual([false, false, null]);
    // An abort for a ledger that cannot be appended to writes no entry, so it cannot end the attempt (unit 9).
    if (decision.kind === "abort" && entry.attempt !== null && !decision.reason.startsWith("LEDGER_")) ended.add(entry.attempt);
  }
}

describe("activation sequences — the happy path (ACT-01)", () => {
  const world = started();
  const trace = runUntil(world, SCHEDULE, utcOf(TUE, 15, 30));

  it("walks every step in execution order, once, with no abort, and ends done", () => {
    expect(trace.filter(entry => entry.decision.kind === "abort").map(entry => `${clock(entry)} ${reason(entry.decision) ?? ""}`)).toEqual([]);
    expect(stepsInOrder(trace)).toEqual(executionOrder());
    expect(trace.at(-1)?.decision.kind).toBe("done");
    const fold = foldOfWorld(world);
    for (const step of executionOrder()) expect(stepDone(fold, step), step).toBe(true);
    expectSafe(trace);
  });

  it("acts at the moments the model predicts", () => {
    expect({
      preflight: firstAt(trace, "0-preflight"),
      certificate: firstAt(trace, "2-certificate"),
      enable: firstAt(trace, "4-enable"),
      watchdogDisable: firstAt(trace, "5a-watchdog-disable"),
      watchdogDown: firstAt(trace, "5b-watchdog-down"),
      watchdogUp: firstAt(trace, "5d-watchdog-up"),
      silence: firstAt(trace, "6a-silence-disable"),
      silenceDown: firstAt(trace, "6b-silence-down"),
      reboot: firstAt(trace, "8-reboot"),
      rearm: firstAt(trace, "7-rearm"),
      proof: firstAt(trace, "9-proof"),
      gate: firstAt(trace, "10-gate"),
      anchor: firstAt(trace, "11-anchor"),
    }).toEqual({
      preflight: "2026-09-21 15:30",
      certificate: "2026-09-21 16:05",
      enable: "2026-09-21 22:05",
      watchdogDisable: "2026-09-21 22:15",
      watchdogDown: "2026-09-21 22:40",
      watchdogUp: "2026-09-21 22:50",
      silence: "2026-09-21 23:00",
      silenceDown: "2026-09-22 00:10",
      reboot: "2026-09-22 13:30",
      rearm: "2026-09-22 13:50",
      proof: "2026-09-22 14:05",
      gate: "2026-09-22 14:35",
      anchor: "2026-09-22 15:20",
    });
  });

  it("closes the reboot from the boot in the first invocation after it", () => {
    const reboot = trace.filter(entry => (entry.decision.kind === "act" || entry.decision.kind === "record") && entry.decision.step === "8-reboot");
    expect(reboot.map(entry => `${clock(entry)} ${entry.decision.kind}`)).toEqual(["2026-09-22 13:30 act", "2026-09-22 13:35 record"]);
  });

  it("leaves the run armed: both tasks enabled, the validated path written, the disarm deleted, the measurement period started", () => {
    expect(world.tasks.cycle.enabled && world.tasks.watchdog.enabled).toBe(true);
    expect(world.certificateLine).toBe(CERT_PATH);
    expect(world.disarm.registered).toBe(false);
    expect(world.bootstrap).not.toBeNull();
    expect(Object.values(world.checks).map(check => check.status)).toEqual(["up", "up", "up"]);
  });
});

describe("activation sequences — backward paths", () => {
  it("ACT-13 / round 5 A3: a failed certificate ends the attempt, and nothing is ever enabled", () => {
    const world = started();
    world.certificateVerdict = "FAIL";
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 0, 45));
    const { entry, index } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-21 16:05", "CERTIFICATE_NOT_PASS"]);
    expect(trace.slice(index + 1).every(item => item.decision.kind === "ended")).toBe(true);
    expect(trace.some(item => item.cycleEnabled || item.watchdogEnabled)).toBe(false);
    expectSafe(trace);
  });

  it("ACT-27: the owner's abort during the watchdog drill stops everything and is read as deliberate", () => {
    const world = started();
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 0, 45), (w, now) => {
      if (now.date === MON && now.minute === 22 * 60 + 27) ownerAbort(w);
    });
    const later = trace.filter(item => item.local.date === TUE || item.local.minute > 22 * 60 + 27);
    expect(later.length).toBeGreaterThan(0);
    expect(later.every(item => item.decision.kind === "ended" && item.decision.reason.includes("by the owner"))).toBe(true);
    expect([world.tasks.cycle.enabled, world.tasks.watchdog.enabled, world.certificateLine, world.disarm.registered]).toEqual([false, false, null, false]);
    expect(foldOfWorld(world).attemptEnded?.byOwner).toBe(true);
    expectSafe(trace);
  });

  it("ACT-24 / round 5 A2: after a red gate, the retry a week later runs steps 4 to 11 again and arms", () => {
    const world = started();
    const first = runUntil(world, SCHEDULE, utcOf(TUE, 16, 10), (w, now) => {
      if (now.date === TUE && now.minute === 14 * 60 + 34) w.checks.readiness.status = "paused";
    });
    const { entry } = onlyAbort(first);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-22 14:35", "GATE_RED"]);
    expect([world.tasks.cycle.enabled, world.certificateLine]).toEqual([false, null]);
    expectSafe(first);

    world.nowUtcMs = utcOf(NEXT_MON, 15, 0);
    ownerPausesChecks(world);
    openAttempt(world, "a2", NEXT_TUE);
    const retry = runUntil(world, scheduleFor(NEXT_MON, NEXT_TUE), utcOf(NEXT_TUE, 15, 30));
    expect(retry.filter(item => item.decision.kind === "abort").map(item => `${clock(item)} ${reason(item.decision) ?? ""}`)).toEqual([]);
    // Review of 2026-09-14, point 3: the preflight and the flat check run again; the installation and the certificate carry over.
    expect(stepsInOrder(retry)).toEqual(["0-preflight", "3-flat", ...executionOrder().slice(executionOrder().indexOf("4-enable"))]);
    expect(retry.at(-1)?.decision.kind).toBe("done");
    expect(world.certificateLine).toBe(CERT_PATH);
    expectSafe(retry);
  });

  /** The first attempt of ACT-24, ended by a red gate: the state every retry below starts from. */
  function afterRedGate(): SimWorld {
    const world = started();
    const first = runUntil(world, SCHEDULE, utcOf(TUE, 16, 10), (w, now) => {
      if (now.date === TUE && now.minute === 14 * 60 + 34) w.checks.readiness.status = "paused";
    });
    expect(reason(onlyAbort(first).entry.decision)).toBe("GATE_RED");
    return world;
  }

  it("review 2026-09-14, point 3: a retry more than fourteen days after the alert confirmation stops at step 0, and nothing is enabled", () => {
    const world = afterRedGate();
    const LATE_MON = "2026-10-05";
    const LATE_TUE = "2026-10-06";
    world.nowUtcMs = utcOf(LATE_MON, 15, 0);
    ownerPausesChecks(world);
    openAttempt(world, "a2", LATE_TUE);
    const retry = runUntil(world, scheduleFor(LATE_MON, LATE_TUE), utcOf(LATE_MON, 23, 0));
    const { entry, index } = onlyAbort(retry);
    expect([clock(entry), entry.decision.kind === "abort" ? entry.decision.step : null, reason(entry.decision)]).toEqual([`${LATE_MON} 15:30`, "0-preflight", "PREFLIGHT_RED"]);
    expect(retry.slice(index + 1).every(item => item.decision.kind === "ended")).toBe(true);
    expect(retry.some(item => item.cycleEnabled || item.watchdogEnabled)).toBe(false);
    expectSafe(retry);
  });

  it("review 2026-09-14, point 3: a retry whose dev account is no longer flat stops at step 3, and nothing is enabled", () => {
    const world = afterRedGate();
    world.nowUtcMs = utcOf(NEXT_MON, 15, 0);
    ownerPausesChecks(world);
    world.devPositions = 1;
    openAttempt(world, "a2", NEXT_TUE);
    const retry = runUntil(world, scheduleFor(NEXT_MON, NEXT_TUE), utcOf(NEXT_MON, 23, 0));
    const { entry, index } = onlyAbort(retry);
    expect([clock(entry), entry.decision.kind === "abort" ? entry.decision.step : null, reason(entry.decision)]).toEqual([`${NEXT_MON} 15:35`, "3-flat", "DEV_ACCOUNT_NOT_FLAT"]);
    expect(retry.slice(index + 1).every(item => item.decision.kind === "ended")).toBe(true);
    expect(retry.some(item => item.cycleEnabled || item.watchdogEnabled)).toBe(false);
    expectSafe(retry);
  });

  it("ACT-29: a crash between the enable's intent and its actions aborts as an interrupted step", () => {
    const world = started();
    world.crash = { step: "4-enable", afterActions: false };
    const trace = runUntil(world, SCHEDULE, utcOf(MON, 22, 30));
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-21 22:10", "STEP_INTERRUPTED"]);
    expectSafe(trace);
  });

  it("ACT-29: a crash after the enable took effect is caught by 0-resume first, and torn down", () => {
    const world = started();
    world.crash = { step: "4-enable", afterActions: true };
    const trace = runUntil(world, SCHEDULE, utcOf(MON, 22, 30));
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-21 22:10", "WORLD_MISMATCH"]);
    expect([world.tasks.cycle.enabled, world.tasks.watchdog.enabled]).toEqual([false, false]);
    expectSafe(trace);
  });

  it("ACT-26: a task enabled by hand during the silence drill is red, not a shortcut", () => {
    const world = started();
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 0, 45), (w, now) => {
      if (now.date === MON && now.minute === 23 * 60 + 20) w.tasks.cycle.enabled = true;
    });
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-21 23:20", "WORLD_MISMATCH"]);
    expect(world.tasks.cycle.enabled).toBe(false);
    expectSafe(trace);
  });

  it("ACT-20: a machine that comes back after the re-arm deadline aborts without ever enabling", () => {
    const world = started();
    world.rebootMinutes = 40;
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 15, 30));
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-22 14:10", "REBOOT_NOT_CLOSED_BEFORE_REARM_DEADLINE"]);
    expect(trace.filter(item => item.local.date === TUE).some(item => item.cycleEnabled)).toBe(false);
    expectSafe(trace);
  });
});

describe("activation sequences — degraded paths", () => {
  it("ACT-39: a torn tail after the gate is a tearing abort — the armed state can no longer be shown", () => {
    const world = started();
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 15, 30), (w, now) => {
      if (now.date === TUE && now.minute === 15 * 60 + 17) w.ledgerText += "{\"seq\":";
    });
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-22 15:20", "LEDGER_TORN"]);
    expect([world.tasks.cycle.enabled, world.certificateLine]).toEqual([false, null]);
    expectSafe(trace);
  });

  it("ACT-45: a wrapper still firing during an outage makes the silence drill invalid instead of counted", () => {
    const world = started();
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 0, 45), (w, now) => {
      if (now.date === MON && now.minute === 23 * 60 + 5) {
        w.strayCycleWrapper = true;
        w.network = false;
      }
    });
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision)]).toEqual(["2026-09-21 23:15", "DRILL_INVALID"]);
    expect(trace.some(item => item.decision.kind === "record" && item.decision.step === "6b-silence-down")).toBe(false);
    expectSafe(trace);
  });

  it("ACT-50: a liveness ping that reaches the watchdog check keeps the watchdog up, so the drill never passes", () => {
    const world = started();
    world.mixedUpLivenessPing = true;
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 0, 45));
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision), entry.decision.kind === "abort" ? entry.decision.step : null]).toEqual(["2026-09-21 22:55", "STEP_DEADLINE_MISSED", "5b-watchdog-down"]);
    expect(trace.some(item => item.decision.kind === "record" && item.decision.step === "5b-watchdog-down")).toBe(false);
    expectSafe(trace);
  });

  it("ACT-43 / spec §5: a missing anchor firing after the gate pages without tearing down the armed run", () => {
    const world = started();
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 16, 5), (w, now) => {
      if (now.date === TUE && now.minute === 15 * 60 + 14) w.cycleStalled = true;
    });
    const { entry } = onlyAbort(trace);
    expect(entry.decision).toMatchObject({ kind: "abort", step: "11-anchor", reason: "STEP_DEADLINE_MISSED", teardown: [] });
    expect(clock(entry)).toBe("2026-09-22 16:05");
    expect([world.tasks.cycle.enabled, world.tasks.watchdog.enabled, world.certificateLine]).toEqual([true, true, CERT_PATH]);
    expectSafe(trace);
  });

  it("ACT-46 / ACT-48: an outage before the silence drill waits out 6a's window and aborts at its deadline", () => {
    const world = started();
    const trace = runUntil(world, SCHEDULE, utcOf(TUE, 0, 45), (w, now) => {
      if (now.date === MON && now.minute === 22 * 60 + 52) w.network = false;
    });
    const { entry } = onlyAbort(trace);
    expect([clock(entry), reason(entry.decision), entry.decision.kind === "abort" ? entry.decision.step : null]).toEqual(["2026-09-21 23:20", "STEP_DEADLINE_MISSED", "6a-silence-disable"]);
    expect(trace.filter(item => item.local.minute > 22 * 60 + 52 && item.local.minute <= 23 * 60 + 15).every(item => item.decision.kind === "wait")).toBe(true);
    expectSafe(trace);
  });
});
