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

| Sleeve | Budget (of $100k) | Instruments | Distribution it buys |
|---|---|---|---|
| Reserve | ~80 % | cash | none — declared idle |
| Income | ~12 % | defined-risk credit structures (credit spreads / iron condors) on liquid ETF underlyings (SPY/QQQ class) | high win-rate, small positive drift |
| Convex | ~8 % premium budget | debit spreads / long options around known scheduled events | lottery ticket, capped at premium |

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
  └─ orchestrator (shell)
       ├─ 1. snapshot: account, positions, orders, clock  ← Alpaca REST (paper)
       ├─ 2. analyst: Claude session (Agent SDK) + Alpaca MCP server (READ-ONLY tools)
       │      → candidates as schema-validated JSON; free-text reasoning attached
       ├─ 3. decision core (PURE, no I/O, no clock, no LLM):
       │      (candidates, snapshot, config, now) → verdicts per gate + actions
       ├─ 4. executor (shell): approved actions → Alpaca orders (REST/CLI),
       │      idempotent client order IDs
       └─ 5. journal: append JSONL entry (inputs digest, candidates, every gate
              verdict incl. vetoes with reasons, actions, fills) → git push
                └─ Vercel redeploys the public dashboard from the journal
```

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

## 4. Risk gate catalog (first cut — final list frozen before go-live Aug 31)

1. **Defined-risk only** — reject any structure whose max loss is not fixed at entry.
2. **Sleeve premium budgets** — income ~12 %, convex ~8 %; a filled order debits its
   sleeve; empty budget ⇒ veto.
3. **Max loss per position** — cap as fraction of sleeve budget.
4. **Per-underlying concentration cap.**
5. **Liquidity gate** — bid/ask width and open-interest floors on every leg.
6. **Session gate** — orders only during regular US trading hours; no new risk in the
   final session before submission deadline.
7. **Idempotency** — deterministic client order IDs; a re-run cycle cannot double-send.
8. **Drawdown kill-switch** — account equity below threshold ⇒ flatten + halt, journaled.
9. **Dead-man** — heartbeat file per cycle; stale heartbeat ⇒ standalone watchdog
   flattens all positions.
10. **Schema gate** — analyst output failing validation is vetoed wholesale (see §3).

## 5. Tech stack (decided, reversible)

- **TypeScript / Node** end-to-end: agent (core + shell), dashboard generator, and the
  Remotion video live in one ecosystem. Options endpoints are called via Alpaca REST
  directly where SDK coverage is thin.
- **Journal**: append-only JSONL in-repo; the only state store.
- **Dashboard**: static site generated from the journal, hosted on **Vercel**
  (rule-book-approved platform); redeploy on push after every cycle.
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
| Social (optional) | journal excerpts as build-in-public posts — LinkedIn decision open (O4) |

## 8. Schedule (budget: 3 build evenings + 1 close-out evening)

| When | What |
|---|---|
| Pre-kickoff week | exploration only: MCP/CLI, paper options quirks (O1), repo scaffold, Remotion template, design docs. No substantive build. |
| Fri Aug 28 (kickoff) | competition account, wiring, journal skeleton |
| Weekend Aug 29–30 | core + gates + tests + dry-run (markets closed) |
| Mon Aug 31, US open | agent live, autonomous; evenings monitoring only |
| Wed Sep 2 evening | one-pager, Remotion video, deck |
| Thu Sep 4 morning | submission, hours before the 17:00 CEST deadline |

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
- **O2** Agent SDK subscription auth under an unattended scheduled task (token
  refresh over a week) — else API-key fallback.
- **O3** Pre-build legality: rule book bans plagiarism, not preparation; no explicit
  during-the-window build requirement found (checked 2026-08-24). Policy anyway:
  design + scaffold before kickoff, substantive build inside the window, timeline
  transparent in the repo.
- **O4** Social track (LinkedIn under real name) — owner decision, due at kickoff.
- **O5** Exact budget percentages, gate thresholds, cycle cadence — frozen before
  go-live Aug 31, journaled as config.
