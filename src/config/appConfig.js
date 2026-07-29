const configuredApiUrl = String(import.meta.env.VITE_API_URL || '').trim();
const allowLegacyAppsScript =
  import.meta.env.DEV && String(import.meta.env.VITE_ALLOW_LEGACY_APPS_SCRIPT || '') === 'true';

if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error('Production build için VITE_API_URL zorunludur.');
}

// Adı geriye dönük uyumluluk için korunuyor; normal hedef artık SQL API'dir.
export const GAS_URL = configuredApiUrl ||
  (allowLegacyAppsScript
    ? 'https://script.google.com/macros/s/AKfycbzTTHM21Flpg6h7DI66UZStTc8ttdIuX95mcvKa4irjsR61IWAqgmMkyIyN20sUFnAW-A/exec'
    : 'http://localhost:8787/api/action');

// Google Cloud OAuth Client ID
export const GOOGLE_CLIENT_ID =
  '333289043957-05l0hq2r1aqafnclifl9dnvipkr99ba5.apps.googleusercontent.com';

const FALLBACK_AD_PASSWORD_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA5KvOH8oJEzi6tZR9xiQj
kM6zWvRTcfZP51cXgos569G8cwhjWhuAA+NvteeYiqSzWvsCqg60KNeiL+4Exuux
fZs/nqYINumcSN6nC06qoJoduNObdNrmsdvp7vAENlxScYbRXXNhi8p1xOC78qVB
D+NkYgPtCa+py4LdYm1p8/ytlKAw7K2IiUH1Jb7553qI90A4ljXMDvdjHpXmG3Vr
X0/WjRxkYomrmsNR0XEeQ9C8q8FG8z3b7H5PCIvRiVzTwZK6cp9BBa7eZjczj7/H
9tS+CN67YXJoVVBkKtCgF+O18NsKIdHeaZT6/yo3qpxVzMMPI3xxu3nZyCMjtmxf
0QIDAQAB
-----END PUBLIC KEY-----`;

// AD şifre sıfırlama için tarayıcı tarafında kullanılacak RSA public key.
// Public key gizli değildir; env boş gelirse iPad/PWA için fallback kullanılır.
export const AD_PASSWORD_PUBLIC_KEY =
  (import.meta.env.VITE_AD_PASSWORD_PUBLIC_KEY || FALLBACK_AD_PASSWORD_PUBLIC_KEY)
    .replace(/\\n/g, '\n')
    .trim();

export const AD_PASSWORD_KEY_ID =
  import.meta.env.VITE_AD_PASSWORD_KEY_ID || 'ad-reset-main';

