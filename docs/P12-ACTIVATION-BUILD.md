# P12 activation — build log

The working record of building the activation script specified in
[`P12-ACTIVATION-SPEC.md`](P12-ACTIVATION-SPEC.md) (revision 10 since 2026-09-14). It exists so that
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

- **Gate condition 4: owner evidence present, confirmation not recorded.** For the three
  current endpoints `hc:c4ad5b69` (readiness), `hc:a685fe10` (liveness), `hc:b76072aa`
  (watchdog) the owner reported the alert received 2026-09-11 22:01 and, on 2026-09-13
  23:26, that the hourly reminders arrived after the setting was switched on at 23:54.
  Since the review of 2026-09-14 that statement is not yet what step 0 reads: the
  confirmation file does not exist, because `confirm-alerts` has not been run, and the
  reminder mail's exact receipt time is not in the repository. The gate has never run.
  (This bullet said "is met" until 2026-09-14; that mixed the owner's statement with a
  recorded confirmation.)
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
| 5 | Decide: fold + observations + clock facts → act / wait / abort / done | **done** — `ops/activation/core/decide.ts`, 105 tests (155 in the activation suite), mutation probe 81/81 including five wiring mutants; architecture-gate inspector clean except the `.ts` extensions (see decisions). **Corrected in unit 6:** `-MaxLogBytes` on the watchdog task (red-first test, mutant D67, probe 82/82) | `8b7b888`, fix in the unit 6 commit |
| 6 | Core tests against recorded worlds, including the retry and abort paths | **done** — `ops/activation/tests/simulator.ts` and `sequences.spec.ts`, 14 sequences (172 tests in the activation suite); decide probe 82/82, the sequences alone 21/82 (a measure, see decisions) | unit 6 commit |
| 7 | Shell readers: tasks, checks API, `.env`, logs, boot time, sessions | **done** — absolute schedule deadline restored beside the five-second lease; real step-10 14:55:01 counterexample and D119–D122 close the boundary | `c996333`, `75e6b56`, `3fbd239`, `0e606d8`, `bfdb4da`, `fa0fbe7`, this commit |
| 8 | Shell actions: enable/disable, disarm task, reboot, `.env` write, pings | **done** — fake-only effect shell, deadline-linearized certificate CAS, pre/post digest validation, bounded abortable ports, compensating teardown | this commit |
| 9 | Ledger store: append with fsync, lock file, append failure as abort | **done** — external blockers reproduced red; physical path/process identities, fold wiring and six real delta seams closed; independent fix-gate A=0/B=0/C=0 | `bdcac95` is superseded; closed in this commit |
| 10 | CLI: `status`, `run`, `open`, `abort --confirm`, `disarm`, `--dry-run` | **done** — `ops/activation/cli.ts` plus six modules, 543 in the activation suite, probes 74/74 | this commit |
| 11 | Digest batch: gate second root, guard `STATE_DIR` coupling, scripts | **brief written** 2026-09-17 (below); D-11.1 ruled A | |
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
  also covers a new attempt on the same day after an owner abort. Steps 1 and 2 carry
  over from any attempt, latest result wins — a later failure included. (Until
  `0e606d8` steps 0 and 3 carried over too; the second review of unit 7 showed that a
  retry then inherited an expired alert confirmation and an old flat check. They now
  run in every attempt, and step 0 keeps the previous attempt's wrapper hashes as its
  baseline.)
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

### Unit 5 — `decide`

- **The gate's inspector was run against `ops/activation/core` without changing the
  gate** (its `inspectCoreDirectory` is exported; a scratch script imports it). It
  found two member names it forbids that date from unit 1 — `arguments` and `now` —
  now `argumentLine` and `nowLocal`. What remains is one finding per file: the gate
  type-checks without `allowImportingTsExtensions`, and Node 24 needs the `.ts`
  extensions. **Unit 11 must decide** whether the second root gets that compiler
  option or the core drops the extensions behind a loader; the AST checks already
  pass.
- **`record` is its own decision, not an action.** A validate-only step writes one
  `result`; an acting step writes `intent`, applies its actions, and writes `result`
  `ok` when all applied or `failed` at the first that did not. Whether an applied
  action took effect is judged by the next invocation's `0-resume` against the
  phase the result put the ledger in — the same observation that catches a manual
  change (ACT-26). A `failed` or `unknown` result in the current attempt aborts; one
  from a previous attempt is re-run.
- **`abort` carries `teardown`**: true for every abort up to and including the gate,
  and for every integrity abort even after it (a torn ledger cannot show that the run
  is correctly armed); false once the gate is done, where an abort pages and records.
  **`ended`** is a separate answer for an attempt an earlier abort ended.
- **An empty ledger is a tearing abort (`LEDGER_EMPTY`)**, as spec §4 says for an
  absent ledger. The CLI that opens an attempt writes its first note before the first
  scheduled invocation, so an owner-started attempt never pages for this.
