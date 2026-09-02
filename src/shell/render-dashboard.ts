// The static dashboard renderer (S-J-07, SUBMISSION-SPEC §2/§3): one pure
// function from a performance projection plus its render context to one HTML
// document. It invents nothing — every figure is a field of the projection,
// every link is an anchor to a seq or lifecycle the projection lists. The
// page states its own journal revision, evidence cutoff, last-updated stamp,
// freshness, and publication state in `glass-box-*` meta tags so an anonymous
// probe can verify it without parsing prose. The golden path (SUBMISSION-SPEC
// §3) is an ordered anchor chain that works with markets closed.
import type { CycleView, FreshnessAssessment, LifecycleLink, PerformanceProjection } from "../core/projection.js";
import { expectedMeta } from "../core/publish.js";
import type { PublishDegradation, PublishExpectation } from "../core/publish.js";
import { auditPresentationStylesheet } from "./presentation-guard.js";

export interface PublicSourceLinks {
  readonly repositoryUrl: string;
  readonly journalRevisionUrl: string | null;
  readonly corePath: string;
  readonly evidenceTestPath: string;
  readonly evidenceDebtRow: string;
}

export interface PinnedRoute {
  readonly journalRevision: string;
  readonly cutoffKind: string;
  readonly cutoffAt: string;
  readonly href: string;
}

export interface RenderContext {
  readonly renderedAt: string;
  readonly freshness: FreshnessAssessment;
  readonly degradation: PublishDegradation;
  readonly source: PublicSourceLinks;
  readonly pinned: readonly PinnedRoute[];
  /** The route this page is served from, for the self-description line. */
  readonly routeLabel: string;
  /**
   * The dashboard stylesheet, inlined verbatim into the page's one `<style>`
   * block so the published page stays a single self-contained HTML file. The
   * shell reads it from `assets/dashboard.css`
   * (`readPresentationAsset` in `./dashboard-build.js`); this renderer stays
   * pure and only receives the text. Empty text is refused, never rendered.
   */
  readonly styles: string;
}

/** Primitive-only stringification: an object in a verdict field is rendered as its JSON, never as `[object Object]`. */
function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return typeof value === "object" ? JSON.stringify(value) : "";
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Integer cents to `$1,234.56` / `-$0.07`; no locale, no float. */
export function formatUsd(cents: number | null): string {
  if (cents === null) return "n/a";
  const sign = cents < 0 ? "-" : "";
  const magnitude = Math.abs(cents);
  const dollars = Math.trunc(magnitude / 100);
  const rest = magnitude % 100;
  const groups: string[] = [];
  let remaining = String(dollars);
  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  groups.unshift(remaining);
  return `${sign}$${groups.join(",")}.${String(rest).padStart(2, "0")}`;
}

export function formatBps(bps: number | null): string {
  if (bps === null) return "n/a";
  const sign = bps < 0 ? "-" : "";
  const magnitude = Math.abs(bps);
  return `${sign}${String(Math.trunc(magnitude / 100))}.${String(magnitude % 100).padStart(2, "0")}%`;
}

