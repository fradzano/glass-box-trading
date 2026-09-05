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
| Install + verify + activation gate | Tue 2026-09-08, after PASS | owner steps 5–6 |
| **First regular cycle** | **Wed 2026-09-09**, from 15:30 CEST, supervised | owner step 7 — the anchor |
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

Check the configuration without printing any secret:

```powershell
node -e "const {loadEnvironment}=require('./dist/shell/runtime-config.js');const e=loadEnvironment(process.cwd(),process.env);for(const k of ['ALPACA_PROFILE','ALPACA_COMP_ACCOUNT_ID','STATE_DIR','BOOTSTRAP_DIAGNOSTIC_SINK','PRE_ARM_CERTIFICATE','HEALTHCHECK_PING_URL','HEALTHCHECK_LIVENESS_URL','HEALTHCHECK_WATCHDOG_URL'])console.log(k.padEnd(28), /KEY|SECRET|TOKEN|URL/.test(k)?(e[k]?'<set>':'<MISSING>'):(e[k]??'<MISSING>'))"
```

**Abort if:** `ALPACA_PROFILE` is not `competition`, `STATE_DIR` still points at
`competition-2`, or anything reads `<MISSING>`.

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

It prints, near the end, a cron expression, a timezone and a grace for each of
the three checks. Configure them with **exactly** those values, set each check's
schedule type to "cron", and point all three at the channel you will actually
see at night. Then put the ping URLs into `.env`:

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
    npm run certificate -- --owner-go
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
npm run build
.\tools\install-scheduled-task.ps1 -CoverageThroughDate 2026-12-09
```

**Expect:** `SCHEDULE COVERAGE OK`, then both tasks registered **and
immediately disabled** — the output says so. It refuses to register at all if
the trigger window does not provably contain every exchange session through the
given date.

Then, still elevated:

```powershell
.\tools\verify-scheduled-tasks.ps1
# expect: SCHEDULER CHECK PASSED (30 checks)
```

**Abort if:** any check fails. Do not enable anything yet.

### 6. The activation gate — Tue 2026-09-08

*Elevated PowerShell for the enable/disable steps.*

All six of these must hold before the run is allowed to be unattended. The first
three are proven in this repository; the last three can only be proven on this
machine, and none of them has been.

1. `npm run verify` exit 0. **proven by test**
2. `.\tools\verify-scheduled-tasks.ps1` passes. **proven on the host in step 5**
3. Certificate run four PASS. **step 4**
4. **Alert receipt**, all three checks, confirmed on your device. **step 3**
5. **Three silence drills**, each a different path, each confirmed:
   ```powershell
   # a. the watchdog alone — the case that was invisible until it got its own check
   Enable-ScheduledTask  -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
   # wait out the watchdog check's period + grace during a session.
   # expect: watchdog check DOWN, liveness and readiness still UP.

   # b. both tasks
   Disable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
   # expect: liveness and readiness DOWN as well.

   # c. the machine itself — shut it down during a session for one period + grace.
   # expect: all three DOWN. This is the only drill that proves the alert does not
   # depend on the machine it is reporting about.
   ```
6. **Restart and signed-out operation**, neither of which any script can assert:
   ```powershell
   # restart: with both tasks enabled, reboot during a session and confirm from
   #   the liveness check and STATE_DIR\cycle-run.log that firings resumed.
   # signed out: with both tasks enabled, sign out (do not shut down) and confirm
   #   the next firing still produced a cycle-run.log line. S4U is configured for
   #   exactly this, and configuration is not evidence.
   ```

Only when all six hold:

```powershell
Enable-ScheduledTask -TaskName 'GlassBoxTrading-AgentCycle' -TaskPath '\GlassBoxTrading\'
Enable-ScheduledTask -TaskName 'GlassBoxTrading-Watchdog'   -TaskPath '\GlassBoxTrading\'
.\tools\verify-scheduled-tasks.ps1 -ExpectEnabled
# expect: SCHEDULER CHECK PASSED, and both states Ready
```

### 7. The supervised first regular cycle — Wed 2026-09-09, from 15:30 CEST

*Normal PowerShell.* Watch one full cycle and confirm, in order:

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
  written. Usually a full disk. Entries are blocked until it is fixed;
  risk-reducing closes still run.

The release, when you have done the procedure — *normal PowerShell*:

```powershell
cd C:\Users\felix\source\repos\glass-box-trading
node dist\shell\unhalt-cli.js --operator felix --reason "what you checked and why you are releasing"
# prints the standing state and the fence procedure, and changes NOTHING without --confirm
node dist\shell\unhalt-cli.js --operator felix --reason "..." --confirm
# expect: "RELEASED: UNHALT seq <n>" and "fence mark now false"
```

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
