import React from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  HardDrive,
  History,
  Loader2,
  Monitor,
  Printer,
  QrCode,
  Search,
  Send,
  Tag,
  Trash2,
  X,
  Laptop,
  Users,
  ExternalLink,
  Keyboard,
  Mouse,
  FileSignature,
  Terminal // <-- EKSİK OLAN İKON EKLENDİ
} from 'lucide-react';
import { GAS_URL } from '../config/appConfig.js';
import { CAMPUS_CODES } from '../constants/inventory.js';
import { toTrLower } from '../utils/text.js';

function getGlpiMismatchInfo(value) {
  const raw = String(value || '').trim();
  const normalized = raw.toLocaleUpperCase('tr-TR');
  if (!raw || normalized === 'OK') return { hasWarning: false, label: 'OK', title: 'GLPI eşleşmesi normal.' };

  const labels = {
    KAMPUS_FARKI: 'Kampüs farkı',
    KAMPÜS_FARKI: 'Kampüs farkı',
    KULLANICI_FARKI: 'Kullanıcı farkı',
    PERSONEL_FARKI: 'Personel farkı',
    TIP_FARKI: 'Tip farkı',
    TİP_FARKI: 'Tip farkı',
    MODEL_FARKI: 'Model farkı',
    SERI_NO_FARKI: 'Seri no farkı',
    SERİ_NO_FARKI: 'Seri no farkı',
    GLPI_ESLESMEDI: 'Eşleşmedi',
    GLPI_EŞLEŞMEDİ: 'Eşleşmedi',
    GLPI_ESLESME_YOK: 'Eşleşme yok',
    GLPI_EŞLEŞME_YOK: 'Eşleşme yok',
  };

  return {
    hasWarning: true,
    label: labels[normalized] || raw.replace(/_/g, ' ').toLocaleLowerCase('tr-TR'),
    title: raw,
  };
}