function formatPrice(cents: number | null): string {
  return cents === null ? "n/a" : `${String(Math.trunc(cents / 100))}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

function stamp(value: string | null): string {
  return value === null ? "null (not yet observed)" : value;
}

function metaTags(expectation: PublishExpectation, context: RenderContext): string {
  const meta = { ...expectedMeta(expectation), "glass-box-rendered-at": context.renderedAt, "glass-box-freshness": context.freshness.state, "glass-box-publish-degraded": context.degradation.degraded ? "true" : "false" };
  return Object.entries(meta).map(([name, content]) => `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`).join("\n");
}

/**
 * One-sentence tooltip text per gate id, keyed exactly as the id appears in
 * the journal record's `gate` field (docs/SPEC.md §G1-G8, `fixtures/golden-journal.jsonl`).
 * An id absent here (unknown or future gate) gets no `title` attribute rather
 * than a guessed one.
 */
const GATE_TOOLTIPS: Readonly<Record<string, string>> = {
  G1: "G1 — defined risk only: every accepted structure has a maximum loss fixed at order entry; no naked short options.",
  G2: "G2 — sleeve budgets: a candidate's reserved max loss must fit within its sleeve's remaining budget.",
  G3: "G3 — max loss per position: a single position's max loss may not exceed the configured fraction of its sleeve budget.",
  G4: "G4 — per-underlying concentration: total exposure on one underlying may not exceed the configured cap.",
  G5: "G5 — liquidity: every leg needs a live, non-crossed quote within the allowed spread, size, and age.",
  G6: "G6 — session and tradability: orders are only possible inside the exchange calendar's actual session, and a stale or frozen quote feed vetoes new entries on that underlying.",
  G7: "G7 — idempotency: every order and close attempt derives a deterministic id, so a crash replay reconciles instead of duplicating.",
  G8: "G8 — schema and whitelist: candidates must be valid, schema-conformant JSON constrained to the configured underlying, structure, expiry, strike-distance, and quantity whitelist.",
};

function gateRail(verdict: Readonly<Record<string, unknown>>): string {
  const vector = Array.isArray(verdict["gateVector"]) ? verdict["gateVector"] : [];
  const cells = vector.map((gate: unknown) => {
    if (typeof gate !== "object" || gate === null) return "";
    const record = gate as Readonly<Record<string, unknown>>;
    const passed = record["passed"] === true;
    const reasons = Array.isArray(record["reasons"]) ? record["reasons"].map(String).join("; ") : "";
    const gateId = text(record["gate"]);
    const tooltip = GATE_TOOLTIPS[gateId];
    const titleAttr = tooltip === undefined ? "" : ` title="${escapeHtml(tooltip)}"`;
    return `<li class="gate gate--${passed ? "pass" : "veto"}"${titleAttr}><span>${escapeHtml(gateId)}</span><strong>${passed ? "PASS" : "VETO"}</strong><small>${escapeHtml(reasons.length === 0 ? (text(record["code"]) || "PASS") : reasons)}</small></li>`;
  });
  return `<ol class="gate-rail" aria-label="Complete deterministic gate vector">${cells.join("")}</ol>`;
}

function candidateBlock(cycle: CycleView, verdict: Readonly<Record<string, unknown>>, index: number): string {
  const id = `gates-${String(cycle.seq)}-${String(index)}`;
  const decision = text(verdict["decision"]) || "?";
  return `<article class="candidate candidate--${decision.toLowerCase()}" id="${id}">
  <header><span class="eyebrow">Candidate</span><h4>${escapeHtml(text(verdict["candidateId"]) || "?")}</h4><span class="stamp stamp--${decision.toLowerCase()}">${escapeHtml(decision)}</span></header>
  <p class="rationale">${escapeHtml(text(verdict["candidateRationale"]))}</p>
  <p class="figure">Reserved max loss: <code>${formatUsd(typeof verdict["reservedMaxLossCents"] === "number" ? verdict["reservedMaxLossCents"] : null)}</code></p>
  ${gateRail(verdict)}
</article>`;
}

function cycleRow(cycle: CycleView): string {
  const codes = cycle.reasonCodes.length === 0 ? "—" : cycle.reasonCodes.join(", ");
  return `<tr><td><a href="#cycle-${String(cycle.seq)}">${String(cycle.seq)}</a></td><td><time>${escapeHtml(cycle.at)}</time></td><td>${escapeHtml(cycle.tradingDay ?? "—")}</td><td>${escapeHtml(cycle.type)}</td><td class="result result--${cycle.result}">${escapeHtml(cycle.result.replaceAll("_", " "))}</td><td>${escapeHtml(codes)}</td><td class="num">${formatUsd(cycle.equityCents)}</td><td>${cycle.candidateVerdicts.length === 0 ? "0" : String(cycle.candidateVerdicts.length)}</td></tr>`;
}

function cycleDetail(cycle: CycleView, lifecyclesBySeq: ReadonlyMap<number, LifecycleLink>): string {
  const batch = cycle.batchVerdicts.length === 0 ? "" : `<p class="batch">Batch verdicts: ${escapeHtml(cycle.batchVerdicts.map(verdict => `${text(verdict["code"])}: ${text(verdict["reason"])}`).join("; "))}</p>`;
  const candidates = cycle.candidateVerdicts.map((verdict, index) => candidateBlock(cycle, verdict, index)).join("");
  const intents = cycle.intentSeqs.map(seq => {
    const link = lifecyclesBySeq.get(seq);
    return link === undefined ? `<li>INTENT seq ${String(seq)}</li>` : `<li><a href="#lifecycle-${escapeHtml(link.exposureLifecycleId)}">INTENT seq ${String(seq)} → ${escapeHtml(link.resolution)}</a></li>`;
  }).join("");
  const noTrade = cycle.result === "no_trade" ? `<p class="no-trade">No-trade result: ${cycle.candidateVerdicts.length === 0 ? (cycle.analystSkipped ? "the analyst produced nothing usable this cycle (skip journaled)" : "the analyst proposed no candidate") : "every candidate was vetoed by the deterministic gates"}.</p>` : "";
  return `<section class="cycle" id="cycle-${String(cycle.seq)}" aria-labelledby="cycle-${String(cycle.seq)}-title">
  <h3 id="cycle-${String(cycle.seq)}-title">${escapeHtml(cycle.type)} seq ${String(cycle.seq)} · <time>${escapeHtml(cycle.at)}</time>${cycle.cycleIndex === null ? "" : ` · cycle ${String(cycle.cycleIndex)}`}${cycle.tradingDay === null ? "" : ` · ${escapeHtml(cycle.tradingDay)}`}</h3>
  <p class="figure">Equity at snapshot: <code>${formatUsd(cycle.equityCents)}</code> · reason codes: <code>${escapeHtml(cycle.reasonCodes.length === 0 ? "none" : cycle.reasonCodes.join(", "))}</code></p>
  ${batch}${noTrade}
  ${candidates}
  ${intents.length === 0 ? "" : `<ul class="intents">${intents}</ul>`}
</section>`;
}

function closeRows(link: LifecycleLink): string {
  if (link.closes.length === 0) return "<p class=\"figure\">No close attempt journaled at this cutoff.</p>";
  return `<table class="closes"><thead><tr><th>Close attempt</th><th>Route</th><th>Gen</th><th>INTENT</th><th>OUTCOME</th><th>Status</th><th>Filled</th><th>Avg price</th><th>Cash</th></tr></thead><tbody>${link.closes.map(close => `<tr><td><code>${escapeHtml(close.attemptId)}</code></td><td>${escapeHtml(close.route)}</td><td>${String(close.generation)}</td><td>${close.intentSeq === null ? (close.reconciliationSeq === null ? "—" : `<strong>none</strong> — <a href="#reconciliation-${String(close.reconciliationSeq)}">AUDIT_GAP_EMERGENCY_CLOSE seq ${String(close.reconciliationSeq)}</a>`) : String(close.intentSeq)}</td><td>${close.outcomeSeq === null ? "—" : String(close.outcomeSeq)}</td><td>${escapeHtml(close.status)}</td><td>${String(close.filledQuantity)}</td><td>${formatPrice(close.avgFillPriceCents)}</td><td class="num">${formatUsd(close.cashCents)}</td></tr>`).join("")}</tbody></table>`;
}

function lifecycleCard(link: LifecycleLink): string {
  return `<article class="lifecycle" id="lifecycle-${escapeHtml(link.exposureLifecycleId)}">
  <header><span class="eyebrow">${escapeHtml(link.sleeve)} sleeve</span><h3>${escapeHtml(link.structureType)} on ${escapeHtml(link.underlying)} · <code>${escapeHtml(link.exposureLifecycleId)}</code></h3><span class="stamp stamp--${link.resolution}">${escapeHtml(link.resolution)}</span></header>
  <p class="rationale">${escapeHtml(link.rationale)}</p>
  <dl class="chain">
    <div><dt>INTENT</dt><dd>seq ${String(link.intentSeq)} · client order <code>${escapeHtml(link.clientOrderId)}</code> · ${escapeHtml(link.limitKind)} limit ${formatPrice(link.submittedLimitCents)} × ${String(link.approvedQuantity)} · reserved ${formatUsd(link.reservedMaxLossCents)}</dd></div>
    <div><dt>Broker order</dt><dd>${link.brokerOrderId === null ? "not acknowledged at this cutoff" : `<code>${escapeHtml(link.brokerOrderId)}</code>`}</dd></div>
    <div><dt>OUTCOME</dt><dd>${link.outcomeSeq === null ? `<strong>unresolved</strong> — state ${escapeHtml(link.state)}` : `seq ${String(link.outcomeSeq)} · ${escapeHtml(link.state)} · filled ${String(link.filledQuantity)} at ${formatPrice(link.avgFillPriceCents)}`}</dd></div>
    <div><dt>Closes</dt><dd>${closeRows(link)}</dd></div>
    <div><dt>P&amp;L contribution</dt><dd>realized <code>${formatUsd(link.realizedCents)}</code> · unrealized <code>${link.openQuantity === 0 ? formatUsd(0) : (link.unrealizedCents === null ? "UNATTRIBUTED (no journaled quote)" : formatUsd(link.unrealizedCents))}</code> · open ${String(link.openQuantity)} of ${String(link.filledQuantity)} filled</dd></div>
  </dl>
</article>`;
}

function sleeveRow(name: string, sleeve: PerformanceProjection["sleeves"]["income"]): string {
  return `<tr><td>${escapeHtml(name)}</td><td class="num">${formatUsd(sleeve.realizedCents)}</td><td class="num">${sleeve.unrealizedCents === null ? "UNATTRIBUTED" : formatUsd(sleeve.unrealizedCents)}</td><td class="num">${formatUsd(sleeve.budgetAtRiskCents)}</td><td>${String(sleeve.lifecycleCount)}</td></tr>`;
}

function qualificationLine(projection: PerformanceProjection): string {
  const q = projection.qualification;
  switch (q.state) {
    case "NOT_APPLICABLE":
      return "Qualification gate: not applicable (dev profile or no competition calendar configured).";
    case "NOT_DUE":
      return `Qualification gate: not yet due (checkpoint at epoch ms ${String(q.checkpointMs)}).`;
    case "QUALIFIED":
      return `Qualification gate: QUALIFIED — ${String(q.fills.length)} ordinary competition fill(s) joined to INTENT and OUTCOME (first: INTENT seq ${String(q.fills[0]?.intentSeq ?? "?")}, OUTCOME seq ${String(q.fills[0]?.outcomeSeq ?? "?")}).`;
    case "COMPETITIVENESS_AT_RISK":
      return "Qualification gate: COMPETITIVENESS_AT_RISK — no ordinary competition fill at the checkpoint. This is this project's internal winning signal, not a statement about external eligibility; the bounded one-lot qualification window is open under unchanged gates.";
    case "WINNING_ACCEPTANCE_FAILED":
      return "Qualification gate: WINNING_ACCEPTANCE_FAILED — no ordinary competition fill by the window end. Submission requires an explicit owner waiver; no external ineligibility is claimed.";
  }
}

function renderHead(projection: PerformanceProjection, expectation: PublishExpectation, context: RenderContext): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glass Box Trading — public evidence at ${escapeHtml(projection.cutoff.kind)} cutoff ${escapeHtml(projection.cutoff.at)}</title>
${metaTags(expectation, context)}
<style>
${context.styles}
</style></head>`;
}

