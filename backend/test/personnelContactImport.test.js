import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPersonnelIdEncryptionKey,
  decryptNationalId,
  encryptNationalId,
  hashNationalId,
  isValidTurkishNationalId,
  normalizeAdUsername,
  normalizeHeader,
  normalizePhone,
  resolvePersonnelContactColumns
} from '../src/personnelContactImport.js';
import {
  parseArguments,
  parseSourceRows,
  prepareChanges
} from '../scripts/import-personnel-contact-data.js';

const TEST_SECRET = 'test-only-personnel-hmac-secret-32-characters-minimum';
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

test('Türkçe kolon başlıklarını kararlı biçimde normalize eder', () => {
  assert.equal(normalizeHeader(' T.C. Kimlik No '), 't c kimlik no');
  assert.equal(normalizeHeader('AD_Kullanıcı'), 'ad kullanici');
});

test('desteklenen Excel kolonlarını tanır', () => {
  const columns = resolvePersonnelContactColumns([
    'Google ID',
    'Kurumsal E-Posta',
    'AD Kullanıcı',
    'T.C. Kimlik No',
    'Cep Telefonu'
  ]);
  assert.deepEqual(columns, {
    personId: 0,
    email: 1,
    adUsername: 2,
    nationalId: 3,
    phone: 4
  });
});

test('noktalı kısa T.C başlığını tanır', () => {
  const columns = resolvePersonnelContactColumns(['User Id', 'Email', 'Telefon', 'T.C']);
  assert.equal(columns.nationalId, 3);
});

test('Türkiye cep telefonu biçimlerini 10 haneye indirger', () => {
  assert.equal(normalizePhone('0538 414 20 88'), '5384142088');
  assert.equal(normalizePhone('+90 (538) 414 20 88'), '5384142088');
  assert.equal(normalizePhone('5384142088'), '5384142088');
  assert.equal(normalizePhone('2125551212'), '');
});

test('skip-invalid seçeneğini açık kullanıcı onayı olarak ayrıştırır', () => {
  const options = parseArguments(['personel.xlsx', '--skip-invalid', '--apply']);
  assert.equal(options.filePath, 'personel.xlsx');
  assert.equal(options.skipInvalid, true);
  assert.equal(options.apply, true);
});

test('skip-invalid geçersiz kaynak satırının tamamını atlar ve geçerli telefonu normalize eder', () => {
  const result = parseSourceRows(
    {
      data: [
        ['User Id', 'Email', 'Telefon', 'T.C'],
        ['google-1', 'bir@istek.k12.tr', '+90 (538) 414 20 88', '10000000146'],
        ['google-2', 'iki@istek.k12.tr', '2125551212', '10000000146'],
        ['google-3', 'uc@istek.k12.tr', '0538 111 22 33', '#REF!']
      ]
    },
    TEST_SECRET,
    { skipInvalid: true }
  );

  assert.equal(result.sourceCount, 3);
  assert.equal(result.parsed.length, 1);
  assert.equal(result.parsed[0].phone, '5384142088');
  assert.deepEqual(
    result.skippedRows.map((row) => row.rowNumber),
    [3, 4]
  );
  assert.equal(result.errors.length, 0);
});

test('skip-invalid aynı T.C. bulunan hesapların tamamını atlar', () => {
  const result = parseSourceRows(
    {
      data: [
        ['User Id', 'Email', 'Telefon', 'T.C'],
        ['google-1', 'bir@istek.k12.tr', '0538 111 22 33', '10000000146'],
        ['google-2', 'iki@istek.k12.tr', '0538 111 22 34', '10000000146'],
        ['google-3', 'uc@istek.k12.tr', '0538 111 22 35', '10000000214']
      ]
    },
    TEST_SECRET,
    { skipInvalid: true }
  );

  assert.deepEqual(
    result.parsed.map((row) => row.personId),
    ['google-3']
  );
  assert.deepEqual(
    result.skippedRows.map((row) => row.rowNumber),
    [2, 3]
  );
  assert.equal(result.errors.length, 0);
});

test('AD kullanıcı adında etki alanı ekini kaldırır', () => {
  assert.equal(normalizeAdUsername('comert.yanar@istek.k12.tr'), 'comert.yanar');
  assert.equal(normalizeAdUsername('COMERT.YANAR'), 'comert.yanar');
});

test('T.C. kimlik doğrulama basamaklarını denetler', () => {
  assert.equal(isValidTurkishNationalId('10000000146'), true);
  assert.equal(isValidTurkishNationalId('10000000145'), false);
  assert.equal(isValidTurkishNationalId('00000000000'), false);
});

test('T.C. kimlik HMAC özeti deterministik, anahtara bağlı ve geri döndürülemez biçimdedir', () => {
  const first = hashNationalId('10000000146', TEST_SECRET);
  const second = hashNationalId('10000000146', TEST_SECRET);
  const otherSecret = hashNationalId(
    '10000000146',
    'different-test-only-personnel-hmac-secret-32-characters'
  );

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, otherSecret);
  assert.equal(first.includes('10000000146'), false);
});

