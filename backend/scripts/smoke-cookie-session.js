import { spawn } from 'node:child_process';
import nodeAssert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, query } from '../src/db.js';
import { createSession, getSessionUser, revokeSession } from '../src/sessionService.js';

const REQUEST_TIMEOUT_MS = 20_000;
const STARTUP_TIMEOUT_MS = 30_000;
const COOKIE_NAME = 'istek_session_smoke';
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let child = null;
let sessionToken = '';
let childOutput = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(name, passed, detail) {
  results.push({ name, passed, detail });
}

async function check(name, callback) {
  try {
    const detail = await callback();
    record(name, true, detail || 'Tamam');
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Bos test portu bulunamadi.'));
        else resolve(port);
      });
    });
  });
}

function appendChildOutput(chunk) {
  childOutput = `${childOutput}${String(chunk || '')}`.slice(-12_000);
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'error',
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON yaniti bekleniyordu (HTTP ${response.status}): ${text.slice(0, 160)}`);
  }
}

async function postAction(baseUrl, payload, headers = {}) {
  return request(`${baseUrl}/api/action`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Istek-Action': payload.action,
      ...headers
    },
    body: JSON.stringify(payload)
  });
}

async function waitUntilHealthy(baseUrl) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) {
      throw new Error(`Gecici backend erken kapandi (kod ${child?.exitCode}).`);
    }
    try {
      const response = await request(`${baseUrl}/health`, {
        headers: { Accept: 'application/json' }
      });
      if (response.status === 200) {
        const body = await readJson(response);
        if (body?.success === true && body?.database === 'connected') return;
      }
    } catch {
      // Sunucu portu acilana kadar tekrar dene.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Gecici cookie backend zamaninda hazir olmadi.');
}

async function getSmokeUserEmail() {
  const result = await query(`
    SELECT TOP 1 au.Email
    FROM dbo.AuthorizedUsers au
    WHERE au.IsActive = 1
    ORDER BY CASE WHEN au.Role = N'HQ IT' THEN 0 ELSE 1 END, au.Email;
  `);
  const email = String(result.recordset[0]?.Email || '').trim().toLowerCase();
  assert(email, 'Aktif yetkili test kullanicisi bulunamadi.');
  return email;
}

async function stopChild() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) =>
      setTimeout(() => {
        if (child?.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5000)
    )
  ]);
}

try {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const email = await getSmokeUserEmail();
  sessionToken = await createSession(email);

  child = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      CORS_ORIGINS: 'http://localhost:5173',
      SESSION_COOKIE_ENABLED: 'true',
      SESSION_COOKIE_NAME: COOKIE_NAME,
      SESSION_COOKIE_SECURE: 'false',
      SESSION_COOKIE_SAME_SITE: 'Lax',
      SESSION_COOKIE_DOMAIN: '',
      SESSION_COOKIE_ALLOW_BODY_TOKEN_FALLBACK: 'false',
      QUEUE_WORKER_ENABLED: 'false',
      QUEUE_CLEANUP_ENABLED: 'false',
      SERVE_FRONTEND: 'false',
      LOG_LEVEL: 'warn'
    }
  });
  child.stdout.on('data', appendChildOutput);
  child.stderr.on('data', appendChildOutput);
  await waitUntilHealthy(baseUrl);

  await check('Body token fallback kapali', async () => {
    const response = await postAction(baseUrl, { action: 'fetchData', authToken: sessionToken });
    assert(response.status === 401, `HTTP ${response.status}; 401 bekleniyordu`);
    const body = await readJson(response);
    assert(body?.success === false, 'success=false donmedi');
    return 'JavaScript govdesindeki token kabul edilmedi';
  });

  await check('HttpOnly cookie ile korunan veri okunuyor', async () => {
    const response = await postAction(
      baseUrl,
      { action: 'fetchData' },
      { Cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}` }
    );
    assert(response.status === 200, `HTTP ${response.status}`);
    const body = await readJson(response);
    assert(body?.success === true, body?.error || 'success=true donmedi');
    assert(Array.isArray(body.personnel), 'personnel listesi donmedi');
    assert(Array.isArray(body.hardware), 'hardware listesi donmedi');
    return `${body.personnel.length} personel, ${body.hardware.length} donanim`;
  });

  await check('Cross-site cookie istegi reddediliyor', async () => {
    const response = await postAction(
      baseUrl,
      { action: 'fetchData' },
      {
        Cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        'Sec-Fetch-Site': 'cross-site'
      }
    );
    assert(response.status === 403, `HTTP ${response.status}; 403 bekleniyordu`);
    const body = await readJson(response);
    assert(body?.success === false, 'success=false donmedi');
    return 'Sec-Fetch-Site=cross-site engellendi';
  });

  await check('Logout cookie ve SQL oturumunu temizliyor', async () => {
    const response = await postAction(
      baseUrl,
      { action: 'logout' },
      { Cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}` }
    );
    assert(response.status === 200, `HTTP ${response.status}`);
    const body = await readJson(response);
    assert(body?.success === true, body?.error || 'Logout basarisiz');

    const setCookie = response.headers.get('set-cookie') || '';
    assert(setCookie.includes(`${COOKIE_NAME}=`), 'Temizlenen cookie adi bulunamadi');
    assert(/Max-Age=0/i.test(setCookie), 'Max-Age=0 bulunamadi');
    assert(/HttpOnly/i.test(setCookie), 'HttpOnly bulunamadi');
    assert(/SameSite=Lax/i.test(setCookie), 'SameSite=Lax bulunamadi');
    assert(/Path=\//i.test(setCookie), 'Path=/ bulunamadi');

    await nodeAssert.rejects(
      () => getSessionUser(sessionToken),
      /oturum s.resi doldu|yetki bulunamad./i
    );
    return 'Cookie sonlandirildi ve Sessions kaydi silindi';
  });

  await check('Silinen cookie oturumu tekrar kullanilamiyor', async () => {
    const response = await postAction(
      baseUrl,
      { action: 'fetchData' },
      { Cookie: `${COOKIE_NAME}=${encodeURIComponent(sessionToken)}` }
    );
    assert(response.status === 401, `HTTP ${response.status}; 401 bekleniyordu`);
    const setCookie = response.headers.get('set-cookie') || '';
    assert(/Max-Age=0/i.test(setCookie), 'Gecersiz oturumda cookie temizleme basligi yok');
    return 'Tekrar oynatma reddedildi';
  });

  console.log(`\nISTEK Zimmet HttpOnly cookie smoke testi: gecici port ${port}\n`);
  for (const result of results) {
    console.log(`${result.passed ? 'OK' : 'HATA'}  ${result.name}: ${result.detail}`);
  }
  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol basarili.`);
  if (failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Cookie smoke testi baslatilamadi: ${error instanceof Error ? error.message : error}`);
  if (childOutput.trim()) console.error(`Gecici backend son cikti:\n${childOutput.trim()}`);
  process.exitCode = 1;
} finally {
  if (sessionToken) await revokeSession(sessionToken).catch(() => {});
  await stopChild().catch(() => {});
  await closePool();
}
