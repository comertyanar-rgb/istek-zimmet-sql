USE IstekZimmet;
GO

/*
  Node API hesabını sabit yüksek yetkili rollerden çıkarır ve yalnız uygulamanın
  kullandığı tablo işlemlerini verir. Import scriptleri Windows yöneticisiyle
  çalıştırılmalıdır; zimmet_api şema/import yöneticisi değildir.
*/

IF USER_ID(N'zimmet_api') IS NULL
  THROW 51030, N'zimmet_api veritabanı kullanıcısı bulunamadı.', 1;
GO

IF IS_ROLEMEMBER(N'db_owner', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_owner] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_accessadmin', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_accessadmin] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_securityadmin', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_securityadmin] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_ddladmin', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_ddladmin] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_backupoperator', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_backupoperator] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_datareader', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_datareader] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_datawriter', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_datawriter] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_denydatareader', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_denydatareader] DROP MEMBER [zimmet_api]');
IF IS_ROLEMEMBER(N'db_denydatawriter', N'zimmet_api') = 1
  EXEC(N'ALTER ROLE [db_denydatawriter] DROP MEMBER [zimmet_api]');
GO

REVOKE CONTROL ON DATABASE::IstekZimmet FROM zimmet_api;
REVOKE CONTROL ON SCHEMA::dbo FROM zimmet_api;
REVOKE ALTER ON SCHEMA::dbo FROM zimmet_api;
REVOKE SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo FROM zimmet_api;
GRANT CONNECT TO zimmet_api;
GO

GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Campuses TO zimmet_api;
DENY DELETE ON OBJECT::dbo.Campuses TO zimmet_api;

GRANT SELECT ON OBJECT::dbo.AuthorizedUsers TO zimmet_api;
DENY INSERT, UPDATE, DELETE ON OBJECT::dbo.AuthorizedUsers TO zimmet_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.Sessions TO zimmet_api;

GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Personnel TO zimmet_api;
DENY DELETE ON OBJECT::dbo.Personnel TO zimmet_api;

GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Hardware TO zimmet_api;
DENY DELETE ON OBJECT::dbo.Hardware TO zimmet_api;

GRANT SELECT, INSERT ON OBJECT::dbo.HardwareHistory TO zimmet_api;
DENY UPDATE, DELETE ON OBJECT::dbo.HardwareHistory TO zimmet_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.GlpiDevices TO zimmet_api;

GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.OperationQueue TO zimmet_api;
DENY DELETE ON OBJECT::dbo.OperationQueue TO zimmet_api;

GRANT SELECT, INSERT ON OBJECT::dbo.SystemLogs TO zimmet_api;
DENY UPDATE, DELETE ON OBJECT::dbo.SystemLogs TO zimmet_api;
GO

IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.ADPasswordQueue TO zimmet_api;
  DENY DELETE ON OBJECT::dbo.ADPasswordQueue TO zimmet_api;
END;

IF OBJECT_ID(N'dbo.SignatureJobs', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.SignatureJobs TO zimmet_api;
  DENY DELETE ON OBJECT::dbo.SignatureJobs TO zimmet_api;
END;

IF OBJECT_ID(N'dbo.SignatureTitles', N'U') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::dbo.SignatureTitles TO zimmet_api;
  DENY INSERT, UPDATE, DELETE ON OBJECT::dbo.SignatureTitles TO zimmet_api;
END;
GO

IF OBJECT_ID(N'dbo.ReserveAgentRequestNonce', N'P') IS NOT NULL
  GRANT EXECUTE ON OBJECT::dbo.ReserveAgentRequestNonce TO zimmet_api;

IF OBJECT_ID(N'dbo.PruneZimmetTransientData', N'P') IS NOT NULL
  GRANT EXECUTE ON OBJECT::dbo.PruneZimmetTransientData TO zimmet_api;

IF OBJECT_ID(N'dbo.vw_SystemLogChainVerification', N'V') IS NOT NULL
  GRANT SELECT ON OBJECT::dbo.vw_SystemLogChainVerification TO zimmet_api;

IF OBJECT_ID(N'dbo.AgentRequestNonces', N'U') IS NOT NULL
  DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.AgentRequestNonces TO zimmet_api;
GO