function renderPageHeader(projection: PerformanceProjection, context: RenderContext): string {
  return `<body><main>
<p class="eyebrow">Glass Box Trading · paper trading only · ${escapeHtml(projection.profile)} profile</p>
<h1>AI proposes; deterministic gates dispose.</h1>
<p class="self" id="self-description">This page renders <strong>only</strong> journal revision <strong><code>${escapeHtml(projection.journalRevision)}</code></strong> at the <strong>${escapeHtml(projection.cutoff.kind)}</strong> evidence cutoff <strong><time>${escapeHtml(projection.cutoff.at)}</time></strong> (${String(projection.entriesFolded)} entries folded, ${String(projection.entriesBeyondCutoff)} rejected as newer than the cutoff). Last journal update <strong><time>${escapeHtml(stamp(projection.lastUpdatedAt))}</time></strong> (seq ${projection.lastSeq === null ? "none" : String(projection.lastSeq)}); rendered at <time>${escapeHtml(context.renderedAt)}</time>; freshness <strong>${escapeHtml(context.freshness.state)}</strong> — ${escapeHtml(context.freshness.explanation)}. Route: ${escapeHtml(context.routeLabel)}.${context.degradation.degraded ? ` <span class="degraded"><strong>Degraded publication:</strong> ${escapeHtml(context.degradation.explanation)}</span>` : ""} Freshness may lag; content may not lie.</p>`;
}

