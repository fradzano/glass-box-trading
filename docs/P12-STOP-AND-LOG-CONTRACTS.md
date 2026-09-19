# P12 — the stop contract and the wrapper log contract

Written 2026-09-19 on the owner's ruling of the same day, **before** the repair the
ruling authorises. Two mechanisms had each been patched twice and each time the defect
came back in a quieter form, so the run's own rule stopped further patching: a third
change needs a contract first, derived from what has to be true in the world, not from
what the code currently does.

These are behavioural axioms in the sense of `CONCEPT.md`'s build order — scenario,
axiom, spec, code. They are the yardstick for the repair and for its counter-verification,
and they are deliberately written where the code cannot reach them.

**Two owner decisions stand behind this document** (`DECISIONS.md`, 2026-09-19):

1. The abort mechanism gets the coherent third change it needs. No risk acceptance is
   granted for the known abort defects — R3-08, R3-09, R2-03 and the result losses that
   share their shape.
2. Residual W is not accepted as an operating state for the long run. The wrapper logging
   repair that was dated 2026-10-06 is pulled forward to before the certificate run.

Neither contract touches the append-only journal's failure contract. Axiom A4 — an append
that fails **is** an abort — stands unchanged, and nothing below is permission to treat a
journal failure as a diagnostic inconvenience.

---

## Part I — the stop contract

### What a stop is, and what it is for

`node ops/activation/cli.ts abort --confirm` is the owner's typed stop. He types it when
he has decided that this activation attempt must not continue: the certificate looked
wrong, a drill failed, he changed his mind at 22:40. It is the one command whose whole
purpose is to make the deployment harmless, and it is the command he will reach for at
the worst moment of the whole run.

The stop is *not* the automatic abort `decide()` produces. That one ends an attempt from
inside the run's own logic and its retry mechanics are the spec's. The clauses below are
about the typed one, except where they say otherwise.

### The scenarios it is derived from

Each of these is an ordinary evening on this host, not a thought experiment.

* **S-STOP-1 — the stop lands while a tick is acting.** The 22:30 invocation holds the
  lease and is inside step `4-enable`, between "disable both tasks" and "enable both
  tasks". At 22:31 the owner types the abort. The abort disarms immediately, because it
  must not wait for a lease; the tick then applies the enable it decided a minute ago.
* **S-STOP-2 — the stop is typed twice.** The first one printed something the owner did
  not trust, or he is not sure it went through, so he types it again.
* **S-STOP-3 — the stop is typed at the wrong state root**, or at a fresh one, or at one
  that was rotated: there is no attempt in it to end.
* **S-STOP-4 — the record cannot be written.** The disk is full, the ledger file is held
  by another process, the lock file survives a dead owner. The four teardown actions have
  already run.
* **S-STOP-5 — the gate's own append fails.** Step 10 wrote the certificate line into
  `.env`, the result append then fails, and axiom A4's teardown runs inside the lease.
* **S-STOP-6 — one part of the teardown fails.** `Disable-ScheduledTask` is denied while
  the certificate line is removed successfully.
* **S-STOP-7 — the next tick fires five minutes after the stop.**
* **S-STOP-8 — the owner continues the next morning.**

### The clauses

**SC-1 — A stop does not wait.** The teardown is applied before the activation lease is
taken. A stop that waits for a running invocation's lease is a stop that did not happen
when it was typed (spec §5, ACT-27). *Unchanged; stated because everything below has to
hold without weakening it.*

**SC-2 — A stop is marked before it acts.** Before the first teardown action, the stop
writes a durable **stop mark** into the activation state root, naming the operator and the
moment. If the mark cannot be written, the stop still disarms, says so, pages, and exits
non-zero: it disarmed, but it is not a durable stop and must not be read as one.
*From S-STOP-1: the mark, not the ordering, is what makes a stop survive a concurrent
invocation.*

**SC-3 — While the mark stands, nothing arms.** Every invocation in every process refuses
to apply an **arming** action while the mark exists: `enable-tasks`,
`write-certificate-line`, `install-tasks`, `register-disarm`, `restart`. **Disarming**
actions stay permitted — `disable-tasks`, `remove-certificate-line`, `delete-disarm`,
`clear-checks` — because a stop must never block another stop, and the disarm one-shot
must keep working after one. The mark is read fresh immediately before each individual
action, so an invocation that decided before the stop cannot arm after it. A refusal on
this ground is recorded and named `STOPPED_BY_OWNER`; it is never silent.
*Closes R2-03. This is the clause the race needs: serialising the two commands is
impossible without making SC-1 false.*

