# P12 activation — specification

The activation script turns the owner's pre-authorisation into an executed
sequence: certificate, enable, drills, reboot, gate, anchor. It exists because
the two steps that used to need a person — the cold-start proof at 13:50 and the
supervised first cycle at 15:15 — fall on weekday afternoons the owner cannot
plan around, and because every one of those steps is decidable from observations
rather than from judgement.

Its yardstick is [`P12-ACTIVATION-SCENARIOS.md`](P12-ACTIVATION-SCENARIOS.md),
derived by an agent that was not allowed to read this repository. Section 8
resolves every place where that catalogue and this deployment disagree.

**Revision 3.** Revision 1 was reviewed blind (NO-GO, A=5 B=12 C=2) and revision 2
counter-verified (NO-GO, A=4 B=9 C=3). Section 10 carries both verdicts and what
each changed. Revision 3 is not a third patch at the same seam: the counter-review
showed that revisions 1 and 2 were the same shape — a deployment that may trade by
default, guarded by something the activation has to do correctly — so the arming
latch is now a mechanism that already exists, is certified, and fails closed on
its own. One decision is still open; see section 9.

---

## 1. What the script is, and what it is not

It is an **operator**, not a trading component. It starts nothing that can place
an order by itself; it hands the deployment its permission to trade, and only
after the three conditions the owner named are observed to hold:

> **Armed only on PASS, a flat dev account, and a green gate.**
> (Owner ruling 2026-09-11, DECISIONS.)

It is not a supervisor of the three-month run. Once the anchor cycle has fired and
the gate has been recorded, the script's job is finished; the watchdog, the three
checks and the weekly review carry the run from there.

**It is not a long-lived process.** Step 7 reboots the machine, so every step is a
separate short invocation that reconstructs the phase from the ledger plus the
world and then does one thing.

## 2. Axioms

The catalogue's seventeen invariants are adopted as written. Five consequences
carry the design:

- **A1 — Unknown is never green.** An unreachable API, a tool that did not run, a
  log line that could not be found and a step that timed out are all failures.
- **A2 — Every exit is safe.** No path — crash, power cut, double invocation,
  permission error — may end with the deployment able to trade unvalidated.
- **A3 — Observe, don't assume.** Task states, check states, `.env`, both digests
  and the wrapper's own hash are read from the world before every decision; on
  conflict the world wins and the conflict is recorded.
- **A4 — The record is the only memory.** Intent before the action, result after
  it, append-only. A later session establishes the phase from the record *plus* a
  verification query, never from the record alone.
- **A5 — Permission is a thing the script must grant, never a thing it must
  prevent.** No step may make *absence* — of a file, of a timer, of a step — mean
  "may trade". §6 is the whole of it.

## 3. Measured preconditions of this host

Read on 2026-09-12; step 0 re-reads each and refuses to start if any has changed.

| Precondition | Measured value | Scenario |
|---|---|---|
| Sleep on AC | `STANDBYIDLE` AC index `0x0` — never | ACT-34 |
| Hibernate on AC | `HIBERNATEIDLE` AC index `0x0` — never | ACT-34 |
| Fast startup | `HiberbootEnabled = 0` — a restart is a real restart | ACT-34 |
| Windows Update active hours | 09:00–03:00, so no automatic restart during the drills | ACT-31 |
| Task definition ACL | `felix`: read only; `Administrators`: full control | ACT-42 |
| Account rights | `felix` is in the local Administrators group; an ordinary shell is not elevated | ACT-42 |
| Reboot right | `SeShutdownPrivilege` present in the token | ACT-06 |
| Auto-logon | `AutoAdminLogon = 0` | ACT-06 |
| ARSO | **active** (`AutoLogonSID` and `LastUsedUsername` set, empty exclusion list — those are the markers, not a switch, so `plausibel`). It would re-create a session after the restart and take the meaning out of step 8, so the elevated registration step sets `DisableAutomaticRestartSignOn = 1` | ACT-06, ACT-35 |
| Session detection | `quser` does not exist on Windows 11 Home; `Win32_LogonSession` (types 2, 10, 11) and the presence of an `explorer` process do | ACT-35 |
| Node | v24.9.0, runs `.ts` directly, including relative `./x.ts` imports | §9 |

**Consequence for the task principal:** the activation task runs at **RunLevel
Highest**, logon type **S4U**, user `felix`. Ordinary rights cannot change a task
definition on this host, so an unprivileged activation would fail exactly at the
enable step. Registering it needs one elevated shell, once.

## 4. The ledger

**Location:** `C:\Users\felix\glass-box-state\activation-1\ledger.jsonl`.

