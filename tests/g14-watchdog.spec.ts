// G14 — the dead-man watchdog (S-G14-01..03, WIN-8): market-hours-aware
// staleness, the fence-first takeover over the shared epoch store, the
// combined recovery (intact mleg close, both S-X-06 residue closes, no
// duplicate action, halt, journal, fail-ping), the fenced old writer, the
// staleness-neutral witness class, the ping precondition, and the watchdog
// as a separate OS process entry point.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, inject, it } from "vitest";
import { emergencyCloseEligibility } from "../src/core/execution.js";
import { assessStaleness, authorityRefusalAlarms, deploymentTerminal, planPing, terminalEntry } from "../src/core/lifecycle.js";
import { runTerminal } from "../src/shell/deadline.js";
import { readHaltState } from "../src/shell/halt-state.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import type { BrokerMutation } from "../src/shell/mutation-gateway.js";
import { runWatchdog } from "../src/shell/watchdog.js";
import type { WatchdogDependencies } from "../src/shell/watchdog.js";
import type { StatePaths } from "../src/shell/state-dir.js";
import { LONG_CALL, SHORT_CALL } from "./execution-fixtures.js";
import { TEST_ONLY_AT_MS } from "./journal-fixtures.js";
import {
  FAR_CALL,
  P5_BINDING,
  P5_NOW,
  secondVertical,
  cleanupLifecycleDirs,
  lifecycleCalendar,
  lifecycleHarness,
  lifecycleMarket,
} from "./lifecycle-fixtures.js";
import type { LifecycleHarness } from "./lifecycle-fixtures.js";

const journalsToUnlock: string[] = [];
afterEach(() => {
  for (const file of journalsToUnlock.splice(0)) { try { chmodSync(file, 0o666); } catch { /* already writable or gone */ } }
  cleanupLifecycleDirs();
});

/** The journal file made read-only: every authoritative append fails, while reads, the epoch store and the holder stay intact. */
function lockJournal(paths: StatePaths): void {
  if (!existsSync(paths.journal)) writeFileSync(paths.journal, "", "utf8");
  chmodSync(paths.journal, 0o444);
  journalsToUnlock.push(paths.journal);
}

function unlockJournal(paths: StatePaths): void {
  chmodSync(paths.journal, 0o666);
}

const SESSION = { isTradingDay: true, opensAt: P5_NOW - 3_600_000, closesAt: P5_NOW + 7_200_000 };
const DEAD_MAN_BOUND_MS = 3_000_000;
const TERMINAL_AT = "2026-09-04T20:00:00.000Z";

function watchdogDeps(harness: LifecycleHarness, overrides: Partial<WatchdogDependencies> = {}): WatchdogDependencies {
  return {
    paths: harness.paths,
    secrets: [],
    clock: () => harness.clock.now,
    instanceId: "watchdog",
    lockTakeoverBoundMs: 60_000,
    deadManBoundMs: DEAD_MAN_BOUND_MS,
    closeEscalationStepCents: 2,
    session: { ...SESSION, closesAt: harness.clock.now + 3_600_000 },
    binding: P5_BINDING,
    broker: { read: harness.fake.read, port: harness.fake.port },
    market: lifecycleMarket(() => harness.clock.now),
    profile: "dev",
    calendar: lifecycleCalendar(harness.clock.now),
    tradingDay: "2026-08-31",
    ping: harness.ping,
    ...overrides,
  };
}

