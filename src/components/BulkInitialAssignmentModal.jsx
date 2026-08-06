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
import { confirmAppAction, showAppAlert } from '../services/uiMessageService.js';
import { downloadGeneratedExport } from '../utils/exportDownload.js';

const MAX_ASSIGNMENT_ITEMS = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PREVIEW_PAGE_SIZE = 10;

const HEADER_ALIASES = {
  serial: ['serino', 'serinumarasi', 'serial', 'serialno', 'serialnumber', 'sn'],
  personEmail: [
    'personeleposta',
    'personelepostasi',
    'personelmail',
    'personelmaili',
    'eposta',
    'email',
  ],
  driveLink: [
    'drivelinki',
    'drivebaglantisi',
    'belgelinki',
    'tutanaklinki',
    'googledrivelinki',
  ],
};

function text(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeLookupText(value) {
  return text(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeEmail(value) {
  return text(value).toLocaleLowerCase('tr-TR');
}

function normalizeSerial(value) {
  return text(value).replace(/^'/, '').trim();
}

function normalizeDriveLink(value) {
  return text(value);
}

function validateDriveLink(value) {
  if (!value) return '';
  if (value.length > 2048) return 'Drive linki 2048 karakterden uzun.';
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !['drive.google.com', 'docs.google.com'].includes(url.hostname.toLocaleLowerCase('tr-TR'))
    ) {
      return 'Yalnızca Google Drive veya Google Docs bağlantısı kullanılabilir.';
    }
  } catch {
    return 'Drive linki geçerli bir HTTPS adresi olmalıdır.';
  }
  return '';
}

function normalizeCampus(value) {
  return text(value)
    .toLocaleLowerCase('tr-TR')
    .replace(/kampüsü|kampusu|kampüs|kampus/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isActivePersonnel(person) {
  const status = text(person?.status || 'Aktif')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I');
  return status === 'AKTIF' || status === 'ACTIVE';
}

function getHardwareStatus(item) {
  const status = text(item?.status).toLocaleUpperCase('tr-TR').replace(/İ/g, 'I');
  if (status === 'AVAILABLE' || status === 'DEPODA') return 'DEPODA';
  if (status === 'ASSIGNED' || status === 'AKTIF') return 'AKTIF';
  if (status === 'TRANSFER') return 'TRANSFER';
  if (status === 'HURDA' || status === 'SCRAP') return 'HURDA';
  return status;
}

function statusLabel(item) {
  const status = getHardwareStatus(item);
  if (status === 'DEPODA') return 'Depoda';
  if (status === 'AKTIF') return 'Zimmetli / Aktif';
  if (status === 'TRANSFER') return 'Transfer';
  if (status === 'HURDA') return 'Hurda';
  return text(item?.status) || '-';
}

function detectDelimiter(source) {
  const firstLine = String(source || '')
    .split(/\r?\n/)
    .find((line) => line.trim()) || '';
  const candidates = [';', ',', '\t'];
  let selected = ';';
  let selectedCount = -1;

  candidates.forEach((candidate) => {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < firstLine.length; index += 1) {
      if (firstLine[index] === '"') quoted = !quoted;
      if (!quoted && firstLine[index] === candidate) count += 1;
    }
    if (count > selectedCount) {
      selected = candidate;
      selectedCount = count;
    }
  });
  return selected;
}

function parseDelimitedText(source) {
  const input = String(source || '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(input);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
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
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => text(value))) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => text(value))) rows.push(row);
  return rows;
}

async function readImportFile(file) {
  const extension = text(file?.name).split('.').pop()?.toLocaleLowerCase('tr-TR');
  if (extension === 'csv') return parseDelimitedText(await file.text());
  if (extension === 'xlsx') {
    const { readSheet } = await import('read-excel-file/browser');
    return readSheet(file);
  }
  throw new Error('Yalnızca .xlsx veya .csv dosyaları yüklenebilir.');
}

function findColumnIndexes(headers) {
  const normalizedHeaders = (headers || []).map(normalizeLookupText);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [
      field,
      normalizedHeaders.findIndex((header) => aliases.includes(header)),
    ])
  );
}

