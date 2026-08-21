import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import readExcelFile from 'read-excel-file/node';
import { config } from '../src/config.js';
import { closePool, getPool, sql, withTransaction } from '../src/db.js';
import {
  assertPersonnelIdEncryptionKey,
  assertPersonnelIdHmacSecret,
  encryptNationalId,
  hashNationalId,
  isValidTurkishNationalId,
  normalizeAdUsername,
  normalizeEmail,
  normalizeHeader,
  normalizeMatchKey,
  normalizeNationalId,
  normalizePhone,
  normalizeText,
  resolvePersonnelContactColumns
} from '../src/personnelContactImport.js';

const MAX_REPORTED_ERRORS = 100;
const MAX_REPORTED_SKIPPED_ROWS = 20;

function usage() {
  return [
    'Kullanım:',
    '  npm run import:personnel-contact -- "C:\\Guvenli\\personel-iletisim.xlsx"',
    '  npm run import:personnel-contact -- "C:\\Guvenli\\personel-iletisim.xlsx" --apply',
    '',
    'Seçenekler:',
    '  --apply          Doğrulanan değişiklikleri SQL Server’a yazar.',
    '  --overwrite      Farklı mevcut telefon/T.C. özetini bilinçli olarak değiştirir.',
    '  --skip-invalid   Geçersiz telefon/T.C. içeren kaynak satırlarını tamamen atlar.',
    '  --skip-unmatched SQL’de personeli bulunmayan kaynak satırlarını raporlayıp atlar.',
    '  --sheet=Sayfa    Çok sayfalı dosyada kullanılacak sayfayı seçer.',
    '  --help           Bu yardımı gösterir.'
  ].join('\n');
}

export function parseArguments(argv) {
  const result = {
    filePath: '',
    apply: false,
    overwrite: false,
    skipInvalid: false,
    skipUnmatched: false,
    sheet: ''
  };

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else if (argument === '--apply') {
      result.apply = true;
    } else if (argument === '--overwrite') {
      result.overwrite = true;
    } else if (argument === '--skip-invalid') {
      result.skipInvalid = true;
    } else if (argument === '--skip-unmatched') {
      result.skipUnmatched = true;
    } else if (argument.startsWith('--sheet=')) {
      result.sheet = argument.slice('--sheet='.length).trim();
    } else if (argument.startsWith('--')) {
      throw new Error(`Bilinmeyen seçenek: ${argument}`);
    } else if (!result.filePath) {
      result.filePath = argument;
    } else {
      throw new Error(`Birden fazla dosya yolu verildi: ${argument}`);
    }
  }

  return result;
}

function cell(row, index) {
  return index > -1 ? row[index] : '';
}

function sheetHasRequiredColumns(sheet) {
  const headers = sheet?.data?.[0] || [];
  const columns = resolvePersonnelContactColumns(headers);
  const hasMatchKey = columns.personId > -1 || columns.email > -1 || columns.adUsername > -1;
  const hasContactData = columns.nationalId > -1 || columns.phone > -1;
  return hasMatchKey && hasContactData;
}

