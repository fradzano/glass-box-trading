<#
.SYNOPSIS
    Installs (or removes) the two Windows Scheduled Tasks that operate Glass
    Box Trading during competition hours: the agent cycle and the dead-man
    watchdog.

.DESCRIPTION
    Registers two tasks under the "\GlassBoxTrading\" Task Scheduler folder:

      GlassBoxTrading-AgentCycle
        `powershell.exe -File tools\cycle-run.ps1`, which runs
        `node dist/shell/agent-cli.js` and appends everything it printed to
        cycle-run.log in STATE_DIR (scenario #75: the task used to invoke node
        directly and discard the cycle report, so on 2026-09-03 seven refused
        cycles left no trace outside the journal). Working directory =
        -RepoRoot, on a weekly Mon-Fri trigger that fires every
        CYCLE_INTERVAL_MS (read from config/policy.json; 900000 ms = 15 min as
        of writing) from the US regular-hours open through the close, both
        computed for "today" in America/New_York (see Get-TodaySessionLocal
        below). agent-cli.ts loads .env itself via
        src/shell/runtime-config.ts, so no secrets are passed on the command
        line or stored in the task definition -- the task only needs to run
        with RepoRoot as its working directory.

      GlassBoxTrading-Watchdog
        `powershell.exe -File tools\watchdog-run.ps1`, firing every
        -WatchdogIntervalMinutes (default 5, must stay below
        DEAD_MAN_BOUND_MS from config/policy.json -- 3,000,000 ms = 50 min as
        of writing) across the same Mon-Fri session window. watchdog-run.ps1
        computes the CLI's required nowMs/opensAtMs/closesAtMs/deadManBoundMs
        arguments at each firing and calls
        `node dist/shell/watchdog-cli.js`. See that script's header for the
        scope: watchdog-cli.ts composes real broker and market ports
        (src/shell/watchdog-runtime.ts), so a firing fences the writer, sets
        HALT and then flattens the open book -- and degrades to
        fence-and-halt-only, with the reason logged, when the configuration,
        the credentials or the account binding do not compose.

    IDEMPOTENT: re-running this script replaces both tasks (existing
    definitions with the same name are unregistered first, then
    re-registered from the current parameters/policy values). -Uninstall
    removes them instead.

    LOGIN-TYPE LIMITATION (read before relying on unattended operation):
    "run whether the user is logged on or not" normally requires a stored
    password, which this script will not prompt for or accept on the command
    line (no secrets on the command line, no interactive credential capture
    in an idempotent/-WhatIf-able script). Instead this script defaults to
    LogonType S4U ("Service for User"): the task runs under the given user's
    identity, logged on or not, WITHOUT a stored password. S4U needs the
    "Log on as a batch job" (SeBatchLogonRight) local right for that account,
    which local Administrators normally already hold. Windows 11 Home has no
    secpol.msc snap-in to grant that right by hand if it is ever missing;
    `secedit.exe` (present on Home) can still edit it from the command line
    if registration fails with a logon-right error. The documented fallback
    is `-LogonType Interactive`, which never needs that right but then only
    runs while the configured user has an active interactive session.

.PARAMETER RepoRoot
    Absolute path to the glass-box-trading checkout. Defaults to the parent
    of this script's directory (tools\..).

.PARAMETER NodePath
    Absolute path to node.exe. Defaults to `(Get-Command node).Source`.

.PARAMETER UserId
    Account the tasks run as. Defaults to the current user ("$env:USERDOMAIN\$env:USERNAME").

.PARAMETER LogonType
    'S4U' (default, see above) or 'Interactive'.

.PARAMETER WatchdogIntervalMinutes
    Watchdog firing cadence. Must be strictly below DEAD_MAN_BOUND_MS (read
    from config/policy.json) or the script refuses to register anything.
    Default 5.

.PARAMETER EdgeMarginMinutes
    How far the trigger window is padded beyond the exchange session on each
    side. The default of 90 covers the one-hour offset that exists in the week
    between the European and American clock changes, with half an hour to spare
    in either direction, measured by tools\check-schedule-coverage.mjs
    (S-G14-06). tools\cycle-run.ps1 skips outside the real session, so the
    padding is inert.

