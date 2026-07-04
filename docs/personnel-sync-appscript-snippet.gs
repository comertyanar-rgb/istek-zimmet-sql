/*
  Google Apps Script -> SQL API personel senkronizasyon örneği.

  Script Properties:
  - ZIMMET_SQL_API_URL: https://.../api/action  veya  http://sunucu:8787/api/action
  - PERSONNEL_SYNC_SECRET: Backend .env içindeki PERSONNEL_SYNC_SECRET ile aynı değer

  Bu endpoint şifre, TC kimlik veya geçici hesap parolası taşımaz.
*/

function syncPersonnelToSql_(items) {
  var apiUrl = PropertiesService.getScriptProperties().getProperty('ZIMMET_SQL_API_URL');
  var secret = PropertiesService.getScriptProperties().getProperty('PERSONNEL_SYNC_SECRET');

  if (!apiUrl || !secret) {
    throw new Error('ZIMMET_SQL_API_URL veya PERSONNEL_SYNC_SECRET Script Properties içinde eksik.');
  }

  var payload = {
    action: 'syncPersonnel',
    secret: secret,
    machine: 'Apps Script',
    items: Array.isArray(items) ? items : [items]
  };

  var response = UrlFetchApp.fetch(apiUrl, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var text = response.getContentText();
  var parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('SQL API JSON dönmedi: ' + text);
  }

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !parsed.success) {
    throw new Error('SQL personel sync başarısız: ' + (parsed.error || text));
  }

  return parsed;
}

function syncKullanicilarSheetToSql() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Kullanıcılar');
  if (!sheet) throw new Error('Kullanıcılar sayfası bulunamadı.');

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;

  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var col = function(names) {
    for (var i = 0; i < names.length; i++) {
      var idx = headers.indexOf(names[i]);
      if (idx > -1) return idx;
    }
    return -1;
  };

  var idCol = col(['Google ID', 'User Id', 'ID']);
  var nameCol = col(['Ad Soyad', 'Adı Soyadı', 'Kullanıcı']);
  var emailCol = col(['Email', 'E-Posta']);
  var deptCol = col(['Department', 'Departman', 'Görev', 'Ünvan']);
  var campusCol = col(['Kampüs', 'Okul']);
  var statusCol = col(['Durumu', 'Status']);
  var photoCol = col(['Profil Fotoğrafı', 'Fotoğraf']);
  var adCol = col(['AD Kullanıcı', 'AD Kullanıcı Adı', 'AD Username']);
  var phoneCol = col(['Telefon', 'Cep Telefonu']);
  var signatureCol = col(['İmza Linki', 'Imza Linki', 'Signature Link']);

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var email = emailCol > -1 ? String(row[emailCol] || '').trim() : '';
    var personId = idCol > -1 ? String(row[idCol] || '').trim() : '';
    if (!personId && !email) continue;

    items.push({
      personId: personId,
      fullName: nameCol > -1 ? row[nameCol] : '',
      email: email,
      department: deptCol > -1 ? row[deptCol] : '',
      campus: campusCol > -1 ? row[campusCol] : '',
      status: statusCol > -1 ? row[statusCol] : 'Aktif',
      photoUrl: photoCol > -1 ? row[photoCol] : '',
      adUsername: adCol > -1 ? row[adCol] : '',
      phone: phoneCol > -1 ? row[phoneCol] : '',
      signatureUrl: signatureCol > -1 ? row[signatureCol] : ''
    });
  }

  var batchSize = 500;
  for (var start = 0; start < items.length; start += batchSize) {
    syncPersonnelToSql_(items.slice(start, start + batchSize));
  }
}
