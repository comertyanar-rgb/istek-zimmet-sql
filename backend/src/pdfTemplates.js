import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_LOGO_PATH = path.resolve(__dirname, '../../public/logo.png');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function trDate(value = new Date()) {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeZone: 'Europe/Istanbul' }).format(value);
}

function trDateTime(value = new Date()) {
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Istanbul'
  }).format(value);
}

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

function logoHtml() {
  try {
    const logoBytes = fs.readFileSync(PUBLIC_LOGO_PATH);
    return `<img src="data:image/png;base64,${logoBytes.toString('base64')}" style="height:50px;max-width:180px;object-fit:contain;" />`;
  } catch {
    return '<h2 style="font-size:18px;margin:0;color:#0066b1;">İSTEK OKULLARI</h2>';
  }
}

function legacyHardwareRows(items = [], accessories = []) {
  const rows = [];
  for (const item of items) {
    rows.push({
      no: String(rows.length + 1),
      type: item.type || 'Cihaz',
      model: [item.brand, item.model].filter(Boolean).join(' ') || '-',
      serial: formatSerial(item.serial)
    });
  }
  for (const item of accessories) {
    rows.push({
      no: '-',
      type: 'Aksesuar',
      model: [item.brand, item.model].filter(Boolean).join(' ') || '-',
      serial: '-'
    });
  }

  return rows.map((item) => `
    <tr>
      <td style="border:1px solid #000;padding:6px;text-align:center;">${escapeHtml(item.no)}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center;">${escapeHtml(item.type)}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center;">${escapeHtml(item.model)}</td>
      <td style="border:1px solid #000;padding:6px;text-align:center;">${escapeHtml(item.serial)}</td>
    </tr>
  `).join('');
}

