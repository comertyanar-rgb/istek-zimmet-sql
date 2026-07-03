/**
 * İSTEK e-posta imza otomasyonu
 *
 * Akis:
 * 1) IK / IT ana sayfada Unvan ve Isleme Al alanlarini duzenler.
 * 2) Export Tools > Isleme alinan imzalari uret calisir.
 * 3) Script sadece Isleme Al secili satirlar icin:
 *    - eksik random id uretir
 *    - Photoshop TXT dataset uretir
 *    - HTML imza dosyalarini uretir
 *    - GAM komut dosyasi uretir
 *    - satir durumunu "Isleme alindi" yapar
 */

const SIGNATURE_CONFIG = {
  mainSheetName: 'Ana',
  titleSheetName: 'ünvanlar',
  campusSheetName: 'kampüsler',

  // Drive klasorleri. Mevcut folder id'lerinle degistir.
  photoshopDatasetFolderId: '0AL7ooB2qwX6_Uk9PVA',
  htmlFolderId: '1d7y5AGn_fE-PALvzVNYcAT4lxbgltlmt',
  gamCommandFolderId: '1d7y5AGn_fE-PALvzVNYcAT4lxbgltlmt',

  publicBaseUrl: 'https://istek.site/imza',
  gamHtmlRelativeFolder: 'signature',
  idLength: 11,

  photoshopHeaders: ['filename', 'ad', 'unvan', 'ing', 'email', 'adres', 'CampusImage'],
  statusQueued: 'İşleme alındı',
  statusDone: 'Basıldı',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Export Tools')
    .addItem('İşleme alınan imzaları üret', 'processSelectedSignatures')
    .addSeparator()
    .addItem('Sadece Photoshop TXT oluştur', 'exportSelectedRowsAsPhotoshopTXT')
    .addItem('Sadece HTML oluştur', 'generateSelectedHtmlFiles')
    .addToUi();
}

function processSelectedSignatures() {
  const result = buildSignatureOutputs_({
    createPhotoshopDataset: true,
    createHtml: true,
    createGamCommands: true,
    updateSheet: true,
  });

  SpreadsheetApp.getUi().alert(
    'İşlem tamamlandı.\n\n' +
      'İşleme alınan satır: ' + result.count + '\n' +
      'Photoshop TXT: ' + (result.photoshopFileUrl || '-') + '\n' +
      'GAM komut dosyası: ' + (result.gamFileUrl || '-')
  );
}

function exportSelectedRowsAsPhotoshopTXT() {
  const result = buildSignatureOutputs_({
    createPhotoshopDataset: true,
    createHtml: false,
    createGamCommands: false,
    updateSheet: false,
  });

  SpreadsheetApp.getUi().alert(
    'Photoshop TXT oluşturuldu.\n\nSatır: ' + result.count + '\nDosya: ' + result.photoshopFileUrl
  );
}

function generateSelectedHtmlFiles() {
  const result = buildSignatureOutputs_({
    createPhotoshopDataset: false,
    createHtml: true,
    createGamCommands: false,
    updateSheet: false,
  });

  SpreadsheetApp.getUi().alert('HTML dosyaları oluşturuldu.\n\nSatır: ' + result.count);
}

