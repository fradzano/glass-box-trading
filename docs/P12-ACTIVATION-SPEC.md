# P12 activation — specification

The activation script turns the owner's pre-authorisation into an executed
sequence: certificate, enable, drills, reboot, gate, anchor. It exists because the
two steps that used to need a person — the cold-start proof at 13:50 and the
supervised first cycle at 15:15 — fall on weekday afternoons the owner cannot plan
around, and because every one of those steps is decidable from observations rather
than from judgement.

Its yardstick is [`P12-ACTIVATION-SCENARIOS.md`](P12-ACTIVATION-SCENARIOS.md),
derived by an agent that was not allowed to read this repository.

**Revision 4.** Three adversarial rounds have run: revision 1 NO-GO (A=5 B=12 C=2),
revision 2 NO-GO (A=4 B=9 C=3), revision 3 NO-GO (A=4 B=11 C=3). Section 11 carries
what each changed. Revision 3's idea survived all of round 3's attacks — the latch
is `PRE_ARM_CERTIFICATE` itself, and the class "armed by default" is gone — but the
round showed the spec reasoning about a **world it had not established**: the task
registered on this host is not the one §6 describes, the key that must be absent is
present, and the profile the latch depends on was never observed. Revision 4 makes
the world a precondition instead of an assumption. One decision is still open (§10).

---

## 1. What the script is, and what it is not

It is an **operator**, not a trading component. It starts nothing that can place an
order by itself; it hands the deployment its permission to trade, and only after
the three conditions the owner named are observed to hold:

> **Armed only on PASS, a flat dev account, and a green gate.**
> (Owner ruling 2026-09-11, DECISIONS.)

It is not a supervisor of the three-month run. Once the anchor cycle has fired and
the gate has been recorded, the script's job is done; the watchdog, the three checks
and the weekly review carry the run from there.

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
- **A3 — Observe, don't assume.** Task *definitions* (not just their states), check
  states, `.env`, the profile, both digests and the wrapper's hash are read from
  the world before every decision; on conflict the world wins and is recorded.
- **A4 — The record is the only memory.** Intent before the action, result after,
  append-only; phase comes from the record *plus* a verification query.
- **A5 — Permission is granted, never merely not-prevented.** No step may make the
  *absence* of something mean "may trade" (§6).

## 3. The host, and the deployment as found

Measured 2026-09-12. Step 0 re-reads each line and refuses if any has changed.

| Precondition | Measured value | Scenario |
|---|---|---|
| Sleep / hibernate on AC | both `0x0` — never | ACT-34 |
| Fast startup | `HiberbootEnabled = 0` — a restart is a real restart | ACT-34 |
| Windows Update active hours | 09:00–03:00; the drills run **inside** those hours, which is what keeps Windows from restarting during them | ACT-31 |
| Task definition ACL | `felix`: read only; `Administrators`: full control | ACT-42 |
| Account rights | `felix` is in the local Administrators group; an ordinary shell is not elevated | ACT-42 |
| Reboot right | `SeShutdownPrivilege` present in the token | ACT-06 |
| Auto-logon | `AutoAdminLogon = 0` | ACT-06 |
| ARSO | **active** (`AutoLogonSID`, `LastUsedUsername` set, empty exclusion list). The elevated registration sets `DisableAutomaticRestartSignOn = 1`, or step 9's proof is worthless | ACT-06 |
| Session detection | `quser` absent on Windows 11 Home; `Win32_LogonSession` (types 2, 10, 11) and an `explorer` process work | ACT-35 |
| Node | v24.9.0, runs `.ts` directly | §10 |

**The deployment as found — three states revision 3 assumed away, all confirmed by
reading the host:**

1. **The registered cycle task does not use the wrapper.** It executes
   `node.exe "…\dist\shell\agent-cli.js"` directly, with a window that starts
   15:30 and lasts 6½ hours. That registration is from the competition week of
   2026-09-02 and predates `tools/cycle-run.ps1`. It has no session test, no
   lead-in, no flag check, no liveness ping, no readiness report, and no 14:00
   firing. **Every safety statement in §6 is about the registration the installer
   produces, not about this one.**
