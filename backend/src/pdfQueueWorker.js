import crypto from 'node:crypto';
import { sql, query } from './db.js';
import { config } from './config.js';
import { buildTransferDocumentHtml, buildZimmetDocumentHtml } from './pdfTemplates.js';
import { renderHtmlToPdfBuffer } from './pdfRenderer.js';
import { uploadPdfThroughGoogleBridge } from './googleBridge.js';
import { buildSafeOperationPayload } from './queuePayloadSanitizer.js';

const PDF_ACTIONS = new Set(['GENERATE_ZIMMET_PDF', 'GENERATE_RETURN_PDF', 'GENERATE_TRANSFER_PDF']);

function affectedRows(result) {
  return Number(result?.rowsAffected?.[0] || 0);
}

function parseJson(value, fallback = {}) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function refreshPayloadHardwareFromDb(payload) {
  const hardware = Array.isArray(payload.hardware) ? payload.hardware : [];
  const ids = hardware.map((item) => Number(item?.hardwareId)).filter(Number.isFinite);
  if (!ids.length) return payload;

  const result = await query(
    `
      SELECT
        HardwareId,
        SerialNo,
        DeviceType,
        Brand,
        Model,
        ComputerName
      FROM dbo.Hardware
      WHERE HardwareId IN (${ids.map((_, index) => `@id${index}`).join(',')})
    `,
    Object.fromEntries(ids.map((id, index) => [`id${index}`, { type: sql.Int, value: id }]))
  );

  const byId = new Map(result.recordset.map((row) => [row.HardwareId, row]));
  payload.hardware = hardware.map((item) => {
    const row = byId.get(Number(item?.hardwareId));
    if (!row) return item;
    return {
      ...item,
      serial: row.SerialNo || item.serial || '',
      type: row.DeviceType || item.type || 'Cihaz',
      brand: row.Brand || item.brand || '',
      model: row.Model || item.model || '',
      computerName: row.ComputerName || item.computerName || ''
    };
  });

  return payload;
}

async function claimPdfJobs(maxJobs, leaseToken, { includeFailed = false } = {}) {
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
          AND ActionType IN (N'GENERATE_ZIMMET_PDF', N'GENERATE_RETURN_PDF', N'GENERATE_TRANSFER_PDF')
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
      OUTPUT
        INSERTED.QueueId,
        INSERTED.PublicId,
        INSERTED.ActionType,
        INSERTED.PayloadJson,
        INSERTED.AttemptCount
      FROM dbo.OperationQueue q
      INNER JOIN NextJobs n ON n.QueueId = q.QueueId;
    `,
    {
      maxJobs: { type: sql.Int, value: Math.max(1, Math.min(Number(maxJobs || 1), 20)) },
      includeFailed: { type: sql.Bit, value: includeFailed ? 1 : 0 },
      maxAttempts: { type: sql.Int, value: Math.max(1, Number(config.queue.maxAttempts || 5)) },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      leaseSeconds: { type: sql.Int, value: Math.max(60, Number(config.queue.leaseSeconds || 1800)) }
    }
  );

  return result.recordset || [];
}

async function renewPdfLease(queueId, leaseToken) {
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
  if (affectedRows(result) !== 1) throw new Error('PDF işinin lease süresi kaybedildi.');
}

async function markJobDone(queueId, leaseToken, resultPayload, safePayload) {
  const result = await query(
    `
      UPDATE dbo.OperationQueue
      SET Status = N'TAMAMLANDI',
          PayloadJson = @safePayloadJson,
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
      safePayloadJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(safePayload) },
      resultJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(resultPayload) }
    }
  );
  if (affectedRows(result) !== 1) throw new Error('PDF işi tamamlanırken lease sahipliği kaybedildi.');
}