export const HardwareProfileModal = ({ deps }) => {
  const {
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
    campusPersonnel,
    handleManualUploadSubmit,
    handleOpenHistory,
    isLoadingHistory,
    showHardwareHistory,
    handlePdfClick,
    
    // --- BURADAN AŞAĞISI EKLENDİ (KARŞILAYICI) ---
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
  } = deps;
  const glpiMismatchInfo = getGlpiMismatchInfo(viewedHardware?.glpiMismatch);

  return (
    <>
      {viewingHardwareId && viewedHardware && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
          style={{ zIndex: 99999 }}
          onClick={() => {
            // YENI: Cihaz kapatilirken HER SEYI sıfırla
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
            {/* COMPACT HEADER (Baslik, Butonlar) */}
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
                  {/* Bilgisayar Ismi Koca Kutu Yerine Buraya Geldi */}
                  {(() => {
                    const showProfileComputerName =
                      viewedHardware.type === 'Laptop' ||
                      viewedHardware.type === 'Masaüstü' ||
                      viewedHardware.type === 'Masaüstü (PC)' ||
                      viewedHardware.type === 'All in One' ||
                      viewedHardware.type === 'Akilli Tahta';
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

                    const typeText = String(viewedHardware.type || '').toLowerCase();
                    const tCode = typeText.includes('laptop')
                      ? 'LAP'
                      : typeText.includes('all in one')
                      ? 'AIO'
                      : typeText.includes('akilli') || typeText.includes('tahta')
                      ? 'SPC'
                      : 'PC';
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
                          {viewedHardware.deviceName || 'Isim Ata'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">
                          {profileComputerPrefix}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
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
                    {/* TEKIL DEPO BUTONU (OPTIMISTIC UI) */}
                {viewedHardware.status !== 'Available' && (
                  <button
                    onClick={() => {
                      setConfirmDialog({
                        message: `Bu cihaz (S/N: ${viewedHardware.serial}) DEPOYA çekilecek. Onaylıyor musunuz?`,
                        type: 'info',
                        onConfirm: () => {
                          setConfirmDialog(null);
                          setViewingHardwareId(null); // Modali aninda kapat
                          
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
                            setHardware(previousHardwareState); // Hata olursa ekrani geri al
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

                {/* TEKIL HURDA BUTONU (OPTIMISTIC UI) */}
                {viewedHardware.status !== 'Hurda' && (
                  <button
                    onClick={() => {
                      setConfirmDialog({
                        message: `DİKKAT: Bu cihaz (S/N: ${viewedHardware.serial}) HURDAYA ayrılacak. Emin misiniz?`,
                        type: 'danger',
                        onConfirm: () => {
                          setConfirmDialog(null);
                          setViewingHardwareId(null); // Modali aninda kapat
                          
                          const previousHardwareState = [...hardware];
                          const targetId = viewedHardware.id;

                          // 1. Ekranda Anında Güncelle
                          setHardware((prev) => prev.map((h) => h.id === targetId ? { ...h, status: 'Hurda', assignedTo: null, groupName: '' } : h));
                          
                          setSuccessMessage('Cihaz arka planda hurdaya ayriliyor...');
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
                            setHardware(previousHardwareState); // Hata olursa ekrani geri al
                            alert('HATA: Internet sorunu nedeniyle cihaz hurdaya ayrilamadi.');
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

                {/* Ince Ayirici */}
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

                <button
                  onClick={() => handleOpenQrLabelPrint([viewedHardware])}
                  className="flex items-center justify-center p-2 sm:p-2.5 rounded-full bg-white text-[#0066b1] border border-blue-100 hover:bg-blue-50 transition-colors shadow-sm"
                  title="QR Etiket Yazdir"
                >
                  <QrCode className="w-4 h-4" />
                </button>

                {/* Kapatma Butonu (Her Zaman Görünür) */}
                <button
                  onClick={() => {
                    // YENI: Cihaz kapatilirken HER SEYI sıfırla
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
                        <CheckCircle2 className="w-3.5 h-3.5" /> Kopyalandi
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
              {(viewedHardware.glpiId || viewedHardware.glpiComputerName || viewedHardware.glpiMismatch) && (
                <div
                  className={`rounded-xl border p-2.5 flex items-center justify-between gap-3 shadow-sm ${
                    glpiMismatchInfo.hasWarning
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-emerald-50/60 border-emerald-100'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        glpiMismatchInfo.hasWarning
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      <Terminal className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">GLPI</p>
                      <p className="text-[12px] font-bold text-gray-800 truncate">
                        {viewedHardware.glpiComputerName || viewedHardware.deviceName || 'Eslesme yok'}
                        {viewedHardware.glpiAdUser ? ` • ${viewedHardware.glpiAdUser}` : ''}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[9px] font-black px-2 py-1 rounded-full shrink-0 ${
                      glpiMismatchInfo.hasWarning
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                    title={glpiMismatchInfo.title}
                  >
                    {glpiMismatchInfo.label}
                  </span>
                </div>
              )}
              {/* YENI: GRUP ETIKETI ALANI (Genis ve Sik) */}
              <div className="bg-indigo-50/50 rounded-xl border border-indigo-100 p-2.5 flex items-center justify-between gap-3 shadow-sm transition-all">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                    <Tag className="w-4 h-4 text-indigo-600" />
                  </div>
                  
                  {!isEditingSingleGroup ? (
                    <div className="flex flex-col min-w-0 w-full cursor-pointer" onClick={() => { setEditSingleGroupText(viewedHardware.groupName || ''); setIsEditingSingleGroup(true); }}>
                      <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">Cihaz Grubu</span>
                      <span className={`text-[12px] font-bold truncate ${viewedHardware.groupName ? 'text-indigo-900' : 'text-indigo-400/70 italic'}`}>
                        {viewedHardware.groupName || 'Bir gruba dahil degil. Ekle'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex-1 flex gap-2 animate-in slide-in-from-left-2 duration-200">
                      <input
                        list="single-group-list"
                        type="text"
                        placeholder="Grubu yazin..."
                        value={editSingleGroupText}
                        onChange={(e) => setEditSingleGroupText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isUpdatingSingleGroup) handleSaveSingleGroup(viewedHardware.id);
                        }}
                        className="flex-1 w-full text-xs font-bold text-indigo-700 p-1.5 border border-indigo-200 rounded outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                        autoFocus
                      />
                      <datalist id="single-group-list">
                        {Array.from(new Set(hardware.map((h) => h.groupName).filter(Boolean))).map((g) => (
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

              {/* 3. YENI: NOT ALANI (Ince ve Zarif Kutu - ?STEK Yesili) */}
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
                        {viewedHardware.notes || 'Not eklenmemis.'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex-1 flex gap-2">
                      <input
                        type="text"
                        placeholder="Kisa bir not yazin..."
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

                  {/* ALT SATIR: Isim (Sol) ve Butonlar (Sag) */}
                  <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center w-full min-w-0 gap-3">
                    
                    {/* SOL: Personel Ismi */}
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
                            // Mobilde enter'a basilinca sayfanin kaymasini engelle
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
    </>
  );
};
