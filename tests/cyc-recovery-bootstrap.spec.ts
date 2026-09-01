// S-CYC-03 (total connectivity loss), S-CYC-08 (first cycle after a gap),
// S-CYC-09 (bootstrap versus foreign book, competition provenance, the
// provenance latch; AUS-1, GV-1, WIN-2), and S-CYC-10 (failed resolution
// stays blocking) as executed runner behaviour over the real gateway.
import { describe, afterEach, expect, it } from "vitest";
import { utcIsoToEpochMs } from "../src/core/execution.js";
import { planPrimaryEntry, validateCompetitionProvenance } from "../src/core/lifecycle.js";
import { runCycle } from "../src/shell/cycle-runner.js";
import { createFakeBroker } from "../src/shell/fake-broker.js";
import { createMutationGateway } from "../src/shell/mutation-gateway.js";
import { writeEpochStore } from "../src/shell/epoch-store.js";
import { TEST_ONLY_EXECUTION_CONFIG } from "./execution-fixtures.js";
import { TEST_ONLY_O5_CONFIG } from "./fixtures.js";
import { TEST_ONLY_ACCOUNT_ID, TEST_ONLY_AT_MS, TEST_ONLY_ORIGIN } from "./journal-fixtures.js";
import {
  P5_NOW,
  cleanupLifecycleDirs,
  defaultLifecycleDeps,
  entriesOf,
  freshLifecyclePaths,
  lifecycleCalendar,
  lifecycleHarness,
  lifecycleMarket,
  recordingPing,
} from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

const COMPETITION_START_MS = utcIsoToEpochMs("2026-08-28T15:00:00Z") as number;

function validBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountRole: "paper",
    accountId: TEST_ONLY_ACCOUNT_ID,
    createdAt: "2026-08-28T16:00:00.000Z",
    openingCashCents: 10_000_000,
    openingEquityCents: 10_000_000,
    positionCount: 0,
    nonTerminalOrderCount: 0,
    orderHistory: { complete: true, items: 0 },
    fillHistory: { complete: true, items: 0 },
    activityHistory: { complete: true, items: 0 },
    ...overrides,
  };
}

describe("S-CYC-03 — total connectivity loss still journals locally", () => {
  it("S-CYC-03 every broker and market read fails → the SKIP with WORLD_UNREACHABLE is written even though no broker data exists", async () => {
    const harness = await lifecycleHarness();
    harness.fake.failNextReads(["account", "positions", "orders"]);
    const report = await harness.cycle({ market: () => Promise.reject(new Error("network is down")) });
    expect(report).toMatchObject({ primary: "SKIP", reasonCodes: ["WORLD_UNREACHABLE"] });
    const skip = harness.entries().find(entry => entry.type === "SKIP");
    expect(skip).toMatchObject({ reasonCodes: ["WORLD_UNREACHABLE"], snapshot: null });
    // The append landed: liveness is real (S-G14-03), abstention is not an alarm.
    expect(report.ping).toBe("success");
    expect(harness.fake.mutations).toHaveLength(0);
  });
});

describe("S-CYC-08 — the first cycle after any gap", () => {
  it("planPrimaryEntry is the pure gap rule: bootstrap only when both sides are virgin; a stale primary marks a gap", () => {
    expect(planPrimaryEntry({ journalEmpty: true, bookVirgin: true, lastPrimaryAtMs: null, nowMs: 1_000, cycleIntervalMs: 100 })).toEqual({ kind: "BOOTSTRAP" });
    expect(planPrimaryEntry({ journalEmpty: true, bookVirgin: false, lastPrimaryAtMs: null, nowMs: 1_000, cycleIntervalMs: 100 })).toMatchObject({ kind: "FOREIGN_BOOK_GAP" });
    expect(planPrimaryEntry({ journalEmpty: false, bookVirgin: true, lastPrimaryAtMs: 700, nowMs: 1_000, cycleIntervalMs: 100 })).toMatchObject({ kind: "GAP", sinceMs: 700 });
    expect(planPrimaryEntry({ journalEmpty: false, bookVirgin: true, lastPrimaryAtMs: 900, nowMs: 1_000, cycleIntervalMs: 100 })).toEqual({ kind: "CYCLE" });
  });

  it("S-CYC-08 after an overnight-sized silence the cycle journals GAP (from–to), consults no analyst, trades nothing, and behaves as exactly one cycle", async () => {
    const harness = await lifecycleHarness();
    harness.clock.now = TEST_ONLY_AT_MS + 3_600_000; // one silent hour ≫ 2 × CYCLE_INTERVAL
    const gap = await harness.cycle();
    expect(gap.primary).toBe("GAP");
    expect(harness.analystCalls.count).toBe(0);
    expect(harness.fake.mutations).toHaveLength(0);
    const entry = harness.entries().find(item => item.type === "GAP");
    expect(String(entry?.["detail"])).toContain("GAP from 2026-08-31T13:30:00.000Z");
    expect(entry?.["snapshot"]).toMatchObject({ accountId: TEST_ONLY_ACCOUNT_ID });
    // No catch-up trading, no doubled aggression: the NEXT scheduled cycle is a normal one.
    const next = await harness.cycle();
    expect(next.primary).toBe("CYCLE");
    expect(next.actions).toMatchObject([{ result: "SUBMITTED" }]);
  });
});

