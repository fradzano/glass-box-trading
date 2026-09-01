// The P6 golden-path fixture contract: the expectations, the qualification
// calendar, and the cutoff rule shared by the recorder test
// (tests/j7-j9-golden-path.spec.ts), which regenerates and checks
// fixtures/golden-journal.jsonl, and the local renderer
// (src/shell/render-golden-dashboard.ts), which builds artifacts/dashboard
// from it. Every value is a TEST_ONLY fixture value, not a production default.
import type { JournalEntry } from "../core/journal.js";
import type { ProjectionExpectations } from "../core/projection.js";
import type { QualificationConfig } from "../core/qualification.js";

/** The P5 harness clock origin plus one minute (tests/lifecycle-fixtures.ts `P5_NOW`). */
export const TEST_ONLY_GOLDEN_NOW_MS = 1_788_183_000_000 + 60_000;

export const TEST_ONLY_GOLDEN_QUALIFICATION: QualificationConfig = {
  checkpointMs: TEST_ONLY_GOLDEN_NOW_MS + 60_000,
  windowEndMs: TEST_ONLY_GOLDEN_NOW_MS + 60_000 + 2 * 900_000,
  maxLossCents: 30_200,
};

export const TEST_ONLY_GOLDEN_EXPECTATIONS: ProjectionExpectations = {
  initialCapitalCents: 10_000_000,
  expectedAccountId: "TEST_ONLY_PA000000000",
  flattenDate: "2026-09-03",
  profile: "competition",
  qualification: TEST_ONLY_GOLDEN_QUALIFICATION,
};

export const GOLDEN_SOURCE = {
  repositoryUrl: "https://github.com/fradzano/glass-box-trading",
  journalRevisionUrl: null,
  corePath: "src/core/decision.ts",
  evidenceTestPath: "tests/cyc-runner.spec.ts (S-CYC-06)",
  evidenceDebtRow: "EVIDENCE-DEBT.md WIN-1: journal-only failure with open exposure → deterministic risk-reducing emergency close, explicit audit-gap reconciliation",
} as const;

export const GOLDEN_CYCLE_INTERVAL_MS = 900_000;
export const GOLDEN_DEAD_MAN_BOUND_MS = 3_000_000;

/** The presentation cutoff of the golden journal: the last entry before the deadline reconciliation (SUBMISSION-SPEC §4.1). */
export function goldenPresentationCutoffAt(entries: readonly JournalEntry[]): string | null {
  let last: string | null = null;
  for (const entry of entries) {
    if (entry.type === "DEADLINE_RECONCILIATION") break;
    last = entry.at;
  }
  return last;
}
