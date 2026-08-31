// G10 — reconciliation of unexplained state (S-G10-01..05): the closed
// classification set, the non-MATCHED halt with driven risk-reducing
// resolution, the RESIDUE_MAX_SESSIONS fail-signal (BEQ-9), the assignment
// residue dispatch (S-G10-03), intent-without-outcome (S-G10-04), and the
// HUMAN_ACTION visibility with the competition provenance latch (S-G10-05).
import { afterEach, describe, expect, it } from "vitest";
import { classifyBook } from "../src/core/lifecycle.js";
import { book, creditVertical, position } from "./execution-fixtures.js";
import { LONG_CALL, SHORT_CALL } from "./execution-fixtures.js";
import { cleanupLifecycleDirs, lifecycleHarness } from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

describe("S-G10-01 — all MATCHED proceeds normally", () => {
  it("S-G10-01 a book fully explained by journaled structures produces no reconciliation, no halt, and normal entries", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills: positions are journaled
    const report = await harness.cycle();
    expect(report.classification?.nonMatched).toEqual([]);
    expect(report.classification?.positions.every(item => item.class === "MATCHED")).toBe(true);
    expect(harness.entries().every(entry => entry.type !== "HALT")).toBe(true);
    expect(report.ping).toBe("success");
  });
});

describe("S-G10-02 / BEQ-9 — any non-MATCHED item halts entries and drives resolution", () => {
  it("S-G10-02 a residue produces a RECONCILIATION entry, a durable halt, a ladder close every cycle, and the fail-signal beyond RESIDUE_MAX_SESSIONS", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills
    // The long leg disappears: the short piece is an unexplained residue outside any intact structure.
    harness.fake.setPositions([{ contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 300 }]);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const first = await harness.cycle();
    expect(first.classification?.nonMatched).toMatchObject([{ class: "RESIDUE", residueKind: "unbounded_short" }]);
    expect(first.entriesBlocked).toContain("RECONCILIATION");
    expect(first.managementCloses).toMatchObject([{ route: "residue", generation: 0 }]);
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "RESIDUE_UNRESOLVED")).toBe(true);
    // Same trading day: within RESIDUE_MAX_SESSIONS = 1 the unbounded policy already alarms, but not the session clock.
    expect(first.alarmConditions.some(item => item.startsWith("RESIDUE_UNRESOLVED_BEYOND"))).toBe(false);
    // The next SESSION with the residue still unresolved raises the session fail-signal while attempts continue.
    const nextDay = await harness.cycle({ tradingDay: "2026-09-01" });
    expect(nextDay.alarmConditions.some(item => item.startsWith("RESIDUE_UNRESOLVED_BEYOND_MAX_SESSIONS"))).toBe(true);
    expect(nextDay.managementCloses).toMatchObject([{ route: "residue" }]);
    expect(nextDay.ping).toBe("fail");
  });

  it("S-G10-02 'no opportunity yet' is non-conforming: resolution is driven every cycle, not hoped for", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setPositions([{ contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 300 }]);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    await harness.cycle();
    await harness.cycle();
    const generations = harness.entries().filter(entry => entry.type === "INTENT" && entry["action"] === "close").map(entry => entry["generation"]);
    expect(generations).toEqual([0, 1]);
  });
});

describe("S-G10-03 — assignment residue dispatches through the discrimination", () => {
  it("S-G10-03 morning-after assignment: shares and orphan long leg are RESIDUE; the leg-wise closes use the right policy per piece", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills the credit vertical
    // Overnight assignment of the short call: short stock appears, the long leg stays as an orphan.
    harness.fake.setPositions([
      { contractId: "SPY", quantity: -100, avgEntryPriceCents: 50_000 },
      { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 },
    ]);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const report = await harness.cycle();
    const classes = Object.fromEntries((report.classification?.positions ?? []).map(item => [item.contractId, `${item.class}:${String(item.residueKind)}`]));
    expect(classes).toEqual({ SPY: "RESIDUE:unbounded_short", [LONG_CALL]: "RESIDUE:bounded_long" });
    // The short stock closes as an uncapped marketable limit (S-X-06) with the alarm; the long leg zero-floor.
    expect(report.alarmConditions).toContain("UNBOUNDED_RESIDUE_RECOVERY:SPY");
    const byId = Object.fromEntries(report.managementCloses.map(item => [item.attemptId, item]));
    expect(Object.keys(byId).some(id => id.includes("residue:SPY:"))).toBe(true);
    expect(Object.keys(byId).some(id => id.includes(`residue:${LONG_CALL}`))).toBe(true);
    // The stock buy-back is marketable: at or past the 50_010 ask.
    const stockClose = report.managementCloses.find(item => item.attemptId.includes("residue:SPY:"));
    expect(stockClose?.limitPriceCents).toBeGreaterThanOrEqual(50_010);
    expect(report.ping).toBe("fail");
  });
});

