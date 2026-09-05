// Pure writer-authority core (S-G12-01/02/07, S-J-06): epoch acquisition
// planning, the compare-and-increment decision, request authorization at the
// single final gateway, the takeover trigger, the scheduling-bound check, and
// account binding. No clock: heartbeat ages and timestamps arrive as inputs.
// Authority is the control epoch and nothing else; the OS lock and elapsed
// time never appear in `authorizeMutation`.

import { isWitnessEntryType } from "./journal.js";
import type { AccountBinding, JournalEntry } from "./journal.js";

export type EpochStoreState =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly detail: string }
  | {
    readonly kind: "present";
    readonly epoch: number;
    /** The instance that acquired this epoch; only it may dispatch authoritative requests under it. */
    readonly holderId: string;
    readonly acquiredAt: string;
    /** True from a virgin seed until the BOOTSTRAP entry lands; persisted so a restart cannot forget it (G1-F2). */
    readonly seedPending: boolean;
    /**
     * True while a reset acquisition is pending: the store exists, but the GAP/HALT pair has not been promoted yet.
     * A pending epoch authorizes nothing; acquisition completes the pair (once) and promotes it (G5-F1).
     */
    readonly resetPending: boolean;
    /**
     * S-G12-08 / A30: a credential fence was detected and may or may not have
     * reached the journal. It is set BEFORE the HALT append is attempted and
     * cleared by exactly one thing, a human un-halt, so neither a later
     * successful append nor a journaled UNHALT from an earlier incident can
     * undo it. It lives here rather than in the halt projection because the
     * journal is authoritative for the projection: a prior HALT/UNHALT pair
     * would otherwise overrule a fence that could not be journaled.
     */
    readonly fencePending: boolean;
    /** Why the durable stop was recorded, when it is known. Free text from the halt reason (S-G12-08). */
    readonly fenceReason?: string | null;
  };

export type AccountVirginity = "virgin" | "non_virgin" | "unknown";

export interface AcquisitionEvidence {
  readonly account: AccountVirginity;
  readonly journalEmpty: boolean;
}

export type AcquisitionPlan =
  | { readonly kind: "SEED_BOOTSTRAP"; readonly epoch: 1 }
  | { readonly kind: "SEED_GAP"; readonly epoch: 1; readonly haltReason: "EPOCH_STORE_RESET" }
  | { readonly kind: "INCREMENT"; readonly expected: number; readonly next: number; /** inherited from the store: the seed is still unjournaled (G2-F1) */ readonly seedPending: boolean; /** inherited from the store: a reset pair still has to be completed and promoted (G5-F1) */ readonly resetPending: boolean; /** inherited from the store: an unreleased credential fence survives every acquisition, or a restart would clear it (S-G12-08) */ readonly fencePending: boolean }
  | { readonly kind: "REFUSE"; readonly reason: "EPOCH_UNREADABLE" | "EPOCH_EXHAUSTED" };

/**
 * An absent store is re-seeded silently only in the virgin bootstrap state
 * (virgin account AND empty journal); every other absence is a reset and
 * takes the GAP path with halt (S-G12-07, S-CYC-09). An unreadable store
 * refuses. A present store is taken over by compare-and-increment.
 */
export function planEpochAcquisition(store: EpochStoreState, evidence: AcquisitionEvidence): AcquisitionPlan {
  switch (store.kind) {
    case "unreadable":
      return { kind: "REFUSE", reason: "EPOCH_UNREADABLE" };
    case "absent":
      return evidence.account === "virgin" && evidence.journalEmpty
        ? { kind: "SEED_BOOTSTRAP", epoch: 1 }
        : { kind: "SEED_GAP", epoch: 1, haltReason: "EPOCH_STORE_RESET" };
    case "present":
      if (store.epoch >= Number.MAX_SAFE_INTEGER) return { kind: "REFUSE", reason: "EPOCH_EXHAUSTED" };
      return { kind: "INCREMENT", expected: store.epoch, next: store.epoch + 1, seedPending: store.seedPending, resetPending: store.resetPending, fencePending: store.fencePending };
  }
}

export type CompareAndIncrement =
  | { readonly kind: "COMMIT"; readonly next: number }
  | { readonly kind: "CHANGED"; readonly observed: number | null }
  | { readonly kind: "REFUSE"; readonly reason: "EPOCH_UNREADABLE" | "EPOCH_EXHAUSTED" };

