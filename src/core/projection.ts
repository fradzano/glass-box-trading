// Pure public-evidence projection (P6: S-J-07 content, S-J-09, the S-CYC-12
// projection). One committed journal revision plus one explicit cutoff go in;
// the judge-facing payload comes out. Every figure derives from the entries at
// or before the cutoff — entries beyond it are rejected and counted, never
// folded. Realized and unrealized P&L are joined to INTENT lifecycle
// identities through the journaled broker fills and the latest journaled
// quote samples; the S-CYC-06 emergency close links to its AUDIT_GAP
// reconciliation; whatever the components cannot explain stays visible as
// `UNATTRIBUTED` and a reconciliation discrepancy — nothing is assigned to a
// sleeve by inference. A milestone not yet observed is `null`, never made up.
// No I/O, no clock: the render time and the cutoff are inputs.
import { foldLifecycles, utcIsoToEpochMs } from "./execution.js";
import type { EntryLifecycleRecord } from "./execution.js";
import { haltStateFrom, isPrimaryEntryType } from "./journal.js";
import type { HaltState, JournalEntry, JournalQuoteSample } from "./journal.js";
import { declaredExpiryHolds } from "./lifecycle.js";
import { projectQualification } from "./qualification.js";
import type { QualificationConfig, QualificationProjection } from "./qualification.js";

export type CutoffKind = "presentation" | "deadline" | "latest";

export interface EvidenceCutoff {
  /** UTC ISO timestamp; entries with `at` beyond it are rejected. */
  readonly at: string;
  readonly kind: CutoffKind;
}

export interface ProjectionExpectations {
  readonly initialCapitalCents: number;
  readonly expectedAccountId: string | null;
  readonly flattenDate: string;
  readonly profile: "dev" | "competition";
  readonly qualification: QualificationConfig | null;
}

export interface EquityPoint {
  readonly seq: number;
  readonly at: string;
  readonly equityCents: number;
  readonly cashCents: number;
}

export interface SleeveAttribution {
  readonly realizedCents: number;
  /** Null when at least one open lifecycle of the sleeve lacks a quote for one of its legs. */
  readonly unrealizedCents: number | null;
  readonly unrealizedUnattributedLifecycles: readonly string[];
  /** Declared budget at risk: the reserved max loss of every lifecycle still holding or resting exposure. */
  readonly budgetAtRiskCents: number;
  readonly lifecycleCount: number;
}

export interface CloseLink {
  readonly attemptId: string;
  readonly route: string;
  readonly generation: number;
  readonly intentSeq: number | null;
  readonly outcomeSeq: number | null;
  /** The AUDIT_GAP reconciliation that records an emergency close the journal never saw submitted (S-CYC-06). */
  readonly reconciliationSeq: number | null;
  readonly status: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly limitKind: "debit" | "credit";
  readonly cashCents: number;
}

export interface LifecycleLink {
  readonly exposureLifecycleId: string;
  readonly clientOrderId: string;
  readonly sleeve: "income" | "convex";
  readonly underlying: string;
  readonly structureType: string;
  readonly intentSeq: number;
  readonly outcomeSeq: number | null;
  readonly state: EntryLifecycleRecord["state"];
  /** `filled`, `resting`, `unresolved`, or `released` — every intent links forward to its broker outcome or its explicit unresolved state. */
  readonly resolution: "filled" | "resting" | "unresolved" | "released";
  readonly brokerOrderId: string | null;
  readonly approvedQuantity: number;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly limitKind: "debit" | "credit";
  readonly submittedLimitCents: number;
  readonly reservedMaxLossCents: number;
  readonly closes: readonly CloseLink[];
  readonly closedQuantity: number;
  readonly openQuantity: number;
  readonly realizedCents: number;
  readonly unrealizedCents: number | null;
  readonly rationale: string;
}

