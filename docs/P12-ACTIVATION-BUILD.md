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
| 2 | Ledger codec: parse lines, torn tail, `seq` gaps, non-monotonic `at` | **done** — `ops/activation/core/ledger.ts`, 12 tests, mutation probe 14/14 | `ba30ed2` |
| 3 | Fold: ledger → attempts, per anchor day, with abort ending an attempt | **done** — `ops/activation/core/fold.ts`, 12 tests, mutation probe 13/13 with one declared equivalent (see decisions) | `56eb9e7` |
| 4 | Step table: windows, order, prerequisites, expected world per phase | **done** — `ops/activation/core/steps.ts`, 26 tests (every window of spec §5 pinned), mutation probe 13/13 | unit 4 commit |
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
- **Day steps are scoped to the attempt, not only to the anchor day.** The spec
  resets steps 4 and 7–11 when the anchor day changes; the fold goes one step
  further and counts them only inside the attempt that ran them. An attempt has
  exactly one anchor day, so this is the stricter form of the same rule, and it
  also covers a new attempt on the same day after an owner abort. Steps 0–3 carry
  over from any attempt, latest result wins — a later failure included.
- **Mutation probe, fold: F6 is an equivalent mutant.** Removing the
  `resultSeq === null` check changes nothing, because the fold sets `resultSeq` and
  `outcome` together, so an intent-only step already fails the outcome test. It was
  replaced by a real mutant at the same site (F6b: an intent-only step returns
  done), which the suite catches.
- **Steps 0 and 1 expire with step 2's window (22:40 on the certificate day).** The
  spec gives them no clock, but they only exist to gate step 2.
- **Closing the reboot's result is bound by `7-rearm`'s window, not by `8-reboot`'s.**
  The first invocation after the boot writes that result, which can be later than
  13:45; it must still come before 13:59.
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

Mutation probes, one set per core unit, live in `ops/activation/probes/`:

```powershell
node ops/activation/probes/mutate-activation.mjs ops/activation/core/ledger.ts ops/activation/probes/mutants-ledger.json
node ops/activation/probes/mutate-activation.mjs ops/activation/core/fold.ts   ops/activation/probes/mutants-fold.json
node ops/activation/probes/mutate-activation.mjs ops/activation/core/steps.ts  ops/activation/probes/mutants-steps.json
```

Never add or edit a `*.spec.ts` while a probe runs.

## Session boundary — 2026-09-13, 23:55

The first build session ended here on purpose, at a unit boundary: units 1–4 are
done, verified and pushed, and unit 5 is the most safety-critical function of the
core. It gets a fresh session rather than the tail of a very long one.

## Next step

**Unit 5: `decide(fold, observations, schedule): Decision`** in
`ops/activation/core/decide.ts`. Read spec §5 (the step table and the abort,
owner-abort and retry paragraphs), §6 and §7 first; everything below is a brief,
not a substitute for them.

**Order of evaluation, as a starting point:**

1. **Integrity.** An empty ledger starts at step 0. A torn or corrupt ledger, or any
   `fold.inconsistencies`, is an abort: the state is unknown, verify against the
   world.
2. **Attempt ended.** `fold.attemptEnded` means this attempt may not act at all — no
   action, whatever the world looks like. A new attempt is opened by the CLI or the
   owner, never by `decide`.
3. **`0-resume`.** Compare the world with the expectation of the current phase, using
   `expectedTasks` and `expectedCertificateLine` from `steps.ts`: task states; once
   step 1 is done, both task definitions **by value** (`powershell.exe`,
   `-File …\tools\cycle-run.ps1`, `-SkipOutsideSession` and `-SessionLeadInMinutes`
   absent or at their defaults); the certificate line; `ALPACA_PROFILE` is
   `competition`; the resolved account equals `schedule.longRunAccountMasked`; no
   duplicate `.env` key; the wrapper hash equals the one step 0 recorded. **Any
   reading the current phase depends on that is `known: false` is an abort (A1).**
4. **Interrupted step.** An interrupted `8-reboot` is closed by the first invocation
   after the boot: `ok` when `bootUtcMs` is later than the intent, `failed` otherwise,
   bound by `7-rearm`'s window. Any other interrupted step is an abort.
5. **Next step and its window.** `nextStep(fold)`; `null` is done. Before `opens` is a
   wait; after `notValidAfter` is an abort naming the missed deadline.
6. **The step itself**, per spec §5: validate-only steps (2, 3, 9) record; acting
   steps return their actions; the gate (10) evaluates the conjunction of §7 and only
   then writes **the certificate path validated in step 2** and deletes the disarm
   task.

**Type gaps to close at the start of unit 5**, found while writing units 1–4:

- `Observations` has no reading for the analyst start and the OAuth token that step 0
  requires, and none for the `BOOTSTRAP` journal entry that step 11 records.
- `Decision` has only an `abort` that tears down. Spec §5 says an abort **after** step
  10 must page and record without disabling a correctly armed run, so a
  non-tearing variant is needed.
- The disarm registration needs its local time (15:05 on the anchor day) and the
  certificate path to write needs to come from step 2's recorded evidence.

**Design points to settle in unit 5, with a test each:**

- An invalid silence drill (API unreachable, or a wrapper log line inside the silence
  window) — the spec says "recorded invalid and repeated, never counted", but the
  night's window may not allow a repeat. Decide whether that is an abort of the
  attempt or a bounded retry, and write it into the build log.
- What "an observed firing after the enable" (step 5a) and "an observed ping" (step
  6a) mean precisely in terms of `cycleLog` / `watchdogLog` lines and their UTC stamps
  relative to the enabling result's `atUtcMs`.
- Session samples for step 9: which sample counts as "13:55" and "14:05" when the
  invocations do not land exactly on those minutes.

**Tests**: a recorded world per step for the happy path, one per red condition, one
per deadline, the interrupted-reboot closing in both outcomes, the attempt-ended
case, the integrity abort, and an unknown reading in every phase that depends on it.
Then a mutant set in `ops/activation/probes/mutants-decide.json` and the probe.

After unit 5: units 7–10, the shell.
