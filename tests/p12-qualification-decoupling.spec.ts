// P12: a long paper run keeps the competition profile's protections — the
// arming certificate gate and the account binding — but must carry none of its
// competitive pressure. The qualification window is not a display state: while
// it is open it issues an analyst brief and applies three entry vetoes (one
// lot, a loss cap, one live attempt at a time). This pins the decoupling.
//
// The decoupling is configuration only, and that is the point: no code path is
// weakened, nothing is special-cased for "long run", and the certificate and
// binding checks are untouched. Placing the qualifying checkpoint beyond the
// deployment's own flatten date means `windowOpen` is false for every instant
// the deployment exists, and everything the window does hangs off `windowOpen`.
import { describe, expect, it } from "vitest";
import { projectQualification, qualificationBrief, qualificationEntryVeto, qualificationReasonCodes } from "../src/core/qualification.js";
import type { QualificationConfig } from "../src/core/qualification.js";

/** The P12 shape: the run flattens 2026-12-08, the checkpoint is the day after. */
const P12_CONFIG: QualificationConfig = {
  checkpointMs: Date.parse("2026-12-09T20:00:00Z"),
  windowEndMs: Date.parse("2026-12-10T20:00:00Z"),
  maxLossCents: 50_000,
};

const FIRST_CYCLE = Date.parse("2026-09-08T13:30:00Z");
const MID_RUN = Date.parse("2026-10-27T14:00:00Z");
const FLATTEN_DAY = Date.parse("2026-12-08T20:00:00Z");

const PLAN = { candidateId: "c1", quantity: 5, reservedMaxLossCents: 400_000 };

describe("P12 — the qualification window never opens during the run", () => {
  for (const [label, at] of [["the first cycle", FIRST_CYCLE], ["mid-run", MID_RUN], ["the flatten day", FLATTEN_DAY]] as const) {
    it(`is NOT_DUE with the window closed at ${label}, so it changes no behaviour`, () => {
      const projection = projectQualification([], at, P12_CONFIG, "competition");
      expect(projection.state).toBe("NOT_DUE");
      expect(projection.windowOpen).toBe(false);

      // The three things an open window actually does, all inert:
      expect(qualificationBrief(projection, P12_CONFIG)).toEqual({ active: false, maxLossCents: null, windowEndMs: null, quantityBound: null });
      expect(qualificationEntryVeto(PLAN, projection, P12_CONFIG, 0)).toBeNull();
      expect(qualificationEntryVeto(PLAN, projection, P12_CONFIG, 3)).toBeNull();
      expect(qualificationReasonCodes(projection)).toEqual([]);
    });
  }

  it("a five-lot candidate well over the cap passes the window untouched: no forced one-lot trade", () => {
    const projection = projectQualification([], MID_RUN, P12_CONFIG, "competition");
    const oversized = { candidateId: "big", quantity: 5, reservedMaxLossCents: 999_999 };
    expect(qualificationEntryVeto(oversized, projection, P12_CONFIG, 0)).toBeNull();
  });

  it("and it never becomes an alarm: the two states that alarm are unreachable before the flatten date", () => {
    // COMPETITIVENESS_AT_RISK and WINNING_ACCEPTANCE_FAILED are the only two
    // states that raise a reason code and a fail-ping. Both need the clock past
    // the checkpoint, which is past the end of the deployment.
    for (const at of [FIRST_CYCLE, MID_RUN, FLATTEN_DAY]) {
      expect(qualificationReasonCodes(projectQualification([], at, P12_CONFIG, "competition"))).toEqual([]);
    }
    // Sanity: the machinery still works, it is simply never reached in range.
    const afterEnd = projectQualification([], Date.parse("2026-12-11T20:00:00Z"), P12_CONFIG, "competition");
    expect(afterEnd.state).toBe("WINNING_ACCEPTANCE_FAILED");
  });

  it("the competition profile's own protections are untouched by the decoupling", () => {
    // The decoupling moves two instants in config. It does not touch the
    // profile, so the arming certificate gate and the S-J-06 account binding
    // still apply exactly as they did for the competition; a dev profile would
    // have switched both off (arming-gate.ts returns armed without reading the
    // certificate for any non-competition profile).
    expect(projectQualification([], MID_RUN, P12_CONFIG, "dev").state).toBe("NOT_APPLICABLE");
    expect(projectQualification([], MID_RUN, P12_CONFIG, "competition").state).toBe("NOT_DUE");
  });
});
