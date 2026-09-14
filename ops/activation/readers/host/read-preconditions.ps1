<#
  The activation's host-precondition reader (spec §3; build log, unit 7). Read-only.

  Prints one flat JSON object of name -> string, the shape Schedule.expectedHostPreconditions
  is written in, so that step 0 and step 7 compare name by name in both directions. Every
  value is normalised to text here and nowhere else: a DWORD as its decimal, a missing value
  as "absent". The names are fixed; adding one here without adding it to the expectation is
  red at step 0, which is the point.

  - SleepAcSeconds, HibernateAcSeconds: the active power plan's AC standby and hibernate
    timeouts, from the CIM power provider (locale-independent, unlike powercfg's text). The
    active plan comes from the registry: Win32_PowerPlan refuses an unelevated caller on this
    host (measured 2026-09-14), while Win32_PowerSettingDataIndex answers.
  - HiberbootEnabled: fast startup; 0 means a restart is a real restart.
  - ActiveHoursStart, ActiveHoursEnd: Windows Update's active hours.
  - AutoAdminLogon, DisableAutomaticRestartSignOn: auto-logon and ARSO; ARSO must be off,
    or step 9's signed-out proof is worthless.
  - ShutdownPrivilege: whether this token holds SeShutdownPrivilege (step 8 restarts).
  - AdministratorsMember: whether this account is a member of the local Administrators group,
    by SID. Not from the token: an unelevated token carries Administrators deny-only, and
    WindowsIdentity.Groups leaves it out (measured 2026-09-14).

  Any failure exits 3 with one line on stderr.
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Get-RegistryText {
    param([string]$Path, [string]$Name)
    $item = Get-ItemProperty -LiteralPath $Path -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $item) { return 'absent' }
    return [string]$item.$Name
}

function Get-AcIndex {
    # Setting GUIDs are Windows' own constants for standby and hibernate idle timeouts.
    param([string]$PlanGuid, [string]$SettingGuid)
    $index = @(Get-CimInstance -Namespace 'root\cimv2\power' -ClassName Win32_PowerSettingDataIndex -Filter "InstanceID LIKE '%{$PlanGuid}\\AC\\{$SettingGuid}'")
    if ($index.Count -ne 1) { return 'absent' }
    return [string]$index[0].SettingIndexValue
}

try {
    $planGuid = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes' -Name 'ActivePowerScheme').ActivePowerScheme
    if ($planGuid -notmatch '^[0-9a-fA-F-]{36}$') { throw 'the active power scheme is not a GUID' }
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $administrators = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.SID.Value })
    $privileges = (& whoami.exe /priv) -join "`n"

    $values = [ordered]@{
        SleepAcSeconds                = Get-AcIndex -PlanGuid $planGuid -SettingGuid '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
        HibernateAcSeconds            = Get-AcIndex -PlanGuid $planGuid -SettingGuid '9d7815a6-7ee4-497e-8888-515a05f02364'
        HiberbootEnabled              = Get-RegistryText -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name 'HiberbootEnabled'
        ActiveHoursStart              = Get-RegistryText -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name 'ActiveHoursStart'
        ActiveHoursEnd                = Get-RegistryText -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -Name 'ActiveHoursEnd'
        AutoAdminLogon                = Get-RegistryText -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -Name 'AutoAdminLogon'
        DisableAutomaticRestartSignOn = Get-RegistryText -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'DisableAutomaticRestartSignOn'
        ShutdownPrivilege             = if ($privileges -match 'SeShutdownPrivilege') { 'present' } else { 'absent' }
        AdministratorsMember          = if ($administrators -contains $me) { 'yes' } else { 'no' }
    }
    ConvertTo-Json -InputObject ([pscustomobject]$values) -Compress
} catch {
    [Console]::Error.WriteLine("host preconditions unreadable: $($_.CategoryInfo.Category)")
    exit 3
}