**Format:** one JSON object per line, UTF-8, LF, appended with `fsync`, fields
`seq` (monotonic), `at` (ISO 8601 with offset), `attempt`, `step`, `kind`
(`intent` | `result` | `observation` | `correction` | `abort` | `note`),
`outcome` (`ok` | `failed` | `already_in_target_state` | `unknown`), `evidence`,
`next_owner_action`.

**Integrity.** A `seq` gap, a torn final line and a non-monotonic `at` all mean
the same to a reader: the state is unknown, verify against the world. A torn line
is never repaired; a `correction` entry names the damaged `seq`.

**Absent, empty or stale.** No ledger, an empty one, or a last entry older than
the current step's own cutoff means: disable both tasks, page, open a new attempt
whose first entry records what was found (ACT-70).

**One instance.** A lock file in the activation state root holds the pid and the
start time. An invocation that finds a live pid appends one `note` and exits; a
lock whose pid is gone is taken over by an entry that says so. The repository's
`withMutex` (`src/shell/epoch-store.ts`) is deliberately **not** reused: it blocks
indefinitely on collision and records no pid, which is neither of the two things
this needs (counter-review B5).

**Secrets.** Never a ping URL, never a check UUID (it *is* the ping credential),
never an API key, never a full account id — checks by name plus `hc:` fingerprint,
accounts by masked id.

**Reading it.** `status` prints the fold — phase, last completed step, what the
ledger last observed — and then the verification the reader must run, because an
observation ages.

## 5. Steps

Each step is a pure decision (`ledger + observations → action | abort | wait`)
executed by a thin shell, each in its own invocation, each idempotent. **Every
step carries a `not valid after`**: an invocation that arrives late does not act,
it aborts and records why (counter-review A2).

| Step | Runs at | Not valid after | Precondition | Action |
|---|---|---|---|---|
| `0-preflight` | before step 1 | — | §3 unchanged; free disk; lock taken; no duplicate key in `.env`; alert path exercised and its three fingerprints recorded; the cycle wrapper's SHA-256 recorded; gate condition 4 (alert receipt **and** a received reminder) present as a human confirmation | none |
| `0-resume` | every invocation | — | — | read both task states, all three check states, `.env` (hash **and** whether `PRE_ARM_CERTIFICATE` is set), both digests, the wrapper hash, the pending flag; where the world contradicts the ledger, record it and believe the world; if the phase is not unambiguous: disable both tasks, page |
| `1-certificate` | Mon, from 15:35 | 21:30 | a certificate file, verdict PASS, whose `runtimeDigest` **and** `policyDigest` equal this deployment's, recomputed now | validate only |
| `2-flat` | after 1 | 21:45 | dev account read-only: zero positions, zero non-terminal orders | validate only; never cancel or close anything |
| `3-enable` | Mon, after 22:05 | 22:40 | US session closed; both tasks `Disabled`; `PRE_ARM_CERTIFICATE` **not** set (§6) | write the pending flag into `STATE_DIR`, then enable both tasks, then register the disarm one-shot |
| `4-drill-watchdog` | Mon, 22:15–23:15 | 23:15 | an observed firing after the enable; the management API answers a read the drill does not touch | disable the watchdog task only; wait until the API shows **exactly** `{gbt-watchdog}` down, its flip timestamp inside the drill window; re-enable; wait until up |
| `5-drill-silence` | Mon, from 23:15 | 00:30 | watchdog check up again; API reachable | disable both tasks after an observed ping; wait until all three are down with their flip timestamps; **resume all three through the API**; leave both tasks disabled |
| `6-reboot` | anchor day, 13:30 | 13:45 | steps 1–5 `ok` | write the intent line, then restart |
| `7-rearm` | anchor day, 13:50 | **14:30** | steps 1–5 `ok`; step 6 `ok`; `LastBootUpTime` later than step 6's intent; §3 unchanged; pending flag present; wrapper hash unchanged | enable both tasks |
| `8-proof` | anchor day, 14:05 | 14:35 | — | a `run:` or `skip:` line whose UTC stamp converts to 14:00–14:04 local, searched in `cycle-run.log` **and** `cycle-run.log.1` with both file names and the converted window recorded; session state sampled at 13:55 and 14:05; `LastBootUpTime` recorded |
| `9-gate` | anchor day, 14:35 | 14:55 | the conjunction in §7 | **write `PRE_ARM_CERTIFICATE` into `.env`** (replace that one line in place, never append; re-read, re-check for duplicates, hash), then delete the pending flag and the disarm one-shot |
| `10-anchor` | anchor day, 15:20 | 16:00 | — | record the 15:15 firing and the `BOOTSTRAP` entry; the measurement period started |

