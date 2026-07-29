import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handleAction } from '../src/actionRouter.js';
import { config } from '../src/config.js';
import { closePool, query, sql } from '../src/db.js';
import { setOtpTestObserver } from '../src/otpService.js';
import { closePdfRenderer } from '../src/pdfRenderer.js';
import { processPdfQueue } from '../src/pdfQueueWorker.js';
import { getAuthorizedUser } from '../src/repositories/inventoryRepository.js';
import { createSession, revokeSession } from '../src/sessionService.js';

const CONFIRMATION = String(process.env.BUSINESS_BULK_TEST_CONFIRM || '').trim();
const REQUESTER_EMAIL = String(process.env.TEST_NOTIFY_EMAIL || '').trim().toLowerCase();
const TEST_PHONE = String(process.env.TEST_NOTIFY_PHONE || '').replace(/\D/g, '');
const DEVICE_COUNT = Math.min(Math.max(Number(process.env.BUSINESS_BULK_TEST_DEVICES || 12), 2), 50);
const TEST_PHASE = String(process.env.BUSINESS_BULK_TEST_PHASE || 'full').trim().toLowerCase();
const CAPTURE_OTP = String(process.env.BUSINESS_BULK_TEST_CAPTURE_OTP || '').trim() === 'YES';
const API_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const OTP_TIMEOUT_MS = 165_000;
const QUEUE_TIMEOUT_MS = 180_000;
const POLL_MS = 1500;
const PREFIX = `CODEX-BULK-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SQLCMD =
  process.env.SQLCMD_PATH ||
  'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\SQLCMD.EXE';
const OTP_FILE = path.resolve(
  process.env.BUSINESS_BULK_TEST_OTP_FILE || path.join(os.tmpdir(), 'istek-zimmet-business-otp.txt')
);

let sessionToken = '';
let person = null;
let originalPhone = null;
let hardware = [];
let completed = false;
let cleanupStarted = false;
let phoneMayHaveChanged = false;
const queueIds = [];
const capturedOtpCodes = new Map();
const startedAt = Date.now();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sqlLiteral(value) {
  return `N'${String(value ?? '').replace(/'/g, "''")}'`;
}

function statusLabel(value) {
  return String(value || '').trim().toUpperCase().replace(/İ/g, 'I');
}

async function callAction(action, payload = {}) {
  const response = await handleAction({ action, authToken: sessionToken, ...payload });
  assert(response?.success === true, response?.error || `${action} işlemi başarısız.`);
  return response;
}

async function ensureReady() {
  assert(CONFIRMATION === 'YES', 'Gerçek bildirim testi için BUSINESS_BULK_TEST_CONFIRM=YES gereklidir.');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(REQUESTER_EMAIL), 'TEST_NOTIFY_EMAIL geçerli olmalıdır.');
  assert(/^(?:90|0)?5\d{9}$/.test(TEST_PHONE), 'TEST_NOTIFY_PHONE Türkiye cep telefonu biçiminde olmalıdır.');
  assert(config.googleBridge?.url && config.googleBridge?.secret, 'Google Bridge ayarları eksik.');
  assert(config.mobildev?.apiKey && config.mobildev?.apiSecret, 'Mobildev ayarları eksik.');
  assert(['full', 'return-only'].includes(TEST_PHASE), 'BUSINESS_BULK_TEST_PHASE full veya return-only olmalıdır.');
  if (CAPTURE_OTP) {
    assert(config.nodeEnv === 'test', 'OTP yakalama yalnız NODE_ENV=test sürecinde kullanılabilir.');
    assert(process.env.OTP_TEST_CAPTURE_ALLOWED === 'YES', 'OTP_TEST_CAPTURE_ALLOWED=YES gereklidir.');
    setOtpTestObserver(({ challengeId, otpCode }) => capturedOtpCodes.set(challengeId, otpCode));
  }

  const health = await fetch(`${API_URL}/health`);
  assert(health.ok, `Backend sağlık kontrolü başarısız: HTTP ${health.status}`);
  const healthBody = await health.json();
  assert(healthBody?.success === true, healthBody?.error || 'Backend hazır değil.');

  const active = await query(`
    SELECT COUNT(*) AS ActiveCount
    FROM dbo.OperationQueue
    WHERE Status IN (N'BEKLIYOR', N'ISLENIYOR')
      AND ActionType IN (N'GENERATE_ZIMMET_PDF', N'GENERATE_RETURN_PDF', N'GENERATE_TRANSFER_PDF')
  `);
  assert(Number(active.recordset[0]?.ActiveCount || 0) === 0, 'Kuyrukta mevcut PDF işi var; test başlatılmadı.');

  const authorizedUser = await getAuthorizedUser(REQUESTER_EMAIL);
  assert(authorizedUser?.role === 'HQ IT', 'Toplu iş testi için belirtilen hesap aktif HQ IT olmalıdır.');

  const personResult = await query(
    `
      SELECT TOP (1) p.PersonId, p.FullName, p.Email, p.Phone, p.CampusId, c.Name AS Campus
      FROM dbo.Personnel p
      LEFT JOIN dbo.Campuses c ON c.CampusId = p.CampusId
      WHERE LOWER(p.Email) = @email
    `,
    { email: { type: sql.NVarChar(320), value: REQUESTER_EMAIL } }
  );
  person = personResult.recordset[0];
  assert(person?.PersonId && person?.CampusId, 'Test e-posta adresine ait personel veya kampüs bulunamadı.');
  originalPhone = person.Phone ?? null;
}