export interface CycleView {
  readonly seq: number;
  readonly at: string;
  readonly type: string;
  readonly tradingDay: string | null;
  readonly cycleIndex: number | null;
  readonly reasonCodes: readonly string[];
  readonly batchVerdicts: readonly Readonly<Record<string, unknown>>[];
  readonly candidateVerdicts: readonly Readonly<Record<string, unknown>>[];
  /**
   * `proposal` when at least one INTENT followed this primary; `refused` when
   * none did but a management close was planned and turned away; `no_trade`
   * otherwise; `bootstrap`/`gap`/`skip`/`witness` for the substitutes. The
   * `refused` value exists because CONCEPT and SUBMISSION-SPEC require the
   * public page to say trade or no-trade AND why, and a cycle that tried to
   * close and could not is not the same fact as one that held on purpose
   * (R41-B2, scenario #74).
   */
  readonly result: "proposal" | "no_trade" | "refused" | "bootstrap" | "gap" | "skip" | "witness";
  readonly intentSeqs: readonly number[];
  readonly closeIntentSeqs: readonly number[];
  /** S-X-08: the management closes this cycle planned and did not submit, with the reason each was turned away. */
  readonly managementRefusals: readonly ManagementRefusalView[];
  readonly equityCents: number | null;
  readonly analystSkipped: boolean;
}

export interface ManagementRefusalView {
  readonly seq: number;
  readonly exposureLifecycleId: string;
  readonly route: string;
  readonly generation: number | null;
  readonly reason: string;
}

export interface Milestones {
  readonly firstArmAt: string | null;
  readonly firstTradeAt: string | null;
  readonly flattenAt: string | null;
  readonly deadlineAt: string | null;
  readonly terminalAt: string | null;
}

export interface PositionView {
  readonly contractId: string;
  readonly quantity: number;
  readonly avgEntryPriceCents: number;
  readonly declaredExpiryHold: boolean;
}

export interface OpenOrderView {
  readonly brokerOrderId: string;
  readonly clientOrderId: string;
  readonly status: string;
  readonly brokerSubmittedAt: string;
}

