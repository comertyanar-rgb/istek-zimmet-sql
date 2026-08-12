import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer-core';

const SIGNATURE_WIDTH = 1072;
const SIGNATURE_HEIGHT = 287;
const CAMPUS_BAND_TOP = 185;
const DEFAULT_CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const DEFAULT_CAMPUS_DIRS = [
  'C:/GAMWork/campus',
  'C:/GAMWork/template/campus',
];

const TEMPLATE_STYLES = {
  '1': { left: 79, right: 609, icon: 577, titleTr: 25, titleEn: 25 },
  '2': { left: 79, right: 609, icon: 577, titleTr: 24, titleEn: 21 },
  '3': { left: 64, right: 648, icon: 616, titleTr: 22, titleEn: 19 },
  '4': { left: 64, right: 648, icon: 616, titleTr: 19, titleEn: 16 },
};

function readArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

function parseDelimitedLine(line, delimiter = '\t') {
  const values = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

function parseDataset(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseDelimitedLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function normalizeTemplateKey(value) {
  const aliases = { normal: '1', compact: '2', small: '3', tiny: '4' };
  let key = String(value || '1').trim().toLowerCase();
  key = key.replace(/^imza-template-/, '').replace(/^template-/, '').replace(/^tpl/, '');
  key = aliases[key] || key;
  if (!/^[1-4](?:-w)?$/.test(key)) throw new Error(`Geçersiz imza şablonu: ${value}`);
  return key;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  return 'image/png';
}

async function fileToDataUrl(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:${getMimeType(filePath)};base64,${bytes.toString('base64')}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findChromeExecutable(configuredPath) {
  const candidates = [
    configuredPath,
    process.env.SIGNATURE_CHROME_PATH,
    process.env.PDF_CHROME_PATH,
    ...DEFAULT_CHROME_PATHS,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error('Chrome/Edge bulunamadı. SIGNATURE_CHROME_PATH ortam değişkenini ayarlayın.');
}

async function resolveCampusImagePath(configuredPath, configuredCampusDir) {
  const sourcePath = String(configuredPath || '').trim();
  const fileName = path.win32.basename(sourcePath) || path.basename(sourcePath);
  const campusDirectories = [
    configuredCampusDir,
    process.env.SIGNATURE_CAMPUS_DIR,
    ...DEFAULT_CAMPUS_DIRS,
  ].filter(Boolean);
  const candidates = [
    sourcePath,
    ...campusDirectories.map((directory) => fileName && path.join(directory, fileName)),
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates.map((candidate) => path.normalize(candidate)))];

  for (const candidate of uniqueCandidates) {
    if (await exists(candidate)) return candidate;
  }

  throw new Error(
    `Kampüs alt bant görseli bulunamadı: ${sourcePath || '(boş)'}. Denenen yollar: ${uniqueCandidates.join(', ') || '(yok)'}`
  );
}

function iconSvg(type) {
  const paths = {
    mail: '<path d="M3.5 6.5h17v11h-17z"/><path d="m4 7 8 6 8-6"/>',
    location: '<path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"/><circle cx="12" cy="10" r="2"/>',
    home: '<path d="m4 11 8-7 8 7"/><path d="M6.5 10v9h11v-9"/><path d="M10 19v-5h4v5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type]}</svg>`;
}

function buildSignatureHtml(row, templateKey, campusImageDataUrl) {
  const baseKey = templateKey.replace(/-w$/, '');
  const wide = templateKey.endsWith('-w');
  const style = TEMPLATE_STYLES[baseKey];
  const nameSize = wide ? 29 : 36;
  const nameMaxWidth = Math.max(390, style.icon - style.left - 38);
  const rightMaxWidth = SIGNATURE_WIDTH - style.right - 24;

  const name = escapeHtml(row.ad);
  const titleTr = escapeHtml(row.unvan);
  const titleEn = escapeHtml(row.ing);
  const email = escapeHtml(row.email);
  const address = escapeHtml(row.adres);
  const campusImage = escapeAttribute(campusImageDataUrl);

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${SIGNATURE_WIDTH}px; height: ${SIGNATURE_HEIGHT}px; overflow: hidden; background: #fff; }
    body { font-family: "Gotham", "Century Gothic", "Segoe UI", Arial, sans-serif; color: #0071bc; }
    .signature { position: relative; width: ${SIGNATURE_WIDTH}px; height: ${SIGNATURE_HEIGHT}px; background: #fff; }
    .name, .title, .info-text { position: absolute; white-space: nowrap; overflow: hidden; }
    .name {
      left: ${style.left}px; top: 43px; width: ${nameMaxWidth}px;
      font-size: ${nameSize}px; line-height: 43px; font-weight: 700; letter-spacing: -0.6px;
    }
    .title { left: ${style.left}px; width: ${nameMaxWidth + 36}px; font-weight: 400; letter-spacing: -0.5px; }
    .title-tr { top: 91px; font-size: ${style.titleTr}px; line-height: 30px; }
    .title-en { top: 123px; font-size: ${style.titleEn}px; line-height: 30px; }
    .info-icon {
      position: absolute; left: ${style.icon}px; width: 25px; height: 25px;
      border-radius: 50%; background: #0071bc; display: grid; place-items: center;
    }
    .info-icon svg { width: 15px; height: 15px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .mail-icon { top: 58px; }
    .location-icon { top: 89px; }
    .home-icon { top: 121px; }
    .info-text {
      left: ${style.right}px; width: ${rightMaxWidth}px; height: 29px;
      font-size: 21px; line-height: 29px; letter-spacing: -0.4px; text-overflow: clip;
    }
    .email { top: 56px; }
    .address { top: 88px; }
    .website { top: 120px; font-weight: 700; }
    .campus-band { position: absolute; left: 0; top: ${CAMPUS_BAND_TOP}px; width: ${SIGNATURE_WIDTH}px; height: ${SIGNATURE_HEIGHT - CAMPUS_BAND_TOP}px; object-fit: fill; }
  </style>
</head>
<body>
  <main class="signature">
    <div class="name">${name}</div>
    <div class="title title-tr">${titleTr}</div>
    <div class="title title-en">${titleEn}</div>
    <span class="info-icon mail-icon">${iconSvg('mail')}</span>
    <span class="info-icon location-icon">${iconSvg('location')}</span>
    <span class="info-icon home-icon">${iconSvg('home')}</span>
    <div class="info-text email">${email}</div>
    <div class="info-text address">${address}</div>
    <div class="info-text website">www.istek.k12.tr</div>
    <img class="campus-band" src="${campusImage}" alt="">
  </main>
</body>
</html>`;
}

async function renderRow(page, row, outputDir, templateKey, campusDir) {
  const filename = String(row.filename || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(filename)) {
    throw new Error(`Geçersiz imza dosya kimliği: ${filename || '(boş)'}`);
  }

  const campusImagePath = await resolveCampusImagePath(row.CampusImage, campusDir);

  const campusImageDataUrl = await fileToDataUrl(campusImagePath);
  const html = buildSignatureHtml(row, templateKey, campusImageDataUrl);
  await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });

  const outputPath = path.join(outputDir, `${filename}.jpg`);
  await page.screenshot({
    path: outputPath,
    type: 'jpeg',
    quality: 96,
    clip: { x: 0, y: 0, width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT },
    captureBeyondViewport: false,
  });
  return outputPath;
}

async function main() {
  const args = readArguments(process.argv.slice(2));
  const datasetPath = path.resolve(String(args.dataset || ''));
  const outputDir = path.resolve(String(args['output-dir'] || ''));
  const templateKey = normalizeTemplateKey(args['template-key']);
  if (!args.dataset || !args['output-dir']) {
    throw new Error('Kullanım: --dataset <dosya> --output-dir <klasör> --template-key <1|1-w|...|4-w>');
  }

  const datasetText = await fs.readFile(datasetPath, 'utf8');
  const rows = parseDataset(datasetText);
  if (rows.length === 0) throw new Error(`Dataset boş: ${datasetPath}`);
  await fs.mkdir(outputDir, { recursive: true });

  const executablePath = await findChromeExecutable(args['chrome-path']);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    timeout: 30_000,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  });

  const outputs = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SIGNATURE_WIDTH, height: SIGNATURE_HEIGHT, deviceScaleFactor: 1 });
    await page.setJavaScriptEnabled(true);
    for (const row of rows) {
      outputs.push(await renderRow(page, row, outputDir, templateKey, args['campus-dir']));
    }
    await page.close();
  } finally {
    await browser.close();
  }

  process.stdout.write(`${JSON.stringify({
    success: true,
    engine: 'headless-chrome',
    templateKey,
    count: outputs.length,
    outputs,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ success: false, error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
