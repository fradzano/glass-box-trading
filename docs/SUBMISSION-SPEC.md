# Submission and winning-path spec

The trading system is only one layer of the entry. A judge encounters the
submission form, video, slides, demo URL, repository, dashboard, and Alpaca
account before reaching most of `docs/SPEC.md`. This document specifies that
outer path. External requirements and their source authority rules live in
[`HACKATHON-FACTS.md`](HACKATHON-FACTS.md); runtime trading behavior remains in
[`SPEC.md`](SPEC.md).

The acceptance claim is deliberately narrow: **a judge can verify every
event-specific criterion from the submitted surfaces without credentials,
local setup, or trust in our narration.** Winning remains a jury decision.

## 1. Criterion-to-evidence contract

| Criterion | Claim | Evidence a judge can inspect | Failure condition |
|---|---|---|---|
| P&L Performance | The dedicated $100k account traded a bounded options strategy during the competition and every reported result equals broker history at its labelled cutoff. | Submitted account ID; proven competition BOOTSTRAP; start, presentation-cutoff, and deadline snapshots; dashboard equity/P&L timeline; ordinary orders/fills linked to intent/outcome, with any S-CYC-06 emergency close exposed as an audit-gap reconciliation; per-sleeve attribution. | Any displayed number lacks a cutoff or cannot be reconciled to the submitted account at that cutoff, or the account has no qualifying options activity. |
| Technology Implementation | The AI performs candidate analysis through Alpaca data while deterministic code exclusively owns risk approval and execution. | One end-to-end cycle in the demo; MCP/CLI/API calls visible in the journal; architecture diagram; public source; red-first tests and named failure-path evidence. | The AI is cosmetic, the Alpaca integration is simulated in the submitted path, or an LLM can reach an order without the core. |
| Creativity & Originality | Vetoes and no-trade decisions are first-class public evidence, not discarded logs; the variance allocation is declared instead of marketed as one-week alpha. | Dashboard decision timeline, gate vector, candidate-specific rationale, rejected candidates, distribution/sleeve attribution, and explicit limitations. | The result looks like a generic chatbot around a broker API or hides unfavorable decisions. |
| Presentation & Execution | A stranger understands the idea in 30 seconds and can follow one reliable path from decision to broker outcome. | Opening dashboard state, sub-five-minute video, PDF deck, one-page write-up, public demo, and clean-browser preflight record. | A required surface is missing, inaccessible, stale without disclosure, inconsistent, or depends on a live trade occurring during judging. |

For this project, “qualifying options activity” means an ordinary
core-approved competition-account options fill joined to its `INTENT` and
`OUTCOME`; dev tests, manual activity, emergency cleanup, rejects, cancels, and
unfilled orders do not qualify. The event publishes no minimum trade count, so
absence is not called external ineligibility. It is an internal winning-path
failure: SPEC S-CYC-12 raises a Sep 1 US-close competitiveness alarm, permits a
strictly capped normal-gates-only qualification window through Sep 2 US close,
and then requires an owner waiver to submit if no qualifying fill exists.
Qualification is necessary for our P&L story, never sufficient evidence of
competitive performance.

Business-value material is supporting pitch content, not a fifth
event-specific criterion: the one-pager names the target user and practical
value, but TAM and revenue speculation may not displace evidence for the four
published criteria.

## 2. Judge-visible dashboard contract

`SPEC.md` S-J-07 owns atomic publication. Its judge-facing payload must contain:

- submitted Alpaca account ID and the journal revision used for the page;
- competition start equity, current equity, absolute and percentage P&L;
- realized and unrealized P&L as separate broker-derived values;
- equity and drawdown timeline, with the actual first-trade, flatten, and
  submission timestamps rather than an assumed five-session label;
- income/convex sleeve attribution and declared budget at risk;
- current positions and non-terminal orders. “Flat” appears only at zero broker
  positions; a valid `DECLARED_EXPIRY_HOLD` is visibly not-flat but labelled
  zero-additional-liability;
