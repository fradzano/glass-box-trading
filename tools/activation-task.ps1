<#
.SYNOPSIS
    Installs the activation scheduler, registers/removes its disarm one-shot, or
    changes the enabled state of one of the two trading tasks.

.DESCRIPTION
    This is the narrow elevated surface used by ops/activation. It accepts only
    fixed operations and fixed GlassBoxTrading task names; no command text is
    evaluated. Installing the activation task is safe by default: without
    -Activate it is registered Disabled. The cycle and watchdog are never
    enabled by an install operation in this script.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('InstallActivation', 'RegisterDisarm', 'DeleteDisarm', 'SetTradingTaskEnabled')]
    [string]$Operation,
    [string]$RepoRoot,
    [string]$ActivationRoot,
    [string]$AnchorDay,
    [string]$CertificateDay,
    [string]$NodePath,
    [string]$UserId,
    [string]$UserSid,
    [ValidateSet('cycle', 'watchdog')]
    [string]$TradingTask,
    [ValidateSet('true', 'false')]
    [string]$Enabled,
    [string]$DisarmAt,
    [switch]$Activate,
    [string]$TaskPath = '\GlassBoxTrading\'
)

$ErrorActionPreference = 'Stop'
$ActivationTaskName = 'GlassBoxTrading-Activation'
$DisarmTaskName = 'GlassBoxTrading-Disarm'
$TradingTaskNames = @{ cycle = 'GlassBoxTrading-AgentCycle'; watchdog = 'GlassBoxTrading-Watchdog' }

