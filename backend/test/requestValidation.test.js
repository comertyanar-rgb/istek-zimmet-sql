import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestValidationError, validateActionRequest } from '../src/requestValidation.js';

test('bilinen ve sade bir aksiyon isteğini kabul eder', () => {
  const payload = { action: 'fetchData', authToken: 'x'.repeat(43), since: '2026-07-11T10:00:00Z' };
  assert.equal(validateActionRequest(payload), payload);
});

test('personel belge geçmişi isteğini kabul eder', () => {
  const payload = {
    action: 'fetchPersonDocumentHistory',
    authToken: 'x'.repeat(43),
    personId: 'person-123'
  };
  assert.equal(validateActionRequest(payload), payload);
});

test('bilinmeyen aksiyonu iş mantığına ulaşmadan reddeder', () => {
  assert.throws(
    () => validateActionRequest({ action: 'deleteEverything' }),
    (error) => error instanceof RequestValidationError && /desteklenmiyor/i.test(error.message)
  );
});

test('prototype pollution alanlarını iç içe nesnelerde reddeder', () => {
  const payload = JSON.parse('{"action":"updateHardware","updates":{"__proto__":{"admin":true}}}');
  assert.throws(
    () => validateActionRequest(payload),
    (error) => error instanceof RequestValidationError && /güvenli olmayan/i.test(error.message)
  );
});