async function markJobFailed(job, leaseToken, error) {
  const maxAttempts = Math.max(1, Number(config.queue.maxAttempts || 5));
  const isTerminalFailure = Number(job.AttemptCount || 0) >= maxAttempts;
  const safePayload = buildSafeOperationPayload(job.ActionType, parseJson(job.PayloadJson));
  const result = await query(
    `
      UPDATE dbo.OperationQueue
      SET Status = N'HATA',
          PayloadJson = CASE WHEN @isTerminalFailure = 1 THEN @safePayloadJson ELSE PayloadJson END,
          ErrorMessage = @errorMessage,
          FinishedAt = SYSUTCDATETIME(),
          LeaseToken = NULL,
          LeaseExpiresAt = NULL
      WHERE QueueId = @queueId
        AND Status = N'ISLENIYOR'
        AND LeaseToken = @leaseToken
    `,
    {
      queueId: { type: sql.BigInt, value: job.QueueId },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      isTerminalFailure: { type: sql.Bit, value: isTerminalFailure ? 1 : 0 },
      safePayloadJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(safePayload) },
      errorMessage: { type: sql.NVarChar(sql.MAX), value: String(error?.message || error || 'PDF kuyruğu hatası').slice(0, 4000) }
    }
  );
  return affectedRows(result) === 1;
}

function historyEventTypeForPdf(actionType) {
  if (actionType === 'GENERATE_ZIMMET_PDF') return 'Zimmet PDF Belgesi Oluşturuldu';
  if (actionType === 'GENERATE_RETURN_PDF') return 'İade PDF Belgesi Oluşturuldu';
  if (actionType === 'GENERATE_TRANSFER_PDF') return 'Transfer PDF Belgesi Oluşturuldu';
  return 'PDF Belgesi Oluşturuldu';
}

async function attachPdfToHardware(payload, uploadResult, job) {
  const hardware = Array.isArray(payload.hardware) ? payload.hardware : [];
  const eventType = historyEventTypeForPdf(job.ActionType);
  for (const item of hardware) {
    if (!item?.hardwareId) continue;

    await query(
      `
        UPDATE dbo.Hardware
        SET DriveLink = @driveLink,
            UpdatedAt = SYSUTCDATETIME()
        WHERE HardwareId = @hardwareId
      `,
      {
        driveLink: { type: sql.NVarChar(1000), value: uploadResult.url || null },
        hardwareId: { type: sql.Int, value: item.hardwareId }
      }
    );

    await query(
      `
        UPDATE dbo.HardwareHistory
        SET EventType = @eventType,
            PersonId = COALESCE(@personId, PersonId),
            PersonName = COALESCE(@personName, PersonName),
            DriveLink = @driveLink,
            DetailsJson = @detailsJson,
            CreatedBy = COALESCE(@createdBy, CreatedBy)
        WHERE HistoryId = (
          SELECT TOP (1) HistoryId
          FROM dbo.HardwareHistory
          WHERE HardwareId = @hardwareId
            AND CASE WHEN ISJSON(DetailsJson) = 1 THEN JSON_VALUE(DetailsJson, '$.queueId') ELSE NULL END = @queuePublicId
          ORDER BY EventDate DESC, HistoryId DESC
        )

        IF @@ROWCOUNT = 0
        BEGIN
          INSERT INTO dbo.HardwareHistory (HardwareId, EventType, PersonId, PersonName, DriveLink, DetailsJson, CreatedBy)
          VALUES (@hardwareId, @eventType, @personId, @personName, @driveLink, @detailsJson, @createdBy)
        END
      `,
      {
        hardwareId: { type: sql.Int, value: item.hardwareId },
        queuePublicId: { type: sql.NVarChar(80), value: job.PublicId },
        eventType: { type: sql.NVarChar(120), value: eventType },
        personId: { type: sql.NVarChar(160), value: payload.person?.id || null },
        personName: { type: sql.NVarChar(240), value: payload.person?.name || null },
        driveLink: { type: sql.NVarChar(1000), value: uploadResult.url || null },
        detailsJson: {
          type: sql.NVarChar(sql.MAX),
          value: JSON.stringify({
            queueId: job.PublicId,
            actionType: job.ActionType,
            documentStatus: 'PDF hazırlandı',
            pdfHash: uploadResult.pdfHash,
            delivery: uploadResult.delivery,
            url: uploadResult.url || '',
            pdfName: payload.pdfName || ''
          })
        },
        createdBy: { type: sql.NVarChar(320), value: payload.requestedBy || null }
      }
    );
  }
}

