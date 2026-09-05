// G11 — deadline flatten and the Friday regime (S-G11-01..04, DOM-3): the
// DEADLINE entry veto, whole-structure ladder closes from the first
// FLATTEN_DATE cycle, the Thursday-close assertion, the Friday
// journaling-only regime with its journaled failure path, and the dedicated
// DEADLINE_RECONCILIATION and TERMINAL entries.
import { afterEach, describe, expect, it } from "vitest";
import { deadlineRegime, lifecycleEntryVeto } from "../src/core/lifecycle.js";
import { runDeadlineReconciliation, runTerminal } from "../src/shell/deadline.js";
import { SHORT_CALL, creditVertical } from "./execution-fixtures.js";
import { cleanupLifecycleDirs, defaultLifecycleDeps, lifecycleCalendar, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

describe("the deadline regime is a pure calendar decision", () => {
  it("normal before FLATTEN_DATE, flatten on it, post_flatten after it", () => {
    expect(deadlineRegime("2026-09-02", "2026-09-03")).toBe("normal");
    expect(deadlineRegime("2026-09-03", "2026-09-03")).toBe("flatten");
    expect(deadlineRegime("2026-09-04", "2026-09-03")).toBe("post_flatten");
  });

  it("S-G11-01/02 every entry action vetoes DEADLINE on and after FLATTEN_DATE", () => {
    expect(lifecycleEntryVeto(creditVertical(), { regime: "flatten", nextTradingDay: "2026-09-04" })).toMatchObject({ code: "DEADLINE" });
    expect(lifecycleEntryVeto(creditVertical(), { regime: "post_flatten", nextTradingDay: "2026-09-07" })).toMatchObject({ code: "DEADLINE" });
  });
});

describe("S-G11-01 / DOM-3 — FLATTEN_DATE closes everything through the ladder and asserts at the close", () => {
  it("S-G11-01 entries veto DEADLINE, every open structure gets a whole-structure deadline close, and an illiquid leg is walked across the spread", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills under the normal calendar (2026-08-31)
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const flattenDay = { tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) };
    const first = await harness.cycle(flattenDay);
    expect(first.lifecycleVetoes).toMatchObject([{ code: "DEADLINE" }]);
    expect(first.managementCloses).toMatchObject([{ route: "deadline", generation: 0, limitPriceCents: 200 }]);
    // DOM-3: the unfilled close is walked across the spread — one step further every cycle, not hoped into a fill.
    const second = await harness.cycle(flattenDay);
    expect(second.managementCloses).toMatchObject([{ route: "deadline", generation: 1, limitPriceCents: 202 }]);
    const intents = harness.entries().filter(entry => entry.type === "INTENT" && entry["action"] === "close");
    expect(intents.map(entry => entry["route"])).toEqual(["deadline", "deadline"]);
  });

  it("S-G11-01 a risk-increasing working order is canceled on FLATTEN_DATE", async () => {
    const harness = await lifecycleHarness();
    // The entry rests (accepted, unfilled): a working risk-increasing order into Thursday.
    harness.fake.setSubmitBehaviour(() => ({ kind: "accept" }));
    await harness.cycle();
    const flattenDay = { tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) };
    await harness.cycle(flattenDay);
    const cancels = harness.fake.mutations.filter(mutation => mutation.kind === "cancel_order");
    expect(cancels.length).toBeGreaterThanOrEqual(1);
    const orders = harness.fake.allOrders();
    expect(orders.every(order => order.status === "canceled" || order.status === "filled" || order.clientOrderId.startsWith("close:"))).toBe(true);
  });

  it("S-G11-01 the Thursday-close assertion halts and alarms when the account is not flat at the final cycle", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const final = await harness.cycle({ tradingDay: "2026-09-03", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04", finalCycleOfSession: true }) });
    expect(final.alarmConditions).toContain("DEADLINE_FLATTEN_FAILED");
    expect(final.ping).toBe("fail");
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "DEADLINE_FLATTEN_FAILED")).toBe(true);
    // Attempts continue: the deadline close is resting at the broker even as the assertion fails.
    expect(final.managementCloses).toMatchObject([{ route: "deadline" }]);
  });
});

