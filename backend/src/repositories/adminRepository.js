import { sql, query, withTransaction } from '../db.js';
import { appendSystemLog } from './inventoryRepository.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function normalizeCampusId(value, { required = false } = {}) {
  const campusId = cleanText(value, 50);
  if (!campusId && !required) return null;
  if (!GUID_PATTERN.test(campusId)) throw new Error('Geçerli bir kampüs seçmelisiniz.');
  return campusId;
}

function clientInfo(data) {
  return [cleanText(data?.clientIp, 120), cleanText(data?.userAgent, 500)]
    .filter(Boolean)
    .join(' | ');
}

function mapAuthorizedUser(row) {
  return {
    email: row.Email,
    role: row.Role,
    campusId: row.CampusId || '',
    campus: row.Campus || 'Bilinmiyor',
    active: Boolean(row.IsActive),
    createdAt: row.CreatedAt || '',
    name: row.FullName || ''
  };
}

function mapPersonnel(row) {
  return {
    id: row.PersonId,
    name: row.FullName || row.PersonId,
    email: row.Email || '',
    department: row.Department || 'Personel',
    status: row.Status || 'Aktif',
    campusId: row.CampusId || '',
    campus: row.Campus || 'Bilinmiyor',
    sourceCampusId: row.SourceCampusId || '',
    sourceCampus: row.SourceCampus || 'Bilinmiyor',
    hasOverride: Boolean(row.HasAdminOverride),
    overrideCampusId: row.CampusIdOverride || '',
    overrideCampus: row.CampusOverride || '',
    overrideStatus: row.StatusOverride || '',
    overrideReason: row.Reason || '',
    overrideUpdatedAt: row.OverrideUpdatedAt || '',
    overrideUpdatedBy: row.OverrideUpdatedBy || ''
  };
}

function mapSignatureTitle(row) {
  return {
    id: Number(row.TitleId),
    titleTr: row.TitleTr || '',
    titleEn: row.TitleEn || '',
    templateKey: row.TemplateKey || '1',
    active: Boolean(row.IsActive),
    createdAt: row.CreatedAt || '',
    updatedAt: row.UpdatedAt || ''
  };
}

export async function fetchAdminOverviewForUser() {
  const [
    authorizedResult,
    campusesResult,
    personnelResult,
    signatureTitlesResult,
    logCountResult
  ] = await Promise.all([
    query(`
      SELECT
        au.Email,
        au.Role,
        au.CampusId,
        au.IsActive,
        au.CreatedAt,
        c.Name AS Campus,
        p.FullName
      FROM dbo.AuthorizedUsers au
      LEFT JOIN dbo.Campuses c ON c.CampusId = au.CampusId
      LEFT JOIN dbo.vw_EffectivePersonnel p ON LOWER(p.Email) = LOWER(au.Email)
      ORDER BY au.IsActive DESC, COALESCE(p.FullName, au.Email)
    `),
    query(`
      SELECT CampusId, CampusCode, Name, IsActive
      FROM dbo.Campuses
      ORDER BY IsActive DESC, Name
    `),
    query(`
      SELECT
        p.PersonId,
        p.FullName,
        p.Email,
        p.Department,
        p.Status,
        p.CampusId,
        effectiveCampus.Name AS Campus,
        sourcePerson.CampusId AS SourceCampusId,
        sourceCampus.Name AS SourceCampus,
        p.HasAdminOverride,
        overrides.CampusIdOverride,
        overrides.CampusOverride,
        overrides.StatusOverride,
        overrides.Reason,
        overrides.UpdatedAt AS OverrideUpdatedAt,
        overrides.UpdatedBy AS OverrideUpdatedBy
      FROM dbo.vw_EffectivePersonnel p
      INNER JOIN dbo.Personnel sourcePerson ON sourcePerson.PersonId = p.PersonId
      LEFT JOIN dbo.Campuses effectiveCampus ON effectiveCampus.CampusId = p.CampusId
      LEFT JOIN dbo.Campuses sourceCampus ON sourceCampus.CampusId = sourcePerson.CampusId
      LEFT JOIN dbo.vw_PersonnelAdminOverrides overrides
        ON overrides.PersonId = p.PersonId AND overrides.IsActive = 1
      ORDER BY p.FullName
    `),
    query(`
      SELECT
        TitleId,
        TitleTr,
        TitleEn,
        TemplateKey,
        IsActive,
        CreatedAt,
        UpdatedAt
      FROM dbo.SignatureTitles
      ORDER BY IsActive DESC, TitleTr
    `),
    query(`SELECT COUNT_BIG(*) AS LogCount FROM dbo.SystemLogs`)
  ]);

  return {
    users: authorizedResult.recordset.map(mapAuthorizedUser),
    campuses: campusesResult.recordset.map((row) => ({
      id: row.CampusId,
      code: row.CampusCode || '',
      name: row.Name,
      active: Boolean(row.IsActive)
    })),
    personnel: personnelResult.recordset.map(mapPersonnel),
    signatureTitles: signatureTitlesResult.recordset.map(mapSignatureTitle),
    logs: [],
    auditTotal: Number(logCountResult.recordset[0]?.LogCount || 0)
  };
}

