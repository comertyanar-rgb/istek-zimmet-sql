// ==========================================================
// GLPI Bilgisayar Ismi -> Kampus + Cihaz Tipi Cozumleyici
// Ornekler:
// IABPC0146  -> Kampus kodu IAB, Tip Masaustu
// IABLAP0242 -> Kampus kodu IAB, Tip Laptop
// IABAIO0012 -> Kampus kodu IAB, Tip All in One
// IABSPC0017 -> Kampus kodu IAB, Tip Akilli Tahta
// ==========================================================

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
  var result = {
    campusCode: "",
    campus: "",
    typeCode: "",
    type: ""
  };

  if (!name) return result;

  var typeMap = getDeviceTypeCodeMap_();
  var typeCodes = Object.keys(typeMap).sort(function(a, b) {
    return b.length - a.length;
  });

  // Once bilinen kampus kodlarini dene. Bu, 3/4 karakterli kampus kodlari icin daha guvenli.
  var campusCodes = Object.keys(campusMap || {}).sort(function(a, b) {
    return b.length - a.length;
  });

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

  // Fallback: Kampus kodu ilk 3 karakter, ardindan cihaz tipi gelir varsayimi.
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

// Mevcut deriveCampusFromComputerName_ fonksiyonunu bununla degistirebilirsiniz:
function deriveCampusFromComputerName_(computerName, campusMap) {
  return parseComputerNameMeta_(computerName, campusMap).campus;
}

function deriveDeviceTypeFromComputerName_(computerName) {
  var meta = parseComputerNameMeta_(computerName, {});
  return meta.type;
}

// importMissingGLPIDevices_ icinde row olustururken:
//
// var meta = parseComputerNameMeta_(item.computerName, getCampusCodeMap_(ss));
// row[campusCol] = meta.campus || item.inferredCampus || verifiedUser.campus;
// if (typeCol > -1) row[typeCol] = meta.type || "Laptop";
//
// reconcileGLPIWithLaptoplar_ icinde GLPI Kampus Tahmini hesaplanirken:
//
// var meta = parseComputerNameMeta_(glpi.computerName, campusMap);
// var inferredCampus = meta.campus;
//
// Mevcut Laptoplar.Cihaz Tipi bos ise GLPI isminden gelen meta.type yazilabilir:
//
// var typeCol = getHeaderIndex(headers, ["Cihaz Tipi"]);
// if (typeCol > -1 && !hwData[r][typeCol] && meta.type) {
//   hwData[r][typeCol] = meta.type;
// }