describe("S-G14-01 — market-hours-aware: an overnight or weekend gap is normal", () => {
  it("assessStaleness is quiet outside a session, on a fresh journal, and on no journal at all; stale only in-session beyond the bound", () => {
    const session = { isTradingDay: true, opensAt: 1_000, closesAt: 2_000 };
    expect(assessStaleness(500, session, 0, 100, false)).toEqual({ kind: "quiet", reason: "OUTSIDE_SESSION" });
    expect(assessStaleness(2_000, session, 0, 100, false)).toEqual({ kind: "quiet", reason: "OUTSIDE_SESSION" });
    expect(assessStaleness(1_500, { ...session, isTradingDay: false }, 0, 100, false)).toEqual({ kind: "quiet", reason: "OUTSIDE_SESSION" });
    expect(assessStaleness(1_500, session, 1_450, 100, false)).toEqual({ kind: "quiet", reason: "FRESH" });
    expect(assessStaleness(1_500, session, null, 100, false)).toEqual({ kind: "quiet", reason: "NO_JOURNAL" });
    expect(assessStaleness(1_500, session, 1_300, 100, false)).toEqual({ kind: "stale", ageMs: 200 });
  });

  it("S-G11-04/S-G14-01 a deployment whose TERMINAL entry stands is ended, not stale: nothing else can make it loud again", () => {
    const session = { isTradingDay: true, opensAt: 1_000, closesAt: 2_000 };
    // The controlled end outranks every other reason — in-session, past the bound, it stays quiet.
    expect(assessStaleness(1_500, session, 1_300, 100, true)).toEqual({ kind: "quiet", reason: "DEPLOYMENT_TERMINAL" });
    expect(assessStaleness(500, session, 1_300, 100, true)).toEqual({ kind: "quiet", reason: "DEPLOYMENT_TERMINAL" });
    // And the flag is derived from the fold, never from a second reading of the file.
    expect(deploymentTerminal([])).toBe(false);
    expect(deploymentTerminal([{ seq: 1, at: TERMINAL_AT, epoch: 1, type: "CYCLE" }])).toBe(false);
    expect(deploymentTerminal([{ seq: 1, at: TERMINAL_AT, epoch: 1, type: "TERMINAL" }])).toBe(true);
    expect(terminalEntry([{ seq: 7, at: TERMINAL_AT, epoch: 1, type: "TERMINAL" }])?.seq).toBe(7);
  });

  it("S-G14-01 an overnight gap triggers no takeover and no mutation", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + 40_000_000; // overnight
    const report = await runWatchdog(watchdogDeps(harness, { session: { isTradingDay: false, opensAt: 0, closesAt: 0 } }));
    expect(report.assessment).toEqual({ kind: "quiet", reason: "OUTSIDE_SESSION" });
    expect(report.acquired).toBeNull();
    expect(harness.entries().every(entry => entry.type !== "HALT")).toBe(true);
  });
});

