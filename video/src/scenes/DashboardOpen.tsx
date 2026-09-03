// 0:30–1:00 — the public dashboard opens with no login: result, exposure,
// control model (SUBMISSION-SPEC §3 step 1). Capture: the browser loading
// meta.presentationRouteUrl in a clean profile.
import type { Dataset } from "../dataset";
import { formatBps, formatUsd } from "../format";
import { color, font } from "../theme";
import { Capture, Frame, Lead, Tile, Tiles } from "./shared";

export const DashboardOpen: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const { meta, projection } = dataset;
  const flat = projection.flatState === "flat" ? "Flat: zero broker positions" : projection.flatState === "declared_expiry_hold" ? "Declared expiry hold: not flat, zero additional liability" : "Not flat: open exposure";
  return (
    <Frame dataset={dataset} eyebrow="Golden path · 1 of 6" title="The dashboard opens without a login">
      <Lead>
        <span style={{ fontFamily: font.mono, fontSize: 30, color: color.accent }}>{meta.presentationRouteUrl}</span>
      </Lead>
      <Capture
        file={meta.captures.dashboardOpen}
        label="clean browser opens the pinned presentation route; first viewport shows result, exposure, control model"
        standIn={
          <>
            <Tiles>
              <Tile label="Current equity" value={formatUsd(projection.currentEquityCents)} note={`cash ${formatUsd(projection.currentCashCents)}`} />
              <Tile label="P&L" value={formatUsd(projection.pnlAbsoluteCents)} note={formatBps(projection.pnlBps)} />
              <Tile label="Exposure" value={flat} tone={projection.flatState === "flat" ? "pass" : "accent"} />
            </Tiles>
            <p style={{ fontSize: 30, margin: 0 }}><strong style={{ fontFamily: font.sans }}>Control model.</strong> The analyst may only propose schema-validated, whitelist-constrained candidates. A pure deterministic core runs the gate vector G1–G8; only its approved plans reach the executor. The LLM has no code path to an order.</p>
          </>
        }
      />
    </Frame>
  );
};
