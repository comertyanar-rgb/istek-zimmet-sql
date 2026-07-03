// ==========================================
// ISTEK Demirbas / Zimmet Backend
// Google Apps Script - GLPI entegrasyonlu ve ŞIK PDF TASARIMLI tam surum
// ==========================================

var GOOGLE_CLIENT_ID = '333289043957-05l0hq2r1aqafnclifl9dnvipkr99ba5.apps.googleusercontent.com';
var ROOT_FOLDER_ID = '0ACnbZT1gvSJtUk9PVA';
var SIGNATURE_CONFIG = {
  titleSheetNames: ['ünvanlar', 'Ünvanlar', 'Unvanlar', 'Imza_Unvanlar', 'İmza_Unvanlar'],
  campusSheetNames: ['kampüsler', 'Kampüsler', 'Kampusler', 'Kampüs', 'Kampus'],
  photoshopDatasetFolderId: '0AL7ooB2qwX6_Uk9PVA',
  htmlFolderId: '1d7y5AGn_fE-PALvzVNYcAT4lxbgltlmt',
  gamCommandFolderId: '1d7y5AGn_fE-PALvzVNYcAT4lxbgltlmt',
  publicBaseUrl: 'https://istek.site/imza',
  gamHtmlRelativeFolder: 'signature',
  idLength: 11,
  photoshopHeaders: ['filename', 'ad', 'unvan', 'ing', 'email', 'adres', 'CampusImage'],
  statusQueued: 'İşleme alındı',
  statusDone: 'Basıldı',
  templateVariants: {
    normal: '',
    compact: '_compact',
    small: '_small',
    tiny: '_tiny'
  }
};

// ==========================================
// JSON / TABLE HELPERS
// ==========================================

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function normalizeIdArray(ids) {
  if (!ids || !ids.length) return [];
  var seen = {};
  var out = [];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i] === null || ids[i] === undefined ? "" : ids[i].toString().trim();
    if (id && !seen[id]) {
      seen[id] = true;
      out.push(id);
    }
  }
  return out;
}

function normalizeHeaderKey_(value) {
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

function getHeaderIndex(headers, names) {
  for (var i = 0; i < names.length; i++) {
    for (var j = 0; j < headers.length; j++) {
      if (String(headers[j] || '').trim() === names[i]) return j;
    }
  }

  var normalizedHeaders = headers.map(normalizeHeaderKey_);
  for (var n = 0; n < names.length; n++) {
    var wanted = normalizeHeaderKey_(names[n]);
    var idx = normalizedHeaders.indexOf(wanted);
    if (idx > -1) return idx;
  }
  return -1;
}

function requireHeader(headers, names, label) {
  var idx = getHeaderIndex(headers, names);
  if (idx === -1) throw new Error("Eksik kolon: " + (label || names.join("/")));
  return idx;
}

function readSheetTable(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error("Sayfa bulunamadı: " + sheetName);
  var values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) throw new Error(sheetName + " sayfası boş.");
  return { sheet: sheet, values: values, headers: values[0] };
}

function ensureColumn_(sheet, headers, name) {
  var idx = getHeaderIndex(headers, [name]);
  if (idx > -1) return idx;

  var newCol = headers.length + 1;
  sheet.getRange(1, newCol).setValue(name);
  headers.push(name);
  return headers.length - 1;
}

function parseHistory(raw) {
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// ==========================================
// NORMALIZATION / SECURITY HELPERS
// ==========================================

function getCoreNameStr(str) {
  if (!str) return '';
  return str.toString().toLowerCase()
    .replace(/kampüsü/g, '')
    .replace(/kampusu/g, '')
    .replace(/kampüs/g, '')
    .replace(/kampus/g, '')
    .trim();
}

function cleanCampusName(c) {
  if (!c) return "";
  var cc = c.toString().toLowerCase()
    .replace(/kampüsü/g, "")
    .replace(/kampusu/g, "")
    .replace(/kampüs/g, "")
    .replace(/kampus/g, "")
    .trim();
  var words = cc.split(" ");
  for (var i = 0; i < words.length; i++) {
    if (words[i]) words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase();
  }
  return words.join(" ") + " Kampüsü";
}

// YENİ EKLENEN FONKSİYON: Veritabanına sadece "Acıbadem" gibi kök ismi kaydeder (Filtrelerin bozulmaması için)
function getShortCampusName(c) {
  if (!c) return "";
  var cc = c.toString().toLowerCase()
    .replace(/kampüsü/g, "")
    .replace(/kampusu/g, "")
    .replace(/kampüs/g, "")
    .replace(/kampus/g, "")
    .trim();
  var words = cc.split(" ");
  for (var i = 0; i < words.length; i++) {
    if (words[i]) words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase();
  }
  return words.join(" ");
}

function normalizeStatus(value) {
  var s = value ? value.toString().trim().toUpperCase() : "";
  s = s.replace(/İ/g, "I");
  if (s === "AKTIF") return "AKTIF";
  if (s === "DEPODA") return "DEPODA";
  if (s === "HURDA") return "HURDA";
  if (s === "TRANSFER") return "TRANSFER";
  return s;
}

function sheetStatusActive_() {
  return "AKTİF";
}

function normalizeKey_(value) {
  return value === null || value === undefined ? "" : value.toString().trim().toLowerCase();
}

function normalizeSerialKey_(value) {
  return normalizeKey_(value).replace(/\s+/g, "");
}

function normalizeComputerNameKey_(value) {
  return normalizeKey_(value).replace(/\s+/g, "");
}

function normalizeAdLogin_(value) {
  var s = normalizeKey_(value);
  if (!s) return "";
  if (s.indexOf("\\") > -1) s = s.split("\\").pop();
  if (s.indexOf("@") > -1) s = s.split("@")[0];
  return s;
}

function normalizePhoneNumber_(value) {
  if (!value) return "";
  var phone = value.toString().replace(/\D/g, "");
  if (phone.indexOf("0090") === 0) phone = phone.substring(4);
  if (phone.indexOf("90") === 0 && phone.length === 12) phone = phone.substring(2);
  if (phone.indexOf("0") === 0 && phone.length === 11) phone = phone.substring(1);
  return phone;
}

function validateTrMobilePhone_(value) {
  var phone = normalizePhoneNumber_(value);
  if (!/^5\d{9}$/.test(phone)) {
    throw new Error("Geçersiz telefon numarası. 5 ile başlayan 10 haneli GSM numarası bekleniyor.");
  }
  return phone;
}

function sanitizeExcel(input) {
  if (typeof input !== 'string') return input;
  if (/^[=+\-@]/.test(input)) return "'" + input;
  return input;
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeFileName(name, fallback) {
  var safe = (name || fallback || "belge.pdf").toString();
  return safe.replace(/[\/\\?%*:|"<>]/g, "-");
}

function stripDataUrlBase64_(value) {
  if (!value || typeof value !== "string") return value;
  var comma = value.indexOf(",");
  if (value.indexOf("base64,") > -1 && comma > -1) return value.substring(comma + 1);
  return value;
}

// IPAD HATASINI ÇÖZEN KISIM (Karakter limiti 2 Milyona çıkarıldı)
function validateSignature(src) {
  if (!src || typeof src !== 'string' || !src.startsWith("data:image/png;base64,")) return false;
  if (src.length > 2000000) return false; 
  return true;
}

function validateUploadedFile(base64Str, fileName) {
  var raw = stripDataUrlBase64_(base64Str);
  if (!raw || typeof raw !== "string") throw new Error("Dosya verisi bulunamadı.");
  if (raw.length > 15000000) throw new Error("Dosya çok büyük. Maksimum 15 MB.");

  var safeName = sanitizeFileName(fileName, "belge.pdf");
  var lower = safeName.toLowerCase();
  var isPdf = lower.endsWith(".pdf");
  var isPng = lower.endsWith(".png");
  var isJpg = lower.endsWith(".jpg") || lower.endsWith(".jpeg");
  if (!isPdf && !isPng && !isJpg) throw new Error("Sadece PDF/JPG/PNG yüklenebilir.");

  var bytes = Utilities.base64Decode(raw);
  if (bytes.length < 4) throw new Error("Dosya geçersiz.");

  if (isPdf && !(bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) {
    throw new Error("PDF dosya imzası geçersiz.");
  }
  if (isPng && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) {
    throw new Error("PNG dosya imzası geçersiz.");
  }
  if (isJpg && !(bytes[0] === 255 && bytes[1] === 216)) {
    throw new Error("JPEG dosya imzası geçersiz.");
  }

  return {
    bytes: bytes,
    fileName: safeName,
    mimeType: isPdf ? "application/pdf" : (isPng ? "image/png" : "image/jpeg")
  };
}

var MOBILDEV_SMS_API_URL = "https://xmlapi.mobildev.com/";

function sendSmsViaMobildev(recipientPhoneNumber, messageText) {
  var scriptProperties = PropertiesService.getScriptProperties();
  var apiKey = scriptProperties.getProperty("MOBILDEV_API_KEY");
  var apiSecret = scriptProperties.getProperty("MOBILDEV_API_SECRET");
  var originator = scriptProperties.getProperty("MOBILDEV_ORIGINATOR");
  if (!apiKey || !apiSecret) throw new Error("Mobildev API bilgileri eksik.");
  if (!recipientPhoneNumber || !messageText) throw new Error("SMS için telefon veya mesaj boş.");

  var finalPhoneNumber = validateTrMobilePhone_(recipientPhoneNumber);
  var xmlPayload = [
    "<MainmsgBody>",
    "<UserName>" + apiKey + "</UserName>",
    "<PassWord>" + apiSecret + "</PassWord>",
    "<Action>1</Action>",
    "<Messages><Message>",
    "<Mesgbody><![CDATA[" + messageText + "]]></Mesgbody>",
    "<Number>" + finalPhoneNumber + "</Number>",
    "</Message></Messages>",
    originator ? "<Originator>" + originator + "</Originator>" : "",
    "<Blacklist>1</Blacklist>",
    "<Encoding>1</Encoding>",
    "<MessageType>N</MessageType>",
    "</MainmsgBody>"
  ].join("");

  var response = UrlFetchApp.fetch(MOBILDEV_SMS_API_URL, {
    method: "post",
    contentType: "application/xml; charset=utf-8",
    payload: xmlPayload,
    muteHttpExceptions: true
  });
  var responseCode = response.getResponseCode();
  var responseBody = response.getContentText().trim();
  if (responseCode >= 200 && responseCode < 300 && /^\s*(ID\s*:\s*)?\d+\s*$/i.test(responseBody)) {
    return true;
  }
  throw new Error("Mobildev SMS gönderimi başarısız: " + responseCode + " / " + responseBody);
}

function updatePersonPhone_(ss, personId, phoneNumber) {
  var phone = validateTrMobilePhone_(phoneNumber);
  var table = readSheetTable(ss, "Kullanıcılar");
  var sheet = table.sheet;
  var headers = table.headers;
  var idCol = requireHeader(headers, ["User Id", "Email", "E-Posta", "Kullanıcı"], "Personel ID");
  var phoneCol = ensureColumn_(sheet, headers, "Telefon");

  for (var r = 1; r < table.values.length; r++) {
    if (table.values[r][idCol] && table.values[r][idCol].toString().trim() === personId.toString().trim()) {
      sheet.getRange(r + 1, phoneCol + 1).setValue(phone);
      return phone;
    }
  }
  throw new Error("Telefon kaydedilecek personel bulunamadı.");
}

function generateSHA256Hash(textOrBlob) {
  var bytes = typeof textOrBlob === 'string' ? Utilities.newBlob(textOrBlob).getBytes() : textOrBlob.getBytes();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  var hexString = '';
  for (var i = 0; i < digest.length; i++) {
    var byteStr = (digest[i] < 0 ? digest[i] + 256 : digest[i]).toString(16);
    hexString += byteStr.length === 1 ? '0' + byteStr : byteStr;
  }
  return hexString.toUpperCase();
}

function getOrCreateCampusFolder(rootFolderId, campus) {
  var root = DriveApp.getFolderById(rootFolderId);
  var folderName = cleanCampusName(campus || "Bilinmiyor");
  var iter = root.getFoldersByName(folderName);
  return iter.hasNext() ? iter.next() : root.createFolder(folderName);
}

function assertUserCanAccessCampus(verifiedUser, campus, message) {
  if (verifiedUser.role === "HQ IT") return;
  if (getCoreNameStr(campus) !== getCoreNameStr(verifiedUser.campus)) {
    throw new Error(message || ("Yetkisiz kampüs: " + campus));
  }
}

// ==========================================
// AUTH / LOGGING
// ==========================================

function getAuthorizedUsers(ss) {
  var sheetName = "Yetkili_IT";
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(["E-Posta", "Rol", "Kampüs"]);
    sheet.setFrozenRows(1);
  }

  var users = {};
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var email = data[i][0] ? data[i][0].toString().trim().toLowerCase() : "";
    if (email !== "") {
      users[email] = {
        role: data[i][1] ? data[i][1].toString().trim() : "IT",
        campus: data[i][2] ? data[i][2].toString().trim() : "Bilinmiyor"
      };
    }
  }
  return users;
}

function appendSecureLog(ss, actionType, executedBy, details, fileHash, driveLink, ipAgent) {
  var logSheet = ss.getSheetByName("Sistem_Loglari");
  if (!logSheet) {
    logSheet = ss.insertSheet("Sistem_Loglari");
    logSheet.appendRow(["Tarih/Saat", "İşlemi Yapan", "İşlem Tipi", "Detay", "Dosya Hash", "Drive Linki", "ZİNCİR HASH (SHA-256)", "İstemci Verisi"]);
    logSheet.setFrozenRows(1);
  }

  var timeStr = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
  var lastRow = logSheet.getLastRow();
  var prevHash = lastRow > 1 ? logSheet.getRange(lastRow, 7).getValue().toString() : "GENESIS";
  var dataToHash = prevHash + "|" + timeStr + "|" + executedBy + "|" + actionType + "|" + details + "|" + fileHash;
  var chainHash = generateSHA256Hash(dataToHash);
  logSheet.appendRow([timeStr, executedBy, actionType, details, fileHash, driveLink, chainHash, ipAgent || "-"]);
}

// ==========================================
// BACKGROUND OPERATION QUEUE
// ==========================================

function getQueueHeaders_() {
  return [
    "Queue ID",
    "Olusturma Zamani",
    "Planlanan Zaman",
    "Baslama Zamani",
    "Bitis Zamani",
    "Durum",
    "Oncelik",
    "Islem Tipi",
    "Islemi Yapan",
    "Kampus",
    "Payload JSON",
    "Sonuc JSON",
    "Hata",
    "Deneme",
    "Son Guncelleme"
  ];
}

function ensureQueueSheet_(ss) {
  var sheet = ss.getSheetByName("Islem_Kuyrugu");
  var headers = getQueueHeaders_();
  if (!sheet) {
    sheet = ss.insertSheet("Islem_Kuyrugu");
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenRows(1);
  }
  return { sheet: sheet, headers: headers };
}

function createQueueId_() {
  return "Q-" + Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().substring(0, 8).toUpperCase();
}

function enqueueOperation_(ss, queuedAction, payload, sessionEmail, verifiedUser, options) {
  options = options || {};
  var table = ensureQueueSheet_(ss);
  var now = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
  var queueId = createQueueId_();
  var safeUser = {
    email: sessionEmail || "Sistem",
    role: verifiedUser && verifiedUser.role ? verifiedUser.role : "",
    campus: verifiedUser && verifiedUser.campus ? verifiedUser.campus : ""
  };
  var queuePayload = {
    action: queuedAction,
    data: payload || {},
    user: safeUser
  };

  table.sheet.appendRow([
    queueId,
    now,
    options.runAt || "",
    "",
    "",
    "BEKLIYOR",
    options.priority || 5,
    queuedAction,
    safeUser.email,
    safeUser.campus,
    JSON.stringify(queuePayload),
    "",
    "",
    0,
    now
  ]);

  return { queueId: queueId, status: "BEKLIYOR" };
}

function enqueueOperationRoute_(data, verifiedUser, sessionEmail) {
  var queuedAction = data.queuedAction || data.operation || "";
  if (queuedAction !== "reconcileGLPI") {
    throw new Error("Bu islem kuyruga alinamaz: " + queuedAction);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queued = enqueueOperation_(
    ss,
    queuedAction,
    data.payload || {},
    sessionEmail,
    verifiedUser,
    { priority: data.priority || 5, runAt: data.runAt || "" }
  );
  return jsonOut({ success: true, queued: true, queueId: queued.queueId, status: queued.status });
}

function fetchOperationQueue_(data, verifiedUser, sessionEmail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var table = ensureQueueSheet_(ss);
  var values = table.sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = requireHeader(headers, ["Queue ID"]);
  var createdCol = requireHeader(headers, ["Olusturma Zamani"]);
  var startCol = requireHeader(headers, ["Baslama Zamani"]);
  var endCol = requireHeader(headers, ["Bitis Zamani"]);
  var statusCol = requireHeader(headers, ["Durum"]);
  var actionCol = requireHeader(headers, ["Islem Tipi"]);
  var byCol = requireHeader(headers, ["Islemi Yapan"]);
  var campusCol = requireHeader(headers, ["Kampus"]);
  var resultCol = requireHeader(headers, ["Sonuc JSON"]);
  var errorCol = requireHeader(headers, ["Hata"]);
  var attemptCol = requireHeader(headers, ["Deneme"]);
  var updatedCol = requireHeader(headers, ["Son Guncelleme"]);
  var queueIds = normalizeIdArray(data.queueIds);
  var queueIdMap = {};
  for (var q = 0; q < queueIds.length; q++) queueIdMap[queueIds[q]] = true;
  var limit = Math.min(Math.max(Number(data.limit || 25), 1), 100);
  var jobs = [];

  for (var r = values.length - 1; r >= 1 && jobs.length < limit; r--) {
    var row = values[r];
    var queueId = row[idCol] ? row[idCol].toString() : "";
    if (queueIds.length && !queueIdMap[queueId]) continue;

    var executedBy = row[byCol] ? row[byCol].toString() : "";
    var campus = row[campusCol] ? row[campusCol].toString() : "";
    if (verifiedUser.role !== "HQ IT" && executedBy !== sessionEmail && getCoreNameStr(campus) !== getCoreNameStr(verifiedUser.campus)) {
      continue;
    }

    jobs.push({
      queueId: queueId,
      createdAt: row[createdCol] || "",
      startedAt: row[startCol] || "",
      finishedAt: row[endCol] || "",
      status: row[statusCol] || "",
      action: row[actionCol] || "",
      executedBy: executedBy,
      campus: campus,
      result: row[resultCol] || "",
      error: row[errorCol] || "",
      attempts: row[attemptCol] || 0,
      updatedAt: row[updatedCol] || ""
    });
  }

  return jsonOut({ success: true, jobs: jobs });
}

function executeQueuedOperation_(queuePayload) {
  var action = queuePayload.action;
  if (action === "reconcileGLPI") {
    return reconcileGLPIWithLaptoplar_();
  }
  throw new Error("Desteklenmeyen kuyruk islemi: " + action);
}

function processQueuedOperations_(maxJobs) {
  maxJobs = Math.min(Math.max(Number(maxJobs || 5), 1), 20);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return { success: true, skipped: true, reason: "Sistem baska bir yazma islemi yapiyor." };
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var table = ensureQueueSheet_(ss);
    var sheet = table.sheet;
    var values = sheet.getDataRange().getValues();
    if (values.length <= 1) return { success: true, processed: 0 };

    var headers = values[0];
    var idCol = requireHeader(headers, ["Queue ID"]);
    var startCol = requireHeader(headers, ["Baslama Zamani"]);
    var endCol = requireHeader(headers, ["Bitis Zamani"]);
    var statusCol = requireHeader(headers, ["Durum"]);
    var actionCol = requireHeader(headers, ["Islem Tipi"]);
    var payloadCol = requireHeader(headers, ["Payload JSON"]);
    var resultCol = requireHeader(headers, ["Sonuc JSON"]);
    var errorCol = requireHeader(headers, ["Hata"]);
    var attemptCol = requireHeader(headers, ["Deneme"]);
    var updatedCol = requireHeader(headers, ["Son Guncelleme"]);
    var processed = 0;

    for (var r = 1; r < values.length && processed < maxJobs; r++) {
      var row = values[r];
      if (row[statusCol] !== "BEKLIYOR") continue;

      var rowNumber = r + 1;
      var attempts = Number(row[attemptCol] || 0) + 1;
      var startTime = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
      sheet.getRange(rowNumber, statusCol + 1).setValue("ISLENIYOR");
      sheet.getRange(rowNumber, startCol + 1).setValue(startTime);
      sheet.getRange(rowNumber, attemptCol + 1).setValue(attempts);
      sheet.getRange(rowNumber, updatedCol + 1).setValue(startTime);
      SpreadsheetApp.flush();

      try {
        var queuePayload = JSON.parse(row[payloadCol]);
        var result = executeQueuedOperation_(queuePayload);
        var finishTime = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
        sheet.getRange(rowNumber, statusCol + 1).setValue("TAMAMLANDI");
        sheet.getRange(rowNumber, endCol + 1).setValue(finishTime);
        sheet.getRange(rowNumber, resultCol + 1).setValue(JSON.stringify(result || { success: true }));
        sheet.getRange(rowNumber, errorCol + 1).setValue("");
        sheet.getRange(rowNumber, updatedCol + 1).setValue(finishTime);
        appendSecureLog(ss, "QUEUE OK", "Islem_Kuyrugu", row[actionCol] + " / " + row[idCol], "-", "-", "-");
      } catch (jobErr) {
        var errorTime = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
        sheet.getRange(rowNumber, statusCol + 1).setValue("HATA");
        sheet.getRange(rowNumber, endCol + 1).setValue(errorTime);
        sheet.getRange(rowNumber, errorCol + 1).setValue(jobErr.message);
        sheet.getRange(rowNumber, updatedCol + 1).setValue(errorTime);
        appendSecureLog(ss, "QUEUE HATA", "Islem_Kuyrugu", row[actionCol] + " / " + row[idCol] + " / " + jobErr.message, "-", "-", "-");
      }
      processed++;
    }

    return { success: true, processed: processed };
  } finally {
    lock.releaseLock();
  }
}

function processIslemKuyrugu() {
  return processQueuedOperations_(5);
}

function installIslemKuyruguTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processIslemKuyrugu") {
      return "Islem_Kuyrugu tetikleyicisi zaten var.";
    }
  }
  ScriptApp.newTrigger("processIslemKuyrugu").timeBased().everyMinutes(1).create();
  return "Islem_Kuyrugu tetikleyicisi kuruldu.";
}

