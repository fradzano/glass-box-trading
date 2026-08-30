import { describe, expect, it } from "vitest";
import { decide } from "../src/core/decision.js";
import { classifyDuplicateSubmission, closeAttemptId, closeLifecycleId, entryClientOrderId, planCloseLifecycle } from "../src/core/order-identity.js";
import { integerUnit } from "../src/core/domain.js";
import type { CloseLifecycleSnapshot, CloseRoute, Quantity } from "../src/core/domain.js";
import { TEST_ONLY_NOW, TEST_ONLY_O5_CONFIG, candidate, snapshot } from "./fixtures.js";

describe("G7 idempotency", () => {
  it("S-G7-01 derives stable entry IDs and one route-independent close lifecycle", () => {
    const decisionSnapshot = snapshot();
    const value = candidate();
    expect(entryClientOrderId(decisionSnapshot, value)).toBe(entryClientOrderId(decisionSnapshot, value));
    expect(entryClientOrderId({ ...decisionSnapshot, cycleIndex: integerUnit(decisionSnapshot.cycleIndex + 1, "Quantity") }, value)).not.toBe(entryClientOrderId(decisionSnapshot, value));
    expect(entryClientOrderId(decisionSnapshot, { ...value, candidateId: "analyst-rephrased", rationale: "Same legs, different prose." })).toBe(entryClientOrderId(decisionSnapshot, value));
    expect(() => integerUnit(-1, "Quantity")).toThrow("Quantity must be non-negative");
    const routes: readonly CloseRoute[] = ["ordinary", "emergency", "expiry", "kill", "watchdog"];
    expect(new Set(routes.map(route => closeLifecycleId("exposure-17", route)))).toEqual(new Set(["close:exposure-17"]));
    expect(closeAttemptId("close:exposure-17", integerUnit(2, "Quantity"))).toBe("close:exposure-17:g2");
  });

  it("S-G7-02 adopts duplicates and never creates parallel, reversing, or fresh-route close children", () => {
    const active: CloseLifecycleSnapshot = {
      exposureLifecycleId: "spread-1",
      route: "ordinary",
      currentExposureQuantity: integerUnit(6, "Quantity"),
      attempts: [{ attemptId: "close:spread-1:g0", generation: integerUnit(0, "Quantity"), requestedQuantity: integerUnit(10, "Quantity"), filledQuantity: integerUnit(4, "Quantity"), state: "partially_filled" }],
    };
    expect(planCloseLifecycle(active)).toMatchObject({ kind: "ADOPT", attemptId: "close:spread-1:g0", remainingExposureQuantity: 6 });
    expect(planCloseLifecycle({ ...active, route: "emergency", attempts: [{ ...active.attempts[0]!, state: "confirmation_unclear" }] })).toMatchObject({ kind: "ADOPT", attemptId: "close:spread-1:g0" });
    expect(planCloseLifecycle({ ...active, currentExposureQuantity: integerUnit(6, "Quantity"), attempts: [{ ...active.attempts[0]!, state: "canceled" }] })).toMatchObject({ kind: "SUBMIT", attemptId: "close:spread-1:g1", quantity: 6 });
    expect(planCloseLifecycle({ ...active, currentExposureQuantity: integerUnit(0, "Quantity"), attempts: [{ ...active.attempts[0]!, state: "filled" }] })).toMatchObject({ kind: "COMPLETE" });
    expect(planCloseLifecycle({ ...active, attempts: [...active.attempts, { ...active.attempts[0]!, attemptId: "other", state: "accepted" }] })).toMatchObject({ kind: "VETO" });
    expect(planCloseLifecycle({ ...active, currentExposureQuantity: -1 as Quantity, attempts: [] })).toMatchObject({ kind: "VETO" });
    expect(planCloseLifecycle({
      ...active,
      currentExposureQuantity: integerUnit(1, "Quantity"),
      attempts: [{ ...active.attempts[0]!, generation: Number.MAX_SAFE_INTEGER as Quantity, state: "canceled" }],
    })).toMatchObject({ kind: "VETO" });
    expect(planCloseLifecycle({ ...active, exposureLifecycleId: "short-stock-residue", route: "watchdog", attempts: [] })).toMatchObject({ kind: "SUBMIT", closeLifecycleId: "close:short-stock-residue", quantity: 6 });
    expect(classifyDuplicateSubmission("entry:existing")).toEqual({ kind: "ADOPT", clientOrderId: "entry:existing" });

    const forgedAttempts: CloseLifecycleSnapshot[] = [
      { ...active, attempts: [{ ...active.attempts[0]!, attemptId: "close:foreign:g0" }] },
      { ...active, attempts: [{ ...active.attempts[0]!, attemptId: "close:spread-1:g9" }] },
      { ...active, attempts: [{ ...active.attempts[0]!, attemptId: "close:foreign:g41", generation: integerUnit(41, "Quantity"), state: "canceled" }] },
      { ...active, attempts: [{ ...active.attempts[0]!, state: "pending_replace" as CloseLifecycleSnapshot["attempts"][number]["state"] }] },
      { ...active, attempts: [{ ...active.attempts[0]!, requestedQuantity: integerUnit(0, "Quantity"), filledQuantity: integerUnit(0, "Quantity") }] },
      { ...active, currentExposureQuantity: integerUnit(0, "Quantity") },
    ];
    for (const forged of forgedAttempts) expect(planCloseLifecycle(forged)).toMatchObject({ kind: "VETO" });

    const duplicateBatch = decide(snapshot(), {
      kind: "candidates",
      candidates: [
        candidate({ candidateId: "first" }),
        candidate({ candidateId: "second" }),
      ],
    }, TEST_ONLY_O5_CONFIG, TEST_ONLY_NOW);
    expect(duplicateBatch.actions).toHaveLength(1);
    expect(duplicateBatch.candidateVerdicts[1]?.gateVector[6]).toMatchObject({ passed: false, code: "IDEMPOTENCY" });
  });
});
