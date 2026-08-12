# Installs/updates the Windows Scheduled Task for SQL -> signature generation jobs.
# Default mode is silent: the task runs wscript.exe, which starts PowerShell hidden.

param(
  [string]$TaskName = "ISTEK Zimmet Imza Agent",
  [int]$IntervalMinutes = 2,
  [string]$ScriptPath = "",
  [string]$WorkingDirectory = "",
  [string]$WrapperPath = "C:\GAMWork\scripts\Run-ImzaAgentHidden.vbs",
  [int]$SignatureFetchLimit = 1,
  [ValidateSet("Headless", "Photoshop")]
  [string]$RenderEngine = "Headless",
  [string]$NodeExe = "node.exe",
  [string]$HeadlessRendererPath = "",
  [string]$ChromePath = "",
  [string]$CampusImageDir = "C:\GAMWork\campus",
  [switch]$DisablePhotoshopFallback,
  [switch]$Visible,
  [switch]$SkipPhotoshop,
  [switch]$SkipUpload,
  [switch]$SkipGam
)

$ErrorActionPreference = "Stop"

function Quote-TaskArgument {
  param([string]$Value)

  if ($null -eq $Value) { return '""' }
  if ($Value.Contains('"')) {
    throw "Gorev argumani cift tirnak iceremez: $Value"
  }
  return '"' + $Value + '"'
}

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes en az 1 olmali."
}

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  $ScriptPath = Resolve-Path (Join-Path $PSScriptRoot "Run-ImzaPipeline.ps1")
}

if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Script bulunamadi: $ScriptPath"
}

if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
  $WorkingDirectory = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $pwsh) {
  $pwsh = Get-Command powershell.exe -ErrorAction SilentlyContinue
}
if (-not $pwsh) {
  throw "PowerShell calistiricisi bulunamadi."
}

$quotedScript = '"' + $ScriptPath + '"'
$arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $quotedScript -SignatureFetchLimit $SignatureFetchLimit"
$arguments += " -RenderEngine $RenderEngine"
$arguments += " -NodeExe " + (Quote-TaskArgument $NodeExe)
if (-not [string]::IsNullOrWhiteSpace($HeadlessRendererPath)) {
  $arguments += " -HeadlessRendererPath " + (Quote-TaskArgument $HeadlessRendererPath)
}
if (-not [string]::IsNullOrWhiteSpace($ChromePath)) {
  $arguments += " -ChromePath " + (Quote-TaskArgument $ChromePath)
}
if (-not [string]::IsNullOrWhiteSpace($CampusImageDir)) {
  $arguments += " -CampusImageDir " + (Quote-TaskArgument $CampusImageDir)
}
if ($DisablePhotoshopFallback) { $arguments += " -DisablePhotoshopFallback" }
if ($SkipPhotoshop) { $arguments += " -SkipPhotoshop" }
if ($SkipUpload) { $arguments += " -SkipUpload" }
if ($SkipGam) { $arguments += " -SkipGam" }

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
Dim shell, exitCode
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "$escapedWorkingDirectory"
exitCode = shell.Run("$escapedHiddenCommand", 0, True)
WScript.Quit exitCode
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
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "ISTEK Zimmet SQL imza olusturma ajani" `
  -Force | Out-Null

[pscustomobject]@{
  success = $true
  taskName = $TaskName
  intervalMinutes = $IntervalMinutes
  scriptPath = $ScriptPath
  renderEngine = $RenderEngine
  hidden = -not $Visible
  wrapperPath = if ($Visible) { "" } else { $WrapperPath }
}
