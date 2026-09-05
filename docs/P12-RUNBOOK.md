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
`COMPETITION_START`; an older account makes the bootstrap refuse. If that
happens, tell me rather than editing the date: editing it voids the certificate.

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

Check the configuration without printing any secret. This is the **step 2**
check, so it asks only for what step 2 sets — the ping URLs come from step 3
and `PRE_ARM_CERTIFICATE` from step 4, and demanding them here would abort a
correct run (R44-B14):

```powershell
node -e "const {loadEnvironment}=require('./dist/shell/runtime-config.js');const e=loadEnvironment(process.cwd(),process.env);for(const k of ['ALPACA_PROFILE','ALPACA_COMP_ACCOUNT_ID','ALPACA_COMP_KEY_ID','ALPACA_COMP_SECRET_KEY','STATE_DIR','BOOTSTRAP_DIAGNOSTIC_SINK'])console.log(k.padEnd(28), /KEY|SECRET|TOKEN|URL/.test(k)?(e[k]?'<set>':'<MISSING>'):(e[k]??'<MISSING>'))"
```

**Abort if:** `ALPACA_PROFILE` is not `competition`, `STATE_DIR` still points at
`competition-2`, or any of these six reads `<MISSING>`.

The same command with the later keys is the **step 5** gate, run after step 3
and step 4 have produced them, immediately before installing:

```powershell
node -e "const {loadEnvironment}=require('./dist/shell/runtime-config.js');const e=loadEnvironment(process.cwd(),process.env);for(const k of ['PRE_ARM_CERTIFICATE','HEALTHCHECK_PING_URL','HEALTHCHECK_LIVENESS_URL','HEALTHCHECK_WATCHDOG_URL'])console.log(k.padEnd(28), /KEY|SECRET|TOKEN|URL/.test(k)?(e[k]?'<set>':'<MISSING>'):(e[k]??'<MISSING>'))"
```

**Abort if:** any of those four reads `<MISSING>` at that point.

### 3. The three notification checks — by Mon 2026-09-07, 22:00

*Browser, then normal PowerShell.*

At healthchecks.io (free tier is enough), create **three** checks. The third
exists because the other two cannot see the watchdog: liveness comes from the
cycle wrapper and readiness from the state files, so a watchdog that is disabled
or broken leaves both green.

Get the exact schedules — the installer derives them from the trigger it will
register, so they match the real firings rather than an approximation:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
.\tools\install-scheduled-task.ps1 -WhatIf -CoverageThroughDate 2026-12-09
```

It prints, before the registration preview, a cron expression, an **IANA**
timezone (`Europe/Berlin`, read from this host through node — healthchecks.io
does not accept the Windows name `W. Europe Standard Time`) and a grace for each
of the three checks. This preview runs in a **normal** shell: since R44-B12 it
prints the schedules before it touches anything that needs elevation.

Configure the checks with **exactly** those values, set each check's schedule
type to "cron", and point all three at the channel you will actually see at
night. **Also switch on the account's recurring "down" reminder** (hourly or
daily) — a check sends one notification when it goes down and one when it
recovers, so without the reminder a single push missed at 22:00 is a silent
night. Then put the ping URLs into `.env`:

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

Then confirm the reminder itself: leave one check down for the reminder's
period and check that a **second** message arrives. If it does not, the account
setting is not on, or not on that channel.

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
# expect: both Disabled, or not registered at all. If either is Ready, stop and
# disable it from an elevated shell before continuing.

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

**Expect:** `verdict: PASS`, the dev account flat, and a printed certificate
path under `evidence/pre-arm/`.
**Abort if:** the verdict is anything but PASS, or the dev account is not flat.

Then put that path into `.env` as `PRE_ARM_CERTIFICATE=` and re-run the
configuration check from step 2. **Close this PowerShell window** before step 5,
so no dev variable can survive in it.

### 5. Install the tasks — Tue 2026-09-08, after PASS

*Elevated PowerShell ("Run as administrator").* Registration needs it.

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
npm.cmd run build   # npm.cmd, not npm: npm.ps1 is blocked by this host's execution policy (R44-B16)
.\tools\install-scheduled-task.ps1 -CoverageThroughDate 2026-12-09
```

