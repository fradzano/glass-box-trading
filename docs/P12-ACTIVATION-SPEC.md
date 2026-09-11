# P12 activation — specification

The activation script turns the owner's pre-authorisation into an executed
sequence: certificate, enable, drills, reboot, gate, anchor. It exists because
the two steps that used to need a person — the cold-start proof at 13:50 and the
supervised first cycle at 15:15 — fall on weekday afternoons the owner cannot
plan around, and because every one of those steps is decidable from observations
rather than from judgement.

Its yardstick is [`P12-ACTIVATION-SCENARIOS.md`](P12-ACTIVATION-SCENARIOS.md),
derived by an agent that was not allowed to read this repository. Section 8
resolves every place where that catalogue and this deployment disagree. Where the
catalogue is right and we were wrong, the design changes, not the catalogue.

**Revision 2**, after a blind adversarial review of revision 1 returned **NO-GO**
(A=5, B=12, C=2). Section 10 lists every finding and what was done with it. One
decision is still open — section 9.

---

## 1. What the script is, and what it is not

It is an **operator**, not a trading component. It starts nothing that can place
an order by itself; it enables the scheduled task that can, and only after the
three conditions the owner named are observed to hold:

> **Armed only on PASS, a flat dev account, and a green gate.**
> (Owner ruling 2026-09-11, DECISIONS.)

It is not a supervisor of the three-month run. Once the anchor cycle has fired
and the gate has been recorded, the script's job is finished; the watchdog, the
three checks and the weekly review carry the run from there.

**It is not a long-lived process.** Revision 1 assumed one process walking the
steps; step 7 reboots the machine that process runs on, so the assumption was
false by construction. Every step is therefore a separate, short invocation that
reconstructs the phase from the ledger plus the world and then does one thing.

## 2. Axioms

The catalogue's seventeen invariants are adopted as written and are not restated
here. Five consequences carry most of the design:

- **A1 — Unknown is never green.** An unreachable API, a tool that did not run, a
  log line that could not be found and a step that timed out are all failures. No
  step may conclude from the absence of a signal.
- **A2 — Every exit is safe.** No path — crash, power cut, double invocation,
  permission error — may end with the cycle task enabled but unvalidated. A
  failed disable is itself an A-class event and must page.
- **A3 — Observe, don't assume.** Task states, check states, `.env` and both
  digests are read from the world before every decision; on conflict the world
  wins and the conflict is recorded.
- **A4 — The record is the only memory.** Intent is written before the action and
  the result after it, append-only, one self-contained entry per line. A later
  session establishes the phase from the record *plus* a verification query, never
  from the record alone (A3).
- **A5 — Inert unless armed, never armed unless disarmed.** The deployment's
  default between the enable and the green gate is *cannot trade*, enforced by a
  file the wrapper checks, not by a timer that has to fire correctly (§6).

## 3. Measured preconditions of this host

Read on 2026-09-12 and recorded here because the scenario catalogue asks for them
to be asserted rather than assumed (ACT-31, ACT-34, ACT-42, ACT-43). Step 0
re-reads each one and refuses to start if any has changed.

| Precondition | Measured value | Scenario |
|---|---|---|
| Sleep on AC | `STANDBYIDLE` AC index `0x0` — never | ACT-34 |
| Hibernate on AC | `HIBERNATEIDLE` AC index `0x0` — never | ACT-34 |
| Fast startup | `HiberbootEnabled = 0` — off, so a restart is a real restart | ACT-34 |
| Windows Update active hours | 09:00–03:00, so no automatic restart during the drills | ACT-31 |
| Task definition ACL | `felix`: read only; `Administrators`: full control | ACT-42 |
| Account rights | `felix` is in the local Administrators group; an ordinary shell is not elevated | ACT-42 |
| Reboot right | `SeShutdownPrivilege` present in the token | ACT-06 |
| Auto-logon | `AutoAdminLogon = 0` | ACT-06 |
| Automatic restart sign-on (ARSO) | **active**: `AutoLogonSID` and `LastUsedUsername` are set under `Winlogon` and the ARSO exclusion list is empty (`plausibel` — those are the markers, not a switch). ARSO re-creates a session after a restart independently of auto-logon, which would take the meaning out of step 8, so the elevated registration step sets `DisableAutomaticRestartSignOn = 1` and step 0 re-reads it | ACT-06, ACT-35 |
| Node | v24.9.0, runs `.ts` directly, including relative `./x.ts` imports | §9 |

