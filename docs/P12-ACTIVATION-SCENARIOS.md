<!--
Provenance: derived on 2026-09-12 by an agent that was given the requirement in
prose and was forbidden to open any file in this repository. That is the point:
a yardstick derived from the artefact it measures rationalises whatever it finds
(CORE.md, axiom "Prüfling ≠ Maßstab"). The list is therefore kept verbatim, and
every disagreement with our design is resolved in the spec that follows it, in
writing -- not by editing this file. Where a scenario rests on a wrong premise
about this deployment, the reconciliation says so and gives the evidence.
-->
# Activation scenarios — independent yardstick

Derived only from the stated requirement and from general knowledge of Windows 11 Home,
Windows Task Scheduler (S4U), healthchecks.io, brokerage paper accounts and unattended
home-PC automation. No repository file was opened while writing this list.

## Reading conventions

- All wall-clock times are **Europe/Berlin** unless a scenario says otherwise.
  Task wrapper logs are in **UTC**; any scenario that crosses that boundary says so.
- "the record" = the append-only file the activation script writes. "a later reader" =
  a fresh assistant session with no memory that has only the record, the machine and
  the healthchecks.io API.
- "armed" = the trading cycle task is enabled in Task Scheduler.
- "paged" = a `/fail` ping on the **readiness** check, which makes healthchecks.io email
  the owner and repeat hourly while down.
- Severity: **A** = could arm without the pre-authorised condition, trade before the gate,
  touch the wrong account (competition account or public dashboard), or leave the owner
  unaware that the run is disabled or broken. **B** = loses the start day, needs manual
  repair, or leaves the record ambiguous. **C** = cosmetic or inconvenience.

### The pre-authorised condition (restated, because everything below is measured against it)

Arming is permitted **only** if all three hold: certificate run verdict PASS, development
account flat, activation gate green. Any other state must end with the trading task
**disabled** and the owner **paged with the reason**.

---

## Group 1 — Forward scenarios (the run as intended)

### ACT-01 — Clean happy path, Monday to Tuesday, no human present
**Sequence.** Mon 15:35 the activation script starts; it records phase entry, runs the
certificate on the development account, gets PASS after 28 min, verifies the dev account
flat, writes the certificate path into `.env`, records the code+config digest. Mon 22:10
it enables both tasks. Mon 22:15–00:15 it runs both silence drills and re-enables
everything. Tue 13:30 it reboots the PC; nobody logs in; the 14:00 firing happens. Tue
14:45 the gate is green. Tue 15:15 the first trading cycle runs.
**Required outcome.** Trading task enabled; all three checks up; the record contains one
append-only entry per step with its evidence (certificate verdict and path, flat-check
result, digest, task states before/after each change, per-check up/down transitions with
timestamps, gate result, first-cycle log reference). A later reader can name the phase
("measurement running since Tue 15:15") without reading anything else.
**Severity if violated.** A.

### ACT-02 — Firings outside the US session report health but do not trade
**Sequence.** Mon 22:10 tasks are enabled. Between 22:10 and 23:45 the cycle fires at
22:15, 22:30, 22:45, 23:00, 23:15, 23:30, 23:45 with the market closed.
**Required outcome.** Every firing pings liveness and readiness; no order is placed; the
record does not treat these firings as trading activity. Readiness stays up (market closed
is not a fault).
**Severity if violated.** A if an order is placed; C if the record mislabels them.

### ACT-03 — The trigger window boundary is respected on both edges
**Sequence.** Tasks enabled; time passes 23:45 Monday and 14:00 Tuesday.
**Required outcome.** No firing between 23:45 and 14:00; the healthchecks.io cron
schedules and graces are consistent with that gap, so the overnight silence does **not**
trip an alarm; the first firing after the gap is 14:00.
**Severity if violated.** B (a nightly false page trains the owner to ignore alerts — that
degradation is itself A-adjacent, but the direct failure is B).

### ACT-04 — Watchdog drill: only the watchdog check goes down
**Sequence.** Mon ~22:20 the script disables only the watchdog task, waits past the
watchdog check's detection window (cron + 15 min grace), queries the management API.
**Required outcome.** API shows watchdog `down`, liveness and readiness `up`. The script
re-enables the watchdog task and waits until the API shows it `up` again before advancing.
Record holds the observed per-check states with timestamps, and the wait actually
terminated on an observation, not on a fixed sleep alone.
**Severity if violated.** B (drill proves nothing) — A if the script leaves the watchdog
task disabled and continues.

### ACT-05 — Full-silence drill: all three checks go down, then are paused
**Sequence.** Mon ~22:45, after an observed ping, the script disables both tasks, waits out
the longest grace (50 min), confirms via API that all three are `down`, pauses all three
checks, re-enables both tasks.
**Required outcome.** All three observed `down` within their detection windows; then all
three `paused`; then both tasks enabled. The first subsequent ping un-pauses each check
automatically, and the record notes the un-pause observation. The owner receives the drill
emails — expected, and the record says they were expected.
**Severity if violated.** A if the tasks are left disabled without paging, or if the checks
are left paused past the gate (a paused check cannot alarm — silent blindness).