.PARAMETER CoverageThroughDate
    `yyyy-MM-dd`. Registration is refused unless the trigger window provably
    contains the exchange session on every weekday up to this date -- for a long
    deployment, pass its planned flatten date. Defaults to 120 days out. This is
    the check that makes "the task is registered" mean something across a clock
    change; `Ready` on its own never did.

.PARAMETER TaskFolder
    Task Scheduler folder the two tasks live in. Default '\GlassBoxTrading\'.

.PARAMETER Activate
    Register the tasks ENABLED. Without it they are registered and immediately
    disabled, so installing is not the same act as going live: the activation
    gate (verifier, certificate, confirmed alarm receipt, supervised first
    cycle) sits between the two on purpose.

.PARAMETER Uninstall
    Remove both tasks (and nothing else) instead of installing them.

.EXAMPLE
    .\tools\install-scheduled-task.ps1 -WhatIf
    Preview registration without touching the Task Scheduler database.

.EXAMPLE
    .\tools\install-scheduled-task.ps1
    Install (or replace) both tasks for the current user.

.EXAMPLE
    .\tools\install-scheduled-task.ps1 -Uninstall
    Remove both tasks.
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    # Left blank by default and resolved from $PSScriptRoot in the body below:
    # PowerShell 5.1 does not reliably populate $PSScriptRoot while evaluating
    # a param-block default when the script also declares CmdletBinding(),
    # so a default expressed here would silently break.
    [string]$RepoRoot,
    [string]$NodePath,
    [string]$UserId = "$env:USERDOMAIN\$env:USERNAME",
    [ValidateSet('S4U', 'Interactive')]
    [string]$LogonType = 'S4U',
    [ValidateRange(1, 1000)]
    [int]$WatchdogIntervalMinutes = 5,
    [ValidateRange(0, 240)]
    [int]$EdgeMarginMinutes = 90,
    [string]$CoverageThroughDate,
    [string]$TaskFolder = '\GlassBoxTrading\',
    [switch]$Activate,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $PSScriptRoot }

$CycleTaskName = 'GlassBoxTrading-AgentCycle'
$WatchdogTaskName = 'GlassBoxTrading-Watchdog'

if (-not (Get-Module -ListAvailable -Name ScheduledTasks)) {
    throw 'The ScheduledTasks module is not available on this host (requires Windows with Task Scheduler).'
}
Import-Module ScheduledTasks -ErrorAction Stop

function Get-EasternTimeZoneInfo {
    # Kept in sync by hand with the identical helper in watchdog-run.ps1.
    try {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('America/New_York')
    } catch {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
    }
}

function Get-SessionWindowLocal {
    # The trigger window in THIS machine's local time, wide enough to contain
    # the American regular session under every offset the deployment will live
    # through (S-G14-06, scenario #80).
    #
    # Why wide: the trigger is registered at a fixed local wall-clock time,
    # but the American and European clock changes fall on different Sundays --
    # in 2026, Europe ends summer time on Oct 25 and the United States ends
    # daylight saving on Nov 1. For the week between them the New York session
    # starts an hour earlier in local terms, and a trigger pinned to the
    # installation day's local time would have missed the first hour of every
    # session that week. So the window is computed for the session on the
    # installation date and then padded by -EdgeMarginMinutes on both sides,
    # which covers a one-hour shift in either direction.
    #
    # What keeps this from being wasteful: tools\cycle-run.ps1 asks the
    # exchange clock on every firing and skips outside the real session, so the
    # extra width costs a few cheap wrapper invocations, not agent cycles.
    # Holidays and early closes remain unknown to both -- a firing on one is a
    # normal, journaled no-trade cycle (S-CYC-08/S-CYC-03), which is why "task
    # fired" is never the same claim as "market was open".
    param([int]$EdgeMarginMinutes = 75)
    $eastern = Get-EasternTimeZoneInfo
    $nowUtc = [System.DateTime]::UtcNow
    $todayEasternDate = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $eastern).Date
    $openEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(9).AddMinutes(30), [System.DateTimeKind]::Unspecified)
    $closeEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(16), [System.DateTimeKind]::Unspecified)
    $openUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($openEastern, $eastern)
    $closeUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($closeEastern, $eastern)
    # The window is then snapped outward so its firings land on a schedule an
    # external check can state exactly (R43-B8): the start drops to the hour and
    # the end rises to the last quarter of an hour. Without that, a cron of
    # `0,15,30,45 <hours>` expects a ping at :45 of the final hour that the
    # trigger never produces, and the check alerts every single evening.
    $paddedOpen = $openUtc.ToLocalTime().AddMinutes(-$EdgeMarginMinutes)
    $paddedClose = $closeUtc.ToLocalTime().AddMinutes($EdgeMarginMinutes)
    $snappedOpen = $paddedOpen.Date.AddHours($paddedOpen.Hour)
    $snappedClose = $paddedClose.Date.AddHours($paddedClose.Hour).AddMinutes(45)
    if ($snappedClose -lt $paddedClose) { $snappedClose = $snappedClose.AddHours(1) }
    return [pscustomobject]@{
        OpenLocal    = $snappedOpen
        CloseLocal   = $snappedClose
        SessionOpen  = $openUtc.ToLocalTime()
        SessionClose = $closeUtc.ToLocalTime()
    }
}

