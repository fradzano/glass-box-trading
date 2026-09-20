<#
.SYNOPSIS
    Elevated, disposable proof for the installer-owned watchdog bootstrap writer.

.DESCRIPTION
    Exercises the same Install-WatchdogBootstrap function used by the real installer,
    but only below a fresh temporary directory. It proves initial creation, protected
    ACLs, readback, ACL-drift detection, replacement semantics, rotation, fingerprint
    rebinding and cleanup. It prints fingerprints and finding codes only, never URLs.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'
$probeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("gbt-watchdog-bootstrap-proof-$([guid]::NewGuid().ToString('N'))")
$bootstrapPath = Join-Path $probeRoot 'secrets\healthchecks-watchdog.url'
$firstUrl = 'https://example.invalid/hc/bootstrap-proof-alpha'
$secondUrl = 'https://example.invalid/hc/bootstrap-proof-bravo'

function Assert-Probe {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "bootstrap proof failed: $Message" }
}

try {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    Assert-Probe $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) 'the proof must run elevated'

    Import-Module (Join-Path $RepoRoot 'tools\watchdog-bootstrap.psm1') -Force -ErrorAction Stop
    $taskUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

    $first = Install-WatchdogBootstrap -Url $firstUrl -TaskUserSid $taskUserSid -Path $bootstrapPath
    $firstRead = Read-WatchdogBootstrap -Path $bootstrapPath
    $firstCheck = Test-WatchdogBootstrap -Path $bootstrapPath -TaskUserSid $taskUserSid -ExpectedFingerprint $first.Fingerprint
    Assert-Probe ($first.Ok -and $firstRead.Ok -and $firstCheck.Ok) 'initial write/readback/ACL check did not pass'
    Assert-Probe ($firstRead.Url -ceq $firstUrl) 'initial readback differed'
    Assert-Probe (@(Get-ChildItem -LiteralPath (Split-Path -Parent $bootstrapPath) -Filter '*.tmp-*').Count -eq 0) 'temporary file survived initial write'
    Assert-Probe (@(Get-ChildItem -LiteralPath (Split-Path -Parent $bootstrapPath) -Filter '*.bak-*').Count -eq 0) 'backup file survived initial write'

    # A held read handle continues to see the old complete value while File.Replace
    # installs the new complete value for new readers. Truncate-and-rewrite cannot
    # satisfy both observations.
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $oldStream = New-Object System.IO.FileStream($bootstrapPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        $second = Install-WatchdogBootstrap -Url $secondUrl -TaskUserSid $taskUserSid -Path $bootstrapPath
        $oldReader = New-Object System.IO.StreamReader($oldStream, [System.Text.Encoding]::UTF8, $true)
        try { $oldValue = $oldReader.ReadToEnd() } finally { $oldReader.Dispose() }
    } finally {
        if ($null -ne $oldStream) { $oldStream.Dispose() }
    }
    $secondRead = Read-WatchdogBootstrap -Path $bootstrapPath
    $secondCheck = Test-WatchdogBootstrap -Path $bootstrapPath -TaskUserSid $taskUserSid -ExpectedFingerprint $second.Fingerprint
    Assert-Probe ($oldValue -ceq $firstUrl) 'held reader did not retain the complete pre-rotation value'
    Assert-Probe ($secondRead.Ok -and $secondRead.Url -ceq $secondUrl -and $secondCheck.Ok) 'rotated value/readback/ACL check did not pass'
    Assert-Probe ($first.Fingerprint -ne $second.Fingerprint) 'rotation did not change the fingerprint'
    Assert-Probe (@(Get-ChildItem -LiteralPath (Split-Path -Parent $bootstrapPath) -Filter '*.tmp-*').Count -eq 0) 'temporary file survived rotation'
    Assert-Probe (@(Get-ChildItem -LiteralPath (Split-Path -Parent $bootstrapPath) -Filter '*.bak-*').Count -eq 0) 'backup file survived rotation'

    # Deliberately widen the file DACL and demand that the verifier detects it.
    $fileInfo = New-Object System.IO.FileInfo($bootstrapPath)
    $security = $fileInfo.GetAccessControl()
    $everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
    $extraRule = New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($extraRule) | Out-Null
    $fileInfo.SetAccessControl($security)
    $drift = Test-WatchdogBootstrap -Path $bootstrapPath -TaskUserSid $taskUserSid -ExpectedFingerprint $second.Fingerprint
    Assert-Probe (-not $drift.Ok -and ($drift.Findings -contains 'file:extra-ace:S-1-1-0')) 'widened ACL was not detected'

    # A final installer pass must repair the drift while rotating back.
    $repaired = Install-WatchdogBootstrap -Url $firstUrl -TaskUserSid $taskUserSid -Path $bootstrapPath
    $repairCheck = Test-WatchdogBootstrap -Path $bootstrapPath -TaskUserSid $taskUserSid -ExpectedFingerprint $repaired.Fingerprint
    Assert-Probe $repairCheck.Ok 'installer did not repair ACL drift'

    $resultLine = "WATCHDOG_BOOTSTRAP_PROOF=PASS first=$($first.Fingerprint) rotated=$($second.Fingerprint) repaired=$($repaired.Fingerprint)"
    if (-not [string]::IsNullOrWhiteSpace($ResultPath)) {
        [System.IO.File]::WriteAllText($ResultPath, $resultLine, (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-Output $resultLine
} catch {
    if (-not [string]::IsNullOrWhiteSpace($ResultPath)) {
        $safeMessage = ($_.Exception.Message -replace [regex]::Escape($firstUrl), '<redacted>' -replace [regex]::Escape($secondUrl), '<redacted>' -replace "\s+", ' ').Trim()
        $failureLine = "WATCHDOG_BOOTSTRAP_PROOF=FAIL id=$($_.FullyQualifiedErrorId) line=$($_.InvocationInfo.ScriptLineNumber) message=$safeMessage"
        [System.IO.File]::WriteAllText($ResultPath, $failureLine, (New-Object System.Text.UTF8Encoding($false)))
    }
    throw
} finally {
    if ([System.IO.Directory]::Exists($probeRoot)) { [System.IO.Directory]::Delete($probeRoot, $true) }
}