test('çok derin JSON ağacını reddeder', () => {
  const payload = { action: 'fetchData' };
  let cursor = payload;
  for (let index = 0; index < 14; index += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(
    () => validateActionRequest(payload),
    (error) => error instanceof RequestValidationError && /iç içe/i.test(error.message)
  );
});

test('kimlik listelerinde nesne kabul etmez', () => {
  assert.throws(
    () => validateActionRequest({ action: 'bulkUpdateGroup', hardwareIds: [{ id: 'ABC' }] }),
    (error) => error instanceof RequestValidationError && /geçersiz bir kimlik/i.test(error.message)
  );
});

test('senkronizasyon ve dışa aktarım liste biçimini zorunlu tutar', () => {
  assert.throws(
    () => validateActionRequest({ action: 'syncGLPI', items: {} }),
    (error) => error instanceof RequestValidationError && /liste biçiminde/i.test(error.message)
  );
  assert.throws(
    () => validateActionRequest({ action: 'createSheet', data: {} }),
    (error) => error instanceof RequestValidationError && /liste biçiminde/i.test(error.message)
  );
});

test('tek personellik eski senkronizasyon biçimini korur', () => {
  const payload = { action: 'syncPersonnel', person: { id: '123', email: 'test@istek.k12.tr' } };
  assert.equal(validateActionRequest(payload), payload);
});

test('toplu donanım içe aktarma listesini doğrular', () => {
  const payload = {
    action: 'bulkAddHardware',
    items: [{ serial: 'SN-001', type: 'Laptop', brand: 'Lenovo', model: 'ThinkPad' }]
  };
  assert.equal(validateActionRequest(payload), payload);

  assert.throws(
    () => validateActionRequest({ action: 'bulkAddHardware', items: [] }),
    (error) => error instanceof RequestValidationError && /bulunamadı/i.test(error.message)
  );
  assert.throws(
    () => validateActionRequest({ action: 'bulkAddHardware', items: [{ serial: 'SN-001' }, null] }),
    (error) => error instanceof RequestValidationError && /geçersiz bir kayıt/i.test(error.message)
  );
});

test('toplu donanım içe aktarmada 1000 satır sınırını uygular', () => {
  assert.throws(
    () =>
      validateActionRequest({
        action: 'bulkAddHardware',
        items: Array.from({ length: 1001 }, (_, index) => ({ serial: `SN-${index}` }))
      }),
    (error) => error instanceof RequestValidationError && /en fazla 1000/i.test(error.message)
  );
});

test('T.C. ile personel aramasında tam 11 hane ister', () => {
  const payload = {
    action: 'lookupPersonnelByNationalId',
    authToken: 'x'.repeat(43),
    nationalId: '10000000146'
  };
  assert.equal(validateActionRequest(payload), payload);

  assert.throws(
    () =>
      validateActionRequest({
        action: 'lookupPersonnelByNationalId',
        authToken: 'x'.repeat(43),
        nationalId: '1000000014'
      }),
    (error) => error instanceof RequestValidationError && /11 haneli/i.test(error.message)
  );
});

test('ilk migrasyon zimmetinde listeyi ve açık onayı zorunlu tutar', () => {
  const payload = {
    action: 'bulkInitialAssignment',
    authToken: 'x'.repeat(43),
    confirmMigration: true,
    items: [{ rowNumber: 2, serial: 'SN-001', personEmail: 'personel@istek.k12.tr' }]
  };
  assert.equal(validateActionRequest(payload), payload);

  assert.throws(
    () =>
      validateActionRequest({
        action: 'bulkInitialAssignment',
        confirmMigration: false,
        items: [{ serial: 'SN-001', personEmail: 'personel@istek.k12.tr' }]
      }),
    (error) => error instanceof RequestValidationError && /açıkça onaylanmalıdır/i.test(error.message)
  );

  assert.throws(
    () =>
      validateActionRequest({
        action: 'bulkInitialAssignment',
        confirmMigration: true,
        items: []
      }),
    (error) => error instanceof RequestValidationError && /1-5000/i.test(error.message)
  );
});

test('ilk migrasyon zimmetinde 5000 satır sınırını uygular', () => {
  assert.throws(
    () =>
      validateActionRequest({
        action: 'bulkInitialAssignment',
        confirmMigration: true,
        items: Array.from({ length: 5001 }, (_, index) => ({
          serial: `SN-${index}`,
          personEmail: `personel${index}@istek.k12.tr`
        }))
      }),
    (error) => error instanceof RequestValidationError && /en fazla 5000/i.test(error.message)
  );
});

test('ilk migrasyon zimmetinde uzun veya yanlış tipte alanları reddeder', () => {
  const base = {
    action: 'bulkInitialAssignment',
    authToken: 'x'.repeat(43),
    confirmMigration: true
  };

  assert.throws(
    () =>
      validateActionRequest({
        ...base,
        items: [{ rowNumber: 2, serial: 'S'.repeat(162), personEmail: 'personel@istek.k12.tr' }]
      }),
    (error) => error instanceof RequestValidationError && /geçersiz seri no/i.test(error.message)
  );

  assert.throws(
    () =>
      validateActionRequest({
        ...base,
        items: [{ rowNumber: 2, serial: 12345, personEmail: 'personel@istek.k12.tr' }]
      }),
    (error) => error instanceof RequestValidationError && /geçersiz seri no/i.test(error.message)
  );

  assert.throws(
    () =>
      validateActionRequest({
        ...base,
        items: [{ rowNumber: 2, serial: 'SN-001', personEmail: `${'a'.repeat(310)}@istek.k12.tr` }]
      }),
    (error) => error instanceof RequestValidationError && /personel e-posta/i.test(error.message)
  );

  const drivePayload = {
    ...base,
    items: [
      {
        rowNumber: 2,
        serial: 'SN-001',
        personEmail: 'personel@istek.k12.tr',
        driveLink: 'https://drive.google.com/file/d/test/view'
      }
    ]
  };
  assert.equal(validateActionRequest(drivePayload), drivePayload);

  assert.throws(
    () =>
      validateActionRequest({
        ...base,
        items: [
          {
            rowNumber: 2,
            serial: 'SN-001',
            personEmail: 'personel@istek.k12.tr',
            driveLink: 'https://example.com/belge.pdf'
          }
        ]
      }),
    (error) => error instanceof RequestValidationError && /Google Drive veya Google Docs/i.test(error.message)
  );
});

test('dışa aktarım biçimini doğrular', () => {
  const payload = { action: 'createSheet', data: [{ Ad: 'Cömert' }], format: 'xlsx' };
  assert.equal(validateActionRequest(payload), payload);

  const templatePayload = {
    action: 'createSheet',
    data: [],
    templateHeaders: ['Seri No *', 'Marka *', 'Model *'],
    format: 'xlsx'
  };
  assert.equal(validateActionRequest(templatePayload), templatePayload);

  assert.throws(
    () => validateActionRequest({ action: 'createSheet', data: [{ Ad: 'Cömert' }], format: 'csv' }),
    (error) => error instanceof RequestValidationError && /biçimi geçersiz/i.test(error.message)
  );
  assert.throws(
    () => validateActionRequest({ action: 'createSheet', data: [], templateHeaders: [''] }),
    (error) => error instanceof RequestValidationError && /şablon başlıkları/i.test(error.message)
  );
});

test('imza işi iptalinde kuyruk kimliğini zorunlu tutar', () => {
  const payload = { action: 'cancelSignatureJob', authToken: 'x'.repeat(43), queueId: 'SIG-TEST-001' };
  assert.equal(validateActionRequest(payload), payload);

  assert.throws(
    () => validateActionRequest({ action: 'cancelSignatureJob', authToken: 'x'.repeat(43), queueId: '' }),
    (error) => error instanceof RequestValidationError && /kuyruğu kimliği/i.test(error.message)
  );
});

test('imza agent durum sorgusunda en fazla 25 kimlik kabul eder', () => {
  const payload = {
    action: 'fetchSignatureJobStates',
    signatureIds: ['ABC12345']
  };
  assert.equal(validateActionRequest(payload), payload);

  assert.throws(
    () =>
      validateActionRequest({
        action: 'fetchSignatureJobStates',
        signatureIds: Array.from({ length: 26 }, (_, index) => `SIG${index}`)
      }),
    (error) => error instanceof RequestValidationError && /en fazla 25/i.test(error.message)
  );
});

test('kuyruk bildirimi gizleme isteğini tür ve kimlik bazında doğrular', () => {
  const payload = {
    action: 'dismissQueueNotifications',
    authToken: 'x'.repeat(43),
    items: [
      { kind: 'operation', queueId: 'PDF-TEST-001' },
      { kind: 'ad-password', queueId: 'AD-TEST-001' },
      { kind: 'signature', queueId: 'SIG-TEST-001' }
    ]
  };
  assert.equal(validateActionRequest(payload), payload);

  assert.throws(
    () =>
      validateActionRequest({
        action: 'dismissQueueNotifications',
        items: [{ kind: 'unknown', queueId: 'TEST-001' }]
      }),
    (error) => error instanceof RequestValidationError && /geçersiz/i.test(error.message)
  );

  assert.throws(
    () => validateActionRequest({ action: 'dismissQueueNotifications', items: [] }),
    (error) => error instanceof RequestValidationError && /1-100/i.test(error.message)
  );
});
