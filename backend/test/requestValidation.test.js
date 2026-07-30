import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestValidationError, validateActionRequest } from '../src/requestValidation.js';

test('bilinen ve sade bir aksiyon isteğini kabul eder', () => {
  const payload = { action: 'fetchData', authToken: 'x'.repeat(43), since: '2026-07-11T10:00:00Z' };
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