async function createTestHardware() {
  const items = Array.from({ length: DEVICE_COUNT }, (_, index) => ({
    serial: `${PREFIX}-${String(index + 1).padStart(2, '0')}`,
    model: `Toplu Akış Testi ${index + 1}`,
    computerName: `CDX${PREFIX.slice(-8)}${String(index + 1).padStart(2, '0')}`,
    deviceType: index % 3 === 0 ? 'Laptop' : index % 3 === 1 ? 'Masaüstü' : 'Monitör',
    brand: 'CODEX TEST'
  }));

  const result = await query(
    `
      INSERT INTO dbo.Hardware (
        SerialNo, Model, CampusId, HardwareStatus, ComputerName, DeviceType, Brand, GroupName, Notes
      )
      OUTPUT INSERTED.HardwareId, INSERTED.SerialNo, INSERTED.HardwareStatus
      SELECT serial, model, @campusId, N'DEPODA', computerName, deviceType, brand, NULL, @notes
      FROM OPENJSON(@itemsJson)
      WITH (
        serial NVARCHAR(160) '$.serial',
        model NVARCHAR(240) '$.model',
        computerName NVARCHAR(160) '$.computerName',
        deviceType NVARCHAR(80) '$.deviceType',
        brand NVARCHAR(120) '$.brand'
      )
    `,
    {
      campusId: { type: sql.UniqueIdentifier, value: person.CampusId },
      itemsJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(items) },
      notes: { type: sql.NVarChar(sql.MAX), value: `${PREFIX} kontrollü test kaydıdır.` }
    }
  );
  hardware = result.recordset;
  assert(hardware.length === DEVICE_COUNT, `Yalnız ${hardware.length}/${DEVICE_COUNT} test cihazı oluşturuldu.`);
}

async function readHardwareState() {
  const result = await query(
    `
      SELECT HardwareId, SerialNo, HardwareStatus, AssignedPersonId, GroupName, DriveLink
      FROM dbo.Hardware
      WHERE SerialNo LIKE @prefix
      ORDER BY SerialNo
    `,
    { prefix: { type: sql.NVarChar(180), value: `${PREFIX}%` } }
  );
  return result.recordset;
}

