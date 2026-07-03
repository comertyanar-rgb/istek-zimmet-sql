import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { sql, query } from '../db.js';
import { consumeOtpApproval } from '../otpService.js';
import { uploadFileThroughGoogleBridge } from '../googleBridge.js';
import { config } from '../config.js';

export const core = (value) =>
  String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/kampüsü/g, '')
    .replace(/kampusu/g, '')
    .replace(/kampüs/g, '')
    .replace(/kampus/g, '')
    .trim();

const toUiStatus = (status) => {
  const value = String(status || '').toUpperCase().replace(/İ/g, 'I');
  if (value === 'AKTIF' || value === '') return 'Assigned';
  if (value === 'DEPODA') return 'Available';
  if (value === 'HURDA') return 'Hurda';
  if (value === 'TRANSFER') return 'Transfer';
  return 'Available';
};

const toDbStatus = (status) => {
  const value = String(status || '').toUpperCase().replace(/İ/g, 'I');
  if (value === 'AVAILABLE' || value === 'DEPODA' || value === 'DEPO') return 'DEPODA';
  if (value === 'HURDA') return 'HURDA';
  if (value === 'TRANSFER') return 'TRANSFER';
  if (value === 'ASSIGNED' || value === 'AKTIF') return 'AKTIF';
  return 'DEPODA';
};

function canSeeCampus(user, campus) {
  return user.role === 'HQ IT' || core(user.campus) === core(campus);
}

function assertCanAccessCampus(user, campus, message = 'Bu kampüsteki cihaz için yetkiniz yok.') {
  if (!canSeeCampus(user, campus)) throw new Error(message);
}

function normalizeIds(ids) {
  const input = Array.isArray(ids) ? ids : [ids];
  return [...new Set(input.map((id) => String(id || '').trim()).filter(Boolean))];
}

