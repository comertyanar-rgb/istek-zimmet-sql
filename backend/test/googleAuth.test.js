import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { config } from '../src/config.js';
import { verifyGoogleIdentity } from '../src/googleAuth.js';

const originalFetch = globalThis.fetch;
const originalClientId = config.googleClientId;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

beforeEach(() => {
  config.googleClientId = 'expected-client.apps.googleusercontent.com';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  config.googleClientId = originalClientId;
});

test('geçerli Google ID token claimlerini kabul eder', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      aud: config.googleClientId,
      iss: 'https://accounts.google.com',
      sub: 'google-user-1',
      email: 'it@istek.k12.tr',
      email_verified: true,
      name: 'Test IT'
    });

  const identity = await verifyGoogleIdentity({ googleToken: 'header.payload.signature' });
  assert.equal(identity.email, 'it@istek.k12.tr');
  assert.equal(identity.name, 'Test IT');
});

test('başka OAuth istemcisine ait access tokenı reddeder', async () => {
  globalThis.fetch = async () =>
    jsonResponse({
      issued_to: 'different-client.apps.googleusercontent.com',
      expires_in: 3600
    });

  await assert.rejects(
    verifyGoogleIdentity({ googleAccessToken: 'valid-looking-access-token' }),
    /istemci uyuşmuyor/i
  );
});

test('aşırı büyük tokenı dış servise göndermeden reddeder', async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return jsonResponse({});
  };

  await assert.rejects(
    verifyGoogleIdentity({ googleAccessToken: 'x'.repeat(16_385) }),
    /biçimi geçersiz/i
  );
  assert.equal(fetchCalled, false);
});