async function processOnePdfJob(job, leaseToken) {
  await renewPdfLease(job.QueueId, leaseToken);
  const payload = parseJson(job.PayloadJson);
  if (!PDF_ACTIONS.has(job.ActionType)) {
    throw new Error(`Desteklenmeyen PDF işi: ${job.ActionType}`);
  }

  payload.queueId = job.PublicId;
  await refreshPayloadHardwareFromDb(payload);
  await renewPdfLease(job.QueueId, leaseToken);
  const html = job.ActionType === 'GENERATE_TRANSFER_PDF'
    ? buildTransferDocumentHtml(payload)
    : buildZimmetDocumentHtml(payload);
  const pdfBuffer = await renderHtmlToPdfBuffer(html, payload.pdfName);
  await renewPdfLease(job.QueueId, leaseToken);
  const uploadResult = await uploadPdfThroughGoogleBridge({
    pdfBuffer,
    pdfName: payload.pdfName,
    campus: payload.campus,
    email: payload.email,
    meta: {
      queueId: job.PublicId,
      actionType: job.ActionType,
      requestedBy: payload.requestedBy
    }
  });

  await renewPdfLease(job.QueueId, leaseToken);
  await attachPdfToHardware(payload, uploadResult, job);

  return {
    result: {
      queueId: job.PublicId,
      actionType: job.ActionType,
      url: uploadResult.url || '',
      pdfHash: uploadResult.pdfHash || '',
      delivery: uploadResult.delivery || '',
      hardwareCount: Array.isArray(payload.hardware) ? payload.hardware.length : 0
    },
    safePayload: buildSafeOperationPayload(job.ActionType, payload)
  };
}

export async function processPdfQueue({ maxJobs = config.queue.maxJobsPerRun, logger, includeFailed = false } = {}) {
  const leaseToken = crypto.randomUUID();
  const jobs = await claimPdfJobs(maxJobs, leaseToken, { includeFailed });
  const results = new Array(jobs.length);
  let nextJobIndex = 0;

  const processNext = async () => {
    while (nextJobIndex < jobs.length) {
      const index = nextJobIndex;
      nextJobIndex += 1;
      const job = jobs[index];

      try {
        const { result, safePayload } = await processOnePdfJob(job, leaseToken);
        await markJobDone(job.QueueId, leaseToken, result, safePayload);
        results[index] = { queueId: job.PublicId, status: 'TAMAMLANDI', result };
        logger?.info?.({ queueId: job.PublicId, actionType: job.ActionType }, 'PDF kuyruğu tamamlandı');
      } catch (error) {
        await markJobFailed(job, leaseToken, error);
        results[index] = { queueId: job.PublicId, status: 'HATA', error: error.message };
        logger?.error?.({ err: error, queueId: job.PublicId, actionType: job.ActionType }, 'PDF kuyruğu hata verdi');
      }
    }
  };

  const concurrency = Math.min(jobs.length, config.queue.workerConcurrency);
  await Promise.all(Array.from({ length: concurrency }, processNext));

  return {
    processed: results.length,
    results
  };
}

export function startPdfQueueWorker(logger) {
  if (!config.queue.workerEnabled) return null;

  let runningPromise = null;
  const tick = () => {
    if (runningPromise) return runningPromise;
    runningPromise = processPdfQueue({ maxJobs: config.queue.maxJobsPerRun, logger })
      .catch((error) => {
        logger?.error?.({ err: error }, 'PDF kuyruk işçisi genel hata aldı');
      })
      .finally(() => {
        runningPromise = null;
      });
    return runningPromise;
  };

  const intervalMs = Math.max(5000, Number(config.queue.workerIntervalMs || 30000));
  const interval = setInterval(tick, intervalMs);
  interval.unref?.();
  tick();

  logger?.info?.(
    {
      intervalMs,
      maxJobsPerRun: config.queue.maxJobsPerRun,
      concurrency: config.queue.workerConcurrency,
      maxConcurrentPages: config.chrome.maxConcurrentPages
    },
    'PDF kuyruk işçisi başlatıldı'
  );
  return {
    async stop() {
      clearInterval(interval);
      if (runningPromise) await runningPromise;
    }
  };
}