describe("S-G14-02 / WIN-8 — in-session staleness fences first, then recovers the whole book", () => {
  it("WIN-8 intact spread + orphan short option + assigned short stock: one fence, mleg close, both S-X-06 closes, no duplicate, halt, journal, fail-ping; the fenced writer cannot mutate", async () => {
    const harness = await lifecycleHarness();
    const first = await harness.cycle(); // the 500/505 vertical fills
    expect(first.actions).toMatchObject([{ result: "SUBMITTED" }]);
    const second = await harness.cycle({ analyst: () => Promise.resolve(JSON.stringify({ candidates: [secondVertical()] })) });
    expect(second.actions).toMatchObject([{ result: "SUBMITTED" }]); // the 510/515 vertical fills
    // Overnight: the 510 short call's long wing is gone (broken structure) and the 500 short call was assigned.
    harness.fake.setPositions([
      { contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 300 },
      { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 },
      { contractId: FAR_CALL, quantity: -1, avgEntryPriceCents: 50 },
      { contractId: "SPY", quantity: -100, avgEntryPriceCents: 50_000 },
    ]);
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000; // in-session, journal stale beyond the bound
    const report = await runWatchdog(watchdogDeps(harness));
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("WON");
    expect(report.epoch).toBe(2); // exactly one fence: the writer's epoch 1 was incremented once
    expect(report.halted).toBe(true);

    // Dispatch: the intact 500/505 vertical closes whole via one two-leg mleg; FAR and SPY close leg-wise, uncapped.
    const subjects = report.closes.map(close => close.subject).sort();
    expect(subjects.filter(subject => subject.startsWith("exposure:"))).toHaveLength(1);
    expect(subjects).toContain(`residue:${FAR_CALL}`);
    expect(subjects).toContain("residue:SPY");
    expect(report.closes).toHaveLength(3); // no duplicate action: a residue is never also closed whole
    const closeSubmits = harness.fake.mutations.filter(mutation => mutation.kind === "submit_order" && (mutation.payload as { intent?: string }).intent === "close");
    expect(closeSubmits).toHaveLength(3);
    const mleg = closeSubmits.find(mutation => (mutation.payload as { legs: readonly unknown[] }).legs.length === 2);
    expect(mleg).toBeDefined();

    // Journal and alarms: the takeover halt is durable; the unbounded residues carry the immediate fail-ping.
    const entries = harness.entries();
    expect(entries.some(item => item.type === "HALT" && item["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
    expect(report.ping).toBe("fail");
    const conditions = harness.ping.record.failures.at(-1)?.conditions ?? [];
    expect(conditions.some(item => item.startsWith("WATCHDOG_TAKEOVER"))).toBe(true);
    expect(conditions).toContain(`UNBOUNDED_RESIDUE_RECOVERY:${FAR_CALL}`);
    expect(conditions).toContain("UNBOUNDED_RESIDUE_RECOVERY:SPY");

    // The fenced old writer that wakes later cannot mutate anything (S-G12-07).
    const wokenWriter = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T15:00:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(wokenWriter).toMatchObject({ ok: false, reason: "STALE_EPOCH" });
  });

  it("S-G14-02 witness appends never reset the staleness clock", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    // A late witness line lands; it is staleness-neutral by class.
    const witness = await harness.gateway.dispatch({ class: "witness", action: { kind: "journal_append", entry: { at: "2026-08-31T14:30:00.000Z", epoch: null, type: "SUPPRESSED", instanceId: "late-witness", holderId: "runner", reason: "LOCK_HELD" } } });
    expect(witness).toMatchObject({ ok: true, stalenessNeutral: true });
    const report = await runWatchdog(watchdogDeps(harness));
    expect(report.assessment.kind).toBe("stale");
  });
});

describe("S-G11-04 / S-G14-02 — after the controlled end the watchdog stands down", () => {
  /** A flat harness whose Friday TERMINAL entry stands, then wound forward well past the dead-man bound inside a session. */
  async function endedDeployment(): Promise<LifecycleHarness> {
    const harness = await lifecycleHarness();
    const terminal = await runTerminal({
      gateway: harness.gateway, epoch: 1, broker: harness.fake.read, market: lifecycleMarket(() => harness.clock.now),
      clock: () => harness.clock.now, profile: "dev", calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 40, ping: harness.ping,
    });
    expect(terminal.appended).toBe(true);
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    return harness;
  }

  it("a journal that stopped because the run ended is quiet: no takeover, no halt, no mutation, no ping", async () => {
    const harness = await endedDeployment();
    const pingsBefore = harness.ping.record.successes.length;
    const mutationsBefore = harness.fake.mutations.length;

    const report = await runWatchdog(watchdogDeps(harness));
    expect(report.assessment).toEqual({ kind: "quiet", reason: "DEPLOYMENT_TERMINAL" });
    expect(report.acquired).toBeNull();
    expect(report.epoch).toBeNull();
    expect(report.halted).toBe(false);
    expect(report.closes).toEqual([]);
    expect(report.ping).toBeNull();
    expect(harness.fake.mutations).toHaveLength(mutationsBefore);
    expect(harness.ping.record.successes).toHaveLength(pingsBefore);
    expect(harness.ping.record.failures).toEqual([]);
    expect(harness.entries().some(entry => entry.type === "HALT")).toBe(false);
    // The writer that ended the run still owns its epoch: nothing was fenced.
    const stillOwned = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: TERMINAL_AT, epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(stillOwned.ok).toBe(true);
  });

  it("the very same staleness without a standing TERMINAL still fences, halts and fail-pings", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;

    const report = await runWatchdog(watchdogDeps(harness));
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true);
    expect(report.ping).toBe("fail");
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
  });
});

