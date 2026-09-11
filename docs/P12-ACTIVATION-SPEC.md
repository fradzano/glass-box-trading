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

**Status: draft, and one decision is open** — see section 9.

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

## 2. Axioms

The catalogue's seventeen invariants are adopted as written and are not restated
here. Four consequences carry most of the design:

- **A1 — Unknown is never green.** An unreachable API, a tool that did not run, a
  log line that could not be found and a step that timed out are all failures. No
  step may conclude from the absence of a signal.
- **A2 — Every exit is safe.** No path — crash, power cut, double invocation,
  permission error — may end with the cycle task enabled but unvalidated. A
  failed disable is itself an A-class event and must page.
- **A3 — Observe, don't assume.** Task states, check states, `.env` and the
  digests are read from the world before every decision; on conflict the world
  wins and the conflict is recorded.
- **A4 — The record is the only memory.** Intent is written before the action and
  the result after it, append-only, one self-contained entry per line. A later
  session establishes the phase from the record *plus* a verification query, never
  from the record alone (A3).

## 3. Measured preconditions of this host

Read on 2026-09-12 and recorded here because the scenario catalogue asks for them
to be asserted rather than assumed (ACT-31, ACT-34, ACT-42, ACT-43). The script
re-reads each one at step 0 and refuses to start if any has changed.

| Precondition | Measured value | Scenario |
|---|---|---|
| Sleep on AC | `STANDBYIDLE` AC index `0x0` — never | ACT-34 |
| Hibernate on AC | `HIBERNATEIDLE` AC index `0x0` — never | ACT-34 |
| Fast startup | `HiberbootEnabled = 0` — off, so a restart is a real restart | ACT-34 |
| Windows Update active hours | 09:00–03:00, so no automatic restart during the drills | ACT-31 |
| Task definition ACL | `felix`: read only; `Administrators`: full control | ACT-42 |
| Account rights | `felix` is in the local Administrators group; an ordinary shell is not elevated | ACT-42 |
| Reboot right | `SeShutdownPrivilege` present in the token | ACT-06 |
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
| `evidence` | the raw material the decision rested on (exit codes, printed contract lines, check states with their own timestamps, digests, task states before and after) |
| `next_owner_action` | one sentence, present on every `abort` and on the last entry of an attempt |

**Integrity.** `seq` gaps, a torn final line and a non-monotonic `at` are all
detectable and all mean the same thing to a reader: treat the state as unknown and
verify against the world (A1, A3). A torn line is never repaired — a `correction`
entry is appended that names the damaged `seq` (ACT-39, ACT-67).

**Secrets.** Never a ping URL, never a check UUID (it *is* the ping credential),
never an API key, never a full account id. Checks appear as name plus `hc:`
fingerprint, accounts as their masked id (ACT-69, DECISIONS 2026-09-12).

**Reading it.** `status` prints the fold of the ledger — phase, last completed
step, what the ledger last observed as armed — followed by the verification the
reader must run, because an observation ages (ACT-65).

## 5. Phases

Each step is a pure decision (`ledger + observations → action | abort | wait`)
executed by a thin shell. Steps are idempotent: each one first reads the world and
records `already_in_target_state` where that is true (ACT-12).

| Step | Precondition | Action | Abort behaviour |
|---|---|---|---|
| `0-preflight` | host table in §3 unchanged; free disk; single instance; gate condition 4 (alert receipt **and** a received reminder) present in the record as a human confirmation | none | refuse, page, nothing armed |
| `1-certificate` | a certificate file exists with verdict PASS, `runtimeDigest` and `policyDigest` equal to this deployment's, and its window ends today | validate only | no PASS by the cutoff → nothing armed, page, retry next trading day |
| `2-flat` | dev account read-only: zero positions, zero non-terminal orders | validate only | page with the residue; never cancel or close anything (ACT-14) |
| `3-env` | `PRE_ARM_CERTIFICATE` absent or different | atomic write of one line, then re-read and hash | page; the record states whether `.env` is intact (ACT-15) |
| `4-enable` | after 22:05 local, US session closed, both tasks `Disabled` | enable both | page; a failed disable on rollback is its own A-class entry |
| `5-drill-watchdog` | an observed firing after the enable | disable watchdog only; wait for the API to show **exactly** `{gbt-watchdog}` down; re-enable; wait until up | page; the record names the drill window and the expected down-set (ACT-50, ACT-68) |
| `6-drill-silence` | watchdog check up again | disable both tasks after an observed ping; wait for all three down; pause all three; re-enable both tasks | page; never leave the checks paused past this step (ACT-19) |
| `7-reboot` | drills recorded, next trading day is the anchor day | write the intent line first, then restart | if nothing follows this entry, the machine did not come back (ACT-20) |
| `8-proof` | after 14:05 on the anchor day | the 14:00 firing exists in the wrapper log, written while nobody was logged on | a catch-up run does **not** satisfy it (ACT-32, ACT-36) |
| `9-gate` | 14:45 | scheduler verifier passes with `-ExpectEnabled`; all three checks up; step 8 satisfied | disable both tasks, page with the failing sub-condition |
| `10-anchor` | after 15:20 | record the 15:15 firing and the `BOOTSTRAP` entry | page; the measurement period is not recorded as started |

