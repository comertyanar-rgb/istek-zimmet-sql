import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { config } from '../src/config.js';
import { AgentAuthError, isAgentAction, verifyAgentRequest } from '../src/agentAuth.js';
import { hashAgentNonce } from '../src/agentNonceStore.js';

const originalSecret = config.adAgentSecret;
const originalLegacySetting = config.agentAuth.allowLegacySecret;
const nonceLedger = new Set();

async function reserveNonce({ nonceHash }) {
  if (nonceLedger.has(nonceHash)) return false;
  nonceLedger.add(nonceHash);
  return true;
}

before(() => {
  config.adAgentSecret = 'agent-test-secret-that-is-longer-than-32-characters';
  config.agentAuth.allowLegacySecret = false;
});

after(() => {
  config.adAgentSecret = originalSecret;
  config.agentAuth.allowLegacySecret = originalLegacySetting;
});

beforeEach(() => {
  nonceLedger.clear();
});

function signedRequest({ body, timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomUUID().replace(/-/g, '') }) {
  const rawBody = Buffer.from(body, 'utf8');
  const signature = crypto
    .createHmac('sha256', config.adAgentSecret)
    .update(`${timestamp}\n${nonce}\n`, 'utf8')
    .update(rawBody)
    .digest('hex');

  return {
    action: 'fetchADPasswordJobs',
    rawBody,
    headers: {
      'x-zimmet-timestamp': String(timestamp),
      'x-zimmet-nonce': nonce,
      'x-zimmet-signature': signature
    }
  };
}

test('yalnızca tanımlı agent aksiyonlarını işaretler', () => {
  assert.equal(isAgentAction('fetchADPasswordJobs'), true);
  assert.equal(isAgentAction('fetchSignatureJobStates'), true);
  assert.equal(isAgentAction('fetchData'), false);
});

test('nonce değerini sabit uzunluklu SHA-256 özetiyle saklamaya hazırlar', () => {
  const nonce = '1234567890abcdef1234567890abcdef';
  const hash = hashAgentNonce(nonce);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashAgentNonce(nonce), hash);
  assert.notEqual(hash, nonce);
});

test('geçerli HMAC imzasını kabul eder', async () => {
  const request = signedRequest({ body: JSON.stringify({ action: 'fetchADPasswordJobs' }) });
  const result = await verifyAgentRequest(request, { reserveNonce });
  assert.equal(result.verified, true);
  assert.equal(result.legacy, false);
});

test('aynı nonce ile tekrar oynatılan isteği reddeder', async () => {
  const request = signedRequest({ body: JSON.stringify({ action: 'fetchADPasswordJobs', test: 'replay' }) });
  await verifyAgentRequest(request, { reserveNonce });
  await assert.rejects(
    verifyAgentRequest(request, { reserveNonce }),
    (error) => error instanceof AgentAuthError && error.statusCode === 409
  );
});

test('imzadan sonra değiştirilen gövdeyi reddeder', async () => {
  const request = signedRequest({ body: JSON.stringify({ action: 'fetchADPasswordJobs', limit: 1 }) });
  request.rawBody = Buffer.from(JSON.stringify({ action: 'fetchADPasswordJobs', limit: 100 }), 'utf8');
  await assert.rejects(
    verifyAgentRequest(request, { reserveNonce }),
    (error) => error instanceof AgentAuthError && /doğrulanamadı/i.test(error.message)
  );
});

test('süresi geçmiş agent isteğini reddeder', async () => {
  const request = signedRequest({
    body: JSON.stringify({ action: 'fetchADPasswordJobs', test: 'expired' }),
    timestamp: Math.floor(Date.now() / 1000) - 3600
  });
  await assert.rejects(
    verifyAgentRequest(request, { reserveNonce }),
    (error) => error instanceof AgentAuthError && /süresi dolmuş/i.test(error.message)
  );
});

test('nonce deposu kullanılamıyorsa güvenli biçimde kapalı kalır', async () => {
  const request = signedRequest({ body: JSON.stringify({ action: 'fetchADPasswordJobs', test: 'db-down' }) });
  await assert.rejects(
    verifyAgentRequest(request, {
      reserveNonce: async () => {
        throw new Error('SQL bağlantısı yok');
      }
    }),
    (error) =>
      error instanceof AgentAuthError &&
      error.statusCode === 503 &&
      /kullanılamıyor/i.test(error.message)
  );
});
