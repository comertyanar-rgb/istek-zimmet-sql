import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import sql from 'mssql';
import { config } from '../src/config.js';

const args = process.argv.slice(2);
const filePath = args.find((arg) => !arg.startsWith('--'));
const shouldReset = args.includes('--reset');
const importStartedAt = new Date();

if (!filePath) {
  console.error('Kullanim: npm run import:xlsx -- "C:\\path\\zimmet-export.xlsx" [--reset]');
  process.exit(1);
}

const resolvedFilePath = path.resolve(filePath);
if (!fs.existsSync(resolvedFilePath)) {
  console.error(`Excel dosyasi bulunamadi: ${resolvedFilePath}`);
  process.exit(1);
}

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeText(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return value.toLocaleString('fullwide', { useGrouping: false }).trim();
    }
    return String(value).trim();
  }
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  const email = normalizeText(value).toLocaleLowerCase('tr-TR');
  return email.includes('@') ? email : '';
}

function normalizeCore(value) {
  return normalizeHeader(value)
    .replace(/ kampusu/g, '')
    .replace(/ kampus/g, '')
    .trim();
}

function normalizeStatus(value) {
  const raw = normalizeHeader(value).toUpperCase();
  if (!raw || raw === 'AKTIF') return 'AKTIF';
  if (raw === 'DEPODA') return 'DEPODA';
  if (raw === 'HURDA') return 'HURDA';
  if (raw === 'TRANSFER') return 'TRANSFER';
  return 'DEPODA';
}

function normalizePhone(value) {
  const digits = normalizeText(value).replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
}

function validGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizeText(value));
}

function getCell(row, names) {
  for (const name of names) {
    const wanted = normalizeHeader(name);
    for (const [key, value] of Object.entries(row)) {
      if (normalizeHeader(key) === wanted) return value;
    }
  }
  return '';
}

function asRows(workbook, sheetNames) {
  const wanted = sheetNames.map(normalizeHeader);
  const sheetName = workbook.SheetNames.find((name) => wanted.includes(normalizeHeader(name)));
  if (!sheetName) return [];
  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: true });
}

