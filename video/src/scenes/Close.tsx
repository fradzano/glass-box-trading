// 4:55–4:59 — demo URL and project name.
import { AbsoluteFill } from "remotion";
import type { Dataset } from "../dataset";
import { color, font } from "../theme";

export const Close: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => (
  <AbsoluteFill style={{ background: color.ink, color: color.paper, fontFamily: font.sans, alignItems: "center", justifyContent: "center", gap: 24 }}>
    <div style={{ fontSize: 96, letterSpacing: "-0.02em" }}>Glass Box Trading</div>
    <div style={{ fontFamily: font.mono, fontSize: 44, color: color.rule }}>{dataset.meta.demoUrl}</div>
    <div style={{ fontSize: 26, color: color.mute }}>AI proposes; deterministic gates dispose.</div>
    <div style={{ position: "absolute", bottom: 28, right: 40, fontSize: 18, color: color.mute }}>Voice-over synthesized with ElevenLabs.</div>
  </AbsoluteFill>
);
