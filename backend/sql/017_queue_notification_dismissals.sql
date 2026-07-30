USE IstekZimmet;
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/*
  Tamamlanan, hatalı veya iptal edilen kuyruk bildirimlerinin kullanıcı bazında
  kalıcı olarak gizlenmesini sağlar. Üç farklı kuyruk aynı tabloda tür + public id
  birleşimiyle tutulur; kuyruk tablolarının kendisi değiştirilmez.
*/

IF OBJECT_ID(N'dbo.QueueNotificationDismissals', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.QueueNotificationDismissals (
    DismissalId BIGINT IDENTITY(1,1) NOT NULL,
    QueueKind NVARCHAR(32) NOT NULL,
    QueuePublicId NVARCHAR(80) NOT NULL,
    UserEmail NVARCHAR(320) NOT NULL,
    CreatedAt DATETIME2(0) NOT NULL
      CONSTRAINT DF_QueueNotificationDismissals_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_QueueNotificationDismissals PRIMARY KEY (DismissalId),
    CONSTRAINT UQ_QueueNotificationDismissals_UserQueue
      UNIQUE (UserEmail, QueueKind, QueuePublicId),
    CONSTRAINT CK_QueueNotificationDismissals_QueueKind
      CHECK (QueueKind IN (N'operation', N'ad-password', N'signature'))
  );
END;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.QueueNotificationDismissals')
    AND name = N'IX_QueueNotificationDismissals_CreatedAt'
)
BEGIN
  CREATE INDEX IX_QueueNotificationDismissals_CreatedAt
    ON dbo.QueueNotificationDismissals(CreatedAt);
END;
GO

IF USER_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT ON OBJECT::dbo.QueueNotificationDismissals TO zimmet_api;
  DENY UPDATE, DELETE ON OBJECT::dbo.QueueNotificationDismissals TO zimmet_api;
END;
GO
