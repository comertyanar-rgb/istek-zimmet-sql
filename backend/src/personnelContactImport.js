import { createHmac } from 'node:crypto';

export const PERSONNEL_CONTACT_HEADERS = Object.freeze({
  personId: ['PersonId', 'Person ID', 'User Id', 'User ID', 'Google ID', 'Kullanıcı ID'],
  email: ['Email', 'E-Posta', 'E-posta', 'Kurumsal E-Posta', 'Kurumsal E-posta'],
  adUsername: ['AD Kullanıcı', 'AD Kullanıcısı', 'AD Username', 'Kullanıcı Adı'],
  nationalId: ['T.C. Kimlik No', 'TC Kimlik No', 'T.C', 'TCKN', 'TC', 'Kimlik No'],
  phone: ['Telefon', 'Phone', 'Cep Telefonu', 'Cep']
});

export function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[şŞ]/g, 's')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeText(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return String(value ?? '').trim();
}

export function normalizeMatchKey(value) {
  return normalizeText(value).toLocaleLowerCase('tr-TR');
}

export function normalizeEmail(value) {
  const email = normalizeMatchKey(value);
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function normalizeAdUsername(value) {
  const username = normalizeMatchKey(value);
  if (!username) return '';
  return username.includes('@') ? username.split('@')[0] : username;
}

export function normalizePhone(value) {
  let digits = normalizeText(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? digits : '';
}

export function normalizeNationalId(value) {
  return normalizeText(value).replace(/\D/g, '');
}

export function isValidTurkishNationalId(value) {
  const nationalId = normalizeNationalId(value);
  if (!/^[1-9]\d{10}$/.test(nationalId)) return false;

  const digits = nationalId.split('').map(Number);
  const oddTotal = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenTotal = digits[1] + digits[3] + digits[5] + digits[7];
  const tenthDigit = ((oddTotal * 7 - evenTotal) % 10 + 10) % 10;
  const eleventhDigit = digits.slice(0, 10).reduce((sum, digit) => sum + digit, 0) % 10;

  return digits[9] === tenthDigit && digits[10] === eleventhDigit;
}

export function assertPersonnelIdHmacSecret(secret) {
  const normalized = String(secret ?? '');
  if (Buffer.byteLength(normalized, 'utf8') < 32) {
    throw new Error(
      'PERSONNEL_ID_HMAC_SECRET eksik veya kısa. En az 32 karakterlik ayrı bir secret tanımlayın.'
    );
  }
  return normalized;
}

export function hashNationalId(value, secret) {
  const nationalId = normalizeNationalId(value);
  if (!isValidTurkishNationalId(nationalId)) {
    throw new Error('T.C. kimlik numarası doğrulama basamakları geçersiz.');
  }
  return createHmac('sha256', assertPersonnelIdHmacSecret(secret))
    .update(nationalId, 'utf8')
    .digest('hex');
}

export function getColumnIndex(headers, aliases) {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(normalizeHeader(alias));
    if (index > -1) return index;
  }
  return -1;
}

export function resolvePersonnelContactColumns(headers) {
  return Object.fromEntries(
    Object.entries(PERSONNEL_CONTACT_HEADERS).map(([key, aliases]) => [
      key,
      getColumnIndex(headers, aliases)
    ])
  );
}
