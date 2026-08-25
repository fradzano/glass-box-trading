# Glass Box Trading — Concept

Entry for the **Alpaca AI Trading Agents Hackathon** (lablab.ai, Aug 28 – Sep 4 2026).
Team: Glass Box Trading (solo, fradzano). This document is the agreed design baseline;
decisions taken here were made 2026-08-24, before any build.

External event facts, source authority, ambiguities, and the one-time kickoff
recheck live in [`docs/HACKATHON-FACTS.md`](docs/HACKATHON-FACTS.md). The
judge-facing delivery contract lives in
[`docs/SUBMISSION-SPEC.md`](docs/SUBMISSION-SPEC.md).

## 1. Framing — what this project claims and what it refuses to claim

One week of paper P&L is statistical noise, but **P&L Performance is an explicit
event criterion** and must be supported by the submitted account. The project
therefore competes for a positive absolute result inside pre-declared max-loss
budgets while refusing to market the outcome as proven alpha. Its other three
event criteria are Technology Implementation, Creativity & Originality, and
Presentation & Execution. Social engagement is a separate optional prize, not a
fourth skill axis or a substitute for the main entry.

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
scheduler (Windows Scheduled Task, cycle every 15 min during US session)
  └─ orchestrator (shell) — single-instance lock; overlapping start exits cleanly
       ├─ 0. reconcile: read Alpaca positions/orders, diff against journal;
       │      any unexplained state → journal it + halt new entries
       ├─ 1. snapshot: account, positions, OPEN ORDERS, halt flag, clock
       ├─ 2. analyst: Claude session + dev-profile MCP from a positive READ-ONLY manifest
       │      → candidates as schema-validated JSON; free-text reasoning attached;
       │      analyst error/rate-limit ⇒ skip cycle + journal entry, never crash-loop
       ├─ 3. decision core (PURE, no I/O, no clock, no LLM):
       │      (candidates, snapshot, config, now) → verdicts per gate + actions;
       │      actions are void if the snapshot is older than a staleness bound
       ├─ 4. executor (shell): per approved action, journal an INTENT entry first,
       │      THEN submit (REST/CLI, idempotent client order IDs), then journal
       │      the outcome; sole exception is SPEC S-CYC-06 emergency risk reduction
       └─ 5. journal: append JSONL entries → git push (dedicated branch, see §5)
                └─ Vercel builds candidate → probe → promote stable dashboard
