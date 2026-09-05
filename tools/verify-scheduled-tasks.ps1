<#
.SYNOPSIS
    Checks what the registered scheduled tasks will actually do.

.DESCRIPTION
    "The task is Ready" says the Task Scheduler holds a definition. It says
    nothing about whether that definition invokes the right script, covers the
    session, repeats at the policy's cadence, or can run while nobody is logged
    on. This reads the registered definitions back and asserts each of those
    against config\policy.json and the files on disk.

    It is a read-only check: it registers nothing, enables nothing and starts
    nothing. Run it after installing, after any policy change, and before
    enabling the tasks for an unattended run.

    What it cannot prove, and says so rather than implying otherwise:
      * that the machine will wake or reboot cleanly -- only a reboot shows that
      * that S4U really runs without a logged-on session on THIS account --
        only an on-demand run with the session signed out shows that
      * that a firing produced a journal entry -- that is the supervised first
        cycle's job, and the liveness endpoint's afterwards

.PARAMETER RepoRoot
    Absolute path to the checkout. Defaults to the parent of this script's dir.

.PARAMETER TaskFolder
    Task Scheduler folder. Default '\GlassBoxTrading\'.

.PARAMETER ExpectEnabled
    Also require both tasks to be enabled. Off by default, because a prepared
    but not yet activated deployment is a legitimate state.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$TaskFolder = '\GlassBoxTrading\',
    [switch]$ExpectEnabled
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

$checks = New-Object System.Collections.Generic.List[object]
function Add-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $checks.Add([pscustomobject]@{ check = $Name; ok = $Ok; detail = $Detail })
    Write-Host "[$(if ($Ok) { 'PASS' } else { 'FAIL' })] $Name -- $Detail"
}

$policy = Get-Content -LiteralPath (Join-Path $RepoRoot 'config\policy.json') -Raw | ConvertFrom-Json
$cycleIntervalMinutes = [math]::Round([int64]$policy.CYCLE_INTERVAL_MS / 60000.0)
$deadManMinutes = [math]::Round([int64]$policy.DEAD_MAN_BOUND_MS / 60000.0)

# R43-B7: the first version compared substrings, so a definition could carry
# the expected script name inside an unrelated argument, run cmd.exe, start at
# 01:00, fire only at weekends, or set the watchdog interval exactly at the
# dead-man bound -- and still pass all 26 checks. Each expectation below is now
# exact: the executable, the -File argument parsed out of the argument string,
# the trigger's local start hour, the weekday set, and a strict inequality on
# the watchdog cadence.
$expected = @(
    [pscustomobject]@{ Name = 'GlassBoxTrading-AgentCycle'; Script = 'tools\cycle-run.ps1'; MaxIntervalMinutes = $cycleIntervalMinutes; StrictlyBelow = $false; ExactIntervalMinutes = $cycleIntervalMinutes },
    [pscustomobject]@{ Name = 'GlassBoxTrading-Watchdog'; Script = 'tools\watchdog-run.ps1'; MaxIntervalMinutes = $deadManMinutes; StrictlyBelow = $true; ExactIntervalMinutes = $null }
)

# R44-B10: the checks below used to read Actions[0] and Triggers[0] and ignore
# everything after them, so a definition with a second cmd.exe action or a
# second weekend trigger passed all 30. A task runs EVERY action and honours
# EVERY trigger, so anything beyond the first is unverified execution.

function Get-FileArgument {
    # The value of -File, honouring quotes. Anything else in the argument
    # string is irrelevant to what actually executes.
    param([string]$Arguments)
    if ($Arguments -match '-File\s+"([^"]+)"') { return $Matches[1] }
    if ($Arguments -match '-File\s+(\S+)') { return $Matches[1] }
    return $null
}