### ACT-06 — Unattended reboot and logged-off run
**Sequence.** Tue 13:30 the script triggers a reboot. The PC comes back to the login
screen. Nobody logs in. 14:00 arrives.
**Required outcome.** The 14:00 cycle firing happens with no interactive session; liveness
and readiness pings land; the record (written after the reboot by the script's resumed
run) shows the reboot timestamp, the boot time, and the 14:00 firing as evidence of
"runs while logged off".
**Severity if violated.** A (the whole three-month run depends on this property).

### ACT-07 — The gate is green and is recorded as a decision, not an assumption
**Sequence.** Tue 14:45 the script runs the scheduler verification tool, queries the three
checks, and looks for the 14:00 firing in the wrapper log.
**Required outcome.** All three sub-conditions individually recorded with their raw
evidence; the gate verdict is the conjunction; the record states "gate green → tasks remain
enabled → measurement period starts at the next trading cycle". If any sub-condition is
merely *unknown* (tool crashed, API unreachable), the gate is **not** green.
**Severity if violated.** A.

### ACT-08 — First trading cycle starts the measurement period
**Sequence.** Tue 15:15 (session open since 15:30? no — 15:15 is pre-open; the first
*trading-capable* cycle is 15:30 or later). The cycle at 15:15 runs, finds the session not
yet open, reports health; the 15:30/15:45 cycle is the first that may trade.
**Required outcome.** The record distinguishes "measurement period started" (a clock fact,
fixed by the configured end date) from "first order placed" (may be much later or never).
The configured end date is unchanged by a late start.
**Severity if violated.** B.

### ACT-09 — Certificate digest binds code and configuration
**Sequence.** After the certificate PASS, the digest of code+config is recorded. Nothing
changes. Tuesday the runtime checks the digest before trading.
**Required outcome.** Digest at gate time equals digest at certificate time; the record
holds both values, not just "matched". Writing the certificate path into `.env` must not
itself invalidate the digest — if `.env` is part of the digest input, the ordering
(digest after the `.env` write) has to be explicit in the record.
**Severity if violated.** A (a digest that silently excludes what it claims to cover is a
false guarantee).

### ACT-10 — The competition account and the public dashboard are never touched
**Sequence.** The whole activation runs while a jury still evaluates the earlier
submission.
**Required outcome.** Every brokerage call during activation targets the **development**
profile, selected explicitly; no write to the competition account, no publish to the
dashboard, no change to the competition account's tasks or checks. The record names the
profile used for each brokerage step.
**Severity if violated.** A.

### ACT-11 — Owner-confirmed alert receipt is a recorded precondition
**Sequence.** Before Monday, a human records that the owner received a test alert email
and an hourly reminder on his own device.
**Required outcome.** The script reads that human-recorded confirmation as a precondition;
if it is missing or stale, the script refuses to proceed past the enable step, leaves the
trading task disabled, and pages. The script never fabricates or self-certifies this.
**Severity if violated.** A (the entire safety net is "the owner gets emailed"; unverified,
the run is unmonitored).

### ACT-12 — The script's own steps are idempotent in the forward direction
**Sequence.** Each step, before acting, reads the current world state (task enabled?
certificate path already in `.env`? check paused?) and records "already in target state,
no action" where that is true.
**Required outcome.** Re-running a completed step changes nothing and appends a record
entry saying so. No step's correctness depends on it having run exactly once.
**Severity if violated.** B.

---

## Group 2 — Backward scenarios (abort at each step, what is left behind, retry, manual intervention)

### ACT-13 — Certificate verdict FAIL
**Sequence.** Mon 16:05 the certificate run ends FAIL.
**Required outcome.** No `.env` write, no task enable, no drills, no reboot. Both tasks
remain disabled. Owner paged with "certificate FAIL" and the certificate file path. Record
states the phase as "aborted at step 1, nothing armed" and states explicitly that a retry
requires a **new certificate run** (the FAIL exception to the no-new-certificate rule).
**Severity if violated.** A.

### ACT-14 — Certificate PASS but development account not flat (leftover open order)
**Sequence.** Certificate PASS; the flat check finds one resting limit order that did not
cancel.
**Required outcome.** Abort before the `.env` write. Nothing armed. Owner paged with the
specific residue (order id, symbol, quantity). Record says a retry the next trading day is
safe **and** may reuse the existing certificate, provided the digest still matches and the
residue is cleared first. The script does **not** cancel the order by itself unless that is
an explicitly pre-authorised remedy — cancelling is a brokerage write outside the arming
mandate.
**Severity if violated.** A (proceeding while not flat) / B (unclear retry guidance).

### ACT-15 — Certificate PASS, account flat, but `.env` write fails (disk full / read-only / AV lock)
**Sequence.** The write of the certificate path into `.env` throws.
**Required outcome.** Fail closed: nothing armed, owner paged. The record must say whether
`.env` is intact, partially written, or replaced by a temp file. The write must be atomic
(write temp + rename) so the record can assert "`.env` unchanged" truthfully. If atomicity
cannot be asserted, the record must say "`.env` state unknown — inspect before retry".
**Severity if violated.** A (a half-written `.env` can arm with the wrong configuration).

