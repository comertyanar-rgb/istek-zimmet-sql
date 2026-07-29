/*
  Sistem loglarını yeniden zincirler, API kullanıcısının eski kayıtları değiştirmesini
  engeller ve zincir durumunu denetlemek için bir görünüm oluşturur.

  UYARI: Bu işlemden sonra dbo.SystemLogs üzerinde UPDATE/DELETE engellenir.
  Bakım amacıyla silme gerekirse yalnızca SQL yöneticisi önce trigger'ı devre dışı bırakmalıdır.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.TR_SystemLogs_AppendOnly', N'TR') IS NOT NULL
  DROP TRIGGER dbo.TR_SystemLogs_AppendOnly;
GO

BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.SystemLogs', N'FileHash') IS NULL
  ALTER TABLE dbo.SystemLogs ADD FileHash NVARCHAR(128) NULL;

IF COL_LENGTH(N'dbo.SystemLogs', N'DriveLink') IS NULL
  ALTER TABLE dbo.SystemLogs ADD DriveLink NVARCHAR(1000) NULL;

IF COL_LENGTH(N'dbo.SystemLogs', N'ChainHash') IS NULL
  ALTER TABLE dbo.SystemLogs ADD ChainHash NVARCHAR(128) NULL;

DECLARE @lockResult INT;
EXEC @lockResult = sys.sp_getapplock
  @Resource = N'IstekZimmet.SystemLogs.Chain',
  @LockMode = N'Exclusive',
  @LockOwner = N'Transaction',
  @LockTimeout = 30000;

IF @lockResult < 0
  THROW 51000, N'Sistem log zinciri kilidi alınamadı.', 1;

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

ALTER TABLE dbo.SystemLogs ALTER COLUMN ChainHash NVARCHAR(128) NOT NULL;

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = N'CK_SystemLogs_ChainHash'
    AND parent_object_id = OBJECT_ID(N'dbo.SystemLogs')
)
BEGIN
  ALTER TABLE dbo.SystemLogs WITH CHECK
    ADD CONSTRAINT CK_SystemLogs_ChainHash CHECK (LEN(ChainHash) = 64);
END;

COMMIT TRANSACTION;
GO

CREATE OR ALTER TRIGGER dbo.TR_SystemLogs_AppendOnly
ON dbo.SystemLogs
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51001, N'Sistem logları yalnızca eklenebilir; güncellenemez veya silinemez.', 1;
END;
GO

CREATE OR ALTER VIEW dbo.vw_SystemLogChainVerification
AS
WITH ChainRows AS (
  SELECT
    LogId,
    CreatedAt,
    ExecutedBy,
    ActionType,
    Details,
    FileHash,
    DriveLink,
    ChainHash,
    ClientInfo,
    COALESCE(LAG(ChainHash) OVER (ORDER BY LogId), N'GENESIS') AS PreviousHash
  FROM dbo.SystemLogs
), CanonicalRows AS (
  SELECT
    LogId,
    ChainHash,
    UPPER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', CONCAT(
      N'v1',
      N'|prev=', DATALENGTH(PreviousHash), N':', PreviousHash,
      N'|time=', DATALENGTH(CONVERT(NVARCHAR(33), CreatedAt, 126)), N':', CONVERT(NVARCHAR(33), CreatedAt, 126),
      N'|by=', CASE WHEN ExecutedBy IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(ExecutedBy), N':', ExecutedBy) END,
      N'|action=', CASE WHEN ActionType IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(ActionType), N':', ActionType) END,
      N'|details=', CASE WHEN Details IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(Details), N':', Details) END,
      N'|file=', CASE WHEN FileHash IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(FileHash), N':', FileHash) END,
      N'|drive=', CASE WHEN DriveLink IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(DriveLink), N':', DriveLink) END,
      N'|client=', CASE WHEN ClientInfo IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(ClientInfo), N':', ClientInfo) END
    )), 2)) AS ExpectedChainHash
  FROM ChainRows
)
SELECT
  LogId,
  ChainHash,
  ExpectedChainHash,
  CONVERT(BIT, CASE WHEN ChainHash = ExpectedChainHash THEN 1 ELSE 0 END) AS IsValid
FROM CanonicalRows;
GO

IF DATABASE_PRINCIPAL_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT ON dbo.SystemLogs TO zimmet_api;
  DENY UPDATE, DELETE ON dbo.SystemLogs TO zimmet_api;
  GRANT SELECT ON dbo.vw_SystemLogChainVerification TO zimmet_api;
END;
GO
