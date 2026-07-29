# Installs/updates the Windows Scheduled Task for GLPI -> SQL sync.
# Default mode is silent: the task runs wscript.exe, which starts PowerShell hidden.

param(
  [string]$TaskName = "ISTEK Zimmet GLPI Sync",
  [int]$IntervalMinutes = 30,
  [string]$ScriptPath = "",
  [string]$WorkingDirectory = "",
  [string]$RunnerPath = "C:\ZimmetGLPI\Run-GlpiSyncTask.ps1",
  [string]$LogPath = "C:\ZimmetGLPI\glpi-sync.log",
  [switch]$AtStartup,
  [switch]$Visible,
  [switch]$RunAsSystem,
  [switch]$RunNow
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

function ConvertTo-PsSingleQuotedLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

$runnerDir = Split-Path -Parent $RunnerPath
if (-not [string]::IsNullOrWhiteSpace($runnerDir)) {
  New-Item -ItemType Directory -Force -Path $runnerDir | Out-Null
}

$logDir = Split-Path -Parent $LogPath
if (-not [string]::IsNullOrWhiteSpace($logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

$pwshLiteral = ConvertTo-PsSingleQuotedLiteral $pwsh.Source
$scriptLiteral = ConvertTo-PsSingleQuotedLiteral ([string]$ScriptPath)
$workingDirectoryLiteral = ConvertTo-PsSingleQuotedLiteral $WorkingDirectory
$logLiteral = ConvertTo-PsSingleQuotedLiteral $LogPath

$runnerContent = @"
`$ErrorActionPreference = "Stop"
`$pwshPath = $pwshLiteral
`$scriptPath = $scriptLiteral
`$workingDirectory = $workingDirectoryLiteral
`$logPath = $logLiteral

Set-Location -LiteralPath `$workingDirectory

try {
  Add-Content -LiteralPath `$logPath -Value ("[{0}] GLPI senkronizasyonu baslatiliyor." -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
  & `$pwshPath -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `$scriptPath *>> `$logPath
  `$exitCode = if (`$null -eq `$LASTEXITCODE) { 0 } else { [int]`$LASTEXITCODE }
  Add-Content -LiteralPath `$logPath -Value ("[{0}] GLPI senkronizasyonu tamamlandi. Cikis kodu: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$exitCode)
  exit `$exitCode
} catch {
  Add-Content -LiteralPath `$logPath -Value ("[{0}] GLPI senkronizasyonu hatasi: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$_.Exception.Message)
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
  -WorkingDirectory $WorkingDirectory

$triggers = @()
$triggers += New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration ([TimeSpan]::FromDays(3650))
if ($AtStartup) {
  $triggers += New-ScheduledTaskTrigger -AtStartup
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

$registerParams = @{
  TaskName = $TaskName
  Action = $action
  Trigger = $triggers
  Settings = $settings
  Description = "ISTEK Zimmet GLPI -> SQL senkronizasyonu"
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
  intervalMinutes = $IntervalMinutes
  scriptPath = $ScriptPath
  hidden = -not $Visible
  runnerPath = $RunnerPath
  logPath = $LogPath
  atStartup = [bool]$AtStartup
  runAs = if ($RunAsSystem) { "SYSTEM" } else { "CurrentUser" }
  started = [bool]$RunNow
}
