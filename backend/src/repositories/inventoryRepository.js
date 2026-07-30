import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, query, withTransaction } from '../db.js';
import { consumeOtpApproval } from '../otpService.js';
import { uploadFileThroughGoogleBridge } from '../googleBridge.js';
import { config } from '../config.js';
import {
  createExportDownloadToken,
  pruneExpiredExportFiles,
} from '../exportTokens.js';
import { decodeCanonicalBase64, MAX_UPLOADED_FILE_BYTES } from '../uploadedFileValidation.js';

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

function normalizeIds(ids, options = {}) {
  const maxItems = Number(options.maxItems || 5000);
  const maxLength = Number(options.maxLength || 160);
  const label = cleanText(options.label || 'Kayıt', 80) || 'Kayıt';
  const input = Array.isArray(ids) ? ids : [ids];
  const normalized = [];
  const seen = new Set();

  for (const id of input) {
    if (id === null || id === undefined || id === '') continue;
    if (typeof id !== 'string' && typeof id !== 'number') {
      throw new Error(`${label} kimliği geçersiz.`);
    }

    const value = String(id).trim();
    if (!value) continue;
    if (value.length > maxLength) {
      throw new Error(`${label} kimliği en fazla ${maxLength} karakter olabilir.`);
    }
    if (seen.has(value)) continue;

    seen.add(value);
    normalized.push(value);
    if (normalized.length > maxItems) {
      throw new Error(`Tek işlemde en fazla ${maxItems} ${label.toLocaleLowerCase('tr-TR')} seçilebilir.`);
    }
  }

  return normalized;
}

