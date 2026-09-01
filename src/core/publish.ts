// Pure publication core (P6: S-J-07 candidate/probe/promotion/rollback,
// S-J-08 branch isolation, S-CYC-07 push retry). The shell pushes, deploys,
// probes, and promotes; what a probe must show, whether a candidate may move
// the stable alias, when the prior accepted deployment is restored, which ref
// a push may target, and whether a push is due are decided here. Deployment
// receipts are keyed by journal revision and live outside the trading journal,
// so acceptance never creates a recursive journal revision.
import type { CutoffKind } from "./projection.js";

/** What the rendered page must state about itself (S-J-07): the probe compares these, nothing less. */
export interface PublishExpectation {
  readonly journalRevision: string;
  readonly cutoffAt: string;
  readonly cutoffKind: CutoffKind;
  readonly lastUpdatedAt: string | null;
  readonly lastSeq: number | null;
}

/** The page's self-description as read by an anonymous probe: the `glass-box-*` meta tags. */
export type ProbeObservation =
  | { readonly ok: true; readonly httpStatus: number; readonly meta: Readonly<Record<string, string>>; readonly authenticated: boolean }
  | { readonly ok: false; readonly error: string };

export type ProbeVerdict = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

export function probeMetaNames(): readonly string[] {
  return ["glass-box-journal-revision", "glass-box-evidence-cutoff", "glass-box-evidence-cutoff-kind", "glass-box-last-updated", "glass-box-last-seq"];
}

/** The meta tags a page must carry for the expectation. Used by the renderer and by the probe symmetrically. */
export function expectedMeta(expectation: PublishExpectation): Readonly<Record<string, string>> {
  return {
    "glass-box-journal-revision": expectation.journalRevision,
    "glass-box-evidence-cutoff": expectation.cutoffAt,
    "glass-box-evidence-cutoff-kind": expectation.cutoffKind,
    "glass-box-last-updated": expectation.lastUpdatedAt ?? "none",
    "glass-box-last-seq": expectation.lastSeq === null ? "none" : String(expectation.lastSeq),
  };
}

