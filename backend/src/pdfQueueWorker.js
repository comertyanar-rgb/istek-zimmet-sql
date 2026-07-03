import { sql, query } from './db.js';
import { config } from './config.js';
import { buildTransferDocumentHtml, buildZimmetDocumentHtml } from './pdfTemplates.js';
import { renderHtmlToPdfBuffer } from './pdfRenderer.js';
import { uploadPdfThroughGoogleBridge } from './googleBridge.js';

const PDF_ACTIONS = new Set(['GENERATE_ZIMMET_PDF', 'GENERATE_RETURN_PDF', 'GENERATE_TRANSFER_PDF']);

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

async function claimPdfJobs(maxJobs, { includeFailed = false } = {}) {
  const result = await query(
    `
      ;WITH NextJobs AS (
        SELECT TOP (@maxJobs) QueueId
        FROM dbo.OperationQueue WITH (READPAST, UPDLOCK, ROWLOCK)
        WHERE (Status = N'BEKLIYOR' OR (@includeFailed = 1 AND Status = N'HATA'))
          AND ActionType IN (N'GENERATE_ZIMMET_PDF', N'GENERATE_RETURN_PDF', N'GENERATE_TRANSFER_PDF')
        ORDER BY CreatedAt
      )
      UPDATE q
      SET Status = N'ISLENIYOR',
          StartedAt = COALESCE(StartedAt, SYSUTCDATETIME()),
          FinishedAt = NULL,
          ErrorMessage = NULL,
          AttemptCount = AttemptCount + 1
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
      includeFailed: { type: sql.Bit, value: includeFailed ? 1 : 0 }
    }
  );

  return result.recordset || [];
}

async function markJobDone(queueId, resultPayload) {
  await query(
    `
      UPDATE dbo.OperationQueue
      SET Status = N'TAMAMLANDI',
          ResultJson = @resultJson,
          ErrorMessage = NULL,
          FinishedAt = SYSUTCDATETIME()
      WHERE QueueId = @queueId
    `,
    {
      queueId: { type: sql.BigInt, value: queueId },
      resultJson: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(resultPayload) }
    }
  );
}

async function markJobFailed(queueId, error) {
  await query(
    `
      UPDATE dbo.OperationQueue
      SET Status = N'HATA',
          ErrorMessage = @errorMessage,
          FinishedAt = SYSUTCDATETIME()
      WHERE QueueId = @queueId
    `,
    {
      queueId: { type: sql.BigInt, value: queueId },
      errorMessage: { type: sql.NVarChar(sql.MAX), value: String(error?.message || error || 'PDF kuyruğu hatası').slice(0, 4000) }
    }
  );
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
        INSERT INTO dbo.HardwareHistory (HardwareId, EventType, PersonId, PersonName, DriveLink, DetailsJson, CreatedBy)
        VALUES (@hardwareId, @eventType, @personId, @personName, @driveLink, @detailsJson, @createdBy)
      `,
      {
        hardwareId: { type: sql.Int, value: item.hardwareId },
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
            url: uploadResult.url || ''
          })
        },
        createdBy: { type: sql.NVarChar(320), value: payload.requestedBy || null }
      }
    );
  }
}

async function processOnePdfJob(job) {
  const payload = parseJson(job.PayloadJson);
  if (!PDF_ACTIONS.has(job.ActionType)) {
    throw new Error(`Desteklenmeyen PDF işi: ${job.ActionType}`);
  }

  payload.queueId = job.PublicId;
  await refreshPayloadHardwareFromDb(payload);
  const html = job.ActionType === 'GENERATE_TRANSFER_PDF'
    ? buildTransferDocumentHtml(payload)
    : buildZimmetDocumentHtml(payload);
  const pdfBuffer = await renderHtmlToPdfBuffer(html, payload.pdfName);
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

  await attachPdfToHardware(payload, uploadResult, job);

  return {
    queueId: job.PublicId,
    actionType: job.ActionType,
    url: uploadResult.url || '',
    pdfHash: uploadResult.pdfHash || '',
    delivery: uploadResult.delivery || '',
    hardwareCount: Array.isArray(payload.hardware) ? payload.hardware.length : 0
  };
}

export async function processPdfQueue({ maxJobs = config.queue.maxJobsPerRun, logger, includeFailed = false } = {}) {
  const jobs = await claimPdfJobs(maxJobs, { includeFailed });
  const results = [];

  for (const job of jobs) {
    try {
      const result = await processOnePdfJob(job);
      await markJobDone(job.QueueId, result);
      results.push({ queueId: job.PublicId, status: 'TAMAMLANDI', result });
      logger?.info?.({ queueId: job.PublicId, actionType: job.ActionType }, 'PDF kuyruğu tamamlandı');
    } catch (error) {
      await markJobFailed(job.QueueId, error);
      results.push({ queueId: job.PublicId, status: 'HATA', error: error.message });
      logger?.error?.({ err: error, queueId: job.PublicId, actionType: job.ActionType }, 'PDF kuyruğu hata verdi');
    }
  }

  return {
    processed: results.length,
    results
  };
}

export function startPdfQueueWorker(logger) {
  if (!config.queue.workerEnabled) return null;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processPdfQueue({ maxJobs: config.queue.maxJobsPerRun, logger });
    } catch (error) {
      logger?.error?.({ err: error }, 'PDF kuyruk işçisi genel hata aldı');
    } finally {
      running = false;
    }
  };

  const intervalMs = Math.max(5000, Number(config.queue.workerIntervalMs || 30000));
  const interval = setInterval(tick, intervalMs);
  interval.unref?.();
  tick();

  logger?.info?.({ intervalMs, maxJobsPerRun: config.queue.maxJobsPerRun }, 'PDF kuyruk işçisi başlatıldı');
  return interval;
}