test('T.C. kimlik numarasını AES-256-GCM ile geri çözülebilir ve rastgele şifreler', () => {
  assert.equal(assertPersonnelIdEncryptionKey(TEST_ENCRYPTION_KEY).length, 32);

  const first = encryptNationalId('10000000146', TEST_ENCRYPTION_KEY);
  const second = encryptNationalId('10000000146', TEST_ENCRYPTION_KEY);

  assert.match(first, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(decryptNationalId(first, TEST_ENCRYPTION_KEY), '10000000146');
  assert.equal(decryptNationalId(second, TEST_ENCRYPTION_KEY), '10000000146');
});

test('oynanmış şifreli T.C. verisini reddeder', () => {
  const encrypted = encryptNationalId('10000000146', TEST_ENCRYPTION_KEY);
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;

  assert.throws(
    () => decryptNationalId(tampered, TEST_ENCRYPTION_KEY),
    /çözülemedi/i
  );
});

test('kaynak T.C. verisini içe aktarım sırasında şifreler', () => {
  const result = parseSourceRows(
    {
      data: [
        ['User Id', 'Email', 'Telefon', 'T.C'],
        ['google-1', 'bir@istek.k12.tr', '0538 111 22 33', '10000000146']
      ]
    },
    TEST_SECRET,
    { encryptionKey: TEST_ENCRYPTION_KEY }
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.parsed.length, 1);
  assert.equal(
    decryptNationalId(result.parsed[0].nationalIdEncrypted, TEST_ENCRYPTION_KEY),
    '10000000146'
  );
});

test('yalnız güvenilir hesap anahtarları aynı personeli gösterdiğinde güncelleme hazırlar', () => {
  const sourceHash = hashNationalId('10000000146', TEST_SECRET);
  const result = prepareChanges(
    [
      {
        rowNumber: 2,
        personId: 'google-1',
        email: 'personel@istek.k12.tr',
        adUsername: 'personel',
        phone: '5384142088',
        nationalIdHash: sourceHash
      }
    ],
    [
      {
        PersonId: 'google-1',
        Email: 'personel@istek.k12.tr',
        AdUsername: 'personel',
        Phone: null,
        NationalIdHash: null
      }
    ],
    false
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].phone, '5384142088');
  assert.equal(result.changes[0].nationalIdHash, sourceHash);
});

test('aynı T.C. özeti için mevcut şifreli değeri korur', () => {
  const nationalIdHash = hashNationalId('10000000146', TEST_SECRET);
  const currentEncrypted = encryptNationalId('10000000146', TEST_ENCRYPTION_KEY);
  const replacementEncrypted = encryptNationalId('10000000146', TEST_ENCRYPTION_KEY);
  const result = prepareChanges(
    [
      {
        rowNumber: 2,
        personId: 'google-1',
        email: 'personel@istek.k12.tr',
        adUsername: 'personel',
        phone: '5384142088',
        nationalIdHash,
        nationalIdEncrypted: replacementEncrypted
      }
    ],
    [
      {
        PersonId: 'google-1',
        Email: 'personel@istek.k12.tr',
        AdUsername: 'personel',
        Phone: null,
        NationalIdHash: nationalIdHash,
        NationalIdEncrypted: currentEncrypted
      }
    ],
    false
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].nationalIdEncrypted, currentEncrypted);
});

test('eski kayıtta şifreli T.C. yoksa aynı özet üzerinden alanı tamamlar', () => {
  const nationalIdHash = hashNationalId('10000000146', TEST_SECRET);
  const encrypted = encryptNationalId('10000000146', TEST_ENCRYPTION_KEY);
  const result = prepareChanges(
    [
      {
        rowNumber: 2,
        personId: 'google-1',
        email: 'personel@istek.k12.tr',
        adUsername: 'personel',
        phone: '',
        nationalIdHash,
        nationalIdEncrypted: encrypted
      }
    ],
    [
      {
        PersonId: 'google-1',
        Email: 'personel@istek.k12.tr',
        AdUsername: 'personel',
        Phone: null,
        NationalIdHash: nationalIdHash,
        NationalIdEncrypted: null
      }
    ],
    false
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].nationalIdEncrypted, encrypted);
});

test('eşleştirme alanları farklı hesapları gösteriyorsa güncellemeyi engeller', () => {
  const result = prepareChanges(
    [
      {
        rowNumber: 2,
        personId: 'google-1',
        email: 'diger@istek.k12.tr',
        adUsername: '',
        phone: '5384142088',
        nationalIdHash: ''
      }
    ],
    [
      {
        PersonId: 'google-1',
        Email: 'birinci@istek.k12.tr',
        AdUsername: 'birinci',
        Phone: null,
        NationalIdHash: null
      },
      {
        PersonId: 'google-2',
        Email: 'diger@istek.k12.tr',
        AdUsername: 'diger',
        Phone: null,
        NationalIdHash: null
      }
    ],
    false
  );

  assert.equal(result.changes.length, 0);
  assert.match(result.errors[0].reason, /farklı personel/i);
});

test('mevcut farklı telefonu overwrite olmadan değiştirmez', () => {
  const source = [
    {
      rowNumber: 2,
      personId: 'google-1',
      email: '',
      adUsername: '',
      phone: '5384142088',
      nationalIdHash: ''
    }
  ];
  const personnel = [
    {
      PersonId: 'google-1',
      Email: 'personel@istek.k12.tr',
      AdUsername: 'personel',
      Phone: '5551112233',
      NationalIdHash: null
    }
  ];

  const protectedResult = prepareChanges(source, personnel, false);
  const overwriteResult = prepareChanges(source, personnel, true);

  assert.equal(protectedResult.changes.length, 0);
  assert.match(protectedResult.errors[0].reason, /--overwrite/);
  assert.equal(overwriteResult.errors.length, 0);
  assert.equal(overwriteResult.changes[0].phone, '5384142088');
});
