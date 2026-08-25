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

**Build order ladder in progress: Szenario ✅ → Axiom ✅ → Spec → Code.**

- Axioms distilled (24, `docs/AXIOMS.md`), owner-reviewed 2026-08-25
  (blind/gate pass; 1 A + several B findings fixed, incl. new A24 account
  binding). Owner calls A–D decided — see DECISIONS.md 2026-08-25 entries.
- Next: concretize axioms into the spec (cases per gate) — the red-first test
  oracle; then the capped adversarial pass: 2–3 rounds max (owner-agreed
  deviation from the full bis-0 end condition; if not at 0 at the cap,
  declare and the owner decides).
- Only then: TypeScript foundation (scaffold, journal types, pure core).

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