/**
 * A short reading guide, placed right after the masthead and before the
 * first data section (S-J-07/SUBMISSION-SPEC §2/§3 owner review, 2026-09-02:
 * "hard to understand what the dashboard wants to show"). Static prose,
 * constant for the module — it describes the page's own construction, not
 * any journal figure, so it carries no projection data.
 */
function renderHowToReadSection(): string {
  return `<section id="how-to-read" aria-labelledby="how-to-read-title">
<h2 id="how-to-read-title">How to read this page</h2>
<p>This page is rendered from one committed revision of the append-only trading journal and nothing else.</p>
<p>Each cycle below shows what the analyst proposed, which of the eight deterministic gates (G1 through G8) each candidate passed or failed and why, and what the executor actually did.</p>
<p>Vetoes and no-trade cycles are shown on purpose: they are the evidence that the gates work, not an omission.</p>
<p>The sleeves table attributes realized and unrealized profit and loss to the income and convex sleeves against their declared budgets.</p>
<p>The reconciliation section lists any discrepancy between what the broker reports and what the journal can explain.</p>
<p>The freshness stamp near the top of this page states how stale it is relative to the journal's last recorded entry.</p>
</section>`;
}

function kpiTiles(projection: PerformanceProjection): string {
  return `<div class="tiles">
<div class="tile"><span class="eyebrow">Start equity (BOOTSTRAP)</span><strong>${formatUsd(projection.startEquityCents)}</strong><small>${projection.startEquityMatchesInitialCapital === null ? "no bootstrap at cutoff" : projection.startEquityMatchesInitialCapital ? "equals INITIAL_CAPITAL" : "DOES NOT equal INITIAL_CAPITAL"}</small></div>
<div class="tile"><span class="eyebrow">Current equity</span><strong>${formatUsd(projection.currentEquityCents)}</strong><small>cash ${formatUsd(projection.currentCashCents)}</small></div>
<div class="tile"><span class="eyebrow">P&amp;L vs. broker-recorded start</span><strong>${formatUsd(projection.pnlAbsoluteCents)}</strong><small>${formatBps(projection.pnlBps)}</small></div>
<div class="tile"><span class="eyebrow">Realized / unrealized</span><strong>${formatUsd(projection.realizedCents)}</strong><small>unrealized ${projection.unrealizedCents === null ? "UNATTRIBUTED" : formatUsd(projection.unrealizedCents)}</small></div>
<div class="tile"><span class="eyebrow">Unattributed</span><strong>${projection.unattributedCents === null ? "n/a" : formatUsd(projection.unattributedCents)}</strong><small>equity delta not explained by joined fills and marks</small></div>
<div class="tile"><span class="eyebrow">Peak / max drawdown</span><strong>${formatUsd(projection.maxDrawdownCents)}</strong><small>peak ${formatUsd(projection.peakEquityCents)} · ${formatBps(projection.maxDrawdownBps)} of peak</small></div>
</div>`;
}

