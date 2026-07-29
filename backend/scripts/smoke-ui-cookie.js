import nodeAssert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { closePool, query, sql } from '../src/db.js';
import { getAuthorizedUser } from '../src/repositories/inventoryRepository.js';
import { createSession, getSessionUser, revokeSession } from '../src/sessionService.js';

const TIMEOUT_MS = 35_000;
const COOKIE_NAME = 'istek_session_ui_smoke';
const COOKIE_SESSION_SENTINEL = '__HTTP_ONLY_COOKIE_SESSION__';
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(backendRoot, '..');
const frontendDistDir = path.join(projectRoot, 'dist');
const screenshotDirectory = String(process.env.SMOKE_SCREENSHOT_DIR || '').trim();

let backendProcess = null;
let backendOutput = '';
let browser = null;
let sessionToken = '';
let expiredSessionToken = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function appendBackendOutput(chunk) {
  backendOutput = `${backendOutput}${String(chunk || '')}`.slice(-12_000);
}

async function saveScreenshot(page, name) {
  if (!screenshotDirectory) return '';
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const filePath = path.join(screenshotDirectory, `${name}.png`);
  await page.screenshot({ path: filePath, type: 'png', fullPage: false });
  return filePath;
}

async function waitForMotionSettle(page) {
  await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 260)));
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PDF_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output = `${output}${String(chunk || '')}`.slice(-20_000);
    });
    child.stderr.on('data', (chunk) => {
      output = `${output}${String(chunk || '')}`.slice(-20_000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(' ')} kod ${code} ile kapandi.\n${output.trim()}`));
    });
  });
}

async function buildSameOriginFrontend() {
  if (String(process.env.SKIP_COOKIE_UI_BUILD || '').toLowerCase() !== 'true') {
    const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    assert(fs.existsSync(viteEntry), 'Vite bulunamadi. Repo kokunde npm install calistirin.');
    await runCommand(process.execPath, [viteEntry, 'build'], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VITE_API_URL: '/api/action'
      }
    });
  }

  const indexPath = path.join(frontendDistDir, 'index.html');
  assert(fs.existsSync(indexPath), 'Frontend dist/index.html bulunamadi. Once npm run build calistirin.');
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

async function request(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function waitUntilHealthy(baseUrl) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (backendProcess?.exitCode !== null) {
      throw new Error(`Gecici backend erken kapandi (kod ${backendProcess?.exitCode}).`);
    }
    try {
      const response = await request(`${baseUrl}/health`);
      if (response.status === 200) {
        const body = await response.json();
        if (body?.success === true && body?.database === 'connected') return;
      }
    } catch {
      // Port acilana kadar yeniden dene.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Gecici ayni-domain backend zamaninda hazir olmadi.');
}

async function getSmokeUser() {
  const result = await query(`
    SELECT TOP 1 au.Email
    FROM dbo.AuthorizedUsers au
    LEFT JOIN dbo.Personnel p ON LOWER(p.Email) = LOWER(au.Email)
    WHERE au.IsActive = 1
    ORDER BY
      CASE WHEN au.Role = N'HQ IT' THEN 0 ELSE 1 END,
      CASE WHEN NULLIF(LTRIM(RTRIM(p.FullName)), N'') IS NULL THEN 1 ELSE 0 END,
      au.Email;
  `);
  const email = String(result.recordset[0]?.Email || '').trim().toLowerCase();
  assert(email, 'Aktif yetkili test kullanicisi bulunamadi.');

  const user = await getAuthorizedUser(email);
  assert(user, 'Yetkili test kullanicisi ayrintisi bulunamadi.');
  return user;
}

async function clickVisibleButton(page, label) {
  const clicked = await page.evaluate((buttonLabel) => {
    const button = [...document.querySelectorAll('button')].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return (
        candidate.textContent?.trim() === buttonLabel &&
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(candidate).visibility !== 'hidden'
      );
    });
    if (!button) return false;
    button.click();
    return true;
  }, label);
  assert(clicked, `${label} dugmesi bulunamadi.`);
}

function waitForActionResponse(page, action) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['x-istek-action'] === action,
    { timeout: TIMEOUT_MS }
  );
}

async function openAuthenticatedPage(browserInstance, baseUrl, viewport, userData, pageSessionToken) {
  const page = await browserInstance.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  if (viewport.reducedMotion) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  }
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((storedUser) => {
    localStorage.setItem('istek_it_user', JSON.stringify(storedUser));
  }, userData);
  await page.setCookie({
    name: COOKIE_NAME,
    value: pageSessionToken,
    url: baseUrl,
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    expires: Math.floor(Date.now() / 1000) + 15 * 60
  });

  const firstFetchPromise = waitForActionResponse(page, 'fetchData');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  const firstFetch = await firstFetchPromise;
  assert(firstFetch.status() === 200, `Ilk fetchData HTTP ${firstFetch.status()}`);
  const firstBody = await firstFetch.json();
  assert(firstBody?.success === true, firstBody?.error || 'Ilk fetchData basarisiz.');
  assert(Array.isArray(firstBody.personnel), 'Personel listesi donmedi.');
  assert(Array.isArray(firstBody.hardware), 'Donanim listesi donmedi.');

  await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });

  const refreshFetchPromise = waitForActionResponse(page, 'fetchData');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  const refreshFetch = await refreshFetchPromise;
  assert(refreshFetch.status() === 200, `Yenileme fetchData HTTP ${refreshFetch.status()}`);
  const refreshBody = await refreshFetch.json();
  assert(refreshBody?.success === true, refreshBody?.error || 'Yenileme fetchData basarisiz.');

  await clickVisibleButton(page, 'Personel');
  await page.waitForSelector('input[placeholder^="Personel Adı"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });
  await clickVisibleButton(page, 'Transfer');
  await page.waitForSelector('input[placeholder^="Gönderen, Alıcı"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });
  await waitForMotionSettle(page);
  const transferScreenshot = await saveScreenshot(page, `cookie-${viewport.name}-transfer`);
  await clickVisibleButton(page, 'Donanım');
  await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });

  await clickVisibleButton(page, 'Donanım Ekle');
  const glpiFetchPromise = waitForActionResponse(page, 'fetchMissingGLPIDevices');
  await clickVisibleButton(page, "GLPI'dan Donanım Ekle");
  const glpiFetch = await glpiFetchPromise;
  assert(glpiFetch.status() === 200, `GLPI eksik cihaz isteği HTTP ${glpiFetch.status()}`);
  const glpiBody = await glpiFetch.json();
  assert(glpiBody?.success === true, glpiBody?.error || 'GLPI eksik cihaz isteği başarısız.');
  assert(Array.isArray(glpiBody.devices), 'GLPI eksik cihaz listesi dönmedi.');
  assert(glpiBody.devices.length > 0, 'Test kullanıcısı için GLPI eksik cihaz listesi boş.');
  await page.waitForSelector('input[placeholder^="GLPI cihaz adı"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });
  await clickVisibleButton(page, 'Donanım');
  await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });

  const state = await page.evaluate((expectedName) => {
    const storedUser = JSON.parse(localStorage.getItem('istek_it_user') || 'null');
    return {
      hasExpectedUser: document.body.innerText.includes(expectedName),
      storedSessionMode: storedUser?.sessionMode || '',
      storedToken: storedUser?.token || '',
      documentCookie: document.cookie,
      hasViteErrorOverlay: Boolean(document.querySelector('vite-error-overlay')),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      bodyTextLength: document.body.innerText.trim().length,
      tabAnimationDuration: getComputedStyle(document.querySelector('.app-tab-panel')).animationDuration
    };
  }, userData.name);

  assert(pageErrors.length === 0, `React/JavaScript hatasi: ${pageErrors.join(' | ')}`);
  assert(!state.hasViteErrorOverlay, 'Vite hata katmani gorunuyor.');
  assert(state.storedSessionMode === 'cookie', `Session mode: ${state.storedSessionMode || 'bos'}`);
  assert(state.storedToken === COOKIE_SESSION_SENTINEL, 'Gercek oturum anahtari localStorage icinde olmamali.');
  assert(!state.documentCookie.includes(`${COOKIE_NAME}=`), 'HttpOnly cookie document.cookie icinde gorunuyor.');
  if (viewport.width >= 768) assert(state.hasExpectedUser, 'Yetkili adi masaustunde gorunmuyor.');
  assert(state.bodyTextLength >= 100, `Sayfa metni beklenenden az: ${state.bodyTextLength}`);
  assert(
    state.documentWidth <= state.viewportWidth + 2,
    `Yatay tasma var: belge ${state.documentWidth}px, viewport ${state.viewportWidth}px`
  );
  if (viewport.reducedMotion) {
    assert(
      Number.parseFloat(state.tabAnimationDuration || '1') <= 0.001,
      `Reduced motion animasyon suresi: ${state.tabAnimationDuration}`
    );
  }
  await waitForMotionSettle(page);
  const hardwareScreenshot = await saveScreenshot(page, `cookie-${viewport.name}-hardware`);

  return {
    page,
    getPageErrors: () => [...pageErrors],
    result: {
      name: viewport.name,
      size: `${viewport.width}x${viewport.height}`,
      personnelCount: firstBody.personnel.length,
      hardwareCount: firstBody.hardware.length,
      glpiMissingCount: glpiBody.devices.length,
      refreshSucceeded: true,
      localStorageContainsOnlySentinel: true,
      httpOnlyCookieHiddenFromDocument: true,
      reducedMotionHonored: Boolean(viewport.reducedMotion),
      screenshots: [hardwareScreenshot, transferScreenshot].filter(Boolean)
    }
  };
}

async function expireSqlSession(token) {
  const tokenHash = crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
  const result = await query(
    `
      UPDATE dbo.Sessions
      SET ExpiresAt = DATEADD(SECOND, -1, SYSUTCDATETIME())
      WHERE TokenHash = @tokenHash
    `,
    { tokenHash: { type: sql.Char(64), value: tokenHash } }
  );
  assert(Number(result.rowsAffected?.[0] || 0) === 1, 'Test SQL oturumu sona erdirilemedi.');
}

async function verifyExpiredSessionUi(browserInstance, baseUrl, userData, pageSessionToken) {
  const page = await browserInstance.newPage();
  const pageErrors = [];
  const nativeDialogs = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('dialog', async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });

  try {
    await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((storedUser) => {
      localStorage.setItem('istek_it_user', JSON.stringify(storedUser));
    }, userData);
    await page.setCookie({
      name: COOKIE_NAME,
      value: pageSessionToken,
      url: baseUrl,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 15 * 60
    });

    const initialFetchPromise = waitForActionResponse(page, 'fetchData');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const initialFetch = await initialFetchPromise;
    assert(initialFetch.status() === 200, `Sure dolma oncesi fetchData HTTP ${initialFetch.status()}`);
    await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
      visible: true,
      timeout: TIMEOUT_MS
    });

    await expireSqlSession(pageSessionToken);
    const expiredFetchPromise = waitForActionResponse(page, 'fetchData');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const expiredFetch = await expiredFetchPromise;
    assert(expiredFetch.status() === 401, `Suresi dolmus fetchData HTTP ${expiredFetch.status()}; 401 bekleniyordu`);

    await page.waitForFunction(
      () => [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Google ile Giriş Yap')),
      { timeout: TIMEOUT_MS }
    );
    await page.waitForSelector('#app-message-title', { visible: true, timeout: TIMEOUT_MS });

    const state = await page.evaluate(() => ({
      storedUser: localStorage.getItem('istek_it_user'),
      messageTitle: document.querySelector('#app-message-title')?.textContent?.trim() || '',
      messageText: document.querySelector('#app-message-description')?.textContent?.trim() || '',
      hasStyledDialog: Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'))
    }));
    const cookies = await page.cookies(baseUrl);

    assert(state.storedUser === null, '401 sonrasinda localStorage oturumu silinmedi.');
    assert(!cookies.some((cookie) => cookie.name === COOKIE_NAME), '401 sonrasinda HttpOnly cookie silinmedi.');
    assert(state.messageTitle === 'Oturum sona erdi', `Mesaj basligi: ${state.messageTitle || 'bos'}`);
    assert(
      /oturum bulunamad.|oturum s.resi doldu|yetki bulunamad./i.test(state.messageText),
      `Beklenmeyen mesaj: ${state.messageText}`
    );
    assert(state.hasStyledDialog, 'Uygulama ici oturum mesaji gorunmuyor.');
    assert(nativeDialogs.length === 0, `Yerel tarayici dialogu acildi: ${nativeDialogs.join(', ')}`);
    assert(pageErrors.length === 0, `Sure dolma React hatasi: ${pageErrors.join(' | ')}`);

    return {
      httpStatus: 401,
      frontendStorageCleared: true,
      httpOnlyCookieCleared: true,
      styledMessageVisible: true,
      nativeBrowserDialogCount: 0
    };
  } finally {
    await page.close();
  }
}

async function stopBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;
  const exited = new Promise((resolve) => backendProcess.once('exit', resolve));
  backendProcess.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) =>
      setTimeout(() => {
        if (backendProcess?.exitCode === null) backendProcess.kill('SIGKILL');
        resolve();
      }, 5000)
    )
  ]);
}

try {
  const executablePath = findBrowserExecutable();
  assert(executablePath, 'Chrome/Edge bulunamadi. PDF_CHROME_PATH veya CHROME_PATH tanimlayin.');

  await buildSameOriginFrontend();
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const user = await getSmokeUser();
  sessionToken = await createSession(user.email);
  const userData = {
    id: user.email,
    name: user.name || user.email.split('@')[0],
    email: user.email,
    role: user.role,
    campus: user.campus,
    picture: '',
    token: COOKIE_SESSION_SENTINEL,
    sessionMode: 'cookie',
    expiresAt: Date.now() + 15 * 60 * 1000
  };

  backendProcess = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      API_PUBLIC_URL: baseUrl,
      CORS_ORIGINS: baseUrl,
      SESSION_COOKIE_ENABLED: 'true',
      SESSION_COOKIE_NAME: COOKIE_NAME,
      SESSION_COOKIE_SECURE: 'false',
      SESSION_COOKIE_SAME_SITE: 'Lax',
      SESSION_COOKIE_DOMAIN: '',
      SESSION_COOKIE_ALLOW_BODY_TOKEN_FALLBACK: 'false',
      SERVE_FRONTEND: 'true',
      FRONTEND_DIST_DIR: frontendDistDir,
      QUEUE_WORKER_ENABLED: 'false',
      QUEUE_CLEANUP_ENABLED: 'false',
      LOG_LEVEL: 'warn'
    }
  });
  backendProcess.stdout.on('data', appendBackendOutput);
  backendProcess.stderr.on('data', appendBackendOutput);
  await waitUntilHealthy(baseUrl);

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check']
  });

  const desktop = await openAuthenticatedPage(
    browser,
    baseUrl,
    { name: 'desktop', width: 1440, height: 900 },
    userData,
    sessionToken
  );
  const mobile = await openAuthenticatedPage(
    browser,
    baseUrl,
    { name: 'mobile', width: 390, height: 844, reducedMotion: true },
    userData,
    sessionToken
  );

  const logoutResponsePromise = waitForActionResponse(desktop.page, 'logout');
  await clickVisibleButton(desktop.page, 'Çıkış Yap');
  const logoutResponse = await logoutResponsePromise;
  assert(logoutResponse.status() === 200, `Logout HTTP ${logoutResponse.status()}`);
  const logoutBody = await logoutResponse.json();
  assert(logoutBody?.success === true, logoutBody?.error || 'Logout basarisiz.');
  await desktop.page.waitForSelector('button', { visible: true, timeout: TIMEOUT_MS });
  await desktop.page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('Google ile Giriş Yap')),
    { timeout: TIMEOUT_MS }
  );

  const storedAfterLogout = await desktop.page.evaluate(() => localStorage.getItem('istek_it_user'));
  assert(storedAfterLogout === null, 'Logout sonrasinda localStorage oturumu silinmedi.');
  const remainingCookies = await desktop.page.cookies(baseUrl);
  assert(!remainingCookies.some((cookie) => cookie.name === COOKIE_NAME), 'Logout sonrasinda HttpOnly cookie silinmedi.');
  await nodeAssert.rejects(
    () => getSessionUser(sessionToken),
    /oturum s.resi doldu|yetki bulunamad./i
  );
  assert(desktop.getPageErrors().length === 0, `Logout React hatasi: ${desktop.getPageErrors().join(' | ')}`);

  await mobile.page.close();
  await desktop.page.close();

  expiredSessionToken = await createSession(user.email);
  const expiration = await verifyExpiredSessionUi(
    browser,
    baseUrl,
    { ...userData, expiresAt: Date.now() + 15 * 60 * 1000 },
    expiredSessionToken
  );

  console.log(JSON.stringify({
    success: true,
    sameOrigin: true,
    sessionMode: 'cookie',
    results: [desktop.result, mobile.result],
    logout: {
      frontendStorageCleared: true,
      httpOnlyCookieCleared: true,
      sqlSessionRevoked: true
    },
    expiration
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: String(error?.message || error),
    backendOutput: backendOutput.trim() || undefined
  }, null, 2));
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch {
    process.exitCode = 1;
  }
  if (sessionToken) await revokeSession(sessionToken).catch(() => {});
  if (expiredSessionToken) await revokeSession(expiredSessionToken).catch(() => {});
  await stopBackend().catch(() => {});
  await closePool();
}