function Get-CronExpression {
    # The expected-ping schedule for a check, stated exactly from the trigger
    # this installer is about to register, in THIS machine's local time.
    param([datetime]$Start, [datetime]$End, [int]$IntervalMinutes)
    $minutes = @()
    for ($minute = 0; $minute -lt 60; $minute += $IntervalMinutes) { $minutes += $minute }
    # Callers are refused above unless the interval divides 60, so the
    # enumeration below is exact rather than approximate (R44-B11).
    if (60 % $IntervalMinutes -ne 0) { throw "Get-CronExpression cannot state a $IntervalMinutes-minute interval exactly." }
    $minuteField = if ($IntervalMinutes -eq 1) { '*' } else { ($minutes -join ',') }
    return "$minuteField $($Start.Hour)-$($End.Hour) * * 1-5"
}

function Remove-ExistingTask {
    param([string]$Name)
    $existing = Get-ScheduledTask -TaskName $Name -TaskPath $TaskFolder -ErrorAction SilentlyContinue
    if ($null -eq $existing) { return }
    if ($PSCmdlet.ShouldProcess("$TaskFolder$Name", 'Remove existing scheduled task (idempotent replace)')) {
        Unregister-ScheduledTask -TaskName $Name -TaskPath $TaskFolder -Confirm:$false
    }
}

# ---------------------------------------------------------------------------
# Uninstall path
# ---------------------------------------------------------------------------
if ($Uninstall) {
    Write-Host "Removing scheduled tasks under '$TaskFolder' ..."
    Remove-ExistingTask -Name $CycleTaskName
    Remove-ExistingTask -Name $WatchdogTaskName
    Write-Host 'Done.'
    return
}

# ---------------------------------------------------------------------------
# Install path: resolve and validate inputs
# ---------------------------------------------------------------------------
if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "RepoRoot '$RepoRoot' does not exist." }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { throw 'node was not found on PATH; pass -NodePath explicitly.' }
    $NodePath = $nodeCommand.Source
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw "NodePath '$NodePath' does not exist." }

$agentEntry = Join-Path $RepoRoot 'dist\shell\agent-cli.js'
$cycleRunner = Join-Path $RepoRoot 'tools\cycle-run.ps1'
$watchdogRunner = Join-Path $RepoRoot 'tools\watchdog-run.ps1'
if (-not (Test-Path -LiteralPath $agentEntry)) {
    Write-Warning "'$agentEntry' is missing; run 'npm run build' before the tasks can actually operate. Registration continues -- the task will simply fail at run time until the build exists."
}
foreach ($runner in @($cycleRunner, $watchdogRunner)) {
    if (-not (Test-Path -LiteralPath $runner)) {
        throw "'$runner' is missing; it ships alongside this installer and must not be removed."
    }
}

