[CmdletBinding()]
param(
  [ValidatePattern('(?-i)^[A-Za-z0-9_.-]+(\\[A-Za-z0-9_.-]+)?$')]
  [string]$ServerInstance = "localhost\SQLEXPRESS",

  [ValidatePattern('(?-i)^[A-Za-z0-9_]+$')]
  [string]$SourceDatabase = "IstekZimmet",

  [string]$BackupDirectory = "C:\ZimmetBackup",
  [string]$BackupFile = "",

  [ValidatePattern('(?-i)^[A-Za-z0-9_]+$')]
  [ValidateLength(1, 70)]
  [string]$TestDatabasePrefix = "IstekZimmet_RestoreDrill",

  [string]$SqlCmdPath = "",
  [switch]$KeepRestoredDatabase,
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

function Test-PathInsideDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Directory
  )

  $candidateFull = [IO.Path]::GetFullPath($Candidate)
  $directoryPrefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return $candidateFull.StartsWith($directoryPrefix, [StringComparison]::OrdinalIgnoreCase)
}

function Invoke-SqlCmdChecked {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$Query,
    [switch]$RawRows
  )

  $arguments = @(
    "-S", $ServerInstance,
    "-d", "master",
    "-E",
    "-b",
    "-r", "1",
    "-l", "30",
    "-t", "0"
  )
  if ($RawRows) {
    $arguments += @("-h", "-1", "-W", "-w", "65535", "-s", "|")
  }
  $arguments += @("-Q", $Query)
  if ($TrustServerCertificate) {
    $arguments += "-C"
  }

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 promotes native stderr to NativeCommandError when
    # ErrorActionPreference is Stop. sqlcmd can use stderr for successful status
    # messages as well, therefore its exit code is authoritative here.
    $ErrorActionPreference = "Continue"
    $output = & $Executable @arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "SQL komutu basarisiz (ExitCode=$exitCode): $($output -join ' ')"
  }
  return @($output)
}

function Escape-SqlString {
  param([string]$Value)
  return ([string]$Value).Replace("'", "''")
}

$backupRoot = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BackupDirectory)).TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
  throw "Backup klasoru bulunamadi: $backupRoot"
}

if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  $latest = Get-ChildItem -LiteralPath $backupRoot -File -Filter ("{0}_full_*.bak" -f $SourceDatabase) |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if (-not $latest) {
    throw "Restore edilecek backup dosyasi bulunamadi: $backupRoot"
  }
  $resolvedBackupFile = $latest.FullName
} else {
  $resolvedBackupFile = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($BackupFile))
}

if (-not (Test-PathInsideDirectory -Candidate $resolvedBackupFile -Directory $backupRoot)) {
  throw "Backup dosyasi izin verilen backup klasorunun disinda: $resolvedBackupFile"
}
if (-not (Test-Path -LiteralPath $resolvedBackupFile -PathType Leaf)) {
  throw "Backup dosyasi bulunamadi: $resolvedBackupFile"
}
if ([IO.Path]::GetExtension($resolvedBackupFile) -ne ".bak") {
  throw "Yalnizca .bak dosyalari restore edilebilir: $resolvedBackupFile"
}

