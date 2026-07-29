import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertSessionCookieConfig,
  readCookieValue,
  serializeSessionCookie
} from '../src/sessionCookie.js';

const secureConfig = {
  cookieEnabled: true,
  cookieName: '__Host-istek_session',
  cookieSecure: true,
  cookieSameSite: 'Lax',
  cookieDomain: '',
  cookieMaxAgeSeconds: 6 * 60 * 60
};

test('oturum cookie degeri guvenli niteliklerle yazilir', () => {
  const serialized = serializeSessionCookie('abc_123-XYZ', secureConfig);

  assert.match(serialized, /^__Host-istek_session=abc_123-XYZ;/);
  assert.match(serialized, /(?:^|; )Path=\/(?:;|$)/);
  assert.match(serialized, /(?:^|; )HttpOnly(?:;|$)/);
  assert.match(serialized, /(?:^|; )Secure(?:;|$)/);
  assert.match(serialized, /(?:^|; )SameSite=Lax(?:;|$)/);
  assert.match(serialized, /(?:^|; )Max-Age=21600(?:;|$)/);
  assert.doesNotMatch(serialized, /(?:^|; )Domain=/);
});

test('oturum cookie temizligi tarayiciya acik son kullanma talimati verir', () => {
  const serialized = serializeSessionCookie('', secureConfig, { clear: true });

  assert.match(serialized, /^__Host-istek_session=;/);
  assert.match(serialized, /(?:^|; )Max-Age=0(?:;|$)/);
  assert.match(serialized, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(serialized, /(?:^|; )HttpOnly(?:;|$)/);
  assert.match(serialized, /(?:^|; )Secure(?:;|$)/);
});

test('cookie basligindan yalniz istenen cookie okunur', () => {
  const header = 'theme=light; istek_session=abc%2Fdef%3D; other=value';
  assert.equal(readCookieValue(header, 'istek_session'), 'abc/def=');
  assert.equal(readCookieValue(header, 'missing'), '');
  assert.equal(readCookieValue('istek_session=%E0%A4%A', 'istek_session'), '');
});

test('SameSite=None Secure olmadan reddedilir', () => {
  assert.throws(
    () =>
      assertSessionCookieConfig({
        ...secureConfig,
        cookieName: 'istek_session',
        cookieSecure: false,
        cookieSameSite: 'None'
      }),
    /SECURE=true zorunludur/i
  );
});

test('__Host- cookie domain tanimlayamaz', () => {
  assert.throws(
    () => assertSessionCookieConfig({ ...secureConfig, cookieDomain: 'example.com' }),
    /DOMAIN bos olmalidir|DOMAIN boş olmalıdır/i
  );
});
