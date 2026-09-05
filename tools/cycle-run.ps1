<#
.SYNOPSIS
    Runs one agent cycle and keeps its printed report.

.DESCRIPTION
    The scheduled cycle task used to invoke `node dist\shell\agent-cli.js`
    directly. agent-cli.js prints a full cycle report -- gate verdicts,
    lifecycle vetoes, management closes and, since 2026-09-05, the refused
    management closes -- and the task discarded all of it. On 2026-09-03 that
    turned three structures the runner could not price into seven cycles that
    read, from the outside, like an agent holding on purpose (scenario #75,
    DECISIONS 2026-09-03). This wrapper is the fix: it runs the same command
    and appends everything the process printed to `cycle-run.log` in
    STATE_DIR, next to the journal and the watchdog's own log.

    The journal remains the record of consequence -- the refusals themselves
    are journaled as MANAGEMENT_REFUSAL entries (S-X-08), so this log is a
    convenience for the operator, never the only copy of anything.

    Deliberately mirrors tools\watchdog-run.ps1, including the one trap that
    cost a day: Windows PowerShell 5.1 wraps every stderr line of a native
    command in an ErrorRecord when the stream is redirected, and under a
    script-wide $ErrorActionPreference = 'Stop' the first such line kills the
    child. agent-cli.js writes its composition line to stderr, so the native
    call runs under 'Continue' and the exit code, not stderr, is the verdict.

.PARAMETER RepoRoot
    Absolute path to the glass-box-trading checkout. Defaults to the parent of
    this script's directory (tools\..).

.PARAMETER NodePath
    Absolute path to node.exe. Defaults to `(Get-Command node).Source`.

.PARAMETER SkipOutsideSession
    Refuse to invoke the agent outside the exchange session for today, computed
    from America/New_York 09:30-16:00 with a lead-in, and on weekends. The
    trigger window is deliberately wider than the session (S-G14-06) so that it
    still covers the session during the weeks when the American and European
    clock changes have not yet met; this switch is what keeps the wide trigger
    from producing pointless invocations. Liveness is still reported on a
    skipped firing -- the scheduler fired and this script ran, which is exactly
    what liveness claims. Default on; -SkipOutsideSession:$false runs always.

.PARAMETER MaxLogBytes
    Rotate cycle-run.log to cycle-run.log.1 once it exceeds this size. A cycle
    report is a few kilobytes and the task fires every 15 minutes, so an
    unrotated log would grow without bound across a long paper run. Default
    16 MiB; 0 disables rotation.
#>
[CmdletBinding()]
param(
    [string]$RepoRoot,
    [string]$NodePath,
    [ValidateRange(0, 1073741824)]
    [int]$MaxLogBytes = 16777216,
    [bool]$SkipOutsideSession = $true,
    [ValidateRange(0, 240)]
    [int]$SessionLeadInMinutes = 20
)

$ErrorActionPreference = 'Stop'

# R44-B8: every precondition below used to `throw` before Send-Liveness was
# even defined, so a missing STATE_DIR, a missing node or an unbuilt dist
# produced a non-zero exit and NO ping at all -- the one class of failure
# where the scheduler fired and the operator heard nothing until the next
# expected ping timed out. The reader, the sender and the liveness URL are
# therefore resolved first, and refusals go through Stop-WithLiveness.
if ([string]::IsNullOrWhiteSpace($RepoRoot)) { $RepoRoot = Split-Path -Parent $PSScriptRoot }

function Get-DotEnvValue {
    # Minimal single-key .env reader mirroring parseDotEnv's KEY=value shape
    # (# comments, optional surrounding quotes). Only ever asked for STATE_DIR
    # here, which is a path, not a secret. Kept in sync by hand with the
    # identical helper in watchdog-run.ps1.
    param([string]$EnvFilePath, [string]$Key)
    if (-not (Test-Path -LiteralPath $EnvFilePath)) { return $null }
    foreach ($rawLine in Get-Content -LiteralPath $EnvFilePath) {
        $line = $rawLine.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) { continue }
        $lineKey = $line.Substring(0, $separator).Trim()
        if ($lineKey -ne $Key) { continue }
        $value = $line.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        return $value
    }
    return $null
}

function Send-Liveness {
    <#
      S-G14-05 / A31: liveness is a different claim from readiness and travels
      on its own endpoint. It says the scheduler fired, this wrapper ran and
      the process reached its end -- nothing about whether the deployment can
      trade, which the runtime reports separately through HEALTHCHECK_PING_URL.
      A non-zero exit is reported as a liveness failure, so a crash-loop is
      visible immediately instead of waiting out a dead-man period. Delivery is
      best effort and never changes this script's exit code.
    #>
    param([string]$BaseUrl, [int]$ExitCode, [string]$Note)
    if ([string]::IsNullOrWhiteSpace($BaseUrl)) { return 'unset' }
    $url = if ($ExitCode -eq 0) { $BaseUrl } else { ($BaseUrl.TrimEnd('/') + '/fail') }
    try {
        $previous = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try {
            Invoke-WebRequest -Uri $url -Method Post -Body $Note -TimeoutSec 10 -UseBasicParsing | Out-Null
        } finally {
            $ProgressPreference = $previous
        }
        return 'sent'
    } catch {
        return "undelivered: $($_.Exception.Message)"
    }
}

$livenessUrl = $env:HEALTHCHECK_LIVENESS_URL
if ([string]::IsNullOrWhiteSpace($livenessUrl)) {
    $livenessUrl = Get-DotEnvValue -EnvFilePath (Join-Path $RepoRoot '.env') -Key 'HEALTHCHECK_LIVENESS_URL'
}

