import { config } from './config.js';
import { processGoogleSheetExportQueue } from './repositories/inventoryRepository.js';

export function startGoogleSheetQueueWorker(logger) {
  if (!config.queue.workerEnabled) return null;

  let runningPromise = null;
  const tick = () => {
    if (runningPromise) return runningPromise;
    runningPromise = processGoogleSheetExportQueue({ maxJobs: 1, logger })
      .catch((error) => {
        logger?.error?.({ err: error }, 'Google Sheet dışa aktarım işçisi genel hata aldı');
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

  logger?.info?.({ intervalMs, maxJobsPerRun: 1 }, 'Google Sheet dışa aktarım işçisi başlatıldı');
  return {
    async stop() {
      clearInterval(interval);
      if (runningPromise) await runningPromise;
    }
  };
}