```

State model (cold-read findings #2/#3): **Alpaca is the source of truth for
account state; the journal is the source of truth for decisions.** Budget
accounting is computed from Alpaca fills PLUS reservations for open orders and
journaled intents — never from the journal alone, and reservation happens at
submit, not at fill.

Role boundaries, enforced structurally:

- **Alpaca MCP server** is a dumb tool adapter (market data, chains, dev-account
  state for the analyst). A versioned positive capability manifest generates its
  toolsets; startup validates both its exact package/version from the actual
  launch interpreter and its offered inventory. The child gets dev
  data credentials only, no competition credentials or executor shell/CLI
  environment; an unexpected tool blocks arming.
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

9. **Expiry eviction** — no risk-bearing position is held into expiry; forced
   close starts no later than the prior session. Sole exception is SPEC S-X-06's
   visibly not-flat, long-only/non-exercising/zero-liability declared hold.
10. **Assignment reconciliation** — step 0 classifies every Alpaca position against
    the journal's known structures; anything unclassified (assignment residue,
    partial fill of one leg) ⇒ close it at next opportunity + halt new entries,
    journaled with reason.
11. **Deadline flatten** — every risk-bearing position and non-terminal order is
    closed by **Thursday Sep 3** market close; Friday holds no risk. A narrow
    S-X-06 declared hold remains broker-visible and is never called flat.

State & failure gates (findings #2/#4/#6/#11):

12. **Single-instance epoch + serializing lock + halt flag** — every authoritative
    gateway request must carry the current persisted epoch; the OS lock only
    serializes local access and can never revive a fenced writer. The halt flag
    is persisted, part of the snapshot, and a core input; a halted account
    accepts no new entries until a manual, journaled un-halt by the owner.
13. **Drawdown kill-switch** — equity below threshold ⇒ sticky halt; cancel and
    reconcile every risk-increasing resting entry (including fill races); reload
    broker truth; then flatten the resulting book and journal it. Flat is claimed
    only with zero risk-bearing positions and zero risk-increasing non-terminal
    orders. The threshold must price in the convex sleeve's PLANNED total decay
    (−8 % of budget is a normal outcome, not an emergency).
14. **Dead-man watchdog** — separate process, market-hours-aware (an overnight
    heartbeat gap is normal, not an alarm). After fencing and reconciliation it
    closes matched intact structures whole (mleg), while already-broken residue
    dispatches through S-X-06; it never legs out an intact structure. Declared limit:
    watchdog and agent share the host, so host death kills both; the true
    backstop for an unattended host is that every position's max loss is capped
    by construction (gate 1).

## 5. Tech stack (decided, reversible)

- **TypeScript / Node** end-to-end: agent (core + shell), dashboard generator, and the
  Remotion video live in one ecosystem. Options endpoints are called via Alpaca REST
  directly where SDK coverage is thin.
- **Journal**: append-only JSONL in-repo — the decision record (account state
  lives at Alpaca, see §3). The agent pushes to a **dedicated `journal` branch**,
  which is the dashboard deployment source; humans never commit there, so
  per-cycle pushes cannot race feature work (finding #7). A push builds an
  immutable candidate deployment. Only a successful anonymous candidate probe
  may move the stable judge-facing alias. Push or probe failure ⇒ retain the
  previous accepted alias, journal locally, retry next cycle — trading never
  blocks on git.
- **Dashboard**: static site generated from the journal, hosted on **Vercel**
  (rule-book-approved platform); candidate deployment per journal revision,
  externally probed before atomic promotion to the submitted URL.
- **MCP server**: the official Python `alpaca-mcp-server` runs as an external
  process — the TypeScript claim covers our own code, not this dependency.
- **Video**: Remotion — the presentation itself is code in the repo, extending the
  glass-box story to the deliverables.
- **License**: MIT (required).

## 6. Accounts and separation

- **Dev**: `PA349COOGKZ1` (felix.radzanowski+alpaca-dev@…) — exploration and testing,
  freely disposable. Keys in local `.env` only (gitignored; see `.env.example`).
- **Competition**: created fresh on Aug 28 per rules ($100k start, ID goes into the
  submission). Once armed, the agent runs exclusively on its keys; the dev account
  stays the sandbox so no experiment ever touches the scored account. Canonical
  arming rule: `first_arm = max(kickoff, successful_dev_live_test_at)`. The target is
  to finish the market-hours dev tests before kickoff so the first eligible Friday
  partial session remains available, but a failed test delays arming rather than
  weakening a gate. Before any competition order, bootstrap records creation at
  or after kickoff, exact $100k opening cash/equity, and fully paginated empty
  order/fill/activity history. Later manual activity irreversibly fails the
  competition provenance and submission gate.
- Both roles bind their explicit profile and independent expected account ID to
  the exact canonical `https://paper-api.alpaca.markets` trading origin at
  startup and before every mutation. Redirects, aliases, and a matching ID from
  the live origin fail closed; market-data origins are validated separately.
- The pre-existing Alpaca account serving another project is **out of bounds
  entirely** — not for dev, not for anything. This repo shares no data or code paths
  with any other trading repo in this workspace.

## 7. Judging map — where each deliverable earns points

| Criterion | Our answer | Judge-visible proof |
|---|---|---|
| P&L Performance | barbell: income drift + convex tail, honestly declared | submitted account ID; broker-reconciled equity/P&L timeline and sleeve attribution |
| Technology Implementation | Agent SDK + Alpaca MCP + REST/CLI + Vercel, clean FCIS cut | one end-to-end decision/fill plus public core, tests, and failure-path evidence |
| Creativity & Originality | declared-variance framing; glass-box journal including vetoes and no-trades | public gate vector and rationale for both accepted and rejected candidates |
| Presentation & Execution | one stable decision-to-outcome golden path | public dashboard, sub-five-minute Remotion video, PDF deck, and required one-pager |
| Social (separate optional prize) | O4 currently NO | no work unless the owner reopens it on visible results |

## 8. Schedule (budget: 3 build evenings + 1 close-out evening)

| When | What |
|---|---|
| Tue Aug 25 | freeze the sourced event contract and complete the winning-path reverse review before scaffolding |
| Wed–Thu Aug 26–27 | TypeScript vertical slice; complete market-hours credit/fill/liquidity tests on the DEV account; prepare submission source skeletons |
| Fri Aug 28 before 17:00 | candidate build deployable; pre-arm gates and host hardening complete or arming is delayed |
| Fri Aug 28 from 17:00 (kickoff) | inspect the actual form; create and bind the fresh competition account; publish GitHub + Vercel; arm in the partial session only if the dev test and gates passed |
| Sat Aug 29 17:00 | public end-to-end golden path works; continue core/gate/tests and dry-run hardening over the weekend |
| Mon Aug 31 | competition run continues; Monday is fallback first-arm only if the pre-kickoff live test failed or the build was not safe |
| Tue Sep 1 / US close | **declared buffer evening** — fixes from live reality or first presentation draft; qualifying options activity exists by close or S-CYC-12 exposes `COMPETITIVENESS_AT_RISK` (our winning gate, not a published minimum-trade rule) |
| Wed Sep 2 | feature freeze except safety/criterion blockers; the strictly capped, normal-gates-only qualification window ends at US close; cover, form copy, video and deck drafts ready |
| Thu Sep 3 20:00 / post-close | freeze narration/layout first; after market close flatten/reconcile, freeze one presentation-cutoff dataset and immutable route, then render the canonical one-page write-up, video, deck and cutoff-identical preflight by 23:45 |
| Fri Sep 4 by 12:00 | submit with five hours of contingency; the agent journals but holds no risk; deadline reconciliation at 17:00 |