$policyPath = Join-Path $RepoRoot 'config\policy.json'
if (-not (Test-Path -LiteralPath $policyPath)) { throw "'$policyPath' is missing." }
$policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
$cycleIntervalMs = [int64]$policy.CYCLE_INTERVAL_MS
$deadManBoundMs = [int64]$policy.DEAD_MAN_BOUND_MS
if ($cycleIntervalMs -le 0) { throw 'config/policy.json CYCLE_INTERVAL_MS is missing or not positive.' }
if ($deadManBoundMs -le 0) { throw 'config/policy.json DEAD_MAN_BOUND_MS is missing or not positive.' }
$cycleIntervalMinutes = [math]::Round($cycleIntervalMs / 60000.0)
if ($cycleIntervalMinutes -lt 1) { $cycleIntervalMinutes = 1 }

# R44-B11: the printed cron enumerates minutes within the hour, so an interval
# that does not divide 60 cannot be stated exactly -- a 7-minute repetition
# drifts (Windows fires 14:56, 15:03; the cron expects 14:56, 15:00), and the
# check would alert on a healthy deployment. `*/7` was printed as though it
# matched. Refuse the interval rather than print a schedule that is wrong.
foreach ($candidate in @(@{ Name = 'CYCLE_INTERVAL_MS'; Minutes = $cycleIntervalMinutes }, @{ Name = '-WatchdogIntervalMinutes'; Minutes = $WatchdogIntervalMinutes })) {
    if (60 % $candidate.Minutes -ne 0) {
        throw "$($candidate.Name) = $($candidate.Minutes) min does not divide 60, so no cron expression states its firings exactly and the external check would alert on a healthy run. Pick a divisor of 60 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60)."
    }
}

if (($WatchdogIntervalMinutes * 60000) -ge $deadManBoundMs) {
    throw "WatchdogIntervalMinutes=$WatchdogIntervalMinutes min (= $($WatchdogIntervalMinutes * 60000) ms) is not below config/policy.json DEAD_MAN_BOUND_MS=$deadManBoundMs ms ($([math]::Round($deadManBoundMs / 60000.0)) min). Pick a smaller -WatchdogIntervalMinutes."
}

$session = Get-SessionWindowLocal -EdgeMarginMinutes $EdgeMarginMinutes
$sessionDuration = New-TimeSpan -Start $session.OpenLocal -End $session.CloseLocal
if ($sessionDuration.TotalMinutes -le 0) {
    throw "Computed session window is empty or inverted (open=$($session.OpenLocal), close=$($session.CloseLocal)); refusing to register a trigger with no repetition span."
}

Write-Host "Policy: CYCLE_INTERVAL_MS=$cycleIntervalMs ($cycleIntervalMinutes min), DEAD_MAN_BOUND_MS=$deadManBoundMs ($([math]::Round($deadManBoundMs / 60000.0)) min)"
Write-Host "Exchange session today (local time, from America/New_York 09:30-16:00): $($session.SessionOpen) .. $($session.SessionClose)"
Write-Host "Trigger window (that session padded by $EdgeMarginMinutes min on both sides, so it still contains the session across both DST changes): $($session.OpenLocal) .. $($session.CloseLocal) ($([math]::Round($sessionDuration.TotalMinutes)) min)"
Write-Host "cycle-run.ps1 skips outside the real session on every firing, so the padding costs wrapper invocations, not agent cycles."

# ---------------------------------------------------------------------------
# Principal and settings shared by both tasks
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# S-G14-06: prove the trigger window contains every session it must, before
# registering anything. A registered task that silently misses the first hour
# of each session for a week is worse than a refused installation.
# ---------------------------------------------------------------------------
$coverageScript = Join-Path $RepoRoot 'tools\check-schedule-coverage.mjs'
if (-not (Test-Path -LiteralPath $coverageScript)) { throw "'$coverageScript' is missing; it ships alongside this installer." }
if ([string]::IsNullOrWhiteSpace($CoverageThroughDate)) { $CoverageThroughDate = [System.DateTime]::UtcNow.AddDays(120).ToString('yyyy-MM-dd') }
$installedOn = [System.DateTime]::UtcNow.ToString('yyyy-MM-dd')
$coverageArgs = @($coverageScript, '--from', $installedOn, '--to', $CoverageThroughDate, '--installed-on', $installedOn, '--margin', "$EdgeMarginMinutes")
Write-Host ''
Write-Host "Schedule coverage check: $NodePath $($coverageArgs -join ' ')"
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $coverageOutput = & $NodePath @coverageArgs 2>&1
    $coverageExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousPreference
}
$coverageOutput | ForEach-Object { Write-Host "  $_" }
if ($coverageExit -ne 0) {
    throw "The trigger window does not contain every exchange session through $CoverageThroughDate (exit $coverageExit). Raise -EdgeMarginMinutes or re-install closer to the deployment; nothing was registered."
}

