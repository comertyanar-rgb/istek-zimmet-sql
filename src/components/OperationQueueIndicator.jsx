import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { postApiAction } from '../services/apiClient.js';
import { toSafeExternalUrl } from '../utils/safeUrls.js';

const ACTIVE_STATUSES = new Set(['BEKLIYOR', 'ISLENIYOR']);

const statusLabel = (status) => {
  if (status === 'BEKLIYOR') return 'Bekliyor';
  if (status === 'ISLENIYOR') return 'İşleniyor';
  if (status === 'TAMAMLANDI') return 'Tamamlandı';
  if (status === 'HATA') return 'Hata';
  if (status === 'IPTAL') return 'İptal edildi';
  return status || '-';
};

const actionLabel = (action) => {
  if (action === 'reconcileGLPI' || action === 'RECONCILE_GLPI') return 'GLPI eşleştirme';
  if (action === 'GENERATE_ZIMMET_PDF') return 'Zimmet PDF';
  if (action === 'GENERATE_RETURN_PDF') return 'İade PDF';
  if (action === 'GENERATE_TRANSFER_PDF') return 'Transfer PDF';
  if (action === 'AD_PASSWORD_RESET') return 'Bilgisayar/Wi‑Fi Şifresi';
  if (action === 'SIGNATURE_CREATE') return 'İmza Oluşturma';
  return action || 'İşlem';
};

const jobSubtitle = (job, payload) => {
  if (job.kind === 'ad-password' || job.kind === 'signature') return job.detail || '';

  if (job.action === 'GENERATE_TRANSFER_PDF') {
    const sender = payload?.senderCampus || '-';
    const receiver = payload?.receiverCampus || '-';
    const count = Array.isArray(payload?.hardware) ? payload.hardware.length : 0;
    return `${sender} → ${receiver}${count ? ` / ${count} cihaz` : ''}`;
  }

  if (job.action === 'GENERATE_ZIMMET_PDF' || job.action === 'GENERATE_RETURN_PDF') {
    const name = payload?.person?.name || '';
    const count = Array.isArray(payload?.hardware) ? payload.hardware.length : 0;
    return [name, count ? `${count} cihaz` : ''].filter(Boolean).join(' / ');
  }

  if (job.action === 'reconcileGLPI' || job.action === 'RECONCILE_GLPI') {
    return 'GLPI cihaz eşleşmeleri güncelleniyor';
  }

  return job.detail || '';
};

const safeJson = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value)
      .replace('T', ' ')
      .replace(/\.\d{3}Z?$/, '')
      .replace(/Z$/, '');
  }

  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const isTerminalStatus = (status) =>
  status === 'TAMAMLANDI' || status === 'HATA' || status === 'IPTAL';

const EMPTY_QUEUE_SNAPSHOT = Object.freeze({
  jobs: [],
  loading: false,
  running: false,
  error: '',
});
const sharedQueueStores = new Map();