### ACT-16 — Abort after `.env` write, before enabling tasks
**Sequence.** Script dies at 21:40 (crash, power cut, operator Ctrl-C) after `.env` holds
the certificate path.
**Required outcome.** Tasks still disabled — the residual state is safe by construction.
Record's last entry is the `.env` write with its outcome, so a later reader can determine
that step 1 is complete and step 2 never started. Retry resumes at step 2 without a new
certificate.
**Severity if violated.** B.

### ACT-17 — Abort between enabling tasks and the drills
**Sequence.** Both tasks enabled at 22:10; the script crashes at 22:12.
**Required outcome.** This is the dangerous residue: tasks are **enabled but unvalidated**,
and the gate will never run. Required behaviour: either the script re-arms a self-healing
path (a supervisor that disables both tasks if the activation does not reach the gate by
Tue 14:45) **or** the enable step is designed so that an unfinished activation cannot reach
a trading-capable session — plus the owner is paged on the next firing that observes
"activation incomplete". Record must show tasks enabled with no gate entry, and a later
reader must read that as "armed but not validated — do not leave it running".
**Severity if violated.** A.

### ACT-18 — Abort during the watchdog drill, watchdog task left disabled
**Sequence.** The script disables the watchdog task and dies before re-enabling it.
**Required outcome.** The watchdog check goes down and pages the owner — which is the
correct visible outcome. Record's last entry names "watchdog task disabled for drill",
so the reader knows the disable was deliberate and that re-enabling is the pending action.
Never leave a drill-induced disable indistinguishable from a fault.
**Severity if violated.** A (silent loss of the watchdog) / B (ambiguous record).

### ACT-19 — Abort while all three checks are paused
**Sequence.** The script pauses all three checks during the full-silence drill and dies
before re-enabling the tasks.
**Required outcome.** Worst blind state: nothing pings, nothing alarms. Mitigation must be
structural — pause for the shortest possible span, and record the pause with an explicit
"if you are reading this, the checks may still be paused; un-pause by sending one ping or
via API" instruction. A later reader must be able to detect paused-ness from the API, not
only from the record.
**Severity if violated.** A.

### ACT-20 — Abort at the reboot step: the reboot command is issued but the PC does not come back
**Sequence.** Tue 13:30 reboot issued; the machine hangs at a firmware or update screen.
**Required outcome.** No 14:00 firing, so liveness goes down and the owner is paged by
healthchecks.io within grace — the external dead-man is the only detector here, and that is
by design. The record's last entry (written *before* the reboot) must say "reboot issued at
13:30; if no entry follows, the machine did not return". The trading task may be enabled in
this state; that is acceptable only because the machine is down and cannot trade — but the
gate never runs, so on return the script must not treat the machine as validated.
**Severity if violated.** A.

### ACT-21 — Gate fails: scheduler verification tool reports a task not enabled
**Sequence.** Tue 14:45 the verification tool finds the cycle task disabled.
**Required outcome.** Disable **both** tasks, page with the specific failing sub-condition,
record the abort. Trading task must be disabled even though the failure was "not enabled" —
the response is uniform, not conditional. Retry the next trading day is permitted with the
same certificate.
**Severity if violated.** A.

### ACT-22 — Gate fails: a check is down
**Sequence.** Tue 14:45 readiness is `down` because a firing reported a fault.
**Required outcome.** Same uniform response: both tasks disabled, owner paged with the
fault reason carried through from the readiness failure, record shows the gate verdict as
red with the evidence. Do not "wait a bit and re-check" indefinitely; a bounded retry is
allowed but must be recorded and must end in a verdict.
**Severity if violated.** A.

### ACT-23 — Gate fails: the 14:00 firing is missing from the log
**Sequence.** Checks are up (a manual or stale ping), but no 14:00 entry exists in the
wrapper log.
**Required outcome.** Red gate. The log evidence is independent of the ping evidence and
must be evaluated separately — "checks are up" must never substitute for "the firing is in
the log". Note the UTC/local conversion: 14:00 Berlin is 12:00Z (CEST) or 13:00Z (CET);
an off-by-one-hour lookup that finds nothing must be distinguishable from a genuinely
missing firing.
**Severity if violated.** A (wrong conversion → false red is B, false green is A).

### ACT-24 — Retry the next trading day with the same certificate
**Sequence.** Tuesday aborted at the gate. Wednesday the script is started again.
**Required outcome.** The script re-validates the certificate (exists, verdict PASS, digest
still matches current code+config), confirms the dev account is still flat if it is going
to re-run anything against it, then resumes from step 2 with Wednesday's clock. The record
opens a new, clearly labelled attempt that references the prior attempt's abort entry. The
configured end date does not move; the run is simply shorter.
**Severity if violated.** B.

### ACT-25 — Retry after code or configuration changed → digest mismatch
**Sequence.** Between the certificate and the retry, the owner edits a source file or `.env`.
**Required outcome.** Digest mismatch → certificate invalid → arming refused, owner paged
with "digest changed; a new certificate run is required". The runtime's own refusal-to-trade
is a second line of defence, not the primary one: the activation script must catch this
before enabling anything.
**Severity if violated.** A.