Any abort disables both tasks, leaves `PRE_ARM_CERTIFICATE` unset, and pages.

## 6. The latch: permission is granted once, by the mechanism that already enforces it

Revisions 1 and 2 both guarded an armed default — first with a timer, then with a
file whose **absence** meant "may trade". Revision 3 removes the class: the
deployment cannot trade until the activation grants permission, and the grant is
the one the runtime already checks.

- **`PRE_ARM_CERTIFICATE` stays out of `.env` until step 9.** A competition
  runtime refuses to arm without a certificate that matches both digests
  (`src/shell/arming-gate.ts`, `src/core/certificate.ts`). Nothing the activation
  fails to do can produce permission; only the write at the green gate can.
- **Writing it is digest-neutral.** `PRE_ARM_CERTIFICATE` is classified
  `deployment` (`src/core/certificate.ts:41`) — one of three such fields, together
  with `STATE_DIR` and `BOOTSTRAP_DIAGNOSTIC_SINK`; the policy digest is unmoved,
  so the certificate stays valid (counter-review B4).
- **No firing before the gate can even reach the runtime.** The cycle wrapper
  invokes `agent-cli.js` only inside the session plus a 20-minute lead-in; outside
  it, it runs `readiness-cli.js`, pings liveness and exits
  (`tools/cycle-run.ps1:236-256`). Every drill firing on Monday night and the
  14:00 firing on the anchor day are outside the session, so the missing
  certificate cannot even produce a refusal entry. The first firing that reaches
  the runtime is 15:15, after the gate at 14:35.
- **The watchdog cannot write either.** `assessStaleness` returns `quiet` outside
  the session and `quiet` on a journal with no authoritative entry
  (`src/core/lifecycle.ts:745-746`), and `runWatchdog` returns on quiet before it
  acquires authority (`src/shell/watchdog.ts:111`). The wrapper passes the real
  session window (`tools/watchdog-run.ps1:224-227`).
- **The pending flag stays, demoted.** `activation-pending.flag` now lives in
  `STATE_DIR` — the one root the wrapper already resolves and already fails closed
  on (`tools/cycle-run.ps1:176-188`) — and the wrapper checks it *after* the
  session test, immediately before invoking node, so readiness still reports on
  every path and the drills still see their `skip:` lines (counter-review A1, B3).
  Its job is no longer to withhold permission; it is to turn a stray in-session
  firing during an aborted activation into a clean logged refusal instead of a
  `CONFIG_INVALID` halt with a credential fence in a journal that should start
  empty. Losing it costs a loud halt, not a trade.
- **The disarm one-shot stays as the third layer**: RunLevel Highest, S4U,
  `StartWhenAvailable`, firing at **15:05** on the anchor day — after the gate's
  own deadline and before the first in-session firing at 15:10 — disabling both
  tasks unless the ledger shows a green gate, and disabling them when the ledger
  is unreadable.
- **The wrapper is hashed.** `tools/*.ps1` is outside the runtime digest, outside
  the architecture gate and untouched by the test suite, so the one file carrying
  the refusal has no gate of its own. Step 0 records its SHA-256 and step 9
  re-checks it (counter-review B9).

## 7. The gate, stated as a conjunction

Green means all of: the verifier prints `SCHEDULER CHECK PASSED` with both tasks
enabled and **zero failed checks** — the count is recorded, not compared, because
`-ExpectEnabled` adds checks and the installation run has both tasks disabled
(counter-review B1); the cycle task's `-SkipOutsideSession` and
`-SessionLeadInMinutes` are absent or at their defaults, asserted by value
(counter-review B2); the three checks report `up` in one stable observation; step 6
is `ok` and `LastBootUpTime` is later than its intent; step 8 is satisfied; the
wrapper hash is unchanged. Any sub-condition that is merely unknown makes the gate
red (A1).

## 8. Reconciliation with the cold catalogue

1. **ACT-08.** The 20-minute lead-in lives in the wrapper and decides only whether
   node is invoked; the decision core vetoes every entry candidate while
   `now < opensAt` (`src/core/decision.ts:216`). The **15:15 firing is the anchor**
   — the first firing that runs a cycle and the start of the measurement period —
   while the first firing that can open a position is 15:30.
2. **ACT-09.** `.env` is not digest-neutral as a file: `ANALYST_MODEL` is read from
   the environment (`src/shell/runtime-config.ts:73`) and classified `policy`
   (`src/core/certificate.ts:66`). Three fields are classified `deployment`, and
   the one the script writes is among them. Step 1 recomputes both digests on every
   attempt.
3. **ACT-11.** Step 0's hardest precondition, and as of 2026-09-12 **not yet
   satisfied**: the recurring reminder had never been switched on, and its first
   arrival completes it.
