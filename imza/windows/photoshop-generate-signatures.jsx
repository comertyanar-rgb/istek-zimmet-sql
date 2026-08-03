#target photoshop

app.displayDialogs = DialogModes.NO;

function writeTextFile(path, text) {
  var file = new File(path);
  file.encoding = "UTF8";
  file.open("w");
  file.write(text);
  file.close();
}

function fileImportDataSets(file) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();

  ref.putClass(stringIDToTypeID("dataSetClass"));
  desc.putReference(charIDToTypeID("null"), ref);
  desc.putPath(charIDToTypeID("Usng"), new File(file));
  desc.putEnumerated(
    charIDToTypeID("Encd"),
    stringIDToTypeID("dataSetEncoding"),
    stringIDToTypeID("dataSetEncodingUTF8")
  );
  desc.putBoolean(stringIDToTypeID("eraseAll"), true);
  desc.putBoolean(stringIDToTypeID("useFirstColumn"), true);

  executeAction(stringIDToTypeID("importDataSets"), desc, DialogModes.NO);
}

function applyDataSet(setName) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();

  ref.putName(stringIDToTypeID("dataSetClass"), setName);
  desc.putReference(charIDToTypeID("null"), ref);
  executeAction(stringIDToTypeID("apply"), desc, DialogModes.NO);
}

function jpegSaveOptions() {
  var options = new JPEGSaveOptions();

  options.embedColorProfile = true;
  options.formatOptions = FormatOptions.STANDARDBASELINE;
  options.matte = MatteType.NONE;
  options.quality = 10;

  return options;
}

function splitTsvLine(line) {
  var values = [];
  var output = "";
  var quoted = false;

  for (var i = 0; i < line.length; i++) {
    var c = line.charAt(i);
    var next = line.charAt(i + 1);

    if (quoted && c === '"' && next === '"') {
      output += '"';
      i++;
      continue;
    }

    if (c === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && c === "\t") {
      values.push(output);
      output = "";
      continue;
    }

    output += c;
  }

  values.push(output);
  return values;
}

function firstTsvCell(line) {
  var values = splitTsvLine(line);
  return values.length ? values[0] : "";
}

function getDataRows(datasetFile) {
  var file = new File(datasetFile);
  var rows = [];
  var headers = [];
  var line;
  var lineNumber = 0;

  file.encoding = "UTF8";
  file.open("r");

  while (!file.eof) {
    line = file.readln();
    lineNumber++;

    if (line.length < 1) {
      continue;
    }

    if (lineNumber === 1) {
      headers = splitTsvLine(line);
      continue;
    }

    var cells = splitTsvLine(line);
    var row = {};
    for (var i = 0; i < headers.length; i++) {
      row[headers[i]] = i < cells.length ? cells[i] : "";
    }
    rows.push(row);
  }

  file.close();
  return rows;
}

function getDataSetNames(datasetFile) {
  var file = new File(datasetFile);
  var names = [];
  var line;
  var lineNumber = 0;

  file.encoding = "UTF8";
  file.open("r");

  while (!file.eof) {
    line = file.readln();
    lineNumber++;

    if (lineNumber === 1 || line.length < 1) {
      continue;
    }

    names.push(firstTsvCell(line));
  }

  file.close();
  return names;
}

function requireCampusImage(row, setName) {
  var campusImagePath = String(row.CampusImage || "");
  if (!campusImagePath) {
    throw new Error("CampusImage is empty for data set: " + setName);
  }

  var campusImageFile = new File(campusImagePath);
  if (!campusImageFile.exists) {
    throw new Error(
      "CampusImage file was not found for data set " +
        setName +
        ": " +
        campusImageFile.fsName
    );
  }
}

function findLayerByName(container, expectedName) {
  var normalizedExpected = normalizeTextForCheck(expectedName);

  for (var i = 0; i < container.artLayers.length; i++) {
    if (normalizeTextForCheck(container.artLayers[i].name) === normalizedExpected) {
      return container.artLayers[i];
    }
  }

  for (var j = 0; j < container.layerSets.length; j++) {
    var match = findLayerByName(container.layerSets[j], expectedName);
    if (match) {
      return match;
    }
  }

  return null;
}