### ACT-26 — Owner intervenes manually mid-activation (enables/disables a task by hand)
**Sequence.** Monday evening the owner opens Task Scheduler and toggles something.
**Required outcome.** The script's next step reads actual state rather than assuming its own
last write, detects the divergence, records it as an external change with before/after
values, and treats an unexpected **enabled** state as a red condition (abort + page) rather
than a convenient shortcut. An unexpected **disabled** state is also a red condition.
**Severity if violated.** A.

### ACT-27 — Owner aborts the whole activation deliberately
**Sequence.** The owner decides Monday night to call it off and runs a stop/rollback path.
**Required outcome.** A defined teardown: both tasks disabled, checks un-paused (so silence
is visible rather than hidden), `.env` certificate path left or reverted per an explicit
decision, and a terminal record entry "activation aborted by owner at <time>, nothing
armed". A later reader must not mistake a deliberate abort for a crash.
**Severity if violated.** B.

### ACT-28 — The script is invoked twice (double-click, scheduler retry, second shell)
**Sequence.** Two instances start within the same minute, or a second starts while the
first sleeps between steps.
**Required outcome.** A single-instance lock (named mutex or lock file with the owning pid
and start time). The second instance exits without acting and appends one record line
saying it found a live instance. A stale lock from a crashed instance must be detectable
(pid no longer alive) and must lead to a recorded, deliberate takeover — never a silent one.
**Severity if violated.** A (two instances racing on task enable/disable and `.env` can
produce an armed, unvalidated state).

### ACT-29 — The activation script crashes mid-step and is restarted by hand
**Sequence.** Crash at 22:47 during the full-silence drill; the owner restarts the script
Tuesday morning.
**Required outcome.** The restart reconstructs phase **from the world plus the record**, not
from the record alone: query task states, query check states, read `.env`, compare digest.
Where record and world disagree, the world wins and the disagreement is recorded. If the
phase cannot be established unambiguously, fail closed: disable both tasks and page.
**Severity if violated.** A.

### ACT-30 — Abort leaves an order-capable window before the gate
**Sequence.** Any abort path that ends with the trading task enabled while the next US
session will open before a human looks.
**Required outcome.** No abort path may end in that state. Every abort ends with the trading
task disabled, or — if disabling itself fails — with a page that says so in plain terms and
a second attempt. "Disable failed" is itself an A-class event that must be loudly visible.
**Severity if violated.** A.

---

## Group 3 — Degraded scenarios (partial failures and real-world surprises)

### Windows, power and the machine

### ACT-31 — Windows Update reboots the PC during the drills
**Sequence.** Mon 23:10 Windows Update installs and restarts the machine mid-drill
(active hours on an evening-used home PC often end before 23:00).
**Required outcome.** The script does not survive the reboot as a process; on restart it
must reconstruct phase from world + record (ACT-29) and must not assume its pre-reboot
assumptions hold. Checks that were paused are still paused across the reboot — the reader
must be able to find that. Active hours should be set so this cannot happen during the
activation window; if it does happen, it is a recorded incident, not a silent gap.
**Severity if violated.** A.

### ACT-32 — A pending-reboot state makes the 13:30 reboot install updates for 50 minutes
**Sequence.** Tue 13:30 the reboot begins "Working on updates"; the machine is back at
14:22.
**Required outcome.** The 14:00 firing is missed. Liveness goes down and pages. On return,
the missed-task behaviour fires a catch-up run (see ACT-36) and the checks recover. The
gate at 14:45 must evaluate "a 14:00 firing exists" honestly: a 14:25 catch-up is **not**
a 14:00 firing. Either the gate red-flags it (safe) or the record states explicitly which
firing satisfied the criterion and why. Silent acceptance of the catch-up is A.
**Severity if violated.** A.

### ACT-33 — The 13:30 reboot hangs at an update screen and needs a key press
**Sequence.** The machine stops at a screen requiring interaction; nobody is home.
**Required outcome.** Total silence → all three checks down → hourly reminders until the
owner returns in the evening. The record's pre-reboot entry is the only local evidence and
must already carry the "if nothing follows, the machine did not return" line. Nothing may be
armed in a way that trades unattended after such a recovery without re-running the gate.
**Severity if violated.** A.

### ACT-34 — The PC sleeps or hibernates and the task does not fire
**Sequence.** Idle sleep kicks in at 23:00 Monday; the next firings do not happen, or fire
late on wake.
**Required outcome.** The activation must have asserted (and recorded) that sleep/hibernate
is disabled or that the tasks are configured to wake the machine, before enabling anything.
An unasserted power policy is a precondition failure: refuse to arm, page. Fast Startup
(hybrid shutdown) must also be considered — a "shutdown" that is really hibernation changes
what the 13:30 reboot proves.
**Severity if violated.** A (a sleeping PC produces a silent, three-month-long non-run).

