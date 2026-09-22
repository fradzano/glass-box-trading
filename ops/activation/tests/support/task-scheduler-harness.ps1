param(
    [Parameter(Mandatory = $true)][string]$ActivationScript,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [ValidateSet('InstallActivation', 'RegisterDisarm')][string]$Operation = 'InstallActivation',
    [switch]$Activate,
    [switch]$ResolvePrincipalToWrongSid
)

$ErrorActionPreference = 'Stop'
$global:HarnessEvents = [System.Collections.Generic.List[string]]::new()
$global:HarnessRegisteredTask = $null
$global:HarnessResolvedSid = if ($ResolvePrincipalToWrongSid) { 'S-1-5-18' } else { $null }

# Function shadowing is safe only while no unshadowed ScheduledTasks command can
# auto-load the module and replace every function below. Refuse before executing
# the subject unless its complete command vocabulary is the reviewed one.
$expectedCommands = @{
    'Disable-ScheduledTask' = 2
    'Enable-ScheduledTask' = 2
    'Get-ScheduledTask' = 3
    'New-ScheduledTaskAction' = 1
    'New-ScheduledTaskPrincipal' = 1
    'New-ScheduledTaskSettingsSet' = 2
    'New-ScheduledTaskTrigger' = 3
    'Register-ScheduledTask' = 2
    'Unregister-ScheduledTask' = 3
}
$subjectText = Get-Content -LiteralPath $ActivationScript -Raw
$commandPattern = '(?<![A-Za-z0-9_-])(?:[A-Za-z]+-ScheduledTask[A-Za-z]*)(?![A-Za-z0-9_-])'
$foundCommands = @([regex]::Matches($subjectText, $commandPattern) | ForEach-Object Value)
$foundGroups = @($foundCommands | Group-Object)
if ($foundCommands.Count -ne (($expectedCommands.Values | Measure-Object -Sum).Sum)) { throw 'HARNESS_UNREVIEWED_SCHEDULED_TASK_COMMAND' }
foreach ($group in $foundGroups) {
    if (-not $expectedCommands.ContainsKey($group.Name) -or $expectedCommands[$group.Name] -ne $group.Count) { throw 'HARNESS_UNREVIEWED_SCHEDULED_TASK_COMMAND' }
}
if (Get-Module -Name ScheduledTasks) { throw 'HARNESS_SCHEDULED_TASKS_MODULE_ALREADY_LOADED' }

function New-Object {
    param([Parameter(Position = 0)][string]$TypeName, [Parameter(Position = 1, ValueFromRemainingArguments = $true)][object[]]$ArgumentList)
    if ($ResolvePrincipalToWrongSid -and $TypeName -like 'Security.Principal.NTAccount*') {
        $account = [pscustomobject]@{}
        $account | Add-Member -MemberType ScriptMethod -Name Translate -Value { param($TargetType) [pscustomobject]@{ Value = $global:HarnessResolvedSid } }
        return $account
    }
    Microsoft.PowerShell.Utility\New-Object @PSBoundParameters
}

function New-ScheduledTaskAction {
    param([string]$Execute, [string]$Argument, [string]$WorkingDirectory)
    [pscustomobject]@{ Execute = $Execute; Arguments = $Argument; WorkingDirectory = $WorkingDirectory }
}

function New-ScheduledTaskPrincipal {
    param([string]$UserId, [string]$LogonType, [string]$RunLevel)
    [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel }
}

function New-ScheduledTaskSettingsSet {
    param(
        [switch]$StartWhenAvailable,
        [string]$MultipleInstances,
        [timespan]$ExecutionTimeLimit,
        [switch]$AllowStartIfOnBatteries,
        [switch]$DontStopIfGoingOnBatteries,
        [switch]$Disable
    )
    [pscustomobject]@{
        StartWhenAvailable = [bool]$StartWhenAvailable
        MultipleInstances = $MultipleInstances
        ExecutionTimeLimit = [System.Xml.XmlConvert]::ToString($ExecutionTimeLimit)
        DisallowStartIfOnBatteries = -not [bool]$AllowStartIfOnBatteries
        StopIfGoingOnBatteries = -not [bool]$DontStopIfGoingOnBatteries
        DisabledAtRegistration = [bool]$Disable
    }
}

