USE [IstekZimmet];
GO

IF COL_LENGTH(N'dbo.Personnel', N'NationalIdEncrypted') IS NULL
BEGIN
  ALTER TABLE dbo.Personnel
    ADD NationalIdEncrypted NVARCHAR(512) NULL;
END;
GO