/** Of two concurrent takers exactly one sees its expected epoch; the other observes the change and demotes itself. */
export function compareAndIncrement(current: EpochStoreState, expected: number): CompareAndIncrement {
  switch (current.kind) {
    case "unreadable":
      return { kind: "REFUSE", reason: "EPOCH_UNREADABLE" };
    case "absent":
      return { kind: "CHANGED", observed: null };
    case "present":
      if (current.epoch !== expected) return { kind: "CHANGED", observed: current.epoch };
      if (current.epoch >= Number.MAX_SAFE_INTEGER) return { kind: "REFUSE", reason: "EPOCH_EXHAUSTED" };
      return { kind: "COMMIT", next: current.epoch + 1 };
  }
}

export type GatewayAction =
  | { readonly kind: "journal_append"; readonly entryType: string }
  | { readonly kind: "broker_mutation" };

export type AuthorityRequest =
  | { readonly class: "authoritative"; readonly epoch: number | null; readonly action: GatewayAction }
  | { readonly class: "witness"; readonly action: GatewayAction };

export type AuthorizationFailure =
  | "EPOCH_REQUIRED"
  | "EPOCH_ABSENT"
  | "EPOCH_UNREADABLE"
  | "STALE_EPOCH"
  | "RESET_PENDING"
  | "AUTHORITATIVE_TYPE_REQUIRED"
  | "WITNESS_TYPE_REQUIRED"
  | "WITNESS_CANNOT_MUTATE_BROKER";

export type Authorization = { readonly authorized: true } | { readonly authorized: false; readonly reason: AuthorizationFailure };

/**
 * The single authorization rule. Authoritative requests need the exact
 * current epoch; witness requests need no authority but may only append a
 * witness-class entry and can never reach the broker (S-G12-07).
 */
export function authorizeMutation(request: AuthorityRequest, store: EpochStoreState): Authorization {
  if (request.class === "witness") {
    if (request.action.kind === "broker_mutation") return { authorized: false, reason: "WITNESS_CANNOT_MUTATE_BROKER" };
    if (!isWitnessEntryType(request.action.entryType)) return { authorized: false, reason: "WITNESS_TYPE_REQUIRED" };
    return { authorized: true };
  }
  if (request.action.kind === "journal_append" && isWitnessEntryType(request.action.entryType)) return { authorized: false, reason: "AUTHORITATIVE_TYPE_REQUIRED" };
  if (request.epoch === null || !Number.isSafeInteger(request.epoch) || request.epoch < 1) return { authorized: false, reason: "EPOCH_REQUIRED" };
  switch (store.kind) {
    case "unreadable":
      return { authorized: false, reason: "EPOCH_UNREADABLE" };
    case "absent":
      return { authorized: false, reason: "EPOCH_ABSENT" };
    case "present":
      if (store.epoch !== request.epoch) return { authorized: false, reason: "STALE_EPOCH" };
      if (store.resetPending) return { authorized: false, reason: "RESET_PENDING" };
      return { authorized: true };
  }
}

/** The reset pair is durable when the journal ends in a GAP followed by a HALT with reason EPOCH_STORE_RESET (G5-F1). */
export function resetPairPresent(entries: readonly JournalEntry[]): boolean {
  const halt = entries.at(-1);
  const gap = entries.at(-2);
  return halt !== undefined && gap !== undefined && gap.type === "GAP" && halt.type === "HALT" && halt["reason"] === "EPOCH_STORE_RESET";
}

/** A stale heartbeat is only the trigger to attempt a takeover; it grants nothing (S-G12-02). */
export function shouldAttemptTakeover(heartbeatAgeMs: number, lockTakeoverBoundMs: number): boolean {
  return Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs > lockTakeoverBoundMs;
}

export interface SchedulingBounds {
  readonly lockTakeoverBoundMs: number;
  readonly cycleWalltimeBudgetMs: number;
  readonly cycleIntervalMs: number;
  readonly deadManBoundMs: number;
}

export type SchedulingViolation =
  | "BOUNDS_NOT_POSITIVE_INTEGERS"
  | "LOCK_TAKEOVER_BOUND_NOT_ABOVE_CYCLE_WALLTIME_BUDGET"
  | "TAKEOVER_DOES_NOT_FIT_DEAD_MAN_BOUND";

