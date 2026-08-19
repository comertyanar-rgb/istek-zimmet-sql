export const MAX_UPLOADED_FILE_BYTES = 15 * 1024 * 1024;

function isBase64AlphabetCode(code) {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47
  );
}

function hasCanonicalBase64Characters(text, padding) {
  const contentLength = text.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    if (!isBase64AlphabetCode(text.charCodeAt(index))) return false;
  }
  for (let index = contentLength; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 61) return false;
  }
  return true;
}

export function decodeCanonicalBase64(value, options = {}) {
  const label = String(options.label || 'Dosya');
  const maxBytes = Number(options.maxBytes || MAX_UPLOADED_FILE_BYTES);
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} verisi bulunamadı.`);

  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (text.length > maxEncodedLength) {
    throw new Error(`${label} çok büyük. Maksimum ${Math.floor(maxBytes / 1024 / 1024)} MB yüklenebilir.`);
  }
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (text.length % 4 !== 0 || !hasCanonicalBase64Characters(text, padding)) {
    throw new Error(`${label} Base64 biçimi geçersiz.`);
  }

  const expectedBytes = (text.length / 4) * 3 - padding;
  if (expectedBytes > maxBytes) {
    throw new Error(`${label} çok büyük. Maksimum ${Math.floor(maxBytes / 1024 / 1024)} MB yüklenebilir.`);
  }

  const buffer = Buffer.from(text, 'base64');
  if (buffer.length !== expectedBytes || buffer.toString('base64') !== text) {
    throw new Error(`${label} Base64 biçimi geçersiz.`);
  }
  return buffer;
}
