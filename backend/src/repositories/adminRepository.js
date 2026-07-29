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

export async function fetchAdminOverviewForUser() {
  const [authorizedResult, campusesResult, personnelResult, logsResult] = await Promise.all([
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
      SELECT TOP (100)
        LogId,
        CreatedAt,
        ExecutedBy,
        ActionType,
        Details,
        ChainHash
      FROM dbo.SystemLogs
      WHERE ActionType LIKE N'YÖNETİM %'
      ORDER BY LogId DESC
    `)
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
    logs: logsResult.recordset.map((row) => ({
      id: row.LogId,
      createdAt: row.CreatedAt,
      executedBy: row.ExecutedBy || '',
      action: row.ActionType,
      details: row.Details || '',
      chainHash: row.ChainHash || ''
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