export interface PerformanceProjection {
  readonly journalRevision: string;
  readonly cutoff: EvidenceCutoff;
  readonly cutoffMs: number;
  readonly entriesFolded: number;
  readonly entriesBeyondCutoff: number;
  readonly lastUpdatedAt: string | null;
  readonly lastSeq: number | null;
  readonly accountId: string | null;
  readonly profile: "dev" | "competition";
  readonly startEquityCents: number | null;
  readonly initialCapitalCents: number;
  readonly startEquityMatchesInitialCapital: boolean | null;
  readonly currentEquityCents: number | null;
  readonly currentCashCents: number | null;
  readonly pnlAbsoluteCents: number | null;
  /** Basis points of the broker-recorded start equity, truncated toward zero; null without a start. */
  readonly pnlBps: number | null;
  readonly realizedCents: number;
  readonly unrealizedCents: number | null;
  /** The remainder the joined components do not explain (`UNATTRIBUTED`); null when no equity delta is computable. */
  readonly unattributedCents: number | null;
  readonly discrepancies: readonly string[];
  readonly equitySeries: readonly EquityPoint[];
  readonly peakEquityCents: number | null;
  readonly maxDrawdownCents: number | null;
  readonly maxDrawdownBps: number | null;
  readonly sleeves: { readonly income: SleeveAttribution; readonly convex: SleeveAttribution };
  readonly positions: readonly PositionView[];
  readonly openOrders: readonly OpenOrderView[];
  readonly flatState: "flat" | "not_flat" | "declared_expiry_hold" | "unknown";
  readonly lifecycles: readonly LifecycleLink[];
  readonly emergencyCloses: readonly CloseLink[];
  readonly cycles: readonly CycleView[];
  readonly milestones: Milestones;
  readonly qualification: QualificationProjection;
  readonly halt: HaltState;
  readonly humanActions: readonly { readonly seq: number; readonly at: string; readonly description: string }[];
  readonly foldFailure: string | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function recordList(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Splits the journal at the cutoff: entries at or before it are folded; later ones are rejected and counted. */
export function splitAtCutoff(entries: readonly JournalEntry[], cutoffMs: number): { readonly folded: readonly JournalEntry[]; readonly rejected: readonly JournalEntry[] } {
  const folded: JournalEntry[] = [];
  const rejected: JournalEntry[] = [];
  for (const entry of entries) {
    const ms = utcIsoToEpochMs(entry.at);
    if (ms !== null && ms <= cutoffMs) folded.push(entry);
    else rejected.push(entry);
  }
  return { folded, rejected };
}

function snapshotOf(entry: JournalEntry): Readonly<Record<string, unknown>> | null {
  const snapshot = entry["snapshot"];
  return isRecord(snapshot) ? snapshot : null;
}

function equitySeriesOf(entries: readonly JournalEntry[]): readonly EquityPoint[] {
  const points: EquityPoint[] = [];
  for (const entry of entries) {
    const snapshot = snapshotOf(entry);
    if (snapshot === null) continue;
    const equity = snapshot["equityCents"];
    const cash = snapshot["cashCents"];
    if (!isInteger(equity) || !isInteger(cash)) continue;
    points.push({ seq: entry.seq, at: entry.at, equityCents: equity, cashCents: cash });
  }
  return points;
}

function drawdownOf(series: readonly EquityPoint[]): { readonly peak: number | null; readonly maxDrawdown: number | null } {
  let peak: number | null = null;
  let maxDrawdown: number | null = null;
  for (const point of series) {
    if (peak === null || point.equityCents > peak) peak = point.equityCents;
    const drawdown = peak - point.equityCents;
    if (maxDrawdown === null || drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return { peak, maxDrawdown };
}

function bpsOf(numeratorCents: number, denominatorCents: number): number | null {
  if (denominatorCents <= 0) return null;
  const scaled = BigInt(numeratorCents) * 10_000n / BigInt(denominatorCents);
  return Number(scaled);
}

interface CloseFill {
  readonly attemptId: string;
  readonly exposureLifecycleId: string;
  readonly route: string;
  readonly generation: number;
  readonly intentSeq: number | null;
  readonly outcomeSeq: number | null;
  readonly reconciliationSeq: number | null;
  readonly status: string;
  readonly filledQuantity: number;
  readonly avgFillPriceCents: number | null;
  readonly limitKind: "debit" | "credit";
}

function limitKindOf(value: unknown): "debit" | "credit" | null {
  if (!isRecord(value)) return null;
  return value["kind"] === "debit" || value["kind"] === "credit" ? value["kind"] : null;
}

/** Every close attempt with its journaled fill: close INTENT + OUTCOME, or the emergency item inside an AUDIT_GAP reconciliation. */
function closeFillsOf(entries: readonly JournalEntry[]): readonly CloseFill[] {
  const byAttempt = new Map<string, CloseFill>();
  for (const entry of entries) {
    if (entry.type === "INTENT" && entry["action"] === "close") {
      const attemptId = entry["clientOrderId"];
      const exposureLifecycleId = entry["exposureLifecycleId"];
      const route = entry["route"];
      const generation = entry["generation"];
      const limitKind = limitKindOf(entry["submittedLimit"]);
      if (typeof attemptId !== "string" || typeof exposureLifecycleId !== "string" || typeof route !== "string" || !isInteger(generation) || limitKind === null) continue;
      byAttempt.set(attemptId, { attemptId, exposureLifecycleId, route, generation, intentSeq: entry.seq, outcomeSeq: null, reconciliationSeq: null, status: "submitted", filledQuantity: 0, avgFillPriceCents: null, limitKind });
      continue;
    }
    if (entry.type === "OUTCOME") {
      const attemptId = entry["clientOrderId"];
      if (typeof attemptId !== "string") continue;
      const close = byAttempt.get(attemptId);
      if (close === undefined) continue;
      const status = entry["status"];
      const filled = entry["filledQuantity"];
      const price = entry["avgFillPriceCents"];
      byAttempt.set(attemptId, { ...close, outcomeSeq: entry.seq, status: typeof status === "string" ? status : close.status, filledQuantity: isInteger(filled) ? filled : close.filledQuantity, avgFillPriceCents: isInteger(price) ? price : null });
      continue;
    }
    if (entry.type === "RECONCILIATION" && stringList(entry["reasonCodes"]).includes("AUDIT_GAP_EMERGENCY_CLOSE")) {
      for (const item of recordList(entry["items"])) {
        if (item["kind"] !== "emergency_close") continue;
        const attemptId = item["attemptId"];
        const exposureLifecycleId = item["exposureLifecycleId"];
        const generation = item["generation"];
        const status = item["status"];
        const filled = item["filledQuantity"];
        const price = item["avgFillPriceCents"];
        const limitKind = limitKindOf(item["submittedLimit"]);
        if (typeof attemptId !== "string" || typeof exposureLifecycleId !== "string" || limitKind === null) continue;
        byAttempt.set(attemptId, {
          attemptId,
          exposureLifecycleId,
          route: "emergency",
          generation: isInteger(generation) ? generation : 0,
          intentSeq: null,
          outcomeSeq: null,
          reconciliationSeq: entry.seq,
          status: typeof status === "string" ? status : "confirmation_unclear",
          filledQuantity: isInteger(filled) ? filled : 0,
          avgFillPriceCents: isInteger(price) ? price : null,
          limitKind,
        });
      }
    }
  }
  return [...byAttempt.values()];
}

/** Cash flow of one fill per lot in cents: a credit is received, a debit is paid. */
function cashPerLot(kind: "debit" | "credit", priceCents: number): number {
  return kind === "credit" ? priceCents * 100 : -priceCents * 100;
}

function closeLinkOf(close: CloseFill): CloseLink {
  const cash = close.avgFillPriceCents === null ? 0 : cashPerLot(close.limitKind, close.avgFillPriceCents) * close.filledQuantity;
  return { attemptId: close.attemptId, route: close.route, generation: close.generation, intentSeq: close.intentSeq, outcomeSeq: close.outcomeSeq, reconciliationSeq: close.reconciliationSeq, status: close.status, filledQuantity: close.filledQuantity, avgFillPriceCents: close.avgFillPriceCents, limitKind: close.limitKind, cashCents: cash };
}

/** Twice the mid value of one lot of the structure at the latest journaled quotes, or null when a leg has no sample. */
function twiceStructureValue(record: EntryLifecycleRecord, samples: Readonly<Record<string, JournalQuoteSample>> | undefined): number | null {
  if (samples === undefined) return null;
  let total = 0;
  for (const leg of record.candidate.legs) {
    const sample = samples[leg.contractId];
    if (sample === undefined) return null;
    const twiceMid = sample.bidCents + sample.askCents;
    total += (leg.side === "buy" ? twiceMid : -twiceMid) * leg.ratio;
  }
  return total;
}

function resolutionOf(record: EntryLifecycleRecord): LifecycleLink["resolution"] {
  switch (record.state) {
    case "filled":
      return "filled";
    case "fillable":
      return "resting";
    case "intent":
    case "confirmation_unclear":
      return "unresolved";
    case "rejected":
    case "canceled":
    case "expired":
      return "released";
  }
}

function emptySleeve(): SleeveAttribution {
  return { realizedCents: 0, unrealizedCents: 0, unrealizedUnattributedLifecycles: [], budgetAtRiskCents: 0, lifecycleCount: 0 };
}

function addToSleeve(sleeve: SleeveAttribution, link: LifecycleLink): SleeveAttribution {
  const holding = link.openQuantity > 0 || link.resolution === "resting" || link.resolution === "unresolved";
  return {
    realizedCents: sleeve.realizedCents + link.realizedCents,
    unrealizedCents: link.openQuantity > 0 && link.unrealizedCents === null ? null : (sleeve.unrealizedCents === null ? null : sleeve.unrealizedCents + (link.unrealizedCents ?? 0)),
    unrealizedUnattributedLifecycles: link.openQuantity > 0 && link.unrealizedCents === null ? [...sleeve.unrealizedUnattributedLifecycles, link.exposureLifecycleId] : sleeve.unrealizedUnattributedLifecycles,
    budgetAtRiskCents: sleeve.budgetAtRiskCents + (holding ? link.reservedMaxLossCents : 0),
    lifecycleCount: sleeve.lifecycleCount + 1,
  };
}

function intentSeqsOf(entries: readonly JournalEntry[]): Readonly<Record<string, { readonly seq: number; readonly structureType: string; readonly rationale: string }>> {
  const seqs: Record<string, { readonly seq: number; readonly structureType: string; readonly rationale: string }> = {};
  for (const entry of entries) {
    if (entry.type !== "INTENT" || entry["action"] === "close") continue;
    const clientOrderId = entry["clientOrderId"];
    const rationale = entry["rationale"];
    if (typeof clientOrderId !== "string") continue;
    seqs[clientOrderId] = { seq: entry.seq, structureType: typeof entry["structureType"] === "string" ? entry["structureType"] : "unknown", rationale: isRecord(rationale) && typeof rationale["text"] === "string" ? rationale["text"] : "" };
  }
  return seqs;
}

function outcomeSeqsOf(entries: readonly JournalEntry[]): Readonly<Record<string, number>> {
  const seqs: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.type !== "OUTCOME") continue;
    const clientOrderId = entry["clientOrderId"];
    if (typeof clientOrderId === "string" && !(clientOrderId in seqs)) seqs[clientOrderId] = entry.seq;
  }
  return seqs;
}

/** The quote samples of the latest snapshot only: a mark shares its instant with the equity it explains, never an older sample. */
function quoteSamplesOf(snapshot: Readonly<Record<string, unknown>> | null): Readonly<Record<string, Readonly<Record<string, JournalQuoteSample>>>> {
  if (snapshot === null || !isRecord(snapshot["quoteSamples"])) return {};
  const byUnderlying: Record<string, Readonly<Record<string, JournalQuoteSample>>> = {};
  for (const [underlying, samples] of Object.entries(snapshot["quoteSamples"])) {
    if (isRecord(samples)) byUnderlying[underlying] = samples as Readonly<Record<string, JournalQuoteSample>>;
  }
  return byUnderlying;
}

function lifecycleLinks(records: readonly EntryLifecycleRecord[], closes: readonly CloseFill[], entries: readonly JournalEntry[], latestSnapshot: Readonly<Record<string, unknown>> | null): readonly LifecycleLink[] {
  const intentSeqs = intentSeqsOf(entries);
  const outcomeSeqs = outcomeSeqsOf(entries);
  const quotes = quoteSamplesOf(latestSnapshot);
  const links: LifecycleLink[] = [];
  for (const record of records) {
    const intent = intentSeqs[record.clientOrderId];
    if (intent === undefined) continue;
    const ownCloses = closes.filter(close => close.exposureLifecycleId === record.exposureLifecycleId).map(closeLinkOf);
    const entryKind = record.candidate.entryLimit.kind;
    const entryPrice = record.avgFillPriceCents;
    const filledQuantity = record.state === "filled" || record.state === "fillable" ? record.filledQuantity : 0;
    const closedTotal = ownCloses.reduce((sum, close) => sum + close.filledQuantity, 0);
    const closedQuantity = Math.min(closedTotal, filledQuantity);
    const openQuantity = filledQuantity - closedQuantity;
    const entryCashPerLot = entryPrice === null ? 0 : cashPerLot(entryKind, entryPrice);
    const realized = ownCloses.reduce((sum, close) => sum + close.cashCents, 0) + entryCashPerLot * closedQuantity;
    let unrealized: number | null = 0;
    if (openQuantity > 0) {
      const twiceValue = twiceStructureValue(record, quotes[record.underlying]);
      unrealized = twiceValue === null ? null : twiceValue * 50 * openQuantity + entryCashPerLot * openQuantity;
    }
    links.push({
      exposureLifecycleId: record.exposureLifecycleId,
      clientOrderId: record.clientOrderId,
      sleeve: record.sleeve,
      underlying: record.underlying,
      structureType: intent.structureType,
      intentSeq: intent.seq,
      outcomeSeq: outcomeSeqs[record.clientOrderId] ?? null,
      state: record.state,
      resolution: resolutionOf(record),
      brokerOrderId: record.brokerOrderId,
      approvedQuantity: record.candidate.quantity,
      filledQuantity,
      avgFillPriceCents: entryPrice,
      limitKind: entryKind,
      submittedLimitCents: record.candidate.entryLimit.priceCents,
      reservedMaxLossCents: record.reservedMaxLossCents,
      closes: ownCloses,
      closedQuantity,
      openQuantity,
      realizedCents: realized,
      unrealizedCents: unrealized,
      rationale: intent.rationale,
    });
  }
  return links;
}

function cycleViews(entries: readonly JournalEntry[]): readonly CycleView[] {
  const views: CycleView[] = [];
  const primaries = entries.filter(entry => isPrimaryEntryType(entry.type));
  for (let index = 0; index < primaries.length; index += 1) {
    const primary = primaries[index];
    if (primary === undefined) continue;
    const nextSeq = primaries[index + 1]?.seq ?? Number.MAX_SAFE_INTEGER;
    const between = entries.filter(entry => entry.seq > primary.seq && entry.seq < nextSeq);
    const intentSeqs = between.filter(entry => entry.type === "INTENT" && entry["action"] !== "close").map(entry => entry.seq);
    const closeIntentSeqs = between.filter(entry => entry.type === "INTENT" && entry["action"] === "close").map(entry => entry.seq);
    const snapshot = snapshotOf(primary);
    const equity = snapshot === null ? null : snapshot["equityCents"];
    const reasonCodes = stringList(primary["reasonCodes"]);
    const managementRefusals: ManagementRefusalView[] = [];
    for (const entry of between) {
      if (entry.type !== "MANAGEMENT_REFUSAL") continue;
      managementRefusals.push({
        seq: entry.seq,
        exposureLifecycleId: typeof entry["exposureLifecycleId"] === "string" ? entry["exposureLifecycleId"] : "",
        route: typeof entry["route"] === "string" ? entry["route"] : "",
        generation: isInteger(entry["generation"]) ? entry["generation"] : null,
        reason: typeof entry["reason"] === "string" ? entry["reason"] : "",
      });
    }
    const result: CycleView["result"] = primary.type === "BOOTSTRAP" ? "bootstrap"
      : primary.type === "GAP" ? "gap"
        : primary.type === "SKIP" ? "skip"
          : primary.type === "CYCLE" ? (intentSeqs.length > 0 ? "proposal" : managementRefusals.length > 0 ? "refused" : "no_trade")
            : "witness";
    views.push({
      seq: primary.seq,
      at: primary.at,
      type: primary.type,
      tradingDay: typeof primary["tradingDay"] === "string" ? primary["tradingDay"] : null,
      cycleIndex: isInteger(primary["cycleIndex"]) ? primary["cycleIndex"] : null,
      reasonCodes,
      batchVerdicts: recordList(primary["batchVerdicts"]),
      candidateVerdicts: recordList(primary["candidateVerdicts"]),
      result,
      intentSeqs,
      closeIntentSeqs,
      managementRefusals,
      equityCents: isInteger(equity) ? equity : null,
      analystSkipped: recordList(primary["batchVerdicts"]).some(verdict => verdict["code"] === "ANALYST_SKIP") || reasonCodes.includes("WORLD_UNREACHABLE"),
    });
  }
  return views;
}

function firstAt(entries: readonly JournalEntry[], predicate: (entry: JournalEntry) => boolean): string | null {
  for (const entry of entries) if (predicate(entry)) return entry.at;
  return null;
}

function positionsOf(snapshot: Readonly<Record<string, unknown>> | null, holds: ReadonlySet<string>): readonly PositionView[] {
  if (snapshot === null) return [];
  return recordList(snapshot["positions"]).flatMap(position => {
    const contractId = position["contractId"];
    const quantity = position["quantity"];
    const avg = position["avgEntryPriceCents"];
    if (typeof contractId !== "string" || !isInteger(quantity) || !isInteger(avg)) return [];
    return [{ contractId, quantity, avgEntryPriceCents: avg, declaredExpiryHold: holds.has(contractId) }];
  });
}

function openOrdersOf(snapshot: Readonly<Record<string, unknown>> | null): readonly OpenOrderView[] {
  if (snapshot === null) return [];
  return recordList(snapshot["openOrders"]).flatMap(order => {
    const brokerOrderId = order["brokerOrderId"];
    const clientOrderId = order["clientOrderId"];
    const status = order["status"];
    const submitted = order["brokerSubmittedAt"];
    if (typeof brokerOrderId !== "string" || typeof clientOrderId !== "string" || typeof status !== "string" || typeof submitted !== "string") return [];
    return [{ brokerOrderId, clientOrderId, status, brokerSubmittedAt: submitted }];
  });
}

function milestonesOf(entries: readonly JournalEntry[], flattenDate: string, holds: ReadonlySet<string>): Milestones {
  const entryIds = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "INTENT" && entry["action"] !== "close" && typeof entry["clientOrderId"] === "string") entryIds.add(entry["clientOrderId"]);
  }
  const firstTradeAt = firstAt(entries, entry => entry.type === "OUTCOME" && typeof entry["clientOrderId"] === "string" && entryIds.has(entry["clientOrderId"]) && (entry["status"] === "filled" || entry["status"] === "partially_filled"));
  let flattenDayReached = false;
  let flattenAt: string | null = null;
  for (const entry of entries) {
    if (typeof entry["tradingDay"] === "string" && entry["tradingDay"] >= flattenDate) flattenDayReached = true;
    if (!flattenDayReached || flattenAt !== null) continue;
    const snapshot = snapshotOf(entry);
    if (snapshot === null) continue;
    const open = positionsOf(snapshot, holds).filter(position => position.quantity !== 0 && !position.declaredExpiryHold);
    if (open.length === 0) flattenAt = entry.at;
  }
  return {
    firstArmAt: firstAt(entries, entry => entry.type === "BOOTSTRAP"),
    firstTradeAt,
    flattenAt,
    deadlineAt: firstAt(entries, entry => entry.type === "DEADLINE_RECONCILIATION"),
    terminalAt: firstAt(entries, entry => entry.type === "TERMINAL"),
  };
}

