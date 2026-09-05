# P12 — how an incident actually reaches me

Written 2026-09-05, before activation. The runbook says which checks to create;
this file answers the different question: **when something breaks, who notices,
what arrives on my phone, and how long does it take.**

Nothing below is a claim that alerting works on the real host. Every signal in
here was exercised against a real HTTP endpoint from this machine
(`tools\check-alert-path.ps1`, six signals, all `[SENT]`), and the state
transitions were exercised by test. What is *not* proven until owner step 3 is
the last hop: that the notification actually lands on a device I look at. HTTP
200 is delivery to the service, not receipt by me.

## The three checks and their clocks

The installer derives these from the trigger it registers; the values below are
what `install-scheduled-task.ps1 -WhatIf -CoverageThroughDate 2026-12-09`
printed on this machine on 2026-09-05.

The names are the ones the runbook has you create, and they are how a push
notification maps to a row here:

| Check | Pinged by | Expected schedule (Europe/Berlin) | Grace | Worst-case detection |
|---|---|---|---|---|
| `gbt-liveness` | `tools\cycle-run.ps1`, every firing, session or not | `0,15,30,45 14-23 * * 1-5` | 30 min | 45 min |
| `gbt-readiness` | `dist\shell\readiness-cli.js`, every firing | `0,15,30,45 14-23 * * 1-5` | 50 min | 65 min |
| `gbt-watchdog` | `tools\watchdog-run.ps1`, every firing | `0,5,...,55 14-23 * * 1-5` | 15 min | 20 min |

**Worst-case detection** is one full period plus the grace: the failure begins a
second after a good ping, so the next expected ping is a whole period away and
the service waits out the grace on top of that. The best case is the grace alone.

**Delivery** is a separate budget: `ALERT_DELIVERY_BUDGET_MS` is 10 minutes.
In practice healthchecks.io sends within seconds of the transition; the ten
minutes is what the design is allowed to assume, not a measurement of their
queue.

Three properties of these schedules matter more than the numbers:

- **A failed ping is immediate, a missing ping is timed.** When a wrapper posts
  to the check's `/fail` path, the check goes down at once and the notification
  is sent then — no grace is waited. Grace governs *silence* only.
- **Silence outside the expression never alerts.** Nights and weekends: the cron
  expects nothing, so nothing is missed. An incident that starts Friday at 23:46
  is detected on **Monday** — watchdog at 14:15, liveness at 14:30, readiness at
  14:50. This is deliberate (an agent that trades only the US session must not
  page me every Saturday) and it is the price: a whole silent weekend is
  indistinguishable from a healthy one.
- **Repetition is an account setting, not a property of the check.**
  healthchecks.io sends one notification when a check goes down and one when it
  recovers. Recurring reminders while it stays down exist as hourly or daily
  "down" reminders in the account's report settings — **switch that on during
  owner step 3** and confirm one arrives. Without it, a single push missed at
  22:00 is a silent night. Which tier that setting belongs to is unverified.

## Case 1 — the machine is off, asleep, or has no internet

**Who notices:** healthchecks.io, and nothing else. That is the entire reason
the alerting endpoint is off-host: no watchdog, no scheduled task and no process
on this machine can report its own absence.

**What appears:** nothing. All three checks stop pinging at the same moment.

**When:** inside a running session the watchdog check goes down first (worst
case 20 min), then liveness (45 min), then readiness (65 min). **Three
notifications in that order, from three different checks, is itself the
fingerprint of a whole-machine outage** — a single failing component takes
exactly one of them down. If the outage starts outside the session window, the
clock does not start until the next weekday at 14:00 Berlin.

**How I see it:** the channel configured in step 3, once per check; repeated
only if the down-reminder setting is on.

**What closes automatically: nothing.** Not one line of this system runs. In
particular:

- Open positions stay open. There is no server-side stop. The defined-risk
  structures cap the loss at what was reserved at entry, and that cap is the
  only thing still working while the machine is off.
- If the machine is off on `FLATTEN_DATE` (2026-12-09), the book is **not**
  flattened. The ladder needs a process. That is an owner intervention, and it
  is bounded by the same market hours as everything else: bring the machine up,
  or close whole structures in the broker dashboard — **but only while the US
  session is open**, 15:30–22:00 local. After 22:00 neither the agent nor you
  can place an option order, and the flatten becomes the next trading day's
  first task.
- The dead-man watchdog cannot help, because it is a scheduled task on the same
  machine. A watchdog that dies with its host is not a fallback for its host,
  and this document does not pretend otherwise.

## Case 2 — the agent process hangs, or exits with an error

Two failures with two different signal shapes.

**Exit with an error.** `cycle-run.ps1` captures the exit code and posts
liveness to `/fail` with the note `cycle exit <n>`; the check goes down
**immediately**, so this is detection within the delivery budget rather than in
45 minutes. Separately `agent-cli.js` fail-pings the readiness endpoint with
`STARTUP_REFUSED:<stage>` or `CYCLE_ABORTED` — added because a startup refusal
(a missing analyst manifest, an unusable state directory) used to journal its
halt and send the endpoint nothing at all. An erroring cycle therefore usually
lights up **two** checks, and the readiness body names the stage.

