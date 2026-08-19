const BRAND_BLUE = '#006eb8';
const BRAND_TEAL = '#87cfcc';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function renderDetailRows(rows) {
  const visibleRows = rows.filter((row) => clean(row?.value));
  if (!visibleRows.length) return '';

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;border-collapse:collapse;border:1px solid #dce5ec;border-radius:6px;overflow:hidden;">
      ${visibleRows.map((row, index) => `
        <tr>
          <td style="width:34%;padding:10px 12px;background:${index % 2 ? '#f8fafc' : '#f2f7fa'};border-bottom:1px solid #e5ebf0;color:#607284;font-size:12px;font-weight:700;">${escapeHtml(row.label)}</td>
          <td style="padding:10px 12px;background:${index % 2 ? '#ffffff' : '#fbfdfe'};border-bottom:1px solid #e5ebf0;color:#172334;font-size:13px;font-weight:600;">${escapeHtml(row.value)}</td>
        </tr>`).join('')}
    </table>`;
}

function renderCorporateEmail({ preheader, title, greeting, paragraphs, details = [], code = '' }) {
  const safeParagraphs = paragraphs
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px;color:#2d3a49;font-size:14px;line-height:1.65;">${escapeHtml(paragraph)}</p>`)
    .join('');
  const codeBlock = code
    ? `<div style="margin:22px 0;padding:18px 20px;border:1px solid #b9dce9;border-radius:6px;background:#eef8fb;text-align:center;">
         <div style="margin-bottom:7px;color:#607284;font-size:11px;font-weight:700;text-transform:uppercase;">Güvenlik kodunuz</div>
         <div style="color:${BRAND_BLUE};font-family:Arial,sans-serif;font-size:32px;font-weight:800;letter-spacing:8px;">${escapeHtml(code)}</div>
       </div>`
    : '';

  return `<!doctype html>
<html lang="tr">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f3f6f8;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6f8;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce5ec;border-radius:8px;overflow:hidden;">
          <tr><td style="height:6px;background:${BRAND_TEAL};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:25px 30px 18px;border-bottom:3px solid ${BRAND_BLUE};">
            <div style="color:${BRAND_BLUE};font-size:19px;font-weight:800;">İSTEK OKULLARI</div>
            <div style="margin-top:4px;color:#68798a;font-size:12px;">Bilgi İşlem Demirbaş Yönetim Sistemi</div>
          </td></tr>
          <tr><td style="padding:28px 30px 24px;">
            <h1 style="margin:0 0 20px;color:#172334;font-size:21px;line-height:1.35;">${escapeHtml(title)}</h1>
            <p style="margin:0 0 16px;color:#172334;font-size:14px;line-height:1.65;font-weight:700;">${escapeHtml(greeting)}</p>
            ${safeParagraphs}
            ${codeBlock}
            ${renderDetailRows(details)}
            <p style="margin:22px 0 0;color:#68798a;font-size:12px;line-height:1.6;">Bu ileti İSTEK Demirbaş Yönetim Sistemi tarafından otomatik olarak gönderilmiştir.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildOtpEmail({ personName, code, action, expiresMinutes }) {
  const isReturn = action === 'return';
  const operation = isReturn ? 'donanım iade' : 'donanım zimmet teslim';
  const title = isReturn ? 'Donanım İade Onay Kodu' : 'Donanım Teslim Onay Kodu';
  const name = clean(personName, 'Personel');
  const minutes = Number(expiresMinutes) || 3;
  const body = [
    `Sayın ${name},`,
    '',
    `İSTEK ${operation} işleminizi onaylamak için güvenlik kodunuz: ${code}`,
    `Kod ${minutes} dakika geçerlidir. Kodu yalnızca işlemi gerçekleştiren yetkili IT personeliyle paylaşınız.`,
    '',
    'Bu işlemi siz başlatmadıysanız kodu paylaşmayınız ve kampüs IT biriminize bilgi veriniz.',
    '',
    'İSTEK Okulları',
    'Bilgi İşlem Demirbaş Yönetim Sistemi'
  ].join('\n');

  return {
    subject: `İSTEK Demirbaş | ${title}`,
    body,
    htmlBody: renderCorporateEmail({
      preheader: `${operation} işleminiz için güvenlik kodu`,
      title,
      greeting: `Sayın ${name},`,
      paragraphs: [
        `İSTEK ${operation} işleminizi onaylamak için aşağıdaki güvenlik kodunu kullanınız.`,
        `Kod ${minutes} dakika geçerlidir. Kodu yalnızca işlemi gerçekleştiren yetkili IT personeliyle paylaşınız.`,
        'Bu işlemi siz başlatmadıysanız kodu paylaşmayınız ve kampüs IT biriminize bilgi veriniz.'
      ],
      code
    })
  };
}

export function buildDocumentEmail({ personName, isReturn, hardwareCount, campus, operatorName }) {
  const name = clean(personName, 'Personel');
  const count = Math.max(1, Number(hardwareCount) || 1);
  const operation = isReturn ? 'iade' : 'zimmet teslim';
  const title = isReturn ? 'Donanım İade İşleminiz Tamamlandı' : 'Donanım Zimmet İşleminiz Tamamlandı';
  const documentName = isReturn ? 'donanım iade tutanağınız' : 'donanım zimmet teslim tutanağınız';
  const body = [
    `Sayın ${name},`,
    '',
    `${count} adet donanıma ilişkin ${operation} işleminiz tamamlanmıştır. ${documentName} bu e-postaya PDF olarak eklenmiştir.`,
    campus ? `Kampüs: ${campus}` : '',
    operatorName ? `İşlemi yapan IT yetkilisi: ${operatorName}` : '',
    '',
    'Belgedeki bilgilerde bir hata olduğunu düşünüyorsanız bu e-postayı yanıtlayarak işlemi yapan IT yetkilisine ulaşabilirsiniz.',
    '',
    'İyi çalışmalar dileriz.',
    'İSTEK Okulları',
    'Bilgi İşlem Demirbaş Yönetim Sistemi'
  ].filter(Boolean).join('\n');

  return {
    subject: `İSTEK Demirbaş | ${isReturn ? 'Donanım İade Belgeniz' : 'Donanım Zimmet Belgeniz'}`,
    body,
    htmlBody: renderCorporateEmail({
      preheader: `${documentName} PDF olarak ektedir`,
      title,
      greeting: `Sayın ${name},`,
      paragraphs: [
        `${count} adet donanıma ilişkin ${operation} işleminiz tamamlanmıştır. ${documentName.charAt(0).toUpperCase() + documentName.slice(1)} bu e-postaya PDF olarak eklenmiştir.`,
        'Belgedeki bilgilerde bir hata olduğunu düşünüyorsanız bu e-postayı yanıtlayarak işlemi yapan IT yetkilisine ulaşabilirsiniz.',
        'İyi çalışmalar dileriz.'
      ],
      details: [
        { label: 'İşlem', value: isReturn ? 'Donanım iade' : 'Donanım zimmet teslim' },
        { label: 'Donanım sayısı', value: `${count} adet` },
        { label: 'Kampüs', value: campus },
        { label: 'IT yetkilisi', value: operatorName }
      ]
    })
  };
}

export function buildTransferEmail({ direction, senderCampus, receiverCampus, hardwareCount }) {
  const isIncoming = direction === 'in';
  const count = Math.max(1, Number(hardwareCount) || 1);
  const title = isIncoming ? 'Cihaz Transferi Teslim Alındı' : 'Cihaz Transferi Başlatıldı';
  const operationText = isIncoming
    ? `${clean(senderCampus, 'Gönderen kampüs')} tarafından gönderilen ${count} adet donanım ${clean(receiverCampus, 'alıcı kampüs')} envanterine teslim alınmıştır.`
    : `${clean(senderCampus, 'Gönderen kampüs')} kampüsünden ${clean(receiverCampus, 'alıcı kampüs')} kampüsüne ${count} adet donanımın transferi başlatılmıştır.`;
  const body = [
    'Sayın IT Yetkilisi,',
    '',
    operationText,
    'Transfer tutanağı ve cihaz listesi bu e-postaya PDF olarak eklenmiştir.',
    isIncoming ? '' : 'Cihazlar ulaştığında sistem üzerinden “Teslim Al” işlemini tamamlayınız.',
    '',
    'İyi çalışmalar dileriz.',
    'İSTEK Okulları',
    'Bilgi İşlem Demirbaş Yönetim Sistemi'
  ].filter(Boolean).join('\n');

  return {
    subject: `İSTEK Demirbaş | ${title}`,
    body,
    htmlBody: renderCorporateEmail({
      preheader: title,
      title,
      greeting: 'Sayın IT Yetkilisi,',
      paragraphs: [
        operationText,
        'Transfer tutanağı ve cihaz listesi bu e-postaya PDF olarak eklenmiştir.',
        isIncoming ? '' : 'Cihazlar ulaştığında sistem üzerinden “Teslim Al” işlemini tamamlayınız.',
        'İyi çalışmalar dileriz.'
      ],
      details: [
        { label: 'Gönderen kampüs', value: senderCampus },
        { label: 'Alıcı kampüs', value: receiverCampus },
        { label: 'Donanım sayısı', value: `${count} adet` }
      ]
    })
  };
}