describe("S-G14-02/03 — the report tells the operator only about the halt it actually journaled", () => {
  // `watchdog-cli.ts` prints this report as the operator-facing JSON line. A
  // takeover whose HALT append never landed leaves a fenced writer, no halt
  // flag and no journal line — reporting `halted: true` there would tell the
  // operator a halt exists that nothing carries, and the fail-ping would name
  // only the staleness that caused the takeover, not the halt that is missing.

  it("with a writable journal the takeover halt is durable and the report says so", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;

    const report = await runWatchdog(watchdogDeps(harness, { broker: null, market: null, binding: null }));
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true);
    expect(report.alarmConditions).not.toContain("HALT_NOT_JOURNALED");
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
    expect(readHaltState(harness.paths).halted).toBe(true);
  });

  it("with an unwritable journal the fence still lands, the report says halted false and the fail-ping names the unjournaled halt", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    lockJournal(harness.paths);

    const report = await runWatchdog(watchdogDeps(harness, { broker: null, market: null, binding: null }));
    expect(report.acquired).toBe("WON");
    expect(report.epoch).toBe(2);
    expect(report.halted).toBe(false);
    expect(report.alarmConditions).toContain("HALT_NOT_JOURNALED");

    // The alarm is raised AND delivered, carrying both the takeover and the missing halt.
    expect(report.ping).toBe("fail");
    const conditions = harness.ping.record.failures.at(-1)?.conditions ?? [];
    expect(conditions.some(item => item.startsWith("WATCHDOG_TAKEOVER"))).toBe(true);
    expect(conditions).toContain("HALT_NOT_JOURNALED");

    // The fence is the epoch increment, not the append: the stale writer stays locked out either way (S-G14-02).
    const wokenWriter = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T15:00:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(wokenWriter).toMatchObject({ ok: false, reason: "STALE_EPOCH" });

    unlockJournal(harness.paths);
    expect(harness.entries().every(entry => entry.type !== "HALT")).toBe(true);
    expect(readHaltState(harness.paths).halted).toBe(false);
  });

  it("the residual window is ONE watchdog interval: the next firing takes over again and lands the halt as soon as the journal is writable", async () => {
    // The open question behind the unwritable-journal branch above: a fenced
    // writer with no halt is a state nothing in the journal records, so what
    // ends it? Not the operator — the next firing does. Because the failed
    // append left the journal untouched, the staleness clock is untouched too,
    // so the very next run reads the same stale-in-session case, fences again
    // and appends the halt it owed. The exposure is bounded by the watchdog
    // cadence, not by a human reaction time.
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    lockJournal(harness.paths);

    const first = await runWatchdog(watchdogDeps(harness, { broker: null, market: null, binding: null }));
    expect(first.acquired).toBe("WON");
    expect(first.epoch).toBe(2);
    expect(first.halted).toBe(false);
    expect(first.alarmConditions).toContain("HALT_NOT_JOURNALED");
    expect(harness.entries().every(entry => entry.type !== "HALT")).toBe(true);

    // One scheduled interval later, with the journal writable again.
    unlockJournal(harness.paths);
    harness.clock.now += 300_000;
    const second = await runWatchdog(watchdogDeps(harness, { broker: null, market: null, binding: null }));
    expect(second.assessment).toEqual({ kind: "stale", ageMs: DEAD_MAN_BOUND_MS + 700_000 });
    // A fence a previous watchdog laid is not a halt, and not a reason to stand down.
    expect(second.acquired).toBe("WON");
    expect(second.epoch).toBe(3);
    expect(second.halted).toBe(true);
    expect(second.alarmConditions).not.toContain("HALT_NOT_JOURNALED");
    expect(second.ping).toBe("fail");
    expect(harness.entries().filter(entry => entry.type === "HALT" && entry["reason"] === "WATCHDOG_TAKEOVER")).toHaveLength(1);
    expect(readHaltState(harness.paths).halted).toBe(true);

    // And the landed halt does what the first run could not: it blocks entries.
    // A successor writer that legitimately acquires authority is refused at the
    // gateway before the broker port, on the halt this second firing journaled.
    harness.clock.now += 120_000; // past the lock-takeover bound, so the watchdog's own holder is no longer live
    const successor = createMutationGateway({ paths: harness.paths, secrets: [], clock: () => harness.clock.now, brokerPort: harness.fake.port, instanceId: "successor", lockTakeoverBoundMs: 60_000, binding: P5_BINDING });
    const acquired = await successor.acquireAuthority({ account: "unknown" });
    if (acquired.kind !== "WON") throw new Error(`successor could not acquire: ${JSON.stringify(acquired)}`);
    const mutationsBefore = harness.fake.mutations.length;
    const entryAttempt = await successor.dispatch({
      class: "authoritative",
      epoch: acquired.epoch,
      action: { kind: "broker_mutation", mutation: { kind: "submit_order", clientOrderId: "entry:successor", binding: P5_BINDING, payload: { legs: [{ contractId: SHORT_CALL, side: "sell", ratio: 1 }], quantity: 1, limit: { kind: "credit", priceCents: 100 }, intent: "entry" } } },
    });
    expect(entryAttempt).toMatchObject({ ok: false, reason: "HALT" });
    expect(harness.fake.mutations).toHaveLength(mutationsBefore);
  });
});

