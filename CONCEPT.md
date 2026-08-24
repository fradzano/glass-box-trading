# Glass Box Trading — Concept

Entry for the **Alpaca AI Trading Agents Hackathon** (lablab.ai, Aug 28 – Sep 4 2026).
Team: Glass Box Trading (solo, fradzano). This document is the agreed design baseline;
decisions taken here were made 2026-08-24, before any build.

## 1. Framing — what this project claims and what it refuses to claim

Five US trading sessions of P&L are statistical noise. Any ranking by one-week paper
P&L rewards the most convex lottery ticket in the field, not skill — and the write-up
will say so openly. This project therefore competes primarily on the four skill axes
of the judging criteria (technology implementation, creativity/originality,
presentation/execution, plus the optional social track) and treats the P&L axis as a
**declared** variance allocation, not a pretended edge.

The core idea, and the name: a **glass-box agent**. Every decision cycle — candidates
seen, every risk gate checked, trade or no trade, and why — is written to an
append-only public journal and rendered on a live dashboard. Rejections are logged
with the same fidelity as executions. Nothing about the agent's reasoning is private.

**The one-line architecture story:** the LLM may have ideas but cannot place orders;
the deterministic core may place orders but cannot have ideas.

## 2. Strategy — declared two-sleeve barbell (defined-risk options only)

Chosen over pure-income and pure-convex alternatives on 2026-08-24 (rationale: serves
both P&L outcomes, gives the agent real decisions to journal, and the declared
variance split IS the originality claim).

| Sleeve | Budget (of $100k) | Budget unit | Instruments | Distribution it buys |
|---|---|---|---|---|
| Reserve | ~80 % | cash | cash | none — declared idle |
| Income | ~12 % | **sum of max loss** (spread width − credit received) | defined-risk credit structures (credit spreads / iron condors) on liquid ETF underlyings (SPY/QQQ class) | high win-rate, small positive drift |
| Convex | ~8 % | **premium paid** | debit spreads / long options around known scheduled events | lottery ticket, capped at premium |

