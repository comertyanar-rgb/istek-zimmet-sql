/*
  Hassas AD parola verisi saklama süresini sınırlar.
  Önce test veritabanında, ardından canlı IstekZimmet veritabanında çalıştırın.
*/

SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
BEGIN
  UPDATE dbo.ADPasswordQueue
  SET PasswordCiphertext = N'',
      EncryptionKeyId = NULL,
      UpdatedAt = SYSUTCDATETIME()
  WHERE Status IN (N'TAMAMLANDI', N'HATA')
    AND ISNULL(PasswordCiphertext, N'') <> N'';
END;

COMMIT TRANSACTION;