## 9. Open points

- **O1** Paper-API options reality check — **largely resolved 2026-08-24** on the dev
  account: `options_trading_level: 3` (spreads allowed) out of the box; a 2-leg
  `mleg` limit order (SPY call debit spread) was accepted with both legs and cleanly
  canceled; the free `indicative` options feed delivers fresh quotes (chain
  snapshots + latest-quotes endpoints). Remaining before go-live: fill-simulation
  behavior during market hours, credit-structure (`sell_to_open`-led) acceptance,
  and a liquidity-gate data source — `open_interest` came back `null` on the
  contracts endpoint for some contracts, so the gate may need quote-size floors
  instead of OI. These observations close only through the revision/config-bound
  S-ARM-01 dev-live-test certificate; a hand-entered timestamp is not evidence.
- **O2** Agent SDK subscription auth — **resolved 2026-08-24**: `claude setup-token`
  (one interactive run) issues a **one-year OAuth token**; set it as
  `CLAUDE_CODE_OAUTH_TOKEN` in the task environment. Documented for exactly the
  unattended case. Caveats: `ANTHROPIC_API_KEY` must NOT be set in that environment
  (it wins the credential precedence), and SDK usage draws from the subscription's
  plan limits — budget the cycle cadence accordingly.
- **O3** Pre-build legality: **resolved 2026-08-24**. The rule book bans
  plagiarism, not preparation. The build is pulled forward; the public history
  remains transparent and includes meaningful work during the event window.
- **O4** Social track (LinkedIn under real name): **NO for now**. It is a separate
  optional prize; revisit only on visible results.
- **O5** Remaining budget, whitelist, and gate thresholds — frozen before the
  actual first arm and journaled as config. Cycle cadence is already 15 minutes.

## 10. Tooling verified (2026-08-24, dev account)

- **Alpaca MCP server** `alpaca-mcp-server` 2.3.0 via pip (Python 3.14; note: a
  broken `fastmcp` install needed `pip install --force-reinstall fastmcp`).
  Stdio handshake + tool call verified: **72 tools**, incl. `get_option_chain`,
  `get_option_snapshot`, `place_option_order`. `ALPACA_TOOLSETS` filters toolsets;
  the analyst's versioned positive manifest selects data/account toolsets, forbids
  `trading`, and rejects the observed inventory if anything extra appears.
  Rechecked 2026-08-25 against the installed server: the tracked
  `config/analyst-mcp-readonly.json` selects `assets,stock-data,options-data`
  and names the exact 32-tool inventory (including the server's read-only docs
  and stock/crypto override tools). The global 2.3.0 install is observation, not
  trust: PyPI still listed 2.2.1 while official GitHub `main` declared 2.3.0.
  `config/analyst-runtime-lock.json` therefore pins official commit
  `872abbf28dab6cdde7d341fc13ac139b8002d1d9`, its dependency lock, and the
  CPython 3.14.1 launcher/runtime hashes. Pre-arm rebuilds a dedicated environment
  from that commit, removes and rejects all surviving Python bytecode, disables
  bytecode writes, and verifies immutable files before the separate exact tool
  inventory check.
- **Alpaca CLI** v0.0.13 (Go binary, checksum-verified) at
  `C:\Users\felix\tools\alpaca-cli\alpaca.exe`. JSON on stdout, `--jq` filtering,
  `order submit` supports `--order-class mleg` + `--legs` (≤4),
  `--client-order-id` (idempotency gate) and `--dry-run`; `alpaca api` is a raw
  passthrough for anything the typed commands miss. Auth via `ALPACA_API_KEY` /
  `ALPACA_SECRET_KEY`; the executor supplies the role-bound canonical paper
  origin explicitly and never relies on the CLI default.
- **REST** verified earlier (§9 O1): account, clock, contracts, `mleg` order
  accept/cancel, `indicative` options feed.
