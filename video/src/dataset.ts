// The single frozen presentation-cutoff dataset (video/README.md): the
// pinned presentation route's projection.json plus a small meta file with
// the URLs the video names. Loaded once in calculateMetadata; every scene
// reads figures from it and never types one. The validation mirrors
// scripts/check-dataset.mjs (which runs before the bundler) so a placeholder
// or an unfrozen dataset fails inside the studio as well.
import { staticFile } from "remotion";

export interface GateResult {
  readonly gate: string;
  readonly passed: boolean;
  readonly code: string;
  readonly reasons: readonly string[];
}

/**
 * Two shapes share the journal's candidateVerdicts: the gate verdict (a
 * rationale, a reserved max loss and the full G1-G8 vector) and the post-gate
 * veto of the qualification window (a code and a reason, no vector).
 */
export interface CandidateVerdict {
  readonly candidateId: string;
  readonly candidateRationale?: string;
  readonly decision: string;
  readonly reservedMaxLossCents?: number;
  readonly gateVector?: readonly GateResult[];
  readonly code?: string;
  readonly reason?: string;
}

export interface CycleView {
  readonly seq: number;
  readonly at: string;
  readonly type: string;
  readonly tradingDay: string | null;
  readonly cycleIndex: number | null;
  readonly reasonCodes: readonly string[];
  readonly candidateVerdicts: readonly CandidateVerdict[];
  readonly result: "proposal" | "no_trade" | "bootstrap" | "gap" | "skip" | "witness";
  readonly intentSeqs: readonly number[];
  readonly equityCents: number | null;
}

export interface CloseLink {
  readonly attemptId: string;
  readonly route: string;
  readonly generation: number;
  readonly intentSeq: number | null;
  readonly outcomeSeq: number | null;
  readonly status: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
}

export interface LifecycleLink {
  readonly exposureLifecycleId: string;
  readonly clientOrderId: string;
  readonly sleeve: "income" | "convex";
  readonly underlying: string;
  readonly structureType: string;
  readonly intentSeq: number;
  readonly outcomeSeq: number | null;
  readonly resolution: "filled" | "resting" | "unresolved" | "released";
  readonly brokerOrderId: string | null;
  readonly approvedQuantity: number;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly limitKind: "debit" | "credit";
  readonly submittedLimitCents: number;
  readonly reservedMaxLossCents: number;
  readonly closes: readonly CloseLink[];
  readonly realizedCents: number;
  readonly unrealizedCents: number | null;
}

export interface SleeveAttribution {
  readonly realizedCents: number;
  readonly unrealizedCents: number | null;
  readonly budgetAtRiskCents: number;
  readonly lifecycleCount: number;
}

export interface Projection {
  readonly journalRevision: string;
  readonly cutoff: { readonly at: string; readonly kind: string };
  readonly lastUpdatedAt: string | null;
  readonly lastSeq: number | null;
  readonly accountId: string | null;
  readonly startEquityCents: number | null;
  readonly initialCapitalCents: number;
  readonly currentEquityCents: number | null;
  readonly currentCashCents: number | null;
  readonly pnlAbsoluteCents: number | null;
  readonly pnlBps: number | null;
  readonly realizedCents: number;
  readonly unrealizedCents: number | null;
  readonly unattributedCents: number | null;
  readonly discrepancies: readonly string[];
  readonly peakEquityCents: number | null;
  readonly maxDrawdownCents: number | null;
  readonly maxDrawdownBps: number | null;
  readonly sleeves: { readonly income: SleeveAttribution; readonly convex: SleeveAttribution };
  readonly flatState: "flat" | "not_flat" | "declared_expiry_hold" | "unknown";
  readonly lifecycles: readonly LifecycleLink[];
  readonly cycles: readonly CycleView[];
}

export interface Meta {
  readonly frozen: boolean;
  readonly datasetNote: string;
  readonly demoUrl: string;
  readonly presentationRouteUrl: string;
  readonly repositoryUrl: string;
  readonly accountId: string;
  readonly presentationCutoffAt: string;
  readonly corePath: string;
  readonly evidenceTestPath: string;
  /** A cycle seq to feature in scenes 3–5; null selects the first proposal cycle with a filled lifecycle. */
  readonly featuredCycleSeq: number | null;
  /** Screen recordings under public/captures/, by scene; null renders the data-driven stand-in (dev only). */
  readonly captures: Readonly<Record<"dashboardOpen" | "decisionCycle" | "gateVector" | "orderToOutcome" | "sourceAndTests", string | null>>;
}

export interface Dataset {
  readonly meta: Meta;
  readonly projection: Projection;
}

function walkStrings(value: unknown, at: string, visit: (text: string, at: string) => void): void {
  if (typeof value === "string") visit(value, at);
  else if (Array.isArray(value)) value.forEach((item, index) => { walkStrings(item, `${at}[${String(index)}]`, visit); });
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value as Record<string, unknown>)) walkStrings(item, `${at}.${key}`, visit);
}

