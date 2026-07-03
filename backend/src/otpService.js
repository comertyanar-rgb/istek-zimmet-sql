import crypto from 'node:crypto';
import { config } from './config.js';
import { sendEmailThroughGoogleBridge } from './googleBridge.js';

const OTP_TTL_MS = 180 * 1000;
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const otpChallenges = new Map();
const validApprovals = new Map();

function isDevelopment() {
  return config.nodeEnv !== 'production';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeTrMobile(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(4);
  if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!/^5\d{9}$/.test(digits)) {
    throw new Error('SMS için 5 ile başlayan 10 haneli geçerli telefon numarası girin.');
  }
  return digits;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cleanupExpired() {
  const now = Date.now();
  for (const [key, item] of otpChallenges.entries()) {
    if (item.expiresAt <= now) otpChallenges.delete(key);
  }
  for (const [key, item] of validApprovals.entries()) {
    if (item.expiresAt <= now) validApprovals.delete(key);
  }
}

async function sendSmsViaMobildev(phone, message) {
  const { apiUrl, apiKey, apiSecret, originator } = config.mobildev;

  if (!apiKey || !apiSecret) {
    if (isDevelopment()) {
      console.info(`[DEV SMS OTP] ${phone}: ${message}`);
      return { delivery: 'console' };
    }
    throw new Error('Mobildev SMS ayarları eksik. MOBILDEV_API_KEY ve MOBILDEV_API_SECRET tanımlayın.');
  }

  const xmlPayload = `
<MainmsgBody>
  <UserName>${escapeXml(apiKey)}</UserName>
  <PassWord>${escapeXml(apiSecret)}</PassWord>
  <Action>1</Action>
  <Messages>
    <Message>
      <Mesgbody><![CDATA[${message}]]></Mesgbody>
      <Number>${phone}</Number>
    </Message>
  </Messages>
  ${originator ? `<Originator>${escapeXml(originator)}</Originator>` : ''}
  <Blacklist>1</Blacklist>
  <Encoding>1</Encoding>
  <MessageType>N</MessageType>
</MainmsgBody>`.trim();

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/xml; charset=utf-8' },
    body: xmlPayload
  });

  const body = (await response.text()).trim();
  const okBody = /^id\s*:/i.test(body) || /^\d+$/.test(body);
  if (!response.ok || !okBody) {
    throw new Error(`Mobildev SMS başarısız: ${response.status} / ${body}`);
  }

  return { delivery: 'sms', providerResponse: body };
}

async function sendEmailOtp(email, message) {
  return sendEmailThroughGoogleBridge({
    to: email,
    subject: 'GÜVENLİK KODU: Donanım Teslim/İade Onayı',
    body: message,
    name: 'İSTEK Demirbaş Yönetimi'
  });
}

export async function sendOtpChallenge({ personEmail, personName, personPhone, channel }) {
  cleanupExpired();
  const email = normalizeEmail(personEmail);
  if (!email || !email.includes('@')) throw new Error('Personelin geçerli e-posta adresi bulunmuyor.');

  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const requestedChannel = channel === 'sms' ? 'sms' : 'email';
  const message = `ISTEK Demirbas teslim/iade onay kodunuz: ${otpCode}. Kod 2 dakika gecerlidir. Bu kodu islemi yapan IT personeliyle paylasarak donanim tutanagini onaylamis olursunuz.`;

  let phone = '';
  let deliveryResult;
  if (requestedChannel === 'sms') {
    phone = normalizeTrMobile(personPhone);
    deliveryResult = await sendSmsViaMobildev(phone, message);
  } else {
    deliveryResult = await sendEmailOtp(email, message);
  }

  otpChallenges.set(email, {
    code: otpCode,
    channel: requestedChannel,
    phone,
    personName: String(personName || ''),
    expiresAt: Date.now() + OTP_TTL_MS
  });

  return {
    channel: requestedChannel,
    phone,
    delivery: deliveryResult.delivery,
    ...(isDevelopment() ? { debugOtp: otpCode } : {})
  };
}

export function verifyOtpCode(personEmail, otpCode) {
  cleanupExpired();
  const email = normalizeEmail(personEmail);
  const challenge = otpChallenges.get(email);
  const code = String(otpCode || '').trim();

  if (!challenge || challenge.expiresAt <= Date.now()) {
    otpChallenges.delete(email);
    throw new Error('Hatalı veya süresi dolmuş kod.');
  }

  if (challenge.code !== code) {
    throw new Error('Hatalı veya süresi dolmuş kod.');
  }

  otpChallenges.delete(email);
  const hash = `DIJIT-ONAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  validApprovals.set(hash, { email, expiresAt: Date.now() + APPROVAL_TTL_MS });
  return { hash };
}

export function consumeOtpApproval(hash, personEmail) {
  cleanupExpired();
  const email = normalizeEmail(personEmail);
  const approval = validApprovals.get(hash);
  if (!approval || approval.expiresAt <= Date.now() || approval.email !== email) {
    validApprovals.delete(hash);
    throw new Error('OTP doğrulama geçersiz veya zaman aşımına uğramış.');
  }
  validApprovals.delete(hash);
  return true;
}