**Consequence for the task principal:** the script must run as a task with
**RunLevel Highest**, logon type **S4U**, user `felix`. Ordinary rights cannot
change a task definition on this host, so an unprivileged activation task would
fail exactly at the enable step, at 22:10, with everything else already done.
Registering that task needs one elevated shell, once.

## 4. The ledger

**Location:** `C:\Users\felix\glass-box-state\activation-1\ledger.jsonl` — beside
the trading state directories, not inside `longrun-1`: the journal's directory
belongs to the agent's own authority protocol and nothing else may write there.

**Format:** one JSON object per line, UTF-8, LF, appended with `fsync`. Fields:

| Field | Meaning |
|---|---|
| `seq` | monotonic integer, starts at 1, never reused |
| `at` | ISO 8601 with offset (local time and offset, so a reader needs no table) |
| `attempt` | attempt id — a new attempt starts a new id and references the previous abort |
| `step` | step id from section 5 |
| `kind` | `intent`, `result`, `observation`, `correction`, `abort`, `note` |
| `outcome` | for `result`: `ok`, `failed`, `already_in_target_state`, `unknown` |
| `evidence` | the raw material the decision rested on (exit codes, printed contract lines, check states with their own `last_ping` and flip timestamps, digests, task states before and after) |
| `next_owner_action` | one sentence, present on every `abort` and on the last entry of an attempt |

**Integrity.** `seq` gaps, a torn final line and a non-monotonic `at` are all
detectable and all mean the same thing to a reader: treat the state as unknown and
verify against the world (A1, A3). A torn line is never repaired — a `correction`
entry is appended that names the damaged `seq` (ACT-39, ACT-67).

**Absent, empty or stale.** No ledger, an empty one, or a last entry older than
the current step's own cutoff means: disable both tasks, page, open a new attempt
whose first entry records what was found. A world change without a ledger entry is
itself the signal that something ran unrecorded (ACT-70).

**One instance.** Every invocation takes the kernel-owned named-pipe mutex the
repository already uses for the epoch store (`src/shell/epoch-store.ts`), keyed by
the activation state root. A second instance appends one `note` entry naming the
live holder and exits without acting. A stale holder — the recorded pid is gone —
is taken over only by an entry that says so (ACT-28).

**Secrets.** Never a ping URL, never a check UUID (it *is* the ping credential),
never an API key, never a full account id. Checks appear as name plus `hc:`
fingerprint, accounts as their masked id (ACT-69, DECISIONS 2026-09-12).

**Reading it.** `status` prints the fold of the ledger — phase, last completed
step, what the ledger last observed as armed — followed by the verification the
reader must run, because an observation ages (ACT-65).

## 5. Steps

Each step is a pure decision (`ledger + observations → action | abort | wait`)
executed by a thin shell, and each runs as its own invocation. Steps are
idempotent: each one first reads the world and records `already_in_target_state`
where that is true (ACT-12).

| Step | Runs at | Precondition | Action | On failure |
|---|---|---|---|---|
| `0-preflight` | before step 1 | §3 table unchanged; free disk; mutex taken; no duplicate key in `.env`; alert path exercised and its three fingerprints recorded; gate condition 4 (alert receipt **and** a received reminder) present as a human confirmation | none | refuse, page, nothing armed |
| `0-resume` | every invocation | — | read both task states, all three check states, the `.env` hash, both digests; where the world contradicts the ledger, record it and believe the world | phase not unambiguous → disable both tasks, page |
| `1-certificate` | Mon, from 15:35 | a certificate file with verdict PASS whose `runtimeDigest` **and** `policyDigest` equal this deployment's, recomputed now | validate only | no PASS by 21:30 → nothing armed, page, retry next trading day |
| `2-flat` | after 1 | dev account read-only: zero positions, zero non-terminal orders | validate only | page with the residue; never cancel or close anything (ACT-14) |
| `3-env` | after 2 | `PRE_ARM_CERTIFICATE` absent or different | replace that one line in place (never append), re-read, hash | page; the record states whether `.env` is intact (ACT-15, ACT-59) |
| `4-enable` | Mon, after 22:05 | US session closed; both tasks `Disabled`; the **pending flag** written first (§6) | write the flag, then enable both tasks, then register the disarm one-shot | page; a failed disable on rollback is its own A-class entry |
| `5-drill-watchdog` | Mon, 22:15–23:15 | an observed firing after the enable; the management API answers a read the drill does not touch | disable watchdog only; wait for the API to show **exactly** `{gbt-watchdog}` down, with that check's own flip timestamp inside the drill window; re-enable; wait until up | page; an unreachable or throttled API is `unknown`, never a status (A1, ACT-45..49) |
| `6-drill-silence` | Mon, from 23:15 | watchdog check up again; API reachable | disable both tasks after an observed ping; wait for all three down with their flip timestamps; pause all three; **leave both tasks disabled** | page |
| `6b-rearm` | anchor day, 13:50 | steps 1–6 `ok`; pending flag present; §3 unchanged | enable both tasks | page; nothing armed |
| `7-reboot` | anchor day, 13:30 (before 6b) | steps 1–6 `ok` | write the intent line, then restart | if nothing follows this entry, the machine did not come back **or** the script was not restarted — verify both task states before concluding anything (ACT-20) |
| `8-proof` | anchor day, 14:05 | — | a `run:` or `skip:` line whose UTC stamp converts to 14:00–14:04 local; the session state sampled at 13:55 and 14:05 from `Win32_LogonSession` (logon types 2, 10, 11) and from the presence of an `explorer` process — `quser` does not exist on Windows 11 Home — and both recorded | a catch-up outside that window does **not** satisfy it (ACT-32, ACT-36); a session present at either sample makes the proof unavailable, not green (A1) |
| `9-gate` | anchor day, 14:45 | — | verifier passes with `-ExpectEnabled` and prints its contract line with the check count recorded at installation; all three checks up in a stable observation; step 8 satisfied; then **delete the pending flag** and the disarm task | disable both tasks, page with the failing sub-condition; exit 1 without a contract line is `unknown`, not `failed` (ACT-61) |
| `10-anchor` | anchor day, 15:20 | — | record the 15:15 firing and the `BOOTSTRAP` entry; the measurement period started | page; the measurement period is not recorded as started |