2. **`.env` already carries `PRE_ARM_CERTIFICATE`**, pointing at the hackathon
   certificate of 2026-09-02, with `ALPACA_PROFILE=competition` and `STATE_DIR`
   at `longrun-1`. A key that is present but stale is *worse* than an absent one:
   startup validation passes, the runtime acquires authority, reads the broker —
   against the competition account — and only then refuses at the arming gate,
   journalling `CONFIG_INVALID` and setting the credential fence
   (`agent-runtime.ts:420-426`, `mutation-gateway.ts:289-294`). An absent key is
   refused before any of that (`core/startup.ts:353`).
3. **`ALPACA_PROFILE` decides whether the latch exists at all.** `evaluateArmingGate`
   returns `armed: true` for every non-competition profile (`arming-gate.ts:56`).
   It reads `competition` today, and the certificate run sets it to `dev` for its
   own duration in a `finally` the runbook itself calls unreliable after a Ctrl-C.

**Consequence for the task principal:** the activation task runs at **RunLevel
Highest**, logon type **S4U**, user `felix`, because ordinary rights cannot change
a task definition here.

## 4. The ledger

**Location:** `C:\Users\felix\glass-box-state\activation-1\ledger.jsonl`.

One JSON object per line, UTF-8, LF, `fsync`ed, with `seq` (monotonic), `at` (ISO
8601 with offset), `attempt`, `step`, `kind` (`intent` | `result` | `observation` |
`correction` | `abort` | `note`), `outcome` (`ok` | `failed` |
`already_in_target_state` | `unknown`), `evidence`, `next_owner_action`.

**Integrity.** A `seq` gap, a torn final line or a non-monotonic `at` all mean: the
state is unknown, verify against the world. A torn line is never repaired; a
`correction` entry names the damaged `seq`.

**Absent, empty or stale.** No ledger, an empty one, or a last entry older than the
current step's cutoff means: disable both tasks, page, open a new attempt whose
first entry records what was found (ACT-70).

**One instance.** A lock file in the activation state root holds pid and start
time. An invocation that finds a live pid appends one `note` and exits; a lock
whose pid is gone is taken over by an entry that says so. `withMutex`
(`src/shell/epoch-store.ts`) is deliberately not reused: it blocks indefinitely and
records no pid.

**Secrets.** Never a ping URL, never a check UUID (it *is* the ping credential),
never an API key, never a full account id — checks by name and `hc:` fingerprint,
accounts by masked id.

**Reading it.** `status` prints the fold — phase, last completed step, last
observations — and then the verification the reader must run, because observations
age.

## 5. Steps

Each step is a pure decision (`ledger + observations → action | abort | wait`) in
its own invocation, idempotent, and each carries a **`not valid after`**: an
invocation that arrives late does not act; it aborts and records why.

