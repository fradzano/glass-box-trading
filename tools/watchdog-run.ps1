<#
.SYNOPSIS
    One dead-man watchdog check: computes today's session window and invokes
    `node dist/shell/watchdog-cli.js`. This is the per-firing Action script
    that tools/install-scheduled-task.ps1 registers on a recurring trigger;
    it is not meant to be edited independently of that installer (the two
    files keep small, deliberately duplicated copies of the same New York
    session-window helper -- see the matching comment in the installer).

.DESCRIPTION
    `src/shell/watchdog-cli.ts` (S-G14) is a process-level entry point that
    takes its clock and session window as explicit CLI arguments rather than
    resolving them itself. Windows Task Scheduler can only fire a static
    command line, so something has to compute `nowMs`, `opensAtMs`,
    `closesAtMs`, and `DEAD_MAN_BOUND_MS` at *run* time and hand them to the
    CLI. That is this script's entire job -- it decides nothing the pure core
    does not already decide; it only gathers the shell-side inputs the CLI
    was built to receive as arguments.

    SCOPE -- read before relying on this in competition operation:
    `watchdog-cli.ts` composes its broker and market ports through
    `src/shell/watchdog-runtime.ts`, so a firing that finds the journal stale
    in-session fences the writer, appends the `WATCHDOG_TAKEOVER` HALT, and
    then runs the full book recovery of `src/shell/watchdog.ts`: MATCHED
    structures close whole via mleg, every residue goes through the S-G10-03
    discrimination, and the run fail-pings. The composition is fail-closed:
    if the §0 configuration, the role credentials or the account binding are
    missing or inconsistent, the CLI degrades to the old fence-and-halt-only
    ports (broker null, market null), logs the reason on stderr -- which this
    script captures into watchdog-run.log -- and still fences, halts and
    pings. So "watchdog fires" means "the book is being flattened AND the
    agent is halted"; a degraded line in the log means the older reading
    still applies for that firing: halt now, reconcile the book by hand.
    The configuration is read from the checkout the compiled entry point
    lives in (dist\shell\watchdog-cli.js -> its repository root), not from
    the working directory, so the task's working directory cannot point the
    watchdog at a foreign deployment; a STATE_DIR that disagrees with the
    configured one degrades rather than recovers a foreign book.

    STATE_DIR resolution mirrors `src/shell/runtime-config.ts`
    (`loadEnvironment`): a real process environment variable named STATE_DIR
    wins; otherwise the value is read from `<RepoRoot>\.env`. Nothing else is
    read out of `.env` here, and this script never prints `.env` content.

.PARAMETER RepoRoot
    Absolute path to the glass-box-trading checkout. Required.

.PARAMETER NodePath
    Absolute path to node.exe. Required.

.PARAMETER WatchdogIntervalMinutes
    Informational only (echoed into the log line); the installer is the one
    that turns this into the task's repetition interval.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [int]$WatchdogIntervalMinutes = 0
)

$ErrorActionPreference = 'Stop'

function Get-EasternTimeZoneInfo {
    # Kept in sync by hand with the identical helper in install-scheduled-task.ps1.
    try {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('America/New_York')
    } catch {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
    }
}

function Get-TodaySessionUtc {
    # Regular-hours 09:30-16:00 America/New_York for "today" (New York wall-clock
    # date), DST-correct via .NET's zone tables. Does NOT know about market
    # holidays or early closes -- see the installer's header comment for the
    # same limitation applied to the scheduled trigger window.
    $eastern = Get-EasternTimeZoneInfo
    $nowUtc = [System.DateTime]::UtcNow
    $todayEasternDate = [System.TimeZoneInfo]::ConvertTimeFromUtc($nowUtc, $eastern).Date
    $openEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(9).AddMinutes(30), [System.DateTimeKind]::Unspecified)
    $closeEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(16), [System.DateTimeKind]::Unspecified)
    return [pscustomobject]@{
        OpensAtUtc  = [System.TimeZoneInfo]::ConvertTimeToUtc($openEastern, $eastern)
        ClosesAtUtc = [System.TimeZoneInfo]::ConvertTimeToUtc($closeEastern, $eastern)
    }
}

