import type { DecisionResult, GateVerdict } from "../core/domain.js";

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

export function renderDecisionView(result: DecisionResult): string {
  const actions = new Map(result.actions.map(action => [action.candidateId, action]));
  const candidates = result.candidateVerdicts.map(verdict => {
    const action = actions.get(verdict.candidateId);
    const conclusion = action === undefined
      ? `No action plan. ${vetoSummary(verdict.gateVector)}`
      : `Action plan ${action.clientOrderId}; reserve ${formatMoney(action.reservedMaxLossCents)} at the submitted ${action.submittedLimit.kind} limit.`;
    return `<article class="decision decision--${verdict.decision.toLowerCase()}" aria-labelledby="${escapeHtml(verdict.candidateId)}-title">
      <header><p class="eyebrow">Candidate verdict</p><div class="decision__title"><h2 id="${escapeHtml(verdict.candidateId)}-title">${escapeHtml(verdict.candidateId)}</h2><span class="stamp">${verdict.decision}</span></div></header>
      <p class="rationale">${escapeHtml(verdict.candidateRationale)}</p>
      <dl><div><dt>Reserved max loss</dt><dd>${formatMoney(verdict.reservedMaxLossCents)}</dd></div><div><dt>Action</dt><dd>${escapeHtml(conclusion)}</dd></div></dl>
      <ol class="gate-rail" aria-label="Complete G1 through G8 verdict vector">${verdict.gateVector.map(gateCell).join("")}</ol>
    </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glass Box — P1 decision tape</title>
<style>
:root{--paper:#f3f6f4;--ink:#132019;--muted:#52635a;--rule:#b9c5be;--pass:#176347;--pass-wash:#dcece4;--veto:#963d2e;--veto-wash:#f3dfda;--panel:#fbfcfb;--shadow:rgba(18,42,29,.08);--font-body:"Segoe UI","Helvetica Neue",sans-serif;--font-data:"Cascadia Code","SFMono-Regular",Consolas,monospace}
*{box-sizing:border-box}html{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;background:var(--paper);color:var(--ink)}body{margin:0;font:16px/1.6 var(--font-body)}main{width:min(1480px,calc(100% - 48px));margin:0 auto;padding:64px 0 96px}.masthead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:end;padding-bottom:24px;border-bottom:2px solid var(--ink)}.eyebrow{margin:0 0 8px;font:700 12px/1.2 var(--font-data);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}h1,h2{margin:0;text-wrap:balance}h1{max-width:18ch;font-size:clamp(40px,7vw,88px);line-height:.95;letter-spacing:-.05em}h2{font-size:24px;line-height:1.2}.masthead__note{max-width:38ch;margin:0;color:var(--muted);text-wrap:pretty}.tape-meta{display:flex;flex-wrap:wrap;gap:8px 24px;margin:20px 0 48px;padding:0;list-style:none;font:600 14px/1.4 var(--font-data);font-variant-numeric:tabular-nums}.decisions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.decision{min-width:0;padding:32px;background:var(--panel);box-shadow:0 1px 2px var(--shadow),0 8px 24px var(--shadow)}.decision--pass{border-top:8px solid var(--pass)}.decision--veto{border-top:8px solid var(--veto)}.decision__title{display:flex;align-items:center;justify-content:space-between;gap:16px}.stamp{padding:6px 10px;font:800 13px/1 var(--font-data);letter-spacing:.1em}.decision--pass .stamp{background:var(--pass-wash);color:var(--pass)}.decision--veto .stamp{background:var(--veto-wash);color:var(--veto)}.rationale{max-width:60ch;min-height:52px;margin:24px 0;color:var(--muted);text-wrap:pretty}dl{display:grid;gap:0;margin:0 0 32px;border-top:1px solid var(--rule)}dl>div{display:grid;grid-template-columns:160px 1fr;gap:16px;padding:12px 0;border-bottom:1px solid var(--rule)}dt{color:var(--muted)}dd{margin:0;font-family:var(--font-data);font-variant-numeric:tabular-nums}.gate-rail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:0;padding:0;list-style:none}.gate{display:grid;grid-template-rows:auto auto 1fr;min-height:120px;padding:12px;background:var(--paper)}.gate>span,.gate>strong{font-family:var(--font-data)}.gate>span{font-size:12px;color:var(--muted)}.gate>strong{font-size:14px}.gate>small{margin-top:12px;font-size:12px;line-height:1.35;color:var(--muted);overflow-wrap:anywhere}.gate--pass>strong{color:var(--pass)}.gate--veto{background:var(--veto-wash)}.gate--veto>strong{color:var(--veto)}footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--rule);color:var(--muted);font-size:14px}
@media(max-width:960px){main{width:min(100% - 32px,720px);padding-top:32px}.masthead,.decisions{grid-template-columns:1fr}.rationale{min-height:0}}@media(max-width:560px){main{width:min(100% - 24px,520px)}.decision{padding:20px}.decision__title,dl>div{grid-template-columns:1fr;display:grid}.stamp{justify-self:start}.gate-rail{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><main><header class="masthead"><div><p class="eyebrow">Glass Box Trading / P1 fixture</p><h1>Every gate stays visible.</h1></div><p class="masthead__note">One pure core call produced both records. A pass is an action plan only; this fixture contains no broker-capable adapter.</p></header><ul class="tape-meta"><li>8 gates × every candidate</li><li>${String(result.actions.length)} action plan</li><li>${String(result.candidateVerdicts.filter(verdict => verdict.decision === "VETO").length)} veto</li></ul><section class="decisions" aria-label="Recorded candidate decisions">${candidates}</section><footer>Exact integer cents drive every displayed risk value. Quote observations and time were explicit inputs.</footer></main></body></html>`;
}