| Step | Runs at | Not valid after | Precondition | Action |
|---|---|---|---|---|
| `0-preflight` | before step 2 | — | §3 unchanged; free disk; lock taken; no duplicate key in `.env`; the alert path exercised with its three fingerprints recorded; the cycle wrapper's SHA-256 recorded; gate condition 4 (alert receipt **and** a received reminder) present as a human confirmation | remove the `PRE_ARM_CERTIFICATE` line from `.env` (replace in place, re-read, re-hash) and record that it is gone |
| `1-install` | Sun/Mon, elevated | before step 2 | build is current | re-register both tasks through `install-scheduled-task.ps1 -CoverageThroughDate 2026-12-16`, then `verify-scheduled-tasks.ps1` must print `SCHEDULER CHECK PASSED`; record both action lines verbatim, so the ledger proves the cycle task now runs the wrapper |
| `0-resume` | every invocation | — | — | read both task **definitions and** states, all three check states, `.env` (hash, whether `PRE_ARM_CERTIFICATE` is set, `ALPACA_PROFILE`), the resolved account id (masked), both digests, the wrapper hash, the pending flag; world beats ledger, and every conflict is recorded; an unexpected `Enabled`, an unexpected certificate line or a profile other than `competition` is **red**: disable both tasks, page (ACT-26, ACT-57) |
| `2-certificate` | Mon, from 15:35 | 22:40 | a certificate file, verdict PASS, whose `runtimeDigest` and `policyDigest` equal this deployment's — obtained by running `certificate-cli --preflight` under the dev profile, which prints both (the policy digest is identical across profiles) | validate only |
| `3-flat` | after 2 | 22:45 | dev account read-only: zero positions, zero non-terminal orders | validate only; never cancel or close anything |
| `4-enable` | Mon, 22:05–22:40 | 22:40 | US session closed; both tasks `Disabled` **and** carrying the verified definitions from step 1; `PRE_ARM_CERTIFICATE` absent; profile `competition` | write the pending flag into `STATE_DIR`, enable both tasks, register the disarm one-shot |
| `5-drill-watchdog` | Mon, 22:15–22:50 | 22:50 | an observed firing after the enable; the management API answers a read the drill does not touch | disable the watchdog task only; wait until the API shows **exactly** `{gbt-watchdog}` down with its flip timestamp inside the drill window; re-enable; wait until up |
| `6-drill-silence` | Mon, 22:50–23:15 start | 00:30 | watchdog check up; API reachable; the last observed ping **T ≤ 23:15** (readiness falls at the next quarter hour + 50 min, so a later T cannot complete before the cutoff) | disable both tasks after an observed ping; wait until all three are down with their flip timestamps; then **send one success ping to each of the three endpoints**, which clears both the down state and any pause; leave both tasks disabled |
| `7-rearm` | anchor day, 13:50 | **13:59** | steps 2–6 `ok`; step 8 `ok`; `LastBootUpTime` later than step 8's intent; §3 unchanged; pending flag present; wrapper hash unchanged | enable both tasks |
| `8-reboot` | anchor day, 13:30 | 13:45 | steps 2–6 `ok` | write the intent line, then restart |
| `9-proof` | anchor day, 14:05 | 14:35 | — | a `run:` or `skip:` line whose UTC stamp converts to 14:00–14:04 local, searched in `cycle-run.log` **and** `cycle-run.log.1`, with both file names and the converted window recorded; session state sampled at 13:55 and 14:05; `LastBootUpTime` recorded |
| `10-gate` | anchor day, 14:35 | 14:55 | the conjunction in §7 | **write `PRE_ARM_CERTIFICATE` into `.env`** (replace in place, never append; re-read, re-check duplicates, re-hash), then delete the pending flag and the disarm one-shot |
| `11-anchor` | anchor day, 15:20 | 16:00 | — | record the firing whose stamp converts to **15:15–15:19** local — a later catch-up is not the anchor — and the `BOOTSTRAP` entry; the measurement period started |

Steps 7 and 8 are ordered by clock: reboot 13:30, re-arm 13:50.
**Every abort disables both tasks, leaves `PRE_ARM_CERTIFICATE` unset, and pages.**

**The invocation mechanism.** One task, `GlassBoxTrading-Activation`, RunLevel
Highest, S4U, `StartWhenAvailable = true`, `MultipleInstances = IgnoreNew`, with two
triggers: Monday 15:30 repeating every 5 minutes for 9h15m, and the anchor day
13:25 repeating every 5 minutes for 2h40m. Deadlines in the table, not the trigger,
decide what a late invocation may do.

**Retry on the next trading day.** A new attempt re-runs `0-resume`, then continues
from the first step whose result is not `ok`. Before it may act it must undo what
the aborted attempt left: the pending flag stays (it is harmless and still needed),
the disarm one-shot must be **re-registered** for the new anchor day (its old
trigger has passed and will never fire again), both tasks must read `Disabled`, the
three checks must read `up` or be brought there by a success ping, and the
certificate is re-validated against freshly printed digests — a certificate from a
previous day is acceptable, a changed digest is not. `FLATTEN_DATE` does **not**
move: the owner fixed the end date on 2026-09-11, so a slip shortens the run and
needs no new certificate. Only a certificate that itself failed requires a new run.

## 6. The latch: permission is granted once, by the mechanism that already enforces it

- **`PRE_ARM_CERTIFICATE` stays out of `.env` from step 0 until step 10.** A
  competition runtime cannot arm without a certificate matching both digests.
  Nothing the activation fails to do can produce permission.