function Get-DotEnvValue {
    # Minimal single-key .env reader mirroring parseDotEnv's KEY=value shape
    # (# comments, optional surrounding quotes). Only ever asked for STATE_DIR
    # here, which is a path, not a secret.
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

# R46-B5: the same defect R44-B8 closed in cycle-run.ps1, at the other wrapper.
# Every precondition below used to `throw` before the heartbeat sender existed,
# so a missing node, an unbuilt dist or an absent STATE_DIR produced silence --
# and silence here costs the full 20-minute check period plus grace, on the one
# component whose failure nothing else can see. The sender and its endpoint are
# resolved first, and refusals go through Stop-WithHeartbeat.

function Send-WatchdogHeartbeat {
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

function Test-NodeRuns {
    <#
      R47-B8, mirroring tools/cycle-run.ps1. A NodePath that exists but is not a runnable image fails at the
      call site with ApplicationFailedException / NativeCommandFailed, and that
      failure aborts the script without reaching any sender: the endpoint saw
      nothing, and the operator waited out a full silence period for what is
      really an immediate, nameable refusal. It cannot be caught reliably at
      the call site either -- raising $ErrorActionPreference to 'Stop' there is
      the trap that killed the watchdog for a day, because it turns the child's
      first stderr line into a terminating error.
      So the image is probed BEFORE it matters, with a command that writes only
      to stdout when it works. `node --version` is that command.
    #>
    param([string]$Path)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Stop'
    try {
        $null = & $Path --version
        return @{ ok = $true; detail = '' }
    } catch {
        # One line: the raw record spans several and this text goes into a log line and a ping body.
        $flat = ($_.Exception.Message -replace "\s+", " ").Trim()
        if ($flat.Length -gt 200) { $flat = $flat.Substring(0, 200) }
        return @{ ok = $false; detail = $flat }
    } finally {
        $ErrorActionPreference = $previous
    }
}

$watchdogUrl = $env:HEALTHCHECK_WATCHDOG_URL
if ([string]::IsNullOrWhiteSpace($watchdogUrl)) {
    $watchdogUrl = Get-DotEnvValue -EnvFilePath (Join-Path $RepoRoot '.env') -Key 'HEALTHCHECK_WATCHDOG_URL'
}

function Stop-WithHeartbeat {
    # A refusal is still an invocation that happened. Report it as a heartbeat
    # failure with its reason, then stop.
    param([string]$Message)
    $delivery = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode 1 -Note "watchdog wrapper refused: $Message"
    throw "$Message (heartbeat $delivery)"
}

if (-not (Test-Path -LiteralPath $RepoRoot)) { Stop-WithHeartbeat "RepoRoot '$RepoRoot' does not exist." }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not (Test-Path -LiteralPath $NodePath)) { Stop-WithHeartbeat "NodePath '$NodePath' does not exist." }

$watchdogEntry = Join-Path $RepoRoot 'dist\shell\watchdog-cli.js'
if (-not (Test-Path -LiteralPath $watchdogEntry)) { Stop-WithHeartbeat "'$watchdogEntry' is missing; run 'npm run build' in $RepoRoot before operating the scheduled tasks." }

$policyPath = Join-Path $RepoRoot 'config\policy.json'
try {
    $policy = Get-Content -LiteralPath $policyPath -Raw | ConvertFrom-Json
    $deadManBoundMs = [int64]$policy.DEAD_MAN_BOUND_MS
} catch {
    Stop-WithHeartbeat "config\policy.json could not be read from ${RepoRoot}: $($_.Exception.Message)"
}

$stateDir = $env:STATE_DIR
if ([string]::IsNullOrWhiteSpace($stateDir)) {
    try {
        $stateDir = Get-DotEnvValue -EnvFilePath (Join-Path $RepoRoot '.env') -Key 'STATE_DIR'
    } catch {
        Stop-WithHeartbeat "STATE_DIR could not be read from $RepoRoot\.env: $($_.Exception.Message)"
    }
}
if ([string]::IsNullOrWhiteSpace($stateDir)) { Stop-WithHeartbeat "STATE_DIR is not set (checked the process environment and $RepoRoot\.env)." }

$nowUtc = [System.DateTime]::UtcNow
$nowIsWeekday = $nowUtc.DayOfWeek -ne [System.DayOfWeek]::Saturday -and $nowUtc.DayOfWeek -ne [System.DayOfWeek]::Sunday
$logPath = Join-Path $stateDir 'watchdog-run.log'

function Write-RunLog {
    param([string]$Message)
    $line = "$([System.DateTime]::UtcNow.ToString('o')) $Message"
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding utf8 } catch { }
    Write-Verbose $line
}