/** The anonymous probe contract: reachable without credentials, HTTP 200, every expected self-description equal. */
export function verifyProbe(expectation: PublishExpectation, observation: ProbeObservation): ProbeVerdict {
  if (!observation.ok) return { ok: false, reasons: [`PROBE_FAILED: ${observation.error}`] };
  const reasons: string[] = [];
  if (observation.authenticated) reasons.push("PROBE_REQUIRED_AUTHENTICATION");
  if (observation.httpStatus !== 200) reasons.push(`PROBE_HTTP_${String(observation.httpStatus)}`);
  const expected = expectedMeta(expectation);
  for (const name of probeMetaNames()) {
    const want = expected[name];
    const got = observation.meta[name];
    if (got === undefined) reasons.push(`META_MISSING: ${name}`);
    else if (got !== want) reasons.push(`META_MISMATCH: ${name} expected ${String(want)} observed ${got}`);
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

export interface DeploymentReceipt {
  readonly journalRevision: string;
  readonly cutoffAt: string;
  readonly cutoffKind: CutoffKind;
  readonly candidateUrl: string;
  readonly deployedAt: string;
  readonly probedAt: string;
  readonly accepted: boolean;
  readonly promotedAt: string | null;
  readonly reasons: readonly string[];
}

export interface DeploymentState {
  /** The receipt currently behind the stable alias, or null before the first promotion. */
  readonly stable: DeploymentReceipt | null;
  /** Every receipt ever written, oldest first; never rewritten. */
  readonly receipts: readonly DeploymentReceipt[];
}

export function emptyDeploymentState(): DeploymentState {
  return { stable: null, receipts: [] };
}

export interface CandidateDeployment {
  readonly expectation: PublishExpectation;
  readonly candidateUrl: string;
  readonly deployedAt: string;
  readonly probedAt: string;
}

export type PromotionPlan =
  | { readonly kind: "promote"; readonly receipt: DeploymentReceipt }
  | { readonly kind: "reject"; readonly receipt: DeploymentReceipt };

/** A candidate moves the alias only on a clean probe; a failed or mismatched probe never does (S-J-07, A26). */
export function planPromotion(candidate: CandidateDeployment, verdict: ProbeVerdict, nowIso: string): PromotionPlan {
  const base = {
    journalRevision: candidate.expectation.journalRevision,
    cutoffAt: candidate.expectation.cutoffAt,
    cutoffKind: candidate.expectation.cutoffKind,
    candidateUrl: candidate.candidateUrl,
    deployedAt: candidate.deployedAt,
    probedAt: candidate.probedAt,
  };
  if (verdict.ok) return { kind: "promote", receipt: { ...base, accepted: true, promotedAt: nowIso, reasons: [] } };
  return { kind: "reject", receipt: { ...base, accepted: false, promotedAt: null, reasons: verdict.reasons } };
}

export type StableVerificationPlan =
  | { readonly kind: "keep" }
  | { readonly kind: "rollback"; readonly to: DeploymentReceipt; readonly reasons: readonly string[] }
  | { readonly kind: "no_prior_accepted"; readonly reasons: readonly string[] };

/**
 * After promotion the stable origin is probed against the same expectation.
 * A failure restores the immediately previous accepted deployment and raises
 * the active fail-signal; with no prior acceptance there is nothing to
 * restore, and the alarm carries that.
 */
export function planStableVerification(state: DeploymentState, verdict: ProbeVerdict): StableVerificationPlan {
  if (verdict.ok) return { kind: "keep" };
  const previous = [...state.receipts].reverse().find(receipt => receipt.accepted && receipt.promotedAt !== null && receipt.candidateUrl !== state.stable?.candidateUrl);
  if (previous === undefined) return { kind: "no_prior_accepted", reasons: verdict.reasons };
  return { kind: "rollback", to: previous, reasons: verdict.reasons };
}

export function stateAfterPromotion(state: DeploymentState, plan: PromotionPlan): DeploymentState {
  return { stable: plan.kind === "promote" ? plan.receipt : state.stable, receipts: [...state.receipts, plan.receipt] };
}

export function stateAfterStableVerification(state: DeploymentState, plan: StableVerificationPlan, nowIso: string): DeploymentState {
  if (plan.kind !== "rollback") return state;
  const restored: DeploymentReceipt = { ...plan.to, probedAt: nowIso, promotedAt: nowIso, reasons: [`ROLLBACK: ${plan.reasons.join("; ")}`] };
  return { stable: restored, receipts: [...state.receipts, restored] };
}

/** The receipt for one journal revision and cutoff kind, or null when that revision never reached a candidate. */
export function receiptFor(state: DeploymentState, journalRevision: string, cutoffKind: CutoffKind): DeploymentReceipt | null {
  return [...state.receipts].reverse().find(receipt => receipt.journalRevision === journalRevision && receipt.cutoffKind === cutoffKind) ?? null;
}

// ---------------------------------------------------------------------------
// S-J-08 — the journal writer pushes to the configured journal branch and refuses every other ref
// ---------------------------------------------------------------------------

export type PushTargetVerdict = { readonly ok: true; readonly ref: string } | { readonly ok: false; readonly reason: string };

/** Exact byte equality against the configured journal ref; a lookalike (`journal/`, `refs/heads/journal`, case) is refused. */
export function checkPushTarget(configuredJournalRef: string, requestedRef: string): PushTargetVerdict {
  if (configuredJournalRef.length === 0) return { ok: false, reason: "JOURNAL_REF_NOT_CONFIGURED" };
  if (requestedRef !== configuredJournalRef) return { ok: false, reason: `PUSH_REF_REFUSED: requested '${requestedRef}' is not the configured journal ref '${configuredJournalRef}'` };
  return { ok: true, ref: requestedRef };
}

export function pushRefusalDraft(context: { readonly atIso: string; readonly epoch: number }, verdict: { readonly ok: false; readonly reason: string }, requestedRef: string, configuredJournalRef: string): { readonly at: string; readonly epoch: number; readonly type: "RECONCILIATION"; readonly reasonCodes: readonly []; readonly items: readonly Readonly<Record<string, unknown>>[] } {
  return { at: context.atIso, epoch: context.epoch, type: "RECONCILIATION", reasonCodes: [], items: [{ kind: "journal_push_refused", requestedRef, configuredJournalRef, reason: verdict.reason }] };
}

// ---------------------------------------------------------------------------
// S-CYC-07 — push failure never blocks trading or journaling; the next invocation retries
// ---------------------------------------------------------------------------

export interface PushState {
  readonly lastPushedRevision: string | null;
  readonly lastPushedAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastAttemptAt: string | null;
}

export function emptyPushState(): PushState {
  return { lastPushedRevision: null, lastPushedAt: null, consecutiveFailures: 0, lastError: null, lastAttemptAt: null };
}

export type PushPlan = { readonly kind: "push"; readonly revision: string } | { readonly kind: "skip"; readonly reason: "ALREADY_PUSHED" | "NO_REVISION" };

/** A push is due whenever the head revision differs from the last pushed one; a failed earlier push is simply retried. */
export function planPush(state: PushState, headRevision: string | null): PushPlan {
  if (headRevision === null) return { kind: "skip", reason: "NO_REVISION" };
  if (state.lastPushedRevision === headRevision) return { kind: "skip", reason: "ALREADY_PUSHED" };
  return { kind: "push", revision: headRevision };
}

export type PushOutcome = { readonly ok: true; readonly revision: string } | { readonly ok: false; readonly error: string };

export function pushStateAfter(state: PushState, outcome: PushOutcome, nowIso: string): PushState {
  if (outcome.ok) return { lastPushedRevision: outcome.revision, lastPushedAt: nowIso, consecutiveFailures: 0, lastError: null, lastAttemptAt: nowIso };
  return { ...state, consecutiveFailures: state.consecutiveFailures + 1, lastError: outcome.error, lastAttemptAt: nowIso };
}

export interface PublishDegradation {
  readonly degraded: boolean;
  readonly explanation: string;
}

/** What the page says about its own publication when the push pipeline is failing (S-CYC-07, A9): lag is disclosed, content stays true. */
export function publishDegradation(state: PushState, headRevision: string | null): PublishDegradation {
  if (state.consecutiveFailures > 0) {
    return { degraded: true, explanation: `publishing degraded: ${String(state.consecutiveFailures)} consecutive push failure(s), last error '${state.lastError ?? "unknown"}' at ${state.lastAttemptAt ?? "unknown"}; last pushed revision ${state.lastPushedRevision ?? "none"}; this page was rendered from ${headRevision ?? "no revision"} and may be newer than the public alias` };
  }
  return { degraded: false, explanation: "publishing healthy: the last push succeeded" };
}
