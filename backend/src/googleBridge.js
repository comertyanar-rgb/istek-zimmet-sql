import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function bridgeAuthorizationError(serviceLabel) {
  return (
    `${serviceLabel} köprüsü anahtarı eşleşmiyor. ` +
    'Sunucudaki GOOGLE_BRIDGE_SECRET değerini Apps Script > Proje Ayarları > ' +
    'Komut Dosyası Özellikleri bölümüne aynı adla ekleyin. Ardından doğru Apps Script ' +
    'projesindeki web uygulamasını yeni sürüm olarak dağıtın ve backend görevini yeniden başlatın.'
  );
}

function normalizeBridgeError(message, serviceLabel) {
  const bridgeError = String(message || '').trim();
  if (/yetkisiz\s+(?:pdf|dosya|e-posta)\s+k[öo]pr[üu]s[üu]/i.test(bridgeError)) {
    return bridgeAuthorizationError(serviceLabel);
  }
  return bridgeError;
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

  const response = await fetchWithTimeout(config.googleBridge.url, {
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
  }, { timeoutMs: 60000, label: 'Google PDF köprüsü' });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }

  if (!response.ok || !data.success) {
    const bridgeError = normalizeBridgeError(
      data.error || `Google köprüsü hata döndürdü: ${response.status}`,
      'Google PDF'
    );
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

  const response = await fetchWithTimeout(config.googleBridge.url, {
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
  }, { timeoutMs: 60000, label: 'Google dosya köprüsü' });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }

  if (!response.ok || !data.success) {
    throw new Error(
      normalizeBridgeError(
        data.error || `Google dosya köprüsü hata döndürdü: ${response.status}`,
        'Google dosya'
      )
    );
  }

  return { url: data.url || data.fileUrl || '', fileHash, pdfHash: fileHash, delivery: 'google', response: data };
}

export async function sendEmailThroughGoogleBridge({ to, subject, body, cc, replyTo, name }) {
  if (!config.googleBridge.url || !config.googleBridge.secret) {
    if (config.nodeEnv !== 'production') {
      console.info(`[DEV EMAIL] ${to}: ${subject}\n${body}`);
      return { delivery: 'console' };
    }
    throw new Error('Google e-posta köprüsü ayarlı değil. GOOGLE_BRIDGE_URL ve GOOGLE_BRIDGE_SECRET tanımlayın.');
  }

  const response = await fetchWithTimeout(config.googleBridge.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'sendBridgeEmail',
      secret: config.googleBridge.secret,
      to,
      subject,
      body,
      cc,
      replyTo,
      name
    })
  }, { timeoutMs: 30000, label: 'Google e-posta köprüsü' });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }

  if (!response.ok || !data.success) {
    throw new Error(
      normalizeBridgeError(
        data.error || `Google e-posta köprüsü hata döndürdü: ${response.status}`,
        'Google e-posta'
      )
    );
  }

  return { delivery: 'email', response: data };
}