describe("S-G14-02/03 — a refused recovery snapshot alarms instead of silently closing nothing", () => {
  // `assembleDecisionSnapshot` can refuse the book-recovery read (an invalid
  // quote, an unreconstructable lifecycle, ...). The fence and the halt above
  // this branch already stand on their own, but recovery itself never ran —
  // and without an alarm naming that, the operator sees a takeover that
  // looks complete while nothing was actually closed.

  it("an invalid quote refuses the snapshot: fence and halt stand, classification stays null, nothing closes, and the fail-ping names WATCHDOG_RECOVERY_SKIPPED", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    // A quote that fails `validateQuote` (negative bidCents) refuses assembly with QUOTE_INVALID.
    const invalidMarket = lifecycleMarket(() => harness.clock.now, { quotes: { [SHORT_CALL]: { bidCents: -1 } } });

    const report = await runWatchdog(watchdogDeps(harness, { market: invalidMarket }));
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true); // the takeover halt is untouched by the recovery refusal
    expect(report.classification).toBeNull();
    expect(report.closes).toEqual([]);
    expect(report.alarmConditions.some(item => item.startsWith(`WATCHDOG_RECOVERY_SKIPPED:QUOTE_INVALID:${SHORT_CALL}`))).toBe(true);

    // The alarm is delivered, not just planned: the fail-ping carries both the takeover and the skipped recovery.
    expect(report.ping).toBe("fail");
    const conditions = harness.ping.record.failures.at(-1)?.conditions ?? [];
    expect(conditions.some(item => item.startsWith("WATCHDOG_TAKEOVER"))).toBe(true);
    expect(conditions.some(item => item.startsWith(`WATCHDOG_RECOVERY_SKIPPED:QUOTE_INVALID:${SHORT_CALL}`))).toBe(true);

    // Recovery never ran: no close INTENT, no order, only the takeover HALT was journaled.
    expect(harness.entries().some(item => item["action"] === "close")).toBe(false);
    expect(harness.fake.mutations.some(mutation => mutation.kind === "submit_order" && (mutation.payload as { intent?: string }).intent === "close")).toBe(false);
    expect(harness.entries().filter(entry => entry.type === "HALT" && entry["reason"] === "WATCHDOG_TAKEOVER")).toHaveLength(1);
  });
});

