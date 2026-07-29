# Installs/updates the Windows Scheduled Task that keeps the local SQL API running.
# The task tracks the backend process, writes a persistent log and can run as SYSTEM.

param(
  [string]$TaskName = "ISTEK Zimmet SQL API",
  [string]$BackendDirectory = "",
  [string]$NodePath = "",
  [Alias("WrapperPath")]
  [string]$RunnerPath = "C:\ZimmetBackend\Run-BackendTask.ps1",
  [string]$LogPath = "C:\ZimmetBackend\backend.log",
  [switch]$AtStartup,
  [switch]$Visible,
  [switch]$RunAsSystem,
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BackendDirectory)) {
  $BackendDirectory = Resolve-Path (Join-Path $PSScriptRoot "..")
}

if (-not (Test-Path -LiteralPath $BackendDirectory)) {
  throw "Backend klasörü bulunamadı: $BackendDirectory"
}

if ([string]::IsNullOrWhiteSpace($NodePath)) {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "node.exe bulunamadı. Node.js kurulu olmalı."
  }
  $NodePath = $node.Source
}

if (-not (Test-Path -LiteralPath $NodePath)) {
  throw "Node bulunamadı: $NodePath"
}

$serverPath = Join-Path $BackendDirectory "src\server.js"
if (-not (Test-Path -LiteralPath $serverPath)) {
  throw "Backend server dosyası bulunamadı: $serverPath"
}

$logDir = Split-Path -Parent $LogPath
if (-not [string]::IsNullOrWhiteSpace($logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

function ConvertTo-PsSingleQuotedLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

$runnerDir = Split-Path -Parent $RunnerPath
if (-not [string]::IsNullOrWhiteSpace($runnerDir)) {
  New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
}

$backendLiteral = ConvertTo-PsSingleQuotedLiteral $BackendDirectory
$nodeLiteral = ConvertTo-PsSingleQuotedLiteral $NodePath
$serverLiteral = ConvertTo-PsSingleQuotedLiteral $serverPath
$logLiteral = ConvertTo-PsSingleQuotedLiteral $LogPath

$runnerContent = @"
`$ErrorActionPreference = "Stop"
`$backendDirectory = $backendLiteral
`$nodePath = $nodeLiteral
`$serverPath = $serverLiteral
`$logPath = $logLiteral

Set-Location -LiteralPath `$backendDirectory

try {
  Add-Content -LiteralPath `$logPath -Value ("[{0}] Backend başlatılıyor." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  & `$nodePath `$serverPath *>> `$logPath
  `$exitCode = if (`$null -eq `$LASTEXITCODE) { 1 } else { [int]`$LASTEXITCODE }
  Add-Content -LiteralPath `$logPath -Value ("[{0}] Backend kapandı. Çıkış kodu: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$exitCode)
  exit `$exitCode
} catch {
  Add-Content -LiteralPath `$logPath -Value ("[{0}] Backend başlatma hatası: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$_.Exception.Message)
  exit 1
}
"@

Set-Content -LiteralPath $RunnerPath -Value $runnerContent -Encoding UTF8

$powershell = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$windowStyle = if ($Visible) { "Normal" } else { "Hidden" }
$runnerArguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle ' +
  $windowStyle + ' -File "' + $RunnerPath + '"'
$action = New-ScheduledTaskAction `
  -Execute $powershell `
  -Argument $runnerArguments `
  -WorkingDirectory $BackendDirectory

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
  -RestartCount 12 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

$registerParams = @{
  TaskName = $TaskName
  Action = $action
  Trigger = $trigger
  Settings = $settings
  Description = "ISTEK Zimmet SQL API backend"
  Force = $true
}

if ($RunAsSystem) {
  $registerParams.Principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest
}

Register-ScheduledTask @registerParams | Out-Null

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
}

[pscustomobject]@{
  success = $true
  taskName = $TaskName
  trigger = if ($AtStartup) { "AtStartup" } else { "AtLogOn" }
  backendDirectory = $BackendDirectory
  nodePath = $NodePath
  logPath = $LogPath
  hidden = -not $Visible
  runnerPath = $RunnerPath
  runAs = if ($RunAsSystem) { "SYSTEM" } else { "CurrentUser" }
  started = [bool]$RunNow
}
