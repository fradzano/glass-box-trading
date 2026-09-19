<#
.SYNOPSIS
    The run log both scheduled-task wrappers write, in one place.

.DESCRIPTION
    `tools/cycle-run.ps1` and `tools/watchdog-run.ps1` each used to carry their own
    hand-synchronised copy of this logic. Five findings of one evening (R3-13 to R3-17)
    came from that one cause in five guises, so the copies are gone and this module is
    the single implementation. It is bound by `docs/P12-STOP-AND-LOG-CONTRACTS.md`,
    part II, and every clause below cites the one it serves.

    LC-1  The log never stops the safety work. No function here throws. A write that
          cannot be made is remembered and reported; it never ends the firing. The
          watchdog is the one component that only acts when something else has already
          gone wrong, and a locked diagnostic file must not be able to disable it.
    LC-5  A transient lock is tolerated: up to four attempts. Measured end to end,
          including the failing writes themselves, that is 550-650 ms per lost line --
          not the ~450 ms the sleeps alone suggest, and the difference is the four
          `Add-Content` attempts. Bounded per line; the per-firing bound is LC-11's.
    LC-6  Every write asks for `-ErrorAction Stop` itself, so the failure branch does not
          depend on the script-wide $ErrorActionPreference at the call site.
    LC-7  What the primary log cannot take goes to a fallback sink beside it, and to the
          per-user temporary directory when that fails too, so that "no line anywhere"
          keeps meaning "no firing happened".
    LC-8  Rotation lives here as well, so both logs rotate on the same bound. The
          watchdog log had none.

    The caller asks `Get-RunLogStatus` when it is about to report, and builds its
    heartbeat body and its exit code from what it finds there. Nothing in this module
    sends anything: the wrappers own their endpoints.

    This file is hashed by the activation's step 0 alongside both wrappers
    (`ops/activation/core/types.ts`, WrapperName), so a change to it is as visible to
    the activation as a change to either script.
#>

Set-StrictMode -Version 2.0

$script:RunLog = $null

<#
  What happened **before** the log had a name (D-2, 2026-09-20).

  Six refusals in the watchdog and five in the cycle wrapper stand above
  `Initialize-RunLog` — an unbuilt `dist`, an unreadable `policy.json`, a missing
  STATE_DIR. Their lines go to the temporary sink, and the status used to report
  `lines lost: 0`, `no fallback sink took it either` and no file name at all, while the
  sink had in fact taken the line. Three false statements in the one alert an operator
  reads at 03:00, and the same generator as Part I's SC-6: a sentence asserted from what
  was owed rather than derived from what happened.
#>
$script:PreOpen = @{ LostLines = 0; FirstLostLine = $null; FallbackUsed = $null; Name = 'wrapper-run.log' }

function Set-RunLogIdentity {
    <#
    .SYNOPSIS
        Names the wrapper before its log has a path, so that a refusal above the log open
        lands in a sink an operator can attribute (D-7).

        Both wrappers used to share one fixed name in the temporary directory, so a cycle
        refusal and a watchdog refusal interleaved in one file with nothing to tell them
        apart -- and the lines carry no wrapper name of their own.
    #>
    param([Parameter(Mandatory = $true)][string]$Name)
    $script:PreOpen.Name = $Name
}

function Initialize-RunLog {
    <#
    .SYNOPSIS
        Names the log for this firing, rotates it if it has grown past its bound, and
        resets the failure memory. Never throws.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$MaxBytes = 16777216,
        [int]$RetryCount = 4,
        [int]$RetryDelayMilliseconds = 150
    )

    $script:RunLog = @{
        Path                   = $Path
        Fallback               = "$Path.fallback"
        MaxBytes               = $MaxBytes
        RetryCount             = [Math]::Max(1, $RetryCount)
        RetryDelayMilliseconds = [Math]::Max(0, $RetryDelayMilliseconds)
        Failed                 = $false
        FirstFailure           = $null
        FirstLostLine          = $null
        LostLines              = 0
        FallbackUsed           = $null
        Rotated                = $false
        RotationFailure        = $null
        # LC-11: the retry budget is per line, and a firing that loses many lines pays it
        # for every one of them. Measured: 200 lost lines cost 98 seconds against a
        # five-minute interval, and the watchdog task is killed at six minutes -- after the
        # fence and the halt, before the verdict ping, which is the silence this contract
        # exists to prevent. Once the firing has spent this much on retries it stops
        # retrying and keeps logging single-attempt, so the lines still go somewhere and the
        # firing still ends on its own terms.
        RetryBudgetMs          = 30000
        RetrySpentMs           = 0
        RetryBudgetExhausted   = $false
    }

    # One generation is kept. Losing an older diagnostic line is acceptable; losing the
    # disk is not, and the journal carries what matters either way. A rotation that fails
    # is recorded and does not stop the firing -- the log simply keeps growing, which is
    # the lesser of the two.
    if ($MaxBytes -gt 0) {
        try {
            if (Test-Path -LiteralPath $Path) {
                $existing = Get-Item -LiteralPath $Path -ErrorAction Stop
                if ($existing.Length -gt $MaxBytes) {
                    Move-Item -LiteralPath $Path -Destination "$Path.1" -Force -ErrorAction Stop
                    $script:RunLog.Rotated = $true
                }
            }
        } catch {
            $script:RunLog.RotationFailure = (Flatten-RunLogText $_.Exception.Message)
        }
    }
}