- **The expected wrapper hash comes from the ledger**, step 0's result evidence, not
  from `Schedule`, which lost that field: one source for one fact (A4). The same holds
  for the certificate path the gate writes (step 2's evidence) and the host
  preconditions the re-arm compares (step 0's evidence).
- **Type gaps closed:** `Observations` gained the analyst start and OAuth token, free
  disk, the verifier run both without and with `-ExpectEnabled` (the shell takes both
  on every invocation, so it never decides which), the disarm registration, and the
  journal's `BOOTSTRAP` entry; `SessionSample` gained `utcMs`; `Schedule` gained the
  coverage date, the expected host preconditions and the free-disk floor;
  `StepState` gained `resultAtUtcMs`, from which the drills measure.
- **Step 1 is an action with its verifier inside it.** `install-tasks` runs the
  installer and then the verifier and fails unless both exit 0; the shell records the
  count and both action lines. It is skipped as already-in-target-state when the
  definitions are right by value and the verifier passed. "Build current" is observable
  only as printable digests; that limit is declared here.
- **Task definitions by value** (`definitionFindings`): `powershell.exe`, exactly the
  installer's host options before `-File`, the right script, and after it only the full
  parameter names the wrappers declare. PowerShell binds any unambiguous prefix and
  binds bare tokens positionally, so `-Skip:$false` or a stray token is red.
  `-SkipOutsideSession` is accepted only as `-SkipOutsideSession:$true` (a `[bool]`
  through `-File` binds only in the colon form), `-SessionLeadInMinutes` only as `20`;
  the watchdog task may carry neither.
- **Unknown in drill phases (design decision).** Local readings (logs, tasks, `.env`)
  abort at once everywhere. The healthchecks.io API, while a drill phase waits for it
  to show a state (5a, 5b, 5d, 6a, 6b), is a **wait bounded by the phase's deadline**:
  a single 429 must not end the night (ACT-47), and the deadline turns lasting
  blindness into an abort. At step 0, 4, 8 and the gate an unreadable API is an abort.
- **Design point 1 — an invalid silence drill ends the attempt** (`DRILL_INVALID`,
  tearing). A repeat inside the same night is arithmetically impossible: the drill can
  only be judged once all three checks are down, and readiness needs about 65 minutes
  from its last ping (spec §5: a ping by 23:15, down by 00:20), so not before about
  23:55 even when 6a starts at 22:50 — while a second 6a would have to start by 23:15
  and the cycle window closes at 23:45, so nothing could bring the checks back up for a
  second run. "Repeated, never counted" therefore means:
  the abort names the drill invalid, and the retry on the next trading day repeats it
  from step 4. The same holds for the watchdog drill. An invalid drill is detected as
  early as possible — wrapper lines inside the window invalidate it before the checks
  go down.
- **Design point 2 — what "observed" means.** 5a's observed firing is a `run:` or
  `skip:` line in `watchdog-run.log` whose UTC stamp is after the enable's result, **and**
  the watchdog check `up` on a ping after that same moment — a check still paused from
  step 0 never goes down, so a firing without its ping proves nothing. 5d needs the
  watchdog `up` on a ping after the re-enable's result. 6a's observed ping is every
  check `up` on a ping after 5d's result; 6a also waits while either task reads
  `Running`. 6b tolerates wrapper lines up to **120 s after the disable's result**:
  disabling does not stop a running instance, and the wrapper writes its line after its
  pings, so such a line is an invocation finishing, not a firing the disable failed to
  prevent. Any later line is the outage signature.
- **Design point 3 — step 9's samples.** The shell takes one session sample on every
  invocation and appends it to its own sample log without judging it. The proof takes
  the **last sample of 13:50–13:59** and the **first of 14:00–14:10** on the anchor day,
  both with a UTC stamp after the recorded boot; neither may show an interactive session
  or an explorer process. A missing 13:5x sample aborts at once (it cannot appear
  later); a missing 14:0x sample or firing waits until 14:35.
- **Two conditions added beyond the table, both fail-closed.** Step 4 requires each
  check `up` or `paused` (step 0 accepts both; the gate later requires `up`). Step 8
  requires all three `up` before restarting, so the machine is not rebooted into a gate
  that cannot turn green; the retry paragraph of §5 asks the same.
- **Step 11** records the first watchdog firing after the gate. Telling an armed
  composition line from a degraded one (spec §8.12) needs a line shape the log reader
  does not produce yet — **open for unit 7**.
- **Open for unit 9:** after a torn tail the next append would glue onto the torn bytes
  and the ledger would read corrupt from then on. The store needs a rule for appending
  after a torn tail that keeps the torn bytes visible and never repairs them.

### Unit 6 — sequences against a simulated world

- **The simulator lives in the test tree** (`ops/activation/tests/simulator.ts`), so the
  core cannot import its own yardstick. It advances a clock minute by minute, fires the
  tasks, settles the checks, fires the disarm, and every five minutes inside the
  activation task's trigger windows invokes `decide` and applies the answer by the shell
  contracts of unit 5. Its model is written at the top of the file so it can be checked
  against the host: cycle every 15 min 14:00–23:45 (`run:` 15:10–21:59), watchdog every
  10 min 14:00–23:55, a check due at its next slot after the last ping (the next day's
  14:00 when none is left) and down after slot plus grace (liveness 30, readiness 50,
  watchdog 15 min), a paused check paused until a ping, a restart of three minutes.
- **The happy path runs unaided** from Monday 15:30 to Tuesday 15:25: every step once, in
  execution order, no abort, `done`, and the moments pinned — enable 22:05, watchdog
  disable 22:15, down 22:40, up 22:50, silence 23:00, all down 00:10, reboot 13:30 closed
  13:35, re-arm 13:50, proof 14:05, gate 14:35, anchor 15:20. Two of those are tight in
  the model: 5d lands at 22:50, the last minute of its window, because the re-enabled
  watchdog's first firing is 22:50; and 6a waits until 23:00 for a liveness ping after
  22:50. **On the host this depends on the watchdog interval and the firing grid**; the
  dry-run rehearsal (unit 13) cannot show it, so the drill windows deserve a look when the
  real interval is known.
- **Finding — the retry clause "the three checks must read up" cannot be met.** After a
  tearing abort both tasks stay disabled, so no ping arrives, and each check goes down
  within its slot plus grace. At 22:05 on a retry evening a check that was up at 15:00 is
  down. What can hold is `paused`, which step 4 already accepts (unit 5); the gate still
  requires `up`. The retry sequence therefore has the owner pause the checks before the
  new attempt. **Consequence for unit 10:** opening a retry attempt should state, or do,
  the pause; and the tearing aborts page into hourly reminders until then, which is loud
  by design. Spec §5's retry paragraph needs the word changed at its next revision.
- **Paths run end to end:** ACT-13 (a failed certificate at 16:05, then only `ended`,
  nothing ever enabled), ACT-27 (the owner's abort at 22:27, read as deliberate), ACT-24
  with round 5 A2 (a red gate, then a retry a week later that runs steps 4–11 again and
  arms), ACT-29 twice (a crash before the enable's actions gives `STEP_INTERRUPTED`; after
  them `0-resume` catches it first as `WORLD_MISMATCH`), ACT-26 (a task enabled by hand
  in the silence drill), ACT-20 (a machine back after 13:59), ACT-39 (a torn tail after the
  gate), ACT-45 (a stray wrapper firing during an outage makes the drill invalid),
  ACT-46/48 (an outage before the silence drill waits out 6a and aborts at its deadline),
  ACT-50 (a liveness ping reaching the watchdog check keeps it up, so 5b never records
  and aborts at 22:55) and ACT-43 with spec §5's post-gate clause (a cycle task that reads
  enabled but never starts misses the anchor; the abort at 16:05 pages and leaves the
  armed run standing).
- **What the sequences catch on their own** was measured with the decide mutant set
  restricted to `sequences.spec.ts`. The first twelve sequences caught 20 of 81; with
  the two added since, 21 of 82. The survivors are almost all refusal branches no
  realistic run reaches, which unit 5's tests pin one by one. Two of the first survivors
  were claims about composition: D3 (an abort after the gate must not tear down), now
  caught by the ACT-43 sequence; and ACT-50, whose sequence shows that a mixed-up ping
  cannot pass the watchdog drill but ends at the deadline, so it catches no extra
  mutant — the down-set comparison (D34) stays pinned by its unit test. This is a
  measure of the sequences, not a gate; the gate is the full probe, 82 of 82.
- **Every sequence is held to invariants 1 and 3** by one helper: the cycle task never
  enabled beside a certificate line without a recorded gate, a tearing abort leaving both
  tasks disabled and no line, and an aborted attempt answering only `ended` afterwards —
  except a ledger abort that could not be appended (the torn tail), which unit 9 decides.
- **Defect in unit 5, found while writing unit 7's brief:** `definitionFindings` accepted
  `-MaxLogBytes` on the watchdog task, but only `cycle-run.ps1` declares it
  (`watchdog-run.ps1` declares `RepoRoot`, `NodePath`, `WatchdogIntervalMinutes`), so a
  watchdog definition PowerShell would refuse to start passed as correct by value. The
  unit-5 comment said "the full names the wrappers declare" and the code checked the
  union of both. Fixed red-first: the test failed before the change.
- **Corrected by a host reading on 2026-09-14:** the registered watchdog runs with
  `-WatchdogIntervalMinutes 5`, not the 10 the simulator assumed. The simulator's
  claim that 5d lands on the last minute of its window came from the wrong interval;
  the model is to be corrected before the claim is repeated anywhere.
- **`mutate-activation.mjs` takes an optional spec file** so that one file's own catch
  rate can be measured; the filter is checked against a plain relative `*.spec.ts` path,
  and the baseline run with the filter must be green first, or every mutant would look
  caught.

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

## Session boundary — 2026-09-14, 00:25

The second build session closed unit 5 here: `decide` with 105 tests, mutation probe
81 of 81 (`node ops/activation/probes/mutate-activation.mjs ops/activation/core/decide.ts ops/activation/probes/mutants-decide.json`),
D9, D41 and D55 spot-checked to fail on exactly the test they target rather than on a
syntax error. Nothing was run on the host.

### Unit 7 — readers

- **The parsers are pure and sit in `ops/activation/readers/parse.ts`**, outside
  `core/`: they need `Date` and `Intl`, which the architecture gate forbids there, and
  they decide nothing about the activation. Every thin I/O call will hand them text.
  Done so far: ISO instants (seven fraction digits, zone required, impossible dates
  refused), Europe/Berlin local time from the zone tables, wrapper logs, the task list
  and the disarm, the verifier, session samples, the boot time, `.env` with its
  environment shadowing, the certificate file, the preflight report, and the
  confirmation file of gate condition 4. Still to write: the healthchecks.io checks
  with their flips (names `gbt-liveness`, `gbt-readiness`, `gbt-watchdog`,
  fingerprint as `tools/healthchecks-provision.mjs` computes it) and the journal's
  first entry (the envelope's field is `type`, not `kind`), then the I/O calls.
- **Fixtures are this host's own output**, read-only on 2026-09-14: the task list with
  its stale direct-node registration, the verifier's `FAILED: 2 of 51`, the dev
  watchdog log's lines, the session probe. Read, and deliberately **not** read: the
  healthchecks.io API, whose answers carry the UUIDs that are ping credentials.
- **Four facts the readings changed:**
  1. **Wrapper logs start with a UTF-8 byte-order mark** (`EF BB BF`, measured on
     `glass-box-state\dev\watchdog-run.log`): `Add-Content -Encoding utf8` writes it
     when PowerShell 5.1 creates the file, and Node keeps it. Unstripped, the first
     line has no instant, the log reads unknown, and every silence drill would be
     invalid.
  2. **One signed-in user holds two type-2 logon sessions** (the split token of an
     administrator, both `DESKTOP-V6EGFDV\felix`). The probe counts distinct accounts
     and leaves out the window manager's and font driver's identities. What a
     signed-out host reports is not measured and stays a question for unit 13.
  3. **The registered watchdog runs every 5 minutes**, not 10 as the simulator assumed.
  4. **`.env` is not the whole latch.** The runtime's `loadEnvironment` lets process
     variables win over `.env`, so the reader returns the effective value (user over
     machine over `.env`) and names every shadowed key. The `.env` parser is held to the
     runtime's own `parseDotEnv` by a differential test; that test refuted a claim of the
     first draft — a byte-order mark does **not** hide the first key, because `trim`
     removes U+FEFF.
- **Verified so far:** `tsc` and ESLint clean, 208 tests in the activation suite, parser
  probe 35 of 35 (`mutants-parse.json`) and healthchecks probe 10 of 10
  (`mutants-healthchecks.json`), each run on a green baseline and restored
  byte-identical. The healthchecks parser's first test proves that no UUID and no
  healthchecks.io URL comes out of an answer that carried them.
- **Secret scan before committing the parsers (C-class tooling finding).**
  `tools/scan-secrets.ps1` exits 1 with 31 `HealthchecksUrl` rows, because that pattern
  is only `hc-ping\.com/` and matches every prose mention of the host. Counted instead,
  printing no values: URLs carrying a real UUID in the working tree (tracked and
  untracked) and in every commit of `git rev-list --all` — **zero** in both, so there is
  no leak. The new parser and its tests do not spell the ping host at all (example hosts
  in the fixtures), so they add no row. The scanner's pattern is left as it is and named
  here: its growing false-positive count is what would hide a real hit.
- **Done for the owner rulings:** `EnvObservation` carries the shadowed keys, and any of
  them is red in every phase; the live-token probe is a step-0 condition and a gate
  condition of its own; the simulator runs the measured 5-minute watchdog. **Correction
  to the unit-6 note above:** with 5 minutes the model's times do not change, because
  they follow the activation's own five-minute invocation grid — 5d still lands at 22:50,
  the last minute of its window, and the reason given earlier (a 10-minute interval) was
  wrong. The tightness stands in the model and still needs the real grid at unit 13.

#### The owner's review of 2026-09-14 (DECISIONS, same date)

The review arrived after `c996333` was pushed; its six points are corrected forward.

1. **Certificate by the runtime's full validator.** `parseCertificateFile(text, path,
   validator)` takes `validateArmingCertificate` with this deployment's expectations;
   PASS only when it accepts the whole document, otherwise `REJECTED` with violations.
   Counter-probes against a real PASS certificate built from `tests/arm01-fixtures.ts`.
   In the shell the validator comes from `dist/core/certificate.js`, the build the
   runtime itself uses (unit 7 I/O).
2. **Disarm by value.** `DisarmObservation` carries state and all actions;
   `disarmFindings` in `decide.ts` requires an enabled one-shot with exactly one action,
   `<nodePath> "<repoRoot>\ops\activation\cli.ts" disarm --state-root "<activationRoot>"
   --anchor-day <anchorDay>`. `Schedule` gained `repoRoot`, `nodePath` and
   `activationRoot`. The disarm CLI mode itself is unit 10's; this fixes its command line.
3. **Gate condition 4 per check.** `core/confirmation.ts` (pure, under the gate's rules)
   does the cross-check; `confirm/record.ts` parses the command line and builds the line;
   `confirm-alerts.ts` is the I/O around them. Step 0 repeats the cross-check against the
   live flips, compares the recorded down flips, dates by the oldest receipt, and records
   the whole confirmation in its evidence. **Not yet run against the API**; the real
   entry waits for the owner's receipt times.
4. **Probe.** `readers/analyst-probe.ts` with the SDK's `query` handed in; tested with a
   fake shaped like the pinned SDK's result types. The real call happens once on the host
   in unit 13.
5. **`ANALYST_UNAVAILABLE` in the long run** — inside the runtime digest: scenario #81,
   A31, S-CYC-01, S-G14-05, one line in `src/shell/cycle-runner.ts`, four tests in
   `tests/cyc-runner.spec.ts` written red first (two red before the change, as expected).
   **Corrected by the second review:** this held for rejected and timed-out calls only. A
   turn the SDK ends as `success` with `is_error` true was returned by `createClaudeAnalyst`
   as the answer and raised nothing; closed red first in `0e606d8` (see "The second review").
6. **Both wrappers by name** (`wrapperHashes`).

**Verified:** tsc and ESLint clean; 268 tests in the activation suite; mutation probes on green baselines, each restored byte-identical: decide 96 of 96 (95 in the full run, where D81 survived; a test was added and catches D81 in a single-mutant rerun), parse 39 of 39, healthchecks 10 of 10, confirmation 10 of 10, analyst probe 10 of 10, confirm-alerts 5 of 5, fold 13 of 13; npm run verify exit 0 including the src change.

#### The second review of 2026-09-14 (DECISIONS, same date)

The owner's second review found five places where the recorded state claimed more than the
code did. Each got a counter-test that ran red on the unchanged code first — 20 failing of
287 in the activation suite (the new tests and the ones whose expectation the fix changes),
6 failing of 40 in `tests/cyc-runner.spec.ts` — and then the fix:

1. **`is_error` in the real analyst path.** `createClaudeAnalyst` returned the text of an SDK
   result `subtype: success, is_error: true` as the analyst's answer. Five tests (401, 403,
   429, 500, 529) run the real function with only the SDK's `query` replaced and assert one
   SDK call, exactly one `ANALYST_SKIP`, `ANALYST_UNAVAILABLE` on the readiness ping, no halt,
   no mutation and no SDK text in journal or report; a sixth covers a session without a
   result message, and a control test the success path. The fix throws with the status only.
2. **Every receipt at or before now.** `crossCheckAlerts(claim, flips, nowUtcMs)` refuses
   `reminder.after-now` and `<check>.alert-after-now` one by one, and an unreadable now.
   Counter case: checks down and never resumed, a reminder typed after now — accepted before,
   by `buildConfirmation` and at step 0 alike.
3. **No inherited step 0 or step 3.** `carriesOver` is steps 1 and 2 only; the fold's
   `previousPreflight` keeps the wrapper baseline across attempts. Counter cases: a retry on
   2026-10-05, more than fourteen days after the confirmation, and a retry with a position on
   the dev account — both enabled the tasks at 22:05 before; both stop before step 4 now, as
   decide tests and as simulator sequences. ACT-24's expected order changed with it: 0, 3,
   then 4 to 11.
4. **Disarm principal and settings.** `DisarmObservation` gained `runLevel`, `logonType` and
   `startWhenAvailable`; `parseDisarm` reads them in the shape `read-tasks.ps1` prints (checked
   against the two registered tasks: `Limited`, `S4U`, `true`); `disarmFindings` requires
   `Highest`, `S4U` and `true` and reports them before the action, so one finding never hides
   another. The node: another installation, a bare `node.exe` and a renamed file are red, and
   `expectedNodePath` names the schedule's node from the running, pinned node.
5. **The probe's own deadline.** A deaf iterator (never settles, ignores the abort) hung the
   probe — still waiting after two seconds; it now returns `TIMEOUT` inside its deadline.

Committed as `0e606d8` with `npm run verify` exit 0 at 48 files / 669 tests. The decide probe
found three mutants whose anchors the fix removed (D25b, D25c, D74); D25b and D74 were
re-anchored, D25c is replaced by D101.

### Unit 7 — the I/O readers

- **Built.** `readers/observe.ts` composes one invocation's `Observations` from thin ports and
  the pure parsers; `readers/host-ports.ts` binds the ports to this host; the read-only
  PowerShell readers are `readers/host/read-{tasks,boot,sessions,preconditions,environment}.ps1`;
  `readers/parse-host.ts` holds the new parsers (host preconditions, the environment shadow,
  account masking, the session sample log, the journal's first entry through the runtime's own
  codec, the newest certificate, the independent read, the analyst reading, the expected node);
  `readers/healthchecks-io.ts` is the only module that holds healthchecks.io credentials, with a
  bounded backoff, and `confirm-alerts.ts` now reads through it.
- **Core changes it needed.** `Observations.alertConfirmation` is a `Reading`: an unreadable
  confirmation file is unknown, not absent (A1). `LogLine.composition` tells the watchdog's
  armed composition line from its degraded one, and step 11 records the first one after the
  gate (spec §8.12) as evidence.
- **Proven by test.** `observe.spec.ts` builds every field of `Observations` from this host's
  recorded reader output — the field list is compared by name, so a field added without a
  reader fails — with every reading known, and feeds the snapshot to `decide`: step 0 is red
  for exactly `host.DisableAutomaticRestartSignOn` and `alert-confirmation.absent`, the two
  things this host still lacks. Further: a failed reader affects only its own field; readings
  the plan leaves out are not taken and say so; no probe is spent without a preflight report;
  no secret of `.env` and no unmasked account number reaches the snapshot; the session sample
  is appended before the log is read back.
- **Run on this host, read-only, 2026-09-14 about 10:55:** the real ports with every network
  and costly reading stubbed out (healthchecks.io, the competition identity, the preflight, the
  probe, the dev account) and the sample log in a scratch directory. Every local reading came
  back known: both tasks `Disabled` (the cycle task still the direct-node registration), no
  disarm one-shot, boot 2026-09-09 03:32:12Z, `.env` with the stale certificate line and no
  shadowed or duplicate key, both wrapper hashes, the §3 preconditions, `longrun-1` empty, no
  confirmation, no journal, the verifier `FAILED: 2 of 51` and with `-ExpectEnabled`
  `FAILED: 4 of 55`, one session sample (one signed-in account, one explorer), 867 GB free.
  The whole read took **52 s**, most of it the two verifier runs.
- **Four facts the host changed:**
  1. `Win32_PowerPlan` refuses an unelevated caller here, while `Win32_PowerSettingDataIndex`
     answers; the active plan comes from the registry's `ActivePowerScheme`.
  2. An unelevated token carries Administrators as deny-only, and `WindowsIdentity.Groups`
     omits it; membership is read with `Get-LocalGroupMember` by SID.
  3. No watchdog log on this host has ever held a composition line, so the armed shape is
     taken from `src/shell/watchdog-runtime.ts` and stays unmeasured until the first firing
     after a gate.
  4. `tools/generate_map.py` lists untracked files, so an uncommitted file would appear in a
     committed map; the blocker commit parked the unfinished readers for its duration.
- **Decisions.** The digests come from the dev `--preflight` rather than a lighter
  computation: `computeRuntimeDigest` needs the analyst runtime observation only the launch
  path gathers, and copying that composition into `ops/` would turn every invocation red on the
  first drift. The declared cost is a preflight on every invocation after step 2.
  `parseJournalHead` only checks that the codec returned an entry: for one line with its newline
  a torn or corrupt reading has none, so the extra conditions were an equivalent mutant and are
  gone.
- **Not exercised against the host, declared:** the healthchecks.io read (its answers carry the
  ping credentials; the parser and `healthchecks-io.ts` are proven against answers with
  credential-shaped values), the competition identity read, the dev account read, the preflight
  and the probe. They are thin, type-checked and linted; unit 13's dry run rehearses them.
- **Verified:** tsc and ESLint clean; 325 tests in the activation suite (268 before the
  review); mutation probes on green baselines, each restored byte-identical: decide 105 of 105,
  parse 45 of 45, parse-host 15 of 15, healthchecks-io 8 of 8, observe 12 of 12, fold 17 of 17,
  confirmation 15 of 15, record 6 of 6, analyst probe 13 of 13, and
  `src/shell/analyst-claude.ts` 5 of 5 against `tests/cyc-runner.spec.ts`
  (`mutate-activation.mjs` now runs a `tests/` spec under the root configuration). The first
  runs of parse-host and observe left three survivors — a first entry of another type that
  the fixture could not produce, the node version's reason, a plan flag tested only together
  with another — and each got a test before the rerun. npm run verify exit 0 at 48 files /
  669 tests. Host re-checked read-only at 11:06: both tasks `Disabled`, no activation task
  and no disarm one-shot registered.

## Unit 7 integrity repair — 2026-09-14

The independent review reopened unit 7 at `bfdb4da`. The first focused run was red in
four places: a complete JSON first line without LF was accepted; session and decision
times came from before long I/O; a foreign healthchecks `update_url` received the API
key; and an abort-insensitive analyst probe stayed open. Result: 4 failed, 53 passed.
After those fixes, a second red run exposed the task boundary: UserId,
WorkingDirectory and related execution semantics were absent, while a relative
`powershell.exe` was accepted. Result: 3 failed, 163 passed.

The repair preserves the journal terminator bit; takes session, healthcheck and
decision timestamps after their respective I/O; makes the certificate write a bounded
lease that requires a fresh identical check read and a new action-time clock;
restricts management requests and redirects before attaching `X-Api-Key`; derives Node
from `.node-version` plus `process.execPath`; binds Windows PowerShell by absolute path;
reads and compares task identity/action semantics; closes Agent SDK queries; and lets a
later attempt append a new certificate result when deployment digests changed.

The first independent cold read was deliberately not accepted: its combined result
was A=2/B=3. It found that `SystemRoot`, `USERDOMAIN` and `USERNAME` were being used
as trust roots, that the probe closed but did not also abort after an SDK error, and
that the action-time promise was stronger than the implemented unit-7 boundary. Four
new counter-tests were red (4 failed, 34 passed). The production reader now uses the
fixed host path `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` and the
WindowsIdentity read through that fixed executable; installer and verifier use the
same canonical Windows SID and fixed PowerShell path. Probe error exits both abort
and close. The spec
now distinguishes the tested lease from the not-yet-built unit-8 executor.

### Executable red evidence

The baseline and intermediate failures are kept separate from the green result:

- On `bfdb4da`, the first focused counter-run failed 4 of 57: a complete JSON line
  without LF was accepted, session/decision clocks were stale, a foreign
  `update_url` received `X-Api-Key`, and the probe query remained open.
- The task-definition counter-run failed 3 of 163: identity and execution semantics
  were absent and a relative PowerShell host was trusted.
- The first cold-read fixes produced 4 failures in 34 focused tests: spoofable host
  trust roots and a probe error path that closed without aborting.
- The real host returned the short task principal `felix`. Three static checks and a
  raw-identity test then failed while replacing unsafe short-name normalization with
  canonical SID comparison.
- Mutation rehearsal also caught two harness gaps before acceptance: P40 was no
  longer applicable after `userSid` entered the return shape, and P48/RT1 initially
  survived because the tests did not require the SID value. Their counter-tests were
  tightened before the lists were rerun.
- The first nominal final cold round was rejected. One reviewer executed the tools
  on this host and found that both installer and verifier treated the two results of
  `Get-Command node` as one command, ending with `CommandNotFoundException`. Another
  ran a duplicate `-RepoRoot` against Windows PowerShell and got
  `ParameterAlreadyBound`, while both core and verifier had accepted that definition.
  A stale rev7 comment was the same round's C finding. These were B=1 and B=1/C=1
  verdicts, so the six-lens count reset instead of being averaged with a zero report.
- The duplicate-parameter verifier mutant VS8 survived its first run because a static
  test proved the check existed, not that its result controlled the check. The test
  now requires `-Ok ($duplicates.Count -eq 0)`; the rerun catches VS8.
- The next cold pass found that the standalone verifier accepted `LogonType=Password`
  although the installer and core require `S4U` exactly. The predicate was executable
  and green for the wrong definition, so the pass was reset at B=1. VS9 now proves the
  exact S4U boundary. A constructed missing-evidence retry also prompted a stricter
  counter-test: an incomplete carried step-2 result is ledger evidence missing, not
  proof that digests changed; D118 catches that distinction.

### Executable green evidence

The final mutation inventory has 324 mutants across ledger, fold, step table,
confirmation, healthcheck parsing and I/O, record command, observation assembly,
host ports, task parsing, task installer/verifier, analyst probe and production
analyst, and the decision core. Every mutant was caught and every target was restored
byte-identical. The per-target totals are: ledger 14, fold 17, steps 13,
confirmation 15, healthcheck parser 10, healthcheck I/O 10, confirmation record 6,
parse 45 plus 3 integrity mutants, parse-host 16, observe 16, analyst probe 15,
production analyst 6, host ports 3, installer 7, verifier 9, task reader 2, and
decision core 117. The new classes are LF loss, stale clocks and gate reads, foreign
origin/redirect credential forwarding, arbitrary Node/PowerShell paths, spoofed task
principals, multiple Node applications on PATH, duplicate wrapper parameters, SDK
close-without-abort/leaked queries, and stale carried certificates.

The focused activation suite passes 346 of 346. `npm run verify` completed with
process exit 0: 48 test files and 670 tests, followed by the architecture, fixture,
dashboard, sandbox and implementation-phase gates. There was no post-test EPERM.

### Passive-host and deliberately unexecuted evidence

Host evidence is separate from executable test evidence. This session did not register,
enable, start or remove tasks; did not reboot; did not call broker write methods; and did
not run `confirm-alerts`. A read-only verifier run reached all 57 checks without the old
multi-Node `CommandNotFoundException` and failed only the four expected checks against
the stale registrations. An installer `-WhatIf` preview resolved the pinned v24.9.0
runtime to `C:\Program Files\nodejs\node.exe` and exited 0 without registering or
enabling anything. The final pre-commit inventory at 18:18 CEST contained exactly
`GlassBoxTrading-AgentCycle` and `GlassBoxTrading-Watchdog`, both `Disabled`, both
resolving `UserId=felix` to the same canonical SID. No Activation or Disarm task was
present. A final post-push inventory and remote/branch equality check remain terminal
session checks; they do not change repository state.

### Final six-lens cold read

After every earlier finding had reset the count, two independent reviewers read the
current implementation and countertests afresh. Both returned **A=0, B=0, C=0** over
exactly journal termination, measurement/gate/action freshness, credential origin,
task identity and execution semantics, SDK cleanup, and append-only certificate retry.
They explicitly rechecked the two-Node PATH, duplicate parameter, exact-S4U, canonical
SID, and incomplete-carried-evidence cases. This is the accepted cold gate; earlier
zero reports before later fixes are not counted.

## Session boundary — 2026-09-14, 01:13

Unit 6 closed here: the simulator, 14 sequences, the retry-clause finding and the
`-MaxLogBytes` correction to unit 5. Nothing was run on the host.

## Unit 7 absolute-deadline repair and unit 8 — 2026-09-14

An executed counterexample through the real step-10 action first failed: a decision
at 14:54:58 produced a check lease through 14:55:03, and the old authorization still
accepted an action at 14:55:01. The action now carries the canonical absolute 14:55
deadline as well as the five-second lease. `authorizeCertificateWrite` accepts exact
equality, refuses the first millisecond after either boundary, rejects clocks before
the observation and invalid numeric contracts, and step 10 rejects a supplied UTC
deadline that does not denote 14:55 on the anchor day. D119 removes the absolute field,
D120 ignores it, D121 weakens equality, and D122 removes schedule consistency.

Unit 8 adds `actions/apply.ts` and the pure `.env` transformer. Every WorldAction is
behind a typed fakeable port. Certificate writes validate the entire certificate with
the runtime validator, compare fresh deployment digests, freshly read Healthchecks and
a fresh clock, then give the same authorization callback to the atomic CAS primitive,
which invokes it inside the commit operation at linearisation. They reread `.env` and
repeat both digest checks after the write. A
known-not-applied CAS preserves concurrent `.env` edits; an uncertain partial write
removes every certificate latch without overwriting unrelated current bytes and tries
to disable both tasks. Port errors become fixed credential-free codes. Mutating ports
receive an AbortSignal; timeout handling aborts and awaits settlement before
compensation or return. An incomplete enable disables every requested task. Restart
success is marked `await-post-boot`, and install evidence retains the verifier count
and both action lines.

This unit owns action orchestration and the branded authorized-CAS constructor. Its
port contract requires abort, settlement and no later effect; a port that ignores that
contract is not claimed bounded by the shell. Concrete Windows, Healthchecks and
restart adapter bindings remain unit 13, as the canonical plan requires.

The red evidence included the original 14:55:01 acceptance, late write-linearisation,
post-mutation CAS failure, changed post-write digests, duplicate latch removal,
credential-shaped port reasons, a clock throw, lost acknowledgements, a late effect
after timeout, and concurrent `.env` changes. All unit-8 tests use fakes and fixtures;
no host, broker or Healthchecks port was bound or invoked.

Final relevant mutation runs are green and restored every target byte-identically:
decision core 121/121 (including D119–D122), action shell 18/18, and `.env`
transformation 4/4. Together with the previously closed inventory this is 350 caught
mutants. The final activation suite passes 368/368. The complete repository
`npm run verify` passes at 48 files / 670 tests, followed by every architecture,
fixture, dashboard, sandbox and implementation-phase gate.

## Unit 9 — durable ledger store — 2026-09-15

**Closed again at 12:48 CEST after external execution.** The `bdcac95` close claim was
superseded. Against that tree, the real Windows ordinary/extended path pair reached a
corrupt duplicate sequence under a two-writer barrier; a same-PID/different-start lock
read live; and an actual store recovery line was codec-valid but contributed no fold
correction. All three failed before their fixes. The resulting tests execute the old
failure moments rather than compare path strings or isolated fields.

`ops/activation/store/ledger-store.ts` is the imperative persistence boundary around
the closed ledger codec. `withActivationLedger` owns a canonical-root pid/start-time
lease for the whole invocation callback, not one append. A separate bounded,
kernel-owned transition/write guard serializes each read-plan-write-fsync operation,
including parallel appends made from one callback. Session appends call
`planLedgerAppend`, write exactly its UTF-8 LF-terminated line, reject short writes or
size changes, and fsync every line before return. A live second invocation takes only
that short guard, writes exactly one note, returns `contended`, and never runs its host
callback. Unknown liveness and malformed ownership data fail closed.

A physical root is the native real path plus its filesystem device and inode. This makes
`C:\...` and `\\?\C:\...` share ledger, lock and endpoint names, and it makes a pathname
rebound to a new directory fail with `ROOT_IDENTITY_CHANGED` instead of redirecting a
held session. Public and session snapshots take the same transition guard as appends,
so a reader cannot classify a half-written line before its fsync.

A lock whose owner is provably dead is renamed to a tombstone under the same guard.
The tombstone remains until its stale-lock note is durable, so an ENOSPC or crash cannot
erase the takeover. Replay detects an already recorded owner and does not double-count
it; a repeated takeover chooses the first unused tombstone suffix. Exclusive-create
races consume the bounded acquisition budget. The lock's PID and start time also name
a kernel-owned endpoint held for the callback; only that exact conjunction is live.
Lock, ledger and release errors become fixed credential-free `LedgerStoreError`
stages and are never returned as success. A failure raised by the callback itself is
not a store failure: it arrives as the separate stage `callback:WORK_FAILED` and carries
the original error as `cause`, so unit 10's typed aborts stay distinguishable from a
ledger defect while the message stays closed. Unit 10 must catch that non-swallowable error
and perform §4's disable-both/page/exit compensation. Unit 9 exposes no host-effect
ports and does not pretend that compensation happened.

**Torn-tail ruling.** Damaged bytes are immutable. A torn primary or recovery segment
is never opened for append; continuation goes to the next six-digit recovery file and
its first complete line is a `correction` naming the damaged segment and sequence. A
zero-byte recovery file proves a crash after create but before its first write, and a
partial first correction proves the next crash window; both remain visible torn
segments and force another recovery file. Readers validate contiguous segment numbers
and marker-first chains and retain every damage item. Thus absent, empty, intact, torn
and corrupt stay distinguishable, and recovery never upgrades damaged history to
intact. Complete noncanonical lines (BOM, CRLF, duplicate-key or reordered JSON),
invalid UTF-8, impossible or divergent timestamps, sequence gaps and terminated bad
JSON are corrupt and are never continued.

Recovery uses `damagedSeq` as its canonical reference. `ledgerCorrectionSeq` gives all
three codec-accepted spellings one meaning, and `foldLedgerSnapshot` carries aggregate
store integrity into the fold. Store-generated notes and corrections inherit the last
entry's attempt and anchor day; the store rejects a factory that changes either. Thus a
correction appears in `fold.corrections` without making the damaged aggregate intact.

Red-first counterexamples cover 24 processes and parallel same-session appends; a
second invocation while the first sleeps; direct live-lock notes; Windows `wx`
collision; ordinary, crashed and replayed stale takeover; torn primary, empty and
partial recovery markers, and repeatedly torn recovery; forged recovery chains;
partial write; concurrent size change; EACCES, EPERM and ENOSPC; ledger, lock and live
note fsync; ledger/lock close and release failure; noncanonical bytes; timestamp and
anchor mismatch; hostile accessors; correction references; and credential-shaped
values and field names. The external blockers add a real Windows alias barrier, a
same-PID/different-start takeover and an actual Store→codec→fold recovery. The delta
cold read added executable paths for root rebinding, repeated `EEXIST`, tombstone
collision, a read during a split write, the snapshot/fold boundary and attempt-preserving
system evidence. The final activation suite passes **417/417**. Targeted mutation runs
catch **32/32 store**, **19/19 fold** and **25/25 ledger-codec mutants**. Together with
the unchanged targets rerun in this session, the complete inventory is **395/395**; each
runner reports byte-identical restoration. The final repository gate is `npm run verify`
at 48 files / 670 tests, followed by every architecture, fixture, dashboard, sandbox and
implementation-phase gate.

The formal `bis-0` store was degraded before this unit: its shared checkout held
unrelated uncommitted evidence from older runs. This session did not mutate or clean
that foreign state and therefore does not claim a formal archived loop. Repository cold
reads supplied the fallback gate. The final independent delta reader first reported
seven B findings: six executable defects and one incorrect expectation that recovery
should hide torn history. After the fixes, its read-only fix-gate ran 74 focused tests,
resolved the six defects, refuted that expectation against the immutable-damage rule,
and reported **A=0, B=0, C=0**.

## Next step

**Review residuals of unit 9 (external review, 2026-09-15 evening; refute gate
executed every finding). G3, G4 and G2 were closed on 2026-09-16; G1 is open and is the
owner's call.**

- **G3 (B, closed 2026-09-16):** the transition guard around `session.read()` now has a
  test. A contended tick's live-lock note is paused mid-line while the holder reads: the
  read does not settle during the write and returns `intact`. Mutant LS33 removes the
  guard and is caught; the store's mutant set is 35/35.
- **G4 (C, closed 2026-09-16):** `assertRootIdentity` in `withLockTransition` is pinned
  through release, the one transition that reads no ledger and therefore has no second
  identity check behind it: a root rebound during the callback fails
  `read-directory:ROOT_IDENTITY_CHANGED` instead of reading a lock in the new directory
  (mutant LS34).
- **G2 (C, closed 2026-09-16):** a failure raised by the `work` callback is no longer
  `write-ledger:IO_ERROR`. It gets the closed stage `callback` / `WORK_FAILED` and carries
  the original error as `cause`, so unit 10 can tell its typed aborts from a ledger defect
  while the message stays credential-free. A store error raised inside the callback keeps
  its own stage (mutant LS35).
- **G1 (B, open):** an existing but unparseable `ledger.lock` (a 0-byte file after a kill in the
  ~2–3 ms create window, reproduced with a real process kill) is never taken over; every
  later invocation throws `read-lock:LOCK_INVALID` until a human deletes the file. The
  gate's fix sketch needs a root-scoped lease endpoint plus an `invalid-lock` tombstone
  and note, which touches codec and fold. **Owner ruling 2026-09-16: declared a residual**,
  not fixed before the certificate — the sketch would sew a third seam into codec and fold
  under time pressure. The runbook carries the manual step instead (delete the unreadable
  `ledger.lock`, then let the next tick run); the fix stays in the backlog without a date.
- **G2 (C, but part of unit 10's contract):** any non-store error thrown by the `work`
  callback is rethrown as `write-ledger:IO_ERROR`. Give it its own closed stage (for example
  `callback` / `WORK_FAILED`) before unit 10 builds on it; otherwise every typed abort
  pages as a ledger defect.

**Gate condition 4 after the rotation: recorded.** The drill ran on the new checks
(`hc:e4f605dd` liveness, `hc:94c5f859` readiness, `hc:40a81113` watchdog, all paused
again afterwards) and `confirm-alerts --operator felix` wrote one line to
`alert-confirmations.jsonl` in the activation state root, cross-check passed. Verified
again on 2026-09-16: the file carries exactly those three fingerprints. The oldest
receipt is 2026-09-15T22:08:59+02:00, so the fourteen days expire on
**2026-09-29 22:08 Europe/Berlin**. Step 0 re-checks that age on *every* attempt
(spec §5, "Retry on the next trading day"), not only on the first: with the planned
anchor on 2026-09-22 there is a week of retry room, but if the run slips by one week
(owner ruling 2026-09-13), the anchor day itself is the last day inside the window and
a retry on the following trading day would stop at step 0. A slip therefore needs a
repeated drill and a fresh `confirm-alerts` before the new certificate day.

**Then unit 10; it was not begun in the unit-9 correction session.** The 2026-09-14 Activation/Disarm
calendar run did not occur: there is no Activation task, no Disarm task and no state
root, so nothing is planned retroactively. The next plausible supervised block is the
certificate and drills on 2026-09-21 with the anchor on 2026-09-22. Before that run,
capture the real alert/reminder receipt times and execute `confirm-alerts` under the
owner's controlled procedure.

What unit 7 fixed for the units after it:

- `readObservations(ports, config, plan)` (`ops/activation/readers/observe.ts`) is the only
  way an invocation observes. The plan is the CLI's (unit 10), derived from the ledger's
  phase: the preflight at steps 1 and 2 and on every invocation after step 2 (the core
  compares the digests from then on), the live-token probe at step 0 and at the gate, the
  dev account's book at step 3. A reading not in the plan reads unknown and says so.
- The execution boundary's `nodePath` comes from
  `expectedNodePath(process.execPath, process.version, <.node-version>)`
  (`readers/parse-host.ts`), never from the task it is compared against. Its PowerShell
  path is the fixed trusted host path and its task principal comes from Windows-backed
  OS identity calls, not process environment variables.
- The session sample log is `<activation root>/session-samples.jsonl`; the reader appends
  one line per invocation and nothing else writes it.
- A full local read takes about 52 s on this host (measured 2026-09-14), most of it the two
  verifier runs; the invocation cadence and the 13:50–13:59 re-arm window must leave room.

Unit 8 (actions, now implemented): enable and disable both tasks; register the disarm one-shot as spec §6
fixes it (`Highest`, `S4U`, `StartWhenAvailable`, the expected node, exactly the command
line of `disarmFindings`) and delete it; restart; remove and write the certificate line in
`.env` (replace in place, re-read, re-check duplicates, re-hash); clear the three checks
(readiness through `readiness-cli.js`, liveness and watchdog by a success ping). Every
action returns applied or a credential-free reason. Registering anything elevated on the
host is unit 13's.

Not yet exercised against the host, and rehearsed in unit 13: the healthchecks.io read, the
competition identity read, the dev account read, the preflight and the probe ports. The
local readers were run read-only on 2026-09-14 (see unit 7).

After unit 10: units 11 (digest batch and the core's second architecture-gate root), 12 (adversarial review against the catalogue) and 13 (elevated registration, the host bindings of `ActionPorts`, and the `--dry-run` rehearsal). **D-10.1 is decided** (2026-09-17): a fourth healthchecks.io check, `gbt-activation`, already created (`hc:32b59017`) with its URL in `.env` as `HEALTHCHECK_ACTIVATION_URL`; the page port that sends its `/fail` and one proving page belong to unit 13. **D-10.2** is unit 13's too: binding the action ports. **Unit 12 is the one "bis 0" loop** over units 1 to 11, by owner ruling of the same day.

## Unit 11 brief — the digest batch

Written 2026-09-17, before the first line of unit 11. The unit table's row ("gate second
root, guard `STATE_DIR` coupling, scripts") names three changes; this brief turns them
into something that can be built and judged.

### Why this unit is on a clock

Every file unit 11 touches is **runtime-digest material**: `enumerateRuntimeFiles`
(`src/shell/digests.ts:56-67`) hashes `src/**/*.ts`, `tools/*.mjs`, `package.json`,
`package-lock.json` and both root `tsconfig`s. The certificate run on 2026-09-21 binds
the digest of that moment, and the arming gate refuses any later digest. So unit 11 must
be committed **before** the certificate run, and **no commit to digest material may
follow it** until the competition is armed; a fix found afterwards costs a new
certificate. Internal deadline: unit 11 committed by the end of 2026-09-19, because
unit 13 needs 2026-09-20. If that deadline slips, the owner hears it at once — and a slip
of the certificate run by a week also needs a repeated alert drill and a fresh
`confirm-alerts` beforehand, because gate condition 4 expires 2026-09-29 22:08
Europe/Berlin.

### Part 1 — the architecture gate gets its second root

Spec §9: the pure core in `ops/activation/core/` is covered by
`tools/check-core-architecture.mjs`, which today hardcodes `CORE_ROOT = src/core`.

**Measured before building** (2026-09-17, `inspectCoreDirectory("ops/activation/core")`
called from a scratch script against `814a459`, gate unchanged): `src/core` passes; the
activation core has **12 findings in four causes**. `confirmation.ts` and `types.ts` are
clean.

| # | Cause | Where | Findings | Proposed resolution | Touches behaviour? |
|---|---|---|---|---|---|
| F1 | value imports end in `.ts`; the gate type-checks without `allowImportingTsExtensions`, Node 24 needs the extensions (unit 5 left this to unit 11) | `decide.ts`, `fold.ts`, `steps.ts` | 3 | the second root gets `allowImportingTsExtensions: true` in its own compiler options; `src/core` keeps its options unchanged | no |
| F2 | a parameter named `stack` (a forbidden member name) | `ledger.ts:102` `inspectLedgerValue` | 1 | rename to `seen` | no |
| F3 | `.map(Number)` passes a standard-library object as a value | `ledger.ts:154` `isoAtUtcMs` | 1 | `.map(part => Number(part))` | no |
| F4 | the accessor-free plain-data check uses `Object.getPrototypeOf`, `Object.prototype`, `Object.getOwnPropertyDescriptors` and `descriptor.value` | `ledger.ts:119-125` `inspectLedgerValue` | 7 (4 distinct members, some reported twice) | **owner decision D-11.1**, below | depends |

F1–F3 are mechanical and behaviour-neutral; the ledger's mutation set is re-run after
them to show it. F4 is not mechanical: the check exists so that a ledger value with a
getter, a class instance or a foreign prototype is refused **without invoking the
accessor** (pinned by `ledger.spec.ts:163`, "rejects nested credential-like field names
without invoking accessors"). No gate-clean formulation can detect an accessor without
reading descriptors, and a `JSON.stringify` round trip invokes getters and `toJSON`, so
it would break exactly the pinned property.

The gate's shape after the change:

- A list of roots, each with its own compiler options: `src/core` (as today) and
  `ops/activation/core` (plus `allowImportingTsExtensions`). Each root is its own
  program; a module specifier escaping *its* root is a violation, so the activation core
  may not import from `src/core` and vice versa.
- A root that does not exist or contains no `.ts` file fails the gate. A second root that
  silently vanished would leave the gate green over nothing.
- Messages that say "src/core" name the root being inspected.
- The self-test grows: a mutant placed under an `ops/activation/core`-shaped root is
  caught; a `.ts`-extension import passes there and fails under `src/core`; a missing
  root fails.
- The success line names both roots.

Out of scope, stated rather than implied: `tools/run-core-sandboxed.mjs` (the runtime
purity sandbox) stays on `src/core` only. Spec §9 asks for the static gate; the sandbox
would need the activation suite's executed paths and is a separate piece of work.

### Part 2 — the certificate command guard refuses the competition `STATE_DIR`

DECISIONS 2026-09-14 (P12 revision): "the certificate command guard should refuse when
the resolved `STATE_DIR` is the one `.env` names for the competition profile. Today only
the profile is enforced, and `--preflight` with the dev profile but a forgotten
`STATE_DIR` would seed `longrun-1` twenty minutes before the anchor."

How the situation arises: `.env` on this host says `ALPACA_PROFILE=competition` and names
`longrun-1` as `STATE_DIR`. Every certificate command is dev-only, so it runs with
`ALPACA_PROFILE=dev` from the process environment — which wins over `.env`
(`loadEnvironment`, `src/shell/runtime-config.ts:37-39`). The activation's step 2 also
overrides `STATE_DIR` (`readers/host-ports.ts:221-223`); a human who forgets that
override builds a dev runtime on the competition directory, and `buildRuntime` writes
`pings.log`, `analyst/` and an epoch binding into it.

**The rule.** Refuse, before runtime construction, when `.env` (the file, not the merged
environment) says `ALPACA_PROFILE=competition` **and** the effective `STATE_DIR` (the
merged environment) denotes the same directory as `.env`'s `STATE_DIR`.

Pure / shell split, following the existing `admitCertificateCommand`:

- **Pure** (`src/shell/certificate-command-guard.ts`, which already holds the pure
  admission rule): `admitCertificateCommand` takes, in addition to today's input, the
  file's profile, the file's `STATE_DIR` key and the effective `STATE_DIR` key, and
  decides. Paths arrive as comparison keys; the function does no path arithmetic.
- **Shell** (`src/shell/certificate-cli.ts`): reads `.env` once, derives each key by
  resolving the path against the repository root and, where the directory exists,
  `realpathSync.native` — the same identity `resolveStateDir` uses
  (`src/shell/state-dir.ts:75`), so that the extended-path and case aliases DECISIONS
  2026-09-01 (R11) closed cannot reopen here. It **creates nothing**: `resolveStateDir`
  creates `quarantine/` on any read, so the guard must not call it.

Cases the tests pin (red first where the behaviour is new):

1. `.env` competition, effective `STATE_DIR` a different directory → admitted.
2. `.env` competition, no override → refused, for `--preflight`, `--owner-go` and
   `--smoke-cycle` alike.
3. `.env` competition, override that is an alias of the same directory — different
   case, trailing separator, relative spelling, `\\?\` prefix, a junction → refused.
4. `.env` says `dev` → the coupling does not apply; today's rules decide.
5. `.env` competition with `STATE_DIR` empty or absent → nothing to protect; the rule
   admits and runtime construction refuses the missing directory as it does today.
6. A refusal leaves the competition directory byte-for-byte unchanged: no `quarantine/`,
   no file (a shell test on a temporary directory).
7. The refusal reason is credential-free and names the rule, not the path.
8. The existing profile rules and `CERTIFICATE_RUN_LIMITS` are unchanged
   (`tests/p7-launch-hardening.spec.ts:32-42`).

### Part 3 — scripts

`npm run verify` does not run the activation suite or its typecheck, which has caught
out more than one session. Proposed:

- `"activation:typecheck": "tsc --noEmit -p ops/tsconfig.json"`
- `"activation:test": "vitest run --config ops/vitest.config.ts"`
- both appended to `verify`, so that one command is the green gate for the whole
  repository. `architecture` needs no change: the tool itself learns the second root.

No script runs the activation CLI. The scheduled task invokes
`node ops\activation\cli.ts` directly, and `disarmFindings` pins that argument vector.

### Open decision this brief surfaces

- **D-11.1 — the accessor-free check in `ledger.ts` versus the gate.** Options:
  **(A)** a narrow, exact exception in the gate's configuration for
  `ops/activation/core/ledger.ts` and exactly those four members, with its reason in
  DECISIONS; the ledger is untouched and the exception is one visible line in the digest.
  Declared limit: the exception is by file and member, so a *second* use of the same
  members in `ledger.ts` would also pass. **(B)** move the plain-data check into the
  shell (the store copies each draft into a plain object after refusing accessors, and
  the core validates only plain data); the core is then gate-clean without exceptions,
  but the change crosses into the codec and the store — the two places unit 9 sewed
  twice and that the owner kept closed for G1 — and it moves the accessor test and two
  mutant sets. **(C)** a `JSON` round trip in the core: rejected, it invokes the
  accessors the check exists to avoid. Recommendation: **A**. The four reflective reads
  are pure (no I/O, no clock, no randomness); the gate forbids them because they are
  laundering routes into intrinsics, and here they do the opposite — they refuse a value
  before any of its code runs. B is the cleaner end state and belongs in the backlog
  after the competition, not in a digest batch two days before the certificate.
  **Owner ruling 2026-09-17: A.** Built tighter than written above: the exception binds
  the file, each exact message and its exact number of raw occurrences, so a second use of
  the same members in `ledger.ts` changes the count and fails the gate. It lives in
  `tools/check-core-architecture.mjs` itself rather than in a JSON file beside it, because
  `tools/*.json` is not digest material and an exception list outside the digest could
  change after the certificate unnoticed.

### Acceptance

- `npm run architecture` passes over both roots, and its self-test proves the second
  root is inspected (a mutant under it is caught; a missing root fails).
- The guard's cases 1–8 are tests; the behaviour-changing ones were red before the fix.
- Mutation probes: a new set over the guard's decision; a set over the gate's root
  handling (drop the second root, drop its compiler option, let a missing root pass —
  each must fail `npm run architecture`); the existing ledger set re-run after F2/F3 and
  restored byte-identically.
- `npm run verify` green, now including the activation typecheck and suite; `ops` lint
  green.
- Committed and pushed by the end of 2026-09-19; the build log and `STATE.md` updated.
- The "bis 0" loop does not run here: unit 12 runs it once over units 1–11 (owner ruling
  2026-09-17).

## Unit 10 — the CLI — 2026-09-16

Built against the unit 10 brief below. Where it deviates from the brief, the reason is here; the
brief itself is left as it was written, because it is the measure this unit was judged by.

**What exists.** `ops/activation/cli.ts` is the entry point, and the work is in five
modules that take their clock, their zone, their ports and their identity as parameters:

| Module | What it owns |
|---|---|
| `cli/args.ts` | argv → a typed invocation, or a refusal that names the argument |
| `cli/schedule.ts` | anchor day → `Schedule`; local wall clock → UTC instant; the ledger's `at` format |
| `cli/plan.ts` | observation plan, every ledger draft, the exit codes, the store-failure classification |
| `cli/deployment.ts` | the deployment file, by value |
| `cli/report.ts` | the status page and the one-line outcome the owner reads |
| `cli/invoke.ts` | the orchestration: lease, reads, decision, actions, appends |

**Five commands, not four.** The brief named `status`, `run`, `abort --confirm` and
`disarm`. Writing the orchestration surfaced a hole: `decide()` never opens an attempt —
on an empty ledger it aborts with `LEDGER_EMPTY` and tells the owner to open one — and an
`abort` ends an attempt for good. Without a fifth command there was therefore no way back
after any abort, and the retry of spec §5 could not be executed at all. So:

- `run` opens an attempt itself in exactly two cases: the ledger is absent or empty (spec
  §4, which prescribes disable-both, page, and a first entry recording what was found),
  or the last attempt **ended and was for an earlier anchor day** — a new anchor day
  resets steps 4 and 7 to 11 anyway.
- `open --anchor-day <day> --operator <name>` is the owner's same-day retry. A tick must
  not undo an abort: without this split, an abort at 22:30 would be reopened by the tick
  at 22:35. It refuses while an attempt is still running.

**A dry run appends nothing.** Spec §9 says the rehearsal "performs every read, prints
every intended action and touches nothing", with the ledger in a scratch root. It would
have been defensible to write the ledger and only withhold the host actions; this build
withholds both. A rehearsal that half-executed an attempt would leave the scratch ledger
in a phase the next rehearsal reads as real, and the value of the rehearsal is that it can
be repeated. The lease and any system entries are still written, because the store owns
those.

**Exit codes: five, not four.** `0` nothing wrong, `1` the attempt ended, `2` the
invocation refused to start, `3` the ledger itself is unreliable, `4` the invocation
failed part way through. The brief had four; `4` was split off `3` because review residual
G2 exists precisely so that the CLI's own typed failure is not read as a ledger defect,
and two failures that must not be confused may not share a number in a task history that
shows nothing else for months.

**Two action contracts, made explicit.** An `act` stops at the first failed action,
because everything after it was decided against a world that no longer holds. A teardown
does **all** of its parts: the owner typed a stop, and a disable that failed is a reason
to keep going, not to stop halfway. `applyAll(..., stopAtFirstFailure)` carries the
difference; it used to be hidden in how the call sites were arranged, where a mutant found
it.

**`disarm` fails safe, not closed.** A ledger it cannot read — residual G1's 0-byte
`ledger.lock` among other causes — disables both tasks and says so, rather than aborting.
Its lease wait is 2 s rather than the store's 5: the one-shot fires at 15:05 and owes its
answer in seconds, and whatever it cannot resolve in that time it resolves by disabling.
A test reproduces exactly G1's 0-byte lock.

**`ActionPorts` are still unbound** (D-10.2). `cli.ts` passes `null`, the whole read path
and `--dry-run` work against the real host, and an unbound action is never recorded as
applied — it is reported as refused with `NO_HOST_BINDINGS`. Unit 13 supplies the ports;
nothing else about unit 10 changes then. **D-10.1 is still open:** the page is a loud,
credential-free line on stderr plus the ledger's `next_owner_action`.

**The deployment file.** `Schedule` needs facts no anchor day derives: the host
preconditions of spec §3, the long-run account's masked id, the coverage date, the disk
minimum. They are measurements, so they are read from `ops/activation/deployment.json`
(with `deployment.example.json` committed as its shape) rather than invented in source. A
missing or half-filled file is a refusal that names the field.

**Evidence.**

- Activation suite **543/543** (was 420 before this unit); `ops` typecheck and lint clean.
- Mutation probes, all restored byte-identically:
  `args 15/15`, `schedule 12/12`, `plan 18/18`, `deployment 7/7`, `invoke 13/13`,
  `report 9/9` — **74 of 74 caught**.
- Six mutants survived their first run and each one was a real gap, not an equivalent:
  a result that counted fewer reports than actions as complete; a restart that swallowed a
  later action's failure; a coverage date matched by its first four digits; a dry run that
  printed only its first intended action; a teardown that stopped at its first failure;
  and a `−05:00` offset written with a plus sign. Five were closed with tests, one by
  making the two action contracts explicit in the code.
- The end-to-end tests run against the **real** ledger store on real files, with the
  unit-6 simulator supplying the world: the lease, the live-lock note, the torn-tail
  recovery and G1's unreadable lock are all exercised, not faked.

**Not covered, and stated rather than implied.** No test drives `run` through a full `act`
against bound ports — the `act` path's own contract is pinned in `cli-actions.spec.ts` and
in the plan's drafts, but the first end-to-end `act` with real host effects is unit 13's
rehearsal. The page channel is undecided (D-10.1), so nothing pages anywhere yet.

## Unit 10 brief — the CLI

Written 2026-09-16, before the first line of unit 10. Owner ruling of the same day:
**`disarm` is in scope.** The unit table listed only `status`, `run`, `abort --confirm`
and `--dry-run`, but `disarmFindings` (`core/decide.ts:249-250`) already pins the disarm
task's argument vector to

```
<repoRoot>\ops\activation\cli.ts  disarm  --state-root <root>  --anchor-day <day>
```

and spec §6 judges that task by value. Leaving `disarm` to unit 13 would mean the core
compares the world against a command that does not exist, and every phase from step 4 to
the gate would be red by construction — discovered, at the earliest, during the Sunday
rehearsal. The unit table row is corrected accordingly.

### What unit 10 is

The single entry point `ops/activation/cli.ts`, plus the pure module(s) it calls. The
shape follows `confirm-alerts.ts`: the decision lives in a pure module with its own
tests, the entry file is thin I/O. Nothing in unit 10 decides an activation step — that
is `decide()`. Unit 10 decides *which invocation this is*, what it may read, what it
writes to the ledger, and how it exits.

### Command surface

| Command | Lock | Reads | Writes |
|---|---|---|---|
| `status` | no lock; read-only snapshot | ledger only, plus the derived phase | nothing |
| `run` | full lease | observations per plan | `intent` / `result` / `abort` / `note` |
| `abort --confirm` | disable **first**, then bounded-wait lease | ledger | terminal `abort` entry |
| `disarm` | full lease | ledger | `result` or `note` |

Global options: `--state-root <path>` (required), `--anchor-day <YYYY-MM-DD>` (required
for `run` and `disarm`), `--dry-run`, `--operator <name>` (required for
`abort --confirm`).

**`status`** is the one command that never takes the lease and never appends. It prints
the fold: current attempt, anchor day, per-step outcome, whether the attempt is ended,
the next step and its window, and the integrity state of the ledger. It is the command
the owner types at 22:00 without perturbing a running invocation.

**`run`** is what the `GlassBoxTrading-Activation` task invokes every five minutes. It
takes the lease through `withActivationLedger`, reads the ledger inside it, folds it,
derives the observation plan from the phase, reads the world, calls `decide()`, and
executes the answer per the contract documented on `Decision` in `core/types.ts`:
`act` writes an `intent`, applies actions in order, stops at the first failure, writes
a `result`; `record` writes one `result`; `wait` records nothing unless the reason is
new; `abort` writes the `abort` entry, tears down when `teardown` is true, and pages;
`ended` does nothing at all; `done` reports completion. A `restart` action reports
`await-post-boot` and must **not** get a result appended in the same invocation.

**`abort --confirm`** follows spec §5 ("The owner's own abort") and is the one place
where the store's rule that everything happens inside the lease is deliberately broken:
it disables both tasks, removes the certificate line, deletes the disarm one-shot and
sends one success ping per endpoint *before* it takes the lease, because those steps are
idempotent and safe under a race, and only then takes the lease with a bounded wait to
write the terminal entry. If the entry cannot be written it says so loudly and exits
non-zero — an owner who typed the abort and got a shrug would go to bed believing the
run was stopped.

**`disarm`** is the 15:05 one-shot of spec §6. It reads the ledger and disables both
tasks unless the ledger shows a green gate for this anchor day. **It fails safe, not
closed-with-an-error:** an unreadable, torn, corrupt or lock-blocked ledger disables both
tasks. This is the one command for which residual G1 (`read-lock:LOCK_INVALID`) must not
become an abort — a disarm that refuses to run because of an unreadable lock is exactly
the failure the disarm exists to prevent.

### The pure / shell split

Pure (own module, own tests, no I/O, no clock, no env):

- argv → typed invocation, or a typed usage refusal. One vocabulary for all four
  commands; unknown flags, missing values and duplicated options are refusals, never
  defaults.
- `--anchor-day` + configuration → `Schedule` (`certificateDay`, `drillNightDay`,
  `gateNotAfterUtcMs` and the rest). No `Schedule` is constructed anywhere in the
  repository today except in tests; this is the first production derivation and every
  field gets a pinning test. The local-to-UTC conversion of the 14:55 deadline is a
  parameter, not a call.
- `Decision` + applied-action results → the ledger drafts to append, in order, with
  their `kind`, `outcome`, `evidence` and `nextOwnerAction`.
- The `makeSystemDraft` factory the store requires for `live-lock`, `stale-lock` and
  `torn-tail` events.
- Error classification: `LedgerStoreError` with stage `callback` / reason `WORK_FAILED`
  is **this CLI's own typed abort**, surfaced with its `cause`; every other stage is a
  ledger defect and triggers the §4 compensation (disable both tasks, page, exit).
  Mixing the two up is the defect G2 was closed to prevent.
- Decision → exit code, and the rendering of every human-readable line.

Shell (`cli.ts`): process argv and clock, `createHostPorts`, `withActivationLedger`,
`readObservations`, `applyAction`, stdout/stderr, `process.exitCode`.

### Exit codes

Following `confirm-alerts.ts` (0 ok, 1 refusal, 2 usage):

- `0` — acted, waited, recorded, finished, or yielded to a live competitor after writing
  its one note.
- `1` — an `abort` entry was written: the attempt is over, the teardown ran, the owner is
  paged. A green run never returns 1.
- `2` — usage or configuration refusal. Nothing was read, nothing was written.
- `3` — ledger defect: the §4 compensation ran, or could not run. This is the code that
  means "the record itself is unreliable", and it is the only one that must never be
  produced by a typed abort of the CLI.

### `--dry-run`

Spec §9: performs every read, prints every intended action, touches nothing — the mode
that runs end to end against the real host on the Sunday before the certificate, with
the ledger in a scratch root. In dry-run, `applyAction` is never called; the intended
actions are rendered instead, and no ledger line is appended.

### Open decisions this brief surfaces

- **D-10.1 — how the activation pages.** The spec says "page" in five places (§4, §5,
  the catalogue's invariant 4) and nowhere says through what. There is no fourth
  healthchecks check, no mail port and no `page` member in `ActionPorts`. Recommendation:
  a deliberate *fail* ping on a dedicated fourth check, because it reuses the alert path
  the owner has already drilled and confirmed, and it keeps the three existing checks'
  meanings intact — but a fourth check is owner work in the healthchecks account, so it
  is a decision, not an implementation detail. Until it is answered, unit 10 renders the
  page as a loud, credential-free line on stderr and records `next_owner_action`.
- **D-10.2 — `ActionPorts` have no host binding.** Unit 8 deliberately left the concrete
  bindings to unit 13 (DECISIONS, 2026-09-14): only fakes exist. Unit 10 therefore takes
  the ports as an argument, ships `status`, `--dry-run` and the whole read path working
  against the real host, and fails closed with a typed refusal when a live action is
  requested without bindings. Unit 13 supplies them; no behaviour of unit 10 changes then.

### Acceptance

- The pure modules ship with their tests; the activation suite stays green
  (`npx vitest run --config ops/vitest.config.ts` — `npm run verify` does not contain it).
- A mutation probe over the new pure modules, with the mutant set restored
  byte-identically.
- The adversarial loop runs on unit 10: it has real surface (exit codes, the compensation
  path, argument parsing, the disarm fail-safe).
- `ops` typecheck and lint green.

## Unit 7 brief, as it was given

**Unit 7: the shell readers** — one per field of `Observations`, each returning a
`Reading` whose reason carries no credential. Functional core, imperative shell applies
inside the shell too: every reader splits into a **pure parser** (text or JSON in, value
or refusal out — tested without a host) and a **thin I/O call** (a command, a file read,
an HTTP request). Parsers are where the defects will be, so they get the tests and a
mutant set; the I/O calls get exercised by the `--dry-run` rehearsal of unit 13.

| Field | Source | Parser to test |
|---|---|---|
| `tasks` | `Get-ScheduledTask -TaskPath \GlassBoxTrading\` as JSON: state, `Actions` (all of them, not `[0]`) | exactly one action per task, else unknown |
| `checks`, `apiIndependentRead` | healthchecks.io management API, bounded backoff | 429 / 5xx / timeout → unknown; status, last ping, flips newest first; fingerprints by the scheme `tools/healthchecks-provision.mjs` already prints, never the UUID |
| `env` | `.env` bytes, **and** `PRE_ARM_CERTIFICATE` / `ALPACA_PROFILE` in the user and machine environment | parse exactly as the runtime does (`parseDotEnv`, `src/shell/runtime-config.ts:14-27`: trimmed lines, `#` comments, first `=`, one pair of quotes stripped, **the last duplicate wins**, so `export KEY=` is a different key); duplicate keys, SHA-256. **Found 2026-09-14:** `loadEnvironment` lets process variables win over `.env` (`runtime-config.ts:37-38`), so a certificate path set in the user or machine environment would reach an S4U task although `.env` has no line — the latch would read closed while it is open. The reader reports either variable found outside `.env` as its own red value, never as absent |
| `resolvedAccountMasked`, `devAccount` | the existing read-only adapter, profile explicit per call | masking; positions and non-terminal orders |
| `deploymentDigests`, `certificate` | the certificate CLI's digest print and the certificate file | verdict and both digests |
| `bootUtcMs` | `Win32_OperatingSystem.LastBootUpTime` | CIM datetime → UTC ms |
| `cycleLog`, `watchdogLog` | `cycle-run.log` + `.log.1` (the cycle wrapper rotates), `watchdog-run.log` (the watchdog wrapper does not rotate, verified 2026-09-14) in `STATE_DIR` | the leading ISO stamp, `run:` / `skip:` / other, local instant; **and the armed-composition shape step 11 needs** |
| `sessionSamples` | an append-only sample log in the activation root, one line per invocation | `Win32_LogonSession` types 2, 10, 11 and `explorer` count |
| `wrapperSha256` | `tools/cycle-run.ps1` (decide whether `watchdog-run.ps1` is hashed too — the spec says "the wrapper") | — |
| `hostPreconditions`, `freeDiskBytes` | registry and volume reads of spec §3 | value normalisation |
| `alertConfirmation` | the confirmation file in the activation state root, appended by `activation confirm-alerts` (**owner ruling 2026-09-14**, DECISIONS) | one JSON line: operator, the typed receipt times of an alert and a reminder, the three fingerprints the command read from the API, the result of the flip cross-check; anything else is unknown |
| `analyst` | the dev `--preflight` JSON (token present, MCP child verified, digests) **plus a minimal Claude call** with the token (**owner ruling 2026-09-14**): one turn, no tools, reduced to `ok` or an error class | the preflight JSON and the probe result — and `decide` gains the probe as a step-0 condition and as a gate condition, with tests and mutants |
| `schedulerCheck`, `schedulerCheckExpectEnabled` | `verify-scheduled-tasks.ps1`, twice | `SCHEDULER CHECK PASSED: N checks.` / `FAILED: x of N`; anything else unknown |
| `disarm` | `Get-ScheduledTask` for the one-shot | trigger → local instant |
| `bootstrapEntry` | the long-run journal's first entry | the existing journal codec, read-only |
| `longRunArtefacts` | directory listing of `longrun-1` | — |

The readers never write, except the sample log. Nothing may run against the competition
account except the identity read of spec §7, and nothing is enabled on the host.

After unit 7: unit 8 (actions), 9 (ledger store), 10 (CLI).

## Unit 6 brief, as it was given

**Unit 6: the core against recorded worlds, as sequences.** Unit 5's tests ask one
question per test — one ledger, one world, one answer. What they do not show is that
the answers compose: that applying each decision the way the shell will, and letting
the world change the way the actions say, walks from an opened attempt to `done` in
exactly the order of `executionOrder()`, and that every abort path ends where the spec
says. Build a small simulator **in the test tree, not in the core**: a world state
(task states and definitions, certificate line, disarm, check statuses with flips and
pings, log lines, boot time, session samples) that the actions mutate, a clock that
advances to the next five-minute invocation, and an appender that writes `intent` /
`result` / `abort` lines through `planLedgerAppend` exactly as the brief of unit 5
defines the shell's semantics. Then, at minimum:

- the happy path Monday 15:30 → Tuesday 15:20 reaches `done`, one `act` or `record` per
  step in order, no abort, and the ledger it leaves folds to every step done;
- ACT-13 + round 5 A3: a certificate FAIL at 16:05, then every invocation until 22:20
  answers `ended`, and no task is ever enabled;
- ACT-27: an owner abort entry during the watchdog drill, then `ended`;
- ACT-24: the retry a week later continues at step 4 and reaches `done`;
- ACT-29: a crash between the intent and the result of step 4 gives `STEP_INTERRUPTED`;
- ACT-26: a task toggled by hand during the silence drill gives `WORLD_MISMATCH`;
- ACT-39: a torn tail after the gate gives `LEDGER_TORN` with teardown;
- ACT-45: an outage during the silence drill gives `DRILL_INVALID`, not a counted drill.

**Contracts unit 5 fixed for the shell (units 7–10):** every reading is a `Reading`
with a credential-free reason; the verifier runs twice per invocation (without and with
`-ExpectEnabled`); one session sample per invocation goes to an append-only sample log;
`act` means intent → actions in order, stop at the first failure → result with the
decision's evidence plus what the actions reported; `record` means one result; `abort`
means one abort entry and, when `teardown`, disable both tasks and leave the certificate
line unset, then page; `ended` and `wait` write nothing new.

**Open threads carried forward:** the armed-composition line shape for step 11 (unit 7);
appending after a torn tail (unit 9); `.ts` import extensions under the architecture
gate's second root (unit 11).

After unit 6: units 7–10, the shell.

## Unit 5 brief, as it was given

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
