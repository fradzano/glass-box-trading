# Form copy — SUB-07

Source of truth for the actual submission form fields. Any mutable number
below is injected from the single frozen presentation-cutoff dataset (the
pinned presentation route's
`revisions/{{JOURNAL_REVISION}}/presentation/projection.json`, produced by the
dashboard publish pipeline at {{PRESENTATION_CUTOFF_AT}}) — never hand-typed.
Once the actual form is copied, this file must match it exactly (SUB-09
preflight checks this).

## Title

> Glass Box Trading

- [ ] Character count: 19 / 50 max

## Short description

> An options trading agent that journals every candidate and veto in public;
> deterministic risk gates, not the LLM, decide every order.

- [ ] Character count: 133 / 255 max

## Long description

> Glass Box Trading is an autonomous options trading agent built for the
> Alpaca AI Trading Agents Hackathon, run against a dedicated $100k paper
> competition account. Its central claim is architectural, not predictive:
> the LLM analyst can propose a trade candidate but has no code path to an
> order, and the deterministic decision core can place an order but evaluates
> only structured, whitelist-constrained fields — the LLM's free-text
> reasoning is stored in the journal for review, never read by a gate. Every
> decision cycle — a proposed
> candidate, a full risk-gate vector, and either an approval or a veto with
> its reason — is written to an append-only public journal and rendered on a
> live dashboard, with no authentication required to view it. Rejections are
> logged with the same fidelity as executions, so the agent's caution is
> visible, not just its wins.
>
> The strategy is a declared two-sleeve barbell: roughly 80 percent of the
> account sits idle as reserve, about 12 percent (measured on a worst-case-loss
> basis) funds defined-risk income structures such as credit spreads and iron
> condors, and about 8 percent (measured on premium paid) funds convex,
> capped-loss positions around scheduled events. No naked short options exist
> anywhere in the strategy space; maximum loss is fixed at order construction
> for every position. A pure, independently tested decision core owns every
> risk gate — entry gates, lifecycle gates such as expiry eviction and
> deadline flatten, and failure gates such as a drawdown kill-switch and a
> dead-man watchdog — so unattended worst case is bounded by design rather
> than by monitoring diligence.
>
> The submission includes a public repository with the pure core and its
> tests, a live demo dashboard, a sub-five-minute video walking one decision
> from candidate to broker fill, and a broker-reconciled P&L record at a
> labelled presentation cutoff. The project makes no alpha or
> risk-adjusted-performance claim: one week of paper trading cannot prove a
> strategy has edge, and every result shown is explicitly framed as a bounded,
> auditable exercise rather than proof of trading skill.

- [ ] Word count: 335 (≥100 required)

## Proposed tags

> options-trading, ai-agents, alpaca, risk-management, autonomous-trading,
> paper-trading, fintech, defined-risk, transparency, mcp

- [ ] Tag count and format checked against the actual form's tag input
      (delimiter, max count, allowed characters) at preflight time.
