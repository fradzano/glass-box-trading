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
  const structureIdentity = candidate.legs
    .map(optionLeg => [
      encodeIdentityPart(optionLeg.contractId),
      optionLeg.side,
      String(optionLeg.ratio),
    ].join("."))
    .sort()
    .join("|");
  return `entry:${snapshot.tradingDay}:${String(snapshot.cycleIndex)}:${structureIdentity}`;
}

function encodeIdentityPart(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
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
  const invalidQuantity = !Number.isSafeInteger(snapshot.currentExposureQuantity)
    || snapshot.currentExposureQuantity < 0
    || snapshot.attempts.some(attempt => !Number.isSafeInteger(attempt.generation)
      || attempt.generation < 0
      || !Number.isSafeInteger(attempt.requestedQuantity)
      || attempt.requestedQuantity < 0
      || !Number.isSafeInteger(attempt.filledQuantity)
      || attempt.filledQuantity < 0
      || attempt.filledQuantity > attempt.requestedQuantity);
  if (invalidQuantity) {
    return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle contains an invalid quantity" };
  }
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
  if (highestGeneration >= Number.MAX_SAFE_INTEGER) {
    return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close attempt generation is exhausted" };
  }
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
