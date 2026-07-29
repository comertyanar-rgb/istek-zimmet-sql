import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from '../src/config.js';
import { closePool, query } from '../src/db.js';
import { getAuthorizedUser } from '../src/repositories/inventoryRepository.js';
import { createSession, revokeSession } from '../src/sessionService.js';

const DEFAULT_UI_URL = 'http://127.0.0.1:5174';
const COOKIE_SESSION_SENTINEL = '__HTTP_ONLY_COOKIE_SESSION__';
const TIMEOUT_MS = 30_000;
const waitMs = Math.max(5_000, Number(process.env.STABILITY_WAIT_MS || 100_000));
const uiUrl = String(process.env.UI_BASE_URL || process.argv[2] || DEFAULT_UI_URL)
  .trim()
  .replace(/\/+$/, '');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findBrowserExecutable() {
  const candidates = [
    process.env.PDF_CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
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
  assert(email, 'Aktif yetkili kullanıcı bulunamadı.');

  const user = await getAuthorizedUser(email);
  assert(user, 'Yetkili kullanıcı ayrıntısı bulunamadı.');
  return user;
}

let browser;
let sessionToken = '';
const diagnostics = {
  navigationRequests: [],
  frameNavigations: [],
  consoleMessages: [],
  hmrMessages: [],
  pageErrors: [],
  loadCount: 0,
  fetchDataCount: 0
};

try {
  const executablePath = findBrowserExecutable();
  assert(executablePath, 'Chrome veya Edge bulunamadı.');

  const user = await getSmokeUser();
  sessionToken = await createSession(user.email);
  const userData = {
    id: user.email,
    name: user.name || user.email.split('@')[0],
    email: user.email,
    role: user.role,
    campus: user.campus,
    picture: '',
    token: config.session.cookieEnabled ? COOKIE_SESSION_SENTINEL : sessionToken,
    sessionMode: config.session.cookieEnabled ? 'cookie' : 'token',
    expiresAt: Date.now() + 15 * 60 * 1000
  };

  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check']
  });

  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    const payload = String(response?.payloadData || '');
    if (
      /"type":"(?:full-reload|update|error)"/.test(payload) &&
      diagnostics.hmrMessages.length < 100
    ) {
      diagnostics.hmrMessages.push({
        at: new Date().toISOString(),
        payload
      });
    }
  });
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      diagnostics.navigationRequests.push({
        at: new Date().toISOString(),
        url: request.url(),
        resourceType: request.resourceType(),
        initiator: request.initiator()
      });
    }
    if (request.headers()['x-istek-action'] === 'fetchData') diagnostics.fetchDataCount += 1;
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      diagnostics.frameNavigations.push({
        at: new Date().toISOString(),
        url: frame.url()
      });
    }
  });
  page.on('load', () => {
    diagnostics.loadCount += 1;
  });
  page.on('console', (message) => {
    const text = message.text();
    if (
      /vite|reload|update|websocket|hmr|optimiz/i.test(text) &&
      diagnostics.consoleMessages.length < 100
    ) {
      diagnostics.consoleMessages.push({
        at: new Date().toISOString(),
        type: message.type(),
        text
      });
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(String(error?.message || error));
  });

  await page.evaluateOnNewDocument((storedUser) => {
    const probeKey = '__istek_stability_document_count';
    const nextCount = Number(window.sessionStorage.getItem(probeKey) || 0) + 1;
    window.sessionStorage.setItem(probeKey, String(nextCount));
    window.localStorage.setItem('istek_it_user', JSON.stringify(storedUser));
  }, userData);

  if (config.session.cookieEnabled) {
    await page.setCookie({
      name: config.session.cookieName,
      value: sessionToken,
      url: uiUrl,
      httpOnly: true,
      secure: config.session.cookieSecure,
      sameSite: config.session.cookieSameSite,
      expires: Math.floor(Date.now() / 1000) + 15 * 60
    });
  }

  await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
    visible: true,
    timeout: TIMEOUT_MS
  });

  const baseline = {
    documentCount: await page.evaluate(() =>
      Number(window.sessionStorage.getItem('__istek_stability_document_count') || 0)
    ),
    navigationRequestCount: diagnostics.navigationRequests.length,
    frameNavigationCount: diagnostics.frameNavigations.length,
    loadCount: diagnostics.loadCount,
    fetchDataCount: diagnostics.fetchDataCount,
    url: page.url()
  };

  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const finalState = {
    documentCount: await page.evaluate(() =>
      Number(window.sessionStorage.getItem('__istek_stability_document_count') || 0)
    ),
    navigationRequestCount: diagnostics.navigationRequests.length,
    frameNavigationCount: diagnostics.frameNavigations.length,
    loadCount: diagnostics.loadCount,
    fetchDataCount: diagnostics.fetchDataCount,
    url: page.url(),
    bodyTextLength: await page.evaluate(() => document.body.innerText.length)
  };

  assert(
    diagnostics.pageErrors.length === 0,
    `Tarayıcı hatası: ${diagnostics.pageErrors.join(' | ')}`
  );
  assert(
    finalState.documentCount === baseline.documentCount,
    `Sayfa ${finalState.documentCount - baseline.documentCount} kez yeniden yüklendi.`
  );
  assert(
    finalState.navigationRequestCount === baseline.navigationRequestCount,
    'Beklenmeyen ana belge isteği oluştu.'
  );
  assert(finalState.url === baseline.url, `Sayfa adresi değişti: ${finalState.url}`);

  console.log(
    JSON.stringify(
      {
        success: true,
        uiUrl,
        waitMs,
        baseline,
        finalState,
        diagnostics
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        success: false,
        uiUrl,
        waitMs,
        error: String(error?.message || error),
        diagnostics
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (sessionToken) {
    try {
      await revokeSession(sessionToken);
    } catch {
      // Test sonucu korunur; yalnızca geçici oturum temizliği başarısız oldu.
    }
  }
  await closePool();
}
