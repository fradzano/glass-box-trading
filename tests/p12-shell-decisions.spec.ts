// P12 unit 12 (the adversarial loop over units 1-11): the two decisions the
// certificate CLI used to make by hand, now functions with a test each.
//
// Both were found the same way. The session predicate existed four times — twice
// in the core, twice in the CLI — and the CLI's copies admitted a live run at the
// close instant that the core already treats as outside the session. The fence
// checkpoint decided inside a readline closure that no test in the repository
// could enter, so an inverted comparison passed the whole green gate and would
// have recorded a human confirmation for an act no human performed.
import { describe, expect, it } from "vitest";
import { isFinalCycleOfSession, isInsideSession } from "../src/core/session-window.js";
import { fenceUnhaltApproval, fenceUnhaltToken } from "../src/core/fence-unhalt.js";
import { assessStaleness } from "../src/core/lifecycle.js";

const OPENS = 1_757_000_000_000;
const CLOSES = OPENS + 6.5 * 60 * 60 * 1000;
const SESSION = { isTradingDay: true, opensAt: OPENS, closesAt: CLOSES } as const;

describe("the session window has one definition", () => {
  it("opens at opensAt and is already closed at closesAt", () => {
    expect(isInsideSession(OPENS - 1, SESSION)).toBe(false);
    expect(isInsideSession(OPENS, SESSION)).toBe(true);
    expect(isInsideSession(CLOSES - 1, SESSION)).toBe(true);
    // The instant the CLI used to treat as "still inside", which is how a live
    // certificate run could start into a market the core had already shut.
    expect(isInsideSession(CLOSES, SESSION)).toBe(false);
    expect(isInsideSession(CLOSES + 1, SESSION)).toBe(false);
  });

  it("is false all day when it is not a trading day", () => {
    const holiday = { ...SESSION, isTradingDay: false };
    for (const now of [OPENS - 1, OPENS, (OPENS + CLOSES) / 2, CLOSES - 1, CLOSES]) {
      expect(isInsideSession(now, holiday), String(now)).toBe(false);
    }
  });

  it("is false for a degenerate window, where open and close coincide", () => {
    const degenerate = { isTradingDay: true, opensAt: OPENS, closesAt: OPENS };
    expect(isInsideSession(OPENS, degenerate)).toBe(false);
  });

  it("agrees with the watchdog's own use of it, at the boundary the two used to differ on", () => {
    // assessStaleness is the second core caller; OUTSIDE_SESSION at closesAt is
    // the same judgement the entry gate makes, and now literally the same code.
    expect(assessStaleness(CLOSES, SESSION, CLOSES - 1, 60_000, false)).toEqual({ kind: "quiet", reason: "OUTSIDE_SESSION" });
    expect(assessStaleness(CLOSES - 1, SESSION, CLOSES - 1, 60_000, false)).toEqual({ kind: "quiet", reason: "FRESH" });
  });
});

describe("the certificate's human checkpoint decides in a function", () => {
  it("clears the halt on exactly the token the prompt asks for", () => {
    expect(fenceUnhaltToken(7)).toBe("CLEAR-HALT 7");
    expect(fenceUnhaltApproval("CLEAR-HALT 7", 7, "felix")).toEqual({
      operator: "felix",
      reason: "human confirmed stable flat fence reconciliation for AUTH_FAILURE halt seq 7",
    });
  });

  it("tolerates the whitespace a paste carries, and nothing else", () => {
    expect(fenceUnhaltApproval("  CLEAR-HALT 7\r\n", 7, "felix")).toMatchObject({ operator: "felix" });
    expect(fenceUnhaltApproval("clear-halt 7", 7, "felix")).toBeNull();
    expect(fenceUnhaltApproval("CLEAR-HALT  7", 7, "felix")).toBeNull();
    expect(fenceUnhaltApproval("CLEAR_HALT_7", 7, "felix")).toBeNull();
  });

  it("refuses every answer that is not this halt's token", () => {
    for (const answer of ["", " ", "y", "yes", "CLEAR-HALT", "CLEAR-HALT 8", "CLEAR-HALT 70", "7"]) {
      expect(fenceUnhaltApproval(answer, 7, "felix"), JSON.stringify(answer)).toBeNull();
    }
  });

  it("names the halt sequence it was asked about, so one answer cannot clear another halt", () => {
    expect(fenceUnhaltApproval(fenceUnhaltToken(8), 7, "felix")).toBeNull();
    expect(fenceUnhaltApproval(fenceUnhaltToken(8), 8, "felix")).toMatchObject({
      reason: "human confirmed stable flat fence reconciliation for AUTH_FAILURE halt seq 8",
    });
  });

  it("records the operator it was given rather than inventing one", () => {
    expect(fenceUnhaltApproval("CLEAR-HALT 1", 1, "owner")).toMatchObject({ operator: "owner" });
    expect(fenceUnhaltApproval("CLEAR-HALT 1", 1, "someone-else")).toMatchObject({ operator: "someone-else" });
  });
});

describe("the final cycle of a session is decided in the same place", () => {
  const INTERVAL = 900_000;

  it("is true exactly when the next cycle would begin at or after the close", () => {
    expect(isFinalCycleOfSession(CLOSES - INTERVAL - 1, INTERVAL, SESSION)).toBe(false);
    // The instant the hand-written copy got wrong: an aligned schedule puts a
    // firing exactly here, and `>` answered "not final" for a cycle after which
    // the session is over.
    expect(isFinalCycleOfSession(CLOSES - INTERVAL, INTERVAL, SESSION)).toBe(true);
    expect(isFinalCycleOfSession(CLOSES - INTERVAL + 1, INTERVAL, SESSION)).toBe(true);
  });

  it("keeps the two end-of-session safety stops on the side they must be on", () => {
    // Before the open it must stay false, or the stuck-eviction halt and the
    // flatten assertion would fire on a session that has not started…
    expect(isFinalCycleOfSession(OPENS - INTERVAL, INTERVAL, SESSION)).toBe(false);
    // …and after the close it must stay true, or a late cycle would silence them.
    expect(isFinalCycleOfSession(CLOSES, INTERVAL, SESSION)).toBe(true);
    expect(isFinalCycleOfSession(CLOSES + INTERVAL, INTERVAL, SESSION)).toBe(true);
  });

  it("means, for any cycle inside the session, that the next one is not", () => {
    for (const now of [OPENS, OPENS + INTERVAL, CLOSES - 2 * INTERVAL, CLOSES - INTERVAL, CLOSES - 1]) {
      expect(isInsideSession(now, SESSION), `precondition ${String(now)}`).toBe(true);
      expect(isFinalCycleOfSession(now, INTERVAL, SESSION), String(now))
        .toBe(!isInsideSession(now + INTERVAL, SESSION));
    }
  });
});
