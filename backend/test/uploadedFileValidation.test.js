import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCanonicalBase64 } from '../src/uploadedFileValidation.js';

test('kanonik Base64 dosya verisini çözer', () => {
  const source = Buffer.from('%PDF-test', 'utf8');
  const decoded = decodeCanonicalBase64(source.toString('base64'), { maxBytes: 100 });
  assert.deepEqual(decoded, source);
});

test('Node Buffer tarafından sessizce yutulabilecek Base64 karakterlerini reddeder', () => {
  assert.throws(
    () => decodeCanonicalBase64('JVBERi0xLjQ=\nignored', { maxBytes: 100 }),
    /Base64 biçimi geçersiz/i
  );
});

test('çözülmüş gerçek dosya boyutunu sınırlar', () => {
  const encoded = Buffer.from('1234', 'utf8').toString('base64');
  assert.throws(() => decodeCanonicalBase64(encoded, { maxBytes: 3 }), /çok büyük/i);
});

test('çok sayfalı PDF boyutundaki Base64 verisini çağrı yığınını taşırmadan çözer', () => {
  const source = Buffer.alloc(4 * 1024 * 1024 + 1, 0x5a);
  const decoded = decodeCanonicalBase64(source.toString('base64'), {
    label: 'PDF',
    maxBytes: 5 * 1024 * 1024
  });

  assert.equal(decoded.length, source.length);
  assert.equal(decoded[0], 0x5a);
  assert.equal(decoded.at(-1), 0x5a);
});

test('büyük Base64 verisindeki geçersiz karakteri çağrı yığını hatası vermeden reddeder', () => {
  const encoded = Buffer.alloc(4 * 1024 * 1024, 0x41).toString('base64');
  const invalid = `${encoded.slice(0, -5)}!${encoded.slice(-4)}`;

  assert.throws(
    () => decodeCanonicalBase64(invalid, { maxBytes: 5 * 1024 * 1024 }),
    /Base64 biçimi geçersiz/i
  );
});
