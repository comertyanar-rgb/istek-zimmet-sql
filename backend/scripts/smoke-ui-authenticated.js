import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { config } from '../src/config.js';
import { closePool, query } from '../src/db.js';
import { getAuthorizedUser } from '../src/repositories/inventoryRepository.js';
import { createSession, revokeSession } from '../src/sessionService.js';

const DEFAULT_UI_URL = 'http://localhost:5173';
const TIMEOUT_MS = 30_000;
const COOKIE_SESSION_SENTINEL = '__HTTP_ONLY_COOKIE_SESSION__';

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
  assert(email, 'Aktif yetkili kullanici bulunamadi');

  const user = await getAuthorizedUser(email);
  assert(user, 'Yetkili kullanici ayrintisi bulunamadi');
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
  assert(clicked, `${label} sekme dugmesi bulunamadi`);
}

async function inspectAuthenticatedViewport(browser, viewport, userData, sessionToken) {
  const page = await browser.newPage();
  const pageErrors = [];
  let stage = 'sayfa açılıyor';
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  try {
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((storedUser) => {
      localStorage.setItem('istek_it_user', JSON.stringify(storedUser));
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

    const fetchDataResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.request().headers()['x-istek-action'] === 'fetchData',
      { timeout: TIMEOUT_MS }
    );

    stage = 'ana veri yükleniyor';
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const fetchDataResponse = await fetchDataResponsePromise;
    assert(fetchDataResponse.status() === 200, `fetchData HTTP ${fetchDataResponse.status()}`);
    const fetchDataBody = await fetchDataResponse.json();
    assert(fetchDataBody?.success === true, `fetchData basarisiz: ${fetchDataBody?.error || 'bilinmiyor'}`);
    assert(Array.isArray(fetchDataBody.personnel), 'fetchData personnel listesi donmedi');
    assert(Array.isArray(fetchDataBody.hardware), 'fetchData hardware listesi donmedi');

    await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
      visible: true,
      timeout: TIMEOUT_MS
    });
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
    await clickVisibleButton(page, 'Donanım');
    await page.waitForSelector('input[placeholder^="Marka, Model, Seri No"]', {
      visible: true,
      timeout: TIMEOUT_MS
    });

    await clickVisibleButton(page, 'Personel');
    await page.waitForSelector('input[placeholder^="Personel Adı"]', {
      visible: true,
      timeout: TIMEOUT_MS
    });
    stage = 'yeni zimmet penceresi açılıyor';
    await clickVisibleButton(page, 'Yeni Zimmet');
    await page.waitForFunction(
      () => document.body.innerText.includes('Personel Seçimi'),
      { timeout: TIMEOUT_MS }
    );

    stage = 'personel seçiliyor';
    const personSelected = await page.evaluate(() => {
      const input = document.querySelector('input[type="radio"][name="person"]');
      const label = input?.closest('label');
      if (!label) return false;
      label.click();
      return true;
    });
    assert(personSelected, 'Zimmet testi için seçilebilir personel bulunamadı');

    await page.waitForFunction(
      () => document.body.innerText.includes('Verilecek Donanımlar'),
      { timeout: TIMEOUT_MS }
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    stage = 'donanım seçiliyor';
    const hardwareSelected = await page.evaluate(() => {
      const checkbox = [...document.querySelectorAll('main input[type="checkbox"]')].find(
        (candidate) => {
          const text = candidate.closest('label')?.innerText || '';
          return text.includes('S/N:') && !text.includes('Zimmetli');
        }
      );
      if (!checkbox) return false;
      checkbox.click();
      return true;
    });
    assert(hardwareSelected, 'Zimmet testi için seçilebilir donanım bulunamadı');

    await page.waitForSelector('[aria-label*="cihaz için tutanak oluştur ve onaya geç"]', {
      visible: true,
      timeout: TIMEOUT_MS
    });

    const assignmentActionState = await page.evaluate(() => {
      const button = document.querySelector('[aria-label*="cihaz için tutanak oluştur ve onaya geç"]');
      const fixedContainer = button?.closest('.fixed');
      const rect = fixedContainer?.getBoundingClientRect();
      return {
        fixed: fixedContainer ? getComputedStyle(fixedContainer).position === 'fixed' : false,
        insideViewport: Boolean(
          rect && rect.top >= 0 && rect.bottom <= window.innerHeight + 1 && rect.width > 0
        )
      };
    });
    assert(assignmentActionState.fixed, 'Zimmet onay eylemi sabit konumda değil');
    assert(assignmentActionState.insideViewport, 'Zimmet onay eylemi görünür alanın dışında');

    await page.evaluate(() => {
      const main = document.querySelector('main');
      if (main) main.scrollTop = Math.min(500, main.scrollHeight - main.clientHeight);
    });
    await new Promise((resolve) => setTimeout(resolve, 180));

    const assignmentActionCompact = await page.evaluate(() => {
      const button = document.querySelector('[aria-label*="cihaz için tutanak oluştur ve onaya geç"]');
      const motion = button?.closest('.assignment-floating-motion');
      return {
        opacity: Number.parseFloat(motion?.style.opacity || '1'),
        transform: motion?.style.transform || ''
      };
    });
    assert(assignmentActionCompact.opacity <= 0.5, 'Zimmet onay eylemi kaydırmada saydamlaşmadı');
    assert(
      assignmentActionCompact.transform.includes('scale(0.9'),
      'Zimmet onay eylemi kaydırmada küçülmedi'
    );

    stage = 'zimmet onay penceresi açılıyor';
    const assignmentActionClicked = await page.evaluate(() => {
      const button = document.querySelector('[aria-label*="cihaz için tutanak oluştur ve onaya geç"]');
      if (!button) return false;
      button.click();
      return true;
    });
    assert(assignmentActionClicked, 'Zimmet onay eylemi açılamadı');

    const assignedWarningVisible = await page.evaluate(() =>
      document.body.innerText.includes('Dikkat! Cihaz Zaten Zimmetli')
    );
    if (assignedWarningVisible) {
      await clickVisibleButton(page, 'Yine de Devam Et');
    }

    await page.waitForFunction(
      () => document.body.innerText.includes('IT Teslim Beyanı'),
      { timeout: TIMEOUT_MS }
    );
    stage = 'IT beyan alanı açılıyor';
    const statementPadOpened = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate.innerText.includes('IT Teslim Beyanı') &&
        candidate.innerText.includes('Yazma alanını büyütmek için dokunun')
      );
      if (!button) return false;
      button.click();
      return true;
    });
    assert(statementPadOpened, 'IT teslim beyanı yazma alanı açılamadı');

    stage = 'el yazısı tuvali doğrulanıyor';
    const canvas = await page.waitForSelector('canvas', { visible: true, timeout: TIMEOUT_MS });
    const statementPadState = await page.evaluate(() => {
      const target = document.querySelector('canvas');
      const style = target ? getComputedStyle(target) : null;
      return {
        touchAction: style?.touchAction || '',
        userSelect: style?.userSelect || '',
        draggable: target?.draggable ?? true
      };
    });
    assert(statementPadState.touchAction === 'none', 'Beyan alanı dokunmatik kaydırmayı engellemiyor');
    assert(statementPadState.userSelect === 'none', 'Beyan alanı metin seçimini engellemiyor');
    assert(statementPadState.draggable === false, 'Beyan alanı sürüklenebilir durumda');

    const canvasBox = await canvas.boundingBox();
    assert(canvasBox?.width > 100 && canvasBox?.height > 100, 'Beyan alanı beklenenden küçük');
    await page.mouse.move(canvasBox.x + 40, canvasBox.y + 70);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.35, canvasBox.y + 95, { steps: 8 });
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.58, canvasBox.y + 62, { steps: 8 });
    await page.mouse.up();

    const drawnPixelCount = await page.evaluate(() => {
      const target = document.querySelector('canvas');
      if (!target) return 0;
      const pixels = target.getContext('2d').getImageData(0, 0, target.width, target.height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] >= 8) count += 1;
      }
      return count;
    });
    assert(drawnPixelCount > 20, `El yazısı tuvaline çizim işlenmedi: ${drawnPixelCount} piksel`);

    stage = 'el yazısı beyanı kaydediliyor';
    const statementConfirmed = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Beyanı Onayla' && !candidate.disabled
      );
      if (!button) return false;
      button.click();
      return true;
    });
    assert(statementConfirmed, 'El yazısı beyanı onaylanamadı');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const statementSaveState = await page.evaluate(() => ({
      saved: [...document.querySelectorAll('span')].some(
        (candidate) => candidate.textContent?.trim() === 'Beyan Kaydedildi'
      ),
      editorOpen: Boolean(document.querySelector('[role="dialog"][aria-label*="yazma alanı"]')),
      confirmDisabled: [...document.querySelectorAll('button')].some(
        (candidate) => candidate.textContent?.includes('Beyanı Onayla') && candidate.disabled
      ),
      beyanTexts: [...document.querySelectorAll('button, span, p')]
        .map((node) => node.textContent?.trim() || '')
        .filter((text) => text.includes('Beyan'))
        .slice(0, 12),
      imageAlts: [...document.querySelectorAll('img')]
        .map((image) => ({ alt: image.alt, srcLength: image.src?.length || 0 }))
        .filter((image) => image.alt.toLocaleLowerCase('tr-TR').includes('beyan'))
    }));
    assert(
      statementSaveState.saved,
      `El yazısı beyanı kaydedilmedi: ${JSON.stringify({ ...statementSaveState, drawnPixelCount })}`
    );

    const statementImageLength = await page.evaluate(() => {
      const preview = [...document.querySelectorAll('img')].find((candidate) =>
        candidate.alt === 'IT Teslim Beyanı el yazısı'
      );
      return preview?.src?.length || 0;
    });
    assert(statementImageLength > 100, 'El yazısı beyanı PNG olarak kaydedilmedi');
    assert(statementImageLength < 300_000, `El yazısı beyanı backend sınırını aşıyor: ${statementImageLength}`);

    const state = await page.evaluate((expectedName) => ({
      hasExpectedUser: document.body.innerText.includes(expectedName),
      hasViteErrorOverlay: Boolean(document.querySelector('vite-error-overlay')),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      bodyTextLength: document.body.innerText.trim().length
    }), userData.name);
    const screenshot = await page.screenshot({ type: 'png', fullPage: false });

    assert(pageErrors.length === 0, `React/JavaScript hatasi: ${pageErrors.join(' | ')}`);
    assert(!state.hasViteErrorOverlay, 'Vite hata katmani gorunuyor');
    if (viewport.width >= 768) {
      assert(state.hasExpectedUser, 'Yetkili kullanici adi masaustu basliginda gorunmuyor');
    }
    assert(state.bodyTextLength >= 100, `Sayfa metni beklenenden az: ${state.bodyTextLength}`);
    assert(
      state.documentWidth <= state.viewportWidth + 2,
      `Yatay tasma var: belge ${state.documentWidth}px, viewport ${state.viewportWidth}px`
    );
    assert(screenshot.length > 10_000, `Ekran goruntusu beklenenden kucuk: ${screenshot.length} byte`);

    return {
      name: viewport.name,
      size: `${viewport.width}x${viewport.height}`,
      personnelCount: fetchDataBody.personnel.length,
      hardwareCount: fetchDataBody.hardware.length,
      userLabelVisible: state.hasExpectedUser,
      assignmentActionFixed: assignmentActionState.fixed,
      assignmentActionCompact: assignmentActionCompact.opacity <= 0.5,
      statementPadTouchSafe: statementPadState.touchAction === 'none' && statementPadState.userSelect === 'none',
      statementImageLength,
      screenshotBytes: screenshot.length
    };
  } catch (error) {
    const visibleText = await page.evaluate(() => document.body.innerText.slice(0, 2500)).catch(() => '');
    throw new Error(`${viewport.name} / ${stage}: ${String(error?.message || error)}\n${visibleText}`);
  } finally {
    await page.close();
  }
}

