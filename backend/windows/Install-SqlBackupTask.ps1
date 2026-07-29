[CmdletBinding()]
param(
  [string]$TaskName = "ISTEK Zimmet SQL Backup",

  [ValidatePattern('(?-i)^[A-Za-z0-9_.-]+(\\[A-Za-z0-9_.-]+)?$')]
  [string]$ServerInstance = "localhost\SQLEXPRESS",

  [ValidatePattern('(?-i)^[A-Za-z0-9_]+$')]
  [string]$Database = "IstekZimmet",

  [string]$BackupDirectory = "C:\ZimmetBackup",

  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 30,

  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$DailyAt = "02:00",

  [string]$RunAsUser = "",
  [string]$BackupScriptPath = "",
  [string]$SqlCmdPath = "",
  [switch]$UseCompression,
  [switch]$SkipSqlServiceAcl,
  [switch]$RunNow
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Bu kurulum yonetici olarak acilmis PowerShell ile calistirilmali."
  }
}

function Quote-CommandLineValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value.Contains('"')) {
    throw "Komut parametresi cift tirnak iceremez: $Value"
  }
  return '"' + $Value + '"'
}

function Resolve-SafeBackupDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)

  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim())
  if (-not [IO.Path]::IsPathRooted($expanded)) {
    throw "Backup klasoru mutlak yol olmali: $expanded"
  }

  $fullPath = [IO.Path]::GetFullPath($expanded).TrimEnd('\', '/')
  $volumeRoot = [IO.Path]::GetPathRoot($fullPath).TrimEnd('\', '/')
  if ($fullPath.Equals($volumeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Disk kok dizini backup klasoru olarak kullanilamaz: $fullPath"
  }

  New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
  return (Get-Item -LiteralPath $fullPath).FullName.TrimEnd('\', '/')
}

function Get-LocalSqlService {
  param([string]$Instance)

  $parts = $Instance.Split('\', 2)
  $hostName = $parts[0].Trim().ToLowerInvariant()
  $localNames = @('.', '(local)', 'localhost', $env:COMPUTERNAME.ToLowerInvariant())
  if ($localNames -notcontains $hostName) { return $null }

  $instanceName = if ($parts.Count -gt 1) { $parts[1] } else { 'MSSQLSERVER' }
  $serviceName = if ($instanceName -eq 'MSSQLSERVER') {
    'MSSQLSERVER'
  } else {
    'MSSQL$' + $instanceName
  }

  return Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
}

function Grant-SqlServiceFolderAccess {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)]$SqlService
  )

  if ([string]::IsNullOrWhiteSpace($SqlService.StartName)) {
    throw "SQL Server servis hesabi belirlenemedi."
  }

  $acl = Get-Acl -LiteralPath $Directory
  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
    [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $SqlService.StartName,
    [Security.AccessControl.FileSystemRights]::Modify,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $Directory -AclObject $acl
}

Assert-Administrator

if ([string]::IsNullOrWhiteSpace($RunAsUser)) {
  $RunAsUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
}

if ([string]::IsNullOrWhiteSpace($BackupScriptPath)) {
  $BackupScriptPath = Join-Path $PSScriptRoot "Backup-IstekZimmet.ps1"
}
$BackupScriptPath = [IO.Path]::GetFullPath($BackupScriptPath)
if (-not (Test-Path -LiteralPath $BackupScriptPath -PathType Leaf)) {
  throw "Backup scripti bulunamadi: $BackupScriptPath"
}

$resolvedBackupDirectory = Resolve-SafeBackupDirectory -Path $BackupDirectory
$logPath = Join-Path $resolvedBackupDirectory "backup-history.log"

$sqlService = Get-LocalSqlService -Instance $ServerInstance
if (-not $SkipSqlServiceAcl) {
  if (-not $sqlService) {
    throw "Yerel SQL Server servisi bulunamadi. Uzak sunucu kullaniyorsaniz klasor iznini sunucuda verip -SkipSqlServiceAcl kullanin."
  }
  Grant-SqlServiceFolderAccess -Directory $resolvedBackupDirectory -SqlService $sqlService
}

$windowsPowerShell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $windowsPowerShell -PathType Leaf)) {
  throw "Windows PowerShell bulunamadi: $windowsPowerShell"
}

$argumentParts = @(
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-WindowStyle', 'Hidden',
  '-File', (Quote-CommandLineValue $BackupScriptPath),
  '-ServerInstance', (Quote-CommandLineValue $ServerInstance),
  '-Database', (Quote-CommandLineValue $Database),
  '-BackupDirectory', (Quote-CommandLineValue $resolvedBackupDirectory),
  '-RetentionDays', $RetentionDays.ToString(),
  '-LogPath', (Quote-CommandLineValue $logPath)
)
if (-not [string]::IsNullOrWhiteSpace($SqlCmdPath)) {
  $argumentParts += @('-SqlCmdPath', (Quote-CommandLineValue ([IO.Path]::GetFullPath($SqlCmdPath))))
}
if ($UseCompression) {
  $argumentParts += '-UseCompression'
}

$timeOfDay = [TimeSpan]::ParseExact($DailyAt, 'hh\:mm', [Globalization.CultureInfo]::InvariantCulture)
$triggerAt = (Get-Date).Date.Add($timeOfDay)
$action = New-ScheduledTaskAction `
  -Execute $windowsPowerShell `
  -Argument ($argumentParts -join ' ') `
  -WorkingDirectory (Split-Path -Parent $BackupScriptPath)
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerAt
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 4) `
  -MultipleInstances IgnoreNew `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal `
  -UserId $RunAsUser `
  -LogonType S4U `
  -RunLevel Highest

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "ISTEK Zimmet SQL tam backup, checksum dogrulama ve saklama temizligi" `
  -Force | Out-Null

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
}

[pscustomobject]@{
  success = $true
  taskName = $TaskName
  serverInstance = $ServerInstance
  database = $Database
  backupDirectory = $resolvedBackupDirectory
  retentionDays = $RetentionDays
  dailyAt = $DailyAt
  runAsUser = $RunAsUser
  logonType = "S4U"
  sqlServiceAccount = if ($sqlService) { $sqlService.StartName } else { "" }
  runNow = [bool]$RunNow
}
