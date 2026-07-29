const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const MAX_UPLOADED_FILE_BYTES = 15 * 1024 * 1024;

export function decodeCanonicalBase64(value, options = {}) {
  const label = String(options.label || 'Dosya');
  const maxBytes = Number(options.maxBytes || MAX_UPLOADED_FILE_BYTES);
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} verisi bulunamadı.`);

  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (text.length > maxEncodedLength) {
    throw new Error(`${label} çok büyük. Maksimum ${Math.floor(maxBytes / 1024 / 1024)} MB yüklenebilir.`);
  }
  if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) {
    throw new Error(`${label} Base64 biçimi geçersiz.`);
  }

  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
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

