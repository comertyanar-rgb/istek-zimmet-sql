import {
  Archive,
  Camera,
  CheckCircle2,
  FileSignature,
  History,
  Loader2,
  Printer,
  QrCode,
  Trash2,
  X,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

const getStatusLabel = (status) => {
  if (status === 'Available') return 'Depoda';
  if (status === 'Assigned') return 'Zimmetli';
  if (status === 'Hurda') return 'Hurda';
  if (status === 'Transfer') return 'Transfer';
  return status || '-';
};

const getStatusClass = (status) => {
  if (status === 'Available') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Assigned') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'Hurda') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Transfer') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
};

// Basit bir Bip sesi oluşturucu (Tarayıcı izin verirse çalar)
const playBeepSound = () => {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.value = 800; // Frekans (Hz)
    gainNode.gain.value = 0.1; // Ses seviyesi
    
    oscillator.start();
    setTimeout(() => oscillator.stop(), 100); // 100ms sonra dur
  } catch (e) {
    console.error("Ses çalınamadı:", e);
  }
};

export const QrScanTab = ({
  qrScannerActive,
  qrScannerError,
  qrVideoRef,
  qrScannedHardware,
  selectedQrHardwareIds,
  setSelectedQrHardwareIds,
  qrScanLog,
  isQrActionBusy = false,
  qrActionLabel = '',
  stopQrCamera,
  handleStartQrCamera,
  handleQrInventoryMark,
  handleQrStatusUpdate,
  handleQrStartZimmet,
  handleOpenQrLabelPrint,
  setViewingHardwareId,
  renderDeviceTypeIcon,
  getPersonName,
}) => {
  const selectedCount = selectedQrHardwareIds.length;
  const selectedAll =
    qrScannedHardware.length > 0 &&
    qrScannedHardware.every((item) => selectedQrHardwareIds.includes(item.id));

  // YENİ: Başarılı okuma animasyonu için state
  const [scanSuccessAnim, setScanSuccessAnim] = useState(false);
  const lastScannedCount = useRef(qrScannedHardware.length);
  const longPressRef = useRef({ timer: null, active: false, id: null });

  // qrScannedHardware listesi her değiştiğinde (yeni QR okunduğunda) animasyon tetiklenir
  useEffect(() => {
    if (qrScannedHardware.length > lastScannedCount.current) {
      playBeepSound();
      setScanSuccessAnim(true);
      setTimeout(() => setScanSuccessAnim(false), 800); // 800ms sonra animasyonu kapat
    }
    lastScannedCount.current = qrScannedHardware.length;
  }, [qrScannedHardware.length]);

  const toggleSelected = (id) => {
    setSelectedQrHardwareIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedAll) {
      setSelectedQrHardwareIds([]);
    } else {
      setSelectedQrHardwareIds(qrScannedHardware.map((item) => item.id));
    }
  };

  const startCardPress = (id) => {
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = { timer: null, active: false, id };
    longPressRef.current.timer = window.setTimeout(() => {
      longPressRef.current.active = true;
      toggleSelected(id);
      if (navigator.vibrate) navigator.vibrate(18);
    }, 420);
  };

  const clearCardPressTimer = () => {
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current.timer = null;
  };

  const handleCardClick = (id) => {
    if (longPressRef.current.active && longPressRef.current.id === id) {
      longPressRef.current = { timer: null, active: false, id: null };
      return;
    }

    if (selectedCount > 0) {
      toggleSelected(id);
      return;
    }

    setViewingHardwareId(id);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-in fade-in pb-32">
      <style>{`
        .qr-hide-scroll::-webkit-scrollbar { display: none; }
        .qr-hide-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
      <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        {/* ÜST BİLGİ ALANI */}
        <div className="p-4 md:p-6 border-b border-gray-100 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#0066b1] text-white flex items-center justify-center shadow-sm shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg md:text-xl font-black text-gray-900 truncate">QR Sayım ve İşlem</h2>
              <p className="text-xs text-gray-500 font-semibold truncate">
                Kamerayla QR okutun, cihazları listeden seçip işlem yapın.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-4">
          {/* HATA EKRANI */}
          {qrScannerError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2 text-sm font-semibold">
              {qrScannerError}
            </div>
          )}

          <div className="grid md:grid-cols-[minmax(240px,360px)_1fr] gap-4">
            
            {/* KAMERA ALANI (DÜZELTİLDİ: Tekrar Aspect-Square yapıldı) */}
            <div className="rounded-3xl border border-gray-200 bg-slate-50 p-3 shadow-inner h-full flex flex-col w-full max-w-[280px] sm:max-w-[320px] md:max-w-none mx-auto">
              <div className="aspect-square w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center relative">
                
                {qrScannerActive ? (
                  /* --- KAMERA AÇIKKEN GÖRÜNECEK KISIM --- */
                  <>
                    <video
                      ref={qrVideoRef}
                      className="absolute inset-0 w-full h-full object-cover"
                      autoPlay
                      playsInline
                      muted
                    />
                    
                    {/* Kamera Kapatma Butonu (Video İçinde Sağ Üstte) */}
                    <button
                      onClick={stopQrCamera}
                      className="absolute top-3 right-3 bg-black/60 hover:bg-red-600 text-white rounded-full p-2 transition-colors z-20 backdrop-blur-sm"
                      title="Kamerayı Kapat"
                    >
                      <X className="w-5 h-5" />
                    </button>

                    {/* Odak Çerçevesi */}
                    <div className="absolute inset-12 md:inset-16 border-2 border-white/70 rounded-2xl shadow-[0_0_0_999px_rgba(0,0,0,0.4)] pointer-events-none" />
                    
                    {/* Bilgi Metni */}
                    <div className="absolute bottom-4 left-4 right-4 text-center text-xs font-bold text-white/90 bg-black/50 rounded-full py-2 pointer-events-none backdrop-blur-sm">
                      QR etiketi kare içine alın
                    </div>

                    {/* BAŞARILI OKUMA ANİMASYONU */}
                    {scanSuccessAnim && (
                      <div className="absolute inset-0 bg-green-500/30 backdrop-blur-[2px] flex items-center justify-center z-30 animate-in fade-in zoom-in duration-200">
                         <div className="bg-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 transform scale-110">
                            <CheckCircle2 className="w-6 h-6 text-green-600" />
                            <span className="font-black text-green-700 text-sm">OKUNDU!</span>
                         </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* --- KAMERA KAPALIYKEN GÖRÜNECEK KISIM --- */
                  <div className="text-center text-slate-400 px-6 flex flex-col items-center justify-center h-full w-full">
                    <QrCode className="w-16 h-16 mx-auto mb-4 opacity-40" />
                    <button 
                      onClick={handleStartQrCamera}
                      className="bg-[#0066b1] hover:bg-[#005595] shadow-lg shadow-blue-500/30 text-white px-6 py-3 rounded-2xl text-sm font-black transition-all flex items-center gap-2"
                    >
                      <Camera className="w-5 h-5" /> Kamerayı Aç
                    </button>
                    <p className="text-[11px] font-medium text-slate-500 mt-4 px-4 text-center leading-relaxed">
                      Cihaz üzerindeki karekodu okutmak için kamerayı başlatın.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* OKUNAN CİHAZLAR LİSTESİ */}
            <div className="rounded-3xl border border-gray-200 bg-white overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3 bg-gray-50/50">
                <div>
                  <h3 className="font-black text-gray-900">Okunan Cihazlar</h3>
                  <p className="text-xs font-semibold text-gray-500">
                    {qrScannedHardware.length} okundu, {selectedCount} seçili
                  </p>
                </div>
                {qrScannedHardware.length > 0 && (
                  <button
                    onClick={toggleAll}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-black text-[#0066b1] bg-white hover:bg-blue-50 transition-colors shadow-sm"
                  >
                    {selectedAll ? 'Seçimi Kaldır' : 'Tümünü Seç'}
                  </button>
                )}
              </div>

              {qrScannedHardware.length === 0 ? (
                <div className="p-8 text-center text-gray-400 flex-1 flex flex-col justify-center">
                  <QrCode className="w-10 h-10 mx-auto mb-3 text-gray-200" />
                  <p className="font-bold">Henüz QR okutulmadı.</p>
                  <p className="text-xs mt-1">Okutulan cihazlar burada listelenecektir.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
                  {qrScannedHardware.map((item) => {
                    const selected = selectedQrHardwareIds.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => handleCardClick(item.id)}
                        onTouchStart={() => startCardPress(item.id)}
                        onTouchEnd={clearCardPressTimer}
                        onTouchMove={clearCardPressTimer}
                        onMouseDown={() => startCardPress(item.id)}
                        onMouseUp={clearCardPressTimer}
                        onMouseLeave={clearCardPressTimer}
                        className={`p-3 md:p-4 flex items-start gap-3 cursor-pointer transition-colors ${
                          selected ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                        }`}
                      >
                        {selectedCount > 0 && (
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelected(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-2 w-5 h-5 rounded border-gray-300 text-[#0066b1] focus:ring-[#0066b1] cursor-pointer shrink-0"
                          />
                        )}
                        <div className="w-10 h-10 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shrink-0 shadow-sm">
                          {renderDeviceTypeIcon(item.type, 'w-5 h-5 text-[#0066b1]')}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-black text-gray-900 truncate">
                                {item.deviceName || item.glpiComputerName || item.serial}
                              </p>
                              <p className="text-xs text-gray-500 font-semibold truncate">
                                {[item.brand, item.model].filter(Boolean).join(' ') || item.type || 'Cihaz'}
                              </p>
                              <p className="text-xs text-[#0066b1] font-bold mt-0.5">S/N: {item.serial || item.id}</p>
                            </div>
                            <span className={`text-[10px] font-black border px-2 py-1 rounded-full shrink-0 ${getStatusClass(item.status)}`}>
                              {getStatusLabel(item.status)}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl bg-white border border-gray-100 p-2 shadow-sm">
                              <p className="text-[9px] font-bold uppercase text-gray-400">Kampüs</p>
                              <p className="font-bold text-gray-700 truncate">{item.campus || '-'}</p>
                            </div>
                            <div className="rounded-xl bg-white border border-gray-100 p-2 shadow-sm">
                              <p className="text-[9px] font-bold uppercase text-gray-400">Personel</p>
                              <p className="font-bold text-gray-700 truncate">{getPersonName(item.assignedTo)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* DÜZELTİLDİ: SADECE SEÇİM YAPILINCA GÖRÜNECEK İŞLEM BUTONLARI */}
          {selectedCount > 0 && (
            <div className="fixed left-1/2 bottom-3 z-[999999] w-[calc(100%-16px)] max-w-3xl -translate-x-1/2 rounded-full border border-blue-200 bg-white/95 backdrop-blur-md p-1.5 flex items-center gap-1.5 shadow-2xl animate-in slide-in-from-bottom-2">
              <span className="w-8 h-8 rounded-full bg-[#0066b1] text-white flex items-center justify-center font-black shrink-0 text-sm">
                {isQrActionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : selectedCount}
              </span>
              {isQrActionBusy && (
                <span className="hidden min-[430px]:inline text-[11px] font-black text-[#0066b1] whitespace-nowrap px-1">
                  {qrActionLabel || 'İşleniyor...'}
                </span>
              )}
              <div className="flex-1 flex items-center justify-between gap-1 min-w-0">
                <button disabled={isQrActionBusy} onClick={handleQrInventoryMark} className="h-10 w-10 sm:w-auto sm:px-3 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-black text-xs flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-45 disabled:cursor-not-allowed" title="Sayımda gör">
                  <CheckCircle2 className="w-4 h-4" /> <span className="hidden sm:inline">Sayım</span>
                </button>
                <button disabled={isQrActionBusy} onClick={() => handleQrStatusUpdate('Available')} className="h-10 w-10 sm:w-auto sm:px-3 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 font-black text-xs flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-45 disabled:cursor-not-allowed" title="Depoya çek">
                  <Archive className="w-4 h-4" /> <span className="hidden sm:inline">Depo</span>
                </button>
                <button disabled={isQrActionBusy} onClick={() => handleQrStatusUpdate('Hurda')} className="h-10 w-10 sm:w-auto sm:px-3 rounded-full bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 font-black text-xs flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-45 disabled:cursor-not-allowed" title="Hurdaya ayır">
                  <Trash2 className="w-4 h-4" /> <span className="hidden sm:inline">Hurda</span>
                </button>
                <button disabled={isQrActionBusy} onClick={handleQrStartZimmet} className="h-10 w-10 sm:w-auto sm:px-3 rounded-full bg-[#0066b1] text-white hover:bg-[#005595] font-black text-xs flex items-center justify-center gap-2 transition-colors shadow-sm shrink-0 disabled:opacity-45 disabled:cursor-not-allowed" title="Zimmete aktar">
                  <FileSignature className="w-4 h-4" /> <span className="hidden sm:inline">Zimmet</span>
                </button>
                <button disabled={isQrActionBusy} onClick={() => handleOpenQrLabelPrint(qrScannedHardware.filter((item) => selectedQrHardwareIds.includes(item.id)))} className="h-10 w-10 sm:w-auto sm:px-3 rounded-full bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-black text-xs flex items-center justify-center gap-2 transition-colors shrink-0 disabled:opacity-45 disabled:cursor-not-allowed" title="Etiket yazdır">
                  <Printer className="w-4 h-4" /> <span className="hidden sm:inline">Etiket</span>
                </button>
              </div>
              <button
                disabled={isQrActionBusy}
                onClick={() => setSelectedQrHardwareIds([])}
                className="w-8 h-8 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Seçimi temizle"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* İŞLEM GEÇMİŞİ LOGU */}
          {qrScanLog.length > 0 && (
            <div className="rounded-3xl border border-gray-200 bg-white overflow-hidden mt-6">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 className="font-black text-gray-900 flex items-center gap-2">
                   <History className="w-4 h-4 text-gray-400" /> İşlem Günlüğü
                </h3>
                <span className="text-xs font-bold text-gray-500 bg-white border border-gray-200 px-2 py-1 rounded-lg shadow-sm">
                  {qrScanLog.length} Kayıt
                </span>
              </div>
              <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                {qrScanLog.map((entry) => (
                  <div key={entry.id} className="p-3 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      <p className="font-bold text-gray-800 truncate text-[13px]">{entry.deviceName}</p>
                      <p className="text-[11px] text-gray-500 font-semibold">S/N: {entry.serial}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] font-black text-[#0066b1] uppercase tracking-wider">{entry.action}</p>
                      <p className="text-[10px] text-gray-400 font-medium">{entry.at}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