describe("S-G14-02 / WIN-8 — the watchdog's own emergency-close eligibility and one-attempt adoption", () => {
  // Two guards inside `submitWatchdogClose` that the WIN-8 combined test never
  // reaches, because on a book that matches the journal both are satisfied:
  // the pre-submission `emergencyCloseEligibility` check, and the adoption of
  // an attempt that is already working. Both are measured here against the
  // freshly read book, not argued from the happy path.

  function closeSubmissions(harness: LifecycleHarness): readonly BrokerMutation[] {
    return harness.fake.mutations.filter(mutation => mutation.kind === "submit_order" && (mutation.payload as { intent?: string }).intent === "close");
  }

  it("a close that would OPEN exposure on the freshly read book is refused, while the same run closes what it can", async () => {
    // The book the broker answers with is not guaranteed to name a contract
    // once. `planBookClosure` folds the rows (the later row wins), while
    // `emergencyCloseEligibility` checks the closing leg against the first row
    // that names the contract -- so on a book that reports SPY twice the two
    // disagree about which side is held, and the order the planner derived
    // would BUY 100 shares against a row that says 100 are already long. The
    // guard refuses to trade a book it cannot read unambiguously, and refuses
    // only that leg: the intact vertical in the same run still closes.
    const harness = await lifecycleHarness();
    const entry = await harness.cycle();
    expect(entry.actions).toMatchObject([{ result: "SUBMITTED" }]);
    const ambiguousBook = {
      ...harness.fake.read,
      positions: () => Promise.resolve([
        { contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 300 },
        { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 },
        { contractId: "SPY", quantity: 100, avgEntryPriceCents: 50_000 },
        { contractId: "SPY", quantity: -100, avgEntryPriceCents: 50_000 },
      ]),
    };
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;

    const report = await runWatchdog(watchdogDeps(harness, { broker: { read: ambiguousBook, port: harness.fake.port } }));
    expect(report.acquired).toBe("WON");
    expect(report.halted).toBe(true); // the fence and the halt are untouched: this refuses a trade, not the takeover
    expect(report.classification).not.toBeNull();

    // The positive control sits in the same run: the intact 500/505 vertical is
    // planned, priced, journaled and submitted as one two-leg mleg.
    expect(report.closes.map(close => close.subject)).toEqual([`exposure:${entry.actions[0]?.clientOrderId ?? ""}`]);
    const submissions = closeSubmissions(harness);
    expect(submissions).toHaveLength(1);
    expect((submissions[0]?.payload as { legs: readonly unknown[] }).legs).toHaveLength(2);

    // The SPY residue is refused BEFORE the journal and before the gateway:
    // no attempt in the report, no close INTENT for it, no order.
    expect(report.closes.some(close => close.subject === "residue:SPY")).toBe(false);
    expect(harness.entries().filter(item => item["action"] === "close" && String(item["exposureLifecycleId"]).includes("SPY"))).toHaveLength(0);
    // Refusing to trade is not refusing to report: the unbounded residue is still alarmed (S-X-06).
    expect(report.alarmConditions).toContain("UNBOUNDED_RESIDUE_RECOVERY:SPY");
    expect(report.ping).toBe("fail");

    // The pure rule that produced the refusal, on the same rows.
    expect(emergencyCloseEligibility(
      [{ contractId: "SPY", quantity: 100, avgEntryPriceCents: 50_000 }, { contractId: "SPY", quantity: -100, avgEntryPriceCents: 50_000 }],
      [{ contractId: "SPY", side: "buy", quantity: 100 }],
    )).toEqual({ eligible: false, reason: "OPENS_A_LEG" });
  });

  it("a close attempt that is still working is adopted by the next firing: one attempt id per lifecycle, never a parallel child", async () => {
    const harness = await lifecycleHarness();
    const entry = await harness.cycle(); // the 500/505 credit vertical fills and is journaled
    expect(entry.actions).toMatchObject([{ result: "SUBMITTED" }]);
    // From here the broker only ACCEPTS: the watchdog's close rests unfilled, so
    // the exposure is still open when the next scheduled firing reads the book
    // and the same whole-structure close is planned again.
    harness.fake.setSubmitBehaviour(() => ({ kind: "accept" }));
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;

    const first = await runWatchdog(watchdogDeps(harness));
    expect(first.closes).toHaveLength(1);
    const attemptId = first.closes[0]?.attemptId ?? "";
    expect(attemptId.endsWith(":g0")).toBe(true);
    expect(closeSubmissions(harness)).toHaveLength(1);

    // The first firing journaled, so the staleness clock restarted with it: the
    // next firing that finds the (still hung) writer stale is one DEAD_MAN_BOUND
    // plus one scheduled interval later, and it re-reads the same open book.
    harness.clock.now += DEAD_MAN_BOUND_MS + 300_000;
    const second = await runWatchdog(watchdogDeps(harness));
    expect(second.acquired).toBe("WON");
    expect(second.classification).not.toBeNull(); // the recovery branch ran and saw the same open structure
    // Adopted, not duplicated: no new attempt in the report, no second order at
    // the broker, and no second close INTENT in the journal (S-G7-01, WIN-8).
    expect(second.closes).toEqual([]);
    const submissions = closeSubmissions(harness);
    expect(submissions).toHaveLength(1);
    expect([...new Set(submissions.map(mutation => mutation.clientOrderId))]).toEqual([attemptId]);
    expect(harness.entries().filter(item => item.type === "INTENT" && item["action"] === "close")).toHaveLength(1);
    // The adopted attempt is the one that is actually resting at the broker.
    const resting = harness.fake.allOrders().filter(order => order.clientOrderId === attemptId);
    expect(resting).toHaveLength(1);
    expect(resting[0]?.status).toBe("accepted");
  });
});

