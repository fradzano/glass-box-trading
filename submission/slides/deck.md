---
marp: true
theme: default
paginate: true
footer: 'Alpaca AI Trading Agents Hackathon (lablab.ai) · Team Glass Box Trading · presentation cutoff {{PRESENTATION_CUTOFF_AT}}'
---

<!--
SUB-05 source. Renders to submission/glass-box-trading.pdf (max 10 slides).
Every mutable number/URL below is a placeholder injected from the single
frozen presentation-cutoff dataset: the pinned presentation route's
revisions/{{JOURNAL_REVISION}}/presentation/projection.json, produced by the
dashboard publish pipeline at {{PRESENTATION_CUTOFF_AT}}. The same dataset
feeds submission/ONE-PAGER.md, submission/COPY.md, and video/README.md — no
figure here may be typed by hand or diverge from theirs.
-->

# Glass Box Trading

**AI proposes; deterministic gates dispose.**

- Result at {{PRESENTATION_CUTOFF_AT}}: {{PNL_ABS}} ({{PNL_PCT}}) on a $100k paper account
- Every decision — trade or no trade — is public and broker-reconciled
- Demo: {{DEMO_URL}} · Repo: {{REPO_URL}}

---

## The auditability problem

- "Autonomous trading agent" claims are easy to make, hard to verify
- Target user: a trader or allocator who wants unattended execution but
  distrusts opaque bot claims
- This entry publishes the whole decision trail — proposals, vetoes, and
  fills alike — not just the wins

---

## The decision-to-fill golden path

1. Open the dashboard, no login — see account state and control model
2. Pick one decision cycle — market context, candidate, rationale
3. See the full gate vector, including at least one veto
4. Follow one approved intent to its order, fill, and P&L contribution
5. Open the public source at the pure decision core and its tests

---

## "AI proposes; deterministic gates dispose"

- LLM analyst proposes candidates from read-only Alpaca market data (MCP)
- Analyst output is schema-validated and whitelist-constrained — never a
  free-form order
- A pure, tested decision core owns every risk gate; time/config/account
  state are parameters, not ambient calls
- Executor places only core-approved actions through the Alpaca REST API
  (multi-leg limit orders, client order id as idempotency key) — the LLM
  has no code path to an order

---

## Options strategy and declared variance allocation

- Two-sleeve barbell, declared up front, not fit after the fact:
  - Reserve ~80% — cash, idle
  - Income ~12% (max-loss basis) — defined-risk credit spreads / iron condors
  - Convex ~8% (premium basis) — debit spreads / long options
- Defined-risk only, everywhere — no naked short options in the strategy space

---

## The cycle and its gates, in order

1. Phase 0: reconcile the journal against broker truth; anything foreign halts
2. Fresh broker snapshot and quotes; the analyst proposes candidates (read-only MCP)
3. The pure core prices each candidate from its own quotes and runs
   **G1** defined risk only · **G2** sleeve budgets · **G3** max loss per position ·
   **G4** per-underlying concentration · **G5** liquidity · **G6** session and
   tradability · **G7** idempotency · **G8** schema and whitelist
4. Executor: limit order, revalidated against a fresh broker read, INTENT before,
   OUTCOME after
- Lifecycle and failure gates run every cycle: **G9** expiry eviction, **G10**
  reconciliation, **G11** deadline flatten, **G12** single instance and halt,
  **G13** drawdown kill-switch, **G14** dead-man watchdog
- Worst case is bounded by design, not by monitoring diligence

---

## Broker-reconciled P&L and sleeve attribution

- Account {{ACCOUNT_ID}}, journal revision {{JOURNAL_REVISION}}
- Start equity {{START_EQUITY}} · Equity at cutoff {{CURRENT_EQUITY}} ·
  P&L {{PNL_ABS}} ({{PNL_PCT}}) at {{PRESENTATION_CUTOFF_AT}}
- Realized {{REALIZED_PNL}} · Unrealized {{UNREALIZED_PNL}} · Unattributed
  {{UNATTRIBUTED}} — a fee-shaped residual the journal cannot explain, shown
  and never assigned to a sleeve
- Realized only, by sleeve: income {{INCOME_SLEEVE_PNL}} ({{INCOME_FILLED}} filled
  spreads) · convex {{CONVEX_SLEEVE_PNL}} ({{CONVEX_FILLED}} filled call of
  {{CONVEX_ATTEMPTED}} attempted)
- Concentration: one {{BEST_LIFECYCLE_LABEL}} on an overnight gap =
  {{BEST_LIFECYCLE_SHARE_PCT}} of the result — path, not skill
- Peak simultaneous defined worst case {{PEAK_RESERVED_MAX_LOSS}}
  ({{PEAK_RESERVED_MAX_LOSS_PCT}}), carried overnight; max drawdown {{MAX_DRAWDOWN}} on
  cycle-spaced samples, the overnight move not sampled; book flat

---

## Public journal, vetoes, and originality

- Every cycle's proposal or no-trade result is journaled with its gate
  vector and rationale — rejections logged with the same fidelity as fills
- The declared variance split is the originality claim, not a marketed
  edge
- {{VETOED_CANDIDATE_COUNT}} vetoed candidates and
  {{NO_TRADE_CYCLE_COUNT}} no-trade cycles are visible on the dashboard as
  of {{PRESENTATION_CUTOFF_AT}}

---

## Failure drills, two defects found, and limitations

- Failure-path tests cover reconciliation, kill-switch, watchdog, expiry
- **Defect 1:** on flatten day the runner could not price the structures
  expiring next session (quote window starts at `EXPIRY_MIN_SESSIONS`); the
  refusal reached only a discarded report, so no close was submitted
- **Response:** owner stood the writer down, the certified dead-man watchdog
  took over — `HALT WATCHDOG_TAKEOVER`, all three structures closed and
  filled within a second, book flat at the deadline
- **Defect 2:** that watchdog's wrapper had killed the CLI on its first
  stderr line since arming — inert for a day, fixed at 17:41 CEST, an hour
  before the takeover
- **API limit:** no conditional submit at Alpaca; the pre-submit re-fetch is
  the declared linearization point, a manual mutation halts the next cycle
- Paper only; two sessions of paper P&L cannot prove edge — no alpha claim

---

## Demo, repository, and post-hackathon path

- Demo: {{DEMO_URL}}
- Repository: {{REPO_URL}}
- Journal revision at cutoff: {{JOURNAL_REVISION}}
- Post-hackathon: continue paper operation, extend the gate catalog and
  sleeve set before any live-account discussion