**Hang.** No ping is written, because the wrapper is still inside the child
process. Three bounds apply in order:

1. The agent's own wall-clock budget, `CYCLE_WALLTIME_BUDGET_MS` = 5 min.
2. The task's `ExecutionTimeLimit` = 10 min, at which the Task Scheduler kills
   the whole wrapper. A killed wrapper posts nothing — not even a failure.
3. `MultipleInstances = IgnoreNew`: while one run hangs, later firings are
   dropped rather than piling up.

A **refusal by the wrapper itself** — no `STATE_DIR`, no node on PATH, an
unbuilt `dist` — is a third shape, and until R44 it was the worst one: it threw
before the sender existed, so the scheduler fired and nothing was reported at
all. It now posts a liveness failure carrying the reason, verified against a
real endpoint (one `POST /liveness/fail :: wrapper refused: …`).

A hang therefore shows up as **silence**, and silence is the timed path:
liveness down at worst 45 minutes after the last good ping. If the hang recurs
on every firing, the check stays down and never recovers on its own.

**What closes automatically:** the hung cycle is killed by the scheduler inside
10 minutes and the next firing starts clean — the kernel mutex and the epoch
store make a half-finished cycle safe to abandon. What is *not* automatic is any
position that cycle was about to manage; the watchdog covers that separately
once the journal goes stale past `DEAD_MAN_BOUND_MS` (50 min).

## Case 3 — the agent runs, but stands under a halt or a credential fence

This is the case that motivated two signals instead of one (axiom A31).

**Liveness stays green, and that is correct.** The scheduled invocation
happened, the wrapper ran, the process exited 0. Liveness claims exactly that
and nothing more. A system with only a heartbeat would look perfectly healthy
here while trading nothing for three months.

**Readiness goes red.** `readiness-cli.js` reads the standing impediment and the
durability of the state directory on **every** firing and posts to `/fail` with
the conditions named in the body:

- `HALT_STANDING:<reason>` — for example `WATCHDOG_TAKEOVER`, `AUTH_FAILURE`,
  `DEADLINE_FLATTEN_FAILED`.
- `CREDENTIAL_FENCE_UNRELEASED` — added alongside the halt when the fence mark
  is set.
- `STATE_NOT_DURABLE:<reason>` — the journal, epoch store or halt projection
  cannot be written. Since R44 the probe writes and flushes a byte rather than
  only checking permissions, so a **full disk** reaches this line too.
- `AUTHORITY_STATE_UNREADABLE` — `epoch.json` no longer parses, so every
  acquisition would refuse.
- `JOURNAL_CORRUPT:line <n>` — a journal line no longer parses, so every
  writer would refuse. Both of these used to report readiness **success**.

**When:** at the next firing, so at most 15 minutes, plus delivery. Because
readiness reports on every firing rather than only on the ones that run a cycle,
a halt at three in the morning is reported at 14:00 and heard **before** the
open rather than after it.

**Does it heal by itself? No, and that it once did was a defect.** A later
successful append used to clear the picture, and the deadline one-shots used to
post a *success* over a standing halt in all four combinations of {journaled
halt, marker-only fence} x {reconciliation, terminal}. All three runtimes now
read the same `standingImpediment`, so the check stays red until a human runs
`node dist\shell\unhalt-cli.js` with `--operator`, `--reason`, `--confirm`
and — whenever a halt is journaled — `--expect-halt-seq <n>`, which the CLI
now requires rather than merely offers, so the release applies to the halt I
actually read and refuses if another one landed in between. Nothing else
clears it, by design: the fence exists precisely because an automatic release
would defeat it.

**What closes automatically with invalid broker credentials: nothing, and
deliberately less than nothing.** A 401 or 403 from the broker is not a
transient error to retry through. `dispatchSafetyHalt` journals a halt *and*
sets the durable fence mark on `AUTH_FAILURE`, so even a restart with a fresh
state projection stays fenced. The agent will not place, amend or close an order
until I release it by hand. If that happens with an open book, the risk cap set
at entry is again the only thing still working. Closing early means the broker
dashboard **and an open US session**: outside 15:30–22:00 local there is no
order to place, so the honest answer at 23:00 is to write down what is open and
act at 15:35 on the next trading day, five minutes after the open — see the
Friday case at the end of this document, which is the same situation on a worse
day.

One honest limit: with the journal, the epoch store *and* the halt projection
all unwritable at the instant of rejection, and full recovery afterwards, no
mark survives that recovery. The alarm is the handover in that case — which is
why `STATE_NOT_DURABLE` is a readiness condition and not a log line.

## Case 4 — only the watchdog task fails

