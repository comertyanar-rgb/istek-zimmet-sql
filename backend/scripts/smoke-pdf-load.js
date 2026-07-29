import crypto from 'node:crypto';
import { config } from '../src/config.js';
import { closePool, query, sql } from '../src/db.js';

const JOB_COUNT = Math.min(Math.max(Number(process.env.PDF_LOAD_TEST_JOBS || 5), 2), 10);
const NOTIFY_EMAIL = String(process.env.TEST_NOTIFY_EMAIL || '').trim().toLowerCase();
const CONFIRMATION = String(process.env.PDF_LOAD_TEST_CONFIRM || '').trim();
const API_URL = String(process.env.API_BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const TIMEOUT_MS = Math.max(Number(process.env.PDF_LOAD_TEST_TIMEOUT_MS || 240000), 60000);
const POLL_MS = 2000;
const TEST_PREFIX = `PDF-LOAD-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureReady() {
  assert(CONFIRMATION === 'YES', 'Dış e-posta yük testi için PDF_LOAD_TEST_CONFIRM=YES gereklidir.');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(NOTIFY_EMAIL), 'TEST_NOTIFY_EMAIL geçerli bir e-posta olmalıdır.');
  assert(config.googleBridge?.url && config.googleBridge?.secret, 'Google Bridge ayarları eksik.');

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
  assert(Number(active.recordset[0]?.ActiveCount || 0) === 0, 'Kuyrukta mevcut PDF işi var; yük testi başlatılmadı.');
}

function makePayload(index) {
  const number = index + 1;
  const isTransfer = number === JOB_COUNT;
  const isReturn = !isTransfer && number % 2 === 0;
  const documentType = isTransfer ? 'transfer' : isReturn ? 'return' : 'zimmet';
  const actionType = isTransfer
    ? 'GENERATE_TRANSFER_PDF'
    : isReturn
      ? 'GENERATE_RETURN_PDF'
      : 'GENERATE_ZIMMET_PDF';
  const pdfName = `${TEST_PREFIX}-${String(number).padStart(2, '0')}-${documentType}.pdf`;
  const hardware = Array.from({ length: 3 }, (_, hardwareIndex) => ({
    serial: `${TEST_PREFIX}-${String(number).padStart(2, '0')}-${hardwareIndex + 1}`,
    type: hardwareIndex === 0 ? 'Laptop' : hardwareIndex === 1 ? 'Masaüstü' : 'Monitör',
    brand: 'CODEX TEST',
    model: `Paralel PDF ${number}.${hardwareIndex + 1}`,
    computerName: `CODEXLOAD${number}${hardwareIndex + 1}`,
    campus: 'Genel Müdürlük'
  }));
  const common = {
    documentType,
    pdfName,
    campus: 'Genel Müdürlük',
    requestedBy: NOTIFY_EMAIL,
    itName: 'Cömert YANAR',
    itEmail: NOTIFY_EMAIL,
    clientIp: 'PDF YÜK TESTİ',
    userAgent: 'Codex controlled PDF load test',
    hardware,
    email: {
      to: NOTIFY_EMAIL,
      replyTo: NOTIFY_EMAIL,
      subject: `[YÜK TESTİ ${number}/${JOB_COUNT}] ${isTransfer ? 'Transfer' : isReturn ? 'İade' : 'Zimmet'} PDF`,
      body: `Bu ileti İSTEK Zimmet paralel PDF kuyruk yük testinin ${number}/${JOB_COUNT} numaralı kontrollü testidir.`
    }
  };

  if (isTransfer) {
    return {
      actionType,
      payload: {
        ...common,
        transferDirection: 'out',
        senderCampus: 'Genel Müdürlük',
        receiverCampus: 'Acıbadem',
        receiverItName: 'Test Alıcısı',
        signatures: { transfer: SIGNATURE }
      }
    };
  }

  return {
    actionType,
    payload: {
      ...common,
      person: {
        id: `${TEST_PREFIX}-PERSON-${number}`,
        name: `Codex Yük Testi ${number}`,
        email: NOTIFY_EMAIL,
        department: 'Kontrollü Sistem Testi',
        campus: 'Genel Müdürlük'
      },
      signatures: {
        it: SIGNATURE,
        person: SIGNATURE,
        otpHash: `${TEST_PREFIX}-OTP-${number}`
      },
      accessories: [{ type: 'Aksesuar', brand: 'Test', model: 'Şarj Adaptörü', serial: '-' }],
      zimmetExplanation: 'Kontrollü paralel PDF kuyruk yük testidir.',
      returnCondition: 'eksiksiz',
      returnExplanation: ''
    }
  };
}

async function enqueueJobs() {
  const campus = await query(`SELECT TOP (1) CampusId FROM dbo.Campuses WHERE CoreName = N'genel müdürlük' AND IsActive = 1`);
  const campusId = campus.recordset[0]?.CampusId || null;
  const jobs = [];

  for (let index = 0; index < JOB_COUNT; index += 1) {
    const item = makePayload(index);
    const publicId = `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const inserted = await query(
      `
        INSERT INTO dbo.OperationQueue (
          PublicId, ActionType, Status, PayloadJson, RequestedBy, CampusId
        )
        OUTPUT INSERTED.QueueId, INSERTED.PublicId, INSERTED.CreatedAt
        VALUES (@publicId, @actionType, N'BEKLIYOR', @payloadJson, @requestedBy, @campusId)
      `,
      {
        publicId: { type: sql.NVarChar(80), value: publicId },
        actionType: { type: sql.NVarChar(120), value: item.actionType },
        payloadJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(item.payload) },
        requestedBy: { type: sql.NVarChar(320), value: NOTIFY_EMAIL },
        campusId: { type: sql.UniqueIdentifier, value: campusId }
      }
    );
    jobs.push(inserted.recordset[0]);
  }

  return jobs;
}

