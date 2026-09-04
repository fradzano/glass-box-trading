// Pure qualification core (P6: S-CYC-12). A qualifying options activity is a
// broker fill on the competition account joined to an ordinary core-approved
// entry INTENT and its OUTCOME. Dev activity, close and emergency orders,
// rejections, cancels, and unfilled orders never count. At the checkpoint the
// absence of such a fill is `COMPETITIVENESS_AT_RISK` (an internal winning
// signal, never a claim about external eligibility); until the window end the
// agent may run at most one live one-lot qualification lifecycle under the
// unchanged gates and a strictly lower loss cap; after the window the absence
// is `WINNING_ACCEPTANCE_FAILED`. The mode carries no gate parameter, so it
// structurally cannot widen tolerance, whitelist, expiry, liquidity, sleeve,
// or concentration bounds — it only adds vetoes.
import { utcIsoToEpochMs } from "./execution.js";
import type { EntryLifecycleRecord } from "./execution.js";
import type { JournalEntry, ReasonCode } from "./journal.js";

export interface QualificationConfig {
  /** `QUALIFYING_ACTIVITY_CHECKPOINT` (§0) as epoch milliseconds. */
  readonly checkpointMs: number;
  /** `QUALIFICATION_WINDOW_END` (§0) as epoch milliseconds. */
  readonly windowEndMs: number;
  /** `QUALIFICATION_MAX_LOSS_CENTS` (§0): strictly below every sleeve cap (validated at startup). */
  readonly maxLossCents: number;
}

export interface QualifyingFill {
  readonly clientOrderId: string;
  readonly exposureLifecycleId: string;
  readonly intentSeq: number;
  readonly outcomeSeq: number;
  readonly filledAt: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly sleeve: string;
}

export type QualificationState =
  | "NOT_APPLICABLE"
  | "NOT_DUE"
  | "QUALIFIED"
  | "COMPETITIVENESS_AT_RISK"
  | "WINNING_ACCEPTANCE_FAILED";

