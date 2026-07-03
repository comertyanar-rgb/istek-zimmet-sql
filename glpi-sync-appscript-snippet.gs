// ==========================================================
// GLPI -> Zimmet Sync Endpoint
// doPost(e) icinde, verifyLogin disindaki authToken kontrolunden ONCE ekleyin.
// Bu endpoint frontend kullanicilari icin degil; sadece ic agdaki sync scripti icindir.
// ==========================================================

function ensureGLPISheet_(ss) {
  var sheet = ss.getSheetByName("GLPI_Cihazlar");
  if (!sheet) sheet = ss.insertSheet("GLPI_Cihazlar");

  var headers = [
    "GLPI ID",
    "Seri no",
    "Bilgisayar İsmi",
    "Marka",
    "Model",
    "AD Kullanıcı",
    "Lokasyon",
    "Son Envanter",
    "Son Sync"
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }

  return { sheet: sheet, headers: headers };
}

function normalizeGlpiValue_(value) {
  if (value === null || value === undefined) return "";
  return value.toString().trim();
}

function handleGLPISync_(data) {
  var expectedSecret = PropertiesService.getScriptProperties().getProperty("GLPI_SYNC_SECRET");
  if (!expectedSecret || data.secret !== expectedSecret) {
    return jsonOut({ success: false, error: "Yetkisiz GLPI sync." });
  }

  var items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 10000) {
    return jsonOut({ success: false, error: "Tek seferde cok fazla GLPI kaydi geldi." });
  }

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
      normalizeGlpiValue_(item.adUser),
      normalizeGlpiValue_(item.location),
      normalizeGlpiValue_(item.lastInventory),
      now
    ];
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#d9ead3");
  sheet.setFrozenRows(1);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return jsonOut({ success: true, count: rows.length, syncedAt: now });
}

// doPost icine su blok eklenmeli:
//
// if (data.action === "syncGLPI") {
//   return handleGLPISync_(data);
// }

