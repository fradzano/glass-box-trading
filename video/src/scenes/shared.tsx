// Layout primitives shared by the scenes: a titled frame with the cutoff
// stamp, KPI tiles, key/value chains, a capture slot, and the DEV watermark.
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { CSSProperties, ReactNode } from "react";
import type { Dataset } from "../dataset";
import { formatInstant } from "../format";
import { color, font } from "../theme";

export const Frame: React.FC<{ readonly dataset: Dataset; readonly eyebrow: string; readonly title: string; readonly children: ReactNode }> = ({ dataset, eyebrow, title, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: color.paper, color: color.ink, fontFamily: font.serif, padding: "72px 96px", opacity }}>
      <div style={{ fontFamily: font.sans, fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", color: color.mute }}>{eyebrow}</div>
      <h1 style={{ fontFamily: font.sans, fontSize: 60, letterSpacing: "-0.01em", margin: "8px 0 32px", lineHeight: 1.1 }}>{title}</h1>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24, minHeight: 0 }}>{children}</div>
      <div style={{ fontFamily: font.sans, fontSize: 22, color: color.mute, borderTop: `1px solid ${color.rule}`, paddingTop: 16, display: "flex", justifyContent: "space-between" }}>
        <span>Paper account <span style={{ fontFamily: font.mono, color: color.ink }}>{dataset.projection.accountId ?? "unknown"}</span> · presentation cutoff {formatInstant(dataset.projection.cutoff.at)}</span>
        <span>journal revision <span style={{ fontFamily: font.mono }}>{dataset.projection.journalRevision}</span></span>
      </div>
    </AbsoluteFill>
  );
};

export const Tile: React.FC<{ readonly label: string; readonly value: string; readonly note?: string; readonly tone?: "ink" | "pass" | "veto" | "accent" }> = ({ label, value, note, tone = "ink" }) => (
  <div style={{ border: `1px solid ${color.rule}`, background: color.white, padding: "20px 28px", minWidth: 300, flex: 1 }}>
    <div style={{ fontFamily: font.sans, fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase", color: color.mute }}>{label}</div>
    <div style={{ fontFamily: font.mono, fontSize: 48, margin: "8px 0 4px", color: color[tone] }}>{value}</div>
    {note === undefined ? null : <div style={{ fontSize: 24, color: color.mute }}>{note}</div>}
  </div>
);

export const Tiles: React.FC<{ readonly children: ReactNode }> = ({ children }) => <div style={{ display: "flex", gap: 20 }}>{children}</div>;

export const Chain: React.FC<{ readonly rows: readonly (readonly [string, string])[]; readonly style?: CSSProperties; readonly dense?: boolean }> = ({ rows, style, dense = false }) => (
  <dl style={{ margin: 0, fontSize: 30, ...style }}>
    {rows.map(([term, detail]) => (
      <div key={term} style={{ display: "grid", gridTemplateColumns: "320px minmax(0, 1fr)", gap: 24, padding: dense ? "5px 0" : "10px 0", borderTop: `1px dotted ${color.rule}` }}>
        <dt style={{ fontFamily: font.sans, fontSize: 22, textTransform: "uppercase", letterSpacing: "0.08em", color: color.mute, paddingTop: 6 }}>{term}</dt>
        <dd style={{ margin: 0, fontFamily: font.mono, overflowWrap: "anywhere" }}>{detail}</dd>
      </div>
    ))}
  </dl>
);

export const Lead: React.FC<{ readonly children: ReactNode }> = ({ children }) => <p style={{ fontSize: 34, lineHeight: 1.4, margin: 0, maxWidth: 1500 }}>{children}</p>;

export const Stamp: React.FC<{ readonly tone: "pass" | "veto" | "accent"; readonly children: ReactNode }> = ({ tone, children }) => (
  <span style={{ fontFamily: font.sans, fontSize: 22, padding: "4px 12px", border: `1px solid ${color[tone]}`, color: color[tone], borderRadius: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</span>
);

/**
 * A screen recording from public/captures/ when meta names one; otherwise a
 * labelled stand-in that shows what the recording must contain. The frozen
 * render refuses a missing capture (scripts/check-dataset.mjs --frozen).
 */
export const Capture: React.FC<{ readonly file: string | null; readonly standIn: ReactNode; readonly label: string }> = ({ file, standIn, label }) => {
  if (file !== null) {
    // The slot must take the remaining height of the frame's column, not 100% of the column (which ran the recording over the footer rule).
    return (
      <div style={{ flex: 1, minHeight: 0, border: `1px solid ${color.rule}`, background: color.white, display: "flex" }}>
        <OffthreadVideo src={staticFile(`captures/${file}`)} muted style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    );
  }
  return (
    <div style={{ flex: 1, border: `2px dashed ${color.veto}`, background: color.white, padding: 28, display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflow: "hidden" }}>
      <div style={{ fontFamily: font.sans, fontSize: 22, color: color.veto, textTransform: "uppercase", letterSpacing: "0.08em" }}>capture pending — {label}</div>
      {standIn}
    </div>
  );
};

export const DevWatermark: React.FC<{ readonly note: string }> = ({ note }) => (
  <div style={{ position: "absolute", top: 24, right: 24, maxWidth: 640, fontFamily: font.sans, fontSize: 20, color: color.white, background: color.veto, padding: "10px 16px", opacity: 0.92 }}>
    DEV DATASET — not the frozen presentation cutoff. {note}
  </div>
);

/** Reveals children one after another, `stepFrames` apart. */
export const Steps: React.FC<{ readonly items: readonly ReactNode[]; readonly stepFrames?: number; readonly gap?: number }> = ({ items, stepFrames = 20, gap = 16 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {items.map((item, index) => (
        <div key={index} style={{ opacity: interpolate(frame, [index * stepFrames, index * stepFrames + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{item}</div>
      ))}
    </div>
  );
};