function createSharedQueueStore({ key, currentUser, gasUrl }) {
  let snapshot = EMPTY_QUEUE_SNAPSHOT;
  let previousJobs = new Map();
  let requestInFlight = null;
  let pollTimer = null;
  let idleCleanupTimer = null;
  let started = false;
  const listeners = new Set();
  const openConsumers = new Set();
  const refreshCallbacks = new Map();

  const emit = (patch) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
    if (Object.prototype.hasOwnProperty.call(patch, 'jobs') && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('istek:operation-queue-updated', {
          detail: { jobs: snapshot.jobs },
        })
      );
    }
  };

  const hasActiveJobs = () => snapshot.jobs.some((job) => ACTIVE_STATUSES.has(job.status));

  const stopPolling = () => {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  };

  const schedulePoll = () => {
    stopPolling();
    if (!started || listeners.size === 0) return;

    const delay = hasActiveJobs() || openConsumers.size > 0 ? 15000 : 120000;
    pollTimer = window.setTimeout(async () => {
      pollTimer = null;
      if (
        document.visibilityState === 'hidden' &&
        !hasActiveJobs() &&
        openConsumers.size === 0
      ) {
        schedulePoll();
        return;
      }
      await fetchQueue({ silent: true });
    }, delay);
  };

  const fetchQueue = async ({ silent = true, force = false } = {}) => {
    if (!currentUser?.token) return undefined;
    if (requestInFlight) {
      const activeRequest = requestInFlight;
      try {
        await activeRequest;
      } catch {
        // İlk çağrı hatayı ortak snapshot'a yazar; takipçi çağrı yeniden hata üretmez.
      }
      if (!force || requestInFlight !== null) return snapshot.jobs;
    }

    if (!silent) emit({ loading: true });
    emit({ error: '' });

    const request = (async () => {
      const [operationData, adData] = await Promise.all([
        postApiAction(
          {
            action: 'fetchOperationQueue',
            authToken: currentUser.token,
            limit: 20,
          },
          { url: gasUrl, timeoutMs: 30000 }
        ),
        postApiAction(
          {
            action: 'fetchADPasswordQueue',
            authToken: currentUser.token,
            limit: 20,
          },
          { url: gasUrl, timeoutMs: 30000 }
        ),
      ]);

      let signatureData = { jobs: [] };
      try {
        signatureData = await postApiAction(
          {
            action: 'fetchSignatureQueue',
            authToken: currentUser.token,
            limit: 20,
          },
          { url: gasUrl, timeoutMs: 30000 }
        );
      } catch {
        signatureData = { jobs: [] };
      }

      const operationJobs = (operationData.jobs || []).map((job) => ({
        ...job,
        kind: 'operation',
      }));
      const adJobs = (adData.jobs || []).map((job) => ({
        ...job,
        kind: 'ad-password',
        action: 'AD_PASSWORD_RESET',
        detail: [job.personName || '-', job.adUser || '-'].join(' / '),
      }));
      const signatureJobs = (signatureData.jobs || []).map((job) => ({
        ...job,
        kind: 'signature',
        action: 'SIGNATURE_CREATE',
        detail: [job.personName || '-', job.titleTr || '-'].join(' / '),
      }));

      const nextJobs = [...operationJobs, ...adJobs, ...signatureJobs].sort((a, b) => {
        const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime() || 0;
        const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime() || 0;
        return bTime - aTime;
      });
      const completedAfterActive = nextJobs.some((job) => {
        const oldStatus = previousJobs.get(`${job.kind}:${job.queueId}`);
        return ACTIVE_STATUSES.has(oldStatus) && isTerminalStatus(job.status);
      });

      previousJobs = new Map(
        nextJobs.map((job) => [`${job.kind}:${job.queueId}`, job.status])
      );
      emit({ jobs: nextJobs });

      if (completedAfterActive) {
        const refreshData = refreshCallbacks.values().next().value;
        refreshData?.();
      }

      return nextJobs;
    })();

    requestInFlight = request;
    try {
      return await request;
    } catch (error) {
      emit({ error: error.message || 'Kuyruk okunamadı.' });
      return undefined;
    } finally {
      if (requestInFlight === request) requestInFlight = null;
      if (!silent) emit({ loading: false });
      schedulePoll();
    }
  };

  const runQueue = async () => {
    if (!currentUser?.token || snapshot.running) return;
    emit({ running: true, error: '' });
    try {
      await postApiAction(
        {
          action: 'runOperationQueue',
          authToken: currentUser.token,
          maxJobs: 5,
          includeFailed: true,
        },
        { url: gasUrl, timeoutMs: 60000 }
      );
      await fetchQueue({ silent: true, force: true });
    } catch (error) {
      emit({ error: error.message || 'Kuyruk çalıştırılamadı.' });
    } finally {
      emit({ running: false });
      schedulePoll();
    }
  };

  const handleFocus = () => fetchQueue({ silent: true });
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') fetchQueue({ silent: true });
  };
  const handleExternalRefresh = () => fetchQueue({ silent: true, force: true });

  const start = () => {
    if (started || typeof window === 'undefined') return;
    started = true;
    window.addEventListener('focus', handleFocus);
    window.addEventListener('istek:operation-queue-refresh', handleExternalRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    fetchQueue({ silent: true });
  };

  const stop = () => {
    if (!started || typeof window === 'undefined') return;
    started = false;
    stopPolling();
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('istek:operation-queue-refresh', handleExternalRefresh);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (idleCleanupTimer) window.clearTimeout(idleCleanupTimer);
      idleCleanupTimer = null;
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        idleCleanupTimer = window.setTimeout(() => {
          if (listeners.size > 0) return;
          stop();
          previousJobs = new Map();
          openConsumers.clear();
          refreshCallbacks.clear();
          sharedQueueStores.delete(key);
        }, 0);
      };
    },
    registerRefreshCallback(consumerId, callback) {
      refreshCallbacks.set(consumerId, callback);
      return () => refreshCallbacks.delete(consumerId);
    },
    setConsumerOpen(consumerId, isOpen) {
      if (isOpen) {
        openConsumers.add(consumerId);
        fetchQueue({ silent: true });
      } else {
        openConsumers.delete(consumerId);
      }
      schedulePoll();
    },
    fetchQueue,
    runQueue,
  };
}