if (-not $nowIsWeekday) {
    Write-RunLog "skip: weekend (watchdog-cli.ts always treats its input as a trading day, so this wrapper is the only Mon-Fri gate)"
    exit 0
}


$session = Get-TodaySessionUtc
$nowMs = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$opensAtMs = [System.DateTimeOffset]::new($session.OpensAtUtc, [System.TimeSpan]::Zero).ToUnixTimeMilliseconds()
$closesAtMs = [System.DateTimeOffset]::new($session.ClosesAtUtc, [System.TimeSpan]::Zero).ToUnixTimeMilliseconds()
$instanceId = "watchdog-$($env:COMPUTERNAME)-$PID"

Write-RunLog "run: instanceId=$instanceId nowMs=$nowMs opensAtMs=$opensAtMs closesAtMs=$closesAtMs deadManBoundMs=$deadManBoundMs stateDir=$stateDir"

$arguments = @($watchdogEntry, $stateDir, $instanceId, "$nowMs", "$opensAtMs", "$closesAtMs", "$deadManBoundMs")
# Windows PowerShell 5.1 wraps every stderr line of a native command in an
# ErrorRecord when the stream is redirected. Under the script-wide
# $ErrorActionPreference = 'Stop' the FIRST such line -- and watchdog-cli.js
# writes its composition log line to stderr before it assesses anything --
# terminated this script and killed the child, so no scheduled firing ever
# reached the staleness assessment, the fence, or the recovery. Measured
# 2026-09-03 on the competition deployment: 54 firings logged "run:", none
# logged "output:" or "exit:", every task result was 1. The native call
# therefore runs under 'Continue'; the CLI's exit code, not its stderr, is
# the verdict, and its stderr lines are logged as output below.
$nodeRuns = Test-NodeRuns -Path $NodePath
if (-not $nodeRuns.ok) {
    $delivery = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode 1 -Note "node cannot be started: $($nodeRuns.detail)"
    Write-RunLog "start refused: node at '$NodePath' is not runnable: $($nodeRuns.detail); heartbeat $delivery"
    exit 1
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $output = & $NodePath @arguments 2>&1
    $exitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
$output | ForEach-Object { Write-RunLog "output: $_" }

# The watchdog's own heartbeat, on its own endpoint.
#
# Without it, both other checks stay green while the watchdog alone is dead or
# disabled: liveness comes from the cycle wrapper, and readiness from the state
# files, so a silent watchdog looks exactly like a healthy one. That is the
# safety net whose failure is least visible, because it only ever acts when
# something else has already gone wrong. Its absence is now detectable on its
# own schedule; a non-zero exit is reported as a failure.
$heartbeat = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode $exitCode -Note "watchdog exit $exitCode"
Write-RunLog "exit: $exitCode; heartbeat $heartbeat"
exit $exitCode
