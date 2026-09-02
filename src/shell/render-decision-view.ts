import type { DecisionResult, GateVerdict } from "../core/domain.js";
import { DECISION_VIEW_STYLES } from "./render-styles.js";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatMoney(cents: number | null): string {
  if (cents === null) return "not computable";
  return `$${Math.trunc(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

function gateCell(gate: GateVerdict): string {
  const detail = gate.reasons.length === 0 ? "Passed" : gate.reasons.join("; ");
  return `<li class="gate gate--${gate.passed ? "pass" : "veto"}"><span>${gate.gate}</span><strong>${gate.passed ? "PASS" : "VETO"}</strong><small>${escapeHtml(detail)}</small></li>`;
}

function vetoSummary(gates: readonly GateVerdict[]): string {
  const grouped = new Map<string, string[]>();
  for (const gate of gates.filter(candidateGate => !candidateGate.passed)) {
    const reason = gate.reasons.join("; ");
    grouped.set(reason, [...(grouped.get(reason) ?? []), gate.gate]);
  }
  return [...grouped.entries()].map(([reason, gateNames]) => `${gateNames.join("/")}: ${reason}`).join("; ");
}

/** One candidate's verdict article: rationale, the action plan it drew (if any), and its full G1–G8 gate rail. */
function decisionArticle(verdict: DecisionResult["candidateVerdicts"][number], index: number, remainingActionsByCandidate: Map<string, DecisionResult["actions"][number][]>): string {
  const action = remainingActionsByCandidate.get(verdict.candidateId)?.shift();
  const titleId = `candidate-${String(index)}-title`;
  const conclusion = action === undefined
    ? `No action plan. ${vetoSummary(verdict.gateVector)}`
    : `Action plan ${action.clientOrderId}; reserve ${formatMoney(action.reservedMaxLossCents)} at the submitted ${action.submittedLimit.kind} limit.`;
  return `<article class="decision decision--${verdict.decision.toLowerCase()}" aria-labelledby="${titleId}">
      <header><p class="eyebrow">Candidate verdict</p><div class="decision__title"><h2 id="${titleId}">${escapeHtml(verdict.candidateId)}</h2><span class="stamp">${verdict.decision}</span></div></header>
      <p class="rationale">${escapeHtml(verdict.candidateRationale)}</p>
      <dl><div><dt>Reserved max loss</dt><dd>${formatMoney(verdict.reservedMaxLossCents)}</dd></div><div><dt>Action</dt><dd>${escapeHtml(conclusion)}</dd></div></dl>
      <ol class="gate-rail" aria-label="Complete G1 through G8 verdict vector">${verdict.gateVector.map(gateCell).join("")}</ol>
    </article>`;
}

function renderHead(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glass Box — P1 decision tape</title>
<style>
${DECISION_VIEW_STYLES}
</style></head>`;
}

function renderMasthead(): string {
  return `<body><main><header class="masthead"><div><p class="eyebrow">Glass Box Trading / P1 fixture</p><h1>Every gate stays visible.</h1></div><p class="masthead__note">One pure core call produced both records. A pass is an action plan only; this fixture contains no broker-capable adapter.</p></header>`;
}

function renderTapeMeta(result: DecisionResult): string {
  return `<ul class="tape-meta"><li>8 gates × every candidate</li><li>${String(result.actions.length)} action plan</li><li>${String(result.candidateVerdicts.filter(verdict => verdict.decision === "VETO").length)} veto</li></ul>`;
}

function renderDecisionsSection(candidates: string): string {
  return `<section class="decisions" aria-label="Recorded candidate decisions">${candidates}</section>`;
}

function renderFooter(): string {
  return `<footer>Exact integer cents drive every displayed risk value. Quote observations and time were explicit inputs.</footer></main></body></html>`;
}

export function renderDecisionView(result: DecisionResult): string {
  const remainingActionsByCandidate = new Map<string, DecisionResult["actions"][number][]>();
  for (const action of result.actions) {
    const queuedActions = remainingActionsByCandidate.get(action.candidateId) ?? [];
    queuedActions.push(action);
    remainingActionsByCandidate.set(action.candidateId, queuedActions);
  }

  const candidates = result.candidateVerdicts.map((verdict, index) => decisionArticle(verdict, index, remainingActionsByCandidate)).join("");

  return `${renderHead()}${renderMasthead()}${renderTapeMeta(result)}${renderDecisionsSection(candidates)}${renderFooter()}`;
}
