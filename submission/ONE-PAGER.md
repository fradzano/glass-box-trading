<!--
SUB-03 source. Renders to submission/glass-box-trading-one-pager.pdf.
All bracketed placeholders below are injected from the single frozen
presentation-cutoff dataset: the pinned presentation route's
revisions/{{JOURNAL_REVISION}}/presentation/projection.json, produced by the
dashboard publish pipeline at the Sep 3 post-close presentation cutoff
({{PRESENTATION_CUTOFF_AT}}). No number here is invented or hand-typed at
render time; the render step must fail loudly if a placeholder is left
unresolved. Target length: one page, under ~480 words.
-->

# Glass Box Trading

**AI proposes; deterministic gates dispose.**

## Thesis, and who it is for

An autonomous options trading agent whose every candidate, veto, and executed
trade is public and broker-reconciled, because a system that manages risk
unattended must be auditable by someone other than its builder. It is for
traders and allocators who want unattended execution but distrust opaque "AI
trading bot" claims: each decision is journaled before the agent acts, so a
reviewer can check reasoning against outcome without taking anyone's word for
it.

## How it works

A scheduled cycle asks an LLM analyst (Alpaca MCP server, read-only market
data) for defined-risk options candidates; the output is schema-validated,
whitelist-constrained, and never touches an order. A pure, tested decision
core scores every candidate against a fixed gate catalog — sleeve budgets,
max loss, concentration, liquidity, session, lifecycle — and returns approve
or veto with reasons. Only core-approved actions reach the executor, which
places paper orders on the $100k competition account and journals intent
before submission, outcome after. That journal is append-only and public; the
dashboard needs no login.

## The four judging criteria, mapped to evidence

**P&L:** account {{ACCOUNT_ID}}, revision {{JOURNAL_REVISION}}, every fill
linked to its intent and outcome. **Technology:** one end-to-end cycle in the
video, MCP/CLI/API calls in the journal, core source and tests public.
**Originality:** vetoes and no-trade cycles shown at the fidelity of
executions. **Presentation:** demo at {{DEMO_URL}}, video, deck, preflight
record.

## Result at the presentation cutoff ({{PRESENTATION_CUTOFF_AT}})

Start equity {{START_EQUITY}}; equity at cutoff {{CURRENT_EQUITY}}; P&L
{{PNL_ABS}} ({{PNL_PCT}}); realized {{REALIZED_PNL}}; unrealized
{{UNREALIZED_PNL}}; unattributed {{UNATTRIBUTED}} — a fee-shaped residual the
journal cannot explain, so it is displayed and never assigned to a sleeve.
Sleeve attribution covers realized P&L only: income {{INCOME_SLEEVE_PNL}} over
{{INCOME_LIFECYCLES}} lifecycles, convex {{CONVEX_SLEEVE_PNL}} over
{{CONVEX_LIFECYCLES}}. Max drawdown {{MAX_DRAWDOWN}} ({{MAX_DRAWDOWN_PCT}} of
peak {{PEAK_EQUITY}}). The book is flat: zero positions, zero open orders.
All figures are broker-derived.

## Limitations

One week of paper trading cannot prove edge, and no result here is evidence
of alpha. Trading is paper only, never live; the sleeve split is declared,
not backtested.

**Two defects surfaced during the competition**, both in `DECISIONS.md`. On the
flatten day the runner could not price the three structures expiring the next
session — its quote window starts at `EXPIRY_MIN_SESSIONS` — and the refusal
reached only a discarded cycle report, so those closes were never submitted.
The owner stood the writer down; the certified dead-man watchdog took over,
journaled `HALT WATCHDOG_TAKEOVER` and closed all three structures, filled
within a second. Second defect: that watchdog's wrapper had killed the CLI on
its first stderr line since arming, leaving the dead-man inert for a day;
it was fixed at 17:41 CEST, an hour before the takeover. The safety net held
when it was needed; neither defect is edited out.

**Known API limitation.** Alpaca has no conditional submit, so the gap
between the pre-submit broker re-fetch and broker acceptance stays open; that
re-fetch's completion is the declared linearization point. Manual account
changes outside a durable halt are prohibited, and one that lands anyway is
caught next cycle as `RESIDUE` or `HUMAN_ACTION`.
