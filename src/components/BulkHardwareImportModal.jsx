import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { postApiAction } from '../services/apiClient.js';
import { showAppAlert } from '../services/uiMessageService.js';

const MAX_IMPORT_ITEMS = 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PREVIEW_PAGE_SIZE = 10;

const TYPE_ALIASES = new Map([
  ['laptop', 'Laptop'],
  ['notebook', 'Laptop'],
  ['dizustu', 'Laptop'],
  ['masaustu', 'Masaüstü (PC)'],
  ['masaustupc', 'Masaüstü (PC)'],
  ['pc', 'Masaüstü (PC)'],
  ['desktop', 'Masaüstü (PC)'],
  ['allinone', 'All in One PC'],
  ['allinonepc', 'All in One PC'],
  ['aio', 'All in One PC'],
  ['tablet', 'Tablet'],
  ['monitor', 'Monitör'],
  ['klavyevemouseseti', 'Klavye ve Mouse Seti'],
  ['klavyemouseseti', 'Klavye ve Mouse Seti'],
  ['mouse', 'Mouse'],
  ['klavye', 'Klavye'],
  ['webcam', 'Webcam'],
  ['harddrive', 'Hard Drive'],
  ['haricidisk', 'Hard Drive'],
  ['disk', 'Hard Drive'],
  ['diger', 'Diğer'],
]);

const HEADER_ALIASES = {
  serial: ['serino', 'serinumarasi', 'serial', 'serialno', 'serialnumber', 'sn'],
  type: ['cihaztipi', 'tip', 'devicetype', 'hardwaretype'],
  brand: ['marka', 'brand', 'manufacturer', 'uretici'],
  model: ['model', 'modeli'],
  deviceName: ['bilgisayarisimi', 'bilgisayaradi', 'computername', 'devicename', 'hostname'],
  notes: ['notlar', 'not', 'notes', 'aciklama'],
  campus: ['kampus', 'campus', 'okul'],
};

function normalizeLookupText(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeHardwareType(value) {
  return TYPE_ALIASES.get(normalizeLookupText(value || 'Laptop')) || '';
}

function cellToText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function detectDelimiter(text) {
  const firstLine = String(text || '')
    .split(/\r?\n/)
    .find((line) => line.trim()) || '';
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;

  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      const char = firstLine[index];
      if (char === '"') quoted = !quoted;
      if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function parseDelimitedText(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(source);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!quoted && (char === '\r' || char === '\n')) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

function getColumnIndexes(headers) {
  const normalizedHeaders = headers.map(normalizeLookupText);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [
      field,
      normalizedHeaders.findIndex((header) => aliases.includes(header)),
    ])
  );
}

function buildPreviewRows(matrix, existingHardware, currentUser) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error('Dosyada başlık satırı ve en az bir donanım kaydı bulunmalıdır.');
  }

  const indexes = getColumnIndexes(matrix[0] || []);
  const missingHeaders = [
    ['serial', 'Seri No'],
    ['brand', 'Marka'],
    ['model', 'Model'],
  ]
    .filter(([field]) => indexes[field] < 0)
    .map(([, label]) => label);
  if (missingHeaders.length > 0) {
    throw new Error(`Zorunlu sütunlar bulunamadı: ${missingHeaders.join(', ')}.`);
  }

  const sourceRows = matrix
    .slice(1)
    .map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => Array.isArray(cells) && cells.some((cell) => cellToText(cell)));
  if (sourceRows.length === 0) throw new Error('Dosyada içe aktarılacak donanım satırı bulunamadı.');
  if (sourceRows.length > MAX_IMPORT_ITEMS) {
    throw new Error(`Tek dosyada en fazla ${MAX_IMPORT_ITEMS} donanım bulunabilir.`);
  }

  const existingSerials = new Set(
    (existingHardware || [])
      .map((item) => cellToText(item.serial || item.id).toLocaleLowerCase('tr-TR'))
      .filter(Boolean)
  );
  const serialCounts = new Map();
  const initialRows = sourceRows.map(({ cells, rowNumber }) => {
    const serialCell = cells[indexes.serial];
    const serial = cellToText(serialCell);
    const typeInput = indexes.type >= 0 ? cellToText(cells[indexes.type]) : 'Laptop';
    const item = {
      rowNumber,
      serial,
      type: normalizeHardwareType(typeInput),
      typeInput: typeInput || 'Laptop',
      brand: cellToText(cells[indexes.brand]),
      model: cellToText(cells[indexes.model]),
      deviceName: indexes.deviceName >= 0 ? cellToText(cells[indexes.deviceName]) : '',
      notes: indexes.notes >= 0 ? cellToText(cells[indexes.notes]) : '',
      campus:
        currentUser?.role === 'HQ IT' && indexes.campus >= 0
          ? cellToText(cells[indexes.campus]) || currentUser.campus
          : currentUser?.campus || '',
      serialWasUnsafeNumber:
        typeof serialCell === 'number' &&
        (!Number.isSafeInteger(serialCell) || serialCell < 0),
    };
    const serialKey = serial.toLocaleLowerCase('tr-TR');
    if (serialKey) serialCounts.set(serialKey, (serialCounts.get(serialKey) || 0) + 1);
    return item;
  });

  return initialRows.map((item) => {
    const errors = [];
    const serialKey = item.serial.toLocaleLowerCase('tr-TR');
    if (!item.serial) errors.push('Seri no boş.');
    if (item.serial.length > 160) errors.push('Seri no 160 karakterden uzun.');
    if (item.serialWasUnsafeNumber || /^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(item.serial)) {
      errors.push('Seri no bilimsel sayıya dönüşmüş; sütunu Excel’de Metin yapın.');
    }
    if (serialKey && serialCounts.get(serialKey) > 1) errors.push('Dosyada aynı seri no birden fazla kez var.');
    if (serialKey && existingSerials.has(serialKey)) errors.push('Bu seri no sistemde zaten kayıtlı.');
    if (!item.type) errors.push(`Desteklenmeyen cihaz tipi: ${item.typeInput || '-'}.`);
    if (!item.brand) errors.push('Marka boş.');
    if (item.brand.length > 120) errors.push('Marka 120 karakterden uzun.');
    if (!item.model) errors.push('Model boş.');
    if (item.model.length > 240) errors.push('Model 240 karakterden uzun.');
    if (item.deviceName.length > 160) errors.push('Bilgisayar ismi 160 karakterden uzun.');
    if (item.notes.length > 4000) errors.push('Notlar 4000 karakterden uzun.');
    if (!item.campus) errors.push('Kampüs belirlenemedi.');

    return { ...item, errors, isValid: errors.length === 0 };
  });
}

