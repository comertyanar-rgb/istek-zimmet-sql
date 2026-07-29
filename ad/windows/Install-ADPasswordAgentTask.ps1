# Installs/updates the Windows Scheduled Task for SQL -> Active Directory
# password reset jobs. The task can run under a dedicated domain account.

param(
  [string]$TaskName = "ISTEK Zimmet AD Password Agent",
  [int]$IntervalMinutes = 1,
  [string]$ScriptPath = "",
  [string]$WorkingDirectory = "",
  [Alias("WrapperPath")]
  [string]$RunnerPath = "C:\ZimmetAD\Run-ADPasswordAgentTask.ps1",
  [string]$LogPath = "C:\ZimmetAD\ad-agent.log",
  [int]$Limit = 5,
  [string]$RunAsUser = "",
  [System.Management.Automation.PSCredential]$Credential,
  [switch]$AtStartup,
  [switch]$Visible,
  [switch]$WhatIfOnly,
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if ($IntervalMinutes -lt 1) {
  throw "IntervalMinutes en az 1 olmali."
}
if ($Limit -lt 1 -or $Limit -gt 20) {
  throw "Limit 1 ile 20 arasinda olmali."
}

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  $ScriptPath = Resolve-Path (Join-Path $PSScriptRoot "Run-ADPasswordAgent.ps1")
}
if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "Script bulunamadi: $ScriptPath"
}

if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
  $WorkingDirectory = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}
if (-not (Test-Path -LiteralPath $WorkingDirectory)) {
  throw "Calisma klasoru bulunamadi: $WorkingDirectory"
}

$pwsh = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $pwsh) {
  throw "PowerShell 7 (pwsh.exe) bulunamadi."
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
$limitLiteral = [int]$Limit
$whatIfLiteral = if ($WhatIfOnly) { '$true' } else { '$false' }

$runnerContent = @"
`$ErrorActionPreference = "Stop"
`$pwshPath = $pwshLiteral
`$scriptPath = $scriptLiteral
`$workingDirectory = $workingDirectoryLiteral
`$logPath = $logLiteral
`$limit = $limitLiteral
`$whatIfOnly = $whatIfLiteral

Set-Location -LiteralPath `$workingDirectory

try {
  if (Test-Path -LiteralPath `$logPath) {
    `$logFile = Get-Item -LiteralPath `$logPath
    if (`$logFile.Length -gt 5MB) {
      Move-Item -LiteralPath `$logPath -Destination ("{0}.1" -f `$logPath) -Force
    }
  }

  `$agentArguments = @(
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", `$scriptPath,
    "-Limit", `$limit,
    "-QuietWhenIdle"
  )
  if (`$whatIfOnly) {
    `$agentArguments += "-WhatIfOnly"
  }

  `$output = (& `$pwshPath @agentArguments *>&1 | Out-String).Trim()
  `$exitCode = if (`$null -eq `$LASTEXITCODE) { 0 } else { [int]`$LASTEXITCODE }

  if (-not [string]::IsNullOrWhiteSpace(`$output)) {
    Add-Content -LiteralPath `$logPath -Value ("[{0}]`r`n{1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$output)
  }
  if (`$exitCode -ne 0) {
    Add-Content -LiteralPath `$logPath -Value ("[{0}] AD agent cikis kodu: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$exitCode)
  }
  exit `$exitCode
} catch {
  Add-Content -LiteralPath `$logPath -Value ("[{0}] AD agent hatasi: {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `$_.Exception.Message)
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
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

$registerParams = @{
  TaskName = $TaskName
  Action = $action
  Trigger = $triggers
  Settings = $settings
  Description = "ISTEK Zimmet SQL AD sifre sifirlama ajani"
  Force = $true
}

if ($Credential -and [string]::IsNullOrWhiteSpace($RunAsUser)) {
  $RunAsUser = $Credential.UserName
}

if (-not [string]::IsNullOrWhiteSpace($RunAsUser)) {
  if (-not $Credential) {
    $Credential = Get-Credential `
      -UserName $RunAsUser `
      -Message "AD parola ajaninin calisacagi servis hesabini girin."
  }
  if ([string]::IsNullOrWhiteSpace($Credential.UserName)) {
    throw "Servis hesabi kullanici adi bos."
  }

  $plainPassword = $Credential.GetNetworkCredential().Password
  try {
    Register-ScheduledTask @registerParams `
      -User $Credential.UserName `
      -Password $plainPassword `
      -RunLevel Limited | Out-Null
  } finally {
    $plainPassword = $null
    $Credential = $null
  }
  $registeredUser = $RunAsUser
} else {
  Write-Warning "RunAsUser verilmedi; gorev mevcut kullanici baglaminda kaydedilecek."
  Register-ScheduledTask @registerParams | Out-Null
  $registeredUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
}

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
  runAs = $registeredUser
  whatIfOnly = [bool]$WhatIfOnly
  started = [bool]$RunNow
}
