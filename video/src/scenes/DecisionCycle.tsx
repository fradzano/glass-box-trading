// 1:00–1:40 — one completed decision cycle: market context, the analyst's
// candidate, its candidate-specific rationale (§3 step 2).
import type { Dataset } from "../dataset";
import { approvedVerdict, featuredCycle } from "../dataset";
import { formatInstant, formatUsd } from "../format";
import { color, font } from "../theme";
import { Capture, Chain, Frame, Lead, Stamp } from "./shared";

export const DecisionCycle: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const cycle = featuredCycle(dataset);
  const verdict = approvedVerdict(cycle) ?? cycle?.candidateVerdicts.find(candidate => candidate.gateVector !== undefined) ?? null;
  return (
    <Frame dataset={dataset} eyebrow="Golden path · 2 of 6" title={cycle === null ? "One decision cycle" : `Cycle seq ${String(cycle.seq)} · ${formatInstant(cycle.at)}`}>
      <Lead>The analyst reads Alpaca market data through a read-only MCP inventory and proposes candidates. Each candidate carries its own rationale; the rationale is stored for review and never read by a gate.</Lead>
      <Capture
        file={dataset.meta.captures.decisionCycle}
        label="scroll to the featured cycle: context, candidate, rationale"
        standIn={
          cycle === null || verdict === null ? <p style={{ fontSize: 30 }}>No cycle with candidates at this cutoff.</p> : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                <span style={{ fontFamily: font.mono, fontSize: 34 }}>{verdict.candidateId}</span>
                <Stamp tone={verdict.decision === "VETO" ? "veto" : "pass"}>{verdict.decision}</Stamp>
                <span style={{ fontFamily: font.sans, fontSize: 24, color: color.mute }}>{String(cycle.candidateVerdicts.length)} candidate(s) this cycle · result {cycle.result.replace("_", " ")}</span>
              </div>
              <p style={{ fontStyle: "italic", fontSize: 30, margin: 0, lineHeight: 1.4 }}>“{verdict.candidateRationale ?? ""}”</p>
              <Chain rows={[["Reserved max loss", formatUsd(verdict.reservedMaxLossCents ?? null)], ["Equity at cycle", formatUsd(cycle.equityCents)], ["Reason codes", cycle.reasonCodes.length === 0 ? "—" : cycle.reasonCodes.join(", ")]]} />
            </>
          )
        }
      />
    </Frame>
  );
};
