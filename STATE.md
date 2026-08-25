# STATE — live cursor

> Owns only the cursor (done / now / next) and open threads. Facts live in
> their owning docs: design = [`CONCEPT.md`](CONCEPT.md), decisions =
> [`DECISIONS.md`](DECISIONS.md), scenario standard =
> [`docs/SCENARIOS.md`](docs/SCENARIOS.md). Update on every session close and
> every decision.

**Last updated:** 2026-08-25 (daytime)
**Branch:** `concept` (no `main` yet — created at publish time, no GitHub remote yet)

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
  `docs/cold-read-2026-08-24.md`) → scenario catalog derived cold
  (`docs/SCENARIOS.md`, 48 scenarios).
- **Calendar fixed:** Sep 4 2026 is a FRIDAY. Five trading sessions, flatten
  Thu Sep 3 close, deliverables Thu evening, submission Fri morning.

## Now

**Build order ladder: Szenario ✅ → Axiom ✅ → Spec ✅ (capped pass done) → Code.**

- Axioms distilled (24, `docs/AXIOMS.md`), owner-reviewed 2026-08-25; owner
  calls A–D decided (DECISIONS.md).
- Spec written (`docs/SPEC.md`, 85 test cases + 1 declared limit, with a
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
- Next: TypeScript foundation — scaffold, journal types, pure core,
  red-first tests per SPEC §0.5 tiers, evidence-debt paths first-class.

## Next (after the ladder)

- Foundation + gates + tests (was planned for the build weekend; pulled forward
  by owner decision 2026-08-24 — see DECISIONS.md).
- Market-hours live test of credit structures on the DEV account (O1 leftover),
  possible from Tue 15:30 CEST.
- Fri Aug 28 kickoff: competition account (owner), its keys into `.env`
  (`ALPACA_COMP_*`), GitHub publish + Vercel wiring.

## Open threads

- O5 (CONCEPT §9): budget percentages, gate thresholds, cycle cadence — freeze
  before go-live Mon Aug 31.
- O4: social track = NO for now; revisit only on visible results.
- GitHub remote does not exist yet; `main` is created at publish (owner gate).
- Repo maps: regenerate via pre-commit hook (`git config core.hooksPath hooks`,
  activated locally; note for fresh clones).
