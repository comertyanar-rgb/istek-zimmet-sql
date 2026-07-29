import crypto from 'node:crypto';
import { config } from './config.js';
import { sendEmailThroughGoogleBridge } from './googleBridge.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const OTP_TTL_MS = 180 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_ACTIVE_OTP_CHALLENGES = 5000;
const MAX_VALID_APPROVALS = 5000;
const otpChallenges = new Map();
const challengeIdByContext = new Map();
const challengeIdByPerson = new Map();
const lastOtpSentAtByPerson = new Map();
const validApprovals = new Map();
let otpTestObserver = null;

export function setOtpTestObserver(observer) {
  if (config.nodeEnv !== 'test' || process.env.OTP_TEST_CAPTURE_ALLOWED !== 'YES') {
    throw new Error('OTP test gözlemcisi yalnız açıkça izin verilen test sürecinde kullanılabilir.');
  }
  if (observer !== null && typeof observer !== 'function') {
    throw new TypeError('OTP test gözlemcisi fonksiyon veya null olmalıdır.');
  }
  otpTestObserver = observer;
}

function isDevelopment() {
  return config.nodeEnv !== 'production';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeOtpAction(value) {
  const action = String(value || '').trim().toLowerCase();
  if (action !== 'zimmet' && action !== 'return') {
    throw new Error('OTP işlem türü geçersiz.');
  }
  return action;
}

function normalizeHardwareIds(values) {
  const source = Array.isArray(values) ? values : [];
  const ids = [...new Set(source.map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
  if (ids.length === 0 || ids.length > 100) throw new Error('OTP için cihaz seçimi geçersiz.');
  return ids;
}

function normalizeOtpContext(value = {}) {
  const requesterEmail = normalizeEmail(value.requesterEmail);
  const personEmail = normalizeEmail(value.personEmail);
  const personId = String(value.personId || '').trim();
  if (!requesterEmail || !requesterEmail.includes('@')) throw new Error('OTP oturum bilgisi geçersiz.');
  if (!personEmail || !personEmail.includes('@')) throw new Error('Personelin geçerli e-posta adresi bulunmuyor.');
  if (!personId) throw new Error('OTP için personel seçimi boş.');

  return {
    requesterEmail,
    personId,
    personEmail,
    action: normalizeOtpAction(value.action),
    hardwareIds: normalizeHardwareIds(value.hardwareIds)
  };
}

function otpContextKey(context) {
  return JSON.stringify(context);
}

function removeChallenge(challengeId) {
  const challenge = otpChallenges.get(challengeId);
  if (!challenge) return;
  if (Buffer.isBuffer(challenge.codeHash)) challenge.codeHash.fill(0);
  otpChallenges.delete(challengeId);
  if (challengeIdByContext.get(challenge.contextKey) === challengeId) {
    challengeIdByContext.delete(challenge.contextKey);
  }
  if (challengeIdByPerson.get(challenge.personKey) === challengeId) {
    challengeIdByPerson.delete(challenge.personKey);
  }
}

function otpCodeHash(challengeId, code) {
  return crypto
    .createHmac('sha256', config.appSecret)
    .update(`${challengeId}:${String(code || '')}`, 'utf8')
    .digest();
}

function otpCodeMatches(challenge, challengeId, code) {
  if (!/^\d{6}$/.test(code) || !Buffer.isBuffer(challenge?.codeHash)) return false;
  const candidateHash = otpCodeHash(challengeId, code);
  return (
    candidateHash.length === challenge.codeHash.length &&
    crypto.timingSafeEqual(candidateHash, challenge.codeHash)
  );
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
  for (const [challengeId, item] of otpChallenges.entries()) {
    if (item.expiresAt <= now) removeChallenge(challengeId);
  }
  for (const [key, item] of validApprovals.entries()) {
    if (item.expiresAt <= now) validApprovals.delete(key);
  }
  for (const [personKey, sentAt] of lastOtpSentAtByPerson.entries()) {
    if (sentAt <= now - OTP_RESEND_COOLDOWN_MS) lastOtpSentAtByPerson.delete(personKey);
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

  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/xml; charset=utf-8' },
    body: xmlPayload
  }, { timeoutMs: 15000, label: 'Mobildev SMS' });

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

export async function sendOtpChallenge({ person, personPhone, channel, context }) {
  cleanupExpired();
  const normalizedContext = normalizeOtpContext({
    ...context,
    personId: person?.id,
    personEmail: person?.email
  });
  const contextKey = otpContextKey(normalizedContext);
  const personKey = normalizedContext.personId;
  const existingChallengeId = challengeIdByContext.get(contextKey);
  const existingChallenge = existingChallengeId ? otpChallenges.get(existingChallengeId) : null;
  if (!challengeIdByPerson.has(personKey) && otpChallenges.size >= MAX_ACTIVE_OTP_CHALLENGES) {
    throw new Error('OTP servisi geçici olarak yoğun. Lütfen kısa süre sonra tekrar deneyin.');
  }
  const lastSentAt = Math.max(
    Number(existingChallenge?.sentAt || 0),
    Number(lastOtpSentAtByPerson.get(personKey) || 0)
  );

  if (lastSentAt && Date.now() - lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    const waitSeconds = Math.max(
      1,
      Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - lastSentAt)) / 1000)
    );
    throw new Error(`Yeni kod göndermek için ${waitSeconds} saniye bekleyin.`);
  }

  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const challengeId = crypto.randomUUID();
  const requestedChannel = channel === 'sms' ? 'sms' : 'email';
  const actionLabel = normalizedContext.action === 'return' ? 'donanım iade' : 'donanım zimmet teslim';
  const message = `İSTEK ${actionLabel} işlemi onay kodunuz: ${otpCode}. Kod 2 dakika geçerlidir. Bu kodu işlemi yapan IT personeliyle paylaşarak ilgili tutanağı onaylamış olursunuz.`;

  let phone = '';
  let deliveryResult;
  if (requestedChannel === 'sms') {
    phone = normalizeTrMobile(personPhone || person?.phone);
    deliveryResult = await sendSmsViaMobildev(phone, message);
  } else {
    deliveryResult = await sendEmailOtp(normalizedContext.personEmail, message);
  }

  const existingPersonChallengeId = challengeIdByPerson.get(personKey);
  if (existingPersonChallengeId) removeChallenge(existingPersonChallengeId);
  if (existingChallengeId && existingChallengeId !== existingPersonChallengeId) {
    removeChallenge(existingChallengeId);
  }
  const sentAt = Date.now();
  otpChallenges.set(challengeId, {
    codeHash: otpCodeHash(challengeId, otpCode),
    channel: requestedChannel,
    phone,
    personName: String(person?.name || ''),
    context: normalizedContext,
    contextKey,
    personKey,
    attempts: 0,
    sentAt,
    expiresAt: sentAt + OTP_TTL_MS
  });
  challengeIdByContext.set(contextKey, challengeId);
  challengeIdByPerson.set(personKey, challengeId);
  lastOtpSentAtByPerson.set(personKey, sentAt);

  if (config.nodeEnv === 'test' && process.env.OTP_TEST_CAPTURE_ALLOWED === 'YES' && otpTestObserver) {
    otpTestObserver(Object.freeze({ challengeId, otpCode, channel: requestedChannel }));
  }

  return {
    challengeId,
    channel: requestedChannel,
    phone,
    delivery: deliveryResult.delivery
  };
}

