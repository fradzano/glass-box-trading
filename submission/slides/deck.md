---
marp: true
theme: default
paginate: true
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
- Executor places only core-approved actions via Alpaca CLI/API — the LLM
  has no code path to an order

---

## Options strategy and declared variance allocation

- Two-sleeve barbell, declared up front, not fit after the fact:
  - Reserve ~80% — cash, idle
  - Income ~12% (max-loss basis) — defined-risk credit spreads / iron condors
  - Convex ~8% (premium basis) — debit spreads / long options
- Defined-risk only, everywhere — no naked short options in the strategy space

---

## Risk gates and bounded unattended worst case

- Entry gates: defined-risk only, sleeve budgets, per-position max loss,
  concentration cap, liquidity floor, session gate, idempotency, schema gate
- Lifecycle gates: expiry eviction, assignment reconciliation, deadline
  flatten by Sep 3 close
- State/failure gates: single-instance epoch + halt flag, drawdown
  kill-switch, dead-man watchdog
- Worst case is bounded by design, not by monitoring diligence

---

## Broker-reconciled P&L and sleeve attribution

- Account {{ACCOUNT_ID}}, journal revision {{JOURNAL_REVISION}}
- Start equity {{START_EQUITY}} · Equity at cutoff {{CURRENT_EQUITY}} ·
  P&L {{PNL_ABS}} ({{PNL_PCT}}) at {{PRESENTATION_CUTOFF_AT}}
- Realized {{REALIZED_PNL}} · Unrealized {{UNREALIZED_PNL}} · Unattributed
  {{UNATTRIBUTED}} — a fee-shaped residual the journal cannot explain, shown
  and never assigned to a sleeve
- Realized only, by sleeve: income {{INCOME_SLEEVE_PNL}} · convex
  {{CONVEX_SLEEVE_PNL}}
- Max drawdown {{MAX_DRAWDOWN}} ({{MAX_DRAWDOWN_PCT}} of peak
  {{PEAK_EQUITY}}); book flat, zero positions, zero orders

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
- Paper only; one week of paper P&L cannot prove edge — no alpha claim

---

## Demo, repository, and post-hackathon path

- Demo: {{DEMO_URL}}
- Repository: {{REPO_URL}}
- Journal revision at cutoff: {{JOURNAL_REVISION}}
- Post-hackathon: continue paper operation, extend the gate catalog and
  sleeve set before any live-account discussion
