# STATE — live cursor

> Owns only the cursor (done / now / next) and open threads. Facts live in
> their owning docs: design = [`CONCEPT.md`](CONCEPT.md), decisions =
> [`DECISIONS.md`](DECISIONS.md), scenario standard =
> [`docs/SCENARIOS.md`](docs/SCENARIOS.md). Update on every session close and
> every decision.

**Last updated:** 2026-08-31 midday (P1 accepted and merged; P2 is the active phase)
**Branch:** `main` holds the accepted P1 (merge of `p1/pure-entry-core`); P2 work starts on `p2/journal-authority` branched from that merge; no GitHub remote yet
**Last accepted phase artifact:** P1 — merge commit on local `main` (2026-08-31; owner acceptance with the adversarial run paused at R5, see DECISIONS.md)
**P0 release baseline:** local `main` at `598f43e`
**Current implementation phase:** P2 — durable journal and mutation authority
([`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md#p2--durable-journal-and-mutation-authority))

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
- **P2 — durable journal and mutation authority — is the active phase.**
  Scope (machine-owned in `config/implementation-phases.json`): 12 cases
  S-J-01..06 and S-G12-01..05/07. Deliver the append-only JSONL journal with
  closed entry schemas, redaction, account binding, halt state, epoch store,
  serialized append path, and the single final mutation gateway; validation
  and transition decisions stay pure in `src/core/**`, the journal is an
  adapter in the shell. Acceptance beyond the shared gate: crash/torn-append,
  concurrent append, stale writer, unreadable epoch, takeover race, witness
  append, and non-virgin epoch-reset paths execute in isolated temporary
  state; holding or reacquiring an OS lock never authorizes a stale epoch; the
  broker port still has no real implementation. Evidence-debt rows to
  discharge in P2: the S-J/S-G12 rows in `docs/EVIDENCE-DEBT.md`.
- Verification depth for P2–P6 under the calendar: red-first tests for every
  allocated case, the repository gates, one mutation probe per phase, and
  one blind counter-verification of the phase's riskiest mechanism (for P2:
  the epoch/fencing gateway). A full bis-0 run per phase does not fit before
  Tuesday; this is a declared reduction, recorded in DECISIONS.md when P2
  closes, never a silent one.

## Next (after P2)

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
