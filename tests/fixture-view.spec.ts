import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { P1_RECORDED_CANDIDATES, P1_RECORDED_SNAPSHOT, TEST_ONLY_P1_NOW, TEST_ONLY_P1_O5_CONFIG } from "../src/fixtures/p1-recorded-cycle.js";
import { renderDecisionView } from "../src/shell/render-decision-view.js";

describe("P1 recorded glass-box fixture", () => {
  it("renders one complete pass and one reasoned veto from the same core result without a broker adapter", () => {
    const result = decide(P1_RECORDED_SNAPSHOT, P1_RECORDED_CANDIDATES, TEST_ONLY_P1_O5_CONFIG, TEST_ONLY_P1_NOW);
    expect(result.candidateVerdicts.map(verdict => verdict.decision)).toEqual(["PASS", "VETO"]);
    expect(result.candidateVerdicts.every(verdict => verdict.gateVector.length === 8)).toBe(true);
    expect(result.actions).toHaveLength(1);
    const html = renderDecisionView(result);
    expect(html).toContain("ENTRY_ACTION_PLAN".replace("ENTRY_ACTION_PLAN", result.actions[0]!.clientOrderId));
    expect(html).toContain("the loss is not fixed at entry");
    expect(html).toContain("long option must contain one buy leg and a debit limit");
    expect(html).toContain("A pass is an action plan only");
  });

  it("consumes duplicate shell-boundary actions once each instead of reusing the first match", () => {
    const result = decide(P1_RECORDED_SNAPSHOT, P1_RECORDED_CANDIDATES, TEST_ONLY_P1_O5_CONFIG, TEST_ONLY_P1_NOW);
    const verdict = result.candidateVerdicts[0]!;
    const action = result.actions[0]!;
    const html = renderDecisionView({
      batchVerdicts: [],
      candidateVerdicts: [verdict, { ...verdict, candidateRationale: "Forged duplicate shell-boundary verdict." }],
      actions: [
        { ...action, clientOrderId: "entry:first" },
        { ...action, clientOrderId: "entry:second" }
      ]
    });

    expect(html.split("entry:first")).toHaveLength(2);
    expect(html.split("entry:second")).toHaveLength(2);
  });
});
