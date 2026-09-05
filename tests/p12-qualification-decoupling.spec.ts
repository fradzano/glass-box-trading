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
import { readFileSync } from "node:fs";
import path from "node:path";
import { projectQualification, qualificationBrief, qualificationEntryVeto, qualificationReasonCodes } from "../src/core/qualification.js";
import type { QualificationConfig } from "../src/core/qualification.js";

const REPO_ROOT = path.resolve();

/**
 * The REAL policy, loaded from config/policy.json rather than copied.
 *
 * R43-B9: the first version of this file copied the constants and sampled only
 * through the flatten date, so it missed that the window opened at
 * 2026-12-09T20:00:00Z — during the journaling-only day, before the deployment
 * had ended. The real runner at 20:15 issued an active qualification brief with
 * a one-lot bound and fail-pinged COMPETITIVENESS_AT_RISK. A test that copies
 * the values it is meant to check cannot see a change to them, which is the
 * whole point of loading them here.
 */
const POLICY = JSON.parse(readFileSync(path.join(REPO_ROOT, "config", "policy.json"), "utf8")) as Record<string, string | number>;
const P12_CONFIG: QualificationConfig = {
  checkpointMs: Date.parse(String(POLICY["QUALIFYING_ACTIVITY_CHECKPOINT"])),
  windowEndMs: Date.parse(String(POLICY["QUALIFICATION_WINDOW_END"])),
  maxLossCents: Number(POLICY["QUALIFICATION_MAX_LOSS_CENTS"]),
};
const FLATTEN_DATE = String(POLICY["FLATTEN_DATE"]);

const FIRST_CYCLE = Date.parse("2026-09-08T13:30:00Z");
const MID_RUN = Date.parse("2026-10-27T14:00:00Z");
const FLATTEN_DAY = Date.parse(`${FLATTEN_DATE}T20:00:00Z`);

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

  it("R43-B9: the window is shut at every minute of the deployment, including the journaling-only day and the shutdown", () => {
    // The scan the first version of this test should have been: every minute
    // from the first cycle to well past TERMINAL, against the real policy.
    const from = Date.parse("2026-09-08T13:30:00Z");
    const until = Date.parse(`${FLATTEN_DATE}T21:00:00Z`) + 3 * 86_400_000;
    let opened = 0;
    let firstOpenAt: string | null = null;
    for (let at = from; at <= until; at += 60_000) {
      const projection = projectQualification([], at, P12_CONFIG, "competition");
      if (projection.windowOpen) {
        opened += 1;
        firstOpenAt ??= new Date(at).toISOString();
      }
    }
    expect(opened, `the window opened ${String(opened)} times, first at ${String(firstOpenAt)}`).toBe(0);
  });

  it("R43-B9: the checkpoint lies beyond the deployment by a clear margin, not by a day", () => {
    // A checkpoint one day after the flatten date left the window opening
    // during the shutdown. The margin has to outlast every plausible slip.
    const flattenMs = Date.parse(`${FLATTEN_DATE}T21:00:00Z`);
    expect(P12_CONFIG.checkpointMs).toBeGreaterThan(flattenMs + 30 * 86_400_000);
    expect(P12_CONFIG.windowEndMs).toBeGreaterThan(P12_CONFIG.checkpointMs);
  });

  it("and it never becomes an alarm: the two states that alarm are unreachable before the flatten date", () => {
    // COMPETITIVENESS_AT_RISK and WINNING_ACCEPTANCE_FAILED are the only two
    // states that raise a reason code and a fail-ping. Both need the clock past
    // the checkpoint, which is past the end of the deployment.
    for (const at of [FIRST_CYCLE, MID_RUN, FLATTEN_DAY]) {
      expect(qualificationReasonCodes(projectQualification([], at, P12_CONFIG, "competition"))).toEqual([]);
    }
    // Sanity: the machinery still works, it is simply never reached in range.
    const afterEnd = projectQualification([], P12_CONFIG.windowEndMs + 60_000, P12_CONFIG, "competition");
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
