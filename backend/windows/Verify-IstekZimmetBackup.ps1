[CmdletBinding()]
param(
  [ValidatePattern('(?-i)^[A-Za-z0-9_.-]+(\\[A-Za-z0-9_.-]+)?$')]
  [string]$ServerInstance = "localhost\SQLEXPRESS",

  [ValidatePattern('(?-i)^[A-Za-z0-9_]+$')]
  [string]$Database = "IstekZimmet",

  [string]$BackupDirectory = "C:\ZimmetBackup",
  [string]$BackupFile = "",
  [string]$SqlCmdPath = "",
  [bool]$TrustServerCertificate = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-SqlCmdExecutable {
  param([string]$RequestedPath)

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    $candidate = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($RequestedPath))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "sqlcmd bulunamadi: $candidate"
    }
    return $candidate
  }

  $command = Get-Command sqlcmd.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "sqlcmd.exe bulunamadi. SQL Server komut satiri araclarini kurun veya -SqlCmdPath verin."
  }
  return $command.Source
}

$backupRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BackupDirectory)).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
  throw "Backup klasoru bulunamadi: $backupRoot"
}

if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  $latest = Get-ChildItem -LiteralPath $backupRoot -File -Filter ("{0}_full_*.bak" -f $Database) |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latest) {
    throw "Dogrulanacak backup dosyasi bulunamadi: $backupRoot"
  }
  $resolvedBackupFile = $latest.FullName
} else {
  $resolvedBackupFile = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BackupFile))
}

if (-not (Test-Path -LiteralPath $resolvedBackupFile -PathType Leaf)) {
  throw "Backup dosyasi bulunamadi: $resolvedBackupFile"
}
if ([IO.Path]::GetExtension($resolvedBackupFile) -ne ".bak") {
  throw "Yalnizca .bak dosyalari dogrulanabilir: $resolvedBackupFile"
}

$sqlcmd = Resolve-SqlCmdExecutable -RequestedPath $SqlCmdPath
$escapedBackupFile = $resolvedBackupFile.Replace("'", "''")
$query = "RESTORE VERIFYONLY FROM DISK = N'$escapedBackupFile' WITH CHECKSUM;"
$sqlcmdArguments = @(
  "-S", $ServerInstance,
  "-d", "master",
  "-E",
  "-b",
  "-r", "1",
  "-l", "30",
  "-t", "0",
  "-Q", $query
)
if ($TrustServerCertificate) {
  $sqlcmdArguments += "-C"
}

$previousErrorActionPreference = $ErrorActionPreference
try {
  # sqlcmd can write successful RESTORE messages to stderr. Windows PowerShell
  # 5.1 must therefore use the native process exit code as the source of truth.
  $ErrorActionPreference = "Continue"
  $sqlOutput = & $sqlcmd @sqlcmdArguments 2>&1
  $sqlExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($sqlExitCode -ne 0) {
  throw "Backup dogrulamasi basarisiz (ExitCode=$sqlExitCode): $($sqlOutput -join ' ')"
}

$fileInfo = Get-Item -LiteralPath $resolvedBackupFile
[pscustomobject]@{
  success = $true
  serverInstance = $ServerInstance
  database = $Database
  backupFile = $fileInfo.FullName
  bytes = $fileInfo.Length
  verified = $true
  verifiedAt = (Get-Date).ToString("o")
}