- **Writing it is digest-neutral**: it is one of three `deployment`-classified
  fields (`src/core/certificate.ts:41`), and only `policy` fields enter the policy
  digest.
- **No firing before the gate reaches the runtime — once the tasks are the ones
  step 1 installs.** The wrapper invokes `agent-cli.js` only inside the session
  plus a 20-minute lead-in; outside it runs `readiness-cli.js`, pings liveness and
  exits (`tools/cycle-run.ps1:236-256`). Drill firings and the 14:00 firing are all
  outside the session; the first firing that reaches the runtime is 15:15, after
  the gate at 14:35. **With the registration currently on the host this is false**
  (§3), which is why step 1 exists and step 4 checks the definition, not just the
  state.
- **The watchdog cannot write either.** `assessStaleness` returns `quiet` outside
  the session and on a journal with no authoritative entry
  (`src/core/lifecycle.ts:745-746`); `runWatchdog` returns on quiet before
  acquiring authority (`src/shell/watchdog.ts:110-111`); the wrapper passes the
  real session window (`tools/watchdog-run.ps1:224-227`).
- **The pending flag, honestly described.** It lives in `STATE_DIR` — the one root
  the wrapper already resolves and already fails closed on. It does not withhold
  permission. It exists for the state §3 found and step 0 removes: if a stale or
  half-written certificate line ever coexists with an in-session firing during an
  aborted activation, the runtime would read the broker and then halt with a
  credential fence in a journal that should start empty. With the key absent, that
  path cannot occur, and the flag's remaining job is to turn any unexpected
  in-session firing into a logged refusal. **The refusal is not silent**: the
  wrapper takes the same exit as a session skip — liveness success, readiness
  reported, one log line naming the flag — so the drills and step 9 still see what
  they measure, and an unnoticed flag cannot fell a check.
- **The disarm one-shot** is the third layer: Highest, S4U, `StartWhenAvailable`,
  firing at **15:05** on the anchor day, disabling both tasks unless the ledger
  shows a green gate, and disabling them when the ledger is unreadable.
- **The wrapper is hashed** at step 0 and re-checked at the gate: `tools/*.ps1` is
  outside the runtime digest, outside the architecture gate and untouched by the
  test suite, so the file carrying the refusal has no gate of its own.

## 7. The gate, stated as a conjunction

Green means all of: `SCHEDULER CHECK PASSED` with both tasks enabled and zero
failed checks (the count is recorded, not compared — `-ExpectEnabled` adds checks,
so the installation figure is not the same number); the cycle task's
`-SkipOutsideSession` and `-SessionLeadInMinutes` absent or at their defaults,
asserted by value; `ALPACA_PROFILE` reads `competition` and the resolved account id
matches the long-run account; **both digests re-printed at gate time still equal the
certificate's**; the three checks `up` in a stable observation, with bounded
backoff — a 429, a 5xx or an unreachable API is `unknown`, and unknown is red; step
8 `ok` with `LastBootUpTime` later than its intent; step 9 satisfied; the wrapper
hash unchanged.

## 8. Reconciliation with the cold catalogue

1. **ACT-08.** The lead-in lives in the wrapper and decides only whether node is
   invoked; the core vetoes entries while `now < opensAt`
   (`src/core/decision.ts:216`). The **15:15 firing is the anchor**; the first
   firing that can open a position is 15:30.
2. **ACT-09.** `.env` is not digest-neutral as a file — `ANALYST_MODEL` is a policy
   field — but the line the script writes is.
3. **ACT-11.** Step 0's hardest precondition, and as of 2026-09-12 **not yet
   satisfied**: the recurring reminder had never been switched on; its first
   arrival completes it.
4. **ACT-19, invariant 12.** Revision 2 left the checks paused overnight; revision
   3 said "resume through the API", which neither the tool offers nor would help,
   because after the drill they are **down**, not paused — thirteen hourly reminder
   mails and a dead man already on the floor at the anchor morning. Step 6 now
   sends one success ping per endpoint, which clears both states.