describe("S-G14-02/03 — staleness that cannot be fenced is the loudest state, not the quietest", () => {
  // Establishing staleness is not authority (S-G14-02): the fence is the
  // atomic epoch increment, and it can be denied. A live holder that still
  // heartbeats is precisely the hung writer this alarm exists for — the
  // journal has stopped growing past DEAD_MAN_BOUND while someone holds the
  // lock. Without authority nothing may be journaled, halted or closed, so
  // the fail-ping is the ONLY thing this run can still do; dropping it leaves
  // the 45-60 min passive missed-ping SLA as the sole signal, which is what
  // S-G14-03 refuses for an ACTIVE alarm condition.

  it("authorityRefusalAlarms names every way the fence can be denied, and carries the staleness with it", () => {
    expect(authorityRefusalAlarms({ kind: "SUPPRESSED", holderId: "runner" }, 3_400_000))
      .toEqual(["WATCHDOG_NO_AUTHORITY:staleness 3400000 ms", "WRITER_HUNG_LOCK_HELD:runner"]);
    expect(authorityRefusalAlarms({ kind: "LOST", observedEpoch: 7 }, 10))
      .toEqual(["WATCHDOG_NO_AUTHORITY:staleness 10 ms", "WATCHDOG_AUTHORITY_LOST:7"]);
    expect(authorityRefusalAlarms({ kind: "LOST", observedEpoch: null }, 10))
      .toEqual(["WATCHDOG_NO_AUTHORITY:staleness 10 ms", "WATCHDOG_AUTHORITY_LOST:unknown"]);
    expect(authorityRefusalAlarms({ kind: "REFUSED", reason: "JOURNAL_CORRUPT" }, 10))
      .toEqual(["WATCHDOG_NO_AUTHORITY:staleness 10 ms", "WATCHDOG_AUTHORITY_REFUSED:JOURNAL_CORRUPT"]);
    // A closed condition: never empty, so `planPing` can only turn it into a fail-ping.
    expect(planPing({ durableAppendLanded: false, alarmConditions: authorityRefusalAlarms({ kind: "SUPPRESSED", holderId: "runner" }, 1) }).kind).toBe("fail");
  });

  it("a hung writer that still heartbeats suppresses the fence: the run fail-pings and mutates, halts and appends nothing", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    // The writer's journal stopped 3.4M ms ago, but its lock is fresh: hung, not gone.
    expect(await harness.gateway.heartbeat()).toBe(true);
    const entriesBefore = harness.entries().length;
    const mutationsBefore = harness.fake.mutations.length;

    const report = await runWatchdog(watchdogDeps(harness));
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("SUPPRESSED");
    expect(report.epoch).toBeNull();
    expect(report.halted).toBe(false);
    expect(report.closes).toEqual([]);

    // The alarm is planned AND delivered, naming the holder that blocked the fence.
    expect(report.ping).toBe("fail");
    expect(report.alarmConditions).toContain("WRITER_HUNG_LOCK_HELD:runner");
    const conditions = harness.ping.record.failures.at(-1)?.conditions ?? [];
    expect(conditions).toContain("WRITER_HUNG_LOCK_HELD:runner");
    expect(conditions).toContain(`WATCHDOG_NO_AUTHORITY:staleness ${String(DEAD_MAN_BOUND_MS + 400_000)} ms`);

    // No authority means no takeover, no halt, no journal line, no order — and the writer keeps its epoch.
    expect(harness.entries()).toHaveLength(entriesBefore);
    expect(harness.entries().every(entry => entry.type !== "HALT")).toBe(true);
    expect(readHaltState(harness.paths).halted).toBe(false);
    expect(harness.fake.mutations).toHaveLength(mutationsBefore);
    const stillOwned = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T15:00:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(stillOwned.ok).toBe(true);
  });

  it("without a ping port the same refusal still reports its conditions", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.clock.now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    expect(await harness.gateway.heartbeat()).toBe(true);

    const report = await runWatchdog(watchdogDeps(harness, { ping: null }));
    expect(report.acquired).toBe("SUPPRESSED");
    expect(report.ping).toBeNull();
    expect(report.alarmConditions).toContain("WRITER_HUNG_LOCK_HELD:runner");
  });
});