function cleanText(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function safeFileName(name, fallback = 'belge') {
  const safe = cleanText(name || fallback, 260).replace(/[\\/:*?"<>|]/g, '-');
  return safe || fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function validateUploadedFile(base64Data, fileName) {
  const base64Text = String(base64Data || '').trim();
  if (!base64Text) throw new Error('Dosya verisi bulunamadı.');
  if (base64Text.length > 15_000_000) throw new Error('Dosya çok büyük. Maksimum 15 MB yüklenebilir.');

  const safeName = safeFileName(fileName, 'belge.pdf');
  const lower = safeName.toLocaleLowerCase('tr-TR');
  const isPdf = lower.endsWith('.pdf');
  const isPng = lower.endsWith('.png');
  const isJpg = lower.endsWith('.jpg') || lower.endsWith('.jpeg');
  if (!isPdf && !isPng && !isJpg) throw new Error('Sadece PDF/JPG/PNG yüklenebilir.');

  const buffer = Buffer.from(base64Text, 'base64');
  if (buffer.length < 4) throw new Error('Dosya geçersiz.');
  if (isPdf && buffer.subarray(0, 4).toString('ascii') !== '%PDF') throw new Error('PDF dosya imzası geçersiz.');
  if (isPng && !(buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71)) {
    throw new Error('PNG dosya imzası geçersiz.');
  }
  if (isJpg && !(buffer[0] === 255 && buffer[1] === 216)) throw new Error('JPEG dosya imzası geçersiz.');

  return {
    buffer,
    fileName: safeName,
    mimeType: isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg',
    fileHash: sha256(buffer)
  };
}

function sanitizeExcelCell(value) {
  if (value === null || value === undefined) return '-';
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0090')) return digits.slice(4);
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits.slice(0, 10);
}

function normalizeSignatureText(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ');
}

function normalizeSignatureTemplateKey(value) {
  let key = String(value || '').trim();
  if (!key) return '';
  key = key.replace(/^imza-template-/i, '');
  key = key.replace(/^template-/i, '');
  key = key.replace(/^tpl/i, '');
  return key.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
}

function getSignatureTemplateVariant(titleTr, titleEn, explicitTemplateKey) {
  const templateKey = normalizeSignatureTemplateKey(explicitTemplateKey);
  if (templateKey) return templateKey;
  const tr = String(titleTr || '').replace(/\s+/g, ' ').trim();
  const en = String(titleEn || '').replace(/\s+/g, ' ').trim();
  const maxLen = Math.max(tr.length, en.length);
  const combinedLen = tr.length + en.length;
  if (maxLen > 62 || combinedLen > 118) return 'tiny';
  if (maxLen > 48 || combinedLen > 96) return 'small';
  if (maxLen > 36 || combinedLen > 76) return 'compact';
  return 'normal';
}
function normalizeKey(value) {
  return String(value ?? '').trim().toLocaleLowerCase('tr-TR');
}

function normalizeSerialKey(value) {
  return normalizeKey(value).replace(/\s+/g, '');
}

function normalizeComputerNameKey(value) {
  return normalizeKey(value).replace(/\s+/g, '');
}

function normalizeAdLogin(value) {
  let login = normalizeKey(value);
  if (!login) return '';
  if (login.includes('\\')) login = login.split('\\').pop();
  if (login.includes('@')) login = login.split('@')[0];
  return login;
}

const FALLBACK_CAMPUS_CODES = {
  AO: 'Atanur Oğuz Kampüsü',
  AB: 'Acıbadem Kampüsü',
  KA: 'Kemal Atatürk Kampüsü',
  UB: 'Uluğbey Kampüsü',
  KM: 'Kaşgarlı Mahmut Kampüsü',
  AK: 'Antalya Kampüsü (Konyaaltı)',
  KL: 'Konyaaltı Kampüsü',
  IO: 'İzmir Kampüsü',
  İO: 'İzmir Kampüsü',
  SS: 'Semiha Şakir Kampüsü',
  BK: 'Bilge Kağan Kampüsü',
  AL: 'Antalya Kampüsü (Lara)',
  AN: 'Ankara Kampüsü',
  GM: 'Genel Müdürlük',
  BE: 'Belde Kampüsü'
};

const DEVICE_TYPE_CODES = {
  LAP: 'Laptop',
  AIO: 'All in One',
  SPC: 'Akıllı Tahta',
  PC: 'Masaüstü'
};

function parseComputerNameMeta(computerName, campusCodeMap) {
  const name = cleanText(computerName, 160).toLocaleUpperCase('tr-TR');
  const empty = { campusCode: '', campus: '', typeCode: '', type: '' };
  if (!name) return empty;

  const campusCodes = Object.keys(campusCodeMap || {}).sort((a, b) => b.length - a.length);
  const typeCodes = Object.keys(DEVICE_TYPE_CODES).sort((a, b) => b.length - a.length);

  for (const campusCode of campusCodes) {
    if (!name.startsWith(campusCode)) continue;
    const rest = name.slice(campusCode.length);
    for (const typeCode of typeCodes) {
      if (rest.startsWith(typeCode)) {
        return {
          campusCode,
          campus: campusCodeMap[campusCode],
          typeCode,
          type: DEVICE_TYPE_CODES[typeCode]
        };
      }
    }
  }

  return empty;
}

async function getCampusIdByName(name) {
  const result = await query(
    `SELECT TOP 1 CampusId, Name FROM dbo.Campuses WHERE CoreName = @core OR Name = @name`,
    {
      core: { type: sql.NVarChar(160), value: core(name) },
      name: { type: sql.NVarChar(160), value: String(name || '') }
    }
  );
  return result.recordset[0]?.CampusId || null;
}

async function ensureCampusId(name) {
  const existing = await getCampusIdByName(name);
  if (existing) return existing;

  const campusName = cleanText(name || 'Bilinmiyor', 160) || 'Bilinmiyor';
  const result = await query(
    `
      INSERT INTO dbo.Campuses (Name)
      OUTPUT INSERTED.CampusId
      VALUES (@name)
    `,
    { name: { type: sql.NVarChar(160), value: campusName } }
  );
  return result.recordset[0].CampusId;
}

async function findHardwareRows(user, hardwareIds, options = {}) {
  const ids = normalizeIds(hardwareIds);
  if (!ids.length) throw new Error('Cihaz seçimi boş.');

  const result = await query(
    `
      SELECT
        h.HardwareId,
        h.SerialNo,
        h.Model,
        h.HardwareStatus,
        h.AssignedPersonId,
        h.DriveLink,
        h.ComputerName,
        h.DeviceType,
        h.Brand,
        h.GroupName,
        h.Notes,
        h.CampusId,
        c.Name AS Campus
      FROM dbo.Hardware h
      LEFT JOIN dbo.Campuses c ON c.CampusId = h.CampusId
      WHERE h.SerialNo IN (${ids.map((_, index) => `@id${index}`).join(',')})
    `,
    Object.fromEntries(ids.map((id, index) => [`id${index}`, { type: sql.NVarChar(160), value: id }]))
  );

  if (result.recordset.length !== ids.length) {
    const found = new Set(result.recordset.map((row) => row.SerialNo));
    const missing = ids.filter((id) => !found.has(id));
    throw new Error(`Cihaz bulunamadı: ${missing.join(', ')}`);
  }

  for (const row of result.recordset) {
    if (!options.skipCampusCheck) assertCanAccessCampus(user, row.Campus || 'Bilinmiyor', `Yetkisiz kampüs cihazı: ${row.SerialNo}`);
    if (options.requireStatus && String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I') !== options.requireStatus) {
      throw new Error(`${row.SerialNo} için beklenen durum ${options.requireStatus}, mevcut durum ${row.HardwareStatus}`);
    }
  }

  return result.recordset;
}

async function appendHardwareHistory(hardwareId, eventType, options = {}) {
  await query(
    `
      INSERT INTO dbo.HardwareHistory (HardwareId, EventType, PersonId, PersonName, DriveLink, EventDate, DetailsJson, CreatedBy)
      VALUES (@hardwareId, @eventType, @personId, @personName, @driveLink, ISNULL(@eventDate, SYSUTCDATETIME()), @detailsJson, @createdBy)
    `,
    {
      hardwareId: { type: sql.Int, value: hardwareId },
      eventType: { type: sql.NVarChar(120), value: cleanText(eventType, 120) || 'İşlem' },
      personId: { type: sql.NVarChar(160), value: options.personId || null },
      personName: { type: sql.NVarChar(240), value: options.personName || null },
      driveLink: { type: sql.NVarChar(1000), value: options.driveLink || null },
      eventDate: { type: sql.DateTime2, value: options.eventDate || null },
      detailsJson: { type: sql.NVarChar(sql.MAX), value: options.detailsJson ? JSON.stringify(options.detailsJson) : null },
      createdBy: { type: sql.NVarChar(320), value: options.createdBy || null }
    }
  );
}

async function appendSystemLog(actionType, user, details, clientInfo = '') {
  await query(
    `
      INSERT INTO dbo.SystemLogs (ExecutedBy, ActionType, Details, ClientInfo)
      VALUES (@executedBy, @actionType, @details, @clientInfo)
    `,
    {
      executedBy: { type: sql.NVarChar(320), value: user?.email || null },
      actionType: { type: sql.NVarChar(120), value: cleanText(actionType, 120) },
      details: { type: sql.NVarChar(sql.MAX), value: details || null },
      clientInfo: { type: sql.NVarChar(sql.MAX), value: clientInfo || null }
    }
  );
}

export async function getAuthorizedUser(email) {
  const result = await query(
    `
      SELECT TOP 1
        au.Email,
        au.Role,
        c.Name AS Campus,
        p.FullName,
        p.PhotoUrl
      FROM dbo.AuthorizedUsers au
      LEFT JOIN dbo.Campuses c ON c.CampusId = au.CampusId
      LEFT JOIN dbo.Personnel p ON LOWER(p.Email) = LOWER(au.Email)
      WHERE au.Email = @email AND au.IsActive = 1
    `,
    { email: { type: sql.NVarChar(320), value: email } }
  );

  const row = result.recordset[0];
  if (!row) return null;

  return {
    email: row.Email,
    role: row.Role,
    campus: row.Campus || 'Bilinmiyor',
    name: row.FullName || '',
    picture: row.PhotoUrl || ''
  };
}

export async function updatePersonnelPhoneForUser(user, personId, phone) {
  const cleanPersonId = cleanText(personId, 160);
  const cleanPhone = cleanText(phone, 20);
  if (!cleanPersonId) throw new Error('Telefon kaydı için personel seçimi bulunamadı.');

  const result = await query(
    `
      SELECT TOP 1 p.PersonId, p.FullName, c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE p.PersonId = @personId
    `,
    { personId: { type: sql.NVarChar(160), value: cleanPersonId } }
  );

  const row = result.recordset[0];
  if (!row) throw new Error('Telefon kaydı için personel bulunamadı.');
  assertCanAccessCampus(user, row.Campus || 'Bilinmiyor', 'Bu personelin telefonunu güncelleme yetkiniz yok.');

  await query(
    `UPDATE dbo.Personnel SET Phone = @phone, UpdatedAt = SYSUTCDATETIME() WHERE PersonId = @personId`,
    {
      phone: { type: sql.NVarChar(20), value: cleanPhone || null },
      personId: { type: sql.NVarChar(160), value: cleanPersonId }
    }
  );

  await appendSystemLog('PERSONEL TELEFON GUNCELLE', user, `${row.FullName || cleanPersonId} için telefon güncellendi.`, '');
  return { phone: cleanPhone };
}
export async function fetchDataForUser(user) {
  const personnelResult = await query(
    `
      SELECT
        p.PersonId,
        p.FullName,
        p.Email,
        p.Department,
        p.Status,
        p.PhotoUrl,
        p.AdUsername,
        p.Phone,
        p.SignatureUrl,
        p.SignatureStatus,
        p.SignatureId,
        p.SignatureTitleTr,
        p.SignatureTitleEn,
        p.SignatureTemplateKey,
        c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE @isHq = 1 OR c.CoreName = @userCore
      ORDER BY p.FullName
    `,
    {
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  const hardwareResult = await query(
    `
      SELECT
        h.HardwareId,
        h.SerialNo,
        h.Model,
        h.HardwareStatus,
        h.DriveLink,
        h.ComputerName,
        h.DeviceType,
        h.Brand,
        h.GroupName,
        h.Notes,
        h.AssignedPersonId,
        h.GlpiId,
        h.GlpiComputerName,
        h.GlpiAdUsername,
        h.GlpiPersonnelName,
        h.GlpiCampusGuess,
        h.GlpiDeviceType,
        h.GlpiMatchType,
        h.GlpiMismatch,
        h.GlpiLastSync,
        c.Name AS Campus,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.HardwareHistory hh WHERE hh.HardwareId = h.HardwareId) THEN 1 ELSE 0 END AS HasHistory
      FROM dbo.Hardware h
      LEFT JOIN dbo.Campuses c ON c.CampusId = h.CampusId
      WHERE @isHq = 1
         OR c.CoreName = @userCore
         OR (
              h.HardwareStatus = N'TRANSFER'
              AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(h.AssignedPersonId, N''), N'GÖNDEREN:', N''), N'GONDEREN:', N''), N' Kampüsü', N''), N' Kampusu', N''), N' Kampüs', N''), N' Kampus', N'')) = @userCore
            )
      ORDER BY h.SerialNo
    `,
    {
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  const uniqueUsers = {};

  for (const row of personnelResult.recordset) {
    const campus = row.Campus || 'Bilinmiyor';
    if (!canSeeCampus(user, campus)) continue;

    uniqueUsers[row.PersonId] = {
      id: row.PersonId,
      name: row.FullName,
      campus,
      email: row.Email || '',
      department: row.Department || 'Personel',
      status: row.Status || 'Aktif',
      picture: row.PhotoUrl || null,
      adUsername: row.AdUsername || '',
      phone: row.Phone || '',
      signatureLink: row.SignatureUrl || '',
      signatureStatus: row.SignatureStatus || '',
      signatureId: row.SignatureId || '',
      signatureTitle: row.SignatureTitleTr || '',
      signatureTitleEn: row.SignatureTitleEn || '',
      signatureTemplateVariant: row.SignatureTemplateKey || '',
      signatureMissing: !row.SignatureUrl
    };
  }

  const hardware = hardwareResult.recordset.map((row) => {
    const status = toUiStatus(row.HardwareStatus);
    const assignedTo = status === 'Assigned' || status === 'Transfer' ? row.AssignedPersonId || null : null;

    if (assignedTo && !uniqueUsers[assignedTo] && !String(assignedTo).toUpperCase().includes('GÖNDEREN:')) {
      uniqueUsers[assignedTo] = {
        id: assignedTo,
        name: assignedTo,
        campus: row.Campus || 'Bilinmiyor',
        department: 'Personel',
        email: '',
        status: 'Aktif',
        picture: null
      };
    }

    return {
      id: row.SerialNo,
      type: row.DeviceType || 'Laptop',
      brand: row.Brand || '',
      model: row.Model || '',
      deviceName: row.ComputerName || '',
      serial: row.SerialNo,
      campus: row.Campus || 'Bilinmiyor',
      status,
      assignedTo,
      driveLink: row.DriveLink || null,
      history: [],
      hasHistory: Boolean(row.HasHistory),
      historyLoaded: false,
      groupName: row.GroupName || '',
      notes: row.Notes || '',
      glpiId: row.GlpiId || '',
      glpiComputerName: row.GlpiComputerName || '',
      glpiAdUser: row.GlpiAdUsername || '',
      glpiPersonName: row.GlpiPersonnelName || '',
      glpiCampusGuess: row.GlpiCampusGuess || '',
      glpiDeviceType: row.GlpiDeviceType || '',
      glpiMatchType: row.GlpiMatchType || '',
      glpiMismatch: row.GlpiMismatch || '',
      glpiLastSync: row.GlpiLastSync || ''
    };
  });

  return {
    personnel: Object.values(uniqueUsers),
    hardware
  };
}

export async function fetchHardwareHistoryForUser(user, serialNo) {
  const deviceResult = await query(
    `
      SELECT TOP 1 h.HardwareId, h.SerialNo, c.Name AS Campus
      FROM dbo.Hardware h
      LEFT JOIN dbo.Campuses c ON c.CampusId = h.CampusId
      WHERE h.SerialNo = @serialNo
    `,
    { serialNo: { type: sql.NVarChar(160), value: String(serialNo || '') } }
  );

  const device = deviceResult.recordset[0];
  if (!device) throw new Error('Cihaz bulunamadı.');
  if (!canSeeCampus(user, device.Campus)) throw new Error('Bu cihazın geçmişini görme yetkiniz yok.');

  const historyResult = await query(
    `
      SELECT TOP 100 EventType, PersonName, DriveLink, EventDate, DetailsJson
      FROM dbo.HardwareHistory
      WHERE HardwareId = @hardwareId
      ORDER BY EventDate DESC, HistoryId DESC
    `,
    { hardwareId: { type: sql.Int, value: device.HardwareId } }
  );

  return historyResult.recordset.map((row) => ({
    personName: row.PersonName || '',
    date: row.EventDate,
    driveLink: row.DriveLink || '',
    type: row.EventType || '',
    details: row.DetailsJson || ''
  }));
}

export async function addHardwareForUser(user, data) {
  const hardware = data.hardware || {};
  const serial = cleanText(hardware.serial || hardware.id, 160);
  if (!serial) throw new Error('Seri no boş olamaz.');

  const campus = user.role === 'HQ IT' && hardware.campus ? hardware.campus : user.campus;
  const campusId = await ensureCampusId(campus);

  await query(
    `
      INSERT INTO dbo.Hardware (SerialNo, Model, CampusId, HardwareStatus, ComputerName, DeviceType, Brand, Notes)
      VALUES (@serial, @model, @campusId, N'DEPODA', @computerName, @deviceType, @brand, @notes)
    `,
    {
      serial: { type: sql.NVarChar(160), value: serial },
      model: { type: sql.NVarChar(240), value: cleanText(hardware.model, 240) || null },
      campusId: { type: sql.UniqueIdentifier, value: campusId },
      computerName: { type: sql.NVarChar(160), value: cleanText(hardware.deviceName, 160) || null },
      deviceType: { type: sql.NVarChar(80), value: cleanText(hardware.type || 'Laptop', 80) },
      brand: { type: sql.NVarChar(120), value: cleanText(hardware.brand, 120) || null },
      notes: { type: sql.NVarChar(sql.MAX), value: '' }
    }
  );

  const rows = await findHardwareRows(user, [serial], { skipCampusCheck: user.role === 'HQ IT' });
  await appendHardwareHistory(rows[0].HardwareId, 'Yeni Donanım', { personName: user.email, createdBy: user.email });
  await appendSystemLog('DONANIM EKLE', user, `S/N: ${serial}`, data.clientIp || '');
  return { id: serial };
}

export async function updateHardwareForUser(user, data) {
  const rows = await findHardwareRows(user, [data.hardwareId]);
  const updates = data.updates || {};
  const sets = [];
  const bind = { serial: { type: sql.NVarChar(160), value: rows[0].SerialNo } };

  if (Object.prototype.hasOwnProperty.call(updates, 'notes')) {
    sets.push('Notes = @notes');
    bind.notes = { type: sql.NVarChar(sql.MAX), value: cleanText(updates.notes, 4000) };
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'deviceName')) {
    sets.push('ComputerName = @deviceName');
    bind.deviceName = { type: sql.NVarChar(160), value: cleanText(updates.deviceName, 160) || null };
  }

  if (!sets.length) return {};

  await query(
    `UPDATE dbo.Hardware SET ${sets.join(', ')}, UpdatedAt = SYSUTCDATETIME() WHERE SerialNo = @serial`,
    bind
  );
  await appendSystemLog('DONANIM GUNCELLE', user, `${rows[0].SerialNo}: ${Object.keys(updates).join(', ')}`, data.clientIp || '');
  return {};
}

export async function bulkUpdateGroupForUser(user, data) {
  const rows = await findHardwareRows(user, data.hardwareIds);
  const groupName = cleanText(data.groupName, 160) || null;

  for (const row of rows) {
    await query(
      `UPDATE dbo.Hardware SET GroupName = @groupName, UpdatedAt = SYSUTCDATETIME() WHERE HardwareId = @hardwareId`,
      {
        groupName: { type: sql.NVarChar(160), value: groupName },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
  }

  await appendSystemLog('GRUP GUNCELLE', user, `${rows.length} cihaz -> ${groupName || '-'}`, data.clientIp || '');
  return { count: rows.length };
}

export async function bulkStatusUpdateForUser(user, data) {
  const rows = await findHardwareRows(user, data.hardwareIds);
  const dbStatus = toDbStatus(data.newStatus);
  if (!['DEPODA', 'HURDA'].includes(dbStatus)) throw new Error('Bu toplu işlem sadece Depo veya Hurda için kullanılabilir.');

  for (const row of rows) {
    await query(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = @status,
            AssignedPersonId = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        status: { type: sql.NVarChar(40), value: dbStatus },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
    await appendHardwareHistory(row.HardwareId, `Toplu İşlem: ${dbStatus}`, {
      personName: user.email,
      createdBy: user.email,
      detailsJson: { previousStatus: row.HardwareStatus, newStatus: dbStatus }
    });
  }

  await appendSystemLog('TOPLU DURUM', user, `${rows.length} cihaz -> ${dbStatus}`, data.clientIp || '');
  return { count: rows.length };
}

export async function recordInventoryScanForUser(user, data) {
  const rows = await findHardwareRows(user, [data.hardwareId]);
  const row = rows[0];
  const scannedAt = new Date();

  await appendHardwareHistory(row.HardwareId, 'Sayımda görüldü', {
    personName: user.email,
    createdBy: user.email,
    eventDate: scannedAt,
    detailsJson: {
      qrPayload: data.qrPayload || '',
      clientIp: data.clientIp || '',
      serial: row.SerialNo
    }
  });

  await appendSystemLog('SAYIM QR', user, `S/N: ${row.SerialNo}`, data.clientIp || '');
  return { scannedAt: scannedAt.toLocaleString('tr-TR') };
}

export async function createSheetForUser(user, data) {
  const exportData = Array.isArray(data.data) ? data.data : [];
  if (!exportData.length) throw new Error('Aktarılacak veri bulunamadı.');

  const headers = Object.keys(exportData[0]).map((header) => sanitizeExcelCell(header));
  const rows = exportData.map((item) =>
    Object.keys(exportData[0]).map((header) => sanitizeExcelCell(item?.[header]))
  );

  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([headers, ...rows]);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Liste');

  const baseDir =
    config.exports.dir ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generated-exports');
  await fs.mkdir(baseDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const fileName = safeFileName(`${data.sheetName || 'Disa Aktarim'}-${stamp}.xlsx`, `disa-aktarim-${stamp}.xlsx`);
  const filePath = path.join(baseDir, fileName);
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  await fs.writeFile(filePath, buffer);

  const publicBase = String(config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/+$/, '');
  const url = `${publicBase}/exports/${encodeURIComponent(fileName)}`;
  await appendSystemLog('EXPORT XLSX', user, `${rows.length} kayıt aktarıldı: ${fileName}`, data.clientIp || '');

  return { url, fileName, count: rows.length };
}

export async function manualAssignOrUploadMissingDocumentForUser(user, data) {
  const action = data.action;
  const isManualAssign = action === 'manualAssign';
  const rows = await findHardwareRows(user, [data.hardwareId]);
  const row = rows[0];
  const status = String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I');

  if (status === 'TRANSFER') throw new Error('Cihaz transferde.');
  if (isManualAssign && status === 'AKTIF') throw new Error('Cihaz zaten başkasına zimmetli.');
  if (isManualAssign && status === 'HURDA') throw new Error('Hurda durumundaki cihaza manuel zimmet yapılamaz.');

  let person = {
    id: '',
    name: cleanText(data.personName, 240) || 'Personel',
    campus: row.Campus || user.campus
  };

  if (isManualAssign) {
    person = await getPersonDetailsForDocument(data.personId);
    if (user.role !== 'HQ IT') {
      assertCanAccessCampus(user, person.campus, 'Farklı kampüs personeline manuel zimmet yapılamaz.');
    }
  }

  const fileInfo = validateUploadedFile(data.pdfData, data.pdfName);
  const upload = await uploadFileThroughGoogleBridge({
    fileBuffer: fileInfo.buffer,
    fileName: fileInfo.fileName,
    mimeType: fileInfo.mimeType,
    campus: row.Campus || user.campus,
    meta: {
      source: action,
      hardwareId: row.HardwareId,
      serial: row.SerialNo,
      requestedBy: user.email
    }
  });

  if (isManualAssign) {
    await query(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'AKTIF',
            AssignedPersonId = @personId,
            DriveLink = @driveLink,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        personId: { type: sql.NVarChar(160), value: person.id },
        driveLink: { type: sql.NVarChar(1000), value: upload.url || null },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
  } else {
    await query(
      `
        UPDATE dbo.Hardware
        SET DriveLink = @driveLink,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        driveLink: { type: sql.NVarChar(1000), value: upload.url || null },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
  }

  await appendHardwareHistory(row.HardwareId, isManualAssign ? 'Manuel Zimmet' : 'Eksik Belge', {
    personId: isManualAssign ? person.id : null,
    personName: person.name,
    driveLink: upload.url || '',
    createdBy: user.email,
    detailsJson: {
      fileName: fileInfo.fileName,
      fileHash: fileInfo.fileHash,
      previousStatus: row.HardwareStatus
    }
  });

  await appendSystemLog(
    isManualAssign ? 'MANUEL ZIMMET' : 'EKSIK BELGE',
    user,
    `${row.SerialNo} -> ${person.name} / ${fileInfo.fileName} / ${fileInfo.fileHash}`,
    data.clientIp || ''
  );

  return { url: upload.url || '', fileHash: fileInfo.fileHash };
}

async function ensureAdPasswordQueueTable() {
  await query(`
IF OBJECT_ID('dbo.ADPasswordQueue', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ADPasswordQueue (
    QueueId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ADPasswordQueue PRIMARY KEY,
    PublicId NVARCHAR(80) NOT NULL CONSTRAINT UQ_ADPasswordQueue_PublicId UNIQUE,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_ADPasswordQueue_CreatedAt DEFAULT SYSUTCDATETIME(),
    StartedAt DATETIME2 NULL,
    FinishedAt DATETIME2 NULL,
    Status NVARCHAR(40) NOT NULL CONSTRAINT DF_ADPasswordQueue_Status DEFAULT N'BEKLIYOR',
    Priority INT NOT NULL CONSTRAINT DF_ADPasswordQueue_Priority DEFAULT 3,
    PersonId NVARCHAR(160) NOT NULL,
    PersonName NVARCHAR(240) NOT NULL,
    PersonEmail NVARCHAR(320) NULL,
    AdUsername NVARCHAR(160) NOT NULL,
    PasswordMode NVARCHAR(40) NOT NULL,
    PasswordCiphertext NVARCHAR(MAX) NOT NULL,
    EncryptionAlg NVARCHAR(80) NOT NULL,
    EncryptionKeyId NVARCHAR(120) NULL,
    Reason NVARCHAR(1000) NULL,
    NotifyEmail BIT NOT NULL CONSTRAINT DF_ADPasswordQueue_NotifyEmail DEFAULT 0,
    NotifySms BIT NOT NULL CONSTRAINT DF_ADPasswordQueue_NotifySms DEFAULT 0,
    NotifyPhone NVARCHAR(20) NULL,
    RequestedBy NVARCHAR(320) NOT NULL,
    CampusId UNIQUEIDENTIFIER NULL,
    CampusName NVARCHAR(160) NULL,
    ResultMessage NVARCHAR(MAX) NULL,
    ErrorMessage NVARCHAR(MAX) NULL,
    AttemptCount INT NOT NULL CONSTRAINT DF_ADPasswordQueue_AttemptCount DEFAULT 0,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_ADPasswordQueue_UpdatedAt DEFAULT SYSUTCDATETIME(),
    ClientIp NVARCHAR(120) NULL,
    UserAgent NVARCHAR(500) NULL
  );
END
`);
}

async function getPersonDetailsForAd(personId) {
  const cleanPersonId = cleanText(personId, 160);
  if (!cleanPersonId) throw new Error('Personel seçimi boş.');

  const result = await query(
    `
      SELECT TOP 1
        p.PersonId,
        p.FullName,
        p.Email,
        p.AdUsername,
        p.Phone,
        p.CampusId,
        c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE p.PersonId = @personId
    `,
    { personId: { type: sql.NVarChar(160), value: cleanPersonId } }
  );

  const row = result.recordset[0];
  if (!row) throw new Error('Personel veritabanında bulunamadı.');
  const adUsername = normalizeAdLogin(row.AdUsername || row.Email || cleanPersonId);
  if (!adUsername) throw new Error('Personel için AD kullanıcı adı bulunamadı.');

  return {
    id: row.PersonId,
    name: row.FullName || row.PersonId,
    email: String(row.Email || '').toLowerCase(),
    adUsername,
    phone: row.Phone || '',
    campusId: row.CampusId || null,
    campus: row.Campus || 'Bilinmiyor'
  };
}

export async function enqueueAdPasswordResetForUser(user, data) {
  await ensureAdPasswordQueueTable();
  const person = await getPersonDetailsForAd(data.personId);
  if (user.role !== 'HQ IT') {
    assertCanAccessCampus(user, person.campus, 'Sadece kendi kampüsünüzdeki personelin şifresini sıfırlayabilirsiniz.');
  }

  const mode = data.passwordMode === 'TEMPORARY' ? 'TEMPORARY' : 'PERMANENT';
  const ciphertext = cleanText(data.passwordCiphertext, 8000);
  if (!ciphertext) throw new Error('Şifreli şifre verisi geçersiz.');
  if (data.encryptionAlg !== 'RSA-OAEP-SHA256') throw new Error('Desteklenmeyen şifreleme algoritması.');

  const notifyEmail = data.notifyEmail === true;
  const notifySms = data.notifySms === true;
  const notifyPhone = normalizePhone(data.notifyPhone || person.phone);
  if (notifySms && !/^5\d{9}$/.test(notifyPhone)) throw new Error('SMS bildirimi için 5 ile başlayan 10 haneli telefon gerekli.');
  if (notifySms && notifyPhone) {
    await updatePersonnelPhoneForUser(user, person.id, notifyPhone);
  }

  const publicId = `AD-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await query(
    `
      INSERT INTO dbo.ADPasswordQueue (
        PublicId, Status, Priority, PersonId, PersonName, PersonEmail, AdUsername,
        PasswordMode, PasswordCiphertext, EncryptionAlg, EncryptionKeyId, Reason,
        NotifyEmail, NotifySms, NotifyPhone, RequestedBy, CampusId, CampusName,
        ClientIp, UserAgent
      )
      VALUES (
        @publicId, N'BEKLIYOR', 3, @personId, @personName, @personEmail, @adUsername,
        @mode, @ciphertext, @encryptionAlg, @encryptionKeyId, @reason,
        @notifyEmail, @notifySms, @notifyPhone, @requestedBy, @campusId, @campusName,
        @clientIp, @userAgent
      )
    `,
    {
      publicId: { type: sql.NVarChar(80), value: publicId },
      personId: { type: sql.NVarChar(160), value: person.id },
      personName: { type: sql.NVarChar(240), value: person.name },
      personEmail: { type: sql.NVarChar(320), value: person.email || null },
      adUsername: { type: sql.NVarChar(160), value: person.adUsername },
      mode: { type: sql.NVarChar(40), value: mode },
      ciphertext: { type: sql.NVarChar(sql.MAX), value: ciphertext },
      encryptionAlg: { type: sql.NVarChar(80), value: data.encryptionAlg },
      encryptionKeyId: { type: sql.NVarChar(120), value: cleanText(data.encryptionKeyId, 120) || null },
      reason: { type: sql.NVarChar(1000), value: cleanText(data.reason, 1000) || null },
      notifyEmail: { type: sql.Bit, value: notifyEmail },
      notifySms: { type: sql.Bit, value: notifySms },
      notifyPhone: { type: sql.NVarChar(20), value: notifySms ? notifyPhone : null },
      requestedBy: { type: sql.NVarChar(320), value: user.email },
      campusId: { type: sql.UniqueIdentifier, value: person.campusId || null },
      campusName: { type: sql.NVarChar(160), value: person.campus },
      clientIp: { type: sql.NVarChar(120), value: cleanText(data.clientIp, 120) || null },
      userAgent: { type: sql.NVarChar(500), value: cleanText(data.userAgent, 500) || null }
    }
  );

  await appendSystemLog('AD SIFRE RESET KUYRUK', user, `${person.name} / ${person.adUsername} / ${mode}`, data.clientIp || '');
  return { queued: true, queueId: publicId, status: 'BEKLIYOR' };
}

export async function fetchAdPasswordQueueForUser(user, data = {}) {
  await ensureAdPasswordQueueTable();
  const limit = Math.min(Math.max(Number(data.limit || 25), 1), 100);
  const result = await query(
    `
      SELECT TOP (@limit)
        q.PublicId,
        q.CreatedAt,
        q.FinishedAt,
        q.Status,
        q.PersonName,
        q.AdUsername,
        q.PasswordMode,
        q.RequestedBy,
        q.CampusName,
        q.ResultMessage,
        q.ErrorMessage,
        q.UpdatedAt
      FROM dbo.ADPasswordQueue q
      LEFT JOIN dbo.Campuses c ON c.CampusId = q.CampusId
      WHERE @isHq = 1 OR q.RequestedBy = @email OR c.CoreName = @campusCore
      ORDER BY q.CreatedAt DESC
    `,
    {
      limit: { type: sql.Int, value: limit },
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' },
      email: { type: sql.NVarChar(320), value: user.email },
      campusCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  return {
    jobs: result.recordset.map((row) => ({
      queueId: row.PublicId,
      createdAt: row.CreatedAt,
      finishedAt: row.FinishedAt,
      status: row.Status,
      personName: row.PersonName,
      adUser: row.AdUsername,
      mode: row.PasswordMode,
      executedBy: row.RequestedBy,
      campus: row.CampusName,
      result: row.ResultMessage || '',
      error: row.ErrorMessage || '',
      updatedAt: row.UpdatedAt
    }))
  };
}

export async function fetchAdPasswordAgentJobs(secret, data = {}) {
  if (!config.adAgentSecret || secret !== config.adAgentSecret) {
    throw new Error('Yetkisiz AD agent isteği.');
  }
  await ensureAdPasswordQueueTable();
  const limit = Math.min(Math.max(Number(data.limit || 5), 1), 20);

  const leaseResult = await query(
    `
      UPDATE TOP (@limit) dbo.ADPasswordQueue
      SET Status = N'ISLENIYOR',
          StartedAt = COALESCE(StartedAt, SYSUTCDATETIME()),
          AttemptCount = AttemptCount + 1,
          UpdatedAt = SYSUTCDATETIME()
      OUTPUT
        INSERTED.PublicId,
        INSERTED.PersonId,
        INSERTED.PersonName,
        INSERTED.AdUsername,
        INSERTED.PasswordMode,
        INSERTED.PasswordCiphertext,
        INSERTED.EncryptionAlg,
        INSERTED.EncryptionKeyId,
        INSERTED.Reason,
        INSERTED.PersonEmail,
        INSERTED.NotifyEmail,
        INSERTED.NotifySms,
        INSERTED.NotifyPhone,
        INSERTED.RequestedBy
      WHERE Status = N'BEKLIYOR'
    `,
    { limit: { type: sql.Int, value: limit } }
  );

  return {
    leased: leaseResult.recordset.length,
    jobs: leaseResult.recordset.map((row) => ({
      queueId: row.PublicId,
      personId: row.PersonId,
      personName: row.PersonName,
      adUser: row.AdUsername,
      mode: row.PasswordMode,
      passwordCiphertext: row.PasswordCiphertext,
      encryptionAlg: row.EncryptionAlg,
      encryptionKeyId: row.EncryptionKeyId,
      reason: row.Reason || '',
      personEmail: row.PersonEmail || '',
      notifyEmail: Boolean(row.NotifyEmail),
      notifySms: Boolean(row.NotifySms),
      notifyPhone: row.NotifyPhone || '',
      requestedBy: row.RequestedBy
    }))
  };
}

export async function completeAdPasswordAgentJob(secret, data = {}) {
  if (!config.adAgentSecret || secret !== config.adAgentSecret) {
    throw new Error('Yetkisiz AD agent isteği.');
  }
  await ensureAdPasswordQueueTable();
  const queueId = cleanText(data.queueId, 80);
  if (!queueId) throw new Error('Queue ID boş.');

  await query(
    `
      UPDATE dbo.ADPasswordQueue
      SET Status = @status,
          FinishedAt = SYSUTCDATETIME(),
          ResultMessage = @resultMessage,
          ErrorMessage = @errorMessage,
          UpdatedAt = SYSUTCDATETIME()
      WHERE PublicId = @queueId
    `,
    {
      status: { type: sql.NVarChar(40), value: data.success === true ? 'TAMAMLANDI' : 'HATA' },
      resultMessage: { type: sql.NVarChar(sql.MAX), value: data.success === true ? cleanText(data.result || 'AD şifresi uygulandı.', 4000) : null },
      errorMessage: { type: sql.NVarChar(sql.MAX), value: data.success === true ? null : cleanText(data.error || 'Bilinmeyen hata', 4000) },
      queueId: { type: sql.NVarChar(80), value: queueId }
    }
  );

  return {};
}

async function ensureSignatureTitlesTable() {
  await query(`
IF OBJECT_ID('dbo.SignatureTitles', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SignatureTitles (
    TitleId INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SignatureTitles PRIMARY KEY,
    TitleTr NVARCHAR(240) NOT NULL,
    TitleEn NVARCHAR(240) NULL,
    TemplateKey NVARCHAR(20) NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_SignatureTitles_IsActive DEFAULT 1,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_SignatureTitles_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_SignatureTitles_UpdatedAt DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX UX_SignatureTitles_TitleTr ON dbo.SignatureTitles(TitleTr);
END
`);
}

export async function fetchSignatureMetaForUser(user) {
  await ensureSignatureTitlesTable();
  const [titlesResult, campusResult, missingResult] = await Promise.all([
    query(`
      SELECT TitleTr, TitleEn, TemplateKey
      FROM dbo.SignatureTitles
      WHERE IsActive = 1
      ORDER BY TitleTr
    `),
    query(`
      SELECT Name AS Campus, COALESCE(ShortAddress, AddressText, N'') AS AddressText, CampusImage
      FROM dbo.Campuses
      WHERE IsActive = 1 AND (@isHq = 1 OR CoreName = @userCore)
      ORDER BY Name
    `, {
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' || core(user.campus) === 'genel müdürlük' || core(user.campus) === 'genel mudurluk' },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }),
    query(`
      SELECT COUNT(1) AS MissingCount
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE (@isHq = 1 OR c.CoreName = @userCore)
        AND ISNULL(p.SignatureUrl, N'') = N''
        AND ISNULL(p.Email, N'') LIKE N'%@%'
        AND ISNULL(p.Status, N'Aktif') NOT IN (N'Pasif')
        AND p.FullName NOT LIKE N'%Kullanıcı Bulunamadı%'
    `, {
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    })
  ]);

  const canChooseCampus = user.role === 'HQ IT' || ['genel müdürlük', 'genel mudurluk'].includes(core(user.campus));

  return {
    titles: titlesResult.recordset.map((row) => ({
      titleTr: row.TitleTr,
      titleEn: row.TitleEn || '',
      templateKey: row.TemplateKey || ''
    })),
    campuses: campusResult.recordset.map((row) => ({
      campus: row.Campus,
      address: row.AddressText || '',
      hasImage: Boolean(row.CampusImage)
    })),
    canChooseCampus,
    missingCount: missingResult.recordset[0]?.MissingCount || 0
  };
}

async function ensureSignatureJobsTable() {
  await query(`
IF OBJECT_ID('dbo.SignatureJobs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.SignatureJobs (
    JobId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_SignatureJobs PRIMARY KEY,
    PublicId NVARCHAR(80) NOT NULL CONSTRAINT UQ_SignatureJobs_PublicId UNIQUE,
    SignatureId NVARCHAR(80) NOT NULL,
    Status NVARCHAR(40) NOT NULL CONSTRAINT DF_SignatureJobs_Status DEFAULT N'BEKLIYOR',
    PersonId NVARCHAR(160) NOT NULL,
    PersonName NVARCHAR(240) NOT NULL,
    PersonEmail NVARCHAR(320) NOT NULL,
    TitleTr NVARCHAR(240) NOT NULL,
    TitleEn NVARCHAR(240) NULL,
    SignatureCampus NVARCHAR(160) NULL,
    AddressText NVARCHAR(500) NULL,
    CampusImage NVARCHAR(1000) NULL,
    ImageUrl NVARCHAR(1000) NOT NULL,
    TemplateKey NVARCHAR(20) NULL,
    GamCommand NVARCHAR(1000) NULL,
    DatasetJson NVARCHAR(MAX) NOT NULL,
    RequestedBy NVARCHAR(320) NOT NULL,
    ErrorMessage NVARCHAR(MAX) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_SignatureJobs_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_SignatureJobs_UpdatedAt DEFAULT SYSUTCDATETIME(),
    FinishedAt DATETIME2 NULL
  );
END
`);
}

async function getSignatureTitle(titleTr) {
  await ensureSignatureTitlesTable();
  const result = await query(`
      SELECT TitleTr, TitleEn, TemplateKey
      FROM dbo.SignatureTitles
      WHERE IsActive = 1
    `);
  const target = normalizeSignatureText(titleTr);
  const row = result.recordset.find((item) => normalizeSignatureText(item.TitleTr) === target);
  if (!row) throw new Error('Seçilen ünvan SQL SignatureTitles tablosunda bulunamadı. Ünvanlar sayfasını SQL’e aktarın.');
  return {
    titleTr: row.TitleTr,
    titleEn: row.TitleEn || '',
    templateKey: row.TemplateKey || ''
  };
}

async function getSignatureCampusInfo(user, requestedCampus, personCampus) {
  const canChooseCampus = user.role === 'HQ IT' || ['genel müdürlük', 'genel mudurluk'].includes(core(user.campus));
  const finalCampus = canChooseCampus ? cleanText(requestedCampus || personCampus || user.campus, 160) : cleanText(personCampus || user.campus, 160);

  if (!canChooseCampus && requestedCampus && core(requestedCampus) !== core(finalCampus)) {
    throw new Error('Bu personel için farklı imza kampüsü seçemezsiniz.');
  }

  const result = await query(
    `
      SELECT TOP 1 Name, COALESCE(ShortAddress, AddressText, N'') AS AddressText, CampusImage
      FROM dbo.Campuses
      WHERE CoreName = @core OR Name = @name
    `,
    {
      core: { type: sql.NVarChar(160), value: core(finalCampus) },
      name: { type: sql.NVarChar(160), value: finalCampus }
    }
  );
  const row = result.recordset[0];
  if (!row) throw new Error(`İmza için kampüs bilgisi bulunamadı: ${finalCampus}`);
  return {
    campus: row.Name,
    address: row.AddressText || '',
    image: row.CampusImage || ''
  };
}

async function makeSignatureId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 11).toUpperCase();
    const result = await query(
      `SELECT TOP 1 1 AS Found FROM dbo.Personnel WHERE SignatureId = @id`,
      { id: { type: sql.NVarChar(80), value: id } }
    );
    if (!result.recordset.length) return id;
  }
  throw new Error('Benzersiz imza ID üretilemedi.');
}

export async function createPersonnelSignatureForUser(user, data) {
  await ensureSignatureJobsTable();
  const person = await getPersonDetailsForDocument(data.personId);
  if (user.role !== 'HQ IT') {
    assertCanAccessCampus(user, person.campus, 'Farklı kampüs personeline imza oluşturamazsınız.');
  }

  const title = await getSignatureTitle(data.titleTr);
  const campusInfo = await getSignatureCampusInfo(user, data.signatureCampus, person.campus);
  const templateVariant = getSignatureTemplateVariant(title.titleTr, title.titleEn, title.templateKey);

  const existingSignature = await query(
    `SELECT SignatureId FROM dbo.Personnel WHERE PersonId = @personId`,
    { personId: { type: sql.NVarChar(160), value: person.id } }
  );
  const currentId = cleanText(existingSignature.recordset[0]?.SignatureId, 80);
  const signatureId = currentId || await makeSignatureId();
  const imageUrl = `https://istek.site/imza/${signatureId}/${signatureId}.jpg`;
  const gamCommand = `gam user "${person.email}" signature file "signature/${signatureId}.html" html`;
  const publicId = `SIG-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const dataset = {
    id: signatureId,
    name: person.name,
    titleTr: title.titleTr,
    titleEn: title.titleEn,
    email: person.email,
    address: campusInfo.address,
    campusImage: campusInfo.image,
    imageUrl,
    gamCommand,
    templateVariant
  };

  await query(
    `
      INSERT INTO dbo.SignatureJobs (
        PublicId, SignatureId, Status, PersonId, PersonName, PersonEmail,
        TitleTr, TitleEn, SignatureCampus, AddressText, CampusImage, ImageUrl,
        TemplateKey, GamCommand, DatasetJson, RequestedBy
      )
      VALUES (
        @publicId, @signatureId, N'BEKLIYOR', @personId, @personName, @personEmail,
        @titleTr, @titleEn, @signatureCampus, @addressText, @campusImage, @imageUrl,
        @templateKey, @gamCommand, @datasetJson, @requestedBy
      )
    `,
    {
      publicId: { type: sql.NVarChar(80), value: publicId },
      signatureId: { type: sql.NVarChar(80), value: signatureId },
      personId: { type: sql.NVarChar(160), value: person.id },
      personName: { type: sql.NVarChar(240), value: person.name },
      personEmail: { type: sql.NVarChar(320), value: person.email },
      titleTr: { type: sql.NVarChar(240), value: title.titleTr },
      titleEn: { type: sql.NVarChar(240), value: title.titleEn || null },
      signatureCampus: { type: sql.NVarChar(160), value: campusInfo.campus },
      addressText: { type: sql.NVarChar(500), value: campusInfo.address || null },
      campusImage: { type: sql.NVarChar(1000), value: campusInfo.image || null },
      imageUrl: { type: sql.NVarChar(1000), value: imageUrl },
      templateKey: { type: sql.NVarChar(20), value: templateVariant },
      gamCommand: { type: sql.NVarChar(1000), value: gamCommand },
      datasetJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(dataset) },
      requestedBy: { type: sql.NVarChar(320), value: user.email }
    }
  );

  await query(
    `
      UPDATE dbo.Personnel
      SET Department = @titleTr,
          SignatureUrl = @imageUrl,
          SignatureId = @signatureId,
          SignatureStatus = N'İşleme alındı',
          SignatureTitleTr = @titleTr,
          SignatureTitleEn = @titleEn,
          SignatureTemplateKey = @templateKey,
          UpdatedAt = SYSUTCDATETIME()
      WHERE PersonId = @personId
    `,
    {
      personId: { type: sql.NVarChar(160), value: person.id },
      titleTr: { type: sql.NVarChar(240), value: title.titleTr },
      titleEn: { type: sql.NVarChar(240), value: title.titleEn || null },
      imageUrl: { type: sql.NVarChar(1000), value: imageUrl },
      signatureId: { type: sql.NVarChar(80), value: signatureId },
      templateKey: { type: sql.NVarChar(20), value: templateVariant }
    }
  );

  await appendSystemLog('IMZA OLUSTUR KUYRUK', user, `${person.name} -> ${title.titleTr} / ${publicId}`, data.clientIp || '');
  return {
    personId: person.id,
    titleTr: title.titleTr,
    titleEn: title.titleEn,
    signatureCampus: campusInfo.campus,
    signatureTemplateVariant: templateVariant,
    signatureId,
    signatureLink: imageUrl,
    signatureStatus: 'İşleme alındı',
    signatureUpdatedAt: new Date().toISOString(),
    queueId: publicId
  };
}

function requireSignatureAgentSecret(secret) {
  if (!config.signatureAgentSecret || secret !== config.signatureAgentSecret) {
    throw new Error('Yetkisiz imza agent isteği.');
  }
}

function parseSignatureDataset(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function fetchSignatureAgentJobs(secret, data = {}) {
  requireSignatureAgentSecret(secret);
  await ensureSignatureJobsTable();
  const limit = Math.min(Math.max(Number(data.limit || 5), 1), 25);

  const leaseResult = await query(
    `
      UPDATE TOP (@limit) dbo.SignatureJobs
      SET Status = N'ISLENIYOR',
          UpdatedAt = SYSUTCDATETIME()
      OUTPUT
        INSERTED.PublicId,
        INSERTED.SignatureId,
        INSERTED.PersonId,
        INSERTED.PersonName,
        INSERTED.PersonEmail,
        INSERTED.TitleTr,
        INSERTED.TitleEn,
        INSERTED.SignatureCampus,
        INSERTED.AddressText,
        INSERTED.CampusImage,
        INSERTED.ImageUrl,
        INSERTED.TemplateKey,
        INSERTED.GamCommand,
        INSERTED.DatasetJson,
        INSERTED.RequestedBy
      WHERE Status IN (N'BEKLIYOR', N'HATA')
    `,
    { limit: { type: sql.Int, value: limit } }
  );

  return {
    leased: leaseResult.recordset.length,
    jobs: leaseResult.recordset.map((row) => {
      const dataset = parseSignatureDataset(row.DatasetJson);
      return {
        queueId: row.PublicId,
        signatureId: row.SignatureId,
        personId: row.PersonId,
        personName: row.PersonName,
        personEmail: row.PersonEmail,
        titleTr: row.TitleTr,
        titleEn: row.TitleEn || '',
        signatureCampus: row.SignatureCampus || '',
        address: row.AddressText || '',
        campusImage: row.CampusImage || '',
        imageUrl: row.ImageUrl,
        templateVariant: row.TemplateKey || dataset.templateVariant || 'normal',
        gamCommand: row.GamCommand || dataset.gamCommand || '',
        dataset
      };
    })
  };
}

export async function completeSignatureAgentJob(secret, data = {}) {
  requireSignatureAgentSecret(secret);
  await ensureSignatureJobsTable();
  const signatureId = cleanText(data.signatureId, 80);
  const queueId = cleanText(data.queueId, 80);
  if (!signatureId && !queueId) throw new Error('İmza ID veya kuyruk ID boş.');

  const success = data.success !== false;
  const status = success ? 'TAMAMLANDI' : 'HATA';
  const personStatus = success ? 'Basıldı' : 'Hata';
  const errorMessage = success ? null : cleanText(data.error || 'İmza ajanı hata bildirdi.', 4000);

  const result = await query(
    `
      UPDATE dbo.SignatureJobs
      SET Status = @status,
          ErrorMessage = @errorMessage,
          FinishedAt = CASE WHEN @success = 1 THEN SYSUTCDATETIME() ELSE FinishedAt END,
          UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.SignatureId, INSERTED.PersonId, INSERTED.ImageUrl
      WHERE (@queueId <> N'' AND PublicId = @queueId)
         OR (@queueId = N'' AND @signatureId <> N'' AND SignatureId = @signatureId AND Status = N'ISLENIYOR')
    `,
    {
      status: { type: sql.NVarChar(40), value: status },
      errorMessage: { type: sql.NVarChar(sql.MAX), value: errorMessage },
      success: { type: sql.Bit, value: success },
      signatureId: { type: sql.NVarChar(80), value: signatureId },
      queueId: { type: sql.NVarChar(80), value: queueId }
    }
  );

  const completed = result.recordset[0];
  if (!completed) throw new Error('Tamamlanacak imza işi bulunamadı.');

  await query(
    `
      UPDATE dbo.Personnel
      SET SignatureStatus = @signatureStatus,
          SignatureUrl = COALESCE(@imageUrl, SignatureUrl),
          UpdatedAt = SYSUTCDATETIME()
      WHERE SignatureId = @signatureId
    `,
    {
      signatureStatus: { type: sql.NVarChar(80), value: personStatus },
      imageUrl: { type: sql.NVarChar(1000), value: completed.ImageUrl || null },
      signatureId: { type: sql.NVarChar(80), value: completed.SignatureId }
    }
  );

  await appendSystemLog(
    success ? 'IMZA BASILDI' : 'IMZA HATASI',
    { email: 'Windows İmza Agent' },
    completed.SignatureId,
    data.machine || ''
  );

  return { signatureId: completed.SignatureId, status: personStatus };
}
export async function startTransferForUser(user, data) {
  const targetCampus = cleanText(data.targetCampus, 160);
  if (!targetCampus) throw new Error('Hedef kampüs boş.');
  const targetCampusId = await ensureCampusId(targetCampus);
  const rows = await findHardwareRows(user, data.hardwareIds, { requireStatus: 'DEPODA' });
  const senderLabel = `GÖNDEREN:${user.campus}`;
  const transferSignature = validateSignatureData(data.transferSignature, 'Transfer');
  const pdfName = safePdfName(data.pdfName, 'transfer-cikis.pdf');
  const hardware = rows.map((row) => ({
    hardwareId: row.HardwareId,
    serial: row.SerialNo,
    type: row.DeviceType || 'Cihaz',
    brand: row.Brand || '',
    model: row.Model || '',
    computerName: row.ComputerName || '',
    campus: row.Campus || ''
  }));
  const queue = await enqueuePdfJob({
    actionType: 'GENERATE_TRANSFER_PDF',
    requestedBy: user.email,
    campusId: rows[0]?.CampusId || null,
    payload: {
      documentType: 'transfer',
      transferDirection: 'out',
      pdfName,
      campus: user.campus,
      senderCampus: user.campus,
      receiverCampus: targetCampus,
      requestedBy: user.email,
      itName: cleanText(data.itName || user.name || user.email, 240),
      hardware,
      signatures: { transfer: transferSignature },
      clientIp: cleanText(data.clientIp, 120),
      email: {
        to: cleanText(data.targetItEmail, 320) || user.email,
        cc: cleanText(data.targetItEmail, 320) ? user.email : '',
        replyTo: user.email,
        subject: 'Kampüsler Arası Cihaz Transferi (Çıkış)',
        body: `${user.campus} kampüsünden ${targetCampus} kampüsüne cihaz transferi başlatılmıştır. Tutanak ektedir.`
      }
    }
  });
  const queueDetails = { queueId: queue.PublicId, documentStatus: 'PDF hazırlanıyor', pdfName };

  for (const row of rows) {
    await query(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'TRANSFER',
            AssignedPersonId = @senderLabel,
            CampusId = @targetCampusId,
            DriveLink = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        senderLabel: { type: sql.NVarChar(160), value: senderLabel },
        targetCampusId: { type: sql.UniqueIdentifier, value: targetCampusId },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
    await appendHardwareHistory(row.HardwareId, `Kampüs Çıkış (${user.campus}) (PDF hazırlanıyor)`, {
      personName: data.itName || user.email,
      createdBy: user.email,
      detailsJson: { targetCampus, previousCampus: row.Campus, ...queueDetails }
    });
  }

  await appendSystemLog('TRANSFER CIKIS KUYRUK', user, `${rows.length} cihaz -> ${targetCampus}, PDF kuyruğu: ${queue.PublicId}`, data.clientIp || '');
  return {
    queued: true,
    queueId: queue.PublicId,
    status: queue.Status,
    url: '',
    message: 'Transfer kaydedildi. PDF arka planda hazırlanıyor.'
  };
}

export async function completeTransferForUser(user, data) {
  const rows = await findHardwareRows(user, data.hardwareIds, { skipCampusCheck: true, requireStatus: 'TRANSFER' });
  const targetCampusId = await ensureCampusId(user.campus);
  const transferSignature = validateSignatureData(data.transferSignature, 'Transfer');
  const pdfName = safePdfName(data.pdfName, 'transfer-giris.pdf');
  const senderCampus = cleanText(data.senderCampus, 160) || rows[0]?.AssignedPersonId?.replace(/^GÖNDEREN:/i, '').replace(/^GONDEREN:/i, '').trim() || '';
  const hardware = rows.map((row) => ({
    hardwareId: row.HardwareId,
    serial: row.SerialNo,
    type: row.DeviceType || 'Cihaz',
    brand: row.Brand || '',
    model: row.Model || '',
    computerName: row.ComputerName || '',
    campus: row.Campus || ''
  }));

  for (const row of rows) {
    if (core(row.Campus) !== core(user.campus)) {
      throw new Error(`Bu cihaz sizin kampüsünüze gönderilmemiş: ${row.SerialNo}`);
    }
  }

  const queue = await enqueuePdfJob({
    actionType: 'GENERATE_TRANSFER_PDF',
    requestedBy: user.email,
    campusId: targetCampusId,
    payload: {
      documentType: 'transfer',
      transferDirection: 'in',
      pdfName,
      campus: user.campus,
      senderCampus,
      receiverCampus: user.campus,
      requestedBy: user.email,
      itName: cleanText(data.itName || user.name || user.email, 240),
      hardware,
      signatures: { transfer: transferSignature },
      clientIp: cleanText(data.clientIp, 120),
      email: {
        to: cleanText(data.targetItEmail, 320) || user.email,
        cc: cleanText(data.targetItEmail, 320) ? user.email : '',
        replyTo: user.email,
        subject: 'Kampüsler Arası Cihaz Transferi (Teslim Alındı)',
        body: `${senderCampus || 'Gönderen kampüs'} tarafından gönderilen cihazlar ${user.campus} kampüsünde teslim alınmıştır. Tutanak ektedir.`
      }
    }
  });
  const queueDetails = { queueId: queue.PublicId, documentStatus: 'PDF hazırlanıyor', pdfName };

  for (const row of rows) {
    await query(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'DEPODA',
            AssignedPersonId = NULL,
            CampusId = @targetCampusId,
            DriveLink = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        targetCampusId: { type: sql.UniqueIdentifier, value: targetCampusId },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
    await appendHardwareHistory(row.HardwareId, `Kampüs Giriş (${user.campus}) (PDF hazırlanıyor)`, {
      personName: data.itName || user.email,
      createdBy: user.email,
      detailsJson: { receiverCampus: user.campus, senderCampus, ...queueDetails }
    });
  }

  await appendSystemLog('TRANSFER GIRIS KUYRUK', user, `${rows.length} cihaz -> ${user.campus}, PDF kuyruğu: ${queue.PublicId}`, data.clientIp || '');
  return {
    queued: true,
    queueId: queue.PublicId,
    status: queue.Status,
    url: '',
    message: 'Transfer teslimi kaydedildi. PDF arka planda hazırlanıyor.'
  };
}

export async function cancelTransferForUser(user, data) {
  const rows = await findHardwareRows(user, data.hardwareIds, { skipCampusCheck: true, requireStatus: 'TRANSFER' });
  const senderCampus = cleanText(data.senderCampus || user.campus, 160);
  const senderCampusId = await ensureCampusId(senderCampus);

  for (const row of rows) {
    const senderRaw = String(row.AssignedPersonId || '').replace(/^GÖNDEREN:/i, '').replace(/^GONDEREN:/i, '').trim();
    if (user.role !== 'HQ IT' && core(senderRaw) !== core(user.campus)) {
      throw new Error('Sadece kendi gönderdiğiniz transferi iptal edebilirsiniz.');
    }

    await query(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'DEPODA',
            AssignedPersonId = NULL,
            CampusId = @senderCampusId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        senderCampusId: { type: sql.UniqueIdentifier, value: senderCampusId },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
    await appendHardwareHistory(row.HardwareId, 'Transfer İptal Edildi', {
      personName: data.currentUserName || user.email,
      createdBy: user.email,
      detailsJson: { senderCampus }
    });
  }

  await appendSystemLog('TRANSFER IPTAL', user, `${rows.length} cihaz -> ${senderCampus}`, data.clientIp || '');
  return { count: rows.length };
}
async function getCampusCodeMap() {
  const result = await query(`SELECT Name, CampusCode FROM dbo.Campuses WHERE IsActive = 1`);
  const map = {};

  for (const [code, campus] of Object.entries(FALLBACK_CAMPUS_CODES)) {
    map[code.toLocaleUpperCase('tr-TR')] = campus;
    map[`I${code}`.toLocaleUpperCase('tr-TR')] = campus;
  }

  for (const row of result.recordset) {
    const campusName = row.Name || '';
    const campusCode = cleanText(row.CampusCode, 32).toLocaleUpperCase('tr-TR');
    if (!campusCode || !campusName) continue;
    map[campusCode] = campusName;
    map[`I${campusCode}`.toLocaleUpperCase('tr-TR')] = campusName;
  }

  return map;
}

async function getGlpiMatchingContext() {
  const [hardwareResult, personnelResult, glpiResult, campusCodeMap] = await Promise.all([
    query(`SELECT SerialNo, ComputerName, GlpiId FROM dbo.Hardware`),
    query(`
      SELECT p.PersonId, p.FullName, p.Email, p.AdUsername, c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
    `),
    query(`
      SELECT GlpiId, SerialNo, ComputerName, Manufacturer, Model, AdUsername, LocationName, LastInventory, LastSync
      FROM dbo.GlpiDevices
      ORDER BY ComputerName, SerialNo, GlpiId
    `),
    getCampusCodeMap()
  ]);

  const existingSerials = new Set();
  const existingNames = new Set();
  const existingGlpiIds = new Set();

  for (const row of hardwareResult.recordset) {
    const serialKey = normalizeSerialKey(row.SerialNo);
    const nameKey = normalizeComputerNameKey(row.ComputerName);
    if (serialKey) existingSerials.add(serialKey);
    if (nameKey) existingNames.add(nameKey);
    if (row.GlpiId !== null && row.GlpiId !== undefined) existingGlpiIds.add(String(row.GlpiId));
  }

  const peopleByAd = new Map();
  for (const row of personnelResult.recordset) {
    const keys = [row.AdUsername, row.Email].map(normalizeAdLogin).filter(Boolean);
    for (const key of keys) {
      if (!peopleByAd.has(key)) {
        peopleByAd.set(key, {
          id: row.PersonId,
          name: row.FullName || '',
          email: row.Email || '',
          campus: row.Campus || ''
        });
      }
    }
  }

  return {
    glpiRows: glpiResult.recordset,
    existingSerials,
    existingNames,
    existingGlpiIds,
    peopleByAd,
    campusCodeMap
  };
}

function parseDateOrNull(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = cleanText(value, 120);
  if (!text) return null;

  const tr = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (tr) {
    return new Date(
      Number(tr[3]),
      Number(tr[2]) - 1,
      Number(tr[1]),
      Number(tr[4] || 0),
      Number(tr[5] || 0),
      Number(tr[6] || 0)
    );
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function makeGlpiMismatch(parts) {
  const clean = parts.map((part) => cleanText(part, 80)).filter(Boolean);
  return clean.length ? [...new Set(clean)].join(';') : 'OK';
}

function indexGlpiRows(glpiRows) {
  const byId = new Map();
  const bySerial = new Map();
  const byName = new Map();

  for (const row of glpiRows) {
    if (row.GlpiId !== null && row.GlpiId !== undefined) byId.set(String(row.GlpiId), row);
    const serialKey = normalizeSerialKey(row.SerialNo);
    const nameKey = normalizeComputerNameKey(row.ComputerName);
    if (serialKey && !bySerial.has(serialKey)) bySerial.set(serialKey, row);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, row);
  }

  return { byId, bySerial, byName };
}

function findMatchingGlpiRow(hardwareRow, indexes) {
  if (hardwareRow.GlpiId !== null && hardwareRow.GlpiId !== undefined && indexes.byId.has(String(hardwareRow.GlpiId))) {
    return { row: indexes.byId.get(String(hardwareRow.GlpiId)), matchType: 'GLPI_ID' };
  }

  const serialKey = normalizeSerialKey(hardwareRow.SerialNo);
  if (serialKey && indexes.bySerial.has(serialKey)) {
    return { row: indexes.bySerial.get(serialKey), matchType: 'SERI_NO' };
  }

  const nameKey = normalizeComputerNameKey(hardwareRow.ComputerName);
  if (nameKey && indexes.byName.has(nameKey)) {
    return { row: indexes.byName.get(nameKey), matchType: 'BILGISAYAR_ISMI' };
  }

  return { row: null, matchType: 'YOK' };
}

async function reconcileHardwareWithGlpi() {
  const [hardwareResult, personnelResult, glpiResult, campusCodeMap] = await Promise.all([
    query(`
      SELECT h.HardwareId, h.SerialNo, h.ComputerName, h.DeviceType, h.GlpiId,
             h.HardwareStatus, h.AssignedPersonId, c.Name AS Campus
      FROM dbo.Hardware h
      LEFT JOIN dbo.Campuses c ON c.CampusId = h.CampusId
    `),
    query(`
      SELECT p.PersonId, p.FullName, p.Email, p.AdUsername, c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
    `),
    query(`
      SELECT GlpiId, SerialNo, ComputerName, Manufacturer, Model, AdUsername, LocationName, LastInventory, LastSync
      FROM dbo.GlpiDevices
    `),
    getCampusCodeMap()
  ]);

  const peopleByAd = new Map();
  for (const person of personnelResult.recordset) {
    for (const key of [person.AdUsername, person.Email].map(normalizeAdLogin).filter(Boolean)) {
      if (!peopleByAd.has(key)) {
        peopleByAd.set(key, {
          id: person.PersonId,
          name: person.FullName || '',
          campus: person.Campus || ''
        });
      }
    }
  }

  const indexes = indexGlpiRows(glpiResult.recordset);
  let reconciled = 0;
  let matched = 0;
  let warnings = 0;

  for (const hardware of hardwareResult.recordset) {
    const match = findMatchingGlpiRow(hardware, indexes);
    if (!match.row) {
      await query(
        `
          UPDATE dbo.Hardware
          SET GlpiMatchType = N'YOK',
              GlpiMismatch = N'GLPI_ESLESMEDI',
              GlpiLastSync = SYSUTCDATETIME(),
              UpdatedAt = SYSUTCDATETIME()
          WHERE HardwareId = @hardwareId
        `,
        { hardwareId: { type: sql.Int, value: hardware.HardwareId } }
      );
      reconciled += 1;
      warnings += 1;
      continue;
    }

    const glpi = match.row;
    const meta = parseComputerNameMeta(glpi.ComputerName, campusCodeMap);
    const adUser = normalizeAdLogin(glpi.AdUsername);
    const person = adUser ? peopleByAd.get(adUser) : null;
    const campusGuess = meta.campus || person?.campus || cleanText(glpi.LocationName, 240) || '';
    const mismatchParts = [];

    if (campusGuess && hardware.Campus && core(campusGuess) !== core(hardware.Campus)) mismatchParts.push('KAMPUS_FARKI');
    if (adUser && !person) mismatchParts.push('PERSONEL_ESLESMEDI');
    if (
      person &&
      String(hardware.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I') === 'AKTIF' &&
      hardware.AssignedPersonId &&
      String(hardware.AssignedPersonId) !== String(person.id)
    ) {
      mismatchParts.push('KULLANICI_FARKI');
    }

    const mismatch = makeGlpiMismatch(mismatchParts);
    if (mismatch !== 'OK') warnings += 1;

    await query(
      `
        UPDATE dbo.Hardware
        SET GlpiId = @glpiId,
            GlpiComputerName = @glpiComputerName,
            GlpiAdUsername = @glpiAdUsername,
            GlpiPersonnelName = @glpiPersonnelName,
            GlpiCampusGuess = @glpiCampusGuess,
            GlpiDeviceType = @glpiDeviceType,
            GlpiMatchType = @glpiMatchType,
            GlpiMismatch = @glpiMismatch,
            GlpiLastSync = @glpiLastSync,
            ComputerName = CASE WHEN ISNULL(ComputerName, N'') = N'' THEN @glpiComputerName ELSE ComputerName END,
            DeviceType = CASE WHEN ISNULL(DeviceType, N'') = N'' THEN @glpiDeviceType ELSE DeviceType END,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        hardwareId: { type: sql.Int, value: hardware.HardwareId },
        glpiId: { type: sql.Int, value: glpi.GlpiId },
        glpiComputerName: { type: sql.NVarChar(160), value: cleanText(glpi.ComputerName, 160) || null },
        glpiAdUsername: { type: sql.NVarChar(160), value: adUser || null },
        glpiPersonnelName: { type: sql.NVarChar(240), value: person?.name || null },
        glpiCampusGuess: { type: sql.NVarChar(160), value: campusGuess || null },
        glpiDeviceType: { type: sql.NVarChar(80), value: meta.type || null },
        glpiMatchType: { type: sql.NVarChar(80), value: match.matchType },
        glpiMismatch: { type: sql.NVarChar(240), value: mismatch },
        glpiLastSync: { type: sql.DateTime2, value: glpi.LastSync || new Date() }
      }
    );
    reconciled += 1;
    matched += 1;
  }

  return { reconciled, matched, warnings };
}

export async function syncGlpiDevicesFromAgent(secret, data = {}) {
  if (!config.glpiSyncSecret || secret !== config.glpiSyncSecret) {
    throw new Error('Yetkisiz GLPI sync isteği.');
  }

  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 20000) throw new Error('Tek seferde çok fazla GLPI kaydı geldi.');

  const syncStartedAt = new Date();
  let count = 0;
  let warnings = 0;

  for (const item of items) {
    const glpiId = Number.parseInt(cleanText(item.glpiId ?? item.id, 40), 10);
    if (!Number.isFinite(glpiId)) {
      warnings += 1;
      continue;
    }

    const serialNo = cleanText(item.serial ?? item.serialNo, 160);
    const computerName = cleanText(item.computerName ?? item.name, 160);
    const manufacturer = cleanText(item.manufacturer ?? item.brand, 160);
    const model = cleanText(item.model, 240);
    const adUsername = normalizeAdLogin(item.adUser ?? item.adUsername ?? item.users_id);
    const locationName = cleanText(item.location ?? item.locationName ?? item.locations_id, 240);
    const lastInventory = parseDateOrNull(item.lastInventory ?? item.date_mod);

    await query(
      `
        MERGE dbo.GlpiDevices AS target
        USING (SELECT @glpiId AS GlpiId) AS source
        ON target.GlpiId = source.GlpiId
        WHEN MATCHED THEN UPDATE SET
          SerialNo = @serialNo,
          ComputerName = @computerName,
          Manufacturer = @manufacturer,
          Model = @model,
          AdUsername = @adUsername,
          LocationName = @locationName,
          LastInventory = @lastInventory,
          LastSync = @lastSync,
          RawJson = @rawJson
        WHEN NOT MATCHED THEN
          INSERT (GlpiId, SerialNo, ComputerName, Manufacturer, Model, AdUsername, LocationName, LastInventory, LastSync, RawJson)
          VALUES (@glpiId, @serialNo, @computerName, @manufacturer, @model, @adUsername, @locationName, @lastInventory, @lastSync, @rawJson);
      `,
      {
        glpiId: { type: sql.Int, value: glpiId },
        serialNo: { type: sql.NVarChar(160), value: serialNo || null },
        computerName: { type: sql.NVarChar(160), value: computerName || null },
        manufacturer: { type: sql.NVarChar(160), value: manufacturer || null },
        model: { type: sql.NVarChar(240), value: model || null },
        adUsername: { type: sql.NVarChar(160), value: adUsername || null },
        locationName: { type: sql.NVarChar(240), value: locationName || null },
        lastInventory: { type: sql.DateTime2, value: lastInventory },
        lastSync: { type: sql.DateTime2, value: syncStartedAt },
        rawJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(item) }
      }
    );
    count += 1;
  }

  await query(`DELETE FROM dbo.GlpiDevices WHERE LastSync < @lastSync`, {
    lastSync: { type: sql.DateTime2, value: syncStartedAt }
  });

  const reconcile = data.reconcile === false ? { reconciled: 0, matched: 0, warnings: 0 } : await reconcileHardwareWithGlpi();
  await appendSystemLog(
    'GLPI SYNC',
    { email: 'GLPI Sync Agent' },
    `${count} GLPI cihazı senkronlandı. Eşleşen: ${reconcile.matched}, uyarı: ${reconcile.warnings + warnings}`,
    data.clientIp || data.machine || ''
  );

  return {
    count,
    syncedAt: syncStartedAt.toISOString(),
    matched: reconcile.matched,
    warnings: reconcile.warnings + warnings
  };
}
function glpiRowToMissingDevice(row, context, user) {
  const glpiId = row.GlpiId;
  const serial = cleanText(row.SerialNo, 160);
  const computerName = cleanText(row.ComputerName, 160);
  const serialKey = normalizeSerialKey(serial);
  const nameKey = normalizeComputerNameKey(computerName);

  if (context.existingGlpiIds.has(String(glpiId))) return null;
  if (serialKey && context.existingSerials.has(serialKey)) return null;
  if (nameKey && context.existingNames.has(nameKey)) return null;
  if (!serial && !computerName) return null;

  const meta = parseComputerNameMeta(computerName, context.campusCodeMap);
  const adUser = normalizeAdLogin(row.AdUsername);
  const person = adUser ? context.peopleByAd.get(adUser) : null;
  const inferredCampus = meta.campus || person?.campus || cleanText(row.LocationName, 240) || '';

  if (user.role !== 'HQ IT') {
    if (!inferredCampus || core(inferredCampus) !== core(user.campus)) return null;
  }

  return {
    glpiId,
    serial,
    computerName,
    brand: cleanText(row.Manufacturer, 160),
    model: cleanText(row.Model, 240),
    adUser,
    matchedPersonId: person?.id || '',
    matchedPersonName: person?.name || '',
    inferredCampus,
    deviceType: meta.type || '',
    lastInventory: row.LastInventory || '',
    lastSync: row.LastSync || ''
  };
}

export async function fetchMissingGlpiDevicesForUser(user) {
  const context = await getGlpiMatchingContext();
  const devices = context.glpiRows
    .map((row) => glpiRowToMissingDevice(row, context, user))
    .filter(Boolean);

  return { devices };
}

export async function importMissingGlpiDevicesForUser(user, data) {
  const ids = normalizeIds(data.glpiIds).map((id) => Number.parseInt(id, 10)).filter(Number.isFinite);
  if (!ids.length) throw new Error('Eklenecek GLPI cihazı seçilmedi.');

  const { devices } = await fetchMissingGlpiDevicesForUser(user);
  const importMap = new Map(devices.map((item) => [Number(item.glpiId), item]));
  const selected = ids.map((id) => importMap.get(id));

  if (selected.some((item) => !item)) {
    throw new Error('Seçili cihazlardan bazıları bulunamadı, zaten eklenmiş olabilir veya kampüs yetkiniz dışında.');
  }

  let imported = 0;
  for (const item of selected) {
    const campus = item.inferredCampus || user.campus || 'Bilinmiyor';
    const campusId = await ensureCampusId(campus);
    const serial = item.serial || `GLPI-${item.glpiId}`;
    const deviceType = item.deviceType || 'Cihaz';
    const mismatch = item.adUser ? 'ZIMMET_YOK_GLPI_KULLANICI_VAR' : 'OK';
    const notes = `GLPI'den eklendi. AD Kullanıcı: ${item.adUser || '-'}`;

    await query(
      `
        INSERT INTO dbo.Hardware (
          SerialNo, Model, CampusId, HardwareStatus, ComputerName, DeviceType, Brand, Notes,
          GlpiId, GlpiComputerName, GlpiAdUsername, GlpiPersonnelName, GlpiCampusGuess,
          GlpiDeviceType, GlpiMatchType, GlpiMismatch, GlpiLastSync
        )
        VALUES (
          @serial, @model, @campusId, N'DEPODA', @computerName, @deviceType, @brand, @notes,
          @glpiId, @glpiComputerName, @glpiAdUsername, @glpiPersonnelName, @glpiCampusGuess,
          @glpiDeviceType, N'GLPI_IMPORT', @glpiMismatch, @glpiLastSync
        )
      `,
      {
        serial: { type: sql.NVarChar(160), value: serial },
        model: { type: sql.NVarChar(240), value: item.model || item.computerName || 'GLPI Cihazı' },
        campusId: { type: sql.UniqueIdentifier, value: campusId },
        computerName: { type: sql.NVarChar(160), value: item.computerName || null },
        deviceType: { type: sql.NVarChar(80), value: deviceType },
        brand: { type: sql.NVarChar(120), value: item.brand || null },
        notes: { type: sql.NVarChar(sql.MAX), value: notes },
        glpiId: { type: sql.Int, value: Number(item.glpiId) },
        glpiComputerName: { type: sql.NVarChar(160), value: item.computerName || null },
        glpiAdUsername: { type: sql.NVarChar(160), value: item.adUser || null },
        glpiPersonnelName: { type: sql.NVarChar(240), value: item.matchedPersonName || null },
        glpiCampusGuess: { type: sql.NVarChar(160), value: item.inferredCampus || null },
        glpiDeviceType: { type: sql.NVarChar(80), value: item.deviceType || null },
        glpiMismatch: { type: sql.NVarChar(240), value: mismatch },
        glpiLastSync: { type: sql.DateTime2, value: item.lastSync || null }
      }
    );

    const rows = await findHardwareRows(user, [serial], { skipCampusCheck: true });
    await appendHardwareHistory(rows[0].HardwareId, 'GLPI Import', {
      personName: user.email,
      createdBy: user.email,
      detailsJson: { glpiId: item.glpiId, adUser: item.adUser, importedFrom: 'GLPI_Cihazlar' }
    });
    imported += 1;
  }

  await appendSystemLog('GLPI IMPORT', user, `${imported} cihaz SQL Hardware tablosuna eklendi`, data.clientIp || '');
  return { imported };
}

function safePdfName(name, fallback = 'belge.pdf') {
  const safe = cleanText(name || fallback, 260).replace(/[\\/:*?"<>|]/g, '-');
  return safe.toLocaleLowerCase('tr-TR').endsWith('.pdf') ? safe : `${safe}.pdf`;
}

function validateSignatureData(value, label) {
  const text = String(value || '');
  if (!text.startsWith('data:image/png;base64,') || text.length > 300000) {
    throw new Error(`${label} imza formatı geçersiz.`);
  }
  return text;
}

async function getPersonDetailsForDocument(personId) {
  const cleanPersonId = cleanText(personId, 160);
  if (!cleanPersonId) throw new Error('Personel seçimi boş.');

  const result = await query(
    `
      SELECT TOP 1
        p.PersonId,
        p.FullName,
        p.Email,
        p.Department,
        p.Status,
        p.CampusId,
        c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE p.PersonId = @personId
    `,
    { personId: { type: sql.NVarChar(160), value: cleanPersonId } }
  );

  const row = result.recordset[0];
  if (!row) throw new Error('Personel veritabanında bulunamadı.');
  if (!row.Email) throw new Error('Personelin sistemde e-posta adresi bulunmuyor.');

  return {
    id: row.PersonId,
    name: row.FullName || row.PersonId,
    email: String(row.Email || '').toLowerCase(),
    department: row.Department || 'Personel',
    status: row.Status || 'Aktif',
    campusId: row.CampusId || null,
    campus: row.Campus || 'Bilinmiyor'
  };
}

async function enqueuePdfJob({ actionType, payload, requestedBy, campusId }) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const publicId = `PDF-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const result = await query(
    `
      INSERT INTO dbo.OperationQueue (PublicId, ActionType, Status, PayloadJson, RequestedBy, CampusId)
      OUTPUT INSERTED.QueueId, INSERTED.PublicId, INSERTED.Status
      VALUES (@publicId, @actionType, N'BEKLIYOR', @payloadJson, @requestedBy, @campusId)
    `,
    {
      publicId: { type: sql.NVarChar(80), value: publicId },
      actionType: { type: sql.NVarChar(120), value: actionType },
      payloadJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(payload) },
      requestedBy: { type: sql.NVarChar(320), value: requestedBy || null },
      campusId: { type: sql.UniqueIdentifier, value: campusId || null }
    }
  );

  return result.recordset[0];
}

function buildAccessoryList(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => String(item?.type || '').toLocaleLowerCase('tr-TR') === 'aksesuar')
    .map((item) => ({
      type: 'Aksesuar',
      brand: cleanText(item.brand, 120),
      model: cleanText(item.model, 240),
      serial: cleanText(item.serial, 160) || '-'
    }));
}

export async function saveZimmetOrReturnForUser(user, data) {
  const isReturn = data.action === 'returnZimmetServerSide';
  const actionType = isReturn ? 'GENERATE_RETURN_PDF' : 'GENERATE_ZIMMET_PDF';
  const person = await getPersonDetailsForDocument(data.personId);

  if (user.role !== 'HQ IT') {
    assertCanAccessCampus(user, person.campus, 'Farklı kampüs personeli için işlem yapamazsınız.');
  }

  const rows = await findHardwareRows(user, data.hardwareIds);
  const today = new Date();
  const hardware = rows.map((row) => ({
    hardwareId: row.HardwareId,
    serial: row.SerialNo,
    type: row.DeviceType || 'Cihaz',
    brand: row.Brand || '',
    model: row.Model || '',
    computerName: row.ComputerName || '',
    campus: row.Campus || ''
  }));

  for (const row of rows) {
    const status = String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I');
    if (status === 'TRANSFER') throw new Error(`Cihaz transferde: ${row.SerialNo}`);
    if (!isReturn && status === 'HURDA') {
      throw new Error(`HATA: Hurda durumundaki cihaz zimmetlenemez: ${row.SerialNo}`);
    }
    if (!isReturn && status !== 'DEPODA' && status !== 'AKTIF') {
      throw new Error(`HATA: Cihaz (S/N: ${row.SerialNo}) zimmete uygun durumda değil. Mevcut durum: ${row.HardwareStatus}`);
    }
    if (isReturn && status !== 'AKTIF') {
      throw new Error(`HATA: İade için cihaz aktif zimmetli olmalı: ${row.SerialNo}`);
    }
    if (isReturn && String(row.AssignedPersonId || '') !== String(person.id)) {
      throw new Error(`HATA: İade edilmek istenen cihaz (S/N: ${row.SerialNo}) bu personele ait değil.`);
    }
  }

  const itSignature = validateSignatureData(data.itSignature, 'IT');
  const personSignature = validateSignatureData(data.personSignature, 'Personel');
  consumeOtpApproval(data.personOtpHash, person.email);

  const pdfName = safePdfName(data.pdfName, isReturn ? 'iade.pdf' : 'zimmet.pdf');
  const payload = {
    documentType: isReturn ? 'return' : 'zimmet',
    pdfName,
    campus: user.campus,
    requestedBy: user.email,
    itName: cleanText(data.itName || user.name || user.email, 240),
    itEmail: cleanText(data.itEmail || user.email, 320),
    person,
    hardware,
    accessories: buildAccessoryList(data.hardwareList),
    signatures: {
      it: itSignature,
      person: personSignature,
      otpHash: cleanText(data.personOtpHash, 120)
    },
    zimmetExplanation: cleanText(data.zimmetExplanation, 2000),
    returnCondition: cleanText(data.returnCondition, 120),
    returnExplanation: cleanText(data.returnExplanation, 2000),
    clientIp: cleanText(data.clientIp, 120),
    userAgent: cleanText(data.userAgent, 500),
    email: {
      to: person.email,
      cc: user.email,
      replyTo: user.email,
      subject: isReturn ? 'Donanım İade Belgeniz' : 'Donanım Zimmet Belgeniz',
      body: isReturn
        ? 'Donanım iade tutanağınız ektedir.'
        : 'Donanım zimmet teslim tutanağınız ektedir.'
    }
  };

  const queue = await enqueuePdfJob({
    actionType,
    payload,
    requestedBy: user.email,
    campusId: rows[0]?.CampusId || person.campusId || null
  });

  const queueDetails = {
    queueId: queue.PublicId,
    documentStatus: 'PDF hazırlanıyor',
    pdfName
  };

  for (const row of rows) {
    await query(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = @status,
            AssignedPersonId = @assignedPersonId,
            DriveLink = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        status: { type: sql.NVarChar(40), value: isReturn ? 'DEPODA' : 'AKTIF' },
        assignedPersonId: { type: sql.NVarChar(160), value: isReturn ? null : person.id },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );

    const previousStatus = String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I');
    const historyType = isReturn
      ? 'İade (PDF hazırlanıyor)'
      : previousStatus === 'AKTIF'
        ? 'Zimmet (Üzerine Yazıldı, PDF hazırlanıyor)'
        : 'Zimmet (PDF hazırlanıyor)';

    await appendHardwareHistory(row.HardwareId, historyType, {
      personId: person.id,
      personName: person.name,
      eventDate: today,
      createdBy: user.email,
      detailsJson: queueDetails
    });
  }

  await appendSystemLog(
    isReturn ? 'IADE KUYRUK' : 'ZIMMET KUYRUK',
    user,
    `${person.name} -> ${rows.length} cihaz, PDF kuyruğu: ${queue.PublicId}`,
    data.clientIp || ''
  );

  return {
    queued: true,
    queueId: queue.PublicId,
    status: queue.Status,
    url: '',
    message: `${isReturn ? 'İade' : 'Zimmet'} kaydedildi. PDF arka planda hazırlanıyor.`
  };
}

export async function fetchOperationQueueForUser(user, data = {}) {
  const limit = Math.min(Math.max(Number(data.limit || 20), 1), 100);
  const result = await query(
    `
      SELECT TOP (@limit)
        q.QueueId,
        q.PublicId,
        q.ActionType,
        q.Status,
        q.PayloadJson,
        q.ResultJson,
        q.ErrorMessage,
        q.RequestedBy,
        q.AttemptCount,
        q.CreatedAt,
        q.StartedAt,
        q.FinishedAt,
        c.Name AS Campus
      FROM dbo.OperationQueue q
      LEFT JOIN dbo.Campuses c ON c.CampusId = q.CampusId
      WHERE @isHq = 1 OR q.RequestedBy = @email OR c.CoreName = @userCore
      ORDER BY q.CreatedAt DESC
    `,
    {
      limit: { type: sql.Int, value: limit },
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' },
      email: { type: sql.NVarChar(320), value: user.email },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  return {
    jobs: result.recordset.map((row) => ({
      queueId: row.QueueId,
      publicId: row.PublicId,
      actionType: row.ActionType,
      action: row.ActionType,
      status: row.Status,
      payloadJson: row.PayloadJson,
      resultJson: row.ResultJson,
      result: row.ResultJson,
      errorMessage: row.ErrorMessage,
      error: row.ErrorMessage,
      requestedBy: row.RequestedBy,
      attemptCount: row.AttemptCount,
      createdAt: row.CreatedAt,
      startedAt: row.StartedAt,
      finishedAt: row.FinishedAt,
      updatedAt: row.FinishedAt || row.StartedAt || row.CreatedAt,
      campus: row.Campus || ''
    }))
  };
}

export async function runOperationQueueForUser(user) {
  await appendSystemLog('ISLEM KUYRUGU KONTROL', user, 'SQL API uzerinden kuyruk kontrol edildi.', '');
  return { processed: 0, message: 'SQL API kuyruk okuyucu hazır; otomatik belge işleyici bir sonraki adımda bağlanacak.' };
}
