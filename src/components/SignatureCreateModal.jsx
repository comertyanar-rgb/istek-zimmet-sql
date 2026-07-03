import { CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileSignature, Loader2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toTrLower } from '../utils/text.js';

const TITLE_PAGE_SIZE = 10;

export function SignatureCreateModal({
  person,
  titles = [],
  campuses = [],
  canChooseCampus = false,
  isLoadingTitles = false,
  isSubmitting = false,
  onClose,
  onSubmit,
}) {
  const [query, setQuery] = useState('');
  const [selectedTitle, setSelectedTitle] = useState(person?.department || '');
  const [selectedCampus, setSelectedCampus] = useState(person?.signatureCampus || person?.campus || '');
  const [page, setPage] = useState(1);

  const filteredTitles = useMemo(() => {
    const terms = toTrLower(query).split(/\s+/).filter(Boolean);
    return titles
      .filter((item) => {
        if (!terms.length) return true;
        const haystack = toTrLower(`${item.titleTr || ''} ${item.titleEn || ''}`);
        return terms.every((term) => haystack.includes(term));
      });
  }, [query, titles]);

  const totalPages = Math.max(1, Math.ceil(filteredTitles.length / TITLE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedTitles = filteredTitles.slice(
    (currentPage - 1) * TITLE_PAGE_SIZE,
    currentPage * TITLE_PAGE_SIZE
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    setQuery('');
    setSelectedTitle(person?.department || '');
    setSelectedCampus(person?.signatureCampus || person?.campus || campuses[0]?.campus || '');
    setPage(1);
  }, [person?.id, person?.department, person?.signatureCampus, person?.campus, campuses]);

  const selectedCampusInfo = useMemo(
    () => campuses.find((item) => item.campus === selectedCampus),
    [campuses, selectedCampus]
  );

  const canSubmit = Boolean(person && selectedTitle && (!canChooseCampus || selectedCampus) && !isSubmitting);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit?.({ personId: person.id, titleTr: selectedTitle, signatureCampus: canChooseCampus ? selectedCampus : person?.campus });
  };

  const modal = (
    <div
      className="fixed inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ zIndex: 120000 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
              <FileSignature className="w-5 h-5 text-[#0066b1]" />
            </div>
            <div className="min-w-0">
              <h3 className="font-black text-gray-900 text-lg leading-tight">İmza Oluştur</h3>
              <p className="text-xs font-semibold text-gray-500 truncate">{person?.name || '-'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full border border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors"
            aria-label="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">E-posta</p>
              <p className="text-sm font-black text-gray-900 truncate">{person?.email || '-'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1">
                {canChooseCampus ? 'İmza Kampüsü' : 'Kampüs'}
              </p>
              {canChooseCampus ? (
                <select
                  value={selectedCampus}
                  onChange={(event) => setSelectedCampus(event.target.value)}
                  className="w-full h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm font-black text-gray-900 outline-none focus:ring-2 focus:ring-[#8bcdc5] focus:border-[#0066b1]"
                >
                  <option value="" disabled>Kampüs seç</option>
                  {campuses.map((item) => (
                    <option key={item.campus} value={item.campus}>
                      {item.campus}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm font-black text-gray-900 truncate">{person?.campus || '-'}</p>
              )}
            </div>
          </div>

          {canChooseCampus && selectedCampusInfo?.address && (
            <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
              {selectedCampusInfo.address}
            </div>
          )}

          {person?.signatureLink ? (
            <a
              href={person.signatureLink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-black text-green-800"
            >
              <span className="inline-flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="truncate">Mevcut imza linki kayıtlı</span>
              </span>
              <ExternalLink className="w-4 h-4 shrink-0" />
            </a>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-800">
              Bu personelin kayıtlı imza linki yok.
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-gray-400 mb-2">
              Ünvan Seç
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ünvan ara..."
                className="w-full h-11 pl-10 pr-3 rounded-xl border border-gray-200 bg-white text-sm font-semibold outline-none focus:ring-2 focus:ring-[#8bcdc5] focus:border-[#0066b1]"
                autoFocus
              />
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="divide-y divide-gray-100">
              {isLoadingTitles ? (
                <div className="p-4 flex items-center justify-center gap-2 text-sm font-bold text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Ünvanlar alınıyor...
                </div>
              ) : paginatedTitles.length > 0 ? (
                paginatedTitles.map((item) => {
                  const active = selectedTitle === item.titleTr;
                  return (
                    <button
                      key={`${item.titleTr}-${item.titleEn}`}
                      type="button"
                      onClick={() => setSelectedTitle(item.titleTr)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        active ? 'bg-blue-50 text-[#0066b1]' : 'bg-white hover:bg-slate-50 text-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="text-sm font-black truncate">{item.titleTr}</p>
                            {item.templateKey && (
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                                Şablon {item.templateKey}
                              </span>
                            )}
                          </div>
                          {item.titleEn && (
                            <p className="text-[11px] font-semibold text-gray-400 truncate mt-0.5">
                              {item.titleEn}
                            </p>
                          )}
                        </div>
                        {active && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-4 text-sm font-bold text-gray-500">
                  Eşleşen ünvan bulunamadı.
                </div>
              )}
            </div>
            {!isLoadingTitles && filteredTitles.length > TITLE_PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-gray-100 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 text-xs font-black"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Önceki
                </button>
                <span className="text-xs font-black text-gray-500">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 text-xs font-black"
                >
                  Sonraki
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-gray-100 flex gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-white border border-gray-200 text-gray-700 font-black hover:bg-gray-50 transition-colors"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 h-12 rounded-xl bg-[#0066b1] text-white font-black shadow-sm hover:bg-[#005595] disabled:opacity-45 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
            İmza Oluştur
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
