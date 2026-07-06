/*
  Google Sheet Kullanıcılar -> SQL personel senkronizasyonu.

  ÖNEMLİ:
  SQL API dışarı açılmayacaksa Apps Script doğrudan SQL API'ye POST atmamalıdır.
  Apps Script Google sunucularında çalıştığı için http://sunucu:8787 veya localhost
  adreslerini göremez.

  Doğru akış:
  1. Form / Google Admin scriptleri Kullanıcılar sayfasını günceller.
  2. Bu Apps Script Web App, Kullanıcılar sayfasını JSON olarak dışarı verir.
  3. Kurum içindeki sync-personnel.ps1 bu JSON'u çeker ve lokal SQL API'ye yazar.

  Script Properties:
  - PERSONNEL_SYNC_SECRET: Backend .env içindeki PERSONNEL_SYNC_SECRET ile aynı değer

  Web App endpoint aksiyonu:
  - exportPersonnelForSync
*/

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function buildPersonnelSyncItemsFromSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Kullanıcılar');
  if (!sheet) throw new Error('Kullanıcılar sayfası bulunamadı.');

  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var col = function(names) {
    for (var i = 0; i < names.length; i++) {
      var idx = headers.indexOf(names[i]);
      if (idx > -1) return idx;
    }
    return -1;
  };

  var idCol = col(['Google ID', 'User Id', 'ID']);
  var nameCol = col(['Ad Soyad', 'Adı Soyadı', 'Kullanıcı', 'Name']);
  var emailCol = col(['Email', 'E-Posta']);
  var deptCol = col(['Department', 'Departman', 'Görev', 'Gorev', 'Ünvan', 'Unvan']);
  var campusCol = col(['Kampüs', 'Kampus', 'Okul']);
  var statusCol = col(['Durumu', 'Status']);
  var photoCol = col(['Profil Fotoğrafı', 'Profil Fotografı', 'Fotoğraf', 'Fotograf', 'Photo']);
  var adCol = col(['AD Kullanıcı', 'AD Kullanici', 'AD Kullanıcı Adı', 'AD Kullanici Adi', 'AD Username', 'SamAccountName']);
  var phoneCol = col(['Telefon', 'Cep Telefonu', 'Cep', 'Phone']);
  var signatureCol = col(['İmza Linki', 'Imza Linki', 'Signature Link', 'SignatureUrl']);

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var email = emailCol > -1 ? String(row[emailCol] || '').trim() : '';
    var adUsername = adCol > -1 ? String(row[adCol] || '').trim() : '';
    var personId = idCol > -1 ? String(row[idCol] || '').trim() : '';
    if (!personId && !email && !adUsername) continue;

    items.push({
      personId: personId,
      fullName: nameCol > -1 ? row[nameCol] : '',
      email: email,
      department: deptCol > -1 ? row[deptCol] : '',
      campus: campusCol > -1 ? row[campusCol] : '',
      status: statusCol > -1 ? row[statusCol] : 'Aktif',
      photoUrl: photoCol > -1 ? row[photoCol] : '',
      adUsername: adUsername,
      phone: phoneCol > -1 ? row[phoneCol] : '',
      signatureUrl: signatureCol > -1 ? row[signatureCol] : ''
    });
  }

  return items;
}

function handlePersonnelExportForSync_(data) {
  var expectedSecret = PropertiesService.getScriptProperties().getProperty('PERSONNEL_SYNC_SECRET') ||
    PropertiesService.getScriptProperties().getProperty('ZIMMET_PERSONNEL_SYNC_SECRET');

  if (!expectedSecret || data.secret !== expectedSecret) {
    return jsonOut({ success: false, error: 'Yetkisiz personel export isteği.' });
  }

  var items = buildPersonnelSyncItemsFromSheet_();
  return jsonOut({
    success: true,
    count: items.length,
    syncedAt: Utilities.formatDate(new Date(), 'Europe/Istanbul', 'dd.MM.yyyy HH:mm:ss'),
    items: items
  });
}

/*
  Mevcut doPost(e) router'iniz varsa içine şunu ekleyin:

  var data = JSON.parse(e.postData.contents);
  if (data.action === 'exportPersonnelForSync') {
    return handlePersonnelExportForSync_(data);
  }
*/
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ success: false, error: 'Bozuk veri paketi.' });
  }

  if (data.action === 'exportPersonnelForSync') {
    return handlePersonnelExportForSync_(data);
  }

  return jsonOut({ success: false, error: 'Bilinmeyen action.' });
}