function cleanText(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

const BULK_HARDWARE_MAX_ITEMS = 1000;
const BULK_HARDWARE_TYPE_ALIASES = new Map([
  ['laptop', 'Laptop'],
  ['notebook', 'Laptop'],
  ['dizustu', 'Laptop'],
  ['masaustu', 'Masaüstü (PC)'],
  ['masaustupc', 'Masaüstü (PC)'],
  ['pc', 'Masaüstü (PC)'],
  ['desktop', 'Masaüstü (PC)'],
  ['allinone', 'All in One PC'],
  ['allinonepc', 'All in One PC'],
  ['aio', 'All in One PC'],
  ['tablet', 'Tablet'],
  ['monitor', 'Monitör'],
  ['klavyevemouseseti', 'Klavye ve Mouse Seti'],
  ['klavyemouseseti', 'Klavye ve Mouse Seti'],
  ['mouse', 'Mouse'],
  ['klavye', 'Klavye'],
  ['webcam', 'Webcam'],
  ['harddrive', 'Hard Drive'],
  ['haricidisk', 'Hard Drive'],
  ['disk', 'Hard Drive'],
  ['diger', 'Diğer']
]);

function normalizeLookupText(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeBulkHardwareType(value) {
  const normalized = normalizeLookupText(value || 'Laptop');
  return BULK_HARDWARE_TYPE_ALIASES.get(normalized) || '';
}

function validateBulkHardwareText(value, maxLength, label, rowNumber, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Excel satır ${rowNumber}: ${label} boş olamaz.`);
  if (text.length > maxLength) {
    throw new Error(`Excel satır ${rowNumber}: ${label} en fazla ${maxLength} karakter olabilir.`);
  }
  return text;
}

function pickFirst(source, names) {
  if (!source || typeof source !== 'object') return '';
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function safeFileName(name, fallback = 'belge') {
  const safe = cleanText(name || fallback, 260).replace(/[\\/:*?"<>|]/g, '-');
  return safe || fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function isValidSharedSecret(provided, expected) {
  if (!expected || !provided) return false;
  const providedBuffer = Buffer.from(String(provided), 'utf8');
  const expectedBuffer = Buffer.from(String(expected), 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function assertSharedSecret(provided, expected, message) {
  if (!isValidSharedSecret(provided, expected)) {
    throw new Error(message);
  }
}

function validateUploadedFile(base64Data, fileName) {
  const safeName = safeFileName(fileName, 'belge.pdf');
  const lower = safeName.toLocaleLowerCase('tr-TR');
  const isPdf = lower.endsWith('.pdf');
  const isPng = lower.endsWith('.png');
  const isJpg = lower.endsWith('.jpg') || lower.endsWith('.jpeg');
  if (!isPdf && !isPng && !isJpg) throw new Error('Sadece PDF/JPG/PNG yüklenebilir.');

  const buffer = decodeCanonicalBase64(base64Data, {
    label: 'Dosya',
    maxBytes: MAX_UPLOADED_FILE_BYTES
  });
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
  if (value === null || value === undefined) return "-";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? String.fromCharCode(39) + text : text;
}

function escapeCsvCell(value) {
  return String.fromCharCode(34) + sanitizeExcelCell(value).replace(/"/g, String.fromCharCode(34, 34)) + String.fromCharCode(34);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0090')) return digits.slice(4);
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits.slice(0, 10);
}

function normalizeEmail(value) {
  const email = cleanText(value, 320).toLocaleLowerCase('tr-TR');
  return email.includes('@') ? email : '';
}

function normalizePersonnelStatus(value, suspended) {
  if (suspended === true || String(suspended).toLocaleLowerCase('tr-TR') === 'true') return 'Pasif';
  const raw = cleanText(value, 40);
  if (!raw) return 'Aktif';
  const key = raw.toLocaleLowerCase('tr-TR');
  if (['pasif', 'passive', 'suspended', 'askıda', 'askida'].includes(key)) return 'Pasif';
  if (['aktif', 'active'].includes(key)) return 'Aktif';
  if (key.includes('bulunamad')) return 'Kullanıcı Bulunamadı';
  return raw;
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
  if (maxLen > 62 || combinedLen > 118) return '4';
  if (maxLen > 48 || combinedLen > 96) return '3';
  if (maxLen > 36 || combinedLen > 76) return '2';
  return '1';
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

function deriveAdUsernameFromEmail(value) {
  const email = normalizeEmail(value);
  if (!email.endsWith('@istek.k12.tr')) return '';
  return normalizeAdLogin(email);
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

async function getActiveCampusByName(name) {
  const result = await query(
    `
      SELECT TOP 1 CampusId, Name
      FROM dbo.Campuses
      WHERE IsActive = 1
        AND (CoreName = @core OR Name = @name)
    `,
    {
      core: { type: sql.NVarChar(160), value: core(name) },
      name: { type: sql.NVarChar(160), value: cleanText(name, 160) }
    }
  );
  return result.recordset[0] || null;
}

async function getTransferEmailRecipients(campusId, requesterEmail) {
  const result = campusId
    ? await query(
        `
          SELECT au.Email
          FROM dbo.AuthorizedUsers au
          WHERE au.IsActive = 1
            AND au.CampusId = @campusId
          ORDER BY au.Email
        `,
        { campusId: { type: sql.UniqueIdentifier, value: campusId } }
      )
    : { recordset: [] };

  const recipients = [
    ...new Set(
      (result.recordset || [])
        .map((row) => normalizeEmail(row.Email))
        .filter(Boolean)
    )
  ];
  const requester = normalizeEmail(requesterEmail);
  const to = recipients.length > 0 ? recipients.join(',') : requester;
  const cc = requester && !recipients.includes(requester) && recipients.length > 0 ? requester : '';
  if (!to) throw new Error('Transfer bildirimi için yetkili e-posta adresi bulunamadı.');
  return { to, cc };
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
  const ids = normalizeIds(hardwareIds, { maxItems: 5000, maxLength: 160, label: 'Cihaz' });
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
        c.Name AS Campus,
        assignedPerson.FullName AS AssignedPersonName
      FROM OPENJSON(@idsJson)
        WITH (SerialNo NVARCHAR(160) '$') requested
      INNER JOIN dbo.Hardware h ON h.SerialNo = requested.SerialNo
      LEFT JOIN dbo.Campuses c ON c.CampusId = h.CampusId
      LEFT JOIN dbo.vw_EffectivePersonnel assignedPerson ON assignedPerson.PersonId = h.AssignedPersonId
    `,
    {
      idsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(ids) }
    }
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

async function appendHardwareHistory(hardwareId, eventType, options = {}, execute = query) {
  await execute(
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

export async function appendSystemLog(actionType, user, details, clientInfo = '', execute = query) {
  if (execute.isTransaction !== true) {
    return withTransaction((transactionExecute) =>
      appendSystemLog(actionType, user, details, clientInfo, transactionExecute)
    );
  }

  await execute(
    `
      DECLARE @lockResult INT;
      EXEC @lockResult = sys.sp_getapplock
        @Resource = N'IstekZimmet.SystemLogs.Chain',
        @LockMode = N'Exclusive',
        @LockOwner = N'Transaction',
        @LockTimeout = 10000;

      IF @lockResult < 0
        THROW 51000, N'Sistem log zinciri kilidi alınamadı.', 1;

      BEGIN TRY
        DECLARE @createdAt DATETIME2(0) = SYSUTCDATETIME();
        DECLARE @createdAtText NVARCHAR(33) = CONVERT(NVARCHAR(33), @createdAt, 126);
        DECLARE @previousHash NVARCHAR(128) = COALESCE(
          (SELECT TOP (1) NULLIF(ChainHash, N'') FROM dbo.SystemLogs ORDER BY LogId DESC),
          N'GENESIS'
        );
        DECLARE @fileHash NVARCHAR(128) = NULL;
        DECLARE @driveLink NVARCHAR(1000) = NULL;
        DECLARE @canonical NVARCHAR(MAX) = CONCAT(
          N'v1',
          N'|prev=', DATALENGTH(@previousHash), N':', @previousHash,
          N'|time=', DATALENGTH(@createdAtText), N':', @createdAtText,
          N'|by=', CASE WHEN @executedBy IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@executedBy), N':', @executedBy) END,
          N'|action=', CASE WHEN @actionType IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@actionType), N':', @actionType) END,
          N'|details=', CASE WHEN @details IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@details), N':', @details) END,
          N'|file=', CASE WHEN @fileHash IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@fileHash), N':', @fileHash) END,
          N'|drive=', CASE WHEN @driveLink IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@driveLink), N':', @driveLink) END,
          N'|client=', CASE WHEN @clientInfo IS NULL THEN N'-1:' ELSE CONCAT(DATALENGTH(@clientInfo), N':', @clientInfo) END
        );
        DECLARE @chainHash NVARCHAR(128) = UPPER(CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @canonical), 2));

        INSERT INTO dbo.SystemLogs (
          CreatedAt, ExecutedBy, ActionType, Details, FileHash, DriveLink, ChainHash, ClientInfo
        )
        VALUES (
          @createdAt, @executedBy, @actionType, @details, @fileHash, @driveLink, @chainHash, @clientInfo
        );
      END TRY
      BEGIN CATCH
        THROW;
      END CATCH
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
      LEFT JOIN dbo.vw_EffectivePersonnel p ON LOWER(p.Email) = LOWER(au.Email)
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

function normalizePersonnelSyncItem(rawItem) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const email = normalizeEmail(pickFirst(item, ['email', 'primaryEmail', 'ePosta', 'eposta', 'mail']));
  const providedAdUsername = normalizeAdLogin(pickFirst(item, ['adUsername', 'adUser', 'windowsUsername', 'kullaniciAdi', 'adKullanici']));
  const adUsername = deriveAdUsernameFromEmail(email) || providedAdUsername;
  const personId =
    cleanText(pickFirst(item, ['personId', 'googleId', 'googleUserId', 'id', 'userId']), 160) ||
    email ||
    adUsername;
  const fullName =
    cleanText(pickFirst(item, ['fullName', 'name', 'adSoyad', 'adSoyadi', 'displayName']), 240) ||
    cleanText(`${pickFirst(item, ['firstName', 'givenName'])} ${pickFirst(item, ['lastName', 'familyName'])}`, 240) ||
    email ||
    adUsername ||
    personId;

  return {
    personId,
    fullName,
    email,
    department: cleanText(pickFirst(item, ['department', 'title', 'unvan', 'gorev', 'jobTitle']), 240),
    campus: cleanText(pickFirst(item, ['campus', 'kampus', 'okul']), 160),
    status: normalizePersonnelStatus(pickFirst(item, ['status', 'durum']), item.suspended),
    photoUrl: cleanText(pickFirst(item, ['photoUrl', 'picture', 'thumbnailPhotoUrl', 'profilFotografi']), 1000),
    adUsername,
    phone: normalizePhone(pickFirst(item, ['phone', 'telefon', 'cellPhone', 'mobile', 'cep'])),
    signatureUrl: cleanText(pickFirst(item, ['signatureUrl', 'signatureLink', 'imzaLinki', 'imzaLink']), 1000)
  };
}

export async function syncPersonnelFromAgent(secret, data = {}) {
  assertSharedSecret(secret, config.personnelSyncSecret, 'Yetkisiz personel sync isteği.');

  const items = Array.isArray(data.items) ? data.items : data.person ? [data.person] : [];
  if (!items.length) {
    return {
      count: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      warningCount: 0,
      warningsTruncated: false,
      warnings: []
    };
  }
  if (items.length > 5000) throw new Error('Tek seferde en fazla 5000 personel kaydı senkronlanabilir.');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let warningCount = 0;
  const warnings = [];
  const addWarning = (message) => {
    warningCount += 1;
    if (warnings.length < 100) warnings.push(message);
  };
  const normalizedPeople = [];

  for (let index = 0; index < items.length; index += 1) {
    const person = normalizePersonnelSyncItem(items[index]);
    if (!person.personId) {
      skipped += 1;
      addWarning(`${index + 1}. kayıt atlandı: Personel ID/e-posta/AD kullanıcı adı yok.`);
      continue;
    }
    normalizedPeople.push(person);
  }

  const campusIdByCore = new Map();
  const campusNames = new Set(normalizedPeople.map((person) => person.campus).filter(Boolean));
  for (const campus of campusNames) {
    campusIdByCore.set(core(campus), await ensureCampusId(campus));
  }

  const existingResult = await query(`SELECT PersonId, Email FROM dbo.Personnel`);
  const existingById = new Map();
  const emailOwners = new Map();
  for (const row of existingResult.recordset) {
    const existingPersonId = String(row.PersonId);
    existingById.set(existingPersonId, row);
    const emailKey = normalizeEmail(row.Email);
    if (emailKey) emailOwners.set(emailKey, existingPersonId);
  }

  const rowsByTargetId = new Map();
  for (const person of normalizedPeople) {
    const emailKey = normalizeEmail(person.email);
    const targetPersonId = existingById.has(person.personId)
      ? person.personId
      : emailOwners.get(emailKey) || person.personId;
    if (targetPersonId !== person.personId) {
      addWarning(`${person.email || person.personId}: mevcut kayıt e-posta ile bulundu, PersonId korunarak güncellendi.`);
    }

    if (emailKey) {
      const emailOwnerId = emailOwners.get(emailKey);
      if (emailOwnerId && emailOwnerId !== targetPersonId) {
        addWarning(`${person.email}: e-posta başka bir personel kaydında olduğu için güncellenmedi.`);
        if (person.adUsername === deriveAdUsernameFromEmail(person.email)) person.adUsername = '';
        person.email = '';
      } else {
        emailOwners.set(emailKey, targetPersonId);
      }
    }

    if (rowsByTargetId.has(targetPersonId)) {
      addWarning(`${targetPersonId}: aynı personel pakette birden fazla kez bulundu; son kayıt kullanıldı.`);
    }
    rowsByTargetId.set(targetPersonId, {
      targetPersonId,
      fullName: person.fullName,
      email: person.email,
      department: person.department,
      campusId: person.campus ? campusIdByCore.get(core(person.campus)) || null : null,
      status: person.status,
      photoUrl: person.photoUrl,
      adUsername: person.adUsername,
      phone: person.phone,
      signatureUrl: person.signatureUrl
    });
  }

  const mergeRows = Array.from(rowsByTargetId.values());
  const batchSize = 500;
  await withTransaction(async (execute) => {
    for (let offset = 0; offset < mergeRows.length; offset += batchSize) {
      const batch = mergeRows.slice(offset, offset + batchSize);
      const result = await execute(
        `
          ;WITH SourceRows AS (
            SELECT *
            FROM OPENJSON(@itemsJson)
            WITH (
              PersonId NVARCHAR(160) '$.targetPersonId',
              FullName NVARCHAR(240) '$.fullName',
              Email NVARCHAR(320) '$.email',
              Department NVARCHAR(240) '$.department',
              CampusId UNIQUEIDENTIFIER '$.campusId',
              Status NVARCHAR(40) '$.status',
              PhotoUrl NVARCHAR(1000) '$.photoUrl',
              AdUsername NVARCHAR(160) '$.adUsername',
              Phone NVARCHAR(20) '$.phone',
              SignatureUrl NVARCHAR(1000) '$.signatureUrl'
            )
          )
          MERGE dbo.Personnel AS target
          USING SourceRows AS source
            ON target.PersonId = source.PersonId
          WHEN MATCHED THEN
            UPDATE SET
              FullName = COALESCE(NULLIF(source.FullName, N''), target.FullName),
              Email = COALESCE(NULLIF(source.Email, N''), target.Email),
              Department = COALESCE(NULLIF(source.Department, N''), target.Department),
              CampusId = COALESCE(source.CampusId, target.CampusId),
              Status = COALESCE(NULLIF(source.Status, N''), target.Status),
              PhotoUrl = COALESCE(NULLIF(source.PhotoUrl, N''), target.PhotoUrl),
              AdUsername = COALESCE(NULLIF(source.AdUsername, N''), target.AdUsername),
              Phone = COALESCE(NULLIF(source.Phone, N''), target.Phone),
              SignatureUrl = COALESCE(NULLIF(source.SignatureUrl, N''), target.SignatureUrl),
              UpdatedAt = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (
              PersonId, FullName, Email, Department, CampusId, Status,
              PhotoUrl, AdUsername, Phone, SignatureUrl
            )
            VALUES (
              source.PersonId,
              COALESCE(NULLIF(source.FullName, N''), NULLIF(source.Email, N''), NULLIF(source.AdUsername, N''), source.PersonId),
              NULLIF(source.Email, N''),
              NULLIF(source.Department, N''),
              source.CampusId,
              COALESCE(NULLIF(source.Status, N''), N'Aktif'),
              NULLIF(source.PhotoUrl, N''),
              NULLIF(source.AdUsername, N''),
              NULLIF(source.Phone, N''),
              NULLIF(source.SignatureUrl, N'')
            )
          OUTPUT $action AS MergeAction;
        `,
        { itemsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(batch) } }
      );

      for (const row of result.recordset) {
        if (row.MergeAction === 'INSERT') inserted += 1;
        else updated += 1;
      }
    }

    await appendSystemLog(
      'PERSONEL SYNC',
      { email: 'Personnel Sync Agent' },
      `${inserted} yeni, ${updated} güncel, ${skipped} atlandı, ${warningCount} uyarı.`,
      data.clientIp || data.machine || '',
      execute
    );
  });

  return {
    count: inserted + updated,
    inserted,
    updated,
    skipped,
    warningCount,
    warningsTruncated: warningCount > warnings.length,
    warnings
  };
}

export async function updatePersonnelPhoneForUser(user, personId, phone) {
  const cleanPersonId = cleanText(personId, 160);
  const cleanPhone = cleanText(phone, 20);
  if (!cleanPersonId) throw new Error('Telefon kaydı için personel seçimi bulunamadı.');

  const result = await query(
    `
      SELECT TOP 1 p.PersonId, p.FullName, c.Name AS Campus
      FROM dbo.vw_EffectivePersonnel p
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

  await appendSystemLog('PERSONEL TELEFON GÜNCELLE', user, `${row.FullName || cleanPersonId} için telefon güncellendi.`, '');
  return { phone: cleanPhone };
}
export async function fetchDataForUser(user, options = {}) {
  const requestedSince = options?.since ? new Date(options.since) : null;
  const deltaSince =
    requestedSince &&
    !Number.isNaN(requestedSince.getTime()) &&
    requestedSince.getTime() <= Date.now() + 60_000
      ? requestedSince
      : null;
  const isDelta = Boolean(deltaSince);
  const isHq = user.role === 'HQ IT';
  // SQL columns currently use second precision. A small overlap avoids missing an
  // update at the watermark boundary; duplicate delta rows are harmless on merge.
  const serverTime = new Date(Date.now() - 5_000);
  const syncParameters = {};
  if (!isHq) {
    syncParameters.userCore = { type: sql.NVarChar(160), value: core(user.campus) };
  }
  if (isDelta) {
    syncParameters.since = { type: sql.DateTime2, value: deltaSince };
  }

  const visibleAssignedPersonExists = `
    EXISTS (
      SELECT 1
      FROM dbo.Hardware visibleHardware
      INNER JOIN dbo.Campuses visibleHardwareCampus
        ON visibleHardwareCampus.CampusId = visibleHardware.CampusId
      WHERE visibleHardware.AssignedPersonId = p.PersonId
        AND visibleHardwareCampus.CoreName = @userCore
    )
  `;
  const recentlyVisibleAssignmentExists = `
    EXISTS (
      SELECT 1
      FROM dbo.Hardware recentHardware
      INNER JOIN dbo.Campuses recentHardwareCampus
        ON recentHardwareCampus.CampusId = recentHardware.CampusId
      WHERE recentHardware.AssignedPersonId = p.PersonId
        AND recentHardwareCampus.CoreName = @userCore
        AND recentHardware.UpdatedAt > @since
    )
  `;
  const personnelVisibilityClause = isHq
    ? '1 = 1'
    : `(c.CoreName = @userCore OR ${visibleAssignedPersonExists})`;
  const personnelDeltaClause = !isDelta
    ? '1 = 1'
    : isHq
      ? 'p.UpdatedAt > @since'
      : `(p.UpdatedAt > @since OR ${recentlyVisibleAssignmentExists})`;
  const hardwareVisibilityClause = isHq
    ? '1 = 1'
    : `
      (
        c.CoreName = @userCore
        OR (
          h.HardwareStatus = N'TRANSFER'
          AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ISNULL(h.AssignedPersonId, N''),
            N'GÖNDEREN:', N''), N'GONDEREN:', N''), N' Kampüsü', N''),
            N' Kampusu', N''), N' Kampüs', N''), N' Kampus', N'')) = @userCore
        )
      )
    `;
  const hardwareDeltaClause = isDelta ? 'h.UpdatedAt > @since' : '1 = 1';

  const [personnelResult, hardwareResult] = await Promise.all([
    query(
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
      FROM dbo.vw_EffectivePersonnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE ${personnelVisibilityClause}
        AND ${personnelDeltaClause}
      ORDER BY p.FullName
      `,
      syncParameters
    ),
    query(
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
        h.UpdatedAt,
        latestHistory.EventDate AS LastEventDate,
        latestHistory.PersonName AS LastEventPersonName,
        latestHistory.EventType AS LastEventType,
        c.Name AS Campus,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.HardwareHistory hh WHERE hh.HardwareId = h.HardwareId) THEN 1 ELSE 0 END AS HasHistory
      FROM dbo.Hardware h
      LEFT JOIN dbo.Campuses c ON c.CampusId = h.CampusId
      OUTER APPLY (
        SELECT TOP (1) hh.EventDate, hh.PersonName, hh.EventType
        FROM dbo.HardwareHistory hh
        WHERE hh.HardwareId = h.HardwareId
        ORDER BY hh.EventDate DESC, hh.HistoryId DESC
      ) latestHistory
      WHERE ${hardwareVisibilityClause}
        AND ${hardwareDeltaClause}
      ORDER BY h.SerialNo
      `,
      syncParameters
    )
  ]);

  const uniqueUsers = {};

  for (const row of personnelResult.recordset) {
    const campus = row.Campus || 'Bilinmiyor';

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
      signatureMissing: !row.SignatureUrl,
      documents: [],
      documentsLoaded: false
    };
  }

  const hardware = hardwareResult.recordset.map((row) => {
    const status = toUiStatus(row.HardwareStatus);
    const assignedTo = status === 'Assigned' || status === 'Transfer' ? row.AssignedPersonId || null : null;

    if (
      !isDelta &&
      assignedTo &&
      !uniqueUsers[assignedTo] &&
      !String(assignedTo).toUpperCase().includes('GÖNDEREN:')
    ) {
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
      glpiLastSync: row.GlpiLastSync || '',
      updatedAt: row.UpdatedAt || '',
      lastEventDate: row.LastEventDate || '',
      lastEventPersonName: row.LastEventPersonName || '',
      lastEventType: row.LastEventType || ''
    };
  });

  return {
    personnel: Object.values(uniqueUsers),
    hardware,
    sync: {
      mode: isDelta ? 'delta' : 'full',
      serverTime: serverTime.toISOString()
    }
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
      SELECT TOP (100)
        CASE
          WHEN oq.Status = N'TAMAMLANDI' THEN
            REPLACE(
              REPLACE(hh.EventType, N', PDF hazırlanıyor', N''),
              N' (PDF hazırlanıyor)',
              N''
            )
          ELSE hh.EventType
        END AS EventType,
        hh.PersonName,
        COALESCE(
          NULLIF(LTRIM(RTRIM(hh.DriveLink)), N''),
          NULLIF(
            CASE WHEN ISJSON(oq.ResultJson) = 1
              THEN JSON_VALUE(oq.ResultJson, '$.url')
              ELSE NULL
            END,
            N''
          )
        ) AS DriveLink,
        hh.EventDate,
        hh.DetailsJson
      FROM dbo.HardwareHistory hh
      LEFT JOIN dbo.OperationQueue oq
        ON oq.PublicId = CASE WHEN ISJSON(hh.DetailsJson) = 1
          THEN JSON_VALUE(hh.DetailsJson, '$.queueId')
          ELSE NULL
        END
      WHERE hh.HardwareId = @hardwareId
      ORDER BY hh.EventDate DESC, hh.HistoryId DESC
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

export async function fetchPersonDocumentHistoryForUser(user, personId) {
  const cleanPersonId = cleanText(personId, 160);
  if (!cleanPersonId) throw new Error('Personel kimliği bulunamadı.');

  const personResult = await query(
    `
      SELECT TOP (1)
        p.PersonId,
        c.Name AS Campus,
        CASE WHEN EXISTS (
          SELECT 1
          FROM dbo.Hardware h
          INNER JOIN dbo.Campuses hc ON hc.CampusId = h.CampusId
          WHERE h.AssignedPersonId = p.PersonId
            AND hc.CoreName = @userCampusCore
        ) THEN 1 ELSE 0 END AS HasVisibleAssignment
      FROM dbo.vw_EffectivePersonnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE p.PersonId = @personId
    `,
    {
      personId: { type: sql.NVarChar(160), value: cleanPersonId },
      userCampusCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  const person = personResult.recordset[0];
  if (!person) throw new Error('Personel bulunamadı.');
  if (
    user.role !== 'HQ IT' &&
    !canSeeCampus(user, person.Campus) &&
    !Boolean(person.HasVisibleAssignment)
  ) {
    throw new Error('Bu personelin belge geçmişini görme yetkiniz yok.');
  }

  const documentsResult = await query(
    `
      WITH DocumentRows AS (
        SELECT
          hh.HistoryId,
          CASE
            WHEN oq.Status = N'TAMAMLANDI' THEN
              REPLACE(
                REPLACE(hh.EventType, N', PDF hazırlanıyor', N''),
                N' (PDF hazırlanıyor)',
                N''
              )
            ELSE hh.EventType
          END AS EventType,
          hh.EventDate,
          hh.DetailsJson,
          COALESCE(
            NULLIF(LTRIM(RTRIM(hh.DriveLink)), N''),
            NULLIF(
              CASE WHEN ISJSON(oq.ResultJson) = 1
                THEN JSON_VALUE(oq.ResultJson, '$.url')
                ELSE NULL
              END,
              N''
            )
          ) AS DriveLink,
          COALESCE(
            NULLIF(
              CASE WHEN ISJSON(hh.DetailsJson) = 1
                THEN JSON_VALUE(hh.DetailsJson, '$.pdfName')
                ELSE NULL
              END,
              N''
            ),
            NULLIF(
              CASE WHEN ISJSON(oq.PayloadJson) = 1
                THEN JSON_VALUE(oq.PayloadJson, '$.pdfName')
                ELSE NULL
              END,
              N''
            )
          ) AS PdfName
        FROM dbo.HardwareHistory hh
        LEFT JOIN dbo.OperationQueue oq
          ON oq.PublicId = CASE WHEN ISJSON(hh.DetailsJson) = 1
            THEN JSON_VALUE(hh.DetailsJson, '$.queueId')
            ELSE NULL
          END
        WHERE hh.PersonId = @personId
          AND (
            hh.EventType LIKE N'Zimmet%'
            OR hh.EventType LIKE N'İade%'
            OR hh.EventType LIKE N'Iade%'
          )
      ),
      RankedDocuments AS (
        SELECT
          HistoryId,
          EventType,
          EventDate,
          DetailsJson,
          DriveLink,
          PdfName,
          ROW_NUMBER() OVER (
            PARTITION BY DriveLink
            ORDER BY EventDate DESC, HistoryId DESC
          ) AS DocumentRank
        FROM DocumentRows
        WHERE DriveLink IS NOT NULL
      )
      SELECT TOP (100)
        HistoryId,
        EventType,
        EventDate,
        DetailsJson,
        DriveLink,
        PdfName
      FROM RankedDocuments
      WHERE DocumentRank = 1
      ORDER BY EventDate DESC, HistoryId DESC
    `,
    { personId: { type: sql.NVarChar(160), value: cleanPersonId } }
  );

  // İstemci geçmişi kronolojik tutup gösterirken ters çevirdiği için
  // API yanıtını eskiden yeniye döndür.
  return documentsResult.recordset.slice().reverse().map((row) => {
    const eventType = String(row.EventType || '');
    const isReturn = /iade/i.test(eventType.replace(/İ/g, 'I'));
    const eventDate = row.EventDate ? new Date(row.EventDate) : null;
    const date =
      eventDate && !Number.isNaN(eventDate.getTime())
        ? eventDate.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })
        : '';
    const url = String(row.DriveLink || '');

    return {
      id: crypto.createHash('sha256').update(`${row.HistoryId}|${url}`).digest('hex').slice(0, 24),
      name: row.PdfName || (isReturn ? 'Donanım İade Belgesi.pdf' : 'Donanım Zimmet Belgesi.pdf'),
      date,
      url,
      type: eventType
    };
  });
}

export async function addHardwareForUser(user, data) {
  const hardware = data.hardware || {};
  const serial = cleanText(hardware.serial || hardware.id, 160);
  if (!serial) throw new Error('Seri no boş olamaz.');

  const campus = user.role === 'HQ IT' && hardware.campus ? hardware.campus : user.campus;
  const campusId = await ensureCampusId(campus);

  await withTransaction(async (execute) => {
    const insertResult = await execute(
      `
        INSERT INTO dbo.Hardware (SerialNo, Model, CampusId, HardwareStatus, ComputerName, DeviceType, Brand, Notes)
        OUTPUT INSERTED.HardwareId
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

    const hardwareId = insertResult.recordset[0]?.HardwareId;
    if (!hardwareId) throw new Error('Donanım kaydı oluşturulamadı.');
    await appendHardwareHistory(
      hardwareId,
      'Yeni Donanım',
      { personName: user.email, createdBy: user.email },
      execute
    );
    await appendSystemLog('DONANIM EKLE', user, `S/N: ${serial}`, data.clientIp || '', execute);
  });
  return { id: serial };
}

export async function bulkAddHardwareForUser(user, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0) throw new Error('İçe aktarılacak donanım bulunamadı.');
  if (items.length > BULK_HARDWARE_MAX_ITEMS) {
    throw new Error(`Tek işlemde en fazla ${BULK_HARDWARE_MAX_ITEMS} donanım eklenebilir.`);
  }

  const campusResult = await query(
    `
      SELECT CampusId, Name, CoreName
      FROM dbo.Campuses
      WHERE IsActive = 1
    `
  );
  const campusesByCore = new Map(
    (campusResult.recordset || []).map((campus) => [core(campus.Name || campus.CoreName), campus])
  );
  const seenSerials = new Map();
  const prepared = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Excel satır ${index + 2}: Kayıt biçimi geçersiz.`);
    }

    const rowNumber = Number.isInteger(Number(item.rowNumber))
      ? Math.max(2, Number(item.rowNumber))
      : index + 2;
    const serial = validateBulkHardwareText(item.serial, 160, 'Seri no', rowNumber, true);
    const serialKey = serial.toLocaleLowerCase('tr-TR');
    if (seenSerials.has(serialKey)) {
      throw new Error(
        `Excel satır ${rowNumber}: "${serial}" seri numarası satır ${seenSerials.get(serialKey)} ile tekrar ediyor.`
      );
    }
    seenSerials.set(serialKey, rowNumber);

    const brand = validateBulkHardwareText(item.brand, 120, 'Marka', rowNumber, true);
    const model = validateBulkHardwareText(item.model, 240, 'Model', rowNumber, true);
    const deviceType = normalizeBulkHardwareType(item.type);
    if (!deviceType) {
      throw new Error(`Excel satır ${rowNumber}: "${cleanText(item.type, 80)}" cihaz tipi desteklenmiyor.`);
    }

    const requestedCampus =
      user.role === 'HQ IT' && String(item.campus || '').trim()
        ? String(item.campus).trim()
        : user.campus;
    const campus = campusesByCore.get(core(requestedCampus));
    if (!campus) {
      throw new Error(`Excel satır ${rowNumber}: "${requestedCampus}" aktif bir kampüs değil.`);
    }

    prepared.push({
      rowNumber,
      serial,
      model,
      campusId: campus.CampusId,
      campus: campus.Name,
      computerName:
        validateBulkHardwareText(item.deviceName, 160, 'Bilgisayar ismi', rowNumber) || null,
      deviceType,
      brand,
      notes: validateBulkHardwareText(item.notes, 4000, 'Notlar', rowNumber) || null
    });
  }

  const insertedRows = await withTransaction(async (execute) => {
    const result = await execute(
      `
        DECLARE @Inserted TABLE (
          HardwareId INT NOT NULL,
          SerialNo NVARCHAR(160) NOT NULL
        );

        INSERT INTO dbo.Hardware (
          SerialNo,
          Model,
          CampusId,
          HardwareStatus,
          ComputerName,
          DeviceType,
          Brand,
          Notes
        )
        OUTPUT INSERTED.HardwareId, INSERTED.SerialNo
          INTO @Inserted (HardwareId, SerialNo)
        SELECT
          source.SerialNo,
          source.Model,
          source.CampusId,
          N'DEPODA',
          NULLIF(source.ComputerName, N''),
          source.DeviceType,
          source.Brand,
          NULLIF(source.Notes, N'')
        FROM OPENJSON(@itemsJson)
          WITH (
            SerialNo NVARCHAR(160) '$.serial',
            Model NVARCHAR(240) '$.model',
            CampusId UNIQUEIDENTIFIER '$.campusId',
            ComputerName NVARCHAR(160) '$.computerName',
            DeviceType NVARCHAR(80) '$.deviceType',
            Brand NVARCHAR(120) '$.brand',
            Notes NVARCHAR(4000) '$.notes'
          ) source
        WHERE NOT EXISTS (
          SELECT 1
          FROM dbo.Hardware existing WITH (UPDLOCK, HOLDLOCK)
          WHERE existing.SerialNo = source.SerialNo
        );

        INSERT INTO dbo.HardwareHistory (
          HardwareId,
          EventType,
          PersonId,
          PersonName,
          DriveLink,
          EventDate,
          DetailsJson,
          CreatedBy
        )
        SELECT
          inserted.HardwareId,
          N'Toplu Donanım Girişi',
          NULL,
          @createdBy,
          NULL,
          SYSUTCDATETIME(),
          N'{"source":"excel"}',
          @createdBy
        FROM @Inserted inserted;

        SELECT HardwareId, SerialNo
        FROM @Inserted
        ORDER BY HardwareId;
      `,
      {
        itemsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(prepared) },
        createdBy: { type: sql.NVarChar(320), value: cleanText(user.email, 320) || null }
      }
    );

    const inserted = result.recordset || [];
    await appendSystemLog(
      'TOPLU DONANIM EKLE',
      user,
      `${inserted.length} donanım Excel ile depoya eklendi; ${prepared.length - inserted.length} tekrar atlandı.`,
      data.clientIp || '',
      execute
    );
    return inserted;
  });

  const insertedSerialKeys = new Set(
    insertedRows.map((row) => String(row.SerialNo || '').toLocaleLowerCase('tr-TR'))
  );
  const duplicateSerials = prepared
    .filter((item) => !insertedSerialKeys.has(item.serial.toLocaleLowerCase('tr-TR')))
    .map((item) => item.serial);

  return {
    imported: insertedRows.length,
    skipped: duplicateSerials.length,
    importedSerials: insertedRows.map((row) => row.SerialNo),
    duplicateSerials
  };
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

  await withTransaction(async (execute) => {
    const updateResult = await execute(
      `UPDATE dbo.Hardware SET ${sets.join(', ')}, UpdatedAt = SYSUTCDATETIME() WHERE SerialNo = @serial`,
      bind
    );
    await assertSingleHardwareUpdate(updateResult, 'Donanım güncellenemedi. Lütfen veriyi yenileyip tekrar deneyin.');
    await appendSystemLog(
      'DONANIM GÜNCELLE',
      user,
      `${rows[0].SerialNo}: ${Object.keys(updates).join(', ')}`,
      data.clientIp || '',
      execute
    );
  });
  return {};
}

export async function bulkUpdateGroupForUser(user, data) {
  const rows = await findHardwareRows(user, data.hardwareIds);
  const groupName = cleanText(data.groupName, 160) || null;
  const changesJson = JSON.stringify(
    rows.map((row) => ({
      hardwareId: row.HardwareId,
      expectedGroupName: row.GroupName || null
    }))
  );

  await withTransaction(async (execute) => {
    const updateResult = await execute(
      `
        DECLARE @updated TABLE (HardwareId INT NOT NULL PRIMARY KEY);

        ;WITH requested AS (
          SELECT HardwareId, ExpectedGroupName
          FROM OPENJSON(@changesJson)
          WITH (
            HardwareId INT '$.hardwareId',
            ExpectedGroupName NVARCHAR(160) '$.expectedGroupName'
          )
        )
        UPDATE hardware
        SET GroupName = @groupName,
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.HardwareId INTO @updated (HardwareId)
        FROM dbo.Hardware hardware
        INNER JOIN requested ON requested.HardwareId = hardware.HardwareId
        WHERE ISNULL(hardware.GroupName, N'') = ISNULL(requested.ExpectedGroupName, N'');

        SELECT COUNT(*) AS UpdatedCount FROM @updated;
      `,
      {
        changesJson: { type: sql.NVarChar(sql.MAX), value: changesJson },
        groupName: { type: sql.NVarChar(160), value: groupName }
      }
    );

    const updatedCount = Number(updateResult.recordset?.[0]?.UpdatedCount || 0);
    if (updatedCount !== rows.length) {
      throw new Error('Bazı cihazların grubu işlem sırasında değişti. Lütfen veriyi yenileyip tekrar deneyin.');
    }

    await appendSystemLog('GRUP GÜNCELLE', user, `${rows.length} cihaz -> ${groupName || '-'}`, data.clientIp || '', execute);
  });
  return { count: rows.length };
}

export async function bulkStatusUpdateForUser(user, data) {
  const rows = await findHardwareRows(user, data.hardwareIds);
  const dbStatus = toDbStatus(data.newStatus);
  if (!['DEPODA', 'HURDA'].includes(dbStatus)) throw new Error('Bu toplu işlem sadece Depo veya Hurda için kullanılabilir.');

  const transferRows = rows.filter(
    (row) => String(row.HardwareStatus || '').trim().toUpperCase().replace(/İ/g, 'I') === 'TRANSFER'
  );
  if (transferRows.length > 0) {
    throw new Error(`Transferdeki cihazların durumu değiştirilemez: ${transferRows.map((row) => row.SerialNo).join(', ')}`);
  }

  const assignedRows = rows.filter((row) => cleanText(row.AssignedPersonId, 160));
  if (assignedRows.length > 0 && data.confirmUnassignAssigned !== true) {
    const preview = assignedRows
      .slice(0, 3)
      .map((row) => `${row.SerialNo}${row.AssignedPersonName ? ` (${row.AssignedPersonName})` : ''}`)
      .join(', ');
    const remaining = assignedRows.length > 3 ? ` ve ${assignedRows.length - 3} cihaz daha` : '';
    throw new Error(
      `${assignedRows.length} cihaz halen personele zimmetli: ${preview}${remaining}. ` +
      'Zimmeti kaldırarak devam etmek için işlemi açıkça onaylayın.'
    );
  }

  const changesJson = JSON.stringify(
    rows.map((row) => {
      const previousStatus = String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I');
      const previousAssignedPersonId = cleanText(row.AssignedPersonId, 160) || null;
      const previousAssignedPersonName = cleanText(row.AssignedPersonName, 240) || user.email;
      return {
        hardwareId: row.HardwareId,
        expectedStatus: previousStatus,
        expectedAssignedPersonId: previousAssignedPersonId,
        previousAssignedPersonName,
        detailsJson: JSON.stringify({
          previousStatus: row.HardwareStatus,
          newStatus: dbStatus,
          previousAssignedPersonId,
          previousAssignedPersonName: row.AssignedPersonName || null,
          forcedUnassign: Boolean(previousAssignedPersonId)
        })
      };
    })
  );

  await withTransaction(async (execute) => {
    const updateResult = await execute(
      `
        DECLARE @updated TABLE (HardwareId INT NOT NULL PRIMARY KEY);

        ;WITH requested AS (
          SELECT
            HardwareId,
            ExpectedStatus,
            ExpectedAssignedPersonId
          FROM OPENJSON(@changesJson)
          WITH (
            HardwareId INT '$.hardwareId',
            ExpectedStatus NVARCHAR(40) '$.expectedStatus',
            ExpectedAssignedPersonId NVARCHAR(160) '$.expectedAssignedPersonId'
          )
        )
        UPDATE hardware
        SET HardwareStatus = @status,
            AssignedPersonId = NULL,
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.HardwareId INTO @updated (HardwareId)
        FROM dbo.Hardware hardware
        INNER JOIN requested ON requested.HardwareId = hardware.HardwareId
        WHERE REPLACE(UPPER(ISNULL(hardware.HardwareStatus, N'')), N'İ', N'I') = requested.ExpectedStatus
          AND ISNULL(hardware.AssignedPersonId, N'') = ISNULL(requested.ExpectedAssignedPersonId, N'');

        INSERT INTO dbo.HardwareHistory (
          HardwareId,
          EventType,
          PersonId,
          PersonName,
          EventDate,
          DetailsJson,
          CreatedBy
        )
        SELECT
          updated.HardwareId,
          @eventType,
          requested.ExpectedAssignedPersonId,
          requested.PreviousAssignedPersonName,
          SYSUTCDATETIME(),
          requested.DetailsJson,
          @createdBy
        FROM @updated updated
        INNER JOIN OPENJSON(@changesJson)
        WITH (
          HardwareId INT '$.hardwareId',
          ExpectedAssignedPersonId NVARCHAR(160) '$.expectedAssignedPersonId',
          PreviousAssignedPersonName NVARCHAR(240) '$.previousAssignedPersonName',
          DetailsJson NVARCHAR(MAX) '$.detailsJson'
        ) requested ON requested.HardwareId = updated.HardwareId;

        SELECT COUNT(*) AS UpdatedCount FROM @updated;
      `,
      {
        changesJson: { type: sql.NVarChar(sql.MAX), value: changesJson },
        status: { type: sql.NVarChar(40), value: dbStatus },
        eventType: { type: sql.NVarChar(120), value: `Toplu İşlem: ${dbStatus}` },
        createdBy: { type: sql.NVarChar(320), value: user.email }
      }
    );

    const updatedCount = Number(updateResult.recordset?.[0]?.UpdatedCount || 0);
    if (updatedCount !== rows.length) {
      throw new Error('Bazı cihazların durumu işlem sırasında değişti. Lütfen veriyi yenileyip tekrar deneyin.');
    }

    await appendSystemLog(
      'TOPLU DURUM',
      user,
      `${rows.length} cihaz -> ${dbStatus}; zimmeti kaldırılan: ${assignedRows.length}`,
      data.clientIp || '',
      execute
    );
  });
  return { count: rows.length, unassignedCount: assignedRows.length };
}

export async function recordInventoryScanForUser(user, data) {
  const rawScans = Array.isArray(data.scans) && data.scans.length > 0
    ? data.scans
    : [{ hardwareId: data.hardwareId, qrPayload: data.qrPayload }];
  const qrPayloadByHardwareId = new Map();
  for (const scan of rawScans) {
    if (!scan || typeof scan !== 'object') throw new Error('QR sayım verisi geçersiz.');
    const hardwareId = String(scan.hardwareId ?? '').trim();
    if (!hardwareId) continue;
    if (hardwareId.length > 160) throw new Error('Cihaz kimliği en fazla 160 karakter olabilir.');
    qrPayloadByHardwareId.set(hardwareId, cleanText(scan.qrPayload, 500));
  }

  const rows = await findHardwareRows(user, Array.from(qrPayloadByHardwareId.keys()));
  const scannedAt = new Date();
  const serialByInternalId = new Map(rows.map((row) => [Number(row.HardwareId), row.SerialNo]));
  const scanRowsJson = JSON.stringify(
    rows.map((row) => ({
      hardwareId: row.HardwareId,
      detailsJson: JSON.stringify({
        qrPayload: qrPayloadByHardwareId.get(row.SerialNo) || '',
        clientIp: cleanText(data.clientIp, 120),
        serial: row.SerialNo
      })
    }))
  );

  const insertedInternalIds = await withTransaction(async (execute) => {
    const insertResult = await execute(
      `
        DECLARE @lockResult INT;
        DECLARE @lockResource NVARCHAR(255) = CONCAT(
          N'IstekZimmet.InventoryScan.',
          CONVERT(VARCHAR(64), HASHBYTES('SHA2_256', @createdBy), 2)
        );
        EXEC @lockResult = sys.sp_getapplock
          @Resource = @lockResource,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 10000;

        IF @lockResult < 0
          THROW 51000, N'QR sayım kilidi alınamadı.', 1;

        DECLARE @inserted TABLE (HardwareId INT NOT NULL PRIMARY KEY);

        ;WITH requested AS (
          SELECT HardwareId, DetailsJson
          FROM OPENJSON(@scanRowsJson)
          WITH (
            HardwareId INT '$.hardwareId',
            DetailsJson NVARCHAR(MAX) '$.detailsJson'
          )
        )
        INSERT INTO dbo.HardwareHistory (
          HardwareId,
          EventType,
          PersonName,
          EventDate,
          DetailsJson,
          CreatedBy
        )
        OUTPUT INSERTED.HardwareId INTO @inserted (HardwareId)
        SELECT
          requested.HardwareId,
          @eventType,
          @createdBy,
          @scannedAt,
          requested.DetailsJson,
          @createdBy
        FROM requested
        WHERE NOT EXISTS (
          SELECT 1
          FROM dbo.HardwareHistory history WITH (UPDLOCK, HOLDLOCK)
          WHERE history.HardwareId = requested.HardwareId
            AND history.EventType = @eventType
            AND history.CreatedBy = @createdBy
            AND history.EventDate >= DATEADD(SECOND, -1 * @dedupeSeconds, @scannedAt)
        );

        SELECT HardwareId FROM @inserted ORDER BY HardwareId;
      `,
      {
        scanRowsJson: { type: sql.NVarChar(sql.MAX), value: scanRowsJson },
        eventType: { type: sql.NVarChar(120), value: 'Sayımda görüldü' },
        createdBy: { type: sql.NVarChar(320), value: user.email },
        scannedAt: { type: sql.DateTime2, value: scannedAt },
        dedupeSeconds: { type: sql.Int, value: 30 }
      }
    );

    const insertedIds = (insertResult.recordset || []).map((row) => Number(row.HardwareId));
    if (insertedIds.length > 0) {
      const insertedSerials = insertedIds.map((hardwareId) => serialByInternalId.get(hardwareId)).filter(Boolean);
      const preview = insertedSerials.slice(0, 10).join(', ');
      const remaining = insertedSerials.length > 10 ? ` ve ${insertedSerials.length - 10} cihaz daha` : '';
      await appendSystemLog(
        'SAYIM QR',
        user,
        `${insertedSerials.length} cihaz: ${preview}${remaining}`,
        data.clientIp || '',
        execute
      );
    }

    return insertedIds;
  });

  const insertedIdSet = new Set(insertedInternalIds);
  const hardwareIds = rows
    .filter((row) => insertedIdSet.has(Number(row.HardwareId)))
    .map((row) => row.SerialNo);
  const duplicateHardwareIds = rows
    .filter((row) => !insertedIdSet.has(Number(row.HardwareId)))
    .map((row) => row.SerialNo);

  return {
    scannedAt: scannedAt.toLocaleString('tr-TR'),
    count: hardwareIds.length,
    duplicateCount: duplicateHardwareIds.length,
    hardwareIds,
    duplicateHardwareIds
  };
}

export async function createSheetForUser(user, data) {
  const exportData = Array.isArray(data.data) ? data.data : [];
  if (!exportData.length) throw new Error('Aktarılacak veri bulunamadı.');
  if (exportData.length > 10000) throw new Error('Tek seferde en fazla 10.000 kayıt dışa aktarılabilir.');

  const rawHeaders = Object.keys(exportData[0] || {});
  if (!rawHeaders.length) throw new Error('Dışa aktarılacak sütun bulunamadı.');
  if (rawHeaders.length > 100) throw new Error('Tek seferde en fazla 100 sütun dışa aktarılabilir.');
  if (Buffer.byteLength(JSON.stringify(exportData), 'utf8') > 8 * 1024 * 1024) {
    throw new Error('Dışa aktarım verisi 8 MB sınırını aşıyor. Filtreleyip tekrar deneyin.');
  }

  const headers = rawHeaders.map((header) => sanitizeExcelCell(header));
  const rows = exportData.map((item) =>
    rawHeaders.map((header) => sanitizeExcelCell(item?.[header]))
  );

  const csv = String.fromCharCode(0xfeff) + [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(";"))
    .join(String.fromCharCode(10));

  const baseDir =
    config.exports.dir ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generated-exports');
  await fs.mkdir(baseDir, { recursive: true });
  await pruneExpiredExportFiles(baseDir);

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const randomPart = crypto.randomBytes(8).toString('hex');
  const fileName = safeFileName(
    `${data.sheetName || 'Dışa Aktarım'}-${stamp}-${randomPart}.csv`,
    `disa-aktarim-${stamp}-${randomPart}.csv`
  );
  const filePath = path.join(baseDir, fileName);
  await fs.writeFile(filePath, csv, "utf8");

  const publicBase = String(config.publicBaseUrl || `http://localhost:${config.port}`).replace(/\/+$/, '');
  const downloadToken = createExportDownloadToken(fileName);
  const url =
    `${publicBase}/exports/${encodeURIComponent(fileName)}` +
    `?expires=${downloadToken.expiresAt}&signature=${downloadToken.signature}`;
  await appendSystemLog('EXPORT CSV', user, `${rows.length} kayıt aktarıldı: ${fileName}`, data.clientIp || '');

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

  await withTransaction(async (execute) => {
    const expectedStatus = String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I');
    const updateResult = await execute(
      isManualAssign
        ? `
            UPDATE dbo.Hardware
            SET HardwareStatus = N'AKTIF',
                AssignedPersonId = @personId,
                DriveLink = @driveLink,
                UpdatedAt = SYSUTCDATETIME()
            WHERE HardwareId = @hardwareId
              AND REPLACE(UPPER(ISNULL(HardwareStatus, N'')), N'İ', N'I') = @expectedStatus
              AND ISNULL(AssignedPersonId, N'') = ISNULL(@expectedAssignedPersonId, N'')
          `
        : `
            UPDATE dbo.Hardware
            SET DriveLink = @driveLink,
                UpdatedAt = SYSUTCDATETIME()
            WHERE HardwareId = @hardwareId
              AND REPLACE(UPPER(ISNULL(HardwareStatus, N'')), N'İ', N'I') = @expectedStatus
              AND ISNULL(AssignedPersonId, N'') = ISNULL(@expectedAssignedPersonId, N'')
          `,
      {
        personId: { type: sql.NVarChar(160), value: isManualAssign ? person.id : null },
        driveLink: { type: sql.NVarChar(1000), value: upload.url || null },
        expectedStatus: { type: sql.NVarChar(40), value: expectedStatus },
        expectedAssignedPersonId: { type: sql.NVarChar(160), value: row.AssignedPersonId || null },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
    await assertSingleHardwareUpdate(
      updateResult,
      `Cihaz belge yüklenirken değişti: ${row.SerialNo}. Veriyi yenileyip tekrar deneyin.`
    );

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
    }, execute);

    await appendSystemLog(
      isManualAssign ? 'MANUEL ZİMMET' : 'EKSİK BELGE',
      user,
      `${row.SerialNo} -> ${person.name} / ${fileInfo.fileName} / ${fileInfo.fileHash}`,
      data.clientIp || '',
      execute
    );
  });

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
    LeaseToken UNIQUEIDENTIFIER NULL,
    LeaseExpiresAt DATETIME2 NULL,
    ClientIp NVARCHAR(120) NULL,
    UserAgent NVARCHAR(500) NULL
  );
END

IF COL_LENGTH('dbo.ADPasswordQueue', 'LeaseToken') IS NULL
  ALTER TABLE dbo.ADPasswordQueue ADD LeaseToken UNIQUEIDENTIFIER NULL;
IF COL_LENGTH('dbo.ADPasswordQueue', 'LeaseExpiresAt') IS NULL
  ALTER TABLE dbo.ADPasswordQueue ADD LeaseExpiresAt DATETIME2 NULL;
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
      FROM dbo.vw_EffectivePersonnel p
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
  const queueParameters = {
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
  };

  await withTransaction(
    async (execute) => {
      const activeJob = await execute(
        `
          SELECT TOP (1) PublicId
          FROM dbo.ADPasswordQueue WITH (UPDLOCK, HOLDLOCK)
          WHERE PersonId = @personId
            AND Status IN (N'BEKLIYOR', N'ISLENIYOR')
          ORDER BY CreatedAt DESC
        `,
        { personId: queueParameters.personId }
      );
      if (activeJob.recordset[0]) {
        throw new Error(
          `Bu personel için zaten bekleyen bir şifre değiştirme işlemi var: ${activeJob.recordset[0].PublicId}`
        );
      }

      await execute(
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
        queueParameters
      );
      await appendSystemLog(
        'AD ŞİFRE RESET KUYRUK',
        user,
        `${person.name} / ${person.adUsername} / ${mode}`,
        data.clientIp || '',
        execute
      );
    },
    sql.ISOLATION_LEVEL.SERIALIZABLE
  );

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
      LEFT JOIN dbo.QueueNotificationDismissals d
        ON d.QueueKind = N'ad-password'
       AND d.QueuePublicId = q.PublicId
       AND d.UserEmail = @email
      WHERE d.DismissalId IS NULL
        AND (@isHq = 1 OR q.RequestedBy = @email OR c.CoreName = @campusCore)
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
  assertSharedSecret(secret, config.adAgentSecret, 'Yetkisiz AD agent isteği.');
  await ensureAdPasswordQueueTable();
  const limit = Math.min(Math.max(Number(data.limit || 5), 1), 20);

  const leaseResult = await query(
    `
      ;WITH NextJobs AS (
        SELECT TOP (@limit) QueueId
        FROM dbo.ADPasswordQueue WITH (READPAST, UPDLOCK, ROWLOCK)
        WHERE (
                Status = N'BEKLIYOR'
                OR (Status = N'ISLENIYOR' AND (LeaseExpiresAt IS NULL OR LeaseExpiresAt <= SYSUTCDATETIME()))
              )
          AND AttemptCount < @maxAttempts
        ORDER BY Priority DESC, CreatedAt, QueueId
      )
      UPDATE q
      SET Status = N'ISLENIYOR',
          StartedAt = COALESCE(StartedAt, SYSUTCDATETIME()),
          AttemptCount = AttemptCount + 1,
          UpdatedAt = SYSUTCDATETIME(),
          LeaseToken = NEWID(),
          LeaseExpiresAt = DATEADD(SECOND, @leaseSeconds, SYSUTCDATETIME())
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
        INSERTED.RequestedBy,
        INSERTED.LeaseToken
      FROM dbo.ADPasswordQueue q
      INNER JOIN NextJobs n ON n.QueueId = q.QueueId
    `,
    {
      limit: { type: sql.Int, value: limit },
      maxAttempts: { type: sql.Int, value: Math.max(1, Number(config.queue.maxAttempts || 5)) },
      leaseSeconds: { type: sql.Int, value: Math.max(60, Number(config.queue.leaseSeconds || 1800)) }
    }
  );

  return {
    leased: leaseResult.recordset.length,
    jobs: leaseResult.recordset.map((row) => ({
      queueId: row.PublicId,
      leaseToken: row.LeaseToken,
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
  assertSharedSecret(secret, config.adAgentSecret, 'Yetkisiz AD agent isteği.');
  await ensureAdPasswordQueueTable();
  const queueId = cleanText(data.queueId, 80);
  const leaseToken = cleanText(data.leaseToken, 80);
  if (!queueId) throw new Error('Queue ID boş.');
  if (!leaseToken) throw new Error('AD iş lease tokenı boş.');

  await withTransaction(async (execute) => {
    const result = await execute(
      `
        UPDATE dbo.ADPasswordQueue
        SET Status = @status,
            FinishedAt = SYSUTCDATETIME(),
            ResultMessage = @resultMessage,
            ErrorMessage = @errorMessage,
            PasswordCiphertext = N'',
            EncryptionKeyId = NULL,
            LeaseToken = NULL,
            LeaseExpiresAt = NULL,
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT
          INSERTED.RequestedBy,
          INSERTED.PersonName,
          INSERTED.AdUsername,
          INSERTED.PasswordMode,
          INSERTED.Status
        WHERE PublicId = @queueId
          AND Status = N'ISLENIYOR'
          AND LeaseToken = @leaseToken
      `,
      {
        status: { type: sql.NVarChar(40), value: data.success === true ? 'TAMAMLANDI' : 'HATA' },
        resultMessage: { type: sql.NVarChar(sql.MAX), value: data.success === true ? cleanText(data.result || 'AD şifresi uygulandı.', 4000) : null },
        errorMessage: { type: sql.NVarChar(sql.MAX), value: data.success === true ? null : cleanText(data.error || 'Bilinmeyen hata', 4000) },
        queueId: { type: sql.NVarChar(80), value: queueId },
        leaseToken: { type: sql.UniqueIdentifier, value: leaseToken }
      }
    );

    const completedJob = result.recordset[0];
    if (!completedJob || Number(result.rowsAffected?.[0] || 0) !== 1) {
      throw new Error('AD işi tamamlanamadı: lease süresi dolmuş veya iş başka bir ajan tarafından alınmış.');
    }

    const modeLabel = completedJob.PasswordMode === 'TEMPORARY' ? 'Geçici' : 'Kalıcı';
    const actionType =
      completedJob.Status === 'TAMAMLANDI'
        ? 'AD ŞİFRE RESET TAMAMLANDI'
        : 'AD ŞİFRE RESET HATA';
    await appendSystemLog(
      actionType,
      { email: completedJob.RequestedBy || 'AD Agent' },
      `${completedJob.PersonName || '-'} / ${completedJob.AdUsername || '-'} / ${modeLabel} / ${queueId}`,
      'AD password agent',
      execute
    );
  });

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
      FROM dbo.vw_EffectivePersonnel p
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
  const titleTrValue = row.TitleTr || '';
  const titleEnValue = row.TitleEn || row.TitleTr || '';
  return {
    titleTr: titleTrValue,
    titleEn: titleEnValue,
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
      `
        SELECT TOP 1 1 AS Found
        FROM (
          SELECT SignatureId FROM dbo.Personnel WHERE SignatureId = @id
          UNION ALL
          SELECT SignatureId FROM dbo.SignatureJobs WHERE SignatureId = @id
        ) existing
      `,
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
  const signatureEmail = normalizeEmail(person.email);
  if (!/^[a-z0-9._%+-]+@istek\.k12\.tr$/i.test(signatureEmail)) {
    throw new Error('İmza oluşturmak için geçerli bir @istek.k12.tr e-posta adresi gereklidir.');
  }

  const signatureId = await makeSignatureId();
  const cacheKey = crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const imageUrl = `https://istek.site/imza/${signatureId}/${signatureId}.jpg?v=${cacheKey}`;
  const gamCommand = `gam user "${signatureEmail}" signature file "signature/${signatureId}.html" html`;
  const publicId = `SIG-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const dataset = {
    id: signatureId,
    name: person.name,
    titleTr: title.titleTr,
    titleEn: title.titleEn,
    email: signatureEmail,
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
      personEmail: { type: sql.NVarChar(320), value: signatureEmail },
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

  await appendSystemLog('İMZA OLUŞTUR KUYRUK', user, `${person.name} -> ${title.titleTr} / ${publicId}`, data.clientIp || '');
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
  assertSharedSecret(secret, config.signatureAgentSecret, 'Yetkisiz imza agent isteği.');
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
      ;WITH NextJobs AS (
        SELECT TOP (@limit) JobId
        FROM dbo.SignatureJobs WITH (READPAST, UPDLOCK, ROWLOCK)
        WHERE Status = N'BEKLIYOR'
        ORDER BY CreatedAt, JobId
      )
      UPDATE j
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
      FROM dbo.SignatureJobs j
      INNER JOIN NextJobs n ON n.JobId = j.JobId
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

export async function fetchSignatureAgentJobStates(secret, data = {}) {
  requireSignatureAgentSecret(secret);
  await ensureSignatureJobsTable();
  const signatureIds = normalizeIds(data.signatureIds, {
    maxItems: 25,
    maxLength: 80,
    label: 'İmza'
  });
  if (!signatureIds.length) return { states: [] };

  const params = {};
  const placeholders = signatureIds.map((signatureId, index) => {
    const name = `signatureId${index}`;
    params[name] = { type: sql.NVarChar(80), value: cleanText(signatureId, 80) };
    return `@${name}`;
  });

  const result = await query(
    `
      SELECT SignatureId, PublicId, Status, UpdatedAt, FinishedAt
      FROM dbo.SignatureJobs
      WHERE SignatureId IN (${placeholders.join(', ')})
    `,
    params
  );

  return {
    states: result.recordset.map((row) => ({
      signatureId: row.SignatureId,
      queueId: row.PublicId,
      status: row.Status,
      updatedAt: row.UpdatedAt,
      finishedAt: row.FinishedAt
    }))
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
          FinishedAt = SYSUTCDATETIME(),
          UpdatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.SignatureId, INSERTED.PersonId, INSERTED.ImageUrl
      WHERE Status = N'ISLENIYOR'
        AND (
          (@queueId <> N'' AND PublicId = @queueId)
          OR (@queueId = N'' AND @signatureId <> N'' AND SignatureId = @signatureId)
        )
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
  if (!completed) throw new Error('İmza işi artık aktif değil; tamamlanmış, iptal edilmiş veya bulunamıyor.');

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

export async function cancelSignatureJobForUser(user, data = {}) {
  await ensureSignatureJobsTable();
  const queueId = cleanText(data.queueId, 80);
  if (!queueId) throw new Error('İptal edilecek imza işi seçilmedi.');

  return withTransaction(async (execute) => {
    const lookup = await execute(
      `
        SELECT TOP (1)
          j.PublicId,
          j.SignatureId,
          j.Status,
          j.PersonId,
          j.PersonName,
          j.RequestedBy,
          c.CoreName AS PersonCampusCore
        FROM dbo.SignatureJobs j WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.vw_EffectivePersonnel p ON p.PersonId = j.PersonId
        LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
        WHERE j.PublicId = @queueId
      `,
      {
        queueId: { type: sql.NVarChar(80), value: queueId }
      }
    );
    const job = lookup.recordset[0];
    if (!job) throw new Error('İptal edilecek imza işi bulunamadı.');

    const isHq =
      user.role === 'HQ IT' ||
      ['genel müdürlük', 'genel mudurluk'].includes(core(user.campus));
    const isRequester = normalizeEmail(job.RequestedBy) === normalizeEmail(user.email);
    const isSameCampus =
      Boolean(job.PersonCampusCore) && core(job.PersonCampusCore) === core(user.campus);
    if (!isHq && !isRequester && !isSameCampus) {
      throw new Error('Bu imza işini iptal etme yetkiniz yok.');
    }

    if (job.Status === 'IPTAL') {
      return { queueId: job.PublicId, signatureId: job.SignatureId, status: 'IPTAL' };
    }
    if (!['BEKLIYOR', 'ISLENIYOR'].includes(job.Status)) {
      throw new Error('Yalnızca bekleyen veya işlenen imza işleri iptal edilebilir.');
    }

    const cancelled = await execute(
      `
        UPDATE dbo.SignatureJobs
        SET Status = N'IPTAL',
            ErrorMessage = N'Kullanıcı tarafından iptal edildi.',
            FinishedAt = SYSUTCDATETIME(),
            UpdatedAt = SYSUTCDATETIME()
        OUTPUT INSERTED.PublicId, INSERTED.SignatureId, INSERTED.PersonId, INSERTED.PersonName
        WHERE PublicId = @queueId
          AND Status IN (N'BEKLIYOR', N'ISLENIYOR')
      `,
      {
        queueId: { type: sql.NVarChar(80), value: queueId }
      }
    );
    const row = cancelled.recordset[0];
    if (!row) throw new Error('İmza işi başka bir işlem tarafından güncellendi; kuyruğu yenileyin.');

    await execute(
      `
        UPDATE dbo.Personnel
        SET SignatureStatus = N'İptal edildi',
            UpdatedAt = SYSUTCDATETIME()
        WHERE PersonId = @personId
          AND SignatureId = @signatureId
      `,
      {
        personId: { type: sql.NVarChar(160), value: row.PersonId },
        signatureId: { type: sql.NVarChar(80), value: row.SignatureId }
      }
    );

    await appendSystemLog(
      'İMZA İŞİ İPTAL',
      user,
      `${row.PersonName || row.PersonId} / ${row.PublicId}`,
      data.clientIp || '',
      execute
    );

    return {
      queueId: row.PublicId,
      signatureId: row.SignatureId,
      status: 'IPTAL'
    };
  });
}

export async function fetchSignatureQueueForUser(user, data = {}) {
  await ensureSignatureJobsTable();
  const limit = Math.min(Math.max(Number(data.limit || 20), 1), 100);
  const isHq = user.role === 'HQ IT' || ['genel müdürlük', 'genel mudurluk'].includes(core(user.campus));

  const result = await query(
    `
      SELECT TOP (@limit)
        j.PublicId,
        j.SignatureId,
        j.Status,
        j.PersonId,
        j.PersonName,
        j.PersonEmail,
        j.TitleTr,
        j.SignatureCampus,
        j.ImageUrl,
        j.RequestedBy,
        j.ErrorMessage,
        j.CreatedAt,
        j.UpdatedAt,
        j.FinishedAt,
        c.Name AS PersonCampus,
        c.CoreName AS PersonCampusCore
      FROM dbo.SignatureJobs j
      LEFT JOIN dbo.vw_EffectivePersonnel p ON p.PersonId = j.PersonId
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      LEFT JOIN dbo.QueueNotificationDismissals d
        ON d.QueueKind = N'signature'
       AND d.QueuePublicId = j.PublicId
       AND d.UserEmail = @email
      WHERE d.DismissalId IS NULL
        AND (
          @isHq = 1
          OR j.RequestedBy = @email
          OR c.CoreName = @userCore
        )
      ORDER BY COALESCE(j.FinishedAt, j.UpdatedAt, j.CreatedAt) DESC
    `,
    {
      limit: { type: sql.Int, value: limit },
      isHq: { type: sql.Bit, value: isHq ? 1 : 0 },
      email: { type: sql.NVarChar(320), value: user.email },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  return {
    jobs: result.recordset.map((row) => {
      const doneUrl = row.Status === 'TAMAMLANDI' && row.ImageUrl ? row.ImageUrl : '';
      return {
        queueId: row.PublicId,
        publicId: row.PublicId,
        actionType: 'SIGNATURE_CREATE',
        action: 'SIGNATURE_CREATE',
        status: row.Status,
        personId: row.PersonId,
        personName: row.PersonName,
        personEmail: row.PersonEmail,
        titleTr: row.TitleTr,
        signatureCampus: row.SignatureCampus || row.PersonCampus || '',
        signatureId: row.SignatureId,
        imageUrl: row.ImageUrl || '',
        resultJson: doneUrl ? JSON.stringify({ url: doneUrl, resultLabel: 'İmza hazırlandı' }) : '',
        result: doneUrl ? JSON.stringify({ url: doneUrl, resultLabel: 'İmza hazırlandı' }) : '',
        errorMessage: row.ErrorMessage,
        error: row.ErrorMessage,
        requestedBy: row.RequestedBy,
        createdAt: row.CreatedAt,
        updatedAt: row.FinishedAt || row.UpdatedAt || row.CreatedAt,
        finishedAt: row.FinishedAt,
        campus: row.SignatureCampus || row.PersonCampus || ''
      };
    })
  };
}
export async function startTransferForUser(user, data) {
  const requestedTargetCampus = cleanText(data.targetCampus, 160);
  if (!requestedTargetCampus) throw new Error('Hedef kampüs boş.');
  const targetCampusRecord = await getActiveCampusByName(requestedTargetCampus);
  if (!targetCampusRecord) throw new Error('Hedef kampüs bulunamadı veya aktif değil.');
  const targetCampus = targetCampusRecord.Name;
  const targetCampusId = targetCampusRecord.CampusId;
  const transferRecipients = await getTransferEmailRecipients(targetCampusId, user.email);
  const rows = await findHardwareRows(user, data.hardwareIds, { requireStatus: 'DEPODA' });
  const senderLabel = `GÖNDEREN:${user.campus}`;
  const transferStatement = validateHandwrittenStatementData(
    data.transferStatement || data.transferSignature,
    'Teslim eden',
    'Eksiksiz teslim ettim.'
  );
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
  const queue = await withTransaction(async (execute) => {
    const queuedJob = await enqueuePdfJob({
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
        statements: { transfer: transferStatement },
        clientIp: cleanText(data.clientIp, 120),
        email: {
          to: transferRecipients.to,
          cc: transferRecipients.cc,
          replyTo: user.email,
          subject: 'Kampüsler Arası Cihaz Transferi (Çıkış)',
          body: `${user.campus} kampüsünden ${targetCampus} kampüsüne cihaz transferi başlatılmıştır. Tutanak ektedir.`
        }
      }
    }, execute);
    const queueDetails = { queueId: queuedJob.PublicId, documentStatus: 'PDF hazırlanıyor', pdfName };

    for (const row of rows) {
      const updateResult = await execute(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'TRANSFER',
            AssignedPersonId = @senderLabel,
            CampusId = @targetCampusId,
            DriveLink = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
          AND REPLACE(UPPER(ISNULL(HardwareStatus, N'')), N'İ', N'I') = N'DEPODA'
          AND ISNULL(AssignedPersonId, N'') = ISNULL(@expectedAssignedPersonId, N'')
          AND CampusId = @expectedCampusId
      `,
      {
        senderLabel: { type: sql.NVarChar(160), value: senderLabel },
        targetCampusId: { type: sql.UniqueIdentifier, value: targetCampusId },
        expectedAssignedPersonId: { type: sql.NVarChar(160), value: row.AssignedPersonId || null },
        expectedCampusId: { type: sql.UniqueIdentifier, value: row.CampusId },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
      await assertSingleHardwareUpdate(updateResult, 'Cihaz transfer çıkışı sırasında değişti: ' + row.SerialNo + '. Lütfen veriyi yenileyip tekrar deneyin.');
      await appendHardwareHistory(row.HardwareId, `Kampüs Çıkış (${user.campus}) (PDF hazırlanıyor)`, {
        personName: data.itName || user.email,
        createdBy: user.email,
        detailsJson: { targetCampus, previousCampus: row.Campus, ...queueDetails }
      }, execute);
    }

    await appendSystemLog('TRANSFER ÇIKIŞ KUYRUK', user, `${rows.length} cihaz -> ${targetCampus}, PDF kuyruğu: ${queuedJob.PublicId}`, data.clientIp || '', execute);
    return queuedJob;
  });
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
  const transferStatement = validateHandwrittenStatementData(
    data.transferStatement || data.transferSignature,
    'Teslim alan',
    'Eksiksiz teslim aldım.'
  );
  const pdfName = safePdfName(data.pdfName, 'transfer-giris.pdf');
  const senderCampuses = [
    ...new Set(
      rows
        .map((row) => String(row.AssignedPersonId || '').replace(/^GÖNDEREN:/i, '').replace(/^GONDEREN:/i, '').trim())
        .filter(Boolean)
    )
  ];
  if (senderCampuses.length !== 1) throw new Error('Transferin gönderen kampüsü doğrulanamadı.');
  const senderCampusRecord = await getActiveCampusByName(senderCampuses[0]);
  if (!senderCampusRecord) throw new Error('Gönderen kampüs bulunamadı veya aktif değil.');
  const senderCampus = senderCampusRecord.Name;
  const transferRecipients = await getTransferEmailRecipients(senderCampusRecord.CampusId, user.email);
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

  const queue = await withTransaction(async (execute) => {
    const queuedJob = await enqueuePdfJob({
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
        statements: { transfer: transferStatement },
        clientIp: cleanText(data.clientIp, 120),
        email: {
          to: transferRecipients.to,
          cc: transferRecipients.cc,
          replyTo: user.email,
          subject: 'Kampüsler Arası Cihaz Transferi (Teslim Alındı)',
          body: `${senderCampus || 'Gönderen kampüs'} tarafından gönderilen cihazlar ${user.campus} kampüsünde teslim alınmıştır. Tutanak ektedir.`
        }
      }
    }, execute);
    const queueDetails = { queueId: queuedJob.PublicId, documentStatus: 'PDF hazırlanıyor', pdfName };

    for (const row of rows) {
      const updateResult = await execute(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'DEPODA',
            AssignedPersonId = NULL,
            CampusId = @targetCampusId,
            DriveLink = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
          AND REPLACE(UPPER(ISNULL(HardwareStatus, N'')), N'İ', N'I') = N'TRANSFER'
          AND ISNULL(AssignedPersonId, N'') = ISNULL(@expectedAssignedPersonId, N'')
          AND CampusId = @expectedCampusId
      `,
      {
        targetCampusId: { type: sql.UniqueIdentifier, value: targetCampusId },
        expectedAssignedPersonId: { type: sql.NVarChar(160), value: row.AssignedPersonId || null },
        expectedCampusId: { type: sql.UniqueIdentifier, value: row.CampusId },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
      await assertSingleHardwareUpdate(updateResult, 'Cihaz transfer teslimi sırasında değişti: ' + row.SerialNo + '. Lütfen veriyi yenileyip tekrar deneyin.');
      await appendHardwareHistory(row.HardwareId, `Kampüs Giriş (${user.campus}) (PDF hazırlanıyor)`, {
        personName: data.itName || user.email,
        createdBy: user.email,
        detailsJson: { receiverCampus: user.campus, senderCampus, ...queueDetails }
      }, execute);
    }

    await appendSystemLog('TRANSFER GİRİŞ KUYRUK', user, `${rows.length} cihaz -> ${user.campus}, PDF kuyruğu: ${queuedJob.PublicId}`, data.clientIp || '', execute);
    return queuedJob;
  });
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
  }

  await withTransaction(async (execute) => {
    for (const row of rows) {
      const updateResult = await execute(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = N'DEPODA',
            AssignedPersonId = NULL,
            CampusId = @senderCampusId,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
          AND REPLACE(UPPER(ISNULL(HardwareStatus, N'')), N'İ', N'I') = N'TRANSFER'
          AND ISNULL(AssignedPersonId, N'') = ISNULL(@expectedAssignedPersonId, N'')
      `,
      {
        senderCampusId: { type: sql.UniqueIdentifier, value: senderCampusId },
        expectedAssignedPersonId: { type: sql.NVarChar(160), value: row.AssignedPersonId || null },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
      await assertSingleHardwareUpdate(updateResult, 'Cihaz transfer iptali sırasında değişti: ' + row.SerialNo + '. Lütfen veriyi yenileyip tekrar deneyin.');
      await appendHardwareHistory(row.HardwareId, 'Transfer İptal Edildi', {
        personName: data.currentUserName || user.email,
        createdBy: user.email,
        detailsJson: { senderCampus }
      }, execute);
    }

    await appendSystemLog('TRANSFER İPTAL', user, `${rows.length} cihaz -> ${senderCampus}`, data.clientIp || '', execute);
  });
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
      FROM dbo.vw_EffectivePersonnel p
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
      FROM dbo.vw_EffectivePersonnel p
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

async function enqueueGlpiReconcileJob() {
  const existing = await query(
    `
      SELECT TOP 1 QueueId, PublicId, Status
      FROM dbo.OperationQueue
      WHERE ActionType = N'RECONCILE_GLPI'
        AND Status IN (N'BEKLIYOR', N'ISLENIYOR')
      ORDER BY CreatedAt DESC
    `
  );

  if (existing.recordset[0]) {
    return { ...existing.recordset[0], reused: true };
  }

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const publicId = `GLPI-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const result = await query(
    `
      INSERT INTO dbo.OperationQueue (PublicId, ActionType, Status, PayloadJson, RequestedBy, CampusId)
      OUTPUT INSERTED.QueueId, INSERTED.PublicId, INSERTED.Status
      VALUES (@publicId, N'RECONCILE_GLPI', N'BEKLIYOR', @payloadJson, N'GLPI Sync Agent', NULL)
    `,
    {
      publicId: { type: sql.NVarChar(80), value: publicId },
      payloadJson: {
        type: sql.NVarChar(sql.MAX),
        value: JSON.stringify({ requestedBy: 'GLPI Sync Agent', requestedAt: new Date().toISOString() })
      }
    }
  );

  return { ...result.recordset[0], reused: false };
}

async function claimGlpiReconcileJobs(maxJobs, leaseToken, { includeFailed = false } = {}) {
  const result = await query(
    `
      ;WITH NextJobs AS (
        SELECT TOP (@maxJobs) QueueId
        FROM dbo.OperationQueue WITH (READPAST, UPDLOCK, ROWLOCK)
        WHERE (
                Status = N'BEKLIYOR'
                OR (@includeFailed = 1 AND Status = N'HATA')
                OR (Status = N'ISLENIYOR' AND (LeaseExpiresAt IS NULL OR LeaseExpiresAt <= SYSUTCDATETIME()))
              )
          AND AttemptCount < @maxAttempts
          AND ActionType = N'RECONCILE_GLPI'
        ORDER BY CreatedAt
      )
      UPDATE q
      SET Status = N'ISLENIYOR',
          StartedAt = COALESCE(StartedAt, SYSUTCDATETIME()),
          FinishedAt = NULL,
          ErrorMessage = NULL,
          AttemptCount = AttemptCount + 1,
          LeaseToken = @leaseToken,
          LeaseExpiresAt = DATEADD(SECOND, @leaseSeconds, SYSUTCDATETIME())
      OUTPUT INSERTED.QueueId, INSERTED.PublicId, INSERTED.ActionType
      FROM dbo.OperationQueue q
      INNER JOIN NextJobs n ON n.QueueId = q.QueueId;
    `,
    {
      maxJobs: { type: sql.Int, value: Math.max(1, Math.min(Number(maxJobs || 1), 5)) },
      includeFailed: { type: sql.Bit, value: includeFailed ? 1 : 0 },
      maxAttempts: { type: sql.Int, value: Math.max(1, Number(config.queue.maxAttempts || 5)) },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      leaseSeconds: { type: sql.Int, value: Math.max(60, Number(config.queue.leaseSeconds || 1800)) }
    }
  );

  return result.recordset || [];
}

async function renewOperationQueueLease(queueId, leaseToken) {
  const result = await query(
    `
      UPDATE dbo.OperationQueue
      SET LeaseExpiresAt = DATEADD(SECOND, @leaseSeconds, SYSUTCDATETIME())
      WHERE QueueId = @queueId
        AND Status = N'ISLENIYOR'
        AND LeaseToken = @leaseToken
    `,
    {
      queueId: { type: sql.BigInt, value: queueId },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      leaseSeconds: { type: sql.Int, value: Math.max(60, Number(config.queue.leaseSeconds || 1800)) }
    }
  );
  if (Number(result.rowsAffected?.[0] || 0) !== 1) throw new Error('İşlem kuyruğu lease sahipliği kaybedildi.');
}

async function markOperationQueueDone(queueId, leaseToken, resultPayload) {
  const result = await query(
    `
      UPDATE dbo.OperationQueue
      SET Status = N'TAMAMLANDI',
          ResultJson = @resultJson,
          ErrorMessage = NULL,
          FinishedAt = SYSUTCDATETIME(),
          LeaseToken = NULL,
          LeaseExpiresAt = NULL
      WHERE QueueId = @queueId
        AND Status = N'ISLENIYOR'
        AND LeaseToken = @leaseToken
    `,
    {
      queueId: { type: sql.BigInt, value: queueId },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      resultJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(resultPayload) }
    }
  );
  if (Number(result.rowsAffected?.[0] || 0) !== 1) throw new Error('İşlem kuyruğu tamamlanırken lease sahipliği kaybedildi.');
}

async function markOperationQueueFailed(queueId, leaseToken, error) {
  const result = await query(
    `
      UPDATE dbo.OperationQueue
      SET Status = N'HATA',
          ErrorMessage = @errorMessage,
          FinishedAt = SYSUTCDATETIME(),
          LeaseToken = NULL,
          LeaseExpiresAt = NULL
      WHERE QueueId = @queueId
        AND Status = N'ISLENIYOR'
        AND LeaseToken = @leaseToken
    `,
    {
      queueId: { type: sql.BigInt, value: queueId },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      errorMessage: { type: sql.NVarChar(sql.MAX), value: String(error?.message || error || 'İşlem kuyruğu hatası').slice(0, 4000) }
    }
  );
  return Number(result.rowsAffected?.[0] || 0) === 1;
}

async function assertSingleHardwareUpdate(result, message) {
  const affected = Array.isArray(result?.rowsAffected) ? Number(result.rowsAffected[0] || 0) : 0;
  if (affected === 1) return;
  throw new Error(message);
}

export async function processGlpiReconcileQueue({ maxJobs = 1, logger, includeFailed = false } = {}) {
  const leaseToken = crypto.randomUUID();
  const jobs = await claimGlpiReconcileJobs(maxJobs, leaseToken, { includeFailed });
  const results = [];

  for (const job of jobs) {
    try {
      const startedAt = new Date();
      await renewOperationQueueLease(job.QueueId, leaseToken);
      const reconcile = await reconcileHardwareWithGlpi();
      const result = {
        queueId: job.PublicId,
        actionType: job.ActionType,
        reconciled: reconcile.reconciled,
        matched: reconcile.matched,
        warnings: reconcile.warnings,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString()
      };
      await markOperationQueueDone(job.QueueId, leaseToken, result);
      results.push({ queueId: job.PublicId, status: 'TAMAMLANDI', result });
      logger?.info?.({ queueId: job.PublicId, ...reconcile }, 'GLPI eşleştirme kuyruğu tamamlandı');
    } catch (error) {
      await markOperationQueueFailed(job.QueueId, leaseToken, error);
      results.push({ queueId: job.PublicId, status: 'HATA', error: error.message });
      logger?.error?.({ err: error, queueId: job.PublicId }, 'GLPI eşleştirme kuyruğu hata verdi');
    }
  }

  return {
    processed: results.length,
    results
  };
}

export async function getOtpRecipientForUser(user, personId) {
  const person = await getPersonDetailsForDocument(personId);
  if (user.role !== 'HQ IT') {
    assertCanAccessCampus(user, person.campus, 'Farklı kampüs personeli için doğrulama kodu gönderemezsiniz.');
  }
  return person;
}

export async function syncGlpiDevicesFromAgent(secret, data = {}) {
  assertSharedSecret(secret, config.glpiSyncSecret, 'Yetkisiz GLPI sync isteği.');

  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 20000) throw new Error('Tek seferde çok fazla GLPI kaydı geldi.');
  if (items.length === 0) {
    throw new Error('GLPI cihaz listesi boş geldi; mevcut kayıtlar güvenlik amacıyla korunuyor.');
  }

  const syncStartedAt = new Date();
  let warnings = 0;
  const normalizedByGlpiId = new Map();

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
    if (normalizedByGlpiId.has(glpiId)) warnings += 1;
    normalizedByGlpiId.set(glpiId, {
      glpiId,
      serialNo: serialNo || null,
      computerName: computerName || null,
      manufacturer: manufacturer || null,
      model: model || null,
      adUsername: adUsername || null,
      locationName: locationName || null,
      lastInventory: lastInventory?.toISOString() || null,
      rawJson: JSON.stringify(item)
    });
  }

  const normalizedItems = Array.from(normalizedByGlpiId.values());
  const count = normalizedItems.length;
  const batchSize = 500;
  await withTransaction(async (execute) => {
    for (let offset = 0; offset < normalizedItems.length; offset += batchSize) {
      const batch = normalizedItems.slice(offset, offset + batchSize);
      await execute(
        `
          ;WITH SourceRows AS (
            SELECT
              GlpiId,
              NULLIF(SerialNo, N'') AS SerialNo,
              NULLIF(ComputerName, N'') AS ComputerName,
              NULLIF(Manufacturer, N'') AS Manufacturer,
              NULLIF(Model, N'') AS Model,
              NULLIF(AdUsername, N'') AS AdUsername,
              NULLIF(LocationName, N'') AS LocationName,
              TRY_CONVERT(DATETIME2(0), LastInventory, 127) AS LastInventory,
              RawJson
            FROM OPENJSON(@itemsJson)
            WITH (
              GlpiId INT '$.glpiId',
              SerialNo NVARCHAR(160) '$.serialNo',
              ComputerName NVARCHAR(160) '$.computerName',
              Manufacturer NVARCHAR(160) '$.manufacturer',
              Model NVARCHAR(240) '$.model',
              AdUsername NVARCHAR(160) '$.adUsername',
              LocationName NVARCHAR(240) '$.locationName',
              LastInventory NVARCHAR(40) '$.lastInventory',
              RawJson NVARCHAR(MAX) '$.rawJson'
            )
          )
          MERGE dbo.GlpiDevices AS target
          USING SourceRows AS source
            ON target.GlpiId = source.GlpiId
          WHEN MATCHED THEN UPDATE SET
            SerialNo = source.SerialNo,
            ComputerName = source.ComputerName,
            Manufacturer = source.Manufacturer,
            Model = source.Model,
            AdUsername = source.AdUsername,
            LocationName = source.LocationName,
            LastInventory = source.LastInventory,
            LastSync = @lastSync,
            RawJson = source.RawJson
          WHEN NOT MATCHED THEN
            INSERT (
              GlpiId, SerialNo, ComputerName, Manufacturer, Model, AdUsername,
              LocationName, LastInventory, LastSync, RawJson
            )
            VALUES (
              source.GlpiId, source.SerialNo, source.ComputerName, source.Manufacturer,
              source.Model, source.AdUsername, source.LocationName, source.LastInventory,
              @lastSync, source.RawJson
            );
        `,
        {
          itemsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(batch) },
          lastSync: { type: sql.DateTime2, value: syncStartedAt }
        }
      );
    }

    await execute(
      `
        DELETE target
        FROM dbo.GlpiDevices AS target
        WHERE NOT EXISTS (
          SELECT 1
          FROM OPENJSON(@activeGlpiIdsJson)
          WITH (GlpiId INT '$') AS active
          WHERE active.GlpiId = target.GlpiId
        )
      `,
      {
        activeGlpiIdsJson: {
          type: sql.NVarChar(sql.MAX),
          value: JSON.stringify(normalizedItems.map((item) => item.glpiId))
        }
      }
    );
  });

  const reconcileMode = typeof data.reconcile === 'string' ? data.reconcile.trim().toLowerCase() : data.reconcile;
  const shouldQueueReconcile = ['queue', 'kuyruk'].includes(reconcileMode);
  const shouldReconcile = ![false, 'false', '0', 'queue', 'kuyruk'].includes(reconcileMode);
  const queuedReconcile = shouldQueueReconcile ? await enqueueGlpiReconcileJob() : null;
  const reconcile = shouldReconcile ? await reconcileHardwareWithGlpi() : { reconciled: 0, matched: 0, warnings: 0 };
  await appendSystemLog(
    'GLPI SYNC',
    { email: 'GLPI Sync Agent' },
    `${count} GLPI cihazı senkronlandı. Eşleşen: ${reconcile.matched}, uyarı: ${reconcile.warnings + warnings}`,
    data.clientIp || data.machine || ''
  );

  return {
    count,
    syncedAt: syncStartedAt.toISOString(),
    reconcileSkipped: !shouldReconcile,
    reconcileQueued: Boolean(queuedReconcile),
    queueId: queuedReconcile?.PublicId || '',
    queueReused: Boolean(queuedReconcile?.reused),
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

  const prepared = [];
  for (const item of selected) {
    const campus = item.inferredCampus || user.campus || 'Bilinmiyor';
    const campusId = await ensureCampusId(campus);
    const serial = item.serial || `GLPI-${item.glpiId}`;
    const deviceType = item.deviceType || 'Cihaz';
    const mismatch = item.adUser ? 'ZIMMET_YOK_GLPI_KULLANICI_VAR' : 'OK';
    const notes = `GLPI'den eklendi. AD Kullanıcı: ${item.adUser || '-'}`;

    prepared.push({ item, campusId, serial, deviceType, mismatch, notes });
  }

  await withTransaction(async (execute) => {
    for (const entry of prepared) {
      const { item, campusId, serial, deviceType, mismatch, notes } = entry;
      const insertResult = await execute(
        `
          INSERT INTO dbo.Hardware (
            SerialNo, Model, CampusId, HardwareStatus, ComputerName, DeviceType, Brand, Notes,
            GlpiId, GlpiComputerName, GlpiAdUsername, GlpiPersonnelName, GlpiCampusGuess,
            GlpiDeviceType, GlpiMatchType, GlpiMismatch, GlpiLastSync
          )
          OUTPUT INSERTED.HardwareId
          SELECT
            @serial, @model, @campusId, N'DEPODA', @computerName, @deviceType, @brand, @notes,
            @glpiId, @glpiComputerName, @glpiAdUsername, @glpiPersonnelName, @glpiCampusGuess,
            @glpiDeviceType, N'GLPI_IMPORT', @glpiMismatch, @glpiLastSync
          WHERE NOT EXISTS (
            SELECT 1
            FROM dbo.Hardware WITH (UPDLOCK, HOLDLOCK)
            WHERE SerialNo = @serial OR GlpiId = @glpiId
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

      const hardwareId = insertResult.recordset[0]?.HardwareId;
      if (!hardwareId) {
        throw new Error(`GLPI cihazı işlem sırasında başka bir kullanıcı tarafından eklendi: ${serial}`);
      }
      await appendHardwareHistory(hardwareId, 'GLPI Import', {
        personName: user.email,
        createdBy: user.email,
        detailsJson: { glpiId: item.glpiId, adUser: item.adUser, importedFrom: 'GLPI_Cihazlar' }
      }, execute);
    }

    await appendSystemLog(
      'GLPI IMPORT',
      user,
      `${prepared.length} cihaz SQL Hardware tablosuna eklendi`,
      data.clientIp || '',
      execute
    );
  });
  return { imported: prepared.length };
}

function safePdfName(name, fallback = 'belge.pdf') {
  const safe = cleanText(name || fallback, 260).replace(/[\\/:*?"<>|]/g, '-');
  return safe.toLocaleLowerCase('tr-TR').endsWith('.pdf') ? safe : `${safe}.pdf`;
}

function validateHandwrittenStatementData(value, label, statementText) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value.image : value;
  const text = String(source || '');
  if (text.length > 300000) {
    throw new Error(`${label} el yazısı beyanı çok büyük.`);
  }

  const match = /^data:image\/png;base64,([a-zA-Z0-9+/]+={0,2})$/.exec(text);
  if (!match || match[1].length % 4 !== 0) {
    throw new Error(`${label} el yazısı beyanı formatı geçersiz.`);
  }

  const buffer = decodeCanonicalBase64(match[1], {
    label: `${label} el yazısı beyanı`,
    maxBytes: 225_000
  });
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < pngMagic.length || pngMagic.some((byte, index) => buffer[index] !== byte)) {
    throw new Error(`${label} el yazısı beyanı geçerli bir PNG değil.`);
  }

  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16).toUpperCase();
  return {
    image: `data:image/png;base64,${buffer.toString('base64')}`,
    text: statementText,
    hash: `BEYAN-${digest}`,
    confirmedAt: new Date().toISOString()
  };
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
        p.Phone,
        p.Department,
        p.Status,
        p.CampusId,
        c.Name AS Campus
      FROM dbo.vw_EffectivePersonnel p
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
    phone: String(row.Phone || ''),
    department: row.Department || 'Personel',
    status: row.Status || 'Aktif',
    campusId: row.CampusId || null,
    campus: row.Campus || 'Bilinmiyor'
  };
}

async function enqueuePdfJob({ actionType, payload, requestedBy, campusId }, execute = query) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const publicId = `PDF-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const result = await execute(
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

function parseQueueJson(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseQueueArray(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeQueueHardware(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    hardwareId: Number.isFinite(Number(item?.hardwareId)) ? Number(item.hardwareId) : null,
    serial: cleanText(item?.serial, 160),
    type: cleanText(item?.type, 80),
    brand: cleanText(item?.brand, 120),
    model: cleanText(item?.model, 240),
    computerName: cleanText(item?.computerName, 160),
    campus: cleanText(item?.campus, 160)
  }));
}

function numberOrUndefined(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
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

  const itStatement = validateHandwrittenStatementData(
    data.itStatement || data.itSignature,
    isReturn ? 'Teslim alan IT' : 'Teslim eden IT',
    isReturn ? 'Donanımı belirtilen durumda teslim aldım.' : 'Eksiksiz teslim ettim.'
  );
  const personStatement = validateHandwrittenStatementData(
    data.personStatement || data.personSignature,
    isReturn ? 'Teslim eden personel' : 'Teslim alan personel',
    isReturn
      ? 'Donanımı belirtilen durumda teslim ettim.'
      : 'Okudum, eksiksiz teslim aldım ve onaylıyorum.'
  );
  consumeOtpApproval(data.personOtpHash, {
    requesterEmail: user.email,
    personId: person.id,
    personEmail: person.email,
    action: isReturn ? 'return' : 'zimmet',
    hardwareIds: data.hardwareIds
  });

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
    statements: {
      it: itStatement,
      person: personStatement,
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

  const queue = await withTransaction(async (execute) => {
    const queuedJob = await enqueuePdfJob({
      actionType,
      payload,
      requestedBy: user.email,
      campusId: rows[0]?.CampusId || person.campusId || null
    }, execute);

    const queueDetails = {
      queueId: queuedJob.PublicId,
      documentStatus: 'PDF hazırlanıyor',
      pdfName
    };

    for (const row of rows) {
      const previousAssignedPersonId = row.AssignedPersonId || null;
      const previousStatusForUpdate = String(row.HardwareStatus || '').toUpperCase().replace(/İ/g, 'I');
      const updateResult = await execute(
      `
        UPDATE dbo.Hardware
        SET HardwareStatus = @status,
            AssignedPersonId = @assignedPersonId,
            DriveLink = NULL,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
          AND REPLACE(UPPER(ISNULL(HardwareStatus, N'')), N'İ', N'I') = @expectedStatus
          AND ISNULL(AssignedPersonId, N'') = ISNULL(@expectedAssignedPersonId, N'')
      `,
      {
        status: { type: sql.NVarChar(40), value: isReturn ? 'DEPODA' : 'AKTIF' },
        assignedPersonId: { type: sql.NVarChar(160), value: isReturn ? null : person.id },
        expectedStatus: { type: sql.NVarChar(40), value: previousStatusForUpdate },
        expectedAssignedPersonId: { type: sql.NVarChar(160), value: previousAssignedPersonId },
        hardwareId: { type: sql.Int, value: row.HardwareId }
      }
    );
      await assertSingleHardwareUpdate(updateResult, 'Cihaz durumu işlem sırasında değişti: ' + row.SerialNo + '. Lütfen veriyi yenileyip tekrar deneyin.');

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
      }, execute);
    }

    await appendSystemLog(
      isReturn ? 'İADE KUYRUK' : 'ZİMMET KUYRUK',
      user,
      `${person.name} -> ${rows.length} cihaz, PDF kuyruğu: ${queuedJob.PublicId}`,
      data.clientIp || '',
      execute
    );
    return queuedJob;
  });

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
      ;WITH QueueRows AS (
        SELECT TOP (@limit)
          q.QueueId,
          q.PublicId,
          q.ActionType,
          q.Status,
          CASE WHEN ISJSON(q.PayloadJson) = 1 THEN q.PayloadJson ELSE N'{}' END AS SafePayloadJson,
          CASE WHEN ISJSON(q.ResultJson) = 1 THEN q.ResultJson ELSE N'{}' END AS SafeResultJson,
          q.ErrorMessage,
          q.RequestedBy,
          q.AttemptCount,
          q.CreatedAt,
          q.StartedAt,
          q.FinishedAt,
          c.Name AS Campus
        FROM dbo.OperationQueue q
        LEFT JOIN dbo.Campuses c ON c.CampusId = q.CampusId
        LEFT JOIN dbo.QueueNotificationDismissals d
          ON d.QueueKind = N'operation'
         AND d.QueuePublicId = q.PublicId
         AND d.UserEmail = @email
        WHERE d.DismissalId IS NULL
          AND (@isHq = 1 OR q.RequestedBy = @email OR c.CoreName = @userCore)
        ORDER BY q.CreatedAt DESC
      )
      SELECT
        QueueId,
        PublicId,
        ActionType,
        Status,
        ErrorMessage,
        RequestedBy,
        AttemptCount,
        CreatedAt,
        StartedAt,
        FinishedAt,
        Campus,
        JSON_VALUE(SafePayloadJson, N'$.documentType') AS PayloadDocumentType,
        JSON_VALUE(SafePayloadJson, N'$.pdfName') AS PayloadPdfName,
        JSON_VALUE(SafePayloadJson, N'$.campus') AS PayloadCampus,
        JSON_VALUE(SafePayloadJson, N'$.senderCampus') AS PayloadSenderCampus,
        JSON_VALUE(SafePayloadJson, N'$.receiverCampus') AS PayloadReceiverCampus,
        JSON_VALUE(SafePayloadJson, N'$.transferDirection') AS PayloadTransferDirection,
        JSON_VALUE(SafePayloadJson, N'$.requestedBy') AS PayloadRequestedBy,
        JSON_VALUE(SafePayloadJson, N'$.itName') AS PayloadItName,
        JSON_VALUE(SafePayloadJson, N'$.person.id') AS PayloadPersonId,
        JSON_VALUE(SafePayloadJson, N'$.person.name') AS PayloadPersonName,
        JSON_VALUE(SafePayloadJson, N'$.person.campus') AS PayloadPersonCampus,
        JSON_VALUE(SafePayloadJson, N'$.person.department') AS PayloadPersonDepartment,
        JSON_QUERY(SafePayloadJson, N'$.hardware') AS PayloadHardwareJson,
        JSON_VALUE(SafeResultJson, N'$.url') AS ResultUrl,
        JSON_VALUE(SafeResultJson, N'$.resultLabel') AS ResultLabel,
        JSON_VALUE(SafeResultJson, N'$.matched') AS ResultMatched,
        JSON_VALUE(SafeResultJson, N'$.reconciled') AS ResultReconciled,
        JSON_VALUE(SafeResultJson, N'$.warnings') AS ResultWarnings,
        JSON_VALUE(SafeResultJson, N'$.count') AS ResultCount,
        JSON_VALUE(SafeResultJson, N'$.hardwareCount') AS ResultHardwareCount,
        JSON_VALUE(SafeResultJson, N'$.actionType') AS ResultActionType,
        JSON_VALUE(SafeResultJson, N'$.delivery') AS ResultDelivery
      FROM QueueRows
      ORDER BY CreatedAt DESC
    `,
    {
      limit: { type: sql.Int, value: limit },
      isHq: { type: sql.Bit, value: user.role === 'HQ IT' },
      email: { type: sql.NVarChar(320), value: user.email },
      userCore: { type: sql.NVarChar(160), value: core(user.campus) }
    }
  );

  return {
    jobs: result.recordset.map((row) => {
      const hardware = safeQueueHardware(parseQueueArray(row.PayloadHardwareJson));
      const hasPerson = Boolean(
        row.PayloadPersonId ||
        row.PayloadPersonName ||
        row.PayloadPersonCampus ||
        row.PayloadPersonDepartment
      );
      const payloadJson = JSON.stringify(compactObject({
        actionType: cleanText(row.ActionType, 120),
        documentType: cleanText(row.PayloadDocumentType, 40),
        pdfName: cleanText(row.PayloadPdfName, 260),
        campus: cleanText(row.PayloadCampus, 160),
        senderCampus: cleanText(row.PayloadSenderCampus, 160),
        receiverCampus: cleanText(row.PayloadReceiverCampus, 160),
        transferDirection: cleanText(row.PayloadTransferDirection, 20),
        requestedBy: cleanText(row.PayloadRequestedBy, 320),
        itName: cleanText(row.PayloadItName, 240),
        person: hasPerson
          ? {
              id: cleanText(row.PayloadPersonId, 160),
              name: cleanText(row.PayloadPersonName, 240),
              campus: cleanText(row.PayloadPersonCampus, 160),
              department: cleanText(row.PayloadPersonDepartment, 240)
            }
          : undefined,
        hardware,
        hardwareCount: hardware.length
      }));
      const resultJson = JSON.stringify(compactObject({
        url: cleanText(row.ResultUrl, 1000),
        resultLabel: cleanText(row.ResultLabel, 160),
        matched: numberOrUndefined(row.ResultMatched),
        reconciled: numberOrUndefined(row.ResultReconciled),
        warnings: numberOrUndefined(row.ResultWarnings),
        count: numberOrUndefined(row.ResultCount),
        hardwareCount: numberOrUndefined(row.ResultHardwareCount),
        actionType: cleanText(row.ResultActionType, 120),
        delivery: cleanText(row.ResultDelivery, 40)
      }));

      return {
        queueId: row.PublicId,
        internalQueueId: row.QueueId,
        publicId: row.PublicId,
        actionType: row.ActionType,
        action: row.ActionType,
        status: row.Status,
        payloadJson,
        resultJson,
        result: resultJson,
        errorMessage: row.ErrorMessage,
        error: row.ErrorMessage,
        requestedBy: row.RequestedBy,
        attemptCount: row.AttemptCount,
        createdAt: row.CreatedAt,
        startedAt: row.StartedAt,
        finishedAt: row.FinishedAt,
        updatedAt: row.FinishedAt || row.StartedAt || row.CreatedAt,
        campus: row.Campus || ''
      };
    })
  };
}

export async function dismissQueueNotificationsForUser(user, data = {}) {
  const allowedKinds = new Set(['operation', 'ad-password', 'signature']);
  const uniqueItems = [];
  const seen = new Set();

  for (const item of Array.isArray(data.items) ? data.items : []) {
    const kind = cleanText(item?.kind, 32).toLocaleLowerCase('en-US');
    const queueId = cleanText(item?.queueId, 80);
    const key = `${kind}:${queueId}`;
    if (!allowedKinds.has(kind) || !queueId || seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push({ kind, queueId });
  }

  if (uniqueItems.length === 0) {
    throw new Error('Gizlenecek kuyruk bildirimi bulunamadı.');
  }

  const email = cleanText(user.email, 320).toLocaleLowerCase('en-US');
  const isHq = user.role === 'HQ IT';
  const isSignatureHq =
    isHq || ['genel müdürlük', 'genel mudurluk'].includes(core(user.campus));

  const result = await withTransaction((execute) =>
    execute(
      `
        DECLARE @Requested TABLE (
          QueueKind NVARCHAR(32) NOT NULL,
          QueuePublicId NVARCHAR(80) NOT NULL,
          PRIMARY KEY (QueueKind, QueuePublicId)
        );

        INSERT INTO @Requested (QueueKind, QueuePublicId)
        SELECT QueueKind, QueuePublicId
        FROM OPENJSON(@itemsJson)
        WITH (
          QueueKind NVARCHAR(32) N'$.kind',
          QueuePublicId NVARCHAR(80) N'$.queueId'
        );

        ;WITH Accessible AS (
          SELECT r.QueueKind, r.QueuePublicId
          FROM @Requested r
          INNER JOIN dbo.OperationQueue q
            ON r.QueueKind = N'operation'
           AND q.PublicId = r.QueuePublicId
          LEFT JOIN dbo.Campuses c ON c.CampusId = q.CampusId
          WHERE q.Status IN (N'TAMAMLANDI', N'HATA', N'IPTAL')
            AND (@isHq = 1 OR q.RequestedBy = @email OR c.CoreName = @userCore)

          UNION ALL

          SELECT r.QueueKind, r.QueuePublicId
          FROM @Requested r
          INNER JOIN dbo.ADPasswordQueue q
            ON r.QueueKind = N'ad-password'
           AND q.PublicId = r.QueuePublicId
          LEFT JOIN dbo.Campuses c ON c.CampusId = q.CampusId
          WHERE q.Status IN (N'TAMAMLANDI', N'HATA', N'IPTAL')
            AND (@isHq = 1 OR q.RequestedBy = @email OR c.CoreName = @userCore)

          UNION ALL

          SELECT r.QueueKind, r.QueuePublicId
          FROM @Requested r
          INNER JOIN dbo.SignatureJobs j
            ON r.QueueKind = N'signature'
           AND j.PublicId = r.QueuePublicId
          LEFT JOIN dbo.vw_EffectivePersonnel p ON p.PersonId = j.PersonId
          LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
          WHERE j.Status IN (N'TAMAMLANDI', N'HATA', N'IPTAL')
            AND (
              @isSignatureHq = 1
              OR j.RequestedBy = @email
              OR c.CoreName = @userCore
            )
        ),
        DistinctAccessible AS (
          SELECT DISTINCT QueueKind, QueuePublicId
          FROM Accessible
        )
        INSERT INTO dbo.QueueNotificationDismissals (
          QueueKind,
          QueuePublicId,
          UserEmail
        )
        SELECT
          a.QueueKind,
          a.QueuePublicId,
          @email
        FROM DistinctAccessible a
        WHERE NOT EXISTS (
          SELECT 1
          FROM dbo.QueueNotificationDismissals d WITH (UPDLOCK, HOLDLOCK)
          WHERE d.UserEmail = @email
            AND d.QueueKind = a.QueueKind
            AND d.QueuePublicId = a.QueuePublicId
        );

        SELECT
          (SELECT COUNT(*) FROM @Requested) AS RequestedCount,
          COUNT(*) AS DismissedCount
        FROM dbo.QueueNotificationDismissals d
        INNER JOIN @Requested r
          ON r.QueueKind = d.QueueKind
         AND r.QueuePublicId = d.QueuePublicId
        WHERE d.UserEmail = @email;
      `,
      {
        itemsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(uniqueItems) },
        isHq: { type: sql.Bit, value: isHq ? 1 : 0 },
        isSignatureHq: { type: sql.Bit, value: isSignatureHq ? 1 : 0 },
        email: { type: sql.NVarChar(320), value: email },
        userCore: { type: sql.NVarChar(160), value: core(user.campus) }
      }
    )
  );

  const counts = result.recordset?.[0] || {};
  return {
    requestedCount: Number(counts.RequestedCount || 0),
    dismissedCount: Number(counts.DismissedCount || 0)
  };
}

export async function runOperationQueueForUser(user) {
  await appendSystemLog('İŞLEM KUYRUĞU KONTROL', user, 'SQL API üzerinden kuyruk kontrol edildi.', '');
  return { processed: 0, message: 'SQL API kuyruk okuyucu hazır; otomatik belge işleyici bir sonraki adımda bağlanacak.' };
}
