# P12 activation — specification

The activation script turns the owner's pre-authorisation into an executed
sequence: certificate, enable, drills, reboot, gate, anchor. It exists because the
two steps that used to need a person — the cold-start proof at 13:50 and the
supervised first cycle at 15:15 — fall on weekday afternoons the owner cannot plan
around, and because every one of those steps is decidable from observations rather
than from judgement.

Its yardstick is [`P12-ACTIVATION-SCENARIOS.md`](P12-ACTIVATION-SCENARIOS.md),
derived by an agent that was not allowed to read this repository.

**Revision 10** (2026-09-14) restores the absolute step-10 deadline as a second,
independent certificate-write boundary and implements the unit-8 effect shell. The
write is authorized before dispatch and atomically at the port's linearisation point;
equality is valid, the first millisecond after either boundary is not. The shell also
revalidates certificate and deployment digests before and after the write, requires
ports to settle after abort and waits for that settlement, and exposes restart as
intent-only.
**Revision 9** (2026-09-14) defines and implements the independent integrity repair
of the unit-7 reader and gate boundary: LF termination is evidence, measurement times follow I/O,
the gate read is last and expires, management credentials stay on the exact HTTPS API
origin/path, task identity and executable paths are compared by value, SDK queries are
closed, and a changed deployment can record a new certificate in a later attempt.
**Revision 8** (2026-09-14) folds in the owner's second review of unit 7: an SDK turn
that ended on an API error is a failed analyst call, no receipt of gate condition 4 may
lie after now, a new attempt runs steps 0 and 3 again, the disarm one-shot is judged by
its principal and settings as well, and the probe keeps its own deadline. Not a blind
round either; section 11 says what it changed.
**Revision 7** (2026-09-14) folds in the owner's review of unit 7 of the build and two
owner rulings; it was not a blind round, and section 11 says what it changed.
**Revision 6.** Five adversarial rounds: rev 1 NO-GO (A=5 B=12 C=2), rev 2 NO-GO
(A=4 B=9 C=3), rev 3 NO-GO (A=4 B=11 C=3), rev 4 NO-GO (A=2 B=8 C=6), rev 5 NO-GO
(A=4 B=7 C=4). Section 11 carries what each changed. Round 5's findings moved back
into the **step table** — the data this spec's pure core folds over — and its
reviewer's judgement was that the core is worth building once those clauses stand,
which they now do. Two things remain the owner's: the order of the check rotation
against gate condition 4 (§8.13), and the certificate's human checkpoint (§10).

---

## 1. What the script is, and what it is not

It is an **operator**, not a trading component. It starts nothing that can place an
order by itself; it hands the deployment its permission to trade, and only after
the three conditions the owner named are observed to hold:

> **Armed only on PASS, a flat dev account, and a green gate.**
> (Owner ruling 2026-09-11, DECISIONS.)

Once the anchor cycle has fired and the gate is recorded, its job is done; the
watchdog, the three checks and the weekly review carry the run from there.

**It is not a long-lived process.** Step 8 reboots the machine, so every step is a
separate short invocation that reconstructs the phase from the ledger plus the
world and then does one thing.

## 2. Axioms

The catalogue's seventeen invariants are adopted as written. Five consequences
carry the design:

- **A1 — Unknown is never green.** An unreachable API, a tool that did not run, a
  log line that could not be found and a step that timed out are all failures.
- **A2 — Every exit is safe.** No path may end with the deployment able to trade
  unvalidated.
- **A3 — Observe, don't assume.** The cycle and watchdog task *definitions* (not
  just states), and the disarm task from step 4 through the gate; check states,
  `.env`, the profile, both digests and both wrapper hashes are read before every
  decision that uses them. The activation task is the invocation mechanism in §5,
  not a unit-7 observation. Its registration is deferred to unit 13 and is not
  claimed as measured here. Cycle and watchdog are observed throughout; the disarm
  task is observed from step 4 through the gate, the phases in which this specification
  requires it.
- **A4 — The record is the only memory.** Intent before the action, result after,
  append-only; phase comes from the record *plus* a verification query. **An
  append that fails is itself an abort**: disable both tasks, page, exit (ACT-44).
- **A5 — Permission is granted, never merely not-prevented.** No step may make the
  *absence* of something mean "may trade" (§6).

## 3. The host, and the deployment as found

Measured 2026-09-12 and re-measured independently in round 4. Step 0 re-reads each
line and refuses if any has changed.

