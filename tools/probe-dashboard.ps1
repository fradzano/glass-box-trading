<#
.SYNOPSIS
    Anonymous probe of a deployed dashboard against its publish manifest
    (SUB-09 preflight, SUB-11 candidate acceptance, R37 C-3), by hand.

.DESCRIPTION
    The frozen build's publisher probes a candidate through a DeployPort that
    never landed (DECISIONS.md, R35 C4). This script is that probe, run by
    the owner over the manifest tools\publish-dashboard.ps1 wrote:

      * every HTML route in the manifest answers 200 without credentials and
        carries exactly the `glass-box-*` meta the manifest expects (journal
        revision, evidence cutoff and kind, last-updated, last seq) — the
        same contract `verifyProbe` in src/core/publish.ts enforces;
      * every JSON route answers 200, parses, and names the same revision;
      * R37 C-3: no served page carries a site-root-relative `revisions/`
        href, every root-absolute `/revisions/...` href it carries answers
        200 — checked on the nested immutable route, not only at the root —
        and the renderer's percent-encoded spelling of the route is NOT what
        is served (the deploy tree carries the safe spelling);
      * a redirect, an authentication wall (Vercel Deployment Protection) or
        a non-200 fails the probe.

    A receipt `probe-<utc>.json` is written beside the manifest (SUB-11:
    deployment receipts live outside the trading journal). Exit code 0 only
    when every check passed. Nothing here mutates the deployment.

.PARAMETER BaseUrl
    The deployment origin to probe, e.g. https://glass-box-trading-abc123.vercel.app
    (candidate) or the stable alias. Required.

.PARAMETER Manifest
    Path to publish-manifest.json from tools\publish-dashboard.ps1. Required.

.EXAMPLE
    tools\probe-dashboard.ps1 -BaseUrl https://glass-box-trading-abc123.vercel.app -Manifest C:\Users\felix\gbt-publish\out\publish-manifest.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$Manifest
)

$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

if (-not (Test-Path -LiteralPath $Manifest)) { throw "Manifest '$Manifest' does not exist." }
$manifestData = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$origin = $BaseUrl.TrimEnd('/')
$checks = New-Object System.Collections.Generic.List[object]

function Get-Anonymous {
    # One anonymous GET: no cookies, no credentials, no redirect following.
    # Returns status, body and the final URL; a non-2xx is returned, not thrown.
    param([string]$Url)
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -MaximumRedirection 0 -WebSession $session -UserAgent 'glass-box-trading-probe' -ErrorAction Stop
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = [string]$response.Content; Location = $null }
    } catch [System.Net.WebException] {
        $webResponse = $_.Exception.Response
        if ($null -eq $webResponse) { return [pscustomobject]@{ Status = 0; Body = $_.Exception.Message; Location = $null } }
        $status = [int]$webResponse.StatusCode
        $location = $webResponse.Headers['Location']
        $reader = New-Object System.IO.StreamReader($webResponse.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
        return [pscustomobject]@{ Status = $status; Body = $body; Location = $location }
    }
}

function Add-Check {
    param([string]$Name, [bool]$Ok, [string]$Detail)
    $checks.Add([pscustomobject]@{ check = $Name; ok = $Ok; detail = $Detail })
    $marker = if ($Ok) { 'PASS' } else { 'FAIL' }
    Write-Host "[$marker] $Name -- $Detail"
}

function ConvertFrom-HtmlAttribute {
    param([string]$Value)
    return $Value.Replace('&amp;', '&').Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&#39;', "'")
}

function Read-GlassBoxMeta {
    param([string]$Html)
    $meta = @{}
    foreach ($match in [regex]::Matches($Html, '<meta name="(glass-box-[a-z-]+)" content="([^"]*)">')) {
        $meta[$match.Groups[1].Value] = ConvertFrom-HtmlAttribute $match.Groups[2].Value
    }
    return $meta
}

$fetched = @{}
function Get-Cached {
    param([string]$Url)
    if (-not $fetched.ContainsKey($Url)) { $fetched[$Url] = Get-Anonymous -Url $Url }
    return $fetched[$Url]
}

