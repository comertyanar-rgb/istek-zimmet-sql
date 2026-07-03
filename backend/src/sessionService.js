import crypto from 'node:crypto';
import { sql, query } from './db.js';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export async function createSession(email) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SIX_HOURS_MS);

  await query(
    `
      INSERT INTO dbo.Sessions (SessionToken, Email, ExpiresAt)
      VALUES (@token, @email, @expiresAt)
    `,
    {
      token: { type: sql.UniqueIdentifier, value: token },
      email: { type: sql.NVarChar(320), value: email },
      expiresAt: { type: sql.DateTime2, value: expiresAt }
    }
  );

  return token;
}

export async function getSessionUser(authToken) {
  if (!authToken) throw new Error('Oturum bulunamadi.');

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
      WHERE s.SessionToken = @token
        AND s.ExpiresAt > SYSUTCDATETIME()
    `,
    {
      token: { type: sql.UniqueIdentifier, value: authToken }
    }
  );

  const row = result.recordset[0];
  if (!row) throw new Error('Oturum suresi doldu veya yetki bulunamadi.');

  await query(
    `UPDATE dbo.Sessions SET LastSeenAt = SYSUTCDATETIME() WHERE SessionToken = @token`,
    { token: { type: sql.UniqueIdentifier, value: authToken } }
  );

  return {
    email: row.Email,
    role: row.Role,
    campus: row.Campus || 'Bilinmiyor',
    campusId: row.CampusId
  };
}