Steps 7 and 6b are ordered by clock, not by table position: the reboot is at
13:30 and the re-arm at 13:50, after the machine is back.

## 6. Inert unless armed

Between the enable (step 4) and the green gate (step 9) the trading tasks are
enabled but not validated. Revision 1 guarded that window with a one-shot disarm
task alone; a review showed that this defends an **armed** default with a
mechanism that shares its fate with the machine (a Windows-Update restart that
ends past 14:50 leaves a catch-up firing inside the session with no gate ever
evaluated).

The default is inverted instead:

- Step 4 writes `activation-pending.flag` beside the ledger **before** enabling
  anything. `tools/cycle-run.ps1` refuses to run a cycle while that file exists,
  logs the reason and still sends its liveness ping — so firings, pings and log
  lines continue, which is exactly what the drills and step 8 measure, while no
  cycle can trade. `tools/*.ps1` is outside the runtime digest
  (`src/shell/digests.ts` covers `tools/**/*.mjs|py`), so this change is
  digest-neutral and cannot void the certificate.
- Step 9 deletes the flag as the last act of a green gate. Deleting it is the
  arming act, and it happens only on the conjunction in §7.
- The disarm one-shot stays as a second layer, with RunLevel Highest, S4U and
  `StartWhenAvailable`, firing at 14:50 on the anchor day: it disables both tasks
  unless the ledger shows a green gate, and an unreadable ledger means disable.

In the steady three-month state the flag is absent and the wrapper behaves exactly
as certified; the mechanism adds no failure mode to the run it authorises.

## 7. The gate, stated as a conjunction

Green means all of: the verifier printed `SCHEDULER CHECK PASSED` with both tasks
enabled and with the same check count recorded at installation; both wrappers'
`-SkipOutsideSession` and `-SessionLeadInMinutes` are absent or at their defaults;
the three checks report `up` in one stable observation; the 14:00 firing is in the
wrapper log inside the 14:00–14:04 window, with the session state sampled around
it; the ledger holds steps 1 to 6b as `ok`. Any sub-condition that is merely
unknown makes the gate red (A1).

## 8. Reconciliation with the cold catalogue

