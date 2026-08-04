/*
  Tek seferlik bakım:
  - Gürültü oluşturan PERSONEL SYNC kayıtlarını siler.
  - Kalan denetim kayıtlarının SHA-256 zincirini yeniden kurar.
  - Yapılan temizliği tek bir denetim kaydıyla belgeler.

  SQL yöneticisi olarak ve uygulama güncellendikten sonra çalıştırın.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

BEGIN TRANSACTION;

DECLARE @lockResult INT;
EXEC @lockResult = sys.sp_getapplock
  @Resource = N'IstekZimmet.SystemLogs.Chain',
  @LockMode = N'Exclusive',
  @LockOwner = N'Transaction',
  @LockTimeout = 30000;

IF @lockResult < 0
  THROW 51000, N'Sistem log zinciri kilidi alınamadı.', 1;

IF OBJECT_ID(N'dbo.TR_SystemLogs_AppendOnly', N'TR') IS NOT NULL
  DISABLE TRIGGER dbo.TR_SystemLogs_AppendOnly ON dbo.SystemLogs;

DECLARE
  @deletedCount INT,
  @deletedMaintenanceCount INT,
  @previousDeletedCount BIGINT = 0,
  @totalDeletedCount BIGINT;

SELECT @previousDeletedCount = COALESCE(SUM(
  TRY_CONVERT(BIGINT, LEFT(Details, NULLIF(CHARINDEX(N' ', Details), 0) - 1))
), 0)
FROM dbo.SystemLogs
WHERE ClientInfo = N'017_prune_personnel_sync_logs.sql';

DELETE FROM dbo.SystemLogs
WHERE ActionType = N'PERSONEL SYNC';

SET @deletedCount = @@ROWCOUNT;

DELETE FROM dbo.SystemLogs
WHERE ClientInfo = N'017_prune_personnel_sync_logs.sql';

SET @deletedMaintenanceCount = @@ROWCOUNT;
SET @totalDeletedCount = @previousDeletedCount + @deletedCount;

DECLARE
  @logId BIGINT,
  @createdAt DATETIME2(0),
  @executedBy NVARCHAR(320),
  @actionType NVARCHAR(120),
  @details NVARCHAR(MAX),
  @fileHash NVARCHAR(128),
  @driveLink NVARCHAR(1000),
  @clientInfo NVARCHAR(MAX),
  @previousHash NVARCHAR(128) = N'GENESIS',
  @createdAtText NVARCHAR(33),
  @canonical NVARCHAR(MAX),
  @chainHash NVARCHAR(128);

DECLARE log_cursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT LogId, CreatedAt, ExecutedBy, ActionType, Details, FileHash, DriveLink, ClientInfo
  FROM dbo.SystemLogs
  ORDER BY LogId;

OPEN log_cursor;
FETCH NEXT FROM log_cursor INTO
  @logId, @createdAt, @executedBy, @actionType, @details, @fileHash, @driveLink, @clientInfo;

WHILE @@FETCH_STATUS = 0
BEGIN
  SET @createdAtText = CONVERT(NVARCHAR(33), @createdAt, 126);
  SET @canonical = CONCAT(
    N'v1',
    N'|prev=', DATALENGTH(@previousHash), N':', @previousHash,
    N'|time=', DATALENGTH(@createdAtText), N':', @createdAtText,
    N'|by=', CASE WHEN @executedBy IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@executedBy), N':', @executedBy) END,
    N'|action=', CASE WHEN @actionType IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@actionType), N':', @actionType) END,
    N'|details=', CASE WHEN @details IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@details), N':', @details) END,
    N'|file=', CASE WHEN @fileHash IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@fileHash), N':', @fileHash) END,
    N'|drive=', CASE WHEN @driveLink IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@driveLink), N':', @driveLink) END,
    N'|client=', CASE WHEN @clientInfo IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@clientInfo), N':', @clientInfo) END
  );
  SET @chainHash = UPPER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @canonical), 2));

  UPDATE dbo.SystemLogs SET ChainHash = @chainHash WHERE LogId = @logId;
  SET @previousHash = @chainHash;

  FETCH NEXT FROM log_cursor INTO
    @logId, @createdAt, @executedBy, @actionType, @details, @fileHash, @driveLink, @clientInfo;
END;

CLOSE log_cursor;
DEALLOCATE log_cursor;

SET @createdAt = SYSUTCDATETIME();
SET @executedBy = N'SQL Bakım';
SET @actionType = N'SISTEM LOG BAKIMI';
SET @details = CONCAT(@totalDeletedCount, N' gereksiz PERSONEL SYNC kaydi temizlendi; kalan zincir yeniden olusturuldu.');
SET @fileHash = NULL;
SET @driveLink = NULL;
SET @clientInfo = N'017_prune_personnel_sync_logs.sql';
SET @createdAtText = CONVERT(NVARCHAR(33), @createdAt, 126);
SET @canonical = CONCAT(
  N'v1',
  N'|prev=', DATALENGTH(@previousHash), N':', @previousHash,
  N'|time=', DATALENGTH(@createdAtText), N':', @createdAtText,
  N'|by=', DATALENGTH(@executedBy), N':', @executedBy,
  N'|action=', DATALENGTH(@actionType), N':', @actionType,
  N'|details=', DATALENGTH(@details), N':', @details,
  N'|file=-1:',
  N'|drive=-1:',
  N'|client=', DATALENGTH(@clientInfo), N':', @clientInfo
);
SET @chainHash = UPPER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @canonical), 2));

INSERT INTO dbo.SystemLogs (
  CreatedAt, ExecutedBy, ActionType, Details, FileHash, DriveLink, ChainHash, ClientInfo
)
VALUES (
  @createdAt, @executedBy, @actionType, @details, @fileHash, @driveLink, @chainHash, @clientInfo
);

IF OBJECT_ID(N'dbo.TR_SystemLogs_AppendOnly', N'TR') IS NOT NULL
  ENABLE TRIGGER dbo.TR_SystemLogs_AppendOnly ON dbo.SystemLogs;

COMMIT TRANSACTION;

SELECT
  @deletedCount AS DeletedPersonnelSyncLogs,
  @totalDeletedCount AS CumulativeDeletedPersonnelSyncLogs,
  @deletedMaintenanceCount AS ReplacedMaintenanceLogs,
  COUNT_BIG(*) AS RemainingSystemLogs
FROM dbo.SystemLogs;

SELECT COUNT_BIG(*) AS InvalidChainRows
FROM dbo.vw_SystemLogChainVerification
WHERE IsValid = 0;