/** Throws with every violation listed; the studio and the render both stop on the first call. */
export function validateDataset(dataset: Dataset): void {
  const failures: string[] = [];
  const { meta, projection } = dataset;
  walkStrings(meta, "meta", (text, at) => { if (text.includes("{{")) failures.push(`${at} still holds a placeholder: ${text}`); });
  if (projection.cutoff.kind !== "presentation") failures.push(`projection.cutoff.kind is ${projection.cutoff.kind}, expected "presentation"`);
  if (projection.cutoff.at !== meta.presentationCutoffAt) failures.push(`meta.presentationCutoffAt ${meta.presentationCutoffAt} differs from projection.cutoff.at ${projection.cutoff.at}`);
  if (projection.accountId !== meta.accountId) failures.push(`meta.accountId ${meta.accountId} differs from projection.accountId ${String(projection.accountId)}`);
  if (!meta.presentationRouteUrl.includes(`/revisions/${projection.journalRevision.replace(":", "-")}/presentation/`)) failures.push("meta.presentationRouteUrl does not name the pinned presentation route of this revision");
  for (const [name, value] of [["startEquityCents", projection.startEquityCents], ["currentEquityCents", projection.currentEquityCents], ["pnlAbsoluteCents", projection.pnlAbsoluteCents], ["pnlBps", projection.pnlBps]] as const) {
    if (value === null || !Number.isFinite(value)) failures.push(`projection.${name} is null; the video cannot state the result`);
  }
  if (failures.length > 0) throw new Error(`dataset invalid:\n${failures.map(line => `  - ${line}`).join("\n")}`);
}

export async function loadDataset(): Promise<Dataset> {
  const [meta, projection] = await Promise.all([
    fetch(staticFile("dataset/meta.json")).then(response => response.json() as Promise<Meta>),
    fetch(staticFile("dataset/projection.json")).then(response => response.json() as Promise<Projection>),
  ]);
  const dataset = { meta, projection };
  validateDataset(dataset);
  return dataset;
}

// ---- selectors: which journal facts the scenes show; pure over the dataset ----

export function featuredLifecycle(dataset: Dataset): LifecycleLink | null {
  const { meta, projection } = dataset;
  if (meta.featuredCycleSeq !== null) {
    const cycle = projection.cycles.find(candidate => candidate.seq === meta.featuredCycleSeq);
    const byIntent = cycle === undefined ? undefined : projection.lifecycles.find(lifecycle => cycle.intentSeqs.includes(lifecycle.intentSeq));
    if (byIntent !== undefined) return byIntent;
  }
  return projection.lifecycles.find(lifecycle => lifecycle.resolution === "filled") ?? projection.lifecycles[0] ?? null;
}

export function featuredCycle(dataset: Dataset): CycleView | null {
  const lifecycle = featuredLifecycle(dataset);
  const byLifecycle = lifecycle === null ? undefined : dataset.projection.cycles.find(cycle => cycle.intentSeqs.includes(lifecycle.intentSeq));
  return byLifecycle ?? dataset.projection.cycles.find(cycle => cycle.candidateVerdicts.length > 0) ?? null;
}

export function approvedVerdict(cycle: CycleView | null): CandidateVerdict | null {
  return cycle?.candidateVerdicts.find(verdict => verdict.decision !== "VETO" && verdict.gateVector !== undefined) ?? null;
}

/** A vetoed candidate WITH its gate vector, preferring the featured cycle so the veto sits next to the approval it lost to. */
export function vetoExample(dataset: Dataset, preferred: CycleView | null): { readonly cycle: CycleView; readonly verdict: CandidateVerdict & { readonly gateVector: readonly GateResult[] } } | null {
  const ordered = preferred === null ? dataset.projection.cycles : [preferred, ...dataset.projection.cycles.filter(cycle => cycle.seq !== preferred.seq)];
  for (const cycle of ordered) {
    for (const verdict of cycle.candidateVerdicts) {
      if (verdict.decision === "VETO" && verdict.gateVector !== undefined) return { cycle, verdict: { ...verdict, gateVector: verdict.gateVector } };
    }
  }
  return null;
}

export function countVerdicts(projection: Projection): { readonly cycles: number; readonly candidates: number; readonly vetoes: number; readonly noTrade: number } {
  let candidates = 0;
  let vetoes = 0;
  let noTrade = 0;
  for (const cycle of projection.cycles) {
    candidates += cycle.candidateVerdicts.length;
    vetoes += cycle.candidateVerdicts.filter(verdict => verdict.decision === "VETO").length;
    if (cycle.result === "no_trade") noTrade += 1;
  }
  return { cycles: projection.cycles.length, candidates, vetoes, noTrade };
}