function Stop-WithLiveness {
    # A refusal is still an invocation that happened. Report it as a
    # liveness failure with the reason, then stop.
    param([string]$Message)
    $delivery = Send-Liveness -BaseUrl $livenessUrl -ExitCode 1 -Note "wrapper refused: $Message"
    throw "$Message (liveness $delivery)"
}

if (-not (Test-Path -LiteralPath $RepoRoot)) { Stop-WithLiveness "RepoRoot '$RepoRoot' does not exist." }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { Stop-WithLiveness 'node was not found on PATH; pass -NodePath explicitly.' }
    $NodePath = $nodeCommand.Source
}
if (-not (Test-Path -LiteralPath $NodePath)) { Stop-WithLiveness "NodePath '$NodePath' does not exist." }

$agentEntry = Join-Path $RepoRoot 'dist\shell\agent-cli.js'
if (-not (Test-Path -LiteralPath $agentEntry)) { Stop-WithLiveness "'$agentEntry' is missing; run 'npm run build' in $RepoRoot before operating the scheduled tasks." }

$stateDir = $env:STATE_DIR
if ([string]::IsNullOrWhiteSpace($stateDir)) {
    $stateDir = Get-DotEnvValue -EnvFilePath (Join-Path $RepoRoot '.env') -Key 'STATE_DIR'
}
if ([string]::IsNullOrWhiteSpace($stateDir)) { Stop-WithLiveness "STATE_DIR is not set (checked the process environment and $RepoRoot\.env)." }

function Get-EasternTimeZoneInfo {
    # Kept in sync by hand with the identical helper in watchdog-run.ps1.
    try {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('America/New_York')
    } catch {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
    }
}

function Test-InsideSession {
    # S-G14-06. Precisely: this converts the current instant into New York
    # local time through the platform's zone tables and compares it with FIXED
    # 09:30-16:00 session bounds. It does NOT consult an exchange calendar --
    # holidays and early closes are unknown to it, so it will let a cycle run on
    # Thanksgiving and after a 13:00 early close. That is safe and documented: a
    # firing on a non-trading day is a normal, cheap, journaled no-trade cycle
    # (S-CYC-08/S-CYC-03), because the RUNTIME does read the exchange calendar.
    # What this prevents is only the overnight and pre-open part of a
    # deliberately wide trigger window.
    param([int]$LeadInMinutes)
    $eastern = Get-EasternTimeZoneInfo
    $nowUtc = [System.DateTime]::UtcNow
    $nowEastern = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $eastern)
    if ($nowEastern.DayOfWeek -eq [System.DayOfWeek]::Saturday -or $nowEastern.DayOfWeek -eq [System.DayOfWeek]::Sunday) { return $false }
    $open = $nowEastern.Date.AddHours(9).AddMinutes(30).AddMinutes(-$LeadInMinutes)
    $close = $nowEastern.Date.AddHours(16)
    return ($nowEastern -ge $open) -and ($nowEastern -le $close)
}

$logPath = Join-Path $stateDir 'cycle-run.log'
if ($MaxLogBytes -gt 0 -and (Test-Path -LiteralPath $logPath)) {
    $existing = Get-Item -LiteralPath $logPath
    if ($existing.Length -gt $MaxLogBytes) {
        # One generation is kept. Losing an older report is acceptable; losing
        # the disk is not, and the journal carries what matters either way.
        try { Move-Item -LiteralPath $logPath -Destination "$logPath.1" -Force } catch { }
    }
}

function Write-RunLog {
    param([string]$Message)
    $line = "$([System.DateTime]::UtcNow.ToString('o')) $Message"
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding utf8 } catch { }
    Write-Verbose $line
}

if ($SkipOutsideSession -and -not (Test-InsideSession -LeadInMinutes $SessionLeadInMinutes)) {
    # R43-B8: readiness reports on EVERY firing, not only the ones that run a
    # cycle. The set of in-session firings moves by an hour in the week between
    # the European and American clock changes, so no single expected-ping
    # schedule can match it; reporting on every firing makes one schedule right
    # for the whole run, and a halt overnight is heard before the open.
    $readinessEntry = Join-Path $RepoRoot 'dist\shell\readiness-cli.js'
    $readiness = 'skipped (readiness-cli.js missing; run npm run build)'
    if (Test-Path -LiteralPath $readinessEntry) {
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            $readiness = (& $NodePath $readinessEntry 2>&1) -join '; '
        } finally {
            $ErrorActionPreference = $previousPreference
        }
    }
    $delivery = Send-Liveness -BaseUrl $livenessUrl -ExitCode 0 -Note "skip: outside the exchange session"
    Write-RunLog "skip: outside the exchange session (weekend, or beyond 09:30-16:00 America/New_York minus $SessionLeadInMinutes min lead-in, computed from the zone tables -- holidays and early closes are NOT known here); liveness $delivery; $readiness"
    exit 0
}

Write-RunLog "run: pid=$PID stateDir=$stateDir entry=$agentEntry"

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $output = & $NodePath $agentEntry 2>&1
    $exitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$output | ForEach-Object { Write-RunLog "output: $_" }
$delivery = Send-Liveness -BaseUrl $livenessUrl -ExitCode $exitCode -Note "cycle exit $exitCode"
Write-RunLog "exit: $exitCode; liveness $delivery"
exit $exitCode
