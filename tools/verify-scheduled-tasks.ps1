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
# R47-B5: this rounded exactly where the installer now refuses, so a policy of
# 870001 ms became "15 minutes" here and a PT15M task passed the exact-cadence
# check the installer would never have produced. Two tools disagreeing about
# what the policy says is worse than either being wrong alone.
$cycleIntervalMs = [int64]$policy.CYCLE_INTERVAL_MS
if ($cycleIntervalMs % 60000 -ne 0) {
    throw "config/policy.json CYCLE_INTERVAL_MS = $cycleIntervalMs ms is not a whole number of minutes, so no scheduled repetition can implement it exactly and nothing can be verified against it. Fix the policy and re-install."
}
$cycleIntervalMinutes = [int]($cycleIntervalMs / 60000)
$deadManMinutes = [math]::Round([int64]$policy.DEAD_MAN_BOUND_MS / 60000.0)

# R43-B7: the first version compared substrings, so a definition could carry
# the expected script name inside an unrelated argument, run cmd.exe, start at
# 01:00, fire only at weekends, or set the watchdog interval exactly at the
# dead-man bound -- and still pass all 26 checks. Each expectation below is now
# exact: the executable, the -File argument parsed out of the argument string,
# the trigger's local start hour, the weekday set, and a strict inequality on
# the watchdog cadence.
$expected = @(
    [pscustomobject]@{ Name = 'GlassBoxTrading-AgentCycle'; Script = 'tools\cycle-run.ps1'; MaxIntervalMinutes = $cycleIntervalMinutes; StrictlyBelow = $false; ExactIntervalMinutes = $cycleIntervalMinutes; MinExecutionTimeLimitMinutes = 10 },
    [pscustomobject]@{ Name = 'GlassBoxTrading-Watchdog'; Script = 'tools\watchdog-run.ps1'; MaxIntervalMinutes = $deadManMinutes; StrictlyBelow = $true; ExactIntervalMinutes = $null; MinExecutionTimeLimitMinutes = 6 }
)

# R44-B10: the checks below used to read Actions[0] and Triggers[0] and ignore
# everything after them, so a definition with a second cmd.exe action or a
# second weekend trigger passed all 30. A task runs EVERY action and honours
# EVERY trigger, so anything beyond the first is unverified execution.

function Get-QuotedArgument {
    # The value of a named parameter, honouring quotes. Used for -File and, since
    # R47-B4, for the wrapper's own -RepoRoot and -NodePath: the right script
    # pointed at someone else's checkout is not this deployment.
    param([string]$Arguments, [string]$Name)
    if ($Arguments -match ("-" + [regex]::Escape($Name) + '\s+"([^"]+)"')) { return $Matches[1] }
    if ($Arguments -match ("-" + [regex]::Escape($Name) + '\s+(\S+)')) { return $Matches[1] }
    return $null
}

