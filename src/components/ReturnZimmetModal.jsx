import React from 'react';
import { CheckCircle2, FileSignature, Loader2, X, FileText } from 'lucide-react';
import { OtpVerification } from './OtpVerification.jsx';
import { SignaturePad } from './SignaturePad.jsx';

function formatSerial(value) {
  const text = String(value ?? '').trim();
  if (!text) return '-';
  if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) {
    const numeric = Number(text);
    if (Number.isFinite(numeric) && Math.abs(numeric) <= Number.MAX_SAFE_INTEGER) {
      return numeric.toLocaleString('fullwide', { useGrouping: false });
    }
  }
  return text;
}

export function ReturnZimmetModal({ deps }) {
  const {
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
    
    // --- BURADAN AŞAĞISI EKLENDİ (KARŞILAYICI) ---
    clientIp,
    handlePersonPhoneSaved,
    handlePdfClick
  } = deps;

  return (
    <>
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
                            {formatSerial(hw.serial)}
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
                            checked={returnCondition === 'hasarlı'}
                            onChange={() => setReturnCondition('hasarlı')}
                            className="w-4 h-4 text-[#0066b1]"
                          />
                          <span>
                            Hasarlı / Eksik aksesuar ile teslim
                            alınmıştır.
                          </span>
                        </label>
                        {returnCondition === 'hasarlı' && (
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
                          [ {returnCondition === 'hasarlı' ? 'X' : ' '} ]
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
                          {returnCondition === 'hasarlı' &&
                          returnExplanation
                            ? returnExplanation
                            : '.........................................................................................................'}
                        </p>
                      </>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: isGenerating ? 'row' : 'column', justifyContent: 'space-between', gap: isGenerating ? '0px' : '30px' }}>
                    
                    {/* --- 1. ADIM: IT IMZASI --- */}
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

                    {/* --- 2. ADIM: PERSONEL KODU VE IMZASI --- */}
                    <div style={{ width: isGenerating ? '50%' : '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>{returningData.person.name}</p>
                      <p style={{ fontSize: '11px', marginBottom: '8px' }}>Teslim Eden (İade Eden) Personel</p>
                      
                      {!isGenerating && (
                        <div className="w-full">
                          {returnItSignature && !returnPersonOtpData && (
                            <OtpVerification personId={returningData.person.id} personName={returningData.person.name} personEmail={returningData.person.email} personPhone={returningData.person.phone} currentUser={currentUser} onPhoneSaved={handlePersonPhoneSaved} onVerified={setReturnPersonOtpData} />
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

                    {/* AKSIYON BUTONLARI */}
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
                        // Hem imzalar hem de onay sart!
                        disabled={!returnPersonSignature || !returnItSignature || !returnPersonOtpData || !isReturnAccepted}
                        className={`px-6 py-3 font-bold rounded-lg shadow-md transition-all flex items-center justify-center w-full sm:w-auto order-1 sm:order-2 ${
                          (!returnPersonSignature || !returnItSignature || !returnPersonOtpData || !isReturnAccepted)
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                            : 'bg-[#0066b1] text-white hover:bg-[#005595]'
                        }`}
                      >
                        {isGenerating ? (
                          <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> İşleniyor...</>
                        ) : (
                          <><CheckCircle2 className="w-5 h-5 mr-2" /> İadeyi Onayla ve PDF Üret</>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