function Flatten-RunLogText {
    <# One line, bounded: this text goes into a log line and into a ping body. #>
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $flat = ($Text -replace "\s+", " ").Trim()
    if ($flat.Length -gt 200) { $flat = $flat.Substring(0, 200) }
    return $flat
}

function Write-RunLog {
    <#
    .SYNOPSIS
        Appends one line. Returns $true when the line landed in the primary log,
        $false when it did not. Never throws (LC-1).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Message)

    $line = "$([System.DateTime]::UtcNow.ToString('o')) $Message"

    # A call before Initialize-RunLog is a refusal above the log open (S-LOG-7): there is
    # no log path yet, and the line would have been lost entirely. It goes to the
    # temporary sink so that even that refusal leaves a trace.
    if ($null -eq $script:RunLog) {
        $script:PreOpen.LostLines++
        if ($null -eq $script:PreOpen.FirstLostLine) { $script:PreOpen.FirstLostLine = (Flatten-RunLogText $Message) }
        $null = Write-RunLogFallback -Line $line -State $null
        return $false
    }

    $attempt = 0
    $lastError = $null
    $startedAt = [System.Diagnostics.Stopwatch]::StartNew()
    $allowed = if ($script:RunLog.RetrySpentMs -ge $script:RunLog.RetryBudgetMs) { 1 } else { $script:RunLog.RetryCount }
    while ($attempt -lt $allowed) {
        $attempt++
        try {
            Add-Content -LiteralPath $script:RunLog.Path -Value $line -Encoding utf8 -ErrorAction Stop
            Write-Verbose $line
            return $true
        } catch {
            $lastError = $_
            if ($attempt -lt $allowed -and $script:RunLog.RetryDelayMilliseconds -gt 0) {
                Start-Sleep -Milliseconds $script:RunLog.RetryDelayMilliseconds
            }
        }
    }

    $startedAt.Stop()
    $script:RunLog.RetrySpentMs += $startedAt.ElapsedMilliseconds
    if ($script:RunLog.RetrySpentMs -ge $script:RunLog.RetryBudgetMs) { $script:RunLog.RetryBudgetExhausted = $true }
    $detail = Flatten-RunLogText $lastError.Exception.Message
    $script:RunLog.LostLines++
    if (-not $script:RunLog.Failed) {
        $script:RunLog.Failed = $true
        $script:RunLog.FirstFailure = "'$($script:RunLog.Path)' after $attempt attempt(s): $detail"
        $script:RunLog.FirstLostLine = (Flatten-RunLogText $Message)
    }
    $null = Write-RunLogFallback -Line $line -State $script:RunLog
    return $false
}