function goldenPathList(goldenPath: readonly (readonly string[])[]): string {
  return `<ol class="golden" id="golden-path">${goldenPath.map(([href, label]) => `<li><a href="${escapeHtml(href ?? "#")}">${escapeHtml(label ?? "")}</a></li>`).join("")}</ol>`;
}

function renderResultSection(projection: PerformanceProjection, flatLabel: string, goldenPath: readonly (readonly string[])[]): string {
  return `<section id="result" aria-labelledby="result-title">
<h2 id="result-title">Result at this cutoff</h2>
<p class="lead">This section reports the account's equity, profit and loss, qualification state, and the control model under which every order is approved.</p>
<p>Submitted Alpaca paper account <strong><code>${escapeHtml(projection.accountId ?? "unknown")}</code></strong>. ${escapeHtml(flatLabel)}.</p>
${kpiTiles(projection)}
<p id="qualification">${escapeHtml(qualificationLine(projection))}</p>
<p id="control-model"><strong>Control model.</strong> The analyst (an LLM over Alpaca market data) may only propose schema-validated, whitelist-constrained candidates. A pure deterministic core prices each candidate from its own quotes and runs the complete gate vector G1–G8; only its approved action plans reach the executor, and every order is a limit order revalidated against fresh broker truth before submission. The LLM has no code path to an order.</p>
<h3>Golden path</h3>
${goldenPathList(goldenPath)}
</section>`;
}

function cyclesTable(projection: PerformanceProjection): string {
  return `<table><thead><tr><th>Seq</th><th>At (UTC)</th><th>Day</th><th>Type</th><th>Result</th><th>Reason codes</th><th>Equity</th><th>Candidates</th></tr></thead><tbody>${projection.cycles.map(cycleRow).join("")}</tbody></table>`;
}

