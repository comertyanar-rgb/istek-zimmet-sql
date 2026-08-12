import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSignatureNameWidth,
  getSignatureTemplateVariant,
  isWideSignatureName,
  normalizeSignatureTemplateKey,
} from '../src/signatureTemplate.js';

test('imza şablonu anahtarlarını güvenli biçimde normalleştirir', () => {
  assert.equal(normalizeSignatureTemplateKey('imza-template-2-w'), '2-w');
  assert.equal(normalizeSignatureTemplateKey('TPL4'), '4');
  assert.equal(normalizeSignatureTemplateKey('normal'), '1');
  assert.equal(normalizeSignatureTemplateKey('compact'), '2');
  assert.equal(normalizeSignatureTemplateKey('small'), '3');
  assert.equal(normalizeSignatureTemplateKey('tiny'), '4');
  assert.equal(normalizeSignatureTemplateKey('7'), '');
  assert.equal(normalizeSignatureTemplateKey('../1'), '');
});

test('kısa ve uzun adların görsel genişliğini ayırt eder', () => {
  assert.ok(getSignatureNameWidth('Mustafa Ali') < getSignatureNameWidth('MUHAMMED MÜCAHİT ÖZDEMİROĞLU'));
  assert.equal(isWideSignatureName('Cömert Yanar'), false);
  assert.equal(isWideSignatureName('MUHAMMED MÜCAHİT ÖZDEMİROĞLU'), true);
});

test('uzun adlarda seçilen ünvan şablonuna wide eki ekler', () => {
  assert.equal(getSignatureTemplateVariant('Bilgi İşlem Uzmanı', 'IT Specialist', '2', 'Cömert Yanar'), '2');
  assert.equal(
    getSignatureTemplateVariant('Bilgi İşlem Uzmanı', 'IT Specialist', '2', 'MUHAMMED MÜCAHİT ÖZDEMİROĞLU'),
    '2-w'
  );
  assert.equal(
    getSignatureTemplateVariant('Bilgi İşlem Uzmanı', 'IT Specialist', '3-w', 'Cömert Yanar'),
    '3-w'
  );
});

test('ünvan uzunluğuna göre temel şablonu seçer', () => {
  assert.equal(getSignatureTemplateVariant('Uzman', 'Specialist', '', 'Ada Tan'), '1');
  assert.equal(
    getSignatureTemplateVariant('Kurumsal Uygulamalar ve Entegrasyonlar Yöneticisi', 'Enterprise Applications Manager', '', 'Ada Tan'),
    '3'
  );
});
