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
        INSERTED.ResultJson,
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

function deliveryCheckpointFromResult(resultJson) {
  const checkpoint = parseJson(resultJson, null);
  if (!checkpoint || checkpoint.stage !== 'DELIVERED' || !checkpoint.url) return null;
  return {
    url: String(checkpoint.url),
    pdfHash: String(checkpoint.pdfHash || ''),
    delivery: String(checkpoint.delivery || 'google'),
    response: { reused: true, checkpoint: true }
  };
}

async function persistDeliveryCheckpoint(queueId, leaseToken, uploadResult) {
  const checkpoint = {
    stage: 'DELIVERED',
    url: uploadResult.url || '',
    pdfHash: uploadResult.pdfHash || '',
    delivery: uploadResult.delivery || '',
    deliveredAt: new Date().toISOString()
  };
  const result = await query(
    `
      UPDATE dbo.OperationQueue
      SET ResultJson = @resultJson,
          LeaseExpiresAt = DATEADD(SECOND, @leaseSeconds, SYSUTCDATETIME())
      WHERE QueueId = @queueId
        AND Status = N'ISLENIYOR'
        AND LeaseToken = @leaseToken
    `,
    {
      queueId: { type: sql.BigInt, value: queueId },
      leaseToken: { type: sql.UniqueIdentifier, value: leaseToken },
      resultJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(checkpoint) },
      leaseSeconds: { type: sql.Int, value: Math.max(60, Number(config.queue.leaseSeconds || 1800)) }
    }
  );
  if (affectedRows(result) !== 1) throw new Error('PDF teslim sonucu saklanırken lease sahipliği kaybedildi.');
}

async function recoverDeliveryFromHardware(payload, job) {
  const hardware = Array.isArray(payload.hardware) ? payload.hardware : [];
  const ids = [...new Set(
    hardware
      .map((item) => Number(item?.hardwareId))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
  if (!ids.length) return null;

  const result = await query(
    `
      SELECT
        hardware.HardwareId,
        hardware.DriveLink,
        CASE WHEN EXISTS (
          SELECT 1
          FROM dbo.HardwareHistory history
          WHERE history.HardwareId = hardware.HardwareId
            AND CASE
                  WHEN ISJSON(history.DetailsJson) = 1
                    THEN JSON_VALUE(history.DetailsJson, '$.queueId')
                  ELSE NULL
                END = @queuePublicId
        ) THEN 1 ELSE 0 END AS HasQueueHistory
      FROM dbo.Hardware hardware
      WHERE hardware.HardwareId IN (${ids.map((_, index) => `@id${index}`).join(',')})
    `,
    {
      queuePublicId: { type: sql.NVarChar(80), value: job.PublicId },
      ...Object.fromEntries(ids.map((id, index) => [`id${index}`, { type: sql.Int, value: id }]))
    }
  );

  const rows = result.recordset || [];
  if (rows.length !== ids.length || rows.some((row) => !row.HasQueueHistory)) return null;
  const links = [...new Set(rows.map((row) => String(row.DriveLink || '').trim()).filter(Boolean))];
  if (links.length !== 1) return null;

  return {
    url: links[0],
    pdfHash: '',
    delivery: 'recovered-existing-upload',
    response: { reused: true, recovered: true }
  };
}

async function attachPdfToHardware(uploadResult, job) {
  await query(
    `
      EXEC dbo.FinalizeHardwarePdfHistory
        @QueuePublicId = @queuePublicId,
        @DriveLink = @driveLink,
        @PdfHash = @pdfHash,
        @Delivery = @delivery
    `,
    {
      queuePublicId: { type: sql.NVarChar(80), value: job.PublicId },
      driveLink: { type: sql.NVarChar(1000), value: uploadResult.url || null },
      pdfHash: { type: sql.NVarChar(128), value: uploadResult.pdfHash || null },
      delivery: { type: sql.NVarChar(40), value: uploadResult.delivery || null }
    }
  );
}

async function processOnePdfJob(job, leaseToken) {
  await renewPdfLease(job.QueueId, leaseToken);
  const payload = parseJson(job.PayloadJson);
  if (!PDF_ACTIONS.has(job.ActionType)) {
    throw new Error(`Desteklenmeyen PDF işi: ${job.ActionType}`);
  }

  payload.queueId = job.PublicId;
  await refreshPayloadHardwareFromDb(payload);
  let uploadResult = deliveryCheckpointFromResult(job.ResultJson);
  if (!uploadResult) {
    uploadResult = await recoverDeliveryFromHardware(payload, job);
  }
  if (!uploadResult) {
    await renewPdfLease(job.QueueId, leaseToken);
    const html = job.ActionType === 'GENERATE_TRANSFER_PDF'
      ? buildTransferDocumentHtml(payload)
      : buildZimmetDocumentHtml(payload);
    const pdfBuffer = await renderHtmlToPdfBuffer(html, payload.pdfName);
    await renewPdfLease(job.QueueId, leaseToken);
    uploadResult = await uploadPdfThroughGoogleBridge({
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
  }

  await persistDeliveryCheckpoint(job.QueueId, leaseToken, uploadResult);

  await renewPdfLease(job.QueueId, leaseToken);
  await attachPdfToHardware(uploadResult, job);

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
