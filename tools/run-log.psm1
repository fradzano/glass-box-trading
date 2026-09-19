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
    LC-5  A transient lock is tolerated: up to four attempts, ~450 ms in total, which
          is below one second and far below the five-minute firing interval.
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
        $null = Write-RunLogFallback -Line $line -State $null
        return $false
    }

    $attempt = 0
    $lastError = $null
    while ($attempt -lt $script:RunLog.RetryCount) {
        $attempt++
        try {
            Add-Content -LiteralPath $script:RunLog.Path -Value $line -Encoding utf8 -ErrorAction Stop
            Write-Verbose $line
            return $true
        } catch {
            $lastError = $_
            if ($attempt -lt $script:RunLog.RetryCount -and $script:RunLog.RetryDelayMilliseconds -gt 0) {
                Start-Sleep -Milliseconds $script:RunLog.RetryDelayMilliseconds
            }
        }
    }

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
    <# LC-7. Best effort by definition: it is the sink for the case where the sink failed. #>
    param([string]$Line, $State)

    $candidates = @()
    if ($null -ne $State) { $candidates += $State.Fallback }
    $temp = $env:TEMP
    if (-not [string]::IsNullOrWhiteSpace($temp)) {
        $leaf = if ($null -ne $State) { [System.IO.Path]::GetFileName($State.Path) } else { 'wrapper-run.log' }
        $candidates += (Join-Path $temp "glass-box-$leaf.fallback")
    }

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
        return @{ Initialized = $false; Failed = $true; Degraded = $true; FirstFailure = 'the run log was never opened'; FirstLostLine = $null; LostLines = 0; FallbackUsed = $null; Path = $null; Rotated = $false; RotationFailure = $null }
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
    if ($null -ne $status.RotationFailure) {
        $clause += "; the run log could not be rotated ($($status.RotationFailure)), so '$($status.Path)' is growing past its bound"
    }
    return $clause
}

Export-ModuleMember -Function Initialize-RunLog, Write-RunLog, Get-RunLogStatus, Get-RunLogFailureClause