const AUDIT_CATEGORIES = new Set([
  '',
  'PASSWORD',
  'HARDWARE',
  'ASSIGNMENT',
  'TRANSFER',
  'GLPI',
  'SIGNATURE',
  'MANAGEMENT',
  'EXPORT',
  'OTHER'
]);

function normalizeAuditDate(value) {
  const dateText = cleanText(value, 10);
  if (!dateText) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error('Denetim tarihi geçersiz.');
  }
  return dateText;
}

export async function fetchAdminAuditLogsForUser(data = {}) {
  const page = Math.min(Math.max(Number.parseInt(data.page, 10) || 1, 1), 1_000_000);
  const pageSize = Math.min(Math.max(Number.parseInt(data.pageSize, 10) || 25, 10), 100);
  const offset = (page - 1) * pageSize;
  const search = cleanText(data.search, 200);
  const category = cleanText(data.category, 40).toUpperCase();
  const fromDate = normalizeAuditDate(data.fromDate);
  const toDate = normalizeAuditDate(data.toDate);

  if (!AUDIT_CATEGORIES.has(category)) {
    throw new Error('Denetim kategorisi geçersiz.');
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  }

  const result = await query(
    `
      ;WITH AuditRows AS (
        SELECT
          logs.LogId,
          logs.CreatedAt,
          logs.ExecutedBy,
          logs.ActionType,
          logs.Details,
          logs.FileHash,
          logs.DriveLink,
          logs.ChainHash,
          logs.ClientInfo,
          CASE
            WHEN logs.ActionType LIKE N'%ŞİFRE%' OR logs.ActionType LIKE N'AD %' THEN N'PASSWORD'
            WHEN logs.ActionType LIKE N'%TRANSFER%' THEN N'TRANSFER'
            WHEN logs.ActionType LIKE N'%ZİMMET%' OR logs.ActionType LIKE N'%İADE%' THEN N'ASSIGNMENT'
            WHEN logs.ActionType LIKE N'%GLPI%' THEN N'GLPI'
            WHEN logs.ActionType LIKE N'%İMZA%' THEN N'SIGNATURE'
            WHEN logs.ActionType LIKE N'YÖNETİM %' THEN N'MANAGEMENT'
            WHEN logs.ActionType LIKE N'%EXPORT%' OR logs.ActionType LIKE N'%AKTAR%' THEN N'EXPORT'
            WHEN logs.ActionType LIKE N'%DONANIM%'
              OR logs.ActionType LIKE N'%GRUP%'
              OR logs.ActionType LIKE N'%SAYIM%'
              OR logs.ActionType LIKE N'%HURDA%'
              OR logs.ActionType LIKE N'%DEPO%' THEN N'HARDWARE'
            ELSE N'OTHER'
          END AS Category,
          CONVERT(BIT, COALESCE(verification.IsValid, 0)) AS ChainValid
        FROM dbo.SystemLogs logs
        LEFT JOIN dbo.vw_SystemLogChainVerification verification
          ON verification.LogId = logs.LogId
      ),
      FilteredRows AS (
        SELECT *
        FROM AuditRows
        WHERE (@category = N'' OR Category = @category)
          AND (
            @search = N''
            OR ExecutedBy LIKE N'%' + @search + N'%'
            OR ActionType LIKE N'%' + @search + N'%'
            OR Details LIKE N'%' + @search + N'%'
          )
          AND (
            @fromDate = N''
            OR CONVERT(DATE, CreatedAt) >= TRY_CONVERT(DATE, @fromDate, 23)
          )
          AND (
            @toDate = N''
            OR CONVERT(DATE, CreatedAt) <= TRY_CONVERT(DATE, @toDate, 23)
          )
      )
      SELECT
        LogId,
        CreatedAt,
        ExecutedBy,
        ActionType,
        Details,
        FileHash,
        DriveLink,
        ChainHash,
        ClientInfo,
        Category,
        ChainValid,
        COUNT_BIG(*) OVER() AS TotalCount
      FROM FilteredRows
      ORDER BY LogId DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `,
    {
      category: { type: sql.NVarChar(40), value: category },
      search: { type: sql.NVarChar(200), value: search },
      fromDate: { type: sql.NVarChar(10), value: fromDate || '' },
      toDate: { type: sql.NVarChar(10), value: toDate || '' },
      offset: { type: sql.Int, value: offset },
      pageSize: { type: sql.Int, value: pageSize }
    }
  );

  const total = Number(result.recordset[0]?.TotalCount || 0);
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    logs: result.recordset.map((row) => ({
      id: row.LogId,
      createdAt: row.CreatedAt,
      executedBy: row.ExecutedBy || 'Sistem',
      action: row.ActionType,
      details: row.Details || '',
      fileHash: row.FileHash || '',
      driveLink: row.DriveLink || '',
      chainHash: row.ChainHash || '',
      clientInfo: row.ClientInfo || '',
      category: row.Category || 'OTHER',
      chainValid: Boolean(row.ChainValid)
    }))
  };
}