function buildSignatureOutputs_(options) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SIGNATURE_CONFIG.mainSheetName);

  if (!sheet) {
    throw new Error('Ana sayfa bulunamadı: ' + SIGNATURE_CONFIG.mainSheetName);
  }

  const range = sheet.getDataRange();
  const values = range.getValues();

  if (values.length < 2) {
    throw new Error('İşlenecek veri yok.');
  }

  const headers = values[0].map(String);
  const col = buildColumnMap_(headers);
  const titleMap = getTwoColumnMap_(ss, SIGNATURE_CONFIG.titleSheetName);
  const campusMap = getCampusMap_(ss, SIGNATURE_CONFIG.campusSheetName);
  const existingIds = collectExistingIds_(values, col.id);
  const rowsToProcess = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const processFlag = row[col.process];
    const status = getCell_(row, col.status);

    if (!isTruthy_(processFlag)) continue;
    if (status === SIGNATURE_CONFIG.statusDone) continue;

    const campus = getCell_(row, col.campus);
    const email = getCell_(row, col.email);
    const name = getCell_(row, col.name);
    const titleTr = getCell_(row, col.titleTr);

    if (!campus || !email || !name || !titleTr) {
      throw new Error((r + 1) + '. satırda Kampüs, Mail, İsim veya Ünvan eksik.');
    }

    let id = getCell_(row, col.id);
    if (!id) {
      id = makeUniqueId_(existingIds, SIGNATURE_CONFIG.idLength);
      existingIds.add(id);
    }

    const titleEn = getCell_(row, col.titleEn) || titleMap[titleTr] || '';
    const campusInfo = campusMap[campus] || {};
    const address = getCell_(row, col.address) || campusInfo.address || '';
    const campusImage = getCell_(row, col.campusImage) || campusInfo.image || '';
    const imageUrl = SIGNATURE_CONFIG.publicBaseUrl + '/' + id + '/' + id + '.jpg';
    const gamCommand =
      'gam user "' +
      email +
      '" signature file "' +
      SIGNATURE_CONFIG.gamHtmlRelativeFolder +
      '/' +
      id +
      '.html" html';

    rowsToProcess.push({
      sheetRowNumber: r + 1,
      id: id,
      campus: campus,
      email: email,
      name: name,
      titleTr: titleTr,
      titleEn: titleEn,
      address: address,
      campusImage: campusImage,
      imageUrl: imageUrl,
      gamCommand: gamCommand,
    });
  }

  if (rowsToProcess.length === 0) {
    throw new Error('İşleme Al seçili satır bulunamadı.');
  }

  const now = new Date();
  const stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
  const result = { count: rowsToProcess.length };

  if (options.createPhotoshopDataset) {
    result.photoshopFileUrl = createPhotoshopDataset_(rowsToProcess, stamp);
  }

  if (options.createHtml) {
    createHtmlFiles_(rowsToProcess);
  }

  if (options.createGamCommands) {
    result.gamFileUrl = createGamCommandFile_(rowsToProcess, stamp);
  }

  if (options.updateSheet) {
    updateProcessedRows_(sheet, col, rowsToProcess, now);
  }

  return result;
}

function buildColumnMap_(headers) {
  return {
    campus: findHeader_(headers, ['Kampüs', 'Kampus']),
    email: findHeader_(headers, ['Mail', 'Email', 'E-posta']),
    name: findHeader_(headers, ['İsim', 'Isim', 'Ad Soyad']),
    titleTr: findHeader_(headers, ['Ünvan', 'Unvan']),
    titleEn: findHeader_(headers, ['Title', 'Ünvan EN', 'Unvan EN']),
    id: findHeader_(headers, ['url', 'ID', 'Filename', 'Dosya Adı']),
    imageUrl: findHeader_(headers, ['Resim linki', 'Resim Linki', 'Image URL'], false),
    gam: findHeader_(headers, ['GAM', 'GAM Kodu', 'Gam kodu'], false),
    address: findHeader_(headers, ['Adres'], false),
    campusImage: findHeader_(headers, ['CampusImage', 'Kampüs Image', 'Kampus Image', 'Arkaplan'], false),
    process: findHeader_(headers, ['İşleme Al', 'Isleme Al', 'Yayınla', 'Yayinla']),
    status: findHeader_(headers, ['Durum', 'Status']),
    processedAt: findHeader_(headers, ['Son İşlem', 'Son Islem', 'Son İşlem Tarihi', 'Son Islem Tarihi'], false),
  };
}

function findHeader_(headers, aliases, required) {
  const isRequired = required !== false;
  const normalizedHeaders = headers.map(normalizeText_);

  for (let i = 0; i < aliases.length; i++) {
    const wanted = normalizeText_(aliases[i]);
    const index = normalizedHeaders.indexOf(wanted);
    if (index !== -1) return index;
  }

  if (isRequired) {
    throw new Error('Zorunlu kolon bulunamadı: ' + aliases.join(' / '));
  }

  return -1;
}

function normalizeText_(value) {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTwoColumnMap_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sayfa bulunamadı: ' + sheetName);

  const values = sheet.getDataRange().getValues();
  const map = {};

  values.forEach(row => {
    const key = String(row[0] || '').trim();
    const value = String(row[1] || '').trim();
    if (key) map[key] = value;
  });

  return map;
}

function getCampusMap_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sayfa bulunamadı: ' + sheetName);

  const values = sheet.getDataRange().getValues();
  const map = {};

  values.forEach(row => {
    const campus = String(row[0] || '').trim();
    if (!campus) return;

    map[campus] = {
      address: String(row[1] || '').trim(),
      image: String(row[2] || '').trim(),
    };
  });

  return map;
}

