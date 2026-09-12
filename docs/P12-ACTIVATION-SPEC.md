# P12 activation — specification

The activation script turns the owner's pre-authorisation into an executed
sequence: certificate, enable, drills, reboot, gate, anchor. It exists because the
two steps that used to need a person — the cold-start proof at 13:50 and the
supervised first cycle at 15:15 — fall on weekday afternoons the owner cannot plan
around, and because every one of those steps is decidable from observations rather
than from judgement.

Its yardstick is [`P12-ACTIVATION-SCENARIOS.md`](P12-ACTIVATION-SCENARIOS.md),
derived by an agent that was not allowed to read this repository.

**Revision 5.** Four adversarial rounds: revision 1 NO-GO (A=5 B=12 C=2),
revision 2 NO-GO (A=4 B=9 C=3), revision 3 NO-GO (A=4 B=11 C=3), revision 4 NO-GO
(A=2 B=8 C=6). Section 11 carries what each changed. Round 4 verified the latch's
four load-bearing code facts independently, measured every line of §3 on the host,
and found both remaining A-defects in the **alert path** rather than in the
mechanism. Revision 5 answers them. One decision is still open (§10) and it is
sharper now than it was.

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
- **A3 — Observe, don't assume.** Task *definitions* (not just states), check
  states, `.env`, the profile, both digests and the wrapper's hash are read from
  the world before every decision; on conflict the world wins and is recorded.
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
   is not sticky (`core/journal.ts:73-75`), so the damage is a releasable halt plus
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
| `0-preflight` | before step 2 | — | §3 unchanged; free disk; lock taken; no duplicate key in `.env`; the wrapper's SHA-256 recorded; **gate condition 4 present as a dated human confirmation** — alert receipt and a received reminder — together with the three `hc:` fingerprints from the run that produced it | remove the `PRE_ARM_CERTIFICATE` line from `.env` (replace in place, re-read, re-hash); read the three checks through the API and require each `up` or `paused`. **It sends nothing.** `check-alert-path.ps1` deliberately ends with all three checks failing and needs `-ResolveOnly` afterwards; running it here would leave them down from 15:35 until the first firing after 22:05 and bury the activation's own pages under eighteen reminder mails |
| `1-install` | Sun/Mon, elevated | before step 2 | build current | re-register both tasks (`install-scheduled-task.ps1 -CoverageThroughDate 2026-12-16`), then `verify-scheduled-tasks.ps1` must print `SCHEDULER CHECK PASSED`; record its count and both action lines verbatim |
| `0-resume` | every invocation | — | — | read both task **definitions and** states, the three check states, `.env` (hash, whether `PRE_ARM_CERTIFICATE` is set, `ALPACA_PROFILE`), the resolved account id (masked, read-only), both digests, the wrapper hash. World beats ledger; every conflict is recorded. Each observation is compared against **the expectation of the step the ledger says we are in** (table above), not against an absolute: an enabled task is red before step 4 and expected after it; a certificate line is red before step 10 and expected after it |
| `2-certificate` | Mon, from 15:35 | 22:40 | a certificate file, verdict PASS, whose two digests equal this deployment's — obtained from `certificate-cli --preflight` run **with the dev profile *and* the dev `STATE_DIR` and diagnostic sink** (it builds a full runtime and would otherwise write `pings.log`, an `analyst/` directory and an epoch binding into `longrun-1`), followed by an assertion that `longrun-1` is still empty | validate only |
| `3-flat` | after 2 | 22:45 | dev account read-only: zero positions, zero non-terminal orders | validate only; never cancel or close anything |
| `4-enable` | Mon, **22:05–22:20** | 22:20 | US session closed; both tasks `Disabled` and carrying the definitions verified in step 1, asserted **by value** for `-SkipOutsideSession` and `-SessionLeadInMinutes` (the verifier only resolves those parameters, it does not check them); `PRE_ARM_CERTIFICATE` absent; profile `competition` | enable both tasks; register the disarm one-shot |
| `5-drill-watchdog` | Mon, 22:15–22:50 | 22:50 | an observed watchdog firing at T ≤ 22:25; the API answers an independent read | disable the watchdog task only; wait until the API shows **exactly** `{gbt-watchdog}` down with its flip timestamp inside the window; re-enable; wait until up |
| `6-drill-silence` | Mon, 22:50–23:15 start | 00:30 | watchdog up; API reachable; last observed ping **T ≤ 23:15** | disable both tasks after an observed ping; wait until all three are down with their flip timestamps; **then repeat the independent API read and check each flip timestamp against the moment of the disable** — if the API is unreachable, or a check fell before its own disable could explain it, the drill is **invalid**, is recorded as invalid and is repeated, never counted (ACT-45); then clear the three checks: readiness through `readiness-cli.js` so the signal keeps its meaning, liveness and watchdog by a direct success ping; leave both tasks disabled |
| `7-rearm` | anchor day, 13:50 (second chance 13:55) | **13:59** | steps 2–6 `ok`; step 8 closed `ok`; §3 unchanged; wrapper hash unchanged | enable both tasks |
| `8-reboot` | anchor day, 13:30 | 13:45 | steps 2–6 `ok` | write the intent line, then restart. **The process cannot write its own result**: the first invocation after the boot closes step 8 with `ok` when `LastBootUpTime` is later than the intent, and with `failed` otherwise |
| `9-proof` | anchor day, 14:05 | 14:35 | — | a `run:` or `skip:` line whose UTC stamp converts to 14:00–14:04 local, searched in `cycle-run.log` **and** `cycle-run.log.1`, both file names and the converted window recorded; session state sampled 13:55 and 14:05; `LastBootUpTime` recorded |
| `10-gate` | anchor day, 14:35 | 14:55 | the conjunction in §7 | write **the certificate path validated in step 2** into `.env` (replace in place, never append; re-read, re-check duplicates, re-hash, and re-validate the file's two digests after the write), then delete the disarm one-shot |
| `11-anchor` | anchor day, 15:20 | 16:00 | — | record the firing whose stamp converts to **15:15–15:19** local — a later catch-up is not the anchor — and the `BOOTSTRAP` entry; the measurement period started |

**Abort, precisely.** Every abort **up to and including step 10** disables both
tasks, leaves `PRE_ARM_CERTIFICATE` unset and pages. After step 10 has written the
certificate path and the anchor has fired, the deployment is the running system:
an abort in step 11 pages and records, and does **not** tear down a correctly armed
run (that decision is the owner's, through the entry below).

**The owner's own abort (ACT-27).** `activation abort --confirm` is a defined
entry point: it disables both tasks, removes the certificate line, deletes the
disarm one-shot, sends one success ping per endpoint so silence stays visible
rather than hidden, and writes a terminal entry naming the operator and the time.
A deliberate stop must not be readable as a crash.

**The invocation mechanism.** One task, `GlassBoxTrading-Activation`, RunLevel
Highest, S4U, `StartWhenAvailable = true`, `MultipleInstances = IgnoreNew`, two
triggers: Monday 15:30 repeating every 5 minutes for 9h15m, and the anchor day
13:25 repeating every 5 minutes for 2h40m. Deadlines in the table, not the trigger,
decide what a late invocation may do.

**Retry on the next trading day.** A new attempt runs `0-resume` and continues from
the first step whose result is not `ok`. Before it may act: the disarm one-shot
must be **re-registered** for the new anchor day (its old trigger has passed and
will never fire again), both tasks must read `Disabled`, the three checks must read
`up`, and the certificate is re-validated against freshly printed digests — a
certificate from a previous day is fine, a changed digest is not. `FLATTEN_DATE`
does not move (owner ruling 2026-09-11), so a slip shortens the run and needs no
new certificate; only a failed certificate needs a new run.

## 6. The latch

- **`PRE_ARM_CERTIFICATE` stays out of `.env` from step 0 until step 10.** A
  competition runtime cannot arm without a certificate matching both digests.
  Nothing the activation fails to do can produce permission.
- **Writing it is digest-neutral**: one of three `deployment`-classified fields
  (`src/core/certificate.ts:37-41`); only `policy` fields enter the policy digest.
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
  unreadable.
- **The wrapper is hashed** at step 0 and re-checked at the gate: `tools/*.ps1` is
  outside the runtime digest, outside the architecture gate and untouched by the
  test suite.

## 7. The gate, stated as a conjunction

Green means all of: `SCHEDULER CHECK PASSED` with both tasks enabled and zero
failed checks (the count is recorded, not compared — `-ExpectEnabled` adds checks);
the cycle task's `-SkipOutsideSession` and `-SessionLeadInMinutes` absent or at
their defaults, asserted by parsing the action line by value; `ALPACA_PROFILE` reads
`competition` and the resolved account id matches the long-run account (a read-only
identity check — the one permitted touch of that account, and it mutates nothing);
both digests re-printed at gate time still equal the certificate's; the three checks
`up` in a stable observation with bounded backoff, where a 429, a 5xx or an
unreachable API is `unknown` and unknown is red; step 8 closed `ok` with
`LastBootUpTime` later than its intent; step 9 satisfied; the wrapper hash
unchanged.

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
real execution then differs from a rehearsed one only in that the actions are
carried out.

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
