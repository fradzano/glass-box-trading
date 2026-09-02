// S-CYC-12 — the qualifying-activity competitiveness gate (WIN-13), driven
// through the real cycle runner over the fake broker on the competition
// profile: an all-week no-candidate path, repeated safe non-fills, the
// ordinary qualifying fill, the cap boundary, an attempted gate bypass, and
// zero new qualification entries after the window.
import { afterEach, describe, expect, it } from "vitest";
import { integerUnit } from "../src/core/domain.js";
import { qualificationBrief, qualificationEntryVeto } from "../src/core/qualification.js";
import type { AnalystInput } from "../src/shell/cycle-runner.js";
import { LONG_CALL, SHORT_CALL, creditVertical } from "./execution-fixtures.js";
import { TWO_CANDIDATES_JSON, cleanupLifecycleDirs, defaultLifecycleDeps, lifecycleHarness, lifecycleMarket } from "./lifecycle-fixtures.js";
import type { LifecycleHarnessOptions } from "./lifecycle-fixtures.js";
import { P5_NOW } from "./lifecycle-fixtures.js";

afterEach(() => { cleanupLifecycleDirs(); });

const CHECKPOINT = P5_NOW + 60_000;
/** Two cycle intervals after the checkpoint: every test steps the clock by at most one interval, so no invocation becomes a GAP (S-CYC-08). */
const WINDOW_END = P5_NOW + 60_000 + 2 * 900_000;
/** The credit vertical reserves (500 - 198) x 100 = 30,200 cents; the cap sits exactly there for the boundary tests. */
const CAP = 30_200;
const QUALIFICATION = { checkpointMs: CHECKPOINT, windowEndMs: WINDOW_END, maxLossCents: CAP };

async function competitionHarness(options: LifecycleHarnessOptions = {}) {
  return lifecycleHarness({ profile: "competition", lifecycle: defaultLifecycleDeps({ qualification: QUALIFICATION }), ...options });
}