function buildPreview(matrix, hardware, personnel, currentUser) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error('Dosyada başlık satırı ve en az bir cihaz satırı bulunmalıdır.');
  }

  const indexes = findColumnIndexes(matrix[0]);
  const missing = [];
  if (indexes.serial < 0) missing.push('Seri No');
  if (indexes.personEmail < 0) missing.push('Personel E-posta');
  if (missing.length > 0) throw new Error(`Zorunlu sütunlar bulunamadı: ${missing.join(', ')}.`);

  const sourceRows = matrix
    .slice(1)
    .map((cells, index) => ({ cells, rowNumber: index + 2 }))
    .filter(({ cells }) => Array.isArray(cells) && cells.some((cell) => text(cell)));
  const filledRows = sourceRows.filter(({ cells }) => text(cells[indexes.personEmail]));
  if (filledRows.length === 0) {
    throw new Error('Personel E-posta sütunu doldurulmuş bir cihaz satırı bulunamadı.');
  }
  if (filledRows.length > MAX_ASSIGNMENT_ITEMS) {
    throw new Error(`Tek dosyada en fazla ${MAX_ASSIGNMENT_ITEMS} zimmet satırı bulunabilir.`);
  }

  const hardwareBySerial = new Map(
    (hardware || []).map((item) => [normalizeSerial(item.serial || item.id).toLocaleLowerCase('tr-TR'), item])
  );
  const personnelByEmail = new Map(
    (personnel || [])
      .filter((person) => normalizeEmail(person.email))
      .map((person) => [normalizeEmail(person.email), person])
  );
  const serialCounts = new Map();
  const prepared = filledRows.map(({ cells, rowNumber }) => {
    const serialCell = cells[indexes.serial];
    const serial = normalizeSerial(serialCell);
    const serialKey = serial.toLocaleLowerCase('tr-TR');
    if (serialKey) serialCounts.set(serialKey, (serialCounts.get(serialKey) || 0) + 1);
    return {
      rowNumber,
      serial,
      serialKey,
      personEmail: normalizeEmail(cells[indexes.personEmail]),
      driveLink: indexes.driveLink >= 0 ? normalizeDriveLink(cells[indexes.driveLink]) : '',
      serialWasUnsafeNumber:
        typeof serialCell === 'number' && (!Number.isSafeInteger(serialCell) || serialCell < 0),
    };
  });

  const rows = prepared.map((item) => {
    const errors = [];
    const device = hardwareBySerial.get(item.serialKey);
    const person = personnelByEmail.get(item.personEmail);

    if (!item.serial) errors.push('Seri no boş.');
    if (item.serial.length > 160) errors.push('Seri no 160 karakterden uzun.');
    if (
      item.serialWasUnsafeNumber ||
      /^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(item.serial)
    ) {
      errors.push('Seri no bilimsel sayıya dönüşmüş; Excel sütununu Metin yapın.');
    }
    if (item.serialKey && serialCounts.get(item.serialKey) > 1) {
      errors.push('Dosyada aynı seri no birden fazla kez var.');
    }
    if (!device && item.serial) errors.push('Cihaz sistemde bulunamadı veya kampüs yetkinizin dışında.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.personEmail)) {
      errors.push('Personel e-posta adresi geçersiz.');
    } else if (item.personEmail.length > 320) {
      errors.push('Personel e-posta adresi 320 karakterden uzun.');
    } else if (!person) {
      errors.push('Bu e-posta adresiyle personel bulunamadı.');
    } else if (!isActivePersonnel(person)) {
      errors.push('Personel aktif değil.');
    }
    const driveLinkError = validateDriveLink(item.driveLink);
    if (driveLinkError) errors.push(driveLinkError);

    if (device && person) {
      if (normalizeCampus(device.campus) !== normalizeCampus(person.campus)) {
        errors.push(`Cihaz ve personel aynı kampüste değil (${device.campus || '-'} / ${person.campus || '-'}).`);
      }
      if (
        currentUser?.role !== 'HQ IT' &&
        normalizeCampus(device.campus) !== normalizeCampus(currentUser?.campus)
      ) {
        errors.push('Cihaz yetkili olduğunuz kampüste değil.');
      }
      const status = getHardwareStatus(device);
      if (status === 'TRANSFER') errors.push('Transferdeki cihaz zimmetlenemez.');
      if (status === 'HURDA') errors.push('Hurda cihaz zimmetlenemez.');
      if (status && !['DEPODA', 'AKTIF'].includes(status)) {
        errors.push(`Desteklenmeyen cihaz durumu: ${statusLabel(device)}.`);
      }
      if (device.assignedTo && String(device.assignedTo) !== String(person.id)) {
        errors.push('Cihaz başka bir personele zimmetli.');
      }
    }

    const alreadyAssigned = Boolean(
      errors.length === 0 && device?.assignedTo && String(device.assignedTo) === String(person?.id)
    );
    return {
      ...item,
      device,
      person,
      errors,
      isValid: errors.length === 0,
      alreadyAssigned,
    };
  });

  return { rows, ignoredCount: sourceRows.length - filledRows.length };
}

