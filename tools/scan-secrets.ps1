<#
.SYNOPSIS
    Scans the entire git history and the current working tree for
    secret-shaped content, without ever printing a matched value.

.DESCRIPTION
    History scan: walks `git log -p --all` line by line, tracking the
    current commit hash and the current file path as it crosses `commit`
    and `diff --git` headers, and tests every diff line (context, added, and
    removed) against a fixed set of secret-shape patterns.

    Working tree scan: every path `git ls-files` reports (tracked files
    only -- exactly what could ever be pushed), read as text and tested
    against the same patterns.

    For every match, only the commit hash (blank for the working-tree scan),
    the file path, and the pattern name are printed -- never the line, never
    the matched substring. A summary with per-pattern counts follows.

    Patterns (see $Patterns below): Alpaca paper/live key IDs, an
    Alpaca-style secret key following the word SECRET, Anthropic API keys,
    a populated CLAUDE_CODE_OAUTH_TOKEN assignment, healthchecks.io ping
    URLs, generic AWS_* assignments, and GitHub personal-access tokens.
    These are shape-based and intentionally broad (recall over precision);
    every hit still needs a human look at the named commit/file since only
    metadata is printed, never content.

.PARAMETER HistoryOnly
    Skip the working-tree scan.

.PARAMETER WorkingTreeOnly
    Skip the history scan.

.OUTPUTS
    Exit code 0 = no hits in the scanned scope(s), 1 = at least one hit,
    2 = usage/environment error (not a git repo, git not found, etc).

.EXAMPLE
    .\tools\scan-secrets.ps1
    Full scan: history + working tree.
#>
[CmdletBinding()]
param(
    [switch]$HistoryOnly,
    [switch]$WorkingTreeOnly
)

$ErrorActionPreference = 'Stop'

if ($HistoryOnly -and $WorkingTreeOnly) {
    Write-Error 'Pass at most one of -HistoryOnly / -WorkingTreeOnly.'
    exit 2
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCommand) {
    Write-Error 'git was not found on PATH.'
    exit 2
}

$repoRoot = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
    Write-Error 'Not inside a git repository.'
    exit 2
}
$repoRoot = $repoRoot.Trim() -replace '/', '\'
Set-Location -LiteralPath $repoRoot

# Ordered so the summary prints in a stable, meaningful sequence.
$Patterns = [ordered]@{
    # Alpaca paper-account key IDs start PK, live-account key IDs start AK.
    'AlpacaKeyIdPaper' = 'PK[A-Z0-9]{16,}'
    'AlpacaKeyIdLive'  = 'AK[A-Z0-9]{16,}'
    # An Alpaca secret key is ~40 base64-ish characters; catch it wherever it
    # follows the literal word SECRET (env var name or a JSON/log field).
    'AlpacaSecretKey'  = '(?i)SECRET\w*\s*[:=]\s*[A-Za-z0-9/+=]{40}'
    'AnthropicKey'     = 'sk-ant-[A-Za-z0-9_-]{20,}'
    # Only a *populated* assignment counts -- 'CLAUDE_CODE_OAUTH_TOKEN=' with
    # nothing after it (as in .env.example) is not a leak.
    'ClaudeOAuthToken' = 'CLAUDE_CODE_OAUTH_TOKEN\s*=\s*\S+'
    'HealthchecksUrl'  = 'hc-ping\.com/'
    'AwsToken'         = 'AWS_[A-Z0-9_]*\s*[:=]\s*\S+'
    'GithubToken'      = 'ghp_[A-Za-z0-9]{36,}'
}

# commit -> file -> pattern -> hit count, so repeats collapse to one summary
# line instead of one per matching diff line.
$hits = New-Object System.Collections.Generic.List[psobject]

function Test-Line {
    # -cmatch, not -match: PowerShell's comparison operators are
    # case-INSENSITIVE by default (unlike .NET regex / -cmatch), which would
    # silently turn every deliberately-uppercase character class below
    # ([A-Z0-9]) into [A-Za-z0-9] and flood the Alpaca key-shape patterns
    # with matches against ordinary lowercase/mixed-case base64 hashes.
    # AlpacaSecretKey's inline (?i) still works fine under -cmatch -- inline
    # regex modifiers are independent of the PowerShell operator's own
    # case-sensitivity flag.
    param([string]$Line, [string]$Commit, [string]$FilePath)
    foreach ($name in $Patterns.Keys) {
        if ($Line -cmatch $Patterns[$name]) {
            $hits.Add([pscustomobject]@{ Commit = $Commit; Path = $FilePath; Pattern = $name })
        }
    }
}

# ---------------------------------------------------------------------------
# History scan: git log -p --all
# ---------------------------------------------------------------------------
if (-not $WorkingTreeOnly) {
    Write-Host 'Scanning full history (git log -p --all) ...'
    $commitHeader = '^commit ([0-9a-f]{40})'
    $diffHeader = '^diff --git a/(.+) b/(.+)$'
    $currentCommit = $null
    $currentFile = $null
    $lineCount = 0
    # -Encoding is deliberately not forced: history may contain non-UTF8
    # bytes from old commits; let git's own byte stream survive as best it can.
    & git log -p --all --no-color | ForEach-Object {
        $lineCount++
        $line = $_
        if ($line -match $commitHeader) {
            $currentCommit = $Matches[1]
            $currentFile = $null
            return
        }
        if ($line -match $diffHeader) {
            $currentFile = $Matches[2]
            return
        }
        if ($null -eq $currentCommit) { return }
        $filePathForLine = if ($null -eq $currentFile) { '(unknown path)' } else { $currentFile }
        Test-Line -Line $line -Commit $currentCommit -FilePath $filePathForLine
    }
    Write-Host "History scan complete: $lineCount diff lines examined."
}

# ---------------------------------------------------------------------------
# Working tree scan: git ls-files
# ---------------------------------------------------------------------------
if (-not $HistoryOnly) {
    Write-Host 'Scanning working tree (git ls-files) ...'
    $trackedFiles = & git ls-files
    $fileCount = 0
    foreach ($relativePath in $trackedFiles) {
        $fileCount++
        $fullPath = Join-Path $repoRoot $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { continue }
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        # Skip anything that looks binary (a NUL byte in the first 8000 bytes)
        # rather than risk a garbled false match on binary content.
        $sampleLength = [Math]::Min(8000, $bytes.Length)
        $looksBinary = $false
        for ($i = 0; $i -lt $sampleLength; $i++) {
            if ($bytes[$i] -eq 0) { $looksBinary = $true; break }
        }
        if ($looksBinary) { continue }
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        foreach ($line in ($text -split "`r?`n")) {
            Test-Line -Line $line -Commit '' -FilePath $relativePath
        }
    }
    Write-Host "Working tree scan complete: $fileCount tracked files examined."
}

# ---------------------------------------------------------------------------
# Report: commit + path + pattern only, then per-pattern counts
# ---------------------------------------------------------------------------
Write-Host ''
if ($hits.Count -eq 0) {
    Write-Host 'No hits.'
    exit 0
}

Write-Host "$($hits.Count) hit(s):"
$hits | Sort-Object Commit, Path, Pattern -Unique | ForEach-Object {
    $where = if ([string]::IsNullOrEmpty($_.Commit)) { '(working tree)' } else { $_.Commit }
    Write-Host "$where`t$($_.Path)`t$($_.Pattern)"
}

Write-Host ''
Write-Host 'Counts by pattern:'
$hits | Group-Object Pattern | Sort-Object Name | ForEach-Object {
    Write-Host "  $($_.Name): $($_.Count)"
}

exit 1