# ---- HTML routes: status, no auth wall, exact probe meta ----
foreach ($route in $manifestData.routes) {
    $url = $origin + $route.url
    $result = Get-Cached -Url $url
    $statusOk = $result.Status -eq 200
    $statusDetail = if ($null -ne $result.Location) { "HTTP $($result.Status) redirect to $($result.Location) (auth wall or alias not ready)" } else { "HTTP $($result.Status)" }
    Add-Check -Name "route $($route.kind) $($route.url) answers 200 anonymously" -Ok $statusOk -Detail $statusDetail
    if (-not $statusOk) { continue }
    $meta = Read-GlassBoxMeta -Html $result.Body
    foreach ($property in $route.expectedMeta.PSObject.Properties) {
        $actual = $meta[$property.Name]
        $ok = ($null -ne $actual) -and ($actual -eq $property.Value)
        $detail = if ($null -eq $actual) { "META_MISSING: $($property.Name)" } elseif ($ok) { "$($property.Name)=$actual" } else { "META_MISMATCH: $($property.Name) expected $($property.Value) got $actual" }
        Add-Check -Name "route $($route.kind) meta $($property.Name)" -Ok $ok -Detail $detail
    }

    # ---- R37 C-3 on every served page, nested routes included ----
    $relativePins = [regex]::Matches($result.Body, 'href="revisions/[^"]*"')
    Add-Check -Name "route $($route.kind) carries no site-root-relative revisions/ href" -Ok ($relativePins.Count -eq 0) -Detail "$($relativePins.Count) relative href(s)"
    $absolutePins = @([regex]::Matches($result.Body, 'href="(/revisions/[^"]*)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
    foreach ($pin in $absolutePins) {
        $pinResult = Get-Cached -Url ($origin + $pin)
        Add-Check -Name "route $($route.kind) pin $pin resolves" -Ok ($pinResult.Status -eq 200) -Detail "HTTP $($pinResult.Status)"
        $encodedForm = $pin -replace '^/revisions/sha256-', '/revisions/sha256%3A'
        if ($encodedForm -ne $pin) {
            $encodedResult = Get-Cached -Url ($origin + $encodedForm + 'index.html')
            Add-Check -Name "route $($route.kind) renderer spelling $encodedForm is not what is served" -Ok ($encodedResult.Status -ne 200) -Detail "HTTP $($encodedResult.Status) (a 200 here would mean the host serves the percent-encoded directory, which the deploy tree does not contain)"
        }
    }
}

# ---- JSON routes: status, parse, revision ----
foreach ($jsonRoute in $manifestData.jsonRoutes) {
    $url = $origin + $jsonRoute
    $result = Get-Cached -Url $url
    $ok = $result.Status -eq 200
    $detail = "HTTP $($result.Status)"
    if ($ok) {
        try {
            $projection = $result.Body | ConvertFrom-Json
            $ok = $projection.journalRevision -eq $manifestData.journalRevision
            $detail = if ($ok) { "journalRevision $($projection.journalRevision)" } else { "journalRevision $($projection.journalRevision) expected $($manifestData.journalRevision)" }
        } catch {
            $ok = $false
            $detail = "not JSON: $($_.Exception.Message)"
        }
    }
    Add-Check -Name "json $jsonRoute" -Ok $ok -Detail $detail
}

$failed = @($checks | Where-Object { -not $_.ok })
$receipt = [pscustomobject]@{
    probedAt        = [System.DateTime]::UtcNow.ToString('o')
    baseUrl         = $origin
    manifest        = (Resolve-Path -LiteralPath $Manifest).Path
    journalRevision = $manifestData.journalRevision
    accountId       = $manifestData.accountId
    ok              = ($failed.Count -eq 0)
    checks          = $checks.ToArray()
}
$receiptPath = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $Manifest).Path) ("probe-" + [System.DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '.json')
[System.IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
Write-Host ''
Write-Host "receipt: $receiptPath"
if ($failed.Count -gt 0) {
    Write-Host "PROBE FAILED: $($failed.Count) of $($checks.Count) checks. Do not promote this candidate."
    exit 1
}
Write-Host "PROBE PASSED: $($checks.Count) checks."
exit 0