**Expect:** `SCHEDULE COVERAGE OK`, then both tasks registered **and
immediately disabled** — the output says so. It refuses to register at all if
the trigger window does not provably contain every exchange session through the
given date.

Then, still elevated:

```powershell
.\tools\verify-scheduled-tasks.ps1
# expect: SCHEDULER CHECK PASSED (35 checks)
```

**Abort if:** any check fails. Do not enable anything yet.

### 6. The activation gate — Tue 2026-09-08 evening into Wed 2026-09-09 morning

*Elevated PowerShell for every enable/disable below.*

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
exactly the signals they are about.

**The safety rule that replaces the old ordering, and it is absolute:** no
firing may run a cycle before the anchor. Concretely — the tasks may be enabled
only after **22:10 CEST** on Tuesday, and if any drill is still open at
**15:05 CEST** on Wednesday, both tasks are disabled again and the anchor moves
to the next trading day (which changes `FLATTEN_DATE`, the policy digest and the
certificate — see *The dates*).

Conditions 1–4 are met before the drills begin:

1. `npm.cmd run verify` exit 0 (`npm.cmd`, not `npm`: `npm.ps1` is blocked by
   this host's execution policy). **proven by test**
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
# expect: SCHEDULER CHECK PASSED, both states Ready
Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 5
# expect, within 15 min: a "skip: outside the exchange session" line, liveness sent, readiness reported.
# If any line instead shows a cycle running, STOP and disable both tasks: the
# session bound is wrong and the anchor must not be today.
```

Wait until all three checks read green in the healthchecks dashboard before
starting drill (a). A drill against a check that was already down proves
nothing.

5. **Three silence drills**, each a different path, each confirmed. The waits
   are the check period plus its grace: watchdog 20 min, liveness 45 min,
   readiness 65 min.

   ```powershell
   # (a) Tue ~22:40 — the watchdog alone. It is the failure the other two
   #     checks cannot see, so this is the drill that earned the third endpoint.
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog' -TaskPath '\GlassBoxTrading\'
   # wait 20 min. expect: watchdog DOWN, liveness and readiness still UP.
   Enable-ScheduledTask  -TaskName 'GlassBoxTrading-Watchdog' -TaskPath '\GlassBoxTrading\'
   # wait for the watchdog check to go green again before continuing.

   # (b) Tue ~23:15 — both tasks. The last firing of the day is 23:45, and the
   #     checks keep waiting for the ping they expected, so the alerts land
   #     around 00:00 (liveness) and 00:20 (readiness). Set an alarm; a drill
   #     whose alert you sleep through has proven nothing either way.
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
   # expect: all three DOWN. Leave them disabled overnight; nothing is expected
   # to ping until Wed 14:00 anyway.

   # (c) Wed 14:00 — the machine itself, in the pre-session part of the trigger
   #     window. Re-enable both tasks, confirm one green firing at 14:00 or
   #     14:15, then shut the machine down for 25 minutes.
   # expect: all three DOWN while it is off. This is the only drill that proves
   # the alert does not depend on the machine it reports about, and it is also
   # condition 6's restart proof: boot it again and the firings must resume by
   # themselves.
   ```

6. **Restart and signed-out operation**, neither of which any script can assert.
   Both are produced by the recovery from drill (c), still before the session:

   ```powershell
   # restart: after booting from drill (c), with both tasks enabled,
   Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 5
   # expect: a firing after the boot, without anyone starting anything, and all
   # three checks green again. If it needed a login to resume, S4U is not doing
   # what it is configured to do -- stop here.

   # signed out: at ~14:50, sign out (do NOT shut down). The 15:00 firing is
   # still outside the session, so it skips, logs and reports without trading.
   # Sign back in afterwards and read the same log:
   Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 5
   # expect: a 15:00 line written while nobody was signed in. S4U is configured
   # for exactly this, and configuration is not evidence.
   ```

**The gate itself, Wed by 15:05 CEST:** all six conditions hold, both tasks are
enabled, and `.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled` passes. If any
of that is not true, disable both tasks now — the anchor moves, and step 4's
certificate has to be repeated after `FLATTEN_DATE` changes.

```powershell
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
# expect: SCHEDULER CHECK PASSED (35 checks), and both states Ready
```

### 7. The supervised first regular cycle — Wed 2026-09-09, from 15:15 CEST

*Normal PowerShell.* The session lead-in starts 20 minutes before the US
open, so the **15:15** firing is the first one that runs a cycle — not
15:30. That firing is the anchor. Watch it and confirm, in order:

```powershell
Get-Content C:\Users\felix\glass-box-state\longrun-1\cycle-run.log -Tail 20
Get-Content C:\Users\felix\glass-box-state\longrun-1\journal.jsonl -Tail 2
```

1. `cycle-run.log` shows the invocation and the whole printed report.
2. The journal has a `BOOTSTRAP` entry and the provenance proof passed.
3. Liveness, readiness and watchdog checks are all green.
4. `.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled` still passes.

**This cycle is the anchor for the flatten date.** If it does not happen on
2026-09-09, stop and tell me: the date moves and the certificate must be redone.

---

## During the run

Who detects each kind of failure, which signal appears or goes missing,
after how long, and what the system will and will not close by itself:
[`P12-INCIDENT-PATHS.md`](P12-INCIDENT-PATHS.md). Read it once before
activation, not during the first alert.

**Weekly:** publish the dashboard through the digest-neutral path in
[`PUBLISH-RUNBOOK.md`](PUBLISH-RUNBOOK.md), from the `gbt-publish` worktree, and
check the probe comes back clean.

**On a readiness alert.** The body names the impediment.

* `HALT_STANDING:<reason>` — the deployment stopped and needs a decision.
* `CREDENTIAL_FENCE_UNRELEASED` — a credential rejection stands. Run the fence
  procedure **before** releasing: the agent could not read its working orders
  when the credentials were refused, so it does not know what is resting at the
  broker. Check and cancel in the broker dashboard first.
* `STATE_NOT_DURABLE:<detail>` — the journal, epoch store or halt file cannot be
  written. Usually a full disk, which the probe now actually detects: it writes
  and flushes a byte rather than only checking permissions (R44-B3). Entries
  are blocked until it is fixed; risk-reducing closes still run.
* `AUTHORITY_STATE_UNREADABLE` or `JOURNAL_CORRUPT:line <n>` — the durable
  state no longer parses. No writer can act on it, so nothing is trading. Do
  not repair by hand: quarantine the state directory, keep it, and report.

The release, when you have done the procedure — *normal PowerShell*:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
node dist\shell\unhalt-cli.js --operator felix --reason "what you checked and why you are releasing"
# prints the standing state and the fence procedure, and changes NOTHING without --confirm.
# Read the "HALT seq <n>" it prints; that number goes into the next command.
node dist\shell\unhalt-cli.js --operator felix --reason "..." --expect-halt-seq <n> --confirm
# expect: "RELEASED: UNHALT seq <m>" and "fence mark now false"
```

**`--expect-halt-seq` is not optional in practice** (R44-B9). It is the
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

**Never during the run:** change a strategy parameter or a risk limit. If one
must change, the measurement period **ends** and a new one begins
([`P12-EVALUATION.md`](P12-EVALUATION.md)); the two are never summed.

**Disk:** budget about 200 MB for the journal plus the publish tree. Measured at
69.4 KiB per entry, roughly 2,000 entries.

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
   # exit 0 only when the entry landed
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