function New-ScheduledTaskTrigger {
    param([switch]$Once, [datetime]$At, [timespan]$RepetitionInterval, [timespan]$RepetitionDuration)
    [pscustomobject]@{
        StartBoundary = $At
        Repetition = [pscustomobject]@{
            Interval = [System.Xml.XmlConvert]::ToString($RepetitionInterval)
            Duration = [System.Xml.XmlConvert]::ToString($RepetitionDuration)
        }
    }
}

function Register-ScheduledTask {
    param([string]$TaskName, [string]$TaskPath, [object]$Action, [object[]]$Trigger, [object]$Principal, [object]$Settings, [string]$Description, [switch]$Force)
    $global:HarnessEvents.Add("register:$([bool]$Settings.DisabledAtRegistration)")
    # Task Scheduler commonly returns the account without its machine/domain
    # qualifier. The production verifier must compare the resolved SID.
    $shortUser = ([string]$Principal.UserId -split '\\')[-1]
    $global:HarnessRegisteredTask = [pscustomobject]@{
        TaskName = $TaskName
        TaskPath = $TaskPath
        Actions = @($Action)
        Triggers = @($Trigger)
        Principal = [pscustomobject]@{ UserId = $shortUser; LogonType = $Principal.LogonType; RunLevel = $Principal.RunLevel }
        Settings = $Settings
        State = if ($Settings.DisabledAtRegistration) { 'Disabled' } else { 'Ready' }
    }
    $global:HarnessRegisteredTask
}

function Get-ScheduledTask {
    param([string]$TaskName, [string]$TaskPath, [string]$ErrorAction)
    $global:HarnessEvents.Add("get:$($global:HarnessRegisteredTask.State)")
    $global:HarnessRegisteredTask
}

function Enable-ScheduledTask {
    param([string]$TaskName, [string]$TaskPath)
    $global:HarnessEvents.Add("enable:$($global:HarnessRegisteredTask.State)")
    $global:HarnessRegisteredTask.State = 'Ready'
    $global:HarnessRegisteredTask
}

function Disable-ScheduledTask {
    param([string]$TaskName, [string]$TaskPath, [string]$ErrorAction)
    $global:HarnessEvents.Add('disable')
    if ($null -ne $global:HarnessRegisteredTask) { $global:HarnessRegisteredTask.State = 'Disabled' }
    $global:HarnessRegisteredTask
}

function Unregister-ScheduledTask {
    param([string]$TaskName, [string]$TaskPath, [switch]$Confirm, [string]$ErrorAction)
    $global:HarnessEvents.Add('unregister')
    $global:HarnessRegisteredTask = $null
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($Operation -eq 'RegisterDisarm') {
    & $ActivationScript -Operation RegisterDisarm -RepoRoot $RepoRoot -ActivationRoot (Join-Path $RepoRoot 'activation-test') -AnchorDay '2026-09-29' -DisarmAt '2026-09-29T15:05:00' -NodePath $NodePath -UserId $identity.Name -UserSid $identity.User.Value | Out-Null
} else {
    & $ActivationScript -Operation InstallActivation -RepoRoot $RepoRoot -ActivationRoot (Join-Path $RepoRoot 'activation-test') -AnchorDay '2026-09-29' -CertificateDay '2026-09-28' -NodePath $NodePath -UserId $identity.Name -UserSid $identity.User.Value -Activate:$Activate | Out-Null
}

if (Get-Module -Name ScheduledTasks) { throw 'HARNESS_SCHEDULED_TASKS_MODULE_AUTOLOADED' }

[pscustomobject]@{
    events = @($global:HarnessEvents)
    state = [string]$global:HarnessRegisteredTask.State
    returnedUserId = [string]$global:HarnessRegisteredTask.Principal.UserId
    requestedUserId = [string]$identity.Name
} | ConvertTo-Json -Compress
