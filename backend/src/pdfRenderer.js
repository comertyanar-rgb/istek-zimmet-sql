import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';

const DEFAULT_CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

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

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PDF renderer hata kodu ${code}: ${stderr.slice(0, 1200)}`));
    });
  });
}

export async function renderHtmlToPdfBuffer(html, pdfName = 'belge.pdf') {
  const chromePath = await findChromeExecutable();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'istek-pdf-'));
  const safeBase = String(pdfName || 'belge.pdf').replace(/[\\/:*?"<>|]/g, '-').replace(/\.pdf$/i, '');
  const htmlPath = path.join(workDir, `${safeBase || crypto.randomUUID()}.html`);
  const pdfPath = path.join(workDir, `${safeBase || crypto.randomUUID()}.pdf`);

  try {
    await fs.writeFile(htmlPath, html, 'utf8');
    await runProcess(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=1000',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ]);

    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