describe("S-G11-02 — Friday is journaling-only, except the journaled failure path", () => {
  it("S-G11-02 with a flat book, Friday performs zero broker mutations and vetoes entries", async () => {
    const harness = await lifecycleHarness();
    const friday = { tradingDay: "2026-09-04", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-07" }) };
    const report = await harness.cycle(friday);
    expect(report.lifecycleVetoes).toMatchObject([{ code: "DEADLINE" }]);
    expect(report.managementCloses).toEqual([]);
    expect(harness.fake.mutations).toHaveLength(0);
    expect(report.ping).toBe("success");
  });

  it("S-G11-02 Thursday failed: Friday cycles still execute risk-reducing closes via the ladder until flat", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // the position exists (Thursday's flatten failed by construction)
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const friday = { tradingDay: "2026-09-04", lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-07" }) };
    const first = await harness.cycle(friday);
    expect(first.managementCloses).toMatchObject([{ route: "deadline", generation: 0 }]);
    harness.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    const second = await harness.cycle(friday);
    expect(second.managementCloses).toMatchObject([{ route: "deadline", generation: 1 }]);
    expect(await harness.fake.read.positions()).toHaveLength(0);
  });
});

describe("S-G11-03/04 — the dedicated Friday entries", () => {
  it("S-G11-03 the DEADLINE_RECONCILIATION entry carries the full broker snapshot and the submitted-revision reference", async () => {
    const harness = await lifecycleHarness();
    const report = await runDeadlineReconciliation({
      gateway: harness.gateway, epoch: 1, broker: harness.fake.read, market: lifecycleMarket(() => harness.clock.now),
      clock: () => harness.clock.now, profile: "dev", calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 40, ping: harness.ping, underlyingUniverse: ["SPY"],
    }, "journal-rev-abc123");
    expect(report).toMatchObject({ appended: true, holdVisible: false, ping: "success" });
    const entry = harness.entries().find(item => item.type === "DEADLINE_RECONCILIATION");
    expect(entry).toMatchObject({ reference: "journal-rev-abc123" });
    expect(entry?.["snapshot"]).toMatchObject({ accountId: "TEST_ONLY_PA000000000" });
  });

  it("S-G11-04 a flat account ends in a clean TERMINAL entry; a risk-bearing remainder is recorded explicitly and fail-signalled", async () => {
    const flat = await lifecycleHarness();
    const clean = await runTerminal({
      gateway: flat.gateway, epoch: 1, broker: flat.fake.read, market: lifecycleMarket(() => flat.clock.now),
      clock: () => flat.clock.now, profile: "dev", calendar: lifecycleCalendar(flat.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 41, ping: flat.ping, underlyingUniverse: ["SPY"],
    });
    expect(clean).toMatchObject({ appended: true, remainder: null, ping: "success" });
    expect(flat.entries().some(entry => entry.type === "TERMINAL")).toBe(true);

    const stuck = await lifecycleHarness();
    await stuck.cycle(); // an open position survives to Friday close
    const failed = await runTerminal({
      gateway: stuck.gateway, epoch: 1, broker: stuck.fake.read, market: lifecycleMarket(() => stuck.clock.now),
      clock: () => stuck.clock.now, profile: "dev", calendar: lifecycleCalendar(stuck.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 42, ping: stuck.ping, underlyingUniverse: ["SPY"],
    });
    expect(failed.remainder).not.toBeNull();
    expect(failed.ping).toBe("fail");
    expect(stuck.ping.record.failures.at(-1)?.conditions).toContain("TERMINAL_REMAINDER_RISK_BEARING");
    const terminal = stuck.entries().find(entry => entry.type === "TERMINAL");
    const remainder = terminal?.["remainder"] as { positions: readonly { contractId: string }[]; maxLossStatement: string; expiryConsequence: string };
    expect(remainder.positions.length).toBeGreaterThan(0);
    expect(remainder.maxLossStatement.length).toBeGreaterThan(0);
    expect(remainder.expiryConsequence.length).toBeGreaterThan(0);
  });
});

describe("S-G11-03/04 — a Friday entry that cannot be written hands over in writing, never in silence", () => {
  it("S-G11-04 an unassemblable snapshot appends nothing, raises the active fail-signal and names the failure class in the report", async () => {
    const harness = await lifecycleHarness();
    const before = harness.entries();
    // One malformed quote in the market observation is enough: the pure assembly refuses the whole snapshot.
    const brokenMarket = lifecycleMarket(() => harness.clock.now, {
      quotes: { [SHORT_CALL]: { bidCents: -1, askCents: 302, bidSize: 20, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" } },
    });
    const report = await runTerminal({
      gateway: harness.gateway, epoch: 1, broker: harness.fake.read, market: brokenMarket,
      clock: () => harness.clock.now, profile: "dev", calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 43, ping: harness.ping, underlyingUniverse: ["SPY"],
    });
    expect(report.appended).toBe(false);
    expect(report.failure).toMatchObject({ kind: "SNAPSHOT_NOT_ASSEMBLED" });
    expect(report.failure?.detail).toContain("QUOTE_INVALID");
    // No entry could land in that state, so the ping is the only channel left — and it is used.
    expect(report.ping).toBe("fail");
    expect(harness.ping.record.failures.at(-1)?.conditions.join(" ")).toContain("DEADLINE_ENTRY_NOT_JOURNALED");
    expect(harness.entries()).toEqual(before);
  });

  it("S-G11-03 an append the gateway refuses is fail-signalled with the refusal reason, not swallowed", async () => {
    const harness = await lifecycleHarness();
    const before = harness.entries();
    const report = await runDeadlineReconciliation({
      // A stale epoch: the snapshot assembles, the gateway refuses the append. Nothing about that may be quiet.
      gateway: harness.gateway, epoch: 99, broker: harness.fake.read, market: lifecycleMarket(() => harness.clock.now),
      clock: () => harness.clock.now, profile: "dev", calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 44, ping: harness.ping, underlyingUniverse: ["SPY"],
    }, "journal-rev-unwritable");
    expect(report.appended).toBe(false);
    expect(report.failure).toMatchObject({ kind: "ENTRY_NOT_JOURNALED" });
    expect(report.failure?.detail).toContain("STALE_EPOCH");
    expect(report.ping).toBe("fail");
    expect(harness.ping.record.failures.at(-1)?.conditions.join(" ")).toContain("DEADLINE_ENTRY_NOT_JOURNALED");
    expect(harness.entries()).toEqual(before);
  });

  it("a written entry reports no failure at all: the field distinguishes silence from success", async () => {
    const harness = await lifecycleHarness();
    const report = await runTerminal({
      gateway: harness.gateway, epoch: 1, broker: harness.fake.read, market: lifecycleMarket(() => harness.clock.now),
      clock: () => harness.clock.now, profile: "dev", calendar: lifecycleCalendar(harness.clock.now), tradingDay: "2026-09-04",
      cycleIndex: 45, ping: harness.ping, underlyingUniverse: ["SPY"],
    });
    expect(report).toMatchObject({ appended: true, ping: "success", failure: null });
    expect(harness.ping.record.failures).toEqual([]);
  });
});