function buildMigrationExportData(hardware, personnel) {
  const personnelById = new Map((personnel || []).map((person) => [String(person.id), person]));
  return (hardware || []).map((item) => {
    const person = item.assignedTo ? personnelById.get(String(item.assignedTo)) : null;
    return {
      'Seri No *': normalizeSerial(item.serial || item.id),
      'Bilgisayar İsmi': item.deviceName || '',
      'Cihaz Tipi': item.type || '',
      Marka: item.brand || '',
      Model: item.model || '',
      Kampüs: item.campus || '',
      'Mevcut Durum': statusLabel(item),
      'Mevcut Personel (Bilgi)': person?.name || '',
      'Personel E-posta *': person?.email || '',
      'Drive Linki (İsteğe Bağlı)': item.driveLink || '',
    };
  });
}

export function BulkInitialAssignmentModal({
  currentUser,
  existingHardware = [],
  existingPersonnel = [],
  onClose,
  onImported,
}) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [fileError, setFileError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloadingList, setIsDownloadingList] = useState(false);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [page, setPage] = useState(1);

  const invalidRows = useMemo(() => rows.filter((row) => !row.isValid), [rows]);
  const assignableRows = useMemo(
    () => rows.filter((row) => row.isValid && !row.alreadyAssigned),
    [rows]
  );
  const skippedRows = useMemo(
    () => rows.filter((row) => row.isValid && row.alreadyAssigned),
    [rows]
  );
  const displayedRows = showOnlyErrors ? invalidRows : rows;
  const totalPages = Math.max(1, Math.ceil(displayedRows.length / PREVIEW_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = displayedRows.slice(
    (safePage - 1) * PREVIEW_PAGE_SIZE,
    safePage * PREVIEW_PAGE_SIZE
  );

  const resetFile = () => {
    setFileName('');
    setRows([]);
    setIgnoredCount(0);
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
      const preview = buildPreview(matrix, existingHardware, existingPersonnel, currentUser);
      setRows(preview.rows);
      setIgnoredCount(preview.ignoredCount);
    } catch (error) {
      setFileError(error.message || 'Dosya okunamadı.');
    } finally {
      setIsReading(false);
    }
  };

  const handleSubmit = async () => {
    if (invalidRows.length > 0) {
      await showAppAlert('Dosyadaki tüm hataları düzeltmeden işlem uygulanamaz.', {
        type: 'warning',
        title: 'Hatalı satırlar var',
      });
      return;
    }
    if (assignableRows.length === 0) {
      await showAppAlert('Yeni bir zimmet oluşturacak satır bulunmuyor.', {
        type: 'warning',
        title: 'Değişiklik yok',
      });
      return;
    }

    const confirmed = await confirmAppAction({
      type: 'warning',
      title: 'İlk migrasyon zimmetini uygulayın',
      message: `${assignableRows.length} cihaz veritabanında doğrudan personele zimmetlenecek. Bu işlem OTP, PDF veya bildirim oluşturmaz. Devam edilsin mi?`,
      confirmLabel: 'Toplu Zimmeti Uygula',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      const result = await postApiAction({
        action: 'bulkInitialAssignment',
        authToken: currentUser?.token,
        confirmMigration: true,
        items: rows.map((row) => ({
          rowNumber: row.rowNumber,
          serial: row.serial,
          personEmail: row.personEmail,
          driveLink: row.driveLink,
        })),
      });
      await onImported?.(result);
      onClose();
    } catch (error) {
      await showAppAlert(`Toplu zimmet tamamlanamadı: ${error.message}`, {
        type: 'error',
        title: 'Migrasyon hatası',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadMigrationList = async () => {
    const exportData = buildMigrationExportData(existingHardware, existingPersonnel);
    if (exportData.length === 0) {
      await showAppAlert('İndirilecek donanım kaydı bulunmuyor.', {
        type: 'warning',
        title: 'Liste boş',
      });
      return;
    }

    setIsDownloadingList(true);
    try {
      const result = await postApiAction(
        {
          action: 'createSheet',
          authToken: currentUser?.token,
          format: 'xlsx',
          sheetName: 'İlk Migrasyon Zimmet Listesi',
          data: exportData,
        },
        { timeoutMs: 120000 }
      );
      await downloadGeneratedExport(
        result.url,
        `Ilk_Migrasyon_Zimmet_Listesi_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } catch (error) {
      await showAppAlert(`Donanım listesi indirilemedi: ${error.message}`, {
        type: 'error',
        title: 'İndirme hatası',
      });
    } finally {
      setIsDownloadingList(false);
    }
  };

  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-initial-assignment-title"
    >
      <div className="app-modal-panel flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b bg-[#0066b1] px-4 py-3.5 text-white sm:px-5">
          <div className="min-w-0">
            <h2 id="bulk-initial-assignment-title" className="flex items-center gap-2 text-base font-black">
              <FileSpreadsheet className="h-5 w-5" />
              İlk Migrasyon Zimmeti
            </h2>
            <p className="mt-0.5 truncate text-[11px] font-medium text-blue-100">
              Personel E-posta * zorunludur; mevcut personel adı yalnızca bilgi amaçlıdır.
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
            <div className="bulk-initial-warning rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900">
              <strong>Yalnızca ilk geçiş içindir.</strong> Cihaz ile personel aynı kampüste olmalıdır. İşlem
              OTP, PDF ve e-posta oluşturmaz; tüm satırlar tek veritabanı işlemiyle ya birlikte uygulanır ya da hiçbiri uygulanmaz.
              Drive Linki isteğe bağlıdır.
            </div>
            <button
              type="button"
              onClick={handleDownloadMigrationList}
              disabled={isDownloadingList || isSubmitting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-bold text-[#0066b1] shadow-sm transition-colors hover:bg-blue-50"
            >
              {isDownloadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isDownloadingList ? 'Hazırlanıyor...' : 'Donanım Listesini İndir'}
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
                    {fileName || 'Zorunlu alanları doldurulmuş Excel veya CSV dosyasını seçin'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Seri No * ve Personel E-posta * zorunlu; Drive Linki isteğe bağlıdır.</p>
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
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyErrors(false);
                    setPage(1);
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left ${
                    !showOnlyErrors ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Doldurulan</span>
                  <strong className="mt-0.5 block text-lg">{rows.length}</strong>
                </button>
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-green-800">
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Zimmetlenecek</span>
                  <strong className="mt-0.5 block text-lg">{assignableRows.length}</strong>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-600">
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Zaten Eşleşen</span>
                  <strong className="mt-0.5 block text-lg">{skippedRows.length}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowOnlyErrors(true);
                    setPage(1);
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-left ${
                    showOnlyErrors ? 'border-red-300 bg-red-50 text-red-800' : 'border-red-200 bg-white text-red-700'
                  }`}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wide">Hatalı</span>
                  <strong className="mt-0.5 block text-lg">{invalidRows.length}</strong>
                </button>
              </div>

              {ignoredCount > 0 && (
                <p className="mt-2 text-[11px] font-medium text-slate-500">
                  Personel E-posta alanı boş olan {ignoredCount} cihaz değişiklik yapılmadan bırakılacak.
                </p>
              )}

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="hidden grid-cols-[58px_minmax(130px,1fr)_minmax(190px,1.4fr)_minmax(170px,1fr)_minmax(200px,1.4fr)] gap-3 border-b bg-slate-100/80 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 md:grid">
                  <span>Satır</span>
                  <span>Seri No</span>
                  <span>Personel</span>
                  <span>Kampüs</span>
                  <span>Kontrol</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {pageRows.map((row) => (
                    <div
                      key={`${row.rowNumber}-${row.serial}`}
                      className={`grid gap-2 px-3 py-3 md:grid-cols-[58px_minmax(130px,1fr)_minmax(190px,1.4fr)_minmax(170px,1fr)_minmax(200px,1.4fr)] md:items-center md:gap-3 ${
                        row.isValid ? 'bg-white' : 'bg-red-50/40'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-slate-400">#{row.rowNumber}</span>
                      <div className="min-w-0">
                        <p className="break-all text-sm font-black text-slate-800">{row.serial || '-'}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">{row.device?.deviceName || row.device?.brand || '-'}</p>
                        {row.driveLink && <p className="mt-0.5 truncate text-[10px] font-semibold text-blue-600">Drive belgesi eklenecek</p>}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-800">{row.person?.name || '-'}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">{row.personEmail || '-'}</p>
                      </div>
                      <div className="min-w-0 text-[11px] font-semibold text-slate-600">
                        <p className="truncate">{row.device?.campus || '-'}</p>
                        {row.person && <p className="mt-0.5 truncate text-slate-400">{row.person.campus || '-'}</p>}
                      </div>
                      {row.isValid ? (
                        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                          row.alreadyAssigned
                            ? 'border-slate-200 bg-slate-50 text-slate-600'
                            : 'border-green-200 bg-green-50 text-green-700'
                        }`}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {row.alreadyAssigned ? 'Zaten eşleşiyor' : 'Zimmete hazır'}
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
                    disabled={safePage <= 1}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                    aria-label="Önceki sayfa"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs font-bold text-slate-600">{safePage} / {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={safePage >= totalPages}
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
            Bir hatalı satır bile varsa hiçbir cihaz güncellenmez.
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
              disabled={isSubmitting || assignableRows.length === 0 || invalidRows.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[#0066b1] px-5 text-sm font-bold text-white shadow-lg shadow-blue-700/20 transition-colors hover:bg-[#005595] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {isSubmitting ? 'Uygulanıyor...' : `${assignableRows.length} Cihazı Zimmetle`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
