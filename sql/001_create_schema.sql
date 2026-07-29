/*
  ISTEK Zimmet SQL Server temel semasi.
  Once test database'inde calistirin.
*/

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

CREATE TABLE dbo.Campuses (
  CampusId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_Campuses_CampusId DEFAULT NEWID(),
  CampusCode NVARCHAR(32) NULL,
  Name NVARCHAR(160) NOT NULL,
  CoreName AS LOWER(REPLACE(REPLACE(REPLACE(REPLACE(Name, N' Kampüsü', N''), N' Kampusu', N''), N' Kampüs', N''), N' Kampus', N'')) PERSISTED,
  AddressText NVARCHAR(500) NULL,
  ShortAddress NVARCHAR(500) NULL,
  CampusImage NVARCHAR(1000) NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_Campuses_IsActive DEFAULT 1,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Campuses_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Campuses_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Campuses PRIMARY KEY (CampusId),
  CONSTRAINT UQ_Campuses_Name UNIQUE (Name)
);

CREATE TABLE dbo.AuthorizedUsers (
  Email NVARCHAR(320) NOT NULL,
  Role NVARCHAR(50) NOT NULL CONSTRAINT DF_AuthorizedUsers_Role DEFAULT N'IT',
  CampusId UNIQUEIDENTIFIER NULL,
  IsActive BIT NOT NULL CONSTRAINT DF_AuthorizedUsers_IsActive DEFAULT 1,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_AuthorizedUsers_CreatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_AuthorizedUsers PRIMARY KEY (Email),
  CONSTRAINT FK_AuthorizedUsers_Campuses FOREIGN KEY (CampusId) REFERENCES dbo.Campuses(CampusId)
);

CREATE TABLE dbo.Sessions (
  SessionToken UNIQUEIDENTIFIER NOT NULL,
  TokenHash CHAR(64) NOT NULL,
  Email NVARCHAR(320) NOT NULL,
  ExpiresAt DATETIME2(0) NOT NULL,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Sessions_CreatedAt DEFAULT SYSUTCDATETIME(),
  LastSeenAt DATETIME2(0) NULL,
  CONSTRAINT PK_Sessions PRIMARY KEY (SessionToken),
  CONSTRAINT UQ_Sessions_TokenHash UNIQUE (TokenHash),
  CONSTRAINT FK_Sessions_AuthorizedUsers FOREIGN KEY (Email) REFERENCES dbo.AuthorizedUsers(Email)
);

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

CREATE INDEX IX_AgentRequestNonces_ExpiresAt
  ON dbo.AgentRequestNonces(ExpiresAt);
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

    DELETE FROM dbo.AgentRequestNonces WITH (ROWLOCK)
    WHERE NonceHash = @NonceHash
      AND ExpiresAt <= @now;

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

CREATE TABLE dbo.Personnel (
  PersonId NVARCHAR(160) NOT NULL,
  FullName NVARCHAR(240) NOT NULL,
  Email NVARCHAR(320) NULL,
  Department NVARCHAR(240) NULL,
  CampusId UNIQUEIDENTIFIER NULL,
  Status NVARCHAR(40) NOT NULL CONSTRAINT DF_Personnel_Status DEFAULT N'Aktif',
  PhotoUrl NVARCHAR(1000) NULL,
  AdUsername NVARCHAR(160) NULL,
  Phone NVARCHAR(20) NULL,
  NationalIdHash CHAR(64) NULL,
  SignatureUrl NVARCHAR(1000) NULL,
  SignatureStatus NVARCHAR(80) NULL,
  SignatureId NVARCHAR(80) NULL,
  SignatureTitleTr NVARCHAR(240) NULL,
  SignatureTitleEn NVARCHAR(240) NULL,
  SignatureTemplateKey NVARCHAR(20) NULL,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Personnel_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Personnel_UpdatedAt DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_Personnel PRIMARY KEY (PersonId),
  CONSTRAINT FK_Personnel_Campuses FOREIGN KEY (CampusId) REFERENCES dbo.Campuses(CampusId),
  CONSTRAINT CK_Personnel_NationalIdHash CHECK (
    NationalIdHash IS NULL
    OR (
      LEN(NationalIdHash) = 64
      AND NationalIdHash NOT LIKE '%[^0-9a-f]%'
    )
  )
);