export async function saveAuthorizedUserForAdmin(user, data, options = {}) {
  const email = normalizeEmail(data.email);
  const role = cleanText(data.role, 50).toUpperCase();
  const campusId = normalizeCampusId(data.campusId, { required: true });
  const active = data.active !== false;

  if (!EMAIL_PATTERN.test(email)) throw new Error('Geçerli bir e-posta adresi girin.');
  if (!['IT', 'HQ IT'].includes(role)) throw new Error('Rol yalnızca IT veya HQ IT olabilir.');
  if (options.isProtectedEmail?.(email)) {
    throw new Error('Sunucu süper yöneticilerinin erişimi bu panelden değiştirilemez.');
  }

  return withTransaction(async (execute) => {
    const result = await execute(
      `
        EXEC dbo.AdminSaveAuthorizedUser
          @ActorEmail = @actorEmail,
          @Email = @email,
          @Role = @role,
          @CampusId = @campusId,
          @IsActive = @isActive
      `,
      {
        actorEmail: { type: sql.NVarChar(320), value: user.email },
        email: { type: sql.NVarChar(320), value: email },
        role: { type: sql.NVarChar(50), value: role },
        campusId: { type: sql.UniqueIdentifier, value: campusId },
        isActive: { type: sql.Bit, value: active }
      }
    );

    const saved = result.recordset[0];
    await appendSystemLog(
      'YÖNETİM YETKİLİ KAYDI',
      user,
      `${email} -> ${role}, ${saved?.Campus || campusId}, ${active ? 'Aktif' : 'Pasif'}`,
      clientInfo(data),
      execute
    );

    return { user: mapAuthorizedUser(saved) };
  });
}

export async function savePersonnelOverrideForAdmin(user, data) {
  const personId = cleanText(data.personId, 160);
  const campusId = normalizeCampusId(data.campusId);
  const status = cleanText(data.status, 40);
  const reason = cleanText(data.reason, 500);

  if (!personId) throw new Error('Personel seçimi bulunamadı.');
  if (!campusId && !status) throw new Error('En az bir kampüs veya durum düzeltmesi seçin.');
  if (status && !['Aktif', 'Pasif'].includes(status)) {
    throw new Error('Personel durumu yalnızca Aktif veya Pasif olabilir.');
  }
  if (reason.length < 3) throw new Error('Düzeltme nedeni en az 3 karakter olmalıdır.');

  return withTransaction(async (execute) => {
    const result = await execute(
      `
        EXEC dbo.AdminSavePersonnelOverride
          @ActorEmail = @actorEmail,
          @PersonId = @personId,
          @CampusIdOverride = @campusId,
          @StatusOverride = @status,
          @Reason = @reason
      `,
      {
        actorEmail: { type: sql.NVarChar(320), value: user.email },
        personId: { type: sql.NVarChar(160), value: personId },
        campusId: { type: sql.UniqueIdentifier, value: campusId },
        status: { type: sql.NVarChar(40), value: status || null },
        reason: { type: sql.NVarChar(500), value: reason }
      }
    );

    const saved = result.recordset[0];
    await appendSystemLog(
      'YÖNETİM PERSONEL DÜZELTME',
      user,
      `${saved?.FullName || personId} -> kampüs: ${saved?.CampusOverride || 'değişmedi'}, durum: ${status || 'değişmedi'}, neden: ${reason}`,
      clientInfo(data),
      execute
    );

    return { override: saved || null };
  });
}

