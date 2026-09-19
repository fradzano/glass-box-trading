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

.PARAMETER MaxLogBytes
    Rotation bound for watchdog-run.log, one generation kept, 0 disables it.
    The registered task does not pass it: the default is the same 16 MiB the
    cycle wrapper uses, and until 2026-09-19 this log had no rotation at all
    while its sibling did -- the kind of asymmetry two hand-kept copies of one
    mechanism produce. Rotation now lives in tools/run-log.psm1 for both.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$NodePath,

    [int]$WatchdogIntervalMinutes = 0,

    [int]$MaxLogBytes = 16777216
)

$ErrorActionPreference = 'Stop'

# The run log comes from tools/run-log.psm1 -- one implementation for both wrappers
# (docs/P12-STOP-AND-LOG-CONTRACTS.md, LC-8). Until 2026-09-19 each wrapper carried its
# own hand-synchronised copy, and five findings of one evening came out of that.
#
# If the module cannot be loaded the firing still happens: the log is a diagnostic
# record, not a precondition for the dead man (LC-1). The stubs below keep every call
# site working and make the missing module travel in the heartbeat body, which is the
# channel that is still reachable.
$runLogModuleFailure = $null
try {
    Import-Module (Join-Path $PSScriptRoot 'run-log.psm1') -Force -ErrorAction Stop
} catch {
    $script:runLogModuleFailureText = ($_.Exception.Message -replace "\s+", " ").Trim()
    $runLogModuleFailure = $script:runLogModuleFailureText
    function Initialize-RunLog { param([string]$Path, [int]$MaxBytes = 0, [int]$RetryCount = 1, [int]$RetryDelayMilliseconds = 0) }
    function Write-RunLog { param([string]$Message) return $false }
    function Get-RunLogStatus { return @{ Initialized = $false; Failed = $true; FirstFailure = "the shared run-log module could not be loaded: $script:runLogModuleFailureText"; FirstLostLine = $null; LostLines = 0; FallbackUsed = $null; Path = $null; Rotated = $false; RotationFailure = $null } }
    function Get-RunLogFailureClause { return "; the shared run-log module could not be loaded ($script:runLogModuleFailureText), so this firing wrote no run log at all" }
}

# ---------------------------------------------------------------------------
# Exchange closures -- a STOP-GAP, and declared as one (DECISIONS, 2026-09-18).
#
# `src/shell/watchdog-cli.ts` asserts `isTradingDay: true` unconditionally and
# this wrapper's only other gate was Monday-to-Friday, so on a weekday the
# exchange is shut the watchdog turned an agent outage on a closed market into a
# fenced epoch store, a standing WATCHDOG_TAKEOVER halt that only a human can
# clear, and a fail ping on every firing -- roughly every fifteen minutes for the
# rest of the day. Measured on Thanksgiving with the real CLI; the same pure
# function fed the exchange calendar answers OUTSIDE_SESSION.
#
# The repair this deserves is the watchdog path reading the exchange calendar it
# already fetches, at `watchdog-cli.ts` and at `watchdog-runtime.ts`'s degraded
# composition. That is `src/`, which is runtime-digest material and frozen until
# after the anchor run. This file is not digest material (`enumerateRuntimeFiles`
# takes only `tools/*.mjs` and `tools/*.py`), so the gate can be closed here
# without voiding a certificate.
#
# THE LIMIT, said plainly: this is a hand-written table, which is the same
# species of asserted fact as the one it repairs. It cannot know about an
# unscheduled closure -- a weather day, a national day of mourning -- which is
# decided days ahead, not years. It is authoritative only through its last entry.
# It must be replaced by a calendar read, not extended forever.
#
# Coverage runs past the measurement period on purpose: the scheduled triggers
# are registered weekly with no end boundary, so the only thing that stops them
# is a human disabling both tasks on the journaling-only day. If that is missed,
# the December and 2027 dates are what would otherwise bite.
$MarketFullDayClosures = @(
    '2026-11-26',  # Thanksgiving                     -- inside the measurement period
    '2026-12-25',  # Christmas Day
    '2027-01-01',  # New Year's Day
    '2027-01-18',  # Martin Luther King, Jr. Day
    '2027-02-15',  # Washington's Birthday
    '2027-03-26',  # Good Friday
    '2027-05-31',  # Memorial Day
    '2027-06-18',  # Juneteenth observed (the 19th is a Saturday)
    '2027-07-05',  # Independence Day observed (the 4th is a Sunday)
    '2027-09-06',  # Labor Day
    '2027-11-25',  # Thanksgiving
    '2027-12-24'   # Christmas Day observed (the 25th is a Saturday)
)