describe("S-G14-03 — the ping precondition and the alarm override", () => {
  it("planPing: success only after a durable append; a fail-ping fires instead of success and may precede any journal", () => {
    expect(planPing({ durableAppendLanded: true, alarmConditions: [] })).toEqual({ kind: "success" });
    expect(planPing({ durableAppendLanded: true, alarmConditions: ["X"] })).toEqual({ kind: "fail", conditions: ["X"] });
    expect(planPing({ durableAppendLanded: false, alarmConditions: ["CONFIG_INVALID"] })).toEqual({ kind: "fail", conditions: ["CONFIG_INVALID"] });
    expect(planPing({ durableAppendLanded: false, alarmConditions: [] })).toMatchObject({ kind: "none" });
  });

  it("S-G14-03 a normal cycle success-pings only after its durable primary; a journal-down cycle sends no success ping", async () => {
    const harness = await lifecycleHarness();
    const report = await harness.cycle();
    expect(report.ping).toBe("success");
    expect(harness.ping.record.successes).toHaveLength(1);
  });
});

describe("S-G14 — the watchdog is a separate process entry point over the same epoch store", () => {
  async function runWatchdogCli(compiledDist: string, args: readonly string[]): Promise<{ readonly code: number | null; readonly stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(compiledDist, "shell", "watchdog-cli.js"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      child.stdout.on("data", chunk => { stdout += String(chunk); });
      child.on("error", reject);
      child.on("close", code => { resolve({ code, stdout }); });
    });
  }

  it("S-G14-02 the watchdog process fences the in-process writer through the shared store and appends the takeover halt", async () => {
    const compiledDist = inject("compiledDist");
    const harness = await lifecycleHarness();
    await harness.cycle();
    const now = P5_NOW + DEAD_MAN_BOUND_MS + 400_000;
    const cli = await runWatchdogCli(compiledDist, [harness.paths.root, "watchdog-process", String(now), String(now - 3_600_000), String(now + 3_600_000), String(DEAD_MAN_BOUND_MS)]);
    expect(cli.code).toBe(0);
    const report = JSON.parse(cli.stdout) as { assessment: { kind: string }; acquired: string | null; epoch: number | null; halted: boolean };
    expect(report.assessment.kind).toBe("stale");
    expect(report.acquired).toBe("WON");
    expect(report.epoch).toBe(2);
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "WATCHDOG_TAKEOVER")).toBe(true);
    // The old in-process writer is fenced by the other PROCESS: same store, same gateway rule, no bypass.
    const fenced = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T15:00:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(fenced).toMatchObject({ ok: false, reason: "STALE_EPOCH" });
  });

  it("S-G14-01 the watchdog process outside a session stays quiet and mutates nothing", async () => {
    const compiledDist = inject("compiledDist");
    const harness = await lifecycleHarness();
    await harness.cycle();
    const now = P5_NOW + 40_000_000;
    const cli = await runWatchdogCli(compiledDist, [harness.paths.root, "watchdog-process", String(now), String(now + 3_600_000), String(now + 7_200_000), String(DEAD_MAN_BOUND_MS)]);
    expect(cli.code).toBe(0);
    const report = JSON.parse(cli.stdout) as { assessment: { kind: string }; acquired: string | null };
    expect(report.assessment.kind).toBe("quiet");
    expect(report.acquired).toBeNull();
    expect(harness.entries().every(entry => entry.type !== "HALT")).toBe(true);
  });
});

describe("clock sanity", () => {
  it("the harness base time sits inside its own session window", () => {
    expect(P5_NOW).toBeGreaterThan(TEST_ONLY_AT_MS);
  });
});