export async function clearPersonnelOverrideForAdmin(user, data) {
  const personId = cleanText(data.personId, 160);
  if (!personId) throw new Error('Personel seçimi bulunamadı.');

  return withTransaction(async (execute) => {
    const currentResult = await execute(
      `
        SELECT TOP (1) FullName, CampusOverride, StatusOverride, Reason
        FROM dbo.vw_PersonnelAdminOverrides
        WHERE PersonId = @personId AND IsActive = 1
      `,
      { personId: { type: sql.NVarChar(160), value: personId } }
    );
    const current = currentResult.recordset[0];
    if (!current) throw new Error('Kaldırılacak aktif personel düzeltmesi bulunamadı.');

    await execute(
      `
        EXEC dbo.AdminClearPersonnelOverride
          @ActorEmail = @actorEmail,
          @PersonId = @personId
      `,
      {
        actorEmail: { type: sql.NVarChar(320), value: user.email },
        personId: { type: sql.NVarChar(160), value: personId }
      }
    );

    await appendSystemLog(
      'YÖNETİM PERSONEL DÜZELTME KALDIR',
      user,
      `${current.FullName || personId} için yönetici düzeltmesi kaldırıldı.`,
      clientInfo(data),
      execute
    );

    return { personId };
  });
}

export async function saveSignatureTitleForAdmin(user, data) {
  const parsedId = Number.parseInt(data.titleId, 10);
  const titleId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
  const titleTr = cleanText(data.titleTr, 240);
  const titleEn = cleanText(data.titleEn, 240);
  const templateKey = cleanText(data.templateKey, 20)
    .replace(/^imza-template-/i, '')
    .replace(/^template-/i, '')
    .trim();
  const active = data.active !== false;

  if (!titleTr) throw new Error('Türkçe ünvan zorunludur.');
  if (!/^[1-4](?:-w)?$/.test(templateKey)) {
    throw new Error('İmza şablonu 1-4 veya 1-w ile 4-w arasında olmalıdır.');
  }

  return withTransaction(async (execute) => {
    const previousResult = titleId
      ? await execute(
          `
            SELECT TitleTr, TitleEn, TemplateKey, IsActive
            FROM dbo.SignatureTitles
            WHERE TitleId = @titleId
          `,
          { titleId: { type: sql.Int, value: titleId } }
        )
      : null;
    const previous = previousResult?.recordset?.[0] || null;

    const result = await execute(
      `
        EXEC dbo.AdminSaveSignatureTitle
          @ActorEmail = @actorEmail,
          @TitleId = @titleId,
          @TitleTr = @titleTr,
          @TitleEn = @titleEn,
          @TemplateKey = @templateKey,
          @IsActive = @isActive
      `,
      {
        actorEmail: { type: sql.NVarChar(320), value: user.email },
        titleId: { type: sql.Int, value: titleId },
        titleTr: { type: sql.NVarChar(240), value: titleTr },
        titleEn: { type: sql.NVarChar(240), value: titleEn || null },
        templateKey: { type: sql.NVarChar(20), value: templateKey },
        isActive: { type: sql.Bit, value: active }
      }
    );

    const saved = result.recordset[0];
    const changeType = previous ? 'güncellendi' : 'eklendi';
    const previousSummary = previous
      ? ` / önceki: ${previous.TitleTr} | ${previous.TitleEn || '-'} | şablon ${
          previous.TemplateKey || 'otomatik'
        } | ${previous.IsActive ? 'Aktif' : 'Pasif'}`
      : '';

    await appendSystemLog(
      'YÖNETİM İMZA ÜNVANI',
      user,
      `${titleTr} ${changeType} -> ${titleEn || 'İngilizce karşılık yok'}, şablon ${templateKey}, ${
        active ? 'Aktif' : 'Pasif'
      }${previousSummary}`,
      clientInfo(data),
      execute
    );

    return { title: mapSignatureTitle(saved) };
  });
}
