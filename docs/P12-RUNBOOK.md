# P12 runbook — the three-month paper run

Prepared 2026-09-05, revised after two blind gate rounds. Everything that could
be done without the owner is done, committed and pushed. What remains needs an
account, a secret, a notification channel or a supervised market-hours slot, and
is in **[Owner steps](#owner-steps)** with a latest time for each.

**Purpose:** operational reliability and economic plausibility over a quarter.
What the run cannot answer is in [`P12-EVALUATION.md`](P12-EVALUATION.md).

**Three states are kept apart throughout this document and must stay apart:**

| State | Means |
|---|---|
| **prepared** | the code exists and is committed |
| **proven by test** | a test or an executed probe demonstrates it in this repository |
| **live on the host** | registered, enabled and observed on the real machine, with the alert received on the owner's own device |

Nothing below is **live on the host** yet. The tasks are registered disabled or
not at all; `tools/install-scheduled-task.ps1` no longer enables anything unless
`-Activate` is passed, so *installing is not activating*.

---

## The dates

The rule, applied in this order: **fix the first regular cycle first, derive the
flatten date from it, then certify.** Three calendar months from the first
regular cycle.

| Event | When | Note |
|---|---|---|
| Account, secrets, notification channel | by **Mon 2026-09-07, 22:00** | owner steps 1–3 |
| Certificate run four (dev account, supervised) | **Tue 2026-09-08**, from 15:30 CEST | owner step 4 |
| Install + verify | Tue 2026-09-08, after PASS | owner step 5 |
| Activation gate (drills, restart, signed out) | Tue 2026-09-08 22:10 CEST → Wed 2026-09-09 15:05 CEST | owner step 6 — outside every session, so nothing trades |
| **First regular cycle** | **Wed 2026-09-09**, the 15:15 CEST firing, supervised | owner step 7 — the anchor |
| `FLATTEN_DATE` | **Wed 2026-12-09** | three calendar months |
| Journaling-only day | Thu 2026-12-10 | |
| `TERMINAL` and shutdown | after the Thu 2026-12-10 US close | |

The certificate and the first regular cycle are **different days on purpose**:
the first cycle may only happen after PASS *and* after the activation gate, and
squeezing both into one afternoon turns a gate into a formality.

**If the start slips.** The flatten date moves with it — three calendar months
from the first regular cycle, always. Changing `FLATTEN_DATE` edits
`config/policy.json`, which changes the **policy digest**, which **voids the
certificate**, because the arming gate compares the deployment's policy digest
with the certificate's. So a slip means: change the date, *then* certify, *then*
arm. There is no exception, including a slip of a single day.

---

## Owner steps

Every block below is meant to be pasted as-is. Each says which shell it needs.
**No step asks you to print a secret**, and nothing here should be copied back
into a chat.

### 1. Create the fresh paper account — by Mon 2026-09-07, 22:00

*No shell. Alpaca web UI.*

A new Alpaca **paper** account, used by nothing but this agent, created **on or
after 2026-09-06T00:00:00Z — that is Sunday 06.09.2026, 02:00 Europe/Berlin.**
The S-CYC-09 provenance proof requires the creation instant to be at or after
`COMPETITION_START`. An older account makes the bootstrap refuse — and it does
so at the **anchor cycle** on Wednesday, after the certificate and the whole
activation gate, because nothing before that reaches the broker's account
history. There is no earlier check; the defence is to create the account after
Sunday and write its creation timestamp into `STATE.md` now, so the later
refusal is one line to look up rather than an investigation.

If it does refuse: **do not edit `COMPETITION_START`.** That changes the policy
digest, which voids the certificate, and it would also make the proof accept an
account that was in use before this run — which is the one thing it exists to
prevent. Create a new account and move the anchor (procedure at the end of
owner step 6).

Enable options level 3 (multi-leg). Never trade on it by hand while the agent
operates — a manual mutation is detectable only one cycle later (owner ruling
2026-09-02, S-CYC-05).

### 2. Secrets and the new state directory — with step 1

*Normal PowerShell. Working directory: the checkout.*

Edit `.env` in an editor (it is gitignored; `.env.example` documents the shape).
Set:

```
ALPACA_PROFILE=competition
ALPACA_COMP_KEY_ID=<the new account's key>
ALPACA_COMP_SECRET_KEY=<the new account's secret>
ALPACA_COMP_ACCOUNT_ID=<the new account number>
STATE_DIR=C:\Users\felix\glass-box-state\longrun-1
BOOTSTRAP_DIAGNOSTIC_SINK=C:\Users\felix\glass-box-state\longrun-1-bootstrap.log
```

Then create the directory — it must be **new and empty**; the competition
journal is a closed archive and the long run must not inherit it:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
New-Item -ItemType Directory -Force C:\Users\felix\glass-box-state\longrun-1 | Out-Null
Get-ChildItem C:\Users\felix\glass-box-state\longrun-1   # expect: nothing
```

The check below runs the compiled loader, so build first — `dist/` is stale or
absent after a fresh clone or a `git pull`, and the error you would otherwise
get ("Cannot find module ./dist/shell/runtime-config.js") is not a
configuration problem:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
npm.cmd run build   # npm.cmd, not npm: npm.ps1 is blocked by this host's execution policy
```

Building here is safe and changes nothing the certificate depends on: the
certificate covers the content of `src/`, `config/` and the package files, not
the moment you compiled them.

Check the configuration without printing any secret. This is the **step 2**
check, so it asks only for what step 2 sets — the ping URLs come from step 3
and `PRE_ARM_CERTIFICATE` from step 4, and demanding them here would abort a
correct run (R44-B14):

```powershell
node -e "const {loadEnvironment}=require('./dist/shell/runtime-config.js');const e=loadEnvironment(process.cwd(),process.env);for(const k of ['ALPACA_PROFILE','ALPACA_COMP_ACCOUNT_ID','ALPACA_COMP_KEY_ID','ALPACA_COMP_SECRET_KEY','STATE_DIR','BOOTSTRAP_DIAGNOSTIC_SINK'])console.log(k.padEnd(28), /KEY|SECRET|TOKEN|URL/.test(k)?(e[k]?'<set>':'<MISSING>'):(e[k]??'<MISSING>'))"
```

**Abort if:** `ALPACA_PROFILE` is not `competition`, or any of these six reads
`<MISSING>`, or `STATE_DIR` still ends in `competition-2` — that is the
hackathon deployment's state directory, a closed archive of 105 journal
entries. The long run must not inherit it, and appending to it would destroy
the record of a finished run.

The same command with the later keys is the **step 5** gate, run after step 3
and step 4 have produced them, immediately before installing:

```powershell
node -e "const {loadEnvironment}=require('./dist/shell/runtime-config.js');const e=loadEnvironment(process.cwd(),process.env);for(const k of ['PRE_ARM_CERTIFICATE','HEALTHCHECK_PING_URL','HEALTHCHECK_LIVENESS_URL','HEALTHCHECK_WATCHDOG_URL'])console.log(k.padEnd(28), /KEY|SECRET|TOKEN|URL/.test(k)?(e[k]?'<set>':'<MISSING>'):(e[k]??'<MISSING>'))"
```

**Abort if:** any of those four reads `<MISSING>` at that point.

### 3. The three notification checks — by Mon 2026-09-07, 22:00

*Browser, then normal PowerShell.*

At healthchecks.io, create **three** checks and name them exactly
**`gbt-liveness`**, **`gbt-readiness`** and **`gbt-watchdog`**. The names are
not decoration: at 23:00 the check name in the push notification is the only
thing that tells you which row of
[`P12-INCIDENT-PATHS.md`](P12-INCIDENT-PATHS.md) you are in.

The third check exists because the other two cannot see the watchdog: liveness
comes from the cycle wrapper and readiness from the state files, so a watchdog
that is disabled or broken leaves both green.

Get the exact schedules — the installer derives them from the trigger it will
register, so they match the real firings rather than an approximation:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
.\tools\install-scheduled-task.ps1 -WhatIf -CoverageThroughDate 2026-12-10
```

It prints, before the registration preview, a cron expression, an **IANA**
timezone (`Europe/Berlin`, read from this host through node — healthchecks.io
does not accept the Windows name `W. Europe Standard Time`) and a grace for each
of the three checks. This preview runs in a **normal** shell: since R44-B12 it
prints the schedules before it touches anything that needs elevation.

Configure the checks with **exactly** those values, set each check's schedule
type to "cron", and point all three at the channel you will actually see at
night. **Also switch on the account's recurring "down" reminder**, hourly if the
account offers it — a check sends one notification when it goes down and one
when it recovers, so without the reminder a single push missed at 22:00 is a
silent night. If the setting is not available on this account, that is a finding
to write into `STATE.md`, not a reason to stop: the run proceeds with one
notification per transition, and you note that a missed push is a missed
incident.

Then put the ping URLs into `.env`. **Getting these three the wrong way round is
the one mistake nothing later catches**, because every check would still be
green — copy each URL directly from its own check page and re-read the names:

```
HEALTHCHECK_PING_URL=<readiness check ping URL>
HEALTHCHECK_LIVENESS_URL=<liveness check ping URL>
HEALTHCHECK_WATCHDOG_URL=<watchdog check ping URL>
```

Now exercise the path and **confirm receipt on your own device**:

```powershell
.\tools\check-alert-path.ps1
# expect: six [SENT] lines and "ALERT PATH DELIVERED"
# then wait for three alerts on your phone or mail, and read their bodies
.\tools\check-alert-path.ps1 -ResolveOnly
# expect: three [SENT] lines, and all three checks green again
```

**Abort if:** any signal says `UNDELIVERED` or `NOT CONFIGURED`, or an alert
does not arrive. HTTP 200 is delivery, not receipt.

Then confirm the reminder itself: leave **`gbt-watchdog`** down for one
reminder period and check that a **second** message arrives. Resolve it
afterwards with `.\tools\check-alert-path.ps1 -ResolveOnly`. If no second
message arrives, the setting is not on, or not on that channel — see above:
note it and continue.

**Then pause all three checks in the dashboard.** They now have cron schedules
and nothing will ping them until Tuesday 22:10, so left running they would go
down on Monday evening and stay down for a day, with the reminder waking you
hourly through the night. Step 6 un-pauses them.

The silence drills are separate and cannot be scripted. Do them in step 6.

### 4. Certificate run four — Tue 2026-09-08, US market hours, supervised

*Normal PowerShell. Working directory: the checkout.* This runs on the **dev**
account against the final configuration; nothing in `config/` may change
afterwards.

The block sets dev values for this run only and restores your session afterwards
**even if it fails**:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading

# Make sure no scheduled task can run while the certificate does.
Get-ScheduledTask -TaskPath '\GlassBoxTrading\' | Select-Object TaskName, State
# expect: both Disabled, or a red "no MSFT_ScheduledTask objects found" error --
#   not being registered at all is the good outcome here, not a failure.
# If either reads Ready, run these two lines from an ELEVATED shell first:
#   Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
#   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'

$saved = @{}
foreach ($name in 'ALPACA_PROFILE','STATE_DIR','BOOTSTRAP_DIAGNOSTIC_SINK','PRE_ARM_CERTIFICATE') {
    $saved[$name] = [System.Environment]::GetEnvironmentVariable($name)
}
try {
    $env:ALPACA_PROFILE            = 'dev'
    $env:STATE_DIR                 = 'C:\Users\felix\glass-box-state\dev'
    $env:BOOTSTRAP_DIAGNOSTIC_SINK = 'C:\Users\felix\glass-box-state\dev-bootstrap.log'
    $env:PRE_ARM_CERTIFICATE       = ''
    npm.cmd run certificate -- --owner-go   # npm.cmd, not npm: npm.ps1 is blocked by this host's execution policy (R44-B16)
} finally {
    foreach ($name in $saved.Keys) {
        if ($null -eq $saved[$name]) { Remove-Item "env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "env:$name" $saved[$name] }
    }
    Write-Host 'dev environment variables restored for this shell.'
}
```

**Expect:** `verdict: PASS` and a printed certificate path under
`evidence/pre-arm/`. The run takes roughly 20-40 minutes; if it has printed
nothing for 15 minutes, Ctrl-C it — the `finally` block still restores your
shell — and treat it as a failed verdict.

Then confirm the dev account is flat, which the certificate does not print:

```powershell
node dist\shell\readiness-cli.js
# expect: "readiness: success (no halt, no fence, state writable)"
```

and open the Alpaca dashboard for the **dev** account: zero positions, zero
open orders.

**Abort if:** the verdict is anything but PASS, or the dev account is not flat.
Either way the anchor moves — the procedure is at the end of owner step 6.

Then put that path into `.env` as `PRE_ARM_CERTIFICATE=` — the absolute path
exactly as printed, without quotes — and run the **second** check from step 2,
the one that asks for the certificate and the three ping URLs. **Close this PowerShell window** before step 5,
so no dev variable can survive in it.

### 5. Install the tasks — Tue 2026-09-08, after PASS

*Elevated PowerShell ("Run as administrator").* Registration needs it.

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
npm.cmd run build   # npm.cmd, not npm: npm.ps1 is blocked by this host's execution policy (R44-B16)
.\tools\install-scheduled-task.ps1 -CoverageThroughDate 2026-12-10
```

**Expect:** `SCHEDULE COVERAGE OK`, then both tasks registered **and
immediately disabled** — the output says so. It refuses to register at all if
the trigger window does not provably contain every exchange session through the
given date. The date is **2026-12-10**, the journaling-only day, not the flatten
date: firings are still needed on the day after the book is closed, to write the
`TERMINAL` entry and to keep reporting both signals.

**If you ever need to undo this** — a wrong path, a wrong account, a moved
anchor — the installer removes what it registered:

```powershell
.\tools\install-scheduled-task.ps1 -Uninstall
Get-ScheduledTask -TaskPath '\GlassBoxTrading\' | Select-Object TaskName, State
# expect: the red "no objects found" error. Nothing is registered any more.
```

Then, still elevated:

```powershell
.\tools\verify-scheduled-tasks.ps1
# expect: SCHEDULER CHECK PASSED (35 checks)
```

**Abort if:** any check fails. Do not enable anything yet.

### 6. The activation gate — Tue 2026-09-08 22:10 CEST to Wed 2026-09-09 15:05 CEST

*Elevated PowerShell for every command below — "Run as administrator" — and
`cd C:\Users\felix\source\repos\glass-box-trading` in each new window, because
the checks are invoked by relative path and this step spans two evenings.*

Two findings reshaped this step (R44-A2, R44-B15). The first draft enabled the
cycle task during a **session** on Tuesday to run its drills — which lets a
competition cycle trade a day before the anchor and silently starts the
measurement period on the wrong date. The second draft was circular: drill (b)
left both tasks disabled, drill (c) powered the machine off without recovering
from it, and the restart and signed-out proofs need both tasks *enabled* — while
the only enable command stood after all six conditions were already met.

Both are answered by the same observation: **the drills need the tasks running,
but they do not need the agent trading.** The trigger window is deliberately
wider than the exchange session, and `cycle-run.ps1` skips outside the session
while still firing, logging and reporting both signals. So the tasks are enabled
inside the trigger window and **outside** every session, and the drills read
exactly the signals they are about. The signed-out proof moved into the same
Tuesday window for the same reason, and the machine-off drill is the only one
left on Wednesday.

**The safety rule that replaces the old ordering, and it is absolute:** no
firing may run a cycle before the anchor. Concretely — the tasks may be enabled
only after **22:10 CEST** on Tuesday, and if any drill is still open at
**15:05 CEST** on Wednesday, both tasks are disabled again and the anchor moves
by **two** trading days — the procedure is written out at the end of this
step, because "the anchor moves" is the sentence you will need at 15:04 with
nothing else to read.

Conditions 1–4 must all be true **before** the drills begin. One and two are
things you run now; three and four are things you did earlier and confirm.

1. Run it now, *normal PowerShell, in the checkout*:
   ```powershell
   cd C:\Users\felix\source\repos\glass-box-trading
   npm.cmd run verify   # npm.cmd, not npm: npm.ps1 is blocked by this host's execution policy
   # expect: it ends without an error and the last line reads
   #   "implementation phases OK: ..."
   ```
   **proven by test**
2. `.\tools\verify-scheduled-tasks.ps1` passes. **proven on the host in step 5**
3. Certificate run four PASS. **step 4**
4. **Alert receipt**, all three checks, confirmed on your own device, including
   one recurring "down" reminder. **step 3**

**Tue 22:10 — enable, outside the session.** The US close was 22:00 CEST, so
every firing from here to 23:45 skips the cycle and reports both signals.

```powershell
Enable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
Enable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
# expect: SCHEDULER CHECK PASSED (35 checks), both states Ready
Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 5
# expect, within 15 min: a "skip: outside the exchange session" line, liveness sent, readiness reported.
# If any line instead shows a cycle running, STOP and disable both tasks: the
# session bound is wrong and the anchor must not be today.
```

Wait until all three checks read green in the healthchecks dashboard before
starting drill (a). A drill against a check that was already down proves
nothing. The **watchdog** check goes green within 5 minutes, **liveness** and
**readiness** at the next quarter hour.

5. **Three silence drills**, each a different path, each confirmed. The waits
   below are the check's period plus its grace: watchdog 20 min, liveness
   45 min, readiness 65 min. **You watch the healthchecks dashboard for DOWN;
   the push on your phone follows within the 10-minute delivery budget, and
   both have to arrive** — the dashboard proves detection, the push proves it
   reached you.

   **(a) Tue 22:30 — the watchdog alone.** It is the failure the other two
   checks cannot see, which is why the third endpoint exists.

   ```powershell
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog' -TaskPath '\GlassBoxTrading\'
   # wait 20 min. expect: gbt-watchdog DOWN; gbt-liveness and gbt-readiness still UP.
   # If either of the other two also falls, STOP: they are wired to the wrong
   # endpoint. Re-enable the watchdog and go back to owner step 3.
   Enable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog' -TaskPath '\GlassBoxTrading\'
   # wait until gbt-watchdog is green again (<= 5 min) before continuing.
   ```

   **(b) Tue 23:00 — signed out, with the tasks running.** This is the S4U
   proof and it belongs here, in a window where no firing can trade, rather
   than in the crowded hour before the anchor.

   ```powershell
   # Sign out. Do NOT lock the screen and do NOT shut down: a locked session is
   # still a session, and would prove nothing.
   # The 23:15 firing runs with nobody signed in. Sign back in at ~23:20, then:
   Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 5
   # expect: a 23:15 line, written while nobody was signed in.
   # If there is none, S4U is not doing what it is configured to do. STOP:
   # disable both tasks (commands in drill (c)) and do not activate.
   ```

   **(c) Tue 23:30 — both tasks, machine still running.** Silence from a live
   machine must alarm. The last firing of the day is 23:45, and the checks keep
   waiting for the ping they expected, so the alerts land around **00:15**
   (liveness) and **00:35** (readiness). Set an alarm; a drill whose alert you
   sleep through has proven nothing either way.

   ```powershell
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
   # expect: gbt-watchdog DOWN by ~23:50, gbt-liveness ~00:15, gbt-readiness ~00:35.
   # Then PAUSE all three checks in the dashboard and go to bed. Unpaused, they
   # stay down until 14:00 and the recurring reminder will wake you hourly.
   ```

6. **Restart, and the alert path without the machine** — Wed 2026-09-09, in the
   pre-session part of the trigger window, so again nothing can trade. Every
   command below is elevated.

   ```powershell
   # 14:00 — un-pause all three checks in the dashboard, then:
   Enable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
   Enable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
   Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 3
   # expect: a 14:00 line, and all three checks green within 5-15 min.

   # 14:05 — shut the machine down. A real shutdown, not sleep and not
   # hibernate: a sleeping machine wakes and pings, which proves nothing.
   Stop-Computer -Force
   ```

   Leave it off for **45 minutes** (14:05 -> 14:50), then switch it on and sign
   in normally.

   ```powershell
   # ~14:52, elevated again:
   Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 5
   # expect: gbt-watchdog went DOWN at ~14:20 and gbt-liveness at ~14:45 while
   #   the machine was off -- that is the proof the alert does not depend on the
   #   machine it reports about;
   # expect: a firing at 15:00 without anyone starting anything -- the restart
   #   proof. StartWhenAvailable is configuration, and configuration is not
   #   evidence.
   ```

   **`gbt-readiness` is deliberately not waited for here.** Its grace is 50
   minutes, so it would only fall at ~15:20 — after the gate and after the
   anchor. Drill (c) already showed that it falls; this drill's claim is
   machine-independence, and two checks falling with the machine switched off
   establish that. Waiting for the third would push the anchor into the next
   week.

**The gate itself, Wed 2026-09-09 by 15:05 CEST.** All six conditions hold,
both tasks are enabled, and:

```powershell
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
# expect: SCHEDULER CHECK PASSED (35 checks), and both states Ready
```

**There are about ten minutes of slack between the 15:00 firing and this gate.**
That is deliberate but thin: a Windows update on shutdown, a BitLocker prompt on
boot, or a log line written a minute late will eat it. If anything is still open
at 15:05 — including "I am not sure" — stop and move the anchor. Do not let the
15:15 firing run into an unfinished gate.

#### If the gate is not met: moving the anchor

The anchor moves by **two trading days, not one.** The certificate needs US
market hours and the anchor fires at 15:15 the same afternoon, so they cannot
share a day — that is the same reason they are separate days in the first place.

*Elevated PowerShell, immediately:*

```powershell
Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
Get-ScheduledTask -TaskPath '\GlassBoxTrading\' | Select-Object TaskName, State
# expect: both Disabled. Nothing may fire until the new certificate exists.
```

Then, in this order, and no other:

1. Pick the new anchor: **two trading days later** (a Wednesday failure means
   certificate Thursday, anchor Friday). Check it is not a US market holiday.
2. Edit `config/policy.json`: set `"FLATTEN_DATE"` to exactly three calendar
   months after the new anchor, as `"YYYY-MM-DD"`. Nothing else in that file
   changes.
3. `npm.cmd run verify` — exit 0. The policy digest has now changed, which is
   what voids the old certificate.
4. Re-run **owner step 4** (certificate run four) on the new certificate day,
   and put the new path into `.env` as `PRE_ARM_CERTIFICATE=`.
5. Re-run **owner step 5** with `-CoverageThroughDate` set to the day *after*
   the new flatten date (the journaling-only day still needs firings).
6. Re-run **owner step 6** in full. The drills were invalidated by the
   re-installation; none of them carries over.
7. Update the calendar from `docs/P12-CALENDAR-PROMPTS.md`, block 9.

**Record it**: append a dated line to `STATE.md` saying which day the anchor
moved from, to, and why. That line is the whole audit trail for a run whose
dates no longer match the document you are reading.

### 7. The supervised first regular cycle — Wed 2026-09-09, from 15:15 CEST

*Normal PowerShell.* The session lead-in starts 20 minutes before the US
open, so the **15:15** firing is the first one that runs a cycle — not
15:30. That firing is the anchor. Watch it and confirm, in order:

```powershell
Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 20
Get-Content C:\Users\felix\glass-box-state\longrun-1\journal.jsonl -Tail 2
```

1. `cycle-run.log` shows the invocation and the printed report, which ends with
   a single JSON line — that line is the report; if the log stops before it,
   the cycle did not finish.
2. The journal's last entries include a `BOOTSTRAP` entry. **If instead you see
   a `HALT` with reason `PROVENANCE_BROKEN`, the account was created too early
   or has been used before.** Stop: disable both tasks, and the run needs a
   different account, which means a new anchor (procedure at the end of step 6).
3. `gbt-liveness`, `gbt-readiness` and `gbt-watchdog` are all green.
4. `.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled` still passes — 35 checks,
   from a **normal** shell, which is enough to read task definitions.

If 1, 3 or 4 fails, disable both tasks from an elevated shell and treat it as a
missed gate: the anchor moves (end of step 6).

**This cycle is the anchor for the flatten date.** If it does not happen on
2026-09-09, the date moves and the certificate must be redone — use the
procedure at the end of step 6 and record the change in `STATE.md`. Nobody else
is watching this run: "report it" means write it down where the next session
will read it.

---

## During the run

Who detects each kind of failure, which signal appears or goes missing,
after how long, and what the system will and will not close by itself:
[`P12-INCIDENT-PATHS.md`](P12-INCIDENT-PATHS.md). Read it once before
activation, not during the first alert.

**Weekly:** publish the dashboard through the digest-neutral path in
[`PUBLISH-RUNBOOK.md`](PUBLISH-RUNBOOK.md), from the `gbt-publish` worktree, and
check the probe comes back clean.

**Before anything else, at any hour: is the book exposed?** That is the
question the alert does not answer, and it decides whether this can wait until
morning.

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
node dist\shell\readiness-cli.js
# reads the state only: prints the standing impediment, or "success".
```

and open the Alpaca dashboard for the **competition** account: positions and
open orders. With a halt or a fence standing, the agent will not close anything
by itself, so an open position is exposed until you or the expiry closes it.
The defined-risk structures cap the loss at what was reserved at entry, which
is why a flat book means it can wait and an open book usually means it cannot.

**On a readiness alert.** The body names the impediment.

* `HALT_STANDING:<reason>` — the deployment stopped and needs a decision.
* `CREDENTIAL_FENCE_UNRELEASED` — a credential rejection stands. **The fence
  procedure, in full**, because the CLI prints it but a broken CLI would not:

  1. Open the Alpaca dashboard for the **competition** account.
  2. List every **open order**. The agent could not read them when its
     credentials were refused, so it does not know what is resting there and
     the journal's last picture may be older than the broker's.
  3. Cancel every open order the journal does not explain. Match by client
     order id against the last `INTENT` entries; anything unmatched is a
     leftover from the rejection and goes.
  4. List every **position** and compare it with the journal's open
     lifecycles. A position the journal does not know about is a manual
     intervention or an assignment; note it in `STATE.md` before continuing.
  5. Confirm the key and secret in `.env` are the ones you intend to use. A
     rotated key is the usual cause, and re-arming with the old one repeats the
     fence within a cycle.

  Only then release.
* `STATE_NOT_DURABLE:<detail>` — the journal, epoch store or halt file cannot be
  written. Usually a full disk, which the probe now actually detects: it writes
  and flushes a byte rather than only checking permissions (R44-B3). Entries
  are blocked until it is fixed; risk-reducing closes still run.
* `AUTHORITY_STATE_UNREADABLE` or `JOURNAL_CORRUPT:line <n>` — the durable
  state no longer parses. No writer can act on it, so nothing is trading and
  nothing will resume by itself. Do not repair the file by hand. Instead:

  ```powershell
  # elevated: stop the deployment before touching its state
  Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
  Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
  # normal shell: keep the evidence, byte for byte
  Copy-Item -Recurse C:\Users\felix\glass-box-state\longrun-1 `
            C:\Users\felix\glass-box-state\longrun-1-quarantine-$(Get-Date -Format yyyyMMddHHmm)
  ```

  Then stop and write what you saw into `STATE.md`. The measurement period ends
  here: a run whose journal is unreadable cannot be evaluated from it, and
  restarting on a repaired file would report a period that never happened.
* `STARTUP_REFUSED:<stage>` — the agent refused before it existed: a missing or
  changed analyst manifest, an unusable `STATE_DIR`, an invalid configuration,
  a certificate that no longer matches. The stage names which. Nothing is
  trading; the cycle simply did not start. This is the likeliest alert after
  any change to the checkout, which is why there should be none during the run.
* `CYCLE_ABORTED` — the cycle threw after starting. `cycle-run.log` holds the
  stack. If the next firing succeeds, the deployment healed itself; if three in
  a row abort, disable both tasks and stop.
* `DEADLINE_FLATTEN_FAILED` — **the only one that cannot wait.** On
  2026-12-09 the ladder could not close the book before the US close. Open the
  broker dashboard and close the remaining structures by hand, as whole
  structures, never leg by leg. The prohibition on manual trading in owner step
  1 is lifted exactly here and in the two cases named in
  [`P12-INCIDENT-PATHS.md`](P12-INCIDENT-PATHS.md) — machine unreachable, or a
  standing fence with an open book — and nowhere else. Note every manual close
  in `STATE.md`; the evaluation has to separate them from the agent's own.

The release, when you have done the procedure — *normal PowerShell*:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
node dist\shell\unhalt-cli.js --operator felix --reason "what you checked and why you are releasing"
# prints the standing state and the fence procedure, and changes NOTHING without --confirm.
# Read the "HALT seq <n>" it prints; that number goes into the next command.
node dist\shell\unhalt-cli.js --operator felix --reason "..." --expect-halt-seq <n> --confirm
# expect: "RELEASED: UNHALT seq <m>" and "fence mark now false"
```

**Then confirm it actually resumed**, which the release does not do by itself:

```powershell
node dist\shell\readiness-cli.js
# expect: "readiness: success (no halt, no fence, state writable)"
```

`gbt-readiness` turns green at the next firing, so within 15 minutes. If it does
not, something else is standing — run the same command again and read what it
names. A release does not restart anything: the next scheduled firing does.

**`--expect-halt-seq` is required whenever a halt is journaled** — the CLI
refuses the release without it and prints the number to use (R44-B9). It is the
compare-and-set that makes the release apply to the halt you actually read.
Without it, a second halt landing between the preview and the confirmation —
which is exactly what a deployment under a credential fence keeps producing —
is released unseen: the gate executed a preview of `HALT seq 1 AUTH_FAILURE`,
a `HALT seq 2 ACCOUNT_BINDING_MISMATCH` arriving next, and the release then
clearing both. With the sequence number the second halt refuses the release and
you go back and look at it.

**On a liveness alert:** the machine, the scheduler or the process. `cycle-run.log`
and the journal say which. Recovery is normally just letting the schedule
resume — `StartWhenAvailable` is set — but a killed writer holds the epoch until
`LOCK_TAKEOVER_BOUND_MS` (6.7 min) elapses, so expect at most one lost cycle
after a hard stop.

**On a watchdog alert:** the safety net itself is not running. Nothing is
protecting the book against a hung writer until it is back. Check the task state
and `STATE_DIR\watchdog-run.log`.

**Clock changes.** Every time in this document is written CEST, which is the
offset until Sunday 2026-10-25. From Monday 2026-10-26 the same instants read
one hour earlier in local time, and for the week to 2026-11-01 the US session
starts at **14:30** local instead of 15:30, because Europe changes first. The
trigger window and the three cron schedules are stated in `Europe/Berlin` and
follow the change by themselves — nothing needs adjusting. What changes is what
you should expect to see: `cycle-run.log` starts producing cycles an hour
earlier in that one week. The two calendar reminders exist for exactly this.

**Never during the run:** change a strategy parameter or a risk limit. If one
must change, the measurement period **ends** and a new one begins
([`P12-EVALUATION.md`](P12-EVALUATION.md)); the two are never summed.

**Disk:** budget about **400 MB** for the journal plus the publish tree. The
two measurements behind that number are worth keeping apart: an average entry
is 69.4 KiB, and the largest synthetic journal measured for this run was
**152.7 MiB** at 2,000 entries — so the journal alone can reach roughly
150-200 MB, and the publish tree carries a rendered revision per publication on
top. Check free space at the Friday review; below 1 GB, archive older
revisions.

**Runtime at that size:** every readiness report reads and parses the journal,
because “no impediment stands” includes “no writer would refuse this state”.
Measured on a 152.7 MiB journal: 162 ms and about 500 MiB of transient memory,
in a process that exits immediately. If that ever becomes visible — a firing
that takes minutes, or memory pressure — it is a machine problem, not a
mystery; the number to compare against is here.

## Ending it

1. **Wed 2026-12-09**, `FLATTEN_DATE`: every cycle closes the book through the
   ladder; by the close the assertion is zero risk-bearing positions and zero
   non-terminal orders (S-G11-01).
2. **Thu 2026-12-10**, journaling-only: no entries; a still-open position keeps
   being closed by the failure path (S-G11-02).
3. After the Thu 2026-12-10 US close, *normal PowerShell*:
   ```powershell
   node dist\shell\deadline-cli.js terminal
   # exit 0 only when the entry landed.
# If it exits non-zero: read what it printed, fix that (a full disk and a
# standing halt are the two causes), and run it again. Do NOT disable the tasks
# before it has landed -- with them disabled nothing can write the entry any
# more, and a run without TERMINAL has no defined end. If it cannot be made to
# land, record that in STATE.md and treat the last CYCLE entry as the end.
   ```
4. Publish the final revision and probe it.
5. *Elevated PowerShell*: disable both tasks and read the state back.
   ```powershell
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
   Get-ScheduledTask -TaskPath '\GlassBoxTrading\' | Select-Object TaskName, State
   # expect: both Disabled
   ```
6. Archive the journal, both logs and the receipts in the verification store,
   then write the evaluation from [`P12-EVALUATION.md`](P12-EVALUATION.md).

The journal is then a closed archive, exactly like the competition's.