# ---------------------------------------------------------------------------
# The external check schedules.
#
# R44-B12: this block used to sit AFTER New-ScheduledTaskPrincipal, which needs
# an elevated shell for LogonType S4U. In the normal PowerShell the runbook
# prescribes for the preview, `-WhatIf` therefore died with "access denied"
# before printing a single cron -- the one output the owner is told to copy.
# It is computed and printed here, before anything that needs elevation.
# ---------------------------------------------------------------------------
$cycleCron = Get-CronExpression -Start $session.OpenLocal -End $session.CloseLocal -IntervalMinutes $cycleIntervalMinutes
$watchdogCron = Get-CronExpression -Start $session.OpenLocal -End $session.CloseLocal -IntervalMinutes $WatchdogIntervalMinutes
# R44-B13: healthchecks.io takes IANA zone names ("Europe/Berlin"), not the
# Windows ids [TimeZoneInfo]::Local.Id returns ("W. Europe Standard Time").
# Windows PowerShell 5.1 has no converter, so the host's own Node -- already
# required above and already invoked for the coverage check -- answers it.
$localZone = ''
try { $localZone = (& $NodePath -e "process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)") } catch { $localZone = '' }
if ([string]::IsNullOrWhiteSpace($localZone)) {
    throw "Could not determine this host's IANA time zone through node ($NodePath). The external checks need an IANA name such as 'Europe/Berlin'; the Windows id '$([System.TimeZoneInfo]::Local.Id)' is not accepted by healthchecks.io."
}

Write-Host ''
Write-Host 'Configure the three external checks with EXACTLY these schedules (timezone below, not UTC):'
Write-Host "  timezone for all three:  $localZone"
Write-Host "  liveness   cron: $cycleCron      grace 30 min   (every cycle firing, session or not)"
Write-Host "  readiness  cron: $cycleCron      grace 50 min   (every cycle firing reports; DEAD_MAN_BOUND_MS)"
Write-Host "  watchdog   cron: $watchdogCron   grace 15 min   (every watchdog firing)"
Write-Host ''
Write-Host 'Detection time = the check period until the next expected ping, plus its grace.'
Write-Host "Alert delivery budget is separate: $([math]::Round([int64]$policy.ALERT_DELIVERY_BUDGET_MS / 60000.0)) min (ALERT_DELIVERY_BUDGET_MS)."
Write-Host 'Weekends and nights are outside every expression above, so silence there is expected and never alerts.'
Write-Host 'Holidays and early closes still ping: the wrappers fire and report on them.'
Write-Host "Reminder: watchdog-cli.ts fences, halts, flattens the open book and pings; it degrades to fence+halt+ping (and logs why) when the configuration, credentials or account binding do not compose -- see tools\watchdog-run.ps1 header."
Write-Host ''

if ($WhatIfPreference) {
    Write-Host "Preview only (-WhatIf): the principal for '$UserId' (LogonType $LogonType) is NOT constructed, because that needs an elevated shell. Registration itself must be run from an elevated PowerShell."
    $principal = $null
} else {
    $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType $LogonType -RunLevel Limited
}
$commonSettings = @{
    StartWhenAvailable        = $true
    DontStopOnIdleEnd         = $true
    AllowStartIfOnBatteries   = $true
    DontStopIfGoingOnBatteries = $true
    MultipleInstances          = 'IgnoreNew'
}

# ---------------------------------------------------------------------------
# GlassBoxTrading-AgentCycle
# ---------------------------------------------------------------------------
Remove-ExistingTask -Name $CycleTaskName

