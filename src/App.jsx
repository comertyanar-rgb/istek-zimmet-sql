import React, { lazy, Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';
import {
  RefreshCw,
  Monitor,
  Users,
  FileSignature,
  Search,
  CheckCircle2,
  Laptop,
  HardDrive,
  Mouse,
  Keyboard,
  Printer,
  Building2,
  FileText,
  Loader2,
  X,
  ExternalLink,
  History,
  Archive,
  Trash2,
  Send,
  Download,
  Table,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Tag,
  QrCode,
  Camera,
  ShieldCheck,
  FileSpreadsheet,
  Wrench,
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { GAS_URL, GOOGLE_CLIENT_ID } from './config/appConfig.js';
import {
  API_SESSION_EXPIRED_EVENT,
  isRetryableApiError,
  OPERATION_QUEUE_REFRESH_EVENT,
  postApiAction,
} from './services/apiClient.js';
import { BRANDS_MODELS, CAMPUS_CODES, TYPE_BRANDS } from './constants/inventory.js';
import { hasCurrentAssignmentDocument } from './utils/hardware.js';
import { toTrLower } from './utils/text.js';
import { openSafeExternalUrl, toSafeDriveEmbedUrl, toSafeExternalUrl } from './utils/safeUrls.js';
import { downloadGeneratedExport } from './utils/exportDownload.js';
import { ClipboardCopy } from './components/ClipboardCopy.jsx';
import { Pagination } from './components/Pagination.jsx';
import { AssignmentFloatingAction } from './components/AssignmentFloatingAction.jsx';
import { ListSkeleton, WorkspaceSkeleton } from './components/LoadingSkeletons.jsx';
import { ThemeToggle } from './components/ThemeToggle.jsx';
import { UserSettingsMenu } from './components/UserSettingsMenu.jsx';
import { confirmAppAction, showAppAlert } from './services/uiMessageService.js';
import { useAppTheme } from './hooks/useAppTheme.js';

const lazyNamed = (loader, exportName) =>
  lazy(() => loader().then((module) => ({ default: module[exportName] })));

const DATA_CACHE_PREFIX = 'istek_it_cache_v3:';
const DATA_CACHE_TTL_MS = 10 * 60 * 1000;
const FULL_DATA_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const COOKIE_SESSION_SENTINEL = '__HTTP_ONLY_COOKIE_SESSION__';
let pendingDataCacheWrite = null;

function formatTransferDateTime(value) {
  if (!value) return 'Tarih bilgisi yok';

  const raw = String(value).trim();
  if (/^\d{1,2}\.\d{1,2}\.\d{4}/.test(raw)) return raw;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return raw || 'Tarih bilgisi yok';

  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getDataCacheKey(user) {
  if (!user?.email || !user?.role || !user?.campus) return '';
  return `${DATA_CACHE_PREFIX}${encodeURIComponent(
    `${String(user.email).toLowerCase()}|${user.role}|${user.campus}`
  )}`;
}

function clearStoredDataCaches() {
  cancelScheduledDataCacheWrite();
  localStorage.removeItem('istek_it_cache');
  for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = sessionStorage.key(index);
    if (key?.startsWith('istek_it_cache_v')) sessionStorage.removeItem(key);
  }
}

function writeDataCache(user, data) {
  const key = getDataCacheKey(user);
  if (!key) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        owner: {
          email: String(user.email).toLowerCase(),
          role: user.role,
          campus: user.campus,
        },
        cachedAt: Date.now(),
        syncServerTime: data.sync?.serverTime || data.syncServerTime || new Date().toISOString(),
        personnel: data.personnel || [],
        hardware: data.hardware || [],
      })
    );
  } catch {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Cache kullanılamıyorsa ana veri akışını etkileme.
    }
  }
}

function cancelScheduledDataCacheWrite() {
  if (!pendingDataCacheWrite || typeof window === 'undefined') return;
  if (pendingDataCacheWrite.type === 'idle' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(pendingDataCacheWrite.handle);
  } else {
    window.clearTimeout(pendingDataCacheWrite.handle);
  }
  pendingDataCacheWrite = null;
}

function scheduleDataCacheWrite(user, data) {
  if (typeof window === 'undefined') return;
  cancelScheduledDataCacheWrite();

  const run = () => {
    pendingDataCacheWrite = null;
    writeDataCache(user, data);
  };

  if (typeof window.requestIdleCallback === 'function') {
    pendingDataCacheWrite = {
      type: 'idle',
      handle: window.requestIdleCallback(run, { timeout: 2000 }),
    };
    return;
  }

  pendingDataCacheWrite = {
    type: 'timeout',
    handle: window.setTimeout(run, 50),
  };
}

function mergeRecordsById(currentRecords, changedRecords) {
  if (!Array.isArray(changedRecords) || changedRecords.length === 0) return currentRecords;

  const merged = new Map((currentRecords || []).map((record) => [record.id, record]));
  changedRecords.forEach((record) => {
    if (!record?.id) return;
    merged.set(record.id, { ...(merged.get(record.id) || {}), ...record });
  });
  return Array.from(merged.values());
}

function hardwareVisualFingerprint(item) {
  return [
    item?.status,
    item?.assignedTo,
    item?.deviceName,
    item?.groupName,
    item?.notes,
    item?.campus,
    item?.driveLink,
  ].map((value) => String(value ?? '')).join('|');
}

function personnelVisualFingerprint(item) {
  return [
    item?.name,
    item?.status,
    item?.department,
    item?.campus,
    item?.signatureStatus,
    item?.signatureLink,
  ].map((value) => String(value ?? '')).join('|');
}

function readDataCache(user) {
  const key = getDataCacheKey(user);
  if (!key) return null;

  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) || 'null');
    const ownerMatches =
      parsed?.owner?.email === String(user.email).toLowerCase() &&
      parsed?.owner?.role === user.role &&
      parsed?.owner?.campus === user.campus;
    const isFresh = Number(parsed?.cachedAt || 0) > Date.now() - DATA_CACHE_TTL_MS;
    if (!ownerMatches || !isFresh) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(key);
    return null;
  }
}

const AdPasswordResetModal = lazyNamed(
  () => import('./components/AdPasswordResetModal.jsx'),
  'AdPasswordResetModal'
);
const GlpiMissingTab = lazyNamed(() => import('./components/GlpiMissingTab.jsx'), 'GlpiMissingTab');
const HardwareProfileModal = lazyNamed(
  () => import('./components/HardwareProfileModal.jsx'),
  'HardwareProfileModal'
);
const OperationQueueIndicator = lazyNamed(
  () => import('./components/OperationQueueIndicator.jsx'),
  'OperationQueueIndicator'
);
const QrScanTab = lazyNamed(() => import('./components/QrScanTab.jsx'), 'QrScanTab');
const ReturnZimmetModal = lazyNamed(() => import('./components/ReturnZimmetModal.jsx'), 'ReturnZimmetModal');
const QrLabelModal = lazyNamed(() => import('./components/QrLabelModal.jsx'), 'QrLabelModal');
const HandwrittenStatementPad = lazyNamed(
  () => import('./components/HandwrittenStatementPad.jsx'),
  'HandwrittenStatementPad'
);
const SignatureCreateModal = lazyNamed(
  () => import('./components/SignatureCreateModal.jsx'),
  'SignatureCreateModal'
);
const ZimmetDocumentModal = lazyNamed(
  () => import('./components/ZimmetDocumentModal.jsx'),
  'ZimmetDocumentModal'
);
const SystemManagementTab = lazyNamed(
  () => import('./components/SystemManagementTab.jsx'),
  'SystemManagementTab'
);
const BulkHardwareImportModal = lazyNamed(
  () => import('./components/BulkHardwareImportModal.jsx'),
  'BulkHardwareImportModal'
);
const BulkInitialAssignmentModal = lazyNamed(
  () => import('./components/BulkInitialAssignmentModal.jsx'),
  'BulkInitialAssignmentModal'
);

const LazyPanelFallback = ({ label = 'Yükleniyor...' }) => (
  <div className="app-tab-panel" aria-label={label}>
    <ListSkeleton rows={5} compact />
  </div>
);

const LazyInlineFallback = ({ label = 'Hazırlanıyor...' }) => (
  <div className="flex items-center justify-center gap-2 text-xs font-bold text-slate-500">
    <Loader2 className="h-4 w-4 animate-spin text-[#0066b1]" />
    {label}
  </div>
);

// --- MAIN APP ---
function GoogleSignInControls({ onAccessTokenSuccess, onError }) {
  const [isOpeningGoogle, setIsOpeningGoogle] = useState(false);
  const [loginHint, setLoginHint] = useState('');
  const loginTimeoutRef = useRef(null);

  const clearLoginTimer = () => {
    if (loginTimeoutRef.current) {
      clearTimeout(loginTimeoutRef.current);
      loginTimeoutRef.current = null;
    }
  };

  useEffect(() => () => clearLoginTimer(), []);

  const loginWithOAuth = useGoogleLogin({
    flow: 'implicit',
    scope: 'openid email profile',
    ux_mode: 'popup',
    prompt: 'select_account',
    onSuccess: (tokenResponse) => {
      clearLoginTimer();
      setIsOpeningGoogle(false);
      setLoginHint('');
      onAccessTokenSuccess(tokenResponse);
    },
    onError: (error) => {
      clearLoginTimer();
      setIsOpeningGoogle(false);
      setLoginHint('');
      onError(error);
    },
    onNonOAuthError: (error) => {
      clearLoginTimer();
      setIsOpeningGoogle(false);
      if (error?.type === 'popup_closed' || error?.type === 'popup_closed_by_user') {
        setLoginHint('Google penceresi kapatıldı. Tekrar giriş yapabilirsiniz.');
        return;
      }
      setLoginHint('');
      onError(error);
    },
  });

  const startGoogleLogin = () => {
    clearLoginTimer();
    setIsOpeningGoogle(true);
    setLoginHint('Google hesap penceresi açılıyor...');
    loginTimeoutRef.current = setTimeout(() => {
      setIsOpeningGoogle(false);
      setLoginHint('Google penceresi boş kalırsa kapatıp tekrar deneyin.');
    }, 12000);

    try {
      loginWithOAuth();
    } catch (error) {
      clearLoginTimer();
      setIsOpeningGoogle(false);
      setLoginHint('');
      onError(error);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={startGoogleLogin}
        disabled={isOpeningGoogle}
        className="h-11 px-6 rounded-full bg-[#0066b1] text-white text-sm font-black shadow-lg shadow-blue-900/20 active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-wait flex items-center gap-2"
      >
        {isOpeningGoogle && <Loader2 className="w-4 h-4 animate-spin" />}
        {isOpeningGoogle ? 'Google Bekleniyor...' : 'Google ile Giriş Yap'}
      </button>
      {loginHint && (
        <p className="max-w-[260px] text-center text-[11px] leading-relaxed font-semibold text-slate-500">
          {loginHint}
        </p>
      )}
    </div>
  );
}

function getAdPasswordJobView(status) {
  const normalized = String(status || '').toLocaleUpperCase('tr-TR');
  if (normalized.includes('HATA')) {
    return { label: 'Hata', tone: 'bg-red-50 text-red-700 border-red-200', active: false };
  }
  if (normalized.includes('TAMAM') || normalized.includes('BASAR') || normalized.includes('BAŞAR')) {
    return { label: 'Değiştirildi', tone: 'bg-green-50 text-green-700 border-green-200', active: false };
  }
  if (normalized.includes('ISLEN') || normalized.includes('İŞLEN')) {
    return { label: 'Değiştiriliyor', tone: 'bg-blue-50 text-blue-700 border-blue-200', active: true };
  }
  if (normalized.includes('BEK')) {
    return { label: 'Sırada', tone: 'bg-amber-50 text-amber-700 border-amber-200', active: true };
  }
  if (!normalized) return null;
  return { label: status, tone: 'bg-slate-50 text-slate-700 border-slate-200', active: false };
}

export default function App() {
  const { theme, toggleTheme } = useAppTheme();
  const serviceWorkerRegistrationRef = useRef(null);
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);

  // PWA güncellemeleri kullanıcı onayıyla uygulanır; açık işlem sırasında sayfa yenilenmez.
  const {
    needRefresh: [needRefresh, setNeedRefresh],
  } = useRegisterSW({
    onRegistered(r) {
      serviceWorkerRegistrationRef.current = r || null;
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  const handleCheckForUpdates = async () => {
    if (isCheckingForUpdate) return;

    if (!('serviceWorker' in navigator)) {
      void showAppAlert('Bu tarayıcı uygulama güncellemelerini denetlemeyi desteklemiyor.', {
        type: 'warning',
        title: 'Güncelleme denetlenemedi',
      });
      return;
    }

    if (!navigator.onLine) {
      void showAppAlert('Güncellemeleri denetlemek için internet bağlantısı gerekiyor.', {
        type: 'warning',
        title: 'Bağlantı yok',
      });
      return;
    }

    setIsCheckingForUpdate(true);

    try {
      let registration = serviceWorkerRegistrationRef.current;
      if (!registration) {
        registration = await navigator.serviceWorker.getRegistration();
        serviceWorkerRegistrationRef.current = registration || null;
      }

      if (!registration) {
        throw new Error('Uygulama güncelleme servisi henüz hazır değil. Uygulamayı kapatıp yeniden açın.');
      }

      if (registration.waiting) {
        setNeedRefresh(true);
        return;
      }

      // Önceki denetimden kalmış bir UI durumu gerçek bir güncelleme değildir.
      // Elle denetimde yalnızca registration.waiting doğruluk kaynağıdır.
      if (needRefresh) setNeedRefresh(false);

      const updateDetected = new Promise((resolve) => {
        let settled = false;
        let timeoutId;

        const finish = (found) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(Boolean(found));
        };

        const watchInstallingWorker = () => {
          const worker = registration.installing;
          if (!worker) return;

          const handleStateChange = () => {
            if (worker.state === 'installed') {
              // Safari/iPadOS'ta "installed" olayı registration.waiting alanından
              // hemen önce gelebiliyor. Kartı ancak etkinleştirilebilir worker hazırsa aç.
              setTimeout(() => finish(Boolean(registration.waiting)), 300);
            } else if (worker.state === 'redundant') {
              finish(false);
            }
          };

          worker.addEventListener('statechange', handleStateChange);
          handleStateChange();
        };

        registration.addEventListener('updatefound', watchInstallingWorker, { once: true });
        timeoutId = setTimeout(() => finish(Boolean(registration.waiting)), 4000);
      });

      await registration.update();
      const hasUpdate = Boolean(registration.waiting) || (await updateDetected);

      if (hasUpdate) {
        setNeedRefresh(true);
      } else {
        void showAppAlert('Kullandığınız sürüm güncel.', {
          type: 'success',
          title: 'Güncelleme denetimi tamamlandı',
          dedupeKey: 'pwa-update-current',
        });
      }
    } catch (error) {
      void showAppAlert(error?.message || 'Güncellemeler şu anda denetlenemedi.', {
        type: 'error',
        title: 'Güncelleme denetlenemedi',
      });
    } finally {
      setIsCheckingForUpdate(false);
    }
  };

  const handleApplyAppUpdate = async () => {
    if (isApplyingUpdate) return;
    setIsApplyingUpdate(true);

    try {
      let registration = serviceWorkerRegistrationRef.current;
      if (!registration) {
        registration = await navigator.serviceWorker.getRegistration();
        serviceWorkerRegistrationRef.current = registration || null;
      }

      if (!registration) {
        throw new Error('Uygulama güncelleme servisi bulunamadı.');
      }

      // Kullanıcı karta çok hızlı dokunursa iPadOS waiting alanını birkaç yüz
      // milisaniye sonra doldurabilir. Kısa süre bekleyip gerçek workerı al.
      for (let attempt = 0; attempt < 30 && !registration.waiting; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const waitingWorker = registration.waiting;
      if (!waitingWorker) {
        setNeedRefresh(false);
        throw new Error('Hazır bir yeni sürüm bulunamadı. Güncellemeleri yeniden denetleyin.');
      }

      let reloadTimer;
      const reloadApp = () => {
        clearTimeout(reloadTimer);
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener('controllerchange', reloadApp, { once: true });
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });

      // Bazı iPadOS sürümleri controllerchange olayını geç iletebiliyor.
      reloadTimer = setTimeout(reloadApp, 5000);
    } catch (error) {
      setIsApplyingUpdate(false);
      void showAppAlert(error?.message || 'Yeni sürüm etkinleştirilemedi.', {
        type: 'error',
        title: 'Güncelleme uygulanamadı',
      });
    }
  };
  // --- EASTER EGG STATES ---
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authNotice, setAuthNotice] = useState('');

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('istek_it_user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        // BEYAZ EKRAN ÇÖZÜMÜ: Eğer isim verisi yoksa veya bozuksa çökmeyi önlemek için anında sil ve baştan giriş iste!
        if (!parsed || !parsed.expiresAt || Date.now() > parsed.expiresAt || !parsed.name || typeof parsed.name !== 'string') {
          localStorage.removeItem('istek_it_user');
          clearStoredDataCaches();
          return null; 
        }
        return parsed;
      }
    } catch(e) {
      localStorage.removeItem('istek_it_user');
      clearStoredDataCaches();
    }
    return null;
  });
  
  // YENİ: Uygulama açıldığı salise "Sistem Yükleniyor" ekranına takılmamak için direkt false yapıyoruz
  const [isLoading, setIsLoading] = useState(false);

  // UYGULAMA AÇIKKEN 6 SAAT DOLARSA ANINDA (REAL-TIME) ÇIKIŞ YAPTIRAN ZAMANLAYICI
  useEffect(() => {
    if (currentUser && currentUser.expiresAt) {
      const timeLeft = currentUser.expiresAt - Date.now();
      if (timeLeft <= 0) {
        resetClientSession();
      } else {
        const timer = setTimeout(() => {
          resetClientSession();
          showAppAlert(
            'Oturum süreniz (6 saat) doldu. Güvenlik amacıyla sistemden otomatik çıkış yapıldı.',
            { type: 'warning', title: 'Oturum sona erdi', dedupeKey: 'session-expired' }
          );
        }, timeLeft);
        return () => clearTimeout(timer);
      }
    }
  }, [currentUser]);

  const [activeTab, setActiveTab] = useState('hardware');
  // Gerçek IP, güvenlik amacıyla backend tarafından bağlantı üzerinden kaydedilir.
  const clientIp = 'Sunucu tarafından kaydedilecek';
  const [successMessage, setSuccessMessage] = useState(null); // İşlem başarılı olduğunda yeşil tik ile çıkacak mesaj

  const headerRef = useRef(null);
  const floatingBtnsRef = useRef(null);
  const newZimmetBtnRef = useRef(null);
  const assignmentActionBtnRef = useRef(null);
  const lastDataSyncRef = useRef('');
  const lastFullSyncAtRef = useRef(0);
  const dataFetchInFlightRef = useRef(null);
  const missingGlpiFetchInFlightRef = useRef(null);
  const qrVideoRef = useRef(null);
  const qrStreamRef = useRef(null);
  const qrDetectorRef = useRef(null);
  const qrLastScanRef = useRef({ value: '', at: 0 });
  const qrActionBusyRef = useRef(false);
  const lastScrollY = useRef(0);
  const scrollTimer = useRef(null);
  const mainContainerRef = useRef(null); // YENİ: Scroll resetleme için

  const headerTimerRef = useRef(null);
  const scrollEndTimer = useRef(null); // YENİ: Kaydırmanın bittiğini anlayan dedektör
  const isHeaderHidden = useRef(false);

  const handleMainScroll = (e) => {
    const currentY = Math.max(0, e.target.scrollTop);

    // 1. LOGO GİZLEME MANTIĞI (Sadece kaydırma ivmesi tamamen durduğunda çalışır -> ZIPLAMA YAPMAZ!)
    clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      if (headerRef.current) {
        if (window.innerWidth <= 1024) {
          if (currentY > 50) {
            if (!isHeaderHidden.current) {
              clearTimeout(headerTimerRef.current);
              headerRef.current.classList.add('header-hidden');
              isHeaderHidden.current = true;
            }
          } else if (currentY <= 10) {
            // EN ÜSTE GELİNDİĞİNDE: 1.5 saniye (1500ms) bekle
            if (isHeaderHidden.current) {
              clearTimeout(headerTimerRef.current);
              headerTimerRef.current = setTimeout(() => {
                if (e.target && e.target.scrollTop <= 10) {
                  headerRef.current.classList.remove('header-hidden');
                  isHeaderHidden.current = false;
                }
              }, 1500);
            }
          }
        } else {
          // Masaüstündeysek (Geniş Ekransa) asla gizleme
          if (isHeaderHidden.current) {
            headerRef.current.classList.remove('header-hidden');
            isHeaderHidden.current = false;
          }
        }
      }
    }, 150); // 150ms gecikme: Kullanıcı parmağını çektiği ve kaydırmanın durduğu anı temsil eder.

    // 2. YÜZÜCÜ BUTONLAR (Beklemeden anında tepki vermeye devam ederler)
    if (!scrollTimer.current) {
      scrollTimer.current = setTimeout(() => {
        const delta = currentY - lastScrollY.current;
        if (Math.abs(delta) > 5) {
          const isScrollingDown = delta > 0 && currentY > 50;

          if (floatingBtnsRef.current) {
            floatingBtnsRef.current.style.opacity = isScrollingDown
              ? '0.35'
              : '1';
            floatingBtnsRef.current.style.transform = isScrollingDown
              ? 'translateX(-50%) scale(0.95) translateY(10px)'
              : 'translateX(-50%) scale(1) translateY(0)';
          }

          if (newZimmetBtnRef.current) {
            newZimmetBtnRef.current.style.opacity = isScrollingDown
              ? '0.35'
              : '1';
            newZimmetBtnRef.current.style.transform = isScrollingDown
              ? 'scale(0.90)'
              : 'scale(1)';
          }

          if (assignmentActionBtnRef.current) {
            assignmentActionBtnRef.current.style.opacity = isScrollingDown
              ? '0.42'
              : '1';
            assignmentActionBtnRef.current.style.transform = isScrollingDown
              ? 'scale(0.90) translateY(8px)'
              : 'scale(1) translateY(0)';
          }
          lastScrollY.current = currentY;
        }
        scrollTimer.current = null;
      }, 50);
    }
  };

// Yeni Menü State'leri
const [showHardwareFilters, setShowHardwareFilters] = useState(false);
const [showAddHardwareMenu, setShowAddHardwareMenu] = useState(false);
const [showHardwareMenu, setShowHardwareMenu] = useState(false);
const [showPersonnelMenu, setShowPersonnelMenu] = useState(false);
const [showAssignFilters, setShowAssignFilters] = useState(false);
const [hardwareFilterStatus, setHardwareFilterStatus] = useState('All');
const [activeFilterDropdown, setActiveFilterDropdown] = useState(null);

// YENİ ZİMMET EKRANI FİLTRELERİ
const [assignFilterStatus, setAssignFilterStatus] = useState('All');
const [assignFilterCampus, setAssignFilterCampus] = useState('All');
const [activeAssignFilterDropdown, setActiveAssignFilterDropdown] = useState(null);

// YENİ: Pagination States
const [hardwarePage, setHardwarePage] = useState(1);
const [personnelPage, setPersonnelPage] = useState(1);
const ITEMS_PER_PAGE = 20; // Her sayfada kaç kayıt gösterileceği

// Kampüs Transfer States
const [isTransferMode, setIsTransferMode] = useState(false);
const [selectedTargetCampus, setSelectedTargetCampus] = useState('');

// === YENİ: TRANSFER İŞLEMİ STATE'LERİ ===
const [transferModalObj, setTransferModalObj] = useState(null); 
const [transferSignature, setTransferSignature] = useState(null);

// --- CİHAZ PROFİLİ İÇİNDEN İSİM GÜNCELLEME STATES ---
const [isEditingDeviceName, setIsEditingDeviceName] = useState(false);
const [editComputerNumber, setEditComputerNumber] = useState('');
const [isUpdatingName, setIsUpdatingName] = useState(false);
// --- YENİ: TEKİL CİHAZ GRUP ATAMA STATES ---
const [isEditingSingleGroup, setIsEditingSingleGroup] = useState(false);
const [editSingleGroupText, setEditSingleGroupText] = useState('');
const [isUpdatingSingleGroup, setIsUpdatingSingleGroup] = useState(false);

const handleSaveSingleGroup = (hardwareId) => {
  // OPTIMISTIC UI: Bekleme ekrani yok, aninda işlem!
  let cCode = 'XX';
  if (currentUser?.campus && CAMPUS_CODES[currentUser.campus]) {
    cCode = CAMPUS_CODES[currentUser.campus];
  }
  
  const rawInput = editSingleGroupText.trim();
  let finalGroupName = '';
  if (rawInput !== '') {
    if (rawInput.startsWith('[')) {
      finalGroupName = rawInput; 
    } else {
      finalGroupName = `[${cCode}] ${rawInput}`; 
    }
  }

  // 1. Olasi hataya karsi eski veriyi sakla
  const previousHardwareState = [...hardware];

  // 2. Arayüzü anında güncelle ve modal düzenlemesini kapat
  setHardware((prev) =>
    prev.map((h) =>
      h.id === hardwareId ? { ...h, groupName: finalGroupName } : h
    )
  );
  setIsEditingSingleGroup(false);

  // 3. Arka planda sessizce sunucuya gönder
  postApiAction({
    authToken: currentUser.token,
    action: 'bulkUpdateGroup',
    hardwareIds: [hardwareId],
    groupName: finalGroupName,
  })
  .then(() => {
    // Başarılıysa arka planda verileri yenile
    fetchVeritabani(false);
  })
  .catch(error => {
    console.error('Grup Kayıt Hatas?:', error);
    setHardware(previousHardwareState); // Hata olursa ekranı eski haline döndür
    showAppAlert('Internet veya sunucu hatasi nedeniyle cihaz gruba atanamadi.');
  });
};

// --- YENİ: CİHAZ NOTU (DURUM) STATES VE FONKSİYONU ---
const [isEditingNote, setIsEditingNote] = useState(false);
const [editNoteText, setEditNoteText] = useState('');
const [isUpdatingNote, setIsUpdatingNote] = useState(false);

const handleSaveNote = async (hardwareId) => {
  setIsUpdatingNote(true);
  try {
    await postApiAction({
      authToken: currentUser.token,
      action: 'updateHardware',
      hardwareId: hardwareId,
      updates: { notes: editNoteText },
    });

    setHardware((prev) =>
      prev.map((h) => (h.id === hardwareId ? { ...h, notes: editNoteText } : h))
    );
    setIsEditingNote(false);
  } catch (error) {
    showAppAlert('Hata: Not kaydedilemedi. ' + error.message);
  } finally {
    setIsUpdatingNote(false);
  }
};

// Personel Profilindeki Çoklu İade İçin Seçilen Cihazlar
const [selectedForReturn, setSelectedForReturn] = useState([]);

// Toplu (Bulk) Seçim States
const [selectedBulkHardware, setSelectedBulkHardware] = useState([]);
const [bulkCampusTransferMode, setBulkCampusTransferMode] = useState(false);
const [bulkTargetCampus, setBulkTargetCampus] = useState('');

// --- YENİ: GRUPLAMA (GROUPING) STATES VE FONKSİYONU ---
const [showGroupModal, setShowGroupModal] = useState(false);
const [groupNameInput, setGroupNameInput] = useState('');

const handleAssignGroup = () => {
  // OPTIMISTIC UI: Bekleme ekrani yok, aninda işlem!
  let cCode = 'XX';
  if (currentUser?.campus && CAMPUS_CODES[currentUser.campus]) {
    cCode = CAMPUS_CODES[currentUser.campus];
  }
  
  const rawInput = groupNameInput.trim();
  let finalGroupName = '';
  if (rawInput !== '') {
    if (rawInput.startsWith('[')) {
      finalGroupName = rawInput; 
    } else {
      finalGroupName = `[${cCode}] ${rawInput}`; 
    }
  }

  // 1. Olasi hataya karsi eski durumu sakla
  const previousHardwareState = [...hardware];
  const selectedIdsToProcess = [...selectedBulkHardware];

  // 2. EKRANI ANINDA GÜNCELLE
  setHardware((prev) =>
    prev.map((h) =>
      selectedIdsToProcess.includes(h.id)
        ? { ...h, groupName: finalGroupName }
        : h
    )
  );

  // 3. Modalları ve seçimleri anında temizle
  setShowGroupModal(false);
  setSelectedBulkHardware([]);
  setGroupNameInput('');
  
  // Ekranı kitlemeyen minik bir uyarı göster
  setSuccessMessage(`${selectedIdsToProcess.length} cihaz "${finalGroupName || 'Grup Yok'}" grubuna atandi.`);
  setTimeout(() => setSuccessMessage(null), 2000);

  // 4. Arka planda sessizce sunucuya ilet
  postApiAction({
    authToken: currentUser.token,
    action: 'bulkUpdateGroup',
    hardwareIds: selectedIdsToProcess,
    groupName: finalGroupName,
  })
  .then(() => {
    fetchVeritabani(false); // Başarılıysa arka planda önbelleği güncelle
  })
  .catch(error => {
    console.error('Toplu Grup Kayıt Hatas?:', error);
    setHardware(previousHardwareState); // Sunucu çökerse ekranı geri al
    showAppAlert('Hata: Internet sorunu nedeniyle cihazlar gruba atanamadi.');
  });
};

// --- YENİ: TRANSFER MERKEZİ STATES ---
const [transferViewTab, setTransferViewTab] = useState('pending'); // 'pending' | 'completed'
const [transferSearchQuery, setTransferSearchQuery] = useState('');
const [showTransferFilters, setShowTransferFilters] = useState(false);
const [transferFilterSender, setTransferFilterSender] = useState('All');
const [transferFilterReceiver, setTransferFilterReceiver] = useState('All');
const [transferFilterDate, setTransferFilterDate] = useState(''); // Tarih filtresi için
const [showNewTransferModal, setShowNewTransferModal] = useState(false);
const [newTransferSelected, setNewTransferSelected] = useState([]);
const [newTransferTarget, setNewTransferTarget] = useState('');
const [newTransferSearch, setNewTransferSearch] = useState('');
const [expandedCompletedTransfers, setExpandedCompletedTransfers] = useState({});

  // Personel Tablosu İçin Seçim State'
  const [selectedBulkPersonnel, setSelectedBulkPersonnel] = useState([]);

  // Siralama (Sorting) States
  const [hardwareSort, setHardwareSort] = useState({
    key: '',
    direction: 'asc',
  });
  const [personnelSort, setPersonnelSort] = useState({
    key: '',
    direction: 'asc',
  });

  const [personnel, setPersonnel] = useState([]);
  const [hardware, setHardware] = useState([]);
  const [recentlyUpdatedHardwareIds, setRecentlyUpdatedHardwareIds] = useState(() => new Set());
  const [recentlyUpdatedPersonnelIds, setRecentlyUpdatedPersonnelIds] = useState(() => new Set());
  const previousHardwareVisualRef = useRef(new Map());
  const previousPersonnelVisualRef = useRef(new Map());
  const hardwareHighlightTimerRef = useRef(null);
  const personnelHighlightTimerRef = useRef(null);

  useEffect(() => {
    const next = new Map(hardware.map((item) => [item.id, hardwareVisualFingerprint(item)]));
    const previous = previousHardwareVisualRef.current;
    if (previous.size > 0) {
      const changed = hardware
        .filter((item) => previous.has(item.id) && previous.get(item.id) !== next.get(item.id))
        .map((item) => item.id);
      if (changed.length > 0) {
        setRecentlyUpdatedHardwareIds(new Set(changed));
        window.clearTimeout(hardwareHighlightTimerRef.current);
        hardwareHighlightTimerRef.current = window.setTimeout(
          () => setRecentlyUpdatedHardwareIds(new Set()),
          1400
        );
      }
    }
    previousHardwareVisualRef.current = next;
  }, [hardware]);

  useEffect(() => {
    const next = new Map(personnel.map((item) => [item.id, personnelVisualFingerprint(item)]));
    const previous = previousPersonnelVisualRef.current;
    if (previous.size > 0) {
      const changed = personnel
        .filter((item) => previous.has(item.id) && previous.get(item.id) !== next.get(item.id))
        .map((item) => item.id);
      if (changed.length > 0) {
        setRecentlyUpdatedPersonnelIds(new Set(changed));
        window.clearTimeout(personnelHighlightTimerRef.current);
        personnelHighlightTimerRef.current = window.setTimeout(
          () => setRecentlyUpdatedPersonnelIds(new Set()),
          1400
        );
      }
    }
    previousPersonnelVisualRef.current = next;
  }, [personnel]);

  useEffect(
    () => () => {
      window.clearTimeout(hardwareHighlightTimerRef.current);
      window.clearTimeout(personnelHighlightTimerRef.current);
    },
    []
  );
  const personnelById = useMemo(
    () => new Map(personnel.map((person) => [person.id, person])),
    [personnel]
  );
  const hardwareById = useMemo(
    () => new Map(hardware.map((item) => [item.id, item])),
    [hardware]
  );
  const hardwareByAssignee = useMemo(() => {
    const grouped = new Map();
    hardware.forEach((item) => {
      if (!item.assignedTo) return;
      const current = grouped.get(item.assignedTo);
      if (current) current.push(item);
      else grouped.set(item.assignedTo, [item]);
    });
    return grouped;
  }, [hardware]);

  function resetClientSession(notice = '') {
    localStorage.removeItem('istek_it_user');
    clearStoredDataCaches();
    setPersonnel([]);
    setHardware([]);
    setMissingGlpiDevices([]);
    setCurrentUser(null);
    setIsLoading(false);
    setIsLoggingIn(false);
    setAuthNotice(notice);
  }

  async function handleLogout() {
    const authToken = currentUser?.token;
    resetClientSession();
    if (!authToken) return;

    try {
      await postApiAction(
        { action: 'logout', authToken },
        { timeoutMs: 10000, notifySessionExpired: false }
      );
    } catch (error) {
      console.warn('Backend oturumu sonlandırılamadı:', error);
    }
  }
  const [signatureTitles, setSignatureTitles] = useState([]);
  const [signatureCampuses, setSignatureCampuses] = useState([]);
  const [canChooseSignatureCampus, setCanChooseSignatureCampus] = useState(false);
  const [isLoadingSignatureTitles, setIsLoadingSignatureTitles] = useState(false);
  const [signatureModalPerson, setSignatureModalPerson] = useState(null);
  const [isCreatingSignature, setIsCreatingSignature] = useState(false);
  const [missingGlpiDevices, setMissingGlpiDevices] = useState([]);
  const [selectedMissingGlpiIds, setSelectedMissingGlpiIds] = useState([]);
  const [missingGlpiSearchQuery, setMissingGlpiSearchQuery] = useState('');
  const [missingGlpiFilterType, setMissingGlpiFilterType] = useState('All');
  const [missingGlpiFilterCampus, setMissingGlpiFilterCampus] = useState('All');
  const [activeMissingGlpiFilterDropdown, setActiveMissingGlpiFilterDropdown] = useState(null);
  const [isLoadingMissingGlpi, setIsLoadingMissingGlpi] = useState(false);
  const [missingGlpiLoadError, setMissingGlpiLoadError] = useState('');
  const [isImportingMissingGlpi, setIsImportingMissingGlpi] = useState(false);
  const [qrInput, setQrInput] = useState('');
  const [qrFoundHardwareId, setQrFoundHardwareId] = useState(null);
  const [qrScannedHardwareIds, setQrScannedHardwareIds] = useState([]);
  const [selectedQrHardwareIds, setSelectedQrHardwareIds] = useState([]);
  const [qrScanLog, setQrScanLog] = useState([]);
  const [qrScannerActive, setQrScannerActive] = useState(false);

  const handleCurrentUserPictureError = () => {
    setCurrentUser((prev) => {
      if (!prev?.picture) return prev;
      const next = { ...prev, picture: null };
      localStorage.setItem('istek_it_user', JSON.stringify(next));
      return next;
    });
  };

  const handlePersonPictureError = (personId) => {
    if (!personId) return;
    setPersonnel((prev) =>
      prev.map((person) => (person.id === personId ? { ...person, picture: null } : person))
    );
  };
  const [qrScannerError, setQrScannerError] = useState('');
  const [isQrActionBusy, setIsQrActionBusy] = useState(false);
  const [qrActionLabel, setQrActionLabel] = useState('');
  const [qrLabelPrintItems, setQrLabelPrintItems] = useState([]);
  const [previewPdf, setPreviewPdf] = useState(null);

  // PDF Generation States
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedHardware, setSelectedHardware] = useState([]);
  const [includeCharger, setIncludeCharger] = useState(false);
  const [includeBag, setIncludeBag] = useState(false);
  const [includeMouse, setIncludeMouse] = useState(false);
  const [selectedMouseId, setSelectedMouseId] = useState('OEM');
  const [isSigning, setIsSigning] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [zimmetExplanation, setZimmetExplanation] = useState(''); // YENİ: Zimmet Açıklama Notu
  // YENİ: Hukuki Onay Checkbox State'leri
  const [isKvkkAccepted, setIsKvkkAccepted] = useState(false);
  const [isReturnAccepted, setIsReturnAccepted] = useState(false);

  // YENİ: ZİMMETLİ CİHAZ ONAY MODALI
  const [showZimmetliOnayModal, setShowZimmetliOnayModal] = useState(false);
  const [zimmetliCihazlarListesi, setZimmetliCihazlarListesi] = useState([]);

  // YENİ: Tarayıcı Confirm Kutusu Yerine Kullanılacak Şık Onay Modalı State'i
  const [confirmDialog, setConfirmDialog] = useState(null); // { message: 'Emin misiniz?', onConfirm: () => {}, type: 'danger'|'info' }
  const [itSignature, setItSignature] = useState(null);
  const [personSignature, setPersonSignature] = useState(null);
  const [personOtpData, setPersonOtpData] = useState(null); // ZİMMET OTP VERİSİ
  const [returnPersonOtpData, setReturnPersonOtpData] = useState(null); // İADE OTP VERİSİ
  const [assignStep, setAssignStep] = useState(1); // YENİ: 1 = Personel Seçimi, 2 = Donanım Seçimi

  // Return States
  const [returningData, setReturningData] = useState(null);
  const [returnItSignature, setReturnItSignature] = useState(null);
  const [returnPersonSignature, setReturnPersonSignature] = useState(null);
  const [returnCondition, setReturnCondition] = useState('eksiksiz');
  const [returnExplanation, setReturnExplanation] = useState('');
  
  // YENİ: İade Edilirken Aksesuar Durumları
  const [returnIncludeCharger, setReturnIncludeCharger] = useState(false);
  const [returnIncludeBag, setReturnIncludeBag] = useState(false);
  const [returnIncludeMouse, setReturnIncludeMouse] = useState(false);

  // --- YENİ Donanım EKLEME STATES ---
  const [showAddHardwareModal, setShowAddHardwareModal] = useState(false);
  const [showBulkHardwareImportModal, setShowBulkHardwareImportModal] = useState(false);
  const [showBulkInitialAssignmentModal, setShowBulkInitialAssignmentModal] = useState(false);
  const [newHardwareForm, setNewHardwareForm] = useState({
    type: 'Laptop',
    brand: 'Lenovo',
    model: 'ThinkPad E15',
    serial: '',
    computerNumber: '', // 4 haneli sayı için
  });
  const [isAddingHardware, setIsAddingHardware] = useState(false);
  // --- MANUEL FOTOĞRAF/PDF YÜKLEME STATES ---
  const [showManualUpload, setShowManualUpload] = useState(false);
  const [manualUploadFile, setManualUploadFile] = useState(null);
  const [manualUploadPerson, setManualUploadPerson] = useState('');
  const [manualUploadSearch, setManualUploadSearch] = useState('');
  const [isUploadingManual, setIsUploadingManual] = useState(false);
  const fileInputRef = useRef(null);

  // Cihaz tipi Laptop, PC veya AIO ise isimlendirme önekini hesapla
  const showComputerName =
    newHardwareForm.type === 'Laptop' ||
    newHardwareForm.type === 'Masaüstü (PC)' ||
    newHardwareForm.type === 'All in One PC';

  let computerPrefix = '';
  if (showComputerName && currentUser) {
    const cCode = CAMPUS_CODES[currentUser.campus] || 'XX';
    let tCode = 'PC';
    if (newHardwareForm.type === 'Laptop') tCode = 'LAP';
    if (newHardwareForm.type === 'All in One PC') tCode = 'AIO';
    computerPrefix = `I${cCode}${tCode}`;
  }

  const handleBrandChange = (e) => {
    const newBrand = e.target.value;
    setNewHardwareForm({
      ...newHardwareForm,
      brand: newBrand,
      model: BRANDS_MODELS[newBrand][0], // Marka değişince modeli ilk seçeneğe sıfırla
    });
  };

  const handleSaveNewHardware = async () => {
    if (
      !newHardwareForm.brand ||
      !newHardwareForm.model ||
      !newHardwareForm.serial
    ) {
      return showAppAlert(
        'Lütfen marka, model ve seri no alanlarını eksiksiz doldurun.'
      );
    }

    // YENİ: AYNI SERİ NUMARASIYLA CİHAZ VAR MI KONTROLÜ
    const isDuplicateSerial = hardware.some(
      (h) =>
        h.serial.trim().toLowerCase() ===
        newHardwareForm.serial.trim().toLowerCase()
    );
    if (isDuplicateSerial) {
      return showAppAlert(
        `HATA: "${newHardwareForm.serial}" seri numaralı bir cihaz sistemde zaten kayıtlı!`
      );
    }

    let finalDeviceName = '';
    // BİLGİSAYAR İSMİ ARTIK ZORUNLU DEĞİL. Sadece içi doluysa 4 hane kontrolü yapar.
    if (showComputerName && newHardwareForm.computerNumber.trim() !== '') {
      if (!/^\d{4}$/.test(newHardwareForm.computerNumber)) {
        return showAppAlert(
          'Lütfen bilgisayar ismi için tam 4 haneli bir sayı girin (Örn: 0045) veya boş bırakın.'
        );
      }
      finalDeviceName = `${computerPrefix}${newHardwareForm.computerNumber}`;
    }

    setIsAddingHardware(true);
    try {
      const displayModel = finalDeviceName
        ? `${newHardwareForm.model} [${finalDeviceName}]`
        : newHardwareForm.model;

      const newHardwareItem = {
        id: 'HW-' + Date.now(),
        type: newHardwareForm.type,
        brand: newHardwareForm.brand,
        model: displayModel,
        deviceName: finalDeviceName,
        serial: newHardwareForm.serial,
        status: 'Available',
        campus: currentUser.campus,
        assignedTo: null,
        history: [],
      };

      await postApiAction({
        authToken: currentUser.token,
        action: 'addHardware',
        hardware: newHardwareItem,
      });

      setHardware((prev) => [newHardwareItem, ...prev]);

      setSuccessMessage('Yeni Donanım başarıyla depoya eklendi.');
setTimeout(() => setSuccessMessage(null), 2500);
      setShowAddHardwareModal(false);
      setNewHardwareForm({
        type: 'Laptop',
        brand: 'Lenovo',
        model: 'ThinkPad E15',
        serial: '',
        computerNumber: '',
      });
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsAddingHardware(false);
    }
  };
  const handleSaveDeviceName = async (hardwareId, prefix) => {
    if (
      editComputerNumber.trim() !== '' &&
      !/^\d{4}$/.test(editComputerNumber)
    ) {
      return showAppAlert(
        'Lütfen bilgisayar ismi için tam 4 haneli bir sayı girin (Örn: 0045) veya boş bırakın.'
      );
    }

    // Prefix ve Numarayı React tarafında birleştiriyoruz. (Örn: IANLAP0015)
    const finalDeviceName =
      editComputerNumber.trim() !== '' ? `${prefix}${editComputerNumber}` : '';
    setIsUpdatingName(true);

    try {
      await postApiAction({
        authToken: currentUser.token,
        action: 'updateHardware',
        hardwareId: hardwareId,
        updates: {
          deviceName: finalDeviceName,
        },
      });

      setHardware((prev) =>
        prev.map((h) =>
          h.id === hardwareId ? { ...h, deviceName: finalDeviceName } : h
        )
      );
      setIsEditingDeviceName(false);
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsUpdatingName(false);
    }
  };
  const handleMissingDocumentUpload = async () => {
    if (!manualUploadFile || !viewedHardwarePerson) return;

    const extension =
      manualUploadFile.type === 'image/png'
        ? '.png'
        : manualUploadFile.type.startsWith('image/')
          ? '.jpg'
          : '.pdf';
    const filename =
      `${viewedHardware.serial}, ${viewedHardwarePerson.name}, Manuel_Tutanak${extension}`.replace(
        /[\/\\?%*:|"<>]/g,
        '-'
      );

    setIsUploadingManual(true);
    try {
      const base64String = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(manualUploadFile);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = (error) => reject(error);
      });

      const result = await postApiAction(
        {
          authToken: currentUser.token,
          action: 'uploadMissingDocument',
          pdfName: filename,
          pdfData: base64String,
          campus: currentUser.campus,
          personName: viewedHardwarePerson.name,
          hardwareId: viewedHardware.id,
        },
        { timeoutMs: 180000 }
      );

      setHardware((prev) =>
        prev.map((h) => {
          if (h.id === viewedHardware.id) {
            return {
              ...h,
              driveLink: result.url,
              history: [
                {
                  personName: viewedHardwarePerson.name,
                  date: new Date().toLocaleDateString('tr-TR'),
                  driveLink: result.url,
                  type: 'Eksik Belge Yüklendi',
                },
                ...(h.history || []),
              ],
            };
          }
          return h;
        })
      );

      setSuccessMessage('Fotoğraf/belge başarıyla cihaza eklendi.');
setTimeout(() => setSuccessMessage(null), 2500);
      setManualUploadFile(null);
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsUploadingManual(false);
    }
  };

  // Filter States
  const [hardwareFilterType, setHardwareFilterType] = useState('All');
  const [hardwareSearchQuery, setHardwareSearchQuery] = useState('');
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState('');
  // YENİ EKLENEN DURUM FİLTRESİ (DEFAULT: Aktif)
  const [personnelFilterStatus, setPersonnelFilterStatus] = useState('Aktif');
  const [personnelSignatureFilter, setPersonnelSignatureFilter] = useState('All');
  const [assignFilterType, setAssignFilterType] = useState('All');
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [campusFilter, setCampusFilter] = useState('All');
  const [personSearch, setPersonSearch] = useState('');
  const [nationalIdLookupPerson, setNationalIdLookupPerson] = useState(null);
  const [isNationalIdLookupLoading, setIsNationalIdLookupLoading] = useState(false);
  const [nationalIdLookupError, setNationalIdLookupError] = useState('');
  const nationalIdLookupRequestRef = useRef(0);

  useEffect(() => {
    const nationalId = personSearch.trim();
    const requestId = nationalIdLookupRequestRef.current + 1;
    nationalIdLookupRequestRef.current = requestId;

    if (!/^\d{11}$/.test(nationalId) || !currentUser?.token) {
      setNationalIdLookupPerson(null);
      setNationalIdLookupError('');
      setIsNationalIdLookupLoading(false);
      return undefined;
    }

    setNationalIdLookupPerson(null);
    setNationalIdLookupError('');
    setIsNationalIdLookupLoading(true);

    const timeoutId = window.setTimeout(async () => {
      try {
        const result = await postApiAction({
          action: 'lookupPersonnelByNationalId',
          authToken: currentUser.token,
          nationalId,
        });
        if (nationalIdLookupRequestRef.current !== requestId) return;

        const person = result.person || null;
        setNationalIdLookupPerson(person);
        if (person) {
          setPersonnel((previous) => mergeRecordsById(previous, [person]));
        } else {
          setNationalIdLookupError('Bu T.C. kimlik numarasıyla erişebileceğiniz bir personel bulunamadı.');
        }
      } catch (error) {
        if (nationalIdLookupRequestRef.current !== requestId) return;
        setNationalIdLookupError(error.message || 'T.C. kimlik numarasıyla personel aranamadı.');
      } finally {
        if (nationalIdLookupRequestRef.current === requestId) {
          setIsNationalIdLookupLoading(false);
        }
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [currentUser?.token, personSearch]);

  // Filtreler veya arama degistiginde Pagination'i 1. sayfaya sıfırla
  useEffect(() => {
    setHardwarePage(1);
  }, [hardwareFilterType, hardwareSearchQuery, campusFilter]);

  useEffect(() => {
    setPersonnelPage(1);
  }, [personnelSearchQuery, campusFilter, personnelFilterStatus, personnelSignatureFilter]);

  const [viewingHardwareId, setViewingHardwareId] = useState(null);
  const [showHardwareHistory, setShowHardwareHistory] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false); // YENİ EKLENDİ

  // YENİ: GEÇMİŞİ SUNUCUDAN ÇEKME FONKSİYONU
  const handleOpenHistory = async (hwId) => {
    if (showHardwareHistory) {
      setShowHardwareHistory(false);
      return;
    }
    
    setShowHardwareHistory(true);
    const hw = hardwareById.get(hwId);
    
    // Eğer daha önce çektiysek veya zaten geçmişi yoksa sunucuyu yorma
    if (hw.historyLoaded || !hw.hasHistory) return;

    setIsLoadingHistory(true);
    try {
      const result = await postApiAction({
        action: 'fetchHardwareHistory',
        authToken: currentUser.token,
        hardwareId: hwId,
      });
      setHardware(prev => prev.map(h => h.id === hwId ? { ...h, history: result.history, historyLoaded: true } : h));
    } catch(e) {
      console.error("Geçmiş çekilemedi");
    } finally {
      setIsLoadingHistory(false);
    }
  };
  // Personel profilindeki geçmişi açıp kapatmak için EKLENDİ
  const [showPersonHistory, setShowPersonHistory] = useState(false);
  const [isLoadingPersonHistory, setIsLoadingPersonHistory] = useState(false);

  const handleOpenPersonHistory = async (personId) => {
    if (showPersonHistory) {
      setShowPersonHistory(false);
      return;
    }

    setShowPersonHistory(true);
    const person = personnelById.get(personId);
    if (person?.documentsLoaded) return;

    setIsLoadingPersonHistory(true);
    try {
      const result = await postApiAction({
        action: 'fetchPersonDocumentHistory',
        authToken: currentUser.token,
        personId,
      });
      const documents = Array.isArray(result.documents) ? result.documents : [];
      setPersonnel((prev) =>
        prev.map((item) =>
          item.id === personId
            ? { ...item, documents, documentsLoaded: true }
            : item
        )
      );
    } catch (error) {
      setShowPersonHistory(false);
      showAppAlert(`Belge geçmişi yüklenemedi: ${error.message}`);
    } finally {
      setIsLoadingPersonHistory(false);
    }
  };

  // Kopyalandı efektleri için
  const [copiedSerial, setCopiedSerial] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  // Personel Sekmesi Mobil Filtre Görünürlüğü
  const [showPersonnelFilters, setShowPersonnelFilters] = useState(false);
  const viewedHardware = viewingHardwareId
    ? hardwareById.get(viewingHardwareId)
    : null;
  // TRANSFER durumundaki sahte atamaları personel profili olarak açmasını engeller
  const viewedHardwarePersonCandidate =
    viewedHardware?.assignedTo && viewedHardware?.status !== 'Transfer'
      ? personnelById.get(viewedHardware.assignedTo)
      : null;
  const viewedHardwarePerson =
    viewedHardwarePersonCandidate &&
    !String(viewedHardwarePersonCandidate.name).toUpperCase().includes('GÖNDEREN:')
      ? viewedHardwarePersonCandidate
      : null;

  const [viewingPersonId, setViewingPersonId] = useState(null);
  const viewedPerson = viewingPersonId
    ? personnelById.get(viewingPersonId)
    : null;
  const viewedPersonHardware = viewedPerson
    ? hardwareByAssignee.get(viewedPerson.id) || []
    : [];
  const [showAdPasswordResetModal, setShowAdPasswordResetModal] = useState(false);
  const [adPasswordJobs, setAdPasswordJobs] = useState([]);
  const getPersonAdLogin = (person) => {
    if (!person) return '';
    if (person.adUser) return person.adUser;
    if (person.email && person.email.includes('@')) return person.email.split('@')[0];
    return '';
  };
  const viewedPersonAdLogin = getPersonAdLogin(viewedPerson);
  const latestAdPasswordJob = useMemo(() => {
    if (!viewedPersonAdLogin) return null;
    const target = viewedPersonAdLogin.toLocaleLowerCase('tr-TR');
    return adPasswordJobs.find((job) => String(job.adUser || '').toLocaleLowerCase('tr-TR') === target) || null;
  }, [adPasswordJobs, viewedPersonAdLogin]);
  const latestAdPasswordJobView = getAdPasswordJobView(latestAdPasswordJob?.status);
  const hasActiveAdPasswordJob = Boolean(latestAdPasswordJobView?.active);
  const handlePersonPhoneSaved = (personId, phone) => {
    if (!personId || !phone) return;
    setPersonnel((prev) =>
      prev.map((p) => (p.id === personId ? { ...p, phone } : p))
    );
  };

  useEffect(() => {
    if (!currentUser?.token) {
      setAdPasswordJobs([]);
      return undefined;
    }

    const handleQueueUpdate = (event) => {
      const jobs = Array.isArray(event?.detail?.jobs) ? event.detail.jobs : [];
      setAdPasswordJobs(jobs.filter((job) => job.kind === 'ad-password'));
    };

    window.addEventListener('istek:operation-queue-updated', handleQueueUpdate);
    return () =>
      window.removeEventListener('istek:operation-queue-updated', handleQueueUpdate);
  }, [currentUser?.token]);

  // --- SEÇİM (CHECKBOX) VE BASILI TUTMA FONKSİYONLARI ---
  const handleToggleBulk = (id) => {
    setSelectedBulkHardware((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Düzeltildi: Sadece o sayfada görünenleri seç/kaldır
  const handleSelectAllBulk = (e, itemsInCurrentPage) => {
    if (e.target.checked) {
      const newIds = itemsInCurrentPage.map((h) => h.id);
      setSelectedBulkHardware((prev) => [...new Set([...prev, ...newIds])]);
    } else {
      const pageIds = itemsInCurrentPage.map((h) => h.id);
      setSelectedBulkHardware((prev) =>
        prev.filter((id) => !pageIds.includes(id))
      );
    }
  };

  const handlePersonnelToggleBulk = (id) => {
    setSelectedBulkPersonnel((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const isSelectionMode = selectedBulkHardware.length > 0;
  const pressTimerRef = useRef(null);
  const handleTouchStart = (id) => {
    if (isSelectionMode) return;
    pressTimerRef.current = setTimeout(() => {
      handleToggleBulk(id);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };
  const handleTouchEnd = () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  };

  const isPersonnelSelectionMode = selectedBulkPersonnel.length > 0;
  const personnelPressTimerRef = useRef(null);
  const handlePersonnelTouchStart = (id) => {
    if (isPersonnelSelectionMode) return;
    personnelPressTimerRef.current = setTimeout(() => {
      handlePersonnelToggleBulk(id);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };
  const handlePersonnelTouchEnd = () => {
    if (personnelPressTimerRef.current)
      clearTimeout(personnelPressTimerRef.current);
  };
  // --- GLPI SEÇİM (CHECKBOX) VE BASILI TUTMA FONKSİYONLARI ---
  const [showMissingGlpiFilters, setShowMissingGlpiFilters] = useState(false);
  const isGlpiSelectionMode = selectedMissingGlpiIds.length > 0;
  const glpiPressTimerRef = useRef(null);

  const handleGlpiToggleBulk = (id) => {
    setSelectedMissingGlpiIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleGlpiTouchStart = (id) => {
    if (isGlpiSelectionMode) return;
    glpiPressTimerRef.current = setTimeout(() => {
      handleGlpiToggleBulk(id);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const handleGlpiTouchEnd = () => {
    if (glpiPressTimerRef.current) clearTimeout(glpiPressTimerRef.current);
  };

  const handlePdfClick = (url, title) => {
    if (!url) {
      setPreviewPdf(null);
      return;
    }

    const safeUrl = toSafeExternalUrl(url, { allowBlob: true });
    if (!safeUrl) {
      showAppAlert('Belge bağlantısı güvenli olmadığı için açılamadı.');
      return;
    }

    if (safeUrl.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = safeUrl;
      a.download = title.endsWith('.pdf') ? title : `${title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // 1. Ekran boyutuna göre mobil kontrolü
      const isMobileWidth = window.innerWidth < 768;
      
      // 2. Cihaz tipine göre Apple (iOS/iPadOS) kontrolü (Genişlikten bağımsız!)
      const isAppleDevice = 
        /iPad|iPhone|iPod/.test(navigator.userAgent) || 
        // iPadOS 13+ Safari Masaüstü gibi davranır, bunu da yakalamak zorundayız:
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      // EĞER CİHAZ MOBİLSE VEYA APPLE CİHAZIYSA DOĞRUDAN YENİ SEKMEYE GİT!
      if (isMobileWidth || isAppleDevice) {
        openSafeExternalUrl(safeUrl);
      } else {
        // Masaüstü Windows cihazlarda (Chrome/Edge vb.) modal (iframe) içinde aç
        const embedUrl = toSafeDriveEmbedUrl(safeUrl);
        if (embedUrl) {
          setPreviewPdf({ url: safeUrl, embedUrl, title });
        } else {
          openSafeExternalUrl(safeUrl);
        }
      }
    }
  };

  // YENİ: Yenileme Butonu İçin State
  const [isRefreshing, setIsRefreshing] = useState(false);

  // GÜVENLİ HALE GETİRİLMİŞ VERİ ÇEKME FONKSİYONU
  const fetchVeritabani = async (showLoader = false, { preferDelta = false } = {}) => {
    // Güvenlik duvarı: Oturum yoksa veya token yoksa veritabanına istek atma!
    if (!currentUser || !currentUser.token) return;

    if (showLoader) setIsRefreshing(true);
    if (dataFetchInFlightRef.current) {
      try {
        return await dataFetchInFlightRef.current;
      } finally {
        if (showLoader) setIsRefreshing(false);
      }
    }

    const canUseDelta =
      preferDelta &&
      Boolean(lastDataSyncRef.current) &&
      Date.now() - lastFullSyncAtRef.current < FULL_DATA_SYNC_INTERVAL_MS;

    const request = (async () => {
      const data = await postApiAction({
        action: 'fetchData',
        authToken: currentUser.token,
        ...(canUseDelta ? { since: lastDataSyncRef.current } : {}),
      });

      const responseMode = data.sync?.mode === 'delta' ? 'delta' : 'full';
      const syncServerTime = data.sync?.serverTime || new Date().toISOString();

      if (responseMode === 'delta') {
        setPersonnel((previous) => mergeRecordsById(previous, data.personnel));
        setHardware((previous) => mergeRecordsById(previous, data.hardware));
      } else {
        setPersonnel(data.personnel || []);
        setHardware(data.hardware || []);
        lastFullSyncAtRef.current = Date.now();
        scheduleDataCacheWrite(currentUser, { ...data, syncServerTime });
      }

      lastDataSyncRef.current = syncServerTime;
      return data;
    })();

    dataFetchInFlightRef.current = request;
    try {
      return await request;
    } catch (err) {
      console.error('Veri çekme hatası:', err);
      if (showLoader) showAppAlert('Veriler yenilenirken hata oluştu: ' + err.message);
    } finally {
      if (dataFetchInFlightRef.current === request) dataFetchInFlightRef.current = null;
      if (showLoader) setIsRefreshing(false);
    }
  };

  const fetchMissingGlpiDevices = async (showLoader = true) => {
    if (!currentUser?.token) {
      setMissingGlpiLoadError('GLPI cihazlarını görüntülemek için yeniden giriş yapın.');
      return null;
    }

    if (showLoader) setIsLoadingMissingGlpi(true);

    if (missingGlpiFetchInFlightRef.current) {
      try {
        return await missingGlpiFetchInFlightRef.current;
      } finally {
        if (showLoader) setIsLoadingMissingGlpi(false);
      }
    }

    setMissingGlpiLoadError('');
    const request = (async () => {
      const data = await postApiAction({
        action: 'fetchMissingGLPIDevices',
        authToken: currentUser.token,
      });

      if (!Array.isArray(data?.devices)) {
        throw new Error('Sunucu GLPI cihaz listesini beklenen biçimde döndürmedi.');
      }

      setMissingGlpiDevices(data.devices);
      setSelectedMissingGlpiIds([]);
      return data;
    })();

    missingGlpiFetchInFlightRef.current = request;
    try {
      return await request;
    } catch (err) {
      console.error('GLPI eksik cihazlar çekilemedi:', err);
      setMissingGlpiLoadError(err.message || 'GLPI cihazları alınamadı.');
      showAppAlert('GLPI eksikleri alınamadı: ' + err.message);
      return null;
    } finally {
      if (missingGlpiFetchInFlightRef.current === request) {
        missingGlpiFetchInFlightRef.current = null;
      }
      if (showLoader) setIsLoadingMissingGlpi(false);
    }
  };

  const handleImportMissingGlpiDevices = async () => {
    if (selectedMissingGlpiIds.length === 0) {
      showAppAlert('Lütfen Donanımlar listesine eklenecek GLPI cihazlarını seçin.');
      return;
    }

    const ok = await confirmAppAction({
      title: 'GLPI cihazlarını ekle',
      message: `${selectedMissingGlpiIds.length} GLPI cihazı Donanımlara Depoda olarak eklenecek. Onaylıyor musunuz?`,
      confirmLabel: 'Donanımlara ekle',
      cancelLabel: 'Vazgeç',
    });
    if (!ok) return;

    setIsImportingMissingGlpi(true);
    try {
      const data = await postApiAction({
        action: 'importMissingGLPIDevices',
        authToken: currentUser.token,
        glpiIds: selectedMissingGlpiIds,
        clientIp,
      });
      setSuccessMessage(`${data.imported || selectedMissingGlpiIds.length} GLPI cihazı Donanımlar listesine eklendi.`);
      setTimeout(() => setSuccessMessage(null), 2500);
      await fetchVeritabani(false);
      await fetchMissingGlpiDevices(false);
    } catch (err) {
      console.error('GLPI import hatası:', err);
      showAppAlert('GLPI cihazları eklenemedi: ' + err.message);
    } finally {
      setIsImportingMissingGlpi(false);
    }
  };

  const updatePersonnelBulkSelection = (checked, items) => {
    const itemIds = items.map((person) => person.id);
    const itemIdSet = new Set(itemIds);
    setSelectedBulkPersonnel((previous) => {
      if (checked) return Array.from(new Set([...previous, ...itemIds]));
      return previous.filter((id) => !itemIdSet.has(id));
    });
  };

  const fetchSignatureMeta = async (showLoader = false) => {
    if (!currentUser?.token) return;
    if (showLoader) setIsLoadingSignatureTitles(true);
    try {
      const data = await postApiAction({
        action: 'fetchSignatureMeta',
        authToken: currentUser.token,
      });
      setSignatureTitles(data.titles || []);
      setSignatureCampuses(data.campuses || []);
      setCanChooseSignatureCampus(Boolean(data.canChooseCampus));
    } catch (err) {
      console.error('İmza ünvanları alınamadı:', err);
      if (showLoader) showAppAlert('İmza ünvanları alınamadı: ' + err.message);
    } finally {
      if (showLoader) setIsLoadingSignatureTitles(false);
    }
  };

  const handleCreatePersonnelSignature = async ({ personId, titleTr, signatureCampus }) => {
    if (!currentUser?.token || !personId || !titleTr) return;
    setIsCreatingSignature(true);
    try {
      const data = await postApiAction({
        action: 'createPersonnelSignature',
        authToken: currentUser.token,
        personId,
        titleTr,
        signatureCampus,
        clientIp,
      });

      setPersonnel((prev) =>
        prev.map((person) =>
          person.id === personId
            ? {
                ...person,
                department: data.titleTr || titleTr,
                signatureLink: data.signatureLink || person.signatureLink,
                signatureId: data.signatureId || person.signatureId,
                signatureStatus: data.signatureStatus || person.signatureStatus,
                signatureTitleEn: data.titleEn || person.signatureTitleEn,
                signatureCampus: data.signatureCampus || person.signatureCampus,
                signatureTemplateVariant: data.signatureTemplateVariant || person.signatureTemplateVariant,
                signatureUpdatedAt: data.signatureUpdatedAt || person.signatureUpdatedAt,
                signatureMissing: false,
              }
            : person
        )
      );
      setSignatureModalPerson(null);
      setSuccessMessage('İmza üretim dosyaları hazırlandı. Windows imza otomasyonu sıradaki çalışmada işleyecek.');
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      console.error('İmza oluşturma hatası:', err);
      showAppAlert('İmza oluşturulamadı: ' + err.message);
    } finally {
      setIsCreatingSignature(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'glpiMissing' && currentUser?.token) {
      fetchMissingGlpiDevices(true);
    }
  }, [activeTab, currentUser?.token]);

  useEffect(() => {
    if (currentUser?.token) fetchSignatureMeta(false);
  }, [currentUser?.token]);


  // --- GÜVENLİ İLK AÇILIŞ VE AKILLI ÖNBELLEK (CACHE) SİSTEMİ ---
  useEffect(() => {
    // KULLANICI GİRİŞ YAPMAMIŞSA (Login Ekranındaysa) HİÇBİR ŞEY YÜKLEME!
    if (!currentUser || !currentUser.token) {
      setIsLoading(false);
      return;
    }

    const cachedData = readDataCache(currentUser);
    lastDataSyncRef.current = '';
    lastFullSyncAtRef.current = 0;

    if (cachedData) {
      setPersonnel(cachedData.personnel || []);
      setHardware(cachedData.hardware || []);
      lastDataSyncRef.current =
        cachedData.syncServerTime || new Date(Number(cachedData.cachedAt) - 5000).toISOString();
      lastFullSyncAtRef.current = Number(cachedData.cachedAt || Date.now());
      setIsLoading(false);
      
      fetchVeritabani(false, { preferDelta: true }); // Arka planda yalnız değişenleri yenile
    } else {
      // Hafıza boşsa Google'dan zorla bekleterek çek
      setIsLoading(true); 
      fetchVeritabani(true).then(() => setIsLoading(false));
    }
  }, [currentUser]);

  useEffect(() => {
    const handleSessionExpired = (event) => {
      const message =
        event?.detail?.message || 'Oturum süreniz doldu. Lütfen yeniden giriş yapın.';
      resetClientSession();
      showAppAlert(message, {
        type: 'warning',
        title: 'Oturum sona erdi',
        dedupeKey: 'session-expired',
        confirmLabel: 'Giriş ekranına dön',
      });
    };

    window.addEventListener(API_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(API_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  useEffect(() => {
    if (!currentUser?.token) return undefined;

    let lastSyncAt = Date.now();
    const syncQuietly = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSyncAt < 45000) return;
      lastSyncAt = now;
      const shouldUseDelta =
        Date.now() - lastFullSyncAtRef.current < FULL_DATA_SYNC_INTERVAL_MS;
      fetchVeritabani(false, { preferDelta: shouldUseDelta });
    };

    const intervalId = window.setInterval(syncQuietly, 90000);
    const handleFocus = () => syncQuietly();
    const handleVisibilityChange = () => syncQuietly();

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- EXCEL VE GOOGLE SHEETS DIŞA AKTARIMI ---
  const getFormattedDataForExport = (data, type) => {
    if (type === 'hardware') {
      return data.map((item) => ({
        Tip: item.type || '-',
        'Marka / Model': `${item.brand} ${item.model}`,
        'Seri No': item.serial || '-',
        Durum:
          item.status === 'Available'
            ? 'Depoda'
            : item.status === 'Hurda'
            ? 'Hurda'
            : item.status === 'Faulty'
            ? 'Arızalı'
            : item.status === 'Transfer'
            ? 'Transfer'
            : 'Zimmetli',
        Personel: personnelById.get(item.assignedTo)?.name || '-',
        Kampüs: item.campus || '-',
      }));
    } else {
      // YENİ: Personel detaylı dışa aktarımı
      return data.map((person) => {
        // Bu personele zimmetli olan tüm donanımları bul
        const assignedHardware = hardwareByAssignee.get(person.id) || [];

        // Donanımların detaylarını virgülle ayırarak tek satırda topla
        const cihazDetaylari = assignedHardware.length > 0 
          ? assignedHardware.map(h => `${h.brand} ${h.model}`).join('  |  ') 
          : '-';

        const serialNumbers = assignedHardware.length > 0
          ? assignedHardware.map(h => h.serial).join('  |  ') 
          : '-';

        const zimmetBelgeleri = assignedHardware.length > 0 
          ? assignedHardware.map(h => h.driveLink ? h.driveLink : 'Belge Yok').join('  |  ') 
          : '-';

        return {
          'Personel Adı': person.name || '-',
          'Departman / Görev': person.department || '-',
          'E-Posta': person.email || '-',
          'Kampüs': person.campus || '-',
          'Toplam Cihaz': assignedHardware.length,
          'Zimmetli Cihazlar': cihazDetaylari,
          'Seri Numaraları': serialNumbers,
          'Zimmet Tutanak Linkleri': zimmetBelgeleri,
        };
      });
    }
  };

  const handleExportExcel = async (data, filename, type) => {
    if (data.length === 0) return showAppAlert('Dışa aktarılacak veri bulunamadı.');

    setIsGenerating(true);
    try {
      const result = await postApiAction(
        {
          authToken: currentUser.token,
          action: 'createSheet',
          format: 'xlsx',
          sheetName: `${filename.replace(/_/g, ' ')} (${new Date().toLocaleDateString('tr-TR')})`,
          data: getFormattedDataForExport(data, type),
        },
        { timeoutMs: 120000 }
      );
      await downloadGeneratedExport(result.url, `${filename}.xlsx`);
    } catch (error) {
      await showAppAlert(`Excel dosyası oluşturulamadı: ${error.message}`, {
        type: 'error',
        title: 'Dışa aktarma hatası',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateGoogleSheet = async (data, type) => {
    if (data.length === 0) return showAppAlert('Aktarılacak veri bulunamadı.');

    // YENİ: window.confirm yerine şık Modal açıyoruz
    setConfirmDialog({
      message: `Seçilen ${data.length} kayıtla yeni bir Google Sheet oluşturulacak ve düzenleme yetkisi hesabınıza verilecek. Devam edilsin mi?`,
      type: 'info',
      onConfirm: async () => {
        setConfirmDialog(null);

        try {
          const formattedData = getFormattedDataForExport(data, type);
          const result = await postApiAction(
            {
              authToken: currentUser.token,
              action: 'createSheet',
              format: 'google-sheet',
              sheetName: `Dışa Aktarım - ${
                type === 'hardware' ? 'Donanım' : 'Personel'
              } (${new Date().toLocaleDateString('tr-TR')})`,
              data: formattedData,
            },
            { timeoutMs: 30000 }
          );

          if (!result.queued || !result.queueId) {
            throw new Error(result.error || 'Dışa aktarım kuyruğa alınamadı.');
          }
          window.dispatchEvent(
            new CustomEvent(OPERATION_QUEUE_REFRESH_EVENT, {
              detail: {
                queueId: result.queueId,
                expectCompletion: true,
              },
            })
          );
        } catch (err) {
          await showAppAlert('İşlem başarısız: ' + err.message, {
            type: 'error',
            title: 'Dışa aktarma hatası',
          });
        }
      },
    });
  };

  // YENİ: OPTIMISTIC UI (İYİMSER ARAYÜZ) İLE IŞIK HIZINDA TOPLU İŞLEM
  const handleBulkAction = async (actionType, targetCampus = null) => {
    if (selectedBulkHardware.length === 0) return;

    const assignedSelectionCount = selectedBulkHardware.reduce(
      (count, id) => count + (hardwareById.get(id)?.assignedTo ? 1 : 0),
      0
    );
    const assignmentWarning = assignedSelectionCount > 0
      ? ` ${assignedSelectionCount} cihaz halen personele zimmetli; devam ederseniz mevcut zimmet bağlantısı kaldırılacak.`
      : '';

    let confirmMsg = '';
    let msgType = 'info';
    if (actionType === 'Depo') {
      confirmMsg = `${selectedBulkHardware.length} adet cihaz depoya çekilecek.${assignmentWarning} Onaylıyor musunuz?`;
    } else if (actionType === 'Hurda') {
      confirmMsg = `${selectedBulkHardware.length} adet cihaz HURDAYA ayrılacak.${assignmentWarning} Emin misiniz?`;
      msgType = 'danger';
    } else if (actionType === 'Arızalı') {
      confirmMsg = `${selectedBulkHardware.length} adet cihaz ARIZALI olarak işaretlenecek.${assignmentWarning} Onaylıyor musunuz?`;
    } else if (actionType === 'Transfer') {
      confirmMsg = `${selectedBulkHardware.length} adet cihaz ${targetCampus} kampüsüne transfer edilecek. Onaylıyor musunuz?`;
    }

    setConfirmDialog({
      message: confirmMsg,
      type: msgType,
      onConfirm: () => {
        setConfirmDialog(null); // Sadece modalı kapat. YÜKLENİYOR EKRANINI AÇMA!

        // 1. ADIM: EKRANI (REACT STATE) ANINDA GÜNCELLE (Kullanıcı 0 saniye bekler)
        // Eğer işlem başarısız olursa geri alabilmek için eski veriyi hafızada tutuyoruz
        const previousHardwareState = [...hardware];
        const selectedIdsToProcess = [...selectedBulkHardware];

        setHardware((prev) =>
          prev.map((h) => {
            if (selectedIdsToProcess.includes(h.id)) {
              if (actionType === 'Depo') return { ...h, status: 'Available', assignedTo: null };
              if (actionType === 'Hurda') return { ...h, status: 'Hurda', assignedTo: null };
              if (actionType === 'Arızalı') return { ...h, status: 'Faulty', assignedTo: null };
              // YENİ: Ekranda kampüs adını anında temizleyerek gösterir (Örn: "Acıbadem Kampüsü" -> "Acıbadem")
              if (actionType === 'Transfer') return { ...h, campus: getCoreCampusName(targetCampus) }; 
            }
            return h;
          })
        );

        // Seçimleri temizle ve minik bir başarılı uyarısı göster (Ekranı kilitlemeyen toast)
        setSelectedBulkHardware([]);
        setBulkCampusTransferMode(false);
        setBulkTargetCampus('');
        
        // isGenerating'i açmadığımız için ekran dönmez, sadece ufak bir bildirim çıkar
        setSuccessMessage(`İşlem arka planda başarıyla kaydediliyor...`);
        setTimeout(() => setSuccessMessage(null), 2000);

        // 2. ADIM: ARKA PLANDA SESSİZCE GOOGLE SHEETS'İ GÜNCELLE
        if (actionType === 'Depo' || actionType === 'Hurda' || actionType === 'Arızalı') {
          postApiAction({
            authToken: currentUser.token,
            action: 'bulkStatusUpdate',
            hardwareIds: selectedIdsToProcess,
            newStatus:
              actionType === 'Depo'
                ? 'Available'
                : actionType === 'Arızalı'
                ? 'Faulty'
                : 'Hurda',
            confirmUnassignAssigned: assignedSelectionCount > 0,
          })
          .then(() => {
             // Başarılıysa arka planda sessizce önbelleği yenile
             fetchVeritabani(false);
          })
          .catch(error => {
             console.error('Arka Plan Hatasi:', error);
             // YENİ: EĞER SUNUCU ÇÖKERSE, EKRANI ESKİ HALİNE GERİ ÇEVİR VE UYAR!
             setHardware(previousHardwareState);
             showAppAlert(`UYARI: İnternet veya sunucu hatası nedeniyle "${actionType}" işlemi kaydedilemedi. Cihazlar eski durumuna döndürüldü.`);
          });
        }
      },
    });
  };

  const finishGoogleLogin = async (payload, profile = {}) => {
    setIsLoggingIn(true);

    try {
      const result = await postApiAction(
        {
          action: 'verifyLogin',
          ...payload,
        },
        { timeoutMs: 30000, notifySessionExpired: false }
      );

      if (result.success) {
        const userData = {
          id: result.email,
          name: result.name || profile.name || result.email.split('@')[0],
          email: result.email,
          role: result.role,
          isSuperAdmin: Boolean(result.isSuperAdmin),
          campus: result.campus,
          picture: profile.picture || result.picture,
          token:
            result.sessionToken ||
            (result.sessionMode === 'cookie' ? COOKIE_SESSION_SENTINEL : ''),
          sessionMode: result.sessionMode || 'token',
          expiresAt:
            Date.now() + Number(result.expiresInSeconds || 6 * 60 * 60) * 1000
        };
        
        clearStoredDataCaches();
        localStorage.setItem('istek_it_user', JSON.stringify(userData));
        setAuthNotice('');
        
        // ÇÖZÜM: State'leri anında ve sırayla güncelle, setTimeout kullanımını kaldır.
        setCurrentUser(userData);
        setIsLoading(true); // Veritabanı çekilme işlemine başla
        setActiveTab('hardware');
      }
    } catch (error) {
      showAppAlert('Giriş Başarısız: ' + error.message);
      setIsLoggingIn(false);
    }
  };

  const handleGoogleAccessTokenSuccess = async (tokenResponse) => {
    if (!tokenResponse?.access_token) {
      setIsLoggingIn(false);
      showAppAlert('Google erişim bilgisi alınamadı. Lütfen tekrar deneyin.');
      return;
    }
    finishGoogleLogin({ googleAccessToken: tokenResponse.access_token });
  };

  const handleGoogleError = (error) => {
    setIsLoggingIn(false);
    const errorType = error?.type || error?.error || '';
    if (errorType === 'popup_closed' || errorType === 'popup_closed_by_user') return;
    showAppAlert('Google ile giriş yapılamadı. Tarayıcınızda pop-up engelleyici varsa kapatınız.');
  };

  const isHQ = currentUser?.campus === 'Genel Müdürlük';

  // --- YENİ: SADECE KAMPÜSÜN "ÖZ İSMİNE" BAKAN FİLTRE ---
  // (İçindeki "Kampüsü" kelimesini silip sadece "Acıbadem" veya "Antalya (Lara)" kısmını eşleştirir)
  const getCoreCampusName = (str) => {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/kampüsü/g, '')
      .replace(/kamp?s?/g, '')
      .replace(/kampüs/g, '')
      .replace(/kamp?s/g, '')
      .trim(); // Başındaki ve sonundaki boşlukları atar
  };

  const getCleanGlpiCampusLabel = (value) => {
    const raw = value === null || value === undefined ? '' : String(value).trim();
    const rawLower = toTrLower(raw);
    if (
      !raw ||
      raw === '-' ||
      raw === '0' ||
      /^\d+$/.test(raw) ||
      ['bilinmiyor', 'yok', 'null', 'undefined'].includes(rawLower)
    ) {
      return '';
    }

    const withoutCampusWord = raw
      .replace(/kampüsü/gi, '')
      .replace(/kampusu/gi, '')
      .replace(/kampüs/gi, '')
      .replace(/kampus/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const core = toTrLower(withoutCampusWord);
    if (!core) return '';

    const officialCampus = Object.keys(CAMPUS_CODES).find((campusName) => {
      const officialCore = toTrLower(
        campusName
          .replace(/kampüsü/gi, '')
          .replace(/kampusu/gi, '')
          .replace(/kampüs/gi, '')
          .replace(/kampus/gi, '')
          .replace(/\s+/g, ' ')
          .trim()
      );
      return officialCore === core;
    });

    if (officialCampus) {
      return officialCampus.replace(/\s*Kampüsü\s*$/i, '').trim();
    }

    return withoutCampusWord
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR'))
      .join(' ');
  };

  const isSignatureEligiblePerson = (person) => {
    const status = String(person?.status || 'Aktif').toLocaleLowerCase('tr-TR');
    const missingUserStatus = 'kullanıcı bulunamadı';
    const asciiSafeStatus = status.replace(/ı/g, 'i');
    const asciiSafeMissingUserStatus = missingUserStatus.replace(/ı/g, 'i');
    return !status.includes('pasif') &&
      !status.includes(missingUserStatus) &&
      !asciiSafeStatus.includes(asciiSafeMissingUserStatus);
  };

  const myCoreCampus = getCoreCampusName(currentUser?.campus);

  // ==========================================
  // ⚡ OPTİMİZE EDİLMİŞ FİLTRE VE SIRALAMA (USEMEMO) ⚡
  // Klavye yazımındaki donmaları ve anlamsız render'ları engeller
  // ==========================================

  // 1. KAMPÜS BAZLI ANA LİSTELER
  const campusHardware = useMemo(() => {
    return isHQ
      ? hardware.filter((h) => campusFilter === 'All' || h.campus === campusFilter)
      : hardware.filter((h) => getCoreCampusName(h.campus) === myCoreCampus);
  }, [hardware, isHQ, campusFilter, myCoreCampus]);

  const campusPersonnel = useMemo(() => {
    return isHQ
      ? personnel.filter((p) => (campusFilter === 'All' || p.campus === campusFilter) && !String(p.name).toUpperCase().includes('GÖNDEREN:'))
      : personnel.filter((p) => getCoreCampusName(p.campus) === myCoreCampus && !String(p.name).toUpperCase().includes('GÖNDEREN:'));
  }, [personnel, isHQ, campusFilter, myCoreCampus]);

  const profileAssignmentPersonnel = useMemo(() => {
    const hardwareCampus = getCoreCampusName(viewedHardware?.campus);
    if (!hardwareCampus) return [];

    return personnel.filter(
      (person) =>
        getCoreCampusName(person.campus) === hardwareCampus &&
        isSignatureEligiblePerson(person) &&
        !String(person.name || '').toUpperCase().includes('GÖNDEREN:')
    );
  }, [personnel, viewedHardware?.campus]);

  // 2. ARAMA VE DURUM FILTRELERI
  const displayHardware = useMemo(() => {
    const normalizeTypeFilter = (value) =>
      toTrLower(String(value || '').replace(/\s*\(pc\)/gi, '').replace(/\s+pc$/i, '').trim());
    const safeFilter = normalizeTypeFilter(hardwareFilterType);
    const searchTerms = toTrLower(hardwareSearchQuery).split(/\s+/).filter(Boolean);

    return campusHardware.filter((h) => {
      const safeType = normalizeTypeFilter(h.type);
      const matchType = hardwareFilterType === 'All' || safeType === safeFilter;

      let matchStatus = true;
      if (hardwareFilterStatus !== 'All') {
        if (hardwareFilterStatus === 'Zimmetli') matchStatus = h.status === 'Assigned';
        if (hardwareFilterStatus === 'Depoda') matchStatus = h.status === 'Available';
        if (hardwareFilterStatus === 'Hurda') matchStatus = h.status === 'Hurda';
        if (hardwareFilterStatus === 'Arızalı') matchStatus = h.status === 'Faulty';
        if (hardwareFilterStatus === 'Transfer') matchStatus = h.status === 'Transfer';
      }

      if (searchTerms.length === 0) return matchType && matchStatus;

      const personName = personnelById.get(h.assignedTo)?.name || h.assignedTo || '';
      const combinedString = toTrLower(`${h.brand} ${h.model} ${h.serial} ${h.deviceName || ''} ${personName} ${h.groupName || ''} ${h.glpiComputerName || ''} ${h.glpiAdUser || ''} ${h.glpiPersonName || ''}`);
      const matchSearch = searchTerms.every((term) => combinedString.includes(term));

      return matchType && matchStatus && matchSearch;
    });
  }, [campusHardware, hardwareFilterType, hardwareFilterStatus, hardwareSearchQuery, personnelById]);

  const missingGlpiTypeOptions = useMemo(() => {
    const values = Array.from(new Set(missingGlpiDevices.map((item) => item.deviceType).filter(Boolean)));
    return ['All', ...values.sort((a, b) => a.localeCompare(b, 'tr'))];
  }, [missingGlpiDevices]);

  const missingGlpiCampusOptions = useMemo(() => {
    const byCore = new Map();
    missingGlpiDevices.forEach((item) => {
      const label = getCleanGlpiCampusLabel(item.inferredCampus);
      if (!label) return;
      const core = getCoreCampusName(label);
      if (!core || byCore.has(core)) return;
      byCore.set(core, label);
    });
    const values = Array.from(byCore.values());
    return ['All', ...values.sort((a, b) => a.localeCompare(b, 'tr'))];
  }, [missingGlpiDevices]);

  useEffect(() => {
    if (
      missingGlpiFilterCampus !== 'All' &&
      !missingGlpiCampusOptions.includes(missingGlpiFilterCampus)
    ) {
      setMissingGlpiFilterCampus('All');
    }
  }, [missingGlpiCampusOptions, missingGlpiFilterCampus]);

  useEffect(() => {
    if (
      missingGlpiFilterType !== 'All' &&
      !missingGlpiTypeOptions.includes(missingGlpiFilterType)
    ) {
      setMissingGlpiFilterType('All');
    }
  }, [missingGlpiTypeOptions, missingGlpiFilterType]);

  const displayMissingGlpiDevices = useMemo(() => {
    const query = toTrLower(missingGlpiSearchQuery).trim();
    const terms = query.split(/\s+/).filter(Boolean);
    return missingGlpiDevices.filter((item) => {
      const typeOk = missingGlpiFilterType === 'All' || item.deviceType === missingGlpiFilterType;
      const campusOk =
        !isHQ ||
        missingGlpiFilterCampus === 'All' ||
        getCoreCampusName(item.inferredCampus) === getCoreCampusName(missingGlpiFilterCampus);

      if (!typeOk || !campusOk) return false;
      if (!query) return true;

      const combined = toTrLower(
        `${item.computerName || ''} ${item.serial || ''} ${item.adUser || ''} ${item.matchedPersonName || ''} ${item.inferredCampus || ''} ${item.deviceType || ''} ${item.brand || ''} ${item.model || ''}`
      );
      return terms.every((term) => combined.includes(term));
    });
  }, [missingGlpiDevices, missingGlpiSearchQuery, missingGlpiFilterType, missingGlpiFilterCampus, isHQ]);

  const qrFoundHardware = useMemo(
    () => hardwareById.get(qrFoundHardwareId) || null,
    [hardwareById, qrFoundHardwareId]
  );

  const qrScannedHardware = useMemo(
    () =>
      qrScannedHardwareIds
        .map((id) => hardwareById.get(id))
        .filter(Boolean),
    [hardwareById, qrScannedHardwareIds]
  );

  const getHardwareQrPayload = (item) => `SN=${item?.serial || item?.id || item?.deviceName || ''}`;

  const handleOpenQrLabelPrint = (items) => {
    const printItems = (items || []).filter((item) => item && (item.serial || item.id || item.deviceName));
    if (printItems.length === 0) {
      showAppAlert('QR etiketi oluşturulacak cihaz bulunamadı.');
      return;
    }

    setQrLabelPrintItems(printItems);
  };

  const displayPersonnel = useMemo(() => {
    const searchTerms = toTrLower(personnelSearchQuery).split(/\s+/).filter(Boolean);
    return campusPersonnel.filter((p) => {
      let matchStatus = true;
      if (personnelFilterStatus !== 'All') matchStatus = (p.status || 'Aktif') === personnelFilterStatus;
      const matchSignature =
        personnelSignatureFilter === 'All' ||
        (personnelSignatureFilter === 'Missing' && isSignatureEligiblePerson(p) && !p.signatureLink) ||
        (personnelSignatureFilter === 'Ready' && Boolean(p.signatureLink));

      if (!matchStatus || !matchSignature) return false;
      if (searchTerms.length === 0) return true;

      const combinedString = toTrLower(`${p.name} ${p.email || ''} ${p.department || ''} ${p.title || ''}`);
      const matchSearch = searchTerms.every((term) => combinedString.includes(term));

      return matchSearch;
    });
  }, [campusPersonnel, personnelFilterStatus, personnelSignatureFilter, personnelSearchQuery]);

  // 3. SIRALAMA (SORTING)
  const handleSortHardware = (key) => setHardwareSort(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  const handleSortPersonnel = (key) => setPersonnelSort(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));

  const sortedHardware = useMemo(() => {
    if (!hardwareSort.key) return displayHardware;
    return [...displayHardware].sort((a, b) => {
      let aValue = '', bValue = '';
      if (hardwareSort.key === 'type') { aValue = a.type || ''; bValue = b.type || ''; }
      if (hardwareSort.key === 'brand') { aValue = `${a.brand} ${a.model}`; bValue = `${b.brand} ${b.model}`; }
      if (hardwareSort.key === 'serial') { aValue = a.serial || ''; bValue = b.serial || ''; }
      if (hardwareSort.key === 'status') { aValue = a.status || ''; bValue = b.status || ''; }
      if (hardwareSort.key === 'person') {
        aValue = personnelById.get(a.assignedTo)?.name || '';
        bValue = personnelById.get(b.assignedTo)?.name || '';
      }
      if (String(aValue).toLowerCase() < String(bValue).toLowerCase()) return hardwareSort.direction === 'asc' ? -1 : 1;
      if (String(aValue).toLowerCase() > String(bValue).toLowerCase()) return hardwareSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [displayHardware, hardwareSort, personnelById]);

  const sortedPersonnel = useMemo(() => {
    if (!personnelSort.key) return displayPersonnel;
    return [...displayPersonnel].sort((a, b) => {
      let aValue = '', bValue = '';
      if (personnelSort.key === 'name') { aValue = a.name || ''; bValue = b.name || ''; }
      if (personnelSort.key === 'dept') { aValue = a.department || ''; bValue = b.department || ''; }
      if (aValue.toLowerCase() < bValue.toLowerCase()) return personnelSort.direction === 'asc' ? -1 : 1;
      if (aValue.toLowerCase() > bValue.toLowerCase()) return personnelSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [displayPersonnel, personnelSort]);

  // YENİ: PAGINATION HESAPLAMALARI
  const hardwareTotalPages = Math.ceil(sortedHardware.length / ITEMS_PER_PAGE);
  const hardwareStartIndex = (hardwarePage - 1) * ITEMS_PER_PAGE;
  const paginatedHardware = sortedHardware.slice(
    hardwareStartIndex,
    hardwareStartIndex + ITEMS_PER_PAGE
  );

  const personnelTotalPages = Math.ceil(
    sortedPersonnel.length / ITEMS_PER_PAGE
  );
  const personnelStartIndex = (personnelPage - 1) * ITEMS_PER_PAGE;
  const paginatedPersonnel = sortedPersonnel.slice(
    personnelStartIndex,
    personnelStartIndex + ITEMS_PER_PAGE
  );

  const selectedHardwareIdSet = useMemo(
    () => new Set(selectedBulkHardware),
    [selectedBulkHardware]
  );
  const selectedHardwareOnPage = paginatedHardware.filter((item) =>
    selectedHardwareIdSet.has(item.id)
  ).length;
  const allHardwareOnPageSelected =
    paginatedHardware.length > 0 && selectedHardwareOnPage === paginatedHardware.length;
  const someHardwareOnPageSelected =
    selectedHardwareOnPage > 0 && !allHardwareOnPageSelected;
  const selectedFilteredHardware = sortedHardware.filter((item) =>
    selectedHardwareIdSet.has(item.id)
  ).length;
  const allFilteredHardwareSelected =
    sortedHardware.length > 0 && selectedFilteredHardware === sortedHardware.length;
  const someFilteredHardwareSelected =
    selectedFilteredHardware > 0 && !allFilteredHardwareSelected;

  const selectedPersonnelIdSet = useMemo(
    () => new Set(selectedBulkPersonnel),
    [selectedBulkPersonnel]
  );
  const selectedPersonnelOnPage = paginatedPersonnel.filter((person) =>
    selectedPersonnelIdSet.has(person.id)
  ).length;
  const allPersonnelOnPageSelected =
    paginatedPersonnel.length > 0 && selectedPersonnelOnPage === paginatedPersonnel.length;
  const somePersonnelOnPageSelected =
    selectedPersonnelOnPage > 0 && !allPersonnelOnPageSelected;
  const selectedFilteredPersonnel = sortedPersonnel.filter((person) =>
    selectedPersonnelIdSet.has(person.id)
  ).length;
  const allFilteredPersonnelSelected =
    sortedPersonnel.length > 0 && selectedFilteredPersonnel === sortedPersonnel.length;
  const someFilteredPersonnelSelected =
    selectedFilteredPersonnel > 0 && !allFilteredPersonnelSelected;

  const getSortIcon = (currentSort, key) => {
    if (currentSort.key !== key)
      return <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />;
    return currentSort.direction === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
    );
  };

  const renderDeviceTypeIcon = (type, className = 'w-4 h-4 text-gray-500') => {
    const t = toTrLower(type);
    if (t.includes('laptop')) return <Laptop className={className} />;
    if (t.includes('masaüst') || t.includes('masaust') || t.includes('desktop') || t === 'pc') return <Monitor className={className} />;
    if (t.includes('all in one') || t.includes('aio')) return <Monitor className={className} />;
    if (t.includes('akıllı') || t.includes('akilli') || t.includes('tahta') || t.includes('spc')) return <Monitor className={className} />;
    if (t.includes('monitör') || t.includes('monitor')) return <Monitor className={className} />;
    if (t.includes('set') || t.includes('klavye')) return <Keyboard className={className} />;
    if (t.includes('mouse')) return <Mouse className={className} />;
    return <HardDrive className={className} />;
  };

  const extractQrLookupValue = (rawValue) => {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';

    try {
      const url = new URL(raw);
      const fromUrl =
        url.searchParams.get('serial') ||
        url.searchParams.get('seri') ||
        url.searchParams.get('sn') ||
        url.searchParams.get('glpi') ||
        url.searchParams.get('glpiId') ||
        url.searchParams.get('computer') ||
        url.searchParams.get('name');
      if (fromUrl) return fromUrl.trim();
    } catch (e) {}

    const keyValueMatch = raw.match(/(?:serial|seri|sn|s\/n|glpi|glpi_id|glpiId|computer|cihaz|name)\s*[:=]\s*([^|;&\s]+)/i);
    if (keyValueMatch) return decodeURIComponent(keyValueMatch[1]).trim();

    return raw.replace(/^SN\s*[:=]\s*/i, '').trim();
  };

  const findHardwareByQrRaw = (rawValue) => {
    const lookup = toTrLower(extractQrLookupValue(rawValue));
    if (!lookup) return null;

    return hardware.find((item) => {
      const candidates = [
        item.id,
        item.serial,
        item.deviceName,
        item.glpiId,
        item.glpiComputerName,
      ].map((value) => toTrLower(value || ''));

      return candidates.some((value) => value && value === lookup);
    }) || null;
  };

  const getQrActionTargetIds = () =>
    selectedQrHardwareIds.length > 0 ? selectedQrHardwareIds : qrScannedHardwareIds;

    const handleQrLookup = (rawValue = qrInput) => {
      const cleanValue = String(rawValue || '').trim();
      if (!cleanValue) return;
    
      const now = Date.now();
      // AYNI KODU 3 SANİYE İÇİNDE TEKRAR OKUMASINI ENGELLER
      if (
        qrLastScanRef.current.value === cleanValue &&
        now - qrLastScanRef.current.at < 3000 
      ) {
        return;
      }
      qrLastScanRef.current = { value: cleanValue, at: now };
    
      const matchedHardware = findHardwareByQrRaw(cleanValue);
      setQrInput(cleanValue);

    if (!matchedHardware) {
      setQrFoundHardwareId(null);
      setQrScannerError('Bu QR mevcut Donanım listesinde bulunamadı.');
      return;
    }

    setQrFoundHardwareId(matchedHardware.id);
    setQrScannerError('');
    setQrScannedHardwareIds((prev) =>
      prev.includes(matchedHardware.id) ? prev : [matchedHardware.id, ...prev]
    );
    setSelectedQrHardwareIds((prev) =>
      prev.includes(matchedHardware.id) ? prev : [matchedHardware.id, ...prev]
    );
    setQrScanLog((prev) => {
      const alreadyLogged = prev.some(
        (entry) => entry.hardwareId === matchedHardware.id && entry.action === 'Okundu'
      );
      if (alreadyLogged) return prev;

      return [
        {
          id: `${Date.now()}-${matchedHardware.id}`,
          hardwareId: matchedHardware.id,
          action: 'Okundu',
          serial: matchedHardware.serial,
          deviceName: matchedHardware.deviceName || matchedHardware.glpiComputerName || '-',
          at: new Date().toLocaleString('tr-TR'),
        },
        ...prev.slice(0, 19),
      ];
    });
  };

  const stopQrCamera = () => {
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach((track) => track.stop());
      qrStreamRef.current = null;
    }
    setQrScannerActive(false);
  };

  // 1. KAMERAYI BASLATMA FONKSIYONU
  const handleStartQrCamera = async () => {
    setQrScannerError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setQrScannerError('Bu tarayıcı kamera erişimini desteklemiyor. Harici QR okuyucu veya manuel giriş kullanabilirsiniz.');
      return;
    }

    try {
      // iOS için arka kamera izni
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      qrStreamRef.current = stream;
      setQrScannerActive(true);
    } catch (error) {
      setQrScannerError('Kamera açılamadı. Tarayıcı kamera iznini veya telefon gizlilik ayarlarını kontrol edin.');
    }
  };

  // 2. VIDEO EKRANA GELDİĞİNDE GÖRÜNTÜYÜ BAĞLAMA (iOS İÇİN KRİTİK)
  useEffect(() => {
    if (qrScannerActive && qrVideoRef.current && qrStreamRef.current) {
      const video = qrVideoRef.current;
      video.srcObject = qrStreamRef.current;
      video.setAttribute('playsinline', 'true'); // iOS Safari'nin tam ekran açmasını engeller
      video.play().catch(e => console.error("Kamera başlatılmadı:", e));
    }
  }, [qrScannerActive]);

  // 3. APPLE (iOS) UYUMLU QR OKUMA DÖNGÜSÜ
  useEffect(() => {
    if (!qrScannerActive) return;

    let cancelled = false;
    let frameId = null;
    let qrDecoder = null;
    
    // Görüntüyü analiz etmek için gizli bir canvas oluşturuyoruz
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    import('jsqr')
      .then((module) => {
        if (!cancelled) {
          qrDecoder = module.default || module;
        }
      })
      .catch((error) => {
        console.error('QR okuyucu yüklenemedi:', error);
        if (!cancelled) {
          setQrScannerError('QR okuyucu yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
        }
      });

    const scan = () => {
      if (cancelled) return;

      if (qrVideoRef.current && qrDecoder && qrVideoRef.current.readyState === qrVideoRef.current.HAVE_ENOUGH_DATA) {
        const video = qrVideoRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Kameradaki o anki kareyi alıp canvas'a çiziyoruz
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

        // jsQR kütüphanesi ile Apple cihazlarında bile güvenle QR arıyoruz
        const code = qrDecoder(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          handleQrLookup(code.data);
        }
      }

      frameId = requestAnimationFrame(scan);
    };

    frameId = requestAnimationFrame(scan);

    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [qrScannerActive, hardware]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopQrCamera(), []);

  const handleQrInventoryMark = async () => {
    if (qrActionBusyRef.current) return;
    const targetIds = getQrActionTargetIds();
    if (targetIds.length === 0) return;

    qrActionBusyRef.current = true;
    setIsQrActionBusy(true);
    setQrActionLabel('Sayım kaydı yazılıyor...');
    setSuccessMessage(`${targetIds.length} cihaz için sayım kaydı yazılıyor...`);

    try {
      const targetItems = targetIds.map((hardwareId) => hardwareById.get(hardwareId)).filter(Boolean);
      const result = await postApiAction({
        authToken: currentUser.token,
        action: 'recordInventoryScan',
        scans: targetItems.map((item) => ({
          hardwareId: item.id,
          qrPayload: getHardwareQrPayload(item),
        })),
        clientIp,
      });
      const insertedIds = new Set(
        Array.isArray(result.hardwareIds) ? result.hardwareIds.map(String) : targetItems.map((item) => String(item.id))
      );
      const processed = targetItems
        .filter((item) => insertedIds.has(String(item.id)))
        .map((item) => ({
          item,
          scannedAt: result.scannedAt || new Date().toLocaleString('tr-TR'),
        }));
      const duplicateCount = Number(result.duplicateCount || 0);

      setQrScanLog((prev) => ([
        ...processed.map(({ item, scannedAt }) => ({
          id: `${Date.now()}-${item.id}`,
          hardwareId: item.id,
          action: 'Sayımda görüldü',
          serial: item.serial,
          deviceName: item.deviceName || item.glpiComputerName || '-',
          at: scannedAt,
        })),
        ...prev,
      ].slice(0, 20)));
      const duplicateMessage = duplicateCount > 0
        ? ` ${duplicateCount} cihaz son 30 saniyede zaten sayıldığı için tekrar yazılmadı.`
        : '';
      setSuccessMessage(
        processed.length > 0
          ? `${processed.length} cihaz sayımda görüldü olarak işlendi.${duplicateMessage}`
          : `Seçilen cihazlar son 30 saniyede zaten sayılmıştı; yeni kayıt oluşturulmadı.`
      );
      setTimeout(() => setSuccessMessage(null), 3500);
      setSelectedQrHardwareIds([]);
    } catch (error) {
      showAppAlert(`Sayım kaydı yazılamadı: ${error.message}`);
    } finally {
      qrActionBusyRef.current = false;
      setIsQrActionBusy(false);
      setQrActionLabel('');
    }
  };

  const handleQrStatusUpdate = (nextStatus) => {
    if (qrActionBusyRef.current) return;
    const targetIds = getQrActionTargetIds();
    if (targetIds.length === 0) return;

    const actionLabel =
      nextStatus === 'Available'
        ? 'Depoya çek'
        : nextStatus === 'Faulty'
        ? 'Arızalı olarak işaretle'
        : 'Hurdaya ayır';
    const assignedCount = targetIds.reduce(
      (count, id) => count + (hardwareById.get(id)?.assignedTo ? 1 : 0),
      0
    );
    const assignmentWarning = assignedCount > 0
      ? ` ${assignedCount} cihaz halen personele zimmetli; mevcut zimmet bağlantısı kaldırılacak.`
      : '';
    setConfirmDialog({
      message: `${targetIds.length} cihaz için "${actionLabel}" işlemi yapılacak.${assignmentWarning} Emin misiniz?`,
      type: nextStatus === 'Hurda' ? 'danger' : 'info',
      onConfirm: async () => {
        if (qrActionBusyRef.current) return;
        qrActionBusyRef.current = true;
        setIsQrActionBusy(true);
        setQrActionLabel(`${actionLabel} işlemi yapılıyor...`);
        setConfirmDialog(null);
        const previousHardwareState = [...hardware];
        const statusText = nextStatus;

        setHardware((prev) =>
          prev.map((item) =>
            targetIds.includes(item.id)
              ? { ...item, status: statusText, assignedTo: null }
              : item
          )
        );

        try {
          await postApiAction({
            authToken: currentUser.token,
            action: 'bulkStatusUpdate',
            hardwareIds: targetIds,
            newStatus: nextStatus,
            confirmUnassignAssigned: assignedCount > 0,
            clientIp,
          });

          setQrScanLog((prev) => [
            ...targetIds.map((hardwareId) => {
              const item = hardwareById.get(hardwareId);
              return {
              id: `${Date.now()}-${hardwareId}`,
              hardwareId,
              action: actionLabel,
              serial: item?.serial || hardwareId,
              deviceName: item?.deviceName || item?.glpiComputerName || '-',
              at: new Date().toLocaleString('tr-TR'),
              };
            }),
            ...prev.slice(0, 19),
          ]);
          setSelectedQrHardwareIds([]);
          fetchVeritabani(false);
        } catch (error) {
          setHardware(previousHardwareState);
          showAppAlert(`QR işlem hatası: ${error.message}`);
        } finally {
          qrActionBusyRef.current = false;
          setIsQrActionBusy(false);
          setQrActionLabel('');
        }
      },
    });
  };

  const handleQrStartZimmet = () => {
    if (qrActionBusyRef.current) return;
    const targetIds = getQrActionTargetIds();
    if (targetIds.length === 0) return;

    const blockedItems = targetIds
      .map((id) => hardwareById.get(id))
      .filter((item) => item && (item.status === 'Hurda' || item.status === 'Faulty' || item.status === 'Transfer'));
    if (blockedItems.length > 0) {
      showAppAlert('Hurda, arızalı veya transfer durumundaki cihazlar zimmete aktarılamaz.');
      return;
    }

    setSelectedHardware(targetIds);
    setSelectedPerson('');
    setAssignStep(1);
    setActiveTab('assign');
    setSuccessMessage(`${targetIds.length} cihaz sepete eklendi. Zimmet için personeli seçin.`);
    setTimeout(() => setSuccessMessage(null), 2500);
  };

  // YENİ: Transferdeki cihazlar zimmetlenemez! Sadece "Depoda" ve "Zimmetli" olanlar listelenir.
  const availableHardwareForAssign = useMemo(() => {
    const normalizeTypeFilter = (value) =>
      toTrLower(String(value || '').replace(/\s*\(pc\)/gi, '').replace(/\s+pc$/i, '').trim());
    const normalizedTypeFilter = normalizeTypeFilter(assignFilterType);
    const searchTerms = toTrLower(assignSearchQuery).split(/\s+/).filter(Boolean);

    return campusHardware.filter((h) => {
      if (h.status === 'Hurda' || h.status === 'Faulty' || h.status === 'Transfer') return false;
      const matchType =
        assignFilterType === 'All' ||
        (h.type && normalizeTypeFilter(h.type) === normalizedTypeFilter);

      let matchStatus = true;
      if (assignFilterStatus === 'Zimmetli')
        matchStatus = h.status === 'Assigned';
      if (assignFilterStatus === 'Depoda')
        matchStatus = h.status === 'Available';

      const matchCampus =
        assignFilterCampus === 'All' || h.campus === assignFilterCampus;

      const personName = personnelById.get(h.assignedTo)?.name || h.assignedTo || '';
      const groupN = h.groupName || '';
      const combinedString = toTrLower(
        `${h.brand} ${h.model} ${h.serial} ${personName} ${groupN}`
      );

      const matchSearch =
        searchTerms.length === 0 ||
        searchTerms.every((term) => combinedString.includes(term));

      return matchType && matchStatus && matchCampus && matchSearch;
    });
  }, [
    campusHardware,
    assignFilterType,
    assignFilterStatus,
    assignFilterCampus,
    assignSearchQuery,
    personnelById,
  ]);

  const handleCreateAssignment = () => {
    if (!selectedPerson || selectedHardware.length === 0)
      return showAppAlert('Lütfen personel ve cihaz seçin.');

    // YENİ MANTIK: Seçilen cihazlar arasında hali hazırda "Zimmetli" olan var mı?
    // Not: Mouse checkbox'ı OEM dışında bir mouse ise onu da dahil ediyoruz
    let finalSelectedHardware = [...selectedHardware];
    if (
      includeMouse &&
      selectedMouseId !== 'OEM' &&
      !finalSelectedHardware.includes(selectedMouseId)
    ) {
      finalSelectedHardware.push(selectedMouseId);
    }

    const alreadyAssignedItems = campusHardware.filter(
      (h) => finalSelectedHardware.includes(h.id) && h.status === 'Assigned'
    );

    if (alreadyAssignedItems.length > 0) {
      // Eğer zimmetli cihaz varsa, beyan adımından önce onay penceresini aç.
      setZimmetliCihazlarListesi(alreadyAssignedItems);
      setShowZimmetliOnayModal(true);
    } else {
      // Sorun yoksa doğrudan beyan ve doğrulama adımına geç.
      setIsSigning(true);
    }
  };

  const handleFinalizeZimmet = async () => {
    if (!itSignature || !personOtpData || !personSignature)
      return showAppAlert('Lütfen IT teslim beyanı, doğrulama kodu ve personel teslim alma beyanını tamamlayın.');

    let finalSelectedHardware = [...selectedHardware];
    if (includeMouse && selectedMouseId !== 'OEM' && !finalSelectedHardware.includes(selectedMouseId)) {
      finalSelectedHardware.push(selectedMouseId);
    }

    const person = campusPersonnel.find((p) => p.id === selectedPerson);
    const items = campusHardware.filter((h) => finalSelectedHardware.includes(h.id));

    const hardwareListForServer = items.map(hw => ({
      type: hw.type || '-', brand: hw.brand || '-', model: hw.model || '-', serial: hw.serial || '-'
    }));

    // YENİ: Aksesuarları Sunucuya Gönderilen PDF Tablosuna Ekliyoruz
    if (includeCharger) hardwareListForServer.push({ type: 'Aksesuar', brand: 'Orijinal Şarj Adaptörü', model: 've Kablosu', serial: '-' });
    if (includeBag) hardwareListForServer.push({ type: 'Aksesuar', brand: 'Notebook Taşıma', model: 'Çantası', serial: '-' });
    if (includeMouse && selectedMouseId === 'OEM') hardwareListForServer.push({ type: 'Aksesuar', brand: 'Standart', model: 'Mouse', serial: 'OEM' });

    let serials = ''; let models = '';
    const allHaveSameGroup = items.every(i => i.groupName && i.groupName === items[0].groupName);
    if (items.length > 1 && allHaveSameGroup) {
      serials = items[0].groupName; models = `${items.length} Adet Cihaz`;
    } else if (items.length > 2) {
      serials = "Toplu Zimmet"; models = `Karma Donanımlar (${items.length} Adet)`;
    } else {
      serials = items.map((i) => i.serial).join(' & ');
      models = items.map((i) => i.brand + ' ' + i.model).join(' & ');
    }

    const rawFilename = `${serials}, ${person.name}, ${person.campus}, ${models}, Zimmet.pdf`;
    const filename = rawFilename.replace(/[\/\\?%*:|"<>]/g, '-');

    setIsGenerating(true);

    try {
      let result;
      let retries = 3; // Sistem meşgulse 3 kez daha dener
      
      while (retries > 0) {
        try {
          result = await postApiAction(
            {
              authToken: currentUser.token,
              action: 'saveZimmetServerSide',
              pdfName: filename,
              campus: currentUser.campus,
              personId: selectedPerson,
              personName: person.name,
              personTitle: person.department || '',
              hardwareIds: finalSelectedHardware,
              hardwareList: hardwareListForServer,
              itEmail: currentUser.email,
              itName: currentUser.name,
              personEmail: person.email || '',
              itStatement: itSignature.image,
              personStatement: personSignature.image,
              personOtpHash: personOtpData.hash,
              zimmetExplanation: zimmetExplanation,
              clientIp: clientIp,
              userAgent: navigator.userAgent
            },
            { timeoutMs: 120000 }
          );
          break; // Başarılı olursa döngüden çık
          
        } catch (fetchError) {
          if (retries > 1 && isRetryableApiError(fetchError)) {
            retries--;
            await new Promise(r => setTimeout(r, 2500));
            continue;
          }
          throw fetchError;
        }
      }

      const isQueued = Boolean(result.queued || result.queueId);
      const realDriveUrl = result.url || '';
      const newDoc = realDriveUrl
        ? { id: Date.now().toString(), name: filename, date: new Date().toLocaleDateString('tr-TR'), url: realDriveUrl }
        : null;

      setPersonnel((prev) =>
        prev.map((p) =>
          p.id === selectedPerson
            ? {
                ...p,
                documents: newDoc ? [...(p.documents || []), newDoc] : p.documents || [],
                documentsLoaded: Boolean(newDoc),
              }
            : p
        )
      );
      setHardware((prev) => prev.map((h) => {
          if (finalSelectedHardware.includes(h.id)) {
            return {
              ...h, status: 'Assigned', assignedTo: selectedPerson, driveLink: realDriveUrl || null,
              hasHistory: true,
              historyLoaded: false,
              history: [{ personName: person.name, date: new Date().toLocaleDateString('tr-TR'), driveLink: realDriveUrl, type: isQueued ? 'Zimmet (PDF hazırlanıyor)' : 'Zimmet' }, ...(h.history || [])],
            };
          }
          return h;
        })
      );

      setSuccessMessage(result.message || (isQueued ? "Zimmet kaydedildi. PDF arka planda hazırlanıyor." : "İşlem Başarılı! Belge sunucuda üretildi ve e-postalar gönderildi."));
      setTimeout(() => setSuccessMessage(null), 4500);
      
      setIsSigning(false); setSelectedPerson(''); setSelectedHardware([]); setItSignature(null);
      setPersonSignature(null); setIncludeCharger(false); setIncludeBag(false); setIncludeMouse(false);
      setSelectedMouseId('OEM'); setActiveTab('personnel'); setPersonOtpData(null); setAssignStep(1);
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // --- İADE PDF ÜRETİMİ VE YÜKLEMESİ (SUNUCU TARAFLI) ---
  const handleFinalizeReturn = async () => {
    if (!returnItSignature || !returnPersonSignature || !returnPersonOtpData || !isReturnAccepted)
      return showAppAlert('Lütfen IT teslim alma beyanı, personel iade beyanı, doğrulama kodu ve Hukuki Onay kutucuğunu tamamlayın.');

    setIsGenerating(true);

    const { hardwareArray, person } = returningData;
    const hardwareListForServer = hardwareArray.map(hw => ({
      type: hw.type || '-', brand: hw.brand || '-', model: hw.model || '-', serial: hw.serial || '-'
    }));

    // YENİ EKLENEN: Aksesuarları iade listesine (ve sunucu PDF'ine) dahil et
    if (returnIncludeCharger) hardwareListForServer.push({ type: 'Aksesuar', brand: 'Orijinal Şarj Adaptörü', model: 've Kablosu', serial: '-' });
    if (returnIncludeBag) hardwareListForServer.push({ type: 'Aksesuar', brand: 'Notebook Taşıma', model: 'Çantası', serial: '-' });
    if (returnIncludeMouse) hardwareListForServer.push({ type: 'Aksesuar', brand: 'Standart', model: 'Mouse', serial: 'OEM' });

    let serials = ''; let models = '';
    const allHaveSameGroup = hardwareArray.every(h => h.groupName && h.groupName === hardwareArray[0].groupName);
    if (hardwareArray.length > 1 && allHaveSameGroup) {
      serials = hardwareArray[0].groupName; models = `${hardwareArray.length} Adet Cihaz`;
    } else if (hardwareArray.length > 2) {
      serials = "Toplu İade"; models = `Karma Donanımlar (${hardwareArray.length} Adet)`;
    } else {
      serials = hardwareArray.map((h) => h.serial).join(' & ');
      models = hardwareArray.map((h) => `${h.brand} ${h.model}`).join(' & ');
    }

    const rawFilename = `${serials}, ${person.name}, ${person.campus}, ${models}, İade.pdf`;
    const filename = rawFilename.replace(/[\/\\?%*:|"<>]/g, '-');

    try {
      let result;
      let retries = 3;
      
      while (retries > 0) {
        try {
          result = await postApiAction(
            {
              authToken: currentUser.token,
              action: 'returnZimmetServerSide',
              pdfName: filename,
              campus: currentUser.campus,
              personId: person.id,
              personName: person.name,
              personTitle: person.department || '',
              hardwareIds: hardwareArray.map((h) => h.id),
              hardwareList: hardwareListForServer,
              itEmail: currentUser.email,
              itName: currentUser.name,
              personEmail: person.email || '',
              itStatement: returnItSignature.image,
              personStatement: returnPersonSignature.image,
              personOtpHash: returnPersonOtpData.hash,
              returnCondition: returnCondition,
              returnExplanation: returnExplanation,
              clientIp: clientIp,
              userAgent: navigator.userAgent
            },
            { timeoutMs: 120000 }
          );
          break;
          
        } catch (fetchError) {
          if (retries > 1 && isRetryableApiError(fetchError)) {
            retries--;
            await new Promise(r => setTimeout(r, 2500));
            continue;
          }
          throw fetchError;
        }
      }

      const isQueued = Boolean(result.queued || result.queueId);
      const realDriveUrl = result.url || '';
      const newDoc = realDriveUrl
        ? { id: Date.now().toString(), name: filename, date: new Date().toLocaleDateString('tr-TR'), url: realDriveUrl }
        : null;

      setHardware((prev) =>
        prev.map((h) =>
          hardwareArray.some((item) => item.id === h.id)
            ? {
                ...h,
                status: 'Available',
                assignedTo: null,
                driveLink: realDriveUrl || null,
                hasHistory: true,
                historyLoaded: false,
                history: [
                  {
                    personName: person.name,
                    date: new Date().toLocaleDateString('tr-TR'),
                    driveLink: realDriveUrl,
                    type: isQueued ? 'İade (PDF hazırlanıyor)' : 'İade',
                  },
                  ...(h.history || []),
                ],
              }
            : h
        )
      );
      setPersonnel((prev) =>
        prev.map((p) =>
          p.id === person.id
            ? {
                ...p,
                documents: newDoc ? [...(p.documents || []), newDoc] : p.documents || [],
                documentsLoaded: Boolean(newDoc),
              }
            : p
        )
      );

      setSuccessMessage(result.message || (isQueued ? "İade kaydedildi. PDF arka planda hazırlanıyor." : "İade işlemi tamamlandı. Belge sunucuda üretildi ve Drive'a kaydedildi."));
      setTimeout(() => setSuccessMessage(null), 4500);
      setReturningData(null); setReturnItSignature(null); setReturnPersonSignature(null); setReturnCondition('eksiksiz'); setReturnExplanation(''); setIsReturnAccepted(false); setReturnPersonOtpData(null);
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // --- KAMPÜS TRANSFER PDF VE KAYIT İŞLEMLERİ (SUNUCU TARAFLI) ---
  // --- KAMPÜS TRANSFER PDF VE KAYIT İŞLEMLERİ (SUNUCU TARAFLI) ---
  const handleFinalizeTransfer = async () => {
    if (!transferSignature) return showAppAlert('Lütfen el yazısı teslim beyanınızı tamamlayın.');

    setIsGenerating(true);

    try {
      const { type, items, targetCampus, senderCampus } = transferModalObj;
      const isOut = type === 'out';

      const hardwareListForServer = items.map(hw => ({
        type: hw.type || '-', brand: hw.brand || '-', model: hw.model || '-', serial: hw.serial || '-'
      }));

      const serials = items.length > 2 ? "Toplu Transfer" : items.map((h) => h.serial).join(' & ');
      const rawFilename = `${serials}, Transfer_${isOut ? 'Çıkış' : 'Giriş'}.pdf`;
      const filename = rawFilename.replace(/[\/\\?%*:|"<>]/g, '-');

      let result;
      let retries = 3;
      
      while (retries > 0) {
        try {
          result = await postApiAction(
            {
              authToken: currentUser.token,
              action: isOut ? 'startTransferServerSide' : 'completeTransferServerSide',
              pdfName: filename,
              hardwareIds: items.map((h) => h.id),
              hardwareList: hardwareListForServer,
              targetCampus: targetCampus,
              senderCampus: senderCampus,
              receiverCampus: currentUser.campus,
              currentUserEmail: currentUser.email,
              itName: currentUser.name,
              transferStatement: transferSignature.image,
              clientIp: clientIp,
            },
            { timeoutMs: 120000 }
          );
          break;
          
        } catch (fetchError) {
          if (retries > 1 && isRetryableApiError(fetchError)) {
            retries--;
            await new Promise(r => setTimeout(r, 2500));
            continue;
          }
          throw fetchError;
        }
      }

      const isQueued = Boolean(result.queued || result.queueId);
      const realDriveUrl = result.url || '';

      // Local State Update
      const timeString = new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      setHardware((prev) => prev.map((h) => {
          if (items.some((i) => i.id === h.id)) {
            const safeHistory = Array.isArray(h.history) ? h.history : [];
            if (isOut) {
              const eventType = isQueued
                ? `Kampüs Çıkış (${currentUser.campus}) (PDF hazırlanıyor)`
                : `Kampüs Çıkış (${currentUser.campus})`;
              const eventDate = new Date().toISOString();
              return {
                ...h,
                status: 'Transfer',
                campus: targetCampus,
                assignedTo: `GÖNDEREN:${currentUser.campus}`,
                driveLink: realDriveUrl || null,
                updatedAt: eventDate,
                lastEventDate: eventDate,
                lastEventPersonName: currentUser.name,
                lastEventType: eventType,
                historyLoaded: true,
                history: [
                  {
                    personName: currentUser.name,
                    date: timeString,
                    driveLink: realDriveUrl,
                    type: eventType,
                  },
                  ...safeHistory,
                ],
              };
            } else {
              return { ...h, status: 'Available', assignedTo: null, campus: currentUser.campus, driveLink: realDriveUrl || null, historyLoaded: true, history: [{ personName: currentUser.name, date: timeString, driveLink: realDriveUrl, type: isQueued ? `Kampüs Giriş (${currentUser.campus}) (PDF hazırlanıyor)` : `Kampüs Giriş (${currentUser.campus})` }, ...safeHistory] };
            }
          }
          return h;
        })
      );

      setSuccessMessage(result.message || (isQueued ? `Transfer işlemi (${isOut ? 'Gönderim' : 'Teslim Alma'}) kaydedildi. PDF arka planda hazırlanıyor.` : `Transfer işlemi (${isOut ? 'Gönderim' : 'Teslim Alma'}) sunucuda üretildi ve e-postalar gönderildi.`));
      setTimeout(() => setSuccessMessage(null), 4500);
      setTransferModalObj(null); setTransferSignature(null); setSelectedBulkHardware([]); setViewingHardwareId(null);
      
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsGenerating(false); // Hata olsa da olmasa da yükleniyor ekranı kapanacak!
    }
  };
  // YENİ: TRANSFER İPTAL ETME (REDDETME) FONKSİYONU
  const handleCancelTransfer = (items, senderCampus) => {
    setConfirmDialog({
      message: "Bu transfer işlemini iptal etmek/reddetmek istediğinize emin misiniz? Cihazlar gönderen kampüsün deposuna geri dönecektir.",
      type: 'danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        setIsGenerating(true);
        try {
          await postApiAction({
            authToken: currentUser.token,
            action: 'cancelTransfer',
            hardwareIds: items.map((i) => i.id),
            senderCampus: senderCampus,
            currentUserName: currentUser.name,
            currentUserEmail: currentUser.email,
          });

          // Ekranda Anında Güncelleme (Cihazı eski kampüsüne ve Depoda durumuna çek)
          setHardware((prev) =>
            prev.map((h) => {
              if (items.some((i) => i.id === h.id)) {
                return {
                  ...h,
                  status: 'Available',
                  assignedTo: null,
                  campus: senderCampus, // Gönderen kampüse geri döndü
                  history: [
                    {
                      personName: currentUser.name,
                      date: new Date().toLocaleDateString('tr-TR'),
                      type: 'Transfer İptal Edildi',
                    },
                    ...(h.history || []),
                  ],
                };
              }
              return h;
            })
          );

          setSuccessMessage('Transfer başarıyla iptal edildi ve cihazlar depoya döndü.');
          setTimeout(() => {
            setSuccessMessage(null);
            setIsGenerating(false);
          }, 2000);
        } catch (error) {
          showAppAlert('Hata: ' + error.message);
          setIsGenerating(false);
        }
      },
    });
  };
  const handleManualUploadSubmit = async () => {
    if (!manualUploadFile || !manualUploadPerson)
      return showAppAlert('Lütfen bir personel ve dosya seçin.');

    const person = personnelById.get(manualUploadPerson);
    if (!person) return showAppAlert('Seçilen personel kaydı bulunamadı.');
    const extension =
      manualUploadFile.type === 'image/png'
        ? '.png'
        : manualUploadFile.type.startsWith('image/')
          ? '.jpg'
          : '.pdf';
    const filename =
      `${viewedHardware.serial}, ${person.name}, Manuel_Tutanak${extension}`.replace(
        /[\/\\?%*:|"<>]/g,
        '-'
      );

    setIsUploadingManual(true);

    try {
      // Dosyayı Base64'e çevir
      const base64String = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(manualUploadFile);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = (error) => reject(error);
      });

      const result = await postApiAction(
        {
          authToken: currentUser.token,
          action: 'manualAssign',
          pdfName: filename,
          pdfData: base64String,
          campus: currentUser.campus,
          personId: person.id,
          personName: person.name,
          hardwareId: viewedHardware.id,
        },
        { timeoutMs: 180000 }
      );

      // Local state'i güncelle
      setHardware((prev) =>
        prev.map((h) => {
          if (h.id === viewedHardware.id) {
            return {
              ...h,
              status: 'Assigned',
              assignedTo: person.id,
              driveLink: result.url,
              history: [
                {
                  personName: person.name,
                  date: new Date().toLocaleDateString('tr-TR'),
                  driveLink: result.url,
                  type: 'Manuel Yükleme',
                },
                ...(h.history || []),
              ],
            };
          }
          return h;
        })
      );

      setSuccessMessage('Eski tutanak başarıyla yüklendi ve zimmet oluşturuldu.');
setTimeout(() => setSuccessMessage(null), 2500);
      setShowManualUpload(false);
      setManualUploadFile(null);
      setManualUploadPerson('');
      setViewingHardwareId(null);
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsUploadingManual(false);
    }
  };

  const handleInitialAssignmentWithoutDocument = async () => {
    if (!manualUploadPerson) return showAppAlert('Lütfen bir personel seçin.');
    if (!viewedHardware) return showAppAlert('Cihaz kaydı bulunamadı.');

    const person = personnelById.get(manualUploadPerson);
    if (!person) return showAppAlert('Seçilen personel kaydı bulunamadı.');
    if (!person.email) return showAppAlert('Seçilen personelin e-posta adresi bulunamadı.');

    const confirmed = await confirmAppAction({
      type: 'warning',
      title: 'Belgesiz ilk geçiş zimmeti',
      message: `${viewedHardware.serial || viewedHardware.id} seri numaralı cihaz ${person.name} adına belgesiz zimmetli gösterilecek. PDF, OTP veya e-posta oluşturulmayacak; iade daha sonra sistemden alınabilecek.`,
      confirmLabel: 'Belgesiz Ata'
    });
    if (!confirmed) return;

    setIsUploadingManual(true);
    try {
      const result = await postApiAction(
        {
          authToken: currentUser.token,
          action: 'bulkInitialAssignment',
          confirmMigration: true,
          source: 'device-profile',
          items: [
            {
              rowNumber: 2,
              serial: String(viewedHardware.serial || viewedHardware.id || '').trim(),
              personEmail: person.email,
              driveLink: ''
            }
          ],
          clientIp
        },
        { timeoutMs: 60000 }
      );

      if (Number(result.assigned || 0) !== 1) {
        await fetchVeritabani();
        throw new Error('Cihaz eşleşmesi değişmedi. Güncel cihaz durumunu kontrol edin.');
      }

      const historyRecord = {
        personName: person.name,
        date: new Date().toLocaleDateString('tr-TR'),
        driveLink: null,
        type: 'İlk Geçiş Zimmeti (Belgesiz)'
      };

      setHardware((prev) =>
        prev.map((hardwareItem) =>
          hardwareItem.id === viewedHardware.id
            ? {
                ...hardwareItem,
                status: 'Assigned',
                assignedTo: person.id,
                driveLink: null,
                hasHistory: true,
                history: [historyRecord, ...(hardwareItem.history || [])]
              }
            : hardwareItem
        )
      );

      setSuccessMessage('Cihaz belgesiz ilk geçiş zimmetiyle personele atandı.');
      setTimeout(() => setSuccessMessage(null), 2500);
      setShowManualUpload(false);
      setManualUploadFile(null);
      setManualUploadPerson('');
      setManualUploadSearch('');
      setViewingHardwareId(null);
    } catch (error) {
      showAppAlert('Hata: ' + error.message);
    } finally {
      setIsUploadingManual(false);
    }
  };

  const renderPrintableDocument = () => (
    <Suspense fallback={<LazyPanelFallback label="Tutanak ekranı hazırlanıyor..." />}>
      <ZimmetDocumentModal
        deps={{
          campusPersonnel,
          selectedPerson,
          selectedHardware,
          includeCharger,
          includeBag,
          includeMouse,
          selectedMouseId,
          campusHardware,
          isGenerating,
          currentUser,
          zimmetExplanation,
          setZimmetExplanation,
          itSignature,
          setItSignature,
          personOtpData,
          setPersonOtpData,
          personSignature,
          setPersonSignature,
          clientIp,
          handlePersonPhoneSaved,
          isKvkkAccepted,
          setIsKvkkAccepted,
          handlePdfClick,
          setIsSigning,
          handleFinalizeZimmet,
        }}
      />
    </Suspense>
  );

  const handleTabChange = (tabName) => {
    // İşlem yapiliyorsa sekme degistirmeyi engelle
    if (isGenerating) return false;
    if (tabName === 'systemAdmin' && !currentUser?.isSuperAdmin) return false;

    // --- AÇIK OLAN HER TÜRLÜ İŞLEMİ VE MODALI İPTAL ET ---
    setIsSigning(false);
    setTransferModalObj(null); // Transfer ekranını kapat
    setReturningData(null); // İade ekranını kapat
    setViewingHardwareId(null); // Cihaz profilini kapat
    setViewingPersonId(null); // Personel profilini kapat
    setShowAddHardwareModal(false); // Donanım ekleme modalini kapat
    setShowBulkHardwareImportModal(false); // Toplu donanım ekleme modalini kapat
    setShowBulkInitialAssignmentModal(false); // İlk migrasyon zimmet modalini kapat
    
    // Zimmet, iade ve transfer el yazısı beyanlarını sıfırla.
    setItSignature(null);
    setPersonSignature(null);
    setPersonOtpData(null);
    setReturnItSignature(null);
    setReturnPersonSignature(null);
    setReturnPersonOtpData(null);
    setTransferSignature(null);

    // Zimmet formunu sıfırla
    setSelectedPerson('');
    setSelectedHardware([]);
    setPersonSearch('');
    setNationalIdLookupPerson(null);
    setNationalIdLookupError('');
    setIsNationalIdLookupLoading(false);
    setAssignSearchQuery('');
    setAssignFilterType('All');
    setAssignFilterStatus('All');
    setAssignFilterCampus('All');
    setActiveAssignFilterDropdown(null);
    setActiveMissingGlpiFilterDropdown(null);
    stopQrCamera();
    setIncludeCharger(false);
    setIncludeBag(false);
    setIncludeMouse(false);
    setSelectedMouseId('OEM');
    setAssignStep(1);
    setZimmetExplanation('');
    setIsKvkkAccepted(false);
    setIsReturnAccepted(false);
    

    // Toplu seçimleri sıfırla
    setSelectedBulkHardware([]);
    setSelectedBulkPersonnel([]);
    setBulkCampusTransferMode(false);

    // Sayfalamayi basa sar
    setHardwarePage(1);
    setPersonnelPage(1);

    // Sekmeyi degistir
    setActiveTab(tabName);

    // iPad Scroll Bug Çözümü
    setTimeout(() => {
      if (mainContainerRef.current) {
        mainContainerRef.current.scrollTop = 0;
      }
    }, 10);
    return true;
  };

  // YENİ: TÜM UYGULAMA İÇİN GENEL GELEN TRANSFER BİLDİRİM SAYACI
  const incomingTransfers = useMemo(
    () =>
      hardware.filter((h) => {
        if (!h.status || !h.campus || !h.assignedTo) return false;
        const isTransferState =
          String(h.status || '').trim().toLowerCase() === 'transfer';
        const isMyCampus = getCoreCampusName(h.campus) === myCoreCampus;
        const isFromSender = String(h.assignedTo).toUpperCase().includes('GÖNDEREN');
        const senderCore = getCoreCampusName(
          String(h.assignedTo).replace(/GÖNDEREN:/i, '')
        );
        const isNotFromMe = senderCore !== myCoreCampus;
        return isTransferState && isMyCampus && isFromSender && isNotFromMe;
      }),
    [hardware, myCoreCampus]
  );

  // --- BEYAZ EKRAN ÇÖZÜMÜ: EKRANLAR HOOK'LARDAN SONRAYA TAŞINDI ---
  if (isLoading) {
    return <WorkspaceSkeleton />;
  }

  if (!currentUser) {
    return (
      <div className="app-login-shell min-h-screen w-screen bg-slate-50 flex items-center justify-center p-4">
        <ThemeToggle
          theme={theme}
          onToggle={toggleTheme}
          className="app-login-theme-toggle fixed right-4 top-4 z-20"
        />
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden p-8 sm:p-10 border border-gray-100">
          <div className="flex flex-col items-center mb-8">
            <div className="w-full flex justify-center mb-4">
              <div className="login-logo-surface inline-flex min-h-24 items-center justify-center rounded-2xl px-4 py-2.5">
                <img src="/istek-logo.png" alt="İSTEK Okulları Logo" className="login-logo-image h-20 sm:h-24 w-auto object-contain" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                <div style={{ display: 'none' }} className="flex-col items-center">
                  <Building2 className="w-16 h-16 text-[#0066b1] mb-2 opacity-90" />
                  <h1 className="text-3xl font-black text-[#0066b1]">İSTEK Okulları</h1>
                </div>
              </div>
            </div>
            <h2 className="text-xl sm:text-xl font-bold text-[#0066b1] text-center tracking-tight">Bilgi İşlem Demirbaş Yönetim Sistemi</h2>
          </div>
          <div className="flex flex-col items-center space-y-6 min-h-[120px] justify-center">
            {authNotice && (
              <div className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs font-bold text-amber-800">
                {authNotice}
              </div>
            )}
            {isLoggingIn ? (
              <div className="flex flex-col items-center justify-center p-2 animate-in fade-in zoom-in duration-300">
                <Loader2 className="w-10 h-10 animate-spin text-[#0066b1] mb-4" />
                <p className="text-gray-800 font-black text-sm">Güvenlik Doğrulaması Yapılıyor...</p>
                <p className="text-[11px] text-gray-400 mt-1.5 text-center">Lütfen bekleyin, şifreli oturum bağlantısı kuruluyor.</p>
              </div>
            ) : (
              <div className="flex flex-col items-center w-full relative">
                <div className="absolute inset-0 flex flex-col items-center justify-center -z-10 text-gray-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2 opacity-50" />
                  <span className="text-[10px] font-bold">Google Güvenlik Modülü Yükleniyor...</span>
                </div>
                <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                  <GoogleSignInControls
                    onAccessTokenSuccess={handleGoogleAccessTokenSuccess}
                    onError={handleGoogleError}
                  />
                </GoogleOAuthProvider>
                <p className="text-xs text-gray-400 text-center mt-4 bg-white/80 backdrop-blur-sm p-1">
                  Sisteme erişmek için kurum hesabınızla giriş yapın. Sadece yetkili IT personeli giriş yapabilir.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      // YENİ: overscroll-none ve touch-none ile arka planın esnemesini (rubber-band) tamamen kapattık
      className="app-shell fixed inset-0 flex flex-col lg:flex-row w-full bg-slate-50 font-sans text-gray-800 selection:bg-[#8bcdc5]/30 overflow-hidden overscroll-none"
    >
      {/* SİTE İÇİ PDF ÖNİZLEYİCİ MODAL (MOBİL VE DESKTOP UYUMLU) */}
      {previewPdf && (
        <div
          className="fixed inset-0 p-0 sm:p-4 md:p-6 flex flex-col items-center justify-center"
          style={{
            backgroundColor: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999999,
          }}
          onClick={() => handlePdfClick(null)}
        >
          {/* HEADER: Kapatma Butonu ve Baslik */}
          <div
            className="flex justify-between items-center w-full bg-black/50 sm:bg-transparent p-3 sm:p-0 mb-0 sm:mb-3 text-white z-20 shrink-0"
            style={{ maxWidth: '1200px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm sm:text-lg md:text-xl font-bold flex items-center gap-2 truncate pr-4">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" />{' '}
              {previewPdf.title}
            </h3>

            <button
              onClick={() => handlePdfClick(null)}
              className="p-2 sm:p-2.5 bg-white/20 hover:bg-white/40 rounded-full transition-colors flex items-center justify-center shrink-0"
              title="Kapat"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>

          {/* IFRAME KUTUSU */}
          <div
            className="bg-white w-full sm:rounded-xl overflow-hidden shadow-2xl relative flex-1 sm:flex-none"
            style={{
              maxWidth: '1200px',
              height: '100%',
              maxHeight: '100%', // Mobilde tam ekran olsun diye
              display: 'block',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Arka Plan Fallback (Yükleniyor) */}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-0 p-6 text-center">
              <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mb-4 animate-pulse" />
              <p className="text-sm sm:text-base text-gray-600 font-medium mb-4">
                PDF Yükleniyor... (Eğer açılmazsa aşağıdaki butonu kullanın)
              </p>
              <a
                href={previewPdf.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2 sm:px-6 sm:py-2 bg-[#0066b1] text-white text-sm sm:text-base font-bold rounded-lg shadow hover:bg-[#005595] transition-colors"
              >
                Tarayıcıda Yeni Sekmede Aç
              </a>
            </div>

            {/* Gerçek İframe */}
            {previewPdf.url && (
              <iframe
                src={previewPdf.embedUrl}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  position: 'relative',
                  zIndex: 10,
                  display: 'block',
                }}
                title="PDF Önizleme"
                allowFullScreen
              />
            )}
          </div>
        </div>
      )}

<aside className="app-sidebar w-full lg:w-64 bg-[#0066b1] text-white flex flex-col print:hidden shrink-0 shadow-md z-30 transition-all">
        {/* MOBİL VE IPAD'DE GİZLENEN LOGO BÖLÜMÜ */}
        <div className="overflow-hidden">
          <style>{`
            .mobile-logo-inner {
              transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
              max-height: 120px;
              opacity: 1;
              padding-top: 12px;
              padding-bottom: 12px;
              padding-left: 12px;
              padding-right: 12px;
              border-bottom: 1px solid rgba(139, 205, 197, 0.3);
              overflow: hidden;
            }
            .mobile-logo-inner.header-hidden {
              max-height: 0px;
              opacity: 0;
              padding-top: 0px;
              padding-bottom: 0px;
              border-bottom: none;
            }
            @media (min-width: 1025px) {
              .mobile-logo-inner {
                max-height: none !important;
                opacity: 1 !important;
                padding: 16px 24px !important;
                border-bottom: 1px solid rgba(139, 205, 197, 0.3) !important;
              }
              .mobile-logo-inner.header-hidden {
                max-height: none !important;
                opacity: 1 !important;
                padding: 16px 24px !important;
              }
            }
          `}</style>

          <div
            ref={headerRef}
            className="mobile-logo-inner flex justify-between items-center lg:block overflow-hidden"
          >
            {/* LOGO (GİZLİ TIKLAMA SAYACI İÇERİR) */}
            <div
              className="theme-logo-surface mobile-brand-surface bg-white px-2 py-1 lg:px-4 lg:py-2.5 rounded-xl shadow-md transition-transform hover:scale-105 cursor-pointer flex justify-center items-center lg:w-full select-none"
              onClick={() => {
                const newCount = logoClickCount + 1;
                setLogoClickCount(newCount);
                if (newCount >= 10) {
                  setShowEasterEgg(true);
                  setLogoClickCount(0);
                }
              }}
            >
              <span className="mobile-brand-mark lg:hidden" aria-hidden="true">
                <img
                  src="/istek-logo.png"
                  alt=""
                  className="mobile-brand-mark__image pointer-events-none"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </span>
              <img
                src="/istek-logo.png"
                alt="İSTEK Okulları Logo Masaüstü"
                className="hidden lg:block h-14 w-auto object-contain pointer-events-none"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>

            {/* MOBİL AKSİYONLAR */}
            <div className="flex items-center gap-2 lg:hidden shrink-0 ml-2">
              <Suspense fallback={<LazyInlineFallback label="" />}>
                <OperationQueueIndicator
                  currentUser={currentUser}
                  gasUrl={GAS_URL}
                  onRefreshData={fetchVeritabani}
                  variant="mobile"
                  alwaysVisible
                />
              </Suspense>

              <UserSettingsMenu
                theme={theme}
                onToggleTheme={toggleTheme}
                onRefresh={() => fetchVeritabani(true)}
                onCheckForUpdates={handleCheckForUpdates}
                onLogout={handleLogout}
                isRefreshing={isRefreshing}
                isCheckingForUpdate={isCheckingForUpdate}
                variant="mobile"
              />
            </div>

          </div>
        </div>

        {/* SEKMELER (Donanım / PERSONEL / TRANSFER) - HER ZAMAN GÖRÜNÜR OLACAK */}
        <nav className="p-1.5 sm:p-2 lg:px-4 lg:py-6 flex flex-col shrink-0 lg:flex-1 bg-[#0066b1] z-40 relative">
          <div className="flex w-full bg-[#005595] p-1 rounded-xl space-x-1 lg:flex-col lg:bg-transparent lg:p-0 lg:space-x-0 lg:space-y-2 lg:w-auto lg:rounded-none">
            <button
              onClick={() => handleTabChange('hardware')}
              className={`flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm lg:flex-none lg:justify-start lg:px-4 lg:py-3 lg:text-base lg:space-x-3 ${
                activeTab === 'hardware'
                  ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                  : 'text-white hover:bg-[#004a82] lg:hover:bg-[#005595]'
              }`}
            >
              <Laptop className="w-4 h-4 sm:w-5 sm:h-5" />{' '}
              <span className="whitespace-nowrap">Donanım</span>
            </button>

            <button
              onClick={() => handleTabChange('personnel')}
              className={`relative flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm lg:flex-none lg:justify-start lg:px-4 lg:py-3 lg:text-base lg:space-x-3 ${
                activeTab === 'personnel'
                  ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                  : 'text-white hover:bg-[#004a82] lg:hover:bg-[#005595]'
              }`}
            >
              <Users className="w-4 h-4 sm:w-5 sm:h-5" />{' '}
              <span className="whitespace-nowrap">Personel</span>
            </button>

            <button
              onClick={() => handleTabChange('transfer')}
              className={`flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm lg:flex-none lg:justify-start lg:px-4 lg:py-3 lg:text-base lg:space-x-3 ${
                activeTab === 'transfer'
                  ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                  : 'text-white hover:bg-[#004a82] lg:hover:bg-[#005595]'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                {incomingTransfers.length > 0 && (
                  <span
                    className="absolute -top-2 -right-2.5 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-black text-white shadow-sm animate-pulse"
                    title={`${incomingTransfers.length} gelen transfer cihazı onay bekliyor`}
                  >
                    {incomingTransfers.length > 99 ? '99+' : incomingTransfers.length}
                  </span>
                )}
              </div>
              <span className="whitespace-nowrap">Transfer</span>
            </button>

            {currentUser?.isSuperAdmin && (
              <button
                onClick={() => handleTabChange('systemAdmin')}
                className={`flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm lg:flex-none lg:justify-start lg:px-4 lg:py-3 lg:text-base lg:space-x-3 ${
                  activeTab === 'systemAdmin'
                    ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                    : 'text-white hover:bg-[#004a82] lg:hover:bg-[#005595]'
                }`}
                title="Sistem Yönetimi"
              >
                <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="whitespace-nowrap">Sistem</span>
              </button>
            )}

          </div>
        </nav>

        {/* MASAÜSTÜ KULLANICI VE AYARLAR */}
        <div className="hidden lg:flex mt-auto p-4 border-t border-[#8bcdc5]/30 bg-[#005595] flex-col">
          <div className="w-full space-y-2" data-user-settings-anchor>
            <Suspense fallback={<LazyInlineFallback label="İşlem kuyruğu..." />}>
              <OperationQueueIndicator
                currentUser={currentUser}
                gasUrl={GAS_URL}
                onRefreshData={fetchVeritabani}
                variant="desktop"
                alwaysVisible
              />
            </Suspense>

            <div className="bg-[#005595] p-3 rounded-xl border border-[#8bcdc5]/30 shadow-inner flex items-center gap-3 relative group">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#0066b1] font-bold shadow-md shrink-0 border-2 border-[#8bcdc5] overflow-hidden">
                {currentUser.picture ? (
                  <img src={currentUser.picture} alt="Profil" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={handleCurrentUserPictureError} />
                ) : (
                  <span className="text-lg">{String(currentUser?.name || 'U').charAt(0)}</span>
                )}
              </div>

              <div className="flex flex-col flex-1 min-w-0 pr-6">
                <p className="text-sm font-bold text-white truncate" title={currentUser.name}>
                  {currentUser.name}
                </p>
                <p className="text-xs text-[#96b4d9] mt-0.5 truncate" title={currentUser.campus}>
                  {currentUser.campus}
                </p>
              </div>

              <UserSettingsMenu
                theme={theme}
                onToggleTheme={toggleTheme}
                onRefresh={() => fetchVeritabani(true)}
                onCheckForUpdates={handleCheckForUpdates}
                onLogout={handleLogout}
                isRefreshing={isRefreshing}
                isCheckingForUpdate={isCheckingForUpdate}
                variant="desktop"
                className="user-settings-menu--profile-card"
              />
            </div>
          </div>
        </div>
      </aside>

      {/* PWA GÜNCELLEME UYARISI (Ekranın Altında veya Üstünde Belirir) */}
      {needRefresh && (
        <div className="fixed bottom-4 left-4 right-4 md:bottom-10 md:left-auto md:right-10 md:w-96 bg-blue-600 text-white p-4 rounded-2xl shadow-2xl flex flex-col gap-3 animate-in slide-in-from-bottom-5" style={{ zIndex: 99999999999 }}>
          <p className="text-sm font-bold flex items-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Yeni Bir Sürüm Çıktı!
          </p>
          <p className="text-xs text-blue-100">
            Sisteme yeni özellikler eklendi veya hatalar giderildi. Güncellemeyi almak için lütfen uygulamayı yenileyin.
          </p>
          <div className="flex gap-2 justify-end mt-1">
            <button 
              onClick={() => setNeedRefresh(false)} 
              className="px-4 py-2 text-xs font-bold bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
            >
              Sonra
            </button>
            <button
              type="button"
              onClick={handleApplyAppUpdate}
              disabled={isApplyingUpdate}
              className="px-4 py-2 text-xs font-bold bg-white text-blue-600 hover:bg-blue-50 rounded-lg shadow-sm transition-colors disabled:cursor-wait disabled:opacity-70"
            >
              {isApplyingUpdate ? 'Yükleniyor...' : 'Hemen Yenile'}
            </button>
          </div>
        </div>
      )}

      <main
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        // iOS SSS (Smooth Scroll Safari) Bug Düzeltmesi: overscroll-behavior-y eklendi
        className="app-main flex-1 overflow-y-auto relative w-full overscroll-none"
        style={{
          WebkitOverflowScrolling: 'touch', // iOS için pürüzsüz kaydırma
          overflowAnchor: 'none',
          // YENİ: Safari'nin touch event'leri yutmasını engeller ve donmayı çözer
          touchAction: 'pan-y', 
        }}
      >
        {/* Nöbetçi vs her şey silindi, sadece temiz ana render kaldı */}

        {isSigning ? (
          renderPrintableDocument()
        ) : (
          <div className="p-3 md:p-8 w-full max-w-[1400px] mx-auto relative pb-32">
            {/* HARDWARE TAB */}
            {activeTab === 'hardware' && (
              <div className="app-tab-panel space-y-0 relative">
                {/* Donanım ARAMA ÇUBUĞU (DAHA İNCE VE ZARİF) */}
                <div
                  style={{ position: 'sticky', top: 0, zIndex: 80 }}
                  className="responsive-tab-toolbar bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-1"
                >
                  <div className="responsive-tab-toolbar__primary flex items-center gap-2 w-full">
                    {/* Arama Çubuğu (İnceltildi: h-10, text-sm) */}
                    <div className="responsive-tab-toolbar__search flex items-center flex-1 min-w-0 px-3 h-10 border border-gray-200 rounded-xl bg-white shadow-sm focus-within:border-[#0066b1] focus-within:ring-2 focus-within:ring-[#0066b1]/20 transition-all">
                      <input
                        type="text"
                        placeholder="Marka, Model, Seri No, Bilgisayar İsmi ara..."
                        className="flex-1 bg-transparent outline-none min-w-0 text-gray-800 text-sm h-full"
                        value={hardwareSearchQuery}
                        onChange={(e) => setHardwareSearchQuery(e.target.value)}
                      />
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {hardwareSearchQuery && (
                          <button
                            onClick={() => setHardwareSearchQuery('')}
                            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                        <Search className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>

                    {/* Filtre Butonu (MOBİLDE GÖRÜNÜR, DESKTOPTA GİZLİ) */}
                    <button
                      onClick={() =>
                        setShowHardwareFilters(!showHardwareFilters)
                      }
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm md:hidden ${
                        showHardwareFilters
                          ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <Filter className="w-4 h-4" />
                    </button>
                    {/* Donanım Ekleme Menüsü */}
                    <div className="responsive-tab-toolbar__action responsive-tab-toolbar__actions-start relative shrink-0">
                      <button
                        onClick={() => {
                          setShowAddHardwareMenu((open) => !open);
                          setShowHardwareMenu(false);
                        }}
                        className="h-10 px-3 md:px-4 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm bg-[#0066b1] border-[#005595] text-white hover:bg-[#005595] font-bold gap-1.5"
                        title="Donanım Ekle"
                        aria-expanded={showAddHardwareMenu}
                        aria-haspopup="menu"
                      >
                        <Plus className="w-4 h-4" />
                        <span className="hidden md:inline text-sm">Donanım Ekle</span>
                        <ChevronDown
                          className={`hidden md:block w-3.5 h-3.5 transition-transform ${
                            showAddHardwareMenu ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {showAddHardwareMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setShowAddHardwareMenu(false)}
                          />
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-[99999999] mt-2 min-w-[240px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-2xl"
                          >
                            <button
                              role="menuitem"
                              onClick={() => {
                                setShowAddHardwareMenu(false);
                                setShowAddHardwareModal(true);
                              }}
                              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                            >
                              <Plus className="h-4 w-4 shrink-0 text-[#0066b1]" />
                              <span>Manuel Donanım Ekle</span>
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setShowAddHardwareMenu(false);
                                setShowBulkHardwareImportModal(true);
                              }}
                              className="flex w-full items-center gap-3 border-t border-gray-100 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                            >
                              <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#0066b1]" />
                              <span>Excel’den Toplu Donanım Ekle</span>
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setShowAddHardwareMenu(false);
                                setShowBulkInitialAssignmentModal(true);
                              }}
                              className="flex w-full items-center gap-3 border-t border-gray-100 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                            >
                              <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#0066b1]" />
                              <span>İlk Migrasyon Zimmeti</span>
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setShowAddHardwareMenu(false);
                                setMissingGlpiSearchQuery('');
                                setMissingGlpiFilterType('All');
                                setMissingGlpiFilterCampus('All');
                                setActiveMissingGlpiFilterDropdown(null);
                                if (handleTabChange('glpiMissing')) {
                                  void fetchMissingGlpiDevices(true);
                                }
                              }}
                              className="flex w-full items-center gap-3 border-t border-gray-100 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-blue-50 hover:text-blue-700"
                            >
                              <div className="relative shrink-0">
                                <HardDrive className="h-4 w-4 text-[#0066b1]" />
                                {missingGlpiDevices.length > 0 && (
                                  <span className="absolute -right-2.5 -top-2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-black text-[#005595] shadow-sm">
                                    {missingGlpiDevices.length}
                                  </span>
                                )}
                              </div>
                              <span>GLPI'dan Donanım Ekle</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* 3 Nokta Butonu */}
                    <div className="responsive-tab-toolbar__action relative shrink-0">
                      <button
                        onClick={() => {
                          setShowHardwareMenu(!showHardwareMenu);
                          setShowAddHardwareMenu(false);
                        }}
                        title="Dışa Aktar"
                        aria-label="Dışa Aktar"
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                          showHardwareMenu
                            ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <Download className="w-4 h-4" />
                      </button>

                      {showHardwareMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setShowHardwareMenu(false)}
                          ></div>
                          <div
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col py-1"
                            style={{
                              position: 'absolute',
                              top: '100%',
                              right: 0,
                              marginTop: '8px',
                              zIndex: 99999999999999999,
                              minWidth: 'max-content',
                            }}
                          >
                            <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-gray-50/50">
                              Dışa Aktar
                            </div>
                            <button
                              onClick={() => {
                                setShowHardwareMenu(false);
                                const exportData =
                                  selectedBulkHardware.length > 0
                                    ? sortedHardware.filter((h) =>
                                        selectedHardwareIdSet.has(h.id)
                                      )
                                    : sortedHardware;
                                handleExportExcel(
                                  exportData,
                                  'Donanım_Listesi',
                                  'hardware'
                                );
                              }}
                              disabled={isGenerating}
                              className="w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors text-left"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              <Download className="w-4 h-4 text-blue-500 shrink-0" />
                              <span>
                                {selectedBulkHardware.length > 0
                                  ? `Seçili (${selectedBulkHardware.length}) Excel Olarak İndir`
                                  : 'Excel Olarak İndir'}
                              </span>
                            </button>
                            <button
                              onClick={() => {
                                setShowHardwareMenu(false);
                                const exportData =
                                  selectedBulkHardware.length > 0
                                    ? sortedHardware.filter((h) =>
                                        selectedHardwareIdSet.has(h.id)
                                      )
                                    : sortedHardware;
                                handleCreateGoogleSheet(exportData, 'hardware');
                              }}
                              disabled={isGenerating}
                              className="w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors text-left disabled:opacity-50"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              {isGenerating ? (
                                <Loader2 className="w-4 h-4 animate-spin text-green-600 shrink-0" />
                              ) : (
                                <Table className="w-4 h-4 text-green-600 shrink-0" />
                              )}
                              <span>
                                {selectedBulkHardware.length > 0
                                  ? "Seçilileri Sheets'e Aktar"
                                  : "Google Sheets'e Aktar"}
                              </span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* --- BAŞLANGIÇ: FİLTRE ÇİPLERİ VE MENÜLERİ (DESKTOPTA HEP GÖRÜNÜR) --- */}
                  <div
                    className={`responsive-tab-toolbar__filters relative mt-3 mb-0 z-[90] ${
                      showHardwareFilters
                        ? 'block animate-in slide-in-from-top-1 fade-in duration-200'
                        : 'hidden md:block'
                    }`}
                  >
                    <style>{`
                      .hide-scroll-bar::-webkit-scrollbar { display: none; }
                      .hide-scroll-bar { -ms-overflow-style: none; scrollbar-width: none; }
                    `}</style>
                    <div className="flex items-center gap-2 pb-1 overflow-x-auto hide-scroll-bar w-full">
                      {/* Durum Butonu */}
                      <button
                        onClick={() =>
                          setActiveFilterDropdown(
                            activeFilterDropdown === 'status' ? null : 'status'
                          )
                        }
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm shrink-0 ${
                          hardwareFilterStatus !== 'All'
                            ? 'bg-[#0066b1] border-[#0066b1] text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        Durum:{' '}
                        {hardwareFilterStatus === 'All'
                          ? 'Tümü'
                          : hardwareFilterStatus}{' '}
                        <ChevronDown className="w-3 h-3 opacity-70" />
                      </button>
                      {/* Tip Butonu */}
                      <button
                        onClick={() =>
                          setActiveFilterDropdown(
                            activeFilterDropdown === 'type' ? null : 'type'
                          )
                        }
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm shrink-0 ${
                          hardwareFilterType !== 'All'
                            ? 'bg-[#0066b1] border-[#0066b1] text-white'
                            : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        Tip:{' '}
                        {hardwareFilterType === 'All'
                          ? 'Tümü'
                          : hardwareFilterType}{' '}
                        <ChevronDown className="w-3 h-3 opacity-70" />
                      </button>
                      {/* Kampüs Butonu (Sadece GM IT için) */}
                      {isHQ && (
                        <button
                          onClick={() =>
                            setActiveFilterDropdown(
                              activeFilterDropdown === 'campus'
                                ? null
                                : 'campus'
                            )
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm shrink-0 pr-4 ${
                            campusFilter !== 'All'
                              ? 'bg-[#0066b1] border-[#0066b1] text-white'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Kampüs:{' '}
                          {campusFilter === 'All'
                            ? 'Tümü'
                            : campusFilter.length > 12
                            ? campusFilter.substring(0, 12) + '...'
                            : campusFilter}{' '}
                          <ChevronDown className="w-3 h-3 opacity-70" />
                        </button>
                      )}

                      {(hardwareFilterStatus !== 'All' ||
                        hardwareFilterType !== 'All' ||
                        campusFilter !== 'All') && (
                        <button
                          onClick={() => {
                            setHardwareFilterStatus('All');
                            setHardwareFilterType('All');
                            setCampusFilter('All');
                            setActiveFilterDropdown(null);
                          }}
                          className="flex items-center gap-1 text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-full transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" /> Temizle
                        </button>
                      )}
                    </div>

                    {/* AÇILIR MENÜLER */}
                    {activeFilterDropdown && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          zIndex: 70,
                          paddingTop: '4px',
                        }}
                      >
                        <div
                          className="fixed inset-0"
                          style={{ zIndex: 60 }}
                          onClick={() => setActiveFilterDropdown(null)}
                        ></div>
                        {activeFilterDropdown === 'status' && (
                          <div
                            style={{
                              width: '180px',
                              position: 'relative',
                              zIndex: 70,
                            }}
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 overflow-hidden"
                          >
                            {[
                              'All',
                              'Zimmetli',
                              'Depoda',
                              'Hurda',
                              'Arızalı',
                              'Transfer',
                            ].map((st) => (
                              <button
                                key={st}
                                onClick={() => {
                                  setHardwareFilterStatus(st);
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  hardwareFilterStatus === st
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {st === 'All' ? 'Tümü' : st}
                              </button>
                            ))}
                          </div>
                        )}
                        {activeFilterDropdown === 'type' && (
                          <div
                            style={{
                              width: '220px',
                              position: 'relative',
                              zIndex: 70,
                            }}
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[100px]"
                          >
                            {[
                              'All',
                              'Laptop',
                              'Masaüstü (PC)',
                              'All in One',
                              'Akilli Tahta',
                              'Tablet',
                              'Monitör',
                              'Klavye ve Mouse Seti',
                              'Mouse',
                              'Klavye',
                              'Webcam',
                              'Hard Drive',
                              'Diger',
                            ].map((t) => (
                              <button
                                key={t}
                                onClick={() => {
                                  setHardwareFilterType(t);
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  hardwareFilterType === t
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {t === 'All' ? 'Tümü' : t}
                              </button>
                            ))}
                          </div>
                        )}
                        {activeFilterDropdown === 'campus' && isHQ && (
                          <div
                            style={{
                              width: '260px',
                              position: 'relative',
                              zIndex: 70,
                            }}
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[200px]"
                          >
                            <button
                              onClick={() => {
                                setCampusFilter('All');
                                setActiveFilterDropdown(null);
                              }}
                              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                campusFilter === 'All'
                                  ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                  : 'text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              Tüm Kampüsler
                            </button>
                            {Array.from(new Set(hardware.map((h) => h.campus)))
                              .filter(Boolean)
                              .sort((a, b) => a.localeCompare(b, 'tr'))
                              .map((c) => (
                                <button
                                  key={c}
                                  onClick={() => {
                                    setCampusFilter(c);
                                    setActiveFilterDropdown(null);
                                  }}
                                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                    campusFilter === c
                                      ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                      : 'text-gray-700 hover:bg-gray-50'
                                  }`}
                                >
                                  {c}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* --- BİTİŞ: FİLTRE ÇİPLERİ VE MENÜLERİ --- */}
                </div>
                {isSelectionMode && sortedHardware.length > 0 && (
                  <div className="flex flex-col gap-2 bg-blue-50/80 p-3 rounded-xl shadow-sm border border-blue-200 mb-3 animate-in fade-in sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[#0066b1]">
                        <input
                          ref={(node) => {
                            if (node) node.indeterminate = someHardwareOnPageSelected;
                          }}
                          type="checkbox"
                          className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
                          checked={allHardwareOnPageSelected}
                          onChange={(e) => handleSelectAllBulk(e, paginatedHardware)}
                        />
                        Bu sayfadakileri seç ({paginatedHardware.length})
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[#0066b1]">
                        <input
                          ref={(node) => {
                            if (node) node.indeterminate = someFilteredHardwareSelected;
                          }}
                          type="checkbox"
                          className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
                          checked={allFilteredHardwareSelected}
                          onChange={(e) => handleSelectAllBulk(e, sortedHardware)}
                        />
                        Filtrelenenlerin tümünü seç ({sortedHardware.length})
                      </label>
                    </div>
                    <span className="text-xs font-bold text-slate-500">
                      {selectedBulkHardware.length} cihaz seçili
                    </span>
                  </div>
                )}

                {/* --- DESKTOP VIEW (TABLE) --- */}
                <div className="inventory-table-shell hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-1">
                  <table className="inventory-table w-full text-left border-collapse">
                    <thead className="inventory-table-head bg-gray-50 border-b border-gray-200 select-none">
                      <tr>
                        <th className="p-4 w-12 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500"
                            checked={
                              paginatedHardware.length > 0 &&
                              paginatedHardware.every((h) =>
                                selectedHardwareIdSet.has(h.id)
                              )
                            }
                            onChange={(e) =>
                              handleSelectAllBulk(e, paginatedHardware)
                            }
                          />
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortHardware('type')}
                        >
                          <div className="flex items-center gap-1">
                            Tip {getSortIcon(hardwareSort, 'type')}
                          </div>
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortHardware('brand')}
                        >
                          <div className="flex items-center gap-1">
                            Marka / Model {getSortIcon(hardwareSort, 'brand')}
                          </div>
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortHardware('serial')}
                        >
                          <div className="flex items-center gap-1">
                            Seri No {getSortIcon(hardwareSort, 'serial')}
                          </div>
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortHardware('status')}
                        >
                          <div className="flex items-center gap-1">
                            Durum {getSortIcon(hardwareSort, 'status')}
                          </div>
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortHardware('person')}
                        >
                          <div className="flex items-center gap-1">
                            Personel {getSortIcon(hardwareSort, 'person')}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedHardware.map((item) => {
                        const personName =
                          personnelById.get(item.assignedTo)?.name || item.assignedTo;
                        const isSelected = selectedHardwareIdSet.has(item.id);
                        const getIcon = (type) => {
                          const t = String(type || '').toLowerCase();
                          if (t.includes('laptop'))
                            return <Laptop className="w-4 h-4 text-gray-500" />; // mobilde text-[#0066b1]
                          if (t.includes('masaüst') || t.includes('masaust') || t.includes('all in one') || t.includes('akıllı') || t.includes('akilli') || t.includes('tahta'))
                            return <Monitor className="w-4 h-4 text-gray-500" />;
                          if (t.includes('set') || t.includes('klavye'))
                            return (
                              <Keyboard className="w-4 h-4 text-gray-500" />
                            ); // mobilde text-[#0066b1]
                          if (t.includes('mouse'))
                            return <Mouse className="w-4 h-4 text-gray-500" />; // mobilde text-[#0066b1]
                          if (t.includes('monitör'))
                            return (
                              <Monitor className="w-4 h-4 text-gray-500" />
                            ); // mobilde text-[#0066b1]
                          return (
                            <HardDrive className="w-4 h-4 text-gray-500" />
                          ); // mobilde text-[#0066b1]
                        };

                        return (
                          <tr
                            key={item.id}
                            onClick={() => setViewingHardwareId(item.id)}
                            className={`inventory-table-row border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                              isSelected ? 'bg-blue-50/50' : ''
                            } ${
                              recentlyUpdatedHardwareIds.has(item.id) ? 'app-record-updated' : ''
                            }`}
                          >
                            <td
                              className="p-4 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500"
                                checked={isSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleToggleBulk(item.id);
                                }}
                              />
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                {getIcon(item.type)}
                                <div>
                                  <button
                                    onClick={() =>
                                      setHardwareFilterType(String(item.type || '').trim())
                                    }
                                    className="font-bold text-gray-900 hover:text-blue-600"
                                  >
                                    {item.type}
                                  </button>
                                  {isHQ && (
                                    <p className="inventory-campus-label text-[11px] text-gray-400 font-semibold">
                                      {item.campus}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              {(() => {
                                const brandStr = String(item.brand || '');
                                const modelStr = String(item.model || '');
                                // Eğer model kelimesi markayı zaten içeriyorsa, o kısmı kırp:
                                const cleanModel = modelStr
                                  .toLowerCase()
                                  .startsWith(brandStr.toLowerCase())
                                  ? modelStr.substring(brandStr.length).trim()
                                  : modelStr;

                                return (
                                  <div className="flex flex-col items-start gap-1.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setHardwareSearchQuery(brandStr);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                        className="font-bold text-gray-900 hover:text-blue-600 transition-colors text-left px-1 -ml-1 rounded hover:bg-blue-50"
                                        title={`${brandStr} markali cihazları ara`}
                                      >
                                        {brandStr}
                                      </button>
                                      <span className="text-gray-300">/</span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setHardwareSearchQuery(modelStr);
                                        }}
                                        style={{
                                          cursor: 'pointer',
                                          textDecorationThickness: '2px',
                                          textUnderlineOffset: '4px',
                                        }}
                                        className="font-semibold text-gray-600 hover:text-blue-600 hover:underline transition-colors text-left px-1 rounded hover:bg-blue-50"
                                        title={`${modelStr} modelini ara`}
                                      >
                                        {cleanModel}
                                      </button>
                                    </div>
                                    {/* GRUP ROZETI ALT SATIRA EKLENDI */}
                                    {item.groupName && (
                                      <span
                                        className="bg-indigo-50 text-indigo-600 border border-indigo-200 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm flex items-center gap-1 cursor-help mt-0.5"
                                        title="Bagli Oldugu Grup"
                                      >
                                        <Tag className="w-3 h-3" />{' '}
                                        {item.groupName}
                                      </span>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="p-4">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingHardwareId(item.id);
                                }}
                                className="inventory-serial-link text-blue-600 font-semibold hover:underline hover:bg-blue-50 px-1.5 py-0.5 rounded transition-colors cursor-pointer inline-block"
                                title="Cihaz detaylarını gör"
                              >
                                {item.serial}
                              </button>
                            </td>
                            <td className="p-4">
                              <span
                                className={`inventory-status status-chip-motion px-3 py-1 rounded-full text-xs font-bold ${
                                  item.status === 'Available'
                                    ? 'inventory-status--available bg-green-100 text-green-700'
                                    : item.status === 'Hurda'
                                    ? 'inventory-status--scrap bg-red-100 text-red-700'
                                    : item.status === 'Faulty'
                                    ? 'inventory-status--faulty bg-amber-100 text-amber-800'
                                    : item.status === 'Transfer'
                                    ? 'inventory-status--transfer bg-violet-100 text-violet-700'
                                    : 'inventory-status--assigned bg-blue-100 text-blue-700'
                                }`}
                              >
                                {item.status === 'Available'
                                  ? 'Depoda'
                                  : item.status === 'Hurda'
                                  ? 'Hurda'
                                  : item.status === 'Faulty'
                                  ? 'Arızalı'
                                  : item.status === 'Transfer'
                                  ? 'Transfer'
                                  : 'Zimmetli'}
                              </span>
                            </td>
                            <td className="p-4">
                              {personName ? (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setViewingPersonId(item.assignedTo);
                                    }}
                                    className="text-sm font-semibold text-gray-700 hover:text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded transition-colors cursor-pointer inline-block text-left truncate max-w-[150px]"
                                    title="Personel profiline git"
                                  >
                                    {personName}
                                  </button>
                                  
                                  {/* YENİ: ANA LİSTEDE PDF AÇMA BUTONU */}
                                  {hasCurrentAssignmentDocument(item) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePdfClick(item.driveLink, `${personName} Zimmet Belgesi`);
                                      }}
                                      className="p-1.5 bg-blue-50 text-[#0066b1] hover:bg-blue-100 rounded-md transition-colors border border-blue-200 shadow-sm shrink-0"
                                      title="Güncel Zimmet PDF'ini Aç"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400 font-medium">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {paginatedHardware.length === 0 && (
                        <tr>
                          <td
                            colSpan="6"
                            className="p-8 text-center text-gray-500"
                          >
                            Kayıt bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* YENİ: MASAÜSTÜ Donanım PAGINATION */}
                  <Pagination
                    currentPage={hardwarePage}
                    totalPages={hardwareTotalPages}
                    onPageChange={setHardwarePage}
                  />
                </div>

                {/* --- Donanım MOBİL GÖRÜNÜM --- */}
                <div className="block md:hidden space-y-2 mt-0">
                  {paginatedHardware.map((item) => {
                      const personName =
                        personnelById.get(item.assignedTo)?.name || item.assignedTo;
                    const isSelected = selectedHardwareIdSet.has(item.id);

                    const getIcon = (type) => {
                      const t = String(type || '').toLowerCase();
                      if (t.includes('laptop'))
                        return <Laptop className="w-5 h-5 text-[#0066b1]" />;
                      if (t.includes('masaüst') || t.includes('masaust') || t.includes('all in one') || t.includes('akıllı') || t.includes('akilli') || t.includes('tahta'))
                        return <Monitor className="w-5 h-5 text-[#0066b1]" />;
                      if (t.includes('mouse'))
                        return <Mouse className="w-5 h-5 text-[#0066b1]" />;
                      if (t.includes('monitör'))
                        return <Monitor className="w-5 h-5 text-[#0066b1]" />;
                      return <HardDrive className="w-5 h-5 text-[#0066b1]" />;
                    };

                    let statusColor = 'bg-[#0066b1]';
                    let statusText = 'ZİMMETLİ';
                    if (item.status === 'Available') {
                      statusColor = 'bg-green-500';
                      statusText = 'DEPODA';
                    }
                    if (item.status === 'Hurda') {
                      statusColor = 'bg-red-500';
                      statusText = 'HURDA';
                    }
                    if (item.status === 'Faulty') {
                      statusColor = 'bg-amber-500';
                      statusText = 'ARIZALI';
                    }
                    if (item.status === 'Transfer') {
                      statusColor = 'bg-violet-500';
                      statusText = 'TRANSFER';
                    }

                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (isSelectionMode) {
                            handleToggleBulk(item.id);
                          } else {
                            setViewingHardwareId(item.id);
                          }
                        }}
                        onTouchStart={() => handleTouchStart(item.id)}
                        onTouchEnd={handleTouchEnd}
                        onTouchMove={handleTouchEnd}
                        onMouseDown={() => handleTouchStart(item.id)}
                        onMouseUp={handleTouchEnd}
                        onMouseLeave={handleTouchEnd}
                        className={`inventory-mobile-card bg-white p-4 rounded-xl shadow-sm border flex flex-col transition-colors cursor-pointer relative select-none ${
                          isSelectionMode && isSelected
                            ? 'border-[#0066b1] bg-[#e0f0ff] ring-1 ring-[#0066b1]/50'
                            : 'border-gray-200 active:bg-gray-50'
                        } ${recentlyUpdatedHardwareIds.has(item.id) ? 'app-record-updated' : ''}`}
                      >
                        <div className="flex items-start gap-3 w-full">
                          {isSelectionMode && (
                            <div
                              className="pt-2 shrink-0 z-10 animate-in zoom-in fade-in duration-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#8bcdc5]"
                                checked={isSelected}
                                onChange={() => handleToggleBulk(item.id)}
                              />
                            </div>
                          )}

                          <div
                            className={`w-10 h-10 mt-0.5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
                              isSelectionMode && isSelected
                                ? 'bg-white border-[#8bcdc5]'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            {getIcon(item.type)}
                          </div>

                          <div className="flex-1 min-w-0 mt-0">
                            <div className="flex justify-between items-start gap-2">
                              {(() => {
                                const brandStr = String(item.brand || '');
                                const modelStr = String(item.model || '');
                                const cleanModel = modelStr
                                  .toLowerCase()
                                  .startsWith(brandStr.toLowerCase())
                                  ? modelStr.substring(brandStr.length).trim()
                                  : modelStr;

                                return (
                                  <div className="flex items-center gap-1.5 pr-2 overflow-hidden whitespace-nowrap">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setHardwareSearchQuery(brandStr);
                                      }}
                                      className="font-bold text-gray-900 text-[15px] leading-tight hover:text-blue-600 transition-colors shrink-0"
                                    >
                                      {brandStr}
                                    </button>
                                    <span className="text-gray-400 text-xs shrink-0">
                                      /
                                    </span>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setHardwareSearchQuery(modelStr);
                                      }}
                                      className="font-bold text-gray-700 text-[15px] leading-tight hover:text-blue-500 transition-colors truncate"
                                      title={cleanModel}
                                    >
                                      {cleanModel}
                                    </button>
                                  </div>
                                );
                              })()}

                              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                                {/* MOBIL GRUP ROZETI */}
                                {item.groupName && (
                                  <span className="bg-indigo-50 text-indigo-600 border border-indigo-200 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                                    <Tag className="w-2.5 h-2.5" />{' '}
                                    {item.groupName}
                                  </span>
                                )}

                                <div className="flex items-center gap-1.5">
                                  <div
                                    className={`inventory-status-dot status-chip-motion w-2.5 h-2.5 rounded-full ${statusColor} shadow-sm`}
                                  ></div>
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider hidden sm:inline-block">
                                    {statusText}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <p className="inventory-serial-inline text-xs text-gray-500 font-medium truncate mt-0.5">
                              S/N: {item.serial}
                            </p>
                          </div>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mt-1 flex flex-col w-full">
                          <p className="text-[10px] font-bold text-slate-400 tracking-wider mb-2">
                            ZİMMETLİ PERSONEL:
                          </p>
                          <div className="flex justify-between items-end gap-2">
                            <div className="flex flex-wrap justify-start gap-2 flex-1">
                              {personName ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isSelectionMode)
                                      setViewingPersonId(item.assignedTo);
                                  }}
                                  className={`px-2.5 py-1.5 bg-white rounded-md flex items-center gap-1.5 border border-slate-200 shadow-sm text-xs font-bold transition-colors ${
                                    isSelectionMode
                                      ? 'text-gray-400 pointer-events-none'
                                      : 'text-slate-700 hover:bg-blue-50 hover:text-[#0066b1] hover:border-blue-200'
                                  }`}
                                >
                                  <Users className="w-3.5 h-3.5 opacity-60" />{' '}
                                  {personName}
                                </button>
                              ) : (
                                <span className="text-[12px] text-gray-400 font-medium pb-1">
                                  Personel atanmadı.
                                </span>
                              )}
                            </div>

                            {hasCurrentAssignmentDocument(item) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isSelectionMode)
                                    handlePdfClick(
                                      item.driveLink,
                                      'Zimmet Belgesi'
                                    );
                                }}
                                className={`shrink-0 flex items-center text-[10px] px-2.5 py-1.5 rounded-md border font-bold transition-colors shadow-sm ${
                                  isSelectionMode
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 pointer-events-none'
                                    : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                }`}
                              >
                                <FileText className="w-3 h-3 mr-1" />{' '}
                                <ExternalLink className="w-2.5 h-2.5 ml-1 opacity-60" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {paginatedHardware.length === 0 && (
                    <div className="text-center p-6 text-gray-500 border border-dashed rounded-xl">
                      Arama kriterlerine uygun cihaz bulunamadı.
                    </div>
                  )}

                  {/* YENİ: MOBİL Donanım PAGINATION */}
                  <div className="mt-4 pb-8 border-t border-gray-200 pt-4 flex justify-center">
                    <Pagination
                      currentPage={hardwarePage}
                      totalPages={hardwareTotalPages}
                      onPageChange={setHardwarePage}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* GLPI MISSING DEVICES TAB */}
            {activeTab === 'glpiMissing' && (
              <Suspense fallback={<LazyPanelFallback label="GLPI cihazları hazırlanıyor..." />}>
                <GlpiMissingTab
                  missingGlpiSearchQuery={missingGlpiSearchQuery}
                  setMissingGlpiSearchQuery={setMissingGlpiSearchQuery}
                  showMissingGlpiFilters={showMissingGlpiFilters}
                  setShowMissingGlpiFilters={setShowMissingGlpiFilters}
                  fetchMissingGlpiDevices={fetchMissingGlpiDevices}
                  isLoadingMissingGlpi={isLoadingMissingGlpi}
                  missingGlpiLoadError={missingGlpiLoadError}
                  activeMissingGlpiFilterDropdown={activeMissingGlpiFilterDropdown}
                  setActiveMissingGlpiFilterDropdown={setActiveMissingGlpiFilterDropdown}
                  missingGlpiFilterType={missingGlpiFilterType}
                  setMissingGlpiFilterType={setMissingGlpiFilterType}
                  missingGlpiFilterCampus={missingGlpiFilterCampus}
                  setMissingGlpiFilterCampus={setMissingGlpiFilterCampus}
                  missingGlpiTypeOptions={missingGlpiTypeOptions}
                  missingGlpiCampusOptions={missingGlpiCampusOptions}
                  isHQ={isHQ}
                  isGlpiSelectionMode={isGlpiSelectionMode}
                  displayMissingGlpiDevices={displayMissingGlpiDevices}
                  selectedMissingGlpiIds={selectedMissingGlpiIds}
                  setSelectedMissingGlpiIds={setSelectedMissingGlpiIds}
                  handleGlpiToggleBulk={handleGlpiToggleBulk}
                  handleGlpiTouchStart={handleGlpiTouchStart}
                  handleGlpiTouchEnd={handleGlpiTouchEnd}
                  renderDeviceTypeIcon={renderDeviceTypeIcon}
                  setViewingPersonId={setViewingPersonId}
                  totalMissingGlpiCount={missingGlpiDevices.length}
                />
              </Suspense>
            )}
            {/* QR OPERATIONS TAB */}
            {activeTab === 'qrScan' && (
              <Suspense fallback={<LazyPanelFallback label="QR ekranı hazırlanıyor..." />}>
                <QrScanTab
                  qrScannerActive={qrScannerActive}
                  qrScannerError={qrScannerError}
                  qrVideoRef={qrVideoRef}
                  qrScannedHardware={qrScannedHardware}
                  selectedQrHardwareIds={selectedQrHardwareIds}
                  setSelectedQrHardwareIds={setSelectedQrHardwareIds}
                  qrScanLog={qrScanLog}
                  isQrActionBusy={isQrActionBusy}
                  qrActionLabel={qrActionLabel}
                  stopQrCamera={stopQrCamera}
                  handleStartQrCamera={handleStartQrCamera}
                  handleQrInventoryMark={handleQrInventoryMark}
                  handleQrStatusUpdate={handleQrStatusUpdate}
                  handleQrStartZimmet={handleQrStartZimmet}
                  handleOpenQrLabelPrint={handleOpenQrLabelPrint}
                  setViewingHardwareId={setViewingHardwareId}
                  renderDeviceTypeIcon={renderDeviceTypeIcon}
                  getPersonName={(personId) => personnelById.get(personId)?.name || personId || '-'}
                />
              </Suspense>
            )}
            {activeTab === 'systemAdmin' && currentUser?.isSuperAdmin && (
              <Suspense fallback={<LazyPanelFallback label="Sistem yönetimi hazırlanıyor..." />}>
                <SystemManagementTab
                  currentUser={currentUser}
                  onRefreshData={fetchVeritabani}
                />
              </Suspense>
            )}
            {/* PERSONNEL TAB */}
            {activeTab === 'personnel' && (
              <div className="app-tab-panel space-y-0 relative">
                {/* PERSONEL ARAMA ÇUBUĞU VE FİLTRELERİ */}
                <div
                  style={{ position: 'sticky', top: 0, zIndex: 80 }}
                  className="responsive-tab-toolbar bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-1"
                >
                  <div className="responsive-tab-toolbar__primary flex items-center gap-2 w-full">
                    {/* Arama Çubuğu */}
                    <div className="responsive-tab-toolbar__search flex items-center flex-1 min-w-0 px-3 h-10 border border-gray-200 rounded-xl bg-white shadow-sm focus-within:border-[#0066b1] focus-within:ring-2 focus-within:ring-[#0066b1]/20 transition-all">
                      <input
                        type="text"
                        placeholder="Personel Adı, E-Posta veya Ünvan ara..."
                        className="flex-1 bg-transparent outline-none min-w-0 text-gray-800 text-sm h-full"
                        value={personnelSearchQuery}
                        onChange={(e) =>
                          setPersonnelSearchQuery(e.target.value)
                        }
                      />
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        {personnelSearchQuery && (
                          <button
                            onClick={() => setPersonnelSearchQuery('')}
                            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                        <Search className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>

                    {/* Filtre Butonu (Artık Herkeste Görünür - MOBİLDE GÖRÜNÜR) */}
                    <button
                      onClick={() =>
                        setShowPersonnelFilters(!showPersonnelFilters)
                      }
                      className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm md:hidden ${
                        showPersonnelFilters
                          ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <Filter className="w-4 h-4" />
                    </button>

                    {/* Dışa Aktar Butonu */}
                    <div className="responsive-tab-toolbar__action responsive-tab-toolbar__actions-start relative shrink-0">
                      <button
                        onClick={() => setShowPersonnelMenu(!showPersonnelMenu)}
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                          showPersonnelMenu
                            ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                        title="Dışa Aktar"
                      >
                        <Download className="w-4 h-4" />
                      </button>

                      {showPersonnelMenu && (
                        <>
                          <div
                            className="fixed inset-0 z-[60]"
                            onClick={() => setShowPersonnelMenu(false)}
                          ></div>
                          <div
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col py-1"
                            style={{
                              position: 'absolute',
                              top: '100%',
                              right: 0,
                              marginTop: '8px',
                              zIndex: 99999,
                              minWidth: 'max-content',
                            }}
                          >
                            <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-gray-50/50">
                              Dışa Aktar
                            </div>
                            <button
                              onClick={() => {
                                setShowPersonnelMenu(false);
                                const exportData =
                                  selectedBulkPersonnel.length > 0
                                    ? sortedPersonnel.filter((p) =>
                                        selectedPersonnelIdSet.has(p.id)
                                      )
                                    : sortedPersonnel;
                                handleExportExcel(
                                  exportData,
                                  'Personel_Listesi',
                                  'personnel'
                                );
                              }}
                              disabled={isGenerating}
                              className="w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors text-left"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              <Download className="w-4 h-4 text-blue-500 shrink-0" />
                              <span>
                                {selectedBulkPersonnel.length > 0
                                  ? `Seçili (${selectedBulkPersonnel.length}) Excel Olarak İndir`
                                  : 'Excel Olarak İndir'}
                              </span>
                            </button>
                            <button
                              onClick={() => {
                                setShowPersonnelMenu(false);
                                const exportData =
                                  selectedBulkPersonnel.length > 0
                                    ? sortedPersonnel.filter((p) =>
                                        selectedPersonnelIdSet.has(p.id)
                                      )
                                    : sortedPersonnel;
                                handleCreateGoogleSheet(
                                  exportData,
                                  'personnel'
                                );
                              }}
                              disabled={isGenerating}
                              className="w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors text-left disabled:opacity-50"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              {isGenerating ? (
                                <Loader2 className="w-4 h-4 animate-spin text-green-600 shrink-0" />
                              ) : (
                                <Table className="w-4 h-4 text-green-600 shrink-0" />
                              )}
                              <span>
                                {selectedBulkPersonnel.length > 0
                                  ? `Seçilileri Sheets'e Aktar (${selectedBulkPersonnel.length}) `
                                  : "Google Sheets'e Aktar"}
                              </span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* PERSONEL FİLTRE ÇİPLERİ (DURUM VE KAMPÜS) */}
                  <div
                    className={`responsive-tab-toolbar__filters relative mt-3 mb-0 z-[90] ${
                      showPersonnelFilters
                        ? 'block animate-in slide-in-from-top-1 fade-in duration-200'
                        : 'hidden md:block'
                    }`}
                  >
                    <style>{`
                      .hide-scroll-bar::-webkit-scrollbar { display: none; }
                      .hide-scroll-bar { -ms-overflow-style: none; scrollbar-width: none; }
                    `}</style>

                    {/* ÇİPLER (KAYDIRILABİLİR ALAN) */}
                    <div className="flex items-center gap-2 pb-1 overflow-x-auto hide-scroll-bar w-full">
                      {/* YENİ EKLENEN DURUM ÇİPİ */}
                      <div className="relative shrink-0 pr-2">
                        <button
                          onClick={() =>
                            setActiveFilterDropdown(
                              activeFilterDropdown === 'personnel-status'
                                ? null
                                : 'personnel-status'
                            )
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm ${
                            personnelFilterStatus !== 'All'
                              ? 'bg-[#0066b1] border-[#0066b1] text-white'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Durum:{' '}
                          {personnelFilterStatus === 'All'
                            ? 'Tümü'
                            : personnelFilterStatus}
                          <ChevronDown className="w-3 h-3 opacity-70" />
                        </button>
                      </div>

                      {/* KAMPÜS ÇİPİ (Sadece Merkez/HQ görür) */}
                      {isHQ && (
                        <div className="relative shrink-0 pr-2">
                          <button
                            onClick={() =>
                              setActiveFilterDropdown(
                                activeFilterDropdown === 'personnel-campus'
                                  ? null
                                  : 'personnel-campus'
                              )
                            }
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm ${
                              campusFilter !== 'All'
                                ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            Kampüs:{' '}
                            {campusFilter === 'All'
                              ? 'Tümü'
                              : campusFilter.length > 12
                              ? campusFilter.substring(0, 12) + '...'
                              : campusFilter}
                            <ChevronDown className="w-3 h-3 opacity-70" />
                          </button>
                        </div>
                      )}

                      <div className="relative shrink-0 pr-2">
                        <button
                          onClick={() =>
                            setActiveFilterDropdown(
                              activeFilterDropdown === 'personnel-signature'
                                ? null
                                : 'personnel-signature'
                            )
                          }
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm ${
                            personnelSignatureFilter !== 'All'
                              ? 'bg-[#0066b1] border-[#0066b1] text-white'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          İmza:{' '}
                          {personnelSignatureFilter === 'Missing'
                            ? 'Eksik'
                            : personnelSignatureFilter === 'Ready'
                            ? 'Var'
                            : 'Tümü'}
                          <ChevronDown className="w-3 h-3 opacity-70" />
                        </button>
                      </div>

                      {(campusFilter !== 'All' ||
                        personnelFilterStatus !== 'Aktif' ||
                        personnelSignatureFilter !== 'All') && (
                        <button
                          onClick={() => {
                            setCampusFilter('All');
                            setPersonnelFilterStatus('Aktif');
                            setPersonnelSignatureFilter('All');
                            setActiveFilterDropdown(null);
                          }}
                          className="flex items-center gap-1 text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-full transition-colors shrink-0"
                        >
                          <X className="w-3.5 h-3.5" /> Temizle
                        </button>
                      )}
                    </div>

                    {/* AÇILIR MENÜLER */}
                    {activeFilterDropdown && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          zIndex: 70,
                          paddingTop: '4px',
                        }}
                      >
                        <div
                          className="fixed inset-0"
                          style={{ zIndex: 60 }}
                          onClick={() => setActiveFilterDropdown(null)}
                        ></div>

                        {/* DURUM AÇILIR MENÜSÜ */}
                        {activeFilterDropdown === 'personnel-status' && (
                          <div
                            style={{
                              width: '200px',
                              position: 'relative',
                              zIndex: 70,
                            }}
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto"
                          >
                            {[
                              'All',
                              'Aktif',
                              'Pasif',
                              'Kullanıcı Bulunamadı',
                            ].map((st) => (
                              <button
                                key={st}
                                onClick={() => {
                                  setPersonnelFilterStatus(st);
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  personnelFilterStatus === st
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {st === 'All' ? 'Tümü' : st}
                              </button>
                            ))}
                          </div>
                        )}

                        {activeFilterDropdown === 'personnel-signature' && (
                          <div
                            style={{
                              width: '200px',
                              position: 'relative',
                              zIndex: 70,
                            }}
                            className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[120px]"
                          >
                            {[
                              { value: 'All', label: 'Tüm imza durumları' },
                              { value: 'Missing', label: 'İmzası olmayanlar' },
                              { value: 'Ready', label: 'İmzası olanlar' },
                            ].map((item) => (
                              <button
                                key={item.value}
                                onClick={() => {
                                  setPersonnelSignatureFilter(item.value);
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  personnelSignatureFilter === item.value
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* KAMPÜS AÇILIR MENÜSÜ */}
                        {activeFilterDropdown === 'personnel-campus' &&
                          isHQ && (
                            <div
                              style={{
                                width: '260px',
                                position: 'relative',
                                zIndex: 70,
                              }}
                              className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[120px]"
                            >
                              <button
                                onClick={() => {
                                  setCampusFilter('All');
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  campusFilter === 'All'
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                Tüm Kampüsler
                              </button>
                              {Array.from(
                              new Set(personnel.map((p) => p.campus))
                            )
                              .filter(Boolean)
                              .sort((a, b) => a.localeCompare(b, 'tr'))
                              .map((c) => (
                                <button
                                  key={c}
                                    onClick={() => {
                                      setCampusFilter(c);
                                      setActiveFilterDropdown(null);
                                    }}
                                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                      campusFilter === c
                                        ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                        : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    {c}
                                  </button>
                                ))}
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                </div>
                {isPersonnelSelectionMode && sortedPersonnel.length > 0 && (
                  <div className="flex flex-col gap-2 bg-blue-50/80 p-3 rounded-xl shadow-sm border border-blue-200 mb-3 animate-in fade-in sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[#0066b1]">
                        <input
                          ref={(node) => {
                            if (node) node.indeterminate = somePersonnelOnPageSelected;
                          }}
                          type="checkbox"
                          className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
                          checked={allPersonnelOnPageSelected}
                          onChange={(e) =>
                            updatePersonnelBulkSelection(e.target.checked, paginatedPersonnel)
                          }
                        />
                        Bu sayfadakileri seç ({paginatedPersonnel.length})
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-[#0066b1]">
                        <input
                          ref={(node) => {
                            if (node) node.indeterminate = someFilteredPersonnelSelected;
                          }}
                          type="checkbox"
                          className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
                          checked={allFilteredPersonnelSelected}
                          onChange={(e) =>
                            updatePersonnelBulkSelection(e.target.checked, sortedPersonnel)
                          }
                        />
                        Filtrelenenlerin tümünü seç ({sortedPersonnel.length})
                      </label>
                    </div>
                    <span className="text-xs font-bold text-slate-500">
                      {selectedBulkPersonnel.length} personel seçili
                    </span>
                  </div>
                )}

                {/* --- DESKTOP VIEW (TABLE) --- */}
                <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-4">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200 select-none">
                      <tr>
                        <th className="p-4 w-12 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500"
                            checked={
                              paginatedPersonnel.length > 0 &&
                              paginatedPersonnel.every((p) =>
                                selectedPersonnelIdSet.has(p.id)
                              )
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                const newIds = paginatedPersonnel.map((p) => p.id);
                                setSelectedBulkPersonnel((prev) => [...new Set([...prev, ...newIds])]);
                              } else {
                                const pageIds = paginatedPersonnel.map((p) => p.id);
                                setSelectedBulkPersonnel((prev) => prev.filter((id) => !pageIds.includes(id)));
                              }
                            }}
                          />
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortPersonnel('name')}
                        >
                          <div className="flex items-center gap-1">
                            Personel {getSortIcon(personnelSort, 'name')}
                          </div>
                        </th>
                        <th
                          className="p-4 font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSortPersonnel('dept')}
                        >
                          <div className="flex items-center gap-1">
                            Görev / Ünvan {getSortIcon(personnelSort, 'dept')}
                          </div>
                        </th>
                        <th className="p-4 font-semibold text-gray-600 w-1/2">
                          Zimmetli Cihazlar ve Tutanaklar
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedPersonnel.map((person) => {
                        const assignedHardware = hardwareByAssignee.get(person.id) || [];
                        const isSelected = selectedPersonnelIdSet.has(person.id);

                        return (
                          <tr
                            key={person.id}
                            onClick={() => setViewingPersonId(person.id)}
                            className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                              isSelected ? 'bg-blue-50/50' : ''
                            } ${
                              recentlyUpdatedPersonnelIds.has(person.id) ? 'app-record-updated' : ''
                            }`}
                          >
                            <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500"
                                checked={isSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSelectedBulkPersonnel((prev) =>
                                    prev.includes(person.id)
                                      ? prev.filter((id) => id !== person.id)
                                      : [...prev, person.id]
                                  );
                                }}
                              />
                            </td>
                            <td className="p-4">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingPersonId(person.id);
                                }}
                                className="flex items-center space-x-3 group text-left cursor-pointer hover:bg-blue-50/50 p-1.5 -ml-1.5 rounded-lg transition-colors w-full"
                                title="Personel profiline git"
                              >
                                <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0 border border-blue-100 overflow-hidden group-hover:border-blue-300 transition-colors">
                                  {person.picture ? (
                                    <img src={person.picture} alt={person.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={() => handlePersonPictureError(person.id)} />
                                  ) : (
                                    String(person?.name || 'U').charAt(0)
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <span className="min-w-0 truncate font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                                      {person.name}
                                    </span>
                                    {isSignatureEligiblePerson(person) && !person.signatureLink && (
                                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                        <FileSignature className="w-3 h-3" />
                                        İmza yok
                                      </span>
                                    )}
                                  </div>
                                  {isHQ && (
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block mt-0.5 group-hover:text-gray-500 transition-colors">
                                      {person.campus}
                                    </span>
                                  )}
                                </div>
                              </button>
                            </td>
                            <td className="p-4 text-sm font-medium text-gray-700">
                              <div className="flex flex-col gap-1">
                                <span>{person.department || '-'}</span>
                                {person.signatureStatus && (
                                  <span className="text-[10px] font-bold text-gray-400">
                                    İmza: {person.signatureStatus}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              {assignedHardware.length > 0 ? (
                                <div className="flex flex-wrap gap-2.5">
                                  {assignedHardware.map((h) => (
                                    <div key={h.id} className="flex items-stretch bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden group">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setViewingHardwareId(h.id);
                                        }}
                                        className="px-2.5 py-1.5 flex items-center gap-1.5 text-[13px] font-bold text-slate-700 hover:bg-blue-50 hover:text-[#0066b1] transition-colors"
                                        title="Cihaz profiline git"
                                      >
                                        <Laptop className="w-3.5 h-3.5 opacity-60 group-hover:text-[#0066b1] transition-colors" /> {h.brand}
                                      </button>

                                      {hasCurrentAssignmentDocument(h) && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handlePdfClick(h.driveLink, 'Güncel Zimmet Belgesi');
                                          }}
                                          className="px-2.5 flex items-center justify-center border-l border-slate-200 bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700 transition-colors"
                                          title="Bu Cihaza Ait Zimmet Belgesini Aç"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400 font-medium">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {paginatedPersonnel.length === 0 && (
                        <tr>
                          <td colSpan="4" className="p-8 text-center text-gray-500">
                            Personel bulunamadı.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {/* YENİ: MASAÜSTÜ PERSONEL PAGINATION */}
                  <Pagination
                    currentPage={personnelPage}
                    totalPages={personnelTotalPages}
                    onPageChange={setPersonnelPage}
                  />
                </div>

                {/* --- PERSONNEL MOBİL GÖRÜNÜM --- */}
                <div className="block md:hidden space-y-3 mt-1 pb-32">
                  {paginatedPersonnel.map((person) => {
                    // DÜZELTME: Artık tüm veritabanından (hardware) tarama yapılıyor
                    const assignedHardware = hardwareByAssignee.get(person.id) || [];
                    const appSheetDocs = assignedHardware.filter(
                      (h) => h.driveLink
                    );
                    const isSelected = selectedPersonnelIdSet.has(person.id);

                    return (
                      <div
                        key={person.id}
                        onClick={() => {
                          if (isPersonnelSelectionMode) {
                            handlePersonnelToggleBulk(person.id);
                          } else {
                            setViewingPersonId(person.id);
                          }
                        }}
                        onTouchStart={() =>
                          handlePersonnelTouchStart(person.id)
                        }
                        onTouchEnd={handlePersonnelTouchEnd}
                        onTouchMove={handlePersonnelTouchEnd}
                        onMouseDown={() => handlePersonnelTouchStart(person.id)}
                        onMouseUp={handlePersonnelTouchEnd}
                        onMouseLeave={handlePersonnelTouchEnd}
                        className={`bg-white p-4 rounded-xl shadow-sm border flex flex-col transition-colors relative select-none cursor-pointer overflow-hidden ${
                          isPersonnelSelectionMode && isSelected
                            ? 'border-[#0066b1] bg-[#e0f0ff] ring-1 ring-[#0066b1]/50'
                            : 'border-gray-200 active:bg-gray-50'
                        } ${recentlyUpdatedPersonnelIds.has(person.id) ? 'app-record-updated' : ''}`}
                      >
                        <div className="flex items-center gap-3 w-full">
                          {isPersonnelSelectionMode && (
                            <div
                              className="shrink-0 z-10 animate-in zoom-in fade-in duration-200"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#8bcdc5]"
                                checked={isSelected}
                                onChange={() =>
                                  handlePersonnelToggleBulk(person.id)
                                }
                              />
                            </div>
                          )}
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0 transition-colors overflow-hidden ${
                              isPersonnelSelectionMode && isSelected
                                ? 'bg-white border border-[#8bcdc5]'
                                : 'bg-slate-50 border border-slate-200 text-[#0066b1]'
                            }`}
                          >
                            {person.picture ? (
                              <img
                                src={person.picture}
                                alt={person.name}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={() => handlePersonPictureError(person.id)}
                              />
                            ) : (
                              String(person?.name || 'U').charAt(0)
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                              <p className="font-bold text-gray-900 text-[15px] truncate pr-2">
                                {person.name}
                              </p>
                              {isHQ && (
                                <span className="shrink-0 text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-md font-bold uppercase tracking-wider border border-gray-200">
                                  {person.campus}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-2">
                              <p className="min-w-0 flex-1 truncate text-xs font-medium text-gray-500">
                                {person.department || 'Personel'}
                              </p>
                              {isSignatureEligiblePerson(person) && !person.signatureLink && (
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                                  <FileSignature className="w-3 h-3" />
                                  İmza yok
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mt-3 flex flex-col w-full">
                          <p className="text-[10px] font-bold text-slate-400 tracking-wider mb-2">
                            ZİMMETLİ CİHAZLAR:
                          </p>
                          <div className="flex flex-wrap gap-2 w-full">
                            {assignedHardware.length > 0 ? (
                              assignedHardware.map((h) => (
                                <div
                                  key={h.id}
                                  className="flex items-stretch bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden group"
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (!isPersonnelSelectionMode)
                                        setViewingHardwareId(h.id);
                                    }}
                                    className={`px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-bold transition-colors ${
                                      isPersonnelSelectionMode
                                        ? 'text-gray-400 pointer-events-none'
                                        : 'text-slate-700 hover:bg-blue-50 hover:text-[#0066b1]'
                                    }`}
                                  >
                                    <Laptop className="w-3.5 h-3.5 opacity-60 group-hover:text-[#0066b1]" />{' '}
                                    {h.brand}
                                  </button>

                                  {hasCurrentAssignmentDocument(h) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isPersonnelSelectionMode)
                                          handlePdfClick(
                                            h.driveLink,
                                            'Güncel Zimmet Belgesi'
                                          );
                                      }}
                                      className={`px-2.5 flex items-center justify-center border-l border-slate-200 transition-colors ${
                                        isPersonnelSelectionMode
                                          ? 'bg-gray-50 text-gray-400 pointer-events-none'
                                          : 'bg-green-50 text-green-600 hover:bg-green-100 hover:text-green-700'
                                      }`}
                                      title="İlgili Zimmet Belgesini Aç"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              ))
                            ) : (
                              <span className="text-[12px] text-gray-400 font-medium pb-1">
                                Cihaz bulunmuyor.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {paginatedPersonnel.length === 0 && (
                    <div className="text-center p-6 text-gray-500 border border-dashed rounded-xl">
                      Personel bulunamadı.
                    </div>
                  )}

                  {/* YENİ: MOBİL PERSONEL PAGINATION */}
                  <div className="mt-6 pb-28 border-t border-gray-200 pt-4 flex justify-center">
                    <Pagination
                      currentPage={personnelPage}
                      totalPages={personnelTotalPages}
                      onPageChange={setPersonnelPage}
                    />
                  </div>
                </div>
              </div>
            )}
            {/* TRANSFER MERKEZI (LOG) TAB                 */}
            {activeTab === 'transfer' && (
              <div className="app-tab-panel max-w-5xl mx-auto space-y-4 pb-32">
                {/* 1. STICKY ARAMA VE FİLTRE ÇUBUĞU (EN ÜSTTE) */}
                <div
                  style={{ position: 'sticky', top: 0, zIndex: 80 }}
                  className="responsive-tab-toolbar bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-2"
                >
                  <div className="responsive-tab-toolbar__primary flex items-center gap-2 w-full">
                    {/* Arama Çubuğu */}
                    <div className="responsive-tab-toolbar__search flex items-center flex-1 min-w-0 h-10 px-4 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#0066b1] transition-all shadow-sm">
                      <Search className="w-5 h-5 text-gray-400 mr-3 shrink-0" />
                      <input
                        type="text"
                        placeholder="Gönderen, Alıcı, Marka, Model veya Seri No ara..."
                        value={transferSearchQuery}
                        onChange={(e) => setTransferSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent outline-none text-sm font-medium text-gray-800 min-w-0"
                      />
                      {transferSearchQuery && (
                        <button
                          onClick={() => setTransferSearchQuery('')}
                          className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors ml-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Filtre Aç/Kapat Butonu */}
                    <button
                      onClick={() =>
                        setShowTransferFilters(!showTransferFilters)
                      }
                      className={`responsive-tab-toolbar__mobile-filter w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                        showTransferFilters
                          ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <Filter className="w-4 h-4" />
                    </button>
                  </div>

                  {/* FİLTRE ÇİPLERİ VE AÇILIR MENÜLER */}
                  <div
                    className={`responsive-tab-toolbar__filters relative mt-3 mb-0 z-[90] ${
                      showTransferFilters
                        ? 'block animate-in slide-in-from-top-1 fade-in duration-200'
                        : 'hidden'
                    }`}
                  >
                      <style>{`.hide-scroll-bar::-webkit-scrollbar { display: none; } .hide-scroll-bar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>

                      <div className="flex items-center gap-2 pb-1 overflow-x-auto hide-scroll-bar w-full">
                        {(transferFilterDate ||
                          transferFilterSender !== 'All' ||
                          transferFilterReceiver !== 'All') && (
                          <button
                            onClick={() => {
                              setTransferFilterDate('');
                              setTransferFilterSender('All');
                              setTransferFilterReceiver('All');
                              setActiveFilterDropdown(null);
                            }}
                            className="flex items-center gap-1 text-[11px] font-bold text-red-500 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1.5 rounded-full transition-colors shrink-0"
                          >
                            <X className="w-3.5 h-3.5" /> Temizle
                          </button>
                        )}

                        {/* Tarih Çipi (iOS ve Desktop Uyumlu Placeholder Hilesi) */}
<div className="relative shrink-0 pr-1 flex items-center justify-center">
  {/* Eğer tarih seçilmediyse üstte 'Tarih Seç 📅' yazısı görünür */}
  {!transferFilterDate && (
    <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-[11px] sm:text-xs font-bold text-gray-700 bg-white border border-gray-300 rounded-full shadow-sm z-10 h-[28px] sm:h-[30px]">
      Tarih Seç 📅
    </span>
  )}
  <input
    type="date"
    value={transferFilterDate}
    onChange={(e) => setTransferFilterDate(e.target.value)}
    onClick={(e) => {
      if (typeof e.currentTarget.showPicker === 'function') {
        try {
          e.currentTarget.showPicker();
        } catch {
          e.currentTarget.focus();
        }
      }
    }}
    aria-label="Transfer tarihini seç"
    className={`flex items-center justify-center min-w-[110px] sm:min-w-[125px] px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm outline-none h-[28px] sm:h-[30px] cursor-pointer relative z-0 ${
      transferFilterDate
        ? 'bg-[#0066b1] border-[#0066b1] text-white'
        : 'text-transparent bg-transparent border-transparent'
    }`}
  />
</div>

                        {/* Gönderen Kampüs Çipi */}
                        <div className="relative shrink-0 pr-1">
                          <button
                            onClick={() =>
                              setActiveFilterDropdown(
                                activeFilterDropdown === 'transfer-sender'
                                  ? null
                                  : 'transfer-sender'
                              )
                            }
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm ${
                              transferFilterSender !== 'All'
                                ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            Gönderen:{' '}
                            {transferFilterSender === 'All'
                              ? 'Tümü'
                              : transferFilterSender.length > 12
                              ? transferFilterSender.substring(0, 12) + '...'
                              : transferFilterSender}
                            <ChevronDown className="w-3 h-3 opacity-70" />
                          </button>
                        </div>

                        {/* Alıcı Kampüs Çipi */}
                        <div className="relative shrink-0 pr-2">
                          <button
                            onClick={() =>
                              setActiveFilterDropdown(
                                activeFilterDropdown === 'transfer-receiver'
                                  ? null
                                  : 'transfer-receiver'
                              )
                            }
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm ${
                              transferFilterReceiver !== 'All'
                                ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            Alıcı:{' '}
                            {transferFilterReceiver === 'All'
                              ? 'Tümü'
                              : transferFilterReceiver.length > 12
                              ? transferFilterReceiver.substring(0, 12) + '...'
                              : transferFilterReceiver}
                            <ChevronDown className="w-3 h-3 opacity-70" />
                          </button>
                        </div>
                      </div>

                      {/* AÇILIR MENÜLER */}
                      {activeFilterDropdown && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 70,
                            paddingTop: '4px',
                          }}
                        >
                          <div
                            className="fixed inset-0"
                            style={{ zIndex: 60 }}
                            onClick={() => setActiveFilterDropdown(null)}
                          ></div>

                          {activeFilterDropdown === 'transfer-sender' && (
                            <div
                              style={{
                                width: '240px',
                                position: 'relative',
                                zIndex: 70,
                              }}
                              className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[100px]"
                            >
                              <button
                                onClick={() => {
                                  setTransferFilterSender('All');
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  transferFilterSender === 'All'
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                Gönderen: Tümü
                              </button>
                              {Array.from(
                              new Set(hardware.map((h) => h.campus))
                            )
                              .filter(Boolean)
                              .sort((a, b) => a.localeCompare(b, 'tr'))
                              .map((c) => (
                                <button
                                  key={c}
                                    onClick={() => {
                                      setTransferFilterSender(c);
                                      setActiveFilterDropdown(null);
                                    }}
                                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                      transferFilterSender === c
                                        ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                        : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    {c}
                                  </button>
                                ))}
                            </div>
                          )}

                          {activeFilterDropdown === 'transfer-receiver' && (
                            <div
                              style={{
                                width: '240px',
                                position: 'relative',
                                zIndex: 70,
                              }}
                              className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[200px]"
                            >
                              <button
                                onClick={() => {
                                  setTransferFilterReceiver('All');
                                  setActiveFilterDropdown(null);
                                }}
                                className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                  transferFilterReceiver === 'All'
                                    ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                    : 'text-gray-700 hover:bg-gray-50'
                                }`}
                              >
                                Alıcı: Tümü
                              </button>
                              {Array.from(
                              new Set(hardware.map((h) => h.campus))
                            )
                              .filter(Boolean)
                              .sort((a, b) => a.localeCompare(b, 'tr'))
                              .map((c) => (
                                <button
                                  key={c}
                                    onClick={() => {
                                      setTransferFilterReceiver(c);
                                      setActiveFilterDropdown(null);
                                    }}
                                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                                      transferFilterReceiver === c
                                        ? 'font-bold text-[#0066b1] bg-blue-50/50'
                                        : 'text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    {c}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 md:p-6">
                  {(() => {
                    // --- VERI HAZIRLIGI (WOD KORUMALI & LAZY LOAD UYUMLU) ---
                    const myPendingOutbound = {};
                    const myPendingInbound = {};
                    const myCompletedTransfers = {};
                    let pendingItemCount = 0;

                    hardware.forEach((h) => {
                      if (h.status === 'Transfer') {
                        const assignedToUp = String(h.assignedTo || '').toUpperCase();
                        
                        // 1. GIDEN (Bekleyen)
                        if (assignedToUp.includes(`GÖNDEREN:${(currentUser?.campus || '').toUpperCase()}`)) {
                          const key = h.driveLink || `pending_out_${h.campus}_${h.id}`;
                          if (!myPendingOutbound[key]) {
                            myPendingOutbound[key] = { targetCampus: h.campus, outLink: h.driveLink, items: [] };
                          }
                          myPendingOutbound[key].items.push(h);
                          pendingItemCount++;
                        }
                        
                        // 2. GELEN (Bekleyen)
                        else if (
                          getCoreCampusName(h.campus) === getCoreCampusName(currentUser.campus) &&
                          assignedToUp.includes('GÖNDEREN:')
                        ) {
                          // BÜYÜK HARF HATASI DÜZELTİLDİ: Orijinal metinden ayıklıyoruz!
                          const originalAssignedTo = String(h.assignedTo || '');
                          const senderName = originalAssignedTo.split(/GÖNDEREN:/i)[1]?.trim() || 'Diğer Kampüs';
                          const key = h.driveLink || `pending_in_${senderName}_${h.id}`;
                          if (!myPendingInbound[key]) {
                            myPendingInbound[key] = { senderCampus: senderName, inLink: h.driveLink, items: [] };
                          }
                          myPendingInbound[key].items.push(h);
                          pendingItemCount++;
                        }
                      }

                      // 3. TAMAMLANMIŞ TRANSFERLER (Çoklu Gidiş-Dönüş Destekli)
                      if (h.status !== 'Transfer' && Array.isArray(h.history)) {
                        // Cihazın TÜM geçmişini tarıyoruz ki her gidiş-dönüş ayrı ayrı listelenebilsin
                        for (let i = 0; i < h.history.length; i++) {
                          const rec = h.history[i];
                          if (!rec) continue;
                          
                          const tStr = toTrLower(String(rec.type || ''));
                          
                          // Sadece 'Giriş' veya 'İptal' kayıtlarını yakalıyoruz (Çünkü bunlar bir transferin bitiş noktasıdır)
                          if (tStr.includes('giriş') || tStr.includes('teslim') || tStr.includes('iptal') || tStr.includes('i̇ptal')) {
                            const inRec = rec;
                            let outRec = null;
                            
                            // Bu Giriş kaydına ait 'Çıkış' kaydını bulmak için geçmişe doğru (i'den sonrasına) bakıyoruz
                            for (let j = i + 1; j < h.history.length; j++) {
                              const prevRec = h.history[j];
                              if (!prevRec) continue;
                              const ptStr = toTrLower(String(prevRec.type || ''));
                              if (ptStr.includes('çıkış') || ptStr.includes('transfer')) {
                                outRec = prevRec;
                                break; // Eşleşen çıkışı bulduk
                              }
                            }
                            
                            // Eğer hem Çıkış hem Giriş bulduysak bu tam bir transferdir
                            if (outRec) {
                              const pStrIn = toTrLower(String(inRec.personName || ''));
                              const pStrOut = toTrLower(String(outRec.personName || ''));
                              
                              // Bu transfer bizimle alakalı mı kontrol et (İsim veya Kampüs kökü eşleşiyor mu?)
                              const involvesMe = pStrIn.includes(toTrLower(currentUser.name)) || pStrOut.includes(toTrLower(currentUser.name));
                              const involvesMyCampus = getCoreCampusName(pStrIn) === myCoreCampus || getCoreCampusName(pStrOut) === myCoreCampus || getCoreCampusName(tStr).includes(myCoreCampus) || getCoreCampusName(toTrLower(outRec.type || '')).includes(myCoreCampus);
                              
                              if (involvesMe || involvesMyCampus) {
                                // Çıkış yapılan PDF linki o transfer partisinin benzersiz ID'sidir
                                const key = outRec.driveLink || inRec.driveLink || `comp_${h.id}_${i}`;
                                
                                let senderCmp = 'Bilinmeyen Kampüs';
                                if (outRec.type && String(outRec.type).includes('(')) {
                                  const match = String(outRec.type).match(/\(([^)]+)\)/);
                                  senderCmp = match ? match[1] : 'Bilinmeyen Kampüs';
                                } else {
                                  senderCmp = String(outRec.personName || '').replace(/GÖNDEREN:/i, '').replace(/GONDEREN:/i, '').trim();
                                }

                                let receiverCmp = 'Bilinmiyor';
                                if (inRec.type && String(inRec.type).includes('(')) {
                                  const match = String(inRec.type).match(/\(([^)]+)\)/);
                                  receiverCmp = match ? match[1] : 'Bilinmiyor';
                                } else if (tStr.includes('iptal') || tStr.includes('i̇ptal')) {
                                  receiverCmp = senderCmp; // İptalse geri dönmüştür
                                }
                                
                                if (!myCompletedTransfers[key]) {
                                  myCompletedTransfers[key] = {
                                    date: inRec.date || outRec.date || '-',
                                    targetCampus: receiverCmp,
                                    senderCampus: senderCmp,
                                    senderName: outRec.personName || 'IT Personeli',
                                    receiverName: inRec.personName || 'IT Personeli',
                                    outLink: outRec.driveLink || null,
                                    inLink: inRec.driveLink || null,
                                    items: [],
                                  };
                                }
                                
                                if (!myCompletedTransfers[key].items.find((item) => item.id === h.id)) {
                                  myCompletedTransfers[key].items.push(h);
                                }
                              }
                            }
                          }
                        }
                      }
                    });

                    const pendingOutKeys = Object.keys(myPendingOutbound);
                    const pendingInKeys = Object.keys(myPendingInbound);
                    const completedKeys = Object.keys(myCompletedTransfers);

                    // --- ARAMA VE FİLTRELEME MANTIĞI ---
                    const searchTerms = toTrLower(transferSearchQuery).split(/\s+/).filter(Boolean);
                    const formattedFilterDate = transferFilterDate ? transferFilterDate.split('-').reverse().join('.') : '';

                    const filterGroup = (group, isPendingIn = false, isPendingOut = false) => {
                      const gSenderCamp = isPendingIn ? group.senderCampus : (isPendingOut ? currentUser.campus : group.senderCampus);
                      const gRecCamp = isPendingIn ? currentUser.campus : (isPendingOut ? group.targetCampus : group.targetCampus);
                      const gSenderName = group.senderName || '';
                      const gRecName = group.receiverName || '';

                      if (searchTerms.length > 0) {
                        const combined = toTrLower(`${gSenderCamp} ${gRecCamp} ${gSenderName} ${gRecName} ${group.date || ''} ${group.items.map((i) => `${i.brand} ${i.model} ${i.serial}`).join(' ')}`);
                        if (!searchTerms.every((term) => combined.includes(term))) return false;
                      }

                      // YENİ: Filtrelerken sağın ve solun içindeki "Kampüsü" kelimelerini görmezden gel
                      if (transferFilterSender !== 'All' && getCoreCampusName(gSenderCamp) !== getCoreCampusName(transferFilterSender)) return false;
                      if (transferFilterReceiver !== 'All' && getCoreCampusName(gRecCamp) !== getCoreCampusName(transferFilterReceiver)) return false;
                      if (formattedFilterDate && !(group.date || '').includes(formattedFilterDate)) return false;

                      return true;
                    };

                    const filteredPendingIn = pendingInKeys.filter((k) => filterGroup(myPendingInbound[k], true, false));
                    const filteredPendingOut = pendingOutKeys.filter((k) => filterGroup(myPendingOutbound[k], false, true));
                    const filteredCompleted = completedKeys.filter((k) => filterGroup(myCompletedTransfers[k]));

                    // YENİ: Tutanak sayısını değil, içindeki toplam cihaz sayısını hesaplar
                    const totalCompletedDevices = filteredCompleted.reduce((total, key) => total + myCompletedTransfers[key].items.length, 0);

                    return (
                    
                      <div className="space-y-6">
                        {/* 2. SEKMELER (ARAMA ÇUBUĞUNUN ALTINDA) - MOBİL UYUMLU */}
                        <div className="flex flex-wrap sm:flex-nowrap bg-gray-100 p-1.5 rounded-xl shadow-inner w-full md:w-auto md:inline-flex gap-1">
                          <button
                            onClick={() => setTransferViewTab('pending')}
                            className={`flex-1 min-w-[130px] md:w-auto px-3 sm:px-4 py-2.5 text-[13px] sm:text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
                              transferViewTab === 'pending'
                                ? 'bg-white text-[#0066b1] shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            <span className="whitespace-nowrap">Bekleyenler</span>
                            <span
                              className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] shrink-0 ${
                                transferViewTab === 'pending'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {pendingItemCount}
                            </span>
                          </button>
                          <button
                            onClick={() => setTransferViewTab('completed')}
                            className={`flex-1 min-w-[160px] px-3 sm:px-5 py-2.5 text-[13px] sm:text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
                              transferViewTab === 'completed'
                                ? 'bg-white text-[#0066b1] shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            <span className="whitespace-nowrap">Tamamlananlar</span>
                            <span
                              className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] shrink-0 ${
                                transferViewTab === 'completed'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {totalCompletedDevices}
                            </span>
                          </button>
                        </div>

                        {/* BEKLEYENLER LİSTESİ */}
                        {transferViewTab === 'pending' && (
                          <div className="space-y-4 animate-in fade-in duration-200">
                            {filteredPendingIn.length === 0 &&
                            filteredPendingOut.length === 0 ? (
                              <div className="py-12 flex flex-col items-center justify-center text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <Search className="w-10 h-10 text-gray-300 mb-3" />
                                <p className="text-gray-500 text-sm font-medium">
                                  Bu kriterlere uygun bekleyen işlem bulunamadı.
                                </p>
                              </div>
                            ) : (
                              <>
                                {/* 1. BİZE GELEN TRANSFERLER */}
                                {filteredPendingIn.map((key) => {
                                  const group = myPendingInbound[key];
                                  let sentDate =
                                    group.items[0]?.lastEventDate ||
                                    group.items[0]?.updatedAt ||
                                    '';
                                  let senderN =
                                    group.items[0]?.lastEventPersonName || 'IT Personeli';
                                  
                                  if (Array.isArray(group.items[0]?.history) && group.items[0].history.length > 0) {
                                    const latestLog = group.items[0].history[0];
                                    // YENİ: latestLog null/undefined gelirse çökmeyi engelleyen if şartı
                                    if (latestLog) {
                                      sentDate = latestLog.date || sentDate;
                                      senderN = latestLog.personName || "IT Personeli";
                                    }
                                  }

                                  return (
                                    <div
                                      key={key}
                                      className="bg-white rounded-xl shadow-md border border-gray-200 border-l-4 border-l-[#0066b1] p-4 md:p-5 transition-all group animate-in slide-in-from-left-2"
                                    >
                                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                                        <span className="text-[#0066b1] text-[11px] font-black tracking-wide uppercase flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-md border border-blue-100">
                                          Gelen Transfer (Onayınız Bekleniyor)
                                        </span>
                                        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                          <button
                                            onClick={() => handleCancelTransfer(group.items, group.senderCampus)}
                                            className="w-full sm:w-auto bg-white text-red-600 border border-red-200 px-4 py-2 rounded-lg text-xs font-bold shadow-sm hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5"
                                          >
                                            <X className="w-4 h-4" /> Reddet
                                          </button>
                                          <button
                                            onClick={() =>
                                              setTransferModalObj({
                                                type: 'in',
                                                items: group.items,
                                                targetCampus: currentUser.campus,
                                                senderCampus: group.senderCampus,
                                              })
                                            }
                                            className="w-full sm:w-auto bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-md hover:bg-green-700 transition-colors flex items-center justify-center gap-1.5"
                                          >
                                            <CheckCircle2 className="w-4 h-4" />{' '}
                                            İncele ve Teslim Al
                                          </button>
                                        </div>
                                      </div>

                                      {/* YENİ ROTA GÖRÜNÜMÜ */}
                                      <div className="flex flex-col mb-4 bg-gray-50 w-full px-4 py-3 rounded-xl border border-gray-100">
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                          Transfer Rotası:
                                        </span>
                                        <div className="flex items-center justify-between gap-3 w-full max-w-lg">
                                          <div className="flex flex-col flex-1">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">
                                              Gönderen
                                            </span>
                                            <span
                                              className="text-sm font-bold text-gray-900 truncate"
                                              title={senderN}
                                            >
                                              {senderN}
                                            </span>
                                            <span className="text-[11px] text-gray-500 font-medium truncate">
                                              {group.senderCampus}
                                            </span>
                                          </div>
                                          <div className="transfer-route-progress" role="img" aria-label="Transfer yolda">
                                            <span className="transfer-route-dot is-complete" />
                                            <span className="transfer-route-line" />
                                            <span className="transfer-route-dot is-current" />
                                          </div>
                                          <div className="flex flex-col flex-1 text-right">
                                            <span className="text-[10px] font-bold text-[#0066b1] uppercase">
                                              Teslim Alan
                                            </span>
                                            <span
                                              className="text-sm font-black text-[#0066b1] truncate"
                                              title={currentUser.name}
                                            >
                                              {currentUser.name}
                                            </span>
                                            <span className="text-[11px] text-[#0066b1]/70 font-bold truncate">
                                              {currentUser.campus}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap gap-2 mb-4">
                                        {group.items.map((hw) => (
                                          <button
                                            key={hw.id}
                                            onClick={() =>
                                              setViewingHardwareId(hw.id)
                                            }
                                            className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-[#0066b1] hover:bg-blue-50 transition-colors px-2.5 py-1.5 rounded-md shadow-sm text-left max-w-full shrink-0"
                                          >
                                            <Laptop className="w-3.5 h-3.5 text-[#0066b1] shrink-0" />
                                            <span className="font-bold text-gray-800 text-xs truncate">
                                              {hw.brand} {hw.model}
                                            </span>
                                            <span className="text-gray-300">
                                              |
                                            </span>
                                            <span className="text-[10px] text-gray-500 font-medium truncate">
                                              S/N: {hw.serial}
                                            </span>
                                          </button>
                                        ))}
                                      </div>

                                      <div className="pt-3 border-t border-gray-100 text-[11px] text-gray-500 font-bold flex items-center gap-1.5">
                                        <History className="w-4 h-4 text-gray-400" />{' '}
                                        Gönderim Zamanı:{' '}
                                        <span className="text-gray-800">
                                          {formatTransferDateTime(sentDate)}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* 2. BİZİM GÖNDERDİKLERİMİZ */}
                                {filteredPendingOut.map((key) => {
                                  const group = myPendingOutbound[key];
                                  let sentDate =
                                    group.items[0]?.lastEventDate ||
                                    group.items[0]?.updatedAt ||
                                    '';
                                  
                                  if (Array.isArray(group.items[0]?.history) && group.items[0].history.length > 0) {
                                    const latestLog = group.items[0].history[0];
                                    if (latestLog) {
                                      sentDate = latestLog.date || sentDate;
                                      // HATA DÜZELTİLDİ: Tanımlanmayan 'senderN' satırı tamamen silindi çünkü burada kullanılmıyor!
                                    }
                                  }

                                  return (
                                    <div
                                      key={key}
                                      className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-amber-500 p-4 transition-all hover:shadow-md group"
                                    >
                                      <div className="flex justify-between items-center mb-4">
                                        <span className="text-amber-600 text-[11px] font-extrabold tracking-wide uppercase flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded border border-amber-100">
                                          <Loader2 className="w-3.5 h-3.5 animate-spin" />{' '}
                                          Alıcı Onayı Bekleniyor
                                        </span>
                                      </div>

                                      {/* ROTA GÖRÜNÜMÜ */}
                                      <div className="flex flex-col mb-4 bg-gray-50 w-full px-4 py-3 rounded-xl border border-gray-100">
                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                          Transfer Rotası:
                                        </span>
                                        <div className="flex items-center justify-between gap-3 w-full max-w-lg">
                                          <div className="flex flex-col flex-1">
                                            <span className="text-[10px] font-bold text-[#0066b1] uppercase">
                                              Gönderen
                                            </span>
                                            <span
                                              className="text-sm font-black text-[#0066b1] truncate"
                                              title={currentUser.name}
                                            >
                                              {currentUser.name}
                                            </span>
                                            <span className="text-[11px] text-[#0066b1]/70 font-bold truncate">
                                              {currentUser.campus}
                                            </span>
                                          </div>
                                          <div className="transfer-route-progress" role="img" aria-label="Transfer yolda">
                                            <span className="transfer-route-dot is-complete" />
                                            <span className="transfer-route-line" />
                                            <span className="transfer-route-dot is-current" />
                                          </div>
                                          <div className="flex flex-col flex-1 text-right">
                                            <span className="text-[10px] font-bold text-gray-500 uppercase">
                                              Teslim Alan
                                            </span>
                                            <span className="text-sm font-bold text-gray-900 truncate">
                                              Bekleniyor...
                                            </span>
                                            <span className="text-[11px] text-gray-500 font-medium truncate">
                                              {group.targetCampus}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* CİHAZ LİSTESİ */}
                                      <div className="flex flex-wrap gap-2 mb-4">
                                        {group.items.map((hw) => (
                                          <button
                                            key={hw.id}
                                            onClick={() =>
                                              setViewingHardwareId(hw.id)
                                            }
                                            className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-[#0066b1] hover:bg-blue-50 transition-colors px-2.5 py-1.5 rounded-md shadow-sm text-left max-w-full shrink-0"
                                          >
                                            <Laptop className="w-3.5 h-3.5 text-[#0066b1] shrink-0" />
                                            <span className="font-bold text-gray-800 text-xs truncate">
                                              {hw.brand} {hw.model}
                                            </span>
                                            <span className="text-gray-300">
                                              |
                                            </span>
                                            <span className="text-[10px] text-gray-500 font-medium truncate">
                                              S/N: {hw.serial}
                                            </span>
                                          </button>
                                        ))}
                                      </div>

                                      {/* ALT BİLGİ VE BUTONLAR (İPTAL ET DAHİL) */}
                                      <div className="pt-3 border-t border-gray-100 text-[11px] text-gray-500 font-bold flex flex-col sm:flex-row items-center justify-between gap-3">
                                        <span className="flex items-center gap-1.5 self-start sm:self-center">
                                          <History className="w-4 h-4 text-gray-400" />{' '}
                                          İşlem Zamanı:{' '}
                                          <span className="text-gray-800">
                                          {formatTransferDateTime(sentDate)}
                                          </span>
                                        </span>
                                        
                                        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                          {/* İPTAL ET BUTONU */}
                                          <button
                                            onClick={() => handleCancelTransfer(group.items, currentUser.campus)}
                                            className="text-red-500 hover:text-white bg-red-50 hover:bg-red-500 px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors border border-red-200 shadow-sm"
                                            title="Transferi İptal Et ve Geri Çek"
                                          >
                                            <X className="w-3.5 h-3.5" /> <span className="text-[10px] font-bold">İptal Et</span>
                                          </button>

                                          {/* PDF AÇ BUTONU */}
                                          {group.outLink && (
                                            <button
                                              onClick={() =>
                                                handlePdfClick(
                                                  group.outLink,
                                                  'Transfer Tutanak Belgesi'
                                                )
                                              }
                                              className="text-[#0066b1] hover:text-white bg-blue-50 hover:bg-[#0066b1] px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors border border-blue-200 shadow-sm"
                                              title="PDF Görüntüle"
                                            >
                                              <FileText className="w-3.5 h-3.5" />{' '}
                                              <span className="text-[10px] font-bold">
                                                PDF Aç
                                              </span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            )}
                          </div>
                        )}

                        {/* YENİ: ULTRA KOMPAKT TAMAMLANANLAR LİSTESİ (TEK SATIR) */}
                        {transferViewTab === 'completed' && (
                          <div className="space-y-2 animate-in fade-in duration-200">
                            {filteredCompleted.length === 0 ? (
                              <div className="py-12 flex flex-col items-center justify-center text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <Search className="w-10 h-10 text-gray-300 mb-3" />
                                <p className="text-gray-500 text-sm font-medium">
                                  Bu kriterlere uygun tamamlanmış işlem bulunamadı.
                                </p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {filteredCompleted.map((key) => {
                                  const group = myCompletedTransfers[key];

                                  const sName = group.senderName.includes('@') 
                                      ? group.senderName.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase()) 
                                      : group.senderName;
                                  
                                  const rName = group.receiverName.includes('@') 
                                      ? group.receiverName.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase()) 
                                      : group.receiverName;

                                  const dateTimeParts = group.date ? group.date.split(' ') : ['-'];
                                  const dateOnly = dateTimeParts[0];
                                  const timeOnly = dateTimeParts[1] || '';
                                  const itemCount = group.items.length;
                                  const firstItem = group.items[0];
                                  const isExpanded = !!expandedCompletedTransfers[key];
                                  const visibleItems = isExpanded ? group.items : (firstItem ? [firstItem] : []);
                                  const extraCount = Math.max(itemCount - 1, 0);

                                  return (
                                    <div
                                      key={key}
                                      className="bg-white rounded-lg shadow-sm border border-gray-200 border-l-[3px] border-l-green-500 px-3 py-2.5 flex flex-col transition-all hover:bg-gray-50"
                                    >
                                      {/* ÜST SATIR: İsimler, Ok İşareti, Kampüsler VE SAĞ ÜSTTE TARİH */}
                                      <div className="flex items-start w-full gap-1.5 sm:gap-2.5">
                                        <div className="min-w-0 flex-1 flex flex-col md:flex-row md:items-start gap-2.5">
                                        
                                        {/* Rota ve İsimler */}
                                        <div
                                          onClick={() =>
                                            setExpandedCompletedTransfers((prev) => ({
                                              ...prev,
                                              [key]: !prev[key],
                                            }))
                                          }
                                          className="flex items-start gap-1.5 sm:gap-2.5 min-w-0 cursor-pointer md:w-[235px] lg:w-[280px] md:shrink-0"
                                        >
                                          <ChevronRight
                                            className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${
                                              isExpanded ? 'rotate-90' : ''
                                            }`}
                                          />
                                          <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-1 text-[11px] sm:text-[13px] font-black text-gray-900 truncate leading-tight">
                                              <span className="truncate" title={group.senderCampus}>{group.senderCampus}</span>
                                              <span className="text-gray-400 font-normal">→</span>
                                              <span className="truncate" title={group.targetCampus}>{group.targetCampus}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-[9px] sm:text-[11px] font-semibold text-gray-500 truncate mt-0.5">
                                              <span className="truncate" title={sName}>{sName}</span>
                                              <span className="text-gray-300">→</span>
                                              <span className="truncate" title={rName}>{rName}</span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* SAĞ ÜST: Tarih ve Saat */}
                                        <div className="pl-6 md:pl-0 -mt-0.5 md:mt-0 md:pt-0.5 flex flex-wrap items-center gap-1.5 min-w-0 md:flex-1">
                                          {visibleItems.map((hw) => {
                                            const bStr = hw.brand || '';
                                            const mStr = hw.model || '';
                                            const cModel = mStr.toLowerCase().startsWith(bStr.toLowerCase()) ? mStr.substring(bStr.length).trim() : mStr;
                                            const chipLabel = `${bStr} ${cModel}`.trim() || hw.serial || 'Cihaz';

                                            return (
                                              <button
                                                key={hw.id}
                                                type="button"
                                                onClick={() => setViewingHardwareId(hw.id)}
                                                title={`${chipLabel}${hw.serial ? ` | S/N: ${hw.serial}` : ''}`}
                                                className="group inline-flex h-8 items-center gap-1.5 bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden px-2.5 py-1.5 text-left shrink-0 max-w-[150px] md:max-w-[230px] text-[11px] font-bold text-slate-700 hover:bg-blue-50 hover:text-[#0066b1] hover:border-blue-200 transition-colors"
                                              >
                                                <Laptop className="w-3.5 h-3.5 opacity-60 group-hover:text-[#0066b1] transition-colors shrink-0" />
                                                <span className="truncate">{chipLabel}</span>
                                              </button>
                                            );
                                          })}
                                          {!isExpanded && extraCount > 0 && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedCompletedTransfers((prev) => ({
                                                  ...prev,
                                                  [key]: true,
                                                }))
                                              }
                                              className="inline-flex h-8 items-center px-2.5 rounded-md bg-slate-50 text-slate-600 text-[11px] font-black border border-slate-200 shadow-sm hover:bg-slate-100 transition-colors"
                                            >
                                              +{extraCount} cihaz
                                            </button>
                                          )}
                                        </div>

                                        </div>

                                        <div className="flex flex-row-reverse items-center text-right shrink-0 gap-1.5 sm:gap-2">
                                          <div className="flex flex-col leading-tight">
                                            <span className="text-[9px] sm:text-[11px] font-black text-gray-700 whitespace-nowrap">{dateOnly}</span>
                                            <span className="text-[9px] sm:text-[10px] text-gray-500 font-semibold whitespace-nowrap">{timeOnly}</span>
                                          </div>
                                          <div className="flex items-center justify-end gap-1">
                                            {group.outLink ? (
                                              <button
                                                onClick={() => handlePdfClick(group.outLink, 'Gönderim Belgesi')}
                                                className="flex items-center justify-center w-7 h-7 bg-blue-50 text-[#0066b1] border border-blue-200 hover:bg-[#0066b1] hover:text-white rounded-lg transition-colors shadow-sm"
                                                title="Çıkış Tutanak PDF'i"
                                              >
                                                <FileText className="w-3.5 h-3.5" />
                                              </button>
                                            ) : (
                                              <span className="px-1.5 py-1 bg-gray-50 text-gray-400 border border-gray-100 rounded text-[9px] font-bold">PDF Yok</span>
                                            )}

                                            {group.inLink && (
                                              <button
                                                onClick={() => handlePdfClick(group.inLink, 'Teslim Alma Belgesi')}
                                                className="flex items-center justify-center w-7 h-7 bg-green-50 text-green-600 border border-green-200 hover:bg-green-600 hover:text-white rounded-lg transition-colors shadow-sm"
                                                title="Giriş Tutanak PDF'i"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        
                                      </div>

                                      {/* ALT SATIR: Cihaz Bilgisi VE PDF Butonları */}
                                      <div className="hidden">
                                        
                                        {/* Cihazlar (Rozet) */}
                                        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
                                          {visibleItems.map((hw) => {
                                            const bStr = hw.brand || '';
                                            const mStr = hw.model || '';
                                            const cModel = mStr.toLowerCase().startsWith(bStr.toLowerCase()) ? mStr.substring(bStr.length).trim() : mStr;
                                            const chipLabel = `${bStr} ${cModel}`.trim() || hw.serial || 'Cihaz';
                                            
                                            return (
                                              <button
                                                key={hw.id}
                                                type="button"
                                                onClick={() => setViewingHardwareId(hw.id)}
                                                title={`${chipLabel}${hw.serial ? ` | S/N: ${hw.serial}` : ''}`}
                                                className="group inline-flex h-8 items-center gap-1.5 bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden px-2.5 py-1.5 text-left shrink-0 max-w-[150px] md:max-w-[230px] text-[11px] font-bold text-slate-700 hover:bg-blue-50 hover:text-[#0066b1] hover:border-blue-200 transition-colors"
                                              >
                                                <Laptop className="w-3.5 h-3.5 opacity-60 group-hover:text-[#0066b1] transition-colors shrink-0" />
                                                <span className="truncate">{chipLabel}</span>
                                              </button>
                                            );
                                          })}
                                          {!isExpanded && extraCount > 0 && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedCompletedTransfers((prev) => ({
                                                  ...prev,
                                                  [key]: true,
                                                }))
                                              }
                                              className="inline-flex h-8 items-center px-2.5 rounded-md bg-slate-50 text-slate-600 text-[11px] font-black border border-slate-200 shadow-sm hover:bg-slate-100 transition-colors"
                                            >
                                              +{extraCount} cihaz
                                            </button>
                                          )}
                                        </div>

                                        {/* PDF İkon Butonları */}
                                        <div className="hidden">
                                          {group.outLink ? (
                                            <button
                                              onClick={() => handlePdfClick(group.outLink, 'Gönderim Belgesi')}
                                              className="flex items-center justify-center p-1.5 bg-blue-50 text-[#0066b1] border border-blue-200 hover:bg-[#0066b1] hover:text-white rounded transition-colors shadow-sm"
                                              title="Çıkış (Gönderim) Tutanak PDF'i"
                                            >
                                              <FileText className="w-4 h-4" />
                                            </button>
                                          ) : (
                                            <span className="px-2 py-1 bg-gray-50 text-gray-400 border border-gray-100 rounded text-[10px] font-medium">PDF Yok</span>
                                          )}

                                          {group.inLink && (
                                            <button
                                              onClick={() => handlePdfClick(group.inLink, 'Teslim Alma Belgesi')}
                                              className="flex items-center justify-center p-1.5 bg-green-50 text-green-600 border border-green-200 hover:bg-green-600 hover:text-white rounded transition-colors shadow-sm"
                                              title="Giriş (Teslim Alma) Tutanak PDF'i"
                                            >
                                              <CheckCircle2 className="w-4 h-4" />
                                            </button>
                                          )}
                                        </div>

                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* YENİ TRANSFER MODAL UI EKLENTİSİ */}
                {showNewTransferModal && (
                  <div
                    className="app-modal-backdrop fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6"
                    style={{ zIndex: 9999999 }}
                  >
                    <div className="app-modal-panel bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
                      {/* Üst Kısım */}
                      <div className="p-4 border-b bg-[#0066b1] text-white flex justify-between items-center shrink-0">
                        <h3 className="font-bold flex items-center gap-2 text-base md:text-lg">
                          <Send className="w-5 h-5" /> Yeni Kampüs Transferi
                        </h3>
                        <button
                          onClick={() => setShowNewTransferModal(false)}
                          className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 transition-colors p-1.5 rounded-full"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="flex flex-col flex-1 overflow-hidden p-4 md:p-5 bg-gray-50">
                        {/* 1. Hedef Kampüs Seçimi */}
                        <div className="mb-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200 shrink-0">
                          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">
                            Hedef Kampüs
                          </label>
                          <select
                            value={newTransferTarget}
                            onChange={(e) =>
                              setNewTransferTarget(e.target.value)
                            }
                            className="w-full p-2.5 text-sm font-bold text-gray-700 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-[#0066b1] shadow-sm"
                          >
                            <option value="">-- Kampüs Seçin --</option>
                            {Object.keys(CAMPUS_CODES)
                              .filter((c) => c !== currentUser.campus)
                              .sort((a, b) => a.localeCompare(b, 'tr'))
                              .map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                          </select>
                        </div>

                        {/* 2. Cihaz Seçimi */}
                        <div className="flex-1 flex flex-col min-h-[350px] md:min-h-[450px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                          <div className="p-3 border-b border-gray-100 flex items-center justify-between bg-gray-50 shrink-0">
                            <span className="text-[11px] font-bold text-gray-500 uppercase">
                              Gönderilecek Cihazlar (Depoda)
                            </span>
                            <span className="text-[11px] font-bold bg-[#0066b1] text-white px-2 py-0.5 rounded-md shadow-sm">
                              {newTransferSelected.length} Seçili
                            </span>
                          </div>

                          <div className="p-3 shrink-0 border-b border-gray-100 flex gap-2">
                            {/* YENİ: GRUP İLE HIZLI SEÇİM (BÜYÜK/KÜÇÜK HARF HATASI DÜZELTİLDİ) */}
                            {Array.from(new Set(hardware.filter(h => getCoreCampusName(h.campus) === myCoreCampus && h.status === 'Available').map(h => h.groupName).filter(Boolean))).length > 0 && (
                              <select
                                onChange={(e) => {
                                  const selectedGrp = e.target.value;
                                  if (!selectedGrp) return;
                                  
                                  const groupItemIds = hardware
                                    .filter(h => getCoreCampusName(h.campus) === myCoreCampus && h.status === 'Available' && h.groupName === selectedGrp)
                                    .map(h => h.id);
                                    
                                  setNewTransferSelected(prev => {
                                    const safePrev = Array.isArray(prev) ? prev : [];
                                    return Array.from(new Set([...safePrev, ...groupItemIds]));
                                  });
                                  
                                  e.target.selectedIndex = 0; 
                                }}
                                className="w-[120px] px-2 py-2 border border-blue-200 bg-blue-50 text-[#0066b1] font-bold rounded-lg outline-none cursor-pointer text-[11px] shadow-sm"
                              >
                                <option value="">Grup Ekle</option>
                                {Array.from(new Set(hardware.filter(h => getCoreCampusName(h.campus) === myCoreCampus && h.status === 'Available').map(h => h.groupName).filter(Boolean))).map(g => (
                                  <option key={g} value={g}>{g}</option>
                                ))}
                              </select>
                            )}

                            <div className="flex items-center w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-[#0066b1] focus-within:border-[#0066b1] transition-all shadow-inner">
                              <Search className="w-4 h-4 text-gray-400 mr-2 shrink-0" />
                              <input
                                type="text"
                                placeholder="Cihaz marka, model veya S/N ara..."
                                value={newTransferSearch}
                                onChange={(e) =>
                                  setNewTransferSearch(e.target.value)
                                }
                                className="flex-1 bg-transparent outline-none text-sm min-w-0"
                              />
                            </div>
                          </div>

                          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                            {(() => {
                              // BÜYÜK/KÜÇÜK HARF KORUMASI EKLENDİ
                              const availables = hardware.filter(
                                (h) =>
                                  getCoreCampusName(h.campus) === myCoreCampus &&
                                  h.status === 'Available'
                              );
                              const searchTerms = toTrLower(newTransferSearch)
                                .split(/\s+/)
                                .filter(Boolean);
                              const filtered = availables.filter((h) => {
                                const combined = toTrLower(
                                  `${h.brand} ${h.model} ${h.serial}`
                                );
                                return (
                                  searchTerms.length === 0 ||
                                  searchTerms.every((term) =>
                                    combined.includes(term)
                                  )
                                );
                              });

                              if (filtered.length === 0)
                                return (
                                  <div className="text-center p-8 text-gray-400 text-sm font-medium border border-dashed border-gray-200 m-2 rounded-xl">
                                    Kriterlere uygun cihaz bulunamadı.
                                  </div>
                                );

                              return filtered.map((h) => {
                                // APPLE APPLE MACBOOK PRO tekrarını çözen temizleme
                                const bStr = h.brand || '';
                                const mStr = h.model || '';
                                const cModel = mStr
                                  .toLowerCase()
                                  .startsWith(bStr.toLowerCase())
                                  ? mStr.substring(bStr.length).trim()
                                  : mStr;

                                return (
                                  <label
                                    key={h.id}
                                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all group ${
                                      newTransferSelected.includes(h.id)
                                        ? 'bg-blue-50/50 border-[#0066b1] shadow-sm'
                                        : 'hover:bg-slate-50 border-gray-100'
                                    }`}
                                  >
                                    <div className="pt-0.5 shrink-0">
                                      <input
                                        type="checkbox"
                                        checked={newTransferSelected.includes(
                                          h.id
                                        )}
                                        onChange={(e) => {
                                          if (e.target.checked)
                                            setNewTransferSelected([
                                              ...newTransferSelected,
                                              h.id,
                                            ]);
                                          else
                                            setNewTransferSelected(
                                              newTransferSelected.filter(
                                                (id) => id !== h.id
                                              )
                                            );
                                        }}
                                        className="w-4 h-4 text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1] cursor-pointer transition-colors"
                                      />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="font-bold text-[13px] md:text-sm text-gray-800 truncate group-hover:text-[#0066b1] transition-colors">
                                        {bStr} {cModel}
                                      </div>
                                      <div className="text-[11px] text-gray-500 font-medium mt-1 truncate">
                                        <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider mr-2">
                                          {h.type}
                                        </span>
                                        S/N: {h.serial}
                                      </div>
                                    </div>
                                  </label>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </div>

                      {/* Alt Butonlar */}
                      <div className="p-4 bg-white border-t border-gray-100 flex justify-end gap-2.5 shrink-0">
                        <button
                          onClick={() => setShowNewTransferModal(false)}
                          className="px-5 py-2.5 bg-white border border-gray-300 text-gray-600 font-bold rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          İptal
                        </button>
                        <button
                          onClick={() => {
                            const selectedItems = hardware.filter((h) =>
                              newTransferSelected.includes(h.id)
                            );
                            setTransferModalObj({
                              type: 'out',
                              items: selectedItems,
                              targetCampus: newTransferTarget,
                              senderCampus: currentUser.campus,
                            });
                            setShowNewTransferModal(false);
                            setNewTransferSelected([]);
                            setNewTransferTarget('');
                          }}
                          disabled={
                            newTransferSelected.length === 0 ||
                            !newTransferTarget
                          }
                          className="px-5 py-2.5 bg-[#0066b1] text-white font-bold rounded-lg shadow-md hover:bg-[#005595] disabled:opacity-50 disabled:shadow-none transition-all flex items-center gap-2"
                        >
                          <Send className="w-4 h-4" /> Transferi Başlat
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ASSIGNMENT TAB (AKORDEON VE TEK SCROLL SISTEMI) */}
            {activeTab === 'assign' && (
              <div className="app-tab-panel max-w-3xl mx-auto space-y-4 pb-32">
                {/* 1. ADIM: PERSONEL SEÇİMİ AKORDEONU */}
                <div
                  className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${
                    assignStep === 1
                      ? 'border-[#0066b1] ring-1 ring-[#0066b1]/30'
                      : 'border-gray-200'
                  }`}
                >
                  {/* Akordeon Basligi (Tiklanabilir) */}
                  <div
                    className="p-4 md:p-5 flex justify-between items-center cursor-pointer bg-gray-50/50 hover:bg-gray-50 transition-colors"
                    onClick={() => setAssignStep(1)}
                  >
                    {assignStep === 1 ? (
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-[#0066b1] text-white shadow-md shrink-0">
                          1
                        </span>
                        <h2 className="text-base md:text-lg font-bold text-[#0066b1]">
                          Personel Seçimi
                        </h2>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <CheckCircle2
                          size={28}
                          color="#059669"
                          className="shrink-0"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                            Seçilen Personel
                          </span>
                          <span className="text-sm font-bold text-gray-800">
                            {selectedPerson
                              ? personnelById.get(selectedPerson)?.name
                              : 'Seçilmedi'}
                          </span>
                        </div>
                      </div>
                    )}

                    {assignStep !== 1 && selectedPerson && (
                      <span className="text-xs font-bold text-[#0066b1] hover:underline px-2 py-1 shrink-0">
                        Değiştir
                      </span>
                    )}
                  </div>

                  {/* Akordeon İçeriği */}
                  {assignStep === 1 && (
                    <div className="p-4 md:p-6 pt-2 border-t border-gray-100 animate-in slide-in-from-top-2">
                      <div className="flex items-center w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#8bcdc5] focus-within:border-[#0066b1] transition-all mb-4">
                        <input
                          type="text"
                          placeholder="Ad, e-posta veya 11 haneli T.C. ile ara..."
                          className="flex-1 bg-transparent outline-none min-w-0 text-sm"
                          value={personSearch}
                          onChange={(e) => setPersonSearch(e.target.value)}
                        />
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          {personSearch && (
                            <button
                              onClick={() => setPersonSearch('')}
                              className="p-1 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          <Search className="w-4 h-4 text-gray-400" />
                        </div>
                      </div>

                      <div className="space-y-3">
                        {(() => {
                          const trimmedSearch = personSearch.trim();
                          const isNumericSearch = /^\d+$/.test(trimmedSearch);
                          const isExactNationalIdSearch = /^\d{11}$/.test(trimmedSearch);
                          const normalizedSearch = toTrLower(trimmedSearch);
                          const filtered = isExactNationalIdSearch
                            ? nationalIdLookupPerson
                              ? [nationalIdLookupPerson]
                              : []
                            : isNumericSearch
                              ? []
                              : campusPersonnel.filter((p) =>
                                  [p.name, p.email, p.department].some((value) =>
                                    toTrLower(value || '').includes(normalizedSearch)
                                  )
                                );
                          const displayList = filtered.slice(0, 30);
                          return (
                            <>
                              {isExactNationalIdSearch && isNationalIdLookupLoading && (
                                <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-semibold text-[#0066b1]">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Personel güvenli şekilde aranıyor...
                                </div>
                              )}
                              {isNumericSearch && !isExactNationalIdSearch && (
                                <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500">
                                  T.C. kimlik numarasını 11 hane olarak girin.
                                </div>
                              )}
                              {isExactNationalIdSearch && !isNationalIdLookupLoading && nationalIdLookupError && (
                                <div className="rounded-lg border border-dashed border-amber-200 bg-amber-50 p-4 text-center text-sm font-semibold text-amber-800">
                                  {nationalIdLookupError}
                                </div>
                              )}
                              {displayList.map((p) => (
                                <label
                                  key={p.id}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSelectedPerson(p.id);
                                    setPersonSearch('');
                                    setNationalIdLookupPerson(null);
                                    setNationalIdLookupError('');
                                    setTimeout(() => setAssignStep(2), 150);
                                  }}
                                  className={`flex items-start gap-3 md:gap-4 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                                    selectedPerson === p.id
                                      ? 'bg-blue-50/50 border-[#0066b1] shadow-sm'
                                      : 'hover:border-[#8bcdc5]/50 border-gray-100 bg-white'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="person"
                                    className="hidden"
                                    checked={selectedPerson === p.id}
                                    readOnly
                                  />

                                  <div className="flex-1 min-w-0 flex flex-col">
                                    <div className="flex justify-between items-start gap-2 w-full">
                                      <p
                                        className={`font-bold text-sm md:text-base truncate pr-2 ${
                                          selectedPerson === p.id
                                            ? 'text-[#0066b1]'
                                            : 'text-gray-800'
                                        }`}
                                      >
                                        {p.name}
                                      </p>
                                      {isHQ && (
                                        <div className="shrink-0 mt-0.5">
                                          <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider text-gray-500 bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                                            {p.campus}
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    {p.department &&
                                      p.department !== 'Personel' && (
                                        <div className="mt-1.5">
                                          <span
                                            className={`inline-block text-[11px] md:text-xs font-bold px-2 py-1 rounded-md transition-colors ${
                                              selectedPerson === p.id
                                                ? 'text-white bg-[#0066b1]'
                                                : 'text-[#0066b1] bg-blue-50 border border-blue-100'
                                            }`}
                                          >
                                            {p.department}
                                          </span>
                                        </div>
                                      )}
                                  </div>
                                </label>
                              ))}
                              {filtered.length === 0 &&
                                !isNumericSearch &&
                                !isNationalIdLookupLoading && (
                                <div className="text-center p-4 text-sm text-gray-500 border border-dashed rounded-lg">
                                  Personel bulunamadı.
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. ADIM: Donanım SEÇİMİ AKORDEONU */}
                <div
                  className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${
                    assignStep === 2
                      ? 'border-[#0066b1] ring-1 ring-[#0066b1]/30'
                      : 'border-gray-200'
                  }`}
                >
                  <div
                    className={`p-4 md:p-5 flex justify-between items-center transition-colors ${
                      selectedPerson
                        ? 'cursor-pointer bg-gray-50/50 hover:bg-gray-50'
                        : 'opacity-60 bg-gray-100 cursor-not-allowed'
                    }`}
                    onClick={() => selectedPerson && setAssignStep(2)}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                          assignStep === 2
                            ? 'bg-[#0066b1] text-white shadow-md'
                            : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        2
                      </span>
                      <h2
                        className={`text-base md:text-lg font-bold transition-colors ${
                          assignStep === 2 ? 'text-[#0066b1]' : 'text-gray-700'
                        }`}
                      >
                        Verilecek Donanımlar
                      </h2>
                    </div>
                    {assignStep !== 2 && selectedHardware.length > 0 && (
                      <div className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold shrink-0">
                        {selectedHardware.length} Cihaz Seçili
                      </div>
                    )}
                  </div>

                  {assignStep === 2 && (
                    <div className="p-4 md:p-6 pt-2 border-t border-gray-100 animate-in slide-in-from-top-2 relative">
                      <div className="responsive-tab-toolbar">
                      <div className="responsive-tab-toolbar__primary flex items-center gap-2 w-full relative z-10">
                        <div className="responsive-tab-toolbar__search flex items-center flex-1 min-w-0 h-10 px-4 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#8bcdc5] focus-within:border-[#0066b1] transition-all">
                          <input
                            type="text"
                            placeholder="Cihaz ara (Marka, model, seri no)..."
                            className="flex-1 bg-transparent outline-none min-w-0 text-sm"
                            value={assignSearchQuery}
                            onChange={(e) =>
                              setAssignSearchQuery(e.target.value)
                            }
                          />
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            {assignSearchQuery && (
                              <button
                                onClick={() => setAssignSearchQuery('')}
                                className="p-1 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                            <Search className="w-4 h-4 text-gray-400" />
                          </div>
                        </div>

                        {Array.from(new Set(availableHardwareForAssign.map(h => h.groupName).filter(Boolean))).length > 0 && (
                          <div className="responsive-tab-toolbar__action responsive-tab-toolbar__actions-start relative shrink-0 hidden sm:block">
                            <select
                              onChange={(e) => {
                                const selectedGrp = e.target.value;
                                if (!selectedGrp) return;
                                
                                const groupItemIds = availableHardwareForAssign
                                  .filter(h => h.groupName === selectedGrp)
                                  .map(h => h.id);
                                  
                                setSelectedHardware(prev => {
                                  const safePrev = Array.isArray(prev) ? prev : [];
                                  return Array.from(new Set([...safePrev, ...groupItemIds]));
                                });
                                
                                e.target.selectedIndex = 0;
                              }}
                              className="h-11 px-3 border border-blue-200 bg-blue-50 text-[#0066b1] font-bold rounded-xl outline-none focus:ring-2 focus:ring-[#0066b1] cursor-pointer text-xs shadow-sm"
                            >
                              <option value="">Grup ile Seç...</option>
                              {Array.from(new Set(availableHardwareForAssign.map(h => h.groupName).filter(Boolean))).map(g => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <button
                          onClick={() =>
                            setShowAssignFilters(!showAssignFilters)
                          }
                          className={`responsive-tab-toolbar__mobile-filter w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                            showAssignFilters
                              ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          <Filter className="w-4 h-4" />
                        </button>
                      </div>

                      {/* ZİMMET AÇILIR FİLTRE MENÜLERİ */}
                      <div
                        className={`responsive-tab-toolbar__filters relative mt-3 mb-0 z-[50] ${
                          showAssignFilters
                            ? 'block animate-in slide-in-from-top-1 fade-in duration-200'
                            : 'hidden'
                        }`}
                      >
                        <style>{`.hide-scroll-bar::-webkit-scrollbar { display: none; } .hide-scroll-bar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
                        <div className="flex items-center gap-2 pb-1 overflow-x-auto hide-scroll-bar w-full">
                          <button
                            onClick={() =>
                              setActiveAssignFilterDropdown(
                                activeAssignFilterDropdown === 'status'
                                  ? null
                                  : 'status'
                              )
                            }
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border shadow-sm shrink-0 ${
                              assignFilterStatus !== 'All'
                                ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                : 'bg-white border-gray-300 text-gray-700'
                            }`}
                          >
                            Durum: {assignFilterStatus === 'All' ? 'Tümü' : assignFilterStatus} <ChevronDown className="w-3 h-3 opacity-70" />
                          </button>

                          <button
                            onClick={() =>
                              setActiveAssignFilterDropdown(
                                activeAssignFilterDropdown === 'type'
                                  ? null
                                  : 'type'
                              )
                            }
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border shadow-sm shrink-0 ${
                              assignFilterType !== 'All'
                                ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                : 'bg-white border-gray-300 text-gray-700'
                            }`}
                          >
                            Tip: {assignFilterType === 'All' ? 'Tümü' : assignFilterType} <ChevronDown className="w-3 h-3 opacity-70" />
                          </button>

                          {isHQ && (
                            <button
                              onClick={() =>
                                setActiveAssignFilterDropdown(
                                  activeAssignFilterDropdown === 'campus'
                                    ? null
                                    : 'campus'
                                )
                              }
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border shadow-sm shrink-0 ${
                                assignFilterCampus !== 'All'
                                  ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                  : 'bg-white border-gray-300 text-gray-700'
                              }`}
                            >
                              Kampüs: {assignFilterCampus === 'All' ? 'Tümü' : (assignFilterCampus.length > 12 ? assignFilterCampus.substring(0, 12) + '...' : assignFilterCampus)} <ChevronDown className="w-3 h-3 opacity-70" />
                            </button>
                          )}

                          {(assignFilterStatus !== 'All' ||
                            assignFilterType !== 'All' ||
                            assignFilterCampus !== 'All') && (
                            <button
                              onClick={() => {
                                setAssignFilterStatus('All');
                                setAssignFilterType('All');
                                setAssignFilterCampus('All');
                                setActiveAssignFilterDropdown(null);
                              }}
                              className="flex items-center gap-1 text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-full shrink-0"
                            >
                              <X className="w-3.5 h-3.5" /> Temizle
                            </button>
                          )}
                        </div>

                        {/* ZİMMET FİLTRESİ KESİLMEZ AÇILIR MENÜSÜ (FIXED OVERLAY) */}
                        {activeAssignFilterDropdown && (
                          <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-end sm:justify-center p-4 pb-8 sm:p-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
                            
                            {/* Kapatma Alani (Bosluga tiklayinca kapanir) */}
                            <div className="absolute inset-0" onClick={() => setActiveAssignFilterDropdown(null)}></div>
                            
                            {/* Kutu İçeriği */}
                            <div className="relative bg-white w-full sm:w-[320px] rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300">
                              
                              <div className="bg-slate-50 border-b border-gray-100 px-4 py-3 flex justify-between items-center">
                                <span className="font-black text-[13px] text-gray-800 uppercase tracking-wide">
                                  {activeAssignFilterDropdown === 'status' ? 'Durum Seçin' : activeAssignFilterDropdown === 'type' ? 'Cihaz Tipi Seçin' : 'Kampüs Seçin'}
                                </span>
                                <button onClick={() => setActiveAssignFilterDropdown(null)} className="p-1.5 bg-gray-200 text-gray-600 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>

                              <div className="max-h-[60vh] overflow-y-auto p-2 hide-scroll-bar">
                                {activeAssignFilterDropdown === 'status' && (
                                  <div className="flex flex-col gap-1">
                                    {['All', 'Zimmetli', 'Depoda'].map((st) => (
                                      <button key={st} onClick={() => { setAssignFilterStatus(st); setActiveAssignFilterDropdown(null); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${assignFilterStatus === st ? 'font-bold text-[#0066b1] bg-blue-50/80 border border-blue-200' : 'text-gray-700 hover:bg-gray-100 font-medium'}`}>
                                        {st === 'All' ? 'Tümü' : st}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                
                                {activeAssignFilterDropdown === 'type' && (
                                  <div className="flex flex-col gap-1">
                                    {['All', 'Laptop', 'Masaüstü (PC)', 'Tablet', 'Monitör', 'Klavye ve Mouse Seti', 'Mouse', 'Klavye', 'Webcam', 'Hard Drive', 'Diğer'].map((t) => (
                                      <button key={t} onClick={() => { setAssignFilterType(t); setActiveAssignFilterDropdown(null); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${assignFilterType === t ? 'font-bold text-[#0066b1] bg-blue-50/80 border border-blue-200' : 'text-gray-700 hover:bg-gray-100 font-medium'}`}>
                                        {t === 'All' ? 'Tüm Tipler' : t}
                                      </button>
                                    ))}
                                  </div>
                                )}
                                
                                {activeAssignFilterDropdown === 'campus' && isHQ && (
                                  <div className="flex flex-col gap-1">
                                    <button onClick={() => { setAssignFilterCampus('All'); setActiveAssignFilterDropdown(null); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${assignFilterCampus === 'All' ? 'font-bold text-[#0066b1] bg-blue-50/80 border border-blue-200' : 'text-gray-700 hover:bg-gray-100 font-medium'}`}>
                                      Tüm Kampüsler
                                    </button>
                                    {Object.keys(CAMPUS_CODES).sort((a, b) => a.localeCompare(b, 'tr')).map((c) => (
                                      <button key={c} onClick={() => { setAssignFilterCampus(c); setActiveAssignFilterDropdown(null); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm transition-all ${assignFilterCampus === c ? 'font-bold text-[#0066b1] bg-blue-50/80 border border-blue-200' : 'text-gray-700 hover:bg-gray-100 font-medium'}`}>
                                        {c}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      </div>

                      {/* SEÇİLEN CİHAZLAR SEPETİ */}
                      {selectedHardware.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100/50 shadow-inner">
                          <span className="w-full text-[10px] font-bold text-[#0066b1] uppercase tracking-wider mb-1 ml-1 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Seçilen Cihazlar Sepeti ({selectedHardware.length})
                          </span>
                          
                          {selectedHardware.map(id => {
                            const hwItem = hardwareById.get(id);
                            if(!hwItem) return null;
                            
                            const bStr = String(hwItem.brand || '');
                            const mStr = String(hwItem.model || '');
                            const cModel = mStr.toLowerCase().startsWith(bStr.toLowerCase()) ? mStr.substring(bStr.length).trim() : mStr;

                            return (
                              <div key={`sel-${hwItem.id}`} className="flex items-center bg-white border border-blue-200 shadow-sm rounded-lg pr-1 pl-2.5 py-1.5 group transition-colors hover:border-[#0066b1] animate-in zoom-in-95 duration-200">
                                <span className="text-xs font-bold text-gray-800 mr-2 truncate max-w-[120px] sm:max-w-[200px]">
                                  {bStr} {cModel}
                                </span>
                                <span className="text-[10px] text-gray-400 font-medium mr-2 hidden sm:inline-block">S/N: {hwItem.serial}</span>
                                
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedHardware(prev => prev.filter(pId => pId !== hwItem.id));
                                  }}
                                  className="w-5 h-5 flex items-center justify-center rounded bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                                  title="Listeden Çıkar"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                          
                          {selectedHardware.length > 1 && (
                            <button 
                              onClick={() => setSelectedHardware([])}
                              className="text-[10px] font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors ml-auto border border-transparent hover:border-red-100"
                            >
                              Tümünü Temizle
                            </button>
                          )}
                        </div>
                      )}

                      {/* YENİ: AKSESUAR SEÇİMİ (SADECE LAPTOP SEÇİLİYSE GÖRÜNÜR) */}
                      {selectedHardware.some((id) => {
                        const h = hardwareById.get(id);
                        return h && String(h.type || '').toLowerCase().includes('laptop');
                      }) && (
                        <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-xl shadow-sm animate-in fade-in">
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                            <Plus className="w-3.5 h-3.5" /> Ek Aksesuarlar (Laptop İçin)
                          </p>
                          <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={includeCharger}
                                onChange={(e) => setIncludeCharger(e.target.checked)}
                                className="w-4 h-4 text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1] cursor-pointer"
                              />
                              <span className="text-sm font-bold text-gray-700">Şarj Aleti ve Kablo</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={includeBag}
                                onChange={(e) => setIncludeBag(e.target.checked)}
                                className="w-4 h-4 text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1] cursor-pointer"
                              />
                              <span className="text-sm font-bold text-gray-700">Taşıma Çantası</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={includeMouse}
                                onChange={(e) => setIncludeMouse(e.target.checked)}
                                className="w-4 h-4 text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1] cursor-pointer"
                              />
                              <span className="text-sm font-bold text-gray-700">Mouse</span>
                            </label>
                          </div>

                          {includeMouse && (
                            <div className="mt-3 animate-in slide-in-from-top-2">
                              <select
                                value={selectedMouseId}
                                onChange={(e) => setSelectedMouseId(e.target.value)}
                                className="w-full sm:w-auto p-2 text-xs font-bold text-gray-700 border border-blue-300 bg-blue-50 rounded-lg outline-none focus:ring-2 focus:ring-[#0066b1]"
                              >
                                <option value="OEM">Standart Mouse (Stoktan Düşmez, Sadece Tutanağa Ekler)</option>
                                {campusHardware
                                  .filter((h) => h.type.includes('Mouse') && h.status === 'Available')
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>
                                      Depodan: {m.brand} {m.model} (S/N: {m.serial})
                                    </option>
                                  ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Donanım LİSTESİ */}
                      <div className="space-y-3 mt-4 relative z-0">
                        {(() => {
                          const displayList = availableHardwareForAssign.slice(0, 30);
                          return (
                            <>
                              {displayList.map((h) => {
                                const isSelected = selectedHardware.includes(h.id);
                                const currentOwner = h.status === 'Assigned' ? personnelById.get(h.assignedTo)?.name : null;
                                
                                // String koruması eklendi (Çökme engellendi)
                                const brandStr = String(h.brand || '');
                                const modelStr = String(h.model || '');
                                const cleanModel = modelStr.toLowerCase().startsWith(brandStr.toLowerCase()) ? modelStr.substring(brandStr.length).trim() : modelStr;

                                return (
                                  <label
                                    key={h.id}
                                    className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition-all group ${
                                      isSelected ? 'bg-blue-50/50 border-[#0066b1] shadow-sm' : 'hover:border-[#8bcdc5]/50 border-gray-100 bg-white hover:bg-slate-50'
                                    }`}
                                  >
                                    <div className="pt-0.5 shrink-0">
                                      <input
                                        type="checkbox"
                                        className="w-5 h-5 text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1] transition-colors cursor-pointer"
                                        checked={isSelected}
                                        onChange={(e) => setSelectedHardware(e.target.checked ? [...selectedHardware, h.id] : selectedHardware.filter((id) => id !== h.id))}
                                      />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className={`font-bold text-sm md:text-base truncate pr-2 ${isSelected ? 'text-[#0066b1]' : 'text-gray-800'}`}>
                                          {brandStr} {cleanModel}
                                        </p>
                                        {h.type && <span className="shrink-0 text-[10px] uppercase tracking-wider font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{h.type}</span>}
                                      </div>
                                      <p className="text-xs text-gray-500 font-medium mt-1 mb-3">S/N: {h.serial}</p>
                                      {currentOwner && (
                                        <div className="mt-4">
                                          <span className="inline-flex items-center text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md shadow-sm">
                                            <span className="mr-1.5 text-sm">⚠️</span>
                                            <span className="truncate max-w-[200px]" title={currentOwner}>Zimmetli : {currentOwner}</span>
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </label>
                                );
                              })}
                              {availableHardwareForAssign.length === 0 && (
                                <div className="text-center p-6 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-500">
                                  Kriterlere uygun cihaz bulunamadı.
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}

            {/* HARDWARE PROFILE MODAL */}
            {viewingHardwareId && (
              <Suspense fallback={<LazyPanelFallback label="Cihaz profili hazırlanıyor..." />}>
                <HardwareProfileModal
                  deps={{
                    viewingHardwareId,
                    viewedHardware,
                    setViewingHardwareId,
                    setShowHardwareHistory,
                    setIsEditingDeviceName,
                    setEditComputerNumber,
                    setIsEditingSingleGroup,
                    setEditSingleGroupText,
                    setIsEditingNote,
                    setEditNoteText,
                    currentUser,
                    setConfirmDialog,
                    setHardware,
                    hardware,
                    fetchVeritabani,
                    clientIp,
                    handleOpenQrLabelPrint,
                    setTransferModalObj,
                    setTransferSignature,
                    setViewingPersonId,
                    setReturningData,
                    isEditingDeviceName,
                    editComputerNumber,
                    isUpdatingName,
                    handleSaveDeviceName,
                    viewedHardwarePerson,
                    isEditingSingleGroup,
                    editSingleGroupText,
                    isUpdatingSingleGroup,
                    handleSaveSingleGroup,
                    isEditingNote,
                    editNoteText,
                    isUpdatingNote,
                    handleSaveNote,
                    manualUploadFile,
                    setManualUploadFile,
                    fileInputRef,
                    handleMissingDocumentUpload,
                    isUploadingManual,
                    showManualUpload,
                    setShowManualUpload,
                    manualUploadSearch,
                    setManualUploadSearch,
                    manualUploadPerson,
                    setManualUploadPerson,
                    campusPersonnel: profileAssignmentPersonnel,
                    personnel,
                    handleManualUploadSubmit,
                    handleInitialAssignmentWithoutDocument,
                    handleOpenHistory,
                    isLoadingHistory,
                    showHardwareHistory,
                    handlePdfClick,

                    // --- EKSİK OLANLAR BURAYA EKLENDİ ---
                    isTransferMode,
                    setIsTransferMode,
                    selectedTargetCampus,
                    setSelectedTargetCampus,
                    copiedSerial,
                    setCopiedSerial,
                    successMessage,
                    setSuccessMessage,
                    isGenerating,
                    setIsGenerating
                  }}
                />
              </Suspense>
            )}

            {/* RETURN HARDWARE MODAL & PDF */}
            {returningData && (
              <Suspense fallback={<LazyPanelFallback label="İade ekranı hazırlanıyor..." />}>
                <ReturnZimmetModal
                  deps={{
                    returningData,
                    setReturningData,
                    isGenerating,
                    currentUser,
                    returnItSignature,
                    setReturnItSignature,
                    returnPersonSignature,
                    setReturnPersonSignature,
                    returnPersonOtpData,
                    setReturnPersonOtpData,
                    returnCondition,
                    setReturnCondition,
                    returnExplanation,
                    setReturnExplanation,
                    returnIncludeCharger,
                    setReturnIncludeCharger,
                    returnIncludeBag,
                    setReturnIncludeBag,
                    returnIncludeMouse,
                    setReturnIncludeMouse,
                    isReturnAccepted,
                    setIsReturnAccepted,
                    handleFinalizeReturn,

                    // --- EKSİK OLANLAR BURAYA EKLENDİ ---
                    clientIp,
                    handlePersonPhoneSaved,
                    handlePdfClick
                  }}
                />
              </Suspense>
            )}

            {showBulkHardwareImportModal && (
              <Suspense fallback={<LazyInlineFallback label="Excel içe aktarma hazırlanıyor..." />}>
                <BulkHardwareImportModal
                  currentUser={currentUser}
                  existingHardware={hardware}
                  onClose={() => setShowBulkHardwareImportModal(false)}
                  onImported={async (result) => {
                    await fetchVeritabani(false);
                    const skippedMessage = result.skipped
                      ? ` ${result.skipped} mevcut seri numarası atlandı.`
                      : '';
                    setSuccessMessage(
                      `${result.imported} donanım depoya eklendi.${skippedMessage}`
                    );
                    setTimeout(() => setSuccessMessage(null), 3500);
                  }}
                />
              </Suspense>
            )}

            {showBulkInitialAssignmentModal && (
              <Suspense fallback={<LazyInlineFallback label="Migrasyon zimmeti hazırlanıyor..." />}>
                <BulkInitialAssignmentModal
                  currentUser={currentUser}
                  existingHardware={hardware}
                  existingPersonnel={personnel}
                  onClose={() => setShowBulkInitialAssignmentModal(false)}
                  onImported={async (result) => {
                    await fetchVeritabani(false);
                    const skippedMessage = result.skipped
                      ? ` ${result.skipped} mevcut eşleşme değişmeden bırakıldı.`
                      : '';
                    setSuccessMessage(
                      `${result.assigned} cihaz personele zimmetlendi.${skippedMessage}`
                    );
                    setTimeout(() => setSuccessMessage(null), 4000);
                  }}
                />
              </Suspense>
            )}

            {/* YENİ Donanım EKLE MODAL */}
            {showAddHardwareModal && (
              <div
                className="app-modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
                style={{ zIndex: 999999 }}
              >
                <div className="app-modal-panel bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden border border-white/20">
                  <div className="flex justify-between items-center p-4 md:p-5 border-b bg-[#0066b1] text-white shrink-0">
                    <h3 className="font-bold text-base flex items-center gap-2">
                      <Plus className="w-5 h-5" /> Yeni Donanım Ekle
                    </h3>
                    <button
                      onClick={() => setShowAddHardwareModal(false)}
                      className="text-blue-100 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="p-5 md:p-6 overflow-y-auto bg-slate-50/50">
                    {/* Uyarı/Bilgi */}
                    <div className="bg-blue-50/80 border border-blue-200 text-blue-800 text-[11px] p-3 rounded-xl flex items-start gap-2 shadow-sm">
                      <Building2 className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
                      <p>
                        Bu Donanım <strong>{currentUser.campus}</strong>{' '}
                        kampüsüne{' '}
                        <span className="font-bold underline">Depoda</span>{' '}
                        statüsüyle eklenecektir.
                      </p>
                    </div>

                    {/* Form Alanlari */}
                    <div className="space-y-4 mt-8">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
                          Cihaz Tipi
                        </label>
                        <select
                          value={newHardwareForm.type}
                          onChange={(e) => {
                            const selectedType = e.target.value;

                            // SEÇİLEN TİPE AİT İLK MARKAYI VE MODELİ OTOMATİK BULUR
                            const autoBrand = TYPE_BRANDS[selectedType]
                              ? TYPE_BRANDS[selectedType][0]
                              : 'Diger';
                            const autoModel = BRANDS_MODELS[autoBrand]
                              ? BRANDS_MODELS[autoBrand][0]
                              : 'Diger';

                            setNewHardwareForm({
                              ...newHardwareForm,
                              type: selectedType,
                              brand: autoBrand,
                              model: autoModel,
                              computerNumber: '',
                            });
                          }}
                          className="w-full px-3 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#0066b1] bg-white shadow-sm transition-all"
                        >
                          <option value="Laptop">Laptop</option>
                          <option value="Masaüstü (PC)">Masaüstü (PC)</option>
                          <option value="All in One PC">All in One PC</option>
                          <option value="Tablet">Tablet</option>
                          <option value="Monitör">Monitör</option>
                          <option value="Klavye ve Mouse Seti">
                            Klavye ve Mouse Seti
                          </option>
                          <option value="Mouse">Mouse</option>
                          <option value="Klavye">Klavye</option>
                          <option value="Webcam">Webcam</option>
                          <option value="Hard Drive">Hard Drive / Disk</option>
                          <option value="Diger">Diger</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
                            Marka
                          </label>
                          <select
                            value={newHardwareForm.brand}
                            onChange={(e) => {
                              const newBrand = e.target.value;
                              setNewHardwareForm({
                                ...newHardwareForm,
                                brand: newBrand,
                                model: BRANDS_MODELS[newBrand][0], // Marka degisince modeli o markanin ilk modeli yap
                              });
                            }}
                            className="w-full px-3 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#0066b1] bg-white shadow-sm transition-all"
                          >
                            {/* BÜTÜN MARKALAR YERİNE, SADECE SEÇİLİ CİHAZ TİPİNE AİT MARKALARI LİSTELER */}
                            {(
                              TYPE_BRANDS[newHardwareForm.type] || ['Diger']
                            ).map((brand) => (
                              <option key={brand} value={brand}>
                                {brand}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
                            Model
                          </label>
                          <select
                            value={newHardwareForm.model}
                            onChange={(e) =>
                              setNewHardwareForm({
                                ...newHardwareForm,
                                model: e.target.value,
                              })
                            }
                            className="w-full px-3 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#0066b1] bg-white shadow-sm transition-all"
                          >
                            {BRANDS_MODELS[newHardwareForm.brand]?.map(
                              (model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">
                          Seri Numarası (S/N)
                        </label>
                        <input
                          type="text"
                          placeholder="Barkod veya seri numarası"
                          value={newHardwareForm.serial}
                          onChange={(e) =>
                            setNewHardwareForm({
                              ...newHardwareForm,
                              serial: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2.5 text-sm font-medium text-gray-800 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#0066b1] bg-white shadow-sm transition-all"
                        />
                      </div>

                      {/* BILGISAYAR ADI */}
                      {showComputerName && (
                        <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 shadow-sm animate-in fade-in mt-2">
                          <label className="flex items-center justify-between block text-[11px] font-bold text-[#0066b1] uppercase tracking-wide mb-3 ml-1">
                            <span>Bilgisayar İsmi Ataması</span>
                            <span className="bg-white text-gray-400 px-2 py-0.5 rounded-full border border-gray-200 text-[9px] tracking-wider shadow-sm">
                              OPSİYONEL
                            </span>
                          </label>
                          <div className="flex items-center w-full border border-gray-300 rounded-xl overflow-hidden bg-white focus-within:ring-2 focus-within:ring-[#0066b1] focus-within:border-[#0066b1] transition-all shadow-inner">
                            <span className="inline-flex items-center justify-center px-3 py-2.5 text-sm font-bold text-gray-500 bg-gray-100/80 border-r border-gray-200 select-none min-w-[80px]">
                              {computerPrefix}
                            </span>
                            <input
                                  type="text"
                                  inputMode="numeric" // YENİ
                                  pattern="[0-9]*"    // YENİ
                                  maxLength="4"
                                  placeholder="0000"
                                  value={editComputerNumber}
                                  onChange={(e) =>
                                    setEditComputerNumber(
                                      e.target.value.replace(/[^0-9]/g, '')
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !isUpdatingName) {
                                      handleSaveDeviceName(viewedHardware.id, profileComputerPrefix);
                                    }
                                  }}
                                  className="flex-1 px-3 py-2 text-sm font-bold tracking-widest text-[#0066b1] bg-transparent outline-none placeholder-gray-300"
                                />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* DAHA DOLGUN, FERAH BUTONLAR */}
                  <div className="p-4 md:p-5 bg-white border-t border-gray-100 flex justify-end gap-3 shrink-0">
                    <button
                      onClick={() => setShowAddHardwareModal(false)}
                      className="px-6 py-2.5 text-gray-600 text-sm font-bold bg-gray-100 hover:bg-gray-200 hover:text-gray-800 rounded-full transition-all"
                    >
                      İptal
                    </button>
                    <button
                      onClick={handleSaveNewHardware}
                      disabled={isAddingHardware}
                      className="px-8 py-2.5 bg-[#0066b1] text-white text-sm font-bold rounded-full shadow-lg shadow-blue-600/30 hover:bg-[#005595] hover:shadow-blue-600/40 hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2"
                    >
                      {isAddingHardware ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />{' '}
                          Kaydediliyor
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4.5 h-4.5" /> Kaydet
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* PERSONNEL PROFILE MODAL */}
            {viewingPersonId && viewedPerson && (
              <div
                className="app-modal-backdrop fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                style={{ zIndex: 99999 }}
              >
                <div className="app-modal-panel bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden">
                  {/* HEADER: p-4 ve daha temiz border */}
                  <div className="flex justify-between items-center p-4 border-b border-gray-100 shrink-0">
                    {/* SOL TARAF: Baslik ve Rozet Bir Arada */}
                    <div className="flex items-center gap-3">
                      <h3 className="font-bold text-[1.05rem] text-gray-800 flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-600" /> Personel
                        Profili
                      </h3>

                      {/* YENİ EKLENEN AKTİF ROZETİ */}
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 shadow-sm border ${
                          viewedPerson.status === 'Kullanıcı Bulunamadı'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : viewedPerson.status === 'Pasif'
                            ? 'bg-gray-100 text-gray-600 border-gray-300'
                            : 'bg-green-50 text-green-700 border-green-200'
                        }`}
                      >
                        {viewedPerson.status || 'Aktif'}
                      </span>
                    </div>

                    {/* SAG TARAF: Kapatma Butonu */}
                    <button
                      onClick={() => {
                        setViewingPersonId(null);
                        setShowPersonHistory(false);
                        setShowAdPasswordResetModal(false);
                        setSelectedForReturn([]);
                      }}
                      className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 p-1.5 rounded-full transition-colors bg-white border border-gray-200 shadow-sm"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* BODY: space-y-4 ile daha kompakt */}
                  <div 
                    className="p-4 space-y-4 overflow-y-auto flex-1 bg-white overscroll-contain"
                    style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                  >
                    {/* 1. KİŞİ BİLGİSİ HEADER */}
                    <div className="flex items-center gap-4 pb-2">
                      {/* Avatar */}
                      <div
                        className="bg-blue-100 text-blue-600 flex items-center justify-center text-[1.35rem] font-bold shadow-sm border border-blue-200 shrink-0 overflow-hidden"
                        style={{
                          width: '56px',
                          height: '56px',
                          borderRadius: '50%',
                        }}
                      >
                        {viewedPerson.picture ? (
                          <img
                            src={viewedPerson.picture}
                            alt={viewedPerson.name}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={() => handlePersonPictureError(viewedPerson.id)}
                          />
                        ) : (
                          viewedPerson.name.charAt(0)
                        )}
                      </div>

                      {/* Sadece İsim ve Kampüs (Tüm satırı kaplıyor) */}
                      <div className="flex-1 flex flex-col min-w-0">
                        <h2
                          className="text-[1.15rem] sm:text-lg font-bold text-gray-900 truncate leading-tight"
                          title={viewedPerson.name}
                        >
                          {viewedPerson.name}
                        </h2>
                        <p
                          className="text-[12px] font-medium text-gray-500 mt-0.5 truncate"
                          title={viewedPerson.campus}
                        >
                          {viewedPerson.campus} Kampüsü
                        </p>
                      </div>
                    </div>

                    {/* 2. HESAP & GÖREV BİLGİLERİ */}
                    <div className="flex flex-col gap-3 mt-4">
                      <div className="overflow-hidden rounded-xl border border-slate-100 bg-slate-50">
                        <div
                          onClick={(e) => {
                            if (!viewedPerson.email) return;
                            e.stopPropagation();
                            navigator.clipboard.writeText(viewedPerson.email);
                            setCopiedEmail(true);
                            setTimeout(() => setCopiedEmail(false), 2000);
                          }}
                          className={`p-3 transition-colors ${
                            viewedPerson.email ? 'cursor-pointer hover:bg-blue-50' : ''
                          }`}
                          title={viewedPerson.email ? 'Kopyalamak için tıkla' : ''}
                        >
                          <p className="text-[10px] text-gray-400 mb-1 font-bold uppercase tracking-wider">
                            E-Posta Adresi
                          </p>
                          <p className="font-bold text-blue-600 text-[13px] truncate leading-tight">
                            {copiedEmail ? (
                              <span className="text-green-600 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Kopyalandı
                              </span>
                            ) : (
                              viewedPerson.email || '-'
                            )}
                          </p>
                        </div>

                        <div className="border-t border-slate-200/80 p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-blue-500 mb-1 font-bold uppercase tracking-wider">
                              AD Kullanıcı adı
                            </p>
                            <p className="font-black text-gray-900 text-[13px] truncate">
                              {viewedPersonAdLogin || 'Tanımlı değil'}
                            </p>
                            {latestAdPasswordJobView && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black ${latestAdPasswordJobView.tone}`}>
                                  {latestAdPasswordJobView.active && <Loader2 className="w-3 h-3 animate-spin" />}
                                  {latestAdPasswordJobView.label}
                                </span>
                                <span className="text-[10px] text-gray-500 font-semibold truncate">
                                  {formatTransferDateTime(
                                    latestAdPasswordJob?.updatedAt || latestAdPasswordJob?.createdAt
                                  )}
                                </span>
                              </div>
                            )}
                            {latestAdPasswordJob?.error && (
                              <p className="text-[10px] text-red-600 font-bold mt-1 line-clamp-2">
                                {latestAdPasswordJob.error}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowAdPasswordResetModal(true)}
                            disabled={!viewedPersonAdLogin || hasActiveAdPasswordJob}
                            title={!viewedPersonAdLogin ? 'Kullanıcı adı tanımlı değil.' : hasActiveAdPasswordJob ? 'Bu personel için bekleyen bir şifre işlemi var.' : 'Şifre değiştir'}
                            className="shrink-0 h-8 px-2.5 rounded-lg bg-[#0066b1] text-white text-[11px] font-black shadow-sm hover:bg-[#005595] transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                          >
                            {hasActiveAdPasswordJob ? 'İşleniyor' : 'Şifre Değiştir'}
                          </button>
                        </div>
                      </div>

                      {/* Departman / İmza Kutucuğu */}
                      <div className={`p-3 rounded-xl border ${
                        viewedPerson.signatureLink
                          ? 'bg-emerald-50/40 border-emerald-300'
                          : isSignatureEligiblePerson(viewedPerson)
                            ? 'bg-amber-50/70 border-amber-300'
                            : 'bg-slate-50 border-slate-100'
                      }`}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                Departman / Görev
                              </p>
                            </div>
                            {viewedPerson.signatureLink ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!openSafeExternalUrl(viewedPerson.signatureLink)) {
                                    showAppAlert('İmza bağlantısı güvenli olmadığı için açılamadı.');
                                  }
                                }}
                                className="group inline-flex max-w-full items-center gap-1.5 text-left font-bold text-[#0066b1] text-[14px] leading-snug hover:text-[#005595] hover:underline underline-offset-2 transition-colors"
                                title="İmza linkini aç"
                              >
                                <span className="min-w-0 break-words">
                                  {viewedPerson.department || '-'}
                                </span>
                                <ExternalLink
                                  className="w-3.5 h-3.5 shrink-0 opacity-65 transition-opacity group-hover:opacity-100"
                                  aria-hidden="true"
                                />
                              </button>
                            ) : (
                              <p className="font-bold text-gray-800 text-[14px] break-words leading-tight">
                                {viewedPerson.department || '-'}
                              </p>
                            )}
                            {viewedPerson.signatureStatus && (
                              <p className="text-[10px] text-gray-500 font-bold mt-1">
                                İmza durumu: {viewedPerson.signatureStatus}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                          {isSignatureEligiblePerson(viewedPerson) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!signatureTitles.length || !signatureCampuses.length) fetchSignatureMeta(true);
                                setSignatureModalPerson(viewedPerson);
                              }}
                              className="h-8 px-2.5 rounded-lg bg-[#0066b1] text-white text-[11px] font-black shadow-sm hover:bg-[#005595] transition-colors inline-flex items-center justify-center gap-1.5"
                              title={viewedPerson.signatureLink ? 'İmzayı yenile' : 'İmza oluştur'}
                            >
                              <FileSignature className="w-3.5 h-3.5" />
                              {viewedPerson.signatureLink ? 'Yenile' : 'Oluştur'}
                            </button>
                          )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 3. ZİMMETLİ CİHAZLAR (Çoklu İade Seçimi Eklendi) */}
                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-bold text-gray-800 flex items-center gap-2 text-sm m-0">
                          <Laptop className="w-4 h-4 text-gray-400" /> Zimmetli
                          Cihazlar
                        </h4>

                        {/* SEÇİLİ CİHAZLARI İADE AL BUTONU */}
                        {viewedPersonHardware.length > 0 &&
                          selectedForReturn.length > 0 && (
                            <button
                              onClick={() => {
                                const selectedHardwareObjs = selectedForReturn
                                  .map((id) => hardwareById.get(id))
                                  .filter(Boolean);
                                setReturningData({
                                  hardwareArray: selectedHardwareObjs,
                                  person: viewedPerson,
                                });
                                setSelectedForReturn([]); // İşleme geçince seçimi sıfırla
                              }}
                              className="text-[10px] bg-[#0066b1] text-white px-2.5 py-1.5 rounded border hover:bg-[#005595] font-bold transition-colors shadow-sm flex items-center gap-1.5"
                            >
                              Seçilileri İade Al ({selectedForReturn.length})
                            </button>
                          )}
                      </div>

                      <div className="space-y-2.5">
                        {viewedPersonHardware.length > 0 ? (
                          viewedPersonHardware
                            .map((h) => {
                              const bStr = h.brand || '';
                              const mStr = h.model || '';
                              const cModel = mStr
                                .toLowerCase()
                                .startsWith(bStr.toLowerCase())
                                ? mStr.substring(bStr.length).trim()
                                : mStr;
                              const isChecked = selectedForReturn.includes(
                                h.id
                              );

                              return (
                                <div
                                  key={h.id}
                                  onClick={() => {
                                    // Kutunun herhangi bir yerine tıklayınca seçimi aç/kapat
                                    setSelectedForReturn((prev) =>
                                      prev.includes(h.id)
                                        ? prev.filter((id) => id !== h.id)
                                        : [...prev, h.id]
                                    );
                                  }}
                                  className={`p-3 md:p-4 border rounded-xl flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 shadow-sm transition-colors w-full cursor-pointer group ${
                                    isChecked
                                      ? 'bg-blue-50/50 border-[#0066b1]'
                                      : 'bg-white border-gray-200 hover:border-blue-300'
                                  }`}
                                >
                                  {/* Sol: Checkbox + Cihaz Bilgisi */}
                                  <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                                    {/* Checkbox Kutusu */}
                                    <div
                                      className="shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => {
                                          setSelectedForReturn((prev) =>
                                            prev.includes(h.id)
                                              ? prev.filter((id) => id !== h.id)
                                              : [...prev, h.id]
                                          );
                                        }}
                                        className="w-4 h-4 cursor-pointer text-[#0066b1] rounded focus:ring-[#0066b1] transition-colors"
                                      />
                                    </div>

                                    <div
                                      className="flex-1 min-w-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setViewingPersonId(null);
                                        setViewingHardwareId(h.id);
                                      }}
                                      title="Cihaz profiline git"
                                    >
                                      <p className="font-bold text-[13px] text-gray-900 group-hover:text-blue-600 transition-colors truncate">
                                        {bStr} {cModel}
                                      </p>
                                      <p className="text-[11px] font-medium text-gray-500 mt-1 truncate">
                                        S/N: {h.serial}{' '}
                                        <span className="text-gray-300 mx-1">
                                          |
                                        </span>{' '}
                                        Tip: {h.type}
                                      </p>
                                    </div>
                                  </div>

                                  {/* Sag: Zimmet Belgesi Butonu (Sadece belge varsa) */}
                                  {hasCurrentAssignmentDocument(h) && (
                                    <div
                                      className="flex flex-row gap-2 shrink-0 sm:ml-auto w-full sm:w-auto"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <button
                                        onClick={() =>
                                          handlePdfClick(
                                            h.driveLink,
                                            'Zimmet Belgesi'
                                          )
                                        }
                                        className="flex-1 sm:flex-none text-xs bg-white text-green-600 px-3 py-1.5 rounded-lg font-semibold border border-green-200 hover:bg-green-50 transition-colors flex items-center justify-center gap-1.5"
                                      >
                                        <FileText className="w-3.5 h-3.5" />{' '}
                                        Zimmet Belgesi
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                        ) : (
                          // Birlikte tasarladığımız o şık kesik çizgili boş durum
                          <div className="py-4 bg-gray-50/50 rounded-xl flex flex-row items-center justify-center gap-2 text-center border-2 border-dashed border-gray-200">
                            <Laptop className="w-4 h-4 text-gray-400" />
                            <p className="text-[13px] font-medium text-gray-500">
                              Kişi üzerinde zimmetli cihaz bulunmamaktadır.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 4. ZİMMET VE İADE GEÇMİŞİ AKORDEONU */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm mt-4">
                      <button
                        onClick={() => handleOpenPersonHistory(viewedPerson.id)}
                        disabled={isLoadingPersonHistory}
                        className={`w-full p-4 flex justify-between items-center transition-colors ${
                          showPersonHistory
                            ? 'bg-slate-50 border-b border-gray-200'
                            : 'hover:bg-slate-50'
                        } ${isLoadingPersonHistory ? 'opacity-70 cursor-wait' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <History className="w-4 h-4 text-gray-500" />
                          <span className="text-[13px] font-bold text-gray-800">
                            Belge Geçmişi (Zimmet & İade)
                            {viewedPerson.documents?.length > 0 && (
                              <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                                {viewedPerson.documents.length}
                              </span>
                            )}
                          </span>
                        </div>
                        {isLoadingPersonHistory ? (
                          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                        ) : viewedPerson.documents?.length > 0 ? (
                          <ChevronDown
                            className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${
                              showPersonHistory ? 'rotate-180' : ''
                            }`}
                          />
                        ) : (
                          <span className="text-[11px] font-semibold text-gray-400">
                            {viewedPerson.documentsLoaded ? 'Kayıt Yok' : 'Yükle'}
                          </span>
                        )}
                      </button>

                      {showPersonHistory &&
                        viewedPerson.documents?.length > 0 && (
                          <div className="p-3 bg-slate-50/50 space-y-2 animate-in slide-in-from-top-2 duration-200 max-h-[250px] overflow-y-auto">
                            {/* En son eklenen belge en üstte çıksın diye reverse() kullanıyoruz */}
                            {[...viewedPerson.documents]
                              .reverse()
                              .map((doc) => {
                                // Türkçe "İ" karakteri sorununu aşmak için genişletilmiş kontrol
                                const isReturn =
                                  doc.name.includes('İade') ||
                                  doc.name.includes('iade') ||
                                  doc.name
                                    .toLocaleLowerCase('tr-TR')
                                    .includes('iade');

                                // Dosya isminden cihaz verilerini ayıklama
                                // (Format: Serial, İsim, Kampüs, Marka Model, Tipi.pdf)
                                const parts = doc.name.split(',');
                                let deviceName = 'Cihaz Belgesi';
                                let serialNo = '';

                                if (parts.length >= 4) {
                                  // Standart Zimmet/İade formülü (5 parça veya 4 parça)
                                  serialNo = parts[0].trim();
                                  deviceName = parts[parts.length - 2].trim();
                                } else if (parts.length > 1) {
                                  // Manuel yüklenen tutanak gibi durumlar için alternatif formül
                                  serialNo = parts[0].trim();
                                  deviceName = parts[parts.length - 1]
                                    .replace(/\.[^/.]+$/, '')
                                    .replace(/_/g, ' ')
                                    .trim();
                                } else {
                                  // Hiçbir formata uymuyorsa direkt pdf ismini koy
                                  deviceName = doc.name.replace(
                                    /\.[^/.]+$/,
                                    ''
                                  );
                                }

                                return (
                                  <div
                                    key={doc.id}
                                    className="p-3 bg-white border border-gray-200 shadow-sm rounded-lg flex justify-between items-center hover:border-blue-200 transition-colors"
                                  >
                                    <div className="pr-2 flex flex-col gap-1 min-w-0">
                                      <p
                                        className="font-bold text-[13px] text-gray-800 leading-tight truncate"
                                        title={deviceName}
                                      >
                                        {deviceName}
                                      </p>
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${
                                            isReturn
                                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                              : 'bg-green-50 text-green-700 border border-green-200'
                                          }`}
                                        >
                                          {isReturn ? 'İADE' : 'ZİMMET'}
                                        </span>
                                        {serialNo && (
                                          <span className="text-[11px] font-medium text-gray-500 truncate border-l border-gray-200 pl-2">
                                            S/N: {serialNo}
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-[10px] font-medium text-gray-400 mt-0.5">
                                        {doc.date || 'Tarih Yok'}
                                      </p>
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePdfClick(doc.url, doc.name);
                                      }}
                                      className="text-xs bg-slate-50 text-slate-700 px-3 py-1.5 rounded-md font-bold border border-slate-200 hover:bg-white hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1.5 shadow-sm shrink-0 ml-2"
                                    >
                                      <FileText className="w-3.5 h-3.5" /> PDF
                                      Aç
                                    </button>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {showAdPasswordResetModal && viewedPerson && (
              <Suspense fallback={<LazyPanelFallback label="Şifre ekranı hazırlanıyor..." />}>
                <AdPasswordResetModal
                  person={viewedPerson}
                  currentUser={currentUser}
                  clientIp={clientIp}
                  onClose={() => setShowAdPasswordResetModal(false)}
                  onQueued={(result) => {
                    setAdPasswordJobs((prev) => [
                      {
                        queueId: result.queueId || 'Bekliyor',
                        createdAt: new Date().toLocaleString('tr-TR'),
                        updatedAt: new Date().toLocaleString('tr-TR'),
                        status: 'BEKLIYOR',
                        personName: viewedPerson.name,
                        adUser: viewedPersonAdLogin,
                        mode: 'Şifre',
                        campus: viewedPerson.campus,
                      },
                      ...prev,
                    ]);
                    setSuccessMessage(`Bilgisayar/Wi‑Fi şifre değiştirme işlemi başlatıldı: ${result.queueId || 'Bekliyor'}`);
                    setTimeout(() => setSuccessMessage(null), 3000);
                  }}
                  onPhoneSaved={handlePersonPhoneSaved}
                />
              </Suspense>
            )}

            {signatureModalPerson && (
              <Suspense fallback={<LazyPanelFallback label="İmza ekranı hazırlanıyor..." />}>
                <SignatureCreateModal
                  person={signatureModalPerson}
                  titles={signatureTitles}
                  campuses={signatureCampuses}
                  canChooseCampus={canChooseSignatureCampus}
                  isLoadingTitles={isLoadingSignatureTitles}
                  isSubmitting={isCreatingSignature}
                  onClose={() => setSignatureModalPerson(null)}
                  onSubmit={handleCreatePersonnelSignature}
                />
              </Suspense>
            )}

            {returningData && (
              <Suspense fallback={<LazyPanelFallback label="İade ekranı hazırlanıyor..." />}>
                <ReturnZimmetModal
                  deps={{
                    returningData,
                    setReturningData,
                    isGenerating,
                    currentUser,
                    returnItSignature,
                    setReturnItSignature,
                    returnPersonSignature,
                    setReturnPersonSignature,
                    returnPersonOtpData,
                    setReturnPersonOtpData,
                    returnCondition,
                    setReturnCondition,
                    returnExplanation,
                    setReturnExplanation,
                    returnIncludeCharger,
                    setReturnIncludeCharger,
                    returnIncludeBag,
                    setReturnIncludeBag,
                    returnIncludeMouse,
                    setReturnIncludeMouse,
                    isReturnAccepted,
                    setIsReturnAccepted,
                    handleFinalizeReturn,
                  }}
                />
              </Suspense>
            )}
          </div>
        )}
        {/* YENİ ZİMMET BUTONUNUN ALTTA KALMAMASI İÇİN GARANTİLİ FİZİKSEL BOŞLUK */}
        <div
          style={{
            height: '140px',
            width: '100%',
            flexShrink: 0,
            display: 'block',
            clear: 'both',
          }}
        ></div>

        {/* === YENİ: TRANSFER MODAL & PDF ÜRETİCİ === */}
        {transferModalObj &&
          (() => {
            let teslimEdenName = '';
            let teslimAlanName = '';

            // İstenen Mantık: Gönderen kendi ismini görür, Alıcı kısmı "Bilgi İşlem Sorumlusu" yazar.
            if (transferModalObj.type === 'out') {
              teslimEdenName = currentUser.name;
              teslimAlanName = 'Bilgi İşlem Sorumlusu';
            } else {
              // Cihazı teslim alırken: Teslim eden "Bilgi İşlem Sorumlusu", teslim alan işlemi yapan kişi.
              teslimEdenName = 'Bilgi İşlem Sorumlusu';
              teslimAlanName = currentUser.name;
            }

            return (
              <div
                className="app-modal-backdrop fixed inset-0 bg-black/80 backdrop-blur-sm overflow-y-auto"
                style={{ zIndex: 9999999 }}
              >
                <div className="min-h-full flex items-start md:items-center justify-center p-2 sm:p-4 py-8">
                  <div className="app-modal-panel bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden">
                    <div
                      className={`flex justify-between items-center p-4 border-b text-white shrink-0 ${
                        transferModalObj.type === 'out'
                          ? 'bg-[#0066b1]'
                          : 'bg-amber-600'
                      }`}
                    >
                      <h3 className="font-bold text-base md:text-lg flex items-center gap-2">
                        <Send className="w-5 h-5" />
                        {transferModalObj.type === 'out'
                          ? 'Kampüsler Arası Çıkış (Gönderim) İşlemi'
                          : 'Kampüsler Arası Giriş (Teslim Alma) İşlemi'}
                      </h3>
                      <button
                        onClick={() => {
                          setTransferModalObj(null);
                          setTransferSignature(null);
                        }}
                        className="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </div>

                    <div className="p-2 md:p-6 bg-gray-100 overflow-x-auto flex flex-col items-center">
                      <div
                        id="transfer-pdf-content"
                        style={{
                          width: isGenerating ? '210mm' : '100%',
                          maxWidth: '210mm',
                          backgroundColor: 'white',
                          padding: isGenerating ? '20mm 25mm' : '4vw',
                          color: 'black',
                          fontFamily: '"Times New Roman", Times, serif',
                          fontSize: '12px',
                          lineHeight: '1.5',
                        }}
          className="theme-paper shadow-lg transition-all duration-300 relative"
                      >
                        {/* LOGO KISMI */}
                        <div style={{ marginBottom: '30px' }}>
                          <img
                            src="https://istek.site/logo/Kurum_Genel_Logo-01.png"
                            alt="İstek Okulları Logo"
                            style={{ height: '50px', width: 'auto' }}
                          />
                        </div>

                        {/* ORTALANMIS BASLIKLAR */}
                        <div
                          style={{ textAlign: 'center', marginBottom: '50px' }}
                        >
                          <h3
                            style={{
                              fontSize: '14px',
                              fontWeight: 'bold',
                              margin: '0 0 10px 0',
                            }}
                          >
                            İSTEK OKULLARI GENEL MÜDÜRLÜĞÜ
                          </h3>
                          <h3
                            style={{
                              fontSize: '14px',
                              fontWeight: 'bold',
                              margin: '0 0 10px 0',
                            }}
                          >
                            BİLGİ İŞLEM DEPARTMANI
                          </h3>
                          <h3
                            style={{
                              fontSize: '14px',
                              fontWeight: 'bold',
                              margin: '0',
                            }}
                          >
                            TESLİM TUTANAĞI
                          </h3>
                        </div>

                        {/* GİRİŞ METNİ */}
                        <p
                          style={{
                            textAlign: 'justify',
                            marginBottom: '30px',
                            textIndent: '30px',
                          }}
                        >
                          İş bu tutanak aşağıda belirtilen marka, model ve seri
                          numarası yazılı donanımlar, İSTEK{' '}
                          {
                            transferModalObj.type === 'out'
                              ? transferModalObj.targetCampus.toUpperCase() // Çıkış yaparken: Hedef Kampüs (Örn: Genel Müdürlük)
                              : currentUser.campus.toUpperCase() // Teslim alırken: Kendi Kampüsüm (Örn: Genel Müdürlük)
                          }{' '}
                          bilgi işlem departmanına, kampüs operasyonlarında
                          kullanılmak üzere teslim edilmiştir.
                        </p>

                        {/* TABLO */}
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            marginBottom: '40px',
                            fontSize: '11px',
                          }}
                        >
                          <thead>
                            <tr>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '8px',
                                  textAlign: 'left',
                                  width: '10%',
                                }}
                              >
                                S. No
                              </th>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '8px',
                                  textAlign: 'center',
                                }}
                              >
                                Marka / Model
                              </th>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '8px',
                                  textAlign: 'center',
                                }}
                              >
                                Seri No
                              </th>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '8px',
                                  textAlign: 'center',
                                  width: '10%',
                                }}
                              >
                                Adet
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {transferModalObj.items.map((hw, idx) => (
                              <tr key={hw.id}>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '8px',
                                    textAlign: 'left',
                                  }}
                                >
                                  {idx + 1}
                                </td>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '8px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {hw.brand} {hw.model}
                                </td>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '8px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {hw.serial}
                                </td>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '8px',
                                    textAlign: 'center',
                                  }}
                                >
                                  1
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* SAGA DAYALI TARIH */}
                        <div
                          style={{ textAlign: 'right', marginBottom: '50px' }}
                        >
                          Teslim Tarihi:{' '}
                          {new Date().toLocaleDateString('tr-TR')}
                        </div>

                        {/* EL YAZISI TESLİM BEYANLARI */}
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: isGenerating ? 'row' : 'column',
                            justifyContent: 'space-between',
                            gap: isGenerating ? '0px' : '30px',
                            marginTop: '40px',
                          }}
                        >
                          {/* Gönderen / Teslim Eden Beyanı */}
                          <div
                            style={{
                              width: isGenerating ? '50%' : '100%',
                              textAlign: 'center',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            }}
                          >
                            <p style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: '20px' }}>
                              Teslim Eden
                            </p>
                            <p>{teslimEdenName}</p>

                            {transferModalObj.type === 'out' && (
                              <>
                                {!isGenerating && (
                                  <div style={{ marginTop: '10px' }}>
                                    <Suspense fallback={<LazyInlineFallback label="Beyan alanı hazırlanıyor..." />}>
                                      <HandwrittenStatementPad
                                        value={transferSignature}
                                        onChange={setTransferSignature}
                                        label="Teslim Eden Beyanı"
                                        statement="Eksiksiz teslim ettim."
                                      />
                                    </Suspense>
                                  </div>
                                )}
                                <div
                                  style={{
                                    height: '80px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginTop: '10px',
                                  }}
                                  className={!isGenerating ? 'hidden' : 'flex'}
                                >
                                  {transferSignature && (
                                    <>
                                      <div style={{ fontSize: '9px', color: '#333', marginBottom: '4px' }}>“Eksiksiz teslim ettim.”</div>
                                      <img src={transferSignature.image} alt="Teslim eden beyanı" style={{ maxHeight: '70px', maxWidth: '100%' }} />
                                      <span style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                                        Beyan ID: {transferSignature.hash}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Alıcı / Teslim Alan Beyanı */}
                          <div
                            style={{
                              width: isGenerating ? '50%' : '100%',
                              textAlign: 'center',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            }}
                          >
                            <p style={{ fontWeight: 'bold', textDecoration: 'underline', marginBottom: '20px' }}>
                              Teslim Alan
                            </p>
                            <p>{teslimAlanName}</p>

                            {transferModalObj.type === 'in' && (
                              <>
                                {!isGenerating && (
                                  <div style={{ marginTop: '10px' }}>
                                    <Suspense fallback={<LazyInlineFallback label="Beyan alanı hazırlanıyor..." />}>
                                      <HandwrittenStatementPad
                                        value={transferSignature}
                                        onChange={setTransferSignature}
                                        label="Teslim Alan Beyanı"
                                        statement="Eksiksiz teslim aldım."
                                      />
                                    </Suspense>
                                  </div>
                                )}
                                <div
                                  style={{
                                    height: '80px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginTop: '10px',
                                  }}
                                  className={!isGenerating ? 'hidden' : 'flex'}
                                >
                                  {transferSignature && (
                                    <>
                                      <div style={{ fontSize: '9px', color: '#333', marginBottom: '4px' }}>“Eksiksiz teslim aldım.”</div>
                                      <img src={transferSignature.image} alt="Teslim alan beyanı" style={{ maxHeight: '70px', maxWidth: '100%' }} />
                                      <span style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                                        Beyan ID: {transferSignature.hash}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* YASAL LOG (Sadece PDF'te görünür) */}
                        <div
                          className={!isGenerating ? 'hidden' : 'block'}
                          style={{
                            marginTop: '100px',
                            borderTop: '1px solid #ccc',
                            paddingTop: '10px',
                          }}
                        >
                          <p
                            style={{
                              fontSize: '9px',
                              fontWeight: 'bold',
                              marginBottom: '4px',
                              color: '#555',
                            }}
                          >
                            DİJİTAL İŞLEM LOG KAYDI
                          </p>
                          <div
                            style={{
                              fontSize: '8px',
                              color: '#777',
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '15px',
                            }}
                          >
                            <span>
                              <strong>İşlemi Yapan IT:</strong>{' '}
                              {currentUser.email}
                            </span>
                            <span>
                              <strong>Zaman Damgası:</strong>{' '}
                              {new Date().toLocaleString('tr-TR')}
                            </span>
                            <span>
                              <strong>IP Adresi:</strong> {clientIp}
                            </span>
                            <span>
                              <strong>Cihaz Bilgisi:</strong>{' '}
                              {navigator.userAgent.substring(0, 50)}...
                            </span>
                          </div>
                        </div>
                      </div>

                      {!isGenerating && (
                        <div className="w-full max-w-[210mm] mt-6 bg-white p-4 rounded-xl shadow-sm border flex justify-between">
                          <button
                            onClick={() => {
                              setTransferModalObj(null);
                              setTransferSignature(null);
                            }}
                            className="px-6 py-2.5 border text-gray-700 font-bold rounded-lg hover:bg-gray-50"
                          >
                            İptal
                          </button>
                          <button
                            onClick={handleFinalizeTransfer}
                            disabled={!transferSignature}
                            className={`px-6 py-2.5 text-white font-bold rounded-lg flex items-center shadow-md disabled:opacity-50 ${
                              transferModalObj.type === 'out'
                                ? 'bg-[#0066b1] hover:bg-[#005595]'
                                : 'bg-amber-600 hover:bg-amber-700'
                            }`}
                          >
                            {isGenerating ? (
                              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-5 h-5 mr-2" />
                            )}
                            {transferModalObj.type === 'out'
                              ? 'Çıkış Yap ve Belge Üret'
                              : 'Teslim Al ve Belge Üret'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
      </main>

      {qrLabelPrintItems.length > 0 && (
        <Suspense fallback={<LazyPanelFallback label="QR etiketi hazırlanıyor..." />}>
          <QrLabelModal
            items={qrLabelPrintItems}
            getPayload={getHardwareQrPayload}
            onClose={() => setQrLabelPrintItems([])}
          />
        </Suspense>
      )}

      {activeTab === 'assign' &&
        selectedPerson &&
        selectedHardware.length > 0 &&
        !isSigning &&
        !showZimmetliOnayModal && (
          <AssignmentFloatingAction
            ref={assignmentActionBtnRef}
            selectedCount={selectedHardware.length}
            onClick={handleCreateAssignment}
          />
        )}

      {/* YENİ: GLPI FLOATING ACTION BAR */}
      {activeTab === 'glpiMissing' && selectedMissingGlpiIds.length > 0 && (
        <div
          className="fixed z-[999999] flex items-center justify-between glpi-floating-container"
          style={{
            bottom: '24px', left: '50%', transform: 'translateX(-50%)',
            backgroundColor: 'var(--app-floating-bg)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            boxShadow: 'var(--app-floating-shadow)', border: '1px solid var(--app-floating-border)', borderRadius: '9999px',
            transition: 'all 0.7s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        >
          <style>{`
            .glpi-floating-container {
              padding: 8px 8px 8px 12px;
              width: max-content;
              max-width: 94%;
            }
            .glpi-action-btn {
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              min-height: 36px;
              padding: 9px 15px;
              border-radius: 9999px;
              font-size: 13px;
              font-weight: 900;
              transition: all 0.2s ease;
              white-space: nowrap;
            }
            .glpi-action-btn:hover { transform: translateY(-1px); }
            .hide-scroll::-webkit-scrollbar { display: none; }
            .hide-scroll { -ms-overflow-style: none; scrollbar-width: none; }
            @media (max-width: 767px) {
              .glpi-floating-container {
                width: calc(100% - 24px);
                padding: 7px;
              }
              .glpi-action-btn {
                flex: 1;
                min-width: 0;
                font-size: 12px;
                padding: 8px 10px;
              }
            }
          `}</style>
          <div className="flex items-center w-full">
            {/* Sayi Rozeti */}
            <div className="bg-[#0066b1] text-white text-base md:text-lg font-black flex items-center justify-center shrink-0 shadow-sm" style={{ width: '36px', height: '36px', borderRadius: '50%' }}>
              {selectedMissingGlpiIds.length}
            </div>

            <div className="hidden sm:flex flex-col justify-center px-3 min-w-[140px]">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">GLPI Seçimi</span>
              <span className="text-xs font-bold text-gray-700 truncate">Donanımlara Depoda olarak ekle</span>
            </div>

            {/* Orta Buton */}
            <div className="flex-1 flex items-center gap-1.5 md:gap-2 overflow-x-auto hide-scroll px-2 md:px-3">
              <button
                onClick={handleImportMissingGlpiDevices}
                disabled={isImportingMissingGlpi}
                className="glpi-action-btn"
                style={{ backgroundColor: '#0066b1', color: '#ffffff', boxShadow: '0 8px 18px rgba(0,102,177,0.22)' }}
              >
                {isImportingMissingGlpi ? <Loader2 className="w-4 h-4 md:w-[18px] md:h-[18px] animate-spin" /> : <Plus className="w-4 h-4 md:w-[18px] md:h-[18px]" />}
                <span className="hidden sm:inline">Sisteme Aktar</span>
                <span className="sm:hidden">Ekle</span>
              </button>
            </div>

            {/* Kapatma çarpısı */}
            <div className="shrink-0 border-l border-gray-200 pl-1 md:pl-2 flex items-center">
              <button onClick={() => setSelectedMissingGlpiIds([])} className="flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors rounded-full" style={{ width: '36px', height: '36px' }}>
                <X size={22} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KUSURSUZ SÜZÜLEN (FLOATING) İŞLEM KAPSÜLÜ (MOBİL & MASAÜSTÜ KUSURSUZ UYUM) */}
      {selectedBulkHardware.length > 0 && (
        <div
          ref={floatingBtnsRef}
          className="fixed z-[999999] flex items-center justify-between floating-container"
          style={{
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--app-floating-bg)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: 'var(--app-floating-shadow)',
            border: '1px solid var(--app-floating-border)',
            borderRadius: '9999px',
            transition: 'all 0.7s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
        >
          <style>{`
            .hide-scroll::-webkit-scrollbar { display: none; }
            .hide-scroll { -ms-overflow-style: none; scrollbar-width: none; }
            
            /* STANDART (MASAÜSTÜ) BOYUTLAR */
            .floating-container {
              padding: 8px 8px 8px 12px;
              width: max-content;
              max-width: 95%;
            }
            .bulk-btn {
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 14px;
              font-weight: 800;
              transition: all 0.2s;
              flex-shrink: 0;
              padding: 10px 16px;
              border-radius: 9999px;
            }
            .bulk-btn:hover { opacity: 0.8; }
            
            /* MOBİL EKRANLAR İÇİN KÜÇÜLTÜLMÜŞ ZARİF BOYUTLAR */
            @media (max-width: 767px) {
              .floating-container { 
                padding: 6px 6px 6px 8px; 
                width: 96%; /* Mobilde ekrani tam kaplasin ama kenarlarda bosluk kalsin */
              }
              .bulk-btn { 
                font-size: 12px; 
                padding: 8px 12px; 
                gap: 5px; 
              }
            }
          `}</style>

          {!bulkCampusTransferMode ? (
            <div className="flex items-center w-full">
              {/* SABIT SOL: Sayi Rozeti */}
              <div
                className="bg-blue-600 text-white text-base md:text-lg font-black flex items-center justify-center shrink-0 shadow-sm"
                style={{ width: '36px', height: '36px', borderRadius: '50%' }}
              >
                {selectedBulkHardware.length}
              </div>

              {/* ORTA: Sadece Butonlar Kaydirilabilir Alani (Mobilde sigmazsa diye) */}
              <div className="flex-1 flex items-center gap-1.5 md:gap-2 overflow-x-auto hide-scroll px-2 md:px-3">
                <button onClick={() => handleBulkAction('Depo')} className="bulk-btn" style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                  <Archive size={16} className="md:w-[18px] md:h-[18px]" /> Depo
                </button>
                <button onClick={() => handleBulkAction('Hurda')} className="bulk-btn" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                  <Trash2 size={16} className="md:w-[18px] md:h-[18px]" /> Hurda
                </button>
                <button onClick={() => handleBulkAction('Arızalı')} className="bulk-btn" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                  <Wrench size={16} className="md:w-[18px] md:h-[18px]" /> Arızalı
                </button>
                <button onClick={() => setShowGroupModal(true)} className="bulk-btn" style={{ backgroundColor: '#f3e8ff', color: '#6b21a8' }}>
                  <Tag size={16} className="md:w-[18px] md:h-[18px]" /> Grup
                </button>
                <button onClick={() => setBulkCampusTransferMode(true)} className="bulk-btn" style={{ backgroundColor: '#3b82f6', color: '#ffffff' }}>
                  <Send size={16} className="md:w-[18px] md:h-[18px]" /> Transfer
                </button>
                <button
                  onClick={() => handleOpenQrLabelPrint(hardware.filter((h) => selectedHardwareIdSet.has(h.id)))}
                  className="bulk-btn"
                  style={{ backgroundColor: '#e0f2fe', color: '#075985' }}
                >
                  <QrCode size={16} className="md:w-[18px] md:h-[18px]" /> QR Etiket
                </button>
              </div>

              {/* SABİT SAĞ: Kapatma Çarpısı */}
              <div className="shrink-0 border-l border-gray-200 pl-1 md:pl-2 flex items-center">
                <button
                  onClick={() => setSelectedBulkHardware([])}
                  className="flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors rounded-full"
                  style={{ width: '36px', height: '36px' }}
                >
                  <X size={22} />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full py-0.5 px-1 gap-2">
              {/* TRANSFER SEÇİM KUTUSU */}
              <select
                value={bulkTargetCampus}
                onChange={(e) => setBulkTargetCampus(e.target.value)}
                className="outline-none focus:ring-2 focus:ring-blue-500 truncate flex-1 min-w-0"
                style={{
                  backgroundColor: '#f8fafc',
                  color: '#333',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px', /* iOS Zoom engellemek için mobilde 16px olmalı ama alan dar, o yüzden 14px'de tutuyoruz */
                  fontWeight: '700',
                  padding: '8px 12px',
                  borderRadius: '9999px',
                }}
              >
                <option value="">Kampüs Seç...</option>
                {Object.keys(CAMPUS_CODES).filter((c) => c !== currentUser.campus).sort((a, b) => a.localeCompare(b, 'tr')).map((c) => (
                    <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <button
                onClick={() => {
                  const selectedObjs = hardware.filter((h) => selectedHardwareIdSet.has(h.id));
                  setTransferModalObj({ type: 'out', items: selectedObjs, targetCampus: bulkTargetCampus, senderCampus: currentUser.campus });
                  setBulkCampusTransferMode(false);
                }}
                disabled={!bulkTargetCampus}
                className="font-bold transition-colors shrink-0 disabled:opacity-50 hover:bg-blue-700 shadow-sm"
                style={{
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  padding: '8px 16px',
                  fontSize: '13px',
                  borderRadius: '9999px',
                }}
              >
                Onayla
              </button>

              <button
                onClick={() => setBulkCampusTransferMode(false)}
                className="flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0 transition-colors rounded-full"
                style={{ width: '34px', height: '34px' }}
              >
                <X size={20} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* YENİ ZİMMET / YENİ TRANSFER BUTONU (FLOATING ACTION BUTTON) */}
      {currentUser &&
        activeTab !== 'assign' &&
        activeTab !== 'qrScan' &&
        activeTab !== 'glpiMissing' &&
        activeTab !== 'systemAdmin' &&
        !isSigning &&
        !viewingHardwareId &&
        !viewingPersonId &&
        !returningData &&
        !showAddHardwareModal &&
        !showBulkHardwareImportModal &&
        !showBulkInitialAssignmentModal &&
        !transferModalObj &&  
        !showNewTransferModal && 
        !confirmDialog && 
        !showGroupModal && 
        selectedHardware.length === 0 &&
        selectedBulkHardware.length === 0 &&
        selectedBulkPersonnel.length === 0 &&
        selectedMissingGlpiIds.length === 0 && ( // <-- BU SATIR EKLENDI
          <div
            ref={newZimmetBtnRef} // Scroll mantığı için referans atandı
            className="btn-zimmet-wrapper print:hidden"
          >
            <style>{`
            .btn-zimmet-wrapper {
              position: fixed;
              z-index: 999999;
              bottom: 24px;
              right: 20px;
              transition: all 0.7s cubic-bezier(0.32, 0.72, 0, 1);
              transform-origin: bottom right;
            }
            .btn-zimmet-wrapper:hover {
              opacity: 1 !important;
              transform: scale(1) !important;
            }
            @media (min-width: 768px) {
              .btn-zimmet-wrapper {
                bottom: 48px;
                right: 48px;
              }
            }
            .btn-zimmet {
              display: flex;
              align-items: center;
              justify-content: center;
              background-color: #0066b1;
              color: #ffffff;
              border: 1px solid #004a82;
              border-radius: 9999px;
              padding: 10px 12px;
              font-weight: 700;
              font-size: 16px;
              cursor: pointer;
              box-shadow: 0 8px 20px rgba(0, 102, 177, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.2);
              transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            @media (min-width: 768px) {
              .btn-zimmet {
                padding: 14px 24px;
                font-size: 17px;
              }
            }
            .btn-zimmet:hover {
              background-color: #005595;
              box-shadow: 0 12px 25px rgba(0, 102, 177, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.25);
              transform: translateY(-2px);
            }
            .btn-zimmet:active {
              background-color: #003a66;
              box-shadow: 0 2px 8px rgba(0, 102, 177, 0.6), inset 0 4px 10px rgba(0, 0, 0, 0.4);
              transform: translateY(2px);
            }
            .btn-zimmet-icon {
              display: flex;
              align-items: center;
              justify-content: center;
              background-color: rgba(255, 255, 255, 0.15);
              padding: 6px;
              border-radius: 50%;
              margin-right: 14px;
              box-shadow: inset 0 1px 3px rgba(0,0,0,0.1);
              transition: background-color 0.2s ease;
            }
            @media (min-width: 768px) {
              .btn-zimmet-icon {
                margin-right: 18px;
                padding: 8px;
              }
            }
            .btn-zimmet:hover .btn-zimmet-icon {
              background-color: rgba(255, 255, 255, 0.25);
            }
          `}</style>

            {activeTab === 'transfer' ? (
              <button
                onClick={() => setShowNewTransferModal(true)}
                className="btn-zimmet"
              >
                <div className="btn-zimmet-icon">
                  <Send className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <span className="whitespace-nowrap tracking-wide">
                  Yeni Transfer
                </span>
              </button>
            ) : activeTab === 'hardware' ? (
              <button
                onClick={() => handleTabChange('qrScan')}
                className="btn-zimmet btn-zimmet--qr"
                aria-label="QR okut"
                title="QR Okut"
              >
                <div className="btn-zimmet-icon">
                  <QrCode className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <span className="qr-fab-label whitespace-nowrap tracking-wide">
                  QR Okut
                </span>
              </button>
            ) : (
              <button
                onClick={() => handleTabChange('assign')}
                className="btn-zimmet"
              >
                <div className="btn-zimmet-icon">
                  <Plus className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <span className="whitespace-nowrap tracking-wide">
                  Yeni Zimmet
                </span>
              </button>
            )}
          </div>
        )}

      {/* YENİ: ŞIK ONAY (CONFIRM) KUTUSU */}
      {confirmDialog && (
        <div className="app-modal-backdrop fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm" style={{ zIndex: 99999999 }}>
          <div className="app-modal-panel bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full text-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${confirmDialog.type === 'danger' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-[#0066b1]'}`}>
              <span className="text-3xl">⚠️</span>
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Emin misiniz?</h3>
            <p className="text-sm text-gray-600 font-medium leading-relaxed mb-8">{confirmDialog.message}</p>
            <div className="flex w-full gap-3">
              <button onClick={() => setConfirmDialog(null)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-colors">İptal Et</button>
              <button onClick={confirmDialog.onConfirm} className={`flex-1 py-3 text-white font-bold rounded-xl shadow-md transition-all hover:-translate-y-0.5 ${confirmDialog.type === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#0066b1] hover:bg-[#005595]'}`}>Evet, Onaylıyorum</button>
            </div>
          </div>
        </div>
      )}

      {/* YENİ: ZİMMETLİ CİHAZ UYARI MODALI */}
      {showZimmetliOnayModal && (
        <div className="app-modal-backdrop fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm" style={{ zIndex: 99999999 }}>
          <div className="app-modal-panel bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-amber-100 text-amber-600">
              <span className="text-3xl">⚠️</span>
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Dikkat! Cihaz Zaten Zimmetli</h3>
            <p className="text-sm text-gray-600 font-medium leading-relaxed mb-4">Seçtiğiniz cihazlardan bazıları şu anda başka personellere zimmetli görünüyor:</p>
            
            <div className="w-full bg-amber-50 p-3 rounded-xl border border-amber-100 max-h-32 overflow-y-auto mb-6 text-left">
              {zimmetliCihazlarListesi.map((h) => {
                const owner = personnelById.get(h.assignedTo)?.name || 'Bilinmiyor';
                return (
                  <div key={h.id} className="text-xs font-bold text-amber-800 mb-1 truncate">
                    • {h.brand} {h.model} <span className="text-amber-600 font-medium">(Mevcut: {owner})</span>
                  </div>
                );
              })}
            </div>
            
            <p className="text-xs text-gray-500 font-medium mb-6">Devam ederseniz, eski zimmetler <strong>otomatik olarak düşülecek</strong> ve cihazlar yeni personele atanacaktır. Onaylıyor musunuz?</p>
            
            <div className="flex w-full gap-3">
              <button onClick={() => setShowZimmetliOnayModal(false)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-colors">İptal Et</button>
              <button onClick={() => { setShowZimmetliOnayModal(false); setIsSigning(true); }} className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-md transition-all">Yine de Devam Et</button>
            </div>
          </div>
        </div>
      )}

      {/* YÜKLENİYOR / BAŞARI EKRANI (SMOOTH TRANSITION) */}
      {(isGenerating || successMessage) && (
        <div 
          className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300" 
          style={{ zIndex: 9999999999 }}
        >
          <div 
            className="bg-white rounded-3xl shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-700 ease-out" 
            style={{ 
              width: '320px', 
              height: '260px', 
              padding: '32px', 
              transform: successMessage ? 'scale(1.03)' : 'scale(1)',
              boxShadow: successMessage ? '0 20px 40px rgba(34, 197, 94, 0.2)' : '0 20px 40px rgba(0, 0, 0, 0.15)'
            }}
          >
            {/* Ortadaki İkon Kutusu (Maviden Yeşile Yumuşak Geçiş) */}
            <div className="relative mb-6 w-20 h-20 flex items-center justify-center shrink-0">
              
              {/* Arka Plan Dış Çemberi (Sürekli Dönüşen Renk) */}
              <div 
                className={`absolute inset-0 rounded-full border-4 shadow-lg transition-all duration-700 ease-in-out ${
                  successMessage 
                    ? 'bg-green-50 border-green-500 scale-100' 
                    : 'bg-white border-[#0066b1]/30 scale-100'
                }`}
              ></div>

              {/* Mavi Ping Animasyonu (Sadece Yüklenirken Görünür) */}
              {!successMessage && (
                <div className="absolute inset-0 bg-blue-200 rounded-full animate-ping opacity-60 duration-1000"></div>
              )}

              {/* Ikonlar (Biri kaybolurken digeri belirir) */}
              <div className="relative z-10 w-full h-full flex items-center justify-center">
                {/* Yükleniyor Çarkı */}
                <Loader2 
                  className={`absolute w-10 h-10 transition-all duration-500 ease-in-out animate-spin ${
                    successMessage ? 'opacity-0 scale-50 text-green-500' : 'opacity-100 scale-100 text-[#0066b1]'
                  }`} 
                />
                
                {/* Başarılı Tik Isareti */}
                <CheckCircle2 
                  className={`absolute w-10 h-10 transition-all duration-500 delay-150 ease-out ${
                    successMessage ? 'opacity-100 scale-100 text-green-600' : 'opacity-0 scale-150 text-[#0066b1]'
                  }`} 
                />
              </div>
            </div>

            {/* Metin Alanı (Yumuşak Metin Geçişi) */}
            <div className="w-full flex flex-col items-center justify-start text-center h-[104px] relative overflow-hidden">
              
              {/* Yükleniyor Metni */}
              <div 
                className={`absolute w-full transition-all duration-500 flex flex-col items-center ${
                  successMessage ? 'opacity-0 -translate-y-4 pointer-events-none' : 'opacity-100 translate-y-0'
                }`}
              >
                <h3 className="text-xl font-black mb-1.5 text-gray-800">İşlem Tamamlanıyor...</h3>
                <p className="text-[13px] text-gray-500 font-medium leading-tight px-2">
                  Lütfen sekmeyi kapatmayın, sistem güncelleniyor.
                </p>
              </div>

              {/* Başarılı Metni */}
              <div 
                className={`absolute w-full transition-all duration-500 delay-100 flex flex-col items-center ${
                  successMessage ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'
                }`}
              >
                <h3 className="text-xl font-black mb-1.5 text-green-700">İşlem Başarılı!</h3>
                <p className="text-[13px] text-gray-600 font-medium leading-[1.5] px-2 pb-1">
                  {successMessage}
                </p>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* GRUP OLUŞTURMA MODALI (iPad Klavye Bug Kesin Çözümü) */}
      {showGroupModal && (
        <div 
          className="app-modal-backdrop fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm"
          style={{ zIndex: 999999 }}
          onPointerDown={(e) => {
            // Arka plana tiklayinca klavyeyi kapat (blur)
            if (e.target === e.currentTarget) document.activeElement.blur();
          }}
        >
          <div 
            className="app-modal-panel bg-white p-6 rounded-3xl shadow-2xl flex flex-col max-w-sm w-full"
            onPointerDown={(e) => e.stopPropagation()} // iOS Safari'nin tiklamayi yutmasini engeller
          >
            <h3 className="text-lg font-black text-gray-900 mb-2 flex items-center gap-2">
              <Tag className="w-5 h-5 text-purple-600" /> Cihazlar? Grupla
            </h3>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              Seçilen <strong className="text-[#0066b1]">{selectedBulkHardware.length} adet</strong> cihazı bir gruba atayın.
            </p>
            
            <div className="relative w-full z-50">
              <input
                list="existing-groups" 
                type="text" 
                placeholder="Grup Adi Girin"
                value={groupNameInput} 
                onChange={(e) => setGroupNameInput(e.target.value)}
                onKeyDown={(e) => { 
                  if (e.key === 'Enter' && !isGenerating) handleAssignGroup(); 
                }}
                // BÜYÜK DÜZELTME BURADA: iOS Safari için zorunlu metin seçme ve focus özellikleri eklendi
                style={{ WebkitUserSelect: 'text', userSelect: 'text', WebkitTouchCallout: 'default' }}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#0066b1] outline-none text-[16px] font-bold text-gray-700 mb-2"
              />
              <datalist id="existing-groups">
                {Array.from(new Set(campusHardware.map((h) => h.groupName).filter(Boolean))).map((g) => <option key={g} value={g} />)}
              </datalist>
            </div>

            <div className="flex w-full gap-3 mt-4">
              <button 
                onClick={() => {
                  setShowGroupModal(false);
                  setGroupNameInput(''); // Kapatınca input içini de sıfırla
                }} 
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors text-sm"
              >
                İptal Et
              </button>
              <button 
                onClick={handleAssignGroup} 
                disabled={isGenerating} 
                className="flex-1 py-3 bg-[#0066b1] hover:bg-[#005595] text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50 text-sm flex justify-center items-center gap-2"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />} Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
      {/* EASTER EGG MODAL EKRANI */}
      {showEasterEgg && (
        <div className="fixed inset-0 flex items-center justify-center animate-in zoom-in duration-200" style={{ zIndex: 999999999999, backgroundColor: 'rgba(0,0,0,0.95)' }}>
          <button onClick={() => setShowEasterEgg(false)} className="fixed top-6 right-6 md:top-10 md:right-10 text-white p-3 rounded-full transition-all z-[99999] border-2 border-white/20 bg-black/40 hover:bg-red-600 hover:border-red-600 shadow-xl" title="Kapat">
            <X className="w-8 h-8 md:w-10 md:h-10" />
          </button>
          <div className="flex flex-col items-center justify-center text-center p-4 w-full max-w-4xl">
            <img
              src="/huseyin-mode.jpg"
              alt="Hüseyin modu"
              loading="eager"
              decoding="async"
              draggable={false}
              className="w-full max-w-[600px] max-h-[70vh] rounded-3xl border-4 border-[#0066b1] mb-6 object-contain shadow-[0_0_40px_rgba(0,102,177,0.4)]"
            />
            <h2 className="text-3xl md:text-5xl font-black text-white drop-shadow-[0_5px_15px_rgba(0,0,0,1)]">
              Tebrikler! Hüseyin modunu açtınız! 👨‍💻
            </h2>
          </div>
        </div>
      )}
    </div>
  );
}