async function readImportFile(file) {
  const extension = String(file?.name || '').split('.').pop()?.toLocaleLowerCase('tr-TR');
  if (extension === 'csv') return parseDelimitedText(await file.text());
  if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    return readSheet(file);
  }
  throw new Error('Yalnızca .xlsx veya .csv dosyaları yüklenebilir.');
}

function downloadTemplate(isHq) {
  const headers = [
    'Seri No',
    'Cihaz Tipi',
    'Marka',
    'Model',
    'Bilgisayar İsmi',
    'Notlar',
    ...(isHq ? ['Kampüs'] : []),
  ];
  const blob = new Blob([`\uFEFF${headers.join(';')}\r\n`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'Toplu_Donanim_Sablonu.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function BulkHardwareImportModal({
  currentUser,
  existingHardware = [],
  onClose,
  onImported,
}) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [fileError, setFileError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [page, setPage] = useState(1);

  const validRows = useMemo(() => rows.filter((row) => row.isValid), [rows]);
  const invalidRows = useMemo(() => rows.filter((row) => !row.isValid), [rows]);
  const displayedRows = showOnlyErrors ? invalidRows : rows;
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / PREVIEW_PAGE_SIZE));
  const pageRows = displayedRows.slice(
    (Math.min(page, totalPages) - 1) * PREVIEW_PAGE_SIZE,
    Math.min(page, totalPages) * PREVIEW_PAGE_SIZE
  );
  const isHq = currentUser?.role === 'HQ IT';

  const resetFile = () => {
    setFileName('');
    setRows([]);
    setFileError('');
    setShowOnlyErrors(false);
    setPage(1);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (file) => {
    if (!file) return;
    resetFile();
    if (file.size > MAX_FILE_BYTES) {
      setFileError('Dosya en fazla 8 MB olabilir.');
      return;
    }

    setIsReading(true);
    setFileName(file.name);
    try {
      const matrix = await readImportFile(file);
      setRows(buildPreviewRows(matrix, existingHardware, currentUser));
    } catch (error) {
      setFileError(error.message || 'Dosya okunamadı.');
    } finally {
      setIsReading(false);
    }
  };

  const handleSubmit = async () => {
    if (validRows.length === 0) {
      showAppAlert('İçe aktarılabilecek geçerli donanım satırı bulunmuyor.', {
        type: 'warning',
        title: 'Geçerli kayıt yok',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await postApiAction({
        action: 'bulkAddHardware',
        authToken: currentUser?.token,
        items: validRows.map((row) => ({
          rowNumber: row.rowNumber,
          serial: row.serial,
          type: row.type,
          brand: row.brand,
          model: row.model,
          deviceName: row.deviceName,
          notes: row.notes,
          ...(isHq ? { campus: row.campus } : {}),
        })),
      });
      await onImported?.(result);
      onClose();
    } catch (error) {
      showAppAlert(`Toplu donanım girişi tamamlanamadı: ${error.message}`, {
        type: 'error',
        title: 'İçe aktarma hatası',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-hardware-import-title"
    >
      <div className="app-modal-panel flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b bg-[#0066b1] px-4 py-3.5 text-white sm:px-5">
          <div className="min-w-0">
            <h2 id="bulk-hardware-import-title" className="flex items-center gap-2 text-base font-black">
              <FileSpreadsheet className="h-5 w-5" />
              Excel’den Toplu Donanım Ekle
            </h2>
            <p className="mt-0.5 truncate text-[11px] font-medium text-blue-100">
              Kayıtlar {isHq ? 'seçilen kampüse' : currentUser?.campus || 'yetkili kampüse'} Depoda olarak eklenir.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="ml-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-blue-50 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/70 p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-3.5 py-3 text-xs leading-relaxed text-blue-900">
              <strong>Zorunlu sütunlar:</strong> Seri No, Marka ve Model. Cihaz Tipi boşsa Laptop kabul edilir.
              Seri numaralarının bozulmaması için Excel’de bu sütunu <strong>Metin</strong> biçiminde tutun.
            </div>
            <button
              type="button"
              onClick={() => downloadTemplate(isHq)}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-bold text-[#0066b1] shadow-sm transition-colors hover:bg-blue-50"
            >
              <Download className="h-4 w-4" />
              Şablonu İndir
            </button>
          </div>

          <div className="mt-4 rounded-xl border-2 border-dashed border-slate-300 bg-white p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
            <div className="flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#0066b1]">
                  {isReading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {fileName || 'Doldurulmuş Excel veya CSV dosyasını seçin'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">.xlsx veya .csv, en fazla 8 MB ve 1000 satır</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {fileName && (
                  <button
                    type="button"
                    onClick={resetFile}
                    disabled={isReading || isSubmitting}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Temizle
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isReading || isSubmitting}
                  className="h-9 rounded-lg bg-[#0066b1] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#005595] disabled:opacity-50"
                >
                  Dosya Seç
                </button>
              </div>
            </div>
          </div>

          {fileError && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm font-semibold text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyErrors(false);
                    setPage(1);
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    !showOnlyErrors
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Toplam</span>
                  <strong className="mt-0.5 block text-lg">{rows.length}</strong>
                </button>
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-green-800">
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Eklenecek</span>
                  <strong className="mt-0.5 block text-lg">{validRows.length}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyErrors(true);
                    setPage(1);
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    showOnlyErrors
                      ? 'border-red-300 bg-red-50 text-red-800'
                      : 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                  }`}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Hatalı / Atlanacak</span>
                  <strong className="mt-0.5 block text-lg">{invalidRows.length}</strong>
                </button>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="hidden grid-cols-[64px_minmax(130px,1fr)_110px_minmax(180px,1.4fr)_minmax(180px,1.2fr)] gap-3 border-b bg-slate-100/80 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 md:grid">
                  <span>Satır</span>
                  <span>Seri No</span>
                  <span>Tip</span>
                  <span>Marka / Model</span>
                  <span>Kontrol</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {pageRows.map((row) => (
                    <div
                      key={`${row.rowNumber}-${row.serial}`}
                      className={`grid gap-2 px-3 py-3 md:grid-cols-[64px_minmax(130px,1fr)_110px_minmax(180px,1.4fr)_minmax(180px,1.2fr)] md:items-center md:gap-3 ${
                        row.isValid ? 'bg-white' : 'bg-red-50/40'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-slate-400">#{row.rowNumber}</span>
                      <div className="min-w-0">
                        <p className="break-all text-sm font-black text-slate-800">{row.serial || '-'}</p>
                        {row.deviceName && (
                          <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{row.deviceName}</p>
                        )}
                      </div>
                      <span className="text-xs font-bold text-slate-700">{row.type || row.typeInput || '-'}</span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-800">{row.brand || '-'}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{row.model || '-'}</p>
                        {isHq && <p className="mt-1 truncate text-[10px] font-semibold text-blue-600">{row.campus}</p>}
                      </div>
                      {row.isValid ? (
                        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Hazır
                        </span>
                      ) : (
                        <div className="space-y-1">
                          {row.errors.map((error) => (
                            <p key={error} className="flex items-start gap-1 text-[10px] font-semibold leading-snug text-red-700">
                              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                              {error}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {pageRows.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                    Bu görünümde kayıt bulunmuyor.
                  </div>
                )}
              </div>

              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={page <= 1}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                    aria-label="Önceki sayfa"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-bold text-slate-600">
                    {Math.min(page, totalPages)} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={page >= totalPages}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                    aria-label="Sonraki sayfa"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-white px-4 py-3.5 sm:px-5">
          <p className="hidden text-[11px] font-medium text-slate-500 sm:block">
            Hatalı satırlar ve mevcut seri numaraları otomatik olarak atlanır.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-10 rounded-full bg-slate-100 px-5 text-sm font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || validRows.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0066b1] px-5 text-sm font-bold text-white shadow-lg shadow-blue-700/20 transition-colors hover:bg-[#005595] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {isSubmitting ? 'Ekleniyor...' : `${validRows.length} Donanımı Ekle`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
