USE IstekZimmet;
GO

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

/*
  Konyaaltı, Konyaaltı - İlkokul ve eski Antalya Konyaaltı adlarını tek
  kampüste birleştirir. Migration tekrar çalıştırılabilir.
*/
BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.Campuses', N'U') IS NULL
    THROW 51000, N'Campuses tablosu bulunamadı.', 1;

  -- NCHAR kullanımı, eski sqlcmd sürümlerinin UTF-8 dosyaları ANSI gibi
  -- okuması halinde bile veritabanına doğru Türkçe adı yazmamızı sağlar.
  DECLARE @DotlessI NCHAR(1) = NCHAR(305);
  DECLARE @UmlautU NCHAR(1) = NCHAR(252);
  DECLARE @BaseName NVARCHAR(160) = N'Konyaalt' + @DotlessI;
  DECLARE @CanonicalName NVARCHAR(160) =
    N'Konyaalt' + @DotlessI + N' Kamp' + @UmlautU + N's' + @UmlautU;

  CREATE TABLE #KonyaaltiCampusIds (
    CampusId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY
  );

  INSERT INTO #KonyaaltiCampusIds (CampusId)
  SELECT DISTINCT c.CampusId
  FROM dbo.Campuses c
  WHERE c.CampusCode IN (N'AK', N'KL')
     OR c.Name COLLATE Turkish_100_CI_AI LIKE N'Konyaalt%'
     OR c.CoreName COLLATE Turkish_100_CI_AI LIKE N'konyaalt%'
     OR c.Name COLLATE Turkish_100_CI_AI LIKE N'Antalya%Konyaalt%'
     OR c.CoreName COLLATE Turkish_100_CI_AI LIKE N'antalya%konyaalt%';

  DECLARE @CanonicalCampusId UNIQUEIDENTIFIER;
  DECLARE @AddressText NVARCHAR(500);
  DECLARE @ShortAddress NVARCHAR(500);
  DECLARE @CampusImage NVARCHAR(1000);

  SELECT TOP (1) @CanonicalCampusId = c.CampusId
  FROM dbo.Campuses c
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = c.CampusId
  ORDER BY
    CASE
      WHEN c.Name = @CanonicalName THEN 0
      WHEN c.Name = @BaseName THEN 1
      WHEN c.CampusCode IN (N'AK', N'KL') THEN 2
      ELSE 3
    END,
    c.IsActive DESC,
    c.CreatedAt;

  SELECT TOP (1) @AddressText = NULLIF(LTRIM(RTRIM(c.AddressText)), N'')
  FROM dbo.Campuses c
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = c.CampusId
  WHERE NULLIF(LTRIM(RTRIM(c.AddressText)), N'') IS NOT NULL
  ORDER BY CASE WHEN c.CampusId = @CanonicalCampusId THEN 0 ELSE 1 END, c.UpdatedAt DESC;

  SELECT TOP (1) @ShortAddress = NULLIF(LTRIM(RTRIM(c.ShortAddress)), N'')
  FROM dbo.Campuses c
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = c.CampusId
  WHERE NULLIF(LTRIM(RTRIM(c.ShortAddress)), N'') IS NOT NULL
  ORDER BY CASE WHEN c.CampusId = @CanonicalCampusId THEN 0 ELSE 1 END, c.UpdatedAt DESC;

  SELECT TOP (1) @CampusImage = NULLIF(LTRIM(RTRIM(c.CampusImage)), N'')
  FROM dbo.Campuses c
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = c.CampusId
  WHERE NULLIF(LTRIM(RTRIM(c.CampusImage)), N'') IS NOT NULL
  ORDER BY CASE WHEN c.CampusId = @CanonicalCampusId THEN 0 ELSE 1 END, c.UpdatedAt DESC;

  IF @CanonicalCampusId IS NULL
  BEGIN
    SET @CanonicalCampusId = NEWID();

    INSERT INTO dbo.Campuses (
      CampusId,
      CampusCode,
      Name,
      AddressText,
      ShortAddress,
      CampusImage,
      IsActive
    )
    VALUES (
      @CanonicalCampusId,
      N'AK',
      @CanonicalName,
      @AddressText,
      @ShortAddress,
      @CampusImage,
      1
    );

    INSERT INTO #KonyaaltiCampusIds (CampusId) VALUES (@CanonicalCampusId);
  END;

  UPDATE au
  SET au.CampusId = @CanonicalCampusId
  FROM dbo.AuthorizedUsers au
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = au.CampusId
  WHERE au.CampusId <> @CanonicalCampusId;

  UPDATE p
  SET p.CampusId = @CanonicalCampusId,
      p.UpdatedAt = SYSUTCDATETIME()
  FROM dbo.Personnel p
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = p.CampusId
  WHERE p.CampusId <> @CanonicalCampusId;

  UPDATE h
  SET h.CampusId = @CanonicalCampusId,
      h.UpdatedAt = SYSUTCDATETIME()
  FROM dbo.Hardware h
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = h.CampusId
  WHERE h.CampusId <> @CanonicalCampusId;

  UPDATE q
  SET q.CampusId = @CanonicalCampusId
  FROM dbo.OperationQueue q
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = q.CampusId
  WHERE q.CampusId <> @CanonicalCampusId;

  UPDATE h
  SET h.GlpiCampusGuess = @CanonicalName,
      h.UpdatedAt = SYSUTCDATETIME()
  FROM dbo.Hardware h
  WHERE h.GlpiCampusGuess COLLATE Turkish_100_CI_AI LIKE N'Konyaalt%'
     OR h.GlpiCampusGuess COLLATE Turkish_100_CI_AI LIKE N'Antalya%Konyaalt%';

  IF OBJECT_ID(N'dbo.ADPasswordQueue', N'U') IS NOT NULL
  BEGIN
    EXEC sys.sp_executesql N'
      UPDATE q
      SET q.CampusId = @CampusId,
          q.CampusName = @CampusName,
          q.UpdatedAt = SYSUTCDATETIME()
      FROM dbo.ADPasswordQueue q
      LEFT JOIN #KonyaaltiCampusIds k ON k.CampusId = q.CampusId
      WHERE k.CampusId IS NOT NULL
         OR q.CampusName COLLATE Turkish_100_CI_AI LIKE N''Konyaalt%''
         OR q.CampusName COLLATE Turkish_100_CI_AI LIKE N''Antalya%Konyaalt%'';',
      N'@CampusId UNIQUEIDENTIFIER, @CampusName NVARCHAR(160)',
      @CampusId = @CanonicalCampusId,
      @CampusName = @CanonicalName;
  END;

  IF OBJECT_ID(N'dbo.PersonnelAdminOverrides', N'U') IS NOT NULL
  BEGIN
    EXEC sys.sp_executesql N'
      UPDATE o
      SET o.CampusIdOverride = @CampusId,
          o.UpdatedAt = SYSUTCDATETIME()
      FROM dbo.PersonnelAdminOverrides o
      INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = o.CampusIdOverride
      WHERE o.CampusIdOverride <> @CampusId;',
      N'@CampusId UNIQUEIDENTIFIER',
      @CampusId = @CanonicalCampusId;
  END;

  /*
    Campuses tablosuna sonradan eklenen moduller de ayni birlesimi otomatik
    izlesin. Bu adim; hesap acma, ogrenci ve gelecekte eklenecek tablolardaki
    CampusId yabanci anahtarlarini, tablo adlarini migration'a sabitlemeden
    kanonik kayda tasir.
  */
  DECLARE @ChildSchema SYSNAME;
  DECLARE @ChildTable SYSNAME;
  DECLARE @ChildColumn SYSNAME;
  DECLARE @ForeignKeySql NVARCHAR(MAX);

  DECLARE CampusForeignKeys CURSOR LOCAL FAST_FORWARD FOR
  SELECT DISTINCT
    OBJECT_SCHEMA_NAME(fkc.parent_object_id),
    OBJECT_NAME(fkc.parent_object_id),
    parentColumn.name
  FROM sys.foreign_key_columns fkc
  INNER JOIN sys.columns parentColumn
    ON parentColumn.object_id = fkc.parent_object_id
   AND parentColumn.column_id = fkc.parent_column_id
  WHERE fkc.referenced_object_id = OBJECT_ID(N'dbo.Campuses');

  OPEN CampusForeignKeys;
  FETCH NEXT FROM CampusForeignKeys INTO @ChildSchema, @ChildTable, @ChildColumn;

  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @ForeignKeySql =
      N'UPDATE child
        SET ' + QUOTENAME(@ChildColumn) + N' = @CampusId
        FROM ' + QUOTENAME(@ChildSchema) + N'.' + QUOTENAME(@ChildTable) + N' AS child
        INNER JOIN #KonyaaltiCampusIds source
          ON source.CampusId = child.' + QUOTENAME(@ChildColumn) + N'
        WHERE child.' + QUOTENAME(@ChildColumn) + N' <> @CampusId;';

    EXEC sys.sp_executesql
      @ForeignKeySql,
      N'@CampusId UNIQUEIDENTIFIER',
      @CampusId = @CanonicalCampusId;

    FETCH NEXT FROM CampusForeignKeys INTO @ChildSchema, @ChildTable, @ChildColumn;
  END;

  CLOSE CampusForeignKeys;
  DEALLOCATE CampusForeignKeys;

  IF OBJECT_ID(N'dbo.AccountCreationRequests', N'U') IS NOT NULL
     AND COL_LENGTH(N'dbo.AccountCreationRequests', N'CampusName') IS NOT NULL
  BEGIN
    EXEC sys.sp_executesql N'
      UPDATE dbo.AccountCreationRequests
      SET CampusName = @CampusName,
          UpdatedAt = SYSUTCDATETIME()
      WHERE CampusId = @CampusId
        AND ISNULL(CampusName, N'''') <> @CampusName;',
      N'@CampusId UNIQUEIDENTIFIER, @CampusName NVARCHAR(160)',
      @CampusId = @CanonicalCampusId,
      @CampusName = @CanonicalName;
  END;

  IF OBJECT_ID(N'dbo.AccountOperations', N'U') IS NOT NULL
     AND COL_LENGTH(N'dbo.AccountOperations', N'CampusName') IS NOT NULL
  BEGIN
    EXEC sys.sp_executesql N'
      UPDATE dbo.AccountOperations
      SET CampusName = @CampusName,
          UpdatedAt = SYSUTCDATETIME()
      WHERE CampusId = @CampusId
        AND ISNULL(CampusName, N'''') <> @CampusName;',
      N'@CampusId UNIQUEIDENTIFIER, @CampusName NVARCHAR(160)',
      @CampusId = @CanonicalCampusId,
      @CampusName = @CanonicalName;
  END;

  IF OBJECT_ID(N'dbo.StudentRegistrations', N'U') IS NOT NULL
     AND COL_LENGTH(N'dbo.StudentRegistrations', N'CampusName') IS NOT NULL
  BEGIN
    EXEC sys.sp_executesql N'
      UPDATE dbo.StudentRegistrations
      SET CampusName = @CampusName,
          UpdatedAt = SYSUTCDATETIME()
      WHERE CampusId = @CampusId
        AND ISNULL(CampusName, N'''') <> @CampusName;',
      N'@CampusId UNIQUEIDENTIFIER, @CampusName NVARCHAR(160)',
      @CampusId = @CanonicalCampusId,
      @CampusName = @CanonicalName;
  END;

  IF OBJECT_ID(N'dbo.StudentProvisioningCampuses', N'U') IS NOT NULL
     AND COL_LENGTH(N'dbo.StudentProvisioningCampuses', N'CampusFullName') IS NOT NULL
  BEGIN
    EXEC sys.sp_executesql N'
      UPDATE dbo.StudentProvisioningCampuses
      SET CampusFullName = @CampusName,
          UpdatedAt = SYSUTCDATETIME()
      WHERE CampusId = @CampusId
        AND ISNULL(CampusFullName, N'''') <> @CampusName;',
      N'@CampusId UNIQUEIDENTIFIER, @CampusName NVARCHAR(160)',
      @CampusId = @CanonicalCampusId,
      @CampusName = @CanonicalName;
  END;

  DELETE c
  FROM dbo.Campuses c
  INNER JOIN #KonyaaltiCampusIds k ON k.CampusId = c.CampusId
  WHERE c.CampusId <> @CanonicalCampusId;

  UPDATE dbo.Campuses
  SET CampusCode = N'AK',
      Name = @CanonicalName,
      AddressText = COALESCE(NULLIF(LTRIM(RTRIM(AddressText)), N''), @AddressText),
      ShortAddress = COALESCE(NULLIF(LTRIM(RTRIM(ShortAddress)), N''), @ShortAddress),
      CampusImage = COALESCE(NULLIF(LTRIM(RTRIM(CampusImage)), N''), @CampusImage),
      IsActive = 1,
      UpdatedAt = SYSUTCDATETIME()
  WHERE CampusId = @CanonicalCampusId;

  COMMIT TRANSACTION;

  SELECT
    CAST(1 AS BIT) AS Success,
    @CanonicalCampusId AS CampusId,
    @CanonicalName AS CampusName;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO
