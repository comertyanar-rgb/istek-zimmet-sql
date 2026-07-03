/*
  Final fixes for the integrated Apps Script backend.
  Apply these changes to the code you pasted last.
*/

// 1) Add this helper near getCoreNameStr().
function normalizeStatus(value) {
  var s = value ? value.toString().trim().toUpperCase() : "";
  s = s.replace(/İ/g, "I");
  if (s === "AKTIF") return "AKTIF";
  if (s === "DEPODA") return "DEPODA";
  if (s === "HURDA") return "HURDA";
  if (s === "TRANSFER") return "TRANSFER";
  return s;
}

function getOrCreateCampusFolder(rootFolderId, campus) {
  var root = DriveApp.getFolderById(rootFolderId);
  var folderName = cleanCampusName(campus || "Bilinmiyor");
  var iter = root.getFoldersByName(folderName);
  return iter.hasNext() ? iter.next() : root.createFolder(folderName);
}

function sanitizeFileName(name, fallback) {
  var safe = (name || fallback || "belge.pdf").toString();
  return safe.replace(/[\/\\?%*:|"<>]/g, "-");
}

function validateUploadedFile(base64Str, fileName) {
  if (!base64Str || typeof base64Str !== "string") throw new Error("Dosya verisi bulunamadi.");
  if (base64Str.length > 15000000) throw new Error("Dosya cok buyuk. Maksimum 15 MB.");

  var safeName = sanitizeFileName(fileName, "belge.pdf");
  var lower = safeName.toLowerCase();
  var isPdf = lower.endsWith(".pdf");
  var isPng = lower.endsWith(".png");
  var isJpg = lower.endsWith(".jpg") || lower.endsWith(".jpeg");
  if (!isPdf && !isPng && !isJpg) throw new Error("Sadece PDF/JPG/PNG yuklenebilir.");

  var bytes = Utilities.base64Decode(base64Str);
  if (bytes.length < 4) throw new Error("Dosya gecersiz.");

  if (isPdf && !(bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) {
    throw new Error("PDF dosya imzasi gecersiz.");
  }
  if (isPng && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) {
    throw new Error("PNG dosya imzasi gecersiz.");
  }
  if (isJpg && !(bytes[0] === 255 && bytes[1] === 216)) {
    throw new Error("JPEG dosya imzasi gecersiz.");
  }

  return {
    bytes: bytes,
    fileName: safeName,
    mimeType: isPdf ? "application/pdf" : (isPng ? "image/png" : "image/jpeg")
  };
}

// 2) In getPersonDetails(), replace idCol with this:
// var idCol = requireHeader(usTable.headers, ["User Id", "Email", "E-Posta"], "Personel ID");

// 3) In findHardwareRows(), replace status calculation with this:
// var status = normalizeStatus(table.values[r][statusCol]);
// Then update active checks elsewhere from "AKTİF" to "AKTIF".

// 4) In sendOTP, add this before writing cache:
// if (!data.personEmail || data.personEmail.indexOf("@") === -1) throw new Error("Gecerli personel e-postasi yok.");
// Optional but recommended: rate limit by sessionEmail/personEmail.

// 5) In saveZimmetServerSide / returnZimmetServerSide:
// - Replace blob.setName(escapeHtml(data.pdfName)) with:
// blob.setName(sanitizeFileName(data.pdfName, isReturn ? "iade.pdf" : "zimmet.pdf"));
// - Replace AKTİF checks with AKTIF:
// if (!isReturn && hw.status === "AKTIF") { ... }
// - Wrap GmailApp.sendEmail in try/catch after DB + log succeeds:
// try {
//   GmailApp.sendEmail(personData.email, isReturn ? "Donanım İade Belgesi" : "Donanım Zimmet Belgesi", "Tutanak ektedir.", { attachments: [blob], cc: sessionEmail, name: "İSTEK Demirbaş" });
// } catch (mailErr) {
//   appendSecureLog(ss, "MAIL HATASI", sessionEmail, mailErr.message, "-", fileUrl, data.clientIp);
// }

// 6) Replace manualAssign/uploadMissingDocument file creation lines with:
// var fileInfo = validateUploadedFile(data.pdfData, data.pdfName);
// var blob = Utilities.newBlob(fileInfo.bytes, fileInfo.mimeType, fileInfo.fileName);
// var fileHash = generateSHA256Hash(blob);
// var folder = getOrCreateCampusFolder("0ACnbZT1gvSJtUk9PVA", targetHw.campus || verifiedUser.campus);
// var fileUrl = folder.createFile(blob).getUrl();

// 7) In manualAssign, after getPersonDetails:
// if (verifiedUser.role !== "HQ IT" && getCoreNameStr(personData.campus || verifiedUser.campus) !== getCoreNameStr(verifiedUser.campus)) {
//   throw new Error("Farkli kampus personeline manuel zimmet yapilamaz.");
// }
// To use this, getPersonDetails should also return campus.

// 8) In transfer complete flow, move this target-campus validation BEFORE creating the PDF/file:
// if (!isOut) {
//   for (var pre = 0; pre < hwRows.length; pre++) {
//     var preRw = hwRows[pre].rowIdx;
//     var campusNow = hwTable.values[preRw][requireHeader(hwTable.headers, ["Kampüs", "Kampus"])];
//     if (getCoreNameStr(campusNow) !== getCoreNameStr(verifiedUser.campus)) {
//       throw new Error("Bu cihaz sizin kampusunize gonderilmemis: " + hwRows[pre].serial);
//     }
//   }
// }

// 9) In cancelTransfer sender check, replace exact includes with normalized comparison:
// var senderRaw = senderStr.replace(/^GÖNDEREN:/i, "").replace(/^GONDEREN:/i, "").trim();
// if (verifiedUser.role !== "HQ IT" && getCoreNameStr(senderRaw) !== getCoreNameStr(verifiedUser.campus)) {
//   throw new Error("Sadece kendi gonderdiginiz transferi iptal edebilirsiniz.");
// }

// 10) Frontend still calls these actions. Keep secure implementations for all:
// addHardware, updateHardware, bulkUpdateGroup, bulkStatusUpdate.
// If they are absent, the UI will fail with "Action Not Found".