function unitPixels(value) {
  return value && value.as ? value.as("px") : Number(value);
}

function getLayerBounds(layer) {
  var bounds = layer.bounds;
  return {
    left: unitPixels(bounds[0]),
    top: unitPixels(bounds[1]),
    right: unitPixels(bounds[2]),
    bottom: unitPixels(bounds[3])
  };
}

function replaceCampusImage(doc, campusImagePath) {
  var targetLayer = findLayerByName(doc, "kampus");
  if (!targetLayer) {
    throw new Error("Campus image layer named 'kampus' was not found in the PSD template.");
  }

  var targetBounds = getLayerBounds(targetLayer);
  var targetWidth = targetBounds.right - targetBounds.left;
  var targetHeight = targetBounds.bottom - targetBounds.top;
  if (targetWidth <= 0 || targetHeight <= 0) {
    throw new Error("Campus image layer has invalid bounds.");
  }

  var sourceDoc = null;
  try {
    sourceDoc = app.open(new File(campusImagePath));
    sourceDoc.selection.selectAll();
    sourceDoc.selection.copy(true);
  } finally {
    if (sourceDoc) {
      sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
    }
  }

  app.activeDocument = doc;
  doc.activeLayer = targetLayer;
  var replacementLayer = doc.paste();
  var replacementBounds = getLayerBounds(replacementLayer);
  var replacementWidth = replacementBounds.right - replacementBounds.left;
  var replacementHeight = replacementBounds.bottom - replacementBounds.top;
  if (replacementWidth <= 0 || replacementHeight <= 0) {
    throw new Error("Campus image replacement has invalid bounds.");
  }

  var scale = Math.min(targetWidth / replacementWidth, targetHeight / replacementHeight) * 100;
  if (Math.abs(scale - 100) > 0.01) {
    replacementLayer.resize(scale, scale, AnchorPosition.MIDDLECENTER);
  }

  replacementBounds = getLayerBounds(replacementLayer);
  replacementWidth = replacementBounds.right - replacementBounds.left;
  replacementHeight = replacementBounds.bottom - replacementBounds.top;
  replacementLayer.translate(
    targetBounds.left + (targetWidth - replacementWidth) / 2 - replacementBounds.left,
    targetBounds.top + (targetHeight - replacementHeight) / 2 - replacementBounds.top
  );
  replacementLayer.name = "kampus";
  targetLayer.remove();
}

