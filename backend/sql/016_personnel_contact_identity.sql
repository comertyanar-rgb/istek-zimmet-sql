/*
  Personel iletişim ve kimlik eşleştirme alanları.

  T.C. kimlik numarası düz metin tutulmaz. Uygulama, sunucu dışında saklanan
  PERSONNEL_ID_HMAC_SECRET ile HMAC-SHA256 üretir ve yalnız özeti kaydeder.
*/

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF COL_LENGTH(N'dbo.Personnel', N'NationalIdHash') IS NULL
BEGIN
  ALTER TABLE dbo.Personnel
    ADD NationalIdHash CHAR(64) NULL;
END;
GO

IF OBJECT_ID(N'dbo.CK_Personnel_NationalIdHash', N'C') IS NULL
BEGIN
  ALTER TABLE dbo.Personnel WITH CHECK
    ADD CONSTRAINT CK_Personnel_NationalIdHash
      CHECK (
        NationalIdHash IS NULL
        OR (
          LEN(NationalIdHash) = 64
          AND NationalIdHash NOT LIKE '%[^0-9a-f]%'
        )
      );
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.Personnel')
    AND name = N'UX_Personnel_NationalIdHash'
)
BEGIN
  CREATE UNIQUE INDEX UX_Personnel_NationalIdHash
    ON dbo.Personnel(NationalIdHash)
    WHERE NationalIdHash IS NOT NULL;
END;
GO

IF DATABASE_PRINCIPAL_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT SELECT, UPDATE ON OBJECT::dbo.Personnel TO zimmet_api;
END;
GO