export function buildZimmetDocumentHtml(payload) {
  const isReturn = payload.documentType === 'return';
  const title = isReturn ? 'DONANIM İADE TUTANAĞI' : 'DONANIM ZİMMET TESLİM TUTANAĞI';
  const today = trDate();
  const currentTime = trDateTime();
  const person = payload.person || {};
  const signatures = payload.signatures || {};
  const personTitle = person.department && person.department !== 'Personel'
    ? ` - ${escapeHtml(person.department)}`
    : '';
  const altText = isReturn
    ? `Yukarıda marka, model ve seri numarası belirtilen İSTEK İstanbul Eğitim Hizmetleri A.Ş. mülkiyetindeki donanım, <strong>${today}</strong> tarihinde aşağıda imzası bulunan personel tarafından Bilgi İşlem (IT) departmanına iade edilmiştir.<br><br><strong>Cihazın İade Anındaki Durumu: </strong>${payload.returnCondition === 'eksiksiz' ? 'Eksiksiz, hasarsız ve çalışır durumda.' : `Hasarlı/Eksik: ${escapeHtml(payload.returnExplanation || '-')}`}`
    : `Yukarıda marka, model ve seri numarası belirtilen İSTEK İstanbul Eğitim Hizmetleri A.Ş. mülkiyetindeki donanım, <strong>${today}</strong> tarihinde tarafıma eksiksiz ve sorunsuz olarak teslim edilmiştir. Cihazı, 'Bilişim Kaynaklarını Kullanma Yönergesi' şartlarına uygun şekilde kullanacağımı, donanıma herhangi bir zarar verdiğim takdirde vermiş olduğum zarara ilişkin tutarın ücretimden, tazminatlarımdan ve diğer tüm hak edişlerimden kesilmesine nakden ve defaten muvafakat ettiğimi kabul ve beyan ederim.${payload.zimmetExplanation ? `<br><br><strong>Ek Açıklama / Not:</strong> ${escapeHtml(payload.zimmetExplanation)}` : ''}`;

  const signatureCell = (titleText, name, signature, otpHash = '') => `
    <td style="width:50%;border:none;vertical-align:top;text-align:center;">
      <div style="font-size:12px;margin-bottom:4px;"><strong>${titleText}</strong></div>
      <div style="font-size:13px;font-weight:bold;margin-bottom:10px;">${escapeHtml(name || '')}</div>
      ${signature ? `<img src="${signature}" style="height:60px;max-width:150px;object-fit:contain;"/>` : ''}
      ${otpHash ? `<div style="font-family:monospace;font-size:8px;color:#666;margin-top:5px;">OTP ID: ${escapeHtml(otpHash)}</div>` : ''}
    </td>
  `;

  const page1 = `
    <div style="padding:10px 30px;font-family:Arial,sans-serif;font-size:11px;color:#000;line-height:1.4;">
      <h3 style="text-align:center;font-weight:bold;font-size:15px;margin-bottom:20px;text-decoration:underline;">${title}</h3>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:11px;">
        <tr><td colspan="2" style="background-color:#f9fafb;border:1px solid #000;padding:6px;font-weight:bold;text-align:center;">İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.</td></tr>
        <tr><td style="border:1px solid #000;padding:6px;font-weight:bold;width:25%;">KAMPÜS / OKUL</td><td style="border:1px solid #000;padding:6px;">${escapeHtml(payload.campus || person.campus || '-')}</td></tr>
        <tr><td style="border:1px solid #000;padding:6px;font-weight:bold;">PERSONEL / ÜNVAN</td><td style="border:1px solid #000;padding:6px;">${escapeHtml(person.name || '')}${personTitle}</td></tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:25px;font-size:11px;text-align:center;">
        <tr style="background-color:#f9fafb;"><th colspan="4" style="border:1px solid #000;padding:6px;font-weight:bold;">İLGİLİ DONANIM BİLGİLERİ</th></tr>
        <tr>
          <th style="border:1px solid #000;padding:6px;width:60px;font-weight:bold;">SIRA NO</th>
          <th style="border:1px solid #000;padding:6px;font-weight:bold;">CİHAZ TİPİ</th>
          <th style="border:1px solid #000;padding:6px;font-weight:bold;">MARKA / MODEL</th>
          <th style="border:1px solid #000;padding:6px;font-weight:bold;">SERİ NUMARASI</th>
        </tr>
        ${legacyHardwareRows(payload.hardware || [], payload.accessories || [])}
      </table>

      <p style="text-align:justify;margin-bottom:40px;font-size:12px;line-height:1.6;">${altText}</p>

      <table style="width:100%;text-align:center;border:none;margin-top:50px;">
        <tr>
          ${signatureCell(isReturn ? 'İade Eden Personel' : 'Teslim Alan Personel', person.name, signatures.person, signatures.otpHash)}
          ${signatureCell(isReturn ? 'Teslim Alan (IT)' : 'Teslim Eden (IT)', payload.itName || payload.requestedBy, signatures.it)}
        </tr>
      </table>
    </div>
  `;

  const page2 = `
    <div style="page-break-before:always;padding:20px 30px;font-family:Arial,sans-serif;font-size:11px;color:#000;line-height:1.4;">
      <div style="text-align:center;font-weight:bold;margin-bottom:20px;">
        <h2 style="font-size:15px;margin:0 0 8px 0;">İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.</h2>
        <h2 style="font-size:14px;margin:0;">BİLGİ İŞLEM DİZÜSTÜ BİLGİSAYAR KULLANIM YÖNERGESİ</h2>
      </div>

      <div>
        <p style="margin-bottom:6px;"><strong>1. Bilgisayar Kullanım Kuralları</strong></p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>a)</strong> Hizmet Paketi kapsamında personel kullanımına verilen dizüstü bilgisayarlar İSTEK İstanbul Eğitim Hizmetleri A.Ş mülkiyetindedir. Bilişim Kaynaklarını Kullanma Yönergesi'nde belirtilen yararlanma koşullarına uygun olarak, personelin sözleşmesi süresince kullanımına tahsis edilir.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>b)</strong> Personel genel müdürlük ve insan kaynakları departmanı tarafından duyurulan tarihte bilgisayarını tüm aksesuarları ile birlikte iade etmekle sorumludur. Üzerinde etiket, yazı vs. kesinlikle olmamalıdır.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>c)</strong> Geçici veya daimi olarak ayrılan personel, bilgisayarını aldığı haliyle iade etmek zorundadır.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>d)</strong> Personel İşveren tarafından kendisine tahsis edilecek dizüstü bilgisayarı ve bilgisayarda yer alan her türlü veriyi işveren tarafından belirlenecek amaçlar ve işin yürütümü ile ilgili olarak kullanmakla yükümlüdür. Buna aykırılık halinde, Personel İşveren' in kişisel veriler de dahil olmak üzere verileri kullanabileceğini, kontrol edebileceğini, fesih gerekçesi olarak kullanabileceğini ve bu durumun kişisel verilerin gizliliğine aykırılık teşkil etmeyeceğini kabul ve beyan eder.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>e)</strong> Personel işverenin izni olmaksızın kullanımına verilen dizüstü bilgisayara herhangi bir program <u>yüklemeyeceğini</u>, buna aykırılık halinde söz konusu programın yüklenmesinden doğan her türlü zarardan (lisanssız ürün kullanımından doğan ceza ve tazminat sorumluluğu da dahil olmak üzere) kendisinin sorumlu olacağını kabul ve beyan eder.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>f)</strong> Personel bilgi işlemin onayı olmadan kullanımına verilen dizüstü bilgisayara kurum dışında herhangi bir donanımsal müdahale, onarım işlemi <u>yapmayacağını</u> (tamir) buna aykırılık halinde söz konusu müdahaleden ötürü her türlü zarardan kendisinin sorumlu olacağını kabul ve beyan eder.</p>

        <p style="margin-top:15px;margin-bottom:6px;"><strong>2. Garanti Kapsamı</strong></p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>a)</strong> Kullanıma verilen dizüstü bilgisayar, Dizüstü Bilgisayar Hizmet Paketi kapsamında üretiminden kaynaklanan hata, kusur veya arızalar için üretici firma garantisi altındadır.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>b)</strong> Garanti koşullarını açıklayıcı belgeler dizüstü bilgisayar ile birlikte verilmektedir. Dizüstü Bilgisayar Hizmet Paketi kapsamında sağlanan destek hizmetleri yurtdışında geçerli değildir.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>c)</strong> Personel arzu ettiği takdirde ücretini kendisi karşılamak kaydıyla bilgisayarı sigortalatabilir.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>d)</strong> Personelin bilgi ve belgelerinin yedekleme sorumluluğu kendisine aittir. Bütün yedeklerini Google drive hesabına alabilir.</p>

        <p style="margin-top:15px;margin-bottom:6px;"><strong>3. Ödemeler ve Cezai Yükümlülükler</strong></p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>a)</strong> Garanti kapsamına girmeyen kusur, ihmal veya dikkatsizlik sonucu bilgisayarda meydana gelebilecek hasarlardan dolayı personel, Bilgi İşlem Müdürlüğü tarafından kendisine yapılan bildirimi takiben en geç 15 gün içerisinde, arızalı parça ve/veya tamir bedelini ödemekle yükümlüdür.</p>
        <p style="margin-bottom:6px;text-align:justify;"><strong>b)</strong> Herhangi bir nedenle iş akdi feshedilen personel bilgisayarını teslim aldığı şekilde iade etmezse, teslim belgesi ve ilgili yönergelere dayanarak İSTEK İstanbul Eğitim Hizmetleri A.Ş tarafından aleyhinde yasal takip başlatılır, tüm aksesuarları ile birlikte bilgisayar veya bedeli ilgili distribütörün vereceği satış fiyatı üzerinden yasal faizleri ile birlikte talep edilir.</p>
      </div>

      <table style="width:100%;text-align:center;border:none;margin-top:25px;">
        <tr>
          ${signatureCell('Tebellüğ Eden (Personel)', person.name, signatures.person)}
          ${signatureCell('Tebliğ Eden (IT)', payload.itName || payload.requestedBy, signatures.it)}
        </tr>
      </table>

      <div style="margin-top:25px;font-size:9px;color:#777;border-top:1px solid #ccc;padding-top:10px;">
        <strong>DİJİTAL İŞLEM LOGU:</strong> IP: ${escapeHtml(payload.clientIp || 'Bilinmiyor')} | Zaman: ${escapeHtml(currentTime)} | Yetkili: ${escapeHtml(payload.itEmail || payload.requestedBy || '')}
      </div>
    </div>
  `;

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 12mm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; }
    * { box-sizing: border-box; }
  </style>
