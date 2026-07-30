import crypto from 'node:crypto';
import { config } from './config.js';
import { hashAgentNonce, reserveAgentNonce } from './agentNonceStore.js';

const AGENT_ACTIONS = new Set([
  'fetchADPasswordJobs',
  'completeADPasswordJob',
  'syncGLPI',
  'syncPersonnel',
  'fetchSignatureJobs',
  'fetchSignatureJobStates',
  'completeSignatureJob'
]);

export class AgentAuthError extends Error {
  constructor(message, statusCode = 401, options = {}) {
    super(message, options);
    this.name = 'AgentAuthError';
    this.statusCode = statusCode;
  }
}

function secretForAction(action) {
  if (action === 'fetchADPasswordJobs' || action === 'completeADPasswordJob') {
    return config.adAgentSecret;
  }
  if (action === 'syncGLPI') return config.glpiSyncSecret;
  if (action === 'syncPersonnel') return config.personnelSyncSecret;
  if (
    action === 'fetchSignatureJobs' ||
    action === 'fetchSignatureJobStates' ||
    action === 'completeSignatureJob'
  ) {
    return config.signatureAgentSecret;
  }
  return '';
}

function headerValue(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : String(value || '').trim();
}

export function isAgentAction(action) {
  return AGENT_ACTIONS.has(String(action || ''));
}

export async function verifyAgentRequest(
  { action, headers, rawBody },
  { reserveNonce = reserveAgentNonce } = {}
) {
  const normalizedAction = String(action || '');
  if (!isAgentAction(normalizedAction)) return null;

  const expectedSecret = secretForAction(normalizedAction);
  if (!expectedSecret) {
    throw new AgentAuthError('Bu agent için sunucu anahtarı yapılandırılmamış.', 503);
  }

  const timestampText = headerValue(headers, 'x-zimmet-timestamp');
  const nonce = headerValue(headers, 'x-zimmet-nonce');
  const signature = headerValue(headers, 'x-zimmet-signature');

  if (!timestampText || !nonce || !signature) {
    if (config.agentAuth.allowLegacySecret) {
      return { verified: false, legacy: true, action: normalizedAction };
    }
    throw new AgentAuthError('Agent kimlik doğrulama başlıkları eksik.');
  }

  if (!/^\d{10,12}$/.test(timestampText)) {
    throw new AgentAuthError('Agent zaman damgası geçersiz.');
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(nonce)) {
    throw new AgentAuthError('Agent nonce değeri geçersiz.');
  }
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    throw new AgentAuthError('Agent imzası geçersiz.');
  }

  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const maxSkewSeconds = Math.min(
    Math.max(Number(config.agentAuth.maxSkewSeconds) || 300, 60),
    15 * 60
  );
  if (Math.abs(nowSeconds - timestamp) > maxSkewSeconds) {
    throw new AgentAuthError('Agent isteğinin zaman damgası süresi dolmuş.');
  }

  const bodyBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody || ''), 'utf8');
  const expectedSignature = crypto
    .createHmac('sha256', expectedSecret)
    .update(`${timestampText}\n${nonce}\n`, 'utf8')
    .update(bodyBuffer)
    .digest();
  const receivedSignature = Buffer.from(signature, 'hex');

  if (
    expectedSignature.length !== receivedSignature.length ||
    !crypto.timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    throw new AgentAuthError('Agent imzası doğrulanamadı.');
  }

  let reserved = false;
  try {
    reserved = await reserveNonce({
      action: normalizedAction,
      nonceHash: hashAgentNonce(nonce),
      expiresAt: new Date(Date.now() + (maxSkewSeconds + 60) * 1000)
    });
  } catch (error) {
    throw new AgentAuthError(
      'Agent tekrar oynatma koruması şu anda kullanılamıyor.',
      503,
      { cause: error }
    );
  }

  if (!reserved) {
    throw new AgentAuthError('Bu agent isteği daha önce kullanılmış.', 409);
  }

  return {
    verified: true,
    legacy: false,
    action: normalizedAction,
    secret: expectedSecret
  };
}
