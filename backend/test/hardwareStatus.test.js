import assert from 'node:assert/strict';
import test from 'node:test';

import { toDbStatus, toUiStatus } from '../src/repositories/inventoryRepository.js';

test('ARIZALI veritabani durumu arayuzde Faulty olarak gosterilir', () => {
  assert.equal(toUiStatus('ARIZALI'), 'Faulty');
  assert.equal(toUiStatus('arizali'), 'Faulty');
});

test('Faulty ve Arizali arayuz degerleri ARIZALI olarak kaydedilir', () => {
  assert.equal(toDbStatus('Faulty'), 'ARIZALI');
  assert.equal(toDbStatus('Arizali'), 'ARIZALI');
});

test('bilinmeyen durum sessizce depoya cevrilmez', () => {
  assert.equal(toDbStatus('BILINMEYEN_DURUM'), '');
});
