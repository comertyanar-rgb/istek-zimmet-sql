USE IstekZimmet;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

/*
  Nihai durumdaki gecici kuyruk kayitlarini kucuk partiler halinde temizler.
  SystemLogs ve HardwareHistory bu politikanin disindadir ve silinmez.
*/

IF OBJECT_ID(N'dbo.OperationQueue', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.OperationQueue')
       AND name = N'IX_OperationQueue_FinalRetention'
   )
BEGIN
  CREATE INDEX IX_OperationQueue_FinalRetention
    ON dbo.OperationQueue(Status, FinishedAt, QueueId)
    WHERE FinishedAt IS NOT NULL;
END;
GO

IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.ADPasswordQueue')
       AND name = N'IX_ADPasswordQueue_FinalRetention'
   )
BEGIN
  CREATE INDEX IX_ADPasswordQueue_FinalRetention
    ON dbo.ADPasswordQueue(Status, FinishedAt, QueueId)
    WHERE FinishedAt IS NOT NULL;
END;
GO

IF OBJECT_ID(N'dbo.SignatureJobs', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.SignatureJobs')
       AND name = N'IX_SignatureJobs_FinalRetention'
   )
BEGIN
  CREATE INDEX IX_SignatureJobs_FinalRetention
    ON dbo.SignatureJobs(Status, UpdatedAt, JobId);
END;
GO

CREATE OR ALTER PROCEDURE dbo.PruneZimmetTransientData
  @OperationRetentionDays INT = 30,
  @AdRetentionDays INT = 30,
  @SignatureRetentionDays INT = 30,
  @BatchSize INT = 500
AS
BEGIN
  SET NOCOUNT ON;

  IF @OperationRetentionDays < 7 OR @OperationRetentionDays > 3650
    THROW 51020, N'OperationQueue saklama suresi 7-3650 gun arasinda olmali.', 1;
  IF @AdRetentionDays < 7 OR @AdRetentionDays > 3650
    THROW 51021, N'ADPasswordQueue saklama suresi 7-3650 gun arasinda olmali.', 1;
  IF @SignatureRetentionDays < 7 OR @SignatureRetentionDays > 3650
    THROW 51022, N'SignatureJobs saklama suresi 7-3650 gun arasinda olmali.', 1;
  IF @BatchSize < 1 OR @BatchSize > 5000
    THROW 51023, N'Temizlik batch boyutu 1-5000 arasinda olmali.', 1;

  DECLARE @now DATETIME2(0) = SYSUTCDATETIME();
  DECLARE @operationDeleted INT = 0;
  DECLARE @adDeleted INT = 0;
  DECLARE @signatureDeleted INT = 0;
  DECLARE @sessionDeleted INT = 0;
  DECLARE @nonceDeleted INT = 0;

  IF OBJECT_ID(N'dbo.OperationQueue', N'U') IS NOT NULL
  BEGIN
    ;WITH DeleteCandidates AS (
      SELECT TOP (@BatchSize) QueueId
      FROM dbo.OperationQueue WITH (READPAST, ROWLOCK)
      WHERE Status IN (N'TAMAMLANDI', N'HATA')
        AND FinishedAt IS NOT NULL
        AND FinishedAt < DATEADD(DAY, -@OperationRetentionDays, @now)
      ORDER BY FinishedAt, QueueId
    )
    DELETE q
    FROM dbo.OperationQueue q
    INNER JOIN DeleteCandidates d ON d.QueueId = q.QueueId;
    SET @operationDeleted = @@ROWCOUNT;
  END;

  IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
  BEGIN
    ;WITH DeleteCandidates AS (
      SELECT TOP (@BatchSize) QueueId
      FROM dbo.ADPasswordQueue WITH (READPAST, ROWLOCK)
      WHERE Status IN (N'TAMAMLANDI', N'HATA')
        AND FinishedAt IS NOT NULL
        AND FinishedAt < DATEADD(DAY, -@AdRetentionDays, @now)
      ORDER BY FinishedAt, QueueId
    )
    DELETE q
    FROM dbo.ADPasswordQueue q
    INNER JOIN DeleteCandidates d ON d.QueueId = q.QueueId;
    SET @adDeleted = @@ROWCOUNT;
  END;

  IF OBJECT_ID(N'dbo.SignatureJobs', N'U') IS NOT NULL
  BEGIN
    ;WITH DeleteCandidates AS (
      SELECT TOP (@BatchSize) JobId
      FROM dbo.SignatureJobs WITH (READPAST, ROWLOCK)
      WHERE Status IN (N'TAMAMLANDI', N'HATA', N'IPTAL')
        AND UpdatedAt < DATEADD(DAY, -@SignatureRetentionDays, @now)
      ORDER BY UpdatedAt, JobId
    )
    DELETE j
    FROM dbo.SignatureJobs j
    INNER JOIN DeleteCandidates d ON d.JobId = j.JobId;
    SET @signatureDeleted = @@ROWCOUNT;
  END;

  IF OBJECT_ID(N'dbo.Sessions', N'U') IS NOT NULL
  BEGIN
    ;WITH DeleteCandidates AS (
      SELECT TOP (@BatchSize) SessionToken
      FROM dbo.Sessions WITH (READPAST, ROWLOCK)
      WHERE ExpiresAt < DATEADD(DAY, -1, @now)
      ORDER BY ExpiresAt
    )
    DELETE s
    FROM dbo.Sessions s
    INNER JOIN DeleteCandidates d ON d.SessionToken = s.SessionToken;
    SET @sessionDeleted = @@ROWCOUNT;
  END;

  IF OBJECT_ID(N'dbo.AgentRequestNonces', N'U') IS NOT NULL
  BEGIN
    ;WITH DeleteCandidates AS (
      SELECT TOP (@BatchSize) NonceHash
      FROM dbo.AgentRequestNonces WITH (READPAST, ROWLOCK)
      WHERE ExpiresAt <= @now
      ORDER BY ExpiresAt
    )
    DELETE n
    FROM dbo.AgentRequestNonces n
    INNER JOIN DeleteCandidates d ON d.NonceHash = n.NonceHash;
    SET @nonceDeleted = @@ROWCOUNT;
  END;

  SELECT
    @operationDeleted AS OperationDeleted,
    @adDeleted AS AdPasswordDeleted,
    @signatureDeleted AS SignatureDeleted,
    @sessionDeleted AS SessionDeleted,
    @nonceDeleted AS NonceDeleted,
    @now AS CleanedAt;
END;
GO

IF USER_ID(N'zimmet_api') IS NOT NULL
  GRANT EXECUTE ON dbo.PruneZimmetTransientData TO zimmet_api;
GO
