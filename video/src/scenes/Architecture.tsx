// 2:45–3:40 — the architecture boundary and why the LLM cannot place an order.
import type { Dataset } from "../dataset";
import { color, font } from "../theme";
import { Frame, Lead, Steps } from "./shared";

const Box: React.FC<{ readonly title: string; readonly lines: readonly string[]; readonly tone: "accent" | "pass" | "ink" }> = ({ title, lines, tone }) => (
  <div style={{ flex: 1, border: `2px solid ${color[tone]}`, background: color.white, padding: "24px 28px", minHeight: 320 }}>
    <div style={{ fontFamily: font.sans, fontSize: 34, color: color[tone], marginBottom: 12 }}>{title}</div>
    {lines.map(line => <div key={line} style={{ fontSize: 26, lineHeight: 1.4 }}>{line}</div>)}
  </div>
);

const Arrow: React.FC<{ readonly label: string }> = ({ label }) => (
  <div style={{ width: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
    <div style={{ fontSize: 64, color: color.mute }}>→</div>
    <div style={{ fontFamily: font.sans, fontSize: 20, color: color.mute, textAlign: "center" }}>{label}</div>
  </div>
);

export const Architecture: React.FC<{ readonly dataset: Dataset }> = ({ dataset }) => (
  <Frame dataset={dataset} eyebrow="Architecture" title="Why the LLM cannot place an order">
    <Lead>Functional core, imperative shell. The decision logic is pure: time, configuration and the broker snapshot are parameters. Everything that touches the world is a thin shell that applies the core's verdicts.</Lead>
    <div style={{ display: "flex", alignItems: "stretch" }}>
      <Box tone="accent" title="Analyst (LLM)" lines={["reads Alpaca market data through a read-only MCP inventory", "returns schema-validated candidates only", "whitelist: underlyings, structures, expiries", "free-text rationale is stored, never read by a gate"]} />
      <Arrow label="candidates (data)" />
      <Box tone="pass" title="Decision core (pure)" lines={["prices each candidate from its own quotes", "gate vector G1–G8, defined risk first", "sleeve budgets, exposure caps, liquidity, session, idempotency", "emits approved action plans or vetoes with reasons"]} />
      <Arrow label="approved plans" />
      <Box tone="ink" title="Executor (shell)" lines={["the only module that submits orders", "limit orders, revalidated against fresh broker truth", "journals INTENT before, OUTCOME after", "fenced by epoch and halt state"]} />
    </div>
    <Steps stepFrames={45} items={[
      <p key="a" style={{ fontSize: 30, margin: 0 }}>The analyst's output is a data structure. Nothing in it is executable, and the executor never sees it: it sees the core's plan.</p>,
      <p key="b" style={{ fontSize: 30, margin: 0 }}>No code path constructs a position whose maximum loss is not fixed at order entry. No naked short options exist in the whitelist.</p>,
      <p key="c" style={{ fontSize: 30, margin: 0 }}>An architecture gate in CI refuses I/O imports and ambient clocks inside the core, so the boundary is checked, not promised.</p>,
    ]} />
  </Frame>
);
