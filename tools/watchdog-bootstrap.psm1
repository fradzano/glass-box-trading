$script:WatchdogBootstrapPath = 'C:\ProgramData\GlassBoxTrading\secrets\healthchecks-watchdog.url'
$script:SystemSid = 'S-1-5-18'
$script:AdministratorsSid = 'S-1-5-32-544'

function Get-WatchdogBootstrapPath {
    return $script:WatchdogBootstrapPath
}

function Get-WatchdogEndpointFingerprint {
    param([Parameter(Mandatory = $true)][string]$Url)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Url)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hex = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
        return "hc:$($hex.Substring(0, 8))"
    } finally {
        $sha.Dispose()
    }
}

function Test-WatchdogEndpointShape {
    param([string]$Url)
    if ([string]::IsNullOrWhiteSpace($Url) -or $Url -ne $Url.Trim() -or $Url.Contains("`r") -or $Url.Contains("`n")) { return $false }
    $parsed = $null
    if (-not [System.Uri]::TryCreate($Url, [System.UriKind]::Absolute, [ref]$parsed)) { return $false }
    if ($parsed.Scheme -ne 'https' -and $parsed.Scheme -ne 'http') { return $false }
    if (-not [string]::IsNullOrEmpty($parsed.UserInfo) -or -not [string]::IsNullOrEmpty($parsed.Query) -or -not [string]::IsNullOrEmpty($parsed.Fragment)) { return $false }
    return $true
}

function Read-SingleDotEnvValue {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Key)
    $matches = @()
    $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine().Trim()
            if ($line.Length -eq 0 -or $line.StartsWith('#')) { continue }
            $separator = $line.IndexOf('=')
            if ($separator -le 0 -or $line.Substring(0, $separator).Trim() -ne $Key) { continue }
            $value = $line.Substring($separator + 1).Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value = $value.Substring(1, $value.Length - 2) }
            $matches += $value
        }
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
    if ($matches.Count -ne 1 -or [string]::IsNullOrWhiteSpace($matches[0])) { throw ".env must contain exactly one non-empty $Key entry." }
    return $matches[0]
}

