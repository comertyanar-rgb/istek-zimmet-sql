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