function accountIdsOf(entries: readonly JournalEntry[]): readonly string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const snapshot = snapshotOf(entry);
    if (snapshot !== null && typeof snapshot["accountId"] === "string") ids.add(snapshot["accountId"]);
    const binding = entry["binding"];
    if (isRecord(binding) && typeof binding["accountId"] === "string") ids.add(binding["accountId"]);
  }
  return [...ids];
}

/**
 * The judge-facing performance projection over one committed journal
 * revision at one explicit cutoff (S-J-09). Pure: the revision label, the
 * cutoff, and the expectations are inputs; nothing is observed.
 */
export function projectPerformance(entries: readonly JournalEntry[], journalRevision: string, cutoff: EvidenceCutoff, expectations: ProjectionExpectations): PerformanceProjection {
  const cutoffMs = utcIsoToEpochMs(cutoff.at) ?? -1;
  const { folded, rejected } = splitAtCutoff(entries, cutoffMs);
  const discrepancies: string[] = [];
  if (cutoffMs < 0) discrepancies.push(`CUTOFF_INVALID: ${cutoff.at}`);
  const fold = foldLifecycles(folded);
  const foldFailure = fold.ok ? null : fold.reason;
  if (!fold.ok) discrepancies.push(`FOLD_FAILED: ${fold.reason}`);
  const records = fold.ok ? fold.entries : [];
  const closes = closeFillsOf(folded);
  const latestSnapshotEntry = [...folded].reverse().find(entry => snapshotOf(entry) !== null);
  const latestSnapshot = latestSnapshotEntry === undefined ? null : snapshotOf(latestSnapshotEntry);
  const links = lifecycleLinks(records, closes, folded, latestSnapshot);
  const emergencyCloses = closes.filter(close => close.reconciliationSeq !== null).map(closeLinkOf);
  const holds = new Set(declaredExpiryHolds(folded));
  const series = equitySeriesOf(folded);
  const bootstrap = folded.find(entry => entry.type === "BOOTSTRAP");
  const bootstrapSnapshot = bootstrap === undefined ? null : snapshotOf(bootstrap);
  const startEquity = bootstrapSnapshot !== null && isInteger(bootstrapSnapshot["equityCents"]) ? bootstrapSnapshot["equityCents"] : null;
  const startMatches = startEquity === null ? null : startEquity === expectations.initialCapitalCents;
  if (startMatches === false) discrepancies.push(`START_EQUITY_NOT_INITIAL_CAPITAL: ${String(startEquity)} vs ${String(expectations.initialCapitalCents)}`);
  if (bootstrap === undefined) discrepancies.push("NO_BOOTSTRAP_AT_CUTOFF");
  const last = series.length === 0 ? null : series[series.length - 1] ?? null;
  const accountIds = accountIdsOf(folded);
  const accountId = bootstrapSnapshot !== null && typeof bootstrapSnapshot["accountId"] === "string" ? bootstrapSnapshot["accountId"] : (accountIds[0] ?? null);
  if (accountIds.length > 1) discrepancies.push(`ACCOUNT_IDS_DIFFER: ${accountIds.join(", ")}`);
  if (expectations.expectedAccountId !== null && accountId !== null && accountId !== expectations.expectedAccountId) discrepancies.push(`ACCOUNT_ID_UNEXPECTED: ${accountId}`);
  const currentEquity = last === null ? null : last.equityCents;
  const pnlAbsolute = startEquity === null || currentEquity === null ? null : currentEquity - startEquity;
  const realized = links.reduce((sum, link) => sum + link.realizedCents, 0);
  const unattributedLifecycles = links.filter(link => link.openQuantity > 0 && link.unrealizedCents === null);
  const unrealized = unattributedLifecycles.length > 0 ? null : links.reduce((sum, link) => sum + (link.unrealizedCents ?? 0), 0);
  for (const link of unattributedLifecycles) discrepancies.push(`UNREALIZED_UNATTRIBUTED: ${link.exposureLifecycleId} has an open leg without a journaled quote`);
  const unattributed = pnlAbsolute === null ? null : pnlAbsolute - realized - (unrealized ?? 0);
  if (unattributed !== null && unattributed !== 0) discrepancies.push(`UNATTRIBUTED: ${String(unattributed)} cents of the equity delta are not explained by joined fills and marks`);
  const { peak, maxDrawdown } = drawdownOf(series);
  const sleeves = links.reduce(
    (acc, link) => (link.sleeve === "income" ? { ...acc, income: addToSleeve(acc.income, link) } : { ...acc, convex: addToSleeve(acc.convex, link) }),
    { income: emptySleeve(), convex: emptySleeve() },
  );
  const positions = positionsOf(latestSnapshot, holds);
  const openPositions = positions.filter(position => position.quantity !== 0);
  const flatState: PerformanceProjection["flatState"] = latestSnapshot === null ? "unknown"
    : openPositions.length === 0 ? "flat"
      : openPositions.every(position => position.declaredExpiryHold) ? "declared_expiry_hold"
        : "not_flat";
  const lastEntry = folded[folded.length - 1];
  const humanActions = folded.filter(entry => entry.type === "HUMAN_ACTION").map(entry => ({ seq: entry.seq, at: entry.at, description: typeof entry["description"] === "string" ? entry["description"] : "" }));
  return {
    journalRevision,
    cutoff,
    cutoffMs,
    entriesFolded: folded.length,
    entriesBeyondCutoff: rejected.length,
    lastUpdatedAt: lastEntry === undefined ? null : lastEntry.at,
    lastSeq: lastEntry === undefined ? null : lastEntry.seq,
    accountId,
    profile: expectations.profile,
    startEquityCents: startEquity,
    initialCapitalCents: expectations.initialCapitalCents,
    startEquityMatchesInitialCapital: startMatches,
    currentEquityCents: currentEquity,
    currentCashCents: last === null ? null : last.cashCents,
    pnlAbsoluteCents: pnlAbsolute,
    pnlBps: pnlAbsolute === null || startEquity === null ? null : bpsOf(pnlAbsolute, startEquity),
    realizedCents: realized,
    unrealizedCents: unrealized,
    unattributedCents: unattributed,
    discrepancies,
    equitySeries: series,
    peakEquityCents: peak,
    maxDrawdownCents: maxDrawdown,
    maxDrawdownBps: peak === null || maxDrawdown === null ? null : bpsOf(maxDrawdown, peak),
    sleeves,
    positions,
    openOrders: openOrdersOf(latestSnapshot),
    flatState,
    lifecycles: links,
    emergencyCloses,
    cycles: cycleViews(folded),
    milestones: milestonesOf(folded, expectations.flattenDate, holds),
    qualification: projectQualification(folded, cutoffMs, expectations.qualification, expectations.profile),
    halt: haltStateFrom(folded),
    humanActions,
    foldFailure,
  };
}