# Early closes, all at 13:00 America/New_York. The wrapper hands the CLI the real
# close, so the post-13:00 tail is outside the session and assessStaleness stays
# quiet -- no separate skip is needed for these.
$MarketEarlyCloses = @{
    '2026-11-27' = 13  # the day after Thanksgiving   -- inside the measurement period
    '2026-12-24' = 13  # Christmas Eve
    '2027-11-26' = 13  # the day after Thanksgiving
}

# The last date either table speaks for. Past it the wrapper keeps today's
# behaviour and says so in the log, rather than inventing a silence: a wrapper
# that skipped past its own coverage would remove the safety net instead of
# repairing it.
$MarketTableThroughDate = '2027-12-31'

function Get-EasternTimeZoneInfo {
    # Kept in sync by hand with the identical helper in install-scheduled-task.ps1.
    try {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('America/New_York')
    } catch {
        return [System.TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
    }
}

function Get-TodayEasternDate {
    # "Today" as the exchange reckons it. Every date decision in this file goes
    # through here, so none of them can drift into UTC: between 00:00 and 05:00
    # Berlin the UTC date is already tomorrow in New York's yesterday, and a
    # weekday test on the wrong one is wrong at exactly the hours nobody watches.
    $eastern = Get-EasternTimeZoneInfo
    return [System.TimeZoneInfo]::ConvertTimeFromUtc([System.DateTime]::UtcNow, $eastern).Date
}

function Test-MarketFullDayClosure {
    # Split out so the closure decision can be driven for any date by a test
    # rather than only for whatever day the host happens to be on. A gate that
    # can only be exercised by waiting for Thanksgiving is not a gate anybody
    # can check.
    param([Parameter(Mandatory = $true)][datetime]$EasternDate)
    return $MarketFullDayClosures -contains $EasternDate.ToString('yyyy-MM-dd')
}

function Get-TodaySessionUtc {
    # Regular hours 09:30-16:00 America/New_York for the given New York
    # wall-clock date -- today's by default -- DST-correct via .NET's zone
    # tables, with the early-close table above applied. It does NOT know about
    # unscheduled closures; see the table's header for the limit this carries.
    param([datetime]$EasternDate = (Get-TodayEasternDate))
    $eastern = Get-EasternTimeZoneInfo
    $todayEasternDate = $EasternDate.Date
    $key = $todayEasternDate.ToString('yyyy-MM-dd')
    $closeHour = 16
    if ($MarketEarlyCloses.ContainsKey($key)) { $closeHour = $MarketEarlyCloses[$key] }
    $openEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours(9).AddMinutes(30), [System.DateTimeKind]::Unspecified)
    $closeEastern = [System.DateTime]::SpecifyKind($todayEasternDate.AddHours($closeHour), [System.DateTimeKind]::Unspecified)
    return [pscustomobject]@{
        OpensAtUtc     = [System.TimeZoneInfo]::ConvertTimeToUtc($openEastern, $eastern)
        ClosesAtUtc    = [System.TimeZoneInfo]::ConvertTimeToUtc($closeEastern, $eastern)
        IsEarlyClose   = $MarketEarlyCloses.ContainsKey($key)
        EasternDateKey = $key
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
    # Guarded, because this read runs *before* the sender exists. Under the
    # script-wide $ErrorActionPreference = 'Stop', a locked or unreadable .env
    # terminated the wrapper right here: no log, no ping, no exit line -- the
    # same failure class R46-B5 closed twenty lines further down at the sibling
    # STATE_DIR read, which this call was left out of. An unreadable .env must
    # not be quieter than a missing one, so the URL simply stays unset and the
    # refusal below travels as far as it can.
    try {
        $watchdogUrl = Get-DotEnvValue -EnvFilePath (Join-Path $RepoRoot '.env') -Key 'HEALTHCHECK_WATCHDOG_URL'
    } catch {
        $watchdogUrl = $null
        $watchdogUrlReadFailure = ($_.Exception.Message -replace "\s+", " ").Trim()
    }
}

function Stop-WithHeartbeat {
    # A refusal is still an invocation that happened. It is written down first and
    # reported as a heartbeat failure with its reason, then it stops.
    #
    # Writing first is safe since 2026-09-19: `Write-RunLog` never throws (LC-1), so the
    # logged line cannot become the thing that swallows the refusal. Before the log has a
    # name the line goes to the fallback sink, which is what gives a refusal above the
    # log open a trace at all. This is why the wrapper no longer needs a second,
    # "logged" variant of this function -- the two used to differ only in whether they
    # dared to touch the log first.
    param([string]$Message)
    $null = Write-RunLog "refusing: $Message"
    $delivery = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode 1 -Note "watchdog wrapper refused: $Message$(Get-RunLogFailureClause)"
    throw "$Message (heartbeat $delivery)"
}

# Said out loud rather than left to the STATE_DIR read below to rediscover: with
# STATE_DIR set in the process environment that read never happens, and an
# unreadable .env would pass unnoticed on the one firing that should say so.
if ($watchdogUrlReadFailure) { Stop-WithHeartbeat "$RepoRoot\.env could not be read: $watchdogUrlReadFailure" }

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

# The run log is opened here rather than further down, because the assertions
# below can end the invocation and a refusal that leaves no line behind is worse
# than no assertion at all: `docs/P12-ACTIVATION-SPEC.md` step 6 uses "no line in
# the two wrapper logs" as its local discriminator for a task that was disabled
# rather than a network that failed, so a silently refusing wrapper forges
# exactly that signature. Every refusal below therefore logs its reason first.
$logPath = Join-Path $stateDir 'watchdog-run.log'

# From here the log has a name, so every line goes to it. Before this point
# `Write-RunLog` writes to the temporary fallback sink instead, which is how a refusal
# above the log open still leaves a trace (LC-7, S-LOG-7).
#
# Rotation is the module's (LC-8). This log never had any: it grew without bound while
# the cycle log rotated at 16 MiB, which is the kind of asymmetry two hand-kept copies
# produce.
Initialize-RunLog -Path $logPath -MaxBytes $MaxLogBytes

# The same three assertions the cycle wrapper makes, deliberately duplicated the
# way this file already duplicates the session-window helper -- see the header.
# They are here because *this* task is the 5-minute one: on the cycle wrapper's
# 15-minute weekday trigger the worst case between the condition breaking and
# somebody learning of it is a weekend, and on this one it is one firing.
#
# What is asserted and why: the certificate command guard derives directory
# identity, and that derivation is weakest on a directory that is not there, so a
# residual resting on "the declared long run exists" needed the condition to be
# observed rather than assumed (DECISIONS, 2026-09-18, R2-23). And the subject is
# checked on both sides, because the guard defends `longRunStateDir` from
# `config/deployment.json` while the wrappers run against `STATE_DIR`: when those
# two drift apart, each is quietly right about a different directory and the
# activation's contamination check passes over one the long run never touches
# (R2-18).
$declaredLongRun = $null
$deploymentStateFile = Join-Path $RepoRoot 'config\deployment.json'
try {
    $declaredLongRun = (Get-Content -LiteralPath $deploymentStateFile -Raw -ErrorAction Stop | ConvertFrom-Json).longRunStateDir
} catch {
    Stop-WithHeartbeat "config/deployment.json could not be read from $RepoRoot ($($_.Exception.Message)); it is the one place that says which directory this deployment defends."
}
if ([string]::IsNullOrWhiteSpace($declaredLongRun)) {
    Stop-WithHeartbeat "config/deployment.json names no longRunStateDir; the deployment declares no directory to defend."
}
foreach ($subject in @(@{ Name = 'STATE_DIR'; Path = $stateDir }, @{ Name = 'config/deployment.json longRunStateDir'; Path = $declaredLongRun })) {
    if ($subject.Path -notmatch '^[A-Za-z]:[\\/]') {
        Stop-WithHeartbeat "$($subject.Name) is not a drive-rooted local path ($($subject.Path)); the certificate guard cannot establish the physical identity of such a path, so the long run must not use one."
    }
    if (-not (Test-Path -LiteralPath $subject.Path -PathType Container)) {
        Stop-WithHeartbeat "$($subject.Name) does not exist ($($subject.Path)). This wrapper does not create it: a directory that vanished is a host problem to look at, not one to paper over by making a fresh empty one."
    }
}
if ([System.IO.Path]::GetFullPath($stateDir).TrimEnd('\','/') -ne [System.IO.Path]::GetFullPath($declaredLongRun).TrimEnd('\','/')) {
    Stop-WithHeartbeat "STATE_DIR ($stateDir) is not the long-run directory this deployment declares ($declaredLongRun)."
}

$todayEastern = Get-TodayEasternDate
$todayEasternKey = $todayEastern.ToString('yyyy-MM-dd')
# The weekday test is taken in New York, not in UTC: this wrapper's session
# window is Eastern throughout, and a UTC weekday disagrees with it for the
# hours either side of midnight. Inside today's registered trigger window the
# two always agreed, so this is a correctness repair with no measured bite.
$nowIsWeekday = $todayEastern.DayOfWeek -ne [System.DayOfWeek]::Saturday -and $todayEastern.DayOfWeek -ne [System.DayOfWeek]::Sunday
# The run log is opened further up, above the state-directory assertions, so
# that a refusal from them is on the record. See the comment there.

# A skip sends no heartbeat -- that is deliberate and unchanged: this task's trigger is
# Mon-Fri, and a closure day is a day the check is expected to be silent. But a skip
# whose line could not be written is not a silent day, it is an unrecorded firing, and
# that is the one signature step 6 of the activation reads as a disabled task. So the
# skip stays quiet only while its log took the line (LC-2).
function Exit-Skip {
    param([string]$Line)
    $null = Write-RunLog $Line
    $logClause = Get-RunLogFailureClause
    if ($logClause -eq '') { exit 0 }
    $delivery = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode 1 -Note "watchdog skipped this firing$logClause"
    $null = Write-RunLog "heartbeat: $delivery"
    exit 9
}

if (-not $nowIsWeekday) {
    Exit-Skip "skip: weekend (watchdog-cli.ts always treats its input as a trading day, so this wrapper is the only Mon-Fri gate)"
}

if (Test-MarketFullDayClosure -EasternDate $todayEastern) {
    # The same reason as the weekend, for the days a Mon-Fri test cannot see.
    # Without this the watchdog fences the epoch store and raises a standing
    # WATCHDOG_TAKEOVER halt on a market that never opened.
    Exit-Skip "skip: exchange closed on $todayEasternKey (stop-gap table in this wrapper; watchdog-cli.ts asserts isTradingDay unconditionally)"
}

if ($todayEasternKey -gt $MarketTableThroughDate) {
    # Loud rather than silent: past its coverage the table speaks for nothing, and
    # a wrapper that skipped here would remove the safety net instead of repairing
    # it. The run is meant to be over long before this line can be reached.
    $null = Write-RunLog "warn: $todayEasternKey is past the closure table's coverage ($MarketTableThroughDate); proceeding as if it were a normal trading day, which is what this wrapper did everywhere before the table existed"
}


$session = Get-TodaySessionUtc
$nowMs = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$opensAtMs = [System.DateTimeOffset]::new($session.OpensAtUtc, [System.TimeSpan]::Zero).ToUnixTimeMilliseconds()
$closesAtMs = [System.DateTimeOffset]::new($session.ClosesAtUtc, [System.TimeSpan]::Zero).ToUnixTimeMilliseconds()
$instanceId = "watchdog-$($env:COMPUTERNAME)-$PID"

$earlyCloseNote = if ($session.IsEarlyClose) { " earlyClose=13:00ET" } else { "" }
$null = Write-RunLog "run: instanceId=$instanceId nowMs=$nowMs opensAtMs=$opensAtMs closesAtMs=$closesAtMs deadManBoundMs=$deadManBoundMs stateDir=$stateDir$earlyCloseNote"

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
    $null = Write-RunLog "start refused: node at '$NodePath' is not runnable: $($nodeRuns.detail)"
    $delivery = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode 1 -Note "node cannot be started: $($nodeRuns.detail)$(Get-RunLogFailureClause)"
    $null = Write-RunLog "heartbeat: $delivery"
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
$output | ForEach-Object { $null = Write-RunLog "output: $_" }
$null = Write-RunLog "exit: $exitCode"

# The watchdog's own heartbeat, on its own endpoint.
#
# Without it, both other checks stay green while the watchdog alone is dead or
# disabled: liveness comes from the cycle wrapper, and readiness from the state
# files, so a silent watchdog looks exactly like a healthy one. That is the
# safety net whose failure is least visible, because it only ever acts when
# something else has already gone wrong.
#
# ONE ping per firing, sent after everything is known (LC-4). It used to be sent
# before the last log line, so a firing whose final write failed emitted a green ping
# and then a red one for the same event. The verdict is failure when the child failed
# OR when this firing could not write its log: the child's own exit code stays in the
# body either way, so the two facts travel together instead of displacing each other
# (LC-2, LC-3).
$logClause = Get-RunLogFailureClause
$verdict = if ($exitCode -ne 0) { $exitCode } elseif ($logClause -ne '') { 1 } else { 0 }
$heartbeat = Send-WatchdogHeartbeat -BaseUrl $watchdogUrl -ExitCode $verdict -Note "watchdog exit $exitCode$logClause"
# Delivery evidence, written after the ping by necessity: a line about the ping cannot
# precede it. Its own failure is the one log failure that cannot reach the body it
# describes -- it travels in the exit code and in the fallback sink instead.
$null = Write-RunLog "heartbeat: $heartbeat"

# The child's verdict is the wrapper's when the child failed. When it did not, a
# firing whose log could not be written still exits non-zero, so the task history
# carries what the log does not: 9 means "the firing completed, its run log did not".
if ($exitCode -ne 0) { exit $exitCode }
if ((Get-RunLogStatus).Failed) { exit 9 }
exit 0
