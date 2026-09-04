// 2:15–2:45 — one approved intent to its Alpaca order, fill and P&L
// contribution (§3 step 4).
import type { Dataset } from "../dataset";
import { featuredLifecycle } from "../dataset";
import { formatPriceCents, formatUsd } from "../format";
import { color, font } from "../theme";
import { Capture, Chain, Frame, Lead, Stamp } from "./shared";

export const OrderToOutcome: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => {
  const lifecycle = featuredLifecycle(dataset);
  return (
    <Frame dataset={dataset} eyebrow="Golden path · 4 of 6" title="Intent → broker order → fill → P&L">
      <Lead>Every INTENT links forward to its broker OUTCOME or to an explicit unresolved state. The order id, the fill price and the reserved maximum loss are journal facts, not narration.</Lead>
      <Capture
        file={dataset.meta.captures.orderToOutcome}
        label="follow the featured lifecycle card: INTENT seq, OUTCOME seq, broker order id, fill, contribution"
        standIn={
          lifecycle === null ? <p style={{ fontSize: 30 }}>No entry INTENT at this cutoff.</p> : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                <span style={{ fontFamily: font.sans, fontSize: 34 }}>{lifecycle.underlying} {lifecycle.structureType.replace("_", " ")} · {lifecycle.sleeve} sleeve</span>
                <Stamp tone={lifecycle.resolution === "filled" ? "pass" : lifecycle.resolution === "unresolved" ? "veto" : "accent"}>{lifecycle.resolution}</Stamp>
                <span style={{ fontFamily: font.sans, fontSize: 24, color: color.mute }}>{String(lifecycle.closes.length)} close attempt(s) recorded</span>
              </div>
              <Chain dense rows={[
                ["INTENT seq", String(lifecycle.intentSeq)],
                ["OUTCOME seq", lifecycle.outcomeSeq === null ? "— (unresolved)" : String(lifecycle.outcomeSeq)],
                ["Client order id", lifecycle.clientOrderId],
                ["Broker order id", lifecycle.brokerOrderId ?? "—"],
                ["Limit", `${formatPriceCents(lifecycle.submittedLimitCents)} ${lifecycle.limitKind} · qty ${String(lifecycle.approvedQuantity)}`],
                ["Fill", `${String(lifecycle.filledQuantity)} at ${formatPriceCents(lifecycle.avgFillPriceCents)}`],
                ["Reserved max loss", formatUsd(lifecycle.reservedMaxLossCents)],
                ["Contribution", `realized ${formatUsd(lifecycle.realizedCents)} · unrealized ${formatUsd(lifecycle.unrealizedCents)}`],
              ]} />
            </>
          )
        }
      />
    </Frame>
  );
};