function getSharedQueueStore(currentUser, gasUrl) {
  if (!currentUser?.token) return null;
  const key = `${gasUrl || ''}|${currentUser.email || ''}|${currentUser.token}`;
  if (!sharedQueueStores.has(key)) {
    sharedQueueStores.set(key, createSharedQueueStore({ key, currentUser, gasUrl }));
  }
  return sharedQueueStores.get(key);
}

function useSharedQueueData({ currentUser, gasUrl, onRefreshData, open }) {
  const consumerIdRef = useRef(Symbol('operation-queue-indicator'));
  const refreshCallbackRef = useRef(onRefreshData);
  refreshCallbackRef.current = onRefreshData;

  const store = useMemo(
    () => getSharedQueueStore(currentUser, gasUrl),
    [currentUser?.email, currentUser?.token, gasUrl]
  );
  const subscribe = useCallback(
    (listener) => (store ? store.subscribe(listener) : () => {}),
    [store]
  );
  const getSnapshot = useCallback(
    () => (store ? store.getSnapshot() : EMPTY_QUEUE_SNAPSHOT),
    [store]
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!store) return undefined;
    return store.registerRefreshCallback(consumerIdRef.current, () =>
      refreshCallbackRef.current?.(false)
    );
  }, [store]);

  useEffect(() => {
    if (!store) return undefined;
    const consumerId = consumerIdRef.current;
    store.setConsumerOpen(consumerId, open);
    return () => store.setConsumerOpen(consumerId, false);
  }, [store, open]);

  return {
    ...snapshot,
    fetchQueue: store?.fetchQueue || (async () => undefined),
    runQueue: store?.runQueue || (async () => undefined),
  };
}

