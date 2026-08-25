import type { CloseLifecyclePlan, CloseLifecycleSnapshot, CloseRoute, DecisionSnapshot, EntryCandidate, Quantity } from "./domain.js";

export function entryClientOrderId(_snapshot: DecisionSnapshot, _candidate: EntryCandidate): string {
  throw new Error("Not implemented");
}

export function closeLifecycleId(_exposureLifecycleId: string, _route: CloseRoute): string {
  throw new Error("Not implemented");
}

export function closeAttemptId(_closeLifecycleId: string, _generation: Quantity): string {
  throw new Error("Not implemented");
}

export function planCloseLifecycle(_snapshot: CloseLifecycleSnapshot): CloseLifecyclePlan {
  throw new Error("Not implemented");
}

export function classifyDuplicateSubmission(_clientOrderId: string): { readonly kind: "ADOPT"; readonly clientOrderId: string } {
  throw new Error("Not implemented");
}