function runOperationQueue_(data, verifiedUser) {
  if (verifiedUser.role !== "HQ IT") throw new Error("Islem kuyrugunu sadece HQ IT manuel calistirabilir.");
  return jsonOut(processQueuedOperations_(data.maxJobs || 5));
}

function ensureInventoryScanSheet_(ss) {
  var sheet = ss.getSheetByName("Sayim_Loglari");
  var headers = [
    "Tarih/Saat",
    "Islemi Yapan",
    "Kampus",
    "Seri no",
    "Bilgisayar Ismi",
    "Marka",
    "Model",
    "Cihaz Tipi",
    "Cihaz Durumu",
    "Zimmetli Kullanici",
    "QR Payload",
    "IP / Istemci",
    "Not"
  ];

  if (!sheet) {
    sheet = ss.insertSheet("Sayim_Loglari");
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function recordInventoryScan_(data, verifiedUser, sessionEmail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hwTable = readSheetTable(ss, "Laptoplar");
  var hwRows = findHardwareRows(hwTable, [data.hardwareId], verifiedUser);
  var hw = hwRows[0];
  var row = hwTable.values[hw.rowIdx];
  var headers = hwTable.headers;

  var pcCol = getHeaderIndex(headers, ["Bilgisayar Ismi", "Bilgisayar İsmi"]);
  var statusCol = requireHeader(headers, ["Cihaz Durumu"], "Cihaz Durumu");
  var userCol = requireHeader(headers, ["Kullanıcı", "Kullanici"], "Kullanıcı");

  var timeStr = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
  var scanSheet = ensureInventoryScanSheet_(ss);
  scanSheet.appendRow([
    timeStr,
    sessionEmail,
    hw.campus,
    hw.serial,
    pcCol > -1 && row[pcCol] ? row[pcCol].toString() : "",
    hw.brand,
    hw.model,
    hw.type,
    row[statusCol] ? row[statusCol].toString() : "",
    row[userCol] ? row[userCol].toString() : "",
    data.qrPayload || "",
    data.clientIp || "",
    data.note || "QR sayim"
  ]);

  appendSecureLog(ss, "QR SAYIM", sessionEmail, "S/N: " + hw.serial, "-", "-", data.clientIp || "-");
  return jsonOut({ success: true, scannedAt: timeStr });
}

// ==========================================
// DOMAIN LOOKUPS
// ==========================================

function findHardwareRows(table, ids, verifiedUser, options) {
  options = options || {};
  ids = normalizeIdArray(ids);
  if (ids.length === 0) throw new Error("Cihaz seçimi boş.");

  var headers = table.headers;
  var seriCol = requireHeader(headers, ["Seri no"], "Seri no");
  var campusCol = requireHeader(headers, ["Kampüs", "Kampus"], "Kampüs");
  var statusCol = requireHeader(headers, ["Cihaz Durumu"], "Cihaz Durumu");
  var userCol = requireHeader(headers, ["Kullanıcı", "Kullanici"], "Kullanıcı");
  var typeCol = requireHeader(headers, ["Cihaz Tipi"]);
  var brandCol = requireHeader(headers, ["Marka"]);
  var modelCol = requireHeader(headers, ["Modeli"]);

  var wanted = {};
  for (var i = 0; i < ids.length; i++) wanted[ids[i]] = true;

  var rows = [];
  for (var r = 1; r < table.values.length; r++) {
    var serial = table.values[r][seriCol] ? table.values[r][seriCol].toString().trim() : "";
    if (!wanted[serial]) continue;

    var campus = table.values[r][campusCol] ? table.values[r][campusCol].toString().trim() : "";
    var status = normalizeStatus(table.values[r][statusCol]);
    var assignedTo = table.values[r][userCol] ? table.values[r][userCol].toString().trim() : "";

    if (!options.skipCampusCheck) {
      assertUserCanAccessCampus(verifiedUser, campus, "Yetkisiz kampüs cihazı: " + serial);
    }

    if (options.requireStatus && status !== options.requireStatus) {
      throw new Error(serial + " için beklenen durum " + options.requireStatus + ", mevcut durum " + status);
    }

    rows.push({
      rowIdx: r,
      serial: serial,
      campus: campus,
      status: status,
      assignedTo: assignedTo,
      type: table.values[r][typeCol] ? table.values[r][typeCol].toString() : "Cihaz",
      brand: table.values[r][brandCol] ? table.values[r][brandCol].toString() : "",
      model: table.values[r][modelCol] ? table.values[r][modelCol].toString() : ""
    });
  }

  if (rows.length !== ids.length) {
    throw new Error("İstenen cihazlardan bazıları veritabanında bulunamadı veya yetkiniz yok.");
  }
  return rows;
}

function getPersonDetails(ss, personId) {
  var usTable = readSheetTable(ss, "Kullanıcılar");
  var idCol = requireHeader(usTable.headers, ["User Id", "Email", "E-Posta", "Kullanıcı"], "Personel ID");
  var nameCol = requireHeader(usTable.headers, ["Ad Soyad", "Adı Soyadı", "Kullanıcı"]);
  var deptCol = getHeaderIndex(usTable.headers, ["Department", "Departman", "Görev", "Ünvan"]);
  var emailCol = getHeaderIndex(usTable.headers, ["Email", "E-Posta"]);
  var campusCol = getHeaderIndex(usTable.headers, ["Kampüs", "Okul"]);
  var adCol = getHeaderIndex(usTable.headers, ["AD Kullanıcı", "AD Kullanici", "AD User", "SamAccountName"]);
  var phoneCol = getHeaderIndex(usTable.headers, ["Telefon", "Phone", "Cep Telefonu", "GSM"]);
  var signatureLinkCol = getHeaderIndex(usTable.headers, ["İmza Linki", "Imza Linki", "Signature Link"]);
  var signatureIdCol = getHeaderIndex(usTable.headers, ["İmza ID", "Imza ID", "Signature ID"]);
  var signatureStatusCol = getHeaderIndex(usTable.headers, ["İmza Durumu", "Imza Durumu", "Signature Status"]);
  var signatureCampusCol = getHeaderIndex(usTable.headers, ["İmza Kampüsü", "Imza Kampusu", "Signature Campus"]);
  var signatureTemplateCol = getHeaderIndex(usTable.headers, ["İmza Şablonu", "Imza Sablonu", "Signature Template"]);
  var signatureUpdatedCol = getHeaderIndex(usTable.headers, ["İmza Son İşlem", "Imza Son Islem", "Signature Last Run"]);

  for (var r = 1; r < usTable.values.length; r++) {
    if (usTable.values[r][idCol] && usTable.values[r][idCol].toString().trim() === personId.toString().trim()) {
      var signatureLink = signatureLinkCol > -1 ? usTable.values[r][signatureLinkCol].toString().trim() : "";
      return {
        id: personId,
        name: usTable.values[r][nameCol].toString().trim(),
        department: deptCol > -1 ? usTable.values[r][deptCol].toString().trim() : "Personel",
        email: emailCol > -1 ? usTable.values[r][emailCol].toString().trim().toLowerCase() : "",
        campus: campusCol > -1 ? usTable.values[r][campusCol].toString().trim() : "",
        adUser: adCol > -1 ? normalizeAdLogin_(usTable.values[r][adCol]) : "",
        phone: phoneCol > -1 && usTable.values[r][phoneCol] ? normalizePhoneNumber_(usTable.values[r][phoneCol]) : "",
        rowIdx: r,
        signatureLink: signatureLink,
        signatureId: signatureIdCol > -1 ? usTable.values[r][signatureIdCol].toString().trim() : "",
        signatureStatus: signatureStatusCol > -1 ? usTable.values[r][signatureStatusCol].toString().trim() : "",
        signatureCampus: signatureCampusCol > -1 ? usTable.values[r][signatureCampusCol].toString().trim() : "",
        signatureTemplateVariant: signatureTemplateCol > -1 ? usTable.values[r][signatureTemplateCol].toString().trim() : "",
        signatureUpdatedAt: signatureUpdatedCol > -1 ? usTable.values[r][signatureUpdatedCol].toString().trim() : "",
        signatureMissing: !signatureLink
      };
    }
  }
  throw new Error("Personel veritabanında bulunamadı.");
}

// ==========================================
// E-POSTA İMZA OTOMASYONU HELPERS
// ==========================================

function normalizeSignatureText_(value) {
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

function getSheetByAnyName_(ss, names) {
  for (var i = 0; i < names.length; i++) {
    var sheet = ss.getSheetByName(names[i]);
    if (sheet) return sheet;
  }
  return null;
}

function getSignatureTitleOptions_(ss) {
  var sheet = getSheetByAnyName_(ss, SIGNATURE_CONFIG.titleSheetNames);
  if (!sheet) throw new Error("İmza ünvan sayfası bulunamadı. Beklenen ad: ünvanlar");

  var values = sheet.getDataRange().getValues();
  var titles = [];
  var seen = {};

  for (var r = 0; r < values.length; r++) {
    var titleTr = values[r][0] ? values[r][0].toString().trim() : "";
    var titleEn = values[r][1] ? values[r][1].toString().trim() : "";
    var templateKey = values[r][2] ? normalizeSignatureTemplateKey_(values[r][2]) : "";
    var norm = normalizeSignatureText_(titleTr);
    if (!titleTr || norm === "unvan" || norm === "turkce unvan" || seen[norm]) continue;

    seen[norm] = true;
    titles.push({ titleTr: titleTr, titleEn: titleEn, templateKey: templateKey });
  }

  titles.sort(function(a, b) {
    return a.titleTr.localeCompare(b.titleTr, 'tr');
  });
  return titles;
}

function findSignatureTitle_(ss, selectedTitle) {
  var normSelected = normalizeSignatureText_(selectedTitle);
  var titles = getSignatureTitleOptions_(ss);
  for (var i = 0; i < titles.length; i++) {
    if (normalizeSignatureText_(titles[i].titleTr) === normSelected) return titles[i];
  }
  throw new Error("Seçilen ünvan, ünvanlar sayfasında bulunamadı: " + selectedTitle);
}

function getSignatureCampusCore_(campus) {
  return normalizeSignatureText_(getCoreNameStr(campus));
}

function canChooseSignatureCampus_(verifiedUser) {
  if (!verifiedUser) return false;
  if (verifiedUser.role === "HQ IT") return true;
  return getSignatureCampusCore_(verifiedUser.campus) === "genel mudurluk";
}

function getSignatureCampusRows_(ss) {
  var sheet = getSheetByAnyName_(ss, SIGNATURE_CONFIG.campusSheetNames);
  if (!sheet) throw new Error("İmza kampüs sayfası bulunamadı. Beklenen ad: kampüsler");

  var values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) throw new Error("İmza kampüs sayfası boş.");

  var headers = values[0].map(function(h) { return h ? h.toString().trim() : ""; });
  var campusCol = getHeaderIndex(headers, ["Kampüs", "Kampus", "Campus"]);
  var addressCol = getHeaderIndex(headers, ["Adres", "Adresi", "Address"]);
  var imageCol = getHeaderIndex(headers, ["CampusImage", "Kampüs Image", "Kampus Image", "Arkaplan"]);
  var firstDataRow = 1;

  // Eski imza otomasyonu formatı: A=Kampüs, B=Adres, C=CampusImage
  if (campusCol === -1) {
    campusCol = 0;
    addressCol = addressCol > -1 ? addressCol : 1;
    imageCol = imageCol > -1 ? imageCol : 2;
    firstDataRow = 0;
  }

  var rows = [];
  var seen = {};
  for (var r = firstDataRow; r < values.length; r++) {
    var rowCampus = values[r][campusCol] ? values[r][campusCol].toString().trim() : "";
    if (!rowCampus || normalizeSignatureText_(rowCampus) === "kampus") continue;
    var core = getSignatureCampusCore_(rowCampus);
    if (seen[core]) continue;
    seen[core] = true;
    rows.push({
      campus: rowCampus,
      address: addressCol > -1 && values[r][addressCol] ? values[r][addressCol].toString().trim() : "",
      image: imageCol > -1 && values[r][imageCol] ? values[r][imageCol].toString().trim() : ""
    });
  }

  rows.sort(function(a, b) {
    return a.campus.localeCompare(b.campus, 'tr');
  });
  return rows;
}

function getSignatureCampusInfo_(ss, campus) {
  var rows = getSignatureCampusRows_(ss);
  var campusCore = getSignatureCampusCore_(campus);
  for (var r = 0; r < rows.length; r++) {
    if (getSignatureCampusCore_(rows[r].campus) === campusCore) return rows[r];
  }
  throw new Error("İmza için kampüs bilgisi bulunamadı: " + campus + " (kampüsler sayfasını kontrol edin)");
}

function getSignatureCampusOptions_(ss, verifiedUser) {
  var rows = getSignatureCampusRows_(ss);
  var canChooseAll = canChooseSignatureCampus_(verifiedUser);
  var userCampusCore = getSignatureCampusCore_(verifiedUser && verifiedUser.campus);
  return rows
    .filter(function(row) {
      return canChooseAll || getSignatureCampusCore_(row.campus) === userCampusCore;
    })
    .map(function(row) {
      return {
        campus: row.campus,
        address: row.address,
        hasImage: !!row.image
      };
    });
}

function normalizeSignatureTemplateKey_(value) {
  var key = String(value || '').trim();
  if (!key) return "";
  key = key.replace(/^imza-template-/i, "");
  key = key.replace(/^template-/i, "");
  key = key.replace(/^tpl/i, "");
  key = key.replace(/[^a-zA-Z0-9_-]/g, "");
  return key;
}

function getSignatureTemplateVariant_(titleTr, titleEn, explicitTemplateKey) {
  var templateKey = normalizeSignatureTemplateKey_(explicitTemplateKey);
  if (templateKey) return templateKey;

  var tr = String(titleTr || '').replace(/\s+/g, ' ').trim();
  var en = String(titleEn || '').replace(/\s+/g, ' ').trim();
  var maxLen = Math.max(tr.length, en.length);
  var combinedLen = tr.length + en.length;

  if (maxLen > 62 || combinedLen > 118) return "tiny";
  if (maxLen > 48 || combinedLen > 96) return "small";
  if (maxLen > 36 || combinedLen > 76) return "compact";
  return "normal";
}

function getSignatureTemplateSuffix_(variant) {
  var key = String(variant || "normal").toLowerCase();
  if (SIGNATURE_CONFIG.templateVariants[key] !== undefined) return SIGNATURE_CONFIG.templateVariants[key];
  var templateKey = normalizeSignatureTemplateKey_(variant);
  return templateKey ? "_tpl" + templateKey : "";
}

function ensureSignatureUserColumns_(ss) {
  var table = readSheetTable(ss, "Kullanıcılar");
  var headers = table.headers.map(function(h) { return h ? h.toString().trim() : ""; });

  var deptCol = getHeaderIndex(headers, ["Department", "Departman", "Görev", "Ünvan"]);
  if (deptCol === -1) deptCol = ensureColumn_(table.sheet, headers, "Ünvan");

  return {
    table: table,
    headers: headers,
    idCol: requireHeader(headers, ["User Id", "Email", "E-Posta", "Kullanıcı"], "Personel ID"),
    deptCol: deptCol,
    signatureLinkCol: ensureColumn_(table.sheet, headers, "İmza Linki"),
    signatureIdCol: ensureColumn_(table.sheet, headers, "İmza ID"),
    signatureStatusCol: ensureColumn_(table.sheet, headers, "İmza Durumu"),
    signatureTitleEnCol: ensureColumn_(table.sheet, headers, "İmza Ünvan EN"),
    signatureCampusCol: ensureColumn_(table.sheet, headers, "İmza Kampüsü"),
    signatureTemplateCol: ensureColumn_(table.sheet, headers, "İmza Şablonu"),
    signatureLastCol: ensureColumn_(table.sheet, headers, "İmza Son İşlem"),
    signatureGamCol: ensureColumn_(table.sheet, headers, "İmza GAM Komutu")
  };
}

function collectSignatureIds_(values, idCol) {
  var ids = {};
  if (idCol < 0) return ids;
  for (var r = 1; r < values.length; r++) {
    var id = values[r][idCol] ? values[r][idCol].toString().trim() : "";
    if (id) ids[id] = true;
  }
  return ids;
}

function makeSignatureId_(existingIds, length) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = "";
  for (var tries = 0; tries < 200; tries++) {
    id = "";
    for (var i = 0; i < length; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (!existingIds[id]) return id;
  }
  throw new Error("Benzersiz imza ID üretilemedi.");
}

function trashDriveFilesByName_(folder, fileName) {
  var files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

function formatSignatureCell_(cellData) {
  var cell = cellData === null || cellData === undefined ? '' : cellData.toString();
  if (cell.indexOf('\t') > -1 || cell.indexOf('"') > -1 || cell.indexOf('\n') > -1) {
    cell = cell.replace(/"/g, '""');
    return '"' + cell + '"';
  }
  return cell;
}

function createSignatureHtml_(imageUrl) {
  return '<!doctype html>\n' +
    '<html>\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>signature</title>\n' +
    '</head>\n' +
    '<body>\n' +
    '<img src="' + escapeHtml(imageUrl) + '" width="568" style="width: 568px; max-width: 100%; height: auto; border: 0; display: block;">\n' +
    '</body>\n' +
    '</html>';
}

function createSignatureOutputFiles_(row) {
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss') + '_' + row.id + getSignatureTemplateSuffix_(row.templateVariant);
  var datasetFolder = DriveApp.getFolderById(SIGNATURE_CONFIG.photoshopDatasetFolderId);
  var htmlFolder = DriveApp.getFolderById(SIGNATURE_CONFIG.htmlFolderId);
  var commandFolder = DriveApp.getFolderById(SIGNATURE_CONFIG.gamCommandFolderId);

  var datasetRows = [
    SIGNATURE_CONFIG.photoshopHeaders,
    [row.id, row.name, row.titleTr, row.titleEn, row.email, row.address, row.campusImage]
  ];
  var datasetContent = datasetRows
    .map(function(outputRow) {
      return outputRow.map(formatSignatureCell_).join('\t');
    })
    .join('\n');

  var datasetFile = datasetFolder.createFile('Photoshop_Dataset_' + stamp + '.txt', datasetContent, MimeType.PLAIN_TEXT);

  var htmlName = row.id + '.html';
  trashDriveFilesByName_(htmlFolder, htmlName);
  htmlFolder.createFile(htmlName, createSignatureHtml_(row.imageUrl), MimeType.HTML);

  var commandName = 'gam_imza_' + stamp + '.cmd';
  trashDriveFilesByName_(commandFolder, commandName);
  var commandLines = [
    '@echo off',
    'setlocal',
    'cd /d C:\\GAMWork',
    '',
    row.gamCommand,
    '',
    'echo.',
    'echo Imza islemi tamamlandi.',
    'exit /b %ERRORLEVEL%'
  ];
  var commandFile = commandFolder.createFile(commandName, commandLines.join('\r\n'), MimeType.PLAIN_TEXT);

  return {
    datasetUrl: datasetFile.getUrl(),
    gamCommandUrl: commandFile.getUrl()
  };
}

function fetchSignatureMeta_(ss, verifiedUser) {
  var titles = getSignatureTitleOptions_(ss);
  var campuses = getSignatureCampusOptions_(ss, verifiedUser);
  var usersTable = readSheetTable(ss, "Kullanıcılar");
  var headers = usersTable.headers;
  var campusCol = getHeaderIndex(headers, ["Kampüs", "Okul"]);
  var signatureLinkCol = getHeaderIndex(headers, ["İmza Linki", "Imza Linki", "Signature Link"]);
  var missingCount = 0;

  for (var r = 1; r < usersTable.values.length; r++) {
    var campus = campusCol > -1 && usersTable.values[r][campusCol] ? usersTable.values[r][campusCol].toString().trim() : "";
    if (verifiedUser.role !== "HQ IT" && getCoreNameStr(campus) !== getCoreNameStr(verifiedUser.campus)) continue;
    if (signatureLinkCol === -1 || !usersTable.values[r][signatureLinkCol]) missingCount++;
  }

  return jsonOut({
    success: true,
    titles: titles,
    campuses: campuses,
    canChooseCampus: canChooseSignatureCampus_(verifiedUser),
    missingCount: missingCount
  });
}

function createPersonnelSignature_(ss, data, verifiedUser, sessionEmail) {
  if (!data.personId) throw new Error("Personel seçimi boş.");
  if (!data.titleTr) throw new Error("Ünvan seçimi boş.");

  var person = getPersonDetails(ss, data.personId);
  if (!person.email || person.email.indexOf("@") === -1) {
    throw new Error("Personelin geçerli e-posta adresi yok.");
  }
  if (verifiedUser.role !== "HQ IT") {
    assertUserCanAccessCampus(verifiedUser, person.campus, "Farklı kampüs personeline imza oluşturamazsınız.");
  }

  var title = findSignatureTitle_(ss, data.titleTr);
  var requestedSignatureCampus = data.signatureCampus ? data.signatureCampus.toString().trim() : "";
  var signatureCampus = requestedSignatureCampus || person.campus || verifiedUser.campus;
  if (!canChooseSignatureCampus_(verifiedUser)) {
    var allowedSignatureCampus = person.campus || verifiedUser.campus;
    if (requestedSignatureCampus && getSignatureCampusCore_(requestedSignatureCampus) !== getSignatureCampusCore_(allowedSignatureCampus)) {
      throw new Error("Bu personel için farklı imza kampüsü seçemezsiniz.");
    }
    signatureCampus = allowedSignatureCampus;
  }
  var campusInfo = getSignatureCampusInfo_(ss, signatureCampus);
  var templateVariant = getSignatureTemplateVariant_(title.titleTr, title.titleEn, title.templateKey);
  var cols = ensureSignatureUserColumns_(ss);
  var existingIds = collectSignatureIds_(cols.table.values, cols.signatureIdCol);
  var currentId = cols.table.values[person.rowIdx] && cols.table.values[person.rowIdx][cols.signatureIdCol]
    ? cols.table.values[person.rowIdx][cols.signatureIdCol].toString().trim()
    : "";
  var signatureId = currentId || makeSignatureId_(existingIds, SIGNATURE_CONFIG.idLength);
  var imageUrl = SIGNATURE_CONFIG.publicBaseUrl + '/' + signatureId + '/' + signatureId + '.jpg';
  var gamCommand = 'gam user "' + person.email + '" signature file "' + SIGNATURE_CONFIG.gamHtmlRelativeFolder + '/' + signatureId + '.html" html';
  var nowText = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");

  var rowData = {
    id: signatureId,
    name: person.name,
    titleTr: title.titleTr,
    titleEn: title.titleEn,
    email: person.email,
    address: campusInfo.address,
    campusImage: campusInfo.image,
    imageUrl: imageUrl,
    gamCommand: gamCommand,
    templateVariant: templateVariant
  };
  var output = createSignatureOutputFiles_(rowData);
  var rowNumber = person.rowIdx + 1;

  cols.table.sheet.getRange(rowNumber, cols.deptCol + 1).setValue(title.titleTr);
  cols.table.sheet.getRange(rowNumber, cols.signatureLinkCol + 1).setValue(imageUrl);
  cols.table.sheet.getRange(rowNumber, cols.signatureIdCol + 1).setValue(signatureId);
  cols.table.sheet.getRange(rowNumber, cols.signatureStatusCol + 1).setValue(SIGNATURE_CONFIG.statusQueued);
  cols.table.sheet.getRange(rowNumber, cols.signatureTitleEnCol + 1).setValue(title.titleEn);
  cols.table.sheet.getRange(rowNumber, cols.signatureCampusCol + 1).setValue(campusInfo.campus);
  cols.table.sheet.getRange(rowNumber, cols.signatureTemplateCol + 1).setValue(templateVariant);
  cols.table.sheet.getRange(rowNumber, cols.signatureLastCol + 1).setValue(nowText);
  cols.table.sheet.getRange(rowNumber, cols.signatureGamCol + 1).setValue(gamCommand);

  appendSecureLog(
    ss,
    "İMZA OLUŞTUR",
    sessionEmail,
    person.name + " -> " + title.titleTr,
    "-",
    imageUrl,
    data.clientIp || "-"
  );

  return jsonOut({
    success: true,
    personId: person.id,
    titleTr: title.titleTr,
    titleEn: title.titleEn,
    signatureCampus: campusInfo.campus,
    signatureTemplateVariant: templateVariant,
    signatureId: signatureId,
    signatureLink: imageUrl,
    signatureStatus: SIGNATURE_CONFIG.statusQueued,
    signatureUpdatedAt: nowText,
    datasetUrl: output.datasetUrl,
    gamCommandUrl: output.gamCommandUrl
  });
}

function requireSignatureAgentSecret_(data) {
  var scriptProperties = PropertiesService.getScriptProperties();
  var expectedSecret =
    scriptProperties.getProperty("SIGNATURE_AGENT_SECRET") ||
    scriptProperties.getProperty("GLPI_SYNC_SECRET");
  if (!expectedSecret || data.secret !== expectedSecret) throw new Error("Yetkisiz imza agent isteği.");
}

function completeSignatureAgentJob_(data) {
  requireSignatureAgentSecret_(data);
  var signatureId = data.signatureId ? data.signatureId.toString().trim() : "";
  if (!signatureId) throw new Error("İmza ID boş.");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cols = ensureSignatureUserColumns_(ss);
  var signatureIdCol = cols.signatureIdCol;
  var statusCol = cols.signatureStatusCol;
  var lastCol = cols.signatureLastCol;
  var templateCol = cols.signatureTemplateCol;
  var nowText = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");

  for (var r = 1; r < cols.table.values.length; r++) {
    var rowSignatureId = cols.table.values[r][signatureIdCol] ? cols.table.values[r][signatureIdCol].toString().trim() : "";
    if (rowSignatureId !== signatureId) continue;

    var rowNumber = r + 1;
    cols.table.sheet.getRange(rowNumber, statusCol + 1).setValue(SIGNATURE_CONFIG.statusDone);
    cols.table.sheet.getRange(rowNumber, lastCol + 1).setValue(nowText);
    if (data.templateVariant && templateCol > -1) {
      cols.table.sheet.getRange(rowNumber, templateCol + 1).setValue(data.templateVariant.toString().trim());
    }

    appendSecureLog(
      ss,
      "İMZA BASILDI",
      "Windows İmza Agent",
      signatureId,
      "-",
      data.imageUrl || "",
      data.machine || "-"
    );

    return jsonOut({ success: true, signatureId: signatureId, status: SIGNATURE_CONFIG.statusDone, updatedAt: nowText });
  }

  throw new Error("İmza ID kullanıcılar sayfasında bulunamadı: " + signatureId);
}

function getADQueueHeaders_() {
  return [
    "Queue ID",
    "Olusturma Zamani",
    "Baslama Zamani",
    "Bitis Zamani",
    "Durum",
    "Priority",
    "Personel ID",
    "Personel Adi",
    "Personel Eposta",
    "AD Kullanici",
    "Sifre Modu",
    "Sifre Ciphertext",
    "Sifre Algoritma",
    "Key ID",
    "Sebep",
    "Bildirim Eposta",
    "Bildirim SMS",
    "Bildirim Telefon",
    "Islemi Yapan",
    "Kampus",
    "Sonuc",
    "Hata",
    "Deneme",
    "Son Guncelleme",
    "Client IP",
    "User Agent"
  ];
}

function ensureADPasswordQueueSheet_(ss) {
  var sheet = ss.getSheetByName("AD_Islem_Kuyrugu");
  var headers = getADQueueHeaders_();
  if (!sheet) {
    sheet = ss.insertSheet("AD_Islem_Kuyrugu");
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0 || !sheet.getRange(1, 1).getValue()) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
    sheet.setFrozenRows(1);
  } else {
    var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    for (var h = 0; h < headers.length; h++) {
      if (currentHeaders.indexOf(headers[h]) === -1) {
        sheet.getRange(1, currentHeaders.length + 1).setValue(headers[h]);
        currentHeaders.push(headers[h]);
      }
    }
    headers = currentHeaders;
  }
  return { sheet: sheet, headers: headers };
}

function createADQueueId_() {
  return "AD-" + Utilities.formatDate(new Date(), "Europe/Istanbul", "yyyyMMdd-HHmmss") + "-" + Utilities.getUuid().substring(0, 8).toUpperCase();
}

function getFallbackAdUser_(personData) {
  if (personData.adUser) return normalizeAdLogin_(personData.adUser);
  if (personData.email && personData.email.indexOf("@") > -1) return normalizeAdLogin_(personData.email.split("@")[0]);
  return "";
}

function enqueueADPasswordReset_(data, verifiedUser, sessionEmail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var person = getPersonDetails(ss, data.personId);
  var adUser = getFallbackAdUser_(person);
  if (!adUser) throw new Error("Personel icin AD kullanici adi bulunamadi.");

  if (verifiedUser.role !== "HQ IT" && getCoreNameStr(person.campus) !== getCoreNameStr(verifiedUser.campus)) {
    throw new Error("Sadece kendi kampusunuzdeki personelin AD sifresini sifirlayabilirsiniz.");
  }

  var mode = data.passwordMode === "TEMPORARY" ? "TEMPORARY" : "PERMANENT";
  var ciphertext = data.passwordCiphertext ? data.passwordCiphertext.toString().trim() : "";
  if (!ciphertext || ciphertext.length > 8000) throw new Error("Sifreli sifre verisi gecersiz.");
  if (!data.encryptionAlg || data.encryptionAlg !== "RSA-OAEP-SHA256") throw new Error("Desteklenmeyen sifreleme algoritmasi.");

  var reason = data.reason ? sanitizeExcel(data.reason.toString().trim()) : "";
  if (reason.length < 5) throw new Error("AD sifre sifirlama icin sebep zorunludur.");

  var table = ensureADPasswordQueueSheet_(ss);
  var now = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
  var queueId = createADQueueId_();
  var notifyEmail = data.notifyEmail === true;
  var notifySms = data.notifySms === true;
  var notifyPhone = data.notifyPhone ? validateTrMobilePhone_(data.notifyPhone) : (person.phone || "");
  if (notifySms && !notifyPhone) throw new Error("SMS bildirimi için telefon numarası gerekli.");
  if (notifySms && data.notifyPhone) notifyPhone = updatePersonPhone_(ss, person.id, notifyPhone);

  var row = new Array(table.headers.length).fill("");
  function setADQueueValue_(name, value) {
    var idx = table.headers.indexOf(name);
    if (idx > -1) row[idx] = value;
  }
  setADQueueValue_("Queue ID", queueId);
  setADQueueValue_("Olusturma Zamani", now);
  setADQueueValue_("Durum", "BEKLIYOR");
  setADQueueValue_("Priority", 3);
  setADQueueValue_("Personel ID", person.id);
  setADQueueValue_("Personel Adi", person.name);
  setADQueueValue_("Personel Eposta", person.email);
  setADQueueValue_("AD Kullanici", adUser);
  setADQueueValue_("Sifre Modu", mode);
  setADQueueValue_("Sifre Ciphertext", ciphertext);
  setADQueueValue_("Sifre Algoritma", data.encryptionAlg);
  setADQueueValue_("Key ID", data.encryptionKeyId || "");
  setADQueueValue_("Sebep", reason);
  setADQueueValue_("Bildirim Eposta", notifyEmail ? "EVET" : "HAYIR");
  setADQueueValue_("Bildirim SMS", notifySms ? "EVET" : "HAYIR");
  setADQueueValue_("Bildirim Telefon", notifyPhone || "");
  setADQueueValue_("Islemi Yapan", sessionEmail);
  setADQueueValue_("Kampus", person.campus || verifiedUser.campus || "");
  setADQueueValue_("Deneme", 0);
  setADQueueValue_("Son Guncelleme", now);
  setADQueueValue_("Client IP", data.clientIp || "");
  setADQueueValue_("User Agent", data.userAgent || "");
  table.sheet.appendRow(row);

  appendSecureLog(ss, "AD SIFRE RESET KUYRUK", sessionEmail, person.name + " / " + adUser + " / " + mode, "-", "-", data.clientIp || "");
  return jsonOut({ success: true, queued: true, queueId: queueId, status: "BEKLIYOR" });
}

function fetchADPasswordQueue_(data, verifiedUser, sessionEmail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var table = ensureADPasswordQueueSheet_(ss);
  var values = table.sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = requireHeader(headers, ["Queue ID"]);
  var createdCol = requireHeader(headers, ["Olusturma Zamani"]);
  var endCol = requireHeader(headers, ["Bitis Zamani"]);
  var statusCol = requireHeader(headers, ["Durum"]);
  var personCol = requireHeader(headers, ["Personel Adi"]);
  var adCol = requireHeader(headers, ["AD Kullanici"]);
  var modeCol = requireHeader(headers, ["Sifre Modu"]);
  var byCol = requireHeader(headers, ["Islemi Yapan"]);
  var campusCol = requireHeader(headers, ["Kampus"]);
  var errorCol = requireHeader(headers, ["Hata"]);
  var updatedCol = requireHeader(headers, ["Son Guncelleme"]);
  var limit = Math.min(Math.max(Number(data.limit || 25), 1), 100);
  var jobs = [];

  for (var r = values.length - 1; r >= 1 && jobs.length < limit; r--) {
    var row = values[r];
    var executedBy = row[byCol] ? row[byCol].toString() : "";
    var campus = row[campusCol] ? row[campusCol].toString() : "";
    if (verifiedUser.role !== "HQ IT" && executedBy !== sessionEmail && getCoreNameStr(campus) !== getCoreNameStr(verifiedUser.campus)) continue;
    jobs.push({
      queueId: row[idCol] || "",
      createdAt: row[createdCol] || "",
      finishedAt: row[endCol] || "",
      status: row[statusCol] || "",
      personName: row[personCol] || "",
      adUser: row[adCol] || "",
      mode: row[modeCol] || "",
      executedBy: executedBy,
      campus: campus,
      error: row[errorCol] || "",
      updatedAt: row[updatedCol] || ""
    });
  }

  return jsonOut({ success: true, jobs: jobs });
}

function requireADAgentSecret_(data) {
  var expectedSecret = PropertiesService.getScriptProperties().getProperty("AD_AGENT_SECRET");
  if (!expectedSecret || data.secret !== expectedSecret) throw new Error("Yetkisiz AD agent istegi.");
}

function fetchADPasswordAgentJobs_(data) {
  requireADAgentSecret_(data);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var table = ensureADPasswordQueueSheet_(ss);
  var sheet = table.sheet;
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = requireHeader(headers, ["Queue ID"]);
  var startCol = requireHeader(headers, ["Baslama Zamani"]);
  var statusCol = requireHeader(headers, ["Durum"]);
  var personIdCol = requireHeader(headers, ["Personel ID"]);
  var personCol = requireHeader(headers, ["Personel Adi"]);
  var adCol = requireHeader(headers, ["AD Kullanici"]);
  var modeCol = requireHeader(headers, ["Sifre Modu"]);
  var cipherCol = requireHeader(headers, ["Sifre Ciphertext"]);
  var algCol = requireHeader(headers, ["Sifre Algoritma"]);
  var keyCol = requireHeader(headers, ["Key ID"]);
  var reasonCol = requireHeader(headers, ["Sebep"]);
  var emailCol = requireHeader(headers, ["Personel Eposta"]);
  var notifyEmailCol = getHeaderIndex(headers, ["Bildirim Eposta"]);
  var notifySmsCol = getHeaderIndex(headers, ["Bildirim SMS"]);
  var notifyPhoneCol = getHeaderIndex(headers, ["Bildirim Telefon"]);
  var byCol = requireHeader(headers, ["Islemi Yapan"]);
  var attemptCol = requireHeader(headers, ["Deneme"]);
  var updatedCol = requireHeader(headers, ["Son Guncelleme"]);
  var now = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
  var limit = Math.min(Math.max(Number(data.limit || 5), 1), 20);
  var jobs = [];

  for (var r = 1; r < values.length && jobs.length < limit; r++) {
    var status = values[r][statusCol] ? values[r][statusCol].toString() : "";
    if (status !== "BEKLIYOR") continue;

    sheet.getRange(r + 1, statusCol + 1).setValue("ISLENIYOR");
    sheet.getRange(r + 1, startCol + 1).setValue(now);
    sheet.getRange(r + 1, attemptCol + 1).setValue(Number(values[r][attemptCol] || 0) + 1);
    sheet.getRange(r + 1, updatedCol + 1).setValue(now);

    jobs.push({
      queueId: values[r][idCol],
      personId: values[r][personIdCol],
      personName: values[r][personCol],
      adUser: values[r][adCol],
      mode: values[r][modeCol],
      passwordCiphertext: values[r][cipherCol],
      encryptionAlg: values[r][algCol],
      encryptionKeyId: values[r][keyCol],
      reason: values[r][reasonCol],
      personEmail: values[r][emailCol],
      notifyEmail: notifyEmailCol > -1 && values[r][notifyEmailCol] === "EVET",
      notifySms: notifySmsCol > -1 && values[r][notifySmsCol] === "EVET",
      notifyPhone: notifyPhoneCol > -1 ? values[r][notifyPhoneCol] : "",
      requestedBy: values[r][byCol]
    });
  }

  return jsonOut({ success: true, jobs: jobs, leased: jobs.length });
}

function completeADPasswordAgentJob_(data) {
  requireADAgentSecret_(data);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var table = ensureADPasswordQueueSheet_(ss);
  var sheet = table.sheet;
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var idCol = requireHeader(headers, ["Queue ID"]);
  var endCol = requireHeader(headers, ["Bitis Zamani"]);
  var statusCol = requireHeader(headers, ["Durum"]);
  var resultCol = requireHeader(headers, ["Sonuc"]);
  var errorCol = requireHeader(headers, ["Hata"]);
  var updatedCol = requireHeader(headers, ["Son Guncelleme"]);
  var now = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
  var queueId = data.queueId ? data.queueId.toString() : "";
  if (!queueId) throw new Error("Queue ID bos.");

  for (var r = 1; r < values.length; r++) {
    if (values[r][idCol] && values[r][idCol].toString() === queueId) {
      var ok = data.success === true;
      sheet.getRange(r + 1, statusCol + 1).setValue(ok ? "TAMAMLANDI" : "HATA");
      sheet.getRange(r + 1, endCol + 1).setValue(now);
      sheet.getRange(r + 1, resultCol + 1).setValue(ok ? (data.result || "AD sifresi uygulandi.") : "");
      sheet.getRange(r + 1, errorCol + 1).setValue(ok ? "" : (data.error || "Bilinmeyen hata"));
      sheet.getRange(r + 1, updatedCol + 1).setValue(now);
      appendSecureLog(ss, ok ? "AD SIFRE RESET OK" : "AD SIFRE RESET HATA", "AD Agent", queueId + " / " + (ok ? "OK" : data.error), "-", "-", "");
      return jsonOut({ success: true });
    }
  }
  throw new Error("AD kuyruk kaydi bulunamadi: " + queueId);
}

// ==========================================
// GLPI NAME PARSER / CAMPUS MAP
// ==========================================

function ensureCampusCodeSheet_(ss) {
  var sheet = ss.getSheetByName("GLPI_KampusKodlari");
  if (!sheet) {
    sheet = ss.insertSheet("GLPI_KampusKodlari");
    sheet.appendRow(["Kod", "Kampüs"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getCampusCodeMap_(ss) {
  var sheet = ensureCampusCodeSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var code = values[i][0] ? values[i][0].toString().trim().toUpperCase() : "";
    var campus = values[i][1] ? values[i][1].toString().trim() : "";
    if (code && campus) map[code] = campus;
  }
  return map;
}

function getDeviceTypeCodeMap_() {
  return {
    "LAP": "Laptop",
    "AIO": "All in One",
    "SPC": "Akıllı Tahta",
    "PC": "Masaüstü"
  };
}

function parseComputerNameMeta_(computerName, campusMap) {
  var name = computerName ? computerName.toString().trim().toUpperCase() : "";
  var result = { campusCode: "", campus: "", typeCode: "", type: "" };
  if (!name) return result;

  var typeMap = getDeviceTypeCodeMap_();
  var typeCodes = Object.keys(typeMap).sort(function(a, b) { return b.length - a.length; });
  var campusCodes = Object.keys(campusMap || {}).sort(function(a, b) { return b.length - a.length; });

  for (var c = 0; c < campusCodes.length; c++) {
    var campusCode = campusCodes[c].toUpperCase();
    if (name.indexOf(campusCode) !== 0) continue;
    var rest = name.substring(campusCode.length);
    for (var t = 0; t < typeCodes.length; t++) {
      var typeCode = typeCodes[t];
      if (rest.indexOf(typeCode) === 0) {
        result.campusCode = campusCode;
        result.campus = campusMap[campusCode];
        result.typeCode = typeCode;
        result.type = typeMap[typeCode];
        return result;
      }
    }
  }

  var fallbackCampusCode = name.substring(0, 3);
  var fallbackRest = name.substring(3);
  result.campusCode = fallbackCampusCode;
  result.campus = campusMap && campusMap[fallbackCampusCode] ? campusMap[fallbackCampusCode] : "";
  for (var ft = 0; ft < typeCodes.length; ft++) {
    var fallbackTypeCode = typeCodes[ft];
    if (fallbackRest.indexOf(fallbackTypeCode) === 0) {
      result.typeCode = fallbackTypeCode;
      result.type = typeMap[fallbackTypeCode];
      return result;
    }
  }
  return result;
}

function normalizeGlpiValue_(value) {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
}

// ==========================================
// GLPI SYNC / RECONCILE
// ==========================================

function ensureGLPISheet_(ss) {
  var sheet = ss.getSheetByName("GLPI_Cihazlar");
  if (!sheet) sheet = ss.insertSheet("GLPI_Cihazlar");

  var headers = ["GLPI ID", "Seri no", "Bilgisayar İsmi", "Marka", "Model", "AD Kullanıcı", "Lokasyon", "Son Envanter", "Son Sync"];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return { sheet: sheet, headers: headers };
}

function handleGLPISync_(data) {
  var expectedSecret = PropertiesService.getScriptProperties().getProperty("GLPI_SYNC_SECRET");
  if (!expectedSecret || data.secret !== expectedSecret) {
    return jsonOut({ success: false, error: "Yetkisiz GLPI sync." });
  }

  var items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 10000) return jsonOut({ success: false, error: "Tek seferde çok fazla GLPI kaydı geldi." });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var table = ensureGLPISheet_(ss);
  var sheet = table.sheet;
  var headers = table.headers;
  var now = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");

  var rows = items.map(function(item) {
    return [
      normalizeGlpiValue_(item.glpiId),
      normalizeGlpiValue_(item.serial),
      normalizeGlpiValue_(item.computerName),
      normalizeGlpiValue_(item.manufacturer),
      normalizeGlpiValue_(item.model),
      normalizeAdLogin_(item.adUser),
      normalizeGlpiValue_(item.location),
      normalizeGlpiValue_(item.lastInventory),
      now
    ];
  });

  var oldLastRow = sheet.getLastRow();
  var allRows = [headers].concat(rows);
  sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
  sheet.setFrozenRows(1);
  if (oldLastRow > allRows.length) {
    sheet.getRange(allRows.length + 1, 1, oldLastRow - allRows.length, headers.length).clearContent();
  }

  var response = { success: true, count: rows.length, syncedAt: now, reconcileSkipped: true };
  var shouldQueueReconcile = (data.reconcile === "queue" || data.reconcile === "kuyruk" || data.reconcile === "queued");
  var shouldReconcile = (data.reconcile === true || data.reconcile === "true" || data.reconcile === 1 || data.reconcile === "1");

  if (shouldQueueReconcile) {
    var queued = enqueueOperation_(
      ss,
      "reconcileGLPI",
      { source: "syncGLPI", syncedAt: now, count: rows.length },
      "GLPI_SYNC",
      { role: "HQ IT", campus: "Genel Mudurluk" },
      { priority: 5 }
    );
    response.reconcileQueued = true;
    response.queueId = queued.queueId;
    response.reconcileMessage = "GLPI verisi guncellendi. Laptoplar eslestirmesi Islem_Kuyrugu'na alindi.";
  } else if (shouldReconcile) {
    var reconcileLock = LockService.getScriptLock();
    var reconcileLocked = false;
    try {
      reconcileLocked = reconcileLock.tryLock(5000);
      if (reconcileLocked) {
        var reconcile = reconcileGLPIWithLaptoplar_();
        response.reconcileSkipped = false;
        response.matched = reconcile.matched;
        response.warnings = reconcile.warnings;
      } else {
        response.reconcileMessage = "Laptoplar eşleştirmesi şu an yoğunluk nedeniyle atlandı. Sync verisi kaydedildi.";
      }
    } finally {
      if (reconcileLocked) reconcileLock.releaseLock();
    }
  } else {
    response.reconcileMessage = "GLPI verisi güncellendi. Laptoplar eşleştirmesi yoğun saatleri kilitlememek için çalıştırılmadı.";
  }

  return jsonOut(response);
}

function handleGeneratedPdfUpload_(data) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty("PDF_BRIDGE_SECRET") || props.getProperty("GOOGLE_BRIDGE_SECRET");
  if (!expectedSecret || data.secret !== expectedSecret) {
    return jsonOut({ success: false, error: "Yetkisiz PDF köprüsü." });
  }

  var incomingBase64 = data.fileBase64 || data.pdfBase64;
  var incomingName = data.fileName || data.pdfName;
  if (!incomingBase64 || !incomingName) {
    throw new Error("Dosya verisi eksik.");
  }

  var bytes = Utilities.base64Decode(incomingBase64);
  if (!bytes || bytes.length < 4) {
    throw new Error("Dosya geçersiz.");
  }

  var fileName = sanitizeFileName(incomingName, "belge.pdf");
  var mimeType = data.mimeType || MimeType.PDF;
  var allowedMimeTypes = [
    MimeType.PDF,
    "application/pdf",
    "image/jpeg",
    "image/png",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ];
  if (allowedMimeTypes.indexOf(mimeType) === -1) {
    throw new Error("Desteklenmeyen dosya tipi: " + mimeType);
  }

  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var folder = getOrCreateCampusFolder(ROOT_FOLDER_ID, data.campus || "Bilinmiyor");
  var file = folder.createFile(blob);
  var fileUrl = file.getUrl();

  var email = data.email || {};
  if (email.to) {
    var mailOptions = {
      attachments: [blob],
      name: "İSTEK Demirbaş Yönetim Sistemi"
    };
    if (email.cc) mailOptions.cc = email.cc;
    if (email.replyTo) mailOptions.replyTo = email.replyTo;

    GmailApp.sendEmail(
      email.to,
      email.subject || "Donanım Belgesi",
      email.body || "Tutanak ektedir.",
      mailOptions
    );
  }

  return jsonOut({
    success: true,
    url: fileUrl,
    fileUrl: fileUrl,
    pdfHash: data.pdfHash || "",
    queueId: data.meta && data.meta.queueId ? data.meta.queueId : ""
  });
}

function handleBridgeEmail_(data) {
  var props = PropertiesService.getScriptProperties();
  var expectedSecret = props.getProperty("PDF_BRIDGE_SECRET") || props.getProperty("GOOGLE_BRIDGE_SECRET");
  if (!expectedSecret || data.secret !== expectedSecret) {
    return jsonOut({ success: false, error: "Yetkisiz e-posta köprüsü." });
  }

  if (!data.to || data.to.toString().indexOf("@") === -1) {
    throw new Error("E-posta alıcısı geçersiz.");
  }

  var options = {
    name: data.name || "İSTEK Demirbaş Yönetimi"
  };
  if (data.cc) options.cc = data.cc;
  if (data.replyTo) options.replyTo = data.replyTo;

  GmailApp.sendEmail(
    data.to,
    data.subject || "İSTEK Bilgilendirme",
    data.body || "",
    options
  );

  return jsonOut({ success: true });
}

function buildPersonIndexByAd_(ss) {
  var table = readSheetTable(ss, "Kullanıcılar");
  var headers = table.headers;
  var idCol = getHeaderIndex(headers, ["User Id", "Email", "E-Posta", "Kullanıcı"]);
  var emailCol = getHeaderIndex(headers, ["Email", "E-Posta"]);
  var adCol = getHeaderIndex(headers, ["AD Kullanıcı", "AD Kullanici", "AD User", "SamAccountName"]);
  var nameCol = getHeaderIndex(headers, ["Ad Soyad", "Adı Soyadı", "Kullanıcı", "Name"]);
  var campusCol = getHeaderIndex(headers, ["Kampüs", "Okul"]);

  var byAd = {};
  for (var r = 1; r < table.values.length; r++) {
    var id = idCol > -1 && table.values[r][idCol] ? table.values[r][idCol].toString().trim() : "";
    var email = emailCol > -1 && table.values[r][emailCol] ? table.values[r][emailCol].toString().trim().toLowerCase() : "";
    var ad = adCol > -1 && table.values[r][adCol] ? normalizeAdLogin_(table.values[r][adCol]) : "";
    var name = nameCol > -1 && table.values[r][nameCol] ? table.values[r][nameCol].toString().trim() : id;
    var campus = campusCol > -1 && table.values[r][campusCol] ? table.values[r][campusCol].toString().trim() : "";
    var keys = [];
    if (ad) keys.push(ad);
    if (email && email.indexOf("@") > -1) keys.push(email.split("@")[0]);
    if (id && id.indexOf("@") > -1) keys.push(id.toLowerCase().split("@")[0]);
    if (id && id.indexOf("@") === -1) keys.push(id.toLowerCase());

    for (var i = 0; i < keys.length; i++) {
      if (keys[i]) byAd[keys[i]] = { id: id, email: email, ad: ad, name: name, campus: campus };
    }
  }
  return byAd;
}

function buildGlpiIndex_(ss) {
  var table = readSheetTable(ss, "GLPI_Cihazlar");
  var headers = table.headers;
  var glpiIdCol = requireHeader(headers, ["GLPI ID"]);
  var serialCol = requireHeader(headers, ["Seri no"]);
  var nameCol = requireHeader(headers, ["Bilgisayar İsmi"]);
  var brandCol = getHeaderIndex(headers, ["Marka"]);
  var modelCol = getHeaderIndex(headers, ["Model"]);
  var adCol = requireHeader(headers, ["AD Kullanıcı"]);
  var lastInventoryCol = getHeaderIndex(headers, ["Son Envanter"]);
  var syncCol = getHeaderIndex(headers, ["Son Sync"]);

  var bySerial = {};
  var byComputerName = {};
  for (var r = 1; r < table.values.length; r++) {
    var item = {
      glpiId: table.values[r][glpiIdCol],
      serial: table.values[r][serialCol],
      computerName: table.values[r][nameCol],
      brand: brandCol > -1 ? table.values[r][brandCol] : "",
      model: modelCol > -1 ? table.values[r][modelCol] : "",
      adUser: table.values[r][adCol],
      lastInventory: lastInventoryCol > -1 ? table.values[r][lastInventoryCol] : "",
      lastSync: syncCol > -1 ? table.values[r][syncCol] : ""
    };
    var serialKey = normalizeSerialKey_(item.serial);
    var nameKey = normalizeComputerNameKey_(item.computerName);
    if (serialKey) bySerial[serialKey] = item;
    if (nameKey) byComputerName[nameKey] = item;
  }
  return { bySerial: bySerial, byComputerName: byComputerName };
}

function reconcileGLPIWithLaptoplar_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hwTable = readSheetTable(ss, "Laptoplar");
  var hwSheet = hwTable.sheet;
  var hwData = hwTable.values;
  var headers = hwTable.headers;

  var serialCol = requireHeader(headers, ["Seri no"]);
  var computerNameCol = getHeaderIndex(headers, ["Bilgisayar İsmi", "Bilgisayar Ismi"]);
  var campusCol = requireHeader(headers, ["Kampüs", "Kampus"]);
  var userCol = requireHeader(headers, ["Kullanıcı", "Kullanici"]);
  var typeCol = getHeaderIndex(headers, ["Cihaz Tipi"]);

  var glpiIdCol = ensureColumn_(hwSheet, headers, "GLPI ID");
  var glpiNameCol = ensureColumn_(hwSheet, headers, "GLPI Bilgisayar İsmi");
  var glpiAdCol = ensureColumn_(hwSheet, headers, "GLPI AD Kullanıcı");
  var glpiPersonCol = ensureColumn_(hwSheet, headers, "GLPI Personel Eşleşmesi");
  var glpiCampusCol = ensureColumn_(hwSheet, headers, "GLPI Kampüs Tahmini");
  var glpiTypeCol = ensureColumn_(hwSheet, headers, "GLPI Cihaz Tipi Tahmini");
  var glpiMatchCol = ensureColumn_(hwSheet, headers, "GLPI Eşleşme");
  var glpiMismatchCol = ensureColumn_(hwSheet, headers, "GLPI Uyuşmazlık");
  var glpiSyncCol = ensureColumn_(hwSheet, headers, "GLPI Son Sync");

  for (var grow = 0; grow < hwData.length; grow++) {
    while (hwData[grow].length < headers.length) hwData[grow].push("");
  }

  var glpiIndex = buildGlpiIndex_(ss);
  var personByAd = buildPersonIndexByAd_(ss);
  var campusMap = getCampusCodeMap_(ss);
  var matched = 0;
  var warnings = 0;

  for (var r = 1; r < hwData.length; r++) {
    var serialKey = normalizeSerialKey_(hwData[r][serialCol]);
    var nameKey = computerNameCol > -1 ? normalizeComputerNameKey_(hwData[r][computerNameCol]) : "";
    var glpi = serialKey ? glpiIndex.bySerial[serialKey] : null;
    var matchType = glpi ? "SERİ NO" : "";

    if (!glpi && nameKey) {
      glpi = glpiIndex.byComputerName[nameKey];
      matchType = glpi ? "BİLGİSAYAR İSMİ" : "";
    }

    if (!glpi) {
      hwData[r][glpiIdCol] = "";
      hwData[r][glpiNameCol] = "";
      hwData[r][glpiAdCol] = "";
      hwData[r][glpiPersonCol] = "";
      hwData[r][glpiCampusCol] = "";
      hwData[r][glpiTypeCol] = "";
      hwData[r][glpiMatchCol] = "YOK";
      hwData[r][glpiMismatchCol] = "GLPI_ESLESMEDI";
      hwData[r][glpiSyncCol] = "";
      warnings++;
      continue;
    }

    matched++;
    var meta = parseComputerNameMeta_(glpi.computerName, campusMap);
    var adKey = normalizeAdLogin_(glpi.adUser);
    var glpiPerson = adKey ? personByAd[adKey] : null;
    var inferredCampus = meta.campus || (glpiPerson ? glpiPerson.campus : "");
    var inferredType = meta.type || "";

    if (computerNameCol > -1 && !hwData[r][computerNameCol] && glpi.computerName) {
      hwData[r][computerNameCol] = glpi.computerName;
    }
    if (typeCol > -1 && !hwData[r][typeCol] && inferredType) {
      hwData[r][typeCol] = inferredType;
    }

    var flags = [];
    var zimmetUser = hwData[r][userCol] ? hwData[r][userCol].toString().trim() : "";
    var currentCampus = hwData[r][campusCol] ? hwData[r][campusCol].toString().trim() : "";

    if (adKey && !glpiPerson) flags.push("AD_KULLANICI_KULLANICILARDA_YOK");
    if (glpiPerson && zimmetUser && glpiPerson.id && zimmetUser !== glpiPerson.id) flags.push("KULLANICI_FARKLI");
    if (glpiPerson && !zimmetUser) flags.push("ZIMMET_YOK_GLPI_KULLANICI_VAR");
    if (inferredCampus && getCoreNameStr(inferredCampus) !== getCoreNameStr(currentCampus)) flags.push("KAMPUS_FARKLI");

    hwData[r][glpiIdCol] = glpi.glpiId || "";
    hwData[r][glpiNameCol] = glpi.computerName || "";
    hwData[r][glpiAdCol] = adKey || "";
    hwData[r][glpiPersonCol] = glpiPerson ? glpiPerson.name : "";
    hwData[r][glpiCampusCol] = inferredCampus || "";
    hwData[r][glpiTypeCol] = inferredType || "";
    hwData[r][glpiMatchCol] = matchType;
    hwData[r][glpiMismatchCol] = flags.length ? flags.join(", ") : "OK";
    hwData[r][glpiSyncCol] = glpi.lastSync || "";
    if (flags.length) warnings++;
  }

  hwSheet.getRange(1, 1, hwData.length, headers.length).setValues(hwData);
  return { matched: matched, warnings: warnings };
}

// ==========================================
// GLPI MISSING DEVICES
// ==========================================

function buildLaptoplarExistingIndex_(ss) {
  var table = readSheetTable(ss, "Laptoplar");
  var headers = table.headers;
  var serialCol = requireHeader(headers, ["Seri no"]);
  var computerNameCol = getHeaderIndex(headers, ["Bilgisayar İsmi", "Bilgisayar Ismi"]);
  var bySerial = {};
  var byComputerName = {};
  for (var r = 1; r < table.values.length; r++) {
    var serialKey = normalizeSerialKey_(table.values[r][serialCol]);
    var nameKey = computerNameCol > -1 ? normalizeComputerNameKey_(table.values[r][computerNameCol]) : "";
    if (serialKey) bySerial[serialKey] = true;
    if (nameKey) byComputerName[nameKey] = true;
  }
  return { bySerial: bySerial, byComputerName: byComputerName };
}

function getMissingGLPIDevices_(ss, verifiedUser) {
  var glpiTable = readSheetTable(ss, "GLPI_Cihazlar");
  var headers = glpiTable.headers;
  var glpiIdCol = requireHeader(headers, ["GLPI ID"]);
  var serialCol = requireHeader(headers, ["Seri no"]);
  var nameCol = requireHeader(headers, ["Bilgisayar İsmi"]);
  var brandCol = getHeaderIndex(headers, ["Marka"]);
  var modelCol = getHeaderIndex(headers, ["Model"]);
  var adCol = requireHeader(headers, ["AD Kullanıcı"]);
  var invCol = getHeaderIndex(headers, ["Son Envanter"]);
  var syncCol = getHeaderIndex(headers, ["Son Sync"]);

  var existing = buildLaptoplarExistingIndex_(ss);
  var people = buildPersonIndexByAd_(ss);
  var campusMap = getCampusCodeMap_(ss);
  var missing = [];

  for (var r = 1; r < glpiTable.values.length; r++) {
    var row = glpiTable.values[r];
    var glpiId = row[glpiIdCol] ? row[glpiIdCol].toString().trim() : "";
    var serial = row[serialCol] ? row[serialCol].toString().trim() : "";
    var computerName = row[nameCol] ? row[nameCol].toString().trim() : "";
    var serialKey = normalizeSerialKey_(serial);
    var nameKey = normalizeComputerNameKey_(computerName);
    if ((serialKey && existing.bySerial[serialKey]) || (nameKey && existing.byComputerName[nameKey])) continue;

    var meta = parseComputerNameMeta_(computerName, campusMap);
    var adUser = normalizeAdLogin_(row[adCol]);
    var person = adUser ? people[adUser] : null;
    var inferredCampus = meta.campus || (person ? person.campus : "");

    if (verifiedUser.role !== "HQ IT") {
      if (!inferredCampus || getCoreNameStr(inferredCampus) !== getCoreNameStr(verifiedUser.campus)) continue;
    }

    missing.push({
      glpiId: glpiId,
      serial: serial,
      computerName: computerName,
      brand: brandCol > -1 ? normalizeGlpiValue_(row[brandCol]) : "",
      model: modelCol > -1 ? normalizeGlpiValue_(row[modelCol]) : "",
      adUser: adUser,
      matchedPersonId: person ? person.id : "",
      matchedPersonName: person ? person.name : "",
      inferredCampus: inferredCampus,
      deviceType: meta.type || "",
      lastInventory: invCol > -1 ? normalizeGlpiValue_(row[invCol]) : "",
      lastSync: syncCol > -1 ? normalizeGlpiValue_(row[syncCol]) : ""
    });
  }
  return missing;
}

function fetchMissingGLPIDevices_(verifiedUser) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return jsonOut({ success: true, devices: getMissingGLPIDevices_(ss, verifiedUser) });
}

function importMissingGLPIDevices_(data, verifiedUser, sessionEmail) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var selectedIds = normalizeIdArray(data.glpiIds);
  if (selectedIds.length === 0) throw new Error("Eklenecek GLPI cihazı seçilmedi.");

  var selectedMap = {};
  for (var i = 0; i < selectedIds.length; i++) selectedMap[selectedIds[i]] = true;

  var missing = getMissingGLPIDevices_(ss, verifiedUser);
  var importMap = {};
  for (var m = 0; m < missing.length; m++) {
    if (selectedMap[missing[m].glpiId]) importMap[missing[m].glpiId] = missing[m];
  }
  if (Object.keys(importMap).length !== selectedIds.length) {
    throw new Error("Seçili cihazlardan bazıları bulunamadı, zaten eklenmiş olabilir veya kampüs yetkiniz dışında.");
  }

  var hwTable = readSheetTable(ss, "Laptoplar");
  var sheet = hwTable.sheet;
  var headers = hwTable.headers;
  var serialCol = requireHeader(headers, ["Seri no"]);
  var modelCol = requireHeader(headers, ["Modeli"]);
  var campusCol = requireHeader(headers, ["Kampüs", "Kampus"]);
  var userCol = requireHeader(headers, ["Kullanıcı", "Kullanici"]);
  var statusCol = requireHeader(headers, ["Cihaz Durumu"]);
  var pcNameCol = getHeaderIndex(headers, ["Bilgisayar İsmi", "Bilgisayar Ismi"]);
  var typeCol = getHeaderIndex(headers, ["Cihaz Tipi"]);
  var brandCol = getHeaderIndex(headers, ["Marka"]);
  var notesCol = getHeaderIndex(headers, ["Notlar"]);

  var glpiIdCol = ensureColumn_(sheet, headers, "GLPI ID");
  var glpiNameCol = ensureColumn_(sheet, headers, "GLPI Bilgisayar İsmi");
  var glpiAdCol = ensureColumn_(sheet, headers, "GLPI AD Kullanıcı");
  var glpiPersonCol = ensureColumn_(sheet, headers, "GLPI Personel Eşleşmesi");
  var glpiCampusCol = ensureColumn_(sheet, headers, "GLPI Kampüs Tahmini");
  var glpiTypeCol = ensureColumn_(sheet, headers, "GLPI Cihaz Tipi Tahmini");
  var glpiMatchCol = ensureColumn_(sheet, headers, "GLPI Eşleşme");
  var glpiMismatchCol = ensureColumn_(sheet, headers, "GLPI Uyuşmazlık");
  var glpiSyncCol = ensureColumn_(sheet, headers, "GLPI Son Sync");

  var rows = [];
  for (var g = 0; g < selectedIds.length; g++) {
    var item = importMap[selectedIds[g]];
    var row = new Array(headers.length).fill("");
    row[serialCol] = sanitizeExcel(item.serial);
    row[modelCol] = sanitizeExcel(item.model || item.computerName || "GLPI Cihazı");
    row[campusCol] = item.inferredCampus || verifiedUser.campus;
    row[userCol] = "";
    row[statusCol] = "DEPODA";
    if (pcNameCol > -1) row[pcNameCol] = sanitizeExcel(item.computerName);
    if (typeCol > -1) row[typeCol] = item.deviceType || "Cihaz";
    if (brandCol > -1) row[brandCol] = sanitizeExcel(item.brand);
    if (notesCol > -1) row[notesCol] = "GLPI'den eklendi. AD Kullanıcı: " + (item.adUser || "-");
    row[glpiIdCol] = item.glpiId;
    row[glpiNameCol] = item.computerName;
    row[glpiAdCol] = item.adUser;
    row[glpiPersonCol] = item.matchedPersonName;
    row[glpiCampusCol] = item.inferredCampus;
    row[glpiTypeCol] = item.deviceType;
    row[glpiMatchCol] = "GLPI_IMPORT";
    row[glpiMismatchCol] = item.adUser ? "ZIMMET_YOK_GLPI_KULLANICI_VAR" : "OK";
    row[glpiSyncCol] = item.lastSync;
    rows.push(row);
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  appendSecureLog(ss, "GLPI IMPORT", sessionEmail, rows.length + " cihaz Laptoplar'a eklendi", "-", "-", data.clientIp || "-");
  return jsonOut({ success: true, imported: rows.length });
}

function enrichFetchHardwareWithGLPI_(hardwareObj, row, headers) {
  var glpiIdCol = getHeaderIndex(headers, ["GLPI ID"]);
  var glpiNameCol = getHeaderIndex(headers, ["GLPI Bilgisayar İsmi"]);
  var glpiAdCol = getHeaderIndex(headers, ["GLPI AD Kullanıcı"]);
  var glpiPersonCol = getHeaderIndex(headers, ["GLPI Personel Eşleşmesi"]);
  var glpiCampusCol = getHeaderIndex(headers, ["GLPI Kampüs Tahmini"]);
  var glpiTypeCol = getHeaderIndex(headers, ["GLPI Cihaz Tipi Tahmini"]);
  var glpiMismatchCol = getHeaderIndex(headers, ["GLPI Uyuşmazlık"]);
  var glpiSyncCol = getHeaderIndex(headers, ["GLPI Son Sync"]);

  var glpiComputerName = glpiNameCol > -1 ? normalizeGlpiValue_(row[glpiNameCol]) : "";
  if (!hardwareObj.deviceName && glpiComputerName) hardwareObj.deviceName = glpiComputerName;
  if ((!hardwareObj.type || hardwareObj.type === "Laptop") && glpiTypeCol > -1 && row[glpiTypeCol]) {
    hardwareObj.type = row[glpiTypeCol].toString();
  }

  hardwareObj.glpiId = glpiIdCol > -1 ? normalizeGlpiValue_(row[glpiIdCol]) : "";
  hardwareObj.glpiComputerName = glpiComputerName;
  hardwareObj.glpiAdUser = glpiAdCol > -1 ? normalizeGlpiValue_(row[glpiAdCol]) : "";
  hardwareObj.glpiPersonName = glpiPersonCol > -1 ? normalizeGlpiValue_(row[glpiPersonCol]) : "";
  hardwareObj.glpiCampus = glpiCampusCol > -1 ? normalizeGlpiValue_(row[glpiCampusCol]) : "";
  hardwareObj.glpiDeviceType = glpiTypeCol > -1 ? normalizeGlpiValue_(row[glpiTypeCol]) : "";
  hardwareObj.glpiMismatch = glpiMismatchCol > -1 ? normalizeGlpiValue_(row[glpiMismatchCol]) : "";
  hardwareObj.glpiLastSync = glpiSyncCol > -1 ? normalizeGlpiValue_(row[glpiSyncCol]) : "";
  return hardwareObj;
}

// ==========================================
// MAIN ROUTER
// ==========================================

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: "Bozuk veri paketi." });
  }

  var lock = LockService.getScriptLock();
  var lockFreeActions = {
    verifyLogin: true,
    fetchData: true,
    fetchHardwareHistory: true,
    fetchMissingGLPIDevices: true,
    sendOTP: true,
    verifyOTP: true,
    syncGLPI: true,
    uploadGeneratedPdf: true,
    sendBridgeEmail: true,
    enqueueOperation: true,
    fetchOperationQueue: true,
    runOperationQueue: true,
    fetchADPasswordQueue: true,
    fetchSignatureMeta: true
  };
  var needsLock = !lockFreeActions[data.action];

  if (needsLock) {
    try {
      lock.waitLock(30000);
    } catch (errLock) {
      return jsonOut({ success: false, error: "Sistem meşgul, lütfen tekrar deneyin." });
    }
  }

  try {
    if (data.action === "syncGLPI") {
      return handleGLPISync_(data);
    }

    if (data.action === "uploadGeneratedPdf") {
      return handleGeneratedPdfUpload_(data);
    }

    if (data.action === "sendBridgeEmail") {
      return handleBridgeEmail_(data);
    }

    if (data.action === "fetchADPasswordJobs") {
      return fetchADPasswordAgentJobs_(data);
    }

    if (data.action === "completeADPasswordJob") {
      return completeADPasswordAgentJob_(data);
    }

    if (data.action === "completeSignatureJob") {
      return completeSignatureAgentJob_(data);
    }

    if (data.action === 'verifyLogin') {
      var verifiedEmail = "";
      var verifiedName = "";
      var verifiedPicture = "";

      if (data.googleToken) {
        var tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(data.googleToken), { muteHttpExceptions: true });
        if (tokenResponse.getResponseCode() !== 200) throw new Error("Geçersiz Token.");
        var tokenInfo = JSON.parse(tokenResponse.getContentText());
        if (tokenInfo.aud !== GOOGLE_CLIENT_ID || String(tokenInfo.email_verified) !== "true") {
          throw new Error("Yetkisiz istemci veya doğrulanmamış e-posta.");
        }
        verifiedEmail = tokenInfo.email.toLowerCase();
        verifiedName = tokenInfo.name || "";
        verifiedPicture = tokenInfo.picture || "";
      } else if (data.googleAccessToken) {
        var accessToken = data.googleAccessToken.toString();
        var accessInfoResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken), { muteHttpExceptions: true });
        if (accessInfoResponse.getResponseCode() !== 200) throw new Error("Geçersiz Google erişim tokeni.");
        var accessInfo = JSON.parse(accessInfoResponse.getContentText());
        if (accessInfo.aud !== GOOGLE_CLIENT_ID) {
          throw new Error("Yetkisiz istemci.");
        }

        var userInfoResponse = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + accessToken }
        });
        if (userInfoResponse.getResponseCode() !== 200) throw new Error("Google kullanıcı bilgisi alınamadı.");
        var userInfo = JSON.parse(userInfoResponse.getContentText());
        if (!userInfo.email || String(userInfo.email_verified) !== "true") {
          throw new Error("Doğrulanmamış Google e-postası.");
        }
        verifiedEmail = userInfo.email.toLowerCase();
        verifiedName = userInfo.name || "";
        verifiedPicture = userInfo.picture || "";
      } else {
        throw new Error("Google kimlik bilgisi eksik.");
      }

      var ssAuth = SpreadsheetApp.getActiveSpreadsheet();
      var verifiedUserAuth = getAuthorizedUsers(ssAuth)[verifiedEmail];
      if (!verifiedUserAuth) throw new Error("Sistem yetkiniz bulunmuyor.");

      var sessionToken = Utilities.getUuid();
      CacheService.getScriptCache().put(sessionToken, verifiedEmail, 21600);
      return jsonOut({ success: true, sessionToken: sessionToken, email: verifiedEmail, name: verifiedName, picture: verifiedPicture, role: verifiedUserAuth.role, campus: verifiedUserAuth.campus });
    }

    if (!data.authToken) throw new Error("Oturum bulunamadı.");
    var sessionEmail = CacheService.getScriptCache().get(data.authToken);
    if (!sessionEmail) throw new Error("Oturum süresi doldu.");

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var verifiedUser = getAuthorizedUsers(ss)[sessionEmail];
    if (!verifiedUser) throw new Error("Yetkileriniz iptal edilmiş.");

    if (data.action === "fetchSignatureMeta") {
      return fetchSignatureMeta_(ss, verifiedUser);
    }

    if (data.action === "enqueueOperation") {
      return enqueueOperationRoute_(data, verifiedUser, sessionEmail);
    }

    if (data.action === "fetchOperationQueue") {
      return fetchOperationQueue_(data, verifiedUser, sessionEmail);
    }

    if (data.action === "runOperationQueue") {
      return runOperationQueue_(data, verifiedUser);
    }

    if (data.action === "enqueueADPasswordReset") {
      return enqueueADPasswordReset_(data, verifiedUser, sessionEmail);
    }

    if (data.action === "fetchADPasswordQueue") {
      return fetchADPasswordQueue_(data, verifiedUser, sessionEmail);
    }

    if (data.action === "createPersonnelSignature") {
      return createPersonnelSignature_(ss, data, verifiedUser, sessionEmail);
    }

    if (data.action === "fetchMissingGLPIDevices") {
      return fetchMissingGLPIDevices_(verifiedUser);
    }

    if (data.action === "importMissingGLPIDevices") {
      return importMissingGLPIDevices_(data, verifiedUser, sessionEmail);
    }

    if (data.action === "recordInventoryScan") {
      return recordInventoryScan_(data, verifiedUser, sessionEmail);
    }

    if (data.action === 'sendOTP') {
      if (!data.personEmail || data.personEmail.indexOf("@") === -1) throw new Error("Geçerli personel e-postası yok.");
      var otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      CacheService.getScriptCache().put('OTP_' + data.personEmail.toLowerCase(), otpCode, 180);
      var otpChannel = data.otpChannel === "sms" ? "sms" : "email";
      if (otpChannel === "sms") {
        var otpPhone = validateTrMobilePhone_(data.personPhone);
        if (data.personId) otpPhone = updatePersonPhone_(ss, data.personId, otpPhone);
        sendSmsViaMobildev(otpPhone, "ISTEK Demirbas teslim/iade onay kodunuz: " + otpCode + ". Kod 2 dakika gecerlidir. Bu kodu IT personeliyle paylasarak donanim tutanagini onaylamis olursunuz.");
        return jsonOut({ success: true, channel: "sms", phone: otpPhone });
      }
      GmailApp.sendEmail(data.personEmail, "GÜVENLİK KODU: Donanım Teslim/İade Onayı", "Sayın " + (data.personName || "Personel") + ",\n\nDonanım teslim/iade tutanağını onaylamak için güvenlik kodunuz: " + otpCode + "\n\nBu kod 2 dakika geçerlidir. Kodu işlemi yapan IT personeliyle paylaşarak ilgili donanım tutanağını dijital olarak onaylamış olursunuz.", { name: "İSTEK Demirbaş Yönetimi" });
      return jsonOut({ success: true, channel: "email" });
    }

    if (data.action === 'verifyOTP') {
      var cachedCode = CacheService.getScriptCache().get('OTP_' + data.personEmail.toLowerCase());
      if (cachedCode && cachedCode === data.otpCode.trim()) {
        CacheService.getScriptCache().remove('OTP_' + data.personEmail.toLowerCase());
        var hash = "DİJIT-ONAY-" + Utilities.getUuid().substring(0, 8).toUpperCase();
        CacheService.getScriptCache().put('VALID_OTP_' + hash, data.personEmail.toLowerCase(), 600);
        return jsonOut({ success: true, hash: hash });
      }
      throw new Error("Hatalı veya süresi dolmuş kod.");
    }

    if (data.action === 'fetchData') {
      var hwDataRaw = ss.getSheetByName("Laptoplar").getDataRange().getValues();
      var usDataRaw = ss.getSheetByName("Kullanıcılar").getDataRange().getValues();
      var hwHeaders = hwDataRaw.shift();
      var usHeaders = usDataRaw.shift();
      var uniqueUsers = {};
      var hardware = [];

      var idCol = getHeaderIndex(usHeaders, ["User Id", "Email", "E-Posta", "Kullanıcı"]);
      var nameCol = getHeaderIndex(usHeaders, ["Ad Soyad", "Adı Soyadı", "Kullanıcı", "Name"]);
      var campusCol = getHeaderIndex(usHeaders, ["Kampüs", "Okul"]);
      var emailCol = getHeaderIndex(usHeaders, ["Email", "E-Posta"]);
      var deptCol = getHeaderIndex(usHeaders, ["Department", "Departman", "Görev", "Ünvan"]);
      var statusColU = getHeaderIndex(usHeaders, ["Durumu", "Status"]);
      var photoCol = getHeaderIndex(usHeaders, ["Profil Fotoğrafı", "Fotoğraf"]);
      var adColU = getHeaderIndex(usHeaders, ["AD Kullanıcı", "AD Kullanici", "AD User", "SamAccountName"]);
      var phoneColU = getHeaderIndex(usHeaders, ["Telefon", "Phone", "Cep Telefonu", "GSM"]);
      var signatureLinkColU = getHeaderIndex(usHeaders, ["İmza Linki", "Imza Linki", "Signature Link"]);
      var signatureIdColU = getHeaderIndex(usHeaders, ["İmza ID", "Imza ID", "Signature ID"]);
      var signatureStatusColU = getHeaderIndex(usHeaders, ["İmza Durumu", "Imza Durumu", "Signature Status"]);
      var signatureTitleEnColU = getHeaderIndex(usHeaders, ["İmza Ünvan EN", "Imza Unvan EN", "Signature Title EN"]);
      var signatureCampusColU = getHeaderIndex(usHeaders, ["İmza Kampüsü", "Imza Kampusu", "Signature Campus"]);
      var signatureTemplateColU = getHeaderIndex(usHeaders, ["İmza Şablonu", "Imza Sablonu", "Signature Template"]);
      var signatureUpdatedColU = getHeaderIndex(usHeaders, ["İmza Son İşlem", "Imza Son Islem", "Signature Last Run"]);

      usDataRaw.forEach(function(row) {
        var id = idCol > -1 && row[idCol] ? row[idCol].toString().trim() : "";
        var campus = campusCol > -1 && row[campusCol] ? row[campusCol].toString().trim() : "Bilinmiyor";
        if (verifiedUser.role !== 'HQ IT' && getCoreNameStr(campus) !== getCoreNameStr(verifiedUser.campus)) return;
        if (id) {
          var signatureLink = signatureLinkColU > -1 && row[signatureLinkColU] ? row[signatureLinkColU].toString().trim() : "";
          uniqueUsers[id] = {
            id: id,
            name: nameCol > -1 && row[nameCol] ? row[nameCol].toString().trim() : id,
            campus: campus,
            email: emailCol > -1 && row[emailCol] ? row[emailCol].toString().trim() : "",
            adUser: adColU > -1 && row[adColU] ? normalizeAdLogin_(row[adColU]) : "",
            phone: phoneColU > -1 && row[phoneColU] ? normalizePhoneNumber_(row[phoneColU]) : "",
            department: deptCol > -1 && row[deptCol] ? row[deptCol].toString().trim() : "Personel",
            status: statusColU > -1 && row[statusColU] ? row[statusColU].toString().trim() : "Aktif",
            picture: photoCol > -1 && row[photoCol] ? row[photoCol].toString().trim() : null,
            signatureLink: signatureLink,
            signatureId: signatureIdColU > -1 && row[signatureIdColU] ? row[signatureIdColU].toString().trim() : "",
            signatureStatus: signatureStatusColU > -1 && row[signatureStatusColU] ? row[signatureStatusColU].toString().trim() : "",
            signatureTitleEn: signatureTitleEnColU > -1 && row[signatureTitleEnColU] ? row[signatureTitleEnColU].toString().trim() : "",
            signatureCampus: signatureCampusColU > -1 && row[signatureCampusColU] ? row[signatureCampusColU].toString().trim() : "",
            signatureTemplateVariant: signatureTemplateColU > -1 && row[signatureTemplateColU] ? row[signatureTemplateColU].toString().trim() : "",
            signatureUpdatedAt: signatureUpdatedColU > -1 && row[signatureUpdatedColU] ? row[signatureUpdatedColU].toString().trim() : "",
            signatureMissing: !signatureLink
          };
        }
      });

      var hwSeriCol = getHeaderIndex(hwHeaders, ["Seri no"]);
      var hwKampusCol = getHeaderIndex(hwHeaders, ["Kampüs", "Kampus"]);
      var hwKullaniciCol = getHeaderIndex(hwHeaders, ["Kullanıcı", "Kullanici"]);
      var hwDurumCol = getHeaderIndex(hwHeaders, ["Cihaz Durumu"]);
      var hwModelCol = getHeaderIndex(hwHeaders, ["Modeli"]);
      var hwPcNameCol = getHeaderIndex(hwHeaders, ["Bilgisayar İsmi", "Bilgisayar Ismi"]);
      var hwTypeCol = getHeaderIndex(hwHeaders, ["Cihaz Tipi"]);
      var hwBrandCol = getHeaderIndex(hwHeaders, ["Marka"]);
      var hwDriveCol = getHeaderIndex(hwHeaders, ["Drive Linki"]);
      var hwHistoryCol = getHeaderIndex(hwHeaders, ["Geçmiş"]);
      var hwGroupCol = getHeaderIndex(hwHeaders, ["Grup Adı"]);
      var hwNotesCol = getHeaderIndex(hwHeaders, ["Notlar"]);

      hwDataRaw.forEach(function(row) {
        var serial = hwSeriCol > -1 && row[hwSeriCol] ? row[hwSeriCol].toString().trim() : "";
        if (!serial) return;

        var campus = hwKampusCol > -1 && row[hwKampusCol] ? row[hwKampusCol].toString().trim() : "Bilinmiyor";
        var assigned = hwKullaniciCol > -1 && row[hwKullaniciCol] ? row[hwKullaniciCol].toString().trim() : null;
        if (verifiedUser.role !== 'HQ IT') {
          var isMyCampus = getCoreNameStr(campus) === getCoreNameStr(verifiedUser.campus);
          var isSentByMe = assigned && assigned.toUpperCase().indexOf("GÖNDEREN:" + verifiedUser.campus.toUpperCase()) > -1;
          if (!isMyCampus && !isSentByMe) return;
        }

        var normStatus = normalizeStatus(hwDurumCol > -1 ? row[hwDurumCol] : "");
        if (normStatus === "") normStatus = "AKTIF";
        var status = "Available";
        if (normStatus === "AKTIF") status = "Assigned";
        else if (normStatus === "DEPODA") status = "Available";
        else if (normStatus === "HURDA") status = "Hurda";
        else if (normStatus === "TRANSFER") status = "Transfer";
        if (status !== "Assigned" && status !== "Transfer") assigned = null;

        if (assigned && !uniqueUsers[assigned] && !assigned.toUpperCase().includes("GÖNDEREN:")) {
          uniqueUsers[assigned] = { id: assigned, name: assigned, campus: campus, department: "Personel", email: "", status: "Aktif", picture: null };
        }

        var fullHistory = parseHistory(hwHistoryCol > -1 ? row[hwHistoryCol] : "");
        var type = hwTypeCol > -1 && row[hwTypeCol] ? row[hwTypeCol].toString().trim() : "Laptop";
        var hardwareObj = {
          id: serial,
          type: type,
          brand: hwBrandCol > -1 && row[hwBrandCol] ? row[hwBrandCol].toString() : "",
          model: hwModelCol > -1 && row[hwModelCol] ? row[hwModelCol].toString() : "",
          deviceName: hwPcNameCol > -1 && row[hwPcNameCol] ? row[hwPcNameCol].toString().trim() : "",
          serial: serial,
          campus: campus,
          status: status,
          assignedTo: assigned,
          driveLink: hwDriveCol > -1 && row[hwDriveCol] ? row[hwDriveCol].toString() : null,
          history: fullHistory.slice(0, 3),
          hasHistory: fullHistory.length > 0,
          historyLoaded: false,
          groupName: hwGroupCol > -1 && row[hwGroupCol] ? row[hwGroupCol].toString() : "",
          notes: hwNotesCol > -1 && row[hwNotesCol] ? row[hwNotesCol].toString() : ""
        };
        hardware.push(enrichFetchHardwareWithGLPI_(hardwareObj, row, hwHeaders));
      });

      return jsonOut({ success: true, personnel: Object.values(uniqueUsers), hardware: hardware });
    }

    if (data.action === 'fetchHardwareHistory') {
      var hwTableH = readSheetTable(ss, "Laptoplar");
      var hwRowsH = findHardwareRows(hwTableH, [data.hardwareId], verifiedUser);
      var histColH = requireHeader(hwTableH.headers, ["Geçmiş"]);
      return jsonOut({ success: true, history: parseHistory(hwTableH.values[hwRowsH[0].rowIdx][histColH]) });
    }

    if (data.action === 'createSheet') {
      if (!data.data || data.data.length === 0) throw new Error("Veri yok.");
      var newSS = SpreadsheetApp.create(sanitizeExcel(data.sheetName || "Dışa Aktarım"));
      var sheet = newSS.getSheets()[0];
      var exportHeadersRaw = Object.keys(data.data[0]);
      var exportHeaders = exportHeadersRaw.map(function(h) { return sanitizeExcel(h); });
      sheet.appendRow(exportHeaders);
      var rowsExport = data.data.map(function(obj) {
        return exportHeadersRaw.map(function(h) { return sanitizeExcel(obj[h]) || "-"; });
      });
      sheet.getRange(2, 1, rowsExport.length, exportHeaders.length).setValues(rowsExport);
      newSS.addEditor(sessionEmail);
      appendSecureLog(ss, "EXPORT SHEETS", sessionEmail, rowsExport.length + " kayıt aktarıldı", "-", newSS.getUrl(), data.clientIp);
      return jsonOut({ success: true, url: newSS.getUrl() });
    }

    if (data.action === 'addHardware') {
      var hwSheetAdd = ss.getSheetByName("Laptoplar");
      var headersAdd = hwSheetAdd.getDataRange().getValues()[0];
      var rowAdd = new Array(headersAdd.length).fill("");
      function setAddCol(name, value) {
        var idx = headersAdd.indexOf(name);
        if (idx > -1) rowAdd[idx] = value;
      }
      setAddCol("Seri no", sanitizeExcel(data.hardware.serial));
      setAddCol("Marka", sanitizeExcel(data.hardware.brand));
      setAddCol("Modeli", sanitizeExcel(data.hardware.model));
      setAddCol("Cihaz Tipi", sanitizeExcel(data.hardware.type || "Cihaz"));
      setAddCol("Bilgisayar İsmi", sanitizeExcel(data.hardware.deviceName || ""));
      setAddCol("Kampüs", verifiedUser.role === "HQ IT" && data.hardware.campus ? data.hardware.campus : verifiedUser.campus);
      setAddCol("Cihaz Durumu", "DEPODA");
      hwSheetAdd.appendRow(rowAdd);
      appendSecureLog(ss, "DONANIM EKLE", sessionEmail, "S/N: " + data.hardware.serial, "-", "-", data.clientIp);
      return jsonOut({ success: true });
    }

    if (data.action === 'updateHardware' || data.action === 'bulkUpdateGroup' || data.action === 'bulkStatusUpdate') {
      var hwTableU = readSheetTable(ss, "Laptoplar");
      var idsU = data.action === 'updateHardware' ? [data.hardwareId] : data.hardwareIds;
      var hwRowsU = findHardwareRows(hwTableU, idsU, verifiedUser);
      var hwDataU = hwTableU.values;
      var dColU = requireHeader(hwTableU.headers, ["Cihaz Durumu"]);
      var userColU = requireHeader(hwTableU.headers, ["Kullanıcı", "Kullanici"]);
      var histColU = requireHeader(hwTableU.headers, ["Geçmiş"]);

      for (var kU = 0; kU < hwRowsU.length; kU++) {
        var rU = hwRowsU[kU].rowIdx;
        if (data.action === 'updateHardware') {
          if (data.updates.notes !== undefined) hwDataU[rU][requireHeader(hwTableU.headers, ["Notlar"])] = sanitizeExcel(data.updates.notes);
          if (data.updates.deviceName !== undefined) hwDataU[rU][requireHeader(hwTableU.headers, ["Bilgisayar İsmi"])] = sanitizeExcel(data.updates.deviceName);
        } else if (data.action === 'bulkUpdateGroup') {
          hwDataU[rU][requireHeader(hwTableU.headers, ["Grup Adı"])] = sanitizeExcel(data.groupName);
        } else if (data.action === 'bulkStatusUpdate') {
          var newSt = data.newStatus === 'Available' ? 'DEPODA' : 'HURDA';
          hwDataU[rU][dColU] = newSt;
          hwDataU[rU][userColU] = "";
          var histU = parseHistory(hwDataU[rU][histColU]);
          histU.unshift({ personName: sessionEmail, date: Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy"), type: 'Toplu İşlem: ' + newSt });
          hwDataU[rU][histColU] = JSON.stringify(histU);
        }
      }
      hwTableU.sheet.getDataRange().setValues(hwDataU);
      appendSecureLog(ss, data.action.toUpperCase(), sessionEmail, hwRowsU.length + " cihaz güncellendi", "-", "-", data.clientIp);
      return jsonOut({ success: true });
    }

    // =========================================================================
    // TASARIMLI PDF - ZİMMET / İADE OLUŞTURMA (09:12 KODUNDAN GETİRİLDİ)
    // =========================================================================
    if (data.action === 'saveZimmetServerSide' || data.action === 'returnZimmetServerSide') {
      var isReturn = data.action === 'returnZimmetServerSide';
      
      // iPad vb yüksek çözünürlüklü ekranlarda base64 imzası devasa boyutlara ulaştığı için 
      // validateSignature fonksiyonundaki boyut limiti 2 Milyona çıkarıldı. String hatası bu yüzden veriyordu.
      if (!validateSignature(data.itSignature) || !validateSignature(data.personSignature)) throw new Error("İmza boyutunuz çok büyük veya geçersiz formatta (String hatası).");

      var personData = getPersonDetails(ss, data.personId);
      if (!personData.email) throw new Error("Personelin sistemde e-posta adresi bulunmuyor.");
      if (!isReturn && verifiedUser.role !== "HQ IT" && personData.campus && getCoreNameStr(personData.campus) !== getCoreNameStr(verifiedUser.campus)) {
        throw new Error("Farklı kampüs personeline zimmet yapılamaz.");
      }

      var validatedOtpEmail = CacheService.getScriptCache().get('VALID_OTP_' + data.personOtpHash);
      if (!validatedOtpEmail || validatedOtpEmail !== personData.email) throw new Error("OTP doğrulama başarısız veya zaman aşımına uğramış.");

      var hwTableZ = readSheetTable(ss, "Laptoplar");
      var hwRowsZ = findHardwareRows(hwTableZ, data.hardwareIds, verifiedUser);
      var hwDataZ = hwTableZ.values;
      var hHeadersZ = hwTableZ.headers;
      var histColZ = requireHeader(hHeadersZ, ["Geçmiş"]);
      var durumColZ = requireHeader(hHeadersZ, ["Cihaz Durumu"]);
      var userColZ = requireHeader(hHeadersZ, ["Kullanıcı", "Kullanici"]);
      var driveColZ = requireHeader(hHeadersZ, ["Drive Linki"]);

      // 1. Cihazları ve Aksesuarları HTML Tablosu satırlarına çevir
      var hardwareTableRows = "";
      for (var iZ = 0; iZ < hwRowsZ.length; iZ++) {
        var hwZ = hwRowsZ[iZ];
        if (hwZ.status === "TRANSFER") throw new Error("Cihaz transferde: " + hwZ.serial);
        if (!isReturn && hwZ.status === "HURDA") throw new Error("HATA: Hurda durumundaki cihaz zimmetlenemez: " + hwZ.serial);
        if (isReturn && hwZ.assignedTo !== data.personId.toString()) throw new Error("HATA: Cihaz bu personele ait değil: " + hwZ.serial);
        
        hardwareTableRows += "<tr><td style='border:1px solid #000;padding:6px;'>" + (iZ + 1) + "</td><td style='border:1px solid #000;padding:6px;'>" + escapeHtml(hwZ.type) + "</td><td style='border:1px solid #000;padding:6px;'>" + escapeHtml(hwZ.brand + " " + hwZ.model) + "</td><td style='border:1px solid #000;padding:6px;'>" + escapeHtml(hwZ.serial) + "</td></tr>";
      }

      // Aksesuarları tabloya ekle
      var requestedHardwareList = data.hardwareList || [];
      for (var a = 0; a < requestedHardwareList.length; a++) {
        if (requestedHardwareList[a].type === 'Aksesuar') {
          hardwareTableRows += "<tr><td style='border:1px solid #000;padding:6px;'>-</td><td style='border:1px solid #000;padding:6px;'>Aksesuar</td><td style='border:1px solid #000;padding:6px;'>" + escapeHtml((requestedHardwareList[a].brand || "") + " " + (requestedHardwareList[a].model || "")) + "</td><td style='border:1px solid #000;padding:6px;'>-</td></tr>";
        }
      }

      var currentTime = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
      var today = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy");

      var baslik = isReturn ? "DONANIM İADE TUTANAĞI" : "DONANIM ZİMMET TESLİM TUTANAĞI";
      var personTitleStr = data.personTitle && data.personTitle !== 'Personel' ? " - " + escapeHtml(data.personTitle) : "";
      
      // Not ve İade açıklamalarının dinamik olarak PDF'e eklenmesi
      var altMetin = isReturn 
          ? "Yukarıda marka, model ve seri numarası belirtilen İSTEK İstanbul Eğitim Hizmetleri A.Ş. mülkiyetindeki donanım, <strong>" + today + "</strong> tarihinde aşağıda imzası bulunan personel tarafından Bilgi İşlem (IT) departmanına iade edilmiştir.<br><br><strong>Cihazın İade Anındaki Durumu: </strong>" + (data.returnCondition === 'eksiksiz' ? "Eksiksiz, hasarsız ve çalışır durumda." : ("Hasarlı/Eksik: " + escapeHtml(data.returnExplanation)))
          : "Yukarıda marka, model ve seri numarası belirtilen İSTEK İstanbul Eğitim Hizmetleri A.Ş. mülkiyetindeki donanım, <strong>" + today + "</strong> tarihinde tarafıma eksiksiz ve sorunsuz olarak teslim edilmiştir. Cihazı, 'Bilişim Kaynaklarını Kullanma Yönergesi' şartlarına uygun şekilde kullanacağımı, donanıma herhangi bir zarar verdiğim takdirde vermiş olduğum zarara ilişkin tutarın ücretimden, tazminatlarımdan ve diğer tüm hak edişlerimden kesilmesine nakden ve defaten muvafakat ettiğimi kabul ve beyan ederim." + 
            (data.zimmetExplanation ? "<br><br><strong>Ek Açıklama / Not:</strong> " + escapeHtml(data.zimmetExplanation) : "");

      // 2. Google Apps Script için ŞIK HTML Şablonu (1. Sayfa)
      var page1 = "<div style='padding: 10px 30px; font-family: Arial, sans-serif; font-size: 11px; color: #000; line-height: 1.4;'>" +
        "<h3 style='text-align: center; font-weight: bold; font-size: 15px; margin-bottom: 20px; text-decoration: underline;'>" + baslik + "</h3>" +
        
        "<table style='width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px;'>" +
          "<tr><td colspan='2' style='background-color: #f9fafb; border: 1px solid #000; padding: 6px; font-weight: bold; text-align: center;'>İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.</td></tr>" +
          "<tr><td style='border: 1px solid #000; padding: 6px; font-weight: bold; width: 25%;'>KAMPÜS / OKUL</td><td style='border: 1px solid #000; padding: 6px;'>" + escapeHtml(data.campus) + "</td></tr>" +
          "<tr><td style='border: 1px solid #000; padding: 6px; font-weight: bold;'>PERSONEL / ÜNVAN</td><td style='border: 1px solid #000; padding: 6px;'>" + escapeHtml(personData.name) + personTitleStr + "</td></tr>" +
        "</table>" +

        "<table style='width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 11px; text-align: center;'>" +
          "<tr style='background-color: #f9fafb;'><th colspan='4' style='border: 1px solid #000; padding: 6px; font-weight: bold;'>İLGİLİ DONANIM BİLGİLERİ</th></tr>" +
          "<tr>" +
            "<th style='border: 1px solid #000; padding: 6px; width: 60px; font-weight: bold;'>SIRA NO</th>" +
            "<th style='border: 1px solid #000; padding: 6px; font-weight: bold;'>CİHAZ TİPİ</th>" +
            "<th style='border: 1px solid #000; padding: 6px; font-weight: bold;'>MARKA / MODEL</th>" +
            "<th style='border: 1px solid #000; padding: 6px; font-weight: bold;'>SERİ NUMARASI</th>" +
          "</tr>" +
          hardwareTableRows +
        "</table>" +

        "<p style='text-align: justify; margin-bottom: 40px; font-size: 12px; line-height: 1.6;'>" + altMetin + "</p>" +

        // 1. Sayfa İmzaları - İSİM HATASI DÜZELTİLDİ (data.itName kullanılıyor)
        "<table style='width: 100%; text-align: center; border: none; margin-top: 50px;'>" +
          "<tr>" +
            "<td style='width: 50%; border: none; vertical-align: top;'>" +
              "<div style='font-size: 12px; margin-bottom: 4px;'><strong>" + (isReturn ? "İade Eden Personel" : "Teslim Alan Personel") + "</strong></div>" +
              "<div style='font-size: 13px; font-weight: bold; margin-bottom: 10px;'>" + escapeHtml(personData.name) + "</div>" +
              "<img src='" + data.personSignature + "' style='height: 60px; max-width: 150px;'/>" +
              "<div style='font-family: monospace; font-size: 8px; color: #666; margin-top: 5px;'>OTP ID: " + escapeHtml(data.personOtpHash) + "</div>" +
            "</td>" +
            "<td style='width: 50%; border: none; vertical-align: top;'>" +
              "<div style='font-size: 12px; margin-bottom: 4px;'><strong>" + (isReturn ? "Teslim Alan (IT)" : "Teslim Eden (IT)") + "</strong></div>" +
              "<div style='font-size: 13px; font-weight: bold; margin-bottom: 10px;'>" + escapeHtml(data.itName) + "</div>" +
              "<img src='" + data.itSignature + "' style='height: 60px; max-width: 150px;'/>" +
            "</td>" +
          "</tr>" +
        "</table>" +
        "</div>";

      // 3. Yönerge Şablonu (2. Sayfa - Tam düzeltilmiş ve daraltılmış hali)
      var page2 = "<div style='page-break-before: always; padding: 20px 30px; font-family: Arial, sans-serif; font-size: 11px; color: #000; line-height: 1.4;'>" +
        "<div style='text-align: center; font-weight: bold; margin-bottom: 20px;'>" +
          "<h2 style='font-size: 15px; margin: 0 0 8px 0;'>İSTEK İSTANBUL EĞİTİM HİZMETLERİ A.Ş.</h2>" +
          "<h2 style='font-size: 14px; margin: 0;'>BİLGİ İŞLEM DİZÜSTÜ BİLGİSAYAR KULLANIM YÖNERGESİ</h2>" +
        "</div>" +

        "<div>" +
          "<p style='margin-bottom: 6px;'><strong>1. Bilgisayar Kullanım Kuralları</strong></p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>a)</strong> Hizmet Paketi kapsamında personel kullanımına verilen dizüstü bilgisayarlar İSTEK İstanbul Eğitim Hizmetleri A.Ş mülkiyetindedir. Bilişim Kaynaklarını Kullanma Yönergesi'nde belirtilen yararlanma koşullarına uygun olarak, personelin sözleşmesi süresince kullanımına tahsis edilir.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>b)</strong> Personel genel müdürlük ve insan kaynakları departmanı tarafından duyurulan tarihte bilgisayarını tüm aksesuarları ile birlikte iade etmekle sorumludur. Üzerinde etiket, yazı vs. kesinlikle olmamalıdır.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>c)</strong> Geçici veya daimi olarak ayrılan personel, bilgisayarını aldığı haliyle iade etmek zorundadır.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>d)</strong> Personel İşveren tarafından kendisine tahsis edilecek dizüstü bilgisayarı ve bilgisayarda yer alan her türlü veriyi işveren tarafından belirlenecek amaçlar ve işin yürütümü ile ilgili olarak kullanmakla yükümlüdür. Buna aykırılık halinde, Personel İşveren' in kişisel veriler de dahil olmak üzere verileri kullanabileceğini, kontrol edebileceğini, fesih gerekçesi olarak kullanabileceğini ve bu durumun kişisel verilerin gizliliğine aykırılık teşkil etmeyeceğini kabul ve beyan eder.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>e)</strong> Personel işverenin izni olmaksızın kullanımına verilen dizüstü bilgisayara herhangi bir program <u>yüklemeyeceğini</u>, buna aykırılık halinde söz konusu programın yüklenmesinden doğan her türlü zarardan (lisanssız ürün kullanımından doğan ceza ve tazminat sorumluluğu da dahil olmak üzere) kendisinin sorumlu olacağını kabul ve beyan eder.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>f)</strong> Personel bilgi işlemin onayı olmadan kullanımına verilen dizüstü bilgisayara kurum dışında herhangi bir donanımsal müdahale, onarım işlemi <u>yapmayacağını</u> (tamir) buna aykırılık halinde söz konusu müdahaleden ötürü her türlü zarardan kendisinin sorumlu olacağını kabul ve beyan eder.</p>" +

          "<p style='margin-top: 15px; margin-bottom: 6px;'><strong>2. Garanti Kapsamı</strong></p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>a)</strong> Kullanıma verilen dizüstü bilgisayar, Dizüstü Bilgisayar Hizmet Paketi kapsamında üretiminden kaynaklanan hata, kusur veya arızalar için üretici firma garantisi altındadır.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>b)</strong> Garanti koşullarını açıklayıcı belgeler dizüstü bilgisayar ile birlikte verilmektedir. Dizüstü Bilgisayar Hizmet Paketi kapsamında sağlanan destek hizmetleri yurtdışında geçerli değildir.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>c)</strong> Personel arzu ettiği takdirde ücretini kendisi karşılamak kaydıyla bilgisayarı sigortalatabilir.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>d)</strong> Personelin bilgi ve belgelerinin yedekleme sorumluluğu kendisine aittir. Bütün yedeklerini Google drive hesabına alabilir.</p>" +

          "<p style='margin-top: 15px; margin-bottom: 6px;'><strong>3. Ödemeler ve Cezai Yükümlülükler</strong></p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>a)</strong> Garanti kapsamına girmeyen kusur, ihmal veya dikkatsizlik sonucu bilgisayarda meydana gelebilecek hasarlardan dolayı personel, Bilgi İşlem Müdürlüğü tarafından kendisine yapılan bildirimi takiben en geç 15 gün içerisinde, arızalı parça ve/veya tamir bedelini ödemekle yükümlüdür.</p>" +
          "<p style='margin-bottom: 6px; text-align: justify;'><strong>b)</strong> Herhangi bir nedenle iş akdi feshedilen personel bilgisayarını teslim aldığı şekilde iade etmezse, teslim belgesi ve ilgili yönergelere dayanarak İSTEK İstanbul Eğitim Hizmetleri A.Ş tarafından aleyhinde yasal takip başlatılır, tüm aksesuarları ile birlikte bilgisayar veya bedeli ilgili distribütörün vereceği satış fiyatı üzerinden yasal faizleri ile birlikte talep edilir.</p>" +
        "</div>" +

        // 2. Sayfa İmzaları
        "<table style='width: 100%; text-align: center; border: none; margin-top: 25px;'>" +
          "<tr>" +
            "<td style='width: 50%; border: none; vertical-align: top;'>" +
              "<div style='font-size: 12px; font-weight: bold; margin-bottom: 4px;'>Tebellüğ Eden (Personel)</div>" +
              "<div style='font-size: 13px; margin-bottom: 10px;'>" + escapeHtml(personData.name) + "</div>" +
              "<img src='" + data.personSignature + "' style='height: 50px; max-width: 150px;'/>" +
            "</td>" +
            "<td style='width: 50%; border: none; vertical-align: top;'>" +
              "<div style='font-size: 12px; font-weight: bold; margin-bottom: 4px;'>Tebliğ Eden (IT)</div>" +
              "<div style='font-size: 13px; margin-bottom: 10px;'>" + escapeHtml(data.itName) + "</div>" +
              "<img src='" + data.itSignature + "' style='height: 50px; max-width: 150px;'/>" +
            "</td>" +
          "</tr>" +
        "</table>" +

        "<div style='margin-top: 25px; font-size: 9px; color: #777; border-top: 1px solid #ccc; padding-top: 10px;'>" +
           "<strong>DİJİTAL İŞLEM LOGU:</strong> IP: " + escapeHtml(data.clientIp || "Bilinmiyor") + " | Zaman: " + currentTime + " | Yetkili: " + escapeHtml(data.itEmail) + 
        "</div>" +
      "</div>";

      // 4. İki sayfayı birleştirip Google Sunucularında PDF'e Çeviriyoruz
      var blobZ = Utilities.newBlob("<html><body>" + page1 + page2 + "</body></html>", MimeType.HTML).getAs(MimeType.PDF);
      blobZ.setName(sanitizeFileName(data.pdfName, isReturn ? "iade.pdf" : "zimmet.pdf"));
      var pdfHashZ = generateSHA256Hash(blobZ);
      var fileUrlZ = getOrCreateCampusFolder(ROOT_FOLDER_ID, verifiedUser.campus).createFile(blobZ).getUrl();

      // Excel Kayıt İşlemleri
      for (var kZ = 0; kZ < hwRowsZ.length; kZ++) {
        var rwZ = hwRowsZ[kZ].rowIdx;
        var histZ = parseHistory(hwDataZ[rwZ][histColZ]);
        if (isReturn) {
          hwDataZ[rwZ][durumColZ] = "DEPODA";
          hwDataZ[rwZ][userColZ] = "";
          histZ.unshift({ personName: personData.name, date: today, driveLink: fileUrlZ, type: 'İade' });
        } else {
          hwDataZ[rwZ][durumColZ] = sheetStatusActive_();
          hwDataZ[rwZ][userColZ] = personData.id;
          histZ.unshift({ personName: personData.name, date: today, driveLink: fileUrlZ, type: hwRowsZ[kZ].status === 'AKTIF' ? 'Zimmet (Üzerine Yazıldı)' : 'Zimmet' });
        }
        hwDataZ[rwZ][driveColZ] = fileUrlZ;
        hwDataZ[rwZ][histColZ] = JSON.stringify(histZ);
      }
      hwTableZ.sheet.getDataRange().setValues(hwDataZ);
      CacheService.getScriptCache().remove('VALID_OTP_' + data.personOtpHash);
      appendSecureLog(ss, isReturn ? "İADE" : "ZİMMET", sessionEmail, personData.name + " -> " + hwRowsZ.length + " cihaz", pdfHashZ, fileUrlZ, data.clientIp);

      // --- KURUMSAL VE UZUN E-POSTA GÖNDERİMİ (Senin 09:12 İstediğin Format) ---
      try {
        var mailOptions = { attachments: [blobZ], name: "İSTEK Demirbaş Yönetim Sistemi" };
        var hasPersonEmail = (personData.email && personData.email.indexOf("@") > -1);
        var toEmail = hasPersonEmail ? personData.email : data.itEmail; 
        
        if (hasPersonEmail && data.itEmail) {
           mailOptions.cc = data.itEmail;
           mailOptions.replyTo = data.itEmail;
        }

        var subject = isReturn ? "BİLGİLENDİRME: Donanım İade İşlemi Tamamlandı" : "ÖNEMLİ: Yeni Donanım Zimmet Bilgilendirmesi";
        var body = isReturn 
            ? "Sayın " + data.personName + ",\n\nÜzerinizde zimmetli olan donanımların iade işlemi başarıyla tamamlanmıştır. Cihazın iade anındaki fiziksel durum raporu ve karşılıklı atılan imzalar ekteki PDF tutanağında yer almaktadır.\n\nBilgilerinize sunar, iyi çalışmalar dileriz."
            : "Sayın " + data.personName + ",\n\nEkteki PDF tutanağında belirtilen cihazlar şahsen tarafınıza teslim edilmiştir. E-Posta doğrulama kodunuz ile cihazı eksiksiz teslim aldığınızı onayladınız.\n\nEğer bu cihazı teslim almadıysanız veya tutanakta bir hata olduğunu düşünüyorsanız, lütfen 24 saat içerisinde \"Tümünü Yanıtla\" diyerek IT departmanına itirazınızı bildiriniz.\n\nİyi çalışmalar dileriz.";
        
        GmailApp.sendEmail(toEmail, subject, body, mailOptions);
      } catch (mailErr) {
        appendSecureLog(ss, "MAIL HATASI", sessionEmail, mailErr.message, "-", fileUrlZ, data.clientIp);
      }
      return jsonOut({ success: true, url: fileUrlZ });
    }

    if (data.action === 'manualAssign' || data.action === 'uploadMissingDocument') {
      var fileInfo = validateUploadedFile(data.pdfData, data.pdfName);
      var hwTableM = readSheetTable(ss, "Laptoplar");
      var hwRowsM = findHardwareRows(hwTableM, [data.hardwareId], verifiedUser);
      var targetHw = hwRowsM[0];
      if (targetHw.status === "TRANSFER") throw new Error("Cihaz transferde.");

      var personM = { name: data.personName || "Personel", id: "" };
      if (data.action === 'manualAssign') {
        if (targetHw.status === "AKTIF") throw new Error("Cihaz zaten başkasına zimmetli.");
        personM = getPersonDetails(ss, data.personId);
        if (verifiedUser.role !== "HQ IT" && personM.campus && getCoreNameStr(personM.campus) !== getCoreNameStr(verifiedUser.campus)) {
          throw new Error("Farklı kampüs personeline manuel zimmet yapılamaz.");
        }
      }

      var blobM = Utilities.newBlob(fileInfo.bytes, fileInfo.mimeType, fileInfo.fileName);
      var fileHashM = generateSHA256Hash(blobM);
      var fileUrlM = getOrCreateCampusFolder(ROOT_FOLDER_ID, targetHw.campus || verifiedUser.campus).createFile(blobM).getUrl();
      var hwDataM = hwTableM.values;
      var histColM = requireHeader(hwTableM.headers, ["Geçmiş"]);
      var histM = parseHistory(hwDataM[targetHw.rowIdx][histColM]);
      if (data.action === 'manualAssign') {
        hwDataM[targetHw.rowIdx][requireHeader(hwTableM.headers, ["Cihaz Durumu"])] = sheetStatusActive_();
        hwDataM[targetHw.rowIdx][requireHeader(hwTableM.headers, ["Kullanıcı", "Kullanici"])] = personM.id;
        histM.unshift({ personName: personM.name, date: Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy"), driveLink: fileUrlM, type: 'Manuel Zimmet' });
      } else {
        histM.unshift({ personName: personM.name, date: Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy"), driveLink: fileUrlM, type: 'Eksik Belge' });
      }
      hwDataM[targetHw.rowIdx][requireHeader(hwTableM.headers, ["Drive Linki"])] = fileUrlM;
      hwDataM[targetHw.rowIdx][histColM] = JSON.stringify(histM);
      hwTableM.sheet.getDataRange().setValues(hwDataM);
      appendSecureLog(ss, data.action.toUpperCase(), sessionEmail, "S/N: " + data.hardwareId, fileHashM, fileUrlM, data.clientIp);
      return jsonOut({ success: true, url: fileUrlM });
    }

    // =========================================================================
    // TASARIMLI PDF - TRANSFER OLUŞTURMA (09:12 KODUNDAN GETİRİLDİ)
    // =========================================================================
    if (data.action === 'startTransferServerSide' || data.action === 'completeTransferServerSide') {
      if (!validateSignature(data.transferSignature)) throw new Error("Geçersiz transfer imzası (String hatası).");
      var isOut = data.action === 'startTransferServerSide';
      var targetCamp = cleanCampusName(isOut ? data.targetCampus : data.receiverCampus);
      var hwTableT = readSheetTable(ss, "Laptoplar");
      var hwRowsT = isOut
        ? findHardwareRows(hwTableT, data.hardwareIds, verifiedUser, { requireStatus: 'DEPODA' })
        : findHardwareRows(hwTableT, data.hardwareIds, verifiedUser, { skipCampusCheck: true, requireStatus: 'TRANSFER' });

      if (!isOut) {
        for (var pre = 0; pre < hwRowsT.length; pre++) {
          var campusNow = hwTableT.values[hwRowsT[pre].rowIdx][requireHeader(hwTableT.headers, ["Kampüs", "Kampus"])];
          if (getCoreNameStr(campusNow) !== getCoreNameStr(verifiedUser.campus)) {
            throw new Error("Bu cihaz sizin kampüsünüze gönderilmemiş: " + hwRowsT[pre].serial);
          }
        }
      }

      // LOGOYU BASE64'E ÇEVİREREK PDF'E GARANTİLİ GÖMME
      var logoBase64Html = "";
      try {
        var logoFetch = UrlFetchApp.fetch("https://istek.site/logo/Kurum_Genel_Logo-01.png");
        var logoB64 = Utilities.base64Encode(logoFetch.getBlob().getBytes());
        logoBase64Html = "<img src='data:image/png;base64," + logoB64 + "' style='height: 50px;'/>";
      } catch(e) {
        logoBase64Html = "<h2>İSTEK OKULLARI</h2>"; 
      }

      var currentTime3 = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy HH:mm:ss");
      var today3 = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy");

      var hardwareTableRowsTransfer = "";
      for(var t=0; t < hwRowsT.length; t++) {
         var hwT = hwRowsT[t];
         hardwareTableRowsTransfer += "<tr>" +
           "<td style='border: 1px solid #000; padding: 6px; text-align: center;'>" + (t+1) + "</td>" +
           "<td style='border: 1px solid #000; padding: 6px; text-align: center;'>" + escapeHtml(hwT.type) + "</td>" +
           "<td style='border: 1px solid #000; padding: 6px; text-align: center;'>" + escapeHtml(hwT.brand + " " + hwT.model) + "</td>" +
           "<td style='border: 1px solid #000; padding: 6px; text-align: center;'>" + escapeHtml(hwT.serial) + "</td>" +
         "</tr>";
      }

      var htmlTransfer = "<html><body style='font-family: Arial, sans-serif; font-size: 11px; color: #000; line-height: 1.4; padding: 20px 25px;'>" +
        "<div style='margin-bottom: 30px;'>" + logoBase64Html + "</div>" +
        
        "<div style='text-align: center; margin-bottom: 40px;'>" +
          "<h3 style='font-size: 15px; font-weight: bold; margin: 0 0 10px 0;'>İSTEK OKULLARI GENEL MÜDÜRLÜĞÜ</h3>" +
          "<h3 style='font-size: 14px; font-weight: bold; margin: 0 0 10px 0;'>BİLGİ İŞLEM DEPARTMANI</h3>" +
          "<h3 style='font-size: 15px; font-weight: bold; margin: 0; text-decoration: underline;'>TRANSFER TESLİM TUTANAĞI</h3>" +
        "</div>" +

        "<p style='text-align: justify; margin-bottom: 30px; text-indent: 30px; font-size: 12px; line-height: 1.5;'>" +
          "İş bu tutanak aşağıda belirtilen marka, model ve seri numarası yazılı donanımlar, İSTEK <strong>" + 
          (isOut ? escapeHtml(data.targetCampus) : escapeHtml(data.receiverCampus)).toUpperCase() + 
          "</strong> bilgi işlem departmanına kullanılmak üzere teslim edilmiştir." +
        "</p>" +

        "<table style='width: 100%; border-collapse: collapse; margin-bottom: 40px; font-size: 11px;'>" +
          "<tr style='background-color: #f3f4f6;'>" +
            "<th style='border: 1px solid #000; padding: 8px; text-align: center; width: 50px;'>SIRA NO</th>" +
            "<th style='border: 1px solid #000; padding: 8px; text-align: center;'>CİHAZ TİPİ</th>" +
            "<th style='border: 1px solid #000; padding: 8px; text-align: center;'>MARKA / MODEL</th>" +
            "<th style='border: 1px solid #000; padding: 8px; text-align: center;'>SERİ NO</th>" +
          "</tr>" +
          hardwareTableRowsTransfer +
        "</table>" +

        "<div style='text-align: right; margin-bottom: 50px; font-weight: bold; font-size: 12px;'>İşlem Tarihi: " + today3 + "</div>" +

        "<table style='width: 100%; text-align: center; border: none; margin-top: 20px;'>" +
          "<tr>" +
            "<td style='width: 50%; border: none; vertical-align: top;'>" +
              "<div style='font-size: 12px; font-weight: bold; text-decoration: underline; margin-bottom: 20px;'>Teslim Eden (Gönderen)</div>" +
              "<div style='font-size: 13px; margin-bottom: 10px;'>" + (isOut ? escapeHtml(data.itName) : "Bilgi İşlem Sorumlusu") + "</div>" +
              (isOut ? "<img src='" + data.transferSignature + "' style='height: 60px; max-width: 150px;'/>" : "") +
            "</td>" +
            "<td style='width: 50%; border: none; vertical-align: top;'>" +
              "<div style='font-size: 12px; font-weight: bold; text-decoration: underline; margin-bottom: 20px;'>Teslim Alan (Alıcı)</div>" +
              "<div style='font-size: 13px; margin-bottom: 10px;'>" + (!isOut ? escapeHtml(data.itName) : "Bilgi İşlem Sorumlusu") + "</div>" +
              (!isOut ? "<img src='" + data.transferSignature + "' style='height: 60px; max-width: 150px;'/>" : "") +
            "</td>" +
          "</tr>" +
        "</table>" +
        
        "<div style='margin-top: 100px; font-size: 9px; color: #777; border-top: 1px solid #ccc; padding-top: 10px;'>" +
           "<strong>DİJİTAL İŞLEM LOGU:</strong> IP: " + escapeHtml(data.clientIp || "Bilinmiyor") + " | Zaman: " + currentTime3 + " | IT Yetkilisi: " + escapeHtml(data.currentUserEmail) + 
        "</div>" +
        "</body></html>";

      var blobT = Utilities.newBlob(htmlTransfer, MimeType.HTML).getAs(MimeType.PDF);
      blobT.setName(sanitizeFileName(data.pdfName, "transfer.pdf"));
      var pdfHashT = generateSHA256Hash(blobT);
      var fileUrlT = getOrCreateCampusFolder(ROOT_FOLDER_ID, targetCamp).createFile(blobT).getUrl();

      var hwDataT = hwTableT.values;
      var hHeadersT = hwTableT.headers;
      var dColT = requireHeader(hHeadersT, ["Cihaz Durumu"]);
      var uColT = requireHeader(hHeadersT, ["Kullanıcı", "Kullanici"]);
      var cColT = requireHeader(hHeadersT, ["Kampüs", "Kampus"]);
      var driveColT = requireHeader(hHeadersT, ["Drive Linki"]);
      var histColT = requireHeader(hHeadersT, ["Geçmiş"]);

      // KAMPÜS ADI TEMİZLEME FONKSİYONU (TRANSFER ESNASINDA VERİTABANINA "Acıbadem" OLARAK KAYDEDİLSİN DİYE)
      function getShortCampusName(c) {
         if(!c) return "";
         return c.toString().replace(/Kampüsü/gi, "").replace(/Kampusu/gi, "").replace(/Kampüs/gi, "").replace(/Kampus/gi, "").trim();
      }

      for (var kT = 0; kT < hwRowsT.length; kT++) {
        var rwT = hwRowsT[kT].rowIdx;
        var histT = parseHistory(hwDataT[rwT][histColT]);
        if (isOut) {
          hwDataT[rwT][dColT] = "TRANSFER";
          hwDataT[rwT][uColT] = "GÖNDEREN:" + getShortCampusName(data.senderCampus);
          hwDataT[rwT][cColT] = getShortCampusName(data.targetCampus);
          histT.unshift({ personName: sessionEmail, date: today3, driveLink: fileUrlT, type: "Kampüs Çıkış (" + getShortCampusName(data.senderCampus) + ")" });
        } else {
          hwDataT[rwT][dColT] = "DEPODA";
          hwDataT[rwT][uColT] = "";
          hwDataT[rwT][cColT] = getShortCampusName(data.receiverCampus);
          histT.unshift({ personName: sessionEmail, date: today3, driveLink: fileUrlT, type: "Kampüs Giriş (" + getShortCampusName(data.receiverCampus) + ")" });
        }
        hwDataT[rwT][driveColT] = fileUrlT;
        hwDataT[rwT][histColT] = JSON.stringify(histT);
      }
      hwTableT.sheet.getDataRange().setValues(hwDataT);
      appendSecureLog(ss, "TRANSFER " + (isOut ? "ÇIKIŞ" : "GİRİŞ"), sessionEmail, hwRowsT.length + " cihaz -> " + targetCamp, pdfHashT, fileUrlT, data.clientIp);
      
      try {
        var mailOptionsTransfer = { attachments: [blobT], name: "İSTEK Demirbaş Yönetim Sistemi" };
        var toTransferEmail = data.currentUserEmail; 
        
        if (data.targetItEmail && data.targetItEmail.indexOf("@") > -1) { 
           toTransferEmail = data.targetItEmail;
           mailOptionsTransfer.cc = data.currentUserEmail;
           mailOptionsTransfer.replyTo = data.currentUserEmail;
        }

        if (isOut) {
          GmailApp.sendEmail(toTransferEmail, "BİLGİLENDİRME: Kampüsler Arası Cihaz Transferi (Çıkış)", "Merhaba,\n\n" + data.senderCampus + " kampüsünden " + data.targetCampus + " kampüsüne donanım gönderimi başlatılmıştır. İlgili çıkış tutanağı ve cihaz listesi ektedir.\n\nLütfen cihazlar size ulaştığında sistem üzerinden 'Teslim Al' işlemi yaparak donanımları kendi envanterinize geçiriniz.\n\nİyi çalışmalar.", mailOptionsTransfer);
        } else {
          GmailApp.sendEmail(toTransferEmail, "BİLGİLENDİRME: Kampüsler Arası Cihaz Transferi (Teslim Alındı)", "Merhaba,\n\n" + data.senderCampus + " kampüsünden " + data.receiverCampus + " kampüsüne gönderilen donanımlar başarıyla teslim alınmış ve envantere eklenmiştir. İlgili giriş tutanağı ektedir.\n\nİyi çalışmalar.", mailOptionsTransfer);
        }
      } catch(err) { 
        console.error("Transfer Mail hatası: " + err.message); 
      }

      return jsonOut({ success: true, url: fileUrlT });
    }

    if (data.action === 'cancelTransfer') {
      var hwTableC = readSheetTable(ss, "Laptoplar");
      var hwRowsC = findHardwareRows(hwTableC, data.hardwareIds, verifiedUser, { skipCampusCheck: true, requireStatus: 'TRANSFER' });
      var hwDataC = hwTableC.values;
      var userColC = requireHeader(hwTableC.headers, ["Kullanıcı", "Kullanici"]);
      var durumColC = requireHeader(hwTableC.headers, ["Cihaz Durumu"]);
      var campusColC = requireHeader(hwTableC.headers, ["Kampüs", "Kampus"]);
      var histColC = requireHeader(hwTableC.headers, ["Geçmiş"]);
      
      function getShortCampusNameForCancel(c) {
         if(!c) return "";
         return c.toString().replace(/Kampüsü/gi, "").replace(/Kampusu/gi, "").replace(/Kampüs/gi, "").replace(/Kampus/gi, "").trim();
      }

      for (var kC = 0; kC < hwRowsC.length; kC++) {
        var rwC = hwRowsC[kC].rowIdx;
        var senderStr = hwDataC[rwC][userColC].toString();
        var senderRaw = senderStr.replace(/^GÖNDEREN:/i, "").replace(/^GONDEREN:/i, "").trim();
        if (verifiedUser.role !== "HQ IT" && getCoreNameStr(senderRaw) !== getCoreNameStr(verifiedUser.campus)) {
          throw new Error("Sadece kendi gönderdiğiniz transferi iptal edebilirsiniz.");
        }
        hwDataC[rwC][durumColC] = "DEPODA";
        hwDataC[rwC][userColC] = "";
        hwDataC[rwC][campusColC] = senderRaw ? senderRaw : getShortCampusNameForCancel(verifiedUser.campus);
        var histC = parseHistory(hwDataC[rwC][histColC]);
        histC.unshift({ personName: sessionEmail, date: Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy"), type: "Transfer İptal" });
        hwDataC[rwC][histColC] = JSON.stringify(histC);
      }
      hwTableC.sheet.getDataRange().setValues(hwDataC);
      appendSecureLog(ss, "TRANSFER İPTAL", sessionEmail, hwRowsC.length + " cihaz geri çekildi", "-", "-", data.clientIp);
      return jsonOut({ success: true });
    }

    throw new Error("Bilinmeyen işlem eylemi (Action Not Found).");
  } catch (error) {
    return jsonOut({ success: false, error: error.message });
  } finally {
    if (needsLock) lock.releaseLock();
  }
}

// Admin SDK yetkisi olan ortamlarda kullanilabilir.
function updateProfilePhotos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Kullanıcılar");
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = 0;
  var photoCol = headers.indexOf("Profil Fotoğrafı");
  if (photoCol === -1) {
    photoCol = headers.length;
    sheet.getRange(1, photoCol + 1).setValue("Profil Fotoğrafı");
  }

  for (var i = 1; i < data.length; i++) {
    var userId = data[i][idCol];
    if (userId) {
      try {
        var user = AdminDirectory.Users.get(userId.toString());
        if (user.thumbnailPhotoUrl) sheet.getRange(i + 1, photoCol + 1).setValue(user.thumbnailPhotoUrl);
      } catch (e) {}
    }
  }
}

function izinIste() {
  UrlFetchApp.fetch("https://google.com");
}
