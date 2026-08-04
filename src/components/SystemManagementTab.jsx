import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSignature,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { postApiAction } from '../services/apiClient.js';
import { confirmAppAction, showAppAlert } from '../services/uiMessageService.js';
import { toTrLower } from '../utils/text.js';

const PAGE_SIZE = 20;
const AUDIT_PAGE_SIZE = 25;

const AUDIT_CATEGORY_OPTIONS = [
  ['', 'Tüm işlemler'],
  ['PASSWORD', 'Şifre işlemleri'],
  ['HARDWARE', 'Donanım'],
  ['ASSIGNMENT', 'Zimmet / İade'],
  ['TRANSFER', 'Transfer'],
  ['GLPI', 'GLPI'],
  ['SIGNATURE', 'İmza'],
  ['MANAGEMENT', 'Yönetim'],
  ['EXPORT', 'Dışa aktarım'],
  ['OTHER', 'Diğer'],
];

const AUDIT_CATEGORY_LABELS = Object.fromEntries(AUDIT_CATEGORY_OPTIONS);

function auditCategoryClass(category) {
  if (category === 'PASSWORD') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (category === 'TRANSFER') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (category === 'ASSIGNMENT') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (category === 'GLPI') return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  if (category === 'MANAGEMENT') return 'border-red-200 bg-red-50 text-red-700';
  if (category === 'SIGNATURE') return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700';
  if (category === 'EXPORT') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (category === 'HARDWARE') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

const emptyUserForm = {
  email: '',
  role: 'IT',
  campusId: '',
  active: true,
};

const emptyOverrideForm = {
  personId: '',
  campusId: '',
  status: '',
  reason: '',
};

const emptySignatureTitleForm = {
  titleId: null,
  titleTr: '',
  titleEn: '',
  templateKey: '1',
  active: true,
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function StatusChip({ active, className = '' }) {
  return active ? (
    <span className={`inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 ${className}`}>
      <CheckCircle2 className="h-3.5 w-3.5" /> Aktif
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 ${className}`}>
      <Ban className="h-3.5 w-3.5" /> Pasif
    </span>
  );
}

function RefreshButton({ onRefresh, loading }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#0066b1] shadow-sm transition-colors hover:bg-blue-50 disabled:opacity-50"
      title="Yönetim verilerini yenile"
      aria-label="Yönetim verilerini yenile"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );
}

function ModalFrame({ title, description, onClose, children }) {
  return (
    <div
      className="app-modal-backdrop fixed inset-0 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm"
      style={{ zIndex: 100000000 }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="app-modal-panel max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 shadow-sm hover:bg-slate-100"
            title="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SystemManagementTab({ currentUser, onRefreshData }) {
  const [overview, setOverview] = useState({
    users: [],
    campuses: [],
    personnel: [],
    signatureTitles: [],
    logs: [],
    auditTotal: 0,
  });
  const [activeSection, setActiveSection] = useState('access');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [overrideOnly, setOverrideOnly] = useState(false);
  const [personnelPage, setPersonnelPage] = useState(1);
  const [userForm, setUserForm] = useState(null);
  const [overrideForm, setOverrideForm] = useState(null);
  const [signatureTitleForm, setSignatureTitleForm] = useState(null);
  const [signatureSearch, setSignatureSearch] = useState('');
  const [signatureActiveFilter, setSignatureActiveFilter] = useState('all');
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCategory, setAuditCategory] = useState('');
  const [auditFromDate, setAuditFromDate] = useState('');
  const [auditToDate, setAuditToDate] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);

  const loadOverview = useCallback(async (showLoader = true) => {
    if (!currentUser?.token) return;
    if (showLoader) setLoading(true);
    try {
      const result = await postApiAction({
        action: 'adminFetchOverview',
        authToken: currentUser.token,
      });
      setOverview({
        users: result.users || [],
        campuses: result.campuses || [],
        personnel: result.personnel || [],
        signatureTitles: result.signatureTitles || [],
        logs: result.logs || [],
        auditTotal: Number(result.auditTotal || 0),
      });
    } catch (error) {
      showAppAlert(`Sistem yönetimi verileri alınamadı: ${error.message}`, {
        type: 'error',
        title: 'Yönetim paneli',
      });
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [currentUser?.token]);

  const loadAuditLogs = useCallback(async () => {
    if (!currentUser?.token) return;
    setAuditLoading(true);
    try {
      const result = await postApiAction({
        action: 'adminFetchAuditLogs',
        authToken: currentUser.token,
        page: auditPage,
        pageSize: AUDIT_PAGE_SIZE,
        search: auditSearch,
        category: auditCategory,
        fromDate: auditFromDate,
        toDate: auditToDate,
      });
      setAuditLogs(Array.isArray(result.logs) ? result.logs : []);
      setAuditTotal(Number(result.total || 0));
      setAuditTotalPages(Math.max(1, Number(result.totalPages || 1)));
    } catch (error) {
      showAppAlert(`Denetim kayıtları alınamadı: ${error.message}`, {
        type: 'error',
        title: 'Denetim kayıtları',
      });
    } finally {
      setAuditLoading(false);
    }
  }, [
    auditCategory,
    auditFromDate,
    auditPage,
    auditSearch,
    auditToDate,
    currentUser?.token,
  ]);

  useEffect(() => {
    loadOverview(true);
  }, [loadOverview]);

  useEffect(() => {
    if (activeSection !== 'audit') return undefined;
    const timeoutId = window.setTimeout(loadAuditLogs, auditSearch ? 300 : 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeSection, loadAuditLogs, auditSearch]);

  const activeCampuses = useMemo(
    () => overview.campuses.filter((campus) => campus.active),
    [overview.campuses]
  );

  const filteredPersonnel = useMemo(() => {
    const needle = toTrLower(search);
    return overview.personnel.filter((person) => {
      if (overrideOnly && !person.hasOverride) return false;
      if (!needle) return true;
      return toTrLower(
        [
          person.name,
          person.email,
          person.department,
          person.campus,
          person.sourceCampus,
        ].join(' ')
      ).includes(needle);
    });
  }, [overview.personnel, overrideOnly, search]);

  const filteredSignatureTitles = useMemo(() => {
    const needle = toTrLower(signatureSearch);
    return overview.signatureTitles.filter((title) => {
      if (signatureActiveFilter === 'active' && !title.active) return false;
      if (signatureActiveFilter === 'passive' && title.active) return false;
      if (!needle) return true;
      return toTrLower(`${title.titleTr} ${title.titleEn}`).includes(needle);
    });
  }, [overview.signatureTitles, signatureActiveFilter, signatureSearch]);

  const personnelTotalPages = Math.max(1, Math.ceil(filteredPersonnel.length / PAGE_SIZE));
  const visiblePersonnel = filteredPersonnel.slice(
    (personnelPage - 1) * PAGE_SIZE,
    personnelPage * PAGE_SIZE
  );

  useEffect(() => {
    setPersonnelPage(1);
  }, [search, overrideOnly]);

  useEffect(() => {
    if (personnelPage > personnelTotalPages) setPersonnelPage(personnelTotalPages);
  }, [personnelPage, personnelTotalPages]);

  const saveUser = async () => {
    if (!userForm) return;
    setSaving(true);
    try {
      await postApiAction({
        action: 'adminSaveAuthorizedUser',
        authToken: currentUser.token,
        ...userForm,
      });
      setUserForm(null);
      await loadOverview(false);
      showAppAlert('Yetkili kullanıcı kaydedildi. Kullanıcının açık oturumları kapatıldı.', {
        type: 'success',
        title: 'Yetki güncellendi',
      });
    } catch (error) {
      showAppAlert(error.message, { type: 'error', title: 'Yetki kaydedilemedi' });
    } finally {
      setSaving(false);
    }
  };

  const saveOverride = async () => {
    if (!overrideForm) return;
    setSaving(true);
    try {
      await postApiAction({
        action: 'adminSavePersonnelOverride',
        authToken: currentUser.token,
        ...overrideForm,
      });
      setOverrideForm(null);
      await Promise.all([loadOverview(false), onRefreshData?.(false)]);
      showAppAlert('Personel düzeltmesi uygulandı.', {
        type: 'success',
        title: 'Düzeltme kaydedildi',
      });
    } catch (error) {
      showAppAlert(error.message, { type: 'error', title: 'Düzeltme kaydedilemedi' });
    } finally {
      setSaving(false);
    }
  };

  const clearOverride = async (person) => {
    const confirmed = await confirmAppAction({
      title: 'Düzeltmeyi kaldır',
      message: `${person.name} için yönetici düzeltmesi kaldırılacak ve senkron kaydı yeniden geçerli olacak.`,
      confirmLabel: 'Düzeltmeyi kaldır',
      cancelLabel: 'Vazgeç',
      type: 'danger',
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      await postApiAction({
        action: 'adminClearPersonnelOverride',
        authToken: currentUser.token,
        personId: person.id,
      });
      await Promise.all([loadOverview(false), onRefreshData?.(false)]);
      showAppAlert('Personel düzeltmesi kaldırıldı.', {
        type: 'success',
        title: 'Senkron kaydı etkin',
      });
    } catch (error) {
      showAppAlert(error.message, { type: 'error', title: 'Düzeltme kaldırılamadı' });
    } finally {
      setSaving(false);
    }
  };

  const saveSignatureTitle = async () => {
    if (!signatureTitleForm) return;
    setSaving(true);
    try {
      await postApiAction({
        action: 'adminSaveSignatureTitle',
        authToken: currentUser.token,
        ...signatureTitleForm,
      });
      setSignatureTitleForm(null);
      await loadOverview(false);
      showAppAlert('İmza ünvanı kaydedildi.', {
        type: 'success',
        title: 'Ünvan güncellendi',
      });
    } catch (error) {
      showAppAlert(error.message, { type: 'error', title: 'Ünvan kaydedilemedi' });
    } finally {
      setSaving(false);
    }
  };

  const openUserForm = (user = null) => {
    setUserForm(
      user
        ? {
            email: user.email,
            role: user.role,
            campusId: user.campusId,
            active: user.active,
          }
        : { ...emptyUserForm }
    );
  };

  const openOverrideForm = (person) => {
    setOverrideForm({
      ...emptyOverrideForm,
      personId: person.id,
      campusId: person.overrideCampusId || '',
      status: person.overrideStatus || '',
      reason: person.overrideReason || '',
      person,
    });
  };

  const openSignatureTitleForm = (title = null) => {
    setSignatureTitleForm(
      title
        ? {
            titleId: title.id,
            titleTr: title.titleTr,
            titleEn: title.titleEn,
            templateKey: title.templateKey || '1',
            active: title.active,
          }
        : { ...emptySignatureTitleForm }
    );
  };

  if (loading) {
    return (
      <div className="app-tab-panel system-management-tab flex min-h-[420px] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin text-[#0066b1]" />
          <p className="text-sm font-bold">Yönetim verileri hazırlanıyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-tab-panel system-management-tab">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 rounded-lg bg-slate-100 p-1 sm:max-w-2xl">
          {[
            ['access', ShieldCheck, 'Yetkili Kullanıcılar', 'Yetki', overview.users.length],
            [
              'personnel',
              Users,
              'Personel Düzeltmeleri',
              'Personel',
              overview.personnel.filter((item) => item.hasOverride).length,
            ],
            [
              'signatureTitles',
              FileSignature,
              'İmza Ünvanları',
              'Ünvan',
              overview.signatureTitles.length,
            ],
            [
              'audit',
              ScrollText,
              'Denetim Kayıtları',
              'Kayıt',
              overview.auditTotal,
            ],
          ].map(([key, Icon, label, mobileLabel, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveSection(key)}
              title={label}
              aria-label={label}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-1.5 py-2.5 text-[11px] font-bold transition-colors sm:px-2 sm:text-sm ${
                activeSection === key
                  ? 'bg-white text-[#0066b1] shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate sm:hidden">{mobileLabel}</span>
              <span className="hidden truncate sm:inline">{label}</span>
              <span className="hidden rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 sm:inline-flex">
                {count}
              </span>
            </button>
          ))}
        </div>
        <RefreshButton
          onRefresh={activeSection === 'audit' ? loadAuditLogs : () => loadOverview(true)}
          loading={activeSection === 'audit' ? auditLoading : loading}
        />
      </div>

      {activeSection === 'access' && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">Uygulama erişimi</h2>
              <p className="hidden text-xs text-slate-500 sm:block">
                Pasifleştirilen kullanıcının mevcut oturumları da kapatılır.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openUserForm()}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0066b1] px-3 text-xs font-bold text-white shadow-md hover:bg-[#005595] sm:h-10 sm:px-4 sm:text-sm"
            >
              <UserPlus className="h-4 w-4" /> Yetkili ekle
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="hidden grid-cols-[minmax(220px,1.6fr)_120px_minmax(160px,1fr)_90px_48px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 md:grid">
              <span>Kullanıcı</span>
              <span>Rol</span>
              <span>Kampüs</span>
              <span>Durum</span>
              <span />
            </div>
            {overview.users.map((user) => (
              <div
                key={user.email}
                className="grid grid-cols-[minmax(0,1fr)_36px] items-center gap-x-3 gap-y-2 border-b border-slate-100 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(220px,1.6fr)_120px_minmax(160px,1fr)_90px_48px] md:gap-3 md:px-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {user.name || user.email}
                  </p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                  {user.protected && (
                    <span className="mt-1 inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-[#0066b1]">
                      Sunucu süper yöneticisi
                    </span>
                  )}
                </div>
                <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs md:hidden">
                  <span className="font-bold text-slate-700">{user.role}</span>
                  <span className="text-slate-300" aria-hidden="true">•</span>
                  <span className="flex min-w-0 items-center gap-1 text-slate-600">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{user.campus}</span>
                  </span>
                  <StatusChip active={user.active} className="ml-auto shrink-0 py-0.5" />
                </div>
                <div className="hidden text-xs font-bold text-slate-700 md:block">{user.role}</div>
                <div className="hidden items-center gap-1.5 text-xs text-slate-600 md:flex">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span>{user.campus}</span>
                </div>
                <div className="hidden md:block">
                  <StatusChip active={user.active} />
                </div>
                <button
                  type="button"
                  onClick={() => openUserForm(user)}
                  disabled={user.protected}
                  className="col-start-2 row-start-1 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#0066b1] shadow-sm hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-35 md:col-start-auto md:row-start-auto"
                  title={user.protected ? 'Sunucu süper yöneticisi panelden değiştirilemez' : 'Yetkiyi düzenle'}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeSection === 'personnel' && (
        <section>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Personel düzeltmeleri</h2>
              <p className="text-xs text-slate-500">
                Kaynak senkron verisi korunur; düzeltme kaldırıldığında yeniden görünür.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm lg:w-80">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Ad, e-posta, ünvan veya kampüs ara"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} title="Aramayı temizle">
                    <X className="h-4 w-4 text-slate-400" />
                  </button>
                )}
              </label>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm">
                <input
                  type="checkbox"
                  checked={overrideOnly}
                  onChange={(event) => setOverrideOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0066b1]"
                />
                Yalnız düzeltilenler
              </label>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="hidden grid-cols-[minmax(220px,1.5fr)_minmax(170px,1fr)_minmax(180px,1fr)_110px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 md:grid">
              <span>Personel</span>
              <span>Etkin kampüs</span>
              <span>Kaynak / düzeltme</span>
              <span>İşlem</span>
            </div>
            {visiblePersonnel.map((person) => (
              <div
                key={person.id}
                className="grid gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(220px,1.5fr)_minmax(170px,1fr)_minmax(180px,1fr)_110px] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{person.name}</p>
                  <p className="truncate text-xs text-slate-500">{person.email || person.id}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">{person.department}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-700">{person.campus}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Durum: {person.status}</p>
                </div>
                <div className="min-w-0">
                  {person.hasOverride ? (
                    <>
                      <span className="inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                        Yönetici düzeltmesi
                      </span>
                      <p className="mt-1 truncate text-[11px] text-slate-500" title={person.overrideReason}>
                        {person.overrideReason}
                      </p>
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">Senkron kaydı kullanılıyor</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openOverrideForm(person)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-[#0066b1] shadow-sm hover:bg-blue-50"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Düzelt
                  </button>
                  {person.hasOverride && (
                    <button
                      type="button"
                      onClick={() => clearOverride(person)}
                      disabled={saving}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 shadow-sm hover:bg-red-50 disabled:opacity-50"
                      title="Düzeltmeyi kaldır"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {visiblePersonnel.length === 0 && (
              <div className="px-4 py-12 text-center text-sm font-bold text-slate-400">
                Arama ölçütlerine uygun personel bulunamadı.
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{filteredPersonnel.length} personel</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPersonnelPage((page) => Math.max(1, page - 1))}
                disabled={personnelPage <= 1}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                title="Önceki sayfa"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-20 text-center font-bold text-slate-600">
                {personnelPage} / {personnelTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setPersonnelPage((page) => Math.min(personnelTotalPages, page + 1))}
                disabled={personnelPage >= personnelTotalPages}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                title="Sonraki sayfa"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      {activeSection === 'signatureTitles' && (
        <section>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">İmza ünvanları</h2>
              <p className="text-xs text-slate-500">
                Türkçe ve İngilizce ünvan karşılıkları ile imza şablonları.
              </p>
            </div>
            <button
              type="button"
              onClick={() => openSignatureTitleForm()}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0066b1] px-4 text-sm font-bold text-white shadow-md hover:bg-[#005595]"
            >
              <Plus className="h-4 w-4" /> Ünvan ekle
            </button>
          </div>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={signatureSearch}
                onChange={(event) => setSignatureSearch(event.target.value)}
                placeholder="Türkçe veya İngilizce ünvan ara"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              {signatureSearch && (
                <button
                  type="button"
                  onClick={() => setSignatureSearch('')}
                  title="Aramayı temizle"
                >
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              )}
            </label>
            <select
              value={signatureActiveFilter}
              onChange={(event) => setSignatureActiveFilter(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none"
              aria-label="Ünvan durumu"
            >
              <option value="all">Tüm durumlar</option>
              <option value="active">Aktif</option>
              <option value="passive">Pasif</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="hidden grid-cols-[minmax(210px,1fr)_minmax(210px,1fr)_100px_90px_48px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 md:grid">
              <span>Türkçe ünvan</span>
              <span>İngilizce ünvan</span>
              <span>Şablon</span>
              <span>Durum</span>
              <span />
            </div>
            {filteredSignatureTitles.map((title) => (
              <div
                key={title.id}
                className="grid grid-cols-[minmax(0,1fr)_40px] gap-x-3 gap-y-2 border-b border-slate-100 px-3 py-3 last:border-b-0 md:grid-cols-[minmax(210px,1fr)_minmax(210px,1fr)_100px_90px_48px] md:items-center md:gap-3 md:px-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">{title.titleTr}</p>
                  <p className="mt-0.5 text-xs text-slate-500 md:hidden">
                    {title.titleEn || 'İngilizce karşılık yok'}
                  </p>
                </div>
                <div className="hidden min-w-0 text-xs text-slate-600 md:block">
                  {title.titleEn || '-'}
                </div>
                <div className="col-span-2 flex items-center gap-2 md:col-span-1">
                  <span className="inline-flex rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-[#0066b1]">
                    Şablon {title.templateKey || '1'}
                  </span>
                  <StatusChip active={title.active} className="md:hidden" />
                </div>
                <div className="hidden md:block">
                  <StatusChip active={title.active} />
                </div>
                <button
                  type="button"
                  onClick={() => openSignatureTitleForm(title)}
                  className="col-start-2 row-start-1 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-[#0066b1] shadow-sm hover:bg-blue-50 md:col-start-auto md:row-start-auto"
                  title="Ünvanı düzenle"
                  aria-label={`${title.titleTr} ünvanını düzenle`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            ))}
            {filteredSignatureTitles.length === 0 && (
              <div className="px-4 py-12 text-center text-sm font-bold text-slate-400">
                Arama ölçütlerine uygun imza ünvanı bulunamadı.
              </div>
            )}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            {filteredSignatureTitles.length} / {overview.signatureTitles.length} ünvan
          </p>
        </section>
      )}

      {activeSection === 'audit' && (
        <section>
          <div className="mb-4 flex flex-col gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">Tüm sistem işlemleri</h2>
              <p className="text-xs text-slate-500">
                Kim, hangi hedefte, hangi işlemi ve ne zaman yaptı. Parola, OTP ve gizli
                anahtar değerleri kayıtlara alınmaz.
              </p>
            </div>
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(220px,1fr)_180px_150px_150px_auto]">
              <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 shadow-sm">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={auditSearch}
                  onChange={(event) => {
                    setAuditSearch(event.target.value);
                    setAuditPage(1);
                  }}
                  placeholder="Yetkili, işlem veya hedef ara"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <select
                value={auditCategory}
                onChange={(event) => {
                  setAuditCategory(event.target.value);
                  setAuditPage(1);
                }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none"
                aria-label="Denetim kategorisi"
              >
                {AUDIT_CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value || 'all'} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={auditFromDate}
                onChange={(event) => {
                  setAuditFromDate(event.target.value);
                  setAuditPage(1);
                }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none"
                title="Başlangıç tarihi"
                aria-label="Başlangıç tarihi"
              />
              <input
                type="date"
                value={auditToDate}
                onChange={(event) => {
                  setAuditToDate(event.target.value);
                  setAuditPage(1);
                }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm outline-none"
                title="Bitiş tarihi"
                aria-label="Bitiş tarihi"
              />
              <button
                type="button"
                onClick={() => {
                  setAuditSearch('');
                  setAuditCategory('');
                  setAuditFromDate('');
                  setAuditToDate('');
                  setAuditPage(1);
                }}
                disabled={
                  !auditSearch && !auditCategory && !auditFromDate && !auditToDate
                }
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-100 disabled:opacity-40"
              >
                <X className="h-4 w-4" /> Temizle
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {auditTotal.toLocaleString('tr-TR')} kayıt bulundu. Kayıtlar SHA-256 zincirli
              ve yalnız eklenebilir yapıdadır.
            </p>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
            {auditLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
                <Loader2 className="h-7 w-7 animate-spin text-[#0066b1]" />
              </div>
            )}
            {auditLogs.map((log) => (
              <div
                key={log.id}
                className="grid gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0 md:grid-cols-[145px_minmax(190px,240px)_1fr]"
              >
                <div>
                  <p className="text-xs font-bold text-slate-600">
                    {formatDateTime(log.createdAt)}
                  </p>
                  <span
                    className={`mt-1 inline-flex rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${auditCategoryClass(
                      log.category
                    )}`}
                  >
                    {AUDIT_CATEGORY_LABELS[log.category] || 'Diğer'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#0066b1]">{log.action}</p>
                  <p className="mt-1 truncate text-[11px] font-medium text-slate-500">
                    İşlemi yapan: {log.executedBy}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs leading-relaxed text-slate-700">{log.details}</p>
                  <details className="mt-2 text-[10px] text-slate-400">
                    <summary className="cursor-pointer select-none font-bold hover:text-slate-600">
                      Teknik detaylar
                    </summary>
                    <div className="mt-1 space-y-1 break-all rounded-md bg-slate-50 p-2 font-mono">
                      <p>
                        Zincir: {log.chainValid ? 'Doğrulandı' : 'Doğrulanamadı'} /{' '}
                        {log.chainHash}
                      </p>
                      {log.clientInfo && <p>İstemci: {log.clientInfo}</p>}
                      {log.fileHash && <p>Dosya: {log.fileHash}</p>}
                      {/^(https?:\/\/)/i.test(log.driveLink || '') && (
                        <a
                          href={log.driveLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-sans font-bold text-[#0066b1] hover:underline"
                        >
                          İlişkili belgeyi aç
                        </a>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            ))}
            {!auditLoading && auditLogs.length === 0 && (
              <div className="px-4 py-12 text-center text-sm font-bold text-slate-400">
                Bu ölçütlere uygun denetim kaydı bulunamadı.
              </div>
            )}
          </div>
          {auditTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500">
                Sayfa {auditPage} / {auditTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuditPage((page) => Math.max(1, page - 1))}
                  disabled={auditPage <= 1 || auditLoading}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm disabled:opacity-40"
                  title="Önceki sayfa"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAuditPage((page) => Math.min(auditTotalPages, page + 1))
                  }
                  disabled={auditPage >= auditTotalPages || auditLoading}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm disabled:opacity-40"
                  title="Sonraki sayfa"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {signatureTitleForm && (
        <ModalFrame
          title={signatureTitleForm.titleId ? 'İmza ünvanını düzenle' : 'İmza ünvanı ekle'}
          onClose={() => setSignatureTitleForm(null)}
        >
          <div className="space-y-4 p-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">
                Türkçe ünvan
              </span>
              <input
                value={signatureTitleForm.titleTr}
                onChange={(event) =>
                  setSignatureTitleForm((form) => ({ ...form, titleTr: event.target.value }))
                }
                maxLength={240}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#0066b1] focus:ring-2 focus:ring-blue-100"
                placeholder="Örn. Bilgi İşlem Uzmanı"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">
                İngilizce ünvan
              </span>
              <input
                value={signatureTitleForm.titleEn}
                onChange={(event) =>
                  setSignatureTitleForm((form) => ({ ...form, titleEn: event.target.value }))
                }
                maxLength={240}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#0066b1] focus:ring-2 focus:ring-blue-100"
                placeholder="Örn. IT Specialist"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">
                  İmza şablonu
                </span>
                <select
                  value={signatureTitleForm.templateKey}
                  onChange={(event) =>
                    setSignatureTitleForm((form) => ({
                      ...form,
                      templateKey: event.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#0066b1]"
                >
                  <option value="1">Şablon 1</option>
                  <option value="2">Şablon 2</option>
                  <option value="3">Şablon 3</option>
                  <option value="4">Şablon 4</option>
                </select>
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:mt-[22px] sm:h-11 sm:py-0">
                <span className="text-sm font-bold text-slate-800">Aktif</span>
                <input
                  type="checkbox"
                  checked={signatureTitleForm.active}
                  onChange={(event) =>
                    setSignatureTitleForm((form) => ({
                      ...form,
                      active: event.target.checked,
                    }))
                  }
                  className="h-5 w-5 rounded border-slate-300 text-[#0066b1]"
                />
              </label>
            </div>
          </div>
          <div className="flex gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button
              type="button"
              onClick={() => setSignatureTitleForm(null)}
              className="h-11 flex-1 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={saveSignatureTitle}
              disabled={saving || !signatureTitleForm.titleTr.trim()}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#0066b1] text-sm font-bold text-white shadow-md disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Kaydet
            </button>
          </div>
        </ModalFrame>
      )}

      {userForm && (
        <ModalFrame
          title={userForm.email ? 'Yetkili kullanıcıyı düzenle' : 'Yetkili kullanıcı ekle'}
          description="Süper yönetici yetkisi burada dağıtılamaz; yalnız sunucu ayarından verilir."
          onClose={() => setUserForm(null)}
        >
          <div className="space-y-4 p-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">E-posta</span>
              <input
                type="email"
                value={userForm.email}
                onChange={(event) => setUserForm((form) => ({ ...form, email: event.target.value }))}
                disabled={Boolean(overview.users.find((item) => item.email === userForm.email))}
                className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#0066b1] focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                placeholder="kullanici@istek.k12.tr"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">Rol</span>
                <select
                  value={userForm.role}
                  onChange={(event) => setUserForm((form) => ({ ...form, role: event.target.value }))}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#0066b1]"
                >
                  <option value="IT">IT</option>
                  <option value="HQ IT">HQ IT</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">Kampüs</span>
                <select
                  value={userForm.campusId}
                  onChange={(event) =>
                    setUserForm((form) => ({ ...form, campusId: event.target.value }))
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#0066b1]"
                >
                  <option value="">Kampüs seçin</option>
                  {activeCampuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <span>
                <span className="block text-sm font-bold text-slate-800">Uygulama erişimi</span>
                <span className="block text-xs text-slate-500">
                  Pasife alındığında açık oturumları sonlandırılır.
                </span>
              </span>
              <input
                type="checkbox"
                checked={userForm.active}
                onChange={(event) =>
                  setUserForm((form) => ({ ...form, active: event.target.checked }))
                }
                className="h-5 w-5 rounded border-slate-300 text-[#0066b1]"
              />
            </label>
          </div>
          <div className="flex gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button
              type="button"
              onClick={() => setUserForm(null)}
              className="h-11 flex-1 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={saveUser}
              disabled={saving || !userForm.email || !userForm.campusId}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#0066b1] text-sm font-bold text-white shadow-md disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Kaydet
            </button>
          </div>
        </ModalFrame>
      )}

      {overrideForm && (
        <ModalFrame
          title="Personel kaydını düzelt"
          description={`${overrideForm.person?.name || overrideForm.personId} • Kaynak kampüs: ${
            overrideForm.person?.sourceCampus || 'Bilinmiyor'
          }`}
          onClose={() => setOverrideForm(null)}
        >
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Bu işlem kaynak personel kaydını silmez. Düzeltme kaldırıldığında senkron
                  sisteminden gelen kampüs ve durum yeniden kullanılır.
                </span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">
                  Kampüs düzeltmesi
                </span>
                <select
                  value={overrideForm.campusId}
                  onChange={(event) =>
                    setOverrideForm((form) => ({ ...form, campusId: event.target.value }))
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#0066b1]"
                >
                  <option value="">Kampüsü değiştirme</option>
                  {activeCampuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-bold text-slate-600">
                  Durum düzeltmesi
                </span>
                <select
                  value={overrideForm.status}
                  onChange={(event) =>
                    setOverrideForm((form) => ({ ...form, status: event.target.value }))
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#0066b1]"
                >
                  <option value="">Durumu değiştirme</option>
                  <option value="Aktif">Aktif</option>
                  <option value="Pasif">Pasif</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">
                Düzeltme nedeni
              </span>
              <textarea
                value={overrideForm.reason}
                onChange={(event) =>
                  setOverrideForm((form) => ({ ...form, reason: event.target.value }))
                }
                maxLength={500}
                rows={3}
                className="w-full resize-none rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-[#0066b1] focus:ring-2 focus:ring-blue-100"
                placeholder="Örn. Personel 27.07.2026 tarihinde Genel Müdürlüğe geçti."
              />
            </label>
          </div>
          <div className="flex gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <button
              type="button"
              onClick={() => setOverrideForm(null)}
              className="h-11 flex-1 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={saveOverride}
              disabled={
                saving ||
                (!overrideForm.campusId && !overrideForm.status) ||
                overrideForm.reason.trim().length < 3
              }
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#0066b1] text-sm font-bold text-white shadow-md disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Düzeltmeyi uygula
            </button>
          </div>
        </ModalFrame>
      )}
    </div>
  );
}
