<#
.SYNOPSIS
    Exercises the whole alerting path to the operator's own device.

.DESCRIPTION
    S-G14-05 / A31 and scenario #79: an alert path that has never carried a
    real alert is not a safety net. During the competition it was not connected
    at all -- HEALTHCHECK_PING_URL was unset, so seventy pings were written to a
    file on the machine that is the thing most likely to have died.

    This script sends the six signals a deployment can produce, in order, to
    whatever endpoints are configured, and reports the HTTP outcome of each. It
    proves DELIVERY. Only the operator can confirm RECEIPT, which is the point:
    after running it, check the device that is supposed to wake you.

      1. readiness success  GET  <HEALTHCHECK_PING_URL>
      2. readiness failure  POST <HEALTHCHECK_PING_URL>/fail   (with conditions)
      3. liveness  success  POST <HEALTHCHECK_LIVENESS_URL>
      4. liveness  failure  POST <HEALTHCHECK_LIVENESS_URL>/fail
      5. watchdog  success  POST <HEALTHCHECK_WATCHDOG_URL>
      6. watchdog  failure  POST <HEALTHCHECK_WATCHDOG_URL>/fail

    The watchdog has its own check because the other two cannot see it: liveness
    comes from the cycle wrapper and readiness from the state files, so a
    watchdog that is disabled or broken leaves both of them green.

    It deliberately ends on a FAILURE for all three checks, so the operator sees
    three alerts arrive and then has to resolve them by re-running with
    -ResolveOnly.
    A silent check is indistinguishable from a healthy one until something has
    actually failed once.

    The cases no script can send are the SILENCES, and there are three distinct
    ones -- watchdog alone, both tasks, and a powered-off machine. They are
    listed at the end with the timings, derived from config\policy.json rather
    than chosen freely.

.PARAMETER RepoRoot
    Absolute path to the checkout. Defaults to the parent of this script's dir.

.PARAMETER ResolveOnly
    Send only the three success signals, to clear checks left failing by a
    previous run.

.EXAMPLE
    .\tools\check-alert-path.ps1
    Full exercise; ends with all three checks in a failed state on purpose.

.EXAMPLE
    .\tools\check-alert-path.ps1 -ResolveOnly
    Put all three checks back to healthy after confirming the alerts arrived.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [switch]$ResolveOnly
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $PSScriptRoot }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

function Get-DotEnvValue {
    param([string]$EnvFilePath, [string]$Key)
    if (-not (Test-Path -LiteralPath $EnvFilePath)) { return $null }
    foreach ($rawLine in Get-Content -LiteralPath $EnvFilePath) {
        $line = $rawLine.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) { continue }
        if ($line.Substring(0, $separator).Trim() -ne $Key) { continue }
        $value = $line.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        return $value
    }
    return $null
}

function Resolve-Endpoint {
    param([string]$Key)
    $value = [System.Environment]::GetEnvironmentVariable($Key)
    if ([string]::IsNullOrWhiteSpace($value)) { $value = Get-DotEnvValue -EnvFilePath (Join-Path $RepoRoot '.env') -Key $Key }
    return $value
}

$results = New-Object System.Collections.Generic.List[object]

function Send-Signal {
    param([string]$Name, [string]$Url, [string]$Method, [string]$Body)
    if ([string]::IsNullOrWhiteSpace($Url)) {
        $results.Add([pscustomobject]@{ signal = $Name; outcome = 'NOT CONFIGURED'; detail = 'the endpoint is unset in the process environment and in .env' })
        Write-Host "[SKIP] $Name -- endpoint not configured"
        return
    }
    try {
        $previous = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            if ($Method -eq 'GET') {
                $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 15 -UseBasicParsing
            } else {
                $response = Invoke-WebRequest -Uri $Url -Method Post -Body $Body -TimeoutSec 15 -UseBasicParsing
            }
        } finally {
            $ProgressPreference = $previous
        }
        $results.Add([pscustomobject]@{ signal = $Name; outcome = "HTTP $($response.StatusCode)"; detail = $Url })
        Write-Host "[SENT] $Name -- HTTP $($response.StatusCode) to $Url"
    } catch {
        $results.Add([pscustomobject]@{ signal = $Name; outcome = 'UNDELIVERED'; detail = $_.Exception.Message })
        Write-Host "[FAIL] $Name -- $($_.Exception.Message)"
    }
}

$readiness = Resolve-Endpoint -Key 'HEALTHCHECK_PING_URL'
$liveness = Resolve-Endpoint -Key 'HEALTHCHECK_LIVENESS_URL'
$watchdog = Resolve-Endpoint -Key 'HEALTHCHECK_WATCHDOG_URL'

$policyPath = Join-Path $RepoRoot 'config\policy.json'
$policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
$cycleIntervalMinutes = [math]::Round([int64]$policy.CYCLE_INTERVAL_MS / 60000.0)
$deadManMinutes = [math]::Round([int64]$policy.DEAD_MAN_BOUND_MS / 60000.0)
$alertSlaMinutes = [math]::Round([int64]$policy.ALERT_DELIVERY_BUDGET_MS / 60000.0)

Write-Host ''
Write-Host "Readiness endpoint: $(if ([string]::IsNullOrWhiteSpace($readiness)) { 'NOT CONFIGURED' } else { $readiness })"
Write-Host "Liveness  endpoint: $(if ([string]::IsNullOrWhiteSpace($liveness)) { 'NOT CONFIGURED' } else { $liveness })"
Write-Host "Watchdog  endpoint: $(if ([string]::IsNullOrWhiteSpace($watchdog)) { 'NOT CONFIGURED' } else { $watchdog })"
Write-Host ''

