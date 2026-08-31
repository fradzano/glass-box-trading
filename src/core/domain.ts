declare const integerBrand: unique symbol;

export type IntegerUnit<Name extends string> = number & {
  readonly [integerBrand]: Name;
};

export type MoneyCents = IntegerUnit<"MoneyCents">;
export type OptionPriceCents = IntegerUnit<"OptionPriceCents">;
export type StrikeCents = IntegerUnit<"StrikeCents">;
export type BasisPoints = IntegerUnit<"BasisPoints">;
export type EpochMilliseconds = IntegerUnit<"EpochMilliseconds">;
export type Quantity = IntegerUnit<"Quantity">;

declare const lotBrand: unique symbol;

/** A positive lot count: candidate quantities and leg ratios are never zero. Only `lotCount` constructs it. */
export type LotCount = number & {
  readonly [lotBrand]: "LotCount";
};

export function lotCount(value: number): LotCount {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("LotCount must be a safe integer");
  }
  if (value < 1) {
    throw new RangeError("LotCount must be at least one");
  }
  return value as LotCount;
}

export function integerUnit<Name extends string>(value: number, name: Name): IntegerUnit<Name> {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
  return value as IntegerUnit<Name>;
}

export type Sleeve = "income" | "convex";
export type OptionRight = "call" | "put";
export type LegSide = "buy" | "sell";
export type EntryLimitKind = "debit" | "credit";

export interface OptionLeg {
  readonly contractId: string;
  readonly underlying: string;
  readonly expiry: string;
  readonly strikeCents: StrikeCents;
  readonly right: OptionRight;
  readonly side: LegSide;
  readonly ratio: LotCount;
}

export interface EntryCandidate {
  readonly candidateId: string;
  readonly declaredStructureType: string;
  readonly sleeve: Sleeve;
  readonly quantity: LotCount;
  readonly remainingTradingSessions: Quantity;
  readonly rationale: string;
  readonly entryLimit: {
    readonly kind: EntryLimitKind;
    readonly priceCents: OptionPriceCents;
  };
  readonly legs: readonly OptionLeg[];
}

export interface OptionContract {
  readonly contractId: string;
  readonly underlying: string;
  readonly expiry: string;
  readonly strikeCents: StrikeCents;
  readonly right: OptionRight;
}

export interface OptionQuote {
  readonly bidCents: OptionPriceCents;
  readonly askCents: OptionPriceCents;
  readonly bidSize: Quantity;
  readonly askSize: Quantity;
  readonly quotedAt: EpochMilliseconds;
}

export type OpenEntryState = "intent" | "fillable" | "confirmation_unclear";
export type ReleasedEntryState = "rejected" | "canceled" | "expired";
export type EntryReservationState = OpenEntryState | "filled" | ReleasedEntryState;

/**
 * Exposure risk is represented exactly once per truth: a filled entry is a
 * `filled` position component and never an `entry` component in a "filled"
 * state. Released entry states carry no risk; every other entry state counts.
 */
export type ExposureRiskComponent =
  | { readonly kind: "filled"; readonly maxLossCents: MoneyCents }
  | { readonly kind: "entry"; readonly state: OpenEntryState | ReleasedEntryState; readonly maxLossCents: MoneyCents }
  | { readonly kind: "exit"; readonly state: EntryReservationState; readonly maxLossCents: MoneyCents };

export interface ExposureLifecycle {
  readonly exposureLifecycleId: string;
  readonly underlying: string;
  readonly sleeve: Sleeve;
  readonly risk: readonly ExposureRiskComponent[];
}

export interface PriorQuoteSample {
  readonly observedAt: EpochMilliseconds;
  readonly quotesByContract: Readonly<Record<string, OptionQuote>>;
}

export interface DecisionSnapshot {
  readonly accountId: string;
  readonly profile: "dev" | "competition";
  readonly cashCents: MoneyCents;
  readonly equityCents: MoneyCents;
  readonly exposureLifecycles: readonly ExposureLifecycle[];
  readonly halt: boolean;
  readonly calendar: {
    readonly isTradingDay: boolean;
    readonly opensAt: EpochMilliseconds;
    readonly closesAt: EpochMilliseconds;
  };
  readonly quotesByContract: Readonly<Record<string, OptionQuote>>;
  readonly priorQuotesByUnderlying: Readonly<Record<string, PriorQuoteSample>>;
  readonly spotCentsByUnderlying: Readonly<Record<string, StrikeCents>>;
  readonly contractsById: Readonly<Record<string, OptionContract>>;
  readonly submittedOrderIds: readonly string[];
  readonly tradingDay: string;
  readonly cycleIndex: Quantity;
  readonly snapshotAt: EpochMilliseconds;
}

