import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

async function saveLocalPdf(pdfBuffer, pdfName) {
  const baseDir = config.queue.generatedPdfDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generated-pdfs');
  await fs.mkdir(baseDir, { recursive: true });
  const safeName = String(pdfName || 'belge.pdf').replace(/[\\/:*?"<>|]/g, '-');
  const filePath = path.join(baseDir, safeName.includes('.') ? safeName : `${safeName}.pdf`);
  await fs.writeFile(filePath, pdfBuffer);
  return { url: `file:///${filePath.replace(/\\/g, '/')}`, localPath: filePath };
}

export async function uploadPdfThroughGoogleBridge({ pdfBuffer, pdfName, campus, email, meta }) {
  const pdfHash = sha256(pdfBuffer);

  if (!config.googleBridge.url || !config.googleBridge.secret) {
    if (config.nodeEnv !== 'production') {
      const local = await saveLocalPdf(pdfBuffer, pdfName);
      return { ...local, pdfHash, delivery: 'local' };
    }
    throw new Error('Google PDF köprüsü ayarlı değil. GOOGLE_BRIDGE_URL ve GOOGLE_BRIDGE_SECRET tanımlayın.');
  }

  const response = await fetch(config.googleBridge.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: config.googleBridge.uploadAction,
      secret: config.googleBridge.secret,
      pdfName,
      pdfBase64: pdfBuffer.toString('base64'),
      pdfHash,
      campus,
      email,
      meta
    })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }

  if (!response.ok || !data.success) {
    const bridgeError = data.error || `Google köprüsü hata döndürdü: ${response.status}`;
    if (/oturum bulunamad[ıi]/i.test(bridgeError)) {
      throw new Error(
        'Google PDF köprüsü uploadGeneratedPdf isteğini oturumlu kullanıcı isteği gibi işledi. ' +
        'Apps Script deploy güncel olmayabilir veya GOOGLE_BRIDGE_URL eski /exec adresini gösteriyor. ' +
        'Apps Script kodunu yeni sürüm olarak deploy edip backend GOOGLE_BRIDGE_URL değerini güncelleyin.'
      );
    }
    throw new Error(bridgeError);
  }

  return { url: data.url || data.fileUrl || '', pdfHash, delivery: 'google', response: data };
}

export async function uploadFileThroughGoogleBridge({ fileBuffer, fileName, mimeType, campus, email, meta }) {
  const fileHash = sha256(fileBuffer);

  if (!config.googleBridge.url || !config.googleBridge.secret) {
    if (config.nodeEnv !== 'production') {
      const local = await saveLocalPdf(fileBuffer, fileName);
      return { ...local, fileHash, pdfHash: fileHash, delivery: 'local' };
    }
    throw new Error('Google dosya köprüsü ayarlı değil. GOOGLE_BRIDGE_URL ve GOOGLE_BRIDGE_SECRET tanımlayın.');
  }

  const response = await fetch(config.googleBridge.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: config.googleBridge.uploadAction,
      secret: config.googleBridge.secret,
      fileName,
      pdfName: fileName,
      fileBase64: fileBuffer.toString('base64'),
      pdfBase64: fileBuffer.toString('base64'),
      mimeType,
      pdfHash: fileHash,
      campus,
      email,
      meta
    })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }

  if (!response.ok || !data.success) {
    throw new Error(data.error || `Google dosya köprüsü hata döndürdü: ${response.status}`);
  }

  return { url: data.url || data.fileUrl || '', fileHash, pdfHash: fileHash, delivery: 'google', response: data };
}
