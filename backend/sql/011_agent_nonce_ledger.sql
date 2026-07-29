/*
  Agent HMAC nonce değerlerini kısa süreli olarak SQL Server'da tutar.
  Böylece API servisi yeniden başlasa bile aynı imzalı istek tekrar çalıştırılamaz.

  API hesabı tabloya doğrudan erişemez; yalnızca atomik rezervasyon prosedürünü
  çalıştırabilir. Ham nonce yerine SHA-256 özeti saklanır.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;

IF OBJECT_ID(N'dbo.AgentRequestNonces', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.AgentRequestNonces (
    NonceHash CHAR(64) NOT NULL,
    ActionType NVARCHAR(120) NOT NULL,
    ExpiresAt DATETIME2(0) NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL
      CONSTRAINT DF_AgentRequestNonces_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_AgentRequestNonces PRIMARY KEY (NonceHash),
    CONSTRAINT CK_AgentRequestNonces_NonceHash
      CHECK (LEN(NonceHash) = 64 AND NonceHash NOT LIKE '%[^0-9a-f]%'),
    CONSTRAINT CK_AgentRequestNonces_Expiry CHECK (ExpiresAt > CreatedAt)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.AgentRequestNonces')
    AND name = N'IX_AgentRequestNonces_ExpiresAt'
)
BEGIN
  CREATE INDEX IX_AgentRequestNonces_ExpiresAt
    ON dbo.AgentRequestNonces(ExpiresAt);
END;
GO

CREATE OR ALTER PROCEDURE dbo.ReserveAgentRequestNonce
  @ActionType NVARCHAR(120),
  @NonceHash CHAR(64),
  @ExpiresAt DATETIME2(0)
AS
BEGIN
  SET XACT_ABORT ON;
  SET NOCOUNT ON;

  DECLARE @now DATETIME2(0) = SYSUTCDATETIME();

  IF NULLIF(LTRIM(RTRIM(@ActionType)), N'') IS NULL OR LEN(@ActionType) > 120
    THROW 51010, N'Agent aksiyon adı geçersiz.', 1;

  IF LEN(@NonceHash) <> 64 OR @NonceHash LIKE '%[^0-9a-f]%'
    THROW 51011, N'Agent nonce özeti geçersiz.', 1;

  IF @ExpiresAt <= @now OR @ExpiresAt > DATEADD(MINUTE, 20, @now)
    THROW 51012, N'Agent nonce geçerlilik süresi geçersiz.', 1;

  BEGIN TRY
    BEGIN TRANSACTION;

    -- Aynı özetin süresi dolmuş eski kaydı varsa önce onu temizle.
    DELETE FROM dbo.AgentRequestNonces WITH (ROWLOCK)
    WHERE NonceHash = @NonceHash
      AND ExpiresAt <= @now;

    -- Tabloyu sürekli küçük tutmak için her istekte sınırlı temizlik yap.
    DELETE TOP (500) FROM dbo.AgentRequestNonces WITH (ROWLOCK, READPAST)
    WHERE ExpiresAt <= @now;

    INSERT INTO dbo.AgentRequestNonces (NonceHash, ActionType, ExpiresAt)
    VALUES (@NonceHash, @ActionType, @ExpiresAt);

    COMMIT TRANSACTION;
    SELECT CAST(1 AS BIT) AS Reserved;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF ERROR_NUMBER() IN (2601, 2627)
    BEGIN
      SELECT CAST(0 AS BIT) AS Reserved;
      RETURN;
    END;

    THROW;
  END CATCH;
END;
GO

IF DATABASE_PRINCIPAL_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT EXECUTE ON OBJECT::dbo.ReserveAgentRequestNonce TO zimmet_api;
  DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.AgentRequestNonces TO zimmet_api;
END;
GO