const executablePath = findBrowserExecutable();
let browser;
let sessionToken = '';

try {
  assert(executablePath, 'Chrome/Edge bulunamadi. PDF_CHROME_PATH veya CHROME_PATH tanimlayin.');
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

  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
  ];
  const results = [];
  for (const viewport of viewports) {
    results.push(await inspectAuthenticatedViewport(browser, viewport, userData, sessionToken));
  }

  console.log(JSON.stringify({
    success: true,
    uiUrl,
    sessionMode: userData.sessionMode,
    role: user.role,
    campus: user.campus,
    results
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    uiUrl,
    error: String(error?.message || error)
  }, null, 2));
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch (error) {
    console.error(`Tarayici kapatilamadi: ${String(error?.message || error)}`);
    process.exitCode = 1;
  }

  if (sessionToken) {
    try {
      const revoked = await revokeSession(sessionToken);
      if (!revoked) throw new Error('Olusturulan test oturumu bulunamadi');
      console.log('Test oturumu SQL tablosundan silindi.');
    } catch (error) {
      console.error(`Test oturumu temizlenemedi: ${String(error?.message || error)}`);
      process.exitCode = 1;
    }
  }

  try {
    await closePool();
  } catch (error) {
    console.error(`SQL havuzu kapatilamadi: ${String(error?.message || error)}`);
    process.exitCode = 1;
  }
}