- every ordinary broker order/fill linked to its `INTENT` and `OUTCOME`, and
  every intent linked forward to its broker outcome or explicit unresolved
  state. The sole S-CYC-06 emergency close links instead to an explicit
  `AUDIT_GAP_EMERGENCY_CLOSE` reconciliation and is never presented as having a
  prior intent;
- every cycle's proposal or no-trade result, gate vector, and rationale;
- last-updated timestamp, freshness state, deployment revision, and a visible
  degraded-state explanation when publishing is stale.
- an immutable historical projection addressable by committed journal revision
  and evidence cutoff. The default route may advance to the latest projection;
  the presentation-cutoff route used by uploaded assets must remain verifiable.

The dashboard makes no unsupported alpha, risk-adjusted-performance, or
live-market claim. Broker values are labelled as paper trading.

## 3. Golden demo path

The demo is deterministic in navigation even when markets are closed. It does
not depend on forcing a new order.

1. Open the public dashboard without authentication. The first viewport states
   the $100k paper-account result, current exposure, and the one-line control
   model: “AI proposes; deterministic gates dispose.”
2. Select one completed decision cycle. Show the Alpaca-derived market context,
   analyst candidate, and candidate-specific rationale.
3. Show the complete deterministic gate vector. Include at least one vetoed
   candidate so safety is observed rather than asserted.
4. Follow one approved intent to its Alpaca order and fill/outcome, then back to
   its P&L contribution.
5. Open the public source at the pure core and the test that executes one named
   evidence-debt path.
6. Return to the dashboard's account reconciliation. During recording this is
   the immutable presentation-cutoff snapshot; after publication the same route
   may expose a newer, explicitly timestamped deadline snapshot.

A manual demo trigger, if used, remains a normal fenced and journaled cycle per
A13. The recorded golden path should normally use existing immutable journal
data, so recording cannot perturb the competition account.

## 4. Deliverable register

`Felix` is the acceptance owner for every row because this is a solo team.
Generated outputs may be rebuilt, but the submitted URLs and uploaded files are
frozen at the internal submission cutoff.