export interface DecisionConfig {
  readonly incomeBudgetCents: MoneyCents;
  readonly convexBudgetCents: MoneyCents;
  readonly maxLossPerPositionBps: BasisPoints;
  readonly maxUnderlyingExposureCents: MoneyCents;
  readonly maxRelativeSpreadBps: BasisPoints;
  readonly minQuoteSize: Quantity;
  readonly quoteMaxAgeMs: EpochMilliseconds;
  readonly snapshotStalenessBoundMs: EpochMilliseconds;
  readonly cycleIntervalMs: EpochMilliseconds;
  readonly underlyingUniverse: readonly string[];
  readonly structureWhitelist: readonly string[];
  readonly expiryMinSessions: Quantity;
  readonly expiryMaxSessions: Quantity;
  readonly maxStrikeDistanceBps: BasisPoints;
  readonly maxCandidateQuantity: Quantity;
}

export type AnalystBatch =
  | { readonly kind: "candidates"; readonly candidates: readonly EntryCandidate[] }
  | { readonly kind: "structural_failure"; readonly issue: string };

export type GateName = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";

export interface GateVerdict {
  readonly gate: GateName;
  readonly passed: boolean;
  readonly code:
    | "PASS"
    | "DEFINED_RISK"
    | "BUDGET"
    | "POSITION_SIZE"
    | "CONCENTRATION"
    | "LIQUIDITY"
    | "SESSION"
    | "IDEMPOTENCY"
    | "WHITELIST"
    | "UNKNOWN_CONTRACT"
    | "SLEEVE_MISMATCH";
  readonly reasons: readonly string[];
}

export interface CandidateVerdict {
  readonly candidateId: string;
  readonly candidateRationale: string;
  readonly decision: "PASS" | "VETO";
  readonly reservedMaxLossCents: MoneyCents | null;
  readonly gateVector: readonly GateVerdict[];
}

export interface EntryActionPlan {
  readonly kind: "ENTRY_ACTION_PLAN";
  readonly candidateId: string;
  readonly exposureLifecycleId: string;
  readonly clientOrderId: string;
  readonly sleeve: Sleeve;
  readonly underlying: string;
  readonly submittedLimit: EntryCandidate["entryLimit"];
  readonly reservedMaxLossCents: MoneyCents;
  readonly legs: readonly OptionLeg[];
  readonly quantity: LotCount;
}

export interface DecisionResult {
  readonly batchVerdicts: readonly ({ readonly code: "STALE_SNAPSHOT" | "SCHEMA_VETO" | "HALT"; readonly reason: string })[];
  readonly candidateVerdicts: readonly CandidateVerdict[];
  readonly actions: readonly EntryActionPlan[];
}

export type CloseRoute = "ordinary" | "emergency" | "expiry" | "kill" | "watchdog";
export type CloseAttemptState = "new" | "accepted" | "partially_filled" | "confirmation_unclear" | "filled" | "rejected" | "canceled" | "expired";

export interface CloseAttemptSnapshot {
  readonly attemptId: string;
  readonly generation: Quantity;
  readonly requestedQuantity: Quantity;
  readonly filledQuantity: Quantity;
  readonly state: CloseAttemptState;
}

export interface CloseLifecycleSnapshot {
  readonly exposureLifecycleId: string;
  readonly route: CloseRoute;
  readonly currentExposureQuantity: Quantity;
  readonly attempts: readonly CloseAttemptSnapshot[];
}

export type CloseLifecyclePlan =
  | { readonly kind: "COMPLETE"; readonly closeLifecycleId: string }
  | { readonly kind: "ADOPT"; readonly closeLifecycleId: string; readonly attemptId: string; readonly remainingExposureQuantity: Quantity }
  | { readonly kind: "SUBMIT"; readonly closeLifecycleId: string; readonly attemptId: string; readonly generation: Quantity; readonly quantity: Quantity }
  | { readonly kind: "VETO"; readonly closeLifecycleId: string; readonly reason: string };
