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
  desc.putReference(stringIDToTypeID("null"), ref);
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

function firstTsvCell(line) {
  if (line.charAt(0) !== '"') {
    return line.split("\t")[0];
  }

  var output = "";
  for (var i = 1; i < line.length; i++) {
    var c = line.charAt(i);
    var next = line.charAt(i + 1);

    if (c === '"' && next === '"') {
      output += '"';
      i++;
      continue;
    }

    if (c === '"') {
      break;
    }

    output += c;
  }

  return output;
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

  var doc = app.open(templateFile);
  fileImportDataSets(datasetFile);

  var names = getDataSetNames(datasetFile.fsName);

  for (var i = 0; i < names.length; i++) {
    applyDataSet(names[i]);
    var saveFile = new File(outputFolder.fsName + "/" + names[i] + ".jpg");
    doc.saveAs(saveFile, jpegSaveOptions(), true, Extension.LOWERCASE);
  }

  doc.close(SaveOptions.DONOTSAVECHANGES);
  writeTextFile(SIGNATURE_JOB.doneFile, "ok");
} catch (error) {
  try {
    writeTextFile(SIGNATURE_JOB.errorFile, String(error) + "\nLine: " + error.line);
  } catch (nestedError) {}
  throw error;
}
