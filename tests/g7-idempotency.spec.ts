import { describe, expect, it } from "vitest";
import { classifyDuplicateSubmission, closeAttemptId, closeLifecycleId, entryClientOrderId, planCloseLifecycle } from "../src/core/order-identity.js";
import { integerUnit } from "../src/core/domain.js";
import type { CloseLifecycleSnapshot, CloseRoute } from "../src/core/domain.js";
import { candidate, snapshot } from "./fixtures.js";

describe("G7 idempotency", () => {
  it("S-G7-01 derives stable entry IDs and one route-independent close lifecycle", () => {
    const decisionSnapshot = snapshot();
    const value = candidate();
    expect(entryClientOrderId(decisionSnapshot, value)).toBe(entryClientOrderId(decisionSnapshot, value));
    expect(entryClientOrderId({ ...decisionSnapshot, cycleIndex: integerUnit(decisionSnapshot.cycleIndex + 1, "Quantity") }, value)).not.toBe(entryClientOrderId(decisionSnapshot, value));
    const routes: readonly CloseRoute[] = ["ordinary", "emergency", "expiry", "kill", "watchdog"];
    expect(new Set(routes.map(route => closeLifecycleId("exposure-17", route)))).toEqual(new Set(["close:exposure-17"]));
    expect(closeAttemptId("close:exposure-17", integerUnit(2, "Quantity"))).toBe("close:exposure-17:g2");
  });

  it("S-G7-02 adopts duplicates and never creates parallel, reversing, or fresh-route close children", () => {
    const active: CloseLifecycleSnapshot = {
      exposureLifecycleId: "spread-1",
      route: "ordinary",
      currentExposureQuantity: integerUnit(10, "Quantity"),
      attempts: [{ attemptId: "close:spread-1:g0", generation: integerUnit(0, "Quantity"), requestedQuantity: integerUnit(10, "Quantity"), filledQuantity: integerUnit(4, "Quantity"), state: "partially_filled" }],
    };
    expect(planCloseLifecycle(active)).toMatchObject({ kind: "ADOPT", attemptId: "close:spread-1:g0", remainingExposureQuantity: 10 });
    expect(planCloseLifecycle({ ...active, route: "emergency", attempts: [{ ...active.attempts[0]!, state: "confirmation_unclear" }] })).toMatchObject({ kind: "ADOPT", attemptId: "close:spread-1:g0" });
    expect(planCloseLifecycle({ ...active, currentExposureQuantity: integerUnit(6, "Quantity"), attempts: [{ ...active.attempts[0]!, state: "canceled" }] })).toMatchObject({ kind: "SUBMIT", attemptId: "close:spread-1:g1", quantity: 6 });
    expect(planCloseLifecycle({ ...active, currentExposureQuantity: integerUnit(0, "Quantity"), attempts: [{ ...active.attempts[0]!, state: "filled" }] })).toMatchObject({ kind: "COMPLETE" });
    expect(planCloseLifecycle({ ...active, attempts: [...active.attempts, { ...active.attempts[0]!, attemptId: "other", state: "accepted" }] })).toMatchObject({ kind: "VETO" });
    expect(planCloseLifecycle({ ...active, exposureLifecycleId: "short-stock-residue", route: "watchdog", attempts: [] })).toMatchObject({ kind: "SUBMIT", closeLifecycleId: "close:short-stock-residue", quantity: 10 });
    expect(classifyDuplicateSubmission("entry:existing")).toEqual({ kind: "ADOPT", clientOrderId: "entry:existing" });
  });
});
