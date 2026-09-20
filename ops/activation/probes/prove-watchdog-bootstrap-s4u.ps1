<#
.SYNOPSIS
    Proves that an on-demand S4U task can read and verify the fixed watchdog bootstrap.

.DESCRIPTION
    The elevated parent registers one triggerless, uniquely named proof task, reads its
    principal back, starts it, waits for a bounded result, and unregisters it in finally.
    The child runs in Task Scheduler's non-interactive S4U token and writes only identity,
    session, result code and hc: fingerprint — never the URL.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [Parameter(Mandatory = $true)][string]$ExpectedFingerprint,
    [switch]$Child
)

$ErrorActionPreference = 'Stop'

# Every value below enters the disposable task's argument string. The endpoint
# itself must never be accepted here: only a non-secret, fixed-shape fingerprint.
if ($ExpectedFingerprint -notmatch '^hc:[0-9a-f]{8}$') { throw 'ExpectedFingerprint must be exactly hc: plus eight lowercase hex characters.' }
if (-not [System.IO.Path]::IsPathRooted($RepoRoot) -or -not [System.IO.Directory]::Exists($RepoRoot) -or $RepoRoot.Contains('"')) { throw 'RepoRoot must be an existing absolute path without a quote.' }
if (-not [System.IO.Path]::IsPathRooted($ResultPath) -or $ResultPath.Contains('"')) { throw 'ResultPath must be an absolute path without a quote.' }

if ($Child) {
    try {
        Import-Module (Join-Path $RepoRoot 'tools\watchdog-bootstrap.psm1') -Force -ErrorAction Stop
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $check = Test-WatchdogBootstrap -TaskUserSid $identity.User.Value -ExpectedFingerprint $ExpectedFingerprint
        $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
        $interactive = [Environment]::UserInteractive
        $ok = $check.Ok -and $check.Fingerprint -eq $ExpectedFingerprint -and -not $interactive -and $sessionId -eq 0
        $line = if ($ok) {
            "WATCHDOG_BOOTSTRAP_S4U=PASS identity=$($identity.Name) sid=$($identity.User.Value) interactive=$interactive session=$sessionId fingerprint=$($check.Fingerprint)"
        } else {
            "WATCHDOG_BOOTSTRAP_S4U=FAIL interactive=$interactive session=$sessionId findings=$($check.Findings -join ',')"
        }
        [System.IO.File]::WriteAllText($ResultPath, $line, (New-Object System.Text.UTF8Encoding($false)))
        if (-not $ok) { exit 1 }
        exit 0
    } catch {
        [System.IO.File]::WriteAllText($ResultPath, "WATCHDOG_BOOTSTRAP_S4U=FAIL id=$($_.FullyQualifiedErrorId)", (New-Object System.Text.UTF8Encoding($false)))
        exit 1
    }
}

$principalNow = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalNow.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'the S4U proof parent must run elevated' }
if (Test-Path -LiteralPath $ResultPath) { Remove-Item -LiteralPath $ResultPath -Force }

$identityNow = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = "GlassBoxTrading-WatchdogBootstrap-Proof-$([guid]::NewGuid().ToString('N'))"
$powerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$scriptPath = $MyInvocation.MyCommand.Path
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`" -Child -RepoRoot `"$RepoRoot`" -ResultPath `"$ResultPath`" -ExpectedFingerprint `"$ExpectedFingerprint`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $RepoRoot
$principal = New-ScheduledTaskPrincipal -UserId $identityNow.Name -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -StartWhenAvailable

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description 'Disposable S4U read proof; no triggers; removed by its parent.' | Out-Null
    $registered = Get-ScheduledTask -TaskName $taskName
    if ($registered.Principal.LogonType -ne 'S4U' -or $registered.Triggers.Count -ne 0) { throw 'registered proof task is not triggerless S4U' }
    Start-ScheduledTask -TaskName $taskName
    $deadline = [DateTime]::UtcNow.AddSeconds(40)
    while (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf)) { throw 'S4U proof task produced no bounded result' }
    $result = [System.IO.File]::ReadAllText($ResultPath)
    if (-not $result.StartsWith('WATCHDOG_BOOTSTRAP_S4U=PASS')) { throw $result }
    $info = Get-ScheduledTaskInfo -TaskName $taskName
    if ($info.LastTaskResult -ne 0) { throw "S4U proof task returned $($info.LastTaskResult)" }
    Write-Output $result
} finally {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
