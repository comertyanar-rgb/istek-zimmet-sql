# Installs/updates the Windows Scheduled Task that keeps the local SQL API running.
# Default mode is silent and log-backed: the task starts Node through wscript.exe.

param(
  [string]$TaskName = "ISTEK Zimmet SQL API",
  [string]$BackendDirectory = "",
  [string]$NodePath = "",
  [string]$WrapperPath = "C:\ZimmetBackend\Run-BackendHidden.vbs",
  [string]$LogPath = "C:\ZimmetBackend\backend.log",
  [switch]$AtStartup,
  [switch]$Visible
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BackendDirectory)) {
  $BackendDirectory = Resolve-Path (Join-Path $PSScriptRoot "..")
}

if (-not (Test-Path -LiteralPath $BackendDirectory)) {
  throw "Backend klasoru bulunamadi: $BackendDirectory"
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "node.exe bulunamadi. Node.js kurulu olmali."
  }
  $NodePath = $node.Source
}

if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Node bulunamadi: $NodePath"
}

$serverPath = Join-Path $BackendDirectory "src\server.js"
if (-not (Test-Path -LiteralPath $serverPath)) {
  throw "Backend server dosyasi bulunamadi: $serverPath"
}

$logDir = Split-Path -Parent $LogPath
if (-not [string]::IsNullOrWhiteSpace($logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$quotedNode = '"' + $NodePath + '"'
$quotedServer = '"' + $serverPath + '"'
$quotedLog = '"' + $LogPath + '"'
$cmdArguments = '/d /s /c "' + $quotedNode + ' ' + $quotedServer + ' >> ' + $quotedLog + ' 2>&1"'

if ($Visible) {
  $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR "System32\cmd.exe") -Argument $cmdArguments -WorkingDirectory $BackendDirectory
} else {
  $wrapperDir = Split-Path -Parent $WrapperPath
  if (-not [string]::IsNullOrWhiteSpace($wrapperDir)) {
    New-Item -ItemType Directory -Force -Path $wrapperDir | Out-Null
  }

  $hiddenCommand = '"' + (Join-Path $env:WINDIR "System32\cmd.exe") + '" ' + $cmdArguments
  $escapedHiddenCommand = $hiddenCommand.Replace('"', '""')
  $escapedWorkingDirectory = $BackendDirectory.Replace('"', '""')
  $wrapperContent = @"
Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$escapedWorkingDirectory"
shell.Run "$escapedHiddenCommand", 0, False
"@

  Set-Content -Path $WrapperPath -Value $wrapperContent -Encoding ASCII

  $wscript = Join-Path $env:WINDIR "System32\wscript.exe"
  $action = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $WrapperPath + '"') -WorkingDirectory $BackendDirectory
}

if ($AtStartup) {
  $trigger = New-ScheduledTaskTrigger -AtStartup
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "ISTEK Zimmet SQL API backend" `
  -Force | Out-Null

[pscustomobject]@{
  success = $true
  taskName = $TaskName
  trigger = if ($AtStartup) { "AtStartup" } else { "AtLogOn" }
  backendDirectory = $BackendDirectory
  nodePath = $NodePath
  logPath = $LogPath
  hidden = -not $Visible
  wrapperPath = if ($Visible) { "" } else { $WrapperPath }
}
