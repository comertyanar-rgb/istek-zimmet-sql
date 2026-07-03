USE [IstekZimmet];
GO

IF EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_Hardware_Personnel'
    AND parent_object_id = OBJECT_ID('dbo.Hardware')
)
BEGIN
  ALTER TABLE dbo.Hardware DROP CONSTRAINT FK_Hardware_Personnel;
END
GO
