// 3:40–4:25 — P&L, both sleeves, budgets at risk, drawdown, and what one
// week cannot prove.
import type { Dataset } from "../dataset";
import { formatBps, formatUsd } from "../format";
import { color, font } from "../theme";
import { Frame, Lead, Steps, Tile, Tiles } from "./shared";

export const PnlAndLimits: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const { projection } = dataset;
  const { income, convex } = projection.sleeves;
  return (
    <Frame dataset={dataset} eyebrow="Result and limits" title="Broker-reconciled P&L, by sleeve">
      <Tiles>
        <Tile label="P&L vs. start" value={formatUsd(projection.pnlAbsoluteCents)} note={formatBps(projection.pnlBps)} tone={(projection.pnlAbsoluteCents ?? 0) < 0 ? "veto" : "pass"} />
        <Tile label="Realized / unrealized" value={formatUsd(projection.realizedCents)} note={`unrealized ${projection.unrealizedCents === null ? "unattributed" : formatUsd(projection.unrealizedCents)}`} />
        <Tile label="Max drawdown" value={formatUsd(projection.maxDrawdownCents)} note={`${formatBps(projection.maxDrawdownBps)} of peak ${formatUsd(projection.peakEquityCents)}`} />
        <Tile label="Unattributed" value={formatUsd(projection.unattributedCents)} note="equity delta not explained by joined fills and marks" tone={projection.unattributedCents === 0 ? "pass" : "accent"} />
      </Tiles>
      <Tiles>
        <Tile label="Income sleeve" value={formatUsd(income.realizedCents + (income.unrealizedCents ?? 0))} note={`${String(income.lifecycleCount)} lifecycles · budget at risk ${formatUsd(income.budgetAtRiskCents)}`} tone="accent" />
        <Tile label="Convex sleeve" value={formatUsd(convex.realizedCents + (convex.unrealizedCents ?? 0))} note={`${String(convex.lifecycleCount)} lifecycles · budget at risk ${formatUsd(convex.budgetAtRiskCents)}`} tone="accent" />
      </Tiles>
      <Steps stepFrames={60} items={[
        <Lead key="a">Every figure is an integer-cent fold of the journal against broker snapshots at the labelled cutoff. A remainder the joined fills cannot explain is shown as <span style={{ fontFamily: font.mono }}>UNATTRIBUTED</span>, not hidden.</Lead>,
        <Lead key="b">Maximum loss is reserved at order entry for every lifecycle; the sleeve budgets bound what unattended operation can lose before a kill switch or the watchdog acts.</Lead>,
        <Lead key="c"><strong style={{ fontFamily: font.sans, color: color.veto }}>What two sessions cannot prove:</strong> that this strategy has edge. The result is a bounded, auditable exercise on paper, and it is presented as nothing more.</Lead>,
      ]} />
    </Frame>
  );
};
