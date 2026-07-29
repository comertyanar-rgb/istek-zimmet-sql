/*
  Bearer oturum tokenlarını SQL'de düz metin tutmaz.
  Bu migration mevcut oturumları sonlandırır; kullanıcılar yeniden giriş yapar.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.Sessions', N'U') IS NOT NULL
BEGIN
  DELETE FROM dbo.Sessions;

  IF COL_LENGTH(N'dbo.Sessions', N'TokenHash') IS NULL
    ALTER TABLE dbo.Sessions ADD TokenHash CHAR(64) NULL;

  EXEC(N'ALTER TABLE dbo.Sessions ALTER COLUMN TokenHash CHAR(64) NOT NULL;');

  IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.Sessions')
      AND name = N'UX_Sessions_TokenHash'
  )
    EXEC(N'CREATE UNIQUE INDEX UX_Sessions_TokenHash ON dbo.Sessions(TokenHash);');
END;

COMMIT TRANSACTION;