# The session in this machine's local time, so the trigger's start can be
# checked against something real rather than against "not null".
$eastern = try { [System.TimeZoneInfo]::FindSystemTimeZoneById('America/New_York') } catch { [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time') }
$todayEastern = [System.TimeZoneInfo]::ConvertTimeFromUtc([System.DateTime]::UtcNow, $eastern).Date
$sessionOpenLocal = [System.TimeZoneInfo]::ConvertTimeToUtc([System.DateTime]::SpecifyKind($todayEastern.AddHours(9).AddMinutes(30), [System.DateTimeKind]::Unspecified), $eastern).ToLocalTime()
$sessionCloseLocal = [System.TimeZoneInfo]::ConvertTimeToUtc([System.DateTime]::SpecifyKind($todayEastern.AddHours(16), [System.DateTimeKind]::Unspecified), $eastern).ToLocalTime()
$MONDAY_TO_FRIDAY = 62

foreach ($spec in $expected) {
    $task = Get-ScheduledTask -TaskName $spec.Name -TaskPath $TaskFolder -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Add-Check -Name "$($spec.Name) is registered" -Ok $false -Detail "not found under $TaskFolder"
        continue
    }
    Add-Check -Name "$($spec.Name) is registered" -Ok $true -Detail "state $($task.State)"

    if ($ExpectEnabled) {
        Add-Check -Name "$($spec.Name) is enabled" -Ok ($task.State -ne 'Disabled') -Detail "state $($task.State)"
    } else {
        Write-Host "[INFO] $($spec.Name) state is $($task.State); -ExpectEnabled was not passed, so this is not asserted"
    }

    # --- the action actually invokes the script we think it does -------------
    $actions = @($task.Actions)
    Add-Check -Name "$($spec.Name) carries exactly one action" -Ok ($actions.Count -eq 1) -Detail "$($actions.Count) action(s); every one of them runs"
    $action = $actions[0]
    $argument = "$($action.Arguments)"
    $executable = [System.IO.Path]::GetFileName("$($action.Execute)")
    Add-Check -Name "$($spec.Name) runs powershell.exe" -Ok ($executable -ieq 'powershell.exe') -Detail "Execute=$($action.Execute)"

    $fileArgument = Get-FileArgument -Arguments $argument
    $expectedFile = Join-Path $RepoRoot $spec.Script
    $resolvedFile = if ([string]::IsNullOrWhiteSpace($fileArgument)) { $null } else { [System.IO.Path]::GetFullPath($fileArgument) }
    $invokesScript = $null -ne $resolvedFile -and $resolvedFile -ieq [System.IO.Path]::GetFullPath($expectedFile)
    Add-Check -Name "$($spec.Name) -File is exactly $($spec.Script)" -Ok $invokesScript -Detail "-File resolves to $(if ($null -eq $resolvedFile) { '(absent)' } else { $resolvedFile }); expected $([System.IO.Path]::GetFullPath($expectedFile))"

    $scriptPath = Join-Path $RepoRoot $spec.Script
    Add-Check -Name "$($spec.Name) target script exists" -Ok (Test-Path -LiteralPath $scriptPath) -Detail $scriptPath

    $workingDirectoryOk = "$($action.WorkingDirectory)".TrimEnd('\') -eq $RepoRoot.TrimEnd('\')
    Add-Check -Name "$($spec.Name) working directory is the checkout" -Ok $workingDirectoryOk -Detail "$($action.WorkingDirectory)"

    # --- it repeats, and not slower than the policy allows -------------------
    $triggers = @($task.Triggers)
    Add-Check -Name "$($spec.Name) carries exactly one trigger" -Ok ($triggers.Count -eq 1) -Detail "$($triggers.Count) trigger(s); every one of them fires"
    $trigger = $triggers[0]
    $repetition = $trigger.Repetition
    if ($null -eq $repetition -or [string]::IsNullOrWhiteSpace($repetition.Interval)) {
        Add-Check -Name "$($spec.Name) repeats within its window" -Ok $false -Detail 'the trigger carries no repetition interval; it would fire once a day'
    } else {
        $interval = [System.Xml.XmlConvert]::ToTimeSpan($repetition.Interval)
        $duration = if ([string]::IsNullOrWhiteSpace($repetition.Duration)) { $null } else { [System.Xml.XmlConvert]::ToTimeSpan($repetition.Duration) }
        $fastEnough = if ($spec.StrictlyBelow) { $interval.TotalMinutes -lt $spec.MaxIntervalMinutes } else { $interval.TotalMinutes -le $spec.MaxIntervalMinutes }
        Add-Check -Name "$($spec.Name) repetition is inside its bound" -Ok $fastEnough -Detail "every $([math]::Round($interval.TotalMinutes)) min (bound $($spec.MaxIntervalMinutes) min, $(if ($spec.StrictlyBelow) { 'strictly below' } else { 'at most' }))"
        # R44-B10: the cycle cadence is not merely bounded, it is fixed for the
        # measurement period -- a slower cycle is a different deployment, and
        # the external readiness cron is derived from this exact number.
        if ($null -ne $spec.ExactIntervalMinutes) {
            Add-Check -Name "$($spec.Name) cadence is exactly the policy interval" -Ok ([math]::Round($interval.TotalMinutes) -eq $spec.ExactIntervalMinutes) -Detail "every $([math]::Round($interval.TotalMinutes)) min (policy CYCLE_INTERVAL_MS = $($spec.ExactIntervalMinutes) min)"
        }
        if ($null -ne $duration) {
            Add-Check -Name "$($spec.Name) repetition window spans a session" -Ok ($duration.TotalMinutes -ge 390) -Detail "$([math]::Round($duration.TotalMinutes)) min (a regular session is 390 min)"
        } else {
            Add-Check -Name "$($spec.Name) repetition window spans a session" -Ok $false -Detail 'no repetition duration'
        }
    }

    # Exactly Monday to Friday, not "some days" (62 = Mon|Tue|Wed|Thu|Fri).
    $daysOfWeek = "$($trigger.DaysOfWeek)"
    Add-Check -Name "$($spec.Name) fires exactly Monday to Friday" -Ok ([int]$trigger.DaysOfWeek -eq $MONDAY_TO_FRIDAY) -Detail "DaysOfWeek=$daysOfWeek (expected $MONDAY_TO_FRIDAY)"

    # The window must actually contain today's session in local time, with the
    # padding the installer promises. A trigger starting at 01:00 passed before.
    $start = [datetime]$trigger.StartBoundary
    $windowEnd = if ($null -eq $repetition -or [string]::IsNullOrWhiteSpace($repetition.Duration)) { $start } else { $start.Add([System.Xml.XmlConvert]::ToTimeSpan($repetition.Duration)) }
    $startsBeforeOpen = $start.TimeOfDay -le $sessionOpenLocal.TimeOfDay
    $endsAfterClose = $windowEnd.TimeOfDay -ge $sessionCloseLocal.TimeOfDay -or $windowEnd.Date -gt $start.Date
    Add-Check -Name "$($spec.Name) window opens no later than the session" -Ok $startsBeforeOpen -Detail "starts $($start.ToString('HH:mm')) local; session opens $($sessionOpenLocal.ToString('HH:mm'))"
    Add-Check -Name "$($spec.Name) window closes no earlier than the session" -Ok $endsAfterClose -Detail "ends $($windowEnd.ToString('HH:mm')) local; session closes $($sessionCloseLocal.ToString('HH:mm'))"

    # --- it can run unattended ----------------------------------------------
    $logonType = "$($task.Principal.LogonType)"
    $unattended = $logonType -eq 'S4U' -or $logonType -eq 'Password'
    Add-Check -Name "$($spec.Name) can run without an interactive session" -Ok $unattended -Detail "LogonType=$logonType (Interactive only runs while that user is signed in)"

    $settings = $task.Settings
    Add-Check -Name "$($spec.Name) starts when a missed run is possible" -Ok ($settings.StartWhenAvailable -eq $true) -Detail "StartWhenAvailable=$($settings.StartWhenAvailable) -- this is what recovers the schedule after a reboot or sleep"
    Add-Check -Name "$($spec.Name) runs on battery" -Ok ($settings.DisallowStartIfOnBatteries -eq $false) -Detail "DisallowStartIfOnBatteries=$($settings.DisallowStartIfOnBatteries)"
    Add-Check -Name "$($spec.Name) does not stop on battery" -Ok ($settings.StopIfGoingOnBatteries -eq $false) -Detail "StopIfGoingOnBatteries=$($settings.StopIfGoingOnBatteries)"
    Add-Check -Name "$($spec.Name) does not stack instances" -Ok ($settings.MultipleInstances -eq 'IgnoreNew') -Detail "MultipleInstances=$($settings.MultipleInstances)"

    $info = Get-ScheduledTaskInfo -TaskName $spec.Name -TaskPath $TaskFolder -ErrorAction SilentlyContinue
    if ($null -ne $info) {
        Write-Host "[INFO] $($spec.Name) last ran $($info.LastRunTime) with result $($info.LastTaskResult); next $($info.NextRunTime)"
    }
}

Write-Host ''
$failed = @($checks | Where-Object { -not $_.ok })
Write-Host 'Not asserted here, and each needs its own evidence:'
Write-Host '  * a clean reboot recovers the schedule (StartWhenAvailable is necessary, not sufficient)'
Write-Host '  * S4U really runs with the session signed out on this account'
Write-Host '  * a firing produced a journal entry -- the supervised first cycle shows that'
Write-Host ''
if ($failed.Count -gt 0) {
    Write-Host "SCHEDULER CHECK FAILED: $($failed.Count) of $($checks.Count) checks. Failed:"
    foreach ($failure in $failed) { Write-Host "  [FAIL] $($failure.check) -- $($failure.detail)" }
    exit 1
}
Write-Host "SCHEDULER CHECK PASSED: $($checks.Count) checks."
exit 0
