[CmdletBinding()]
param(
  [ValidatePattern('(?-i)^[A-Za-z0-9_.-]+(\\[A-Za-z0-9_.-]+)?$')]
  [string]$ServerInstance = "localhost\SQLEXPRESS",

  [ValidatePattern('(?-i)^[A-Za-z0-9_]+$')]
  [string]$Database = "IstekZimmet",

  [string]$BackupDirectory = "C:\ZimmetBackup",

  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 30,

  [string]$SqlCmdPath = "",
  [string]$LogPath = "",
  [switch]$UseCompression,
  [switch]$SkipCleanup,
  [bool]$TrustServerCertificate = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-SafeDirectory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Backup klasoru bos olamaz."
  }

  $expanded = [Environment]::ExpandEnvironmentVariables($Path.Trim())
  if (-not [IO.Path]::IsPathRooted($expanded)) {
    throw "Backup klasoru mutlak bir yol olmali: $expanded"
  }

  $fullPath = [IO.Path]::GetFullPath($expanded).TrimEnd('\', '/')
  $volumeRoot = [IO.Path]::GetPathRoot($fullPath).TrimEnd('\', '/')
  if ($fullPath.Equals($volumeRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Disk kok dizini backup klasoru olarak kullanilamaz: $fullPath"
  }

  New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
  return (Get-Item -LiteralPath $fullPath).FullName.TrimEnd('\', '/')
}

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

function Test-PathInsideDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Directory
  )

  $candidateFull = [IO.Path]::GetFullPath($Candidate)
  $directoryPrefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return $candidateFull.StartsWith($directoryPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Write-BackupLog {
  param(
    [string]$Path,
    [string]$Level,
    [string]$Message
  )

  if ([string]::IsNullOrWhiteSpace($Path)) { return }

  $logDirectory = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($logDirectory)) {
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  }

  if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -gt 5MB) {
    $archivePath = "$Path.previous"
    if (Test-Path -LiteralPath $archivePath) {
      Remove-Item -LiteralPath $archivePath -Force
    }
    Move-Item -LiteralPath $Path -Destination $archivePath -Force
  }

  $line = "{0} [{1}] {2}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Level.ToUpperInvariant(), $Message
  Add-Content -LiteralPath $Path -Value $line -Encoding UTF8
}

$backupRoot = $null
$backupFile = $null
$resolvedLogPath = $null
$mutex = $null
$mutexAcquired = $false

try {
  $backupRoot = Resolve-SafeDirectory -Path $BackupDirectory
  $resolvedLogPath = if ([string]::IsNullOrWhiteSpace($LogPath)) {
    Join-Path $backupRoot "backup-history.log"
  } else {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($LogPath))
  }

  $safeMutexDatabase = $Database -replace '[^A-Za-z0-9_]', '_'
  $mutex = New-Object System.Threading.Mutex($false, "Global\ISTEK_Zimmet_Backup_$safeMutexDatabase")
  $mutexAcquired = $mutex.WaitOne(0)
  if (-not $mutexAcquired) {
    throw "Ayni veritabani icin baska bir backup islemi halen calisiyor."
  }

  $sqlcmd = Resolve-SqlCmdExecutable -RequestedPath $SqlCmdPath
  $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $backupFile = Join-Path $backupRoot ("{0}_full_{1}.bak" -f $Database, $timestamp)

  if (-not (Test-PathInsideDirectory -Candidate $backupFile -Directory $backupRoot)) {
    throw "Olusturulacak backup dosyasi izin verilen klasorun disinda."
  }

  $escapedBackupFile = $backupFile.Replace("'", "''")
  $backupOptions = "COPY_ONLY, INIT, CHECKSUM, STATS = 10"
  if ($UseCompression) {
    $backupOptions += ", COMPRESSION"
  }

  $query = @"
SET NOCOUNT ON;
IF DB_ID(N'$Database') IS NULL
  THROW 51000, 'Backup alinacak veritabani bulunamadi.', 1;
BACKUP DATABASE [$Database]
  TO DISK = N'$escapedBackupFile'
  WITH $backupOptions;
RESTORE VERIFYONLY
  FROM DISK = N'$escapedBackupFile'
  WITH CHECKSUM;
"@

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
    # Windows PowerShell 5.1 turns any native stderr line into a terminating
    # NativeCommandError when ErrorActionPreference is Stop. sqlcmd -r 1 also
    # writes some successful RESTORE messages to stderr, so trust its exit code.
    $ErrorActionPreference = "Continue"
    $sqlOutput = & $sqlcmd @sqlcmdArguments 2>&1
    $sqlExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($sqlExitCode -ne 0) {
    throw "SQL backup veya VERIFYONLY basarisiz (ExitCode=$sqlExitCode): $($sqlOutput -join ' ')"
  }

  if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf)) {
    throw "SQL Server basarili dondu ancak backup dosyasi bulunamadi: $backupFile"
  }

  $backupInfo = Get-Item -LiteralPath $backupFile
  if ($backupInfo.Length -le 0) {
    throw "Olusturulan backup dosyasi bos: $backupFile"
  }

  $removedFiles = @()
  if (-not $SkipCleanup) {
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-$RetentionDays)
    $namePattern = "{0}_full_*.bak" -f $Database
    $cleanupCandidates = Get-ChildItem -LiteralPath $backupRoot -File -Filter $namePattern |
      Where-Object { $_.LastWriteTimeUtc -lt $cutoff }

    foreach ($candidate in $cleanupCandidates) {
      if (-not (Test-PathInsideDirectory -Candidate $candidate.FullName -Directory $backupRoot)) {
        throw "Silme adayi backup klasoru disinda: $($candidate.FullName)"
      }
      if ($candidate.Extension -ne ".bak" -or $candidate.Name -notlike $namePattern) {
        throw "Beklenmeyen dosya temizleme adayi olarak geldi: $($candidate.Name)"
      }

      Remove-Item -LiteralPath $candidate.FullName -Force
      $removedFiles += $candidate.Name
    }
  }

  Write-BackupLog -Path $resolvedLogPath -Level "INFO" -Message (
    "Backup tamamlandi ve dogrulandi. Database={0}; File={1}; Bytes={2}; Removed={3}" -f
      $Database, $backupInfo.Name, $backupInfo.Length, $removedFiles.Count
  )

  [pscustomobject]@{
    success = $true
    serverInstance = $ServerInstance
    database = $Database
    backupFile = $backupInfo.FullName
    bytes = $backupInfo.Length
    verified = $true
    retentionDays = $RetentionDays
    removedCount = $removedFiles.Count
    removedFiles = $removedFiles
    completedAt = (Get-Date).ToString("o")
  }
}
catch {
  if (
    $backupFile -and
    $backupRoot -and
    (Test-Path -LiteralPath $backupFile -PathType Leaf) -and
    (Test-PathInsideDirectory -Candidate $backupFile -Directory $backupRoot)
  ) {
    Remove-Item -LiteralPath $backupFile -Force -ErrorAction SilentlyContinue
  }

  try {
    Write-BackupLog -Path $resolvedLogPath -Level "ERROR" -Message $_.Exception.Message
  } catch {
    # The original backup error is more important than a secondary log error.
  }
  throw
}
finally {
  if ($mutexAcquired -and $mutex) {
    $mutex.ReleaseMutex()
  }
  if ($mutex) {
    $mutex.Dispose()
  }
}
