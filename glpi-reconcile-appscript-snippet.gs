// ==========================================================
// GLPI_Cihazlar -> Laptoplar Uzlastirma Katmani
// Bu kod GLPI verisini ana zimmet tablosuna "bilgi/uyari" olarak isler.
// Hukuki zimmet alani olan Laptoplar!Kullanici otomatik degistirilmez.
// ==========================================================

function ensureColumn_(sheet, headers, name) {
  var idx = headers.indexOf(name);
  if (idx > -1) return idx;

  var newCol = headers.length + 1;
  sheet.getRange(1, newCol).setValue(name);
  headers.push(name);
  return headers.length - 1;
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

  // DOMAIN\user -> user
  if (s.indexOf("\\") > -1) {
    s = s.split("\\").pop();
  }

  // user@domain -> user
  if (s.indexOf("@") > -1) {
    s = s.split("@")[0];
  }

  return s;
}

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

function deriveCampusFromComputerName_(computerName, campusMap) {
  var name = computerName ? computerName.toString().trim().toUpperCase() : "";
  if (!name) return "";

  // Ornekler: IGMPC0073, IABPC0146, IKALAP0242, IALLAP...
  // Kurum kod standardiniz farkliysa GLPI_KampusKodlari sayfasindaki kodlari buna gore girin.
  var code3 = name.substring(0, 3);
  if (campusMap[code3]) return campusMap[code3];

  var code4 = name.substring(0, 4);
  if (campusMap[code4]) return campusMap[code4];

  return "";
}

function buildPersonIndexByAd_(ss) {
  var table = readSheetTable(ss, "Kullanıcılar");
  var headers = table.headers;

  var idCol = getHeaderIndex(headers, ["User Id", "Email", "E-Posta", "Kullanıcı"]);
  var emailCol = getHeaderIndex(headers, ["Email", "E-Posta"]);
  var nameCol = getHeaderIndex(headers, ["Ad Soyad", "Adı Soyadı", "Kullanıcı", "Name"]);
  var campusCol = getHeaderIndex(headers, ["Kampüs", "Okul"]);

  var byAd = {};
  for (var r = 1; r < table.values.length; r++) {
    var id = idCol > -1 && table.values[r][idCol] ? table.values[r][idCol].toString().trim() : "";
    var email = emailCol > -1 && table.values[r][emailCol] ? table.values[r][emailCol].toString().trim().toLowerCase() : "";
    var name = nameCol > -1 && table.values[r][nameCol] ? table.values[r][nameCol].toString().trim() : id;
    var campus = campusCol > -1 && table.values[r][campusCol] ? table.values[r][campusCol].toString().trim() : "";

    var keys = [];
    if (email && email.indexOf("@") > -1) keys.push(email.split("@")[0]);
    if (id && id.indexOf("@") > -1) keys.push(id.toLowerCase().split("@")[0]);
    if (id && id.indexOf("@") === -1) keys.push(id.toLowerCase());

    for (var i = 0; i < keys.length; i++) {
      if (keys[i]) {
        byAd[keys[i]] = { id: id, email: email, name: name, campus: campus };
      }
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

  var glpiIdCol = ensureColumn_(hwSheet, headers, "GLPI ID");
  var glpiNameCol = ensureColumn_(hwSheet, headers, "GLPI Bilgisayar İsmi");
  var glpiAdCol = ensureColumn_(hwSheet, headers, "GLPI AD Kullanıcı");
  var glpiPersonCol = ensureColumn_(hwSheet, headers, "GLPI Personel Eşleşmesi");
  var glpiCampusCol = ensureColumn_(hwSheet, headers, "GLPI Kampüs Tahmini");
  var glpiMatchCol = ensureColumn_(hwSheet, headers, "GLPI Eşleşme");
  var glpiMismatchCol = ensureColumn_(hwSheet, headers, "GLPI Uyuşmazlık");
  var glpiSyncCol = ensureColumn_(hwSheet, headers, "GLPI Son Sync");

  // Kolon eklediysek data satirlarini yeni kolon sayisina genislet.
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
      hwData[r][glpiMatchCol] = "YOK";
      hwData[r][glpiMismatchCol] = "GLPI_ESLESMEDI";
      hwData[r][glpiSyncCol] = "";
      warnings++;
      continue;
    }

    matched++;

    var adKey = normalizeAdLogin_(glpi.adUser);
    var glpiPerson = adKey ? personByAd[adKey] : null;
    var inferredCampus = deriveCampusFromComputerName_(glpi.computerName, campusMap);

    var flags = [];
    var zimmetUser = hwData[r][userCol] ? hwData[r][userCol].toString().trim() : "";
    var currentCampus = hwData[r][campusCol] ? hwData[r][campusCol].toString().trim() : "";

    if (adKey && !glpiPerson) {
      flags.push("AD_KULLANICI_KULLANICILARDA_YOK");
    }

    if (glpiPerson && zimmetUser && glpiPerson.id && zimmetUser !== glpiPerson.id) {
      flags.push("KULLANICI_FARKLI");
    }

    if (glpiPerson && !zimmetUser) {
      flags.push("ZIMMET_YOK_GLPI_KULLANICI_VAR");
    }

    if (inferredCampus && getCoreNameStr(inferredCampus) !== getCoreNameStr(currentCampus)) {
      flags.push("KAMPUS_FARKLI");
    }

    hwData[r][glpiIdCol] = glpi.glpiId || "";
    hwData[r][glpiNameCol] = glpi.computerName || "";
    hwData[r][glpiAdCol] = adKey || "";
    hwData[r][glpiPersonCol] = glpiPerson ? glpiPerson.name : "";
    hwData[r][glpiCampusCol] = inferredCampus || "";
    hwData[r][glpiMatchCol] = matchType;
    hwData[r][glpiMismatchCol] = flags.length ? flags.join(", ") : "OK";
    hwData[r][glpiSyncCol] = glpi.lastSync || "";

    if (flags.length) warnings++;
  }

  hwSheet.getRange(1, 1, hwData.length, headers.length).setValues(hwData);
  return { matched: matched, warnings: warnings };
}

// handleGLPISync_(data) fonksiyonunun sonunda su satirlari kullanabilirsiniz:
//
// var reconcile = reconcileGLPIWithLaptoplar_();
// return jsonOut({
//   success: true,
//   count: rows.length,
//   syncedAt: now,
//   matched: reconcile.matched,
//   warnings: reconcile.warnings
// });