### ACT-35 — The owner uses the PC in the evening and logs in during the drills
**Sequence.** Mon 22:30 the owner logs in, browses, maybe opens the repo.
**Required outcome.** S4U tasks continue to fire regardless of the interactive session; a
logged-on session must not change task behaviour, and the drills' conclusions must not
depend on nobody being logged in. The record notes that a session was present during the
drill window if it can detect it, so a later reader does not over-claim "proved logged-off
operation" from the drill (only ACT-06 proves that).
**Severity if violated.** B.

### ACT-36 — Catch-up storm: "run task as soon as possible after a missed start"
**Sequence.** After a two-hour outage the scheduler releases missed instances; the cycle
task runs immediately, possibly repeatedly.
**Required outcome.** At most one catch-up run; it must be idempotent and must not place
orders based on stale intent. Each catch-up ping must be distinguishable in the record and
in the log from an on-schedule firing. A catch-up must never satisfy a gate criterion that
names a specific clock time.
**Severity if violated.** A if it trades on stale state; B otherwise.

### ACT-37 — Overlapping instances: a cycle run exceeds 15 minutes
**Sequence.** A slow broker API makes the 15:30 cycle still run at 15:45.
**Required outcome.** The task's multiple-instance policy must be "do not start a new
instance" (or a lock enforces the same), so two cycles never evaluate the account
concurrently. The skipped firing must still produce a health signal or be covered by the
grace, so the skip does not read as silence. Record/lens: concurrency on a brokerage
account is an A-class surface.
**Severity if violated.** A.

### ACT-38 — Power cut overnight; the PC does not power back on
**Sequence.** Mains fails at 03:00; the BIOS is set to stay off after AC loss.
**Required outcome.** No 14:00 firing, checks down, owner paged. The activation cannot fix
this, but the record and the runbook must let the owner conclude in one look: "machine off,
nothing armed is running, re-run the activation from step X on the next trading day".
**Severity if violated.** B (A if the record suggests the run is healthy).

### ACT-39 — Power cut while the record file is being appended
**Sequence.** The machine loses power mid-write; the last line is truncated or contains NUL
padding.
**Required outcome.** The record format must tolerate a torn final line: line-delimited,
one self-contained entry per line, each entry with its own timestamp and an integrity
marker (sequence number or hash chain) so a reader can say "entry N is incomplete" rather
than mis-parsing it. Recovery appends a new entry noting the torn tail; the torn line is
never edited or deleted.
**Severity if violated.** B (A if a torn line can be read as a completed step).

### ACT-40 — Clock drift or an NTP step during the window
**Sequence.** The system clock is 4 minutes off, then jumps.
**Required outcome.** healthchecks.io grace windows absorb small drift; the record's
timestamps must be unambiguous (ISO 8601 with offset) so a reader can align local record
entries against UTC wrapper logs and against healthchecks.io's own server timestamps.
A jump backwards must not make sequence numbers non-monotonic.
**Severity if violated.** B.

### ACT-41 — DST change inside the measurement window
**Sequence.** Europe ends DST on the last Sunday of October, the US a week later; for that
one week the US session in Berlin time is 14:30–21:00 instead of 15:30–22:00.
**Required outcome.** The trigger window 14:00–23:45 still covers the shifted session, and
the healthchecks.io cron schedules (defined in Europe/Berlin) still match the firing
pattern. Any component that hardcodes "15:30" as the open must derive it from the exchange
calendar, not from Berlin local time. This is outside the activation weekend but inside the
run it authorises, so the activation must at least record the assumption.
**Severity if violated.** A (silent no-trade or false readiness failures for a week).

### ACT-42 — The activation script is not elevated
**Sequence.** Enabling a task registered for all users, or issuing a reboot, returns access
denied.
**Required outcome.** The script checks for the required privileges **before** step 1, not
at 22:10, and fails closed early with a page and a clear record entry. A partial success
(one task enabled, the other refused) is the bad case: detect, revert the successful half,
page.
**Severity if violated.** A.

### ACT-43 — The S4U task fails with a logon/credential error
**Sequence.** The account password changed, or the task's stored principal no longer
resolves; the task reports 0x8007052E / "The user account does not have permission to run
this task" and never executes.
**Required outcome.** Enabled ≠ running. The activation must verify a task actually **ran**
(last run time and result advanced, plus the ping arrived), never only that it is enabled.
The gate's "both tasks enabled" criterion is necessary but not sufficient; the 14:00-firing
criterion is what catches this.
**Severity if violated.** A.

### ACT-44 — Antivirus or Controlled Folder Access blocks the script, the record or `.env`
**Sequence.** Defender quarantines the wrapper, or a locked handle makes the `.env` rename
fail, or the record file cannot be opened for append.
**Required outcome.** Fail closed. A record write that fails is itself an A-class event:
the script must not continue silently making changes it cannot document — if it cannot
append, it disables both tasks, pages, and exits.
**Severity if violated.** A.

### Network, healthchecks.io and email

### ACT-45 — Network loss for 40 minutes on Monday evening
**Sequence.** The router drops at 22:20; firings happen but pings cannot leave.
**Required outcome.** The firings still run and log locally; the checks go down and the
owner is paged (correct — from outside, silence is silence). When connectivity returns the
next ping restores the checks. The drills running at that moment are **invalid** and must be
recorded as invalid and repeated, not counted: a check that is down because of the network
proves nothing about a disabled task.
**Severity if violated.** A (a drill conclusion drawn from an ambiguous cause is a false
proof of the alerting chain).