**SC-4 — A stop is confirmed under the lease.** After the immediate pass the stop acquires
the lease — the instant at which no other invocation is inside an `act` — and re-applies
the disarming actions. The report distinguishes the two passes. Only a stop whose second
pass applied everything it attempted is reported as confirmed; contention, a failed
action or an unwritten mark each make it unconfirmed, and an unconfirmed stop never exits
0.
*From S-STOP-1 and S-STOP-6: the second pass is what undoes an action that landed in the
window, and the distinction is what keeps the report honest.*

**SC-5 — Every stop leaves a record, and no attempt is ended twice.** A stop against an
open attempt appends the terminal entry that ends it. A stop against a ledger with no
attempt appends a note. A stop against an attempt that is **already ended** appends a
note naming what this invocation did — it does not end the attempt a second time, and it
never reports "Nothing was done" after applying real actions.
*Closes R3-08. The ledger is append-only, so the entry a repeat writes is the only
durable trace that four actions ran and three checks were pinged.*

**SC-6 — Output, ledger, exit code and page are built from what happened.** Every sentence
about a teardown is derived from the action reports and from nothing else: an action that
was not attempted reads as not attempted, an action whose effect is unknown reads as
unknown, and nothing is asserted from what was *owed*. An invocation that changed the
world and cannot say so is a defect, not a rounding error.
*The generator behind R2-14, R3-01 and R3-08, stated once so that its instances stop
being repaired one at a time.*

**SC-7 — A failure to record is reported with the effects it leaves behind.** When the
world was changed and the entry could not be written, the invocation names both, pages,
and exits non-zero. This holds for **every** store stage — `write-ledger`, `sync-ledger`,
`close-ledger`, the lock stages — and not only for the CLI's own typed abort travelling
back out through the lease. The teardown that ran on the way out travels with the outcome
whatever the failure is classified as.
*Closes R3-09 and the reachable half of R3-06. The test that certifies this clause must
inject the shape the store really produces — a `LedgerStoreError` — because that is the
branch production takes.*

**SC-8 — Only the owner lifts a stop.** The mark is cleared by `activation open`, the
owner's typed continuation, and by nothing else. No scheduled tick clears it, not even the
one that opens a new attempt for a new anchor day: a stop typed on Monday night is not
undone by Tuesday's clock.
*From S-STOP-7 and S-STOP-8. The cost is stated rather than hidden: a retry on the next
trading day needs one typed command more than it does today, and the refusal that enforces
it names that command.*

**SC-8a — and `open` works while a stop stands, which is the point of it.** Its refusal of
a second attempt for one anchor day stands over everything except the owner's own stop.
Two states need this. A stop against a state root with no attempt writes a note, and the
fold reads the last entry's attempt id as the current attempt, so that note looks like an
open attempt; and a stop that could not take the lease disarmed and marked without ending
anything. Without this clause the stop would leave the owner no way back in — found by
the cross-process probe of 2026-09-19, not by reading the code.

**SC-9 — A stop is visible without reading the ledger.** `activation status` prints
whether a stop mark stands, who set it and when.

### What this contract does not cover

The automatic abort inside `run` keeps the spec's semantics. The stop mark is written by
the typed abort only — an automatic abort ends the attempt in the ledger, which is what
the retry rules already read. Extending the mark to automatic aborts would change retry
behaviour across the whole run, which is not what the defects call for.

---

## Part II — the wrapper log contract

### What the wrapper run logs are, and what they are not

`tools/cycle-run.ps1` and `tools/watchdog-run.ps1` are the two scripts the live scheduled
tasks execute, every fifteen and every five minutes. Each writes a diagnostic line per
firing into `<STATE_DIR>\cycle-run.log` and `<STATE_DIR>\watchdog-run.log`.

Those logs are **diagnostic evidence, not authority**. The authority is the append-only
journal, and the alarm path is healthchecks.io. Yesterday's repair inverted that: it made
a failed log write end the firing, which turned the diagnostic file into a precondition
for the safety work of the one component that only ever acts when something else has
already gone wrong.

### The scenarios it is derived from

* **S-LOG-1 — a foreign process holds the log for 200 ms.** A backup agent, a virus
  scanner, an editor. The firing is due now.
* **S-LOG-2 — the log cannot be written all day.** The file is read-only, the directory
  denies writes, the disk is full.
* **S-LOG-3 — the first write of a firing fails**, so the file ends the firing empty.
* **S-LOG-4 — the last write fails**, after the child has run and its verdict is known.
* **S-LOG-5 — the log has grown past its bound** and has to be rotated.
* **S-LOG-6 — the activation's step 6 reads both logs** and uses "no line in the silence
  window" as its local discriminator between a disabled task and a failed uplink.