export interface QualificationProjection {
  readonly state: QualificationState;
  readonly fills: readonly QualifyingFill[];
  readonly checkpointMs: number | null;
  readonly windowEndMs: number | null;
  /** True while the bounded qualification window is open and no fill exists (the mode is active). */
  readonly windowOpen: boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every ordinary competition entry fill: an INTENT that is not a close, whose
 * binding names the competition profile, joined to a filled or partially
 * filled OUTCOME for the same client order ID. Order of the journal is the
 * order of the result.
 */
export function qualifyingFills(entries: readonly JournalEntry[]): readonly QualifyingFill[] {
  const intents = new Map<string, { readonly seq: number; readonly exposureLifecycleId: string; readonly sleeve: string }>();
  const fills: QualifyingFill[] = [];
  for (const entry of entries) {
    if (entry.type === "INTENT" && entry["action"] !== "close") {
      const binding = entry["binding"];
      const clientOrderId = entry["clientOrderId"];
      const exposureLifecycleId = entry["exposureLifecycleId"];
      const sleeve = entry["sleeve"];
      if (!isRecord(binding) || binding["profile"] !== "competition" || typeof clientOrderId !== "string" || typeof exposureLifecycleId !== "string" || typeof sleeve !== "string") continue;
      intents.set(clientOrderId, { seq: entry.seq, exposureLifecycleId, sleeve });
      continue;
    }
    if (entry.type !== "OUTCOME") continue;
    const clientOrderId = entry["clientOrderId"];
    const status = entry["status"];
    if (typeof clientOrderId !== "string" || (status !== "filled" && status !== "partially_filled")) continue;
    const intent = intents.get(clientOrderId);
    if (intent === undefined) continue;
    const filledQuantity = entry["filledQuantity"];
    const price = entry["avgFillPriceCents"];
    if (typeof filledQuantity !== "number" || filledQuantity < 1) continue;
    fills.push({
      clientOrderId,
      exposureLifecycleId: intent.exposureLifecycleId,
      intentSeq: intent.seq,
      outcomeSeq: entry.seq,
      filledAt: entry.at,
      filledQuantity,
      avgFillPriceCents: typeof price === "number" ? price : null,
      sleeve: intent.sleeve,
    });
  }
  return fills;
}

/** The S-CYC-12 state at one instant: the journal up to that instant, the configured checkpoint and window, the running profile. */
export function projectQualification(entries: readonly JournalEntry[], nowMs: number, config: QualificationConfig | null, profile: "dev" | "competition"): QualificationProjection {
  if (config === null || profile !== "competition") return { state: "NOT_APPLICABLE", fills: [], checkpointMs: null, windowEndMs: null, windowOpen: false };
  const fills = qualifyingFills(entries).filter(fill => {
    const ms = utcIsoToEpochMs(fill.filledAt);
    return ms !== null && ms <= nowMs;
  });
  if (fills.length > 0) return { state: "QUALIFIED", fills, checkpointMs: config.checkpointMs, windowEndMs: config.windowEndMs, windowOpen: false };
  if (nowMs < config.checkpointMs) return { state: "NOT_DUE", fills, checkpointMs: config.checkpointMs, windowEndMs: config.windowEndMs, windowOpen: false };
  if (nowMs < config.windowEndMs) return { state: "COMPETITIVENESS_AT_RISK", fills, checkpointMs: config.checkpointMs, windowEndMs: config.windowEndMs, windowOpen: true };
  return { state: "WINNING_ACCEPTANCE_FAILED", fills, checkpointMs: config.checkpointMs, windowEndMs: config.windowEndMs, windowOpen: false };
}

/** The reason codes a CYCLE carries for the projected state (S-J-03: labels inside entries, not extra types). */
export function qualificationReasonCodes(projection: QualificationProjection): readonly ReasonCode[] {
  if (projection.state === "COMPETITIVENESS_AT_RISK") return ["COMPETITIVENESS_AT_RISK"];
  if (projection.state === "WINNING_ACCEPTANCE_FAILED") return ["WINNING_ACCEPTANCE_FAILED"];
  return [];
}

/** A live qualification attempt: an entry lifecycle submitted but not yet terminal (intent, fillable, or unclear). */
export function liveEntryLifecycles(records: readonly EntryLifecycleRecord[]): readonly EntryLifecycleRecord[] {
  return records.filter(record => record.state === "intent" || record.state === "fillable" || record.state === "confirmation_unclear");
}

export type QualificationVetoCode = "QUALIFICATION_CAP" | "QUALIFICATION_ONE_LOT" | "QUALIFICATION_ONE_LIVE";

export interface QualificationVeto {
  readonly candidateId: string;
  readonly code: QualificationVetoCode;
  readonly reason: string;
}

export interface QualificationPlanView {
  readonly candidateId: string;
  readonly quantity: number;
  readonly reservedMaxLossCents: number;
}

/**
 * The window's additional vetoes, applied after the unchanged gate vector and
 * the lifecycle vetoes: one lot, reserved max loss at or below the
 * qualification cap, and at most one live attempt at a time (a plan already
 * accepted in this cycle counts as live for the next). Returns null when the
 * window is not open — the mode adds nothing outside it.
 */
export function qualificationEntryVeto(plan: QualificationPlanView, projection: QualificationProjection, config: QualificationConfig | null, liveCount: number): QualificationVeto | null {
  if (!projection.windowOpen || config === null) return null;
  if (liveCount > 0) return { candidateId: plan.candidateId, code: "QUALIFICATION_ONE_LIVE", reason: `qualification window: ${String(liveCount)} live attempt(s) already; at most one at a time` };
  if (plan.quantity !== 1) return { candidateId: plan.candidateId, code: "QUALIFICATION_ONE_LOT", reason: `qualification window: quantity ${String(plan.quantity)} exceeds the one-lot bound` };
  if (plan.reservedMaxLossCents > config.maxLossCents) return { candidateId: plan.candidateId, code: "QUALIFICATION_CAP", reason: `qualification window: reserved max loss ${String(plan.reservedMaxLossCents)} exceeds QUALIFICATION_MAX_LOSS ${String(config.maxLossCents)}` };
  return null;
}

/** The analyst-facing statement of the mode: a prioritisation hint plus the cap, never a gate parameter. */
export interface QualificationBrief {
  readonly active: boolean;
  readonly maxLossCents: number | null;
  readonly windowEndMs: number | null;
  /** The one-lot bound the core enforces on a qualification entry (S-CYC-12); stated to the analyst because it vetoed a passing five-lot candidate live on 2026-09-02. */
  readonly quantityBound: 1 | null;
}

export function qualificationBrief(projection: QualificationProjection, config: QualificationConfig | null): QualificationBrief {
  if (!projection.windowOpen || config === null) return { active: false, maxLossCents: null, windowEndMs: null, quantityBound: null };
  return { active: true, maxLossCents: config.maxLossCents, windowEndMs: config.windowEndMs, quantityBound: 1 };
}