### ACT-46 — DNS resolution fails while the link is up
**Sequence.** `hc-ping.com` does not resolve; the API host does not resolve.
**Required outcome.** Same as ACT-45 from the outside. Internally, the script must
distinguish "API unreachable" from "API says the check is up": unreachable is **unknown**,
and unknown is never green. Any gate or drill step whose evidence is unknown fails closed.
**Severity if violated.** A.

### ACT-47 — healthchecks.io management API rate-limits the drill polling
**Sequence.** The script polls check status every few seconds and starts receiving 429.
**Required outcome.** Bounded polling with backoff and a cap; 429 is treated as unknown,
not as a status; the drill has a deadline after which it reports "could not observe" and
fails closed rather than looping. Record holds the request count and the backoff decisions
so a later reader can tell throttling from outage.
**Severity if violated.** B.

### ACT-48 — healthchecks.io itself is down or degraded during the activation
**Sequence.** The service returns 5xx for 30 minutes on Monday evening, or ingests pings but
the API lags.
**Required outcome.** No arming decision may rest on an unavailable third party. Drills are
postponed or declared inconclusive; the gate is red if check status cannot be established.
The script never assumes "up" from the absence of an alarm.
**Severity if violated.** A.

### ACT-49 — Ping ingest and API status are eventually consistent
**Sequence.** A ping is accepted, but the API still reports the previous state for some
seconds; or a check flips up/down/up inside one poll interval.
**Required outcome.** Drill assertions wait for a **stable observation** (the expected state
observed, with a defined settle period) rather than a single sample, and record the raw
samples. Conclusions must survive one delayed sample.
**Severity if violated.** B.

### ACT-50 — The wrong check is pinged (liveness vs readiness vs watchdog URL mix-up)
**Sequence.** A configuration error sends the readiness ping to the liveness URL; readiness
never receives anything, or a `/fail` lands on the wrong check.
**Required outcome.** The drills are precisely what catches this: the watchdog drill asserts
that **only** the watchdog goes down — a mix-up shows up as the wrong check going down. The
script must compare the observed down-set against the expected down-set as a set, not check
a single expectation. Each ping URL's identity must be recorded by a fingerprint that is not
the secret itself.
**Severity if violated.** A (a readiness `/fail` that lands nowhere means the owner is never
paged for a halt — the single most dangerous silent failure in this design).

### ACT-51 — Alert email is delayed, filtered as spam, or the owner misses it
**Sequence.** The drill's page arrives 25 minutes late or in the junk folder.
**Required outcome.** The activation does not depend on the owner reacting within the
window; it depends on the run ending in a safe state without him. The human-recorded alert
confirmation (ACT-11) is the precondition covering deliverability; hourly reminders cover
a single missed mail. Record notes the expected number of drill alerts so the owner can
reconcile his inbox afterwards.
**Severity if violated.** B.

### ACT-52 — The hourly reminder storm during the full-silence drill annoys or confuses
**Sequence.** Three checks down for ~50 minutes produce a cluster of emails late at night.
**Required outcome.** Expected and pre-announced in the record; the pause step exists partly
to stop the reminders. Cosmetic only, as long as the owner can tell drill mail from real
mail — which requires the drill window to be recorded with its start and end times.
**Severity if violated.** C.

### Brokerage, market and the certificate

### ACT-53 — The certificate run hangs with no verdict
**Sequence.** A broker API call blocks; at 16:30 the run has produced neither PASS nor FAIL.
**Required outcome.** A hard timeout (bounded by the 20–40 minute expectation plus margin)
turns "no verdict" into FAIL-closed, not into a wait that consumes the day. The dev account
must then be checked for residue from the aborted run (partially filled or resting orders),
and that check's outcome must be recorded. Nothing is armed.
**Severity if violated.** A (a hang that silently reaches 22:10 could otherwise arm on a
stale assumption).

### ACT-54 — Market closed unexpectedly: holiday or an early close
**Sequence.** Monday turns out to be a US holiday, or a half-day with a 19:00 Berlin close.
**Required outcome.** The certificate run needs a live session; if the session is not open,
it must refuse to start rather than produce a PASS from a closed market. The script detects
"session not open at 15:35" as a precondition failure, records it, pages a low-urgency
notice, and proposes the next trading day. Nothing armed.
**Severity if violated.** A (a PASS certified against a closed market is a false
certificate).

### ACT-55 — A trading halt or the broker's paper venue misbehaves mid-certificate
**Sequence.** The instrument halts, or the paper engine stops filling.
**Required outcome.** The certificate ends FAIL or inconclusive — never PASS with an
asterisk. Inconclusive is treated exactly like FAIL for arming purposes, and the record says
which of the two it was and why.
**Severity if violated.** A.