describe("S-CYC-09 / AUS-1 / GV-1 — bootstrap only over a virgin account; a foreign book is never adopted", () => {
  it("S-CYC-09 virgin account and empty journal → BOOTSTRAP with the broker snapshot as the opening baseline, then a normal cycle", async () => {
    const harness = await lifecycleHarness({ seedEntries: null });
    const report = await harness.cycle();
    expect(report.primary).toBe("BOOTSTRAP");
    const types = harness.entries().map(entry => entry.type);
    expect(types[0]).toBe("BOOTSTRAP");
    expect(harness.entries()[0]).toMatchObject({ epochSeeded: true });
    // "Proceeds as a normal cycle": the analyst ran; the G6 quote-history warm-up simply vetoes the first candidates.
    expect(harness.analystCalls.count).toBe(1);
    const second = await harness.cycle();
    expect(second.primary).toBe("CYCLE");
    expect(second.actions).toMatchObject([{ result: "SUBMITTED" }]);
  });

  it("GV-1 / AUS-1 a lost journal over a non-empty account is a GAP with every item non-MATCHED and a halt — never a silent adoption", async () => {
    const paths = freshLifecyclePaths();
    const clock = { now: P5_NOW };
    // The epoch store survived; the journal did not (lost/corrupted journal, wrong working directory, fresh clone).
    writeEpochStore(paths, { epoch: 5, holderId: "long-gone", acquiredAt: "2026-08-30T13:30:00.000Z", seedPending: false, resetPending: false });
    const fake = createFakeBroker({
      accountId: TEST_ONLY_ACCOUNT_ID, cashCents: 10_000_000, equityCents: 10_000_000, clock: () => clock.now,
      positions: [{ contractId: "SPY260904C00505000", quantity: 1, avgEntryPriceCents: 100 }],
    });
    const binding = { profile: "dev", tradingOrigin: TEST_ONLY_ORIGIN, accountId: TEST_ONLY_ACCOUNT_ID } as const;
    const gateway = createMutationGateway({ paths, secrets: [], clock: () => clock.now, brokerPort: fake.port, instanceId: "recovered", lockTakeoverBoundMs: 60_000, binding });
    const acquired = await gateway.acquireAuthority({ account: "unknown" });
    expect(acquired.kind).toBe("WON");
    if (acquired.kind !== "WON") return;
    const ping = recordingPing(() => clock.now);
    const report = await runCycle({
      gateway, epoch: acquired.epoch, paths, binding, broker: fake.read, market: lifecycleMarket(() => clock.now),
      analyst: () => Promise.resolve("{\"candidates\":[]}"), analystTimeoutMs: 200, clock: () => clock.now,
      calendar: lifecycleCalendar(clock.now), tradingDay: "2026-08-31", cycleIndex: 1, profile: "dev",
      decisionConfig: TEST_ONLY_O5_CONFIG, executionConfig: TEST_ONLY_EXECUTION_CONFIG,
      lifecycle: defaultLifecycleDeps(), ping,
    });
    expect(report.primary).toBe("GAP");
    expect(report.alarmConditions).toContain("FOREIGN_BOOK_GAP");
    expect(ping.record.failures).toHaveLength(1);
    const entries = entriesOf(paths);
    expect(entries.map(entry => entry.type)).toEqual(["GAP", "RECONCILIATION", "HALT"]);
    expect(entries[2]).toMatchObject({ reason: "GAP" });
    expect(entries.every(entry => entry.type !== "BOOTSTRAP")).toBe(true);
    expect(fake.mutations).toHaveLength(0);
  });
});

