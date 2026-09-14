<#
  The activation's task reader (build log, unit 7). Read-only: it registers, enables and
  starts nothing.

  Prints one JSON array, one object per task in the folder, in the shape
  ops/activation/readers/parse.ts reads: TaskName, State (the enum's name), every action
  (Execute, Arguments), every trigger (StartBoundary), and the principal and settings the
  disarm one-shot is judged by (RunLevel and LogonType by name, StartWhenAvailable as a
  boolean). An empty folder prints nothing. Any other failure exits 3 with one line on
  stderr, which the reader turns into an unknown reading.
#>
param(
    [string]$TaskPath = '\GlassBoxTrading\'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $tasks = @(Get-ScheduledTask -TaskPath $TaskPath)
} catch {
    # An absent folder is a fact (no task registered), not a failure. Its message is the CIM
    # "no objects found" error, recognised by its HRESULT rather than by localised text.
    if ($_.Exception.HResult -eq -2146233088 -and $_.CategoryInfo.Category -eq 'ObjectNotFound') { exit 0 }
    [Console]::Error.WriteLine("task list unreadable: $($_.CategoryInfo.Category)")
    exit 3
}
if ($tasks.Count -eq 0) { exit 0 }

$rows = foreach ($task in $tasks) {
    $userId = [string]$task.Principal.UserId
    $userSid = try { (New-Object Security.Principal.NTAccount($userId)).Translate([Security.Principal.SecurityIdentifier]).Value } catch { $null }
    [pscustomobject]@{
        TaskName           = $task.TaskName
        State              = [string]$task.State
        Actions            = @($task.Actions | ForEach-Object { [pscustomobject]@{ Execute = $_.Execute; Arguments = $_.Arguments; WorkingDirectory = $_.WorkingDirectory } })
        Triggers           = @($task.Triggers | ForEach-Object { [pscustomobject]@{ StartBoundary = $_.StartBoundary } })
        RunLevel           = [string]$task.Principal.RunLevel
        LogonType          = [string]$task.Principal.LogonType
        UserId             = $userId
        UserSid            = $userSid
        StartWhenAvailable = [bool]$task.Settings.StartWhenAvailable
    }
}
ConvertTo-Json -InputObject @($rows) -Depth 5
