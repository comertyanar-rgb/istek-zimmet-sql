/*
  Drop-in security patches for the Apps Script backend.

  How to use:
  1. Paste the helper section below after appendSecureLog(...).
  2. Replace the matching action blocks in doPost(e) with the secure blocks below.
  3. Add the final "unknown action" throw just before catch(error).
*/

// ================================
// Helper section
// ================================

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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

function getHeaderIndex(headers, names) {
  for (var i = 0; i < names.length; i++) {
    var idx = headers.indexOf(names[i]);
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
  if (!sheet) throw new Error("Sayfa bulunamadi: " + sheetName);
  var values = sheet.getDataRange().getValues();
  if (!values || values.length === 0) throw new Error(sheetName + " sayfasi bos.");
  return { sheet: sheet, values: values, headers: values[0] };
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

function assertUserCanAccessCampus(verifiedUser, campus, message) {
  if (verifiedUser.role === "HQ IT") return;
  if (getCoreNameStr(campus) !== getCoreNameStr(verifiedUser.campus)) {
    throw new Error(message || ("Yetkisiz kampus: " + campus));
  }
}

function findHardwareRows(table, ids, verifiedUser, options) {
  options = options || {};
  ids = normalizeIdArray(ids);
  if (ids.length === 0) throw new Error("Cihaz secimi bos.");

  var headers = table.headers;
  var seriCol = requireHeader(headers, ["Seri no"], "Seri no");
  var campusCol = requireHeader(headers, ["Kampus", "Kampüs"], "Kampus");
  var statusCol = requireHeader(headers, ["Cihaz Durumu"], "Cihaz Durumu");
  var userCol = requireHeader(headers, ["Kullanici", "Kullanıcı"], "Kullanici");

  var wanted = {};
  for (var i = 0; i < ids.length; i++) wanted[ids[i]] = true;

  var rows = [];
  for (var r = 1; r < table.values.length; r++) {
    var serial = table.values[r][seriCol] ? table.values[r][seriCol].toString().trim() : "";
    if (!wanted[serial]) continue;

    var campus = table.values[r][campusCol] ? table.values[r][campusCol].toString().trim() : "";
    var status = table.values[r][statusCol] ? table.values[r][statusCol].toString().trim().toUpperCase() : "";
    var assignedTo = table.values[r][userCol] ? table.values[r][userCol].toString().trim() : "";

    assertUserCanAccessCampus(verifiedUser, campus, "Yetkisiz kampus cihazi: " + serial);

    if (options.requireStatus && status !== options.requireStatus) {
      throw new Error(serial + " icin beklenen durum " + options.requireStatus + ", mevcut durum " + status);
    }
    if (options.forbidStatus && status === options.forbidStatus) {
      throw new Error(serial + " bu durumda islenemez: " + status);
    }
    if (options.requireAssignedTo && assignedTo !== options.requireAssignedTo) {
      throw new Error("Cihaz bu personele zimmetli degil: " + serial);
    }

    rows.push({
      rowIndex: r,
      serial: serial,
      campus: campus,
      status: status,
      assignedTo: assignedTo
    });
  }

  if (rows.length !== ids.length) {
    throw new Error("Bazi cihazlar bulunamadi veya yetkisiz: " + ids.join(", "));
  }
  return rows;
}

function findUserRecord(table, personId, verifiedUser, options) {
  options = options || {};
  var headers = table.headers;
  var idCol = getHeaderIndex(headers, ["User Id", "Email", "E-Posta", "Kullanıcı", "Kullanici"]);
  var nameCol = getHeaderIndex(headers, ["Ad Soyad", "Adı Soyadı", "Isim Soyisim", "İsim Soyisim", "Name", "Kullanıcı", "Kullanici"]);
  var campusCol = getHeaderIndex(headers, ["Kampus", "Kampüs", "Okul"]);
  var emailCol = getHeaderIndex(headers, ["Email", "E-Posta"]);
  var deptCol = getHeaderIndex(headers, ["Department", "Departman", "Görev", "Gorev", "Unvan", "Ünvan"]);

  if (idCol === -1) throw new Error("Personel kimlik kolonu bulunamadi.");

  var wantedId = personId ? personId.toString().trim() : "";
  if (!wantedId) throw new Error("Personel secimi bos.");

  for (var r = 1; r < table.values.length; r++) {
    var id = table.values[r][idCol] ? table.values[r][idCol].toString().trim() : "";
    if (id !== wantedId) continue;

    var campus = campusCol > -1 && table.values[r][campusCol] ? table.values[r][campusCol].toString().trim() : "";
    if (options.enforceCampus) {
      assertUserCanAccessCampus(verifiedUser, campus, "Yetkisiz personel kampusu: " + campus);
    }

    var email = emailCol > -1 && table.values[r][emailCol] ? table.values[r][emailCol].toString().trim().toLowerCase() : "";
    return {
      id: id,
      name: nameCol > -1 && table.values[r][nameCol] ? table.values[r][nameCol].toString().trim() : id,
      campus: campus,
      email: email,
      department: deptCol > -1 && table.values[r][deptCol] ? table.values[r][deptCol].toString().trim() : "Personel"
    };
  }

  throw new Error("Personel bulunamadi: " + wantedId);
}

function sanitizeFileName(name, fallback) {
  var safe = (name || fallback || "belge.pdf").toString();
  safe = safe.replace(/[\/\\?%*:|"<>]/g, "-");
  return sanitizeExcel(safe);
}

function validateUploadedFile(base64Data, fileName) {
  if (!base64Data || typeof base64Data !== "string") throw new Error("Dosya verisi bulunamadi.");
  if (base64Data.length > 12000000) throw new Error("Dosya cok buyuk. Lutfen daha kucuk PDF/JPG yukleyin.");

  var lower = (fileName || "").toString().toLowerCase();
  var isPdf = lower.lastIndexOf(".pdf") === lower.length - 4;
  var isImage = /\.(jpg|jpeg|png)$/i.test(lower);
  if (!isPdf && !isImage) throw new Error("Sadece PDF/JPG/PNG dosyasi yuklenebilir.");

  var bytes = Utilities.base64Decode(base64Data);
  if (bytes.length < 4) throw new Error("Dosya gecersiz.");

  if (isPdf) {
    if (!(bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) {
      throw new Error("PDF imzasi gecersiz.");
    }
    return { bytes: bytes, mimeType: "application/pdf" };
  }

  if (lower.match(/\.png$/i)) {
    if (!(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) {
      throw new Error("PNG imzasi gecersiz.");
    }
    return { bytes: bytes, mimeType: "image/png" };
  }

  if (!(bytes[0] === 255 && bytes[1] === 216)) throw new Error("JPEG imzasi gecersiz.");
  return { bytes: bytes, mimeType: "image/jpeg" };
}

function getOrCreateChildFolder(parentFolder, name) {
  var folderName = cleanCampusName(name || "Bilinmiyor");
  var iter = parentFolder.getFoldersByName(folderName);
  return iter.hasNext() ? iter.next() : parentFolder.createFolder(folderName);
}

function addHistory(table, rowIndex, record) {
  var historyCol = requireHeader(table.headers, ["Gecmis", "Geçmiş"], "Gecmis");
  var history = parseHistory(table.values[rowIndex][historyCol]);
  history.unshift(record);
  table.values[rowIndex][historyCol] = JSON.stringify(history);
}

// ================================
// Replacement: fetchHardwareHistory
// ================================
/*
if (data.action === 'fetchHardwareHistory') {
  var hwTableHist = readSheetTable(ss, "Laptoplar");
  var rowsHist = findHardwareRows(hwTableHist, [data.hardwareId], verifiedUser, {});
  var historyColHist = requireHeader(hwTableHist.headers, ["Gecmis", "Geçmiş"], "Gecmis");
  var history = parseHistory(hwTableHist.values[rowsHist[0].rowIndex][historyColHist]);
  return jsonOut({ success: true, history: history });
}
*/

// ================================
// Replacement: uploadMissingDocument / manualAssign
// ================================
/*
if (data.action === 'uploadMissingDocument' || data.action === 'manualAssign') {
  var hwTableUpload = readSheetTable(ss, "Laptoplar");
  var hwRowsUpload = findHardwareRows(hwTableUpload, [data.hardwareId], verifiedUser, { forbidStatus: "TRANSFER" });
  var hwRowUpload = hwRowsUpload[0].rowIndex;

  var safeNameUpload = sanitizeFileName(data.pdfName, data.action + ".pdf");
  var fileInfoUpload = validateUploadedFile(data.pdfData, safeNameUpload);

  var personForManual = null;
  if (data.action === 'manualAssign') {
    var userTableManual = readSheetTable(ss, "Kullanıcılar");
    personForManual = findUserRecord(userTableManual, data.personId, verifiedUser, {});
  }

  var rootFolderUpload = DriveApp.getFolderById("0ACnbZT1gvSJtUk9PVA");
  var campusFolderUpload = getOrCreateChildFolder(rootFolderUpload, hwRowsUpload[0].campus);
  var blobUpload = Utilities.newBlob(fileInfoUpload.bytes, fileInfoUpload.mimeType, safeNameUpload);
  var fileHashUpload = generateSHA256Hash(blobUpload);
  var fileUrlUpload = campusFolderUpload.createFile(blobUpload).getUrl();

  var headersUpload = hwTableUpload.headers;
  var statusColUpload = requireHeader(headersUpload, ["Cihaz Durumu"], "Cihaz Durumu");
  var userColUpload = requireHeader(headersUpload, ["Kullanici", "Kullanıcı"], "Kullanici");
  var driveColUpload = requireHeader(headersUpload, ["Drive Linki"], "Drive Linki");
  var todayUpload = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy");

  if (data.action === 'manualAssign') {
    hwTableUpload.values[hwRowUpload][statusColUpload] = "AKTİF";
    hwTableUpload.values[hwRowUpload][userColUpload] = personForManual.id;
    addHistory(hwTableUpload, hwRowUpload, {
      personName: personForManual.name,
      date: todayUpload,
      driveLink: fileUrlUpload,
      type: "Manuel Zimmet"
    });
  } else {
    addHistory(hwTableUpload, hwRowUpload, {
      personName: sessionEmail,
      date: todayUpload,
      driveLink: fileUrlUpload,
      type: "Eksik Belge"
    });
  }

  hwTableUpload.values[hwRowUpload][driveColUpload] = fileUrlUpload;
  hwTableUpload.sheet.getDataRange().setValues(hwTableUpload.values);

  appendSecureLog(ss, data.action.toUpperCase(), sessionEmail, "S/N: " + data.hardwareId, fileHashUpload, fileUrlUpload, (data.clientIp || "") + " (Beyan)");
  return jsonOut({ success: true, url: fileUrlUpload });
}
*/

// ================================
// Replacement: transfer out/in
// ================================
/*
if (data.action === 'startTransferServerSide' || data.action === 'completeTransferServerSide') {
  if (!validateSignature(data.transferSignature)) throw new Error("Gecersiz transfer imzasi.");

  var isOutTransfer = data.action === 'startTransferServerSide';
  var hwTableTransfer = readSheetTable(ss, "Laptoplar");
  var idsTransfer = normalizeIdArray(data.hardwareIds);
  var requiredStatusTransfer = isOutTransfer ? "DEPODA" : "TRANSFER";
  var rowsTransfer = findHardwareRows(hwTableTransfer, idsTransfer, verifiedUser, { requireStatus: requiredStatusTransfer });

  var headersTransfer = hwTableTransfer.headers;
  var statusColTransfer = requireHeader(headersTransfer, ["Cihaz Durumu"], "Cihaz Durumu");
  var userColTransfer = requireHeader(headersTransfer, ["Kullanici", "Kullanıcı"], "Kullanici");
  var campusColTransfer = requireHeader(headersTransfer, ["Kampus", "Kampüs"], "Kampus");
  var driveColTransfer = requireHeader(headersTransfer, ["Drive Linki"], "Drive Linki");
  var typeColTransfer = getHeaderIndex(headersTransfer, ["Cihaz Tipi"]);
  var brandColTransfer = getHeaderIndex(headersTransfer, ["Marka"]);
  var modelColTransfer = getHeaderIndex(headersTransfer, ["Modeli"]);

  var senderCampusTransfer = isOutTransfer ? rowsTransfer[0].campus : data.senderCampus;
  var targetCampusTransfer = isOutTransfer ? cleanCampusName(data.targetCampus) : verifiedUser.campus;

  if (isOutTransfer) {
    for (var co = 0; co < rowsTransfer.length; co++) {
      assertUserCanAccessCampus(verifiedUser, rowsTransfer[co].campus, "Gonderen kampus siz degilsiniz.");
    }
  } else {
    for (var ci = 0; ci < rowsTransfer.length; ci++) {
      assertUserCanAccessCampus(verifiedUser, rowsTransfer[ci].campus, "Alici kampus siz degilsiniz.");
      var assignedTransfer = hwTableTransfer.values[rowsTransfer[ci].rowIndex][userColTransfer].toString();
      if (assignedTransfer.indexOf("GÖNDEREN:") !== 0 && assignedTransfer.indexOf("GONDEREN:") !== 0) {
        throw new Error("Transfer gonderen bilgisi gecersiz: " + rowsTransfer[ci].serial);
      }
    }
  }

  var rowsHtmlTransfer = "";
  for (var ht = 0; ht < rowsTransfer.length; ht++) {
    var rr = rowsTransfer[ht].rowIndex;
    rowsHtmlTransfer += "<tr>" +
      "<td style='border:1px solid #000;padding:5px;'>" + (ht + 1) + "</td>" +
      "<td style='border:1px solid #000;padding:5px;'>" + escapeHtml(typeColTransfer > -1 ? hwTableTransfer.values[rr][typeColTransfer] : "") + "</td>" +
      "<td style='border:1px solid #000;padding:5px;'>" + escapeHtml(brandColTransfer > -1 ? hwTableTransfer.values[rr][brandColTransfer] : "") + " " + escapeHtml(modelColTransfer > -1 ? hwTableTransfer.values[rr][modelColTransfer] : "") + "</td>" +
      "<td style='border:1px solid #000;padding:5px;'>" + escapeHtml(rowsTransfer[ht].serial) + "</td>" +
      "</tr>";
  }

  var todayTransfer = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy");
  var htmlTransfer = "<html><body><div style='font-family:Arial;font-size:12px;padding:20px;'>" +
    "<h3>TRANSFER " + (isOutTransfer ? "CIKIS" : "GIRIS") + " TUTANAGI</h3>" +
    "<p>Gonderen: " + escapeHtml(senderCampusTransfer) + "</p>" +
    "<p>Alici: " + escapeHtml(targetCampusTransfer) + "</p>" +
    "<table style='width:100%;border-collapse:collapse;'>" + rowsHtmlTransfer + "</table>" +
    "<p>Tarih: " + todayTransfer + "</p>" +
    "<p>IT Yetkilisi: " + escapeHtml(data.itName || sessionEmail) + "</p>" +
    "<img src='" + data.transferSignature + "' style='height:60px;'/>" +
    "<p style='font-size:9px;color:#666;'>IP (Beyan): " + escapeHtml(data.clientIp || "") + "</p>" +
    "</div></body></html>";

  var blobTransfer = Utilities.newBlob(htmlTransfer, MimeType.HTML).getAs(MimeType.PDF);
  blobTransfer.setName(sanitizeFileName(data.pdfName, "transfer.pdf"));
  var hashTransfer = generateSHA256Hash(blobTransfer);
  var rootTransfer = DriveApp.getFolderById("0ACnbZT1gvSJtUk9PVA");
  var folderTransfer = getOrCreateChildFolder(rootTransfer, isOutTransfer ? senderCampusTransfer : targetCampusTransfer);
  var fileUrlTransfer = folderTransfer.createFile(blobTransfer).getUrl();

  for (var ut = 0; ut < rowsTransfer.length; ut++) {
    var rowIdxTransfer = rowsTransfer[ut].rowIndex;
    if (isOutTransfer) {
      hwTableTransfer.values[rowIdxTransfer][statusColTransfer] = "TRANSFER";
      hwTableTransfer.values[rowIdxTransfer][userColTransfer] = "GÖNDEREN:" + cleanCampusName(senderCampusTransfer);
      hwTableTransfer.values[rowIdxTransfer][campusColTransfer] = cleanCampusName(targetCampusTransfer);
      addHistory(hwTableTransfer, rowIdxTransfer, { personName: sessionEmail, date: todayTransfer, driveLink: fileUrlTransfer, type: "Kampüs Çıkış" });
    } else {
      hwTableTransfer.values[rowIdxTransfer][statusColTransfer] = "DEPODA";
      hwTableTransfer.values[rowIdxTransfer][userColTransfer] = "";
      hwTableTransfer.values[rowIdxTransfer][campusColTransfer] = cleanCampusName(targetCampusTransfer);
      addHistory(hwTableTransfer, rowIdxTransfer, { personName: sessionEmail, date: todayTransfer, driveLink: fileUrlTransfer, type: "Kampüs Giriş" });
    }
    hwTableTransfer.values[rowIdxTransfer][driveColTransfer] = fileUrlTransfer;
  }

  hwTableTransfer.sheet.getDataRange().setValues(hwTableTransfer.values);
  appendSecureLog(ss, "TRANSFER " + (isOutTransfer ? "CIKIS" : "GIRIS"), sessionEmail, rowsTransfer.length + " Cihaz", hashTransfer, fileUrlTransfer, (data.clientIp || "") + " (Beyan)");
  return jsonOut({ success: true, url: fileUrlTransfer });
}
*/

// ================================
// Replacement: cancelTransfer
// ================================
/*
if (data.action === 'cancelTransfer') {
  var hwTableCancel = readSheetTable(ss, "Laptoplar");
  var rowsCancel = findHardwareRows(hwTableCancel, data.hardwareIds, verifiedUser, { requireStatus: "TRANSFER" });
  var headersCancel = hwTableCancel.headers;
  var statusColCancel = requireHeader(headersCancel, ["Cihaz Durumu"], "Cihaz Durumu");
  var userColCancel = requireHeader(headersCancel, ["Kullanici", "Kullanıcı"], "Kullanici");
  var campusColCancel = requireHeader(headersCancel, ["Kampus", "Kampüs"], "Kampus");
  var driveColCancel = requireHeader(headersCancel, ["Drive Linki"], "Drive Linki");
  var todayCancel = Utilities.formatDate(new Date(), "Europe/Istanbul", "dd.MM.yyyy");

  for (var cc = 0; cc < rowsCancel.length; cc++) {
    var rowIdxCancel = rowsCancel[cc].rowIndex;
    var assignedCancel = hwTableCancel.values[rowIdxCancel][userColCancel].toString();
    var senderRaw = assignedCancel.replace(/^GÖNDEREN:/i, "").replace(/^GONDEREN:/i, "").trim();
    if (!senderRaw) throw new Error("Gonderen kampus bilgisi bulunamadi: " + rowsCancel[cc].serial);

    if (verifiedUser.role !== "HQ IT" && getCoreNameStr(senderRaw) !== getCoreNameStr(verifiedUser.campus)) {
      throw new Error("Sadece kendi gonderdiginiz transferi iptal edebilirsiniz: " + rowsCancel[cc].serial);
    }

    hwTableCancel.values[rowIdxCancel][statusColCancel] = "DEPODA";
    hwTableCancel.values[rowIdxCancel][userColCancel] = "";
    hwTableCancel.values[rowIdxCancel][campusColCancel] = cleanCampusName(senderRaw);
    hwTableCancel.values[rowIdxCancel][driveColCancel] = "";
    addHistory(hwTableCancel, rowIdxCancel, { personName: sessionEmail, date: todayCancel, type: "Transfer İptal" });
  }

  hwTableCancel.sheet.getDataRange().setValues(hwTableCancel.values);
  appendSecureLog(ss, "TRANSFER IPTAL", sessionEmail, rowsCancel.length + " Cihaz geri cekildi", "-", "-", (data.clientIp || "") + " (Beyan)");
  return jsonOut({ success: true });
}
*/

// Add this just before catch(error) in doPost(e):
// throw new Error("Bilinmeyen islem: " + data.action);
