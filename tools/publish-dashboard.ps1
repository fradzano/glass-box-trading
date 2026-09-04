<#
.SYNOPSIS
    Renders the judge-facing dashboard from a COPY of the competition journal
    with the frozen build, without touching the S-ARM-01 runtime digest.

.DESCRIPTION
    The frozen build has no production caller for the publisher and no git or
    Vercel port (DECISIONS.md, R35 C4). This wrapper is the owner's
    digest-neutral entry point: it runs `node submission/publish/render-site.mjs`,
    which loads the BUILT modules under dist/ (never src/), reads the journal
    copy, and writes

      <OutDir>\site                  the renderer's page set, byte-for-byte
      <OutDir>\deploy                the host-safe deploy tree (R37 C-3: safe
                                     revision directory names, root-absolute
                                     history-pin hrefs) plus vercel.json
      <OutDir>\publish-manifest.json routes and the probe meta per route,
                                     consumed by tools\probe-dashboard.ps1

    It NEVER builds, never runs npm, never reads .env, and refuses an OutDir
    inside the checkout (except under artifacts\, which the digest walk skips).
    The script it calls refuses a journal that sits beside a live STATE_DIR
    marker (epoch.json, pings.log, halt.json, quarantine\): copy the journal
    first, never point this at the original. The deploy itself is a manual
    step; see README.md "Publish the judge-facing dashboard".

.PARAMETER JournalCopy
    Path to a COPY of the competition journal (journal.jsonl). Required.

.PARAMETER OutDir
    Output directory outside the checkout (or under <RepoRoot>\artifacts\). Required.

.PARAMETER AccountId
    The submitted competition broker account id the page must show. Required.
    It is the projection's expectation, not read from the journal.

.PARAMETER PresentationCutoff
    Optional ISO-8601 instant; pins the immutable presentation route
    (SUBMISSION-SPEC §4.1).

.PARAMETER DeadlineCutoff
    Optional ISO-8601 instant; pins the immutable deadline route.

.PARAMETER JournalRevisionUrl
    Optional public URL of the committed journal revision, shown on the page.

.PARAMETER RepoRoot
    The checkout whose dist\, config\policy.json and assets\ are READ. Defaults
    to the parent of this script's directory.

.PARAMETER NodePath
    Path to node.exe. Defaults to the first `node` on PATH.

.EXAMPLE
    Copy-Item C:\Users\felix\glass-box-state\competition-2\journal.jsonl C:\Users\felix\gbt-publish\journal-copy.jsonl
    tools\publish-dashboard.ps1 -JournalCopy C:\Users\felix\gbt-publish\journal-copy.jsonl -OutDir C:\Users\felix\gbt-publish\out -AccountId PA376WIK2ATL
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$JournalCopy,

    [Parameter(Mandatory = $true)]
    [string]$OutDir,

    [Parameter(Mandatory = $true)]
    [string]$AccountId,

    [string]$PresentationCutoff,

    [string]$DeadlineCutoff,

    [string]$JournalRevisionUrl,

    [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),

    [string]$NodePath
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $RepoRoot)) { throw "RepoRoot '$RepoRoot' does not exist." }
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\')

if ([string]::IsNullOrWhiteSpace($NodePath)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) { throw "node was not found on PATH; pass -NodePath." }
    $NodePath = $nodeCommand.Source
}
if (-not (Test-Path -LiteralPath $NodePath)) { throw "NodePath '$NodePath' does not exist." }

$renderScript = Join-Path $RepoRoot 'submission\publish\render-site.mjs'
if (-not (Test-Path -LiteralPath $renderScript)) { throw "'$renderScript' is missing." }
$publisherModule = Join-Path $RepoRoot 'dist\shell\publisher.js'
if (-not (Test-Path -LiteralPath $publisherModule)) {
    throw "'$publisherModule' is missing. This script never builds: dist\ is digest material. Build in a separate worktree and pass that checkout as -RepoRoot if the operating checkout has no dist\."
}

if (-not (Test-Path -LiteralPath $JournalCopy)) { throw "JournalCopy '$JournalCopy' does not exist." }
$JournalCopy = (Resolve-Path -LiteralPath $JournalCopy).Path

$outFull = [System.IO.Path]::GetFullPath($OutDir).TrimEnd('\')
$repoPrefix = $RepoRoot + '\'
$artifactsPrefix = (Join-Path $RepoRoot 'artifacts') + '\'
if (($outFull + '\').StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase) -and -not ($outFull + '\').StartsWith($artifactsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutDir '$outFull' lies inside the checkout '$RepoRoot'. Use a directory outside the checkout (or under artifacts\, which git ignores and the digest walk skips)."
}

$arguments = @($renderScript, '--repo-root', $RepoRoot, '--journal', $JournalCopy, '--out', $outFull, '--account-id', $AccountId)
if (-not [string]::IsNullOrWhiteSpace($PresentationCutoff)) { $arguments += @('--presentation-cutoff', $PresentationCutoff) }
if (-not [string]::IsNullOrWhiteSpace($DeadlineCutoff)) { $arguments += @('--deadline-cutoff', $DeadlineCutoff) }
if (-not [string]::IsNullOrWhiteSpace($JournalRevisionUrl)) { $arguments += @('--journal-revision-url', $JournalRevisionUrl) }

Write-Host "render: $NodePath $($arguments -join ' ')"
& $NodePath @arguments
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    Write-Error "render-site.mjs exited with $exitCode; nothing was deployed."
    exit $exitCode
}

$manifestPath = Join-Path $outFull 'publish-manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Write-Host ''
Write-Host "journal revision : $($manifest.journalRevision)  (entries $($manifest.entryCount), last seq $($manifest.lastSeq), latest cutoff $($manifest.latestCutoffAt))"
Write-Host "account          : $($manifest.accountId)"
Write-Host "discrepancies    : $($manifest.discrepancies.Count)"
foreach ($route in $manifest.routes) { Write-Host "route            : $($route.kind.PadRight(12)) $($route.url)  (cutoff $($route.cutoffAt))" }
Write-Host ''
Write-Host 'Next (manual, README.md "Publish the judge-facing dashboard"):'
Write-Host "  1. Open $($manifest.deployDir)\index.html in a browser and read it as a judge would."
Write-Host "  2. cd $($manifest.deployDir); vercel deploy --prod --skip-domain   (candidate URL, not yet the stable alias)"
Write-Host "  3. tools\probe-dashboard.ps1 -BaseUrl <candidate URL> -Manifest $manifestPath"
Write-Host '  4. vercel promote <candidate URL>; probe the stable alias the same way; keep both receipts.'
exit 0
