// Backend URL.
// Varsayilan Apps Script'tir. SQL Server API testinde .env icine
// VITE_API_URL=http://localhost:8787/api/action yazinca frontend yeni API'ye gider.
export const GAS_URL =
  import.meta.env.VITE_API_URL ||
  'https://script.google.com/macros/s/AKfycbzTTHM21Flpg6h7DI66UZStTc8ttdIuX95mcvKa4irjsR61IWAqgmMkyIyN20sUFnAW-A/exec';

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

// AD sifre sifirlama icin tarayici tarafinda kullanilacak RSA public key.
// Public key gizli degildir; env bos gelirse iPad/PWA icin fallback kullanilir.
export const AD_PASSWORD_PUBLIC_KEY =
  (import.meta.env.VITE_AD_PASSWORD_PUBLIC_KEY || FALLBACK_AD_PASSWORD_PUBLIC_KEY)
    .replace(/\\n/g, '\n')
    .trim();

export const AD_PASSWORD_KEY_ID =
  import.meta.env.VITE_AD_PASSWORD_KEY_ID || 'ad-reset-main';

