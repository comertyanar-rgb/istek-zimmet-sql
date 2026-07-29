import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import { config } from './config.js';

const DEFAULT_CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

let executablePromise = null;
let browserPromise = null;
let browserInstance = null;
let activePages = 0;
const pageWaiters = [];

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findChromeExecutable() {
  if (config.chrome.executablePath && await exists(config.chrome.executablePath)) {
    return config.chrome.executablePath;
  }

  for (const candidate of DEFAULT_CHROME_PATHS) {
    if (await exists(candidate)) return candidate;
  }

  throw new Error('PDF üretimi için Chrome/Edge bulunamadı. PDF_CHROME_PATH ortam değişkenini ayarlayın.');
}

function getChromeExecutable() {
  if (!executablePromise) executablePromise = findChromeExecutable();
  return executablePromise;
}

function browserIsConnected(browser) {
  if (!browser) return false;
  if (typeof browser.isConnected === 'function') return browser.isConnected();
  return Boolean(browser.connected);
}

async function launchBrowser() {
  const executablePath = await getChromeExecutable();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    timeout: config.chrome.launchTimeoutMs,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--no-default-browser-check',
      '--no-first-run'
    ]
  });

  browserInstance = browser;
  browser.on('disconnected', () => {
    if (browserInstance === browser) browserInstance = null;
    browserPromise = null;
  });
  return browser;
}

async function getBrowser() {
  if (browserIsConnected(browserInstance)) return browserInstance;
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null;
      browserInstance = null;
      throw error;
    });
  }
  return browserPromise;
}

function releasePageSlot() {
  activePages = Math.max(0, activePages - 1);
  const next = pageWaiters.shift();
  if (next) next();
}

async function acquirePageSlot() {
  const maxPages = config.chrome.maxConcurrentPages;
  if (activePages >= maxPages) {
    await new Promise((resolve) => pageWaiters.push(resolve));
  }
  activePages += 1;
  return releasePageSlot;
}

function isRecoverableBrowserError(error) {
  return /browser has disconnected|connection closed|session closed|target closed|protocol error/i.test(
    String(error?.message || error || '')
  );
}

async function discardBrowser() {
  const browser = browserInstance;
  browserInstance = null;
  browserPromise = null;
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    // Çökmüş tarayıcı zaten kapanmış olabilir.
  }
}

async function renderOnce(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    page.setDefaultTimeout(config.chrome.renderTimeoutMs);
    page.setDefaultNavigationTimeout(config.chrome.renderTimeoutMs);
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url === 'about:blank' || url.startsWith('data:')) {
        request.continue();
        return;
      }
      request.abort('blockedbyclient');
    });

    await page.setContent(html, {
      waitUntil: 'load',
      timeout: config.chrome.renderTimeoutMs
    });
    await page.emulateMediaType('print');

    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      timeout: config.chrome.renderTimeoutMs
    });
    return Buffer.from(bytes);
  } finally {
    try {
      await page.close();
    } catch {
      // Tarayıcı çöktüyse sayfa ayrıca kapatılamayabilir.
    }
  }
}

export async function renderHtmlToPdfBuffer(html) {
  const release = await acquirePageSlot();
  try {
    try {
      return await renderOnce(html);
    } catch (error) {
      if (!isRecoverableBrowserError(error)) throw error;
      await discardBrowser();
      return await renderOnce(html);
    }
  } finally {
    release();
  }
}

export async function closePdfRenderer() {
  await discardBrowser();
}
