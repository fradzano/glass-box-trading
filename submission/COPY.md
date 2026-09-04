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

> Glass Box Trading is an autonomous options trading agent built for the
> Alpaca AI Trading Agents Hackathon, run against the dedicated $100k paper
> competition account PA376WIK2ATL. Its central claim is architectural, not predictive:
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
> risk-adjusted-performance claim: two sessions of paper trading cannot prove a
> strategy has edge, and every result shown is explicitly framed as a bounded,
> auditable exercise rather than proof of trading skill. The broker-reconciled
> result at the presentation cutoff (2026-09-03T20:00:14.787Z) is +$583.59 on
> $100,000.00, or 0.58%, with the book flat; 61% of it came from a single
> four-contract QQQ call that caught an overnight gap, against a peak
> simultaneous fixed worst case of $3,421.00. Two defects from the competition
> week are named in the submission rather than left out: on the final trading
> day the runner could not price the structures expiring the next session and
> so never submitted their closes, and the watchdog's wrapper had been killing
> the CLI on its first stderr line since arming, leaving the dead-man inert
> for a day until it was fixed at 17:41 CEST that day. An hour later, after
> the owner stood the writer down, the repaired dead-man watchdog took over,
> closed all three remaining structures and left the account flat — the
> safety-net path doing the job it was built for.

- [x] Word count: 460 (≥100 required); 2870 characters including spaces.
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
