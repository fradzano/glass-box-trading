// Placeholder injection for the submission texts (SUB-03/05/07/09): every
// {{TOKEN}} in a source file resolves from the single frozen presentation-
// cutoff dataset under video/public/dataset/ (meta.json + projection.json).
// Pure derivation, then one write. Fails loudly on an unknown or unresolved
// token so no artifact can carry a placeholder or a hand-typed figure.
//   node submission/render/inject.mjs <source.md> <target.md>
//   node submission/render/inject.mjs --values      (prints the value table)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const datasetDir = path.join(here, "..", "..", "video", "public", "dataset");
const meta = JSON.parse(readFileSync(path.join(datasetDir, "meta.json"), "utf8"));
const projection = JSON.parse(readFileSync(path.join(datasetDir, "projection.json"), "utf8"));

// Same integer-cent rules as the dashboard renderer and video/src/format.ts.
function usd(cents) {
  if (cents === null || cents === undefined) throw new Error("usd(null)");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}
function pct(bps) {
  if (bps === null || bps === undefined) throw new Error("pct(null)");
  const sign = bps < 0 ? "-" : "";
  const abs = Math.abs(bps);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}%`;
}

export function deriveValues(meta, projection) {
  if (meta.frozen !== true) throw new Error("dataset is not frozen");
  if (projection.cutoff.kind !== "presentation") throw new Error("cutoff kind is not presentation");
  if (projection.cutoff.at !== meta.presentationCutoffAt) throw new Error("cutoff mismatch meta/projection");
  if (projection.accountId !== meta.accountId) throw new Error("account mismatch meta/projection");
  let candidates = 0, vetoes = 0, noTrade = 0;
  for (const cycle of projection.cycles) {
    candidates += cycle.candidateVerdicts.length;
    vetoes += cycle.candidateVerdicts.filter(v => v.decision === "VETO").length;
    if (cycle.result === "no_trade") noTrade += 1;
  }
  const safe = projection.journalRevision.replace(":", "-");
  if (!meta.presentationRouteUrl.includes(`/revisions/${safe}/presentation/`)) throw new Error("route URL does not name the pinned revision");
  return {
    JOURNAL_REVISION: projection.journalRevision,
    JOURNAL_REVISION_SAFE: safe,
    PRESENTATION_CUTOFF_AT: projection.cutoff.at,
    PRESENTATION_ROUTE_URL: meta.presentationRouteUrl,
    ACCOUNT_ID: projection.accountId,
    DEMO_URL: meta.demoUrl,
    REPO_URL: meta.repositoryUrl,
    START_EQUITY: usd(projection.startEquityCents),
    CURRENT_EQUITY: usd(projection.currentEquityCents),
    CURRENT_CASH: usd(projection.currentCashCents),
    PNL_ABS: usd(projection.pnlAbsoluteCents),
    PNL_PCT: pct(projection.pnlBps),
    REALIZED_PNL: usd(projection.realizedCents),
    UNREALIZED_PNL: usd(projection.unrealizedCents),
    UNATTRIBUTED: usd(projection.unattributedCents),
    INCOME_SLEEVE_PNL: usd(projection.sleeves.income.realizedCents),
    CONVEX_SLEEVE_PNL: usd(projection.sleeves.convex.realizedCents),
    INCOME_LIFECYCLES: String(projection.sleeves.income.lifecycleCount),
    CONVEX_LIFECYCLES: String(projection.sleeves.convex.lifecycleCount),
    MAX_DRAWDOWN: usd(projection.maxDrawdownCents),
    MAX_DRAWDOWN_PCT: pct(projection.maxDrawdownBps),
    PEAK_EQUITY: usd(projection.peakEquityCents),
    CYCLE_COUNT: String(projection.cycles.length),
    CANDIDATE_COUNT: String(candidates),
    VETOED_CANDIDATE_COUNT: String(vetoes),
    NO_TRADE_CYCLE_COUNT: String(noTrade),
    LIFECYCLE_COUNT: String(projection.lifecycles.length),
    QUALIFYING_FILLS: String(projection.qualification.fills.length),
    FLAT_STATE: projection.flatState,
    FIRST_TRADE_AT: projection.milestones.firstTradeAt,
    FLATTEN_AT: projection.milestones.flattenAt,
    BOOTSTRAP_AT: projection.milestones.firstArmAt,
    LAST_SEQ: String(projection.lastSeq),
    HALT_REASON: projection.halt?.reason ?? "none",
  };
}

export function inject(text, values) {
  const unknown = [];
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, token) => {
    if (token in values) return values[token];
    unknown.push(token);
    return whole;
  });
  if (unknown.length > 0) throw new Error(`unresolved placeholders: ${[...new Set(unknown)].join(", ")}`);
  if (/{{[A-Z_]+}}/.test(out)) throw new Error("a placeholder survived injection");
  return out;
}

const values = deriveValues(meta, projection);
const [, , source, target] = process.argv;
if (source === "--values") {
  for (const [k, v] of Object.entries(values)) process.stdout.write(`${k}\t${v}\n`);
} else if (source && target) {
  const out = inject(readFileSync(source, "utf8"), values);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, out, "utf8");
  process.stdout.write(`injected ${source} -> ${target} (revision ${values.JOURNAL_REVISION}, cutoff ${values.PRESENTATION_CUTOFF_AT})\n`);
} else {
  process.stderr.write("usage: node submission/render/inject.mjs <source> <target> | --values\n");
  process.exit(2);
}