async function readSourceSheet(filePath, requestedSheet) {
  if (path.extname(filePath).toLocaleLowerCase('tr-TR') !== '.xlsx') {
    throw new Error('Kaynak dosya .xlsx biçiminde olmalıdır.');
  }

  const sheets = await readExcelFile(filePath);
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('Excel dosyasında okunabilir sayfa bulunamadı.');
  }

  if (requestedSheet) {
    const wanted = normalizeHeader(requestedSheet);
    const selected = sheets.find((sheet) => normalizeHeader(sheet.sheet) === wanted);
    if (!selected) {
      throw new Error(
        `Excel sayfası bulunamadı: ${requestedSheet}. Mevcut sayfalar: ${sheets
          .map((sheet) => sheet.sheet)
          .join(', ')}`
      );
    }
    if (!sheetHasRequiredColumns(selected)) {
      throw new Error(`"${selected.sheet}" sayfasında eşleştirme ve iletişim kolonları bulunamadı.`);
    }
    return selected;
  }

  const candidates = sheets.filter(sheetHasRequiredColumns);
  if (candidates.length === 0) {
    throw new Error(
      'Google ID/e-posta/AD kullanıcı adı ile T.C./Telefon kolonlarını birlikte içeren sayfa bulunamadı.'
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Birden fazla uygun sayfa bulundu (${candidates
        .map((sheet) => sheet.sheet)
        .join(', ')}). --sheet=SayfaAdı kullanın.`
    );
  }
  return candidates[0];
}

function addMapValue(map, key, personnel) {
  if (!key) return;
  const list = map.get(key) || [];
  list.push(personnel);
  map.set(key, list);
}

function buildPersonnelIndexes(personnelRows) {
  const indexes = {
    personId: new Map(),
    email: new Map(),
    adUsername: new Map(),
    nationalIdHash: new Map()
  };

  for (const personnel of personnelRows) {
    addMapValue(indexes.personId, normalizeMatchKey(personnel.PersonId), personnel);
    addMapValue(indexes.email, normalizeEmail(personnel.Email), personnel);
    addMapValue(indexes.adUsername, normalizeAdUsername(personnel.AdUsername), personnel);
    addMapValue(
      indexes.nationalIdHash,
      normalizeMatchKey(personnel.NationalIdHash),
      personnel
    );
  }

  return indexes;
}

function addError(errors, rowNumber, reason) {
  errors.push({ rowNumber, reason });
}

function resolvePersonnelForRow(source, indexes, errors) {
  const matches = new Map();
  const suppliedKeys = [
    ['Google ID', source.personId, indexes.personId],
    ['kurumsal e-posta', source.email, indexes.email],
    ['AD kullanıcı adı', source.adUsername, indexes.adUsername]
  ].filter(([, value]) => value);

  if (suppliedKeys.length === 0) {
    addError(errors, source.rowNumber, 'Google ID, kurumsal e-posta veya AD kullanıcı adı eksik.');
    return null;
  }

  let hasKeyError = false;
  for (const [label, value, index] of suppliedKeys) {
    const candidates = index.get(value) || [];
    if (candidates.length === 0) {
      addError(errors, source.rowNumber, `${label} SQL’de bulunamadı.`);
      hasKeyError = true;
      continue;
    }
    if (candidates.length > 1) {
      addError(errors, source.rowNumber, `${label} birden fazla SQL kaydıyla eşleşiyor.`);
      hasKeyError = true;
      continue;
    }
    matches.set(candidates[0].PersonId, candidates[0]);
  }

  if (hasKeyError) return null;
  if (matches.size !== 1) {
    addError(errors, source.rowNumber, 'Verilen eşleştirme alanları farklı personel kayıtlarını gösteriyor.');
    return null;
  }

  return [...matches.values()][0];
}

export function parseSourceRows(sheet, hmacSecret, options = {}) {
  const skipInvalid = options.skipInvalid === true;
  const encryptionKey = options.encryptionKey || '';
  const [headers, ...rows] = sheet.data;
  const columns = resolvePersonnelContactColumns(headers);
  const parsed = [];
  const errors = [];
  const skippedRows = [];
  let sourceCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rawPersonId = normalizeText(cell(row, columns.personId));
    const rawEmail = normalizeText(cell(row, columns.email));
    const rawAdUsername = normalizeText(cell(row, columns.adUsername));
    const rawNationalId = normalizeText(cell(row, columns.nationalId));
    const rawPhone = normalizeText(cell(row, columns.phone));

    if (!rawPersonId && !rawEmail && !rawAdUsername && !rawNationalId && !rawPhone) return;
    sourceCount += 1;

    const source = {
      rowNumber,
      personId: normalizeMatchKey(rawPersonId),
      email: normalizeEmail(rawEmail),
      adUsername: normalizeAdUsername(rawAdUsername),
      nationalId: normalizeNationalId(rawNationalId),
      nationalIdHash: '',
      nationalIdEncrypted: '',
      phone: normalizePhone(rawPhone)
    };
    const rowErrors = [];

    if (rawEmail && !source.email) {
      addError(rowErrors, rowNumber, 'Kurumsal e-posta biçimi geçersiz.');
    }
    if (rawPhone && !source.phone) {
      addError(rowErrors, rowNumber, 'Telefon 5 ile başlayan 10 haneli Türkiye cep telefonu olmalıdır.');
    }
    if (rawNationalId && !isValidTurkishNationalId(source.nationalId)) {
      addError(rowErrors, rowNumber, 'T.C. kimlik numarasının biçimi veya doğrulama basamakları geçersiz.');
    } else if (source.nationalId) {
      source.nationalIdHash = hashNationalId(source.nationalId, hmacSecret);
      if (encryptionKey) {
        source.nationalIdEncrypted = encryptNationalId(source.nationalId, encryptionKey);
      }
    }
    if (!source.phone && !source.nationalIdHash) {
      addError(rowErrors, rowNumber, 'Telefon veya T.C. kimlik numarasından en az biri gereklidir.');
    }

    if (rowErrors.length > 0 && skipInvalid) {
      skippedRows.push({
        rowNumber,
        reasons: rowErrors.map((error) => error.reason)
      });
      return;
    }

    errors.push(...rowErrors);
    delete source.nationalId;
    parsed.push(source);
  });

  if (sourceCount === 0) {
    throw new Error('Seçilen Excel sayfasında aktarılacak veri satırı bulunamadı.');
  }

  if (!skipInvalid) {
    return { parsed, errors, skippedRows, sourceCount };
  }

  const nationalIdHashCounts = new Map();
  for (const source of parsed) {
    if (!source.nationalIdHash) continue;
    nationalIdHashCounts.set(
      source.nationalIdHash,
      (nationalIdHashCounts.get(source.nationalIdHash) || 0) + 1
    );
  }

  const duplicateNationalIdHashes = new Set(
    [...nationalIdHashCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([nationalIdHash]) => nationalIdHash)
  );
  const filtered = [];
  for (const source of parsed) {
    if (
      source.nationalIdHash &&
      duplicateNationalIdHashes.has(source.nationalIdHash)
    ) {
      skippedRows.push({
        rowNumber: source.rowNumber,
        reasons: [
          'Aynı T.C. kimlik numarası kaynak dosyada birden fazla hesapta kullanılmış.'
        ]
      });
      continue;
    }
    filtered.push(source);
  }

  return { parsed: filtered, errors, skippedRows, sourceCount };
}

export function prepareChanges(sourceRows, personnelRows, overwrite, options = {}) {
  const errors = [];
  const skippedRows = [];
  const indexes = buildPersonnelIndexes(personnelRows);
  const changes = [];
  const matchedPersonRows = new Map();
  const sourceHashRows = new Map();
  let matchedCount = 0;
  let unchangedCount = 0;

  for (const source of sourceRows) {
    const rowErrors = [];
    const personnel = resolvePersonnelForRow(source, indexes, rowErrors);
    if (!personnel) {
      const onlyUnmatchedErrors =
        rowErrors.length > 0 &&
        rowErrors.every((error) => error.reason.endsWith('SQL’de bulunamadı.'));
      if (options.skipUnmatched === true && onlyUnmatchedErrors) {
        skippedRows.push({
          rowNumber: source.rowNumber,
          reasons: rowErrors.map((error) => error.reason)
        });
      } else {
        errors.push(...rowErrors);
      }
      continue;
    }
    matchedCount += 1;

    const previousSourceRow = matchedPersonRows.get(personnel.PersonId);
    if (previousSourceRow) {
      addError(
        errors,
        source.rowNumber,
        `Aynı personel Excel’in ${previousSourceRow}. satırında da bulunuyor.`
      );
      continue;
    }
    matchedPersonRows.set(personnel.PersonId, source.rowNumber);

    if (source.nationalIdHash) {
      const previousHashRow = sourceHashRows.get(source.nationalIdHash);
      if (previousHashRow) {
        addError(
          errors,
          source.rowNumber,
          `Aynı T.C. kimlik numarası Excel’in ${previousHashRow}. satırında da bulunuyor.`
        );
        continue;
      }
      sourceHashRows.set(source.nationalIdHash, source.rowNumber);

      const hashOwners = indexes.nationalIdHash.get(source.nationalIdHash) || [];
      if (hashOwners.some((owner) => owner.PersonId !== personnel.PersonId)) {
        addError(errors, source.rowNumber, 'T.C. kimlik numarası başka bir personel hesabına kayıtlı.');
        continue;
      }
    }

    const currentPhone = normalizeText(personnel.Phone);
    const comparableCurrentPhone = normalizePhone(currentPhone);
    const currentHash = normalizeMatchKey(personnel.NationalIdHash);
    const currentEncrypted = normalizeText(personnel.NationalIdEncrypted);
    let rowHasConflict = false;

    if (
      source.phone &&
      currentPhone &&
      comparableCurrentPhone !== source.phone &&
      !overwrite
    ) {
      addError(
        errors,
        source.rowNumber,
        'SQL’de farklı bir telefon kayıtlı. Bilinçli değişiklik için --overwrite kullanın.'
      );
      rowHasConflict = true;
    }
    if (
      source.nationalIdHash &&
      currentHash &&
      currentHash !== source.nationalIdHash &&
      !overwrite
    ) {
      addError(
        errors,
        source.rowNumber,
        'SQL’de farklı bir T.C. özeti kayıtlı. Bilinçli değişiklik için --overwrite kullanın.'
      );
      rowHasConflict = true;
    }
    if (rowHasConflict) continue;

    const desiredPhone = source.phone || currentPhone || null;
    const desiredNationalIdHash = source.nationalIdHash || currentHash || null;
    const desiredNationalIdEncrypted = source.nationalIdHash
      ? source.nationalIdHash === currentHash && currentEncrypted
        ? currentEncrypted
        : source.nationalIdEncrypted || currentEncrypted || null
      : currentEncrypted || null;
    const phoneChanged = (desiredPhone || '') !== currentPhone;
    const hashChanged = (desiredNationalIdHash || '') !== currentHash;
    const encryptedChanged = (desiredNationalIdEncrypted || '') !== currentEncrypted;

    if (!phoneChanged && !hashChanged && !encryptedChanged) {
      unchangedCount += 1;
      continue;
    }

    changes.push({
      personId: personnel.PersonId,
      phone: desiredPhone,
      nationalIdHash: desiredNationalIdHash,
      nationalIdEncrypted: desiredNationalIdEncrypted,
      expectedPhone: currentPhone || null,
      expectedNationalIdHash: currentHash || null,
      expectedNationalIdEncrypted: currentEncrypted || null
    });
  }

  return { changes, errors, skippedRows, matchedCount, unchangedCount };
}

function reportErrors(errors) {
  if (errors.length === 0) return;
  console.error('\nDoğrulama hataları:');
  for (const error of errors.slice(0, MAX_REPORTED_ERRORS)) {
    console.error(`  Satır ${error.rowNumber}: ${error.reason}`);
  }
  if (errors.length > MAX_REPORTED_ERRORS) {
    console.error(`  ... ${errors.length - MAX_REPORTED_ERRORS} hata daha gösterilmedi.`);
  }
}

function reportSkippedRows(skippedRows) {
  if (skippedRows.length === 0) return;
  console.warn('\nBilinçli olarak atlanan geçersiz kaynak satırları:');
  for (const skipped of skippedRows.slice(0, MAX_REPORTED_SKIPPED_ROWS)) {
    console.warn(`  Satır ${skipped.rowNumber}: ${skipped.reasons.join(' ')}`);
  }
  if (skippedRows.length > MAX_REPORTED_SKIPPED_ROWS) {
    console.warn(
      `  ... ${skippedRows.length - MAX_REPORTED_SKIPPED_ROWS} atlanan satır daha gösterilmedi.`
    );
  }
}

function reportSummary({
  filePath,
  sheetName,
  sourceCount,
  skippedRows,
  matchedCount,
  unchangedCount,
  changes,
  errors
}) {
  console.log('\nPersonel iletişim/kimlik aktarım özeti');
  console.log(`  Dosya:              ${path.basename(filePath)}`);
  console.log(`  Excel sayfası:       ${sheetName}`);
  console.log(`  Kaynak satır:        ${sourceCount}`);
  console.log(`  Atlanan satır:       ${skippedRows.length}`);
  console.log(`  SQL ile eşleşen:     ${matchedCount}`);
  console.log(`  Değişecek kayıt:     ${changes.length}`);
  console.log(`  Zaten güncel:        ${unchangedCount}`);
  console.log(`  Hatalı kayıt:        ${errors.length}`);
}

async function assertDatabaseReady(pool) {
  const readiness = await pool.request().query(`
SELECT CAST(
  CASE
    WHEN COL_LENGTH(N'dbo.Personnel', N'NationalIdHash') IS NULL THEN 0
    WHEN COL_LENGTH(N'dbo.Personnel', N'NationalIdEncrypted') IS NULL THEN 0
    ELSE 1
  END
  AS BIT
) AS Ready;
`);
  if (!readiness.recordset[0]?.Ready) {
    throw new Error(
      'Şifreli T.C. kolonları bulunamadı. Önce backend/sql/022_personnel_national_id_encryption.sql migration dosyasını çalıştırın.'
    );
  }
}

async function loadPersonnel(pool) {
  const result = await pool.request().query(`
SELECT PersonId, FullName, Email, AdUsername, Phone, NationalIdHash, NationalIdEncrypted
FROM dbo.Personnel;
`);
  if (result.recordset.length === 0) {
    throw new Error('SQL’de personel kaydı bulunamadı.');
  }
  return result.recordset;
}

async function applyChanges(changes) {
  const changesJson = JSON.stringify(changes);
  return withTransaction(async (transactionQuery) => {
    const result = await transactionQuery(
      `
SET XACT_ABORT ON;

DECLARE @Updated TABLE (PersonId NVARCHAR(160) NOT NULL PRIMARY KEY);

WITH SourceRows AS (
  SELECT
    PersonId,
    Phone,
    NationalIdHash,
    NationalIdEncrypted,
    ExpectedPhone,
    ExpectedNationalIdHash,
    ExpectedNationalIdEncrypted
  FROM OPENJSON(@ChangesJson)
  WITH (
    PersonId NVARCHAR(160) '$.personId',
    Phone NVARCHAR(20) '$.phone',
    NationalIdHash CHAR(64) '$.nationalIdHash',
    NationalIdEncrypted NVARCHAR(512) '$.nationalIdEncrypted',
    ExpectedPhone NVARCHAR(20) '$.expectedPhone',
    ExpectedNationalIdHash CHAR(64) '$.expectedNationalIdHash',
    ExpectedNationalIdEncrypted NVARCHAR(512) '$.expectedNationalIdEncrypted'
  )
)
UPDATE personnel WITH (UPDLOCK)
SET
  Phone = source.Phone,
  NationalIdHash = source.NationalIdHash,
  NationalIdEncrypted = source.NationalIdEncrypted,
  UpdatedAt = SYSUTCDATETIME()
OUTPUT INSERTED.PersonId INTO @Updated(PersonId)
FROM dbo.Personnel AS personnel
INNER JOIN SourceRows AS source ON source.PersonId = personnel.PersonId
WHERE ISNULL(personnel.Phone, N'') = ISNULL(source.ExpectedPhone, N'')
  AND ISNULL(personnel.NationalIdHash, '') = ISNULL(source.ExpectedNationalIdHash, '')
  AND ISNULL(personnel.NationalIdEncrypted, N'') = ISNULL(source.ExpectedNationalIdEncrypted, N'');

SELECT COUNT_BIG(1) AS UpdatedCount FROM @Updated;
`,
      {
        ChangesJson: {
          type: sql.NVarChar(sql.MAX),
          value: changesJson
        }
      }
    );

    const updatedCount = Number(result.recordset[0]?.UpdatedCount || 0);
    if (updatedCount !== changes.length) {
      throw new Error(
        'Aktarım sırasında bazı personel kayıtları başka bir işlem tarafından değiştirildi. Hiçbir değişiklik kaydedilmedi; dry-run işlemini yeniden çalıştırın.'
      );
    }
    return updatedCount;
  }, sql.ISOLATION_LEVEL.SERIALIZABLE);
}

export async function runImport(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.filePath) throw new Error(`Excel dosyası belirtilmedi.\n\n${usage()}`);

  const filePath = path.resolve(options.filePath);
  if (!fs.existsSync(filePath)) throw new Error(`Excel dosyası bulunamadı: ${filePath}`);
  const hmacSecret = assertPersonnelIdHmacSecret(config.personnelIdHmacSecret);
  assertPersonnelIdEncryptionKey(config.personnelIdEncryptionKey);
  const encryptionKey = config.personnelIdEncryptionKey;
  const sheet = await readSourceSheet(filePath, options.sheet);
  const sourceResult = parseSourceRows(sheet, hmacSecret, {
    skipInvalid: options.skipInvalid,
    encryptionKey
  });

  const pool = await getPool();
  await assertDatabaseReady(pool);
  const personnelRows = await loadPersonnel(pool);
  const prepared = prepareChanges(sourceResult.parsed, personnelRows, options.overwrite, {
    skipUnmatched: options.skipUnmatched
  });
  const errors = [...sourceResult.errors, ...prepared.errors];
  const skippedRows = [...sourceResult.skippedRows, ...prepared.skippedRows];

  reportSummary({
    filePath,
    sheetName: sheet.sheet,
    sourceCount: sourceResult.sourceCount,
    skippedRows,
    matchedCount: prepared.matchedCount,
    unchangedCount: prepared.unchangedCount,
    changes: prepared.changes,
    errors
  });
  reportSkippedRows(skippedRows);
  reportErrors(errors);

  if (errors.length > 0) {
    throw new Error('Hatalar düzeltilmeden SQL verisi değiştirilmedi.');
  }
  if (sourceResult.parsed.length === 0) {
    throw new Error('Geçersiz satırlar atlandıktan sonra aktarılabilir kayıt kalmadı.');
  }
  if (!options.apply) {
    console.log('\nDry-run tamamlandı; SQL değiştirilmedi. Uygulamak için aynı komuta --apply ekleyin.');
    return;
  }
  if (prepared.changes.length === 0) {
    console.log('\nTüm kayıtlar zaten güncel; SQL’de değişiklik yapılmadı.');
    return;
  }

  const updatedCount = await applyChanges(prepared.changes);
  console.log(`\nAktarım tamamlandı: ${updatedCount} personel kaydı güvenli biçimde güncellendi.`);
}

const isMain =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runImport()
    .catch((error) => {
      console.error(`\nAktarım başarısız: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
    });
}