async function validateAllHardware({ status, assignedPersonId, groupName, requireDriveLink = false }) {
  const rows = await readHardwareState();
  assert(rows.length === DEVICE_COUNT, `Test cihaz sayısı değişti: ${rows.length}/${DEVICE_COUNT}.`);
  assert(rows.every((row) => statusLabel(row.HardwareStatus) === status), `Cihazların tamamı ${status} durumunda değil.`);
  if (assignedPersonId === null) {
    assert(rows.every((row) => !row.AssignedPersonId), 'Bazı test cihazlarında personel ataması kaldı.');
  } else if (assignedPersonId) {
    assert(rows.every((row) => String(row.AssignedPersonId) === String(assignedPersonId)), 'Bazı cihazların zimmet sahibi yanlış.');
  }
  if (groupName !== undefined) {
    assert(rows.every((row) => String(row.GroupName || '') === groupName), 'Toplu grup güncellemesi eksik kaldı.');
  }
  if (requireDriveLink) {
    assert(rows.every((row) => /^https?:\/\//i.test(String(row.DriveLink || ''))), 'Bazı cihazların Drive bağlantısı oluşmadı.');
  }
  return rows;
}

async function runBulkDatabaseActions() {
  const serials = hardware.map((item) => item.SerialNo);
  const groupName = `${PREFIX} GRUBU`;
  await callAction('bulkUpdateGroup', { hardwareIds: serials, groupName });
  await validateAllHardware({ status: 'DEPODA', assignedPersonId: null, groupName });

  const scanResult = await callAction('recordInventoryScan', {
    scans: serials.map((serial) => ({ hardwareId: serial, qrPayload: `ISTEK-ZIMMET:${serial}` }))
  });
  assert(Number(scanResult.count || 0) === DEVICE_COUNT, 'Toplu QR sayım adedi uyuşmuyor.');

  await callAction('bulkStatusUpdate', { hardwareIds: serials, newStatus: 'Hurda' });
  await validateAllHardware({ status: 'HURDA', assignedPersonId: null, groupName });

  await callAction('bulkStatusUpdate', { hardwareIds: serials, newStatus: 'Available' });
  await validateAllHardware({ status: 'DEPODA', assignedPersonId: null, groupName });
}

async function prepareReturnOnlyState() {
  const serials = hardware.map((item) => item.SerialNo);
  const groupName = `${PREFIX} GRUBU`;
  await callAction('bulkUpdateGroup', { hardwareIds: serials, groupName });
  const result = await query(
    `
      UPDATE dbo.Hardware
      SET HardwareStatus = N'AKTIF',
          AssignedPersonId = @personId,
          UpdatedAt = SYSUTCDATETIME()
      WHERE SerialNo LIKE @prefix
        AND HardwareStatus = N'DEPODA'
    `,
    {
      personId: { type: sql.NVarChar(160), value: person.PersonId },
      prefix: { type: sql.NVarChar(180), value: `${PREFIX}%` }
    }
  );
  assert(Number(result.rowsAffected?.[0] || 0) === DEVICE_COUNT, 'İade testi için sentetik zimmet durumu hazırlanamadı.');
  await validateAllHardware({ status: 'AKTIF', assignedPersonId: person.PersonId, groupName });
}

async function promptOtp(label, channelDescription) {
  console.log(`\n${label} doğrulama kodu ${channelDescription} gönderildi.`);
  await fs.rm(OTP_FILE, { force: true });
  console.log(`${label} kodu bekleniyor. Tek kullanımlık giriş dosyası: ${OTP_FILE}`);
  const deadline = Date.now() + OTP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const code = String(await fs.readFile(OTP_FILE, 'utf8')).trim();
      await fs.rm(OTP_FILE, { force: true });
      assert(/^\d{6}$/.test(code), 'OTP kodu 6 rakam olmalıdır.');
      return code;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await sleep(500);
  }
  throw new Error(`${label} OTP giriş süresi doldu.`);
}

async function getOtpApproval(action, channel) {
  const serials = hardware.map((item) => item.SerialNo);
  const challenge = await callAction('sendOTP', {
    personId: person.PersonId,
    personPhone: TEST_PHONE,
    otpChannel: channel,
    otpAction: action,
    hardwareIds: serials
  });
  if (channel === 'sms') phoneMayHaveChanged = true;
  let code = '';
  if (CAPTURE_OTP) {
    code = String(capturedOtpCodes.get(challenge.challengeId) || '');
    capturedOtpCodes.delete(challenge.challengeId);
    assert(/^\d{6}$/.test(code), 'Test OTP kodu bellekten alınamadı.');
    console.log(`${action === 'zimmet' ? 'Toplu zimmet' : 'Toplu iade'} OTP teslimi doğrulandı; kod test belleğinden tüketildi.`);
  } else {
    code = await promptOtp(
      action === 'zimmet' ? 'Toplu zimmet' : 'Toplu iade',
      channel === 'sms' ? `SMS ile ${TEST_PHONE.slice(-4).padStart(TEST_PHONE.length, '*')} numarasına` : REQUESTER_EMAIL
    );
  }
  const verified = await callAction('verifyOTP', {
    personId: person.PersonId,
    challengeId: challenge.challengeId,
    otpCode: code,
    otpAction: action,
    hardwareIds: serials
  });
  assert(/^DIJIT-ONAY-/i.test(String(verified.hash || '')), 'OTP onay anahtarı oluşmadı.');
  return verified.hash;
}

async function waitForQueue(queueId) {
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await query(
      `
        SELECT PublicId, ActionType, Status, AttemptCount, CreatedAt, StartedAt, FinishedAt,
               ErrorMessage, ResultJson
        FROM dbo.OperationQueue
        WHERE PublicId = @queueId
      `,
      { queueId: { type: sql.NVarChar(80), value: queueId } }
    );
    const row = result.recordset[0];
    assert(row, `Kuyruk kaydı bulunamadı: ${queueId}`);
    if (row.Status === 'TAMAMLANDI') return row;
    if (row.Status === 'HATA') throw new Error(`${row.ActionType} kuyruğu hata verdi: ${row.ErrorMessage || 'Bilinmeyen hata'}`);

    await processPdfQueue({ maxJobs: Math.max(1, config.queue.maxJobsPerRun) });
    await sleep(POLL_MS);
  }
  throw new Error(`Kuyruk zaman aşımı: ${queueId}`);
}