function parseJsonHistory(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseDateOrNull(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = normalizeText(value);
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

async function dropTransferIncompatibleFk(pool) {
  try {
    await pool.request().query(`
IF EXISTS (
  SELECT 1
  FROM sys.foreign_keys
  WHERE name = 'FK_Hardware_Personnel'
    AND parent_object_id = OBJECT_ID('dbo.Hardware')
)
BEGIN
  ALTER TABLE dbo.Hardware DROP CONSTRAINT FK_Hardware_Personnel;
END
`);
  } catch (error) {
    throw new Error(`Transfer uyumluluk scripti uygulanamadi. SSMS'te Windows yetkili kullanicinla once sql/002_allow_transfer_sender.sql dosyasini calistir. Detay: ${error.message}`);
  }
}

async function resetTables(pool) {
  await pool.request().query(`
IF OBJECT_ID('dbo.SignatureJobs', 'U') IS NOT NULL DELETE FROM dbo.SignatureJobs;
IF OBJECT_ID('dbo.ADPasswordQueue', 'U') IS NOT NULL DELETE FROM dbo.ADPasswordQueue;
IF OBJECT_ID('dbo.SignatureTitles', 'U') IS NOT NULL DELETE FROM dbo.SignatureTitles;
DELETE FROM dbo.SystemLogs;
DELETE FROM dbo.OperationQueue;
DELETE FROM dbo.HardwareHistory;
DELETE FROM dbo.Hardware;
DELETE FROM dbo.GlpiDevices;
DELETE FROM dbo.Sessions;
DELETE FROM dbo.Personnel;
DELETE FROM dbo.AuthorizedUsers;
DELETE FROM dbo.Campuses;
`);
}

async function ensureAuxiliaryTables(pool) {
  await pool.request().query(`
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
END;
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
END;
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
END;
`);
}

async function upsertCampus(tx, item) {
  await tx.request()
    .input('CampusId', sql.UniqueIdentifier, validGuid(item.campusId) ? item.campusId : null)
    .input('CampusCode', sql.NVarChar(32), item.campusCode || null)
    .input('Name', sql.NVarChar(160), item.name)
    .input('AddressText', sql.NVarChar(500), item.address || null)
    .input('ShortAddress', sql.NVarChar(500), item.shortAddress || null)
    .input('CampusImage', sql.NVarChar(1000), item.campusImage || null)
    .query(`
MERGE dbo.Campuses AS target
USING (SELECT @Name AS Name) AS source
ON target.Name = source.Name
WHEN MATCHED THEN UPDATE SET
  CampusCode = COALESCE(@CampusCode, target.CampusCode),
  AddressText = @AddressText,
  ShortAddress = @ShortAddress,
  CampusImage = @CampusImage,
  UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (CampusId, CampusCode, Name, AddressText, ShortAddress, CampusImage)
  VALUES (ISNULL(@CampusId, NEWID()), @CampusCode, @Name, @AddressText, @ShortAddress, @CampusImage);
`);
}

async function loadCampusMap(tx) {
  const result = await tx.request().query(`
SELECT CONVERT(NVARCHAR(36), CampusId) AS CampusId, Name, CoreName
FROM dbo.Campuses;
`);
  const map = new Map();
  for (const row of result.recordset) {
    map.set(normalizeCore(row.Name), row.CampusId);
    map.set(normalizeCore(row.CoreName), row.CampusId);
  }
  return map;
}

function campusIdFor(campusMap, campusName) {
  return campusMap.get(normalizeCore(campusName)) || null;
}

async function upsertAuthorizedUser(tx, item, campusMap) {
  await tx.request()
    .input('Email', sql.NVarChar(320), item.email)
    .input('Role', sql.NVarChar(50), item.role)
    .input('CampusId', sql.UniqueIdentifier, campusIdFor(campusMap, item.campus))
    .query(`
MERGE dbo.AuthorizedUsers AS target
USING (SELECT @Email AS Email) AS source
ON target.Email = source.Email
WHEN MATCHED THEN UPDATE SET Role = @Role, CampusId = @CampusId, IsActive = 1
WHEN NOT MATCHED THEN
  INSERT (Email, Role, CampusId) VALUES (@Email, @Role, @CampusId);
`);
}

async function upsertSignatureTitle(tx, item) {
  await tx.request()
    .input('TitleTr', sql.NVarChar(240), item.titleTr)
    .input('TitleEn', sql.NVarChar(240), item.titleEn || null)
    .input('TemplateKey', sql.NVarChar(20), item.templateKey || null)
    .query(`
MERGE dbo.SignatureTitles AS target
USING (SELECT @TitleTr AS TitleTr) AS source
ON target.TitleTr = source.TitleTr
WHEN MATCHED THEN UPDATE SET
  TitleEn = @TitleEn,
  TemplateKey = @TemplateKey,
  IsActive = 1,
  UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (TitleTr, TitleEn, TemplateKey)
  VALUES (@TitleTr, @TitleEn, @TemplateKey);
`);
}

async function upsertPersonnel(tx, item, campusMap) {
  await tx.request()
    .input('PersonId', sql.NVarChar(160), item.personId)
    .input('FullName', sql.NVarChar(240), item.fullName)
    .input('Email', sql.NVarChar(320), item.email || null)
    .input('Department', sql.NVarChar(240), item.department || null)
    .input('CampusId', sql.UniqueIdentifier, campusIdFor(campusMap, item.campus))
    .input('Status', sql.NVarChar(40), item.status)
    .input('PhotoUrl', sql.NVarChar(1000), item.pictureUrl || null)
    .input('AdUsername', sql.NVarChar(160), item.adUsername || null)
    .input('Phone', sql.NVarChar(20), item.phone || null)
    .input('SignatureUrl', sql.NVarChar(1000), item.signatureLink || null)
    .query(`
MERGE dbo.Personnel AS target
USING (SELECT @PersonId AS PersonId) AS source
ON target.PersonId = source.PersonId
WHEN MATCHED THEN UPDATE SET
  FullName = @FullName,
  Email = @Email,
  Department = @Department,
  CampusId = @CampusId,
  Status = @Status,
  PhotoUrl = @PhotoUrl,
  AdUsername = @AdUsername,
  Phone = @Phone,
  SignatureUrl = @SignatureUrl,
  UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (PersonId, FullName, Email, Department, CampusId, Status, PhotoUrl, AdUsername, Phone, SignatureUrl)
  VALUES (@PersonId, @FullName, @Email, @Department, @CampusId, @Status, @PhotoUrl, @AdUsername, @Phone, @SignatureUrl);
`);
}

async function upsertHardware(tx, item, campusMap) {
  await tx.request()
    .input('SerialNo', sql.NVarChar(160), item.serialNo)
    .input('Model', sql.NVarChar(240), item.model || null)
    .input('CampusId', sql.UniqueIdentifier, campusIdFor(campusMap, item.campus))
    .input('AssignedPersonId', sql.NVarChar(160), item.assignedPersonId || null)
    .input('HardwareStatus', sql.NVarChar(40), item.status)
    .input('DriveLink', sql.NVarChar(1000), item.driveLink || null)
    .input('ComputerName', sql.NVarChar(160), item.computerName || null)
    .input('DeviceType', sql.NVarChar(80), item.deviceType || null)
    .input('Brand', sql.NVarChar(120), item.brand || null)
    .input('GroupName', sql.NVarChar(160), item.groupName || null)
    .input('Notes', sql.NVarChar(sql.MAX), item.notes || null)
    .input('GlpiId', sql.Int, item.glpiId)
    .input('GlpiComputerName', sql.NVarChar(160), item.glpiComputerName || null)
    .input('GlpiAdUsername', sql.NVarChar(160), item.glpiAdUsername || null)
    .input('GlpiPersonnelName', sql.NVarChar(240), item.glpiPersonName || null)
    .input('GlpiCampusGuess', sql.NVarChar(160), item.glpiCampusGuess || null)
    .input('GlpiDeviceType', sql.NVarChar(80), item.glpiDeviceType || null)
    .input('GlpiMatchType', sql.NVarChar(80), item.glpiMatchType || null)
    .input('GlpiMismatch', sql.NVarChar(240), item.glpiConflict || null)
    .input('GlpiLastSync', sql.DateTime2, item.glpiLastSync || null)
    .query(`
MERGE dbo.Hardware AS target
USING (SELECT @SerialNo AS SerialNo) AS source
ON target.SerialNo = source.SerialNo
WHEN MATCHED THEN UPDATE SET
  Model = @Model,
  CampusId = @CampusId,
  AssignedPersonId = @AssignedPersonId,
  HardwareStatus = @HardwareStatus,
  DriveLink = @DriveLink,
  ComputerName = @ComputerName,
  DeviceType = @DeviceType,
  Brand = @Brand,
  GroupName = @GroupName,
  Notes = @Notes,
  GlpiId = @GlpiId,
  GlpiComputerName = @GlpiComputerName,
  GlpiAdUsername = @GlpiAdUsername,
  GlpiPersonnelName = @GlpiPersonnelName,
  GlpiCampusGuess = @GlpiCampusGuess,
  GlpiDeviceType = @GlpiDeviceType,
  GlpiMatchType = @GlpiMatchType,
  GlpiMismatch = @GlpiMismatch,
  GlpiLastSync = @GlpiLastSync,
  UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (SerialNo, Model, CampusId, AssignedPersonId, HardwareStatus, DriveLink, ComputerName, DeviceType, Brand, GroupName, Notes, GlpiId, GlpiComputerName, GlpiAdUsername, GlpiPersonnelName, GlpiCampusGuess, GlpiDeviceType, GlpiMatchType, GlpiMismatch, GlpiLastSync)
  VALUES (@SerialNo, @Model, @CampusId, @AssignedPersonId, @HardwareStatus, @DriveLink, @ComputerName, @DeviceType, @Brand, @GroupName, @Notes, @GlpiId, @GlpiComputerName, @GlpiAdUsername, @GlpiPersonnelName, @GlpiCampusGuess, @GlpiDeviceType, @GlpiMatchType, @GlpiMismatch, @GlpiLastSync);
`);
}

async function insertHardwareHistory(tx, serialNo, historyItems) {
  const deviceResult = await tx.request()
    .input('SerialNo', sql.NVarChar(160), serialNo)
    .query('SELECT TOP 1 HardwareId FROM dbo.Hardware WHERE SerialNo = @SerialNo');

  const hardwareId = deviceResult.recordset[0]?.HardwareId;
  if (!hardwareId) return;

  await tx.request()
    .input('HardwareId', sql.Int, hardwareId)
    .query('DELETE FROM dbo.HardwareHistory WHERE HardwareId = @HardwareId');

  for (const item of historyItems) {
    await tx.request()
      .input('HardwareId', sql.Int, hardwareId)
      .input('EventType', sql.NVarChar(120), normalizeText(item.type) || 'Geçmiş')
      .input('PersonName', sql.NVarChar(240), normalizeText(item.personName) || null)
      .input('DriveLink', sql.NVarChar(1000), normalizeText(item.driveLink) || null)
      .input('EventDate', sql.DateTime2, parseDateOrNull(item.date) || importStartedAt)
      .input('DetailsJson', sql.NVarChar(sql.MAX), JSON.stringify(item))
      .query(`
INSERT INTO dbo.HardwareHistory (HardwareId, EventType, PersonName, DriveLink, EventDate, DetailsJson)
VALUES (@HardwareId, @EventType, @PersonName, @DriveLink, @EventDate, @DetailsJson);
`);
  }
}

async function upsertGlpiDevice(tx, item) {
  await tx.request()
    .input('GlpiId', sql.Int, item.glpiId)
    .input('SerialNo', sql.NVarChar(160), item.serialNo || null)
    .input('ComputerName', sql.NVarChar(160), item.computerName || null)
    .input('Manufacturer', sql.NVarChar(160), item.manufacturer || null)
    .input('Model', sql.NVarChar(240), item.model || null)
    .input('AdUsername', sql.NVarChar(160), item.adUsername || null)
    .input('LocationName', sql.NVarChar(240), item.location || null)
    .input('LastInventory', sql.DateTime2, item.lastInventory || null)
    .input('LastSync', sql.DateTime2, item.lastSync || importStartedAt)
    .input('RawJson', sql.NVarChar(sql.MAX), item.rawJson)
    .query(`
MERGE dbo.GlpiDevices AS target
USING (SELECT @GlpiId AS GlpiId) AS source
ON target.GlpiId = source.GlpiId
WHEN MATCHED THEN UPDATE SET
  SerialNo = @SerialNo,
  ComputerName = @ComputerName,
  Manufacturer = @Manufacturer,
  Model = @Model,
  AdUsername = @AdUsername,
  LocationName = @LocationName,
  LastInventory = @LastInventory,
  LastSync = @LastSync,
  RawJson = @RawJson
WHEN NOT MATCHED THEN
  INSERT (GlpiId, SerialNo, ComputerName, Manufacturer, Model, AdUsername, LocationName, LastInventory, LastSync, RawJson)
  VALUES (@GlpiId, @SerialNo, @ComputerName, @Manufacturer, @Model, @AdUsername, @LocationName, @LastInventory, @LastSync, @RawJson);
`);
}

function parseWorkbook() {
  const workbook = xlsx.readFile(resolvedFilePath, { cellDates: true });

  const campuses = asRows(workbook, ['Kampüs', 'Kampus']).map((row, idx) => {
    const name = normalizeText(getCell(row, ['Kampüs', 'Kampus']));
    return {
      campusId: normalizeText(getCell(row, ['Campus Id'])),
      campusCode: normalizeText(getCell(row, ['Campus Code', 'Kod'])),
      name,
      address: normalizeText(getCell(row, ['Adresi', 'Adres'])),
      shortAddress: normalizeText(getCell(row, ['Adres'])),
      campusImage: normalizeText(getCell(row, ['CampusImage', 'Campus Image']))
    };
  }).filter((item) => item.name);

  const authorizedUsers = asRows(workbook, ['Yetkili_IT', 'Yetkili IT']).map((row) => ({
    email: normalizeEmail(getCell(row, ['E-Posta', 'Email'])),
    role: normalizeText(getCell(row, ['Rol', 'Role'])) || 'IT',
    campus: normalizeText(getCell(row, ['Kampüs', 'Kampus', 'Campus'])) || 'Bilinmiyor'
  })).filter((item) => item.email);

  const signatureTitles = asRows(workbook, ['Ünvanlar', 'Unvanlar', 'ünvanlar', 'Imza_Unvanlar', 'İmza_Unvanlar']).map((row) => ({
    titleTr: normalizeText(getCell(row, ['Ünvan', 'Unvan', 'Türkçe Ünvan', 'Turkce Unvan', 'Title TR', 'titleTr'])),
    titleEn: normalizeText(getCell(row, ['İngilizce Ünvan', 'Ingilizce Unvan', 'English', 'Title EN', 'titleEn'])),
    templateKey: normalizeText(getCell(row, ['Şablon', 'Sablon', 'Template', 'TemplateKey', 'templateKey']))
      .replace(/^imza-template-/i, '')
      .replace(/^template-/i, '')
      .replace(/^tpl/i, '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 20)
  })).filter((item) => item.titleTr);

  const personnel = asRows(workbook, ['Kullanıcılar', 'Kullanicilar']).map((row) => {
    const email = normalizeEmail(getCell(row, ['Email', 'E-Posta']));
    const personId = normalizeText(getCell(row, ['User Id', 'Kullanıcı', 'Kullanici'])) || email;
    return {
      personId,
      fullName: normalizeText(getCell(row, ['Ad Soyad', 'Adı Soyadı', 'Adi Soyadi', 'Kullanıcı', 'Kullanici', 'Name'])) || personId,
      email,
      department: normalizeText(getCell(row, ['Department', 'Departman', 'Görev', 'Gorev', 'Ünvan', 'Unvan'])) || 'Personel',
      campus: normalizeText(getCell(row, ['Kampüs', 'Kampus', 'Okul'])) || 'Bilinmiyor',
      status: normalizeText(getCell(row, ['Durumu', 'Status'])) || 'Aktif',
      pictureUrl: normalizeText(getCell(row, ['Profil Fotoğrafı', 'Profil Fotografi', 'Fotoğraf', 'Fotograf'])),
      adUsername: normalizeText(getCell(row, ['AD Kullanıcı', 'AD Kullanici', 'AD Username'])),
      phone: normalizePhone(getCell(row, ['Telefon', 'Phone', 'Cep Telefonu'])),
      signatureLink: normalizeText(getCell(row, ['İmza Linki', 'Imza Linki', 'Signature Link']))
    };
  }).filter((item) => item.personId);

  dedupePersonnelEmails(personnel);

  const hardware = asRows(workbook, ['Laptoplar']).map((row) => {
    const serialNo = normalizeText(getCell(row, ['Seri no', 'Seri No', 'Serial']));
    return {
      serialNo,
      model: normalizeText(getCell(row, ['Modeli', 'Model'])) || 'Bilinmiyor',
      campus: normalizeText(getCell(row, ['Kampüs', 'Kampus'])) || 'Bilinmiyor',
      assignedPersonId: normalizeText(getCell(row, ['Kullanıcı', 'Kullanici'])),
      status: normalizeStatus(getCell(row, ['Cihaz Durumu'])),
      driveLink: normalizeText(getCell(row, ['Drive Linki'])),
      computerName: normalizeText(getCell(row, ['Bilgisayar İsmi', 'Bilgisayar Ismi'])),
      deviceType: normalizeText(getCell(row, ['Cihaz Tipi'])) || 'Laptop',
      brand: normalizeText(getCell(row, ['Marka'])) || 'Bilinmiyor',
      groupName: normalizeText(getCell(row, ['Grup Adı', 'Grup Adi'])),
      notes: normalizeText(getCell(row, ['Notlar'])),
      glpiId: Number.parseInt(normalizeText(getCell(row, ['GLPI ID'])), 10) || null,
      glpiComputerName: normalizeText(getCell(row, ['GLPI Bilgisayar İsmi', 'GLPI Bilgisayar Ismi'])),
      glpiAdUsername: normalizeText(getCell(row, ['GLPI AD Kullanıcı', 'GLPI AD Kullanici'])),
      glpiPersonName: normalizeText(getCell(row, ['GLPI Personel', 'GLPI Personel Eşleşme', 'GLPI Personel Eslesme'])),
      glpiCampusGuess: normalizeText(getCell(row, ['GLPI Kampüs Tahmin', 'GLPI Kampus Tahmin'])),
      glpiDeviceType: normalizeText(getCell(row, ['GLPI Cihaz Tipi'])),
      glpiMatchType: normalizeText(getCell(row, ['GLPI Eşleşme', 'GLPI Eslesme'])),
      glpiConflict: normalizeText(getCell(row, ['GLPI Uyuşmazlık', 'GLPI Uyusmazlik'])),
      glpiLastSync: parseDateOrNull(getCell(row, ['GLPI Son Sync'])),
      history: parseJsonHistory(getCell(row, ['Geçmiş', 'Gecmis']))
    };
  }).filter((item) => item.serialNo);

  const glpiDevices = asRows(workbook, ['GLPI_Cihazlar', 'GLPI Cihazlar']).map((row) => {
    const glpiId = Number.parseInt(normalizeText(getCell(row, ['GLPI ID', 'id'])), 10);
    return {
      glpiId,
      serialNo: normalizeText(getCell(row, ['Seri no', 'Seri No', 'serial'])),
      computerName: normalizeText(getCell(row, ['Bilgisayar İsmi', 'Bilgisayar Ismi', 'name'])),
      manufacturer: normalizeText(getCell(row, ['Marka', 'manufacturer'])),
      model: normalizeText(getCell(row, ['Model', 'model'])),
      adUsername: normalizeText(getCell(row, ['AD Kullanıcı', 'AD Kullanici', 'users_id'])),
      location: normalizeText(getCell(row, ['Lokasyon', 'locations_id'])),
      lastInventory: parseDateOrNull(getCell(row, ['Son Envanter'])),
      lastSync: parseDateOrNull(getCell(row, ['Son Sync'])),
      rawJson: JSON.stringify(row)
    };
  }).filter((item) => Number.isFinite(item.glpiId));

  return { campuses, authorizedUsers, signatureTitles, personnel, hardware, glpiDevices };
}

function dedupePersonnelEmails(personnel) {
  const seen = new Map();
  for (const person of personnel) {
    if (!person.email) continue;
    if (seen.has(person.email) && seen.get(person.email) !== person.personId) {
      person.email = '';
      continue;
    }
    seen.set(person.email, person.personId);
  }
}

function collectCampusNames(parsed) {
  const names = new Map();
  const add = (name) => {
    const value = normalizeText(name);
    if (value) names.set(normalizeCore(value), value);
  };

  parsed.campuses.forEach((item) => add(item.name));
  parsed.authorizedUsers.forEach((item) => add(item.campus));
  parsed.personnel.forEach((item) => add(item.campus));
  parsed.hardware.forEach((item) => add(item.campus));

  return [...names.values()].filter((name) => normalizeCore(name) !== 'bilinmiyor');
}

async function main() {
  const parsed = parseWorkbook();
  const pool = await sql.connect(config.sql);

  await dropTransferIncompatibleFk(pool);
  await ensureAuxiliaryTables(pool);
  if (shouldReset) await resetTables(pool);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const item of parsed.campuses) await upsertCampus(tx, item);

    const knownCampusNames = new Set(parsed.campuses.map((item) => normalizeCore(item.name)));
    for (const name of collectCampusNames(parsed)) {
      if (!knownCampusNames.has(normalizeCore(name))) {
        await upsertCampus(tx, { name, campusId: '', campusCode: '', address: '', shortAddress: '', campusImage: '' });
      }
    }

    const campusMap = await loadCampusMap(tx);

    for (const item of parsed.authorizedUsers) await upsertAuthorizedUser(tx, item, campusMap);
    for (const item of parsed.signatureTitles) await upsertSignatureTitle(tx, item);
    for (const item of parsed.personnel) await upsertPersonnel(tx, item, campusMap);
    for (const item of parsed.hardware) {
      await upsertHardware(tx, item, campusMap);
      await insertHardwareHistory(tx, item.serialNo, item.history);
    }
    for (const item of parsed.glpiDevices) await upsertGlpiDevice(tx, item);

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    await pool.close();
  }

  console.log('Import tamamlandi.');
  console.table({
    campuses: parsed.campuses.length,
    authorizedUsers: parsed.authorizedUsers.length,
    signatureTitles: parsed.signatureTitles.length,
    personnel: parsed.personnel.length,
    hardware: parsed.hardware.length,
    glpiDevices: parsed.glpiDevices.length,
    reset: shouldReset
  });
}

main().catch((error) => {
  console.error('Import basarisiz:', error.message);
  process.exit(1);
});