/** A tape that moved since the last cycle, so G6's frozen-quote check does not veto every later entry (the fixture market is static). */
function movedMarket(harness: Awaited<ReturnType<typeof competitionHarness>>, deltaCents: number) {
  return lifecycleMarket(() => harness.clock.now, { quotes: {
    [SHORT_CALL]: { bidCents: 300 + deltaCents, askCents: 302 + deltaCents, bidSize: 20 + deltaCents, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
    [LONG_CALL]: { bidCents: 100 + deltaCents, askCents: 102 + deltaCents, bidSize: 20 + deltaCents, askSize: 20, quotedAtMs: harness.clock.now, brokerQuotedAt: "2026-08-31T13:30:59.871234567Z" },
  } });
}

function cycleReasonCodes(harness: Awaited<ReturnType<typeof competitionHarness>>): readonly (readonly string[])[] {
  return harness.entries().filter(entry => entry.type === "CYCLE").map(entry => entry["reasonCodes"] as readonly string[]);
}

describe("S-CYC-12 — checkpoint, window, and failure are journaled and exposed", () => {
  it("an all-week no-candidate path: before the checkpoint nothing is flagged; from the checkpoint every CYCLE carries COMPETITIVENESS_AT_RISK and alarms; from the window end WINNING_ACCEPTANCE_FAILED", async () => {
    const harness = await competitionHarness({ analyst: () => Promise.resolve("{\"candidates\":[]}") });
    const before = await harness.cycle();
    expect(before.reasonCodes).toEqual([]);
    expect(before.alarmConditions).toEqual([]);
    harness.clock.now = CHECKPOINT;
    const atCheckpoint = await harness.cycle();
    expect(atCheckpoint.alarmConditions).toContain("COMPETITIVENESS_AT_RISK");
    expect(atCheckpoint.ping).toBe("fail");
    harness.clock.now = CHECKPOINT + 900_000;
    await harness.cycle();
    harness.clock.now = WINDOW_END;
    const afterWindow = await harness.cycle();
    expect(afterWindow.alarmConditions).toContain("WINNING_ACCEPTANCE_FAILED");
    expect(cycleReasonCodes(harness)).toEqual([[], ["COMPETITIVENESS_AT_RISK"], ["COMPETITIVENESS_AT_RISK"], ["WINNING_ACCEPTANCE_FAILED"]]);
    expect(harness.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toEqual([]);
  });

  it("the analyst brief is active only inside the open window and carries the cap; it is never a gate parameter", async () => {
    const briefs: AnalystInput["qualification"][] = [];
    const harness = await competitionHarness({ analyst: input => { briefs.push(input.qualification); return Promise.resolve("{\"candidates\":[]}"); } });
    await harness.cycle();
    harness.clock.now = CHECKPOINT;
    await harness.cycle();
    harness.clock.now = WINDOW_END;
    await harness.cycle();
    expect(briefs).toEqual([
      { active: false, maxLossCents: null, windowEndMs: null, quantityBound: null },
      { active: true, maxLossCents: CAP, windowEndMs: WINDOW_END, quantityBound: 1 },
      { active: false, maxLossCents: null, windowEndMs: null, quantityBound: null },
    ]);
    expect(Object.keys(qualificationBrief({ state: "COMPETITIVENESS_AT_RISK", fills: [], checkpointMs: 0, windowEndMs: 1, windowOpen: true }, QUALIFICATION))).toEqual(["active", "maxLossCents", "windowEndMs", "quantityBound"]);
  });
});

describe("S-CYC-12 — the window's proposal still traverses the unchanged path with a stricter cap", () => {
  it("repeated safe non-fills: one live one-lot attempt at a time, each resting order canceled by expiry of the next cycle's phase 0 only through broker truth; the state stays at risk", async () => {
    const harness = await competitionHarness();
    harness.fake.setSubmitBehaviour(() => ({ kind: "accept" }));
    harness.clock.now = CHECKPOINT;
    const first = await harness.cycle();
    expect(first.actions).toMatchObject([{ result: "SUBMITTED" }]);
    expect(first.alarmConditions).toContain("COMPETITIVENESS_AT_RISK");
    harness.clock.now = CHECKPOINT + 900_000;
    // The first attempt is still resting (accepted, unfilled). The same candidate again is G7's duplicate veto; a
    // different candidate passes the gates and is refused by the window's one-live rule, journaled as a lifecycle veto.
    const second = await harness.cycle({ analyst: () => Promise.resolve(TWO_CANDIDATES_JSON), market: movedMarket(harness, 1) });
    expect(second.lifecycleVetoes).toMatchObject([{ code: "QUALIFICATION_ONE_LIVE" }]);
    expect(second.actions).toMatchObject([{ result: "NOT_SENT", detail: expect.stringContaining("QUALIFICATION_ONE_LIVE") }]);
    expect(harness.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toHaveLength(1);
    expect(cycleReasonCodes(harness)).toEqual([["COMPETITIVENESS_AT_RISK"], ["COMPETITIVENESS_AT_RISK"]]);
    // The resting order expires overnight at the broker; the next cycle sees the terminal state and may try once more.
    harness.fake.transitionOrder(harness.fake.allOrders()[0]?.clientOrderId ?? "", { status: "expired", reason: null });
    harness.clock.now = CHECKPOINT + 2 * 900_000 - 60_000;
    const third = await harness.cycle({ market: movedMarket(harness, 2) });
    expect(third.actions).toMatchObject([{ result: "SUBMITTED" }]);
    expect(third.alarmConditions).toContain("COMPETITIVENESS_AT_RISK");
  });

  it("an ordinary qualifying fill inside the window turns the state to QUALIFIED: no more alarm, no reason code, the window's vetoes are gone", async () => {
    const harness = await competitionHarness();
    harness.clock.now = CHECKPOINT;
    const filled = await harness.cycle();
    expect(filled.actions).toMatchObject([{ result: "SUBMITTED", status: "filled" }]);
    expect(filled.alarmConditions).toContain("COMPETITIVENESS_AT_RISK"); // the state is projected at the start of the cycle, before its own fill
    harness.clock.now = CHECKPOINT + 900_000;
    const after = await harness.cycle();
    expect(after.alarmConditions).not.toContain("COMPETITIVENESS_AT_RISK");
    expect(after.reasonCodes).toEqual([]);
    expect(after.lifecycleVetoes).toEqual([]);
    expect(cycleReasonCodes(harness)).toEqual([["COMPETITIVENESS_AT_RISK"], []]);
    harness.clock.now = WINDOW_END + 900_000;
    const late = await harness.cycle();
    expect(late.alarmConditions).not.toContain("WINNING_ACCEPTANCE_FAILED");
  });

  it("the cap boundary: a reserved max loss exactly at QUALIFICATION_MAX_LOSS passes, one cent above is vetoed QUALIFICATION_CAP", async () => {
    const atCap = await competitionHarness();
    atCap.clock.now = CHECKPOINT;
    expect((await atCap.cycle()).actions).toMatchObject([{ result: "SUBMITTED" }]);
    const aboveCap = await competitionHarness({ lifecycle: defaultLifecycleDeps({ qualification: { ...QUALIFICATION, maxLossCents: CAP - 1 } }) });
    aboveCap.clock.now = CHECKPOINT;
    const report = await aboveCap.cycle();
    expect(report.lifecycleVetoes).toMatchObject([{ code: "QUALIFICATION_CAP" }]);
    expect(report.actions).toMatchObject([{ result: "NOT_SENT", detail: expect.stringContaining("QUALIFICATION_CAP") }]);
    expect(aboveCap.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toEqual([]);
    // The CYCLE entry carries the veto as a candidate verdict, so the judge sees the refused attempt.
    const cycle = aboveCap.entries().find(entry => entry.type === "CYCLE");
    expect(cycle?.["candidateVerdicts"]).toMatchObject([{ decision: "PASS" }, { decision: "VETO", code: "QUALIFICATION_CAP" }]);
    expect(qualificationEntryVeto({ candidateId: "c", quantity: 1, reservedMaxLossCents: CAP }, { state: "COMPETITIVENESS_AT_RISK", fills: [], checkpointMs: 0, windowEndMs: 1, windowOpen: true }, QUALIFICATION, 0)).toBeNull();
    expect(qualificationEntryVeto({ candidateId: "c", quantity: 1, reservedMaxLossCents: CAP + 1 }, { state: "COMPETITIVENESS_AT_RISK", fills: [], checkpointMs: 0, windowEndMs: 1, windowOpen: true }, QUALIFICATION, 0)).toMatchObject({ code: "QUALIFICATION_CAP" });
  });

  it("an attempted gate bypass: a two-lot proposal is vetoed QUALIFICATION_ONE_LOT, and a structure outside the whitelist is still vetoed by G8 — the mode widens nothing", async () => {
    const twoLots = JSON.stringify({ candidates: [creditVertical({ quantity: integerUnit(2, "Quantity") as never })] });
    const harness = await competitionHarness({ analyst: () => Promise.resolve(twoLots) });
    harness.clock.now = CHECKPOINT;
    const report = await harness.cycle();
    expect(report.lifecycleVetoes).toMatchObject([{ code: "QUALIFICATION_ONE_LOT" }]);
    expect(harness.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toEqual([]);
    // A vertical's legs declared as an iron condor: the unchanged gates refuse it (declared structure versus legs), the window adds nothing.
    const foreign = JSON.stringify({ candidates: [creditVertical({ declaredStructureType: "iron_condor" })] });
    const bypass = await competitionHarness({ analyst: () => Promise.resolve(foreign) });
    bypass.clock.now = CHECKPOINT;
    const vetoed = await bypass.cycle();
    expect(vetoed.actions).toEqual([]);
    expect(vetoed.lifecycleVetoes).toEqual([]);
    expect(bypass.fake.mutations.filter(mutation => mutation.kind === "submit_order")).toEqual([]);
    const cycle = bypass.entries().find(entry => entry.type === "CYCLE");
    const verdicts = cycle?.["candidateVerdicts"] as readonly { decision: string; gateVector?: readonly { gate: string; passed: boolean; code: string }[] }[];
    const batch = cycle?.["batchVerdicts"] as readonly { code: string }[];
    // The refusal lands where the unchanged path puts it: a gate veto in the vector or a batch-level SCHEMA_VETO — never a qualification code.
    const gateVeto = verdicts.some(verdict => verdict.decision === "VETO" && (verdict.gateVector ?? []).some(gate => !gate.passed));
    const schemaVeto = batch.some(verdict => verdict.code === "SCHEMA_VETO");
    expect(gateVeto || schemaVeto).toBe(true);
  });

  it("after the window end no qualification entry starts: the brief is inactive, the window vetoes are absent, and the CYCLE carries WINNING_ACCEPTANCE_FAILED", async () => {
    const briefs: AnalystInput["qualification"][] = [];
    const twoLots = JSON.stringify({ candidates: [creditVertical({ quantity: integerUnit(2, "Quantity") as never })] });
    const harness = await competitionHarness({ analyst: input => { briefs.push(input.qualification); return Promise.resolve(briefs.length < 3 ? "{\"candidates\":[]}" : twoLots); } });
    await harness.cycle();
    harness.clock.now = CHECKPOINT + 900_000;
    await harness.cycle();
    harness.clock.now = WINDOW_END;
    const report = await harness.cycle({ market: movedMarket(harness, 1) });
    expect(briefs.map(brief => brief.active)).toEqual([false, true, false]);
    expect(report.lifecycleVetoes).toEqual([]);
    expect(report.alarmConditions).toContain("WINNING_ACCEPTANCE_FAILED");
    expect(cycleReasonCodes(harness)).toEqual([[], ["COMPETITIVENESS_AT_RISK"], ["WINNING_ACCEPTANCE_FAILED"]]);
    // Ordinary trading under the normal gates is unchanged after the window (G11 is untouched): the two-lot entry is submitted.
    expect(report.actions).toMatchObject([{ result: "SUBMITTED" }]);
  });
});