4. **ACT-19 / invariant 12 — blindness is time-boxed.** Revision 2 left the three
   checks paused from 00:20 to 14:00; the counter-review called that a fourteen-hour
   hole with nobody present to end it. Step 5 now resumes them through the API as
   soon as the drill evidence is in the ledger. The crons expect no ping between
   23:45 and 14:00, so the night stays quiet, and a missing 14:00 firing fells
   liveness at 14:30 — the dead man is armed for the anchor morning again.
5. **ACT-34 / ACT-31.** Measured; see §3.
6. **ACT-41.** The trigger window is 14:00–23:45, the session comes from the
   exchange calendar, and an anchor in 2026-10-26..30 is forbidden anyway.
7. **ACT-53.** The certificate *waits by design* for a human checkpoint (§9); the
   catalogue's hard timeout applies to the script's wait for the artefact (21:30).
8. **Declared loss — the powered-off drill (counter-review B7).** The runbook's
   drill (c) switches the host off, which proves the alert path does not depend on
   the machine it reports about. A script cannot switch the machine back on, so
   step 5 proves the weaker "both tasks disabled" silence instead. This is a
   deliberate reduction, not an oversight: the owner can run the real machine-off
   drill on any evening after 22:00 in the first week, and until he does, the claim
   "a dead machine alarms" rests on the cron schedules and graces alone.

## 9. The open decision, and where the code lives

**Open: the certificate's human checkpoint.** Every certificate run provokes a 401
on purpose, halts `AUTH_FAILURE`, and waits — heartbeating, without a timeout
(`src/shell/certificate-run.ts:109-129`) — for a human to type `CLEAR-HALT <seq>`
on stdin (`src/shell/certificate-cli.ts:70-81`). A task with no logged-on session
cannot answer it. Either the owner starts the run on Monday evening and answers the
prompt whenever he passes the machine (the wait is unbounded, so this costs two
short interactions), or the script answers it under the pre-authorisation, which
needs a change in `src/` and turns a human judgement into a condition. This spec
assumes the first; step 1 validates an artefact it did not produce.

**Location: `ops/activation/`, outside the certified digest.** The digest covers
`src/`, `dist/`, `tools/*.mjs|py`, `config/*.json`, `assets/**` and the package and
tsconfig files, so code placed there would void the certificate the moment it is
fixed — and the first execution of this script is also its first real test. Node 24
runs the TypeScript directly, so there is no build output either. The pure core
lives in `ops/activation/core/`; covering it with the architecture gate requires
giving `tools/check-core-architecture.mjs` a second root, which is a change inside
the digest and must land **before** the certificate run.

## 10. What the two reviews changed

**Blind review of revision 1 — NO-GO, A=5 B=12 C=2.** Nothing restarted the script
after its own reboot; the disarm task shared fate with what it guarded; the silence
drill left the deployment armed with all three checks paused; "nobody was logged
on" was not observable from the wrapper log; the silence drill could not tell a
drill from a network outage. Revision 2 answered with separate invocations, a
pending flag, a drill ending disabled, session sampling, and an independent API
read plus flip timestamps.

**Counter-verification of revision 2 — NO-GO, A=4 B=9 C=3.** The fixes were the
same shape as what they replaced: *A1* the flag's absence meant permission and its
path was one the wrapper never resolves; *A2* only two steps had deadlines, so a
catch-up invocation could re-arm at 15:40, inside the session; *A3* a skipped or
failed reboot still produced a green gate, because step 7 was not in the
conjunction and boot time was never read; *A4* the checks stayed paused for
fourteen unattended hours. Revision 3 answers them at the root (§6), with
deadlines on every step (§5), boot time and step 6 in the gate (§7), and an API
resume at the end of the drill (§8.4). Folded in as well: B1 (count recorded, not
compared), B2 (wrapper parameters asserted by value), B3 (where the flag check
sits), B4 (three deployment fields), B5 (own lock file, not `withMutex`), B6 (gate
at 14:35, disarm at 15:05), B8 (both log files and the converted window), B9 (the
wrapper's hash), C1–C3 (the lock in one place, the pause's own flip distinguished
from a drill down, the duplicate-key check repeated at the write).

**Still open from the counter-review:** B7, the powered-off drill, declared as a
loss in §8.8 rather than replaced.

**B11 from the blind review — two normative documents.** This spec supersedes the
manual sequence in `P12-RUNBOOK.md` §6 and §7 for the activation itself; the
runbook keeps everything else, including the incident paths and the clock rules.
The supersession is written into the runbook when the code lands, not before — an
unimplemented spec must not disable a procedure that still works by hand.
