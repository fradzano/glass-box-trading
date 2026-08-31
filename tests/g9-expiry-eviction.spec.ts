// G9 — expiry eviction (S-G9-01..03): the entry veto for an
// eviction-immediate candidate, the whole-structure eviction close tracked
// to a terminal state through the ladder (BEQ-1), the session-close halt and
// fail-signal while attempts continue, and eviction as a management action
// that runs under halt and never leg-wise on intact structures.
import { afterEach, describe, expect, it } from "vitest";
import { lifecycleEntryVeto } from "../src/core/lifecycle.js";
import { creditVertical } from "./execution-fixtures.js";
import { cleanupLifecycleDirs, defaultLifecycleDeps, lifecycleHarness } from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

describe("S-G9-01 — an entry that would meet eviction immediately vetoes EXPIRY", () => {
  it("S-G9-01 the pure veto fires when the nearest leg expiry is at or before the next trading session", () => {
    const candidate = creditVertical();
    expect(lifecycleEntryVeto(candidate, { regime: "normal", nextTradingDay: "2026-09-04" })).toMatchObject({ code: "EXPIRY" });
    expect(lifecycleEntryVeto(candidate, { regime: "normal", nextTradingDay: "2026-09-05" })).toMatchObject({ code: "EXPIRY" });
    expect(lifecycleEntryVeto(candidate, { regime: "normal", nextTradingDay: "2026-09-01" })).toBeNull();
  });

  it("S-G9-01 the runner records the veto in the CYCLE and sends no order", async () => {
    const harness = await lifecycleHarness({ lifecycle: { nextTradingDay: "2026-09-04" } });
    const report = await harness.cycle();
    expect(report.lifecycleVetoes).toMatchObject([{ code: "EXPIRY" }]);
    expect(report.actions).toMatchObject([{ result: "NOT_SENT" }]);
    expect(harness.fake.mutations).toHaveLength(0);
    const cycle = harness.entries().find(entry => entry.type === "CYCLE");
    const verdicts = cycle?.["candidateVerdicts"] as readonly Record<string, unknown>[];
    expect(verdicts.some(verdict => verdict["decision"] === "VETO" && verdict["code"] === "EXPIRY")).toBe(true);
  });
});

describe("S-G9-02 / BEQ-1 — the eviction close is generated regardless of P&L and tracked to a terminal state", () => {
  it("S-G9-02 an open position expiring next session gets a whole-structure expiry close; an unfilled close re-enters the ladder every cycle until it fills", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills under the normal calendar
    const eviction = defaultLifecycleDeps({ nextTradingDay: "2026-09-04" });
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const first = await harness.cycle({ lifecycle: eviction });
    expect(first.managementCloses).toMatchObject([{ route: "expiry", generation: 0 }]);
    // BEQ-1: the resting close is vetoed by the market (never fills); the next cycle cancels and re-submits.
    const second = await harness.cycle({ lifecycle: eviction });
    expect(second.managementCloses).toMatchObject([{ route: "expiry", generation: 1 }]);
    // Once the broker fills the escalated close, the lifecycle is terminal: no further attempt is generated.
    harness.fake.setSubmitBehaviour(() => ({ kind: "fill" }));
    const third = await harness.cycle({ lifecycle: eviction });
    expect(third.managementCloses).toMatchObject([{ route: "expiry", generation: 2 }]);
    const positions = await harness.fake.read.positions();
    expect(positions).toHaveLength(0);
    const fourth = await harness.cycle({ lifecycle: eviction });
    expect(fourth.managementCloses).toEqual([]);
    // "A close was generated once" never satisfies the case: three journaled generations exist, then terminal.
    const generations = harness.entries().filter(entry => entry.type === "INTENT" && entry["action"] === "close").map(entry => entry["generation"]);
    expect(generations).toEqual([0, 1, 2]);
  });

  it("S-G9-02 still open with no further cycle before session close → halt plus active fail-signal while attempts continue", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle();
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const final = await harness.cycle({ lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04", finalCycleOfSession: true }) });
    expect(final.managementCloses).toMatchObject([{ route: "expiry" }]);
    expect(final.alarmConditions).toContain("EXPIRY_EVICTION_UNFILLED_AT_SESSION_CLOSE");
    expect(final.ping).toBe("fail");
    expect(harness.ping.record.failures.at(-1)?.conditions).toContain("EXPIRY_EVICTION_UNFILLED_AT_SESSION_CLOSE");
    expect(harness.entries().some(entry => entry.type === "HALT" && entry["reason"] === "EXPIRY_EVICTION_STUCK")).toBe(true);
  });
});

describe("S-G9-03 — eviction closes are management actions", () => {
  it("S-G9-03 they run under halt, and they are never leg-wise on an intact structure", async () => {
    const harness = await lifecycleHarness();
    await harness.cycle(); // entry fills
    // A manual halt is set; entries are vetoed but the eviction close still runs (management action).
    const haltResult = await harness.gateway.dispatch({ class: "authoritative", epoch: 1, action: { kind: "journal_append", entry: { at: "2026-08-31T13:32:00.000Z", epoch: 1, type: "HALT", reason: "MANUAL", detail: "operator halt for the S-G9-03 drill", sticky: false } } });
    expect(haltResult.ok).toBe(true);
    harness.fake.setSubmitBehaviour(payload => (payload.intent === "close" ? { kind: "accept" } : { kind: "fill" }));
    const report = await harness.cycle({ lifecycle: defaultLifecycleDeps({ nextTradingDay: "2026-09-04" }) });
    expect(report.managementCloses).toMatchObject([{ route: "expiry" }]);
    // Whole-structure, not leg-wise: the close INTENT carries both legs of the intact vertical.
    const closeIntent = harness.entries().find(entry => entry.type === "INTENT" && entry["action"] === "close");
    expect((closeIntent?.["legs"] as readonly unknown[]).length).toBe(2);
    // No entry order was sent while halted.
    expect(harness.fake.mutations.filter(mutation => {
      const payload = mutation.payload as { intent?: string } | undefined;
      return mutation.kind === "submit_order" && payload?.intent === "entry";
    }).length).toBe(1); // only the original entry from cycle 1
  });
});
