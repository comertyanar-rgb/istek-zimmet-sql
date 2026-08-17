USE [IstekZimmet];
GO

IF OBJECT_ID(N'dbo.Hardware', N'U') IS NULL
BEGIN
  THROW 50001, N'dbo.Hardware tablosu bulunamadı.', 1;
END
GO

IF EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE name = N'CK_Hardware_Status'
    AND parent_object_id = OBJECT_ID(N'dbo.Hardware')
)
BEGIN
  ALTER TABLE dbo.Hardware DROP CONSTRAINT CK_Hardware_Status;
END
GO

ALTER TABLE dbo.Hardware WITH CHECK
ADD CONSTRAINT CK_Hardware_Status
CHECK (HardwareStatus IN (N'AKTIF', N'DEPODA', N'HURDA', N'ARIZALI', N'TRANSFER'));
GO

ALTER TABLE dbo.Hardware CHECK CONSTRAINT CK_Hardware_Status;
GO