function queueReport(row) {
  const result = row.ResultJson ? JSON.parse(row.ResultJson) : {};
  const start = row.StartedAt ? new Date(row.StartedAt).getTime() : NaN;
  const finish = row.FinishedAt ? new Date(row.FinishedAt).getTime() : NaN;
  return {
    queueId: row.PublicId,
    actionType: row.ActionType,
    status: row.Status,
    attempts: Number(row.AttemptCount || 0),
    durationSeconds: Number.isFinite(start) && Number.isFinite(finish) ? Number(((finish - start) / 1000).toFixed(2)) : null,
    delivery: result.delivery || '',
    driveUrl: result.url || ''
  };
}

async function runDocumentAction(action, otpHash) {
  const isReturn = action === 'returnZimmetServerSide';
  const result = await callAction(action, {
    personId: person.PersonId,
    hardwareIds: hardware.map((item) => item.SerialNo),
    hardwareList: [],
    personOtpHash: otpHash,
    itStatement: SIGNATURE,
    personStatement: SIGNATURE,
    itName: 'Cömert YANAR',
    itEmail: REQUESTER_EMAIL,
    pdfName: `${PREFIX}-${isReturn ? 'toplu-iade' : 'toplu-zimmet'}.pdf`,
    zimmetExplanation: `${PREFIX} kontrollü toplu iş akışı testidir.`,
    returnCondition: 'eksiksiz',
    returnExplanation: ''
  });
  assert(result.queued === true && result.queueId, `${action} PDF kuyruğuna alınmadı.`);
  queueIds.push(result.queueId);
  return waitForQueue(result.queueId);
}

async function waitForOtpCooldown() {
  const waitMs = 61_000;
  console.log(`\nİade OTP testi için ${Math.ceil(waitMs / 1000)} saniyelik yeniden gönderim süresi bekleniyor...`);
  await sleep(waitMs);
}

function cleanupWithWindowsAuth() {
  if (cleanupStarted) return;
  cleanupStarted = true;
  if (!person?.PersonId && hardware.length === 0) return;

  assert(/^[A-Z0-9-]+$/.test(PREFIX), 'Test öneki güvenli değil; otomatik temizlik durduruldu.');
  const restorePhoneSql = phoneMayHaveChanged
    ? `UPDATE dbo.Personnel SET Phone = ${originalPhone === null ? 'NULL' : sqlLiteral(originalPhone)}, UpdatedAt = SYSUTCDATETIME()\n` +
      `WHERE PersonId = ${sqlLiteral(person.PersonId)};`
    : '';
  const cleanupSql = `
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
DELETE hh
FROM dbo.HardwareHistory hh
INNER JOIN dbo.Hardware h ON h.HardwareId = hh.HardwareId
WHERE h.SerialNo LIKE ${sqlLiteral(`${PREFIX}%`)};
DELETE FROM dbo.Hardware WHERE SerialNo LIKE ${sqlLiteral(`${PREFIX}%`)};
${restorePhoneSql}
COMMIT TRANSACTION;
`;
  const result = spawnSync(
    SQLCMD,
    ['-S', process.env.SQL_SERVER_ADMIN || 'localhost\\SQLEXPRESS', '-d', process.env.SQL_DATABASE || 'IstekZimmet', '-E', '-b', '-Q', cleanupSql],
    { encoding: 'utf8', windowsHide: true }
  );
  if (result.status !== 0) {
    throw new Error(`Test kayıtları otomatik temizlenemedi: ${String(result.stderr || result.stdout || '').trim()}`);
  }
}