# Through the wrapper, not straight to node: the wrapper keeps the printed
# cycle report in STATE_DIR\cycle-run.log (scenario #75).
$cycleArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$cycleRunner`" -RepoRoot `"$RepoRoot`" -NodePath `"$NodePath`""
$cycleAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $cycleArgs -WorkingDirectory $RepoRoot
$cycleOnceTrigger = New-ScheduledTaskTrigger -Once -At $session.OpenLocal -RepetitionInterval (New-TimeSpan -Minutes $cycleIntervalMinutes) -RepetitionDuration $sessionDuration
$cycleTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $session.OpenLocal
$cycleTrigger.Repetition = $cycleOnceTrigger.Repetition
$cycleSettings = New-ScheduledTaskSettingsSet @commonSettings -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if ($PSCmdlet.ShouldProcess("$TaskFolder$CycleTaskName", "Register scheduled task: cycle-run.ps1 (node dist\shell\agent-cli.js, printed report kept) every $cycleIntervalMinutes min, Mon-Fri $($session.OpenLocal.ToString('HH:mm')) - $($session.CloseLocal.ToString('HH:mm')) local")) {
    Register-ScheduledTask -TaskName $CycleTaskName -TaskPath $TaskFolder -Action $cycleAction -Trigger $cycleTrigger -Principal $principal -Settings $cycleSettings -Description 'Glass Box Trading: one agent-cli.js cycle through tools/cycle-run.ps1, which keeps the printed report in STATE_DIR/cycle-run.log. Reads .env in RepoRoot; no secrets on the command line. Installed by tools/install-scheduled-task.ps1.' | Out-Null
    if (-not $Activate) { Disable-ScheduledTask -TaskName $CycleTaskName -TaskPath $TaskFolder | Out-Null }
}

# ---------------------------------------------------------------------------
# GlassBoxTrading-Watchdog
# ---------------------------------------------------------------------------
Remove-ExistingTask -Name $WatchdogTaskName

$watchdogArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$watchdogRunner`" -RepoRoot `"$RepoRoot`" -NodePath `"$NodePath`" -WatchdogIntervalMinutes $WatchdogIntervalMinutes"
$watchdogAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $watchdogArgs -WorkingDirectory $RepoRoot
$watchdogOnceTrigger = New-ScheduledTaskTrigger -Once -At $session.OpenLocal -RepetitionInterval (New-TimeSpan -Minutes $WatchdogIntervalMinutes) -RepetitionDuration $sessionDuration
$watchdogTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday -At $session.OpenLocal
$watchdogTrigger.Repetition = $watchdogOnceTrigger.Repetition
# Six minutes: the recovery run is bounded by CYCLE_WALLTIME_BUDGET_MS (5 min) plus composition; the kernel mutex serializes any overlap.
$watchdogSettings = New-ScheduledTaskSettingsSet @commonSettings -ExecutionTimeLimit (New-TimeSpan -Minutes 6)

if ($PSCmdlet.ShouldProcess("$TaskFolder$WatchdogTaskName", "Register scheduled task: watchdog-run.ps1 every $WatchdogIntervalMinutes min (< dead-man bound), Mon-Fri $($session.OpenLocal.ToString('HH:mm')) - $($session.CloseLocal.ToString('HH:mm')) local")) {
    Register-ScheduledTask -TaskName $WatchdogTaskName -TaskPath $TaskFolder -Action $watchdogAction -Trigger $watchdogTrigger -Principal $principal -Settings $watchdogSettings -Description 'Glass Box Trading: dead-man watchdog (S-G14). Fences, halts and flattens the open book on staleness; degrades to fence-and-halt-only when the configuration does not compose -- see tools/watchdog-run.ps1. Installed by tools/install-scheduled-task.ps1.' | Out-Null
    if (-not $Activate) { Disable-ScheduledTask -TaskName $WatchdogTaskName -TaskPath $TaskFolder | Out-Null }
}

Write-Host ''
Write-Host "Registration $(if ($WhatIfPreference) { '(preview only, -WhatIf) ' })complete for user '$UserId', LogonType '$LogonType', folder '$TaskFolder'."
Write-Host "Tasks were registered $(if ($Activate) { 'ENABLED (-Activate was passed)' } else { 'and immediately DISABLED. Installing is not activating: enable them only after the activation gate in docs/P12-RUNBOOK.md.' })"
Write-Host 'Verify what was registered with tools\verify-scheduled-tasks.ps1 before relying on any of it.'
