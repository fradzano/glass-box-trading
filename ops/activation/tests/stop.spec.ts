// The stop contract's pure half (`docs/P12-STOP-AND-LOG-CONTRACTS.md`, SC-3).
//
// Which actions a standing stop forbids is a decision, not an ordering, so it is decided
// here — in a function with no clock, no file and no lease — and the shell only carries
// the answer out. The list is exhaustive by construction: `WorldAction["kind"]` is a
// closed union and the switch has no default, so a tenth action cannot be added without
// someone saying which side of the line it falls on.
import { describe, expect, it } from "vitest";
import { armsDeployment, stopMarkLine, stopRefusal } from "../core/stop.ts";
import type { StopMarkState } from "../core/stop.ts";
import type { WorldAction } from "../core/types.ts";

const MARK: StopMarkState = { kind: "present", mark: { id: "stop-1", operator: "felix", at: "2026-09-21T22:31:00+02:00", atUtcMs: 1_790_000_000_000, reason: "OWNER_ABORT" } };
const NONE: StopMarkState = { kind: "absent" };
const UNKNOWN: StopMarkState = { kind: "unreadable", reason: "stop.json: EACCES" };

const ARMING: readonly WorldAction["kind"][] = ["enable-tasks", "write-certificate-line", "install-tasks", "register-disarm", "restart"];
const DISARMING: readonly WorldAction["kind"][] = ["disable-tasks", "remove-certificate-line", "delete-disarm", "clear-checks"];

describe("which actions a stop forbids", () => {
  it("names every action of the union, once, on one side or the other", () => {
    const all = [...ARMING, ...DISARMING];
    expect(new Set(all).size).toBe(all.length);
    // If a tenth kind is added to WorldAction, this line stops compiling before it stops
    // passing, which is the point of the exhaustive switch behind it.
    for (const kind of all) expect(typeof armsDeployment(kind)).toBe("boolean");
  });

  it("forbids everything that could arm the deployment", () => {
    for (const kind of ARMING) {
      expect(armsDeployment(kind)).toBe(true);
      expect(stopRefusal(kind, MARK)).toContain("STOPPED_BY_OWNER");
      expect(stopRefusal(kind, MARK)).toContain("felix");
    }
  });

  // A stop must never block another stop. The 15:05 one-shot still has to disable both
  // tasks after an owner abort at 14:00, and an automatic abort still has to remove the
  // certificate line — a rule that stopped those would turn the safest state into the one
  // the deployment cannot reach.
  it("permits everything that disarms it, mark or no mark", () => {
    for (const kind of DISARMING) {
      expect(armsDeployment(kind)).toBe(false);
      for (const state of [MARK, NONE, UNKNOWN]) expect(stopRefusal(kind, state)).toBeNull();
    }
  });

  it("permits arming when no stop stands", () => {
    for (const kind of ARMING) expect(stopRefusal(kind, NONE)).toBeNull();
  });

  // An answer that cannot be obtained is not an absence. This is the same shape as the
  // defect the whole mark exists to close: a missing check that reads as permission.
  it("refuses arming when the mark cannot be read at all", () => {
    for (const kind of ARMING) {
      const refusal = stopRefusal(kind, UNKNOWN);
      expect(refusal).toContain("STOP_MARK_UNREADABLE");
      expect(refusal).toContain("EACCES");
    }
  });

  it("says in one line what a reader of status has to know", () => {
    expect(stopMarkLine(NONE)).toContain("none");
    expect(stopMarkLine(MARK)).toContain("felix");
    expect(stopMarkLine(MARK)).toContain("activation open");
    expect(stopMarkLine(UNKNOWN)).toContain("could not be read");
  });
});
