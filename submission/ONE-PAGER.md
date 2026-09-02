<!--
SUB-03 source. Renders to submission/glass-box-trading-one-pager.pdf.
All bracketed placeholders below are injected from the single frozen
presentation-cutoff dataset: the pinned presentation route's
revisions/{{JOURNAL_REVISION}}/presentation/projection.json, produced by the
dashboard publish pipeline at the Sep 3 post-close presentation cutoff
({{PRESENTATION_CUTOFF_AT}}). No number here is invented or hand-typed at
render time; the render step must fail loudly if a placeholder is left
unresolved. Target length: one page, under ~450 words.
-->

# Glass Box Trading

**AI proposes; deterministic gates dispose.**

## Thesis

An autonomous options trading agent whose every candidate, veto, and executed
trade is public and broker-reconciled, because a system that manages risk
unattended must be auditable by someone other than its own builder.

## Who this is for

A trader or allocator who wants an unattended strategy but distrusts opaque
"AI trading bot" claims. The practical value is not a performance promise; it
is a verification pattern — every decision the agent makes is journaled
before it acts, so a reviewer can check the reasoning against the outcome
without asking the operator to vouch for it.

## How it works

A scheduled cycle asks an LLM analyst (via the Alpaca MCP server, read-only
market data) to propose defined-risk options candidates. The analyst's output
is schema-validated and whitelist-constrained; it never touches an order. A
pure, tested decision core evaluates every candidate against a fixed gate
catalog (sleeve budgets, max loss per position, concentration, liquidity,
session, lifecycle) and returns approve/veto verdicts with reasons. Only
core-approved actions reach the executor, which places paper orders on the
$100k competition account through the Alpaca CLI/API and journals intent
before submission and outcome after. The journal is append-only and public;
the dashboard renders it without authentication.

## The four judging criteria, mapped to evidence

- **P&L Performance:** account {{ACCOUNT_ID}}, journal revision
  {{JOURNAL_REVISION}}, start/presentation-cutoff snapshots on the dashboard,
  every fill linked to its intent and outcome.
- **Technology Implementation:** one end-to-end cycle in the demo video;
  MCP/CLI/API calls visible in the journal; the decision core's source and
  its tests are public.
- **Creativity & Originality:** vetoed candidates and no-trade cycles are
  shown with the same fidelity as executions; the two-sleeve budget split is
  declared, not marketed as proven alpha.
- **Presentation & Execution:** public demo at {{DEMO_URL}}, sub-five-minute
  video, ten-slide deck, this write-up, and a clean-browser preflight record.

## Result at the presentation cutoff ({{PRESENTATION_CUTOFF_AT}})

Start equity {{START_EQUITY}}; equity at cutoff {{PNL_ABS}} ({{PNL_PCT}});
realized P&L {{REALIZED_PNL}}; unrealized P&L {{UNREALIZED_PNL}}; income
sleeve {{INCOME_SLEEVE_PNL}}; convex sleeve {{CONVEX_SLEEVE_PNL}}. Figures are
broker-derived and paper-trading only; see {{DEMO_URL}} for the same numbers
at the deadline cutoff.

## Limitations

One week of paper trading cannot prove edge; no result here is evidence of
alpha. All trading is paper (Alpaca sandbox/competition), never live. The
two-sleeve split is a declared design choice, not backtested. Absent
qualifying trade activity is disclosed as an internal winning-path
failure, not external ineligibility.

**Known limitation.** Alpaca's API has no conditional submit, so the gap
between the pre-submit broker re-fetch and broker acceptance cannot be
closed; that re-fetch's completion is the declared linearization point,
and a manual account change inside the gap is caught next cycle as
`HUMAN_ACTION`, which halts and irreversibly breaks the provenance latch.