function Require-Value {
    param([string]$Name, [string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is required for $Operation." }
}

function Resolve-ExactIdentity {
    Require-Value -Name 'UserId' -Value $UserId
    Require-Value -Name 'UserSid' -Value $UserSid
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ($identity.Name -ine $UserId -or $identity.User.Value -ne $UserSid) {
        throw 'The requested task principal is not the current Windows identity.'
    }
}

function Resolve-Inputs {
    Require-Value -Name 'RepoRoot' -Value $RepoRoot
    Require-Value -Name 'ActivationRoot' -Value $ActivationRoot
    Require-Value -Name 'NodePath' -Value $NodePath
    $script:RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
    $script:ActivationRoot = [System.IO.Path]::GetFullPath($ActivationRoot)
    $script:NodePath = (Resolve-Path -LiteralPath $NodePath).Path
    if ([System.IO.Path]::GetFileName($script:NodePath) -ine 'node.exe') { throw 'NodePath must name node.exe.' }
    $cli = Join-Path $script:RepoRoot 'ops\activation\cli.ts'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw 'The activation CLI is missing.' }
    Resolve-ExactIdentity
}

function New-ActivationAction {
    param([ValidateSet('run', 'disarm')][string]$Command)
    $arguments = @(
        ('"{0}"' -f (Join-Path $script:RepoRoot 'ops\activation\cli.ts')),
        $Command,
        '--state-root', ('"{0}"' -f $script:ActivationRoot),
        '--anchor-day', $AnchorDay
    ) -join ' '
    return New-ScheduledTaskAction -Execute $script:NodePath -Argument $arguments -WorkingDirectory $script:RepoRoot
}

function Assert-CommonDefinition {
    param([object]$Task, [string]$ExpectedArguments)
    if ([string]$Task.Principal.RunLevel -ne 'Highest') { throw 'Registered task RunLevel is not Highest.' }
    if ([string]$Task.Principal.LogonType -ne 'S4U') { throw 'Registered task LogonType is not S4U.' }
    $registeredSid = try { (New-Object Security.Principal.NTAccount([string]$Task.Principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { throw 'Registered task principal cannot be resolved to a Windows SID.' }
    if ($registeredSid -ne $UserSid) { throw 'Registered task principal SID differs from the requested identity.' }
    if (-not [bool]$Task.Settings.StartWhenAvailable) { throw 'Registered task does not StartWhenAvailable.' }
    if ([string]$Task.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'Registered task does not IgnoreNew.' }
    if ([string]$Task.Settings.ExecutionTimeLimit -ne 'PT10M') { throw 'Registered task ExecutionTimeLimit is not ten minutes.' }
    if ([bool]$Task.Settings.DisallowStartIfOnBatteries) { throw 'Registered task is forbidden to start on battery power.' }
    if ([bool]$Task.Settings.StopIfGoingOnBatteries) { throw 'Registered task stops when the host switches to battery power.' }
    $actions = @($Task.Actions)
    if ($actions.Count -ne 1) { throw "Registered task has $($actions.Count) actions, expected one." }
    if ([string]$actions[0].Execute -ine $script:NodePath -or [string]$actions[0].WorkingDirectory -ine $script:RepoRoot -or [string]$actions[0].Arguments -cne $ExpectedArguments) {
        throw 'Registered task action differs from the exact activation command.'
    }
}

if ($Operation -eq 'SetTradingTaskEnabled') {
    Require-Value -Name 'TradingTask' -Value $TradingTask
    Require-Value -Name 'Enabled' -Value $Enabled
    $name = $TradingTaskNames[$TradingTask]
    if ($Enabled -eq 'true') {
        if ($PSCmdlet.ShouldProcess("$TaskPath$name", 'Enable scheduled task')) { Enable-ScheduledTask -TaskName $name -TaskPath $TaskPath | Out-Null }
    } else {
        if ($PSCmdlet.ShouldProcess("$TaskPath$name", 'Disable scheduled task')) { Disable-ScheduledTask -TaskName $name -TaskPath $TaskPath | Out-Null }
    }
    return
}

if ($Operation -eq 'DeleteDisarm') {
    $existing = Get-ScheduledTask -TaskName $DisarmTaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($null -ne $existing -and $PSCmdlet.ShouldProcess("$TaskPath$DisarmTaskName", 'Remove disarm one-shot')) {
        Unregister-ScheduledTask -TaskName $DisarmTaskName -TaskPath $TaskPath -Confirm:$false
    }
    return
}

Resolve-Inputs
Require-Value -Name 'AnchorDay' -Value $AnchorDay
if ($AnchorDay -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'AnchorDay must be YYYY-MM-DD.' }
$principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

if ($Operation -eq 'RegisterDisarm') {
    Require-Value -Name 'DisarmAt' -Value $DisarmAt
    $fires = [datetime]::ParseExact($DisarmAt, 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
    if ($fires.ToString('yyyy-MM-dd') -ne $AnchorDay) { throw 'DisarmAt must fall on AnchorDay.' }
    $trigger = New-ScheduledTaskTrigger -Once -At $fires
    $action = New-ActivationAction -Command disarm
    if ($PSCmdlet.ShouldProcess("$TaskPath$DisarmTaskName", 'Register enabled disarm one-shot')) {
        try {
            Register-ScheduledTask -TaskName $DisarmTaskName -TaskPath $TaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Glass Box Trading activation fail-safe one-shot.' -Force | Out-Null
            $registered = Get-ScheduledTask -TaskName $DisarmTaskName -TaskPath $TaskPath -ErrorAction Stop
            Assert-CommonDefinition -Task $registered -ExpectedArguments $action.Arguments
            $registeredTriggers = @($registered.Triggers)
            if ($registeredTriggers.Count -ne 1 -or ([datetime]$registeredTriggers[0].StartBoundary) -ne $fires) { throw 'Registered disarm trigger differs from the requested instant.' }
            if ([string]$registered.State -eq 'Disabled') { throw 'Registered disarm one-shot is disabled.' }
        } catch {
            Unregister-ScheduledTask -TaskName $DisarmTaskName -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue
            throw
        }
    }
    return
}

Require-Value -Name 'CertificateDay' -Value $CertificateDay
if ($CertificateDay -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'CertificateDay must be YYYY-MM-DD.' }
$certificateStart = [datetime]::ParseExact("${CertificateDay}T15:30:00", 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
$anchorStart = [datetime]::ParseExact("${AnchorDay}T13:25:00", 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
if ($certificateStart.Date -ne $anchorStart.Date.AddDays(-1)) { throw 'CertificateDay must be the calendar day before AnchorDay.' }
$certificateTrigger = New-ScheduledTaskTrigger -Once -At $certificateStart -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 9 -Minutes 15)
$anchorTrigger = New-ScheduledTaskTrigger -Once -At $anchorStart -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 2 -Minutes 40)
$activationAction = New-ActivationAction -Command run
if ($PSCmdlet.ShouldProcess("$TaskPath$ActivationTaskName", "Register activation task for $CertificateDay and $AnchorDay")) {
    try {
        $disabledSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Disable
        Register-ScheduledTask -TaskName $ActivationTaskName -TaskPath $TaskPath -Action $activationAction -Trigger @($certificateTrigger, $anchorTrigger) -Principal $principal -Settings $disabledSettings -Description 'Glass Box Trading guarded activation orchestrator.' -Force | Out-Null
        $registered = Get-ScheduledTask -TaskName $ActivationTaskName -TaskPath $TaskPath -ErrorAction Stop
        Assert-CommonDefinition -Task $registered -ExpectedArguments $activationAction.Arguments
        if ([string]$registered.State -ne 'Disabled') { throw 'Registered activation task was not disabled before verification.' }
        $registeredTriggers = @($registered.Triggers)
        if ($registeredTriggers.Count -ne 2) { throw "Registered activation task has $($registeredTriggers.Count) triggers, expected two." }
        $expectedStarts = @($certificateStart, $anchorStart)
        $expectedDurations = @('PT9H15M', 'PT2H40M')
        for ($index = 0; $index -lt 2; $index++) {
            if (([datetime]$registeredTriggers[$index].StartBoundary) -ne $expectedStarts[$index]) { throw "Activation trigger $index has the wrong start." }
            if ([string]$registeredTriggers[$index].Repetition.Interval -ne 'PT5M') { throw "Activation trigger $index does not repeat every five minutes." }
            if ([string]$registeredTriggers[$index].Repetition.Duration -ne $expectedDurations[$index]) { throw "Activation trigger $index has the wrong duration." }
        }
        if ($Activate) { Enable-ScheduledTask -TaskName $ActivationTaskName -TaskPath $TaskPath | Out-Null }
    } catch {
        Disable-ScheduledTask -TaskName $ActivationTaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue | Out-Null
        Unregister-ScheduledTask -TaskName $ActivationTaskName -TaskPath $TaskPath -Confirm:$false -ErrorAction SilentlyContinue
        throw
    }
}
