// 0:00–0:30 — the auditability problem, the glass-box answer, the result.
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Dataset } from "../dataset";
import { countVerdicts } from "../dataset";
import { formatBps, formatInstant, formatUsd } from "../format";
import { color, font } from "../theme";
import { Tile, Tiles } from "./shared";

export const ColdOpen: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const frame = useCurrentFrame();
  const { projection } = dataset;
  const counts = countVerdicts(projection);
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  const problemOpacity = interpolate(frame, [90, 110], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const answerOpacity = interpolate(frame, [300, 320], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const resultOpacity = interpolate(frame, [540, 560], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: color.paper, color: color.ink, fontFamily: font.serif, padding: "120px 140px", justifyContent: "center", gap: 40 }}>
      <div style={{ opacity: titleOpacity }}>
        <div style={{ fontFamily: font.sans, fontSize: 24, letterSpacing: "0.14em", textTransform: "uppercase", color: color.mute }}>Alpaca AI Trading Agents Hackathon · paper trading</div>
        <h1 style={{ fontFamily: font.sans, fontSize: 112, letterSpacing: "-0.02em", margin: "8px 0 0", lineHeight: 1 }}>Glass Box Trading</h1>
      </div>
      <p style={{ fontSize: 44, lineHeight: 1.35, margin: 0, maxWidth: 1500, opacity: problemOpacity }}>
        An autonomous trading agent is easy to claim and hard to audit. What did it consider, what did it refuse, and who actually placed the order?
      </p>
      <p style={{ fontSize: 44, lineHeight: 1.35, margin: 0, maxWidth: 1500, opacity: answerOpacity }}>
        <strong style={{ fontFamily: font.sans }}>AI proposes; deterministic gates dispose.</strong> Every candidate, every veto and every fill sits in a public, append-only journal.
      </p>
      <div style={{ opacity: resultOpacity }}>
        <Tiles>
          <Tile label="Start equity (BOOTSTRAP)" value={formatUsd(projection.startEquityCents)} note="dedicated $100k paper account" />
          <Tile label="P&L vs. broker-recorded start" value={formatUsd(projection.pnlAbsoluteCents)} note={`${formatBps(projection.pnlBps)} · as of ${formatInstant(projection.cutoff.at)}`} tone={(projection.pnlAbsoluteCents ?? 0) < 0 ? "veto" : "pass"} />
          <Tile label="Decisions journaled" value={String(counts.cycles)} note={`${String(counts.candidates)} candidates, ${String(counts.vetoes)} vetoed, ${String(counts.noTrade)} no-trade cycles`} tone="accent" />
        </Tiles>
      </div>
    </AbsoluteFill>
  );
};