</head>
<body>
  ${page1}
  ${page2}
</body>
</html>`;
}

export function buildTransferDocumentHtml(payload) {
  const isOut = payload.transferDirection === 'out';
  const today = trDate();
  const currentTime = trDateTime();
  const signatures = payload.signatures || {};
  const senderCampus = payload.senderCampus || '-';
  const receiverCampus = payload.receiverCampus || '-';
  const targetCampus = isOut ? receiverCampus : receiverCampus;
  const senderName = isOut
    ? payload.itName || payload.requestedBy || ''
    : payload.senderItName || 'Bilgi İşlem Sorumlusu';
  const receiverName = !isOut
    ? payload.itName || payload.requestedBy || ''
    : payload.receiverItName || 'Bilgi İşlem Sorumlusu';

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 12mm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; }
    * { box-sizing: border-box; }
  </style>
</head>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; line-height: 1.4; padding: 20px 25px;">
  <div style="margin-bottom: 30px;">${logoHtml()}</div>

  <div style="text-align: center; margin-bottom: 50px;">
    <h3 style="font-size: 14px; font-weight: bold; margin: 0 0 10px 0;">İSTEK OKULLARI GENEL MÜDÜRLÜĞÜ</h3>
    <h3 style="font-size: 14px; font-weight: bold; margin: 0 0 10px 0;">BİLGİ İŞLEM DEPARTMANI</h3>
    <h3 style="font-size: 14px; font-weight: bold; margin: 0; text-decoration: underline;">TRANSFER TESLİM TUTANAĞI</h3>
  </div>

  <p style="text-align: justify; margin-bottom: 30px; text-indent: 30px; font-size: 12px; line-height: 1.5;">
    İş bu tutanak aşağıda belirtilen marka, model ve seri numarası yazılı donanımlar, İSTEK
    <strong>${escapeHtml(targetCampus).toLocaleUpperCase('tr-TR')}</strong> bilgi işlem departmanına kullanılmak üzere teslim edilmiştir.
  </p>

  <table style="width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 11px;">
    <tr style="background-color: #f3f4f6;">
      <th style="border: 1px solid #000; padding: 8px; text-align: center; width: 10%;">S. NO</th>
      <th style="border: 1px solid #000; padding: 8px; text-align: center;">CİHAZ TİPİ</th>
      <th style="border: 1px solid #000; padding: 8px; text-align: center;">MARKA / MODEL</th>
      <th style="border: 1px solid #000; padding: 8px; text-align: center;">SERİ NO</th>
    </tr>
    ${legacyHardwareRows(payload.hardware || [], [])}
  </table>

  <div style="text-align: right; margin-bottom: 50px; font-weight: bold; font-size: 12px;">
    İşlem Tarihi: ${escapeHtml(today)}
  </div>

  <table style="width: 100%; text-align: center; border: none; margin-top: 20px;">
    <tr>
      <td style="width: 50%; border: none; vertical-align: top;">
        <div style="font-size: 12px; font-weight: bold; text-decoration: underline; margin-bottom: 20px;">Teslim Eden (Gönderen)</div>
        <div style="font-size: 12px; margin-bottom: 10px;">${escapeHtml(senderName)}</div>
        ${isOut && signatures.transfer ? `<img src="${signatures.transfer}" style="height: 60px; max-width: 150px; object-fit: contain;" />` : ''}
        <div style="font-size: 10px; color: #777; margin-top: 8px;">${escapeHtml(senderCampus)}</div>
      </td>
      <td style="width: 50%; border: none; vertical-align: top;">
        <div style="font-size: 12px; font-weight: bold; text-decoration: underline; margin-bottom: 20px;">Teslim Alan (Alıcı)</div>
        <div style="font-size: 12px; margin-bottom: 10px;">${escapeHtml(receiverName)}</div>
        ${!isOut && signatures.transfer ? `<img src="${signatures.transfer}" style="height: 60px; max-width: 150px; object-fit: contain;" />` : ''}
        <div style="font-size: 10px; color: #777; margin-top: 8px;">${escapeHtml(receiverCampus)}</div>
      </td>
    </tr>
  </table>

  <div style="margin-top: 100px; font-size: 8px; color: #777; border-top: 1px solid #ccc; padding-top: 10px;">
    <strong>DİJİTAL İŞLEM LOGU:</strong>
    IP: ${escapeHtml(payload.clientIp || 'Bilinmiyor')} |
    Zaman: ${escapeHtml(currentTime)} |
    IT Yetkilisi: ${escapeHtml(payload.requestedBy || '')} |
    Kuyruk: ${escapeHtml(payload.queueId || '')}
  </div>
</body>
</html>`;
}