function renderCyclesSection(projection: PerformanceProjection, lifecyclesBySeq: ReadonlyMap<number, LifecycleLink>): string {
  return `<section id="cycles" aria-labelledby="cycles-title">
<h2 id="cycles-title">Every cycle: proposal or no-trade, gate vector, rationale</h2>
<p class="lead">This section lists every decision cycle, whether it produced a trade or a deliberate no-trade, and the gate vector each candidate passed or failed.</p>
<p>${String(projection.cycles.length)} primary entries at this cutoff. A no-trade result is first-class evidence: the analyst proposed nothing usable or every candidate was vetoed.</p>
${cyclesTable(projection)}
${projection.cycles.map(cycle => cycleDetail(cycle, lifecyclesBySeq)).join("")}
</section>`;
}

function renderLifecyclesSection(projection: PerformanceProjection): string {
  return `<section id="lifecycles" aria-labelledby="lifecycles-title">
<h2 id="lifecycles-title">Every intent, forward to its broker outcome</h2>
<p class="lead">This section follows every submitted intent from its broker order through its fill and any close, with its profit and loss contribution.</p>
${projection.lifecycles.length === 0 ? "<p>No entry INTENT at this cutoff.</p>" : projection.lifecycles.map(lifecycleCard).join("")}
${projection.emergencyCloses.length === 0 ? "" : `<h3 id="emergency-closes">Emergency closes without a prior intent (S-CYC-06)</h3><p>These closes were submitted while the journal could not be appended. They link to their audit-gap reconciliation and are never presented as having had a prior intent.</p><ul>${projection.emergencyCloses.map(close => `<li id="reconciliation-${String(close.reconciliationSeq ?? 0)}"><code>${escapeHtml(close.attemptId)}</code> — ${escapeHtml(close.status)}, filled ${String(close.filledQuantity)} at ${formatPrice(close.avgFillPriceCents)}, cash ${formatUsd(close.cashCents)} — recorded by RECONCILIATION seq ${String(close.reconciliationSeq ?? 0)} (<code>AUDIT_GAP_EMERGENCY_CLOSE</code>, no durable prior INTENT)</li>`).join("")}</ul>`}
${projection.humanActions.length === 0 ? "" : `<h3>Human actions detected</h3><ul>${projection.humanActions.map(action => `<li>seq ${String(action.seq)} · <time>${escapeHtml(action.at)}</time> · ${escapeHtml(action.description)}</li>`).join("")}</ul>`}
</section>`;
}

function renderSourceSection(context: RenderContext, projection: PerformanceProjection): string {
  return `<section id="source" aria-labelledby="source-title">
<h2 id="source-title">Public source</h2>
<p class="lead">This section links the pure decision core and the test that exercises one named evidence-debt path, so a reader can verify the code that produced this page.</p>
<ul>
<li>Repository: <a href="${escapeHtml(context.source.repositoryUrl)}">${escapeHtml(context.source.repositoryUrl)}</a>${context.source.journalRevisionUrl === null ? "" : ` · journal revision <a href="${escapeHtml(context.source.journalRevisionUrl)}">${escapeHtml(projection.journalRevision)}</a>`}</li>
<li>The pure core: <code>${escapeHtml(context.source.corePath)}</code> — no I/O, no clock, no randomness; time, configuration, and observations are parameters.</li>
<li>One named evidence-debt path executed by a test: <code>${escapeHtml(context.source.evidenceTestPath)}</code> (${escapeHtml(context.source.evidenceDebtRow)}).</li>
</ul>
</section>`;
}

function reconciliationComponentsTable(projection: PerformanceProjection): string {
  return `<table><thead><tr><th>Component</th><th>Value</th><th>Source</th></tr></thead><tbody>
<tr><td>Start equity</td><td class="num">${formatUsd(projection.startEquityCents)}</td><td>BOOTSTRAP snapshot (broker-recorded)</td></tr>
<tr><td>Current equity</td><td class="num">${formatUsd(projection.currentEquityCents)}</td><td>latest journaled broker snapshot at or before the cutoff</td></tr>
<tr><td>Realized P&amp;L</td><td class="num">${formatUsd(projection.realizedCents)}</td><td>journaled entry and close fills joined to INTENT lifecycles</td></tr>
<tr><td>Unrealized P&amp;L</td><td class="num">${projection.unrealizedCents === null ? "UNATTRIBUTED" : formatUsd(projection.unrealizedCents)}</td><td>open lifecycles marked at the latest journaled quote samples</td></tr>
<tr><td>UNATTRIBUTED</td><td class="num">${projection.unattributedCents === null ? "n/a" : formatUsd(projection.unattributedCents)}</td><td>equity delta minus realized minus unrealized — displayed, never assigned</td></tr>
</tbody></table>`;
}

