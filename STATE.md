# STATE — live cursor

> Owns only the cursor (done / now / next) and open threads. Facts live in
> their owning docs: design = [`CONCEPT.md`](CONCEPT.md), decisions =
> [`DECISIONS.md`](DECISIONS.md), scenario standard =
> [`docs/SCENARIOS.md`](docs/SCENARIOS.md). Update on every session close and
> every decision.

**Last updated:** 2026-08-31 evening (P2 closed on its branch: green, riskiest mechanism gate-confirmed after seven calls; awaiting Felix's merge word)
**Branch:** `p2/journal-authority` at `615dbd0` + docs (implementation `d8281e5`; gate-finding fixes `0431ac9`, `6677b24`, `c13ab5e`, `e44809a`, `5d875ea`; robustness `615dbd0`; branched from the P1 merge `9778e6d` on local `main`); no GitHub remote yet
**Last accepted phase artifact:** P1 — merge commit `9778e6d` on local `main` (2026-08-31; owner acceptance with the adversarial run paused at R5, see DECISIONS.md). P2 is **complete on its branch and not yet merged**: it awaits Felix's word.
**P0 release baseline:** local `main` at `598f43e`
**Current implementation phase:** P2 — durable journal and mutation authority
([`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md#p2--durable-journal-and-mutation-authority)) — implementation complete, closing

## Done

- Hackathon registered (lablab.ai, user `fradzano`, team **Glass Box Trading**,
  solo, closed). Discord joined.
- Dev paper account `PA349COOGKZ1` live; keys + `CLAUDE_CODE_OAUTH_TOKEN` in
  local `.env` (gitignored).
- Tooling verified against the dev account: REST (options level 3, mleg order
  accept/cancel, indicative feed), MCP server (72 tools, read-only via
  `ALPACA_TOOLSETS`), CLI v0.0.13 (`~/tools/alpaca-cli/`, mleg + client-order-id
  + dry-run). CONCEPT §10.
- CONCEPT baseline → single-round cold read (6A/6B/3C, all folded in,
  `docs/cold-read-2026-08-24.md`) → initial 48-scenario catalog derived cold,
  since extended to 71 (`docs/SCENARIOS.md`).
- **External contract frozen:** `docs/HACKATHON-FACTS.md` records the rendered
  event page, source authority rules, account rules, judging criteria, deliverables,
  and the one-time kickoff form/P&L clarification.
- **Calendar corrected again from the official kickoff:** the event touches six
  US market dates (partial Fridays Aug 28 and Sep 4; full Mon–Thu). Canonical
  arming is the later of kickoff and a successful dev live test. Thursday Sep
  3 close remains the last risk moment; Friday is reconciliation-only.
- **Submission boundary specified:** `docs/SUBMISSION-SPEC.md` owns the four
  criterion evidence paths, public golden demo, dashboard performance payload,
  video, deck, one-pager, cover, form copy, account evidence, preflight, and
  anonymous acceptance of post-submit dashboard revisions.
- **Pre-kickoff implementation boundary decided:** published Alpaca rules permit
  a head start. Pre-event commits remain visible and are tagged as the baseline
  at kickoff; competition account creation and activity remain kickoff-gated.
- **Implementation is partitioned into proof-gated phases P1–P10:**
  `docs/IMPLEMENTATION-PLAN.md` assigns all 90 runtime test cases exactly once
  across P1–P7, then owns the release, operation, and submission stage gates.
- **P0 release branch established:** local `main` points at `598f43e`; P1 work
  starts on `p1/pure-entry-core`. `concept` remains as the historical planning
  ref; no remote exists.

## Now

**Calendar pressure governs the order of work now** (owner ruling
2026-08-31): P2–P6 must be complete before Tuesday 2026-09-01 15:30 CEST (US
open) so that P7's dev live certificate and P8's kickoff release can run in
that same market session; Wednesday 2026-09-02 15:30 CEST is the abort point
for competition arming, Wednesday 22:00 CEST the last qualification entry,
Thursday 22:00 CEST flat, Friday 12:00 CEST internal submission (17:00 external).
One phase per session; every session ends with the handoff protocol in
`docs/IMPLEMENTATION-PLAN.md` and an ahoy note for the next phase.

- **P1 accepted and merged (2026-08-31).** Pure entry-decision core, exact
  integer risk from one expiry-payoff evaluation, 37 allocated SPEC cases (45
  tests), static provenance gate (69-mutant self-test) and runtime sandbox
  gate (19 calibration mutants, export surface restricted to ordinary shapes
  by prototype identity), local glass-box fixture. Verification green at the
  merged tree (`npm run verify`, exit 0). Adversarial run R1–R5 in the store
  `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p1-pure-entry-core`,
  **paused, not terminated** (criteria 1, 5 met; 2, 3, 4, 6 open; `R4-F5`
  carries the owner's countersignature only). Inherited obligations:
  `RES-P1-01a..d` in `docs/EVIDENCE-DEBT.md` (every adapter validates snapshot
  shape and unit brands before `decide`), WIN-11 (P3), SES/`lockdown` backlog.
- **P2 — durable journal and mutation authority — implemented at `d8281e5`
  (2026-08-31).** All 12 allocated cases (S-J-01..06, S-G12-01..05/07) have
  red-first tests (31 tests, 5 files); `npm run verify` exit 0 (76 tests,
  static gate, sandbox gate now executing the journal and authority core,
  partition check). Delivered: pure `src/core/journal.ts` (closed schemas,
  UTC timestamps, line codec with torn-tail detection, redaction, halt
  transition, journal folds) and `src/core/authority.ts` (epoch acquisition,
  compare-and-increment, the single authorization rule, scheduling bounds,
  account binding); shell `state-dir`, `epoch-store` (atomic writes, holder
  heartbeat, `wx` mutex), `journal-store` (fsynced append, quarantine),
  `halt-state`, `mutation-gateway` (the one path for appends and future
  broker mutations; `NO_BROKER_PORT` is the only port), `manual-unhalt`,
  `gateway-cli` (real-process races in tests). Torn append, concurrent
  append (25 in-process, 5×8 across processes), stale writer holding and
  reacquiring the lock, unreadable epoch, takeover race (2 in-process, 6
  processes), witness append, and non-virgin epoch reset all execute in
  temporary `STATE_DIR`s. Evidence-debt rows discharged: BEQ-7, KGV-1/2,
  KGV-3, KGV-1-REG, KGV-11, WIN-16 (✅); in part BEQ-5, BEQ-6, GV-5, KGV-4,
  WIN-9 (◐, the S-CYC-11 halves belong to P4). Verification record: store
  `C:\Users\felix\verify-runs\fradzano\glass-box-trading\p2-journal-authority`
  (`LEDGER.md`): mutation probe 9/9 caught; blind gate on the epoch/fencing
  gateway: first call `task-mth6xs72-d7lqbi` aborted by the provider content
  filter (no verdict) after naming two edges that were real and are closed
  at `0431ac9` (G1-F1 observed-but-not-acquired epoch, G1-F2 seed obligation
  in memory only; see DECISIONS.md); second call `task-mth7dgrq-6dx7ps`
  ran read-only, could execute nothing (`VERDICT: NOT ISSUED`) but found
  G2-F1 (seed obligation cleared by takeover), closed at `6677b24`; third
  call `task-mth87op3-454yk7` (`--write`) executed and returned **REFUTED**
  with three class-A findings G3-F1/F2/F3 (entry epoch unbound; persisted
  holder id treated as acquisition — reached the broker port; reset path
  persisted the store before `GAP`/`HALT`), all closed at `c13ab5e`
  (`npm run verify` exit 0, 76 tests); fourth call `task-mth9f0wj-a6cuce`
  died at the provider content filter before any probe; fifth call
  `task-mth9nyst-0i2n0y` executed: G3-F1/F2 and the witness rule
  **confirmed**, G3-F3 **rejected** as G5-F1 (reset lines under an epoch
  with no store; duplicate pair on retry) → reset path redesigned as a
  persisted pending acquisition at `e44809a` (`npm run verify` exit 0,
  76 tests); sixth call `task-mthadqew-m9cxj9`
  executed: every reset variant **held**, one adjacent path **rejected** as
  G6-F1 (manual un-halt bypassed the pending-reset guard → duplicate pair)
  → closed at `5d875ea`; seventh call `task-mthb03w7-pwxs9p`
  (`prompts/G7-fixverify-manual-unhalt.md`, `--write`) returned
  **CONFIRMED** at `5d875ea`; its reviewer also observed a Windows rename
  sharing flake in the five-process test, closed at `615dbd0` (not
  gate-verified). **P2 closing state:** `npm run verify` exit 0 at `615dbd0`
  (76 tests); the epoch/fencing gateway, the reset path, the witness rule,
  and the manual un-halt path are gate-confirmed by executed evidence;
  schemas, redaction, binding, and the halt fold rest on the repository
  gates and the 9/9 mutation probe only (declared reduced depth,
  DECISIONS.md 2026-08-31). **Next action is Felix's:** merge
  `p2/journal-authority` into local `main` (`--no-ff`), or not. P3 then
  branches from the merge.
- Verification depth for P2–P6 under the calendar: red-first tests for every
  allocated case, the repository gates, one mutation probe per phase, and
  one blind counter-verification of the phase's riskiest mechanism. A full
  bis-0 run per phase does not fit before Tuesday; this reduction is now
  recorded in DECISIONS.md (entry of 2026-08-31, "Verification depth for
  P2–P6 is reduced by declaration").

## Next (after P2)

- **P3 — broker execution state machine and cycle safety under fakes** on its
  own branch from the accepted P2: the `DecisionSnapshot` adapter (discharges
  `RES-P1-01a..c`, reconstructs prior quotes via `latestQuoteSamples`), the
  fake broker behind `BrokerMutationPort`, the cycle runner that emits exactly
  one primary entry per invocation through the gateway. Scope in
  `config/implementation-phases.json` (12 cases).
- Continue P3–P7 in `docs/IMPLEMENTATION-PLAN.md`; a phase advances only after
  its shared and phase-specific gates pass. A waiver counts only where the
  owning SPEC explicitly permits it; otherwise the phase and arming stay blocked.
- Aug 26–27 target: reach the P7 market-hours dev certificate if every earlier
  phase passes; schedule pressure delays arming rather than collapsing phases.
- Fri Aug 28 kickoff 17:00 CEST: inspect the real submission form, create the
  competition account (owner), put its keys in `.env` (`ALPACA_COMP_*`),
  publish GitHub + Vercel, and arm in the partial session only if pre-arm gates
  are green.

## Open threads

- P1 adversarial run is paused at R5 of 8 (store `R5.md`, `LEDGER.md`);
  resumable from R6 (prompts staged in the store) if time allows after P8.
  Preserve the store and its errata (`E-R1-01`, `E-R2-01`, `E-R4-01..04`,
  `E-R5-01..04`); do not rewrite history.
- Harness notes (R4/R5): launch Codex companion calls from the repository
  directory (a store-directory launch registers the job under another
  workspace and `status`/`result` there return nothing); the queue can leave a
  job `queued` indefinitely (cancel via PowerShell, relaunch fresh; zombie
  entries `task-mtgioru5-beltgf`, `task-mth0zx0s-ccqad7` are never waited on);
  Sol calls can end with `model at capacity` or a provider content filter
  (`E-R5-01`) — archive the interim, relaunch, and phrase purity-gate prompts
  in neutral engineering vocabulary; a gate call with targeted commands takes
  10–20 minutes, one that runs `npm run verify` on copies 30–45.

- O5 (CONCEPT §9): remaining gate thresholds — freeze before the actual first
  arm; cycle cadence is already fixed at 15 minutes.
- Kickoff delta check: actual submission form fields and the organiser's P&L
  window/formula answer; append once to `docs/HACKATHON-FACTS.md`.
- Build the analyst MCP in its dedicated environment from the pinned official
  commit and frozen dependency lock; S-CYC-11 must verify it before dev arming.
- O4: social track = NO for now; revisit only on visible results.
- GitHub remote does not exist yet; publishing `main` remains a P8 owner gate.
- Repo maps: regenerate via pre-commit hook (`git config core.hooksPath hooks`,
  activated locally; note for fresh clones).
