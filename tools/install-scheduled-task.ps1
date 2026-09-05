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

.PARAMETER TaskFolder
    Task Scheduler folder the two tasks live in. Default '\GlassBoxTrading\'.

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
    [string]$TaskFolder = '\GlassBoxTrading\',
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

function Get-TodaySessionLocal {
    # Regular-hours 09:30-16:00 America/New_York for "today" (New York
    # wall-clock date), converted to this machine's local time, DST-correct
    # via .NET's zone tables. Declared limitation: this does NOT know about
    # NYSE holidays or early-close days (e.g. the hackathon's partial
    # Fridays) -- a weekly Mon-Fri trigger fires on those days too. Operating
    # policy already treats "not actually a trading day" as a normal, safe,
    # empty cycle (see S-CYC-08/S-CYC-03 in docs/SPEC.md), so a spurious
    # firing on a holiday is inert, not unsafe; it is called out here because
    # it means "task fired" is not the same claim as "market was open."
    $eastern = Get-EasternTimeZoneInfo
    $nowUtc = [System.DateTime]::UtcNow
    $todayEasternDate = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $eastern).Date
    $openEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(9).AddMinutes(30), [System.DateTimeKind]::Unspecified)
    $closeEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(16), [System.DateTimeKind]::Unspecified)
    $openUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($openEastern, $eastern)
    $closeUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($closeEastern, $eastern)
    return [pscustomobject]@{
        OpenLocal  = $openUtc.ToLocalTime()
        CloseLocal = $closeUtc.ToLocalTime()
    }
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

if (($WatchdogIntervalMinutes * 60000) -ge $deadManBoundMs) {
    throw "WatchdogIntervalMinutes=$WatchdogIntervalMinutes min (= $($WatchdogIntervalMinutes * 60000) ms) is not below config/policy.json DEAD_MAN_BOUND_MS=$deadManBoundMs ms ($([math]::Round($deadManBoundMs / 60000.0)) min). Pick a smaller -WatchdogIntervalMinutes."
}

$session = Get-TodaySessionLocal
$sessionDuration = New-TimeSpan -Start $session.OpenLocal -End $session.CloseLocal
if ($sessionDuration.TotalMinutes -le 0) {
    throw "Computed session window is empty or inverted (open=$($session.OpenLocal), close=$($session.CloseLocal)); refusing to register a trigger with no repetition span."
}

Write-Host "Policy: CYCLE_INTERVAL_MS=$cycleIntervalMs ($cycleIntervalMinutes min), DEAD_MAN_BOUND_MS=$deadManBoundMs ($([math]::Round($deadManBoundMs / 60000.0)) min)"
Write-Host "Session window (local time, computed from America/New_York 09:30-16:00 for today's NY date): $($session.OpenLocal) .. $($session.CloseLocal) ($([math]::Round($sessionDuration.TotalMinutes)) min)"

# ---------------------------------------------------------------------------
# Principal and settings shared by both tasks
# ---------------------------------------------------------------------------
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType $LogonType -RunLevel Limited
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
}

Write-Host ''
Write-Host "Registration $(if ($WhatIfPreference) { '(preview only, -WhatIf) ' })complete for user '$UserId', LogonType '$LogonType', folder '$TaskFolder'."
Write-Host "Reminder: watchdog-cli.ts fences, halts, flattens the open book and pings; it degrades to fence+halt+ping (and logs why) when the configuration, credentials or account binding do not compose -- see tools\watchdog-run.ps1 header."
