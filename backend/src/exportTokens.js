import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const DEFAULT_TTL_SECONDS = 15 * 60;
const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

const tokenPayload = (fileName, expiresAt) => `${fileName}\n${expiresAt}`;

const hmac = (fileName, expiresAt) =>
  crypto
    .createHmac('sha256', config.appSecret)
    .update(tokenPayload(fileName, expiresAt), 'utf8')
    .digest('hex');

export function createExportDownloadToken(fileName, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const safeTtl = Math.min(Math.max(Number(ttlSeconds) || DEFAULT_TTL_SECONDS, 60), 60 * 60);
  const expiresAt = Math.floor(Date.now() / 1000) + safeTtl;
  return {
    expiresAt,
    signature: hmac(fileName, expiresAt),
  };
}

export function verifyExportDownloadToken(fileName, expiresAtValue, signatureValue) {
  const expiresAt = Number(expiresAtValue);
  const signature = String(signatureValue || '');
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const expected = Buffer.from(hmac(fileName, expiresAt), 'hex');
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export async function pruneExpiredExportFiles(baseDir, retentionMs = EXPORT_RETENTION_MS) {
  let entries;
  try {
    entries = await fs.readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const cutoff = Date.now() - retentionMs;
  await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(baseDir, entry.name);
        try {
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < cutoff) await fs.unlink(filePath);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      })
  );
}