describe("S-G10-04 — intent without outcome resolves against the broker by client order ID", () => {
  it("S-G10-04 not found at the broker → NOT_SUBMITTED journaled and the reservation released", async () => {
    const harness = await lifecycleHarness();
    // The submit throws before anything reaches the broker: a durable INTENT with no outcome.
    harness.fake.setSubmitBehaviour(() => ({ kind: "lose_ack_never_sent" }));
    const first = await harness.cycle();
    expect(first.actions).toMatchObject([{ result: "SUBMITTED", status: "confirmation_unclear" }]);
    harness.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    const second = await harness.cycle();
    expect(second.resolved).toMatchObject([{ result: "NOT_AT_BROKER" }]);
    const reconciliation = harness.entries().find(entry => entry.type === "RECONCILIATION" && Array.isArray(entry["reasonCodes"]) && (entry["reasonCodes"] as unknown[]).includes("NOT_SUBMITTED"));
    expect(reconciliation).toBeDefined();
  });
});

describe("S-G10-05 — a manual human trade is HUMAN_ACTION, never absorbed", () => {
  it("S-G10-05 dev account: the foreign position is journaled HUMAN_ACTION, halts entries, and follows ordinary reconciliation", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    // A contract the journal never traded appears: only a manual intervention explains it.
    harness.fake.setPositions([
      position(), { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 },
      { contractId: "TSLA270115C00300000", quantity: 2, avgEntryPriceCents: 500 },
    ]);
    const report = await harness.cycle();
    const human = report.classification?.positions.find(item => item.contractId === "TSLA270115C00300000");
    expect(human).toMatchObject({ class: "HUMAN_ACTION" });
    expect(harness.entries().some(entry => entry.type === "HUMAN_ACTION")).toBe(true);
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "RESIDUE_UNRESOLVED")).toBe(true);
    // No metadata exists for the foreign contract: no close is fabricated; the halt stands for the human.
    expect(report.managementCloses.every(item => !item.attemptId.includes("TSLA"))).toBe(true);
    // Dev: the provenance latch does NOT fire.
    expect(harness.entries().every(entry => !(entry.type === "HALT" && entry["reason"] === "PROVENANCE_BROKEN"))).toBe(true);
  });

  it("S-G10-05 competition account: the manual trade sets the irreversible PROVENANCE_BROKEN latch; un-halt cannot clear it", async () => {
    const harness = await lifecycleHarness({ profile: "competition" });
    await harness.cycle();
    harness.fake.setPositions([
      position(), { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 },
      { contractId: "TSLA270115C00300000", quantity: 2, avgEntryPriceCents: 500 },
    ]);
    const report = await harness.cycle();
    expect(report.alarmConditions).toContain("PROVENANCE_BROKEN");
    const halt = harness.entries().find(entry => entry.type === "HALT" && entry["reason"] === "PROVENANCE_BROKEN");
    expect(halt).toMatchObject({ sticky: true });
    const unhalt = await harness.gateway.dispatchManualUnhalt({ operator: "felix", reason: "attempt to clear the latch" });
    expect(unhalt).toMatchObject({ ok: false, reason: "HALT_IS_STICKY" });
    // Entries stay blocked; risk-reducing cleanup would still be permitted (management actions run under halt).
    const after = await harness.cycle();
    expect(after.actions.every(action => action.result !== "SUBMITTED")).toBe(true);
  });
});

describe("classifyBook — the pure discrimination", () => {
  it("distinguishes MATCHED, RESIDUE (bounded/unbounded), HUMAN_ACTION, UNKNOWN_ORDER, and CONFIRMATION_UNCLEAR", () => {
    const candidate = creditVertical();
    const lifecycles = [{
      clientOrderId: "entry-1", exposureLifecycleId: "exposure:entry-1", sleeve: "income" as const, underlying: "SPY",
      candidate, reservedMaxLossCents: 30_000 as never, state: "filled" as const, filledQuantity: 1 as never,
      avgFillPriceCents: 200 as never, brokerOrderId: "b1", priceBreach: false,
    }];
    const testBook = book({
      positions: [
        { contractId: SHORT_CALL, quantity: -1, avgEntryPriceCents: 300 },
        { contractId: LONG_CALL, quantity: 1, avgEntryPriceCents: 100 },
        { contractId: "SPY", quantity: -100, avgEntryPriceCents: 50_000 },
        { contractId: "TSLA", quantity: 5, avgEntryPriceCents: 100 },
      ],
      openOrders: [
        { brokerOrderId: "b2", clientOrderId: "mystery-order", status: "accepted", filledQuantity: 0, avgFillPriceCents: null, brokerTimestamps: {}, brokerReason: null, legs: [], quantity: 1, limit: null },
      ],
    });
    const classification = classifyBook(testBook, lifecycles, [], ["entry-unclear"]);
    const positionClasses = Object.fromEntries(classification.positions.map(item => [item.contractId, item.class]));
    expect(positionClasses).toEqual({ [SHORT_CALL]: "MATCHED", [LONG_CALL]: "MATCHED", SPY: "RESIDUE", TSLA: "HUMAN_ACTION" });
    expect(classification.positions.find(item => item.contractId === "SPY")).toMatchObject({ residueKind: "unbounded_short" });
    const orderClasses = Object.fromEntries(classification.orders.map(item => [item.clientOrderId, item.class]));
    expect(orderClasses).toEqual({ "mystery-order": "UNKNOWN_ORDER", "entry-unclear": "CONFIRMATION_UNCLEAR" });
    expect(classification.nonMatched.length).toBe(4);
  });
});