* **S-LOG-7 — the wrapper refuses above the log open**, because `STATE_DIR` itself could
  not be read: there is no log path yet.

### The clauses

**LC-1 — The log never stops the safety work.** No failure to write a run log prevents the
watchdog from assessing staleness, fencing, halting and recovering the book, or the cycle
wrapper from running its cycle. The log is written around the work, never in front of it.
*Closes R3-13. This is the clause the owner's ruling is built on: an unwritable diagnostic
file must not disable the dead man.*

**LC-2 — A log failure is never silent.** A firing that could not write its log reports
that through the channel that is still reachable: its heartbeat goes to the endpoint's
`/fail` with a body naming the file, the reason, and the line that was lost.
*Closes R3-14 against S-LOG-3. Silence is the one signature the activation reads as "the
task was disabled", so a firing that happened must never produce it.*

**LC-3 — The child's verdict and the log failure both survive.** After the child has run,
its exit code reaches the heartbeat body and the process exit code, and the log failure is
reported beside it in the same body. Neither displaces the other. A firing that completed
is never reported as a refusal.
*Closes R3-15.*

**LC-4 — One verdict ping per firing.** Success and failure are decided once, after
everything is known, and exactly one verdict heartbeat is sent. A firing that never
started sends the refusal heartbeat instead. No firing sends a green ping and then a red
one.
*Closes R3-16.*

**LC-5 — Transient locks are tolerated; permanent ones are named.** A write is retried on
a bounded schedule — at most four attempts across less than half a second in total — before it
counts as failed. The policy lives in one place and is stated in the code that implements
it.
*Closes R3-13 against S-LOG-1, and bounds the tolerance so that S-LOG-2 still reports
within one firing.*

**LC-6 — The failure path does not rest on an ambient setting.** Every log write asks for
its own error behaviour, so the failure branch is reachable no matter what the script-wide
`$ErrorActionPreference` is at that line.
*Closes R3-17.*

**LC-7 — A second sink, so that "no line" keeps its meaning.** When the primary log cannot
be written, the line is written to a fallback sink beside it, and to the per-user
temporary directory when that fails too. The fallback is evidence for the human reading
the drill afterwards; the activation's own discriminator stays what the spec says it is —
no line in either run log, no ping body naming a log failure — so this clause adds
evidence without moving any decision into a new file.
*Strengthens LC-2 for S-LOG-3 and S-LOG-6.*

**LC-8 — One implementation, not two copies.** Both wrappers take their logging from one
shared module: rotation, retry policy, fallback, and the memory of what failed. The
watchdog log rotates on the same bound as the cycle log. The module is covered by the
activation's step-0 wrapper hashes, so a change to it is as visible as a change to either
wrapper.
*Closes R3-07 and R3-C05, and removes the hand-synchronisation that produced five
findings from one cause.*

**LC-9 — The journal's contract is untouched.** This contract governs the wrappers'
diagnostic run logs. An append failure in the append-only journal remains an abort
(axiom A4). Nothing here is permission to swallow a journal error.

### What this contract does not cover

Rotation loses one generation by design; the journal carries what matters. The activation's
step 9 keeps reading `cycle-run.log` and `cycle-run.log.1` only: on the anchor morning an
unwritable log is a host problem to stop for, not one to route around.

**One log line stands outside LC-2, by necessity.** A line that reports the ping's delivery
cannot be written before the ping is sent, so if that one line is the only write that
fails, its failure cannot reach the body it describes. It travels instead in the process
exit code (9) and in the fallback sink. Everything the firing is *about* — its start, the
child's output, the child's exit code — is written before the ping and is therefore inside
the body.

---

## How these contracts are measured

Both parts are executable claims, so neither is believed on reading:

* Every clause gets at least one test that fails against the code as it stands on
  2026-09-19 before it passes against the repair.
* The stop contract is driven **across process boundaries** — two real OS processes, the
  real lock, the real files — not only through the in-process harness, because SC-3 and
  SC-4 are about what two processes do to one world. **Its limit, named:** with the action
  ports unbound until unit 13, what the cross-process probe measures is the *decision*
  every port call passes through, not an action taking effect. The effect itself is owed a
  controlled probe once the bindings exist.
* The store failures of SC-7 are injected as the shapes the store really throws, at
  `write-ledger`, `sync-ledger` and `close-ledger`.
* The log contract is driven against **whole wrapper processes** with a locked log, a
  read-only log, a stub child and a rotation boundary, because no unit test crosses a
  PowerShell script.
* Both parts get a mutation probe: a repair whose removal leaves the suite green has not
  been measured.