describe("S-CYC-09 / WIN-2 — the competition provenance proof", () => {
  it("validateCompetitionProvenance passes only the complete virgin bundle and flags reuse evidence", () => {
    const expectations = { expectedAccountId: TEST_ONLY_ACCOUNT_ID, competitionStartMs: COMPETITION_START_MS, initialCapitalCents: 10_000_000 };
    expect(validateCompetitionProvenance(validBundle(), expectations)).toEqual({ ok: true });
    const missingPages = validateCompetitionProvenance(validBundle({ orderHistory: { complete: false, items: 0 } }), expectations);
    expect(missingPages).toMatchObject({ ok: false, reuseEvidence: false });
    const early = validateCompetitionProvenance(validBundle({ createdAt: "2026-08-27T16:00:00.000Z" }), expectations);
    expect(early).toMatchObject({ ok: false, reuseEvidence: true });
    const used = validateCompetitionProvenance(validBundle({ fillHistory: { complete: true, items: 3 } }), expectations);
    expect(used).toMatchObject({ ok: false, reuseEvidence: true });
    const wrongCapital = validateCompetitionProvenance(validBundle({ openingEquityCents: 9_999_900 }), expectations);
    expect(wrongCapital.ok).toBe(false);
    const noProof = validateCompetitionProvenance({}, expectations);
    expect(noProof.ok).toBe(false);
  });

  it("S-CYC-09 a valid bundle lets the competition bootstrap proceed; a failing bundle sends no order and fail-pings", async () => {
    const good = await lifecycleHarness({ seedEntries: null, profile: "competition" });
    const goodLifecycle = defaultLifecycleDeps({ provenance: () => Promise.resolve(validBundle()), competitionStartMs: COMPETITION_START_MS, initialCapitalCents: 10_000_000 });
    const bootstrap = await good.cycle({ lifecycle: goodLifecycle });
    expect(bootstrap.primary).toBe("BOOTSTRAP");
    expect(good.entries()[0]?.type).toBe("BOOTSTRAP");

    const bad = await lifecycleHarness({ seedEntries: null, profile: "competition" });
    const badLifecycle = defaultLifecycleDeps({ provenance: () => Promise.resolve(validBundle({ orderHistory: { complete: false, items: 0 } })), competitionStartMs: COMPETITION_START_MS, initialCapitalCents: 10_000_000 });
    const refused = await bad.cycle({ lifecycle: badLifecycle });
    expect(refused.primary).not.toBe("BOOTSTRAP");
    expect(refused.alarmConditions).toContain("COMPETITION_PROVENANCE_FAILED");
    expect(refused.ping).toBe("fail");
    expect(bad.fake.mutations).toHaveLength(0);
    // The seed is still pending: nothing authoritative can land before a valid bootstrap — no order can ever follow.
    expect(bad.entries()).toHaveLength(0);
    const blockedIntent = await bad.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T13:32:00.000Z", epoch: 1, type: "SKIP", reasonCodes: [], snapshot: null } } });
    expect(blockedIntent).toMatchObject({ ok: false, reason: "SEED_NOT_JOURNALED" });
  });
});

describe("S-CYC-10 / BEQ-2 — failed resolution stays blocking", () => {
  it("S-CYC-10 an unresolvable CONFIRMATION_UNCLEAR blocks entries until broker-terminal truth", async () => {
    const harness = await lifecycleHarness();
    harness.fake.setSubmitBehaviour(() => ({ kind: "lose_ack" }));
    const first = await harness.cycle();
    expect(first.actions).toMatchObject([{ result: "SUBMITTED", status: "confirmation_unclear" }]);

    // BEQ-2: the broker lookup is still down next cycle — the item stays open, entries stay blocked.
    harness.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    harness.fake.failNextReads(["orders"]);
    const second = await harness.cycle();
    expect(second.entriesBlocked.some(item => item.startsWith("UNRESOLVED:"))).toBe(true);
    expect(second.actions.every(action => action.result !== "SUBMITTED")).toBe(true);
    expect(harness.analystCalls.count).toBe(1); // management-only: the analyst was not consulted again
    const reconciliation = harness.entries().filter(entry => entry.type === "RECONCILIATION").at(-1);
    const items = reconciliation?.["items"] as readonly Record<string, unknown>[];
    expect(items.some(item => item["class"] === "CONFIRMATION_UNCLEAR")).toBe(true);

    // A successful identity match is still non-terminal: the broker answers,
    // but a working order remains blocked after the lost acknowledgement.
    const third = await harness.cycle();
    expect(third.resolved).toMatchObject([{ result: "MATCHED_WORKING" }]);
    expect(third.entriesBlocked.some(item => item.startsWith("UNRESOLVED:"))).toBe(true);
    expect(third.actions.every(action => action.result !== "SUBMITTED")).toBe(true);
    expect(harness.analystCalls.count).toBe(1);

    const clientOrderId = first.actions[0]!.clientOrderId;
    harness.fake.transitionOrder(clientOrderId, { status: "canceled", reason: "terminal broker truth" });
    const fourth = await harness.cycle();
    expect(fourth.resolved).toMatchObject([{ result: "OUTCOME:canceled" }]);
    expect(fourth.actions).toMatchObject([{ result: "SUBMITTED" }]);
  });
});