| ID | Deliverable | Planned source / target | Acceptance evidence | Internal due |
|---|---|---|---|---|
| SUB-01 | Public repository | GitHub URL set at kickoff; `README.md`, `LICENSE`, source and tests | Anonymous browser opens the exact submitted revision; MIT license present; no secrets; meaningful commits exist during the event window. | Aug 28 after kickoff |
| SUB-02 | Demo application | Stable Vercel alias set at kickoff; immutable candidates generated from `journal` branch | Anonymous clean-browser run completes the golden path; no login; current page names journal revision and freshness; the pinned presentation-cutoff route remains accessible after later snapshots; only externally accepted candidates reach the submitted alias. | First working version by Aug 29 17:00; final Sep 3 |
| SUB-03 | One-page write-up | Source `submission/ONE-PAGER.md`; canonical target `submission/glass-box-trading-one-pager.pdf`, replaced at kickoff by exactly one form-accepted canonical type only if PDF is rejected | Reproducibly renders as exactly one page; MIME type, byte size, embedded fonts/images, visible presentation cutoff, and successful actual-form upload/link validation pass. It covers AI logic, deterministic risk gates, Alpaca MCP/CLI/API implementation, target user, result, and limitations. | Content/layout freeze Sep 3 20:00; cutoff render Sep 3 23:30 |
| SUB-04 | Video | Remotion source under `video/`; final `submission/glass-box-trading.mp4` | MP4, under five minutes and 300 MB; most runtime is the working demo; every displayed URL and number is injected from and names the single frozen presentation-cutoff dataset. | Narration/scene freeze Sep 3 20:00; cutoff render Sep 3 23:30 |
| SUB-05 | Slide deck | Marp source `submission/slides/deck.md`; final `submission/glass-box-trading.pdf` | PDF, at most 10 slides, readable without narration, all four event criteria covered; every mutable number comes from the same frozen presentation-cutoff dataset as SUB-03/04. | Layout/content freeze Sep 3 20:00; cutoff render Sep 3 23:30 |
| SUB-06 | Cover image | `submission/cover.png` | PNG or JPG, exact 16:9, legible at thumbnail size, no unsupported performance claim. | Sep 2 |
| SUB-07 | Form copy | `submission/COPY.md` | Title ≤50 characters; short description ≤255 characters; long description ≥100 words; final tags listed; exact copy matches submitted form. | Draft Sep 2; final Sep 3 |
| SUB-08 | Account evidence | competition account ID in local config and submission; public redacted BOOTSTRAP/snapshots/journal | BOOTSTRAP proves creation at/after kickoff, exact $100k cash/equity, zero positions/orders and complete empty trading history; ID matches every order-related entry; irreversible provenance latch remains clean. | Account Aug 28; evidence continuous; final snapshot Sep 4 17:00 |
| SUB-09 | Submission preflight | `submission/PREFLIGHT.md` | Every form field, upload, URL, account ID, revision, format, size, visibility, and cross-artifact number checked from a clean browser; the actual form accepts the one canonical SUB-03 upload/link target and its MIME/size; added, changed, stricter, or contradictory kickoff-form requirements are recorded and resolved. | Draft Sep 3; cutoff-identical run by Sep 3 23:45; rerun before Sep 4 12:00 |
| SUB-10 | Social links | none unless `DECISIONS.md` reopens O4 | If reopened: at most five eligible X/LinkedIn links, both organisers tagged, provenance and no engagement gaming. | Decision remains NO; revisit only on visible results |
| SUB-11 | Post-submit publication acceptance | dashboard publish pipeline and deployment receipts outside the trading journal | Every deadline/terminal candidate is fetched anonymously at its immutable URL and matches expected revision, cutoff, and freshness before atomic promotion; alias/probe failure preserves or restores the prior accepted deployment and alarms. | Automatically before every post-submit promotion |
| SUB-12 | Pre-arm live-test certificate | `evidence/pre-arm/<timestamp>.json`; SPEC S-ARM-01 | Dev role/account, canonical paper origin, `runtimeDigest`, and role-neutral `policyDigest` match deployment; pinned MCP runtime integrity, credit acceptance, real fill/reconciliation, liquidity inputs and credential-fence evidence complete; terminal dev account has zero positions/orders. Competition identity/provenance validates separately. | Aug 27 market close; regenerate after runtime or role-neutral policy change |

