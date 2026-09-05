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

$expected = @(
    [pscustomobject]@{ Name = 'GlassBoxTrading-AgentCycle'; Script = 'tools\cycle-run.ps1'; IntervalMinutes = $cycleIntervalMinutes; MaxIntervalMinutes = $cycleIntervalMinutes },
    [pscustomobject]@{ Name = 'GlassBoxTrading-Watchdog'; Script = 'tools\watchdog-run.ps1'; IntervalMinutes = $null; MaxIntervalMinutes = $deadManMinutes }
)

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
    $action = @($task.Actions)[0]
    $argument = "$($action.Arguments)"
    $invokesScript = $argument -like "*$($spec.Script)*"
    Add-Check -Name "$($spec.Name) invokes $($spec.Script)" -Ok $invokesScript -Detail "$($action.Execute) $argument"

    $scriptPath = Join-Path $RepoRoot $spec.Script
    Add-Check -Name "$($spec.Name) target script exists" -Ok (Test-Path -LiteralPath $scriptPath) -Detail $scriptPath

    $workingDirectoryOk = "$($action.WorkingDirectory)".TrimEnd('\') -eq $RepoRoot.TrimEnd('\')
    Add-Check -Name "$($spec.Name) working directory is the checkout" -Ok $workingDirectoryOk -Detail "$($action.WorkingDirectory)"

    # --- it repeats, and not slower than the policy allows -------------------
    $trigger = @($task.Triggers)[0]
    $repetition = $trigger.Repetition
    if ($null -eq $repetition -or [string]::IsNullOrWhiteSpace($repetition.Interval)) {
        Add-Check -Name "$($spec.Name) repeats within its window" -Ok $false -Detail 'the trigger carries no repetition interval; it would fire once a day'
    } else {
        $interval = [System.Xml.XmlConvert]::ToTimeSpan($repetition.Interval)
        $duration = if ([string]::IsNullOrWhiteSpace($repetition.Duration)) { $null } else { [System.Xml.XmlConvert]::ToTimeSpan($repetition.Duration) }
        $fastEnough = $interval.TotalMinutes -le $spec.MaxIntervalMinutes
        Add-Check -Name "$($spec.Name) repetition is inside its bound" -Ok $fastEnough -Detail "every $([math]::Round($interval.TotalMinutes)) min (bound $($spec.MaxIntervalMinutes) min)"
        if ($null -ne $duration) {
            Add-Check -Name "$($spec.Name) repetition window spans a session" -Ok ($duration.TotalMinutes -ge 390) -Detail "$([math]::Round($duration.TotalMinutes)) min (a regular session is 390 min)"
        } else {
            Add-Check -Name "$($spec.Name) repetition window spans a session" -Ok $false -Detail 'no repetition duration'
        }
    }

    $daysOfWeek = "$($trigger.DaysOfWeek)"
    Add-Check -Name "$($spec.Name) fires on weekdays" -Ok ($null -ne $trigger.DaysOfWeek) -Detail "DaysOfWeek=$daysOfWeek"

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