function sleeveAttributionTable(projection: PerformanceProjection): string {
  return `<table><thead><tr><th>Sleeve</th><th>Realized</th><th>Unrealized</th><th>Declared budget at risk</th><th>Lifecycles</th></tr></thead><tbody>${sleeveRow("income", projection.sleeves.income)}${sleeveRow("convex", projection.sleeves.convex)}</tbody></table>`;
}

function positionsTable(projection: PerformanceProjection): string {
  const openPositions = projection.positions.filter(position => position.quantity !== 0);
  return openPositions.length === 0 ? "<p>Zero broker positions.</p>" : `<table><thead><tr><th>Contract</th><th>Quantity</th><th>Avg entry</th><th>Note</th></tr></thead><tbody>${openPositions.map(position => `<tr><td><code>${escapeHtml(position.contractId)}</code></td><td class="num">${String(position.quantity)}</td><td class="num">${formatPrice(position.avgEntryPriceCents)}</td><td>${position.declaredExpiryHold ? "DECLARED_EXPIRY_HOLD — zero additional liability" : ""}</td></tr>`).join("")}</tbody></table>`;
}

function ordersTableBlock(projection: PerformanceProjection): string {
  return projection.openOrders.length === 0 ? "<p>Zero non-terminal orders.</p>" : `<table><thead><tr><th>Broker order</th><th>Client order</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${projection.openOrders.map(order => `<tr><td><code>${escapeHtml(order.brokerOrderId)}</code></td><td><code>${escapeHtml(order.clientOrderId)}</code></td><td>${escapeHtml(order.status)}</td><td><time>${escapeHtml(order.brokerSubmittedAt)}</time></td></tr>`).join("")}</tbody></table>`;
}

function milestonesTable(projection: PerformanceProjection): string {
  return `<table><tbody>
<tr><td>First arm (BOOTSTRAP)</td><td><time>${escapeHtml(stamp(projection.milestones.firstArmAt))}</time></td></tr>
<tr><td>First trade (first entry fill)</td><td><time>${escapeHtml(stamp(projection.milestones.firstTradeAt))}</time></td></tr>
<tr><td>Flatten (first flat snapshot on or after FLATTEN_DATE)</td><td><time>${escapeHtml(stamp(projection.milestones.flattenAt))}</time></td></tr>
<tr><td>Deadline reconciliation</td><td><time>${escapeHtml(stamp(projection.milestones.deadlineAt))}</time></td></tr>
<tr><td>Terminal</td><td><time>${escapeHtml(stamp(projection.milestones.terminalAt))}</time></td></tr>
</tbody></table>`;
}

function equityTimelineTable(projection: PerformanceProjection): string {
  return `<table><thead><tr><th>Seq</th><th>At</th><th>Equity</th><th>Cash</th></tr></thead><tbody>${projection.equitySeries.map(point => `<tr><td>${String(point.seq)}</td><td><time>${escapeHtml(point.at)}</time></td><td class="num">${formatUsd(point.equityCents)}</td><td class="num">${formatUsd(point.cashCents)}</td></tr>`).join("")}</tbody></table>`;
}

