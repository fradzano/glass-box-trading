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
| Activation gate (drills, cold start) | Tue 2026-09-08 22:10 → Wed 2026-09-09 **14:45** | owner step 6 — outside every session, so nothing trades |
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

## Reading the clock

Four separate rounds of findings came from times: a drill whose wait was
shorter than the grace it was waiting out, a "23:15 line" that a healthy
deployment writes as `21:15Z`, an alert budget counted twice, and a shift rule
that moved a market-hours step onto a Sunday. They are one problem, so this
section is the one place that answers it and everything below refers here.

### The log is UTC; every instruction is local

Both wrappers write `[DateTime]::UtcNow.ToString('o')`. So a firing you observe
at **23:15 local** appears in the file as `2026-09-08T21:15:…Z`, and Wednesday's
14:00 and 15:00 firings appear as `12:00Z` and `13:00Z`. **Never read the log
with `Get-Content` during a drill.** Use:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
.\tools\show-run-log.ps1 -Tail 5
.\tools\show-run-log.ps1 -Log watchdog -Since "14:00"
```

It prints each line as `local (UTC hh:mm:ss) message`, so the times in this
document and the times on the screen are the same times. It only reads.

### When a check goes down, exactly

An external check does not measure "how long since the last ping". It measures
**the ping its schedule expected next, plus the grace**:

    down at  =  (first expected ping after the last observed ping)  +  grace

The three checks, with the schedules the installer prints:

| Check | Expected every | Grace | Down at, after a last observed ping at T |
|---|---|---|---|
| `gbt-watchdog` | 5 min | 15 min | T + 5 + 15 = **T + 20** |
| `gbt-liveness` | 15 min | 30 min | T + 15 + 30 = **T + 45** |
| `gbt-readiness` | 15 min | 50 min | T + 15 + 50 = **T + 65** |

Those are the values for a T that falls **on** the schedule (`:00`, `:15`,
`:30`, `:45` for the two cycle checks). A ping observed at 14:03 is still
followed by an expected one at 14:15, so it buys nothing.

**The expression has an end, and past it the arithmetic changes completely.**
The two cycle checks expect pings only between **14:00 and 23:45** on weekdays.
After the 23:45 firing the *next expected* ping is 14:00 the following weekday,
so a T of 23:45 puts liveness's detection at 14:30 and readiness's at 14:50 the
next day — not forty-five and sixty-five minutes later. Any drill that must
finish tonight therefore needs **T at or before 23:30**, and any drill measured
from a Friday evening waits until Monday. The watchdog's five-minute schedule
ends at the same 23:45.

**Each check family has its own T.** The two cycle checks are pinged by
`cycle-run.ps1` at the quarter hour; the watchdog is pinged by
`watchdog-run.ps1` every five minutes. They are different logs and different
last-ping instants, up to five minutes apart, so a drill that touches all three
reads both logs and notes both:

```powershell
.\tools\show-run-log.ps1 -Tail 2                 # T for gbt-liveness and gbt-readiness
.\tools\show-run-log.ps1 -Log watchdog -Tail 2   # T for gbt-watchdog
```

`-Since` takes **local** time, like every instruction here; the output shows
local and UTC side by side.

**Then delivery, which is a separate budget and never folded into the numbers
above:** `ALERT_DELIVERY_BUDGET_MS` is 10 minutes. A drill is finished when the
push is **on your phone**, not when the dashboard turns red, so plan
`T + detection + 10` and note both times.

### Every drill starts from an observed ping, never from a clock

The first draft of the activation gate said "enable at 14:00, expect the 14:00
firing". A task enabled at 14:00:30 misses that trigger entirely; a ping that
lands at 14:16 pushes every following number by fifteen minutes. So:

1. Do the thing (enable, disable, sign out, shut down).
2. **Wait for a firing you can see** — a line from `show-run-log.ps1`, and the
   check green on the dashboard. Write its local time down. That is **T**.
3. Compute the drill's deadlines from T with the table above.
4. Compare what happened against what you computed, then move on.

A drill whose T you did not observe proves nothing, and a drill you start
before the previous one is green again proves less than nothing.

### The trading calendar decides every date

Dates are **derived**, never shifted by a fixed number of calendar days. From
the anchor — the first regular approved cycle — everything else follows:

| Derived | Rule |
|---|---|
| Certificate day | the trading day **immediately before** the anchor |
| Activation gate | the evening of the certificate day into the anchor morning |
| `FLATTEN_DATE` | three calendar months after the anchor; **if that is not a US trading day, the next one that is** |
| Journaling-only day | the **trading day after** `FLATTEN_DATE` — it needs firings and a US close, so a Saturday is never it |
| `-CoverageThroughDate` | the journaling-only day |
| `TERMINAL` | after the US close of the journaling-only day |

**Three kinds of day an anchor may not be, because the gate's fixed times
assume an ordinary session:**

* **A day in the week between the two clock changes** (Mon 2026-10-26 to Fri
  2026-10-30). The session runs 14:30–21:00 local there, so the first firing
  that runs a cycle is **14:15** — half an hour *before* the 14:45 gate that is
  supposed to authorise it. An anchor in that week would break the absolute
  rule by construction.
* **A day after a US early close** (Fri 2026-11-27, Thu 2026-12-24, and their
  equivalents). The close is 19:00 local, not 22:00, so "enable at 22:10"
  wastes three hours; and as a *certificate* day an early close cuts the
  supervised window short.
* **A day in the corresponding spring mismatch**, 14 to 28 March 2027, when
  the United States has changed and Europe has not. An earlier version of this
  list claimed the session opens at 13:30 local then and that the trigger
  window would not cover it. That was wrong, and checking it is one line:
  09:30 New York on 2027-03-15 is 13:30 UTC and therefore **14:30 Berlin** —
  exactly like the October mismatch, comfortably inside a window that starts at
  14:00. The coverage check is not the problem. The problem is the same one as
  above: at a 14:30 open the first firing that runs a cycle is 14:15, before
  the gate, so those five days are forbidden as an **anchor** and are entirely
  ordinary as run days.

Applied to the planned anchor of **Wed 2026-09-09**: certificate Tue 2026-09-08,
`FLATTEN_DATE` Wed 2026-12-09, journaling-only Thu 2026-12-10, coverage through
2026-12-10. Applied to a Friday anchor of 2026-09-11 it would be:
`FLATTEN_DATE` Fri 2026-12-11, journaling-only **Mon 2026-12-14** — not
Saturday the 12th, which has no close and no firings.

### Manual intervention: permission and executability are two questions

Owner step 1 forbids trading the competition account by hand while the agent
operates. That prohibition lifts in exactly three situations, and **nowhere
else**:

1. The machine is unreachable and cannot be brought up while risk stands.
2. A halt or credential fence stands **with an open book** — the agent will not
   close anything until a human releases it.
3. `DEADLINE_FLATTEN_FAILED` on the flatten date.

Permission is not ability. **Options trade only during the regular US session**
— 09:30–16:00 New York, i.e. 15:30–22:00 local, and 14:30–21:00 in the week
between the two clock changes. There is no extended-hours session for options
at this broker. Outside that window **nothing can be closed by anyone**, and an
instruction to "close it now" at 23:00 on a Friday is an instruction that
cannot be carried out.

So the rule has two halves and both are always stated:

* **Inside the session, with permission:** close the affected structures whole
  in the broker dashboard, never leg by leg, and write every close into
  `STATE.md` — the evaluation separates manual closes from the agent's own and
  can only do that if they are named.
* **Outside the session, and what to do depends on what is actually in the
  book.** Look before concluding: the broker dashboard reads at any hour, even
  when it will not accept an order.

  * **Intact option structures.** Nothing can be done and nothing needs to be.
    Every leg is still there, so the maximum loss is the one fixed at entry and
    it cannot grow overnight or over a weekend. That is the whole reason this
    strategy is defined-risk, and this is the hour it earns its keep.
  * **A residue — shares from an assignment, or a short leg whose long wing
    expired.** The cap does **not** hold here, and the spec says so itself:
    S-X-06 is the assignment exception to A23's constructive worst case, which
    is why the runner raises `UNBOUNDED_RESIDUE_RECOVERY` and closes such a
    residue with **no price cap** — the realised cost may exceed the original
    maximum loss, and a short share residue has no upper bound at all. This is
    the one thing here that can get materially worse while you sleep.
    Options still cannot be traded outside 15:30–22:00 local. A **share**
    residue is an equity position, and equities do have pre- and post-market
    sessions — whether an order is accepted depends on the broker's
    extended-hours support and the order type, so **check in the dashboard
    rather than assume either way**. If it can be closed, close it and note it.

  Either way, write down what is open — which structures, which residues, what
  size and direction — and set an alarm for **15:35 local on the next trading
  day**, five minutes *after* the open at 15:30 (14:35 in the week between the
  two clock changes). An alarm at 15:20 would ring ten minutes before anything
  could be done, which is the mistake this paragraph exists to prevent.

---

## Owner steps

Every block below is meant to be pasted as-is. Each says which shell it needs.
**No step asks you to print a secret**, and nothing here should be copied back
into a chat.

### 1. Create the fresh paper account — by Mon 2026-09-07, 22:00

*No shell. Alpaca web UI.*

A new Alpaca **paper** account, used by nothing but this agent, created **on or after `COMPETITION_START`, which is 2026-09-05T00:00:00Z — Saturday
05.09.2026, 02:00 Europe/Berlin.**
The S-CYC-09 provenance proof requires the creation instant to be at or after
`COMPETITION_START`, opening cash **and** equity at exactly $100,000.00, zero
positions and non-terminal orders, an order and fill history that are complete
and empty, and an activity ledger carrying nothing but the opening funding
journal.

**Check it before anything depends on it.** Until this probe existed the only
way to learn the verdict was to arm and watch the anchor cycle refuse — on
Wednesday, after the certificate and the whole activation gate, leaving a
sticky `PROVENANCE_BROKEN` mark behind. It asks the same question through the
same pure function, reads only, and writes nothing at all:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
npm.cmd run build      # only needed if dist\ is older than the checkout
node tools\probe-provenance.mjs competition
# expect: "PROVENANCE OK: this account would be accepted for arming ..."
```

