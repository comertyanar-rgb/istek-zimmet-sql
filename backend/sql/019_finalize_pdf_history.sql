USE IstekZimmet;
GO

/*
  PDF Google Drive'a teslim edildikten sonra cihaz bağlantısını ve bekleyen
  geçmiş kaydını tek işlemde tamamlar. API hesabının HardwareHistory üzerinde
  doğrudan UPDATE yetkisi yoktur; yalnızca bu dar kapsamlı prosedürü çalıştırır.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

CREATE OR ALTER PROCEDURE dbo.FinalizeHardwarePdfHistory
  @QueuePublicId NVARCHAR(80),
  @DriveLink NVARCHAR(1000),
  @PdfHash NVARCHAR(128) = NULL,
  @Delivery NVARCHAR(40) = NULL
WITH EXECUTE AS OWNER
AS
BEGIN
  SET XACT_ABORT ON;
  SET NOCOUNT ON;

  SET @QueuePublicId = NULLIF(LTRIM(RTRIM(@QueuePublicId)), N'');
  SET @DriveLink = NULLIF(LTRIM(RTRIM(@DriveLink)), N'');
  SET @PdfHash = NULLIF(UPPER(LTRIM(RTRIM(@PdfHash))), N'');
  SET @Delivery = NULLIF(LTRIM(RTRIM(@Delivery)), N'');

  IF @QueuePublicId IS NULL OR LEN(@QueuePublicId) > 80
    THROW 51060, N'PDF kuyruk kimliği geçersiz.', 1;
  IF @DriveLink IS NULL OR LEN(@DriveLink) > 1000
    THROW 51061, N'PDF Drive bağlantısı geçersiz.', 1;
  IF @PdfHash IS NOT NULL AND (LEN(@PdfHash) <> 64 OR @PdfHash LIKE N'%[^0-9A-F]%')
    THROW 51062, N'PDF SHA-256 özeti geçersiz.', 1;

  DECLARE @ActionType NVARCHAR(120);
  DECLARE @PayloadJson NVARCHAR(MAX);
  DECLARE @CreatedBy NVARCHAR(320);
  DECLARE @PersonId NVARCHAR(160);
  DECLARE @PersonName NVARCHAR(240);
  DECLARE @PdfName NVARCHAR(260);
  DECLARE @EventType NVARCHAR(120);

  SELECT TOP (1)
    @ActionType = ActionType,
    @PayloadJson = PayloadJson,
    @CreatedBy = RequestedBy
  FROM dbo.OperationQueue
  WHERE PublicId = @QueuePublicId
    AND Status = N'ISLENIYOR';

  IF @ActionType IS NULL OR @ActionType NOT IN (
    N'GENERATE_ZIMMET_PDF',
    N'GENERATE_RETURN_PDF',
    N'GENERATE_TRANSFER_PDF'
  )
    THROW 51063, N'İşlenmekte olan PDF kuyruğu bulunamadı.', 1;
  IF ISJSON(@PayloadJson) <> 1
    THROW 51064, N'PDF kuyruk verisi geçersiz.', 1;

  SET @PersonId = NULLIF(JSON_VALUE(@PayloadJson, N'$.person.id'), N'');
  SET @PersonName = NULLIF(JSON_VALUE(@PayloadJson, N'$.person.name'), N'');
  SET @PdfName = NULLIF(JSON_VALUE(@PayloadJson, N'$.pdfName'), N'');
  SET @EventType = CASE @ActionType
    WHEN N'GENERATE_ZIMMET_PDF' THEN N'Zimmet PDF Belgesi Oluşturuldu'
    WHEN N'GENERATE_RETURN_PDF' THEN N'İade PDF Belgesi Oluşturuldu'
    WHEN N'GENERATE_TRANSFER_PDF' THEN N'Transfer PDF Belgesi Oluşturuldu'
  END;

  DECLARE @HardwareIds TABLE (
    HardwareId INT NOT NULL PRIMARY KEY
  );

  INSERT INTO @HardwareIds (HardwareId)
  SELECT DISTINCT HardwareId
  FROM OPENJSON(@PayloadJson, N'$.hardware')
  WITH (HardwareId INT '$.hardwareId')
  WHERE HardwareId IS NOT NULL AND HardwareId > 0;

  DECLARE @HardwareCount INT = (SELECT COUNT(*) FROM @HardwareIds);
  IF @HardwareCount = 0
    THROW 51065, N'PDF kuyruğunda cihaz bulunamadı.', 1;

  DECLARE @DetailsJson NVARCHAR(MAX) = (
    SELECT
      @QueuePublicId AS queueId,
      @ActionType AS actionType,
      N'PDF hazırlandı' AS documentStatus,
      ISNULL(@PdfHash, N'') AS pdfHash,
      ISNULL(@Delivery, N'') AS delivery,
      @DriveLink AS url,
      ISNULL(@PdfName, N'') AS pdfName
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
  );

  BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE hardware
    SET DriveLink = @DriveLink,
        UpdatedAt = SYSUTCDATETIME()
    FROM dbo.Hardware hardware
    INNER JOIN @HardwareIds requested ON requested.HardwareId = hardware.HardwareId;

    IF @@ROWCOUNT <> @HardwareCount
      THROW 51066, N'PDF bağlantısı yazılacak cihazlardan bazıları bulunamadı.', 1;

    ;WITH RankedHistory AS (
      SELECT
        history.HistoryId,
        ROW_NUMBER() OVER (
          PARTITION BY history.HardwareId
          ORDER BY history.EventDate DESC, history.HistoryId DESC
        ) AS RowNumber
      FROM dbo.HardwareHistory history
      INNER JOIN @HardwareIds requested ON requested.HardwareId = history.HardwareId
      WHERE CASE
              WHEN ISJSON(history.DetailsJson) = 1
                THEN JSON_VALUE(history.DetailsJson, N'$.queueId')
              ELSE NULL
            END = @QueuePublicId
    )
    UPDATE history
    SET EventType = @EventType,
        PersonId = COALESCE(@PersonId, history.PersonId),
        PersonName = COALESCE(@PersonName, history.PersonName),
        DriveLink = @DriveLink,
        DetailsJson = @DetailsJson,
        CreatedBy = COALESCE(@CreatedBy, history.CreatedBy)
    FROM dbo.HardwareHistory history
    INNER JOIN RankedHistory ranked
      ON ranked.HistoryId = history.HistoryId
     AND ranked.RowNumber = 1;

    INSERT INTO dbo.HardwareHistory (
      HardwareId,
      EventType,
      PersonId,
      PersonName,
      DriveLink,
      DetailsJson,
      CreatedBy
    )
    SELECT
      requested.HardwareId,
      @EventType,
      @PersonId,
      @PersonName,
      @DriveLink,
      @DetailsJson,
      @CreatedBy
    FROM @HardwareIds requested
    WHERE NOT EXISTS (
      SELECT 1
      FROM dbo.HardwareHistory history
      WHERE history.HardwareId = requested.HardwareId
        AND CASE
              WHEN ISJSON(history.DetailsJson) = 1
                THEN JSON_VALUE(history.DetailsJson, N'$.queueId')
              ELSE NULL
            END = @QueuePublicId
    );

    COMMIT TRANSACTION;

    SELECT
      @QueuePublicId AS QueuePublicId,
      @HardwareCount AS HardwareCount,
      @DriveLink AS DriveLink;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;
GO

IF USER_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.FinalizeHardwarePdfHistory TO zimmet_api;
END;
GO
