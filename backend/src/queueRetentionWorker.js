import { config } from './config.js';
import { query, sql } from './db.js';

async function hasRetentionProcedure() {
  const result = await query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.PruneZimmetTransientData', N'P') IS NULL THEN 0 ELSE 1 END AS Installed
  `);
  return Boolean(result.recordset[0]?.Installed);
}

export async function pruneTransientQueueData() {
  if (!(await hasRetentionProcedure())) {
    return { installed: false, deleted: 0 };
  }

  const result = await query(
    `
      EXEC dbo.PruneZimmetTransientData
        @OperationRetentionDays = @operationRetentionDays,
        @AdRetentionDays = @adRetentionDays,
        @SignatureRetentionDays = @signatureRetentionDays,
        @BatchSize = @batchSize
    `,
    {
      operationRetentionDays: {
        type: sql.Int,
        value: config.queue.cleanup.operationRetentionDays,
      },
      adRetentionDays: {
        type: sql.Int,
        value: config.queue.cleanup.adRetentionDays,
      },
      signatureRetentionDays: {
        type: sql.Int,
        value: config.queue.cleanup.signatureRetentionDays,
      },
      batchSize: { type: sql.Int, value: config.queue.cleanup.batchSize },
    }
  );

  const row = result.recordset[0] || {};
  const counts = {
    operationDeleted: Number(row.OperationDeleted || 0),
    adPasswordDeleted: Number(row.AdPasswordDeleted || 0),
    signatureDeleted: Number(row.SignatureDeleted || 0),
    sessionDeleted: Number(row.SessionDeleted || 0),
    nonceDeleted: Number(row.NonceDeleted || 0),
  };

  return {
    installed: true,
    ...counts,
    deleted: Object.values(counts).reduce((sum, value) => sum + value, 0),
    cleanedAt: row.CleanedAt || new Date(),
  };
}

export function startQueueRetentionWorker(logger) {
  if (!config.queue.cleanup.enabled) return null;

  let stopped = false;
  let runningPromise = null;
  let migrationWarningLogged = false;

  const tick = () => {
    if (stopped || runningPromise) return runningPromise;

    runningPromise = pruneTransientQueueData()
      .then((result) => {
        if (!result.installed) {
          if (!migrationWarningLogged) {
            logger?.warn?.(
              'Kuyruk saklama temizliği etkin ancak 012_queue_retention.sql uygulanmamış'
            );
            migrationWarningLogged = true;
          }
          return;
        }

        migrationWarningLogged = false;
        if (result.deleted > 0) {
          logger?.info?.({ cleanup: result }, 'Geçici kuyruk kayıtları temizlendi');
        } else {
          logger?.debug?.('Geçici kuyruk temizliğinde silinecek kayıt bulunamadı');
        }
      })
      .catch((error) => {
        logger?.error?.({ err: error }, 'Geçici kuyruk temizliği hata verdi');
      })
      .finally(() => {
        runningPromise = null;
      });

    return runningPromise;
  };

  const firstRunDelayMs = Math.min(60_000, config.queue.cleanup.intervalMs);
  const firstRunTimer = setTimeout(tick, firstRunDelayMs);
  firstRunTimer.unref?.();

  const interval = setInterval(tick, config.queue.cleanup.intervalMs);
  interval.unref?.();

  logger?.info?.(
    {
      intervalMs: config.queue.cleanup.intervalMs,
      operationRetentionDays: config.queue.cleanup.operationRetentionDays,
      adRetentionDays: config.queue.cleanup.adRetentionDays,
      signatureRetentionDays: config.queue.cleanup.signatureRetentionDays,
      batchSize: config.queue.cleanup.batchSize,
    },
    'Geçici kuyruk saklama işçisi başlatıldı'
  );

  return {
    async stop() {
      stopped = true;
      clearTimeout(firstRunTimer);
      clearInterval(interval);
      if (runningPromise) await runningPromise;
    },
  };
}
