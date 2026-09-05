<#
.SYNOPSIS
    Exercises the whole alerting path to the operator's own device.

.DESCRIPTION
    S-G14-05 / A31 and scenario #79: an alert path that has never carried a
    real alert is not a safety net. During the competition it was not connected
    at all -- HEALTHCHECK_PING_URL was unset, so seventy pings were written to a
    file on the machine that is the thing most likely to have died.

    This script sends the four signals a deployment can produce, in order, to
    whatever endpoints are configured, and reports the HTTP outcome of each. It
    proves DELIVERY. Only the operator can confirm RECEIPT, which is the point:
    after running it, check the device that is supposed to wake you.

      1. readiness success  GET  <HEALTHCHECK_PING_URL>
      2. readiness failure  POST <HEALTHCHECK_PING_URL>/fail   (with conditions)
      3. liveness  success  POST <HEALTHCHECK_LIVENESS_URL>
      4. liveness  failure  POST <HEALTHCHECK_LIVENESS_URL>/fail

    It deliberately ends on a FAILURE for both checks, so the operator sees two
    alerts arrive and then has to resolve them by re-running with -ResolveOnly.
    A silent check is indistinguishable from a healthy one until something has
    actually failed once.

    The third case the operator must test is silence, and no script can send
    it: stop the scheduled tasks (or disconnect the machine) and wait out the
    check's period plus grace. The expected timings are printed at the end,
    derived from config\policy.json rather than chosen freely.

.PARAMETER RepoRoot
    Absolute path to the checkout. Defaults to the parent of this script's dir.

.PARAMETER ResolveOnly
    Send only the two success signals, to clear checks left failing by a
    previous run.

.EXAMPLE
    .\tools\check-alert-path.ps1
    Full exercise; ends with both checks in a failed state on purpose.

.EXAMPLE
    .\tools\check-alert-path.ps1 -ResolveOnly
    Put both checks back to healthy after confirming the alerts arrived.
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

$policyPath = Join-Path $RepoRoot 'config\policy.json'
$policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
$cycleIntervalMinutes = [math]::Round([int64]$policy.CYCLE_INTERVAL_MS / 60000.0)
$deadManMinutes = [math]::Round([int64]$policy.DEAD_MAN_BOUND_MS / 60000.0)
$alertSlaMinutes = [math]::Round([int64]$policy.ALERT_DELIVERY_BUDGET_MS / 60000.0)

Write-Host ''
Write-Host "Readiness endpoint: $(if ([string]::IsNullOrWhiteSpace($readiness)) { 'NOT CONFIGURED' } else { $readiness })"
Write-Host "Liveness  endpoint: $(if ([string]::IsNullOrWhiteSpace($liveness)) { 'NOT CONFIGURED' } else { $liveness })"
Write-Host ''

$stamp = [System.DateTime]::UtcNow.ToString('o')

if ($ResolveOnly) {
    Write-Host 'Resolve-only: sending the two success signals.'
    Send-Signal -Name 'readiness success' -Url $readiness -Method 'GET'
    Send-Signal -Name 'liveness success' -Url $liveness -Method 'POST' -Body "alert-path check resolved at $stamp"
} else {
    Send-Signal -Name 'readiness success' -Url $readiness -Method 'GET'
    Start-Sleep -Seconds 2
    Send-Signal -Name 'liveness success' -Url $liveness -Method 'POST' -Body "alert-path check: liveness healthy at $stamp"
    Start-Sleep -Seconds 2
    Send-Signal -Name 'readiness failure' -Url $(if ([string]::IsNullOrWhiteSpace($readiness)) { $null } else { $readiness.TrimEnd('/') + '/fail' }) -Method 'POST' -Body "ALERT PATH CHECK $stamp`nHALT_STANDING:AUTH_FAILURE`nCREDENTIAL_FENCE_UNRELEASED"
    Start-Sleep -Seconds 2
    Send-Signal -Name 'liveness failure' -Url $(if ([string]::IsNullOrWhiteSpace($liveness)) { $null } else { $liveness.TrimEnd('/') + '/fail' }) -Method 'POST' -Body "ALERT PATH CHECK $stamp`ncycle exit 1"
}

Write-Host ''
$results | Format-Table -AutoSize
$undelivered = @($results | Where-Object { $_.outcome -eq 'UNDELIVERED' -or $_.outcome -eq 'NOT CONFIGURED' })

Write-Host 'What the operator must now confirm, on the device that is supposed to wake them:'
if (-not $ResolveOnly) {
    Write-Host '  1. An alert for the READINESS check, naming HALT_STANDING:AUTH_FAILURE.'
    Write-Host '  2. An alert for the LIVENESS check, naming the non-zero cycle exit.'
    Write-Host '  3. Then re-run with -ResolveOnly and confirm both checks return to healthy.'
    Write-Host ''
    Write-Host '  4. Silence, which no script can send. Stop both scheduled tasks (or disconnect'
    Write-Host '     the machine) during a session and wait out the check period plus grace.'
}
Write-Host ''
Write-Host 'Timings to configure, derived from config\policy.json -- not chosen freely:'
Write-Host "  Liveness check period: $cycleIntervalMinutes min (CYCLE_INTERVAL_MS), grace 2 intervals = $($cycleIntervalMinutes * 2) min."
Write-Host "    Its schedule must cover the TRIGGER window in this machine's local time, Mon-Fri,"
Write-Host '    not the exchange session: the wrapper fires and reports liveness even when it skips.'
Write-Host "  Readiness check period: $cycleIntervalMinutes min, grace $deadManMinutes min (DEAD_MAN_BOUND_MS)."
Write-Host "  Alert delivery budget: $alertSlaMinutes min (ALERT_DELIVERY_BUDGET_MS) -- the owner-decided SLA (A18, owner call C)."
Write-Host '  Both checks are expected to be silent outside the trigger window, overnight and at'
Write-Host '  weekends; configure them with a cron schedule in the scheduler machine`s own zone so a'
Write-Host '  quiet Sunday is not an alert. Holidays and early closes still ping: the wrapper runs.'

if ($undelivered.Count -gt 0) {
    Write-Host ''
    Write-Host "ALERT PATH INCOMPLETE: $($undelivered.Count) signal(s) were not delivered. An unattended run may not start on this state."
    exit 1
}
Write-Host ''
Write-Host 'ALERT PATH DELIVERED: every configured signal reached its endpoint. Receipt is the operator''s to confirm.'
exit 0