$stamp = [System.DateTime]::UtcNow.ToString('o')

if ($ResolveOnly) {
    Write-Host 'Resolve-only: sending the three success signals.'
    Send-Signal -Name 'readiness success' -Url $readiness -Method 'GET'
    Send-Signal -Name 'liveness success' -Url $liveness -Method 'POST' -Body "alert-path check resolved at $stamp"
    Send-Signal -Name 'watchdog success' -Url $watchdog -Method 'POST' -Body "alert-path check resolved at $stamp"
} else {
    Send-Signal -Name 'readiness success' -Url $readiness -Method 'GET'
    Start-Sleep -Seconds 2
    Send-Signal -Name 'liveness success' -Url $liveness -Method 'POST' -Body "alert-path check: liveness healthy at $stamp"
    Start-Sleep -Seconds 2
    Send-Signal -Name 'readiness failure' -Url $(if ([string]::IsNullOrWhiteSpace($readiness)) { $null } else { $readiness.TrimEnd('/') + '/fail' }) -Method 'POST' -Body "ALERT PATH CHECK $stamp`nHALT_STANDING:AUTH_FAILURE`nCREDENTIAL_FENCE_UNRELEASED"
    Start-Sleep -Seconds 2
    Send-Signal -Name 'liveness failure' -Url $(if ([string]::IsNullOrWhiteSpace($liveness)) { $null } else { $liveness.TrimEnd('/') + '/fail' }) -Method 'POST' -Body "ALERT PATH CHECK $stamp`ncycle exit 1"
    Start-Sleep -Seconds 2
    Send-Signal -Name 'watchdog success' -Url $watchdog -Method 'POST' -Body "alert-path check: watchdog healthy at $stamp"
    Start-Sleep -Seconds 2
    Send-Signal -Name 'watchdog failure' -Url $(if ([string]::IsNullOrWhiteSpace($watchdog)) { $null } else { $watchdog.TrimEnd('/') + '/fail' }) -Method 'POST' -Body "ALERT PATH CHECK $stamp`nwatchdog exit 1"
}

Write-Host ''
$results | Format-Table -AutoSize
$undelivered = @($results | Where-Object { $_.outcome -eq 'UNDELIVERED' -or $_.outcome -eq 'NOT CONFIGURED' })

Write-Host 'What the operator must now confirm, on the device that is supposed to wake them:'
if (-not $ResolveOnly) {
    Write-Host '  1. An alert for the READINESS check, naming HALT_STANDING:AUTH_FAILURE.'
    Write-Host '  2. An alert for the LIVENESS check, naming the non-zero cycle exit.'
    Write-Host '  3. An alert for the WATCHDOG check, naming the non-zero watchdog exit.'
    Write-Host '  4. Then re-run with -ResolveOnly and confirm all three return to healthy.'
    Write-Host ''
    Write-Host '  5. Silence, which no script can send, and each of these is a DIFFERENT path:'
    Write-Host '       a. disable ONLY the watchdog task during a session -> watchdog check alone'
    Write-Host '          goes down while the other two stay green. This is the case that was'
    Write-Host '          invisible before the watchdog got its own heartbeat.'
    Write-Host '       b. disable BOTH tasks during a session -> liveness and readiness go down.'
    Write-Host '       c. power the machine off during a session -> all three go down.'
    Write-Host '     Wait out each period plus grace and confirm the alert on your own device.'
}
Write-Host ''
Write-Host 'Schedules: run tools\install-scheduled-task.ps1 -WhatIf. It prints the exact cron'
Write-Host 'expression and timezone for each check, derived from the trigger it registers.'
Write-Host ''
Write-Host 'Timings to configure, derived from config\policy.json -- not chosen freely:'
Write-Host "  liveness   grace 30 min. Detection: up to $cycleIntervalMinutes min to the next expected"
Write-Host '             ping, plus grace. Means: the machine, the scheduler or the process is gone.'
Write-Host "  readiness  grace $deadManMinutes min (DEAD_MAN_BOUND_MS). Detection: up to $cycleIntervalMinutes min plus grace."
Write-Host '             Means: a halt, an unreleased credential fence, or an unwritable state dir.'
Write-Host "  watchdog   grace 15 min. Detection: up to the watchdog interval plus grace."
Write-Host '             Means: the safety net itself is not running.'
Write-Host "  Alert DELIVERY budget is separate and additional: $alertSlaMinutes min (ALERT_DELIVERY_BUDGET_MS,"
Write-Host '             owner call C). Detection + delivery is what you actually wait.'
Write-Host '  All three are expected to be silent outside the trigger window, overnight and at'
Write-Host '  weekends: use the cron expressions the installer prints, in the machine`s own zone,'
Write-Host '  so a quiet Sunday is not an alert. Holidays and early closes still ping.'

if ($undelivered.Count -gt 0) {
    Write-Host ''
    Write-Host "ALERT PATH INCOMPLETE: $($undelivered.Count) signal(s) were not delivered. An unattended run may not start on this state."
    exit 1
}
Write-Host ''
Write-Host 'ALERT PATH DELIVERED: every configured signal reached its endpoint. Receipt is the operator''s to confirm.'
exit 0