async function readJobs(publicIds) {
  const binds = Object.fromEntries(
    publicIds.map((id, index) => [`id${index}`, { type: sql.NVarChar(80), value: id }])
  );
  return (
    await query(
      `
        SELECT PublicId, ActionType, Status, AttemptCount, CreatedAt, StartedAt, FinishedAt,
               ErrorMessage, ResultJson
        FROM dbo.OperationQueue
        WHERE PublicId IN (${publicIds.map((_, index) => `@id${index}`).join(', ')})
        ORDER BY CreatedAt, QueueId
      `,
      binds
    )
  ).recordset;
}

function calculatePeakConcurrency(rows) {
  const points = [];
  for (const row of rows) {
    const started = new Date(row.StartedAt).getTime();
    const finished = new Date(row.FinishedAt).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(finished)) continue;
    points.push({ time: started, delta: 1 });
    points.push({ time: finished, delta: -1 });
  }
  points.sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const point of points) {
    active += point.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

let enqueued = [];
const testStartedAt = Date.now();

try {
  await ensureReady();
  enqueued = await enqueueJobs();
  const ids = enqueued.map((job) => job.PublicId);
  const deadline = Date.now() + TIMEOUT_MS;
  let rows = [];

  while (Date.now() < deadline) {
    rows = await readJobs(ids);
    if (rows.length === ids.length && rows.every((row) => ['TAMAMLANDI', 'HATA'].includes(row.Status))) break;
    await sleep(POLL_MS);
  }

  rows = await readJobs(ids);
  assert(rows.length === ids.length, 'Yük testi kuyruk kayıtlarının bir kısmı bulunamadı.');
  assert(rows.every((row) => ['TAMAMLANDI', 'HATA'].includes(row.Status)), 'PDF yük testi zaman aşımına uğradı.');

  const report = rows.map((row) => {
    const result = row.ResultJson ? JSON.parse(row.ResultJson) : {};
    const startedAt = row.StartedAt ? new Date(row.StartedAt) : null;
    const finishedAt = row.FinishedAt ? new Date(row.FinishedAt) : null;
    return {
      queueId: row.PublicId,
      actionType: row.ActionType,
      status: row.Status,
      attempts: row.AttemptCount,
      durationSeconds:
        startedAt && finishedAt ? Number(((finishedAt - startedAt) / 1000).toFixed(2)) : null,
      delivery: result.delivery || '',
      hasDriveUrl: Boolean(result.url),
      error: row.ErrorMessage || ''
    };
  });
  const successCount = report.filter((item) => item.status === 'TAMAMLANDI').length;

  console.log(
    JSON.stringify(
      {
        success: successCount === JOB_COUNT,
        testPrefix: TEST_PREFIX,
        jobs: JOB_COUNT,
        workerConcurrency: config.queue.workerConcurrency,
        maxJobsPerRun: config.queue.maxJobsPerRun,
        peakObservedConcurrency: calculatePeakConcurrency(rows),
        wallTimeSeconds: Number(((Date.now() - testStartedAt) / 1000).toFixed(2)),
        notifyEmail: NOTIFY_EMAIL,
        completed: successCount,
        failed: JOB_COUNT - successCount,
        report
      },
      null,
      2
    )
  );

  assert(successCount === JOB_COUNT, `${JOB_COUNT - successCount} PDF işi hata verdi.`);
} catch (error) {
  console.error(
    JSON.stringify(
      {
        success: false,
        testPrefix: TEST_PREFIX,
        enqueued: enqueued.map((job) => job.PublicId),
        error: String(error?.message || error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await closePool();
}