CREATE UNIQUE INDEX IX_Personnel_Email ON dbo.Personnel(Email) WHERE Email IS NOT NULL;
CREATE INDEX IX_Personnel_AdUsername ON dbo.Personnel(AdUsername);
CREATE INDEX IX_Personnel_CampusId ON dbo.Personnel(CampusId);
CREATE UNIQUE INDEX UX_Personnel_NationalIdHash ON dbo.Personnel(NationalIdHash)
  WHERE NationalIdHash IS NOT NULL;
CREATE INDEX IX_Personnel_UpdatedAt ON dbo.Personnel(UpdatedAt)
  INCLUDE (PersonId, CampusId);

CREATE TABLE dbo.Hardware (
  HardwareId INT IDENTITY(1,1) NOT NULL,
  SerialNo NVARCHAR(160) NOT NULL,
  Model NVARCHAR(240) NULL,
  CampusId UNIQUEIDENTIFIER NULL,
  AssignedPersonId NVARCHAR(160) NULL,
  HardwareStatus NVARCHAR(40) NOT NULL CONSTRAINT DF_Hardware_Status DEFAULT N'DEPODA',
  DriveLink NVARCHAR(1000) NULL,
  ComputerName NVARCHAR(160) NULL,
  DeviceType NVARCHAR(80) NULL,
  Brand NVARCHAR(120) NULL,
  GroupName NVARCHAR(160) NULL,
  Notes NVARCHAR(MAX) NULL,
  GlpiId INT NULL,
  GlpiComputerName NVARCHAR(160) NULL,
  GlpiAdUsername NVARCHAR(160) NULL,
  GlpiPersonnelName NVARCHAR(240) NULL,
  GlpiCampusGuess NVARCHAR(160) NULL,
  GlpiDeviceType NVARCHAR(80) NULL,
  GlpiMatchType NVARCHAR(80) NULL,
  GlpiMismatch NVARCHAR(240) NULL,
  GlpiLastSync DATETIME2(0) NULL,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Hardware_CreatedAt DEFAULT SYSUTCDATETIME(),
  UpdatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_Hardware_UpdatedAt DEFAULT SYSUTCDATETIME(),
  RowVersion ROWVERSION,
  CONSTRAINT PK_Hardware PRIMARY KEY (HardwareId),
  CONSTRAINT UQ_Hardware_SerialNo UNIQUE (SerialNo),
  CONSTRAINT FK_Hardware_Campuses FOREIGN KEY (CampusId) REFERENCES dbo.Campuses(CampusId),
  CONSTRAINT FK_Hardware_Personnel FOREIGN KEY (AssignedPersonId) REFERENCES dbo.Personnel(PersonId),
  CONSTRAINT CK_Hardware_Status CHECK (HardwareStatus IN (N'AKTIF', N'DEPODA', N'HURDA', N'TRANSFER'))
);

CREATE INDEX IX_Hardware_CampusStatus ON dbo.Hardware(CampusId, HardwareStatus);
CREATE INDEX IX_Hardware_AssignedPersonId ON dbo.Hardware(AssignedPersonId);
CREATE INDEX IX_Hardware_ComputerName ON dbo.Hardware(ComputerName);
CREATE INDEX IX_Hardware_GlpiId ON dbo.Hardware(GlpiId);
CREATE INDEX IX_Hardware_UpdatedAt ON dbo.Hardware(UpdatedAt)
  INCLUDE (HardwareId, CampusId, SerialNo, HardwareStatus, AssignedPersonId);

CREATE TABLE dbo.HardwareHistory (
  HistoryId BIGINT IDENTITY(1,1) NOT NULL,
  HardwareId INT NOT NULL,
  EventType NVARCHAR(120) NOT NULL,
  PersonId NVARCHAR(160) NULL,
  PersonName NVARCHAR(240) NULL,
  DriveLink NVARCHAR(1000) NULL,
  EventDate DATETIME2(0) NOT NULL CONSTRAINT DF_HardwareHistory_EventDate DEFAULT SYSUTCDATETIME(),
  DetailsJson NVARCHAR(MAX) NULL,
  CreatedBy NVARCHAR(320) NULL,
  CONSTRAINT PK_HardwareHistory PRIMARY KEY (HistoryId),
  CONSTRAINT FK_HardwareHistory_Hardware FOREIGN KEY (HardwareId) REFERENCES dbo.Hardware(HardwareId),
  CONSTRAINT FK_HardwareHistory_Personnel FOREIGN KEY (PersonId) REFERENCES dbo.Personnel(PersonId)
);

