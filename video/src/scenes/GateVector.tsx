// 1:40–2:15 — the complete deterministic gate vector, with at least one
// vetoed candidate so safety is observed, not asserted (§3 step 3).
import type { Dataset } from "../dataset";
import { featuredCycle, vetoExample } from "../dataset";
import { formatUsd } from "../format";
import { color, font } from "../theme";
import { Capture, Frame, Lead, Stamp, Steps } from "./shared";

const GATE_NAMES: Readonly<Record<string, string>> = {
  G1: "defined risk", G2: "sleeve budget", G3: "max loss per position", G4: "underlying exposure",
  G5: "liquidity", G6: "session tradability", G7: "idempotency", G8: "schema whitelist",
};

export const GateVector: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const example = vetoExample(dataset, featuredCycle(dataset));
  return (
    <Frame dataset={dataset} eyebrow="Golden path · 3 of 6" title="Eight gates, every one recorded — and a veto">
      <Lead>The core prices each candidate from its own quotes and runs G1–G8. A single failed gate vetoes the candidate; the journal keeps the whole vector either way.</Lead>
      <Capture
        file={dataset.meta.captures.gateVector}
        label="the gate rail of a vetoed candidate, failed gate highlighted"
        standIn={
          example === null ? <p style={{ fontSize: 30 }}>No vetoed candidate at this cutoff.</p> : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                <span style={{ fontFamily: font.mono, fontSize: 32 }}>{example.verdict.candidateId}</span>
                <Stamp tone="veto">{example.verdict.decision}</Stamp>
                <span style={{ fontFamily: font.sans, fontSize: 24, color: color.mute }}>cycle seq {String(example.cycle.seq)} · reserved max loss {formatUsd(example.verdict.reservedMaxLossCents ?? null)}</span>
              </div>
              <Steps stepFrames={12} gap={10} items={example.verdict.gateVector.map(gate => (
                <div key={gate.gate} style={{ display: "grid", gridTemplateColumns: "90px 360px 200px minmax(0, 1fr)", gap: 20, alignItems: "baseline", border: `1px solid ${gate.passed ? color.rule : color.veto}`, background: color.white, padding: "8px 16px" }}>
                  <span style={{ fontFamily: font.mono, fontSize: 28 }}>{gate.gate}</span>
                  <span style={{ fontFamily: font.sans, fontSize: 24, color: color.mute }}>{GATE_NAMES[gate.gate] ?? ""}</span>
                  <span style={{ fontFamily: font.sans, fontSize: 24, color: gate.passed ? color.pass : color.veto, fontWeight: 700 }}>{gate.code}</span>
                  <span style={{ fontFamily: font.mono, fontSize: 22, color: color.mute, overflowWrap: "anywhere" }}>{gate.reasons.join("; ")}</span>
                </div>
              ))} />
            </>
          )
        }
      />
    </Frame>
  );
};