export type FreshnessState = "fresh" | "lagging" | "stale";

export interface FreshnessAssessment {
  readonly state: FreshnessState;
  readonly ageMs: number | null;
  readonly explanation: string;
}

/**
 * Freshness of a rendered page relative to its render instant (S-J-07,
 * S-CYC-07): fresh within one cycle interval, lagging within the dead-man
 * bound, stale beyond it. Freshness may lag; content may not lie — the page
 * states this assessment next to the stamp.
 */
export function assessFreshness(lastUpdatedAt: string | null, renderedAtMs: number, cycleIntervalMs: number, deadManBoundMs: number): FreshnessAssessment {
  const lastMs = lastUpdatedAt === null ? null : utcIsoToEpochMs(lastUpdatedAt);
  if (lastMs === null) return { state: "stale", ageMs: null, explanation: "no journal entry at or before the cutoff; nothing is current" };
  const ageMs = renderedAtMs - lastMs;
  if (ageMs <= cycleIntervalMs) return { state: "fresh", ageMs, explanation: "the newest folded entry is within one cycle interval of the render" };
  if (ageMs <= deadManBoundMs) return { state: "lagging", ageMs, explanation: "the newest folded entry is older than one cycle interval; publishing or the session may be idle" };
  return { state: "stale", ageMs, explanation: "the newest folded entry is older than the dead-man bound; treat every figure as historical, not current" };
}