### ACT-56 — The development account is not flat because of a leftover *position*
**Sequence.** A closing leg did not fill; a short option position remains overnight.
**Required outcome.** Abort before `.env`, page with the position detail. Additionally the
defined-risk invariant matters here: an unpaired short leg on the dev account must be
reported as an explicit risk finding, not just as "not flat".
**Severity if violated.** A.

### ACT-57 — Broker API auth expires or the wrong profile is selected
**Sequence.** The token for the development profile is stale, or an environment default
silently points at the competition account.
**Required outcome.** Every brokerage call resolves its account from the explicit profile
and asserts the resolved account identity **before** acting; a mismatch or an unresolvable
profile aborts immediately. The record names the resolved account identifier (masked) for
each step so a later reader can prove the competition account was untouched.
**Severity if violated.** A.

### ACT-58 — The broker resets or reconciles the paper account overnight
**Sequence.** Between Monday's certificate and Tuesday's gate the paper account's balances
or positions are reset by the provider.
**Required outcome.** The gate does not depend on Monday's account snapshot; anything it
needs it re-reads Tuesday. The record distinguishes "flat as observed Monday 16:10" from
"flat now".
**Severity if violated.** B.

### Files, tools and the deployment

### ACT-59 — `.env` is edited concurrently by the owner or another tool
**Sequence.** The owner opens `.env` in an editor at 21:55 and saves at 22:05, after the
script wrote the certificate path.
**Required outcome.** The script re-reads and verifies the certificate path immediately
before the enable step, and the digest check catches the change (ACT-25). Lost-update on
`.env` must be detectable: record the file's hash after writing and compare later.
Duplicate keys in `.env` (two lines for the same variable) must be rejected, not
last-one-wins.
**Severity if violated.** A.

### ACT-60 — Disk full during the activation
**Sequence.** The record append, the certificate file write, or the wrapper log rotation
fails with no space.
**Required outcome.** Fail closed and page (see ACT-44). Free-space is a checkable
precondition and should be checked at step 0, because the failure mode of a full disk is a
run that appears to work and documents nothing.
**Severity if violated.** A.

### ACT-61 — The scheduler verification tool itself fails or is missing
**Sequence.** Tue 14:45 the tool throws, returns a non-zero code with no parseable output,
or has been renamed.
**Required outcome.** Tool failure is **not** a green gate and **not** a skipped criterion:
it is an unknown, so the gate is red, both tasks are disabled and the owner is paged with
"gate could not be evaluated". The record distinguishes "tool ran and said no" from "tool
did not run".
**Severity if violated.** A.

### ACT-62 — The wrapper log the gate reads has rotated, is in UTC, or is empty
**Sequence.** The 14:00 entry is in yesterday's rotated file, or the lookup uses local time
against UTC stamps.
**Required outcome.** The gate's log lookup is explicit about timezone conversion and about
which files it searched, and records both. "Not found" must be accompanied by the search
window and file list so a later reader can tell a lookup bug from a genuine miss.
**Severity if violated.** B (false green would be A).

### ACT-63 — The reboot step runs while the owner is mid-work on his everyday machine
**Sequence.** Tue 13:30 the owner is unexpectedly at home with unsaved work open.
**Required outcome.** The reboot is announced in advance (calendar entry, on-screen warning
with a short delay) and is logged; forced closure of the owner's applications is a C-class
annoyance but must not be a surprise. The reboot must not be silently skipped because a
session is active — skipping would invalidate the restart proof, so skipping is a recorded
abort, not a shrug.
**Severity if violated.** C for the interruption; A if the reboot is silently skipped and
the gate still passes.

---

## Group 4 — The record and its later reader

The reader is a fresh assistant session with no memory, possibly days later, possibly
woken by an alert email at 22:00. Each scenario below is a question that reader must be
able to answer, and the failure mode when the record does not support it.

### ACT-64 — "Which phase is the activation in, and what was the last completed step?"
**Sequence.** A reader opens the record cold, at an arbitrary point between Monday 15:35
and Tuesday 15:15.
**Required outcome.** The answer is derivable from the record's tail alone, in bounded
reading: every entry carries timestamp with offset, attempt id, step id, intent
("about to do X") **and** result ("X succeeded/failed, evidence Y"). A step with an intent
line but no result line reads unambiguously as "interrupted during X". No reader should have
to infer phase from the absence of something.
**Severity if violated.** B.

### ACT-65 — "Is anything armed right now?"
**Sequence.** The reader must decide whether the trading task is enabled and whether the
next session could trade.
**Required outcome.** The record states the last **observed** task states with the time of
observation, and states plainly that observations age: the reader's procedure is
record-then-verify (query Task Scheduler and the three checks) with the world overriding the
record on conflict. A record that invites "the file says disabled, so we are safe" without
telling the reader to verify is itself the defect.
**Severity if violated.** A.

### ACT-66 — "Is a retry safe, and does it need a new certificate?"
**Sequence.** The reader finds an abort entry from the previous day.
**Required outcome.** Each abort entry carries: the failing condition, whether the
certificate is still valid (verdict, path, digest at abort time), what residue exists
(dev-account positions/orders, `.env` state, paused checks, disabled tasks), and the
resume point. The certificate-FAIL case must be explicitly marked as "new certificate
required" — the one exception to retry-without-recertifying.
**Severity if violated.** A (a reader who retries on an invalidated certificate arms
outside the pre-authorised condition).