**Who notices:** the watchdog's own check, and only it. Before R43 there was no
such check, and nothing else could have noticed: liveness is written by the
cycle wrapper and readiness by `readiness-cli.js` from the state files, so
**both stay green with the watchdog task disabled, unregistered or crashing**.
That is a property of where the two signals come from, not an observation of one
outage — the safety net was the component whose failure was structurally
invisible. What *was* executed is the third endpoint itself: its success and its
failure signal both went over real HTTP in `tools\check-alert-path.ps1`.

**What appears:** the third check stops being pinged. `watchdog-run.ps1` posts a
heartbeat on every firing — success on exit 0, `/fail` otherwise — so a watchdog
that crashes reports its own failure at once, and a watchdog that is disabled,
unregistered or never triggered goes down by timeout.

**When:** 5-minute period, 15-minute grace, so **20 minutes worst case** — the
fastest of the three, because a missing watchdog is the failure that leaves the
least behind.

**What closes automatically: nothing, and nothing is broken yet either.** A
missing watchdog does not stop trading; it removes the recovery that would have
fenced, halted and flattened a stale deployment. The right response is therefore
not urgency but promptness: re-enable the task, confirm the check turns green,
and check whether a stale journal accumulated meanwhile.

## The summary I actually need at 23:00

**Answer one question before reading the table: is the book exposed?** Run
`node dist\shell\readiness-cli.js` and open the broker dashboard. A flat book
turns every row below into something that can wait for the morning; an open
book with a standing halt cannot, because nothing will close it by itself.

| What broke | First check to go red | Worst case | Heals itself? | Tonight, or tomorrow? |
|---|---|---|---|---|
| Machine off or offline | `gbt-watchdog`, then `gbt-liveness`, then `gbt-readiness` | 20 / 45 / 65 min | no | tonight if the book is open, otherwise tomorrow |
| Cycle exits with an error | `gbt-liveness` (immediate `/fail`) and `gbt-readiness` | delivery only | no, if it recurs | tomorrow, unless it is the third in a row |
| Cycle hangs | `gbt-liveness` (silence) | 45 min | the kill is automatic, the cause is not | tomorrow |
| Halt or credential fence | `gbt-readiness` | 15 min + delivery | **never** — release is manual by design | tonight if the book is open |
| `DEADLINE_FLATTEN_FAILED` on 2026-12-09 | `gbt-readiness` | 15 min + delivery | no | **tonight, before the US close** |
| Watchdog alone | `gbt-watchdog` | 20 min | no | tomorrow morning — promptness, not urgency |

Outside 14:00–23:45 Berlin on weekdays, every row above waits for the next
weekday at 14:00. That is the deliberate cost of not being paged on weekends.

**The Friday-evening case, stated because the silence rule creates it — and
because the obvious answer to it is wrong.** An alert arriving Friday at 23:00
with an open book is one of the three situations in which the prohibition on
manual trading lifts (the list is in the runbook, under *Manual intervention*).
It is also a situation in which **there is nothing you can do that evening**:
options trade only in the regular US session, 09:30–16:00 New York, and this
broker offers no extended-hours session for them. Friday 23:00 local is 17:00
in New York. The market closed an hour ago; no order will be accepted, by the
agent or by you.

An earlier version of this document told you to close the structures anyway.
That instruction could not be carried out, and an instruction that cannot be
carried out is worse than none: it costs the half hour you spend discovering
that, at the exact moment you most want to be doing something.

So, concretely:

* **Write down what is open** — which structures, which expiries, and what the
  alert said. `node dist\shell\readiness-cli.js` names the impediment; the
  broker dashboard shows the book, and reading it is always possible even when
  trading is not.
* **Set an alarm for 15:35 local on the next trading day** — five minutes
  *after* the open, which is 15:30 local, or 14:35 in the week between the two
  clock changes — and decide then with the book in front of you.
* **What carries an INTACT structure until then is the structure itself.**
  Every position this agent opens has a maximum loss fixed at entry, and while
  all its legs are there that cap cannot grow over a weekend. That is the whole
  reason the strategy is defined-risk, and this is the hour in which that
  choice pays for itself.
* **A residue is the exception, and it is not a small one.** A share position
  from an assignment, or a short leg whose long wing expired, is outside that
  cap — the spec's own S-X-06 is the assignment exception to A23's
  constructive worst case, which is why the runner raises
  `UNBOUNDED_RESIDUE_RECOVERY` and closes such a residue with no price cap. A
  short share residue is unbounded. Options still cannot be traded after
  22:00 local, but a share residue is an equity position and equities have
  extended-hours sessions; whether an order is accepted depends on the broker
  and the order type, so look rather than assume. This is the one thing in this
  document that can get materially worse while you sleep.
* **The exception to the wait** is an expiry inside the silence: a structure
  expiring on the Monday needs the Monday open, not the Monday afternoon.
  Note the earliest expiry in the book beside the alarm.

A flat book on Friday evening waits for Monday and needs no alarm at all.