function Read-WatchdogBootstrap {
    param([string]$Path = $script:WatchdogBootstrapPath)
    try {
        if (-not [System.IO.File]::Exists($Path)) {
            return [pscustomobject]@{ Ok = $false; Code = 'missing'; Url = $null; Fingerprint = $null }
        }
        $attributes = [System.IO.File]::GetAttributes($Path)
        if (($attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            return [pscustomobject]@{ Ok = $false; Code = 'reparse-point'; Url = $null; Fingerprint = $null }
        }
        if (($attributes -band [System.IO.FileAttributes]::Encrypted) -ne 0) {
            return [pscustomobject]@{ Ok = $false; Code = 'encrypted'; Url = $null; Fingerprint = $null }
        }
        $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
        try {
            if ($stream.Length -le 0 -or $stream.Length -gt 4096) {
                return [pscustomobject]@{ Ok = $false; Code = 'invalid-length'; Url = $null; Fingerprint = $null }
            }
            $bytes = New-Object byte[] ([int]$stream.Length)
            $offset = 0
            while ($offset -lt $bytes.Length) {
                $read = $stream.Read($bytes, $offset, $bytes.Length - $offset)
                if ($read -le 0) { break }
                $offset += $read
            }
            if ($offset -ne $bytes.Length) {
                return [pscustomobject]@{ Ok = $false; Code = 'short-read'; Url = $null; Fingerprint = $null }
            }
        } finally {
            $stream.Dispose()
        }
        $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
        $url = $utf8.GetString($bytes)
        if (-not (Test-WatchdogEndpointShape -Url $url)) {
            return [pscustomobject]@{ Ok = $false; Code = 'invalid-content'; Url = $null; Fingerprint = $null }
        }
        return [pscustomobject]@{ Ok = $true; Code = 'ok'; Url = $url; Fingerprint = (Get-WatchdogEndpointFingerprint -Url $url) }
    } catch {
        return [pscustomobject]@{ Ok = $false; Code = 'unreadable'; Url = $null; Fingerprint = $null }
    }
}

function New-WatchdogBootstrapSecurity {
    param(
        [Parameter(Mandatory = $true)][string]$TaskUserSid,
        [Parameter(Mandatory = $true)][bool]$Directory
    )
    $security = if ($Directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
    $security.SetAccessRuleProtection($true, $false)
    $administrators = New-Object System.Security.Principal.SecurityIdentifier($script:AdministratorsSid)
    $security.SetOwner($administrators)
    $inheritance = if ($Directory) { [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [System.Security.AccessControl.InheritanceFlags]::None }
    $propagation = [System.Security.AccessControl.PropagationFlags]::None
    foreach ($entry in @(
        [pscustomobject]@{ Sid = $script:SystemSid; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        [pscustomobject]@{ Sid = $script:AdministratorsSid; Rights = [System.Security.AccessControl.FileSystemRights]::FullControl },
        [pscustomobject]@{ Sid = $TaskUserSid; Rights = $(if ($Directory) { [System.Security.AccessControl.FileSystemRights]::ReadAndExecute } else { [System.Security.AccessControl.FileSystemRights]::Read }) }
    )) {
        $sid = New-Object System.Security.Principal.SecurityIdentifier($entry.Sid)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $entry.Rights, $inheritance, $propagation, [System.Security.AccessControl.AccessControlType]::Allow)
        $security.AddAccessRule($rule) | Out-Null
    }
    return $security
}

function Get-WatchdogBootstrapAclFindings {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$TaskUserSid,
        [Parameter(Mandatory = $true)][bool]$Directory
    )
    $findings = New-Object System.Collections.Generic.List[string]
    try {
        $security = if ($Directory) { (New-Object System.IO.DirectoryInfo($Path)).GetAccessControl() } else { (New-Object System.IO.FileInfo($Path)).GetAccessControl() }
        if (-not $security.AreAccessRulesProtected) { $findings.Add('inheritance-enabled') }
        $owner = $security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        if ($owner -ne $script:AdministratorsSid) { $findings.Add('owner-unexpected') }
        $rules = @($security.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
        $expected = @($script:SystemSid, $script:AdministratorsSid, $TaskUserSid)
        $expectedInheritance = if ($Directory) { [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [System.Security.AccessControl.InheritanceFlags]::None }
        foreach ($rule in $rules) {
            $sid = $rule.IdentityReference.Value
            if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { $findings.Add("deny-ace:$sid"); continue }
            if ($expected -notcontains $sid) { $findings.Add("extra-ace:$sid"); continue }
            $expectedRights = if ($sid -eq $TaskUserSid) {
                # Windows canonicalizes an allow ACE by adding Synchronize when
                # it is persisted, including for the Read composites below.
                $(if ($Directory) { [System.Security.AccessControl.FileSystemRights]::ReadAndExecute } else { [System.Security.AccessControl.FileSystemRights]::Read }) -bor [System.Security.AccessControl.FileSystemRights]::Synchronize
            } else { [System.Security.AccessControl.FileSystemRights]::FullControl }
            if ($rule.FileSystemRights -ne $expectedRights) { $findings.Add("rights-mismatch:${sid}:$([int]$rule.FileSystemRights):$([int]$expectedRights)") }
            if ($rule.InheritanceFlags -ne $expectedInheritance -or $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None -or $rule.IsInherited) { $findings.Add("inheritance-mismatch:$sid") }
        }
        foreach ($sid in $expected) {
            $matching = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow })
            if ($matching.Count -eq 0) { $findings.Add("missing-ace:$sid") }
            elseif ($matching.Count -ne 1) { $findings.Add("duplicate-ace:$sid") }
        }
    } catch {
        $findings.Add('acl-unreadable')
    }
    return @($findings)
}

function Set-WatchdogBootstrapAcl {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$TaskUserSid,
        [Parameter(Mandatory = $true)][bool]$Directory
    )
    $security = New-WatchdogBootstrapSecurity -TaskUserSid $TaskUserSid -Directory $Directory
    if ($Directory) { (New-Object System.IO.DirectoryInfo($Path)).SetAccessControl($security) } else { (New-Object System.IO.FileInfo($Path)).SetAccessControl($security) }
}

function Test-WatchdogBootstrap {
    param(
        [string]$Path = $script:WatchdogBootstrapPath,
        [Parameter(Mandatory = $true)][string]$TaskUserSid,
        [string]$ExpectedFingerprint = ''
    )
    $findings = New-Object System.Collections.Generic.List[string]
    $directory = Split-Path -Parent $Path
    if (-not [System.IO.Directory]::Exists($directory)) { $findings.Add('directory-missing') }
    else { foreach ($finding in (Get-WatchdogBootstrapAclFindings -Path $directory -TaskUserSid $TaskUserSid -Directory $true)) { $findings.Add("directory:$finding") } }
    $read = Read-WatchdogBootstrap -Path $Path
    if (-not $read.Ok) { $findings.Add("file:$($read.Code)") }
    else {
        foreach ($finding in (Get-WatchdogBootstrapAclFindings -Path $Path -TaskUserSid $TaskUserSid -Directory $false)) { $findings.Add("file:$finding") }
        if (-not [string]::IsNullOrWhiteSpace($ExpectedFingerprint) -and $read.Fingerprint -ne $ExpectedFingerprint) { $findings.Add("fingerprint-mismatch:$($read.Fingerprint):$ExpectedFingerprint") }
    }
    return [pscustomobject]@{ Ok = ($findings.Count -eq 0); Findings = @($findings); Fingerprint = $(if ($read.Ok) { $read.Fingerprint } else { $null }) }
}

function Install-WatchdogBootstrap {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$TaskUserSid,
        [string]$Path = $script:WatchdogBootstrapPath
    )
    if (-not (Test-WatchdogEndpointShape -Url $Url)) { throw 'The configured watchdog endpoint is absent or invalid.' }
    $directory = Split-Path -Parent $Path
    $parent = Split-Path -Parent $directory
    if ([System.IO.Directory]::Exists($parent) -and (([System.IO.File]::GetAttributes($parent) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'The watchdog bootstrap parent directory is a reparse point.' }
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    if ([System.IO.Directory]::Exists($directory)) {
        if (([System.IO.File]::GetAttributes($directory) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The watchdog bootstrap directory is a reparse point.' }
    } else {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    Set-WatchdogBootstrapAcl -Path $directory -TaskUserSid $TaskUserSid -Directory $true

    $temporary = "$Path.tmp-$([System.Guid]::NewGuid().ToString('N'))"
    $backup = "$Path.bak-$([System.Guid]::NewGuid().ToString('N'))"
    try {
        [System.IO.File]::WriteAllText($temporary, $Url, (New-Object System.Text.UTF8Encoding($false)))
        Set-WatchdogBootstrapAcl -Path $temporary -TaskUserSid $TaskUserSid -Directory $false
        $tempRead = Read-WatchdogBootstrap -Path $temporary
        if (-not $tempRead.Ok -or $tempRead.Url -cne $Url) { throw 'The watchdog bootstrap temporary file did not read back exactly.' }
        if ([System.IO.File]::Exists($Path)) {
            Set-WatchdogBootstrapAcl -Path $Path -TaskUserSid $TaskUserSid -Directory $false
            # Windows PowerShell 5.1/.NET Framework rejects a null backup path.
            # The backup is transient, inherits the already-tight target ACL and
            # is removed before verification returns.
            [System.IO.File]::Replace($temporary, $Path, $backup, $true)
            [System.IO.File]::Delete($backup)
        } else {
            [System.IO.File]::Move($temporary, $Path)
        }
        Set-WatchdogBootstrapAcl -Path $Path -TaskUserSid $TaskUserSid -Directory $false
        $expected = Get-WatchdogEndpointFingerprint -Url $Url
        $verified = Test-WatchdogBootstrap -Path $Path -TaskUserSid $TaskUserSid -ExpectedFingerprint $expected
        $readBack = Read-WatchdogBootstrap -Path $Path
        if (-not $verified.Ok -or -not $readBack.Ok -or $readBack.Url -cne $Url) { throw "The watchdog bootstrap verification failed: $($verified.Findings -join ', ')." }
        return [pscustomobject]@{ Ok = $true; Fingerprint = $expected; Path = $Path }
    } finally {
        if ([System.IO.File]::Exists($temporary)) { [System.IO.File]::Delete($temporary) }
        if ([System.IO.File]::Exists($backup)) { [System.IO.File]::Delete($backup) }
    }
}

Export-ModuleMember -Function Get-WatchdogBootstrapPath, Get-WatchdogEndpointFingerprint, Read-SingleDotEnvValue, Read-WatchdogBootstrap, Test-WatchdogBootstrap, Install-WatchdogBootstrap