function Write-RunLogFallback {
    <#
      LC-7. Best effort by definition: it is the sink for the case where the sink failed.

      **Nothing in here may throw** (LC-1, D-1, measured 2026-09-20). `Join-Path` consults
      the PowerShell provider and raises `DriveNotFoundException` when `$env:TEMP` names a
      drive letter that does not exist in the session — an S4U logon with a mapped or
      substituted TEMP is the realistic shape. That call used to sit outside the per-
      candidate `try`, and under the script-wide `Stop` preference the error was terminating:
      it escaped `Write-RunLog`, whose own header promises it never throws, and the watchdog
      exited 1 having never started its child. Measured: zero pings, no log line, the dead
      man did not assess, fence or halt. The path is built with
      `[System.IO.Path]::Combine`, which touches no provider, and every candidate is
      produced inside its own guard.
    #>
    param([string]$Line, $State)

    $candidates = New-Object System.Collections.ArrayList
    try {
        if ($null -ne $State) { $null = $candidates.Add($State.Fallback) }
    } catch { }
    try {
        $temp = $env:TEMP
        if (-not [string]::IsNullOrWhiteSpace($temp)) {
            $leaf = if ($null -ne $State) { [System.IO.Path]::GetFileName($State.Path) } else { $script:PreOpen.Name }
            # The name carries the wrapper's own log name, so two wrappers writing into one
            # temporary directory stay attributable (D-7).
            $null = $candidates.Add([System.IO.Path]::Combine($temp, "glass-box-$leaf.fallback"))
        }
    } catch { }

    foreach ($candidate in $candidates) {
        try {
            # The sink for the case where the sink failed still may not grow without end:
            # it is the file nobody is watching, on the deployment that runs unattended for
            # a quarter (LC-10). One generation, the same bound, and a failure here is
            # simply the next candidate's turn.
            $bound = if ($null -ne $State -and $State.MaxBytes -gt 0) { $State.MaxBytes } else { 16777216 }
            if (Test-Path -LiteralPath $candidate) {
                $existingFallback = Get-Item -LiteralPath $candidate -ErrorAction Stop
                if ($existingFallback.Length -gt $bound) { Move-Item -LiteralPath $candidate -Destination "$candidate.1" -Force -ErrorAction Stop }
            }
            Add-Content -LiteralPath $candidate -Value $Line -Encoding utf8 -ErrorAction Stop
            if ($null -ne $State -and $null -eq $State.FallbackUsed) { $State.FallbackUsed = $candidate }
            if ($null -eq $State) { $script:PreOpen.FallbackUsed = $candidate }
            return $true
        } catch {
            continue
        }
    }
    return $false
}

function Get-RunLogStatus {
    <#
    .SYNOPSIS
        What the caller needs to report: whether the log took this firing's lines, and
        what went wrong if it did not.
    #>
    if ($null -eq $script:RunLog) {
        return @{
            Initialized     = $false
            Failed          = $true
            Degraded        = $true
            FirstFailure    = 'the run log was never opened -- this refusal happened above the point where its name is known'
            FirstLostLine   = $script:PreOpen.FirstLostLine
            LostLines       = $script:PreOpen.LostLines
            FallbackUsed    = $script:PreOpen.FallbackUsed
            Path            = $null
            Rotated         = $false
            RotationFailure = $null
        }
    }
    return @{
        Initialized     = $true
        Failed          = $script:RunLog.Failed
        # One question for the caller: is this firing's diagnostic record sound? A log
        # that could not be written and a log that could not be rotated are both answers
        # of "no", and both have to reach the verdict (LC-10).
        Degraded        = ($script:RunLog.Failed -or $null -ne $script:RunLog.RotationFailure)
        FirstFailure    = $script:RunLog.FirstFailure
        FirstLostLine   = $script:RunLog.FirstLostLine
        LostLines       = $script:RunLog.LostLines
        FallbackUsed    = $script:RunLog.FallbackUsed
        Path            = $script:RunLog.Path
        Rotated         = $script:RunLog.Rotated
        RotationFailure = $script:RunLog.RotationFailure
        RetrySpentMs    = $script:RunLog.RetrySpentMs
        BudgetExhausted = $script:RunLog.RetryBudgetExhausted
    }
}

function Get-RunLogFailureClause {
    <#
    .SYNOPSIS
        The clause a heartbeat body carries when the log is not doing its job, and the
        empty string when it is (LC-2). It is built from the status and from nothing else,
        so the sentence and the fact cannot drift apart.

        A failed ROTATION belongs here too (LC-10, R4-04). It used to be recorded in the
        status and consumed by nobody: measured with the `.1` target exclusively locked and
        the primary log writable, rotation failed, the next write succeeded, the verdict
        stayed green, and the log grew past its bound in silence. Over an unattended
        quarter the bound is the only thing that keeps this storage finite.
    #>
    $status = Get-RunLogStatus
    $clause = ''
    if ($status.Failed) {
        $where = if ($null -ne $status.FallbackUsed) { "; written to '$($status.FallbackUsed)' instead" } else { '; no fallback sink took it either' }
        $lost = if ($null -ne $status.FirstLostLine) { "; first lost line: $($status.FirstLostLine)" } else { '' }
        $clause += "; the run log could not be written ($($status.FirstFailure)); lines lost: $($status.LostLines)$lost$where"
    }
    if ($status.ContainsKey('BudgetExhausted') -and $status.BudgetExhausted) {
        $clause += "; this firing spent its whole retry budget on a log it could not write ($($status.RetrySpentMs) ms) and stopped retrying"
    }
    if ($null -ne $status.RotationFailure) {
        $clause += "; the run log could not be rotated ($($status.RotationFailure)), so '$($status.Path)' is growing past its bound"
    }
    return $clause
}

Export-ModuleMember -Function Set-RunLogIdentity, Initialize-RunLog, Write-RunLog, Get-RunLogStatus, Get-RunLogFailureClause