function normalizeTextForCheck(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function collectTextLayerContents(container, output) {
  for (var i = 0; i < container.artLayers.length; i++) {
    var layer = container.artLayers[i];
    if (layer.kind === LayerKind.TEXT) {
      output.push(String(layer.textItem.contents));
    }
  }

  for (var j = 0; j < container.layerSets.length; j++) {
    collectTextLayerContents(container.layerSets[j], output);
  }
}

function documentContainsText(doc, expectedText) {
  var expected = normalizeTextForCheck(expectedText);
  if (!expected) {
    return true;
  }

  var contents = [];
  collectTextLayerContents(doc, contents);

  for (var i = 0; i < contents.length; i++) {
    if (normalizeTextForCheck(contents[i]).indexOf(expected) >= 0) {
      return true;
    }
  }

  return false;
}

function setTextLayerValue(layer, value) {
  var text = String(value || "");
  layer.textItem.contents = text;
  try {
    if (text) {
      layer.name = text;
    }
  } catch (ignored) {}
}

function fillSignatureTextLayers(container, row) {
  for (var i = 0; i < container.artLayers.length; i++) {
    var layer = container.artLayers[i];
    if (layer.kind !== LayerKind.TEXT) {
      continue;
    }

    var layerName = normalizeTextForCheck(layer.name);
    var layerText = normalizeTextForCheck(layer.textItem.contents);
    var marker = layerName + " " + layerText;

    if (layerName === "filename" || layerText === "919xzmnshu2") {
      setTextLayerValue(layer, row.filename);
      continue;
    }

    if (marker.indexOf("@istek.k12.tr") >= 0 || marker.indexOf("@") >= 0) {
      setTextLayerValue(layer, row.email);
      continue;
    }

    if (marker.indexOf("www.istek") >= 0) {
      continue;
    }

    if (marker.indexOf("graphic designer") >= 0) {
      setTextLayerValue(layer, row.ing || row.unvan);
      continue;
    }

    if (marker.indexOf("dizgici") >= 0) {
      setTextLayerValue(layer, row.unvan);
      continue;
    }

    if (
      marker.indexOf("acıbadem") >= 0 ||
      marker.indexOf("kadıköy") >= 0 ||
      marker.indexOf("bag sk") >= 0 ||
      marker.indexOf("bağ sk") >= 0 ||
      marker.indexOf(" cad") >= 0 ||
      marker.indexOf(" no:") >= 0
    ) {
      setTextLayerValue(layer, row.adres);
      continue;
    }

    if (marker.indexOf("aygül ceylan") >= 0 || marker.indexOf("aygul ceylan") >= 0) {
      setTextLayerValue(layer, row.ad);
      continue;
    }

    if (row.ad) {
      setTextLayerValue(layer, row.ad);
      continue;
    }
  }

  for (var j = 0; j < container.layerSets.length; j++) {
    fillSignatureTextLayers(container.layerSets[j], row);
  }
}

try {
  var jobFile = new File("C:/GAMWork/job/photoshop-job.js");
  if (!jobFile.exists) {
    throw new Error("Job file was not found: " + jobFile.fsName);
  }

  $.evalFile(jobFile);

  if (typeof SIGNATURE_JOB === "undefined") {
    throw new Error("SIGNATURE_JOB was not defined.");
  }

  var templateFile = new File(SIGNATURE_JOB.psdPath);
  var datasetFile = new File(SIGNATURE_JOB.datasetPath);
  var outputFolder = new Folder(SIGNATURE_JOB.outputDir);

  if (!templateFile.exists) {
    throw new Error("PSD template was not found: " + templateFile.fsName);
  }

  if (!datasetFile.exists) {
    throw new Error("Dataset file was not found: " + datasetFile.fsName);
  }

  if (!outputFolder.exists) {
    outputFolder.create();
  }

  var rows = getDataRows(datasetFile.fsName);
  if (!rows || rows.length < 1) {
    throw new Error("Dataset file has no data rows: " + datasetFile.fsName);
  }

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var setName = row.filename;
    requireCampusImage(row, setName);

    var doc = null;
    try {
      doc = app.open(templateFile);

      replaceCampusImage(doc, row.CampusImage);
      fillSignatureTextLayers(doc, row);
      app.refresh();

      if (!documentContainsText(doc, row.email) && !documentContainsText(doc, row.ad)) {
        throw new Error(
          "Dataset was found but was not applied to the visible text layers: " +
            setName +
            " / " +
            row.ad +
            " / " +
            row.email
        );
      }

      var saveFile = new File(outputFolder.fsName + "/" + setName + ".jpg");
      doc.saveAs(saveFile, jpegSaveOptions(), true, Extension.LOWERCASE);
      doc.close(SaveOptions.DONOTSAVECHANGES);
      doc = null;
    } catch (rowError) {
      if (doc) {
        try {
          doc.close(SaveOptions.DONOTSAVECHANGES);
        } catch (closeError) {}
      }
      throw rowError;
    }
  }

  writeTextFile(SIGNATURE_JOB.doneFile, "ok");
} catch (error) {
  try {
    writeTextFile(SIGNATURE_JOB.errorFile, String(error) + "\nLine: " + error.line);
  } catch (nestedError) {}
  throw error;
}