The budget unit matters: credit structures *receive* premium, so their budget is
measured in worst-case loss, not premium flow (cold-read finding #8).

Hard invariant across both sleeves: **defined-risk structures only**. Maximum loss per
position is fixed at order construction (premium paid, or spread width minus credit).
No naked short options exist anywhere in the strategy space.

Every journal entry declares which sleeve a trade belongs to and which distribution
the agent expects to be paid from. The agent's job is allocation and discipline, not
prediction; the write-up frames it exactly that way.

## 3. Architecture — "AI proposes, gates dispose"

Functional Core / Imperative Shell (house rule; the hackathon deadline does not
suspend it — the agent has money-shaped invariants, so the core is pure and tested).

```
scheduler (Windows Scheduled Task, cycle every 15–30 min during US session)
  └─ orchestrator (shell) — single-instance lock; overlapping start exits cleanly
       ├─ 0. reconcile: read Alpaca positions/orders, diff against journal;
       │      any unexplained state → journal it + halt new entries
       ├─ 1. snapshot: account, positions, OPEN ORDERS, halt flag, clock
       ├─ 2. analyst: Claude session (Agent SDK) + Alpaca MCP server (READ-ONLY tools)
       │      → candidates as schema-validated JSON; free-text reasoning attached;
       │      analyst error/rate-limit ⇒ skip cycle + journal entry, never crash-loop
       ├─ 3. decision core (PURE, no I/O, no clock, no LLM):
       │      (candidates, snapshot, config, now) → verdicts per gate + actions;
       │      actions are void if the snapshot is older than a staleness bound
       ├─ 4. executor (shell): per approved action, journal an INTENT entry first,
       │      THEN submit (REST/CLI, idempotent client order IDs), then journal
       │      the outcome — a crash mid-cycle leaves an intent, never a silent fill
       └─ 5. journal: append JSONL entries → git push (dedicated branch, see §5)
                └─ Vercel redeploys the public dashboard from the journal
```

State model (cold-read findings #2/#3): **Alpaca is the source of truth for
account state; the journal is the source of truth for decisions.** Budget
accounting is computed from Alpaca fills PLUS reservations for open orders and
journaled intents — never from the journal alone, and reservation happens at
submit, not at fill.

Role boundaries, enforced structurally:

- **Alpaca MCP server** is a dumb tool adapter (market data, chains, account state for
  the analyst). It holds no rules and is attached to the analyst read-only.
- **Analyst (LLM)** proposes candidates only. Output is validated against a strict
  schema; order-relevant fields may only take values from a whitelist (underlying
  universe, structure types, expiry/strike ranges, size ceilings). An analyst output
  that fails validation is journaled and dropped — never repaired silently.
- **Decision core** is a pure function; time, config, and account state are
  parameters. It owns every gate listed in §4. Tests are delivery scope.
- **Executor** performs only core-approved actions. The LLM has no code path to an
  order.

Auth for the analyst: Claude subscription via Agent SDK preferred; `ANTHROPIC_API_KEY`
as configured fallback if unattended plan-auth token refresh proves brittle
(open point O2).

## 4. Risk gate catalog (second cut after cold read — final list frozen before go-live Aug 31)

Entry gates:

1. **Defined-risk only** — reject any structure whose max loss is not fixed at entry.
2. **Sleeve budgets** — income ~12 % (max-loss basis), convex ~8 % (premium basis);
   **reserved at submit**, open orders and journaled intents count against the
   budget; empty budget ⇒ veto.
3. **Max loss per position** — cap as fraction of sleeve budget.
4. **Per-underlying concentration cap.**
5. **Liquidity gate** — bid/ask width floors on every leg (quote sizes, not OI —
   see §9 O1).
6. **Session gate** — orders only during regular US trading hours.
7. **Idempotency** — deterministic client order IDs; a re-run cycle cannot double-send.
8. **Schema gate** — analyst output failing validation is vetoed wholesale (see §3).

Lifecycle gates (cold-read finding #1 — entry-only catalogs die at expiry):

9. **Expiry eviction** — no position is held into its expiry day; forced close no
   later than the prior session. Weekly options make this a daily concern, not an
   edge case.
10. **Assignment reconciliation** — step 0 classifies every Alpaca position against
    the journal's known structures; anything unclassified (assignment residue,
    partial fill of one leg) ⇒ close it at next opportunity + halt new entries,
    journaled with reason.
11. **Deadline flatten** — everything closed by **Thursday Sep 3** market close;
    Friday (submission day — Sep 4 2026 is a FRIDAY, calendar fixed per
    SCENARIOS.md #38) holds no risk, and the judges see a closed book whose
    post-deadline state cannot change under expiry mechanics.

State & failure gates (findings #2/#4/#6/#11):

12. **Single-instance lock + halt flag** — the halt flag is a persisted file, part
    of the snapshot, and a core input; a halted account accepts no new entries
    until a manual, journaled un-halt by the owner.
13. **Drawdown kill-switch** — equity below threshold ⇒ flatten + halt, journaled.
    The threshold must price in the convex sleeve's PLANNED total decay (−8 % of
    budget is a normal outcome, not an emergency).
14. **Dead-man watchdog** — separate process, market-hours-aware (an overnight
    heartbeat gap is normal, not an alarm); on genuine staleness during trading
    hours it closes positions as WHOLE structures (mleg), never leg-wise — a
    safety mechanism must not create a transient naked short. Declared limit:
    watchdog and agent share the host, so host death kills both; the true
    backstop for an unattended host is that every position's max loss is capped
    by construction (gate 1).

## 5. Tech stack (decided, reversible)

- **TypeScript / Node** end-to-end: agent (core + shell), dashboard generator, and the
  Remotion video live in one ecosystem. Options endpoints are called via Alpaca REST
  directly where SDK coverage is thin.
- **Journal**: append-only JSONL in-repo — the decision record (account state
  lives at Alpaca, see §3). The agent pushes to a **dedicated `journal` branch**,
  which is Vercel's production branch; humans never commit there, so per-cycle
  pushes cannot race feature work (finding #7). Push failure ⇒ journal locally,
  retry next cycle — trading never blocks on git.
- **Dashboard**: static site generated from the journal, hosted on **Vercel**
  (rule-book-approved platform); redeploy on push after every cycle.
- **MCP server**: the official Python `alpaca-mcp-server` runs as an external
  process — the TypeScript claim covers our own code, not this dependency.
- **Video**: Remotion — the presentation itself is code in the repo, extending the
  glass-box story to the deliverables.
- **License**: MIT (required).

## 6. Accounts and separation

- **Dev**: `PA349COOGKZ1` (felix.radzanowski+alpaca-dev@…) — exploration and testing,
  freely disposable. Keys in local `.env` only (gitignored; see `.env.example`).
- **Competition**: created fresh on Aug 28 per rules ($100k start, ID goes into the
  submission). Agent runs exclusively on its keys from kickoff; the dev account stays
  the sandbox so no experiment ever touches the scored account.
- The pre-existing Alpaca account serving another project is **out of bounds
  entirely** — not for dev, not for anything. This repo shares no data or code paths
  with any other trading repo in this workspace.

## 7. Judging map — where each deliverable earns points

| Criterion | Our answer |
|---|---|
| P&L | barbell: income drift + convex tail, honestly declared |
| Technology | Agent SDK + Alpaca MCP + REST/CLI + Vercel, clean FCIS cut |
| Creativity | declared-variance framing; glass-box journal incl. vetoes |
| Presentation | live dashboard = demo URL; Remotion video; one-pager mirrors §3/§4 |
| Social (conditional) | O4 currently NO — row inactive unless the owner reopens it on visible results |

## 8. Schedule (budget: 3 build evenings + 1 close-out evening)

| When | What |
|---|---|
| Pre-kickoff week | exploration only: MCP/CLI, paper options quirks (O1), repo scaffold, Remotion template, design docs. No substantive build. |
| Fri Aug 28 (kickoff) | competition account, wiring, journal skeleton, **host hardening** (power plan, run-when-logged-off, auto-update deferral — finding #9) |
| Weekend Aug 29–30 | core + gates + tests + dry-run (markets closed) |
| Mon Aug 31 | **pre-arm live test on the DEV account at US open** (credit-structure acceptance, fill behavior — the O1 leftovers are market-hours-only); only then arm the competition account (finding #5) |
| Tue Sep 1 | **declared buffer evening** — fixes from Monday's live reality; otherwise dashboard polish |
| Wed Sep 2 evening | second buffer / monitoring — the calendar gives us a fifth session we originally miscounted (Sep 4 is a Friday, see SCENARIOS.md #38) |
| Thu Sep 3 evening | one-pager, Remotion video (render time budgeted), deck (PDF), cover image 16:9, short/long descriptions, tags; **flatten all positions by Thursday close** (gate 11) |
| Fri Sep 4 morning | submission, hours before the 17:00 CEST deadline — the morning is reserve for form surprises, not planned work; the agent journals but holds no risk |

## 9. Open points

- **O1** Paper-API options reality check — **largely resolved 2026-08-24** on the dev
  account: `options_trading_level: 3` (spreads allowed) out of the box; a 2-leg
  `mleg` limit order (SPY call debit spread) was accepted with both legs and cleanly
  canceled; the free `indicative` options feed delivers fresh quotes (chain
  snapshots + latest-quotes endpoints). Remaining before go-live: fill-simulation
  behavior during market hours, credit-structure (`sell_to_open`-led) acceptance,
  and a liquidity-gate data source — `open_interest` came back `null` on the
  contracts endpoint for some contracts, so the gate may need quote-size floors
  instead of OI.
- **O2** Agent SDK subscription auth — **resolved 2026-08-24**: `claude setup-token`
  (one interactive run) issues a **one-year OAuth token**; set it as
  `CLAUDE_CODE_OAUTH_TOKEN` in the task environment. Documented for exactly the
  unattended case. Caveats: `ANTHROPIC_API_KEY` must NOT be set in that environment
  (it wins the credential precedence), and SDK usage draws from the subscription's
  plan limits — budget the cycle cadence accordingly.
- **O3** Pre-build legality: rule book bans plagiarism, not preparation; no explicit
  during-the-window build requirement found (checked 2026-08-24). Policy anyway:
  design + scaffold before kickoff, substantive build inside the window, timeline
  transparent in the repo.
- **O4** Social track (LinkedIn under real name) — owner decision, due at kickoff.
- **O5** Exact budget percentages, gate thresholds, cycle cadence — frozen before
  go-live Aug 31, journaled as config.

## 10. Tooling verified (2026-08-24, dev account)

- **Alpaca MCP server** `alpaca-mcp-server` 2.3.0 via pip (Python 3.14; note: a
  broken `fastmcp` install needed `pip install --force-reinstall fastmcp`).
  Stdio handshake + tool call verified: **72 tools**, incl. `get_option_chain`,
  `get_option_snapshot`, `place_option_order`. `ALPACA_TOOLSETS` filters toolsets —
  this is how the analyst gets a **read-only** attachment (data/account toolsets,
  no `trading`).
- **Alpaca CLI** v0.0.13 (Go binary, checksum-verified) at
  `C:\Users\felix\tools\alpaca-cli\alpaca.exe`. JSON on stdout, `--jq` filtering,
  `order submit` supports `--order-class mleg` + `--legs` (≤4),
  `--client-order-id` (idempotency gate) and `--dry-run`; `alpaca api` is a raw
  passthrough for anything the typed commands miss. Auth via `ALPACA_API_KEY` /
  `ALPACA_SECRET_KEY`; paper is the default (live requires an explicit opt-in we
  will never set).
- **REST** verified earlier (§9 O1): account, clock, contracts, `mleg` order
  accept/cancel, `indicative` options feed.