**The self-healing rule (ACT-17).** Between step 4 and step 9 the tasks are
enabled but not yet validated. The script therefore registers, at the moment it
enables them, a one-shot **disarm task** for 14:50 on the anchor day that disables
both tasks unless the ledger shows a green gate. A crash of the activation script
after step 4 then cannot leave a trading-capable deployment behind.

## 6. Actions the script may take

Enable and disable the two trading tasks; register and delete its own disarm
task; restart the machine; write one line to `.env`; pause and resume the three
checks; send a `/fail` ping to `gbt-readiness` with a reason; append to the
ledger. **Nothing else**, and in particular: no order, no cancel, no close, no
publication, no touch of the competition account (ACT-10, ACT-14, ACT-57).

Paging is one mechanism: a readiness `/fail` whose body names the step, the
failing condition and the owner's next action.

## 7. The gate, stated as a conjunction

Green means all of: the verifier printed `SCHEDULER CHECK PASSED` with both tasks
enabled; the three checks report `up` in one stable observation; the 14:00 firing
is in the wrapper log with the right UTC conversion and with no interactive
session at that moment; the ledger holds steps 1 to 6 as `ok`. Any sub-condition
that is merely unknown makes the gate red (A1).

## 8. Reconciliation with the cold catalogue

Where the catalogue's premise differs from this deployment, with the evidence:

1. **ACT-08 — "15:15 is pre-open, the first trading-capable cycle is 15:30".**
   Wrong for this deployment: the cycle's lead-in starts 20 minutes before the US
   open, so the **15:15 firing is the anchor** and may trade. The gate at 14:45
   therefore has 30 minutes of margin, not 45, and step 9 may not overrun.
2. **ACT-09 — "if `.env` is part of the digest input, order matters".** It is not:
   the runtime digest covers `src/**/*.ts`, `dist/**/*.js`, `tools/**/*.mjs|py`,
   `config/**/*.json`, `assets/**` and the package and tsconfig files
   (`src/shell/digests.ts`). `.env` is deployment configuration and never enters
   it. Writing the certificate path is therefore digest-neutral — which is what
   makes step 3 possible at all.
3. **ACT-11 — the human-confirmed alert receipt.** Adopted as written and made
   step 0's hardest precondition. As of 2026-09-12 it is **not yet satisfied**:
   the recurring reminder had never been switched on, and its first arrival is
   what completes it (DECISIONS 2026-09-11 23:54).
4. **ACT-34 — sleep and fast startup.** Measured, not assumed; see §3.
5. **ACT-41 — the DST mismatch week.** Already handled by the design: the trigger
   window is 14:00–23:45 and the session is derived from the exchange calendar,
   and an anchor inside 2026-10-26 to 10-30 is forbidden for a different reason
   (the first trading firing would precede the gate). The activation records the
   assumption; nothing else to do.
6. **ACT-43 — "enabled ≠ running".** Adopted: step 8 is what proves it, and the
   gate's verifier result alone never substitutes for it.
7. **ACT-53 — the certificate hang.** This deployment's certificate *waits by
   design*, without a timeout, for a human checkpoint — see §9. The catalogue's
   remedy (a hard timeout) applies to the script's own wait for the artefact, not
   to the certificate process.

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
`src/`, `dist/`, `tools/*.mjs|py`, `config/*.json` and the package files, so code
placed there would void the certificate the moment it is fixed — and the first
execution of this script is also its first real test, between the certificate and
the anchor, which is exactly when a fix must stay cheap. Node 24 runs the
TypeScript directly, so there is no build output to place anywhere either. The
pure core lives in `ops/activation/core/`, is gated like `src/core/`, and its
tests live with the repository's other tests.
