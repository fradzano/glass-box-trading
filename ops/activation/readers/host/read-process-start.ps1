[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$TargetProcessId
)

$ErrorActionPreference = 'Stop'

try {
    $process = Get-Process -Id $TargetProcessId -ErrorAction Stop
} catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
    [Console]::Out.WriteLine('ABSENT')
    exit 0
} catch {
    [Console]::Error.WriteLine('PROCESS_START_UNAVAILABLE')
    exit 2
}

$startedAtUtc = $process.StartTime.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
[Console]::Out.WriteLine($startedAtUtc)