/** The S-G12-02 inequalities: scheduling constraints that size the timers, never an authority mechanism. */
export function validateSchedulingBounds(bounds: SchedulingBounds): { readonly ok: true } | { readonly ok: false; readonly violations: readonly SchedulingViolation[] } {
  const values = [bounds.lockTakeoverBoundMs, bounds.cycleWalltimeBudgetMs, bounds.cycleIntervalMs, bounds.deadManBoundMs];
  if (!values.every(value => Number.isSafeInteger(value) && value > 0)) return { ok: false, violations: ["BOUNDS_NOT_POSITIVE_INTEGERS"] };
  const violations: SchedulingViolation[] = [];
  if (!(bounds.lockTakeoverBoundMs > bounds.cycleWalltimeBudgetMs)) violations.push("LOCK_TAKEOVER_BOUND_NOT_ABOVE_CYCLE_WALLTIME_BUDGET");
  const takeoverWindow = BigInt(bounds.lockTakeoverBoundMs) + 2n * (BigInt(bounds.cycleIntervalMs) + BigInt(bounds.cycleWalltimeBudgetMs));
  if (takeoverWindow > BigInt(bounds.deadManBoundMs)) violations.push("TAKEOVER_DOES_NOT_FIT_DEAD_MAN_BOUND");
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export interface BindingConfig {
  /** `ALPACA_TRADING_ORIGIN` from §0 — a configuration input, never a literal inside the core. */
  readonly canonicalTradingOrigin: string;
  /** `EXPECTED_ACCOUNT_ID` — configured separately from profile and credentials (S-J-06). */
  readonly expectedAccountId: string | undefined;
}

export interface BindingObservation {
  readonly profile: string;
  readonly requestedOrigin: string;
  /** The origin actually reached after any redirect, as observed by the shell. */
  readonly observedOrigin: string;
  readonly brokerReportedAccountId: string | undefined;
}

export type BindingFailure =
  | "UNKNOWN_PROFILE"
  | "CONFIG_INVALID_EXPECTED_ACCOUNT_ID"
  | "CONFIG_INVALID_TRADING_ORIGIN"
  | "ORIGIN_NOT_CANONICAL"
  | "ORIGIN_REDIRECTED"
  | "ACCOUNT_ID_MISMATCH";

export type BindingResult = { readonly ok: true; readonly binding: AccountBinding } | { readonly ok: false; readonly reason: BindingFailure };

function isLowercaseHostChar(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e;
}

/** `https://` + a lowercase ASCII host and nothing else: no port, path, query, fragment, userinfo, or whitespace. */
export function isCanonicalOriginShape(origin: string): boolean {
  const scheme = "https://";
  if (!origin.startsWith(scheme) || origin.length === scheme.length) return false;
  const host = origin.slice(scheme.length);
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..") || !host.includes(".")) return false;
  for (let index = 0; index < host.length; index += 1) if (!isLowercaseHostChar(host.charCodeAt(index))) return false;
  return true;
}

/** The paper trading host: the canonical origin's host begins with `paper-`. The one place that decides it. */
export function isPaperTradingHost(origin: string): boolean {
  return origin.slice("https://".length).startsWith("paper-");
}

/**
 * Binds the closed triplet {profile, canonical paper trading origin, expected
 * account ID} from two independent sources: the configured expectation and
 * the broker's own report. Every mismatch class fails closed (S-J-06, A24).
 */
export function bindAccount(config: BindingConfig, observation: BindingObservation): BindingResult {
  if (observation.profile !== "dev" && observation.profile !== "competition") return { ok: false, reason: "UNKNOWN_PROFILE" };
  const expected = config.expectedAccountId;
  if (expected === undefined || expected.trim().length === 0) return { ok: false, reason: "CONFIG_INVALID_EXPECTED_ACCOUNT_ID" };
  if (!isCanonicalOriginShape(config.canonicalTradingOrigin) || !isPaperTradingHost(config.canonicalTradingOrigin)) return { ok: false, reason: "CONFIG_INVALID_TRADING_ORIGIN" };
  if (observation.requestedOrigin !== config.canonicalTradingOrigin) return { ok: false, reason: "ORIGIN_NOT_CANONICAL" };
  if (observation.observedOrigin !== observation.requestedOrigin) return { ok: false, reason: "ORIGIN_REDIRECTED" };
  const reported = observation.brokerReportedAccountId;
  if (reported === undefined || reported.length === 0 || reported !== expected) return { ok: false, reason: "ACCOUNT_ID_MISMATCH" };
  return { ok: true, binding: { profile: observation.profile, tradingOrigin: config.canonicalTradingOrigin, accountId: expected } };
}

/** Market-data origins are a separate allowlist; membership grants no order capability (S-J-06). */
export function isAllowedMarketDataOrigin(origin: string, allowlist: readonly string[]): boolean {
  return isCanonicalOriginShape(origin) && allowlist.includes(origin);
}

export function bindingsEqual(left: AccountBinding, right: AccountBinding): boolean {
  return left.profile === right.profile && left.tradingOrigin === right.tradingOrigin && left.accountId === right.accountId;
}
