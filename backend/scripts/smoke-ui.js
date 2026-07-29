import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DEFAULT_UI_URL = 'http://localhost:5173';
const NAVIGATION_TIMEOUT_MS = 20_000;

const uiUrl = String(process.env.UI_BASE_URL || process.argv[2] || DEFAULT_UI_URL)
  .trim()
  .replace(/\/+$/, '');

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function inspectViewport(browser, viewport) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  try {
    await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForFunction(
      () => document.body?.innerText?.includes('Bilgi İşlem Demirbaş Yönetim Sistemi'),
      { timeout: NAVIGATION_TIMEOUT_MS }
    );

    const state = await page.evaluate(() => {
      const root = document.getElementById('root');
      const buttons = [...document.querySelectorAll('button')];
      const loginButton = buttons.find((button) => button.textContent?.includes('Google ile Giriş Yap'));
      const buttonRect = loginButton?.getBoundingClientRect();
      const rootRect = root?.getBoundingClientRect();

      return {
        bodyTextLength: document.body?.innerText?.trim().length || 0,
        hasViteErrorOverlay: Boolean(document.querySelector('vite-error-overlay')),
        rootWidth: rootRect?.width || 0,
        rootHeight: rootRect?.height || 0,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        loginButtonVisible: Boolean(
          loginButton &&
          buttonRect &&
          buttonRect.width > 0 &&
          buttonRect.height > 0 &&
          buttonRect.right > 0 &&
          buttonRect.bottom > 0 &&
          buttonRect.left < window.innerWidth &&
          buttonRect.top < window.innerHeight
        ),
        loginButtonClipped: Boolean(
          loginButton &&
          (loginButton.scrollWidth > loginButton.clientWidth + 1 ||
            loginButton.scrollHeight > loginButton.clientHeight + 1)
        )
      };
    });

    const screenshot = await page.screenshot({ type: 'png', fullPage: false });
    assert(pageErrors.length === 0, `React/JavaScript hatasi: ${pageErrors.join(' | ')}`);
    assert(!state.hasViteErrorOverlay, 'Vite hata katmani gorunuyor');
    assert(state.bodyTextLength >= 80, `Sayfa metni beklenenden az: ${state.bodyTextLength}`);
    assert(state.rootWidth > 0 && state.rootHeight > 0, 'React root gorunur boyuta sahip degil');
    assert(state.loginButtonVisible, 'Google ile Giris Yap dugmesi gorunmuyor');
    assert(!state.loginButtonClipped, 'Google ile Giris Yap dugmesi kirpilmis');
    assert(
      state.documentWidth <= state.viewportWidth + 2,
      `Yatay tasma var: belge ${state.documentWidth}px, viewport ${state.viewportWidth}px`
    );
    assert(screenshot.length > 5000, `Ekran goruntusu beklenenden kucuk: ${screenshot.length} byte`);

    return {
      name: viewport.name,
      size: `${viewport.width}x${viewport.height}`,
      screenshotBytes: screenshot.length,
      bodyTextLength: state.bodyTextLength
    };
  } finally {
    await page.close();
  }
}

const executablePath = findBrowserExecutable();
if (!executablePath) {
  console.error('Chrome/Edge bulunamadi. PDF_CHROME_PATH veya CHROME_PATH tanimlayin.');
  process.exit(1);
}

let browser;
try {
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
  for (const viewport of viewports) results.push(await inspectViewport(browser, viewport));

  console.log(JSON.stringify({ success: true, uiUrl, executablePath, results }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    uiUrl,
    executablePath,
    error: String(error?.message || error)
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