Run it now, run it again after step 2, and run it once more on the morning of
the anchor. It costs seconds and it is the only check that answers this
question before the day it matters. Write the account's creation timestamp into
`STATE.md` while you are here.

If it does refuse: **do not edit `COMPETITION_START`.** That changes the policy
digest, which voids the certificate, and it would also make the proof accept an
account that was in use before this run — which is the one thing it exists to
prevent. Create a new account and move the anchor (procedure at the end of
owner step 6).

Enable options level 3 (multi-leg). Never trade on it by hand while the agent
operates — a manual mutation is detectable only one cycle later (owner ruling
2026-09-02, S-CYC-05). The three situations in which that prohibition lifts,
and the market hours that decide whether anything can be done about them, are
in [Manual intervention](#manual-intervention-permission-and-executability-are-two-questions).

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

**And check for a duplicated key**, because the two halves of this deployment
resolve one differently: node keeps the **last** occurrence, the PowerShell
wrappers' `.env` reader returns the **first**. A key written twice therefore
means the agent and its wrappers disagree about its value, silently. It has
happened here once already, with `BOOTSTRAP_DIAGNOSTIC_SINK`.

```powershell
node -e "const t=require('fs').readFileSync('.env','utf8');const seen=new Map();for(const l of t.split(/\r?\n/)){const s=l.trim();if(!s.length||s.startsWith('#'))continue;const k=s.slice(0,s.indexOf('='));seen.set(k,(seen.get(k)??0)+1)}const d=[...seen].filter(([,n])=>n>1);console.log(d.length?'DUPLICATE KEYS: '+d.map(([k,n])=>k+' x'+n).join(', '):'no duplicate keys')"
# expect: "no duplicate keys". If not, delete the EARLIER line(s) -- the last
#   one is what the agent uses.
```

**Abort if:** `ALPACA_PROFILE` is not `competition`, or any of these six reads
`<MISSING>`, or a key is duplicated, or `STATE_DIR` still ends in `competition-2` — that is the
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
night. **Switch on the account's recurring "down" reminder** — hourly if the
account offers it, daily otherwise. A check sends one notification when it goes
down and one when it recovers, so without the reminder a single push missed at
22:00 is a silent night, and this run has one operator and no second pair of
eyes. **It is a gate condition** (step 6, condition 4), not a nice-to-have, and
the two places say the same thing on purpose.

If the account genuinely cannot do it, that is not a shrug and not a silent
downgrade: it is an owner decision to run with one notification per transition,
and it is taken **before** activation and written into `STATE.md` with its date
and its reason. Then condition 4 is met by that recorded decision instead of by
a received reminder. What is not acceptable is discovering the gap at 23:00 in
December.

Then put the ping URLs into `.env`. **Getting these three the wrong way round is
the one mistake nothing later catches**, because every check would still be
green — copy each URL directly from its own check page and re-read the names:

```
HEALTHCHECK_PING_URL=<readiness check ping URL>
HEALTHCHECK_LIVENESS_URL=<liveness check ping URL>
HEALTHCHECK_WATCHDOG_URL=<watchdog check ping URL>
```

**Or let the API do all of it.** Creating three checks by hand means
transcribing two cron expressions, a timezone and three graces into three web
forms and copying three URLs back — nine chances to make a mistake that either
alarms on a healthy night or silently disables a signal. With a project API key
in `.env` as `HEALTHCHECK_IO_API_KEY`, one command does the same thing and
prints no URL:

```powershell
node tools\healthchecks-provision.mjs --list
node tools\healthchecks-provision.mjs --tz <timezone from the installer> `
     --cycle-cron "<cycle cron from the installer>" `
     --watchdog-cron "<watchdog cron from the installer>" --rotate --apply
```

It deletes the checks whose URLs are currently in `.env` (`--rotate`), creates
the three with the right names, schedules and graces, assigns every
notification channel in the project, writes the new URLs into `.env`, and
leaves the checks **paused** — a cron check that has never been pinged would
otherwise go down and start alarming days before anything is meant to ping it.
The first ping resumes a paused check by itself, so the alert-path test below
wakes them with no further step. Without `--apply` it is a dry run.

Now exercise the path and **confirm receipt on your own device**. The order
matters: `-ResolveOnly` turns every check green again, so the reminder has to be
waited out **before** it, not after — otherwise there is nothing left down for a
reminder to be about.

```powershell
.\tools\check-alert-path.ps1
# expect: six [SENT] lines and "ALERT PATH DELIVERED"
# The endpoints print as fingerprints (hc:xxxxxxxx), not as URLs: a ping URL is
#   a credential -- anyone who has it can send SUCCESS pings and so suppress a
#   real silence alarm -- and this output is meant to be read and compared.
#   Check the three fingerprints are DIFFERENT; two the same means two of the
#   .env values are the same URL, which is the swap nothing later catches.
# then wait for three alerts on your phone or mail, and read their bodies:
#   each names its check and the condition that failed.
```

Leave them down and wait out **one reminder period** (an hour, or a day if that
is all the account offers). Confirm a **second** message arrives for at least
one check — that is condition 4 of the activation gate, and it is the only
evidence that a night-time incident reaches you more than once.

```powershell
.\tools\check-alert-path.ps1 -ResolveOnly
# expect: three [SENT] lines, and all three checks green again
```

**Abort if:** any signal says `UNDELIVERED` or `NOT CONFIGURED`, or an alert
does not arrive. HTTP 200 is delivery, not receipt.

**If no second message arrives**, the setting is not on, or not on that
channel. Fix it and repeat, or take the recorded owner decision above. Do not
carry the question into the gate.

**Then pause all three checks in the dashboard.** They now have cron schedules
and nothing will ping them until Tuesday 22:10, so left running they would go
down on Monday evening and stay down for a day, with the reminder waking you
hourly through the night. Step 6 un-pauses them.

The silence drills are separate and cannot be scripted. Do them in step 6.

### 4. Certificate run four — Tue 2026-09-08, US market hours, supervised

*Normal PowerShell. Working directory: the checkout.* This runs on the **dev**
account against the final configuration; nothing in `config/` may change
afterwards.

**The process environment wins over `.env`** — `loadEnvironment` reads the file
and then lets the process environment override it, which is what makes the
block below work at all. If that were the other way round, this run would use
the competition profile and write into `longrun-1`, on the one step whose whole
purpose is the dev account. Confirm it before trusting the block:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
$env:ALPACA_PROFILE = 'dev'
node -e "const {loadEnvironment}=require('./dist/shell/runtime-config.js');console.log('ALPACA_PROFILE resolves to', loadEnvironment(process.cwd(),process.env)['ALPACA_PROFILE'])"
# expect: "ALPACA_PROFILE resolves to dev". If it says competition, STOP -- the
#   block below would run the certificate against the wrong account.
Remove-Item env:ALPACA_PROFILE
```

The block sets dev values for this run only and restores your session
afterwards on the normal and the failing path:

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
nothing for 15 minutes, Ctrl-C it and treat it as a failed verdict. The
`finally` block usually restores the shell after a Ctrl-C, but that depends on
how the break reaches the child process and is not something to rely on — which
is why closing the window afterwards, below, is the actual safeguard.

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
# expect: SCHEDULER CHECK PASSED, and a check count at the end of the line.
# Write that number down: it must be the same every later time you run this
# without -ExpectEnabled. A number that changes means the verifier changed,
# and a verifier that changed has not verified the same thing twice.
```

**Abort if:** any check fails. Do not enable anything yet.

### 6. The activation gate — Tue 2026-09-08 22:10 to Wed 2026-09-09 14:45 local

*Elevated PowerShell for the enable/disable commands and for
`verify-scheduled-tasks.ps1`, "Run as administrator", with
`cd C:\Users\felix\source\repos\glass-box-trading` in each new window — the
scripts are invoked by relative path and this step spans two evenings. The one
exception is condition 1's `npm.cmd run verify`, which is a normal shell and is
marked as such.* (The verifier itself only reads task definitions and works
unelevated too; it is run elevated here simply because the window is already
open.)
Read **[Reading the clock](#reading-the-clock)** first; every wait below is
computed from an observed ping, not from the wall clock.

The drills need the tasks **running**, and they do not need the agent
**trading**. The trigger window is wider than the exchange session and
`cycle-run.ps1` skips outside it while still firing, logging and reporting both
signals — so the tasks are enabled inside the trigger window and outside every
session, and every drill reads real firings that cannot trade.

**The safety rule that replaces the old ordering, and it is absolute:** no
firing may run a cycle before the anchor. Concretely, the tasks may be enabled
only after **22:10** on Tuesday (the US close is 22:00), and anything still
open at **14:45** on Wednesday moves the anchor — the procedure is at the end
of this step.

**All three drills are on Tuesday.** An earlier draft put the machine-off drill
on Wednesday morning, where the pre-session window is 75 minutes to the anchor and only 45 to the gate,
while `gbt-readiness` alone needs 65 plus delivery: it could not finish before
the gate it was a condition of, nor even before the anchor. Tuesday's window has the room, because the
checks keep waiting for the ping they expected long after the last firing of
the day. Wednesday is then only the restart proof, with real reserve.

Conditions 1–4 must all be true **before** the drills begin. One is something
you run now; the others you did earlier and confirm.

1. Run it now, *normal PowerShell, in the checkout*:
   ```powershell
   cd C:\Users\felix\source\repos\glass-box-trading
   npm.cmd run verify   # npm.cmd, not npm: npm.ps1 is blocked by this host's execution policy
   # expect: it ends without an error and the last line reads
   #   "implementation phases OK: ..."
   ```
   **proven by test**
2. `.\tools\verify-scheduled-tasks.ps1` passed in step 5. **proven on the host**
3. Certificate run four PASS. **step 4**
4. **Alert receipt**, all three checks, confirmed on your own device, **and one
   recurring reminder received**. **step 3**

**Tue 22:10 — enable, outside the session.** Finish this block **before
22:15**: that firing is the one the drills measure from, and a late enable
pushes the whole evening a quarter of an hour back.

```powershell
# Un-pause all three checks in the dashboard first (step 3 paused them), then:
Enable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
Enable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
# expect: SCHEDULER CHECK PASSED, both states Ready
```

Now wait for a firing you can see, and write down its local time — this is the
**T** every drill below is measured from:

```powershell
.\tools\show-run-log.ps1 -Tail 3
# expect, at the next quarter hour: a "skip: outside the exchange session" line,
#   liveness sent, readiness reported.
# If any line instead shows a cycle RUNNING, STOP and disable both tasks: the
#   session bound is wrong and the anchor must not be today.
```

All three checks must read green in the dashboard before the first drill.
`gbt-watchdog` turns green within 5 minutes of enabling, the other two at the
next quarter hour.

5. **Three drills.** Each is: do the thing, observe, compute from T, compare.
   Detection first, then the push within the 10-minute delivery budget;
   **both have to arrive** before the next drill starts. The schedule below is
   the earliest each can begin, not a clock to keep to — a drill that runs late
   is fine, a drill that starts before the previous one is green is worthless.

   **The hard boundary of the evening:** drill (c) needs a **T at or before
   23:30**. After the 23:45 firing the checks stop expecting pings until 14:00
   the next weekday, so a later T cannot produce a detection tonight. If (a)
   and (b) have run so late that (c) cannot start by 23:30, **stop**: disable
   both tasks and move the anchor. Do not run a half drill.

   **(a) 22:30 — the watchdog alone.** The failure the other two checks cannot
   see, which is why the third endpoint exists.

   ```powershell
   .\tools\show-run-log.ps1 -Log watchdog -Tail 2   # note T (a watchdog firing)
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog' -TaskPath '\GlassBoxTrading\'
   # expect at T+20 (22:50): gbt-watchdog DOWN; gbt-liveness and gbt-readiness still UP.
   # expect by T+30 (23:00): the push on your phone.
   # If either of the other two also falls, STOP: they are wired to the wrong
   #   endpoint, and step 3 has to be redone.
   # If the DOWN appears and the push does not, STOP as well: an alert nobody
   #   receives is the failure this whole gate is about. Re-check the channel
   #   in step 3 before going on.
   Enable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog' -TaskPath '\GlassBoxTrading\'
   # wait until gbt-watchdog is green again -- at most 5 min, so about 23:05.
   ```

   **(b) 23:05, once (a) is green — signed out, tasks running.** The S4U proof,
   here rather than in the crowded hour before the anchor because no firing here
   can trade. It needs one quarter-hour firing, so start it by 23:10 at the
   latest: signing out takes a minute and the 23:15 firing is the one it uses.

   ```powershell
   # Sign out. Do NOT lock the screen and do NOT shut down: a locked session is
   # still a session and would prove nothing.
   # The next quarter-hour firing runs with nobody signed in. Sign back in about
   # five minutes after it and read the log with its local column:
   .\tools\show-run-log.ps1 -Tail 3
   # expect: a line at the quarter hour you were signed out for -- e.g.
   #   "2026-09-08 23:15:04  (UTC 21:15:04)  skip: ..." -- written while nobody
   #   was signed in. The file itself holds 21:15Z; that is the same instant.
   # If there is none, S4U is not doing what it is configured to do. STOP:
   #   disable both tasks and do not activate.
   ```

   **(c) 23:30, and no later — the machine itself.** This proves the alert does
   not depend on the machine it reports about, and it subsumes the "both tasks
   disabled" drill an earlier draft ran separately: with the host switched off,
   no ping can be produced by any means.

   ```powershell
   .\tools\show-run-log.ps1 -Tail 2                 # T(cycle)    -- for liveness and readiness
   .\tools\show-run-log.ps1 -Log watchdog -Tail 2   # T(watchdog) -- up to 5 min later
   Stop-Computer -Force
   # A real shutdown. Not sleep, not hibernate: a sleeping machine wakes and
   # pings, which proves the opposite of what this drill is for.
   ```

   Two T values, because the two logs are pinged by different wrappers on
   different schedules and can be five minutes apart:

   | Check | Down at | Push by |
   |---|---|---|
   | `gbt-watchdog` | T(watchdog) + 20 | + 10 |
   | `gbt-liveness` | T(cycle) + 45 | + 10 |
   | `gbt-readiness` | T(cycle) + 65 | + 10 |

   With T(cycle) = 23:30 and T(watchdog) = 23:35 that is 23:55, 00:15 and
   00:35, with the last push by 00:45. **Set an alarm for 00:45**: a drill
   whose alerts you sleep through has proven nothing either way, and this is the
   latest the evening runs. If a push is missing while its DOWN is there, that
   is a finding and not a delay — stop and fix the channel.

   **When all three have arrived, pause all three checks from your phone** and
   go to bed. The machine stays off, nothing will ping until Wednesday, and an
   unpaused check with the recurring reminder on will wake you hourly until
   14:00. They are paused in the DOWN state, so expect them to come back DOWN
   on Wednesday and to turn green only after a real firing — which is what
   makes the 14:00 log line, and not the dashboard colour, the restart proof.

6. **Restart — Wed 2026-09-09, before the session.** The machine has been off
   since Tuesday night, so this is a cold boot, which is the proof that matters.

   ```powershell
   # ~13:50 — switch the machine on and sign in normally. Un-pause all three
   #          checks in the dashboard.
   # 14:00 is the first trigger of the day. Nobody starts anything.
   # ~14:05, elevated:
   .\tools\show-run-log.ps1 -Since "14:00"
   # expect: a 14:00 (UTC 12:00) line, written without anyone starting it.
   #   That is the restart proof; StartWhenAvailable is configuration, and
   #   configuration is not evidence.
   # If nothing fired, STOP: disable both tasks and move the anchor.
   ```

   Then let one more firing pass and confirm all three checks are green again —
   `gbt-watchdog` within 5 minutes, the other two by 14:20. They were paused
   while DOWN, so green here means a real firing reached them; if any is still
   red at 14:30, stop and move the anchor rather than spending the reserve on
   it.

**The gate itself, Wed by 14:45 local.** All six conditions hold, both tasks are
enabled, and:

```powershell
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
# expect: SCHEDULER CHECK PASSED, and both states Ready
```

The gate is binary, so the reserve that actually absorbs a slow boot or a
Windows update is the **25 minutes between 14:20 and 14:45**, not the
half hour after it: nothing that happens before the gate can borrow time from
after it. The 14:45–15:15 gap exists for a different reason — it is the margin
that keeps a gate finishing at 14:44 from colliding with the anchor. If
anything is still open at 14:45, including "I am not sure", stop and move the
anchor.

#### If the gate is not met: moving the anchor

Everything is **derived from the new anchor** through the table in
[Reading the clock](#reading-the-clock). Do not shift dates by a fixed number of
days: the certificate needs US market hours, so a linear shift can land it on a
Sunday, and a flatten date can land on a Friday whose "day after" is a Saturday
with no close and no firings.

*Elevated PowerShell, immediately:*

```powershell
Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
Get-ScheduledTask -TaskPath '\GlassBoxTrading\' | Select-Object TaskName, State
# expect: both Disabled. Nothing may fire until the new certificate exists.
```

Then, in this order and no other:

1. **Pick the new anchor**: a US trading day on which you can supervise the
   morning, whose *preceding trading day* you can also supervise in the
   evening, and which is none of the three forbidden kinds listed in
   [Reading the clock](#reading-the-clock). The gate's evening is the evening
   of the **certificate day**, which is the preceding *trading* day and not
   simply "the night before": a Monday anchor puts the drills on Friday
   evening and the cold-start proof on Monday morning, with the weekend in
   between. That is allowed — the machine simply stays off over the weekend,
   which is what drill (c) leaves it as anyway — but it is a 63-hour gate and
   the checks stay paused throughout.
2. **Derive the rest** from the table: `FLATTEN_DATE` three calendar months
   after the anchor and rolled forward to a trading day; journaling-only the
   trading day after that; coverage through the journaling-only day.
3. Edit `config/policy.json`: set `"FLATTEN_DATE"` to the derived date as
   `"YYYY-MM-DD"`. Nothing else in that file changes.
4. `npm.cmd run verify` — exit 0. The policy digest has now changed, which is
   what voids the old certificate.
5. Re-run **owner step 4** on the new certificate day; put the new path into
   `.env` as `PRE_ARM_CERTIFICATE=`.
6. Re-run **owner step 5** with `-CoverageThroughDate <journaling-only day>`.
7. **Re-check the three external checks, before any drill.**
   `install-scheduled-task.ps1` derives the cron expressions from the trigger
   it registers, so a different coverage date can print different ones. Compare
   what it just printed with what the three checks are configured with and
   update any that differ. This comes **first**, because the drills measure
   those checks: a drill against a check on the old schedule proves something
   about a deployment that no longer exists, and it would have to be repeated
   anyway.
8. Re-run **owner step 6** in full. The drills were invalidated by the
   re-installation; none of them carries over.
9. Update the calendar with block 9 of
   [`P12-CALENDAR-PROMPTS.md`](P12-CALENDAR-PROMPTS.md), which asks for the new
   anchor and derives the rest rather than shifting.

**Record it**: append a dated line to `STATE.md` saying which day the anchor
moved from, to, and why. That line is the whole audit trail for a run whose
dates no longer match the document you are reading.

### 7. The supervised first regular cycle — Wed 2026-09-09, the 15:15 firing

*Normal PowerShell.* The session lead-in starts 20 minutes before the US open,
so **15:15** is the first firing that runs a cycle — not 15:30. That firing is
the anchor. Watch it and confirm, in order:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
.\tools\show-run-log.ps1 -Since "15:15"
# The journal does not exist yet if the cycle refused; that is a result, not an
# error, so this prints a line rather than a red exception either way.
if (Test-Path C:\Users\felix\glass-box-state\longrun-1\journal.jsonl) {
    Get-Content C:\Users\felix\glass-box-state\longrun-1\journal.jsonl -Tail 3
} else { 'journal.jsonl does not exist -- nothing has been journaled' }
```

1. The log shows the invocation and the printed report, which ends with a
   single JSON line — that line **is** the report; if the log stops before it,
   the cycle did not finish.
2. The journal's last entries include a `BOOTSTRAP` entry. **What a rejected
   account actually looks like is different from what you might expect** — see
   below; it is not a journaled halt.
3. `gbt-liveness`, `gbt-readiness` and `gbt-watchdog` are all green.
4. `.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled` still passes — from a **normal** shell, which is enough to read task definitions.

If 1, 3 or 4 fails, disable both tasks from an elevated shell and move the
anchor (end of step 6).

#### If the account is rejected: what you will actually see

The provenance proof (S-CYC-09) refuses an account that existed, or traded,
before `COMPETITION_START`. On a **first-ever** run the refusal **journals
nothing at all** — no `HALT`, not even a `GAP` — because the epoch seed is
still unspent and no authoritative append is possible until a valid `BOOTSTRAP`
lands. Looking for a `HALT PROVENANCE_BROKEN` here would mean looking for
something that cannot be there. What you see instead is in the **printed
report** and on the endpoint:

```powershell
.\tools\show-run-log.ps1 -Since "15:15"
# In the report's JSON line:
#   "primary": null
#   "entriesBlocked": [ ... "PROVENANCE" ... ]
#   "alarmConditions": [ ... "COMPETITION_PROVENANCE_FAILED" ... ]
#   "ping": "fail"
# And in STATE_DIR: journal.jsonl is still EMPTY (0 entries).
Get-Content C:\Users\felix\glass-box-state\longrun-1\journal.jsonl -Tail 3
# expect on this path: nothing at all.
```

`gbt-readiness` goes red with `COMPETITION_PROVENANCE_FAILED`. Nothing traded
and nothing can: the unspent seed is what blocks every order.

**But the state directory is not empty of consequence, and an earlier version of
this document said it was.** Since every refused halt marks the durable fence
before it attempts its entry, this refusal leaves a mark behind even though the
journal is untouched — and its reason, `PROVENANCE_BROKEN`, is **sticky**, so
no manual release can clear it. Look at all three files, not two:

```powershell
Get-Content C:\Users\felix\glass-box-state\longrun-1\epoch.json
# expect on this path: "seedPending": true, "fencePending": true,
#   "fenceReason": "PROVENANCE_BROKEN"
```

That mark is the record of a rejected account, it is irreversible by design,
and it is the reason the next step is a **new state directory** rather than a
cleaned-out one.

**Swapping the account.** The anchor procedure in step 6 changes dates; it does
**not** change credentials, so both are needed and in this order:

*Elevated PowerShell, first:*

```powershell
Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
```

Then:

1. Create a new Alpaca paper account, options level 3, **created at or after**
   `COMPETITION_START` (Sun 2026-09-06 02:00 local). Note its creation instant
   in `STATE.md` before anything else.
2. Replace **all three** values in `.env` — `ALPACA_COMP_KEY_ID`,
   `ALPACA_COMP_SECRET_KEY` and `ALPACA_COMP_ACCOUNT_ID`. Changing the two
   credentials and leaving the account id is the mistake this list exists to
   prevent: the binding check would then refuse every mutation and halt the
   deployment on `ACCOUNT_BINDING_MISMATCH`.
3. **Point `STATE_DIR` at a NEW directory and keep the old one.** Not
   emptied, not edited, not reused:
   ```
   STATE_DIR=C:\Users\felix\glass-box-state\longrun-2
   BOOTSTRAP_DIAGNOSTIC_SINK=C:\Users\felix\glass-box-state\longrun-2-bootstrap.log
   ```
   ```powershell
   New-Item -ItemType Directory -Force C:\Users\felix\glass-box-state\longrun-2 | Out-Null
   Get-ChildItem C:\Users\felix\glass-box-state\longrun-2   # expect: nothing
   ```
   An earlier version of this document said the first-ever failure left nothing
   irreversible and that `longrun-1` could simply be emptied. That was wrong
   and it was wrong in the dangerous direction: the refusal leaves a sticky
   `PROVENANCE_BROKEN` mark in `epoch.json`, so emptying the directory would
   have deleted a durable stop by hand — the single thing the whole fence
   mechanism exists to make impossible. The failed attempt is evidence: keep
   `longrun-1`, and note in `STATE.md` which account and which day it belongs
   to. This holds for both shapes of the failure, the empty first run and a
   later one where a `GAP` or halt did land; the difference is only in what is
   inside, never in whether it is kept.
4. Re-run the **step 2** configuration check (the first of the two), and the
   **step 5** check for the certificate and ping URLs.
5. The certificate binds to the *policy*, not to the account, so it survives an
   account swap on its own. But the anchor has moved by now, and moving the
   anchor changes `FLATTEN_DATE` and therefore the policy digest — so follow
   the anchor procedure at the end of step 6 from its step 2 onward, which
   re-certifies.
6. Re-run **owner step 6** in full before enabling anything.

**This cycle is the anchor for the flatten date.** If it does not happen on
2026-09-09, the dates move: derive them again from the table in
[Reading the clock](#reading-the-clock) and record the change in `STATE.md`.
Nobody else is watching this run — "report it" means write it down where the
next session will read it.

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
* `DEADLINE_FLATTEN_FAILED` — **the one alert whose window can close.** On the
  flatten date the ladder could not close the book before the US close. This is
  case 3 of
  [Manual intervention](#manual-intervention-permission-and-executability-are-two-questions):
  you may close by hand, and whether you *can* depends entirely on whether the
  US session is still open. Inside it, close whole structures in the broker
  dashboard and note every one in `STATE.md`. After the close there is nothing
  to do tonight and nothing that could be done — options do not trade after
  16:00 New York — so write down what is open and act at **15:35** local on the
  next trading day, five minutes after the open (14:35 in the clock-change
  week). The position's maximum loss was fixed when it was opened;
  that is what carries it overnight.

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

**Clock changes.** Times in this document are local. Until Sunday 2026-10-25
that is CEST; afterwards CET. From Monday 2026-10-26 the same instants read
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
The first figure published here (162 ms, ~500 MiB) was measured against a
journal of *invalid* entries, so the parser stopped at the first line and the
number meant nothing. A gate measured it properly on **150 MiB of valid
entries: about 1.5 s and 1.2 GiB of transient memory** for the two reads it did
then; the reads were merged into one afterwards, so expect roughly half of
that, in a process that exits immediately. If it ever becomes visible — a
firing that takes minutes, or memory pressure on this machine — that is the
number to compare against, and the honest reading of the earlier one is that a
measurement whose fixture avoids the work measures nothing.

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
