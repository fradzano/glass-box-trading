import { integerUnit } from "./domain.js";
import type {
  CloseAttemptSnapshot,
  CloseLifecyclePlan,
  CloseLifecycleSnapshot,
  CloseRoute,
  DecisionSnapshot,
  EntryCandidate,
  Quantity,
} from "./domain.js";

function isActiveCloseState(state: CloseAttemptSnapshot["state"]): boolean {
  return state === "new"
    || state === "accepted"
    || state === "partially_filled"
    || state === "confirmation_unclear";
}

export function entryClientOrderId(snapshot: DecisionSnapshot, candidate: EntryCandidate): string {
  return `entry:${snapshot.tradingDay}:${String(snapshot.cycleIndex)}:${encodeURIComponent(candidate.structureIdentity)}`;
}

export function closeLifecycleId(exposureLifecycleId: string, route: CloseRoute): string {
  void route;
  return `close:${exposureLifecycleId}`;
}

export function closeAttemptId(lifecycleId: string, generation: Quantity): string {
  return `${lifecycleId}:g${String(generation)}`;
}

export function planCloseLifecycle(snapshot: CloseLifecycleSnapshot): CloseLifecyclePlan {
  const lifecycleId = closeLifecycleId(snapshot.exposureLifecycleId, snapshot.route);
  const activeAttempts = snapshot.attempts.filter(attempt => isActiveCloseState(attempt.state));

  if (activeAttempts.length > 1) {
    return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "multiple non-terminal or confirmation-unclear close children" };
  }

  const activeAttempt = activeAttempts[0];
  if (activeAttempt !== undefined) {
    return {
      kind: "ADOPT",
      closeLifecycleId: lifecycleId,
      attemptId: activeAttempt.attemptId,
      remainingExposureQuantity: snapshot.currentExposureQuantity,
    };
  }

  if (snapshot.currentExposureQuantity === 0) {
    return { kind: "COMPLETE", closeLifecycleId: lifecycleId };
  }

  const highestGeneration = snapshot.attempts.reduce(
    (highest, attempt) => Math.max(highest, attempt.generation),
    -1,
  );
  const generation = integerUnit(highestGeneration + 1, "Quantity");
  return {
    kind: "SUBMIT",
    closeLifecycleId: lifecycleId,
    attemptId: closeAttemptId(lifecycleId, generation),
    generation,
    quantity: snapshot.currentExposureQuantity,
  };
}

export function classifyDuplicateSubmission(clientOrderId: string): { readonly kind: "ADOPT"; readonly clientOrderId: string } {
  return { kind: "ADOPT", clientOrderId };
}
