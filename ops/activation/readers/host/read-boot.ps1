<#
  The activation's boot-time reader (build log, unit 7). Read-only.

  Prints Win32_OperatingSystem.LastBootUpTime as a UTC ISO 8601 instant with PowerShell's
  seven fraction digits and a Z, which parseBootInstant in ops/activation/readers/parse.ts
  reads. Any failure exits 3 with one line on stderr.
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $boot = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime
    [Console]::Out.WriteLine($boot.ToUniversalTime().ToString('o'))
} catch {
    [Console]::Error.WriteLine("boot time unreadable: $($_.CategoryInfo.Category)")
    exit 3
}