| Precondition | Measured value |
|---|---|
| Sleep / hibernate on AC | both `0x0` — never |
| Fast startup | `HiberbootEnabled = 0` — a restart is a real restart |
| Windows Update active hours | 09:00–03:00; the drills run **inside** those hours, which is what keeps Windows from restarting during them |
| Task definition ACL | `felix`: read only; `Administrators`: full control |
| Account rights | `felix` is in the local Administrators group; an ordinary shell is not elevated |
| Reboot right | `SeShutdownPrivilege` present in the token |
| Auto-logon / ARSO | `AutoAdminLogon = 0`, but `AutoLogonSID` and `LastUsedUsername` set and `DisableAutomaticRestartSignOn` **absent** — ARSO is active and the elevated step must switch it off, or step 9's proof is worthless |
| Session detection | `quser` absent on Windows 11 Home; `Win32_LogonSession` (types 2, 10, 11) and an `explorer` process work |
| Node / disk | v24.9.0; 1.1 TB free |

**The deployment as found:**

1. **The registered cycle task does not use the wrapper.** It executes
   `node.exe "…\dist\shell\agent-cli.js"` directly, window 15:30 + 6½ h, from the
   competition week of 2026-09-02. No session test, no lead-in, no liveness ping,
   no readiness report, no 14:00 firing. `verify-scheduled-tasks.ps1` catches it
   (executed in round 4: exit 1, `SCHEDULER CHECK FAILED: 2 of 51`). The installer
   preview produces the right one: action `powershell.exe -File tools\cycle-run.ps1`,
   window Mon–Fri **14:00–23:45**, coverage OK through 2026-12-16.
2. **`.env` carries a stale `PRE_ARM_CERTIFICATE`** pointing at the hackathon
   certificate of 2026-09-02, with `ALPACA_PROFILE=competition` and `STATE_DIR` at
   `longrun-1`, which is empty. A stale key is worse than an absent one: startup
   validation passes, the runtime acquires authority and reads the broker — against
   the competition account — and only then refuses, journalling `CONFIG_INVALID`
   and setting the credential fence (`agent-runtime.ts:420-426`,
   `mutation-gateway.ts:289-294`). An absent key is refused at
   `core/startup.ts:353`, before the broker is even constructed. `CONFIG_INVALID`
   is not sticky (`core/journal.ts:72-74` — only `KILL` and `PROVENANCE_BROKEN`
   are), so the damage is a releasable halt plus
   a contaminated state directory, not an irreversible mark.
3. **`ALPACA_PROFILE` decides whether the latch exists at all.**
   `evaluateArmingGate` returns `armed: true` for every non-competition profile
   (`arming-gate.ts:56`), and the certificate run sets the profile to `dev` for its
   own duration.

## 4. The ledger

`C:\Users\felix\glass-box-state\activation-1\ledger.jsonl`: one JSON object per
line, UTF-8, LF, `fsync`ed, fields `seq` (monotonic), `at` (ISO 8601 with offset),
`attempt`, `step`, `kind` (`intent` | `result` | `observation` | `correction` |
`abort` | `note`), `outcome` (`ok` | `failed` | `already_in_target_state` |
`unknown`), `evidence`, `next_owner_action`.

**Integrity.** A `seq` gap, a torn final line or a non-monotonic `at`: state
unknown, verify against the world. A torn line is never repaired; a `correction`
names the damaged `seq`. **An append that throws** — a lock, Controlled Folder
Access, no space — disables both tasks, pages and exits (A4).
The LF is evidence, not formatting: a syntactically complete first journal line
without its terminator is torn/unknown. The same bytes followed by LF are complete.

**Absent, empty or stale** means: disable both tasks, page, open a new attempt
whose first entry records what was found.

**One instance.** A lock file in the activation state root holds pid and start
time; a second invocation appends one `note` and exits; a lock whose pid is gone is
taken over by an entry saying so. `withMutex` is not reused: it blocks
indefinitely and records no pid.

**Secrets.** Never a ping URL, never a check UUID, never an API key, never a full
account id — checks by name and `hc:` fingerprint, accounts by masked id.

## 5. Steps

Each step is a pure decision (`ledger + observations → action | abort | wait`) in
its own invocation, idempotent, with a **`not valid after`**. An invocation that
arrives late does not act; it aborts and records why.

