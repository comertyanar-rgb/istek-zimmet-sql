# Installs/updates the Windows Scheduled Task for Google Sheet -> SQL personnel sync.

param(
  [string]$TaskName = "ISTEK Zimmet Personnel Sync",
  [int]$IntervalMinutes = 5,
  [string]$ScriptPath = "",
  [string]$LogPath = "C:\ZimmetPersonnel\personnel-sync.log",
  [string]$WorkingDirectory = ""
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes en az 1 olmali."
}

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  $ScriptPath = Resolve-Path (Join-Path $PSScriptRoot "..\..\sync-personnel.ps1")
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Script bulunamadi: $ScriptPath"
}

if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
  $WorkingDirectory = Split-Path -Parent $ScriptPath
}

$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $pwsh) {
  $pwsh = Get-Command powershell.exe -ErrorAction SilentlyContinue
}
if (-not $pwsh) {
  throw "PowerShell calistiricisi bulunamadi."
}

$logDir = Split-Path -Parent $LogPath
if (-not [string]::IsNullOrWhiteSpace($logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$quotedScript = '"' + $ScriptPath + '"'
$quotedLog = '"' + $LogPath + '"'
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript -LogPath $quotedLog"

$action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument $arguments -WorkingDirectory $WorkingDirectory
$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration ([TimeSpan]::FromDays(3650))

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "ISTEK Zimmet Kullanıcılar Sheet -> SQL personel senkronizasyonu" `
  -Force | Out-Null

[pscustomobject]@{
  success = $true
  taskName = $TaskName
  intervalMinutes = $IntervalMinutes
  scriptPath = $ScriptPath
  logPath = $LogPath
}
