# Glass Box Trading — agent instructions

Yes, this file is committed on purpose. A glass-box project publishes its build
rules along with its decisions. Design baseline: [`CONCEPT.md`](CONCEPT.md) —
read it first; this file only adds working conventions.

## Invariants (do not relax)

- **Paper only.** This project never touches a live brokerage account, ever.
- **Secrets never enter the repo.** Keys live in `.env` (gitignored);
  `.env.example` documents the shape. A secret found in a diff or in history
  means stop and report, not silently clean up.
- **Account separation.** Dev account = sandbox, freely disposable. Competition
  account (from Aug 28) runs the agent exclusively; no experiments on it.
  Selection is explicit via `ALPACA_PROFILE` — never hardcode an account.
- **Defined-risk only.** No code path may construct a position whose maximum
  loss is not fixed at order entry. No naked short options, anywhere.
- **The LLM has no code path to an order.** Analyst output is schema-validated,
  whitelist-constrained candidates; only the deterministic core approves
  actions; only the executor places orders.
- **Journal is append-only.** Entries are never edited or regenerated;
  corrections are new entries.

## Conventions

- Functional Core / Imperative Shell. Decision logic is pure (time, config,
  account snapshot as parameters); I/O lives in the shell. Core code ships with
  its tests.
- TypeScript / Node end-to-end (agent, dashboard generator, Remotion video).
- Everything in the repo is English. License: MIT.
- Commits: work happens on feature branches; `main` is release state.

## GitHub identity

Repo lives under `~/source/repos/` → private identity (fradzano). Before `gh`
operations: `gh auth switch --user fradzano`.