async function ensureTestQueuesSettledForCleanup() {
  if (queueIds.length === 0) return;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await query(
      `
        SELECT COUNT(*) AS ActiveCount
        FROM dbo.OperationQueue
        WHERE PublicId IN (${queueIds.map((_, index) => `@queue${index}`).join(', ')})
          AND Status IN (N'BEKLIYOR', N'ISLENIYOR')
      `,
      Object.fromEntries(
        queueIds.map((queueId, index) => [`queue${index}`, { type: sql.NVarChar(80), value: queueId }])
      )
    );
    if (Number(result.recordset[0]?.ActiveCount || 0) === 0) return;
    await processPdfQueue({ maxJobs: Math.max(1, config.queue.maxJobsPerRun) });
    await sleep(POLL_MS);
  }
  throw new Error('Test PDF kuyruğu hâlâ çalıştığı için sentetik cihaz temizliği güvenli biçimde ertelendi.');
}

try {
  await ensureReady();
  sessionToken = await createSession(REQUESTER_EMAIL);
  await createTestHardware();
  let zimmetQueue = null;
  if (TEST_PHASE === 'full') {
    await runBulkDatabaseActions();
    console.log(JSON.stringify({ stage: 'bulk-actions-passed', testPrefix: PREFIX, devices: DEVICE_COUNT }, null, 2));

    const zimmetOtpHash = await getOtpApproval('zimmet', 'sms');
    zimmetQueue = await runDocumentAction('saveZimmetServerSide', zimmetOtpHash);
    await validateAllHardware({
      status: 'AKTIF',
      assignedPersonId: person.PersonId,
      groupName: `${PREFIX} GRUBU`,
      requireDriveLink: true
    });
    await waitForOtpCooldown();
  } else {
    await prepareReturnOnlyState();
    console.log(JSON.stringify({ stage: 'return-only-ready', testPrefix: PREFIX, devices: DEVICE_COUNT }, null, 2));
  }

  const returnOtpHash = await getOtpApproval('return', 'email');
  const returnQueue = await runDocumentAction('returnZimmetServerSide', returnOtpHash);
  await validateAllHardware({
    status: 'DEPODA',
    assignedPersonId: null,
    groupName: `${PREFIX} GRUBU`,
    requireDriveLink: true
  });

  const history = await query(
    `
      SELECT EventType, COUNT(*) AS EventCount
      FROM dbo.HardwareHistory hh
      INNER JOIN dbo.Hardware h ON h.HardwareId = hh.HardwareId
      WHERE h.SerialNo LIKE @prefix
      GROUP BY EventType
      ORDER BY EventType
    `,
    { prefix: { type: sql.NVarChar(180), value: `${PREFIX}%` } }
  );

  completed = true;
  console.log(
    JSON.stringify(
      {
        success: true,
        testPrefix: PREFIX,
        devices: DEVICE_COUNT,
        notifyEmail: REQUESTER_EMAIL,
        notifyPhoneLast4: TEST_PHONE.slice(-4),
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        phase: TEST_PHASE,
        zimmet: zimmetQueue ? queueReport(zimmetQueue) : null,
        return: queueReport(returnQueue),
        history: history.recordset
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        success: false,
        testPrefix: PREFIX,
        devicesCreated: hardware.length,
        queues: queueIds,
        error: String(error?.message || error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await fs.rm(OTP_FILE, { force: true }).catch(() => {});
  try {
    if (sessionToken) await revokeSession(sessionToken);
  } catch (error) {
    console.error(`Test oturumu temizlenemedi: ${error.message}`);
    process.exitCode = 1;
  }
  try {
    await ensureTestQueuesSettledForCleanup();
    cleanupWithWindowsAuth();
    if (hardware.length > 0) console.log(`${hardware.length} sentetik cihaz ve geçmişleri temizlendi.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  await closePdfRenderer().catch(() => {});
  await closePool();
  if (!completed && hardware.length > 0) console.log('Test tamamlanmadı; sentetik kayıt temizliği yine uygulandı.');
}
