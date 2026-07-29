USE IstekZimmet;
GO

/*
  Sistem Yönetimi paneli:
  - Süper yönetici kimliği uygulama sunucusundaki SUPER_ADMIN_EMAILS
    izin listesinden doğrulanır.
  - API hesabına AuthorizedUsers veya override tablosunda doğrudan yazma
    yetkisi verilmez; değişiklikler yalnız EXECUTE AS OWNER prosedürlerinden geçer.
  - Personel senkron kaydı değiştirilmez. Yönetici düzeltmesi ayrı tutulur ve
    vw_EffectivePersonnel üzerinden okunur.
*/

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'dbo.PersonnelAdminOverrides', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.PersonnelAdminOverrides (
    PersonId NVARCHAR(160) NOT NULL,
    CampusIdOverride UNIQUEIDENTIFIER NULL,
    StatusOverride NVARCHAR(40) NULL,
    Reason NVARCHAR(500) NOT NULL,
    IsActive BIT NOT NULL
      CONSTRAINT DF_PersonnelAdminOverrides_IsActive DEFAULT 1,
    CreatedAt DATETIME2(0) NOT NULL
      CONSTRAINT DF_PersonnelAdminOverrides_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedBy NVARCHAR(320) NOT NULL,
    UpdatedAt DATETIME2(0) NOT NULL
      CONSTRAINT DF_PersonnelAdminOverrides_UpdatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy NVARCHAR(320) NOT NULL,
    CONSTRAINT PK_PersonnelAdminOverrides PRIMARY KEY (PersonId),
    CONSTRAINT FK_PersonnelAdminOverrides_Personnel
      FOREIGN KEY (PersonId) REFERENCES dbo.Personnel(PersonId),
    CONSTRAINT FK_PersonnelAdminOverrides_Campuses
      FOREIGN KEY (CampusIdOverride) REFERENCES dbo.Campuses(CampusId),
    CONSTRAINT CK_PersonnelAdminOverrides_Status
      CHECK (StatusOverride IS NULL OR StatusOverride IN (N'Aktif', N'Pasif')),
    CONSTRAINT CK_PersonnelAdminOverrides_Change
      CHECK (CampusIdOverride IS NOT NULL OR StatusOverride IS NOT NULL),
    CONSTRAINT CK_PersonnelAdminOverrides_Reason
      CHECK (LEN(LTRIM(RTRIM(Reason))) >= 3)
  );

  CREATE INDEX IX_PersonnelAdminOverrides_Active
    ON dbo.PersonnelAdminOverrides(IsActive, UpdatedAt DESC)
    INCLUDE (CampusIdOverride, StatusOverride, UpdatedBy);
END;
GO

CREATE OR ALTER VIEW dbo.vw_EffectivePersonnel
AS
SELECT
  p.PersonId,
  p.FullName,
  p.Email,
  p.Department,
  CASE
    WHEN o.IsActive = 1 AND o.CampusIdOverride IS NOT NULL
      THEN o.CampusIdOverride
    ELSE p.CampusId
  END AS CampusId,
  CASE
    WHEN o.IsActive = 1 AND NULLIF(o.StatusOverride, N'') IS NOT NULL
      THEN o.StatusOverride
    ELSE p.Status
  END AS Status,
  p.PhotoUrl,
  p.AdUsername,
  p.Phone,
  p.SignatureUrl,
  p.SignatureStatus,
  p.SignatureId,
  p.SignatureTitleTr,
  p.SignatureTitleEn,
  p.SignatureTemplateKey,
  p.CreatedAt,
  CASE
    WHEN o.IsActive = 1 AND o.UpdatedAt > p.UpdatedAt
      THEN o.UpdatedAt
    ELSE p.UpdatedAt
  END AS UpdatedAt,
  CONVERT(BIT, CASE WHEN o.IsActive = 1 THEN 1 ELSE 0 END) AS HasAdminOverride,
  CASE WHEN o.IsActive = 1 THEN o.Reason END AS AdminOverrideReason,
  CASE WHEN o.IsActive = 1 THEN o.UpdatedBy END AS AdminOverrideUpdatedBy,
  CASE WHEN o.IsActive = 1 THEN o.UpdatedAt END AS AdminOverrideUpdatedAt
FROM dbo.Personnel p
LEFT JOIN dbo.PersonnelAdminOverrides o ON o.PersonId = p.PersonId;
GO