$sqlcmd = Resolve-SqlCmdExecutable -RequestedPath $SqlCmdPath
$testDatabase = "{0}_{1}_{2}" -f $TestDatabasePrefix, (Get-Date -Format "yyyyMMdd_HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 6))
if ($testDatabase.Length -gt 128) {
  throw "Olusturulan test veritabani adi 128 karakter sinirini asiyor."
}

$mutex = New-Object System.Threading.Mutex($false, "Global\ISTEK_Zimmet_Restore_Drill")
$mutexAcquired = $false
$createdByThisRun = $false
$restoreStartedAt = Get-Date
$dataFiles = @()
$logFiles = @()

try {
  $mutexAcquired = $mutex.WaitOne(0)
  if (-not $mutexAcquired) {
    throw "Baska bir restore tatbikati halen calisiyor."
  }

  $escapedBackupFile = Escape-SqlString $resolvedBackupFile
  $existingCheck = Invoke-SqlCmdChecked -Executable $sqlcmd -RawRows -Query @"
SET NOCOUNT ON;
SELECT CASE WHEN DB_ID(N'$testDatabase') IS NULL THEN N'FREE' ELSE N'EXISTS' END;
"@
  if (($existingCheck -join '').Trim() -ne "FREE") {
    throw "Test veritabani adi zaten kullanimda: $testDatabase"
  }

  $fileListOutput = Invoke-SqlCmdChecked -Executable $sqlcmd -RawRows -Query @"
SET NOCOUNT ON;
RESTORE FILELISTONLY FROM DISK = N'$escapedBackupFile';
"@

  $backupFiles = @()
  foreach ($line in $fileListOutput) {
    $parts = @($line.ToString().Split('|') | ForEach-Object { $_.Trim() })
    if ($parts.Count -lt 3) { continue }
    if ($parts[2] -notin @('D', 'L')) { continue }
    if ([string]::IsNullOrWhiteSpace($parts[0])) { continue }
    $backupFiles += [pscustomobject]@{
      logicalName = $parts[0]
      type = $parts[2]
    }
  }

  if (-not ($backupFiles | Where-Object { $_.type -eq 'D' })) {
    throw "Backup FILELISTONLY ciktisinda veri dosyasi bulunamadi."
  }
  if (-not ($backupFiles | Where-Object { $_.type -eq 'L' })) {
    throw "Backup FILELISTONLY ciktisinda log dosyasi bulunamadi."
  }

  $pathOutput = Invoke-SqlCmdChecked -Executable $sqlcmd -RawRows -Query @"
SET NOCOUNT ON;
DECLARE @dataPath nvarchar(4000) = CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultDataPath'));
DECLARE @logPath nvarchar(4000) = CONVERT(nvarchar(4000), SERVERPROPERTY('InstanceDefaultLogPath'));
IF NULLIF(@dataPath, N'') IS NULL
  SELECT TOP 1 @dataPath = LEFT(physical_name, LEN(physical_name) - CHARINDEX(N'\', REVERSE(physical_name)) + 1)
  FROM sys.master_files WHERE database_id = 1 AND type = 0;
IF NULLIF(@logPath, N'') IS NULL
  SELECT TOP 1 @logPath = LEFT(physical_name, LEN(physical_name) - CHARINDEX(N'\', REVERSE(physical_name)) + 1)
  FROM sys.master_files WHERE database_id = 1 AND type = 1;
SELECT ISNULL(@dataPath, N'') + N'|' + ISNULL(@logPath, N'');
"@
  $pathParts = @(($pathOutput | Select-Object -First 1).ToString().Split('|'))
  if ($pathParts.Count -lt 2) {
    throw "SQL Server varsayilan veri/log klasorleri belirlenemedi."
  }
  $dataDirectory = $pathParts[0].Trim().TrimEnd('\', '/')
  $logDirectory = $pathParts[1].Trim().TrimEnd('\', '/')
  if (-not $dataDirectory -or -not $logDirectory) {
    throw "SQL Server varsayilan veri/log klasorleri bos dondu."
  }

  $moves = @()
  $dataIndex = 0
  $logIndex = 0
  foreach ($backupFileEntry in $backupFiles) {
    if ($backupFileEntry.type -eq 'D') {
      $dataIndex += 1
      $extension = if ($dataIndex -eq 1) { '.mdf' } else { '.ndf' }
      $targetPath = Join-Path $dataDirectory ("{0}_data_{1}{2}" -f $testDatabase, $dataIndex, $extension)
      $dataFiles += $targetPath
    } else {
      $logIndex += 1
      $targetPath = Join-Path $logDirectory ("{0}_log_{1}.ldf" -f $testDatabase, $logIndex)
      $logFiles += $targetPath
    }

    $logicalName = Escape-SqlString $backupFileEntry.logicalName
    $escapedTargetPath = Escape-SqlString $targetPath
    $moves += "MOVE N'$logicalName' TO N'$escapedTargetPath'"
  }

  $moveClause = $moves -join ",`r`n  "
  $restoreOutput = Invoke-SqlCmdChecked -Executable $sqlcmd -Query @"
SET NOCOUNT ON;
IF DB_ID(N'$testDatabase') IS NOT NULL
  THROW 51000, 'Restore drill veritabani beklenmedik sekilde mevcut.', 1;
RESTORE DATABASE [$testDatabase]
FROM DISK = N'$escapedBackupFile'
WITH
  $moveClause,
  CHECKSUM,
  RECOVERY,
  STATS = 10;
"@
  $createdByThisRun = $true

  $verificationOutput = Invoke-SqlCmdChecked -Executable $sqlcmd -RawRows -Query @"
SET NOCOUNT ON;
IF DB_ID(N'$testDatabase') IS NULL
  THROW 51000, 'Restore drill veritabani olusmadi.', 1;
IF (SELECT state_desc FROM sys.databases WHERE name = N'$testDatabase') <> N'ONLINE'
  THROW 51000, 'Restore drill veritabani ONLINE degil.', 1;
DBCC CHECKDB ([$testDatabase]) WITH NO_INFOMSGS, ALL_ERRORMSGS;
DECLARE @sql nvarchar(max) = N'
  USE [$testDatabase];
  IF OBJECT_ID(N''dbo.Hardware'', N''U'') IS NULL THROW 51000, ''Hardware tablosu yok.'', 1;
  IF OBJECT_ID(N''dbo.Personnel'', N''U'') IS NULL THROW 51000, ''Personnel tablosu yok.'', 1;
  IF OBJECT_ID(N''dbo.SystemLogs'', N''U'') IS NULL THROW 51000, ''SystemLogs tablosu yok.'', 1;
  SELECT
    DB_NAME() AS DatabaseName,
    (SELECT COUNT_BIG(*) FROM dbo.Hardware) AS HardwareCount,
    (SELECT COUNT_BIG(*) FROM dbo.Personnel) AS PersonnelCount,
    (SELECT COUNT_BIG(*) FROM dbo.SystemLogs) AS SystemLogCount,
    CASE WHEN OBJECT_ID(N''dbo.vw_SystemLogChainVerification'', N''V'') IS NULL THEN -1
         ELSE (SELECT COUNT_BIG(*) FROM dbo.vw_SystemLogChainVerification WHERE IsValid = 0)
    END AS InvalidLogCount;';
EXEC sys.sp_executesql @sql;
"@

  $verificationLine = $verificationOutput |
    Where-Object { $_.ToString().Trim().StartsWith($testDatabase + '|') } |
    Select-Object -First 1
  if (-not $verificationLine) {
    throw "Restore dogrulama sayimlari okunamadi."
  }
  $verificationParts = @($verificationLine.ToString().Split('|') | ForEach-Object { $_.Trim() })
  if ($verificationParts.Count -lt 5) {
    throw "Restore dogrulama ciktisi eksik."
  }
  $hardwareCount = [long]$verificationParts[1]
  $personnelCount = [long]$verificationParts[2]
  $systemLogCount = [long]$verificationParts[3]
  $invalidLogCount = [long]$verificationParts[4]
  if ($hardwareCount -le 0 -or $personnelCount -le 0 -or $systemLogCount -le 0) {
    throw "Restore edilen veritabaninda beklenen temel kayitlar bulunamadi. Hardware=$hardwareCount; Personnel=$personnelCount; SystemLogs=$systemLogCount"
  }
  if ($invalidLogCount -ne 0) {
    throw "Restore edilen veritabaninda log zinciri dogrulanamadi. InvalidLogCount=$invalidLogCount"
  }

  [pscustomobject]@{
    success = $true
    serverInstance = $ServerInstance
    sourceDatabase = $SourceDatabase
    testDatabase = $testDatabase
    backupFile = $resolvedBackupFile
    hardwareCount = $hardwareCount
    personnelCount = $personnelCount
    systemLogCount = $systemLogCount
    invalidLogCount = $invalidLogCount
    checkDbPassed = $true
    kept = [bool]$KeepRestoredDatabase
    elapsedSeconds = [math]::Round(((Get-Date) - $restoreStartedAt).TotalSeconds, 2)
    completedAt = (Get-Date).ToString('o')
  }
}
finally {
  if ($createdByThisRun -and -not $KeepRestoredDatabase) {
    try {
      Invoke-SqlCmdChecked -Executable $sqlcmd -Query @"
SET NOCOUNT ON;
IF DB_ID(N'$testDatabase') IS NOT NULL
BEGIN
  ALTER DATABASE [$testDatabase] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  DROP DATABASE [$testDatabase];
END;
"@ | Out-Null
    } catch {
      Write-Error "Restore drill test veritabani temizlenemedi: $testDatabase. $($_.Exception.Message)"
    }
  }

  if ($mutexAcquired -and $mutex) {
    $mutex.ReleaseMutex()
  }
  if ($mutex) {
    $mutex.Dispose()
  }
}
