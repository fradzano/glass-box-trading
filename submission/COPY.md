# Form copy — SUB-07

Source of truth for the actual submission form fields. Unlike ONE-PAGER.md and
slides/deck.md, this file carries no placeholders: the form is pasted from
here, so every value is already resolved from the single frozen
presentation-cutoff dataset (the pinned presentation route's
`revisions/sha256:7b82959a344a7c7e/presentation/projection.json`, produced by
the dashboard publish pipeline at 2026-09-03T20:00:14.787Z). The values come
from `node submission/render/inject.mjs --values`, not from typing. Once the
actual form is filled, this file must match it exactly (SUB-09 preflight
checks this).

## Title

> Glass Box Trading

- [x] Character count: 17 / 50 max (measured, spaces included)

## Short description

> An options trading agent that journals every candidate and veto in public;
> deterministic risk gates, not the LLM, decide every order.

- [x] Character count: 133 / 255 max (measured, spaces included)

## Long description

> Glass Box Trading is an autonomous options trading agent built for the Alpaca AI Trading Agents Hackathon, run on the dedicated $100k paper account PA376WIK2ATL. Its central claim is architectural, not predictive: the LLM analyst (Claude, reading Alpaca market data through a read-only MCP toolset) can propose a trade candidate but has no code path to an order. A pure, tested decision core prices every candidate from its own quotes and runs eight gates in a fixed order (defined risk only, sleeve budgets, max loss per position, concentration, liquidity, session, idempotency, schema and whitelist); only approved plans reach the executor, which sends multi-leg limit orders to the Alpaca REST API after revalidating against fresh broker truth. Every cycle, every gate verdict and every veto is written to an append-only public journal and rendered on a login-free dashboard, so the agent's caution is as visible as its fills.
>
> The strategy is a declared two-sleeve barbell: about 80% reserve, ~12% defined-risk income structures on a max-loss basis, ~8% convex capped-loss positions on premium paid. No naked short options exist anywhere; maximum loss is fixed at order construction. Lifecycle gates (expiry eviction, reconciliation, deadline flatten, halt, drawdown kill-switch, dead-man watchdog) bound the unattended worst case by design.
>
> Result at the presentation cutoff (2026-09-03T20:00:14.787Z): +$583.59 on $100,000.00, or 0.58%, book flat; 61% of it came from one four-contract QQQ call on an overnight gap, against a peak fixed worst case of $3,421.00. Two sessions of paper trading prove nothing about edge, and no alpha is claimed. Two defects are named rather than hidden: on the final day the runner could not price next-session expiries and never submitted those closes, and the watchdog's wrapper had left the dead-man inert for a day until fixed an hour before it was needed. The repaired watchdog then closed the last three structures; the safety net held.

- [x] Word count: 308 (≥100 required); 1980 characters including spaces (form limit 600–2000).
      All three counts measured on the field text as pasted (quote markers and
      line wrapping stripped), not estimated.

## Alpaca paper-account ID (required form field, docs/HACKATHON-FACTS.md)

> PA376WIK2ATL

- [x] Equals `accountId` in the frozen dataset and the pinned dashboard page
      (`video/public/dataset/projection.json`, `submission/ACCOUNT-EVIDENCE.md`).

## Proposed tags

> options-trading, ai-agents, alpaca, risk-management, autonomous-trading,
> paper-trading, fintech, defined-risk, transparency, mcp

- [ ] Tag count and format checked against the actual form's tag input
      (delimiter, max count, allowed characters) at preflight time.

## URLs

> Demo: https://glass-box-trading.vercel.app
> Repository: https://github.com/fradzano/glass-box-trading

- [ ] Demo URL is the stable Vercel production alias (team `glass-box-trading`,
      project `glass-box-trading`); every promotion is preceded by the anonymous
      probe of `tools/probe-dashboard.ps1` (receipts in the owner's publish
      directory). First promotion 2026-09-02 19:20Z, journal revision
      `sha256:c1c8e14ea4035034`. The judged figures live on the pinned
      presentation route,
      `https://glass-box-trading.vercel.app/revisions/sha256-7b82959a344a7c7e/presentation/`
      (journal revision `sha256:7b82959a344a7c7e` at the presentation cutoff),
      which stays readable regardless of later dashboard revisions.
- [ ] Repository URL's exact submitted revision is recorded at preflight time.