### ACT-67 — Append-only integrity: retries, interleaving, and a tampered or regenerated record
**Sequence.** Three attempts across Monday, Tuesday and Wednesday write into one file; at
some point someone (human or assistant) "cleans up" the file or a crashed instance
re-writes a header.
**Required outcome.** Entries are only ever appended; corrections are new entries that
reference the entry they correct, never edits. Monotonic sequence numbers plus per-entry
timestamps let a reader detect gaps, reordering or truncation. Attempt boundaries are
explicit, so entries from different attempts cannot be read as one sequence. A reader that
finds an integrity break must treat the whole state as unknown and fail closed.
**Severity if violated.** A.

### ACT-68 — Drill-induced alarms must not read as faults, and faults must not read as drills
**Sequence.** The owner (or a later reader) sees three "check went down" emails timestamped
Monday 23:05.
**Required outcome.** The record delimits each drill with start and end entries naming the
expected down-set and the expected alert count, so email and record reconcile. Conversely,
a genuine fault occurring during a drill window must still be distinguishable — the drill
entry states what was expected, and anything beyond that set is an incident. "It was
probably the drill" must never be the only available reading.
**Severity if violated.** A (a real halt dismissed as drill noise leaves the owner unaware).

### ACT-69 — Time and secrets in the record
**Sequence.** The reader compares record entries (local time) against wrapper logs (UTC) and
against healthchecks.io timestamps, and the record was written by a script handling API
keys and ping URLs.
**Required outcome.** Every timestamp carries an explicit offset; where an entry quotes a
log line, it quotes it with its original UTC stamp **and** the converted local time. No ping
URL, API key, token or full account number appears in the record — only stable
fingerprints that let a reader confirm identity without disclosing the secret, and the
record must not be the place where a credential leaks into a repository or a transcript.
**Severity if violated.** B for time ambiguity; A for a leaked credential (and stop-and-report,
not silent cleanup).

### ACT-70 — "There is no record (or it stops abruptly) — what does that mean?"
**Sequence.** The reader finds no file, an empty file, or a file whose last entry is hours
old with nothing following.
**Required outcome.** The distinction "never started" / "started and died" / "record lost"
must be recoverable: the first entry of every attempt is written **before** any world
change, so the existence of any world change without a record is itself the signal. A
missing or stale record means fail closed — disable both tasks, page, and record the
recovery as a new attempt. Every entry that ends an attempt names the owner's next action
in one sentence, so the reader can answer "what must the owner do now" without inventing it.
**Severity if violated.** A.

---

## Invariants distilled from the catalogue

1. **Arming requires the full triple.** Certificate PASS **and** dev account flat **and**
   green gate — verified, not assumed; anything else ends disabled and paged.
2. **Unknown is never green.** An unreachable API, a crashed tool, a missing log entry and a
   timed-out step all count as failure, never as "probably fine".
3. **Every exit is safe.** No path — crash, abort, power cut, permission error, double
   invocation — may end with the trading task enabled but unvalidated.
4. **Fail closed loudly.** Every abort disables both tasks *and* pages the owner with the
   reason; a failed disable is itself an alarm-worthy event.
5. **Observe, don't assume.** Task and check states are read from the world before every
   decision; the world overrides the record on conflict, and the conflict is recorded.
6. **Enabled ≠ running.** Only an actual firing with its ping and log line proves the
   scheduled task works under S4U.
7. **A named clock time is not satisfied by a catch-up run.** Gate criteria that name a
   time must be met by that firing, not by a delayed replay.
8. **One instance at a time** — for the activation script and for the trading cycle alike;
   concurrency near a brokerage account is an A-class surface.
9. **The certificate binds code and configuration**, the digest is recorded on both sides of
   every comparison, and a mismatch invalidates arming before the runtime ever sees it.
10. **Only the development account is touched**; the competition account and the public
    dashboard are out of scope for every step, and each brokerage step records the account
    identity it resolved.
11. **Drills must be unambiguous or invalid.** A check that could be down for two reasons
    proves nothing; drill windows, expected down-sets and expected alert counts are recorded
    in advance.
12. **Blindness is time-boxed.** Paused checks and disabled tasks are the only states in
    which nothing can alarm; they exist for minutes, are recorded, and never survive an
    abort unannounced.
13. **The record is append-only, self-contained and crash-tolerant** — intent before action,
    result after, one entry per line, monotonic sequence, torn tails detectable, corrections
    as new entries.
14. **A cold reader can answer five questions from the record plus a verification query:**
    which phase, last completed step, what is armed right now, is a retry safe (and does it
    need a new certificate), what must the owner do now.
15. **No secrets in the record** — fingerprints only; a credential found anywhere means stop
    and report.
16. **Precondition confirmations come from a human**, never from the script certifying
    itself; a missing or stale confirmation blocks arming.
17. **A late start only shortens the run.** The configured end date is never moved by a
    retry, and a retry never silently lowers the arming bar.




