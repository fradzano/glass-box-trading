<#
.SYNOPSIS
    Prints the tail of a wrapper log with each line's time in BOTH local time
    and UTC.

.DESCRIPTION
    `cycle-run.ps1` and `watchdog-run.ps1` write their lines with
    `[DateTime]::UtcNow.ToString('o')`, i.e. UTC. Every instruction an operator
    follows is in local time. A gate found what that costs: the runbook told
    the operator to look for a "23:15 line" after the signed-out drill, and the
    line that a correctly working task actually writes is
    `2026-09-08T21:15:…Z` -- so a healthy deployment reads as a failed drill,
    at 23:20 on a Tuesday, with the anchor the next day.

    Rather than sprinkle UTC examples through the runbook and hope they survive
    two clock changes, this prints both. The local column is what the runbook's
    times refer to; the UTC column is what the file contains.

    It reads only. Nothing here writes, and it is not part of the certificate's
    runtime digest (tools/*.ps1 never is), so it can be used at any point of
    the run without touching what the arming gate compares.

.PARAMETER StateDir
    STATE_DIR. Defaults to the process environment, then to `.env` beside this
    script's repository, exactly as the wrappers resolve it.

.PARAMETER Log
    Which wrapper log: `cycle` (default) or `watchdog`.

.PARAMETER Tail
    How many lines from the end. Default 20.

.PARAMETER Since
    Optional local-time instant ("14:00", "2026-09-09 14:00"). Only lines at or
    after it are printed -- the usual question during a drill is "did anything
    fire after I switched it back on".

.EXAMPLE
    .\tools\show-run-log.ps1 -Tail 5
    .\tools\show-run-log.ps1 -Log watchdog -Since "14:00"
#>
[CmdletBinding()]
param(
    [string]$StateDir,
    [ValidateSet('cycle', 'watchdog')]
    [string]$Log = 'cycle',
    [ValidateRange(1, 10000)]
    [int]$Tail = 20,
    [string]$Since
)

$ErrorActionPreference = 'Stop'

function Get-DotEnvValue {
    # The same minimal reader both wrappers carry, for the same key.
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

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($StateDir)) { $StateDir = $env:STATE_DIR }
if ([string]::IsNullOrWhiteSpace($StateDir)) { $StateDir = Get-DotEnvValue -EnvFilePath (Join-Path $repoRoot '.env') -Key 'STATE_DIR' }
if ([string]::IsNullOrWhiteSpace($StateDir)) {
    throw "STATE_DIR is not set (checked the process environment and $repoRoot\.env). Pass -StateDir explicitly."
}

$fileName = if ($Log -eq 'cycle') { 'cycle-run.log' } else { 'watchdog-run.log' }
$logPath = Join-Path $StateDir $fileName
if (-not (Test-Path -LiteralPath $logPath)) {
    Write-Host "No $fileName in $StateDir yet."
    Write-Host 'Before the first firing that is expected; after it, it is a finding.'
    exit 0
}

$sinceLocal = $null
if (-not [string]::IsNullOrWhiteSpace($Since)) {
    try { $sinceLocal = [datetime]::Parse($Since, [System.Globalization.CultureInfo]::CurrentCulture) }
    catch { throw "-Since '$Since' is not a time this machine understands. Try '14:00' or '2026-09-09 14:00'." }
}

$zone = [System.TimeZoneInfo]::Local
Write-Host "$logPath"
Write-Host "local time is $($zone.Id); the file itself is UTC"
Write-Host ''

$lines = Get-Content -LiteralPath $logPath -Tail $Tail
$shown = 0
foreach ($line in $lines) {
    $space = $line.IndexOf(' ')
    $stampText = if ($space -gt 0) { $line.Substring(0, $space) } else { '' }
    $message = if ($space -gt 0) { $line.Substring($space + 1) } else { $line }
    $parsed = [datetime]::MinValue
    $ok = [datetime]::TryParse($stampText, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)
    if (-not $ok) {
        # A line without a parseable stamp is printed as it stands rather than dropped.
        Write-Host "                    $line"
        $shown += 1
        continue
    }
    $utc = $parsed.ToUniversalTime()
    $local = $utc.ToLocalTime()
    if ($null -ne $sinceLocal -and $local -lt $sinceLocal) { continue }
    Write-Host ("{0}  (UTC {1})  {2}" -f $local.ToString('yyyy-MM-dd HH:mm:ss'), $utc.ToString('HH:mm:ss'), $message)
    $shown += 1
}

if ($shown -eq 0) {
    Write-Host "No line at or after $($sinceLocal.ToString('yyyy-MM-dd HH:mm')) local in the last $Tail lines."
    Write-Host 'During a drill that is the finding, not an error of this command.'
}