CREATE INDEX IX_HardwareHistory_HardwareDate ON dbo.HardwareHistory(HardwareId, EventDate DESC);

CREATE TABLE dbo.GlpiDevices (
  GlpiId INT NOT NULL,
  SerialNo NVARCHAR(160) NULL,
  ComputerName NVARCHAR(160) NULL,
  Manufacturer NVARCHAR(160) NULL,
  Model NVARCHAR(240) NULL,
  AdUsername NVARCHAR(160) NULL,
  LocationName NVARCHAR(240) NULL,
  LastInventory DATETIME2(0) NULL,
  LastSync DATETIME2(0) NOT NULL CONSTRAINT DF_GlpiDevices_LastSync DEFAULT SYSUTCDATETIME(),
  RawJson NVARCHAR(MAX) NULL,
  CONSTRAINT PK_GlpiDevices PRIMARY KEY (GlpiId)
);

CREATE INDEX IX_GlpiDevices_SerialNo ON dbo.GlpiDevices(SerialNo);
CREATE INDEX IX_GlpiDevices_ComputerName ON dbo.GlpiDevices(ComputerName);
CREATE INDEX IX_GlpiDevices_AdUsername ON dbo.GlpiDevices(AdUsername);

CREATE TABLE dbo.OperationQueue (
  QueueId BIGINT IDENTITY(1,1) NOT NULL,
  PublicId NVARCHAR(80) NOT NULL,
  ActionType NVARCHAR(120) NOT NULL,
  Status NVARCHAR(40) NOT NULL CONSTRAINT DF_OperationQueue_Status DEFAULT N'BEKLIYOR',
  PayloadJson NVARCHAR(MAX) NOT NULL,
  ResultJson NVARCHAR(MAX) NULL,
  ErrorMessage NVARCHAR(MAX) NULL,
  RequestedBy NVARCHAR(320) NULL,
  CampusId UNIQUEIDENTIFIER NULL,
  AttemptCount INT NOT NULL CONSTRAINT DF_OperationQueue_AttemptCount DEFAULT 0,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_OperationQueue_CreatedAt DEFAULT SYSUTCDATETIME(),
  StartedAt DATETIME2(0) NULL,
  FinishedAt DATETIME2(0) NULL,
  LeaseToken UNIQUEIDENTIFIER NULL,
  LeaseExpiresAt DATETIME2(0) NULL,
  CONSTRAINT PK_OperationQueue PRIMARY KEY (QueueId),
  CONSTRAINT UQ_OperationQueue_PublicId UNIQUE (PublicId),
  CONSTRAINT FK_OperationQueue_Campuses FOREIGN KEY (CampusId) REFERENCES dbo.Campuses(CampusId)
);

CREATE INDEX IX_OperationQueue_StatusCreated ON dbo.OperationQueue(Status, CreatedAt);

CREATE TABLE dbo.SystemLogs (
  LogId BIGINT IDENTITY(1,1) NOT NULL,
  CreatedAt DATETIME2(0) NOT NULL CONSTRAINT DF_SystemLogs_CreatedAt DEFAULT SYSUTCDATETIME(),
  ExecutedBy NVARCHAR(320) NULL,
  ActionType NVARCHAR(120) NOT NULL,
  Details NVARCHAR(MAX) NULL,
  FileHash NVARCHAR(128) NULL,
  DriveLink NVARCHAR(1000) NULL,
  ChainHash NVARCHAR(128) NOT NULL,
  ClientInfo NVARCHAR(MAX) NULL,
  CONSTRAINT PK_SystemLogs PRIMARY KEY (LogId),
  CONSTRAINT CK_SystemLogs_ChainHash CHECK (LEN(ChainHash) = 64)
);

CREATE INDEX IX_SystemLogs_CreatedAt ON dbo.SystemLogs(CreatedAt DESC);

GO

CREATE OR ALTER TRIGGER dbo.TR_SystemLogs_AppendOnly
ON dbo.SystemLogs
INSTEAD OF UPDATE, DELETE
AS
BEGIN
  SET NOCOUNT ON;
  THROW 51001, N'Sistem logları yalnızca eklenebilir; güncellenemez veya silinemez.', 1;
END;
GO
