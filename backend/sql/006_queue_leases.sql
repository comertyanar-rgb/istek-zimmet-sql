/*
  OperationQueue ve ADPasswordQueue için süreli iş sahipliği ekler.
  Backend kodunu güncellemeden önce bu migration'ı çalıştırın.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.OperationQueue', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH(N'dbo.OperationQueue', N'LeaseToken') IS NULL
    ALTER TABLE dbo.OperationQueue ADD LeaseToken UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.OperationQueue', N'LeaseExpiresAt') IS NULL
    ALTER TABLE dbo.OperationQueue ADD LeaseExpiresAt DATETIME2 NULL;

  EXEC(N'
    UPDATE dbo.OperationQueue
    SET LeaseExpiresAt = DATEADD(MINUTE, -1, SYSUTCDATETIME())
    WHERE Status = N''ISLENIYOR''
      AND LeaseExpiresAt IS NULL;
  ');
END;

IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
BEGIN
  IF COL_LENGTH(N'dbo.ADPasswordQueue', N'LeaseToken') IS NULL
    ALTER TABLE dbo.ADPasswordQueue ADD LeaseToken UNIQUEIDENTIFIER NULL;
  IF COL_LENGTH(N'dbo.ADPasswordQueue', N'LeaseExpiresAt') IS NULL
    ALTER TABLE dbo.ADPasswordQueue ADD LeaseExpiresAt DATETIME2 NULL;

  EXEC(N'
    UPDATE dbo.ADPasswordQueue
    SET LeaseExpiresAt = DATEADD(MINUTE, -1, SYSUTCDATETIME())
    WHERE Status = N''ISLENIYOR''
      AND LeaseExpiresAt IS NULL;
  ');
END;

COMMIT TRANSACTION;
