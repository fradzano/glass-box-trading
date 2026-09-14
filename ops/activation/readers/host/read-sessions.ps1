<#
  The activation's session probe (build log, unit 7, design point 3). Read-only.

  quser does not exist on Windows 11 Home (spec §3), so the probe reads Win32_LogonSession
  for the interactive logon types 2 (console), 10 (remote) and 11 (cached) with the
  accounts Win32_LoggedOnUser associates with each, and counts explorer processes. It
  prints { "sessions": [{ "type": 2, "accounts": ["HOST\\user"] }], "explorer": 1 }, which
  parseSessionProbe reads; the parser, not this script, decides who is a person. Any
  failure exits 3 with one line on stderr.
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $sessions = @(Get-CimInstance -ClassName Win32_LogonSession | Where-Object { $_.LogonType -in 2, 10, 11 } | ForEach-Object {
        $accounts = @(Get-CimAssociatedInstance -InputObject $_ -Association Win32_LoggedOnUser | ForEach-Object { "$($_.Domain)\$($_.Name)" })
        [pscustomobject]@{ type = [int]$_.LogonType; accounts = $accounts }
    })
    $explorer = @(Get-Process -Name explorer -ErrorAction SilentlyContinue).Count
    ConvertTo-Json -InputObject ([pscustomobject]@{ sessions = $sessions; explorer = $explorer }) -Depth 4 -Compress
} catch {
    [Console]::Error.WriteLine("session probe failed: $($_.CategoryInfo.Category)")
    exit 3
}
