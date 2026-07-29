SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID(N'dbo.Personnel', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
     FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.Personnel')
       AND name = N'IX_Personnel_UpdatedAt'
   )
BEGIN
  CREATE INDEX IX_Personnel_UpdatedAt
    ON dbo.Personnel(UpdatedAt)
    INCLUDE (PersonId, CampusId);
END;
GO

IF OBJECT_ID(N'dbo.Hardware', N'U') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
     FROM sys.indexes
     WHERE object_id = OBJECT_ID(N'dbo.Hardware')
       AND name = N'IX_Hardware_UpdatedAt'
   )
BEGIN
  CREATE INDEX IX_Hardware_UpdatedAt
    ON dbo.Hardware(UpdatedAt)
    INCLUDE (HardwareId, CampusId, SerialNo, HardwareStatus, AssignedPersonId);
END;
GO
