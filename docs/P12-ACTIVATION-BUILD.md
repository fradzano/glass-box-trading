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
| 5 | Decide: fold + observations + clock facts → act / wait / abort / done | **done** — `ops/activation/core/decide.ts`, 105 tests (155 in the activation suite), mutation probe 81/81 including five wiring mutants; architecture-gate inspector clean except the `.ts` extensions (see decisions). **Corrected in unit 6:** `-MaxLogBytes` on the watchdog task (red-first test, mutant D67, probe 82/82) | `8b7b888`, fix in the unit 6 commit |
| 6 | Core tests against recorded worlds, including the retry and abort paths | **done** — `ops/activation/tests/simulator.ts` and `sequences.spec.ts`, 14 sequences (172 tests in the activation suite); decide probe 82/82, the sequences alone 21/82 (a measure, see decisions) | unit 6 commit |
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

## Session boundary — 2026-09-14, 01:13

Unit 6 closed here: the simulator, 14 sequences, the retry-clause finding and the
`-MaxLogBytes` correction to unit 5. Nothing was run on the host.

## Next step

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
| `env` | `.env` bytes | duplicate keys, `PRE_ARM_CERTIFICATE`, `ALPACA_PROFILE`, SHA-256 |
| `resolvedAccountMasked`, `devAccount` | the existing read-only adapter, profile explicit per call | masking; positions and non-terminal orders |
| `deploymentDigests`, `certificate` | the certificate CLI's digest print and the certificate file | verdict and both digests |
| `bootUtcMs` | `Win32_OperatingSystem.LastBootUpTime` | CIM datetime → UTC ms |
| `cycleLog`, `watchdogLog` | `cycle-run.log` + `.log.1` (the cycle wrapper rotates), `watchdog-run.log` (the watchdog wrapper does not rotate, verified 2026-09-14) in `STATE_DIR` | the leading ISO stamp, `run:` / `skip:` / other, local instant; **and the armed-composition shape step 11 needs** |
| `sessionSamples` | an append-only sample log in the activation root, one line per invocation | `Win32_LogonSession` types 2, 10, 11 and `explorer` count |
| `wrapperSha256` | `tools/cycle-run.ps1` (decide whether `watchdog-run.ps1` is hashed too — the spec says "the wrapper") | — |
| `hostPreconditions`, `freeDiskBytes` | registry and volume reads of spec §3 | value normalisation |
| `alertConfirmation` | a human-written file — **location and format to fix in this unit** | refuse anything but date plus three `hc:` fingerprints |
| `analyst` | token presence, and **how "an analyst child started and verified" is observed — to design** | — |
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
