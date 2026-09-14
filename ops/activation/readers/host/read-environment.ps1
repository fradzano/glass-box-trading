<#
  The activation's environment-shadow reader (owner ruling 2026-09-14; build log, unit 7).
  Read-only.

  The runtime lets process variables win over .env (src/shell/runtime-config.ts,
  loadEnvironment), and an S4U task's process environment is built from the user and machine
  environment in the registry. So a PRE_ARM_CERTIFICATE, ALPACA_PROFILE or STATE_DIR set there
  would reach the runtime although .env has no line. This prints, for exactly those three
  keys and nothing else, the ones set in each scope with their values:
  { "user": { "KEY": "value" }, "machine": {} }. None of the three is a credential. Any
  failure exits 3 with one line on stderr.
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    $keys = @('PRE_ARM_CERTIFICATE', 'ALPACA_PROFILE', 'STATE_DIR')
    $result = [ordered]@{ user = [ordered]@{}; machine = [ordered]@{} }
    foreach ($key in $keys) {
        $user = [System.Environment]::GetEnvironmentVariable($key, [System.EnvironmentVariableTarget]::User)
        if ($null -ne $user) { $result.user[$key] = $user }
        $machine = [System.Environment]::GetEnvironmentVariable($key, [System.EnvironmentVariableTarget]::Machine)
        if ($null -ne $machine) { $result.machine[$key] = $machine }
    }
    ConvertTo-Json -InputObject ([pscustomobject]@{ user = [pscustomobject]$result.user; machine = [pscustomobject]$result.machine }) -Compress
} catch {
    [Console]::Error.WriteLine("environment unreadable: $($_.CategoryInfo.Category)")
    exit 3
}