5. **ACT-26, ACT-57.** An unexpected enabled task, an unexpected certificate line
   and a profile other than `competition` are red conditions in `0-resume`.
6. **ACT-25.** The digests are re-validated at the gate, not only on Monday.
7. **ACT-32, ACT-36.** Step 9's window is 14:00–14:04 and step 11's is 15:15–15:19;
   a catch-up satisfies neither.
8. **ACT-41.** The trigger window is 14:00–23:45, the session comes from the
   exchange calendar, and an anchor in 2026-10-26..30 is forbidden anyway.
9. **ACT-53.** The certificate waits by design for a human checkpoint (§10); the
   script's own wait for the artefact ends at 22:40, which is also the last moment
   the owner's `CLEAR-HALT` can still produce a usable certificate.
10. **Declared loss — the powered-off drill.** A script cannot switch the machine
    back on, so step 6 proves the weaker "both tasks disabled" silence. The
    scenarios that stay unproven by name: **ACT-20** (reboot issued, machine does
    not return), **ACT-33** (hang at an update screen), **ACT-38** (power cut) —
    all three rest on "a dead machine alarms", which now rests on the cron
    schedules and graces alone until the owner runs the real drill on an evening
    after 22:00.
11. **ACT-12 / the runbook's acceptance check.** The pending flag makes
    `Get-ChildItem <STATE_DIR>` non-empty, which the runbook's fresh-deployment
    check expects to be empty. Named here so the next reader does not treat it as
    contamination.

## 9. Where the code lives

`ops/activation/`, outside the certified digest: the digest covers `src/`, `dist/`,
`tools/*.mjs|py`, `config/*.json`, `assets/**` and the package and tsconfig files,
so code placed there would void the certificate the moment it is fixed — and the
first execution is also its first real test. Node 24 runs the TypeScript directly,
so there is no build output either. The pure core lives in `ops/activation/core/`;
covering it with the architecture gate needs a second root in
`tools/check-core-architecture.mjs`, which is a change inside the digest and must
land **before** the certificate run. The digests themselves are never recomputed by
hand: `certificate-cli --preflight` prints both, and that is what the script
compares (there is no other entry point that exposes them).

## 10. The open decision

**The certificate's human checkpoint.** Every certificate run provokes a 401 on
purpose, halts `AUTH_FAILURE`, and waits — heartbeating, without a timeout
(`src/shell/certificate-run.ts:109-129`) — for a human to type `CLEAR-HALT <seq>`
(`src/shell/certificate-cli.ts:70-81`). A task with no logged-on session cannot
answer it. Either the owner starts the run on Monday evening and answers the prompt
by **22:30** (the wait is unbounded, but step 2 needs the artefact by 22:40), or the
script answers it under the pre-authorisation, which needs a change in `src/` and
turns a human judgement into a condition. This spec assumes the first.

## 11. What the three rounds changed

- **Round 1 (revision 1, A=5 B=12 C=2).** Nothing restarted the script after its own
  reboot; the disarm task shared fate with what it guarded; the drill left the
  deployment armed with all three checks paused; "nobody was logged on" was not
  observable; the drill could not tell a drill from an outage.
- **Round 2 (revision 2, A=4 B=9 C=3).** The fixes had the same shape as what they
  replaced: a file whose absence meant permission, on a path the wrapper never
  resolves; only two steps had deadlines; a skipped reboot still produced a green
  gate. → Revision 3 made the certificate path itself the latch.
- **Round 3 (revision 3, A=4 B=11 C=3).** The latch held against every attack and
  all four of its load-bearing code facts were confirmed independently. What failed
  was the spec's picture of the world: the registered task bypasses the wrapper
  (→ step 1 and a definition check in step 4), the certificate key is present and
  stale (→ step 0 removes it), the profile is never observed (→ `0-resume` and §7),
  and "resume the checks through the API" was not a capability (→ success pings).
  Deadlines were corrected where they contradicted the detection arithmetic (step 6
  needs T ≤ 23:15) or the evidence they depend on (re-arm must precede the 14:00
  firing, so 13:59). Added: the invocation mechanism, the retry procedure, the
  digest re-validation at the gate, and the named scenarios that the declared loss
  leaves unproven.