The Vercel implementation uses a staged production deployment with automatic
domain assignment disabled (`vercel --prod --skip-domain`), probes the generated
deployment URL, and only then runs `vercel promote`. A failed stable-origin
probe runs `vercel rollback` to the immediately previous accepted deployment.
This flow and immutable generated URLs are documented by Vercel in
[Deploying from the CLI](https://vercel.com/docs/cli/deploying-from-cli),
[Promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment),
and [Generated URLs](https://vercel.com/docs/deployments/generated-urls).
Deployment Protection must not require judge or probe authentication.

The actual submission form is unavailable before kickoff. Its first inspection
is a required delta check against this register, not a fresh research project.
Any added, changed, or stricter requirement is appended to
`HACKATHON-FACTS.md` and this table the same day. A material contradiction with
the event page blocks submission until an organiser clarification is recorded.

## 4.1 Evidence cutoffs

There are two deliberate evidence cuts:

- **Presentation cutoff:** the reconciled, risk-flat Sep 3 post-close account and
  journal revision used by the immutable one-pager, video, slides, cover, and
  form copy. Every number in those artifacts is labelled with this timestamp.
  A valid declared expiry hold remains visibly not-flat and cannot be omitted.
- **Deadline cutoff:** the Sep 4 17:00 CEST broker snapshot appended
  automatically to the public journal/dashboard and tied to the already
  submitted account ID. It may confirm or extend the presentation cutoff, but
  it is not retroactively claimed to appear in an uploaded immutable file.

All surfaces share account identity, provenance rules, and reconciliation
logic. Numbers only need to be equal when their labelled cutoff is equal. The
preflight rejects an unlabeled or cross-cutoff comparison.

## 5. Video and deck content

### Video, maximum five minutes

| Time | Content |
|---|---|
| 0:00–0:30 | The problem: autonomous trading is easy to claim and hard to audit. State the glass-box answer and current paper result. |
| 0:30–2:45 | Run the golden demo path: decision, rationale, veto, approved order/fill, reconciliation. |
| 2:45–3:40 | Show the architecture boundary and why the LLM cannot place an order. |
| 3:40–4:25 | Explain P&L, both sleeves, maximum-loss budgets, drawdown, and what one week cannot prove. |
| 4:25–4:55 | Show repository/tests and the public evidence that remains after judging. |
| 4:55–5:00 | End on the demo URL and project name. |

### Slide deck, maximum ten slides

1. Glass Box Trading: result and one-sentence thesis.
2. The auditability problem and target user.
3. The decision-to-fill golden path.
4. “AI proposes; deterministic gates dispose” architecture.
5. Options strategy and declared variance allocation.
6. Risk gates and bounded unattended worst case.
7. Broker-reconciled P&L and sleeve attribution.
8. Public journal, vetoes, and originality.
9. Failure drills, tests, and explicit limitations.
10. Demo URL, repository, and post-hackathon path.

## 6. Competition and delivery schedule

| When | Required state |
|---|---|
| Aug 25 | External contract frozen; winning-path review complete before scaffold. |
| Aug 26–27 | S-ARM-01 dev-account market-hours certificate passes for the exact runtime and role-neutral policy digests; core vertical slice and delivery skeleton take priority over broad feature coverage. |
| Aug 28 before 17:00 | Candidate build is deployable; no competition account exists in reused form. |
| Aug 28 from 17:00 | Inspect actual form, create the fresh $100k competition account, publish GitHub/Vercel, bind account ID. Arm during the Friday partial session only if the same pre-arm gates required for Monday have passed; otherwise delay rather than waive them. |
| Aug 29 17:00 | Public end-to-end golden path works. |
| Aug 30–Sep 1 | Competition operation, fault hardening, dashboard evidence, and first video/deck drafts. At Sep 1 US close, S-CYC-12 must show qualifying activity or expose `COMPETITIVENESS_AT_RISK`. |
| Sep 2 | Feature freeze except defects that block a criterion or safety invariant; cover and form copy ready. The bounded S-CYC-12 qualification window ends at US close; no fill means internal `WINNING_ACCEPTANCE_FAILED`, never a fabricated external eligibility ruling. |
| Sep 3 market close | Zero risk-bearing positions and zero non-terminal orders. Only the narrow, visible S-X-06 declared expiry hold may remain. This gives up the final Friday trading window for an auditable submission state. |
| Sep 3 20:00 | Freeze all narration, prose, and layout that does not depend on the still-open market. No artifact is called final against a future cutoff. |
| Sep 3 after market close | Reconcile broker truth, freeze one presentation-cutoff dataset and its immutable dashboard route, inject that dataset into video/slides/one-pager/copy, render canonical artifacts by 23:30, then run cutoff-identical preflight by 23:45. |
| Sep 4 by 12:00 | Submit with five hours of form/hosting contingency. |
| Sep 4 17:00 | Automated deadline reconciliation builds and externally verifies an immutable candidate before promoting it to the stable journal/dashboard URL; immutable uploaded artifacts remain truthfully labelled with the Sep 3 presentation cutoff. The US-close terminal snapshot gets the same candidate gate. |

## 7. Submission gate

Submission is blocked until all mandatory `SUB-*` rows are accepted or a
specific organiser-approved exception is recorded. A successful local build is
not acceptance evidence for a public URL. A manually approved six-hour
post-deadline submission exception is emergency recovery only and is never
part of the plan. `WINNING_ACCEPTANCE_FAILED` also requires an explicit owner
waiver, because safe submission may still be externally eligible while no
longer meeting this project's own P&L story.

## Rejected proposals

- **Treat Business Value as a fifth event criterion.** Rejected on 2026-08-25:
  it comes from the generic winning guide, while the rendered Alpaca event page
  publishes P&L Performance, Technology Implementation, Creativity &
  Originality, and Presentation & Execution. Target user and practical value
  remain useful presentation material; TAM and revenue speculation do not gain
  an invented scoring axis.
