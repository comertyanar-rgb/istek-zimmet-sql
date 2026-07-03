import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { jwtDecode } from 'jwt-decode';
import {
  RefreshCw,
  Monitor,
  Users,
  FileSignature,
  LogOut,
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
  MoreVertical,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  Tag,
  Terminal,
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import * as XLSX from 'xlsx';

// --- YOUR LIVE GOOGLE APPS SCRIPT URL ---
const GAS_URL =
  'https://script.google.com/macros/s/AKfycbzTTHM21Flpg6h7DI66UZStTc8ttdIuX95mcvKa4irjsR61IWAqgmMkyIyN20sUFnAW-A/exec';
// --- GOOGLE CLOUD CLIENT ID ---
const GOOGLE_CLIENT_ID =
  '333289043957-05l0hq2r1aqafnclifl9dnvipkr99ba5.apps.googleusercontent.com';

// --- KAMPÜS KODLARI (Bilgisayar İsimlendirmesi İçin) ---
const CAMPUS_CODES = {
  'Atanur Oğuz Kampüsü': 'AO',
  'Acıbadem Kampüsü': 'AB',
  'Kemal Atatürk Kampüsü': 'KA',
  'Uluğbey Kampüsü': 'UB',
  'Kaşgarlı Mahmut Kampüsü': 'KM',
  'Antalya Kampüsü (Konyaaltı)': 'AK',
  'İzmir Kampüsü': 'İO',
  'Semiha Şakir Kampüsü': 'SS',
  'Bilge Kağan Kampüsü': 'BK',
  'Antalya Kampüsü (Lara)': 'AL',
  'Ankara Kampüsü': 'AN',
  'Genel Müdürlük': 'GM',
  'Belde Kampüsü': 'BE',
};

const TYPE_BRANDS = {
  Laptop: ['Lenovo', 'HP', 'Dell', 'Apple', 'Asus', 'Casper', 'Diğer'],
  'Masaüstü (PC)': ['Lenovo', 'HP', 'Dell', 'Asus', 'Casper', 'Apple', 'Diğer'],
  'All in One PC': ['Lenovo', 'HP', 'Dell', 'Asus', 'Casper', 'Apple', 'Diğer'],
  Tablet: ['Apple', 'Samsung', 'Lenovo', 'Diğer'],
  Monitör: [
    'Samsung',
    'Philips',
    'ViewSonic',
    'AOC',
    'Lenovo',
    'HP',
    'Dell',
    'Asus',
    'Diğer',
  ],
  // YENİ EKLENEN KATEGORİ:
  'Klavye ve Mouse Seti': [
    'Logitech',
    'A4Tech',
    'Everest',
    'Lenovo',
    'HP',
    'Dell',
    'Diğer',
  ],
  Mouse: [
    'Logitech',
    'A4Tech',
    'Everest',
    'Apple',
    'Lenovo',
    'HP',
    'Dell',
    'Asus',
    'Diğer',
  ],
  Klavye: [
    'Logitech',
    'A4Tech',
    'Everest',
    'Apple',
    'Lenovo',
    'HP',
    'Dell',
    'Asus',
    'Diğer',
  ],
  Webcam: ['Logitech', 'A4Tech', 'Diğer'],
  'Hard Drive': ['Samsung', 'Diğer'],
  Diğer: ['Diğer'],
};
// --- TÜRKÇE KARAKTER UYUMLU ARAMA İÇİN GEREKLİ FONKSİYON (BEYAZ EKRAN ÇÖZÜMÜ) ---
const toTrLower = (str) => {
  if (!str) return '';
  return String(str)
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
};

const BRANDS_MODELS = {
  Lenovo: [
    'ThinkPad E15',
    'ThinkPad E14',
    'V15',
    'IdeaPad',
    'ThinkCentre',
    'All in One (AIO)',
    'Diğer',
  ],
  HP: [
    'ProBook',
    'EliteBook',
    'Pavilion',
    '250 G8',
    'ProDesk',
    'All in One (AIO)',
    'Victus',
    'Diğer',
  ],
  Dell: [
    'Latitude',
    'Vostro',
    'OptiPlex',
    'Inspiron',
    'All in One (AIO)',
    'Diğer',
  ],
  Apple: ['MacBook Air', 'MacBook Pro', 'iMac', 'Mac mini', 'Diğer'],
  Asus: ['ZenBook', 'VivoBook', 'ExpertBook', 'All in One (AIO)', 'Diğer'],
  Casper: ['Nirvana', 'Excalibur', 'All in One (AIO)', 'Diğer'],
  Logitech: [
    'MK220 (Set)',
    'MK235 (Set)',
    'MK240 (Set)',
    'MK270 (Set)',
    'M170 (Mouse)',
    'M185 (Mouse)',
    'M220 (Mouse)',
    'Standart Klavye',
    'Diğer',
  ],
  A4Tech: ['Standart Mouse', 'Standart Klavye', 'Diğer'],
  Everest: ['Standart Mouse', 'Standart Klavye', 'Diğer'],
  Samsung: ['Standart Monitör', 'Diğer'],
  Philips: ['Standart Monitör', 'Diğer'],
  ViewSonic: ['Standart Monitör', 'Diğer'],
  AOC: ['Standart Monitör', 'Diğer'],
  Diğer: ['Standart', 'Diğer'],
};

// --- YENİ: KOPYALAMA BİLEŞENİ ---
const ClipboardCopy = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation(); // Karta tıklanmasını engeller
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md hover:bg-gray-200 transition-colors flex items-center justify-center bg-white border border-gray-200 shadow-sm ml-1"
      title="Kopyala"
    >
      {copied ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-gray-500" />
      )}
    </button>
  );
};