function Get-FileArgument {
    param([string]$Arguments)
    return Get-QuotedArgument -Arguments $Arguments -Name 'File'
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
        # R47-B6: "not Disabled" accepted `Unknown`, which is what a task in an
        # unreadable or partially registered state reports. The gate asks
        # whether this will fire, and only Ready and Running answer yes.
        Add-Check -Name "$($spec.Name) is enabled" -Ok ($task.State -eq 'Ready' -or $task.State -eq 'Running') -Detail "state $($task.State) (expected Ready or Running)"
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

    # R46-B1: PowerShell honours -Command and treats a following -File as one of
    # ITS arguments, so an action reading
    #   -Command "Write-Output x" -File "<the expected wrapper>"
    # ran something else entirely and passed every check. -File must be the
    # thing that executes, which means no competing entry point may appear.
    # R47-B9: powershell.exe resolves PARAMETER PREFIXES, so `-Co`, `-Com` and
    # `-Comma` are all `-Command` and the exact-spelling list R46 added missed
    # every one of them: a task reading `-Co "..." -File "<the wrapper>"` was
    # certified while PowerShell ran the command and passed `-File` to it as an
    # argument. The rule is therefore about prefixes, not spellings. `-e` is a
    # prefix of both EncodedCommand and ExecutionPolicy, and powershell.exe
    # resolves it to EncodedCommand, so it is rejected; `-ex` and longer are
    # unambiguous ExecutionPolicy and stay allowed.
    $commandLike = @()
    foreach ($token in [regex]::Matches($argument, '(?<=^|\s)-([A-Za-z]+)')) {
        $name = $token.Groups[1].Value.ToLowerInvariant()
        $isCommand = 'command'.StartsWith($name)
        $isEncoded = 'encodedcommand'.StartsWith($name) -and -not ('executionpolicy'.StartsWith($name) -and $name.Length -ge 2)
        if ($isCommand -or $isEncoded) { $commandLike += "-$($token.Groups[1].Value)" }
    }
    Add-Check -Name "$($spec.Name) uses -File and nothing else runs" -Ok ($commandLike.Count -eq 0) -Detail "$(if ($commandLike.Count -eq 0) { 'no -Command/-EncodedCommand prefix present' } else { "command-like parameter(s): $($commandLike -join ', ')" }); arguments: $argument"

    $fileArgument = Get-FileArgument -Arguments $argument
    $expectedFile = Join-Path $RepoRoot $spec.Script
    $resolvedFile = if ([string]::IsNullOrWhiteSpace($fileArgument)) { $null } else { [System.IO.Path]::GetFullPath($fileArgument) }
    $invokesScript = $null -ne $resolvedFile -and $resolvedFile -ieq [System.IO.Path]::GetFullPath($expectedFile)
    Add-Check -Name "$($spec.Name) -File is exactly $($spec.Script)" -Ok $invokesScript -Detail "-File resolves to $(if ($null -eq $resolvedFile) { '(absent)' } else { $resolvedFile }); expected $([System.IO.Path]::GetFullPath($expectedFile))"

    $scriptPath = Join-Path $RepoRoot $spec.Script
    Add-Check -Name "$($spec.Name) target script exists" -Ok (Test-Path -LiteralPath $scriptPath) -Detail $scriptPath

    # R47-B4: the right script invoked with someone else's -RepoRoot or
    # -NodePath is not this deployment. Both wrappers accept those parameters,
    # and the installer passes them, so they are checked rather than forbidden.
    $passedRepoRoot = Get-QuotedArgument -Arguments $argument -Name 'RepoRoot'
    $repoRootOk = [string]::IsNullOrWhiteSpace($passedRepoRoot) -or
        ((Test-Path -LiteralPath $passedRepoRoot) -and ([System.IO.Path]::GetFullPath($passedRepoRoot).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')))
    Add-Check -Name "$($spec.Name) -RepoRoot is this checkout" -Ok $repoRootOk -Detail "$(if ([string]::IsNullOrWhiteSpace($passedRepoRoot)) { '(not passed; the wrapper defaults to its own parent)' } else { $passedRepoRoot })"

    $passedNodePath = Get-QuotedArgument -Arguments $argument -Name 'NodePath'
    $nodePathOk = [string]::IsNullOrWhiteSpace($passedNodePath) -or (Test-Path -LiteralPath $passedNodePath)
    Add-Check -Name "$($spec.Name) -NodePath exists" -Ok $nodePathOk -Detail "$(if ([string]::IsNullOrWhiteSpace($passedNodePath)) { '(not passed; the wrapper resolves node from PATH)' } else { $passedNodePath })"

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
        Add-Check -Name "$($spec.Name) repetition is inside its bound" -Ok $fastEnough -Detail "every $($interval.ToString()) (= $($interval.TotalMinutes) min; bound $($spec.MaxIntervalMinutes) min, $(if ($spec.StrictlyBelow) { 'strictly below' } else { 'at most' }))"
        # R44-B10: the cycle cadence is not merely bounded, it is fixed for the
        # measurement period -- a slower cycle is a different deployment, and
        # the external readiness cron is derived from this exact number.
        if ($null -ne $spec.ExactIntervalMinutes) {
            # R45: "exactly" must not be rounded into existence. A registered
            # repetition of PT14M31S rounds to 15 and passed this check while
            # every firing drifted away from the cron the external readiness
            # check expects. The comparison is on total minutes with no
            # rounding at all, and the detail prints the real value.
            $exact = $interval.TotalMinutes -eq [double]$spec.ExactIntervalMinutes
            Add-Check -Name "$($spec.Name) cadence is exactly the policy interval" -Ok $exact -Detail "every $($interval.ToString()) (= $($interval.TotalMinutes) min; policy CYCLE_INTERVAL_MS = $($spec.ExactIntervalMinutes) min)"
        }
        if ($null -ne $duration) {
            Add-Check -Name "$($spec.Name) repetition window spans a session" -Ok ($duration.TotalMinutes -ge 390) -Detail "$([math]::Round($duration.TotalMinutes)) min (a regular session is 390 min)"
        } else {
            Add-Check -Name "$($spec.Name) repetition window spans a session" -Ok $false -Detail 'no repetition duration'
        }
    }

    # R46-B2: a MonthlyDOW trigger carries DaysOfWeek and a repetition just like
    # a weekly one, and fires in one week of the month. The weekday set and the
    # cadence therefore say nothing on their own -- the trigger's own type has
    # to be asserted.
    $triggerClass = "$($trigger.CimClass.CimClassName)"
    Add-Check -Name "$($spec.Name) trigger is weekly, not monthly or one-off" -Ok ($triggerClass -eq 'MSFT_TaskWeeklyTrigger') -Detail "CIM class $triggerClass (expected MSFT_TaskWeeklyTrigger)"
    $weeksInterval = $trigger.WeeksInterval
    Add-Check -Name "$($spec.Name) repeats every week" -Ok ($null -ne $weeksInterval -and [int]$weeksInterval -eq 1) -Detail "WeeksInterval=$(if ($null -eq $weeksInterval) { '(absent)' } else { $weeksInterval })"

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

    # R47-B1: the two checks above compare only the TIME OF DAY, so a trigger
    # whose StartBoundary is 2099-01-01 14:00 passed both -- correct hours, and
    # the first firing seventy-three years away. The date has to be checked as
    # well: a trigger that starts in the future is a task that will not run,
    # and a task that will not run passes every other check in this file.
    $startsSoon = $start.Date -le [datetime]::Today.AddDays(7) -and $start.Date -ge [datetime]::Today.AddDays(-3650)
    Add-Check -Name "$($spec.Name) start boundary is not in the future" -Ok $startsSoon -Detail "StartBoundary $($start.ToString('yyyy-MM-dd HH:mm')) local (must be on or before $([datetime]::Today.AddDays(7).ToString('yyyy-MM-dd')))"

    # --- it can run unattended ----------------------------------------------
    $logonType = "$($task.Principal.LogonType)"
    $unattended = $logonType -eq 'S4U' -or $logonType -eq 'Password'
    Add-Check -Name "$($spec.Name) can run without an interactive session" -Ok $unattended -Detail "LogonType=$logonType (Interactive only runs while that user is signed in)"

    $settings = $task.Settings
    Add-Check -Name "$($spec.Name) starts when a missed run is possible" -Ok ($settings.StartWhenAvailable -eq $true) -Detail "StartWhenAvailable=$($settings.StartWhenAvailable) -- this is what recovers the schedule after a reboot or sleep"
    Add-Check -Name "$($spec.Name) runs on battery" -Ok ($settings.DisallowStartIfOnBatteries -eq $false) -Detail "DisallowStartIfOnBatteries=$($settings.DisallowStartIfOnBatteries)"
    Add-Check -Name "$($spec.Name) does not stop on battery" -Ok ($settings.StopIfGoingOnBatteries -eq $false) -Detail "StopIfGoingOnBatteries=$($settings.StopIfGoingOnBatteries)"
    Add-Check -Name "$($spec.Name) does not stack instances" -Ok ($settings.MultipleInstances -eq 'IgnoreNew') -Detail "MultipleInstances=$($settings.MultipleInstances)"

    # R46-B3: the scheduler kills a run at ExecutionTimeLimit. A limit shorter
    # than the work's own budget silently truncates recovery -- the cycle's
    # wall-clock budget is 5 min plus composition, the watchdog's recovery the
    # same -- and a killed wrapper posts nothing at all, so it reads as silence
    # rather than as a failure. PT1M passed every check before this.
    $limitRaw = "$($settings.ExecutionTimeLimit)"
    $limitMinutes = $null
    if (-not [string]::IsNullOrWhiteSpace($limitRaw)) {
        try { $limitMinutes = ([System.Xml.XmlConvert]::ToTimeSpan($limitRaw)).TotalMinutes } catch { $limitMinutes = $null }
    }
    $limitOk = $null -ne $limitMinutes -and $limitMinutes -ge $spec.MinExecutionTimeLimitMinutes
    Add-Check -Name "$($spec.Name) may run long enough to finish" -Ok $limitOk -Detail "ExecutionTimeLimit=$(if ([string]::IsNullOrWhiteSpace($limitRaw)) { '(absent)' } else { $limitRaw }) (need at least $($spec.MinExecutionTimeLimitMinutes) min)"

    $info = Get-ScheduledTaskInfo -TaskName $spec.Name -TaskPath $TaskFolder -ErrorAction SilentlyContinue
    if ($null -ne $info) {
        Write-Host "[INFO] $($spec.Name) last ran $($info.LastRunTime) with result $($info.LastTaskResult); next $($info.NextRunTime)"
        # R47-B1, the other half: the scheduler's own answer to "when next".
        # Only asserted when the task is supposed to be enabled -- a disabled
        # task legitimately reports none.
        if ($ExpectEnabled -and $null -ne $info.NextRunTime) {
            $nextSoon = [datetime]$info.NextRunTime -le [datetime]::Now.AddDays(4)
            Add-Check -Name "$($spec.Name) next run is within four days" -Ok $nextSoon -Detail "next $($info.NextRunTime) (a weekday task should never be further away than a long weekend)"
        }
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
