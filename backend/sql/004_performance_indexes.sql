USE IstekZimmet;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Sessions_ExpiresAt' AND object_id = OBJECT_ID(N'dbo.Sessions'))
  CREATE INDEX IX_Sessions_ExpiresAt ON dbo.Sessions(ExpiresAt);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OperationQueue_ActionStatusCreated' AND object_id = OBJECT_ID(N'dbo.OperationQueue'))
  CREATE INDEX IX_OperationQueue_ActionStatusCreated
    ON dbo.OperationQueue(ActionType, Status, CreatedAt)
    INCLUDE (QueueId, PublicId, RequestedBy, CampusId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_OperationQueue_RequestedCreated' AND object_id = OBJECT_ID(N'dbo.OperationQueue'))
  CREATE INDEX IX_OperationQueue_RequestedCreated
    ON dbo.OperationQueue(RequestedBy, CreatedAt DESC)
    INCLUDE (ActionType, Status, PublicId, CampusId, FinishedAt);
GO

IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ADPasswordQueue_StatusPriorityCreated' AND object_id = OBJECT_ID(N'dbo.ADPasswordQueue'))
  CREATE INDEX IX_ADPasswordQueue_StatusPriorityCreated
    ON dbo.ADPasswordQueue(Status, Priority DESC, CreatedAt)
    INCLUDE (QueueId, PublicId, RequestedBy, CampusId);
GO

IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_ADPasswordQueue_RequestedCreated' AND object_id = OBJECT_ID(N'dbo.ADPasswordQueue'))
  CREATE INDEX IX_ADPasswordQueue_RequestedCreated
    ON dbo.ADPasswordQueue(RequestedBy, CreatedAt DESC)
    INCLUDE (Status, PublicId, CampusId, FinishedAt, UpdatedAt);
GO

IF OBJECT_ID(N'dbo.SignatureJobs', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SignatureJobs_StatusCreated' AND object_id = OBJECT_ID(N'dbo.SignatureJobs'))
  CREATE INDEX IX_SignatureJobs_StatusCreated
    ON dbo.SignatureJobs(Status, CreatedAt)
    INCLUDE (JobId, PublicId, RequestedBy, PersonId);
GO

IF OBJECT_ID(N'dbo.SignatureJobs', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_SignatureJobs_RequestedCreated' AND object_id = OBJECT_ID(N'dbo.SignatureJobs'))
  CREATE INDEX IX_SignatureJobs_RequestedCreated
    ON dbo.SignatureJobs(RequestedBy, CreatedAt DESC)
    INCLUDE (Status, PublicId, PersonId, FinishedAt, UpdatedAt);
GO
