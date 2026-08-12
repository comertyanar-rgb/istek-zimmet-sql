USE IstekZimmet;
GO

/*
  Adds wide-name signature variants to the existing title administration flow.
  Fresh installations also receive this validation from migration 018.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

CREATE OR ALTER PROCEDURE dbo.AdminSaveSignatureTitle
  @ActorEmail NVARCHAR(320),
  @TitleId INT = NULL,
  @TitleTr NVARCHAR(240),
  @TitleEn NVARCHAR(240) = NULL,
  @TemplateKey NVARCHAR(20),
  @IsActive BIT
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @cleanActor NVARCHAR(320) = LOWER(LTRIM(RTRIM(ISNULL(@ActorEmail, N''))));
  DECLARE @cleanTitleTr NVARCHAR(240) = LTRIM(RTRIM(ISNULL(@TitleTr, N'')));
  DECLARE @cleanTitleEn NVARCHAR(240) = NULLIF(LTRIM(RTRIM(ISNULL(@TitleEn, N''))), N'');
  DECLARE @cleanTemplateKey NVARCHAR(20) = LTRIM(RTRIM(ISNULL(@TemplateKey, N'')));

  IF @cleanActor = N''
    THROW 51060, N'İşlemi yapan yönetici bilgisi bulunamadı.', 1;

  IF @cleanTitleTr = N''
    THROW 51061, N'Türkçe ünvan zorunludur.', 1;

  IF @cleanTemplateKey NOT IN (N'1', N'1-w', N'2', N'2-w', N'3', N'3-w', N'4', N'4-w')
    THROW 51062, N'İmza şablonu yalnızca 1, 1-w, 2, 2-w, 3, 3-w, 4 veya 4-w olabilir.', 1;

  IF @TitleId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.SignatureTitles WHERE TitleId = @TitleId
  )
    THROW 51063, N'Düzenlenecek imza ünvanı bulunamadı.', 1;

  IF EXISTS (
    SELECT 1
    FROM dbo.SignatureTitles
    WHERE TitleTr = @cleanTitleTr
      AND (@TitleId IS NULL OR TitleId <> @TitleId)
  )
    THROW 51064, N'Bu Türkçe ünvan zaten kayıtlıdır.', 1;

  IF @TitleId IS NULL
  BEGIN
    INSERT INTO dbo.SignatureTitles (
      TitleTr,
      TitleEn,
      TemplateKey,
      IsActive,
      CreatedAt,
      UpdatedAt
    )
    VALUES (
      @cleanTitleTr,
      @cleanTitleEn,
      @cleanTemplateKey,
      @IsActive,
      SYSUTCDATETIME(),
      SYSUTCDATETIME()
    );

    SET @TitleId = CONVERT(INT, SCOPE_IDENTITY());
  END
  ELSE
  BEGIN
    UPDATE dbo.SignatureTitles
    SET
      TitleTr = @cleanTitleTr,
      TitleEn = @cleanTitleEn,
      TemplateKey = @cleanTemplateKey,
      IsActive = @IsActive,
      UpdatedAt = SYSUTCDATETIME()
    WHERE TitleId = @TitleId;
  END;

  SELECT
    TitleId,
    TitleTr,
    TitleEn,
    TemplateKey,
    IsActive,
    CreatedAt,
    UpdatedAt
  FROM dbo.SignatureTitles
  WHERE TitleId = @TitleId;
END;
GO

IF DATABASE_PRINCIPAL_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::dbo.SignatureTitles TO zimmet_api;
  DENY INSERT, UPDATE, DELETE ON OBJECT::dbo.SignatureTitles TO zimmet_api;
  GRANT EXECUTE ON OBJECT::dbo.AdminSaveSignatureTitle TO zimmet_api;
END;
GO