1. **ACT-08 — "the first trading-capable cycle is 15:30".** The catalogue is
   right and revision 1 was wrong. The 20-minute lead-in lives in the wrapper and
   decides only whether node is invoked; the decision core vetoes every entry
   candidate while `now < opensAt` (`src/core/decision.ts:216`, verified here
   rather than taken on the review's word). So the **15:15 firing is the anchor** — the
   first firing that runs a cycle, and the start of the measurement period — while
   the first firing that can open a position is 15:30. Step 10 records the former
   and never claims the latter.
2. **ACT-09 — the digest and `.env`.** Revision 1 claimed `.env` never enters a
   digest. False: `ANALYST_MODEL` is read from the environment
   (`src/shell/runtime-config.ts:73`) and classified `policy`
   (`src/core/certificate.ts:66`), so it enters the **policy** digest. Only
   `PRE_ARM_CERTIFICATE` is classified `deployment`, which is what makes step 3
   digest-neutral. Step 1 therefore recomputes **both** digests on every attempt.
3. **ACT-11 — the human-confirmed alert receipt.** Step 0's hardest precondition.
   As of 2026-09-12 it is **not yet satisfied**: the recurring reminder had never
   been switched on, and its first arrival completes it.
4. **ACT-34 — sleep and fast startup.** Measured, not assumed; see §3.
5. **ACT-41 — the DST mismatch week.** Handled by the design: the trigger window
   is 14:00–23:45, the session comes from the exchange calendar, and an anchor
   inside 2026-10-26 to 10-30 is forbidden anyway. The activation records the
   assumption.
6. **ACT-43 — "enabled ≠ running".** Step 8 proves it; the verifier's result
   alone never substitutes for it.
7. **ACT-53 — the certificate hang.** This deployment's certificate *waits by
   design* for a human checkpoint (§9). The catalogue's remedy — a hard timeout —
   applies to the script's wait for the artefact (21:30 on Monday), not to the
   certificate process.

## 9. The open decision, and where the code lives

**Open: the certificate's human checkpoint.** Every certificate run provokes a
401 on purpose, halts `AUTH_FAILURE`, and waits — heartbeating, without a timeout
(`src/shell/certificate-run.ts:109-129`) — for a human to type `CLEAR-HALT <seq>`
on stdin (`src/shell/certificate-cli.ts:70-81`). A task running without a logged-on
session cannot answer it. Either the owner starts the run on Monday evening and
answers the prompt whenever he passes the machine (the wait is unbounded, so this
costs two short interactions), or the script answers it under the pre-authorisation,
which needs a change in `src/` and turns a human judgement into a condition. This
spec assumes the first; step 1 validates an artefact it did not produce. The second
would add a step `1a` and change nothing else.

**Location: `ops/activation/`, outside the certified digest.** The digest covers
`src/`, `dist/`, `tools/*.mjs|py`, `config/*.json`, `assets/**` and the package and
tsconfig files, so code placed there would void the certificate the moment it is
fixed — and the first execution of this script is also its first real test, between
the certificate and the anchor, which is exactly when a fix must stay cheap. Node 24
runs the TypeScript directly, so there is no build output to place anywhere either.
The pure core lives in `ops/activation/core/`; making the architecture gate cover it
requires giving `tools/check-core-architecture.mjs` a second root, which is a change
inside the digest and therefore has to land **before** the certificate run.

## 10. What the blind review changed

Revision 1 was reviewed against the catalogue and the code by an agent with no
stake in it. Verdict NO-GO, A=5 B=12 C=2. The three A-findings that mattered were
one defect seen three times — a long-lived process, an armed default, and a reboot
underneath both:

- **A1** nothing restarted the script after its own reboot, and the ledger's last
  line claimed the opposite → steps run as separate invocations, the activation
  task gets a recurring trigger across the anchor morning, and step 7's abort text
  names both possibilities.
- **A2** the disarm task shared fate with what it guarded → the pending flag in §6
  inverts the default; the disarm stays as a second layer with its rights,
  `StartWhenAvailable`, and "unreadable ledger means disable" stated.
- **A3** step 6 left the deployment armed and all three checks paused for thirteen
  hours, contradicting its own abort rule → step 6 now ends with both tasks
  disabled, and step 6b re-enables them at 13:50 on the anchor day, where the 14:00
  firing resumes the paused checks by itself.
- **A4** "nobody was logged on" was not observable from the wrapper log → the
  session state is sampled at 13:55 and 14:05 and recorded, and ARSO joins §3.
- **A5** the silence drill could not tell a successful drill from a network outage
  → the API must answer an independent read, and every down transition must carry
  its own flip timestamp inside the drill window.

Accepted and folded in: B1 (both digests, §8.2), B2 (§8.1), B3 (wrapper parameters
in the gate), B4 (replace, never append, plus the duplicate-key check), B5 (the
mutex), B6 (`0-resume`), B7 (the 14:00–14:04 window), B8 (contract line as
evidence, exit 1 without it is unknown), B9 (absent or stale ledger), B10 (alert
path exercised at step 0), B12 (the gate's second root, §9), C1 (`assets/**`), C2
(a cutoff for step 5).

**B11 — two normative documents.** Still open and deliberately so: this spec
supersedes the manual sequence in `P12-RUNBOOK.md` §6 and §7 for the activation
itself, and the runbook keeps everything else, including the incident paths and
the clock rules. The supersession is written into the runbook when the code lands,
not before — an unimplemented spec must not be allowed to disable the procedure
that still works by hand.
