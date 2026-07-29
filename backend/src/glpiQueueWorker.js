import { config } from './config.js';
import { processGlpiReconcileQueue } from './repositories/inventoryRepository.js';

export function startGlpiQueueWorker(logger) {
  if (!config.queue.workerEnabled) return null;

  let runningPromise = null;
  const tick = () => {
    if (runningPromise) return runningPromise;
    runningPromise = processGlpiReconcileQueue({ maxJobs: 1, logger })
      .catch((error) => {
        logger?.error?.({ err: error }, 'GLPI eşleştirme işçisi genel hata aldı');
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

  logger?.info?.({ intervalMs, maxJobsPerRun: 1 }, 'GLPI eşleştirme işçisi başlatıldı');
  return {
    async stop() {
      clearInterval(interval);
      if (runningPromise) await runningPromise;
    }
  };
}
