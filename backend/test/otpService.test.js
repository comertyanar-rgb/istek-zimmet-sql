import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTrMobile, setOtpTestObserver } from '../src/otpService.js';

test('Türkiye cep telefonu biçimlerini 10 haneye indirger', () => {
  assert.equal(normalizeTrMobile('0538 414 20 88'), '5384142088');
  assert.equal(normalizeTrMobile('+90 (538) 414-20-88'), '5384142088');
  assert.equal(normalizeTrMobile('0090 538 414 20 88'), '5384142088');
});

test('geçersiz veya sabit telefon numarasını reddeder', () => {
  assert.throws(() => normalizeTrMobile('2121234567'), /5 ile başlayan 10 haneli/i);
  assert.throws(() => normalizeTrMobile('538123'), /5 ile başlayan 10 haneli/i);
});

test('OTP gözlemcisi normal çalışma sürecinde kapalıdır', () => {
  assert.throws(
    () => setOtpTestObserver(() => {}),
    /yalnız açıkça izin verilen test sürecinde/i
  );
});