| Step | Runs at | Not valid after | Precondition | Action |
|---|---|---|---|---|
| `0-preflight` | before step 2 | — | §3 unchanged; free disk; lock taken; no duplicate key in `.env`, and `PRE_ARM_CERTIFICATE`, `ALPACA_PROFILE` and `STATE_DIR` set in neither the user nor the machine environment, because the runtime lets process variables win over `.env`; the SHA-256 of **both** wrappers, `cycle-run.ps1` and `watchdog-run.ps1`, recorded by name; `CLAUDE_CODE_OAUTH_TOKEN` present, the analyst's MCP child started and verified (the dev `--preflight`), **and the token proven live** by a minimal Claude call through the pinned Agent SDK — the configured `ANALYST_MODEL`, one turn, no tools, no settings, a hard deadline the probe keeps itself — it races the session, so an SDK iterator that ignores the abort still ends on time (revision 8) — the analyst's constructed environment without `ANTHROPIC_API_KEY`, and success only as a `success` result with `is_error` false (revision 6 said a dead token would cost the anchor at 14:35; the runtime checks the token for presence only, so it would instead have armed a run whose every analyst call fails); **gate condition 4 present as the confirmation `activation confirm-alerts` wrote**: a receipt time per check, or the owner's statement that one mail named all three; the reminder's receipt time and the checks it listed; the three `hc:` fingerprints, which must equal the three the API reports **now**; and the down flip assigned to each check. Step 0 repeats the cross-check against the live flip history — per check a down flip before its alert, no up flip before the reminder, the alert no later than the reminder, the reminder at least one reminder period after the down flip, all three checks listed — and the confirmation is at most 14 days old, measured as an exact duration from its **oldest** receipt; and no receipt — each alert and the reminder, one by one — lies after the moment `confirm-alerts` wrote the line or after step 0's clock (revision 8: a reminder typed into the future passed while the checks had not come back up) | remove the `PRE_ARM_CERTIFICATE` line from `.env` (replace in place, re-read, re-hash); read the three checks through the API and require each `up` or `paused`. **It sends nothing.** `check-alert-path.ps1` deliberately ends with all three checks failing and needs `-ResolveOnly` afterwards; running it here would leave them down from 15:35 until the first firing after 22:05 and bury the activation's own pages under eighteen reminder mails |
| `1-install` | Sun/Mon, elevated | before step 2 | build current | re-register both tasks (`install-scheduled-task.ps1 -CoverageThroughDate 2026-12-16`), then `verify-scheduled-tasks.ps1` must print `SCHEDULER CHECK PASSED`; record its count and both action lines verbatim |
| `0-resume` | every invocation | — | — | read both task **definitions and** states, the three check states, `.env` (hash, whether `PRE_ARM_CERTIFICATE` is set, `ALPACA_PROFILE`), the resolved account id (masked, read-only), both digests, the wrapper hash. World beats ledger; every conflict is recorded. Each observation is compared against **the expectation of the step the ledger says we are in** (table above), not against an absolute: an enabled task is red before step 4 and expected after it; a certificate line is red before step 10 and expected after it |
| `2-certificate` | Mon, from 15:35 | 22:40 | a certificate file that the runtime's own `validateArmingCertificate` accepts against this deployment — the same function the arming gate calls: exact schema, evidence digest, PASS, dev role, canonical origin, both digests; a document whose flat fields say PASS and that fails this validation is REJECTED, never PASS — obtained from `certificate-cli --preflight` run **with the dev profile *and* the dev `STATE_DIR` and diagnostic sink** (it builds a full runtime and would otherwise write `pings.log`, an `analyst/` directory and an epoch binding into `longrun-1`), followed by an assertion that `longrun-1` holds **no `journal.jsonl`, no `epoch.json`, no `analyst/`, no `pings.log`** — not "is empty", because `resolveStateDir` creates `quarantine/` on any read (`src/shell/state-dir.ts:77-78`) and `readiness-cli.js` reads that directory on every skipped firing, so an emptiness test would fail on the second attempt for a directory the design itself made | validate only |
| `3-flat` | after 2 | 22:45 | dev account read-only: zero positions, zero non-terminal orders | validate only; never cancel or close anything |
| `4-enable` | Mon, **22:05–22:20** | 22:20 | **steps 2 and 3 `ok` in this attempt**; US session closed; each check `up` or `paused`; both tasks `Disabled` and carrying the definitions verified in step 1, asserted **by value** for `-SkipOutsideSession` and `-SessionLeadInMinutes` (the verifier only resolves those parameters, it does not check them); `PRE_ARM_CERTIFICATE` absent; profile `competition` | enable both tasks; register the disarm one-shot |
| `5-drill-watchdog` | Mon, 22:15–22:50 | 22:50 | an observed watchdog firing at T ≤ 22:25; the API answers an independent read | disable the watchdog task only; wait until the API shows **exactly** `{gbt-watchdog}` down with its flip timestamp inside the window; re-enable; wait until up |
| `6-drill-silence` | Mon, 22:50–23:15 start | 00:30 | watchdog up; API reachable; last observed ping **T ≤ 23:15** | disable both tasks after an observed ping; wait until all three are down with their flip timestamps; **then repeat the independent API read and check each flip timestamp against the moment of the disable** — if the API is unreachable, the drill is **invalid**, is recorded as invalid and is repeated, never counted (ACT-45). The decisive discriminator is **local**, because a down flip always carries the moment the grace expired and therefore always follows the disable: with both tasks disabled no wrapper runs, so `cycle-run.log` and `watchdog-run.log` must contain **no line** inside the silence window — a network outage leaves `run:` lines and undelivered pings there, and that is what separates "my disable caused this" from "the uplink did". Every timestamp comparison is made in UTC, since the API's stamps are UTC and the wrapper logs are too; then clear the three checks: readiness through `readiness-cli.js` so the signal keeps its meaning, liveness and watchdog by a direct success ping; leave both tasks disabled |
| `7-rearm` | anchor day, 13:50 (second chance 13:55) | **13:59** | steps 2–6 `ok`; step 8 closed `ok`; §3 unchanged; wrapper hash unchanged | enable both tasks |
| `8-reboot` | anchor day, 13:30 | 13:45 | steps 2–6 `ok`; all three checks `up`, so the machine is not rebooted into a gate that cannot turn green | write the intent line, then restart. **The process cannot write its own result**: the first invocation after the boot closes step 8 with `ok` when `LastBootUpTime` is later than the intent, and with `failed` otherwise. **The result names its anchor day and counts only for that day** — a reboot proof from a previous attempt is not a reboot proof for today |
| `9-proof` | anchor day, 14:05 | 14:35 | — | a `run:` or `skip:` line whose UTC stamp converts to 14:00–14:04 local, searched in `cycle-run.log` **and** `cycle-run.log.1`, both file names and the converted window recorded; session state sampled 13:55 and 14:05; `LastBootUpTime` recorded |
| `10-gate` | anchor day, 14:35 | 14:55 | the conjunction in §7 | write **the certificate path validated in step 2** into `.env` (replace in place, never append; re-read, re-check duplicates, re-hash, and re-validate the file's two digests after the write), then delete the disarm one-shot |
| `11-anchor` | anchor day, 15:20 | 16:00 | — | record the firing whose stamp converts to **15:15–15:19** local — a later catch-up is not the anchor — and the `BOOTSTRAP` entry; the measurement period started |

**Revision-10 task and time boundary.** The step-1 and `0-resume` task reading carries
UserId, RunLevel, LogonType, StartWhenAvailable, WorkingDirectory, every action and
the expected executables. Cycle and watchdog must use the absolute trusted Windows
PowerShell path; their `-NodePath` must equal the running pinned runtime's
`process.execPath`. An existing but different file, including `notepad.exe`, is red.
The disarm task carries the same identity and action detail from step 4 through the
gate. The activation task is not claimed as an observation in unit 7.

Session samples are timestamped after their session probe completes. The
healthchecks read is the last external I/O before the gate decision; its completion
time and the later decision time are distinct. The decision does not grant an
unconditional write: it carries both the absolute 14:55 schedule deadline and a
five-second lease containing the observed check triplet. Immediately before changing
`.env`, unit 8 reads the three checks and the clock again and passes both through
`authorizeCertificateWrite`. The atomic compare-and-swap primitive invokes that same
authorization callback inside its commit operation against its linearisation-time
clock. Equality at either deadline is
valid; after either deadline, with an unknown or changed check, or with a clock before
the observation, no write occurs. The supplied UTC deadline must denote 14:55 on the
anchor day as derived from the same local/UTC observation. Unit 7 proves this
conjunction and unit 8 consumes it.

**Abort, precisely.** Every abort **up to and including step 10** disables both
tasks, leaves `PRE_ARM_CERTIFICATE` unset and pages. **An `abort` entry ends the
attempt**: no later invocation of that attempt may act, whatever the world then
looks like. Without this clause a certificate that failed at 16:05 would still
leave every precondition of step 4 true at 22:05, and the tasks would go on — no
trade, because the latch holds, but outside the owner's condition, which is what
the condition is for. An invalid drill (steps 5 and 6) is such an abort: a repeat inside
the same night is arithmetically impossible, so the retry repeats the drill from step 4.
After step 10 has written the
certificate path and the anchor has fired, the deployment is the running system:
an abort in step 11 pages and records, and does **not** tear down a correctly armed
run (that decision is the owner's, through the entry below).

**The owner's own abort (ACT-27).** `activation abort --confirm` is a defined
entry point: it disables both tasks, removes the certificate line, deletes the
disarm one-shot, sends one success ping per endpoint so silence stays visible
rather than hidden, and writes a terminal entry naming the operator and the time.
A deliberate stop must not be readable as a crash. **It never defers to the
single-instance lock**: it disables both tasks first — idempotent, safe under a
race with a running invocation — and only then takes the lock, with a bounded
wait, to write its terminal entry. If it cannot write that entry it says so and
exits non-zero, because an owner who typed the abort and got a shrug would go to
bed believing the run was stopped.

**The invocation mechanism.** One task, `GlassBoxTrading-Activation`, RunLevel
Highest, S4U, `StartWhenAvailable = true`, `MultipleInstances = IgnoreNew`, two
triggers: Monday 15:30 repeating every 5 minutes for 9h15m, and the anchor day
13:25 repeating every 5 minutes for 2h40m. Deadlines in the table, not the trigger,
decide what a late invocation may do.

**Retry on the next trading day.** A new attempt runs `0-resume` and continues from
the first step whose result is not `ok` **for this attempt's anchor day**. A new
anchor day resets steps 4, 7, 8, 9, 10 and 11 to "not run", because each of them
asserts something about one particular day: an enable that was undone, a reboot
that happened yesterday, a firing in yesterday's log. Step 1 carries over and is
re-checked by value. Step 2 carries only while freshly printed digests and the
current validated certificate match its recorded evidence. If the digests changed
and a new PASS certificate matches the new pair, the old result remains in the
append-only ledger but stops counting; the new attempt appends its own step-2 result.
Steps 0 and 3 do not (revision 8): the confirmation's age, the token, the host, the
disk and whether the dev account is flat are facts about now, so every attempt runs
them again — a retry more than fourteen days after the oldest receipt stops at step 0,
a dev account that is no longer flat stops at step 3, both before step 4. The wrappers
keep their baseline across attempts: the new step 0 compares both hashes with the
previous attempt's preflight. Before it may act: the disarm one-shot
must be **re-registered** for the new anchor day (its old trigger has passed and
will never fire again), both tasks must read `Disabled`, the three checks must read
`up` or `paused` — with both tasks disabled since the abort, a check that read up in the
afternoon is down long before 22:05, so the owner pauses them before the retry (found by
the unit-6 simulator) — and the certificate is re-validated against freshly printed digests — a
matching certificate from a previous day is fine; changed digests require a new
certificate and do not create a permanent `WORLD_MISMATCH`. `FLATTEN_DATE`
does not move (owner ruling 2026-09-11), so a slip shortens the run and needs no
new certificate; only a failed certificate needs a new run.

## 6. The latch

- **`PRE_ARM_CERTIFICATE` stays out of `.env` from step 0 until step 10.** A
  competition runtime cannot arm without a certificate matching both digests.
  Nothing the activation fails to do can produce permission.
- **Writing it is digest-neutral**: one of three `deployment`-classified fields
  (`src/core/certificate.ts:39-41`); only `policy` fields enter the policy digest.
- **No firing before the gate reaches the runtime — once the tasks are the ones
  step 1 installs.** The wrapper invokes `agent-cli.js` only inside the session
  plus a 20-minute lead-in; outside it runs `readiness-cli.js`, pings liveness and
  exits (`tools/cycle-run.ps1:236-256`). Drill firings and the 14:00 firing are
  outside the session; the first firing that reaches the runtime is 15:15, after
  the gate at 14:35.
- **The watchdog cannot write either.** `assessStaleness` returns `quiet` outside
  the session and on a journal with no authoritative entry
  (`src/core/lifecycle.ts:745-746`); `runWatchdog` returns on quiet before
  acquiring authority (`src/shell/watchdog.ts:110-111`); the wrapper passes the
  real session window (`tools/watchdog-run.ps1:224-227`).
- **No pending flag.** Revisions 2 to 4 carried a marker file that the cycle
  wrapper was to check. It is dropped: the latch makes the case it guarded
  impossible, no such check exists in any file today, and adding one would put
  untested code into an un-gated `.ps1` on the path of every firing — a layer
  counted in a defence-in-depth argument that was never built is worse than an
  admitted single mechanism.
- **The disarm one-shot** remains the second layer: Highest, S4U,
  `StartWhenAvailable`, firing at **15:05** on the anchor day, disabling both tasks
  unless the ledger shows a green gate, and disabling them when the ledger is
  unreadable. It is judged **by value**, not by its time: it must read enabled and carry
  exactly one action — the expected node running
  `ops\activation\cli.ts disarm --state-root <activation root> --anchor-day <anchor day>`
  and nothing else — and it must run the way it is registered here: `Highest`, `S4U`
  and `StartWhenAvailable`, each read back from the scheduler (revision 8). Its
  principal is resolved by Windows to a SID and compared with the current activation
  identity's Windows SID; `felix`, `.\\felix`, and a domain account with the same short
  name are not treated as interchangeable strings. The expected
  node is compared by full path; it is the node the activation itself runs on, and only
  if that is the pinned `.node-version`, never the node the registration names. A
  trigger at 15:05 that runs anything else, or runs it without those settings, is red in
  every phase from step 4 to the gate.
- **Both wrappers are hashed**, `cycle-run.ps1` and `watchdog-run.ps1`, by name, at
  step 0, and re-checked on every later invocation and at the gate: `tools/*.ps1` is
  outside the runtime digest, outside the architecture gate and untouched by the
  test suite, and the two wrappers carry different safety claims.

## 7. The gate, stated as a conjunction

Green means all of: `SCHEDULER CHECK PASSED` with both tasks enabled and zero
failed checks (the count is recorded, not compared — `-ExpectEnabled` adds checks);
both deployment tasks use `S4U` exactly, not merely any unattended logon type;
the cycle task's `-SkipOutsideSession` and `-SessionLeadInMinutes` absent or at
their defaults, asserted by parsing the action line by value; `ALPACA_PROFILE` reads
`competition` and the resolved account id matches the long-run account (a read-only
identity check — the one permitted touch of that account, and it mutates nothing);
both digests re-printed at gate time still equal the certificate's; the three checks
`up` in a stable observation with bounded backoff, where a 429, a 5xx or an
unreachable API is `unknown` and unknown is red; step 8 closed `ok` with
`LastBootUpTime` later than **today's** intent line, not an earlier attempt's;
step 9 satisfied; both wrapper hashes unchanged, by name; and the analyst's token
proven live by the probe at gate time, where a probe that fails or cannot run is red
(owner ruling 2026-09-14).

The healthcheck observation is the last external read before the decision. It carries
its completion time, and the certificate-write decision carries that observation plus
an absolute 14:55 schedule deadline and a five-second expiry. Unit 8 reads all three
checks and the clock immediately before applying the action, and the atomic write port
repeats the same authorization at linearisation. Unknown or changed identity/status/
last-ping data, a clock before the observation, or the first instant after either
deadline refuses the write; equality at each deadline remains valid. Unit 7 proves
this authorization contract and unit 8 implements it.

Healthchecks management requests use manual redirects. `X-Api-Key` is sent only to
the HTTPS `healthchecks.io` origin on `/api/v3/checks/`, `/api/v3/channels/`, or an
exact `/api/v3/checks/<uuid>/flips/` path. A foreign `update_url`, malformed path or
redirect is unknown and receives no key.

## 8. Reconciliation with the cold catalogue

1. **ACT-08.** The lead-in lives in the wrapper; the core vetoes entries while
   `now < opensAt` (`src/core/decision.ts:216`). The 15:15 firing is the anchor;
   the first firing that can open a position is 15:30.
2. **ACT-09.** `.env` is not digest-neutral as a file (`ANALYST_MODEL` is policy),
   but the line the script writes is.
3. **ACT-11.** Step 0's hardest precondition, and as of 2026-09-12 **not yet
   satisfied**: the recurring reminder had never been switched on; its first
   arrival completes it.
4. **ACT-19, invariant 12.** No check is left paused or down across the night:
   step 6 clears all three before it ends, and step 0 sends nothing at all.
5. **ACT-45.** The silence drill now checks the *cause* of its silence, not only
   its shape; an unreachable API or a flip that predates its own disable makes the
   drill invalid and repeatable rather than passed.
6. **ACT-25 / ACT-26 / ACT-57.** Digests re-validated at the gate; unexpected task
   states, certificate lines and profiles are red, judged against the expectation
   of the current step.
7. **ACT-32 / ACT-36.** Step 9's window is 14:00–14:04, step 11's is 15:15–15:19; a
   catch-up satisfies neither. ACT-37 is satisfied by the deployment itself:
   `MultipleInstances = IgnoreNew` on both tasks, verified and checked by the
   verifier.
8. **ACT-27.** The owner's deliberate abort has its own entry point (§5).
9. **ACT-44 / ACT-60.** A failing ledger append is an abort (A4).
10. **ACT-41.** The cycle window is 14:00–23:45 and the watchdog window ends 23:55;
    the session comes from the exchange calendar, and an anchor in 2026-10-26..30
    is forbidden anyway.
11. **Declared loss — the powered-off drill.** A script cannot switch the machine
    back on, so step 6 proves the weaker "both tasks disabled" silence. Unproven by
    name: **ACT-20** (reboot issued, machine does not return), **ACT-33** (hang at
    an update screen), **ACT-38** (power cut) — all three rest on "a dead machine
    alarms", which rests on the cron schedules and graces alone until the owner
    runs the real drill on an evening after 22:00.
12. **Declared limit — the drill measures a degraded watchdog.** While the
    certificate line is out of `.env`, `validateStartupConfig` refuses, so
    `composeWatchdog` degrades to its fence-and-halt-only ports
    (`src/shell/watchdog-runtime.ts`). A quiet run still exits 0 and the wrapper
    still sends its success heartbeat, so the check stays green — fail-closed by
    design, but it means step 5 proves the heartbeat path of a *degraded*
    watchdog. The armed composition first runs after step 10, unobserved. Step 11
    therefore records the first composition line after the gate from
    `watchdog-run.log`, armed or degraded, as evidence rather than as a condition. Its
    shape is taken from `src/shell/watchdog-runtime.ts`, because no watchdog log on this
    host has held a composition line yet.
13. **The rotation comes first.** Rotating the three checks replaces their URLs and
    therefore their fingerprints, which is why step 0 compares the confirmation's
    fingerprints against the live ones: a rotation after the confirmation would
    leave it attesting endpoints that no longer exist (ACT-11, ACT-50). The order
    is: rotate, then exercise the alert path, then wait out one reminder period,
    then confirm — all on the new checks, all before Monday.
14. **Main catalogue #81 — the analyst dies after the gate.** The probe at step 0 and at
    the gate covers the moment before arming. After it, a failed analyst call raises
    `ANALYST_UNAVAILABLE` on that cycle's readiness signal without halting (SPEC
    S-CYC-01, owner ruling 2026-09-14). Declared limit: outside the session readiness
    comes from standing impediments only, so it reads success overnight and fails again
    with the first cycle of the next session. Revision 8: until the second review this
    held for rejections and timeouts only — a turn the SDK ends as `success` with
    `is_error` true was returned as the analyst's answer and raised nothing. It now
    throws, and the path is tested through the real `createClaudeAnalyst` with only the
    SDK's `query` replaced.
    Revision 9 aborts and closes the SDK query on timeout and error. Both the probe
    and the real analyst have a repeated-cycle counterexample whose iterator ignores
    abort; closing it ends the query and no live query accumulates.

## 9. Where the code lives, and how it is tested before it matters

`ops/activation/`, outside the certified digest, run directly by Node 24. The pure
core lives in `ops/activation/core/`; covering it with the architecture gate needs
a second root in `tools/check-core-architecture.mjs`, a change inside the digest
that must land **before** the certificate run.

**No step runs against the host for the first time on Monday.** The core is
`ledger + observations → action`, so every step is exercised against recorded
worlds in the test suite, and the shell gets a `--dry-run` mode that performs every
read, prints every intended action and touches nothing — run once end to end on
Sunday against the real host, with the ledger written to a scratch root. The first
rehearsal exercises the readers, the ledger and the step selection for the steps
whose windows are open when it runs. **What it cannot rehearse, stated rather than
implied:** the elevated re-registration, the certificate run with its human
checkpoint, the reboot and the result derived from it, every drill observation (no
disable, so no down flip), and — because on a Sunday every deadline is either past
or not yet reached — the sequence itself. The sequence belongs in the test suite,
where the pure core runs against recorded worlds and recorded clocks; the
rehearsal proves the shell can read this host.

## 10. The open decision, sharpened

**The certificate's human checkpoint.** Every certificate run provokes a 401 on
purpose, halts `AUTH_FAILURE`, and waits — heartbeating, without a timeout
(`certificate-run.ts:109-129`) — for a human to type `CLEAR-HALT <seq>`
(`certificate-cli.ts:70-81`). A task with no logged-on session cannot answer it.

Round 4 sharpened the cost of the first option: the run needs 20–40 minutes of open
market, so it must start by about 21:20 and the prompt arrives at an unpredictable
minute; the owner is therefore bound to a Monday evening slot in market hours — the
very kind of commitment whose unplannability motivated scripting this in the first
place. The alternative is a change in `src/shell/certificate-cli.ts` that answers
the checkpoint under the recorded pre-authorisation, with the journal entry naming
what it is (a pre-authorised release, not "human confirmed"), plus tests and a
review before Monday. That is a real weakening of the one deliberate human act in
the certificate, and it is the owner's call, not mine.

## 11. What the four rounds changed

- **Round 1 (rev 1, A=5 B=12 C=2).** No restart after its own reboot; the disarm
  task shared fate with what it guarded; checks left paused; "nobody logged on"
  unobservable; the drill could not tell a drill from an outage.
- **Round 2 (rev 2, A=4 B=9 C=3).** The fixes had the shape of what they replaced:
  a file whose absence meant permission, on a path the wrapper never resolves; only
  two steps had deadlines; a skipped reboot still passed the gate.
- **Round 3 (rev 3, A=4 B=11 C=3).** The latch held against every attack and all
  four of its load-bearing code facts were confirmed — but the spec described a
  world it had not established: the registered task bypasses the wrapper, the
  certificate key is present and stale, the profile was never observed, and
  "resume through the API" was not a capability.
- **Round 4 (rev 4, A=2 B=8 C=6).** The world now matched the host, measured line
  by line, and both remaining A-defects were in the alert path: step 0 would have
  left all three checks down for six and a half hours, and the silence drill had no
  cause check, so a network outage could pass as a proven alert path. Both are
  closed above. Closed with them: the step-4 window that made step 5 arithmetically
  impossible, a step 8 that could never report `ok`, `--preflight` writing into the
  long-run state directory, absolutes in `0-resume` and in the abort rule that were
  wrong after the gate, an unnamed certificate path at step 10, and a ledger append
  that could fail unnoticed. Dropped rather than fixed: the pending flag.
- **Round 5 (rev 5, A=4 B=7 C=4).** Both A-defects of round 4 were closed, and the
  findings moved back into the step table — the data the pure core folds over, not
  the design. The planned check rotation would have invalidated gate condition 4
  without any clause noticing (→ step 0 compares fingerprints, §8.13 fixes the
  order); a retry on a later day would have inherited the previous day's reboot
  proof (→ results are anchor-day scoped, the gate compares against today's intent);
  step 4 would have enabled both tasks on an evening whose certificate had failed,
  because its preconditions never mentioned steps 2 and 3 (→ both, plus an abort
  that ends the attempt); and the owner's own abort could be swallowed by the
  single-instance lock (→ it disables first and takes the lock afterwards). Folded
  in as well: the local log discriminator and UTC comparison for the drill, the
  emptiness assertion named by artefact instead of by directory, a staleness bound
  on condition 4, the OAuth token and analyst start moved into step 0, an honest
  list of what the rehearsal cannot rehearse, and the degraded-watchdog limit.
- **Revision 7 (the owner's review of 2026-09-14; not a blind round).** Reading the code
  corrected revision 6's reason for the token check, and the owner ruled a live-token
  probe at step 0 and at the gate. Gate condition 4 is recorded per check by
  `confirm-alerts` and cross-checked against the flip history instead of resting on one
  typed time. The certificate is judged by the runtime's full validator, not by its flat
  fields. The disarm one-shot is judged by what it runs. Both wrappers are hashed by name.
  `.env` is not the whole latch: the three keys set in the user or machine environment
  are red. A retry asks for the checks up or paused. An invalid drill ends the attempt.
  And the long run's silent analyst failure became an alarm (§8.14).
- **Revision 8 (the owner's second review of unit 7, 2026-09-14; not a blind round).** Five
  clauses held only against the inputs the tests used, and each got a counter-test that
  failed first. The alarm of §8.14 missed the SDK's `success`/`is_error` result. Gate
  condition 4 checked the age of its oldest receipt but not whether any receipt lay in
  the future. A retry inherited steps 0 to 3, so a confirmation older than fourteen days
  and a dev account traded on since both passed; now only steps 1 and 2 carry over, and
  the wrappers keep their baseline across attempts. The disarm one-shot was judged by
  what it runs but not by whether it could run elevated, signed out and after a missed
  start. And the probe's deadline depended on the SDK honouring the abort.
- **Revision 9 (independent unit-7 integrity review, 2026-09-14).** The review supplied
  fourteen falsifiable acceptance points. Red counterexamples covered LF termination,
  stale clocks and gate reads, credential forwarding, arbitrary Node/PowerShell paths,
  unused runtime identity, SDK cleanup, retry certificates and incomplete task identity.
  The final task-identity correction compares canonical Windows SIDs, not short-name
  spellings returned by Task Scheduler.
  Unit 7 closes only after the expanded mutation set, full verification and the final
  six-lens cold read report zero A and zero B findings.