function discrepanciesBlock(projection: PerformanceProjection): string {
  return projection.discrepancies.length === 0 ? "<p>None: every total reconciles to its broker-derived components.</p>" : `<ul class="discrepancies">${projection.discrepancies.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function haltStateLine(projection: PerformanceProjection): string {
  return `<p>Halt state at cutoff: ${projection.halt.halted ? `<strong>halted</strong> (${escapeHtml(projection.halt.reason ?? "unknown")}${projection.halt.sticky ? ", sticky" : ""})` : "not halted"}.</p>`;
}

function renderReconciliationSection(projection: PerformanceProjection): string {
  return `<section id="reconciliation" aria-labelledby="reconciliation-title">
<h2 id="reconciliation-title">Account reconciliation at this cutoff</h2>
<p class="lead">This section breaks the account's equity and profit and loss into their components and lists anything the broker reports that the journal cannot explain.</p>
${reconciliationComponentsTable(projection)}
<h3>Sleeve attribution</h3>
${sleeveAttributionTable(projection)}
<h3>Positions and non-terminal orders</h3>
${positionsTable(projection)}
${ordersTableBlock(projection)}
<h3>Milestones actually observed</h3>
${milestonesTable(projection)}
<h3>Equity timeline</h3>
${equityTimelineTable(projection)}
<h3>Reconciliation discrepancies</h3>
${discrepanciesBlock(projection)}
${haltStateLine(projection)}
</section>`;
}

function renderHistorySection(context: RenderContext): string {
  return `<section id="history" aria-labelledby="history-title">
<h2 id="history-title">Immutable projections</h2>
<p class="lead">This section lists the immutable, pinned projections of earlier journal revisions.</p>
${context.pinned.length === 0 ? "<p>No pinned projection yet. The presentation-cutoff route is pinned when the uploaded artifacts are rendered.</p>" : `<ul>${context.pinned.map(pin => `<li><a href="${escapeHtml(pin.href)}">${escapeHtml(pin.cutoffKind)} cutoff ${escapeHtml(pin.cutoffAt)} · revision ${escapeHtml(pin.journalRevision)}</a></li>`).join("")}</ul>`}
</section>`;
}

function renderFooter(): string {
  return `<p class="disclaimer">Paper trading on an Alpaca paper account. This page makes no alpha, risk-adjusted-performance, or live-market claim; one week cannot prove a strategy. Numbers are comparable only at equal labelled cutoffs. The journal is append-only; corrections are new entries.</p>
</main></body></html>`;
}

export function renderDashboard(projection: PerformanceProjection, expectation: PublishExpectation, context: RenderContext): string {
  if (context.styles.trim().length === 0) throw new Error("renderDashboard: no stylesheet supplied; refusing to render an unstyled page");
  const stylesheetReasons = auditPresentationStylesheet(context.styles);
  if (stylesheetReasons.length > 0) throw new Error(`renderDashboard: stylesheet refused: ${stylesheetReasons.join("; ")}`);
  // Defence in depth (P9/R34 B2): the audit above already refuses any `<`, but a renderer that
  // inlines the text verbatim is the one place a style-block breakout would actually fire, so it
  // re-checks the exact text it is about to splice into the page.
  if (context.styles.includes("</")) throw new Error("renderDashboard: stylesheet refused: </ (style-block breakout: the inlined text could close </style> and inject markup)");
  const lifecyclesBySeq = new Map(projection.lifecycles.map(link => [link.intentSeq, link] as const));
  const firstVeto = projection.cycles.find(cycle => cycle.candidateVerdicts.some(verdict => verdict["decision"] === "VETO"));
  const firstProposal = projection.cycles.find(cycle => cycle.result === "proposal");
  const firstFilled = projection.lifecycles.find(link => link.resolution === "filled");
  const flatLabel = projection.flatState === "flat" ? "Flat: zero broker positions" : projection.flatState === "declared_expiry_hold" ? "Not flat: a declared expiry hold remains (zero additional liability)" : projection.flatState === "not_flat" ? "Not flat: open exposure" : "Exposure unknown (no snapshot at this cutoff)";
  const goldenPath = [
    ["#result", "1. The $100k paper-account result, current exposure, and the control model"],
    [firstProposal === undefined ? "#cycles" : `#cycle-${String(firstProposal.seq)}`, "2. One completed decision cycle: market context, analyst candidate, rationale"],
    [firstVeto === undefined ? "#cycles" : `#cycle-${String(firstVeto.seq)}`, "3. The complete deterministic gate vector, including a vetoed candidate"],
    [firstFilled === undefined ? "#lifecycles" : `#lifecycle-${firstFilled.exposureLifecycleId}`, "4. One approved intent to its broker order, fill/outcome, and P&L contribution"],
    ["#source", "5. The public source: the pure core and the test that executes one named evidence-debt path"],
    ["#reconciliation", "6. The account reconciliation at this cutoff"],
  ];
  const sections = [
    `${renderHead(projection, expectation, context)}\n${renderPageHeader(projection, context)}`,
    renderHowToReadSection(),
    renderResultSection(projection, flatLabel, goldenPath),
    renderCyclesSection(projection, lifecyclesBySeq),
    renderLifecyclesSection(projection),
    renderSourceSection(context, projection),
    renderReconciliationSection(projection),
    renderHistorySection(context),
    renderFooter(),
  ];
  return `${sections.join("\n\n")}\n`;
}

