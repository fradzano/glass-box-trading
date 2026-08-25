import type { AnalystBatch, DecisionConfig, DecisionResult, DecisionSnapshot, EntryCandidate, ExposureRiskComponent, MoneyCents, OptionPriceCents, Quantity } from "./domain.js";

export function decide(
  _snapshot: DecisionSnapshot,
  _batch: AnalystBatch,
  _config: DecisionConfig,
  _now: number,
): DecisionResult {
  throw new Error("Not implemented");
}

export function parseAnalystOutput(_raw: string): AnalystBatch {
  throw new Error("Not implemented");
}

export function reconcilePartialFillRisk(
  _candidate: EntryCandidate,
  _filledQuantity: Quantity,
  _averageFillPriceCents: OptionPriceCents,
  _remainingQuantity: Quantity,
): { readonly components: readonly ExposureRiskComponent[]; readonly totalMaxLossCents: MoneyCents } {
  throw new Error("Not implemented");
}
