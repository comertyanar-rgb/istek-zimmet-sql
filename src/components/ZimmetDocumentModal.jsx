import React from 'react';
import { CheckCircle2, FileSignature, Loader2 } from 'lucide-react';
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

export function ZimmetDocumentModal({ deps }) {
  const {
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
  } = deps;

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

          {/* === 1. SAYFA BASLANGICI === */}
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
                      <td>{formatSerial(item.serial)}</td>
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

          {/* === 2. SAYFA BASLANGICI === */}
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

            {/* 2. SAYFA IMZA VE OTP AKIS ALANI */}
            <div style={{ display: 'flex', flexDirection: isGenerating ? 'row' : 'column', justifyContent: 'space-between', gap: isGenerating ? '0px' : '30px', marginTop: '40px' }}>
              
              {/* --- 1. ADIM: IT IMZASI --- */}
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

              {/* --- 2. ADIM: PERSONEL KODU VE IMZASI --- */}
              <div style={{ width: isGenerating ? '50%' : '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <p style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px' }}>Tebellüğ Eden (Personel):</p>
                <p style={{ fontSize: '12px', marginBottom: '8px' }}>{person?.name}</p>
                
                {!isGenerating && (
                  <div className="w-full">
                    {itSignature && !personOtpData && (
                       <OtpVerification personId={person?.id} personName={person?.name} personEmail={person?.email} personPhone={person?.phone} currentUser={currentUser} onPhoneSaved={handlePersonPhoneSaved} onVerified={setPersonOtpData} />
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
            
            {/* HUKUKI ONAY VE KVKK KUTUSU */}
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

            {/* AKSIYON BUTONLARI */}
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
}
