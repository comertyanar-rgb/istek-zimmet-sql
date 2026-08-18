import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalCampusName,
  core,
  KONYAALTI_CAMPUS_NAME
} from '../src/repositories/inventoryRepository.js';

const KONYAALTI_ALIASES = [
  'Konyaaltı',
  'Konyaaltı Kampüsü',
  'Konyaaltı - İlkokul',
  'Konyaaltı İlkokul',
  'Antalya Kampüsü (Konyaaltı)',
  'Antalya_Konyaalti'
];

test('Konyaaltı kampüs varyantları aynı yetki anahtarına çözülür', () => {
  for (const alias of KONYAALTI_ALIASES) {
    assert.equal(core(alias), 'konyaaltı', alias);
    assert.equal(canonicalCampusName(alias), KONYAALTI_CAMPUS_NAME, alias);
  }
});

test('Lara kampüsü Konyaaltı birleşimine dahil edilmez', () => {
  assert.equal(core('Antalya Kampüsü (Lara)'), 'antalya (lara)');
  assert.equal(canonicalCampusName('Antalya Kampüsü (Lara)'), 'Antalya Kampüsü (Lara)');
  assert.notEqual(core('Antalya Kampüsü (Lara)'), core('Konyaaltı Kampüsü'));
});
