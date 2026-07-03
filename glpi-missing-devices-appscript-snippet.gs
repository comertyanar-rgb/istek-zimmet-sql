// ==========================================================
// GLPI Eksik Cihazlar Entegrasyonu
// Gereksinim:
// - glpi-reconcile-appscript-snippet.gs icindeki yardimci fonksiyonlar ekli olmali.
// - Kullanıcılar sayfasina opsiyonel "AD Kullanıcı" kolonu eklenebilir.
// ==========================================================

function buildPersonIndexByAdWithColumn_(ss) {
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
    var ad = adCol > -1 && table.values[r][adCol] ? table.values[r][adCol].toString().trim().toLowerCase() : "";
    var name = nameCol > -1 && table.values[r][nameCol] ? table.values[r][nameCol].toString().trim() : id;
    var campus = campusCol > -1 && table.values[r][campusCol] ? table.values[r][campusCol].toString().trim() : "";

    var keys = [];
    if (ad) keys.push(normalizeAdLogin_(ad));
    if (email && email.indexOf("@") > -1) keys.push(email.split("@")[0]);
    if (id && id.indexOf("@") > -1) keys.push(id.toLowerCase().split("@")[0]);
    if (id && id.indexOf("@") === -1) keys.push(id.toLowerCase());

    for (var i = 0; i < keys.length; i++) {
      if (keys[i]) {
        byAd[keys[i]] = { id: id, email: email, ad: ad, name: name, campus: campus };
      }
    }
  }

  return byAd;
}

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
  var people = buildPersonIndexByAdWithColumn_(ss);
  var campusMap = getCampusCodeMap_(ss);
  var missing = [];

  for (var r = 1; r < glpiTable.values.length; r++) {
    var row = glpiTable.values[r];
    var glpiId = row[glpiIdCol] ? row[glpiIdCol].toString().trim() : "";
    var serial = row[serialCol] ? row[serialCol].toString().trim() : "";
    var computerName = row[nameCol] ? row[nameCol].toString().trim() : "";

    var serialKey = normalizeSerialKey_(serial);
    var nameKey = normalizeComputerNameKey_(computerName);

    if ((serialKey && existing.bySerial[serialKey]) || (nameKey && existing.byComputerName[nameKey])) {
      continue;
    }

    var inferredCampus = deriveCampusFromComputerName_(computerName, campusMap);
    if (verifiedUser.role !== "HQ IT") {
      if (!inferredCampus || getCoreNameStr(inferredCampus) !== getCoreNameStr(verifiedUser.campus)) {
        continue;
      }
    }

    var adUser = normalizeAdLogin_(row[adCol]);
    var person = adUser ? people[adUser] : null;

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
      lastInventory: invCol > -1 ? normalizeGlpiValue_(row[invCol]) : "",
      lastSync: syncCol > -1 ? normalizeGlpiValue_(row[syncCol]) : ""
    });
  }

  return missing;
}

function fetchMissingGLPIDevices_(verifiedUser) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return jsonOut({
    success: true,
    devices: getMissingGLPIDevices_(ss, verifiedUser)
  });
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
    if (typeCol > -1) row[typeCol] = "Laptop";
    if (brandCol > -1) row[brandCol] = sanitizeExcel(item.brand);
    if (notesCol > -1) row[notesCol] = "GLPI'den eklendi. AD Kullanıcı: " + (item.adUser || "-");

    row[glpiIdCol] = item.glpiId;
    row[glpiNameCol] = item.computerName;
    row[glpiAdCol] = item.adUser;
    row[glpiPersonCol] = item.matchedPersonName;
    row[glpiCampusCol] = item.inferredCampus;
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
  var glpiNameCol = getHeaderIndex(headers, ["GLPI Bilgisayar İsmi"]);
  var glpiAdCol = getHeaderIndex(headers, ["GLPI AD Kullanıcı"]);
  var glpiPersonCol = getHeaderIndex(headers, ["GLPI Personel Eşleşmesi"]);
  var glpiCampusCol = getHeaderIndex(headers, ["GLPI Kampüs Tahmini"]);
  var glpiMismatchCol = getHeaderIndex(headers, ["GLPI Uyuşmazlık"]);
  var glpiSyncCol = getHeaderIndex(headers, ["GLPI Son Sync"]);

  var glpiComputerName = glpiNameCol > -1 ? normalizeGlpiValue_(row[glpiNameCol]) : "";

  // Bilgisayar ismi bos ise GLPI'den gelen isim frontend'e deviceName olarak gitsin.
  if (!hardwareObj.deviceName && glpiComputerName) {
    hardwareObj.deviceName = glpiComputerName;
  }

  hardwareObj.glpiComputerName = glpiComputerName;
  hardwareObj.glpiAdUser = glpiAdCol > -1 ? normalizeGlpiValue_(row[glpiAdCol]) : "";
  hardwareObj.glpiPersonName = glpiPersonCol > -1 ? normalizeGlpiValue_(row[glpiPersonCol]) : "";
  hardwareObj.glpiCampus = glpiCampusCol > -1 ? normalizeGlpiValue_(row[glpiCampusCol]) : "";
  hardwareObj.glpiMismatch = glpiMismatchCol > -1 ? normalizeGlpiValue_(row[glpiMismatchCol]) : "";
  hardwareObj.glpiLastSync = glpiSyncCol > -1 ? normalizeGlpiValue_(row[glpiSyncCol]) : "";

  return hardwareObj;
}

// doPost icine, oturum/yetki kontrolunden sonra ekleyin:
//
// if (data.action === "fetchMissingGLPIDevices") {
//   return fetchMissingGLPIDevices_(verifiedUser);
// }
//
// if (data.action === "importMissingGLPIDevices") {
//   return importMissingGLPIDevices_(data, verifiedUser, sessionEmail);
// }
//
// fetchData icindeki hardware.push({...}) yerine:
//
// var hardwareObj = { mevcut alanlariniz };
// hardware.push(enrichFetchHardwareWithGLPI_(hardwareObj, row, hwHeaders));