export function verifyOtpCode({ challengeId, otpCode, context }) {
  cleanupExpired();
  const normalizedChallengeId = String(challengeId || '').trim();
  const normalizedContext = normalizeOtpContext(context);
  const contextKey = otpContextKey(normalizedContext);
  const challenge = otpChallenges.get(normalizedChallengeId);
  const code = String(otpCode || '').trim();

  if (!challenge || challenge.expiresAt <= Date.now() || challenge.contextKey !== contextKey) {
    if (challenge?.expiresAt <= Date.now()) removeChallenge(normalizedChallengeId);
    throw new Error('Hatalı veya süresi dolmuş kod.');
  }

  if (!otpCodeMatches(challenge, normalizedChallengeId, code)) {
    challenge.attempts = Number(challenge.attempts || 0) + 1;
    if (challenge.attempts >= MAX_OTP_ATTEMPTS) removeChallenge(normalizedChallengeId);
    throw new Error('Hatalı veya süresi dolmuş kod.');
  }

  if (validApprovals.size >= MAX_VALID_APPROVALS) {
    cleanupExpired();
    if (validApprovals.size >= MAX_VALID_APPROVALS) {
      throw new Error('OTP servisi geçici olarak yoğun. Lütfen kısa süre sonra tekrar deneyin.');
    }
  }

  removeChallenge(normalizedChallengeId);
  const hash = `DIJIT-ONAY-${crypto.randomUUID().toUpperCase()}`;
  validApprovals.set(hash, {
    context: normalizedContext,
    contextKey,
    expiresAt: Date.now() + APPROVAL_TTL_MS
  });
  return { hash, channel: challenge.channel };
}

export function consumeOtpApproval(hash, context) {
  cleanupExpired();
  const normalizedHash = String(hash || '').trim();
  const normalizedContext = normalizeOtpContext(context);
  const approval = validApprovals.get(normalizedHash);
  if (!approval || approval.expiresAt <= Date.now() || approval.contextKey !== otpContextKey(normalizedContext)) {
    if (approval?.expiresAt <= Date.now()) validApprovals.delete(normalizedHash);
    throw new Error('OTP doğrulama geçersiz veya zaman aşımına uğramış.');
  }
  validApprovals.delete(normalizedHash);
  return true;
}