CREATE OR ALTER VIEW dbo.vw_PersonnelAdminOverrides
AS
SELECT
  o.PersonId,
  p.FullName,
  p.Email,
  p.Department,
  p.CampusId AS SourceCampusId,
  sourceCampus.Name AS SourceCampus,
  o.CampusIdOverride,
  overrideCampus.Name AS CampusOverride,
  o.StatusOverride,
  o.Reason,
  o.IsActive,
  o.CreatedAt,
  o.CreatedBy,
  o.UpdatedAt,
  o.UpdatedBy
FROM dbo.PersonnelAdminOverrides o
INNER JOIN dbo.Personnel p ON p.PersonId = o.PersonId
LEFT JOIN dbo.Campuses sourceCampus ON sourceCampus.CampusId = p.CampusId
LEFT JOIN dbo.Campuses overrideCampus ON overrideCampus.CampusId = o.CampusIdOverride;
GO

CREATE OR ALTER PROCEDURE dbo.AdminSaveAuthorizedUser
  @ActorEmail NVARCHAR(320),
  @Email NVARCHAR(320),
  @Role NVARCHAR(50),
  @CampusId UNIQUEIDENTIFIER,
  @IsActive BIT
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @normalizedActor NVARCHAR(320) = LOWER(LTRIM(RTRIM(ISNULL(@ActorEmail, N''))));
  DECLARE @normalizedEmail NVARCHAR(320) = LOWER(LTRIM(RTRIM(ISNULL(@Email, N''))));
  DECLARE @normalizedRole NVARCHAR(50) = UPPER(LTRIM(RTRIM(ISNULL(@Role, N''))));

  IF @normalizedActor = N'' OR @normalizedEmail = N''
    THROW 51040, N'Yetkili e-posta adresi zorunludur.', 1;

  IF @normalizedEmail = @normalizedActor
    THROW 51041, N'Kendi sistem erişiminizi bu panelden değiştiremezsiniz.', 1;

  IF @normalizedEmail NOT LIKE N'%_@_%._%'
    THROW 51042, N'Geçerli bir yetkili e-posta adresi girin.', 1;

  IF @normalizedRole NOT IN (N'IT', N'HQ IT')
    THROW 51043, N'Rol yalnızca IT veya HQ IT olabilir.', 1;

  IF @CampusId IS NULL OR NOT EXISTS (
    SELECT 1 FROM dbo.Campuses WHERE CampusId = @CampusId AND IsActive = 1
  )
    THROW 51044, N'Aktif bir kampüs seçmelisiniz.', 1;

  MERGE dbo.AuthorizedUsers AS target
  USING (
    SELECT
      @normalizedEmail AS Email,
      @normalizedRole AS Role,
      @CampusId AS CampusId,
      @IsActive AS IsActive
  ) AS source
    ON target.Email = source.Email
  WHEN MATCHED THEN
    UPDATE SET
      Role = source.Role,
      CampusId = source.CampusId,
      IsActive = source.IsActive
  WHEN NOT MATCHED THEN
    INSERT (Email, Role, CampusId, IsActive)
    VALUES (source.Email, source.Role, source.CampusId, source.IsActive);

  DELETE FROM dbo.Sessions WHERE Email = @normalizedEmail;

  SELECT
    au.Email,
    au.Role,
    au.CampusId,
    c.Name AS Campus,
    au.IsActive,
    au.CreatedAt
  FROM dbo.AuthorizedUsers au
  LEFT JOIN dbo.Campuses c ON c.CampusId = au.CampusId
  WHERE au.Email = @normalizedEmail;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AdminSavePersonnelOverride
  @ActorEmail NVARCHAR(320),
  @PersonId NVARCHAR(160),
  @CampusIdOverride UNIQUEIDENTIFIER = NULL,
  @StatusOverride NVARCHAR(40) = NULL,
  @Reason NVARCHAR(500)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @cleanPersonId NVARCHAR(160) = LTRIM(RTRIM(ISNULL(@PersonId, N'')));
  DECLARE @cleanActor NVARCHAR(320) = LOWER(LTRIM(RTRIM(ISNULL(@ActorEmail, N''))));
  DECLARE @cleanStatus NVARCHAR(40) = NULLIF(LTRIM(RTRIM(ISNULL(@StatusOverride, N''))), N'');
  DECLARE @cleanReason NVARCHAR(500) = LTRIM(RTRIM(ISNULL(@Reason, N'')));

  IF @cleanActor = N'' OR @cleanPersonId = N''
    THROW 51045, N'Yönetici ve personel bilgisi zorunludur.', 1;

  IF NOT EXISTS (SELECT 1 FROM dbo.Personnel WHERE PersonId = @cleanPersonId)
    THROW 51046, N'Personel kaydı bulunamadı.', 1;

  IF @CampusIdOverride IS NULL AND @cleanStatus IS NULL
    THROW 51047, N'En az bir kampüs veya durum düzeltmesi seçmelisiniz.', 1;

  IF @CampusIdOverride IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dbo.Campuses WHERE CampusId = @CampusIdOverride AND IsActive = 1
  )
    THROW 51048, N'Seçilen kampüs aktif değil veya bulunamadı.', 1;

  IF @cleanStatus IS NOT NULL AND @cleanStatus NOT IN (N'Aktif', N'Pasif')
    THROW 51049, N'Personel durumu yalnızca Aktif veya Pasif olabilir.', 1;

  IF LEN(@cleanReason) < 3
    THROW 51050, N'Düzeltme nedeni en az 3 karakter olmalıdır.', 1;

  MERGE dbo.PersonnelAdminOverrides AS target
  USING (
    SELECT
      @cleanPersonId AS PersonId,
      @CampusIdOverride AS CampusIdOverride,
      @cleanStatus AS StatusOverride,
      @cleanReason AS Reason,
      @cleanActor AS UpdatedBy
  ) AS source
    ON target.PersonId = source.PersonId
  WHEN MATCHED THEN
    UPDATE SET
      CampusIdOverride = source.CampusIdOverride,
      StatusOverride = source.StatusOverride,
      Reason = source.Reason,
      IsActive = 1,
      UpdatedAt = SYSUTCDATETIME(),
      UpdatedBy = source.UpdatedBy
  WHEN NOT MATCHED THEN
    INSERT (
      PersonId, CampusIdOverride, StatusOverride, Reason,
      IsActive, CreatedBy, UpdatedBy
    )
    VALUES (
      source.PersonId, source.CampusIdOverride, source.StatusOverride,
      source.Reason, 1, source.UpdatedBy, source.UpdatedBy
    );

  SELECT *
  FROM dbo.vw_PersonnelAdminOverrides
  WHERE PersonId = @cleanPersonId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.AdminClearPersonnelOverride
  @ActorEmail NVARCHAR(320),
  @PersonId NVARCHAR(160)
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @cleanPersonId NVARCHAR(160) = LTRIM(RTRIM(ISNULL(@PersonId, N'')));
  DECLARE @cleanActor NVARCHAR(320) = LOWER(LTRIM(RTRIM(ISNULL(@ActorEmail, N''))));

  IF @cleanActor = N'' OR @cleanPersonId = N''
    THROW 51051, N'Yönetici ve personel bilgisi zorunludur.', 1;

  UPDATE dbo.PersonnelAdminOverrides
  SET
    IsActive = 0,
    UpdatedAt = SYSUTCDATETIME(),
    UpdatedBy = @cleanActor
  WHERE PersonId = @cleanPersonId
    AND IsActive = 1;

  IF @@ROWCOUNT = 0
    THROW 51052, N'Kaldırılacak aktif personel düzeltmesi bulunamadı.', 1;

  SELECT @cleanPersonId AS PersonId;
END;
GO

IF DATABASE_PRINCIPAL_ID(N'zimmet_api') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::dbo.vw_EffectivePersonnel TO zimmet_api;
  GRANT SELECT ON OBJECT::dbo.vw_PersonnelAdminOverrides TO zimmet_api;

  DENY SELECT, INSERT, UPDATE, DELETE
    ON OBJECT::dbo.PersonnelAdminOverrides TO zimmet_api;

  GRANT EXECUTE ON OBJECT::dbo.AdminSaveAuthorizedUser TO zimmet_api;
  GRANT EXECUTE ON OBJECT::dbo.AdminSavePersonnelOverride TO zimmet_api;
  GRANT EXECUTE ON OBJECT::dbo.AdminClearPersonnelOverride TO zimmet_api;
END;
GO