function collectExistingIds_(values, idCol) {
  const ids = new Set();

  for (let i = 1; i < values.length; i++) {
    const id = String(values[i][idCol] || '').trim();
    if (id) ids.add(id);
  }

  return ids;
}

function makeUniqueId_(existingIds, length) {
  let id = '';

  do {
    id = makeId_(length);
  } while (existingIds.has(id));

  return id;
}

function makeId_(length) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let output = '';

  for (let i = 0; i < length; i++) {
    output += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return output;
}

function createPhotoshopDataset_(rows, stamp) {
  const folder = DriveApp.getFolderById(SIGNATURE_CONFIG.photoshopDatasetFolderId);
  const contentRows = [
    SIGNATURE_CONFIG.photoshopHeaders,
    ...rows.map(row => [
      row.id,
      row.name,
      row.titleTr,
      row.titleEn,
      row.email,
      row.address,
      row.campusImage,
    ]),
  ];

  const content = contentRows
    .map(row => row.map(formatCellForOutput_).join('\t'))
    .join('\n');

  const file = folder.createFile('Photoshop_Dataset_' + stamp + '.txt', content, MimeType.PLAIN_TEXT);
  return file.getUrl();
}

function createHtmlFiles_(rows) {
  const folder = DriveApp.getFolderById(SIGNATURE_CONFIG.htmlFolderId);

  rows.forEach(row => {
    const fileName = row.id + '.html';
    trashFilesByName_(folder, fileName);

    const htmlContent =
      '<!doctype html>\n' +
      '<html>\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<title>signature</title>\n' +
      '</head>\n' +
      '<body>\n' +
      '<img src="' +
      row.imageUrl +
      '" width="568" style="width: 568px; max-width: 100%; height: auto; border: 0; display: block;">\n' +
      '</body>\n' +
      '</html>';

    folder.createFile(fileName, htmlContent, MimeType.HTML);
  });
}

function createGamCommandFile_(rows, stamp) {
  const folder = DriveApp.getFolderById(SIGNATURE_CONFIG.gamCommandFolderId);
  const fileName = 'gam_imza_' + stamp + '.cmd';
  const commands = [
    '@echo off',
    'setlocal',
    'cd /d C:\\GAMWork',
    '',
    ...rows.map(row => row.gamCommand),
    '',
    'echo.',
    'echo Imza islemi tamamlandi.',
    'exit /b %ERRORLEVEL%',
  ];

  trashFilesByName_(folder, fileName);
  const file = folder.createFile(fileName, commands.join('\r\n'), MimeType.PLAIN_TEXT);
  return file.getUrl();
}

function updateProcessedRows_(sheet, col, rows, now) {
  rows.forEach(row => {
    const r = row.sheetRowNumber;

    sheet.getRange(r, col.id + 1).setValue(row.id);
    if (col.titleEn !== -1) sheet.getRange(r, col.titleEn + 1).setValue(row.titleEn);
    if (col.imageUrl !== -1) sheet.getRange(r, col.imageUrl + 1).setValue(row.imageUrl);
    if (col.gam !== -1) sheet.getRange(r, col.gam + 1).setValue(row.gamCommand);
    if (col.address !== -1) sheet.getRange(r, col.address + 1).setValue(row.address);
    if (col.campusImage !== -1) sheet.getRange(r, col.campusImage + 1).setValue(row.campusImage);
    if (col.process !== -1) sheet.getRange(r, col.process + 1).setValue(false);
    if (col.status !== -1) sheet.getRange(r, col.status + 1).setValue(SIGNATURE_CONFIG.statusQueued);
    if (col.processedAt !== -1) sheet.getRange(r, col.processedAt + 1).setValue(now);
  });
}

function trashFilesByName_(folder, fileName) {
  const files = folder.getFilesByName(fileName);

  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

function formatCellForOutput_(cellData) {
  let cell = cellData === null || cellData === undefined ? '' : cellData.toString();

  if (cell.includes('\t') || cell.includes('"') || cell.includes('\n')) {
    cell = cell.replace(/"/g, '""');
    return '"' + cell + '"';
  }

  return cell;
}

function getCell_(row, index) {
  if (index === -1) return '';
  return String(row[index] || '').trim();
}

function isTruthy_(value) {
  return value === true || String(value).toLocaleLowerCase('tr').trim() === 'evet';
}