// Biyometrik Veriden Arındırılmış Yasal Signature Pad (Genişletildi ve Çoklu Çizim Eklendi)
const SignaturePad = ({ onSign, label }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false); // Çizim yapıldı mı?
  const [isConfirmed, setIsConfirmed] = useState(false); // İmza onaylandı mı?

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX = e.clientX;
    let clientY = e.clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  };

  const startDrawing = (e) => {
    if (isConfirmed) return; // Onaylandıysa çizmeyi engelle
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e) => {
    if (!isDrawing || isConfirmed) return;
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const confirmSignature = (e) => {
    e.preventDefault();
    if (!hasDrawn) return;
    const simpleHash = `İMZA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    onSign({ image: canvasRef.current.toDataURL('image/png'), hash: simpleHash });
    setIsConfirmed(true);
  };

  const clear = (e) => {
    if(e) e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    setIsConfirmed(false);
    onSign(null);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[320px] mx-auto relative animate-in zoom-in-95">
      <div className="relative w-full mb-2 flex justify-center bg-gray-50/50 rounded-xl">
        <canvas
          ref={canvasRef} 
          width={600} 
          height={320} /* DÜZELTME: HTML boyutu artırıldı ki kalite düşmesin */
          style={{ width: '100%', height: '170px', touchAction: 'none', opacity: isConfirmed ? 0.5 : 1 }} /* DÜZELTME: CSS boyutu 100px'den 170px'e çıkarıldı */
          className={`cursor-crosshair bg-white border-2 rounded-xl w-full shadow-inner ${isConfirmed ? 'border-green-500' : 'border-dashed border-gray-300'}`}
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
        />
        
        <button onClick={clear} className="absolute top-2 right-2 text-[10px] font-bold bg-white px-2.5 py-1.5 rounded-lg text-red-500 shadow border border-gray-200 hover:bg-red-50">
          Temizle
        </button>

        {hasDrawn && !isConfirmed && (
           <button onClick={confirmSignature} className="absolute top-2 left-2 text-[10px] font-bold bg-green-600 px-3 py-1.5 rounded-lg text-white shadow border border-green-700 hover:bg-green-700 animate-in fade-in flex items-center gap-1">
             <CheckCircle2 className="w-3 h-3"/> Onayla
           </button>
        )}
      </div>
      <span className={`text-[11px] font-bold text-center uppercase tracking-wide ${isConfirmed ? 'text-green-600' : 'text-gray-500'}`}>
        {isConfirmed ? 'İmza Kaydedildi ✓' : label}
      </span>
    </div>
  );
};

// YENİ: E-POSTA DOĞRULAMA (OTP) BİLEŞENİ (2 DAKİKA SAYAÇLI)
const OtpVerification = ({ personName, personEmail, onVerified, currentUser }) => {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(120); // 2 Dakika = 120 Saniye

  // Geri Sayım Mantığı
  useEffect(() => {
    if (step !== 2 || timeLeft <= 0) return;
    const timerId = setInterval(() => {
      setTimeLeft((prevTime) => prevTime - 1);
    }, 1000);
    return () => clearInterval(timerId);
  }, [step, timeLeft]);

  // Dakika ve Saniyeyi Formata Çevirme (Örn: 01:45)
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const sendCode = async (e) => {
    if(e) e.preventDefault();
    if (!personEmail) return alert("Hata: Personelin e-posta adresi sistemde yok.");
    setLoading(true);
    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'sendOTP', personEmail, personName, authToken: currentUser.token }),
      });
      const data = await response.json();
      if (data.success) {
        setStep(2);
        setTimeLeft(120); // Tekrar gönderildiğinde sayacı başa sar
        setCode('');
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      alert("Kod gönderilemedi: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    if (code.length !== 6 || timeLeft <= 0) return;
    setLoading(true);
    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'verifyOTP', personEmail, otpCode: code, authToken: currentUser.token }),
      });
      const data = await response.json();
      if (data.success) {
        onVerified({ email: personEmail, time: new Date().toLocaleString('tr-TR'), hash: data.hash });
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      alert("Doğrulama Başarısız: " + error.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[320px] mx-auto bg-blue-50/50 p-4 rounded-xl border border-blue-100 shadow-sm mt-4 mb-4 animate-in slide-in-from-top-2">
      <span className="text-[11px] font-extrabold text-[#0066b1] text-center uppercase tracking-wide mb-3">
        E-Posta Doğrulama Kodu
      </span>
      
      {step === 1 ? (
        <button onClick={sendCode} disabled={loading} className="w-full py-2.5 bg-[#0066b1] text-white text-xs font-bold rounded-lg shadow-md hover:bg-[#005595] transition-colors flex justify-center items-center h-10">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Personele Kod Gönder"}
        </button>
      ) : (
        <div className="w-full flex flex-col items-center animate-in fade-in">
          <p className="text-[10px] text-gray-600 mb-2 text-center leading-relaxed">
            <strong>{personEmail}</strong> adresine gelen 6 haneli kodu giriniz:
          </p>
          
          <input
            type="text"
            inputMode="numeric" // YENİ: SADECE RAKAM KLAVYESİ AÇAR
            pattern="[0-9]*"    // YENİ: iOS'u rakam klavyesine zorlar
            maxLength={6} 
            value={code} 
            disabled={timeLeft <= 0 || loading}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="000000"
            style={{ WebkitUserSelect: 'auto', userSelect: 'auto' }}
            className="w-full text-center text-2xl font-black tracking-[0.4em] p-2 border-2 border-blue-300 rounded-lg outline-none focus:border-[#0066b1] mb-3 bg-white text-[#0066b1] h-12 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200 transition-all"
          />

          {timeLeft > 0 ? (
            <>
              <p className="text-xs font-bold text-amber-600 mb-3 flex items-center gap-1.5">
                ⏳ Kalan Süre: <span className="font-black">{formatTime(timeLeft)}</span>
              </p>
              <button onClick={verifyCode} disabled={loading || code.length !== 6} className="w-full py-2.5 bg-green-600 text-white text-xs font-bold rounded-lg shadow-md hover:bg-green-700 transition-colors flex justify-center items-center h-10 disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Kodu Onayla ve İmzaya Geç"}
              </button>
            </>
          ) : (
            <>
              <p className="text-xs font-bold text-red-500 mb-3 flex items-center gap-1.5">
                <X className="w-3.5 h-3.5"/> Kodun Süresi Doldu!
              </p>
              <button onClick={sendCode} disabled={loading} className="w-full py-2.5 bg-slate-800 text-white text-xs font-bold rounded-lg shadow-md hover:bg-slate-900 transition-colors flex justify-center items-center h-10">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tekrar Kod İste"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};


// --- YENİ: PAGINATION COMPONENT ---
const Pagination = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center space-x-2 py-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-sm"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <span className="text-sm font-medium text-gray-700 px-4">
        Sayfa {currentPage} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors shadow-sm"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
};

// --- MAIN APP ---
export default function App() {
  // YENİ: PWA (Mobil Uygulama) Otomatik Güncelleme Sistemi
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Service worker başarıyla kaydedildi
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });
  // --- EASTER EGG STATES ---
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [showEasterEgg, setShowEasterEgg] = useState(false);

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('istek_it_user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        // BEYAZ EKRAN ÇÖZÜMÜ: Eğer isim verisi yoksa veya bozuksa çökmeyi önlemek için anında sil ve baştan giriş iste!
        if (!parsed || !parsed.expiresAt || Date.now() > parsed.expiresAt || !parsed.name || typeof parsed.name !== 'string') {
          localStorage.removeItem('istek_it_user');
          return null; 
        }
        return parsed;
      }
    } catch(e) {
      localStorage.removeItem('istek_it_user');
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
        localStorage.removeItem('istek_it_user');
        setCurrentUser(null);
      } else {
        const timer = setTimeout(() => {
          alert("Oturum süreniz (6 saat) doldu. Güvenlik amacıyla sistemden otomatik çıkış yapıldı.");
          localStorage.removeItem('istek_it_user');
          setCurrentUser(null);
        }, timeLeft);
        return () => clearTimeout(timer);
      }
    }
  }, [currentUser]);

  const [activeTab, setActiveTab] = useState('hardware');
  // YENİ: Yasal Geçerlilik İçin IP State'i
  const [clientIp, setClientIp] = useState('Alınıyor...');
  const [successMessage, setSuccessMessage] = useState(null); // İşlem başarılı olduğunda yeşil tik ile çıkacak mesaj
  const [generatedSheetUrl, setGeneratedSheetUrl] = useState(null); // YENİ: Sheets Linki İçin Modal State

  useEffect(() => {
    // Sayfa açıldığında IP adresini çek (Hukuki Log İçin)
    fetch('https://api.ipify.org?format=json')
      .then((res) => res.json())
      .then((data) => setClientIp(data.ip))
      .catch(() => setClientIp('Bulunamadı'));
  }, []);

  const headerRef = useRef(null);
  const floatingBtnsRef = useRef(null);
  const newZimmetBtnRef = useRef(null);
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
          lastScrollY.current = currentY;
        }
        scrollTimer.current = null;
      }, 50);
    }
  };

// Yeni Menü State'leri
const [showHardwareFilters, setShowHardwareFilters] = useState(false);
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
  // OPTIMISTIC UI: Bekleme ekranı yok, anında işlem!
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

  // 1. Olası hataya karşı eski veriyi sakla
  const previousHardwareState = [...hardware];

  // 2. Arayüzü anında güncelle ve modal düzenlemesini kapat
  setHardware((prev) =>
    prev.map((h) =>
      h.id === hardwareId ? { ...h, groupName: finalGroupName } : h
    )
  );
  setIsEditingSingleGroup(false);

  // 3. Arka planda sessizce sunucuya gönder
  fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({
      authToken: currentUser.token, 
      action: 'bulkUpdateGroup',
      hardwareIds: [hardwareId], 
      groupName: finalGroupName,
    }),
  })
  .then(response => response.json())
  .then(result => {
    if (!result.success) throw new Error(result.error);
    // Başarılıysa arka planda verileri yenile
    fetchVeritabani(false);
  })
  .catch(error => {
    console.error('Grup Kayıt Hatası:', error);
    setHardware(previousHardwareState); // Hata olursa ekranı eski haline döndür
    alert('İnternet veya sunucu hatası nedeniyle cihaz gruba atanamadı.');
  });
};

// --- YENİ: CİHAZ NOTU (DURUM) STATES VE FONKSİYONU ---
const [isEditingNote, setIsEditingNote] = useState(false);
const [editNoteText, setEditNoteText] = useState('');
const [isUpdatingNote, setIsUpdatingNote] = useState(false);

const handleSaveNote = async (hardwareId) => {
  setIsUpdatingNote(true);
  try {
    fetch(GAS_URL, {
      method: 'POST',
      body: JSON.stringify({
       authToken: currentUser.token,
        action: 'updateHardware',
        hardwareId: hardwareId,
        updates: { notes: editNoteText },
      }),
    }).catch((err) => console.error('Not kayıt hatası:', err));

    setHardware((prev) =>
      prev.map((h) => (h.id === hardwareId ? { ...h, notes: editNoteText } : h))
    );
    setIsEditingNote(false);
  } catch (error) {
    alert('Hata: Not kaydedilemedi. ' + error.message);
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
  // OPTIMISTIC UI: Bekleme ekranı yok, anında işlem!
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

  // 1. Olası hataya karşı eski durumu sakla
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
  setSuccessMessage(`${selectedIdsToProcess.length} cihaz "${finalGroupName || 'Grup Yok'}" grubuna atandı.`);
  setTimeout(() => setSuccessMessage(null), 2000);

  // 4. Arka planda sessizce sunucuya ilet
  fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({
     authToken: currentUser.token,
      action: 'bulkUpdateGroup',
      hardwareIds: selectedIdsToProcess,
      groupName: finalGroupName,
    }),
  })
  .then(response => response.json())
  .then(result => {
    if (!result.success) throw new Error(result.error);
    fetchVeritabani(false); // Başarılıysa arka planda önbelleği güncelle
  })
  .catch(error => {
    console.error('Toplu Grup Kayıt Hatası:', error);
    setHardware(previousHardwareState); // Sunucu çökerse ekranı geri al
    alert('Hata: İnternet sorunu nedeniyle cihazlar gruba atanamadı.');
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

  // Personel Tablosu İçin Seçim State'
  const [selectedBulkPersonnel, setSelectedBulkPersonnel] = useState([]);

  // Sıralama (Sorting) States
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

  // --- YENİ DONANIM EKLEME STATES ---
  const [showAddHardwareModal, setShowAddHardwareModal] = useState(false);
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
      return alert(
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
      return alert(
        `HATA: "${newHardwareForm.serial}" seri numaralı bir cihaz sistemde zaten kayıtlı!`
      );
    }

    let finalDeviceName = '';
    // BİLGİSAYAR İSMİ ARTIK ZORUNLU DEĞİL. Sadece içi doluysa 4 hane kontrolü yapar.
    if (showComputerName && newHardwareForm.computerNumber.trim() !== '') {
      if (!/^\d{4}$/.test(newHardwareForm.computerNumber)) {
        return alert(
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

      fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
         authToken: currentUser.token,
          action: 'addHardware',
          hardware: newHardwareItem,
        }),
      }).catch((err) => console.error('Script hatası:', err));

      setHardware((prev) => [newHardwareItem, ...prev]);

      setSuccessMessage('Yeni donanım başarıyla depoya eklendi.');
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
      alert('Hata: ' + error.message);
    } finally {
      setIsAddingHardware(false);
    }
  };
  const handleSaveDeviceName = async (hardwareId, prefix) => {
    if (
      editComputerNumber.trim() !== '' &&
      !/^\d{4}$/.test(editComputerNumber)
    ) {
      return alert(
        'Lütfen bilgisayar ismi için tam 4 haneli bir sayı girin (Örn: 0045) veya boş bırakın.'
      );
    }

    // Prefix ve Numarayı React tarafında birleştiriyoruz. (Örn: IANLAP0015)
    const finalDeviceName =
      editComputerNumber.trim() !== '' ? `${prefix}${editComputerNumber}` : '';
    setIsUpdatingName(true);

    try {
      fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
         authToken: currentUser.token,
          action: 'updateHardware',
          hardwareId: hardwareId,
          updates: {
            deviceName: finalDeviceName, // Backend artık tek bir string bekliyor
          },
        }),
      }).catch((err) => console.error('Kayıt hatası:', err));

      setHardware((prev) =>
        prev.map((h) =>
          h.id === hardwareId ? { ...h, deviceName: finalDeviceName } : h
        )
      );
      setIsEditingDeviceName(false);
    } catch (error) {
      alert('Hata: ' + error.message);
    } finally {
      setIsUpdatingName(false);
    }
  };
  const handleMissingDocumentUpload = async () => {
    if (!manualUploadFile || !viewedHardwarePerson) return;

    const isImage = manualUploadFile.type.startsWith('image/');
    const extension = isImage ? '.jpg' : '.pdf';
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

      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
         authToken: currentUser.token,
          action: 'uploadMissingDocument',
          pdfName: filename,
          pdfData: base64String,
          campus: currentUser.campus,
          personName: viewedHardwarePerson.name,
          hardwareId: viewedHardware.id,
        }),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

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

      setSuccessMessage('Fotoğraf/Belge başarıyla cihaza eklendi.');
setTimeout(() => setSuccessMessage(null), 2500);
      setManualUploadFile(null);
    } catch (error) {
      alert('Hata: ' + error.message);
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
  const [assignFilterType, setAssignFilterType] = useState('All');
  const [assignSearchQuery, setAssignSearchQuery] = useState('');
  const [campusFilter, setCampusFilter] = useState('All');
  const [personSearch, setPersonSearch] = useState('');

  // Filtreler veya arama değiştiğinde Pagination'ı 1. sayfaya sıfırla
  useEffect(() => {
    setHardwarePage(1);
  }, [hardwareFilterType, hardwareSearchQuery, campusFilter]);

  useEffect(() => {
    setPersonnelPage(1);
  }, [personnelSearchQuery, campusFilter, personnelFilterStatus]);

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
    const hw = hardware.find(h => h.id === hwId);
    
    // Eğer daha önce çektiysek veya zaten geçmişi yoksa sunucuyu yorma
    if (hw.historyLoaded || !hw.hasHistory) return;

    setIsLoadingHistory(true);
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'fetchHardwareHistory', authToken: currentUser.token, hardwareId: hwId })
      });
      const result = await res.json();
      if (result.success) {
        setHardware(prev => prev.map(h => h.id === hwId ? { ...h, history: result.history, historyLoaded: true } : h));
      }
    } catch(e) {
      console.error("Geçmiş çekilemedi");
    } finally {
      setIsLoadingHistory(false);
    }
  };
  // Personel profilindeki geçmişi açıp kapatmak için EKLENDİ
  const [showPersonHistory, setShowPersonHistory] = useState(false);
  // Kopyalandı efektleri için
  const [copiedSerial, setCopiedSerial] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  // Personel Sekmesi Mobil Filtre Görünürlüğü
  const [showPersonnelFilters, setShowPersonnelFilters] = useState(false);
  const viewedHardware = viewingHardwareId
    ? hardware.find((h) => h.id === viewingHardwareId)
    : null;
  // TRANSFER durumundaki sahte atamaları personel profili olarak açmasını engeller
  const viewedHardwarePerson =
    viewedHardware?.assignedTo && viewedHardware?.status !== 'Transfer'
      ? personnel.find(
          (p) =>
            p.id === viewedHardware.assignedTo &&
            !String(p.name).toUpperCase().includes('GÖNDEREN:')
        )
      : null;

  const [viewingPersonId, setViewingPersonId] = useState(null);
  const viewedPerson = viewingPersonId
    ? personnel.find((p) => p.id === viewingPersonId)
    : null;

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

  // URL Formatter
  const formatDriveUrlForEmbed = (url) => {
    if (!url) return '';

    // YENİ: URL'den Google Drive ID'sini çıkart
    let fileId = '';
    const match = url.match(/\/d\/(.*?)\//);
    if (match && match[1]) {
      fileId = match[1];
    }

    // Mobil cihaz mı kontrol et (Daha güvenli bir yöntem)
    const isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      ) || window.innerWidth < 768;

    if (fileId) {
      // Mobilde (Brave dahil) iframe içinde açılması için en garantili yöntem (Google Docs Viewer)
      if (isMobile) {
        return `https://docs.google.com/viewer?url=${encodeURIComponent(
          `https://drive.google.com/uc?export=download&id=${fileId}`
        )}&embedded=true`;
      }
      // Masaüstünde standart preview
      return `https://drive.google.com/file/d/${fileId}/preview`;
    }

    if (url.includes('/preview')) return url;
    if (url.includes('drive.google.com'))
      return url.replace(/\/view.*/, '/preview');
    return url;
  };

  const handlePdfClick = (url, title) => {
    if (!url) {
      setPreviewPdf(null);
      return;
    }

    if (url.startsWith('blob:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = title.endsWith('.pdf') ? title : `${title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      // Mobil cihaz algılama (768px altı)
      const isMobile = window.innerWidth < 768;

      if (isMobile) {
        // Mobilde modal açmak yerine doğrudan yeni sekmede/native okuyucuda aç (Kesin çözüm)
        window.open(url, '_blank');
      } else {
        // Masaüstünde modal (iframe) içinde aç
        setPreviewPdf({ url, title });
      }
    }
  };

  // YENİ: Yenileme Butonu İçin State
  const [isRefreshing, setIsRefreshing] = useState(false);

  // GÜVENLİ HALE GETİRİLMİŞ VERİ ÇEKME FONKSİYONU
  const fetchVeritabani = async (showLoader = false) => {
    // Güvenlik duvarı: Oturum yoksa veya token yoksa veritabanına istek atma!
    if (!currentUser || !currentUser.token) return; 

    if (showLoader) setIsRefreshing(true);
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST', // Artık GET değil POST yapıyoruz
        body: JSON.stringify({
          action: 'fetchData',
          authToken: currentUser.token // Güvenlik Anahtarını Gönderiyoruz
        })
      });
      const data = await res.json();
      
      if (!data.success) throw new Error(data.error); // Token patlamışsa hata ver

      setPersonnel(data.personnel || []);
      setHardware(data.hardware || []);
      localStorage.setItem('istek_it_cache', JSON.stringify(data));
    } catch (err) {
      console.error('Veri çekme hatası:', err);
      if (showLoader) alert('Veriler yenilenirken hata oluştu: ' + err.message);
    } finally {
      if (showLoader) setIsRefreshing(false);
    }
  };

  // ÇÖZÜM 1: HTML2PDF SADECE 1 KEZ YÜKLENİR (BELLEK ŞİŞMESİ VE BEYAZ EKRAN ÇÖZÜMÜ)
  useEffect(() => {
    if (!document.getElementById('html2pdf-script')) {
      const script = document.createElement('script');
      script.id = 'html2pdf-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // --- GÜVENLİ İLK AÇILIŞ VE AKILLI ÖNBELLEK (CACHE) SİSTEMİ ---
  useEffect(() => {
    // KULLANICI GİRİŞ YAPMAMIŞSA (Login Ekranındaysa) HİÇBİR ŞEY YÜKLEME!
    if (!currentUser || !currentUser.token) {
      setIsLoading(false);
      return;
    }

    const cachedData = localStorage.getItem('istek_it_cache');

    if (cachedData) {
      const parsed = JSON.parse(cachedData);
      setPersonnel(parsed.personnel || []);
      setHardware(parsed.hardware || []);
      setIsLoading(false);
      
      fetchVeritabani(false); // Arka planda yenile
    } else {
      // Hafıza boşsa Google'dan zorla bekleterek çek
      setIsLoading(true); 
      fetchVeritabani(true).then(() => setIsLoading(false));
    }
  }, [currentUser]);

  // --- XLSX VE GOOGLE SHEETS EXPORT FONKSİYONLARI ---
  // --- XLSX VE GOOGLE SHEETS EXPORT FONKSİYONLARI ---
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
            : 'Zimmetli',
        Personel: personnel.find((p) => p.id === item.assignedTo)?.name || '-',
        Kampüs: item.campus || '-',
      }));
    } else {
      // YENİ: Personel detaylı dışa aktarımı
      return data.map((person) => {
        // Bu personele zimmetli olan tüm donanımları bul
        const assignedHardware = hardware.filter((h) => h.assignedTo === person.id);

        // Donanımların detaylarını virgülle ayırarak tek satırda topla
        const cihazDetaylari = assignedHardware.length > 0 
          ? assignedHardware.map(h => `${h.brand} ${h.model}`).join('  |  ') 
          : '-';

        const seriNumaralari = assignedHardware.length > 0 
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
          'Seri Numaraları': seriNumaralari,
          'Zimmet Tutanak Linkleri': zimmetBelgeleri,
        };
      });
    }
  };

  const handleExportXLSX = (data, filename, type) => {
    if (data.length === 0) return alert('Dışa aktarılacak veri bulunamadı.');
    const formattedData = getFormattedDataForExport(data, type);
    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Liste');
    XLSX.writeFile(
      workbook,
      `${filename}_${new Date().toLocaleDateString('tr-TR')}.xlsx`
    );
  };

  const handleCreateGoogleSheet = async (data, type) => {
    if (data.length === 0) return alert('Aktarılacak veri bulunamadı.');

    // YENİ: window.confirm yerine şık Modal açıyoruz
    setConfirmDialog({
      message: `Seçilen ${data.length} adet kayıtla yeni bir Google E-Tablo (Sheets) dosyası oluşturulacak. Bu işlem birkaç saniye sürebilir. Onaylıyor musunuz?`,
      type: 'info',
      onConfirm: async () => {
        setConfirmDialog(null); // Modalı kapat
        setIsGenerating(true);  // Yükleniyor ekranını aç

        try {
          const formattedData = getFormattedDataForExport(data, type);
          const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
              authToken: currentUser.token,
              action: 'createSheet',
              sheetName: `Dışa Aktarım - ${
                type === 'hardware' ? 'Donanım' : 'Personel'
              } (${new Date().toLocaleDateString('tr-TR')})`,
              data: formattedData,
            }),
          });

          const result = await response.json();
          if (result.success && result.url) {
            // Başarılıysa linki ekrana Modal olarak bas (Pop-up engeline takılmamak için)
            setGeneratedSheetUrl(result.url);
          } else {
            alert('Hata: Google Sheets oluşturulamadı. ' + (result.error || ''));
          }
        } catch (err) {
          alert('İşlem başarısız: ' + err.message);
        } finally {
          setIsGenerating(false);
        }
      },
    });
  };

  // YENİ: OPTIMISTIC UI (İYİMSER ARAYÜZ) İLE IŞIK HIZINDA TOPLU İŞLEM
  const handleBulkAction = async (actionType, targetCampus = null) => {
    if (selectedBulkHardware.length === 0) return;

    let confirmMsg = '';
    let msgType = 'info';
    if (actionType === 'Depo') {
      confirmMsg = `${selectedBulkHardware.length} adet cihaz depoya çekilecek. Onaylıyor musunuz?`;
    } else if (actionType === 'Hurda') {
      confirmMsg = `${selectedBulkHardware.length} adet cihaz HURDAYA ayrılacak. Emin misiniz?`;
      msgType = 'danger';
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
        if (actionType === 'Depo' || actionType === 'Hurda') {
          fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
              authToken: currentUser.token,
              action: 'bulkStatusUpdate',
              hardwareIds: selectedIdsToProcess,
              newStatus: actionType === 'Depo' ? 'Available' : 'Hurda',
            }),
          })
          .then(response => response.json())
          .then(result => {
             if (!result.success) throw new Error(result.error);
             // Başarılıysa arka planda sessizce önbelleği yenile
             fetchVeritabani(false);
          })
          .catch(error => {
             console.error('Arka Plan Hatası:', error);
             // YENİ: EĞER SUNUCU ÇÖKERSE, EKRANI ESKİ HALİNE GERİ ÇEVİR VE UYAR!
             setHardware(previousHardwareState);
             alert(`UYARI: İnternet veya sunucu hatası nedeniyle "${actionType}" işlemi kaydedilemedi. Cihazlar eski durumuna döndürüldü.`);
          });
        }
      },
    });
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setIsLoggingIn(true); // YÜKLENİYOR EKRANINI AÇ
    const decoded = jwtDecode(credentialResponse.credential);

    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'verifyLogin',
          googleToken: credentialResponse.credential
        })
      });
      
      const result = await response.json();

      if (result.success) {
        const userData = {
          id: result.email,
          name: decoded.name || result.email.split('@')[0],
          email: result.email,
          role: result.role,
          campus: result.campus,
          picture: decoded.picture,
          token: result.sessionToken,
          expiresAt: Date.now() + (6 * 60 * 60 * 1000)
        };
        
        localStorage.setItem('istek_it_user', JSON.stringify(userData));
        
        // ÇÖZÜM 2: Google İframe'in aniden silinip DOM'u çökertmesini engellemek için milisaniyelik gecikme eklendi
        setTimeout(() => {
          setIsLoading(true);
          setCurrentUser(userData);
          setActiveTab('hardware');
        }, 150);
        
      } else {
        alert('Giriş Başarısız: ' + result.error);
      }
    } catch (error) {
      alert('Sunucuyla iletişim kurulamadı. İnternet bağlantınızı kontrol edin.');
    } finally {
      // Yükleniyor ekranını Google işlemleri tamamen bitince kapat
      setTimeout(() => setIsLoggingIn(false), 200); 
    }
  };

  const isHQ = currentUser?.campus === 'Genel Müdürlük';

  // --- YENİ: SADECE KAMPÜSÜN "ÖZ İSMİNE" BAKAN FİLTRE ---
  // (İçindeki "Kampüsü" kelimesini silip sadece "Acıbadem" veya "Antalya (Lara)" kısmını eşleştirir)
  const getCoreCampusName = (str) => {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/kampüsü/g, '')
      .replace(/kampusu/g, '')
      .replace(/kampüs/g, '')
      .replace(/kampus/g, '')
      .trim(); // Başındaki ve sonundaki boşlukları atar
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

  // 2. ARAMA VE DURUM FİLTRELERİ
  const displayHardware = useMemo(() => {
    return campusHardware.filter((h) => {
      const safeType = toTrLower(String(h.type || '').trim());
      const safeFilter = toTrLower(hardwareFilterType.trim());
      const matchType = hardwareFilterType === 'All' || safeType === safeFilter;

      let matchStatus = true;
      if (hardwareFilterStatus !== 'All') {
        if (hardwareFilterStatus === 'Zimmetli') matchStatus = h.status === 'Assigned';
        if (hardwareFilterStatus === 'Depoda') matchStatus = h.status === 'Available';
        if (hardwareFilterStatus === 'Hurda') matchStatus = h.status === 'Hurda';
        if (hardwareFilterStatus === 'Transfer') matchStatus = h.status === 'Transfer';
      }

      if (!hardwareSearchQuery) return matchType && matchStatus;

      const searchTerms = toTrLower(hardwareSearchQuery).split(/\s+/).filter(Boolean);
      const personName = personnel.find((p) => p.id === h.assignedTo)?.name || h.assignedTo || '';
      const combinedString = toTrLower(`${h.brand} ${h.model} ${h.serial} ${personName} ${h.groupName || ''}`);
      const matchSearch = searchTerms.every((term) => combinedString.includes(term));

      return matchType && matchStatus && matchSearch;
    });
  }, [campusHardware, hardwareFilterType, hardwareFilterStatus, hardwareSearchQuery, personnel]);

  const displayPersonnel = useMemo(() => {
    return campusPersonnel.filter((p) => {
      let matchStatus = true;
      if (personnelFilterStatus !== 'All') matchStatus = (p.status || 'Aktif') === personnelFilterStatus;

      if (!personnelSearchQuery) return matchStatus;

      const searchTerms = toTrLower(personnelSearchQuery).split(/\s+/).filter(Boolean);
      const combinedString = toTrLower(`${p.name} ${p.email || ''} ${p.department || ''} ${p.title || ''}`);
      const matchSearch = searchTerms.every((term) => combinedString.includes(term));

      return matchStatus && matchSearch;
    });
  }, [campusPersonnel, personnelFilterStatus, personnelSearchQuery]);

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
        aValue = personnel.find((p) => p.id === a.assignedTo)?.name || '';
        bValue = personnel.find((p) => p.id === b.assignedTo)?.name || '';
      }
      if (String(aValue).toLowerCase() < String(bValue).toLowerCase()) return hardwareSort.direction === 'asc' ? -1 : 1;
      if (String(aValue).toLowerCase() > String(bValue).toLowerCase()) return hardwareSort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [displayHardware, hardwareSort, personnel]);

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

  const getSortIcon = (currentSort, key) => {
    if (currentSort.key !== key)
      return <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />;
    return currentSort.direction === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-600" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
    );
  };

  // YENİ: Transferdeki cihazlar zimmetlenemez! Sadece "Depoda" ve "Zimmetli" olanlar listelenir.
  const availableHardwareForAssign = campusHardware
    .filter((h) => h.status !== 'Hurda' && h.status !== 'Transfer')
    .filter((h) => {
      const matchType =
        assignFilterType === 'All' ||
        (h.type && toTrLower(h.type) === toTrLower(assignFilterType));

      let matchStatus = true;
      if (assignFilterStatus === 'Zimmetli')
        matchStatus = h.status === 'Assigned';
      if (assignFilterStatus === 'Depoda')
        matchStatus = h.status === 'Available';

      const matchCampus =
        assignFilterCampus === 'All' || h.campus === assignFilterCampus;

      const searchTerms = toTrLower(assignSearchQuery)
        .split(/\s+/)
        .filter(Boolean);
        const personName =
        personnel.find((p) => p.id === h.assignedTo)?.name || h.assignedTo || '';
      const groupN = h.groupName || '';
      const combinedString = toTrLower(
        `${h.brand} ${h.model} ${h.serial} ${personName} ${groupN}`
      );

      const matchSearch =
        searchTerms.length === 0 ||
        searchTerms.every((term) => combinedString.includes(term));

      return matchType && matchStatus && matchCampus && matchSearch;
    });

  const handleCreateAssignment = () => {
    if (!selectedPerson || selectedHardware.length === 0)
      return alert('Lütfen personel ve cihaz seçin.');

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
      // Eğer zimmetli cihaz varsa, imzaya geçmeden önce Onay Modalını aç
      setZimmetliCihazlarListesi(alreadyAssignedItems);
      setShowZimmetliOnayModal(true);
    } else {
      // Sorun yoksa direkt imzaya geç
      setIsSigning(true);
    }
  };

  const handleFinalizeZimmet = async () => {
    if (!itSignature || !personOtpData || !personSignature)
      return alert('Lütfen IT imzası, doğrulama kodu ve personel imzasının tamamlandığından emin olun.');

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
    if (allHaveSameGroup) {
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
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          authToken: currentUser.token,
          action: 'saveZimmetServerSide',
          pdfName: filename,
          campus: currentUser.campus,
          personId: selectedPerson,
          personName: person.name,
          personTitle: person.department || '', // YENİ: Ünvan Eklendi
          hardwareIds: finalSelectedHardware,
          hardwareList: hardwareListForServer,
          itEmail: currentUser.email,
          itName: currentUser.name,
          personEmail: person.email || '',
          itSignature: itSignature.image,
          personSignature: personSignature.image,
          personOtpHash: personOtpData.hash,
          zimmetExplanation: zimmetExplanation, // BURASI EKLENDİ
          clientIp: clientIp,
          userAgent: navigator.userAgent
        }),
      });
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || "Drive'a kaydedilemedi.");

      const realDriveUrl = result.url;
      const newDoc = { id: Date.now().toString(), name: filename, date: new Date().toLocaleDateString('tr-TR'), url: realDriveUrl };

      setPersonnel((prev) => prev.map((p) => p.id === selectedPerson ? { ...p, documents: [...(p.documents || []), newDoc] } : p ));
      setHardware((prev) => prev.map((h) => {
          if (finalSelectedHardware.includes(h.id)) {
            return {
              ...h, status: 'Assigned', assignedTo: selectedPerson, driveLink: realDriveUrl,
              history: [{ personName: person.name, date: new Date().toLocaleDateString('tr-TR'), driveLink: realDriveUrl }, ...(h.history || [])],
            };
          }
          return h;
        })
      );

      setSuccessMessage("İşlem Başarılı! Belge sunucuda üretildi ve e-postalar gönderildi.");
      setTimeout(() => setSuccessMessage(null), 3000);
      
      setIsSigning(false); setSelectedPerson(''); setSelectedHardware([]); setItSignature(null);
      setPersonSignature(null); setIncludeCharger(false); setIncludeBag(false); setIncludeMouse(false);
      setSelectedMouseId('OEM'); setActiveTab('personnel'); setPersonOtpData(null); setAssignStep(1);
    } catch (error) {
      alert('Hata: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // --- İADE PDF ÜRETİMİ VE YÜKLEMESİ (SUNUCU TARAFLI) ---
  const handleFinalizeReturn = async () => {
    if (!returnItSignature || !returnPersonSignature || !returnPersonOtpData || !isReturnAccepted)
      return alert('Lütfen imzaları, SMS kodunu ve Hukuki Onay kutucuğunu tamamlayın.');

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
    if (allHaveSameGroup) {
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
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          authToken: currentUser.token,
          action: 'returnZimmetServerSide',
          pdfName: filename,
          campus: currentUser.campus,
          personId: person.id,
          personName: person.name,
          personTitle: person.department || '', // YENİ: Ünvan Eklendi
          hardwareIds: hardwareArray.map((h) => h.id),
          hardwareList: hardwareListForServer,
          itEmail: currentUser.email,
          itName: currentUser.name,
          personEmail: person.email || '',
          itSignature: returnItSignature.image,
          personSignature: returnPersonSignature.image,
          personOtpHash: returnPersonOtpData.hash,
          returnCondition: returnCondition,
          returnExplanation: returnExplanation,
          clientIp: clientIp,
          userAgent: navigator.userAgent
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || "Drive'a kaydedilemedi.");

      const realDriveUrl = result.url;
      const newDoc = { id: Date.now().toString(), name: filename, date: new Date().toLocaleDateString('tr-TR'), url: realDriveUrl };

      setHardware((prev) => prev.map((h) => hardwareArray.some((item) => item.id === h.id) ? { ...h, status: 'Available', assignedTo: null, driveLink: realDriveUrl } : h ));
      setPersonnel((prev) => prev.map((p) => p.id === person.id ? { ...p, documents: [...(p.documents || []), newDoc] } : p ));

      setSuccessMessage("İade işlemi tamamlandı. Belge sunucuda üretildi ve Drive'a kaydedildi.");
      setTimeout(() => setSuccessMessage(null), 3000);
      setReturningData(null); setReturnItSignature(null); setReturnPersonSignature(null); setReturnCondition('eksiksiz'); setReturnExplanation(''); setIsReturnAccepted(false); setReturnPersonOtpData(null);
    } catch (error) {
      alert('Hata: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // --- KAMPÜS TRANSFER PDF VE KAYIT İŞLEMLERİ (SUNUCU TARAFLI) ---
  // --- KAMPÜS TRANSFER PDF VE KAYIT İŞLEMLERİ (SUNUCU TARAFLI) ---
  const handleFinalizeTransfer = async () => {
    if (!transferSignature) return alert('Lütfen imzanızı atın.');

    setIsGenerating(true);

    try {
      const { type, items, targetCampus, senderCampus } = transferModalObj;
      const isOut = type === 'out';

      // HATA DÜZELTİLDİ: AUTHORIZED_IT_USERS bağımlılığı kaldırıldı.
      let targetItEmail = '';
      const relevantCampus = isOut ? targetCampus : senderCampus;
      if (relevantCampus && relevantCampus.trim().toLowerCase() === 'genel müdürlük') {
        targetItEmail = 'huseyin.cift@istek.k12.tr';
      }

      const hardwareListForServer = items.map(hw => ({
        type: hw.type || '-', brand: hw.brand || '-', model: hw.model || '-', serial: hw.serial || '-'
      }));

      const serials = items.length > 2 ? "Toplu Transfer" : items.map((h) => h.serial).join(' & ');
      const rawFilename = `${serials}, Transfer_${isOut ? 'Cikis' : 'Giris'}.pdf`;
      const filename = rawFilename.replace(/[\/\\?%*:|"<>]/g, '-');

      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
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
          targetItEmail: targetItEmail,
          transferSignature: transferSignature.image,
          clientIp: clientIp,
        }),
      });
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      // Local State Update
      const timeString = new Date().toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      setHardware((prev) => prev.map((h) => {
          if (items.some((i) => i.id === h.id)) {
            const safeHistory = Array.isArray(h.history) ? h.history : [];
            if (isOut) {
              return { ...h, status: 'Transfer', campus: targetCampus, assignedTo: `GÖNDEREN:${currentUser.campus}`, driveLink: result.url, historyLoaded: true, history: [{ personName: currentUser.name, date: timeString, driveLink: result.url, type: `Kampüs Çıkış (${currentUser.campus})` }, ...safeHistory] };
            } else {
              return { ...h, status: 'Available', assignedTo: null, campus: currentUser.campus, driveLink: result.url, historyLoaded: true, history: [{ personName: currentUser.name, date: timeString, driveLink: result.url, type: `Kampüs Giriş (${currentUser.campus})` }, ...safeHistory] };
            }
          }
          return h;
        })
      );

      setSuccessMessage(`Transfer işlemi (${isOut ? 'Gönderim' : 'Teslim Alma'}) sunucuda üretildi ve e-postalar gönderildi.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      setTransferModalObj(null); setTransferSignature(null); setSelectedBulkHardware([]); setViewingHardwareId(null);
      
    } catch (error) {
      alert('Hata: ' + error.message);
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
          const response = await fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
              authToken: currentUser.token,
              action: 'cancelTransfer',
              hardwareIds: items.map((i) => i.id),
              senderCampus: senderCampus,
              currentUserName: currentUser.name,
              currentUserEmail: currentUser.email,
            }),
          });
          const result = await response.json();
          if (!result.success) throw new Error(result.error);

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
          alert('Hata: ' + error.message);
          setIsGenerating(false);
        }
      },
    });
  };
  const handleManualUploadSubmit = async () => {
    if (!manualUploadFile || !manualUploadPerson)
      return alert('Lütfen bir personel ve dosya seçin.');

    const person = personnel.find((p) => p.id === manualUploadPerson);
    const isImage = manualUploadFile.type.startsWith('image/');
    const extension = isImage ? '.jpg' : '.pdf';
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

      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
         authToken: currentUser.token,
          action: 'manualAssign',
          pdfName: filename,
          pdfData: base64String,
          campus: currentUser.campus,
          personId: person.id,
          personName: person.name,
          hardwareId: viewedHardware.id,
        }),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

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
      alert('Hata: ' + error.message);
    } finally {
      setIsUploadingManual(false);
    }
  };
  const renderPrintableDocument = () => {
    const person = campusPersonnel.find((p) => p.id === selectedPerson);
    let finalSelectedForPdf = [...selectedHardware];
    if (includeMouse && selectedMouseId !== 'OEM') {
      if (!finalSelectedForPdf.includes(selectedMouseId)) {
        finalSelectedForPdf.push(selectedMouseId);
      }
    }
    const items = campusHardware.filter((h) =>
      finalSelectedForPdf.includes(h.id)
    );
    const today = new Date().toLocaleDateString('tr-TR');
    let rowCounter = 1;

    const currentTime = new Date().toLocaleString('tr-TR');
    const userAgent = navigator.userAgent;

    return (
      <div className="w-full flex flex-col items-center pb-20 bg-gray-200 p-2 md:p-4 overflow-x-hidden">
        <div
          id="pdf-content"
          style={{
            width: isGenerating ? '210mm' : '100%',
            maxWidth: '210mm',
            backgroundColor: 'white',
            color: 'black',
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: '11px',
            lineHeight: '1.4',
            textRendering: 'optimizeLegibility',
            WebkitFontSmoothing: 'antialiased',
          }}
          className="shadow-xl mx-auto print:shadow-none print:m-0 transition-all duration-300"
        >
          <style>{`
            .pdf-page { padding: ${
              isGenerating ? '15mm 20mm' : '6vw'
            }; box-sizing: border-box; position: relative; } 
            .page-break { page-break-before: always; } 
            .pdf-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; } 
            .pdf-table th, .pdf-table td { border: 1px solid #000; padding: 6px; text-align: center; } 
            .pdf-p { margin-bottom: 8px; text-align: justify; } 
            .pdf-strong { font-weight: bold; }
          `}</style>

          {/* === 1. SAYFA BAŞLANGICI === */}
          <div className="pdf-page">
            <h3 className="text-center font-bold text-[16px] mb-6 underline">
              DONANIM ZİMMET TESLİM TUTANAĞI
            </h3>

            <div className={!isGenerating ? 'overflow-x-auto w-full mb-4' : 'w-full mb-4'}>
              <table className="pdf-table m-0">
                <tbody>
                  <tr>
                    <td colSpan="4" className="bg-gray-100 font-bold" style={{ backgroundColor: '#f3f4f6' }}>
                      İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.
                    </td>
                  </tr>
                  <tr>
                    <td className="w-1/4 font-bold text-left px-4 min-w-[100px]">KAMPÜS / OKUL</td>
                    <td colSpan="3" className="text-left px-4">{person?.campus || currentUser.campus}</td>
                  </tr>
                  <tr>
                    <td className="font-bold text-left px-4">PERSONEL / ÜNVAN</td>
                    <td colSpan="3" className="text-left px-4">{person?.name} - {person?.department}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={!isGenerating ? 'overflow-x-auto w-full' : 'w-full'}>
              <table className="pdf-table m-0">
                <thead>
                  <tr>
                    <th colSpan="4" className="font-bold" style={{ backgroundColor: '#f3f4f6' }}>
                      TESLİM EDİLEN DONANIM BİLGİLERİ
                    </th>
                  </tr>
                  <tr>
                    <th style={{ width: '60px' }}>SIRA NO</th>
                    <th className="min-w-[120px]">CİHAZ MARKA MODEL</th>
                    <th className="min-w-[120px]">SERİ NUMARASI</th>
                    <th style={{ width: '80px' }}>MİKTAR</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{rowCounter++}</td>
                      <td>{item.brand} {item.model}</td>
                      <td>{item.serial}</td>
                      <td>1</td>
                    </tr>
                  ))}
                  {includeCharger && (
                    <tr>
                      <td>{rowCounter++}</td>
                      <td>Orijinal Şarj Adaptörü ve Kablosu</td>
                      <td>-</td>
                      <td>1</td>
                    </tr>
                  )}
                  {includeBag && (
                    <tr>
                      <td>{rowCounter++}</td>
                      <td>Notebook Taşıma Çantası</td>
                      <td>-</td>
                      <td>1</td>
                    </tr>
                  )}
                  {includeMouse && selectedMouseId === 'OEM' && (
                    <tr>
                      <td>{rowCounter++}</td>
                      <td>Standart Mouse</td>
                      <td>OEM</td>
                      <td>1</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="pdf-p mt-8 text-sm leading-relaxed text-justify">
              Yukarıda marka, model ve seri numarası belirtilen İSTEK İstanbul
              Eğitim Hizmetleri A.Ş. mülkiyetindeki donanım,{' '}
              <strong>{today}</strong> tarihinde tarafıma eksiksiz ve sorunsuz
              olarak teslim edilmiştir. Cihazı, "Bilişim Kaynaklarını Kullanma
              Yönergesi" şartlarına uygun şekilde kullanacağımı, donanıma
              herhangi bir zarar verdiğim takdirde vermiş olduğum zarara ilişkin
              tutarın ücretimden, tazminatlarımdan ve diğer tüm hak edişlerimden
              kesilmesine nakden ve defaten muvafakat ettiğimi kabul ve beyan
              ederim.
            </p>

            <div style={{ border: '1px solid black', padding: '15px', marginTop: '20px', backgroundColor: '#fafafa' }}>
              <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '12px' }}>
                Teslim Edilen Donanım(lar) İçin Ek Açıklama / Not:
              </p>
              {!isGenerating ? (
                <textarea
                  placeholder="Cihazın fiziki durumu veya ek aksesuarlar hakkında not yazabilirsiniz..."
                  value={zimmetExplanation}
                  onChange={(e) => setZimmetExplanation(e.target.value)}
                  className="w-full p-3 text-sm border border-gray-300 rounded outline-none focus:ring-2 focus:ring-[#0066b1] bg-white print-hide resize-none"
                  rows="3"
                />
              ) : (
                <p style={{ fontSize: '12px', color: '#333', marginTop: '8px', minHeight: '20px' }}>
                  {zimmetExplanation || 'Cihaz(lar) eksiksiz, hasarsız ve çalışır durumda teslim edilmiştir.'}
                </p>
              )}
            </div>
          </div>

          {/* === 2. SAYFA BAŞLANGICI === */}
          <div className="pdf-page page-break">
            <div className="text-center font-bold mb-8">
              <h2 className="text-[15px] m-0">İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.</h2>
              <h2 className="text-[14px] m-0 mt-2">BİLGİ İŞLEM DİZÜSTÜ BİLGİSAYAR KULLANIM YÖNERGESİ</h2>
            </div>

            <div>
              <p className="pdf-p"><span className="pdf-strong">a)</span> Hizmet Paketi kapsamında personel kullanımına verilen dizüstü bilgisayarlar İSTEK İstanbul Eğitim Hizmetleri A.Ş mülkiyetindedir. Bilişim Kaynaklarını Kullanma Yönergesi'nde belirtilen yararlanma koşullarına uygun olarak, personelin sözleşmesi süresince kullanımına tahsis edilir.</p>
              <p className="pdf-p"><span className="pdf-strong">b)</span> Personel genel müdürlük ve insan kaynakları departmanı tarafından duyurulan tarihte bilgisayarını tüm aksesuarları ile birlikte iade etmekle sorumludur. Üzerinde etiket, yazı vs. kesinlikle olmamalıdır.</p>
              <p className="pdf-p"><span className="pdf-strong">c)</span> Geçici veya daimi olarak ayrılan personel, bilgisayarını aldığı haliyle iade etmek zorundadır.</p>
              <p className="pdf-p"><span className="pdf-strong">d)</span> Personel İşveren tarafından kendisine tahsis edilecek dizüstü bilgisayarı ve bilgisayarda yer alan her türlü veriyi işveren tarafından belirlenecek amaçlar ve işin yürütümü ile ilgili olarak kullanmakla yükümlüdür. Buna aykırılık halinde, Personel İşveren' in kişisel veriler de dahil olmak üzere verileri kullanabileceğini, kontrol edebileceğini, fesih gerekçesi olarak kullanabileceğini ve bu durumun kişisel verilerin gizliliğine aykırılık teşkil etmeyeceğini kabul ve beyan eder.</p>
              <p className="pdf-p"><span className="pdf-strong">e)</span> Personel işverenin izni olmaksızın kullanımına verilen dizüstü bilgisayara herhangi bir program yüklemeyeceğini, buna aykırılık halinde söz konusu programın yüklenmesinden doğan her türlü zarardan (lisanssız ürün kullanımından doğan ceza ve tazminat sorumluluğu da dahil olmak üzere) kendisinin sorumlu olacağını kabul ve beyan eder.</p>
              <p className="pdf-p"><span className="pdf-strong">f)</span> Personel bilgi işlemin onayı olmadan kullanımına verilen dizüstü bilgisayara kurum dışında herhangi bir donanımsal müdahale, onarım işlemi yapmayacağını(tamir) buna aykırılık halinde söz konusu müdahaleden ötürü her türlü zarardan kendisinin sorumlu olacağını kabul ve beyan eder.</p>
              
              <p className="pdf-p mt-6"><span className="pdf-strong">2. Garanti Kapsamı</span></p>
              <p className="pdf-p"><span className="pdf-strong">a)</span> Kullanıma verilen dizüstü bilgisayar, Dizüstü Bilgisayar Hizmet Paketi kapsamında üretiminden kaynaklanan hata, kusur veya arızalar için üretici firma garantisi altındadır.</p>
              <p className="pdf-p"><span className="pdf-strong">b)</span> Garanti koşullarını açıklayıcı belgeler dizüstü bilgisayar ile birlikte verilmektedir. Dizüstü Bilgisayar Hizmet Paketi kapsamında sağlanan destek hizmetleri yurtdışında geçerli değildir.</p>
              <p className="pdf-p"><span className="pdf-strong">c)</span> Personel arzu ettiği takdirde ücretini kendisi karşılamak kaydıyla bilgisayarı sigortalatabilir.</p>
              <p className="pdf-p"><span className="pdf-strong">d)</span> Personelin bilgi ve belgelerinin yedekleme sorumluluğu kendisine aittir. Bütün yedeklerini Google drive hesabına alabilir.</p>

              <p className="pdf-p mt-6"><span className="pdf-strong">3. Ödemeler ve Cezai Yükümlülükler</span></p>
              <p className="pdf-p"><span className="pdf-strong">a)</span> Garanti kapsamına girmeyen kusur, ihmal veya dikkatsizlik sonucu bilgisayarda meydana gelebilecek hasarlardan dolayı personel, Bilgi İşlem Müdürlüğü tarafından kendisine yapılan bildirimi takiben en geç 15 gün içerisinde, arızalı parça ve/veya tamir bedelini ödemekle yükümlüdür.</p>
              <p className="pdf-p"><span className="pdf-strong">b)</span> Herhangi bir nedenle iş akdi feshedilen personel bilgisayarını teslim aldığı şekilde iade etmezse, teslim belgesi ve ilgili yönergelere dayanarak İSTEK İstanbul Eğitim Hizmetleri A.Ş tarafından aleyhinde yasal takip başlatılır, tüm aksesuarları ile birlikte bilgisayar veya bedeli ilgili distribütörün vereceği satış fiyatı üzerinden yasal faizleri ile birlikte talep edilir.</p>
            </div>

            {/* 2. SAYFA İMZA VE OTP AKIŞ ALANI */}
            <div style={{ display: 'flex', flexDirection: isGenerating ? 'row' : 'column', justifyContent: 'space-between', gap: isGenerating ? '0px' : '30px', marginTop: '40px' }}>
              
              {/* --- 1. ADIM: IT İMZASI --- */}
              <div style={{ width: isGenerating ? '50%' : '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Tebliğ Eden (IT):</p>
                <p style={{ fontSize: '12px', marginBottom: '8px' }}>{currentUser.name}</p>
                
                {!isGenerating && !itSignature && (
                  <SignaturePad onSign={setItSignature} label="1. Önce Siz (IT) İmzalayın" />
                )}
                
                <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className={(!isGenerating && !itSignature) ? 'hidden' : 'flex'}>
                  {itSignature && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <img src={itSignature.image} alt="İmza IT" style={{ maxHeight: '60px', maxWidth: '100%' }} />
                      <span style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>ID: {itSignature.hash}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* --- 2. ADIM: PERSONEL KODU VE İMZASI --- */}
              <div style={{ width: isGenerating ? '50%' : '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Tebellüğ Eden (Personel):</p>
                <p style={{ fontSize: '12px', marginBottom: '8px' }}>{person?.name}</p>
                
                {!isGenerating && (
                  <div className="w-full">
                    {itSignature && !personOtpData && (
                       <OtpVerification personName={person?.name} personEmail={person?.email} currentUser={currentUser} onVerified={setPersonOtpData} />
                    )}

                    {personOtpData && !personSignature && (
                       <div className="animate-in slide-in-from-bottom-2 mt-4">
                         <div className="bg-green-50 text-green-700 text-[10px] font-bold py-1.5 px-3 rounded-t-xl border border-green-200 flex items-center justify-center gap-1.5 w-full max-w-[320px] mx-auto border-b-0">
                           <CheckCircle2 className="w-3.5 h-3.5" /> Kod Doğrulandı! Lütfen İmza Çizin.
                         </div>
                         <SignaturePad onSign={setPersonSignature} label="2. Personel İmzası" />
                       </div>
                    )}
                  </div>
                )}
                
                <div style={{ height: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className={(!isGenerating && !personSignature) ? 'hidden' : 'flex'}>
                  {personSignature && (
                    <img src={personSignature.image} alt="İmza Personel" style={{ maxHeight: '45px', maxWidth: '100%', marginBottom: '2px' }} />
                  )}
                  {personOtpData && personSignature && (
                    <div style={{ border: '1px solid #0066b1', padding: '2px 8px', borderRadius: '4px', textAlign: 'center', backgroundColor: '#f0f7ff' }}>
                      <p style={{ fontSize: '7px', color: '#0066b1', fontWeight: 'bold', margin: '0' }}>✓ E-POSTA İLE ONAYLANDI</p>
                      <p style={{ fontSize: '6px', color: '#666', margin: '0' }}>{personOtpData.email}</p>
                      <p style={{ fontSize: '6px', color: '#999', margin: '0', fontFamily: 'monospace' }}>Onay ID: {personOtpData.hash}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className={!isGenerating ? 'hidden' : 'block'} style={{ marginTop: '50px', borderTop: '1px solid #ccc', paddingTop: '10px' }}>
              <p style={{ fontSize: '9px', fontWeight: 'bold', marginBottom: '4px', color: '#555' }}>DİJİTAL İŞLEM LOG KAYDI</p>
              <div style={{ fontSize: '8px', color: '#777', display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
                <span><strong>İşlemi Yapan IT:</strong> {currentUser.email}</span>
                <span><strong>Zaman Damgası:</strong> {currentTime}</span>
                <span><strong>IP Adresi:</strong> {clientIp}</span>
                <span><strong>Cihaz Bilgisi:</strong> {userAgent.substring(0, 50)}...</span>
              </div>
            </div>
          </div>
        </div>

        {!isGenerating && (
          <div className="print-hide w-full max-w-[210mm] flex flex-col bg-white p-4 md:p-6 mt-8 rounded-2xl shadow-lg border border-gray-200 mb-10 gap-6">
            
            {/* HUKUKİ ONAY VE KVKK KUTUSU */}
            <div className="p-5 bg-blue-50/40 border border-blue-200 rounded-xl shadow-sm">
              <label className="flex items-start gap-3.5 cursor-pointer group">
                <div className="mt-0 mr-3 shrink-0">
                  <input
                    type="checkbox"
                    checked={isKvkkAccepted}
                    onChange={(e) => setIsKvkkAccepted(e.target.checked)}
                    className="w-5 h-5 text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1] cursor-pointer transition-colors group-hover:border-[#0066b1]"
                  />
                </div>
                <div className="text-[12px] sm:text-[13px] text-gray-700 leading-relaxed text-justify">
                <strong className="text-[#0066b1] block mb-1">Hukuki Onay ve Açık Rıza:</strong> 
                  İSTEK İstanbul Eğitim Hizmetleri A.Ş.{' '}
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handlePdfClick("https://drive.google.com/file/d/1cHFh6FWZsqi34pQJiuvyVsWNzq0hQ_PL/view", "Bilişim Kaynaklarını Kullanma Yönergesi");
                    }}
                    className="text-[#0066b1] font-bold underline hover:text-blue-800 transition-colors"
                  >
                    Bilişim Kaynaklarını Kullanma Yönergesi
                  </a>
                  'ni okudum, anladım ve kabul ediyorum. 
                  Tarafıma teslim edilen cihaz/cihazları, işbu formda yer alan <span className="font-semibold italic bg-blue-100/50 px-1 rounded">"Ek Açıklama / Not"</span> doğrultusunda teslim aldığımı; 
                  cihazlarda meydana gelebilecek ve garanti kapsamı dışında kalan her türlü zararı (kullanıcı hatası vb.) 
                  tazmin etmeyi peşinen kabul ve beyan ederim. 
                  <br/><br/>
                  İşbu formda yer alan adım, soyadım ve imzamın/dijital izimin, zimmet süreçlerinin yürütülmesi amacıyla 
                  6698 sayılı KVKK kapsamında işlenmesine açık rıza gösteriyorum.
                </div>
              </label>
            </div>

            {/* İNCE AYIRICI ÇİZGİ */}
            <hr className="border-gray-200 mb-6" />

            {/* AKSİYON BUTONLARI */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <p className="text-[13px] font-bold text-gray-700 text-center sm:text-left flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-blue-600" /> İmzalarınızı atıp işlemi onaylayın.
              </p>
              
              <div className="flex gap-3 w-full sm:w-auto justify-center">
                <button
                  onClick={() => {
                    setIsSigning(false);
                    setItSignature(null);
                    setPersonSignature(null);
                    setPersonOtpData(null);
                  }}
                  disabled={isGenerating}
                  className="px-5 py-2.5 border border-gray-300 text-gray-600 font-bold rounded-xl hover:bg-gray-100 disabled:opacity-50 transition-colors shadow-sm w-full sm:w-auto"
                >
                  İptal Et
                </button>
                <button
                  onClick={handleFinalizeZimmet}
                  disabled={isGenerating || !isKvkkAccepted || !itSignature || !personOtpData || !personSignature}
                  className={`px-6 py-2.5 font-extrabold rounded-xl shadow-md transition-all flex items-center justify-center w-full sm:w-auto ${
                    (!isKvkkAccepted || !itSignature || !personOtpData || !personSignature) 
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none' 
                      : 'bg-green-600 text-white hover:bg-green-700 hover:shadow-lg active:scale-95'
                  }`}
                >
                  {isGenerating ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> İşleniyor...</>
                  ) : (
                    <><CheckCircle2 className="w-5 h-5 mr-2" /> Okudum, Onaylıyorum</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleTabChange = (tabName) => {
    // İşlem yapılıyorsa sekme değiştirmeyi engelle
    if (isGenerating) return;

    // --- AÇIK OLAN HER TÜRLÜ İŞLEMİ VE MODALI İPTAL ET ---
    setIsSigning(false);
    setTransferModalObj(null); // Transfer ekranını kapat
    setReturningData(null); // İade ekranını kapat
    setViewingHardwareId(null); // Cihaz profilini kapat
    setViewingPersonId(null); // Personel profilini kapat
    setShowAddHardwareModal(false); // Donanım ekleme modalını kapat
    
    // Zimmet ve İade imzalarını sıfırla
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
    setAssignSearchQuery('');
    setAssignFilterType('All');
    setAssignFilterStatus('All');
    setAssignFilterCampus('All');
    setActiveAssignFilterDropdown(null);
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

    // Sayfalamayı başa sar
    setHardwarePage(1);
    setPersonnelPage(1);

    // Sekmeyi değiştir
    setActiveTab(tabName);

    // iPad Scroll Bug Çözümü
    setTimeout(() => {
      if (mainContainerRef.current) {
        mainContainerRef.current.scrollTop = 0;
      }
    }, 10);
  };

  // YENİ: TÜM UYGULAMA İÇİN GENEL GELEN TRANSFER BİLDİRİM SAYACI
  const incomingTransfers = hardware.filter((h) => {
    if (!h.status || !h.campus || !h.assignedTo) return false;
    const isTransferState = String(h.status || '').trim().toLowerCase() === 'transfer';
    const isMyCampus = getCoreCampusName(h.campus) === myCoreCampus;
    const isFromSender = String(h.assignedTo).toUpperCase().includes('GÖNDEREN');
    const senderCore = getCoreCampusName(String(h.assignedTo).replace(/GÖNDEREN:/i, ''));
    const isNotFromMe = senderCore !== myCoreCampus;
    return isTransferState && isMyCampus && isFromSender && isNotFromMe;
  });

  // --- BEYAZ EKRAN ÇÖZÜMÜ: EKRANLAR HOOK'LARDAN SONRAYA TAŞINDI ---
  if (isLoading) {
    return (
      <div className="min-h-screen w-screen overflow-x-hidden flex flex-col items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
        <p className="text-gray-600 font-medium">Sistem Yükleniyor...</p>
        <p className="text-gray-400 text-sm mt-2">Veritabanı ile senkronize ediliyor.</p>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen w-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl overflow-hidden p-8 sm:p-10 border border-gray-100">
          <div className="flex flex-col items-center mb-8">
            <div className="w-full flex justify-center mb-4">
              <img src="https://istek.site/logo/Kurum_Genel_Logo-01.png" alt="İSTEK Okulları Logo" className="h-20 sm:h-24 w-auto object-contain drop-shadow-sm" onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
              <div style={{ display: 'none' }} className="flex-col items-center">
                <Building2 className="w-16 h-16 text-[#0066b1] mb-2 opacity-90" />
                <h1 className="text-3xl font-black text-[#0066b1]">İSTEK Okulları</h1>
              </div>
            </div>
            <h2 className="text-xl sm:text-xl font-bold text-[#0066b1] text-center tracking-tight">Bilgi İşlem Demirbaş Yönetim Sistemi</h2>
          </div>
          <div className="flex flex-col items-center space-y-6 min-h-[120px] justify-center">
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
                  <GoogleLogin onSuccess={handleGoogleSuccess} onError={() => { setIsLoggingIn(false); alert('Google ile giriş yapılamadı.'); }} useOneTap />
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
      className="fixed inset-0 flex flex-col md:flex-row w-full bg-slate-50 font-sans text-gray-800 selection:bg-[#8bcdc5]/30 overflow-hidden overscroll-none"
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
          {/* HEADER: Kapatma Butonu ve Başlık */}
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
                rel="noreferrer"
                className="px-5 py-2 sm:px-6 sm:py-2 bg-[#0066b1] text-white text-sm sm:text-base font-bold rounded-lg shadow hover:bg-[#005595] transition-colors"
              >
                Tarayıcıda Yeni Sekmede Aç
              </a>
            </div>

            {/* Gerçek İframe */}
            {previewPdf.url && (
              <iframe
                src={formatDriveUrlForEmbed(previewPdf.url)}
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

<aside className="w-full md:w-64 bg-[#0066b1] text-white flex flex-col print:hidden shrink-0 shadow-md z-30 transition-all">
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
            className="mobile-logo-inner flex justify-between items-center md:block overflow-hidden"
          >
            {/* LOGO (GİZLİ TIKLAMA SAYACI İÇERİR) */}
            <div
              className="bg-white px-2 py-1 md:px-4 md:py-2.5 rounded-xl shadow-md transition-transform hover:scale-105 cursor-pointer flex justify-center items-center md:w-full select-none"
              onClick={() => {
                const newCount = logoClickCount + 1;
                setLogoClickCount(newCount);
                if (newCount >= 10) {
                  setShowEasterEgg(true);
                  setLogoClickCount(0);
                }
              }}
            >
              <img
                src={'https://istek.site/logo/Kurum_Genel_Logo-04.png'}
                alt="İSTEK Okulları Logo Mobil"
                className="h-6 w-auto object-contain md:hidden pointer-events-none"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
              <img
                src={'https://istek.site/logo/Kurum_Genel_Logo-01.png'}
                alt="İSTEK Okulları Logo Masaüstü"
                className="hidden md:block h-20 md:h-12 lg:h-14 w-auto object-contain pointer-events-none"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>

            {/* MOBİL PROFİL */}
            <div className="flex items-center gap-2 md:hidden shrink-0 ml-2">
              <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-[#0066b1] font-bold shadow-md shrink-0 border-2 border-[#8bcdc5] overflow-hidden">
              {currentUser.picture ? (
  <img src={currentUser.picture} alt="Profil" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
) : (
  (currentUser?.name || 'U').charAt(0)
)}
              </div>
              
              {/* YENİ: Mobil Veri Yenile Butonu */}
              <button
                onClick={() => fetchVeritabani(true)}
                disabled={isRefreshing}
                className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                title="Verileri Yenile"
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>

              <button
                onClick={() => {
                  localStorage.removeItem('istek_it_user');
                  setCurrentUser(null);
                }}
                className="p-1.5 bg-red-500/20 text-red-100 hover:bg-red-500 rounded-lg transition-colors shrink-0"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>

            {/* MASAÜSTÜ PROFİL VE YENİLE BUTONU (Hatasız Kısım) */}
            <div className="hidden md:block mt-6">
              <div className="bg-[#005595] p-3 rounded-xl border border-[#8bcdc5]/30 shadow-inner mb-4 flex items-center gap-3 relative group">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-[#0066b1] font-bold shadow-md shrink-0 border-2 border-[#8bcdc5] overflow-hidden">
          {currentUser.picture ? (
            <img src={currentUser.picture} alt="Profil" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
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

                {/* YENİ: ŞIK YENİLE BUTONU (Sağa Dayalı) */}
                <button
                  onClick={() => fetchVeritabani(true)}
                  disabled={isRefreshing}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-all shadow-sm disabled:opacity-50"
                  title="Verileri Yenile"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-white' : 'text-white/80 group-hover:text-white'}`} />
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* SEKMELER (DONANIM / PERSONEL / TRANSFER) - HER ZAMAN GÖRÜNÜR OLACAK */}
        <nav className="p-1.5 sm:p-2 md:px-4 md:py-6 flex flex-col shrink-0 bg-[#0066b1] z-40 relative">
          <div className="flex w-full bg-[#005595] p-1 rounded-xl space-x-1 md:flex-col md:bg-transparent md:p-0 md:space-x-0 md:space-y-2 md:w-auto md:rounded-none">
            <button
              onClick={() => handleTabChange('hardware')}
              className={`flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm md:flex-none md:justify-start md:px-4 md:py-3 md:text-base md:space-x-3 ${
                activeTab === 'hardware'
                  ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                  : 'text-white hover:bg-[#004a82] md:hover:bg-[#005595]'
              }`}
            >
              <Laptop className="w-4 h-4 sm:w-5 sm:h-5" />{' '}
              <span className="whitespace-nowrap">Donanım</span>
            </button>

            <button
              onClick={() => handleTabChange('personnel')}
              className={`flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm md:flex-none md:justify-start md:px-4 md:py-3 md:text-base md:space-x-3 ${
                activeTab === 'personnel'
                  ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                  : 'text-white hover:bg-[#004a82] md:hover:bg-[#005595]'
              }`}
            >
              <Users className="w-4 h-4 sm:w-5 sm:h-5" />{' '}
              <span className="whitespace-nowrap">Personel</span>
            </button>

            <button
              onClick={() => handleTabChange('transfer')}
              className={`flex-1 flex justify-center items-center space-x-1 sm:space-x-2 px-1.5 py-2.5 sm:py-3 rounded-lg transition-all font-bold text-xs sm:text-sm md:flex-none md:justify-start md:px-4 md:py-3 md:text-base md:space-x-3 ${
                activeTab === 'transfer'
                  ? 'bg-[#8bcdc5] text-[#0066b1] shadow-md'
                  : 'text-white hover:bg-[#004a82] md:hover:bg-[#005595]'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                {incomingTransfers.length > 0 && (
                  <span className="absolute -top-2 -right-2.5 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-sm animate-pulse">
                    {incomingTransfers.length}
                  </span>
                )}
              </div>
              <span className="whitespace-nowrap">Transfer</span>
            </button>
          </div>
        </nav>

        {/* Masaüstü Aksiyon Butonları (SADECE ÇIKIŞ YAP) */}
        <div className="hidden md:block p-4 border-t border-[#8bcdc5]/30 bg-[#005595] space-y-2">
          <button
            onClick={() => {
              localStorage.removeItem('istek_it_user');
              setCurrentUser(null);
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/20 text-red-100 hover:bg-red-500 hover:text-white rounded-lg transition-colors text-sm font-bold"
          >
            <LogOut className="w-4 h-4" /> Çıkış Yap
          </button>
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
              onClick={() => updateServiceWorker(true)} 
              className="px-4 py-2 text-xs font-bold bg-white text-blue-600 hover:bg-blue-50 rounded-lg shadow-sm transition-colors"
            >
              Hemen Yenile
            </button>
          </div>
        </div>
      )}

      <main
        ref={mainContainerRef}
        onScroll={handleMainScroll}
        // iOS SSS (Smooth Scroll Safari) Bug Düzeltmesi: overscroll-behavior-y eklendi
        className="flex-1 overflow-y-auto relative w-full overscroll-none"
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
              <div className="space-y-0 animate-in fade-in relative">
                {/* DONANIM ARAMA ÇUBUĞU (DAHA İNCE VE ZARİF) */}
                <div
                  style={{ position: 'sticky', top: 0, zIndex: 80 }}
                  className="bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-1"
                >
                  <div className="flex items-center gap-2 w-full">
                    {/* Arama Çubuğu (İnceltildi: h-10, text-sm) */}
                    <div className="flex items-center flex-1 min-w-0 px-3 h-10 border border-gray-200 rounded-xl bg-white shadow-sm focus-within:border-[#0066b1] focus-within:ring-2 focus-within:ring-[#0066b1]/20 transition-all">
                      <input
                        type="text"
                        placeholder="Marka, Model, Seri No ara..."
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
                    {/* Yeni Donanım Ekle Butonu */}
                    <button
                      onClick={() => setShowAddHardwareModal(true)}
                      className="h-10 px-3 md:px-4 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm bg-[#0066b1] border-[#005595] text-white hover:bg-[#005595] font-bold gap-1.5"
                      title="Yeni Donanım Ekle"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="hidden md:inline text-sm">
                        Donanım Ekle
                      </span>
                    </button>

                    {/* 3 Nokta Butonu */}
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowHardwareMenu(!showHardwareMenu)}
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                          showHardwareMenu
                            ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        <MoreVertical className="w-4 h-4" />
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
                                        selectedBulkHardware.includes(h.id)
                                      )
                                    : sortedHardware;
                                handleExportXLSX(
                                  exportData,
                                  'Donanim_Listesi',
                                  'hardware'
                                );
                              }}
                              className="w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors text-left"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              <Download className="w-4 h-4 text-blue-500 shrink-0" />
                              <span>
                                {selectedBulkHardware.length > 0
                                  ? `Seçili (${selectedBulkHardware.length}) İndir`
                                  : 'XLSX Olarak İndir'}
                              </span>
                            </button>
                            <button
                              onClick={() => {
                                setShowHardwareMenu(false);
                                const exportData =
                                  selectedBulkHardware.length > 0
                                    ? sortedHardware.filter((h) =>
                                        selectedBulkHardware.includes(h.id)
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
                    className={`relative mt-3 mb-0 z-[90] ${
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
                              'Tablet',
                              'Monitör',
                              'Klavye ve Mouse Seti',
                              'Mouse',
                              'Klavye',
                              'Webcam',
                              'Hard Drive',
                              'Diğer',
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
                {/* YENİ: TÜM SAYFALARI SEÇ (HEM MOBİL HEM DESKTOP İÇİN ORTAK) */}
                {isSelectionMode &&
                  sortedHardware.length > paginatedHardware.length && (
                    <label className="flex items-center gap-3 bg-blue-50/80 p-3 rounded-xl shadow-sm border border-blue-200 cursor-pointer mb-3 animate-in fade-in transition-colors hover:bg-blue-100/50">
                      <input
                        type="checkbox"
                        className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
                        checked={sortedHardware.every((h) =>
                          selectedBulkHardware.includes(h.id)
                        )}
                        onChange={(e) => handleSelectAllBulk(e, sortedHardware)}
                      />
                      <span className="text-sm font-bold text-[#0066b1]">
                        Tüm Sayfalardaki Filtrelenmiş Cihazları Seç (
                        {sortedHardware.length})
                      </span>
                    </label>
                  )}

                {/* --- DESKTOP VIEW (TABLE) --- */}
                <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mt-1">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200 select-none">
                      <tr>
                        <th className="p-4 w-12 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500"
                            checked={
                              paginatedHardware.length > 0 &&
                              paginatedHardware.every((h) =>
                                selectedBulkHardware.includes(h.id)
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
                          personnel.find((p) => p.id === item.assignedTo)
                            ?.name || item.assignedTo;
                        const isSelected = selectedBulkHardware.includes(
                          item.id
                        );
                        const getIcon = (type) => {
                          const t = String(type || '').toLowerCase();
                          if (t.includes('laptop'))
                            return <Laptop className="w-4 h-4 text-gray-500" />; // mobilde text-[#0066b1]
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
                            className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                              isSelected ? 'bg-blue-50/50' : ''
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
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
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
                                        title={`${brandStr} markalı cihazları ara`}
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
                                    {/* GRUP ROZETİ ALT SATIRA EKLENDİ */}
                                    {item.groupName && (
                                      <span
                                        className="bg-indigo-50 text-indigo-600 border border-indigo-200 text-[10px] font-bold px-2 py-0.5 rounded shadow-sm flex items-center gap-1 cursor-help mt-0.5"
                                        title="Bağlı Olduğu Grup"
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
                                className="text-blue-600 font-semibold hover:underline hover:bg-blue-50 px-1.5 py-0.5 rounded transition-colors cursor-pointer inline-block"
                                title="Cihaz detaylarını gör"
                              >
                                {item.serial}
                              </button>
                            </td>
                            <td className="p-4">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-bold ${
                                  item.status === 'Available'
                                    ? 'bg-green-100 text-green-700'
                                    : item.status === 'Hurda'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                {item.status === 'Available'
                                  ? 'Depoda'
                                  : item.status === 'Hurda'
                                  ? 'Hurda'
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
                                  {item.driveLink && (
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

                  {/* YENİ: MASAÜSTÜ DONANIM PAGINATION */}
                  <Pagination
                    currentPage={hardwarePage}
                    totalPages={hardwareTotalPages}
                    onPageChange={setHardwarePage}
                  />
                </div>

                {/* --- DONANIM MOBİL GÖRÜNÜM --- */}
                <div className="block md:hidden space-y-2 mt-0">
                  {paginatedHardware.map((item) => {
                    const personName =
                      personnel.find((p) => p.id === item.assignedTo)?.name ||
                      item.assignedTo;
                    const isSelected = selectedBulkHardware.includes(item.id);

                    const getIcon = (type) => {
                      const t = String(type || '').toLowerCase();
                      if (t.includes('laptop'))
                        return <Laptop className="w-5 h-5 text-[#0066b1]" />;
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
                        className={`bg-white p-4 rounded-xl shadow-sm border flex flex-col transition-colors cursor-pointer relative select-none ${
                          isSelectionMode && isSelected
                            ? 'border-[#0066b1] bg-[#e0f0ff] ring-1 ring-[#0066b1]/50'
                            : 'border-gray-200 active:bg-gray-50'
                        }`}
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
                                {/* MOBİL GRUP ROZETİ */}
                                {item.groupName && (
                                  <span className="bg-indigo-50 text-indigo-600 border border-indigo-200 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                                    <Tag className="w-2.5 h-2.5" />{' '}
                                    {item.groupName}
                                  </span>
                                )}

                                <div className="flex items-center gap-1.5">
                                  <div
                                    className={`w-2.5 h-2.5 rounded-full ${statusColor} shadow-sm`}
                                  ></div>
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider hidden sm:inline-block">
                                    {statusText}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 font-medium truncate mt-0.5">
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

                            {item.driveLink && (
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

                  {/* YENİ: MOBİL DONANIM PAGINATION */}
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

            {/* PERSONNEL TAB */}
            {activeTab === 'personnel' && (
              <div className="space-y-0 animate-in fade-in relative">
                {/* PERSONEL ARAMA ÇUBUĞU VE FİLTRELERİ */}
                <div
                  style={{ position: 'sticky', top: 0, zIndex: 80 }}
                  className="bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-1"
                >
                  <div className="flex items-center gap-2 w-full">
                    {/* Arama Çubuğu */}
                    <div className="flex items-center flex-1 min-w-0 px-3 h-10 border border-gray-200 rounded-xl bg-white shadow-sm focus-within:border-[#0066b1] focus-within:ring-2 focus-within:ring-[#0066b1]/20 transition-all">
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

                    {/* 3 Nokta Butonu */}
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setShowPersonnelMenu(!showPersonnelMenu)}
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                          showPersonnelMenu
                            ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                            : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                        title="Daha Fazla Seçenek"
                      >
                        <MoreVertical className="w-4 h-4" />
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
                                        selectedBulkPersonnel.includes(p.id)
                                      )
                                    : sortedPersonnel;
                                handleExportXLSX(
                                  exportData,
                                  'Personel_Listesi',
                                  'personnel'
                                );
                              }}
                              className="w-full px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-3 transition-colors text-left"
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              <Download className="w-4 h-4 text-blue-500 shrink-0" />
                              <span>
                                {selectedBulkPersonnel.length > 0
                                  ? `Seçili (${selectedBulkPersonnel.length}) XLSX Olarak İndir`
                                  : 'XLSX Olarak İndir'}
                              </span>
                            </button>
                            <button
                              onClick={() => {
                                setShowPersonnelMenu(false);
                                const exportData =
                                  selectedBulkPersonnel.length > 0
                                    ? sortedPersonnel.filter((p) =>
                                        selectedBulkPersonnel.includes(p.id)
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
                                  ? `Seçilileri Sheete Aktar (${selectedBulkPersonnel.length}) `
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
                    className={`relative mt-3 mb-0 z-[90] ${
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

                      {(campusFilter !== 'All' ||
                        personnelFilterStatus !== 'Aktif') && (
                        <button
                          onClick={() => {
                            setCampusFilter('All');
                            setPersonnelFilterStatus('Aktif');
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
                {/* YENİ: TÜM SAYFALARI SEÇ (HEM MOBİL HEM DESKTOP İÇİN ORTAK) */}
                {isPersonnelSelectionMode &&
                  sortedPersonnel.length > paginatedPersonnel.length && (
                    <label className="flex items-center gap-3 bg-blue-50/80 p-3 rounded-xl shadow-sm border border-blue-200 cursor-pointer mb-3 animate-in fade-in transition-colors hover:bg-blue-100/50">
                      <input
                        type="checkbox"
                        className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
                        checked={sortedPersonnel.every((p) =>
                          selectedBulkPersonnel.includes(p.id)
                        )}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const newIds = sortedPersonnel.map((p) => p.id);
                            setSelectedBulkPersonnel((prev) => [
                              ...new Set([...prev, ...newIds]),
                            ]);
                          } else {
                            const pageIds = sortedPersonnel.map((p) => p.id);
                            setSelectedBulkPersonnel((prev) =>
                              prev.filter((id) => !pageIds.includes(id))
                            );
                          }
                        }}
                      />
                      <span className="text-sm font-bold text-[#0066b1]">
                        Tüm Sayfalardaki Filtrelenmiş Personelleri Seç (
                        {sortedPersonnel.length})
                      </span>
                    </label>
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
                                selectedBulkPersonnel.includes(p.id)
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
                        const assignedHardware = hardware.filter((h) => h.assignedTo === person.id);
                        const isSelected = selectedBulkPersonnel.includes(person.id);

                        return (
                          <tr
                            key={person.id}
                            onClick={() => setViewingPersonId(person.id)}
                            className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                              isSelected ? 'bg-blue-50/50' : ''
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
                                    <img src={person.picture} alt={person.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    String(person?.name || 'U').charAt(0)
                                  )}
                                </div>
                                <div>
                                  <span className="font-bold text-gray-900 group-hover:text-blue-600 block transition-colors">
                                    {person.name}
                                  </span>
                                  {isHQ && (
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block mt-0.5 group-hover:text-gray-500 transition-colors">
                                      {person.campus}
                                    </span>
                                  )}
                                </div>
                              </button>
                            </td>
                            <td className="p-4 text-sm font-medium text-gray-700">
                              {person.department || '-'}
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

                                      {h.driveLink && (
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
                    const assignedHardware = hardware.filter(
                      (h) => h.assignedTo === person.id
                    );
                    const appSheetDocs = assignedHardware.filter(
                      (h) => h.driveLink
                    );
                    const isSelected = selectedBulkPersonnel.includes(
                      person.id
                    );

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
                        }`}
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
                            <p className="text-xs text-gray-500 font-medium truncate mt-0.5">
                              {person.department || 'Personel'}
                            </p>
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

                                  {h.driveLink && (
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
            {/* TRANSFER MERKEZİ (LOG) TAB                 */}
            {activeTab === 'transfer' && (
              <div className="max-w-5xl mx-auto space-y-4 animate-in fade-in pb-32">
                {/* 1. STICKY ARAMA VE FİLTRE ÇUBUĞU (EN ÜSTTE) */}
                <div
                  style={{ position: 'sticky', top: 0, zIndex: 80 }}
                  className="bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-2"
                >
                  <div className="flex items-center gap-2 w-full">
                    {/* Arama Çubuğu */}
                    <div className="flex items-center flex-1 px-4 py-2.5 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#0066b1] transition-all shadow-sm">
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
                      className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
                        showTransferFilters
                          ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                          : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      <Filter className="w-4 h-4" />
                    </button>
                  </div>

                  {/* FİLTRE ÇİPLERİ VE AÇILIR MENÜLER */}
                  {showTransferFilters && (
                    <div
                      className={`relative mt-3 mb-0 z-[90] animate-in slide-in-from-top-1 fade-in duration-200`}
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

                        {/* Tarih Çipi (Native Date Input butona uyarlandı) */}
                        <div className="relative shrink-0 pr-1">
                          <input
                            type="date"
                            value={transferFilterDate}
                            onChange={(e) =>
                              setTransferFilterDate(e.target.value)
                            }
                            className={`flex items-center justify-center min-w-[110px] sm:min-w-[125px] px-3 py-1 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm outline-none h-[28px] sm:h-[30px] cursor-pointer ${
                              transferFilterDate
                                ? 'bg-[#0066b1] border-[#0066b1] text-white'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
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
                  )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 md:p-6">
                  {(() => {
                    // --- VERİ HAZIRLIĞI (WOD KORUMALI & LAZY LOAD UYUMLU) ---
                    const myPendingOutbound = {};
                    const myPendingInbound = {};
                    const myCompletedTransfers = {};
                    let pendingItemCount = 0;

                    hardware.forEach((h) => {
                      if (h.status === 'Transfer') {
                        const assignedToUp = String(h.assignedTo || '').toUpperCase();
                        
                        // 1. GİDEN (Bekleyen)
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

                      // 3. TAMAMLANMIŞ TRANSFERLER (WSoD Korumalı!)
                      if (h.status !== 'Transfer' && Array.isArray(h.history) && h.history.length > 0) {
                        const isRelatedToUs = h.history.some((r) =>
                            r && // Undefined koruması
                            (String(r.type || '').toLowerCase().includes('çıkış') ||
                             String(r.type || '').toLowerCase().includes('giriş') ||
                             String(r.type || '').toLowerCase().includes('transfer')) &&
                            (String(r.personName || '').toLowerCase().includes(currentUser.name.toLowerCase()) ||
                             String(r.personName || '').toLowerCase().includes(currentUser.campus.toLowerCase()) ||
                             String(r.type || '').toLowerCase().includes(currentUser.campus.toLowerCase()))
                        );

                        if (isRelatedToUs) {
                          // BEYAZ EKRAN ÇÖZÜMÜ: currentUser veya campus boş gelirse çökmeyi engeller
                          const safeCampus = (currentUser?.campus || '').toLowerCase();

                          const outIdx = h.history.findIndex(r => r && (String(r.type || '').toLowerCase().includes('çıkış') || (String(r.type || '').toLowerCase() === 'transfer' && String(r.personName || '').toLowerCase() !== safeCampus)));
                          const inIdx = h.history.findIndex(r => r && (String(r.type || '').toLowerCase().includes('giriş') || String(r.type || '').toLowerCase().includes('teslim')));
                          const cancelIdx = h.history.findIndex(r => r && String(r.type || '').includes('İptal'));

                          if (cancelIdx !== -1 && outIdx !== -1 && cancelIdx <= outIdx) {
                            if (inIdx === -1 || cancelIdx < inIdx) return;
                          }

                          const outRec = outIdx !== -1 ? h.history[outIdx] : null;
                          const inRec = inIdx !== -1 ? h.history[inIdx] : null;
                          const key = outRec?.driveLink || inRec?.driveLink || `comp_${h.id}`;

                          let senderCmp = 'Bilinmeyen Kampüs';
                          if (outRec && outRec.type && String(outRec.type).includes('(')) {
                             const match = String(outRec.type).match(/\(([^)]+)\)/);
                             senderCmp = match ? match[1] : 'Bilinmeyen Kampüs';
                          } else if (outRec) {
                             senderCmp = String(outRec.personName || '').replace(/GÖNDEREN:/i, '').trim();
                          }

                          let receiverCmp = h.campus || 'Bilinmiyor';
                          if (inRec && inRec.type && String(inRec.type).includes('(')) {
                             const match = String(inRec.type).match(/\(([^)]+)\)/);
                             receiverCmp = match ? match[1] : h.campus;
                          }

                          if (!myCompletedTransfers[key]) {
                            myCompletedTransfers[key] = {
                              date: inRec ? inRec.date : (outRec ? outRec.date : '-'),
                              targetCampus: receiverCmp,
                              senderCampus: senderCmp,
                              senderName: outRec ? outRec.personName : 'IT Personeli',
                              receiverName: inRec ? inRec.personName : 'IT Personeli',
                              outLink: outRec?.driveLink || null,
                              inLink: inRec?.driveLink || null,
                              items: [],
                            };
                          }
                          if (!myCompletedTransfers[key].items.find((i) => i.id === h.id)) {
                            myCompletedTransfers[key].items.push(h);
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

                      if (transferFilterSender !== 'All' && gSenderCamp !== transferFilterSender) return false;
                      if (transferFilterReceiver !== 'All' && gRecCamp !== transferFilterReceiver) return false;
                      if (formattedFilterDate && !(group.date || '').includes(formattedFilterDate)) return false;

                      return true;
                    };

                    const filteredPendingIn = pendingInKeys.filter((k) => filterGroup(myPendingInbound[k], true, false));
                    const filteredPendingOut = pendingOutKeys.filter((k) => filterGroup(myPendingOutbound[k], false, true));
                    const filteredCompleted = completedKeys.filter((k) => filterGroup(myCompletedTransfers[k]));

                    return (
                    
                      <div className="space-y-6">
                        {/* 2. SEKMELER (ARAMA ÇUBUĞUNUN ALTINDA) - MOBİL UYUMLU */}
                        <div className="flex flex-wrap sm:flex-nowrap bg-gray-100 p-1.5 rounded-xl shadow-inner w-full md:w-max gap-1">
                          <button
                            onClick={() => setTransferViewTab('pending')}
                            className={`flex-1 min-w-[130px] px-3 sm:px-6 py-2.5 text-[13px] sm:text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
                              transferViewTab === 'pending'
                                ? 'bg-white text-[#0066b1] shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            <span className="truncate">Bekleyenler</span>
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
                            className={`flex-1 min-w-[130px] px-3 sm:px-6 py-2.5 text-[13px] sm:text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
                              transferViewTab === 'completed'
                                ? 'bg-white text-[#0066b1] shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                            }`}
                          >
                            <span className="truncate">Tamamlananlar</span>
                            <span
                              className={`px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] shrink-0 ${
                                transferViewTab === 'completed'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {completedKeys.length}
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
                                  let sentDate = 'Tarih Bilinmiyor';
                                  let senderN = 'IT Personeli';
                                  
                                  if (Array.isArray(group.items[0]?.history) && group.items[0].history.length > 0) {
                                    const latestLog = group.items[0].history[0];
                                    // YENİ: latestLog null/undefined gelirse çökmeyi engelleyen if şartı
                                    if (latestLog) {
                                      sentDate = latestLog.date || "Tarih Bilinmiyor";
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
                                          <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
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
                                          {sentDate}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* 2. BİZİM GÖNDERDİKLERİMİZ */}
                                {filteredPendingOut.map((key) => {
                                  const group = myPendingOutbound[key];
                                  let sentDate = 'Tarih Bilinmiyor';
                                  
                                  if (Array.isArray(group.items[0]?.history) && group.items[0].history.length > 0) {
                                    const latestLog = group.items[0].history[0];
                                    if (latestLog) {
                                      sentDate = latestLog.date || "Tarih Bilinmiyor";
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
                                          Karşı Taraf Onayı Bekliyor
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
                                          <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
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
                                            {sentDate}
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

                        {/* TAMAMLANANLAR LİSTESİ */}
                        {transferViewTab === 'completed' && (
                          <div className="space-y-4 animate-in fade-in duration-200">
                            {filteredCompleted.length === 0 ? (
                              <div className="py-12 flex flex-col items-center justify-center text-center bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                <Search className="w-10 h-10 text-gray-300 mb-3" />
                                <p className="text-gray-500 text-sm font-medium">
                                  Bu kriterlere uygun tamamlanmış işlem
                                  bulunamadı.
                                </p>
                              </div>
                            ) : (
                              filteredCompleted.map((key) => {
                                const group = myCompletedTransfers[key];
                                return (
                                  <div
                                    key={key}
                                    className="bg-white rounded-xl shadow-sm border border-gray-200 border-l-4 border-l-green-500 p-3 md:p-4 transition-all hover:shadow-md group"
                                  >
                                    {/* ROTA GÖRÜNÜMÜ (TAMAMLANDI Başlığı Kaldırıldı) */}
                                    <div className="flex flex-col mb-3 bg-gray-50 w-full px-4 py-2.5 rounded-xl border border-gray-100">
                                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                        Transfer Rotası:
                                      </span>
                                      <div className="flex items-center justify-between gap-3 w-full max-w-lg">
                                        <div className="flex flex-col flex-1">
                                          <span className="text-[10px] font-bold text-gray-500 uppercase">
                                            Gönderen
                                          </span>
                                          <span
                                            className="text-sm font-bold text-gray-900 truncate"
                                            title={group.senderName}
                                          >
                                            {group.senderName}
                                          </span>
                                          <span className="text-[11px] text-gray-500 font-medium truncate">
                                            {group.senderCampus}
                                          </span>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-gray-300 shrink-0" />
                                        <div className="flex flex-col flex-1 text-right">
                                          <span className="text-[10px] font-bold text-gray-500 uppercase">
                                            Teslim Alan
                                          </span>
                                          <span
                                            className="text-sm font-bold text-gray-900 truncate"
                                            title={group.receiverName}
                                          >
                                            {group.receiverName}
                                          </span>
                                          <span className="text-[11px] text-gray-500 font-medium truncate">
                                            {group.targetCampus}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2 mb-3">
                                      {group.items.map((hw) => (
                                        <button
                                          key={hw.id}
                                          onClick={() =>
                                            setViewingHardwareId(hw.id)
                                          }
                                          className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-green-600 hover:bg-green-50 transition-colors px-2.5 py-1.5 rounded-md shadow-sm text-left max-w-full shrink-0"
                                        >
                                          <Laptop className="w-3.5 h-3.5 text-gray-400 shrink-0" />
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

                                    {/* ALT BİLGİ VE PDF BUTONLARI (İşlem zamanı solda, butonlar sağda) */}
                                    <div className="pt-2.5 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                      <div className="text-[11px] text-gray-500 font-bold flex items-center gap-1.5">
                                        <History className="w-4 h-4 text-gray-400" />{' '}
                                        İşlem Zamanı:{' '}
                                        <span className="text-gray-800">
                                          {group.date}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 self-end sm:self-auto">
                                        {group.outLink ? (
                                          <button
                                            onClick={() =>
                                              handlePdfClick(group.outLink, 'Gönderim Belgesi')
                                            }
                                            className="flex items-center gap-1 px-2 py-1 bg-blue-50 text-[#0066b1] border border-blue-200 hover:bg-blue-100 rounded text-[10px] font-bold transition-colors shadow-sm"
                                            title="Çıkış (Gönderim) Tutanak PDF'i"
                                          >
                                            <FileText className="w-3 h-3" />{' '}
                                            ÇIKIŞ PDF
                                          </button>
                                        ) : (
                                          <span
                                            className="px-2 py-1 bg-gray-50 text-gray-400 border border-gray-100 rounded text-[10px] font-medium"
                                            title="Bu işlem için PDF bulunamadı"
                                          >
                                            PDF Yok
                                          </span>
                                        )}
                                        {group.inLink && (
                                          <button
                                            onClick={() =>
                                              handlePdfClick(group.inLink, 'Teslim Alma Belgesi')
                                            }
                                            className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 rounded text-[10px] font-bold transition-colors shadow-sm"
                                            title="Giriş (Teslim Alma) Tutanak PDF'i"
                                          >
                                            <FileSignature className="w-3 h-3" />{' '}
                                            GİRİŞ PDF
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
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
                    className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6"
                    style={{ zIndex: 9999999 }}
                  >
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden animate-in zoom-in-95 duration-500 max-h-[90vh]">
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

            {/* ASSIGNMENT TAB (AKORDEON VE TEK SCROLL SİSTEMİ) */}
            {activeTab === 'assign' && (
              <div className="max-w-3xl mx-auto space-y-4 animate-in fade-in pb-32">
                {/* 1. ADIM: PERSONEL SEÇİMİ AKORDEONU */}
                <div
                  className={`bg-white rounded-2xl shadow-sm border transition-all duration-300 overflow-hidden ${
                    assignStep === 1
                      ? 'border-[#0066b1] ring-1 ring-[#0066b1]/30'
                      : 'border-gray-200'
                  }`}
                >
                  {/* Akordeon Başlığı (Tıklanabilir) */}
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
                              ? personnel.find((p) => p.id === selectedPerson)
                                  ?.name
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
                          placeholder="Personel ara..."
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
                          const filtered = campusPersonnel.filter((p) =>
                            toTrLower(p.name).includes(toTrLower(personSearch))
                          );
                          const displayList = filtered.slice(0, 30);
                          return (
                            <>
                              {displayList.map((p) => (
                                <label
                                  key={p.id}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setSelectedPerson(p.id);
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
                              {filtered.length === 0 && (
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

                {/* 2. ADIM: DONANIM SEÇİMİ AKORDEONU */}
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
                      <div className="flex items-center gap-2 w-full relative z-10">
                        <div className="flex items-center flex-1 px-4 py-2.5 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-[#8bcdc5] focus-within:border-[#0066b1] transition-all">
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
                          <div className="relative shrink-0 hidden sm:block">
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
                          className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm ${
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
                        className={`relative mt-3 mb-0 z-[50] ${
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
                            
                            {/* Kapatma Alanı (Boşluğa tıklayınca kapanır) */}
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
                                    {Object.keys(CAMPUS_CODES).map((c) => (
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

                      {/* SEÇİLEN CİHAZLAR SEPETİ */}
                      {selectedHardware.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100/50 shadow-inner">
                          <span className="w-full text-[10px] font-bold text-[#0066b1] uppercase tracking-wider mb-1 ml-1 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Seçilen Cihazlar Sepeti ({selectedHardware.length})
                          </span>
                          
                          {selectedHardware.map(id => {
                            const hwItem = hardware.find(h => h.id === id);
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
                        const h = hardware.find((hw) => hw.id === id);
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
                      
                      {/* DONANIM LİSTESİ */}
                      <div className="space-y-3 mt-4 relative z-0">
                        {(() => {
                          const displayList = availableHardwareForAssign.slice(0, 30);
                          return (
                            <>
                              {displayList.map((h) => {
                                const isSelected = selectedHardware.includes(h.id);
                                const currentOwner = h.status === 'Assigned' ? personnel.find((p) => p.id === h.assignedTo)?.name : null;
                                
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

                {/* YEPYENİ 3D TUTANAK OLUŞTUR BUTONU */}
                {selectedPerson && selectedHardware.length > 0 && (
                  <div
                    className={`fixed left-0 right-0 flex justify-center px-4 w-full transition-all duration-300 pointer-events-none`}
                    style={{ bottom: '24px', zIndex: 999999 }}
                  >
                    <style>{`
                      .btn-tutanak {
                        pointer-events: auto; /* Tıklanabilirliği geri getirir */
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background-color: #0066b1;
                        color: #ffffff;
                        border: 1px solid #004a82;
                        border-radius: 9999px;
                        padding: 12px 16px 12px 24px;
                        font-weight: 800;
                        font-size: 16px;
                        cursor: pointer;
                        box-shadow: 0 10px 30px rgba(0, 102, 177, 0.4), inset 0 2px 5px rgba(255, 255, 255, 0.25);
                        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                        width: 95%;
                        max-width: 400px;
                        transform-origin: center bottom;
                      }

                      @media (min-width: 768px) {
                        .btn-tutanak {
                          width: auto;
                          padding: 14px 20px 14px 28px;
                          font-size: 17px;
                        }
                      }

                      /* Hover Efekti (Fare Üzerindeyken) */
                      .btn-tutanak:hover:not(:disabled) {
                        background-color: #005595;
                        box-shadow: 0 14px 35px rgba(0, 102, 177, 0.5), inset 0 2px 5px rgba(255, 255, 255, 0.3);
                        transform: translateY(-2px);
                      }

                      /* Aktif Efekti (Tıklanırken) */
                      .btn-tutanak:active:not(:disabled) {
                        background-color: #003a66;
                        box-shadow: 0 4px 12px rgba(0, 102, 177, 0.6), inset 0 4px 10px rgba(0, 0, 0, 0.4);
                        transform: translateY(2px);
                      }

                      /* Buton İkonu Gölgelendirmesi */
                      .btn-tutanak-icon {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background-color: rgba(255, 255, 255, 0.15);
                        padding: 8px;
                        border-radius: 50%;
                        margin-left: 16px;
                        box-shadow: inset 0 1px 3px rgba(0,0,0,0.15);
                        transition: background-color 0.2s ease;
                      }

                      .btn-tutanak:hover:not(:disabled) .btn-tutanak-icon {
                        background-color: rgba(255, 255, 255, 0.25);
                      }
                    `}</style>
                    <button
                      onClick={handleCreateAssignment}
                      disabled={!selectedPerson || selectedHardware.length === 0}
                      className="btn-tutanak animate-in slide-in-from-bottom-8 fade-in"
                    >
                      <span className="whitespace-nowrap tracking-wide">
                        Tutanak Oluştur ve İmzaya Geç
                      </span>
                      <div className="btn-tutanak-icon">
                        <CheckCircle2 className="w-5 h-5 text-white" strokeWidth={3} />
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* HARDWARE PROFILE MODAL (FERAH, DARALTILMIŞ VE YENİ BUTONLU TASARIM) */}
            {viewingHardwareId && viewedHardware && (
              <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
                style={{ zIndex: 99999 }}
                onClick={() => {
                  // YENİ: Cihaz kapatılırken HER ŞEYİ sıfırla
                  setViewingHardwareId(null);
                  setIsTransferMode(false);
                  setSelectedTargetCampus('');
                  setIsEditingDeviceName(false);
                  setShowHardwareHistory(false);
                  setIsEditingSingleGroup(false);
                  setEditSingleGroupText('');
                  setIsEditingNote(false);
                  setEditNoteText('');
                  setShowManualUpload(false);
                  setManualUploadFile(null);
                  setManualUploadPerson('');
                }}
              >
                {/* DİKKAT: max-w-lg, max-w-md YAPILDI (Güvenli şekilde) */}
                <div
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[92vh] overflow-hidden animate-in zoom-in-95 duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* COMPACT HEADER (Başlık, Butonlar) */}
                  <div className="flex justify-between items-center p-5 sm:p-4 border-b border-gray-100 shrink-0 bg-slate-50/80">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                        <Laptop className="w-4 h-4 text-[#0066b1]" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-bold text-[15px] sm:text-base text-gray-900 leading-tight">
                            Cihaz Profili
                          </h3>
                        </div>
                        {/* Bilgisayar İsmi Koca Kutu Yerine Buraya Geldi */}
                        {(() => {
                          const showProfileComputerName =
                            viewedHardware.type === 'Laptop' ||
                            viewedHardware.type === 'Masaüstü (PC)';
                          if (!showProfileComputerName) return null;

                          let cCode = 'XX';
                          const hwCampus = viewedHardware.campus || '';
                          if (CAMPUS_CODES[hwCampus]) {
                            cCode = CAMPUS_CODES[hwCampus];
                          } else {
                            const matchedKey = Object.keys(CAMPUS_CODES).find(
                              (key) =>
                                key.includes(hwCampus) || hwCampus.includes(key)
                            );
                            if (matchedKey) cCode = CAMPUS_CODES[matchedKey];
                          }

                          const tCode =
                            viewedHardware.type === 'Laptop' ? 'LAP' : 'PC';
                          const profileComputerPrefix = `I${cCode}${tCode}`;

                          return !isEditingDeviceName ? (
                            <div
                              onClick={() => {
                                let currentNum = '';
                                if (viewedHardware.deviceName) {
                                  const match = viewedHardware.deviceName.match(
                                    /(\d{4})$/
                                  );
                                  if (match) currentNum = match[1];
                                }
                                setEditComputerNumber(currentNum);
                                setIsEditingDeviceName(true);
                              }}
                              className="flex items-center gap-1.5 mt-0.5 cursor-pointer group"
                              title="Bilgisayar İsmini Düzenle"
                            >
                              <Tag className="w-3 h-3 text-gray-400 group-hover:text-[#0066b1] transition-colors" />
                              <span
                                className={`text-[11px] font-bold ${
                                  viewedHardware.deviceName
                                    ? 'text-[#0066b1] tracking-wider'
                                    : 'text-gray-400 border-b border-dashed border-gray-300'
                                }`}
                              >
                                {viewedHardware.deviceName || 'İsim Ata'}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                                {profileComputerPrefix}
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
                                className="w-12 px-1 py-0.5 text-[11px] font-bold text-[#0066b1] border border-blue-300 rounded outline-none text-center"
                                autoFocus
                              />
                              <button
                                onClick={() =>
                                  handleSaveDeviceName(
                                    viewedHardware.id,
                                    profileComputerPrefix
                                  )
                                }
                                disabled={isUpdatingName}
                                className="bg-green-100 text-green-700 hover:bg-green-200 p-1 rounded transition-colors"
                              >
                                {isUpdatingName ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                onClick={() => setIsEditingDeviceName(false)}
                                className="bg-gray-200 text-gray-600 hover:bg-gray-300 p-1 rounded transition-colors"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* SAĞ ÜST KÖŞE BUTONLARI (DEPO, HURDA, TRANSFER, X) */}
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {/* EĞER CİHAZ TRANSFERDEYSE HİÇBİR İŞLEM YAPILAMAZ */}
                      {viewedHardware.status === 'Transfer' ? (
                         <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded border border-amber-200 mr-2 flex items-center gap-1">
                           <Loader2 className="w-3 h-3 animate-spin"/> YOLDA
                         </span>
                      ) : (
                        <>
                          {/* TEKİL DEPO BUTONU (OPTIMISTIC UI) */}
                      {viewedHardware.status !== 'Available' && (
                        <button
                          onClick={() => {
                            setConfirmDialog({
                              message: `Bu cihaz (S/N: ${viewedHardware.serial}) DEPOYA çekilecek. Onaylıyor musunuz?`,
                              type: 'info',
                              onConfirm: () => {
                                setConfirmDialog(null);
                                setViewingHardwareId(null); // Modalı anında kapat
                                
                                const previousHardwareState = [...hardware];
                                const targetId = viewedHardware.id;

                                // 1. Ekranda Anında Güncelle
                                setHardware((prev) => prev.map((h) => h.id === targetId ? { ...h, status: 'Available', assignedTo: null, groupName: '' } : h));
                                
                                setSuccessMessage('Cihaz arka planda depoya çekiliyor...');
                                setTimeout(() => setSuccessMessage(null), 2000);

                                // 2. Arka planda sunucuya bildir
                                fetch(GAS_URL, {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    authToken: currentUser.token,
                                    action: 'bulkStatusUpdate',
                                    hardwareIds: [targetId], 
                                    newStatus: 'Available',
                                  }),
                                })
                                .then(response => response.json())
                                .then(result => {
                                  if (!result.success) throw new Error(result.error);
                                  fetchVeritabani(false);
                                })
                                .catch(error => {
                                  console.error('Depo Hata:', error);
                                  setHardware(previousHardwareState); // Hata olursa ekranı geri al
                                  alert('HATA: İnternet sorunu nedeniyle cihaz depoya çekilemedi.');
                                });
                              }
                            });
                          }}
                          className="flex items-center justify-center p-2 sm:p-2.5 rounded-full bg-[#d1fae5] text-[#065f46] border border-green-200 hover:bg-green-200 transition-colors shadow-sm"
                          title="Cihazı Depoya Çek"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      )}

                      {/* TEKİL HURDA BUTONU (OPTIMISTIC UI) */}
                      {viewedHardware.status !== 'Hurda' && (
                        <button
                          onClick={() => {
                            setConfirmDialog({
                              message: `DİKKAT: Bu cihaz (S/N: ${viewedHardware.serial}) HURDAYA ayrılacak. Emin misiniz?`,
                              type: 'danger',
                              onConfirm: () => {
                                setConfirmDialog(null);
                                setViewingHardwareId(null); // Modalı anında kapat
                                
                                const previousHardwareState = [...hardware];
                                const targetId = viewedHardware.id;

                                // 1. Ekranda Anında Güncelle
                                setHardware((prev) => prev.map((h) => h.id === targetId ? { ...h, status: 'Hurda', assignedTo: null, groupName: '' } : h));
                                
                                setSuccessMessage('Cihaz arka planda hurdaya ayrılıyor...');
                                setTimeout(() => setSuccessMessage(null), 2000);

                                // 2. Arka planda sunucuya bildir
                                fetch(GAS_URL, {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    authToken: currentUser.token,
                                    action: 'bulkStatusUpdate',
                                    hardwareIds: [targetId],
                                    newStatus: 'Hurda',
                                  }),
                                })
                                .then(response => response.json())
                                .then(result => {
                                  if (!result.success) throw new Error(result.error);
                                  fetchVeritabani(false);
                                })
                                .catch(error => {
                                  console.error('Hurda Hata:', error);
                                  setHardware(previousHardwareState); // Hata olursa ekranı geri al
                                  alert('HATA: İnternet sorunu nedeniyle cihaz hurdaya ayrılamadı.');
                                });
                              }
                            });
                          }}
                          className="flex items-center justify-center p-2 sm:p-2.5 rounded-full bg-[#fee2e2] text-[#991b1b] border border-red-200 hover:bg-red-200 transition-colors shadow-sm"
                          title="Cihazı Hurdaya Ayır"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                      {/* İnce Ayırıcı */}
                      <div className="w-[1px] h-5 bg-gray-200 mx-0.5"></div>

                      {/* Kampüs Transfer Butonu */}
                      <button
                        onClick={() => setIsTransferMode(!isTransferMode)}
                        className={`flex items-center justify-center p-2 sm:p-2.5 rounded-full transition-colors shadow-sm border ${
                          isTransferMode
                            ? 'bg-amber-100 text-amber-700 border-amber-300'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100 hover:text-[#0066b1]'
                        }`}
                        title="Kampüsler Arası Transfer"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                        </>
                      )}

                      {/* Kapatma Butonu (Her Zaman Görünür) */}
                      <button
                        onClick={() => {
                          // YENİ: Cihaz kapatılırken HER ŞEYİ sıfırla
                          setViewingHardwareId(null);
                          setIsTransferMode(false);
                          setSelectedTargetCampus('');
                          setIsEditingDeviceName(false);
                          setShowHardwareHistory(false);
                          setIsEditingSingleGroup(false);
                          setEditSingleGroupText('');
                          setIsEditingNote(false);
                          setEditNoteText('');
                          setShowManualUpload(false);
                          setManualUploadFile(null);
                          setManualUploadPerson('');
                        }}
                        className="text-gray-400 hover:text-gray-800 hover:bg-gray-200 p-2 sm:p-2.5 rounded-full transition-colors bg-white border border-gray-200 shadow-sm"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* BODY */}
                  <div 
                    className="p-3 sm:p-4 space-y-3 overflow-y-auto flex-1 bg-white hide-scroll-bar overscroll-contain"
                    style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
                  >
                    <style>{`
                      .hide-scroll-bar::-webkit-scrollbar { width: 5px; }
                      .hide-scroll-bar::-webkit-scrollbar-track { background: transparent; }
                      .hide-scroll-bar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
                    `}</style>

                    {/* TRANSFER MODU AKTİFSE EN ÜSTTE ÇIKAR */}
                    {isTransferMode && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 animate-in slide-in-from-top-2 duration-200 shadow-sm">
                        <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <Send className="w-3.5 h-3.5" /> Hedef Kampüsü Seçin
                        </p>
                        <div className="flex gap-2">
                        <select
                            value={selectedTargetCampus}
                            onChange={(e) =>
                              setSelectedTargetCampus(e.target.value)
                            }
                            className="flex-1 p-2 text-sm font-medium text-gray-700 border border-amber-300 rounded-lg outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                          >
                            <option value="">-- Seçin --</option>
                            {Object.keys(CAMPUS_CODES)
                              .filter((c) => c !== currentUser.campus)
                              .map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                          </select>
                          <button
                            onClick={() => {
                              setTransferModalObj({
                                type: 'out',
                                items: [viewedHardware],
                                targetCampus: selectedTargetCampus,
                                senderCampus: currentUser.campus,
                              });
                              setIsTransferMode(false);
                            }}
                            disabled={!selectedTargetCampus}
                            className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-amber-700 disabled:opacity-50 transition-colors"
                          >
                            Gönder
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 4'LÜ BİLGİ KARTLARI (Daha Dar) */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 p-2.5 sm:p-3 rounded-xl border border-slate-100 flex flex-col justify-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-400 mb-0.5 font-bold uppercase tracking-wider">
                          Tip
                        </p>
                        <p className="font-bold text-gray-800 text-[13px] sm:text-sm leading-tight">
                          {viewedHardware.type}
                        </p>
                      </div>
                      <div className="bg-slate-50 p-2.5 sm:p-3 rounded-xl border border-slate-100 flex flex-col justify-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-400 mb-0.5 font-bold uppercase tracking-wider">
                          Marka / Model
                        </p>
                        <p className="font-bold text-gray-800 text-[13px] sm:text-sm break-words leading-tight truncate">
                          {(() => {
                            const bStr = viewedHardware.brand || '';
                            const mStr = viewedHardware.model || '';
                            const cModel = mStr
                              .toLowerCase()
                              .startsWith(bStr.toLowerCase())
                              ? mStr.substring(bStr.length).trim()
                              : mStr;
                            return `${bStr} ${cModel}`;
                          })()}
                        </p>
                      </div>
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(viewedHardware.serial);
                          setCopiedSerial(true);
                          setTimeout(() => setCopiedSerial(false), 2000);
                        }}
                        className="bg-slate-50 p-2.5 sm:p-3 rounded-xl border border-slate-100 flex flex-col justify-center cursor-pointer hover:bg-blue-50 transition-colors group"
                        title="Kopyalamak için tıkla"
                      >
                        <p className="text-[9px] sm:text-[10px] text-gray-400 mb-0.5 font-bold uppercase tracking-wider group-hover:text-blue-500 transition-colors">
                          Seri No
                        </p>
                        <p className="font-bold text-[#0066b1] text-[13px] sm:text-sm break-all leading-tight">
                          {copiedSerial ? (
                            <span className="text-green-600 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Kopyalandı
                            </span>
                          ) : (
                            viewedHardware.serial
                          )}
                        </p>
                      </div>
                      <div className="bg-slate-50 p-2.5 sm:p-3 rounded-xl border border-slate-100 flex flex-col justify-center">
                        <p className="text-[9px] sm:text-[10px] text-gray-400 mb-0.5 font-bold uppercase tracking-wider">
                          Kampüs
                        </p>
                        <p className="font-bold text-gray-800 text-[13px] sm:text-sm leading-tight truncate">
                          {viewedHardware.campus}
                        </p>
                      </div>
                    </div>
                    {/* YENİ: GRUP ETİKETİ ALANI (Geniş ve Şık) */}
                    <div className="bg-indigo-50/50 rounded-xl border border-indigo-100 p-2.5 flex items-center justify-between gap-3 shadow-sm transition-all">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                          <Tag className="w-4 h-4 text-indigo-600" />
                        </div>
                        
                        {!isEditingSingleGroup ? (
                          <div className="flex flex-col min-w-0 w-full cursor-pointer" onClick={() => { setEditSingleGroupText(viewedHardware.groupName || ''); setIsEditingSingleGroup(true); }}>
                            <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">Cihaz Grubu</span>
                            <span className={`text-[12px] font-bold truncate ${viewedHardware.groupName ? 'text-indigo-900' : 'text-indigo-400/70 italic'}`}>
                              {viewedHardware.groupName || 'Bir gruba dahil değil. Ekle'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex-1 flex gap-2 animate-in slide-in-from-left-2 duration-200">
                            <input
                              list="single-group-list"
                              type="text"
                              placeholder="Grubu yazın..."
                              value={editSingleGroupText}
                              onChange={(e) => setEditSingleGroupText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !isUpdatingSingleGroup) handleSaveSingleGroup(viewedHardware.id);
                              }}
                              className="flex-1 w-full text-xs font-bold text-indigo-700 p-1.5 border border-indigo-200 rounded outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                              autoFocus
                            />
                            <datalist id="single-group-list">
                              {Array.from(new Set(campusHardware.map((h) => h.groupName).filter(Boolean))).map((g) => (
                                <option key={g} value={g} />
                              ))}
                            </datalist>
                            <button
                              onClick={() => handleSaveSingleGroup(viewedHardware.id)}
                              disabled={isUpdatingSingleGroup}
                              className="bg-indigo-600 text-white p-1.5 rounded hover:bg-indigo-700 disabled:opacity-50 shrink-0 shadow-sm"
                            >
                              {isUpdatingSingleGroup ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => setIsEditingSingleGroup(false)}
                              className="bg-white border border-gray-200 text-gray-500 p-1.5 rounded hover:bg-gray-50 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 3. YENİ: NOT ALANI (İnce ve Zarif Kutu - İSTEK Yeşili) */}
                    <div className="bg-[#8bcdc5]/10 rounded-xl border border-[#8bcdc5]/40 p-2.5 flex items-center justify-between gap-3 shadow-sm">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <FileText className="w-4 h-4 text-[#0066b1] shrink-0 mt-0.5" />
                        {!isEditingNote ? (
                          <div className="flex flex-col min-w-0 w-full">
                            <span className="text-[9px] font-bold text-[#0066b1] uppercase tracking-wider">
                              Donanım Notu
                            </span>
                            <span
                              className={`text-[12px] font-medium truncate ${
                                viewedHardware.notes
                                  ? 'text-gray-800'
                                  : 'text-gray-400 italic'
                              }`}
                            >
                              {viewedHardware.notes || 'Not eklenmemiş.'}
                            </span>
                          </div>
                        ) : (
                          <div className="flex-1 flex gap-2">
                            <input
                              type="text"
                              placeholder="Kısa bir not yazın..."
                              value={editNoteText}
                              onChange={(e) => setEditNoteText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !isUpdatingNote) {
                                  handleSaveNote(viewedHardware.id);
                                }
                              }}
                              className="flex-1 w-full text-xs p-1.5 border border-[#8bcdc5] rounded outline-none focus:border-[#0066b1] bg-white"
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveNote(viewedHardware.id)}
                              disabled={isUpdatingNote}
                              className="bg-[#0066b1] text-white p-1.5 rounded hover:bg-[#005595] disabled:opacity-50 shrink-0"
                            >
                              {isUpdatingNote ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                            <button
                              onClick={() => setIsEditingNote(false)}
                              className="bg-gray-200 text-gray-600 p-1.5 rounded hover:bg-gray-300 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {!isEditingNote && (
                        <button
                          onClick={() => {
                            setEditNoteText(viewedHardware.notes || '');
                            setIsEditingNote(true);
                          }}
                          className="shrink-0 text-[10px] font-bold text-[#0066b1] bg-white border border-[#8bcdc5]/60 px-2 py-1 rounded shadow-sm hover:bg-[#8bcdc5]/20 transition-colors"
                        >
                          Düzenle
                        </button>
                      )}
                    </div>

                    {/* GÜNCEL ZİMMET & EKSİK BELGE YÜKLEME */}
                    {viewedHardwarePerson ? (
                      // ANA KUTU (Daha kompakt ve dar padding)
                      <div className="relative p-3 sm:p-4 bg-blue-50/40 border border-blue-100 rounded-xl flex flex-col shadow-sm transition-all">
                        
                        {/* ÜST SATIR: Başlık ve Uyarı Yan Yana */}
                        <div className="flex justify-between items-center mb-1.5 sm:mb-2">
                          <p className="text-[10px] sm:text-[11px] font-extrabold text-[#0066b1] flex items-center gap-1.5 uppercase tracking-wider m-0">
                            <CheckCircle2 className="w-3.5 h-3.5" /> GÜNCEL ZİMMET
                          </p>
                          
                          {/* Sağ Üst: Belge Yok Rozeti */}
                          {!viewedHardware.driveLink && (
                            <span className="text-[9px] sm:text-[10px] font-black text-amber-600  flex items-center gap-0 m-0">
                              <span className="text-[11px] sm:text-[12px] -mt-0.5">⚠️</span> Belge Yok
                            </span>
                          )}
                        </div>

                        {/* ALT SATIR: İsim (Sol) ve Butonlar (Sağ) */}
                        <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center w-full min-w-0 gap-3">
                          
                          {/* SOL: Personel İsmi */}
                          <div className="flex flex-col min-w-0 flex-1 justify-center">
                            <button
                              onClick={() => {
                                setViewingHardwareId(null);
                                setViewingPersonId(viewedHardwarePerson.id);
                              }}
                              className="font-bold text-[15px] sm:text-[16px] text-gray-900 hover:text-blue-700 hover:underline text-left transition-colors truncate"
                              title="Personel Profilini Aç"
                            >
                              {viewedHardwarePerson.name}
                            </button>
                          </div>

                          {/* SAĞ: Yükle Veya (PDF Görüntüle + İade Al) Butonları */}
                          {!viewedHardware.driveLink ? (
                            <div className="flex flex-col items-end shrink-0 w-full sm:w-auto">
                              <input
                                type="file"
                                ref={fileInputRef}
                                accept="image/*,application/pdf"
                                capture="environment"
                                onChange={(e) => setManualUploadFile(e.target.files[0])}
                                className="hidden"
                              />
                              
                              {!manualUploadFile ? (
                                <button
                                  onClick={() => fileInputRef.current.click()}
                                  className="text-[10px] sm:text-[11px] font-bold text-gray-700 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 hover:text-[#0066b1] hover:border-[#0066b1]/40 px-3 py-1.5 sm:py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer w-full sm:w-auto"
                                >
                                  <Printer className="w-3 h-3" /> Yükle
                                </button>
                              ) : (
                                <div className="flex gap-1.5 animate-in slide-in-from-right-2 duration-200 m-0 w-full sm:w-auto">
                                  <button
                                    onClick={handleMissingDocumentUpload}
                                    disabled={isUploadingManual}
                                    className="flex-1 sm:flex-none flex items-center justify-center bg-green-600 text-white px-3 py-1.5 rounded-md shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
                                    title="Dosyayı Yükle"
                                  >
                                    {isUploadingManual ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => setManualUploadFile(null)}
                                    className="flex items-center justify-center bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-red-500 px-3 py-1.5 rounded-md transition-colors shadow-sm"
                                    title="İptal Et"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            // Belge VARSA (PDF Görüntüle ve İade Al butonları alt alta)
                            <div className="flex flex-col items-end gap-2 shrink-0 w-full sm:w-auto min-w-[120px]">
                              {/* PDF Görüntüle (Üstte) */}
                              <button
                                onClick={() => handlePdfClick(viewedHardware.driveLink, `${viewedHardwarePerson.name} Zimmet Belgesi`)}
                                className="flex items-center justify-center text-[10px] sm:text-xs bg-white text-[#0066b1] px-3 py-1.5 rounded-lg font-bold border border-blue-200 hover:bg-blue-50 transition-colors shadow-sm w-full"
                                title="Güncel Zimmet Belgesini Aç"
                              >
                                <FileText className="w-3.5 h-3.5 mr-1.5" /> PDF Görüntüle
                              </button>

                              {/* İade Al (Altta) */}
                              <button
                                onClick={() => {
                                  setViewingHardwareId(null);
                                  setReturningData({ hardwareArray: [viewedHardware], person: viewedHardwarePerson });
                                }}
                                className="flex items-center justify-center px-4 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 rounded-lg font-bold hover:bg-rose-100 hover:border-rose-300 transition-colors text-[11px] sm:text-xs shadow-sm w-full"
                              >
                                İade Al
                              </button>
                            </div>
                          )}
                        </div>

                      </div>
                    ) : (
                      // CİHAZ BOŞTAYSA MANUEL YÜKLEME ALANI
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 shadow-sm">
                        {!showManualUpload ? (
                          <div className="flex justify-between items-center gap-3">
                            <div>
                              <p className="text-[13px] font-bold text-gray-800 leading-tight">
                                Tutanak Yükle
                              </p>
                              <p className="text-[10px] text-gray-500 mt-0.5">
                                Sistem dışı kağıt belge
                              </p>
                            </div>
                            <button
                              onClick={() => setShowManualUpload(true)}
                              className="px-3 py-1.5 bg-white text-gray-700 text-[11px] font-bold rounded-lg border border-gray-300 shadow-sm hover:bg-gray-50 flex items-center gap-1.5 shrink-0"
                            >
                              <Printer className="w-3.5 h-3.5" /> Yükle
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5 animate-in fade-in duration-200">
                            <p className="text-[10px] font-bold text-[#0066b1] uppercase tracking-wider">
                              Kime Zimmetli Gösterilecek?
                            </p>
                            <div className="flex items-center w-full px-2.5 py-1.5 border border-gray-300 rounded-lg bg-white focus-within:border-[#0066b1] transition-all">
                              <Search className="w-3.5 h-3.5 text-gray-400 mr-2 shrink-0" />
                              <input
                                type="text"
                                placeholder="Personel ara..."
                                className="flex-1 bg-transparent outline-none text-[13px] min-w-0"
                                value={manualUploadSearch}
                                onChange={(e) =>
                                  setManualUploadSearch(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  // Mobilde enter'a basılınca sayfanın kaymasını engelle
                                  if (e.key === 'Enter') e.preventDefault(); 
                                }}
                              />
                            </div>
                            <div className="max-h-[120px] overflow-y-auto border border-gray-200 rounded-lg bg-white space-y-1 p-1">
                              {campusPersonnel
                                .filter((p) =>
                                  toTrLower(p.name).includes(
                                    toTrLower(manualUploadSearch)
                                  )
                                )
                                .map((p) => (
                                  <label
                                    key={p.id}
                                    className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${
                                      manualUploadPerson === p.id
                                        ? 'bg-blue-50 border-blue-200'
                                        : 'hover:bg-gray-50'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="manual_person"
                                      checked={manualUploadPerson === p.id}
                                      onChange={() =>
                                        setManualUploadPerson(p.id)
                                      }
                                      className="w-3.5 h-3.5 text-[#0066b1] border-gray-300"
                                    />
                                    <span className="text-[12px] font-medium text-gray-800 truncate">
                                      {p.name}
                                    </span>
                                  </label>
                                ))}
                            </div>

                            <input
                              type="file"
                              ref={fileInputRef}
                              accept="image/*,application/pdf"
                              capture="environment"
                              onChange={(e) =>
                                setManualUploadFile(e.target.files[0])
                              }
                              className="hidden"
                            />
                            <button
                              onClick={() => fileInputRef.current.click()}
                              className="w-full py-2 border border-dashed border-blue-300 bg-blue-50 text-[#0066b1] rounded-lg font-bold text-[11px] hover:bg-blue-100 flex items-center justify-center gap-1.5 transition-colors"
                            >
                              {manualUploadFile ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />{' '}
                                  {manualUploadFile.name.substring(0, 20)}...
                                </>
                              ) : (
                                '📸 Kamera / Dosya Seç'
                              )}
                            </button>

                            <div className="flex justify-end gap-2 pt-1 mt-1">
                              <button
                                onClick={() => {
                                  setShowManualUpload(false);
                                  setManualUploadFile(null);
                                }}
                                className="px-3 py-1.5 text-[11px] font-bold text-gray-500 hover:bg-gray-100 rounded-md"
                              >
                                İptal
                              </button>
                              <button
                                onClick={handleManualUploadSubmit}
                                disabled={
                                  isUploadingManual ||
                                  !manualUploadFile ||
                                  !manualUploadPerson
                                }
                                className="px-3 py-1.5 text-[11px] font-bold bg-[#0066b1] text-white rounded-md hover:bg-[#005595] disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                              >
                                {isUploadingManual ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  'Yükle ve Ata'
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ZİMMET GEÇMİŞİ AKORDEONU (Daha Kompakt) */}
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                      <button
                        onClick={() => handleOpenHistory(viewedHardware.id)}
                        disabled={!viewedHardware.hasHistory}
                        className={`w-full p-3 sm:p-3.5 flex justify-between items-center transition-colors ${
                          showHardwareHistory ? 'bg-slate-50 border-b border-gray-200' : 'hover:bg-slate-50'
                        } ${!viewedHardware.hasHistory ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-center gap-2">
                          <History className="w-4 h-4 text-gray-500" />
                          <span className="text-[12px] font-bold text-gray-800">
                            Zimmet Geçmişi
                            {viewedHardware.historyLoaded && viewedHardware.history?.length > 0 && (
                              <span className="ml-1.5 text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                                {viewedHardware.history.length}
                              </span>
                            )}
                          </span>
                        </div>
                        {isLoadingHistory ? (
                           <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                        ) : viewedHardware.hasHistory ? (
                          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${showHardwareHistory ? 'rotate-180' : ''}`} />
                        ) : (
                          <span className="text-[10px] font-semibold text-gray-400">Kayıt Yok</span>
                        )}
                      </button>

                      {showHardwareHistory &&
                        viewedHardware.history?.length > 0 && (
                          <div className="p-2 bg-slate-50/50 space-y-1.5 animate-in slide-in-from-top-2 duration-200 max-h-[180px] overflow-y-auto">
                            {viewedHardware.history.map((record, idx) => (
                              <div
                                key={idx}
                                className="p-2.5 bg-white border border-gray-200 shadow-sm rounded-lg flex justify-between items-center hover:border-blue-200 transition-colors"
                              >
                                <div className="pr-2 min-w-0">
                                  <p className="font-bold text-[12px] text-gray-800 leading-tight mb-0.5 truncate">
                                    {record.personName}
                                  </p>
                                  <div className="flex items-center gap-1.5 truncate">
                                    <p className="text-[10px] font-medium text-gray-500">
                                      {record.date}
                                    </p>
                                    <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0"></span>
                                    <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wider truncate">
                                      {record.type || 'Zimmet'}
                                    </p>
                                  </div>
                                </div>
                                {record.driveLink ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePdfClick(
                                        record.driveLink,
                                        `${record.personName} Belgesi`
                                      );
                                    }}
                                    className="text-[10px] bg-slate-50 text-slate-700 px-2 py-1.5 rounded-md font-bold border border-slate-200 hover:bg-white hover:text-blue-600 hover:border-blue-200 transition-colors flex items-center gap-1 shadow-sm shrink-0"
                                  >
                                    <FileText className="w-3 h-3" /> PDF
                                  </button>
                                ) : (
                                  <span className="text-[9px] text-gray-400 italic font-semibold px-2 shrink-0">
                                    Belge Yok
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* YENİ DONANIM EKLE MODAL */}
            {showAddHardwareModal && (
              <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
                style={{ zIndex: 999999 }}
              >
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in zoom-in-95 duration-500 border border-white/20">
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
                        Bu donanım <strong>{currentUser.campus}</strong>{' '}
                        kampüsüne{' '}
                        <span className="font-bold underline">Depoda</span>{' '}
                        statüsüyle eklenecektir.
                      </p>
                    </div>

                    {/* Form Alanları */}
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
                              : 'Diğer';
                            const autoModel = BRANDS_MODELS[autoBrand]
                              ? BRANDS_MODELS[autoBrand][0]
                              : 'Diğer';

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
                          <option value="Diğer">Diğer</option>
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
                                model: BRANDS_MODELS[newBrand][0], // Marka değişince modeli o markanın ilk modeli yap
                              });
                            }}
                            className="w-full px-3 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#0066b1] bg-white shadow-sm transition-all"
                          >
                            {/* BÜTÜN MARKALAR YERİNE, SADECE SEÇİLİ CİHAZ TİPİNE AİT MARKALARI LİSTELER */}
                            {(
                              TYPE_BRANDS[newHardwareForm.type] || ['Diğer']
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

                      {/* BİLGİSAYAR ADI */}
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
                className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                style={{ zIndex: 99999 }}
              >
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden">
                  {/* HEADER: p-4 ve daha temiz border */}
                  <div className="flex justify-between items-center p-4 border-b border-gray-100 shrink-0">
                    {/* SOL TARAF: Başlık ve Rozet Bir Arada */}
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

                    {/* SAĞ TARAF: Kapatma Butonu */}
                    <button
                      onClick={() => {
                        setViewingPersonId(null);
                        setShowPersonHistory(false);
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

                    {/* 2. İLETİŞİM & GÖREV KARTLARI (Alt Alta, Boşluklu, Çizgili) */}
                    <div className="flex flex-col gap-3 mt-4">
                      {/* E-Posta Kutucuğu */}
                      <div
                        onClick={(e) => {
                          if (!viewedPerson.email) return;
                          e.stopPropagation();
                          navigator.clipboard.writeText(viewedPerson.email);
                          setCopiedEmail(true);
                          setTimeout(() => setCopiedEmail(false), 2000);
                        }}
                        className={`bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-center transition-colors relative ${
                          viewedPerson.email
                            ? 'cursor-pointer hover:bg-blue-50 group'
                            : ''
                        }`}
                        title={
                          viewedPerson.email ? 'Kopyalamak için tıkla' : ''
                        }
                      >
                        <p className="text-[10px] text-gray-400 mb-1.5 font-bold uppercase tracking-wider group-hover:text-blue-500 transition-colors">
                          E-Posta Adresi
                        </p>
                        <p className="font-bold text-blue-600 text-[14px] truncate leading-tight group-hover:text-blue-800 transition-colors">
                          {copiedEmail ? (
                            <span className="text-green-600 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4" /> Kopyalandı
                            </span>
                          ) : (
                            viewedPerson.email || '-'
                          )}
                        </p>
                      </div>

                      {/* Departman Kutucuğu */}
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col justify-center">
                        <p className="text-[10px] text-gray-400 mb-1.5 font-bold uppercase tracking-wider">
                          Departman / Görev
                        </p>
                        <p className="font-bold text-gray-800 text-[14px] break-words leading-tight">
                          {viewedPerson.department || '-'}
                        </p>
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
                        {hardware.filter(
                          (h) => h.assignedTo === viewedPerson.id
                        ).length > 0 &&
                          selectedForReturn.length > 0 && (
                            <button
                              onClick={() => {
                                const selectedHardwareObjs = hardware.filter(
                                  (h) => selectedForReturn.includes(h.id)
                                );
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
                        {hardware.filter(
                          (h) => h.assignedTo === viewedPerson.id
                        ).length > 0 ? (
                          hardware
                            .filter((h) => h.assignedTo === viewedPerson.id)
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

                                  {/* Sağ: Zimmet Belgesi Butonu (Sadece belge varsa) */}
                                  {h.driveLink && (
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
                        onClick={() => setShowPersonHistory(!showPersonHistory)}
                        disabled={
                          !viewedPerson.documents ||
                          viewedPerson.documents.length === 0
                        }
                        className={`w-full p-4 flex justify-between items-center transition-colors ${
                          showPersonHistory
                            ? 'bg-slate-50 border-b border-gray-200'
                            : 'hover:bg-slate-50'
                        } ${
                          !viewedPerson.documents ||
                          viewedPerson.documents.length === 0
                            ? 'opacity-60 cursor-not-allowed'
                            : ''
                        }`}
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
                        {viewedPerson.documents?.length > 0 ? (
                          <ChevronDown
                            className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${
                              showPersonHistory ? 'rotate-180' : ''
                            }`}
                          />
                        ) : (
                          <span className="text-[11px] font-semibold text-gray-400">
                            Kayıt Yok
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

            {/* RETURN HARDWARE MODAL & PDF */}
            {returningData && (
              <div
                className="fixed inset-0 bg-black/80 backdrop-blur-sm overflow-y-auto"
                style={{ zIndex: 999999 }}
              >
                <div className="min-h-full flex items-start md:items-center justify-center p-2 sm:p-4 py-8">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center p-4 border-b bg-[#0066b1] text-white shrink-0">
                      <h3 className="font-bold text-base md:text-lg flex items-center gap-2">
                        <FileSignature className="w-5 h-5" /> Donanım İade
                        İşlemi
                      </h3>
                      <button
                        onClick={() => {
                          setReturningData(null);
                          setReturnItSignature(null);
                          setReturnPersonSignature(null);
                          setReturnPersonOtpData(null);
                          setReturnCondition('eksiksiz');
                          setReturnExplanation('');
                        }}
                        className="text-blue-100 hover:text-white bg-white/10 hover:bg-white/20 p-1.5 rounded-full transition-colors"
                      >
                        <X className="w-6 h-6" />
                      </button>
                    </div>

                    <div className="p-2 md:p-6 bg-gray-100 overflow-x-auto flex flex-col items-center">
                      <div
                        id="return-pdf-content"
                        style={{
                          width: isGenerating ? '210mm' : '100%',
                          maxWidth: '210mm',
                          backgroundColor: 'white',
                          padding: isGenerating ? '15mm 20mm' : '4vw',
                          color: 'black',
                          fontFamily: 'Arial, sans-serif',
                          fontSize: '11px',
                          lineHeight: '1.4',
                        }}
                        className="shadow-lg transition-all duration-300"
                      >
                        <h3 className="text-center font-bold text-[16px] mb-6 underline">
                          DONANIM İADE TUTANAĞI
                        </h3>

                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            marginBottom: '12px',
                          }}
                        >
                          <tbody>
                            <tr>
                              <td
                                colSpan="4"
                                style={{
                                  backgroundColor: '#f3f4f6',
                                  fontWeight: 'bold',
                                  border: '1px solid #000',
                                  padding: '6px',
                                  textAlign: 'center',
                                }}
                              >
                                İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.
                              </td>
                            </tr>
                            <tr>
                              <td
                                style={{
                                  fontWeight: 'bold',
                                  border: '1px solid #000',
                                  padding: '6px',
                                  textAlign: 'left',
                                  width: '25%',
                                }}
                              >
                                KAMPÜS / OKUL
                              </td>
                              <td
                                colSpan="3"
                                style={{
                                  border: '1px solid #000',
                                  padding: '6px',
                                  textAlign: 'left',
                                }}
                              >
                                {returningData.person.campus}
                              </td>
                            </tr>
                            <tr>
                              <td
                                style={{
                                  fontWeight: 'bold',
                                  border: '1px solid #000',
                                  padding: '6px',
                                  textAlign: 'left',
                                }}
                              >
                                PERSONEL / ÜNVAN
                              </td>
                              <td
                                colSpan="3"
                                style={{
                                  border: '1px solid #000',
                                  padding: '6px',
                                  textAlign: 'left',
                                }}
                              >
                                {returningData.person.name} -{' '}
                                {returningData.person.department}
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            marginBottom: '20px',
                          }}
                        >
                          <thead>
                            <tr>
                              <th
                                colSpan="4"
                                style={{
                                  backgroundColor: '#f3f4f6',
                                  fontWeight: 'bold',
                                  border: '1px solid #000',
                                  padding: '6px',
                                  textAlign: 'center',
                                }}
                              >
                                İADE EDİLEN DONANIM BİLGİLERİ
                              </th>
                            </tr>
                            <tr>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '6px',
                                }}
                              >
                                SIRA NO
                              </th>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '6px',
                                }}
                              >
                                CİHAZ TİPİ
                              </th>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '6px',
                                }}
                              >
                                MARKA / MODEL
                              </th>
                              <th
                                style={{
                                  border: '1px solid #000',
                                  padding: '6px',
                                }}
                              >
                                SERİ NUMARASI
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {returningData.hardwareArray.map((hw, idx) => (
                              <tr key={hw.id}>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '6px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {idx + 1}
                                </td>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '6px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {hw.type}
                                </td>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '6px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {hw.brand} {hw.model}
                                </td>
                                <td
                                  style={{
                                    border: '1px solid #000',
                                    padding: '6px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {hw.serial}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <p
                          style={{
                            textAlign: 'justify',
                            marginBottom: '20px',
                            fontSize: '12px',
                            lineHeight: '1.6',
                          }}
                        >
                          Yukarıda marka, model ve seri numarası belirtilen
                          İSTEK İstanbul Eğitim Hizmetleri A.Ş. mülkiyetindeki
                          donanım,{' '}
                          <strong>
                            {new Date().toLocaleDateString('tr-TR')}
                          </strong>{' '}
                          tarihinde aşağıda imzası bulunan personel tarafından
                          Bilgi İşlem (IT) departmanına iade edilmiştir.
                        </p>

                        {/* YENİ: İADE İÇİN AKSESUAR SEÇİMİ */}
                        {!isGenerating && returningData.hardwareArray.some(h => String(h.type || '').toLowerCase().includes('laptop')) && (
                          <div className="flex flex-col gap-2 mb-6 p-4 bg-amber-50/50 border border-amber-200 rounded-xl w-full text-left print-hide">
                            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide mb-1">Beraberinde İade Edilen Aksesuarlar</p>
                            <div className="flex flex-wrap gap-4 sm:gap-6">
                              <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-gray-700">
                                <input type="checkbox" checked={returnIncludeCharger} onChange={e => setReturnIncludeCharger(e.target.checked)} className="w-4 h-4 text-amber-600 rounded focus:ring-amber-600 cursor-pointer" /> Şarj Aleti
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-gray-700">
                                <input type="checkbox" checked={returnIncludeBag} onChange={e => setReturnIncludeBag(e.target.checked)} className="w-4 h-4 text-amber-600 rounded focus:ring-amber-600 cursor-pointer" /> Çanta
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-gray-700">
                                <input type="checkbox" checked={returnIncludeMouse} onChange={e => setReturnIncludeMouse(e.target.checked)} className="w-4 h-4 text-amber-600 rounded focus:ring-amber-600 cursor-pointer" /> Mouse
                              </label>
                            </div>
                          </div>
                        )}

                        <div
                          style={{
                            border: '1px solid black',
                            padding: '15px',
                            marginBottom: '40px',
                            backgroundColor: '#fafafa',
                          }}
                        >
                          <p
                            style={{
                              fontWeight: 'bold',
                              fontSize: '12px',
                              marginBottom: '12px',
                            }}
                          >
                            Cihazın İade Anındaki Fiziksel ve Donanımsal Durumu:
                          </p>

                          {!isGenerating ? (
                            <div className="flex flex-col gap-3">
                              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                <input
                                  type="radio"
                                  name="condition"
                                  checked={returnCondition === 'eksiksiz'}
                                  onChange={() =>
                                    setReturnCondition('eksiksiz')
                                  }
                                  className="w-4 h-4 text-[#0066b1]"
                                />
                                <span>
                                  Eksiksiz, hasarsız ve çalışır durumda teslim
                                  alınmıştır.
                                </span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                <input
                                  type="radio"
                                  name="condition"
                                  checked={returnCondition === 'hasarli'}
                                  onChange={() => setReturnCondition('hasarli')}
                                  className="w-4 h-4 text-[#0066b1]"
                                />
                                <span>
                                  Hasarlı / Eksik aksesuar ile teslim
                                  alınmıştır.
                                </span>
                              </label>
                              {returnCondition === 'hasarli' && (
                                <input
                                  type="text"
                                  placeholder="Hasar veya eksiklik detayını yazınız..."
                                  value={returnExplanation}
                                  onChange={(e) =>
                                    setReturnExplanation(e.target.value)
                                  }
                                  className="w-full p-2.5 text-sm border border-gray-300 rounded outline-none focus:ring-2 focus:ring-[#0066b1] bg-white mt-1"
                                />
                              )}
                            </div>
                          ) : (
                            <>
                              <p
                                style={{
                                  fontSize: '12px',
                                  marginBottom: '8px',
                                }}
                              >
                                [ {returnCondition === 'eksiksiz' ? 'X' : ' '} ]
                                Eksiksiz, hasarsız ve çalışır durumda teslim
                                alınmıştır.
                              </p>
                              <p
                                style={{
                                  fontSize: '12px',
                                  marginBottom: '4px',
                                }}
                              >
                                [ {returnCondition === 'hasarli' ? 'X' : ' '} ]
                                Hasarlı / Eksik aksesuar ile teslim alınmıştır.
                              </p>
                              <p
                                style={{
                                  fontSize: '12px',
                                  color: '#333',
                                  marginTop: '8px',
                                }}
                              >
                                <span style={{ fontWeight: 'bold' }}>
                                  Açıklama:
                                </span>{' '}
                                {returnCondition === 'hasarli' &&
                                returnExplanation
                                  ? returnExplanation
                                  : '.........................................................................................................'}
                              </p>
                            </>
                          )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: isGenerating ? 'row' : 'column', justifyContent: 'space-between', gap: isGenerating ? '0px' : '30px' }}>
                          
                          {/* --- 1. ADIM: IT İMZASI --- */}
                          <div style={{ width: isGenerating ? '50%' : '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>{currentUser.name}</p>
                            <p style={{ fontSize: '11px', marginBottom: '8px' }}>Teslim Alan Yetkili (IT)</p>
                            
                            {!isGenerating && !returnItSignature && (
                              <SignaturePad onSign={setReturnItSignature} label="1. Önce Siz (IT) İmzalayın" />
                            )}
                            
                            <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className={(!isGenerating && !returnItSignature) ? 'hidden' : 'flex'}>
                              {returnItSignature && (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                  <img src={returnItSignature.image} alt="İmza IT" style={{ maxHeight: '60px', maxWidth: '100%' }} />
                                  <span style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>ID: {returnItSignature.hash}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* --- 2. ADIM: PERSONEL KODU VE İMZASI --- */}
                          <div style={{ width: isGenerating ? '50%' : '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>{returningData.person.name}</p>
                            <p style={{ fontSize: '11px', marginBottom: '8px' }}>Teslim Eden (İade Eden) Personel</p>
                            
                            {!isGenerating && (
                              <div className="w-full">
                                {returnItSignature && !returnPersonOtpData && (
                                  <OtpVerification personName={returningData.person.name} personEmail={returningData.person.email} currentUser={currentUser} onVerified={setReturnPersonOtpData} />
                                )}
                                {returnPersonOtpData && !returnPersonSignature && (
                                  <div className="animate-in slide-in-from-bottom-2 mt-4">
                                    <div className="bg-amber-50 text-amber-700 text-[10px] font-bold py-1.5 px-3 rounded-t-xl border border-amber-200 flex items-center justify-center gap-1.5 w-full max-w-[320px] mx-auto border-b-0">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> Kod Doğrulandı! Lütfen İmza Çizin.
                                    </div>
                                    <SignaturePad onSign={setReturnPersonSignature} label="2. Personel İmzası" />
                                  </div>
                                )}
                              </div>
                            )}
                            
                            <div style={{ height: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className={(!isGenerating && !returnPersonSignature) ? 'hidden' : 'flex'}>
                              {returnPersonSignature && (
                                <img src={returnPersonSignature.image} alt="İmza Personel" style={{ maxHeight: '45px', maxWidth: '100%', marginBottom: '2px' }} />
                              )}
                              {returnPersonOtpData && returnPersonSignature && (
                                <div style={{ border: '1px solid #0066b1', padding: '2px 8px', borderRadius: '4px', textAlign: 'center', backgroundColor: '#f0f7ff' }}>
                                  <p style={{ fontSize: '7px', color: '#0066b1', fontWeight: 'bold', margin: '0' }}>✓ E-POSTA İLE ONAYLANDI</p>
                                  <p style={{ fontSize: '6px', color: '#666', margin: '0' }}>{returnPersonOtpData.email}</p>
                                  <p style={{ fontSize: '6px', color: '#999', margin: '0', fontFamily: 'monospace' }}>Onay ID: {returnPersonOtpData.hash}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* İADE BUTONLARI VE ONAY KUTUSU (PDF DIŞINDA, EN ALTTA) */}
                      {!isGenerating && (
                        <div className="w-full max-w-[210mm] mt-6 bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-200 shrink-0 flex flex-col gap-6">
                          
                          {/* İADE HUKUKİ ONAY KUTUSU BURAYA GELDİ */}
                          <div className="p-4 bg-amber-50/50 border border-amber-200 rounded-xl">
                            <label className="flex items-start gap-3 cursor-pointer">
                              <div className="pt-1 shrink-0">
                                <input
                                  type="checkbox"
                                  checked={isReturnAccepted}
                                  onChange={(e) => setIsReturnAccepted(e.target.checked)}
                                  className="w-5 h-5 text-amber-600 rounded border-gray-300 focus:ring-amber-600 cursor-pointer"
                                />
                              </div>
                              <div className="text-[12px] text-gray-700 leading-relaxed text-justify">
                                <strong>Hukuki Onay:</strong> Üzerimde zimmetli olan yukarıdaki donanımı/donanımları ve ek aksesuarlarını, belirttiğim fiziksel ve donanımsal durumuyla kuruma iade ettiğimi beyan ederim. Varsa, kullanıcı hatasından kaynaklanan hasarların tespiti durumunda kurumun yasal ve idari haklarının saklı olduğunu kabul ediyorum.
                              </div>
                            </label>
                          </div>

                          {/* AKSİYON BUTONLARI */}
                          <div className="flex flex-col sm:flex-row justify-between gap-3">
                            <button
                              onClick={() => {
                                setReturningData(null);
                                setReturnItSignature(null);
                                setReturnPersonSignature(null);
                                setReturnPersonOtpData(null);
                                setReturnCondition('eksiksiz');
                                setReturnExplanation('');
                              }}
                              className="px-6 py-3 border border-gray-300 text-gray-700 font-bold rounded-lg shadow-sm hover:bg-gray-50 transition-all w-full sm:w-auto order-2 sm:order-1"
                            >
                              İptal
                            </button>
                            <button
                              onClick={handleFinalizeReturn}
                              // Hem imzalar hem de onay şart!
                              disabled={!returnPersonSignature || !returnItSignature || !returnPersonOtpData || !isReturnAccepted}
                              className={`px-6 py-3 font-bold rounded-lg shadow-md transition-all flex items-center justify-center w-full sm:w-auto order-1 sm:order-2 ${
                                (!returnPersonSignature || !returnItSignature || !returnPersonOtpData || !isReturnAccepted)
                                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                                  : 'bg-[#0066b1] text-white hover:bg-[#005595]'
                              }`}
                            >
                              <CheckCircle2 className="w-5 h-5 mr-2" /> İadeyi Onayla ve PDF Üret
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
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
              // Cihazı teslim alırken: Teslim eden "Bilgi İşlem Sorumlusu", Teslim alan işlemi yapan kişi.
              teslimEdenName = 'Bilgi İşlem Sorumlusu';
              teslimAlanName = currentUser.name;
            }

            return (
              <div
                className="fixed inset-0 bg-black/80 backdrop-blur-sm overflow-y-auto"
                style={{ zIndex: 9999999 }}
              >
                <div className="min-h-full flex items-start md:items-center justify-center p-2 sm:p-4 py-8">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden">
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
                        className="shadow-lg transition-all duration-300 relative"
                      >
                        {/* LOGO KISMI */}
                        <div style={{ marginBottom: '30px' }}>
                          <img
                            src="https://istek.site/logo/Kurum_Genel_Logo-01.png"
                            alt="İstek Okulları Logo"
                            style={{ height: '50px', width: 'auto' }}
                          />
                        </div>

                        {/* ORTALANMIŞ BAŞLIKLAR */}
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

                        {/* SAĞA DAYALI TARİH */}
                        <div
                          style={{ textAlign: 'right', marginBottom: '50px' }}
                        >
                          Teslim Tarihi:{' '}
                          {new Date().toLocaleDateString('tr-TR')}
                        </div>

                        {/* İMZA KISMI (Sol ve Sağ - Tam Ortalanmış Format) */}
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: isGenerating ? 'row' : 'column',
                            justifyContent: 'space-between',
                            gap: isGenerating ? '0px' : '30px',
                            marginTop: '40px',
                          }}
                        >
                          {/* Sol İmza (Gönderen / Teslim Eden) */}
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
                                    <SignaturePad onSign={setTransferSignature} label="İmzanızı Atın" />
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
                                      <img src={transferSignature.image} alt="İmza" style={{ maxHeight: '70px', maxWidth: '100%' }} />
                                      <span style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                                        ID: {transferSignature.hash}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Sağ İmza (Alan / Teslim Alan) */}
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
                                    <SignaturePad onSign={setTransferSignature} label="İmzanızı Atın" />
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
                                      <img src={transferSignature.image} alt="İmza" style={{ maxHeight: '70px', maxWidth: '100%' }} />
                                      <span style={{ fontSize: '7px', color: '#666', fontFamily: 'monospace', marginTop: '2px' }}>
                                        ID: {transferSignature.hash}
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

      {/* KUSURSUZ SÜZÜLEN (FLOATING) İŞLEM KAPSÜLÜ (MOBİL & MASAÜSTÜ KUSURSUZ UYUM) */}
      {selectedBulkHardware.length > 0 && (
        <div
          ref={floatingBtnsRef}
          className="fixed z-[999999] flex items-center justify-between floating-container"
          style={{
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 12px 45px rgba(0,0,0,0.2)',
            border: '1px solid rgba(0,0,0,0.08)',
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
                width: 96%; /* Mobilde ekranı tam kaplasın ama kenarlarda boşluk kalsın */
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
              {/* SABİT SOL: Sayı Rozeti */}
              <div
                className="bg-blue-600 text-white text-base md:text-lg font-black flex items-center justify-center shrink-0 shadow-sm"
                style={{ width: '36px', height: '36px', borderRadius: '50%' }}
              >
                {selectedBulkHardware.length}
              </div>

              {/* ORTA: Sadece Butonlar Kaydırılabilir Alanı (Mobilde sığmazsa diye) */}
              <div className="flex-1 flex items-center gap-1.5 md:gap-2 overflow-x-auto hide-scroll px-2 md:px-3">
                <button onClick={() => handleBulkAction('Depo')} className="bulk-btn" style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                  <Archive size={16} className="md:w-[18px] md:h-[18px]" /> Depo
                </button>
                <button onClick={() => handleBulkAction('Hurda')} className="bulk-btn" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>
                  <Trash2 size={16} className="md:w-[18px] md:h-[18px]" /> Hurda
                </button>
                <button onClick={() => setShowGroupModal(true)} className="bulk-btn" style={{ backgroundColor: '#f3e8ff', color: '#6b21a8' }}>
                  <Tag size={16} className="md:w-[18px] md:h-[18px]" /> Grup
                </button>
                <button onClick={() => setBulkCampusTransferMode(true)} className="bulk-btn" style={{ backgroundColor: '#3b82f6', color: '#ffffff' }}>
                  <Send size={16} className="md:w-[18px] md:h-[18px]" /> Transfer
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
                {Object.keys(CAMPUS_CODES).filter((c) => c !== currentUser.campus).map((c) => (
                    <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <button
                onClick={() => {
                  const selectedObjs = hardware.filter((h) => selectedBulkHardware.includes(h.id));
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
        !isSigning &&
        !viewingHardwareId &&
        !viewingPersonId &&
        !returningData &&
        !showAddHardwareModal &&
        !transferModalObj &&  
        !showNewTransferModal && 
        !confirmDialog && 
        !showGroupModal && 
        selectedHardware.length === 0 &&
        selectedBulkHardware.length === 0 &&
        selectedBulkPersonnel.length === 0 && (
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
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-500" style={{ zIndex: 99999999 }}>
          <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full text-center transform transition-all animate-in zoom-in-95">
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
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300" style={{ zIndex: 99999999 }}>
          <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full text-center transform transition-all animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-amber-100 text-amber-600">
              <span className="text-3xl">⚠️</span>
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Dikkat! Cihaz Zaten Zimmetli</h3>
            <p className="text-sm text-gray-600 font-medium leading-relaxed mb-4">Seçtiğiniz cihazlardan bazıları şu anda başka personellere zimmetli görünüyor:</p>
            
            <div className="w-full bg-amber-50 p-3 rounded-xl border border-amber-100 max-h-32 overflow-y-auto mb-6 text-left">
              {zimmetliCihazlarListesi.map((h) => {
                const owner = personnel.find((p) => p.id === h.assignedTo)?.name || 'Bilinmiyor';
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

              {/* İkonlar (Biri kaybolurken diğeri belirir) */}
              <div className="relative z-10 w-full h-full flex items-center justify-center">
                {/* Yükleniyor Çarkı */}
                <Loader2 
                  className={`absolute w-10 h-10 transition-all duration-500 ease-in-out animate-spin ${
                    successMessage ? 'opacity-0 scale-50 text-green-500' : 'opacity-100 scale-100 text-[#0066b1]'
                  }`} 
                />
                
                {/* Başarılı Tik İşareti */}
                <CheckCircle2 
                  className={`absolute w-10 h-10 transition-all duration-500 delay-150 ease-out ${
                    successMessage ? 'opacity-100 scale-100 text-green-600' : 'opacity-0 scale-150 text-[#0066b1]'
                  }`} 
                />
              </div>
            </div>

            {/* Metin Alanı (Yumuşak Metin Geçişi) */}
            <div className="w-full flex flex-col items-center justify-start text-center h-[80px] relative overflow-hidden">
              
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
                <p className="text-[13px] text-gray-600 font-medium leading-tight px-2">
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
          className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" 
          style={{ zIndex: 999999 }}
          onPointerDown={(e) => {
            // Arka plana tıklayınca klavyeyi kapat (blur)
            if (e.target === e.currentTarget) document.activeElement.blur();
          }}
        >
          <div 
            className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col max-w-sm w-full transform transition-all animate-in zoom-in-95"
            onPointerDown={(e) => e.stopPropagation()} // iOS Safari'nin tıklamayı yutmasını engeller
          >
            <h3 className="text-lg font-black text-gray-900 mb-2 flex items-center gap-2">
              <Tag className="w-5 h-5 text-purple-600" /> Cihazları Grupla
            </h3>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              Seçilen <strong className="text-[#0066b1]">{selectedBulkHardware.length} adet</strong> cihazı bir gruba atayın.
            </p>
            
            <div className="relative w-full z-50">
              <input
                list="existing-groups" 
                type="text" 
                placeholder="Grup Adı Girin"
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
      {/* YENİ: GOOGLE SHEETS OLUŞTURULDU MODALI (Pop-up Engeline Takılmamak İçin) */}
      {generatedSheetUrl && (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300"
          style={{ zIndex: 9999999999 }}
        >
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center max-w-sm w-full text-center transform transition-all animate-in zoom-in-95">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5 bg-green-100 text-green-600 border-4 border-green-50 shadow-inner">
              <Table className="w-10 h-10" />
            </div>
            
            <h3 className="text-xl font-black text-gray-900 mb-2">Tablonuz Hazır!</h3>
            <p className="text-sm text-gray-500 font-medium leading-relaxed mb-6">
              Seçtiğiniz veriler başarıyla Google E-Tablolar (Sheets) formatına dönüştürüldü.
            </p>
            
            <div className="flex w-full flex-col gap-3">
              <a
                href={generatedSheetUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setGeneratedSheetUrl(null)} // Tıklayınca modalı kapat
                className="w-full py-3.5 bg-green-600 text-white font-black rounded-xl shadow-md hover:bg-green-700 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-5 h-5" /> Tabloyu Görüntüle
              </a>
              
              <button
                onClick={() => setGeneratedSheetUrl(null)}
                className="w-full py-3 bg-gray-100 text-gray-600 font-bold rounded-xl hover:bg-gray-200 transition-colors"
              >
                Kapat
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
              src="https://drive.google.com/thumbnail?id=1b4vy0bcDxxm1ubDwhb3jp70spII-yzC-&sz=w1000" alt="Easter Egg"
              className="w-full max-w-[600px] max-h-[70vh] rounded-3xl border-4 border-[#0066b1] mb-6 object-contain shadow-[0_0_40px_rgba(0,102,177,0.4)]"
              onError={(e) => { e.target.onerror = null; e.target.src = 'https://media1.tenor.com/m/b10vA4_2v7kAAAAC/hacker-hack.gif'; }}
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
