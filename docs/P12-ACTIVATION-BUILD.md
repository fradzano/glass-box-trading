# P12 activation — build log

The working record of building the activation script specified in
[`P12-ACTIVATION-SPEC.md`](P12-ACTIVATION-SPEC.md) (revision 6). It exists so that
a fresh session can continue from here without the transcript of the one before:
every unit below is either done — with its commit — or not, and the next step is
always named at the bottom.

## Ground rules for this build

- **The date is not fixed.** Owner ruling 2026-09-13 23:35: build first, see how
  far it gets; split into several sessions when it gets late or the context runs
  short; move the anchor by a week if needed. The spec's step table is written for
  "Monday certificate, Tuesday anchor" and stays valid for whichever week that is.
- **State is written continuously.** After every finished unit: tests green, this
  log and `STATE.md` updated, committed and pushed. Nothing that matters lives only
  in a session's context.
- **Functional core, imperative shell.** Decisions live in `ops/activation/core/`
  as pure functions over the ledger and a snapshot of observations; the shell
  reads the world, calls the core, applies the result. The core obeys the same
  rules as `src/core/` (no I/O, no clock, no `Intl`, no module-scope tables), so
  that the architecture gate can cover it once it gets its second root.
- **Outside the certified digest.** Nothing under `ops/` enters the runtime digest.
  Changes that do — the architecture gate's second root, the certificate command
  guard's `STATE_DIR` coupling, any `package.json` script — are collected into one
  batch that must land **before** the certificate run.

## Open owner decisions, and the default the build assumes

| Decision | Default until ruled | Effect on the build |
|---|---|---|
| Anchor week | not fixed | none — dates are parameters |
| Rotate the three checks? | **no** (recommended 2026-09-13: condition 4 is now complete on these endpoints) | none — step 0 compares fingerprints either way |
| Certificate human checkpoint | **variant A**: the owner starts the run and types `CLEAR-HALT` | step 2 validates an artefact; variant B would add a step `1a` and a change in `src/` |

## Facts established since revision 6

- **Gate condition 4 is met** for the three current endpoints `hc:c4ad5b69`
  (readiness), `hc:a685fe10` (liveness), `hc:b76072aa` (watchdog): alert receipt
  confirmed 2026-09-11 22:01, and the owner confirmed on 2026-09-13 23:26 that the
  hourly reminders arrived after the setting was switched on at 23:54.
- **Host re-checked 2026-09-13 23:30:** both tasks `Disabled`, the cycle task still
  the stale direct-node registration, `longrun-1` empty, the three checks `paused`
  with the fingerprints above, branch in sync at `340444a`.

## Units

| # | Unit | Status | Commit |
|---|---|---|---|
| 1 | Core types: step ids, ledger entry, observation snapshot, decision | **done** — `ops/activation/core/types.ts` | see unit 2 |
| 2 | Ledger codec: parse lines, torn tail, `seq` gaps, non-monotonic `at` | **done** — `ops/activation/core/ledger.ts`, 12 tests, mutation probe 14/14 | first `ops/` commit |
| 3 | Fold: ledger → attempts, per anchor day, with abort ending an attempt | open | |
| 4 | Step table: preconditions, deadlines, expectations per step | open | |
| 5 | Decide: fold + observations + clock facts → act / wait / abort / done | open | |
| 6 | Core tests against recorded worlds, including the retry and abort paths | open | |
| 7 | Shell readers: tasks, checks API, `.env`, logs, boot time, sessions | open | |
| 8 | Shell actions: enable/disable, disarm task, reboot, `.env` write, pings | open | |
| 9 | Ledger store: append with fsync, lock file, append failure as abort | open | |
| 10 | CLI: `status`, `run`, `abort --confirm`, `--dry-run` | open | |
| 11 | Digest batch: gate second root, guard `STATE_DIR` coupling, scripts | open | |
| 12 | Adversarial review of the code against the catalogue | open | |
| 13 | Elevated registration command and dry-run rehearsal on the host | open | |

## Decisions taken during the build

- **Steps 5 and 6 are split into phases** (`5a`–`5d`, `6a`–`6c`). Each phase is its
  own invocation minutes apart — disable, observe down, re-enable, observe up — and
  each must be reconstructible from the ledger alone.
- **Every ledger line carries `atUtcMs` next to `at`.** The shell writes both at
  append time, so the core orders entries without parsing a date (the architecture
  gate forbids `Date` and `Intl` in core code).
- **Every ledger line carries `anchorDay`.** Round 5's finding A2 — a retry must not
  inherit yesterday's reboot proof — needs results to name the day they are about.
- **`at` must carry an offset; a bare `Z` is refused.** The spec wants local time
  with offset, so a reader needs no conversion table.
- **The ledger refuses secret-shaped values by shape**: UUIDs, `hc-ping.com` URLs and
  healthchecks.io API URLs, anywhere in `evidence` or `nextOwnerAction`. The
  2026-09-12 exposure came from a deny-list that forgot one field; a shape check
  catches the field nobody listed.
- **`ops/tsconfig.json` and `ops/vitest.config.ts` live beside the code.** The root
  `tsconfig.json`, `vitest.config.ts` and `package.json` are digest material, so the
  activation gets its own typecheck and test run without touching them. The root
  ESLint configuration already covers `ops/**/*.ts` (typed, via the project
  service), so `npm run verify` lints it. `allowImportingTsExtensions` and
  `erasableSyntaxOnly` are set so that Node 24 runs the code without a build.
- **Not yet applied to `ops/`: the architecture gate.** It hardcodes `src/core` and
  gets its second root in unit 11. Until then the core is written to its rules by
  hand, and the mutation probes carry the evidence that the tests bite.

## How to run the checks

From the repository root:

```powershell
npx.cmd tsc -p ops/tsconfig.json
npx.cmd eslint ops
npx.cmd vitest run --config ops/vitest.config.ts
```

## Next step

Unit 3: the fold — ledger to attempt state, per anchor day, with an abort ending the
attempt.
