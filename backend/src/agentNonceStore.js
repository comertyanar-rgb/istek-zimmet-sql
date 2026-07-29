import crypto from 'node:crypto';
import { query, sql } from './db.js';

export function hashAgentNonce(nonce) {
  return crypto.createHash('sha256').update(String(nonce || ''), 'utf8').digest('hex');
}

export async function reserveAgentNonce({ action, nonceHash, expiresAt }) {
  const result = await query(
    `
      EXEC dbo.ReserveAgentRequestNonce
        @ActionType = @action,
        @NonceHash = @nonceHash,
        @ExpiresAt = @expiresAt
    `,
    {
      action: { type: sql.NVarChar(120), value: action },
      nonceHash: { type: sql.Char(64), value: nonceHash },
      expiresAt: { type: sql.DateTime2, value: expiresAt }
    }
  );

  const reserved = result.recordset?.[0]?.Reserved;
  if (reserved === undefined || reserved === null) {
    throw new Error('Agent nonce rezervasyon prosedürü geçerli bir sonuç döndürmedi.');
  }

  return Boolean(reserved);
}
