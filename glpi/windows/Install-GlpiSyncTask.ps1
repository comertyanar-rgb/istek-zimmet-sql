# Installs/updates the Windows Scheduled Task for GLPI -> SQL sync.
# Default mode is silent: the task runs wscript.exe, which starts PowerShell hidden.

param(
  [string]$TaskName = "ISTEK Zimmet GLPI Sync",
  [int]$IntervalMinutes = 30,
  [string]$ScriptPath = "",
  [string]$WorkingDirectory = "",
  [string]$WrapperPath = "C:\ZimmetGLPI\Run-GlpiSyncHidden.vbs",
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes en az 1 olmali."
}

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  $ScriptPath = Resolve-Path (Join-Path $PSScriptRoot "..\..\sync-glpi.ps1")
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

$quotedScript = '"' + $ScriptPath + '"'
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript"

if ($Visible) {
  $action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument $arguments -WorkingDirectory $WorkingDirectory
} else {
  $wrapperDir = Split-Path -Parent $WrapperPath
  if (-not [string]::IsNullOrWhiteSpace($wrapperDir)) {
    New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null
  }

  $hiddenCommand = '"' + $pwsh.Source + '" ' + $arguments
  $escapedHiddenCommand = $hiddenCommand.Replace('"', '""')
  $escapedWorkingDirectory = $WorkingDirectory.Replace('"', '""')
  $wrapperContent = @"
Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$escapedWorkingDirectory"
shell.Run "$escapedHiddenCommand", 0, False
"@

  Set-Content -Path $WrapperPath -Value $wrapperContent -Encoding ASCII

  $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
  $action = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $WrapperPath + '"') -WorkingDirectory $WorkingDirectory
}

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration ([TimeSpan]::FromDays(3650))

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "ISTEK Zimmet GLPI -> SQL senkronizasyonu" `
  -Force | Out-Null

[pscustomobject]@{
  success = $true
  taskName = $TaskName
  intervalMinutes = $IntervalMinutes
  scriptPath = $ScriptPath
  hidden = -not $Visible
  wrapperPath = if ($Visible) { "" } else { $WrapperPath }
}
