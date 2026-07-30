import { config } from '../src/config.js';
import { fetchWithTimeout } from '../src/fetchWithTimeout.js';

const url = String(config.googleBridge.url || '').trim();
const secret = String(config.googleBridge.secret || '').trim();

if (!url) {
  throw new Error('GOOGLE_BRIDGE_URL tanımlı değil.');
}
if (!secret) {
  throw new Error('GOOGLE_BRIDGE_SECRET tanımlı değil.');
}

const response = await fetchWithTimeout(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'verifyGoogleBridge',
    secret
  })
}, {
  timeoutMs: 30000,
  label: 'Google köprüsü doğrulaması'
});

const responseText = await response.text();
let payload;
try {
  payload = JSON.parse(responseText);
} catch {
  payload = {
    success: false,
    error: `Apps Script JSON yerine şu yanıtı döndürdü: ${responseText.slice(0, 240)}`
  };
}

const result = {
  success: Boolean(response.ok && payload.success),
  httpStatus: response.status,
  service: payload.service || null,
  checkedAt: payload.checkedAt || null,
  error: payload.error || null
};

console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exitCode = 1;
