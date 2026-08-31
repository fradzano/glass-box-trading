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

function isKnownCloseState(state: unknown): state is CloseAttemptSnapshot["state"] {
  return state === "new"
    || state === "accepted"
    || state === "partially_filled"
    || state === "confirmation_unclear"
    || state === "filled"
    || state === "rejected"
    || state === "canceled"
    || state === "expired";
}

function isActiveCloseState(state: CloseAttemptSnapshot["state"]): boolean {
  return state === "new"
    || state === "accepted"
    || state === "partially_filled"
    || state === "confirmation_unclear";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
  const attemptsValue: unknown = snapshot.attempts;
  if (!Number.isSafeInteger(snapshot.currentExposureQuantity) || snapshot.currentExposureQuantity < 0 || !Array.isArray(attemptsValue)) {
    return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
  }

  const seenGenerations = new Set<number>();
  const validatedAttempts: CloseAttemptSnapshot[] = [];
  for (const attemptValue of attemptsValue) {
    if (!isRecord(attemptValue)) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    const attemptId = attemptValue["attemptId"];
    const generation = attemptValue["generation"];
    const requestedQuantity = attemptValue["requestedQuantity"];
    const filledQuantity = attemptValue["filledQuantity"];
    const state = attemptValue["state"];
    if (typeof attemptId !== "string"
      || !isNonnegativeSafeInteger(generation)
      || seenGenerations.has(generation)
      || attemptId !== closeAttemptId(lifecycleId, integerUnit(generation, "Quantity"))
      || !isNonnegativeSafeInteger(requestedQuantity)
      || requestedQuantity === 0
      || !isNonnegativeSafeInteger(filledQuantity)
      || filledQuantity > requestedQuantity
      || !isKnownCloseState(state)) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    const attempt: CloseAttemptSnapshot = {
      attemptId,
      generation: integerUnit(generation, "Quantity"),
      requestedQuantity: integerUnit(requestedQuantity, "Quantity"),
      filledQuantity: integerUnit(filledQuantity, "Quantity"),
      state,
    };
    seenGenerations.add(attempt.generation);
    if ((attempt.state === "new" || attempt.state === "accepted" || attempt.state === "rejected") && attempt.filledQuantity !== 0) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    if (attempt.state === "partially_filled" && (attempt.filledQuantity === 0 || attempt.filledQuantity === attempt.requestedQuantity)) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    if (attempt.state === "filled" && attempt.filledQuantity !== attempt.requestedQuantity) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    if ((attempt.state === "canceled" || attempt.state === "expired") && attempt.filledQuantity === attempt.requestedQuantity) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    const remainingAttemptQuantity = attempt.requestedQuantity - attempt.filledQuantity;
    if (isActiveCloseState(attempt.state) && (remainingAttemptQuantity <= 0 || remainingAttemptQuantity > snapshot.currentExposureQuantity)) {
      return { kind: "VETO", closeLifecycleId: lifecycleId, reason: "close lifecycle snapshot is invalid" };
    }
    validatedAttempts.push(attempt);
  }
  const activeAttempts = validatedAttempts.filter(attempt => isActiveCloseState(attempt.state));

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

  const highestGeneration = validatedAttempts.reduce(
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
