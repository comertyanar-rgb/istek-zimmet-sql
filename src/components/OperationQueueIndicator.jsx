import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';

const ACTIVE_STATUSES = new Set(['BEKLIYOR', 'ISLENIYOR']);

const statusLabel = (status) => {
  if (status === 'BEKLIYOR') return 'Bekliyor';
  if (status === 'ISLENIYOR') return 'İşleniyor';
  if (status === 'TAMAMLANDI') return 'Tamamlandı';
  if (status === 'HATA') return 'Hata';
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

const safeJson = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const OperationQueueIndicator = ({
  currentUser,
  gasUrl,
  onRefreshData,
  variant = 'desktop',
  alwaysVisible = false,
}) => {
  const [jobs, setJobs] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const previousJobsRef = useRef(new Map());

  const fetchQueue = async ({ silent = true } = {}) => {
    if (!currentUser?.token) return;
    if (!silent) setLoading(true);
    setError('');

    try {
      const operationResponse = await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'fetchOperationQueue',
          authToken: currentUser.token,
          limit: 20,
        }),
      });
      const operationData = await operationResponse.json();
      if (!operationData.success) throw new Error(operationData.error || 'Kuyruk okunamadı.');

      const adResponse = await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'fetchADPasswordQueue',
          authToken: currentUser.token,
          limit: 20,
        }),
      });
      const adData = await adResponse.json();
      if (!adData.success) throw new Error(adData.error || 'Şifre kuyruğu okunamadı.');

      let signatureData = { jobs: [] };
      try {
        const signatureResponse = await fetch(gasUrl, {
          method: 'POST',
          body: JSON.stringify({
            action: 'fetchSignatureQueue',
            authToken: currentUser.token,
            limit: 20,
          }),
        });
        const nextSignatureData = await signatureResponse.json();
        if (nextSignatureData.success) signatureData = nextSignatureData;
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
      const previous = previousJobsRef.current;
      const completedAfterActive = nextJobs.some((job) => {
        const oldStatus = previous.get(`${job.kind}:${job.queueId}`);
        return ACTIVE_STATUSES.has(oldStatus) && job.status === 'TAMAMLANDI';
      });

      previousJobsRef.current = new Map(nextJobs.map((job) => [`${job.kind}:${job.queueId}`, job.status]));
      setJobs(nextJobs);

      if (completedAfterActive && onRefreshData) {
        onRefreshData(false);
      }
    } catch (err) {
      setError(err.message || 'Kuyruk okunamadı.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUser?.token) {
      setJobs([]);
      previousJobsRef.current = new Map();
      return undefined;
    }

    fetchQueue({ silent: true });
    const interval = window.setInterval(() => fetchQueue({ silent: true }), 30000);
    return () => window.clearInterval(interval);
  }, [currentUser?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const waiting = jobs.filter((job) => job.status === 'BEKLIYOR').length;
    const processing = jobs.filter((job) => job.status === 'ISLENIYOR').length;
    const failed = jobs.filter((job) => job.status === 'HATA').length;
    const active = waiting + processing;
    return { waiting, processing, failed, active };
  }, [jobs]);

  const shouldShowButton = alwaysVisible || summary.active > 0 || summary.failed > 0 || open;
  if (!shouldShowButton) return null;

  const isMobile = variant === 'mobile';
  const buttonClass = isMobile
    ? 'relative p-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors shrink-0 border border-amber-200'
    : 'relative w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 text-white hover:bg-white/20 border border-white/10 transition-colors text-sm font-bold';

  const runQueue = async () => {
    if (!currentUser?.token) return;
    setRunning(true);
    setError('');
    try {
      const response = await fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({
          action: 'runOperationQueue',
          authToken: currentUser.token,
          maxJobs: 5,
          includeFailed: true,
        }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Kuyruk çalıştırılamadı.');
      await fetchQueue({ silent: true });
    } catch (err) {
      setError(err.message || 'Kuyruk çalıştırılamadı.');
    } finally {
      setRunning(false);
    }
  };

  const panelPositionClass = isMobile
    ? 'left-4 right-4 top-20 w-auto max-w-none'
    : 'left-3 bottom-[104px] top-auto right-auto w-[min(420px,calc(100vw-24px))] max-w-sm';

  const panelContent = open ? (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 999999999999 }}>
      <div
        className="absolute inset-0 bg-black/20 pointer-events-auto"
        onClick={() => setOpen(false)}
      />
      <section
        className={`absolute ${panelPositionClass} bg-white rounded-2xl shadow-2xl border border-gray-200 pointer-events-auto overflow-hidden`}
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

        {error && (
          <div className="m-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        <div className="max-h-[min(64vh,520px)] overflow-y-auto p-3 space-y-2">
          {jobs.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">
              Kuyrukta işlem yok.
            </div>
          ) : (
            jobs.map((job) => {
              const parsedResult = safeJson(job.result || job.resultJson);
              const statusClass =
                job.status === 'TAMAMLANDI'
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : job.status === 'HATA'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : job.status === 'ISLENIYOR'
                      ? 'bg-blue-50 text-[#0066b1] border-blue-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200';

              return (
                <article
                  key={`${job.kind}:${job.queueId}`}
                  className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Clock3 className="w-4 h-4 text-gray-400 shrink-0" />
                        <p className="font-black text-sm text-gray-900 truncate">
                          {actionLabel(job.action)}
                        </p>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-1 truncate">
                        {job.kind === 'ad-password' || job.kind === 'signature' ? job.detail : job.queueId}
                      </p>
                    </div>
                    <span className={`px-2 py-1 rounded-full border text-[10px] font-black shrink-0 ${statusClass}`}>
                      {statusLabel(job.status)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <span className="block text-gray-400 font-bold">Oluşturma</span>
                      <span className="font-bold text-gray-700">{job.createdAt || '-'}</span>
                    </div>
                    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                      <span className="block text-gray-400 font-bold">Son Güncelleme</span>
                      <span className="font-bold text-gray-700">{job.updatedAt || '-'}</span>
                    </div>
                  </div>

                  {job.error && (
                    <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-bold text-red-700">
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
                          {parsedResult.url
                            ? parsedResult.resultLabel || (job.kind === 'signature' ? 'İmza hazırlandı' : 'PDF hazırlandı')
                            : parsedResult.matched !== undefined
                            ? `${parsedResult.matched} eşleşme güncellendi`
                            : 'İşlem tamamlandı'}
                        </span>
                      </span>
                      {parsedResult.url && (
                        <a
                          href={parsedResult.url}
                          target="_blank"
                          rel="noreferrer"
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
        {(summary.active > 0 || summary.failed > 0) && (
          <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-amber-400 text-[#005595] text-[10px] font-black flex items-center justify-center shadow-sm">
            {summary.failed > 0 ? summary.failed : summary.active}
          </span>
        )}
      </button>

      {typeof document !== 'undefined' && panelContent ? createPortal(panelContent, document.body) : panelContent}
    </>
  );
};