export const OperationQueueIndicator = ({
  currentUser,
  gasUrl,
  onRefreshData,
  variant = 'desktop',
  alwaysVisible = false,
}) => {
  const [open, setOpen] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set());
  const [cancellingKey, setCancellingKey] = useState('');
  const [cancelError, setCancelError] = useState('');
  const { jobs, loading, running, error, fetchQueue, runQueue } = useSharedQueueData({
    currentUser,
    gasUrl,
    onRefreshData,
    open,
  });

  const storageKey = currentUser?.email
    ? `istek_operation_queue_dismissed:${currentUser.email}`
    : 'istek_operation_queue_dismissed:anonymous';

  const getJobKey = (job) => `${job.kind}:${job.queueId}`;

  const persistDismissedKeys = (nextKeys) => {
    const limited = Array.from(nextKeys).slice(-200);
    const nextSet = new Set(limited);
    setDismissedKeys(nextSet);
    try {
      localStorage.setItem(storageKey, JSON.stringify(limited));
    } catch {
      // LocalStorage dolu veya kapalıysa sadece bu oturumda gizlenir.
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setDismissedKeys(new Set(Array.isArray(parsed) ? parsed : []));
    } catch {
      setDismissedKeys(new Set());
    }
  }, [storageKey]);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => !dismissedKeys.has(getJobKey(job))),
    [jobs, dismissedKeys]
  );

  const summary = useMemo(() => {
    const waiting = visibleJobs.filter((job) => job.status === 'BEKLIYOR').length;
    const processing = visibleJobs.filter((job) => job.status === 'ISLENIYOR').length;
    const failed = visibleJobs.filter((job) => job.status === 'HATA').length;
    const active = waiting + processing;
    return { waiting, processing, failed, active };
  }, [visibleJobs]);

  const shouldShowButton = alwaysVisible || summary.active > 0 || summary.failed > 0 || open;
  if (!shouldShowButton) return null;

  const isMobile = variant === 'mobile';
  const buttonClass = isMobile
    ? 'relative p-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors shrink-0 border border-amber-200'
    : 'relative w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 border border-white/10 transition-colors text-sm font-bold';

  const dismissJob = (job) => {
    if (!isTerminalStatus(job.status)) return;
    const next = new Set(dismissedKeys);
    next.add(getJobKey(job));
    persistDismissedKeys(next);
  };

  const dismissCompletedJobs = () => {
    const next = new Set(dismissedKeys);
    visibleJobs.forEach((job) => {
      if (isTerminalStatus(job.status)) next.add(getJobKey(job));
    });
    persistDismissedKeys(next);
  };

  const cancelSignatureJob = async (job) => {
    if (
      job.kind !== 'signature' ||
      !ACTIVE_STATUSES.has(job.status) ||
      !job.queueId ||
      cancellingKey
    ) {
      return;
    }

    const key = getJobKey(job);
    setCancellingKey(key);
    setCancelError('');
    try {
      await postApiAction(
        {
          action: 'cancelSignatureJob',
          authToken: currentUser.token,
          queueId: job.queueId,
        },
        { url: gasUrl, timeoutMs: 30000 }
      );
      await fetchQueue({ silent: true, force: true });
      onRefreshData?.(false);
    } catch (cancelRequestError) {
      setCancelError(cancelRequestError.message || 'İmza işi iptal edilemedi.');
    } finally {
      setCancellingKey('');
    }
  };

  const panelPositionClass = isMobile
    ? 'left-4 right-4 top-20 w-auto max-w-none'
    : 'left-3 bottom-[104px] top-auto right-auto w-[min(420px,calc(100vw-24px))] max-w-sm';

  const panelContent = open ? (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 999999999999 }}>
      <div
        className="app-modal-backdrop absolute inset-0 bg-black/20 pointer-events-auto"
        onClick={() => setOpen(false)}
      />
      <section
        className={`app-modal-panel absolute ${panelPositionClass} bg-white rounded-2xl shadow-2xl border border-gray-200 pointer-events-auto overflow-hidden`}
      >
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-black text-gray-900 text-sm">İşlem Kuyruğu</h3>
            <p className="text-xs text-gray-500">
              {summary.active > 0
                ? `${summary.active} işlem bekliyor/işleniyor`
                : summary.failed > 0
                  ? `${summary.failed} işlem hata verdi`
                  : 'Son işlemler'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {visibleJobs.some((job) => isTerminalStatus(job.status)) && (
              <button
                type="button"
                onClick={dismissCompletedJobs}
                className="h-8 px-2.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 text-[11px] font-black"
                title="Tamamlanan ve hatalı bildirimleri gizle"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Temizle</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchQueue({ silent: false })}
              className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center justify-center"
              title="Yenile"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {currentUser?.role === 'HQ IT' && (
              <button
                type="button"
                onClick={runQueue}
                disabled={running}
                className="w-8 h-8 rounded-lg border border-blue-200 bg-blue-50 text-[#0066b1] hover:bg-blue-100 flex items-center justify-center disabled:opacity-60"
                title="Kuyruğu Çalıştır"
              >
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center justify-center"
              title="Kapat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {(error || cancelError) && (
          <div className="m-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {cancelError || error}
          </div>
        )}

        <div className="max-h-[min(64vh,520px)] overflow-y-auto p-3 space-y-2">
          {visibleJobs.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              Kuyrukta işlem yok.
            </div>
          ) : (
            visibleJobs.map((job) => {
              const parsedResult = safeJson(job.result || job.resultJson);
              const parsedPayload = safeJson(job.payloadJson);
              const safeResultUrl = toSafeExternalUrl(parsedResult?.url);
              const subtitle = jobSubtitle(job, parsedPayload);
              const statusClass =
                job.status === 'TAMAMLANDI'
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : job.status === 'HATA'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : job.status === 'IPTAL'
                      ? 'bg-gray-100 text-gray-600 border-gray-200'
                    : job.status === 'ISLENIYOR'
                      ? 'bg-blue-50 text-[#0066b1] border-blue-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200';

              return (
                <article
                  key={`${job.kind}:${job.queueId}`}
                  data-status={job.status}
                  className="app-queue-card rounded-xl border border-gray-200 bg-white p-3 pt-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Clock3 className="w-4 h-4 text-gray-400 shrink-0" />
                        <p className="font-black text-sm text-gray-900 truncate">
                          {actionLabel(job.action)}
                        </p>
                      </div>
                      {subtitle && (
                        <p className="text-[11px] text-gray-500 mt-1 truncate">
                          {subtitle}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`px-2 py-1 rounded-full border text-[10px] font-black ${statusClass}`}>
                        {statusLabel(job.status)}
                      </span>
                      {job.kind === 'signature' && ACTIVE_STATUSES.has(job.status) && (
                        <button
                          type="button"
                          onClick={() => cancelSignatureJob(job)}
                          disabled={Boolean(cancellingKey)}
                          className="h-7 px-2 rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 flex items-center justify-center gap-1 text-[10px] font-black disabled:opacity-60"
                          title="Bu imza işini iptal et"
                        >
                          {cancellingKey === getJobKey(job) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Ban className="w-3.5 h-3.5" />
                          )}
                          <span>İptal</span>
                        </button>
                      )}
                      {isTerminalStatus(job.status) && (
                        <button
                          type="button"
                          onClick={() => dismissJob(job)}
                          className="w-6 h-6 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center"
                          title="Bu bildirimi gizle"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <span className="block text-gray-400 font-bold">Oluşturma</span>
                      <span className="font-bold text-gray-700">{formatDateTime(job.createdAt)}</span>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <span className="block text-gray-400 font-bold">Son Güncelleme</span>
                      <span className="font-bold text-gray-700">{formatDateTime(job.updatedAt)}</span>
                    </div>
                  </div>

                  {job.error && (
                    <p
                      className={`mt-2 rounded-lg px-2 py-1.5 text-[11px] font-bold ${
                        job.status === 'IPTAL'
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {job.error}
                    </p>
                  )}

                  {job.kind === 'ad-password' && job.result && (
                    <p className="mt-2 rounded-lg bg-green-50 px-2 py-1.5 text-[11px] font-bold text-green-700">
                      {job.result}
                    </p>
                  )}
                  {parsedResult && job.status === 'TAMAMLANDI' && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-green-50 px-2 py-1.5 text-[11px] font-bold text-green-700">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {safeResultUrl
                            ? parsedResult.resultLabel || (job.kind === 'signature' ? 'İmza hazırlandı' : 'PDF hazırlandı')
                            : parsedResult.matched !== undefined
                            ? `${parsedResult.matched} eşleşme güncellendi`
                            : 'İşlem tamamlandı'}
                        </span>
                      </span>
                      {safeResultUrl && (
                        <a
                          href={safeResultUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-green-200 bg-white px-2 py-1 text-[10px] font-black text-green-700 hover:bg-green-100 shrink-0"
                        >
                          Aç
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          fetchQueue({ silent: true });
        }}
        className={buttonClass}
        title="İşlem Kuyruğu"
      >
        {summary.processing > 0 ? (
          <Loader2 className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} animate-spin`} />
        ) : summary.failed > 0 ? (
          <AlertCircle className={`${isMobile ? 'w-5 h-5' : 'w-4 h-4'} text-red-300`} />
        ) : (
          <ListChecks className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
        )}
        {!isMobile && <span>İşlem Kuyruğu</span>}
        {summary.active > 0 && (
          <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-amber-400 text-[#005595] text-[10px] font-black flex items-center justify-center shadow-sm">
            {summary.active}
          </span>
        )}
      </button>

      {typeof document !== 'undefined' && panelContent ? createPortal(panelContent, document.body) : panelContent}
    </>
  );
};
