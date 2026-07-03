import { AD_PASSWORD_KEY_ID, AD_PASSWORD_PUBLIC_KEY } from '../config/appConfig.js';

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function normalizePublicKey(publicKey) {
  return publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export async function encryptAdPassword(password) {
  if (!window.crypto?.subtle) {
    throw new Error('Bu tarayıcı güvenli şifreleme API desteği sunmuyor.');
  }

  const normalizedKey = normalizePublicKey(AD_PASSWORD_PUBLIC_KEY || '');
  if (!normalizedKey) {
    throw new Error('AD şifre sıfırlama public key ayarı eksik.');
  }

  const key = await window.crypto.subtle.importKey(
    'spki',
    base64ToArrayBuffer(normalizedKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    key,
    new TextEncoder().encode(password)
  );

  return {
    ciphertext: arrayBufferToBase64(encrypted),
    algorithm: 'RSA-OAEP-SHA256',
    keyId: AD_PASSWORD_KEY_ID,
  };
}
