import crypto from 'node:crypto';
import { sql, query } from './db.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TRACKED_SESSION_TOUCHES = 10_000;
const lastSessionTouchByHash = new Map();
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isValidSessionToken(token) {
  return typeof token === 'string' && SESSION_TOKEN_PATTERN.test(token);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function reserveSessionTouch(tokenHash) {
  const now = Date.now();
  const previous = Number(lastSessionTouchByHash.get(tokenHash) || 0);
  if (previous > now - SESSION_TOUCH_INTERVAL_MS) return 0;

  if (lastSessionTouchByHash.size >= MAX_TRACKED_SESSION_TOUCHES) {
    for (const [key, touchedAt] of lastSessionTouchByHash.entries()) {
      if (touchedAt <= now - SIX_HOURS_MS) lastSessionTouchByHash.delete(key);
    }
    if (lastSessionTouchByHash.size >= MAX_TRACKED_SESSION_TOUCHES) return 0;
  }

  lastSessionTouchByHash.set(tokenHash, now);
  return now;
}

export async function createSession(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const sessionId = crypto.randomUUID();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SIX_HOURS_MS);

  await query(
    `
      DELETE FROM dbo.Sessions WHERE ExpiresAt <= SYSUTCDATETIME();

      INSERT INTO dbo.Sessions (SessionToken, TokenHash, Email, ExpiresAt)
      VALUES (@sessionId, @tokenHash, @email, @expiresAt)
    `,
    {
      sessionId: { type: sql.UniqueIdentifier, value: sessionId },
      tokenHash: { type: sql.Char(64), value: tokenHash },
      email: { type: sql.NVarChar(320), value: email },
      expiresAt: { type: sql.DateTime2, value: expiresAt }
    }
  );

  return token;
}

export async function getSessionUser(authToken) {
  if (!isValidSessionToken(authToken)) throw new Error('Oturum bulunamadı.');
  const tokenHash = hashSessionToken(authToken);

  const result = await query(
    `
      SELECT TOP 1
        s.Email,
        au.Role,
        c.Name AS Campus,
        c.CampusId
      FROM dbo.Sessions s
      INNER JOIN dbo.AuthorizedUsers au ON au.Email = s.Email AND au.IsActive = 1
      LEFT JOIN dbo.Campuses c ON c.CampusId = au.CampusId
      WHERE s.TokenHash = @tokenHash
        AND s.ExpiresAt > SYSUTCDATETIME()
    `,
    {
      tokenHash: { type: sql.Char(64), value: tokenHash }
    }
  );

  const row = result.recordset[0];
  if (!row) throw new Error('Oturum süresi doldu veya yetki bulunamadı.');

  const reservedTouchAt = reserveSessionTouch(tokenHash);
  if (reservedTouchAt) {
    try {
      await query(
        `
          UPDATE dbo.Sessions
          SET LastSeenAt = SYSUTCDATETIME()
          WHERE TokenHash = @tokenHash
            AND (LastSeenAt IS NULL OR LastSeenAt < DATEADD(MINUTE, -5, SYSUTCDATETIME()))
        `,
        { tokenHash: { type: sql.Char(64), value: tokenHash } }
      );
    } catch (error) {
      if (lastSessionTouchByHash.get(tokenHash) === reservedTouchAt) {
        lastSessionTouchByHash.delete(tokenHash);
      }
      throw error;
    }
  }

  return {
    email: row.Email,
    role: row.Role,
    campus: row.Campus || 'Bilinmiyor',
    campusId: row.CampusId
  };
}

export async function revokeSession(authToken) {
  if (!isValidSessionToken(authToken)) return false;
  const tokenHash = hashSessionToken(authToken);
  lastSessionTouchByHash.delete(tokenHash);

  const result = await query(
    `
      DELETE FROM dbo.Sessions
      WHERE TokenHash = @tokenHash
    `,
    { tokenHash: { type: sql.Char(64), value: tokenHash } }
  );

  return Number(result.rowsAffected?.[0] || 0) > 0;
}
