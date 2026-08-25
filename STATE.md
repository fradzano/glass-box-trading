# STATE — live cursor

> Owns only the cursor (done / now / next) and open threads. Facts live in
> their owning docs: design = [`CONCEPT.md`](CONCEPT.md), decisions =
> [`DECISIONS.md`](DECISIONS.md), scenario standard =
> [`docs/SCENARIOS.md`](docs/SCENARIOS.md). Update on every session close and
> every decision.

**Last updated:** 2026-08-25 (P1 branch cut)
**Branch:** `p1/pure-entry-core` (branched from local `main` at `598f43e`; no GitHub remote yet)
**Last accepted phase artifact:** P0 at `0486dd3`
**P0 release baseline:** local `main` at `598f43e`
**Current implementation phase:** P1 — pure entry-decision core
([`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md#p1--pure-entry-decision-core))

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

**Build order ladder: Szenario ✅ → Axiom ✅ → Spec ✅ → winning/submission
reverse read ✅ → Code next.**

- Axioms distilled (28, `docs/AXIOMS.md`), owner-reviewed 2026-08-25; owner
  calls A–D decided (DECISIONS.md).
- Spec written (`docs/SPEC.md`, 90 test cases + 1 declared limit, with a
  build-priority MVP cut in §0.5) and run through the capped adversarial
  pass `spec-pass` (2 rounds of the 2–3 cap; NOT a bis-0 termination).
  R1: 17 findings (2 A, 14 B, 1 C), all A and most B RESOLVED via gate
  counter-verification; R2: regressions + fresh lenses, mutation probe
  injected and CAUGHT (calendar mutant found by a blind checker). Final
  audit + re-audit ran; the run ends as a **Vorlage with open
  discrepancy** (D16 executable-declaration dispute, N1/N2 bookkeeping).
- **Owner rulings 2026-08-25 (all recorded in DECISIONS.md):** Vorlage
  accepted as capped; D16 "executable: yes" → evidence debt; GV-2 solved
  by writer FENCING (epoch at a single mutation gateway, witness-append
  class, `STATE_DIR` binding; O5: 15-min cycle, dead-man 50+10 min);
  GV-3/6/8 solved by typed revalidation claimset, discriminated recovery
  policy (S-X-06, assignment exception to A23), journal-backed quote
  history. All folded into SPEC through commit `9a23853`; the
  owner-ordered cold seam verification (R3) confirmed the fencing class
  fix (KGV-1/2/3 RESOLVED), KGV-4 rests as a declared limit inside
  S-G12-07, and every remaining B is a pfadpflichtige row in
  **`docs/EVIDENCE-DEBT.md`** (the tracked register the red-first tests
  must discharge).
- The winning-path reverse read is complete. Its delivery pass closed the
  evidence-cutoff, staged-publication, canonical one-page artifact, and
  post-close render seams. Its runtime passes closed competition provenance,
  emergency-close audit semantics, expiry-hold consistency, bootstrap
  diagnostics, whitelist bounds, MCP capability enforcement, certificate
  identity separation, watchdog residue dispatch, stale-writer authority,
  route-independent close idempotency, and MCP supply-chain pinning. Every
  confirmed A/B finding from these waves is folded into scenarios, axioms,
  spec, decisions, submission acceptance, and `docs/EVIDENCE-DEBT.md`, then
  counter-verified. This was an adversarial winning-path review, not a formal
  bis-0 termination; executable implementation paths remain evidence debt.
- **P1 is next:** build the TypeScript/Node foundation and complete pure
  entry-decision core for S-CORE-01..03 and G1–G8 (37 cases), including the
  architecture boundary and a local glass-box fixture. No broker-capable
  adapter exists in this phase. Acceptance and failure conditions live only in
  the linked P1 plan section.

## Next (after P1)

- Continue P2–P7 in `docs/IMPLEMENTATION-PLAN.md`; a phase advances only after
  its shared and phase-specific gates pass. A waiver counts only where the
  owning SPEC explicitly permits it; otherwise the phase and arming stay blocked.
- Aug 26–27 target: reach the P7 market-hours dev certificate if every earlier
  phase passes; schedule pressure delays arming rather than collapsing phases.
- Fri Aug 28 kickoff 17:00 CEST: inspect the real submission form, create the
  competition account (owner), put its keys in `.env` (`ALPACA_COMP_*`),
  publish GitHub + Vercel, and arm in the partial session only if pre-arm gates
  are green.

## Open threads

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
