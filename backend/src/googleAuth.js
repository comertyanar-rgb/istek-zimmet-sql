import { config } from './config.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

function requireBoundedToken(value, label, { maxLength, jwt = false }) {
  const token = String(value || '').trim();
  if (!token || token.length > maxLength || /[\r\n]/.test(token)) {
    throw new Error(`${label} biçimi geçersiz.`);
  }
  if (jwt && token.split('.').length !== 3) {
    throw new Error(`${label} biçimi geçersiz.`);
  }
  return token;
}

function isVerified(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function tokenAudience(payload) {
  return String(payload?.aud || payload?.audience || payload?.issued_to || '');
}

async function fetchJson(url, options, label = 'Google kimlik servisi') {
  const response = await fetchWithTimeout(url, options, { timeoutMs: 10000, label });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { response, payload };
}

export async function verifyGoogleIdentity(data) {
  if (data.googleToken) {
    const googleToken = requireBoundedToken(data.googleToken, 'Google ID tokenı', {
      maxLength: 16_384,
      jwt: true
    });
    const tokenUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(googleToken);
    const { response, payload } = await fetchJson(tokenUrl);

    if (
      !response.ok ||
      tokenAudience(payload) !== config.googleClientId ||
      !isVerified(payload.email_verified) ||
      !GOOGLE_ISSUERS.has(String(payload.iss || '')) ||
      !payload.sub ||
      !payload.email
    ) {
      throw new Error('Google kimliği geçersiz veya istemci uyuşmuyor.');
    }

    return {
      email: String(payload.email || '').toLowerCase(),
      name: payload.name || '',
      picture: payload.picture || ''
    };
  }

  if (data.googleAccessToken) {
    const googleAccessToken = requireBoundedToken(data.googleAccessToken, 'Google erişim tokenı', {
      maxLength: 16_384
    });
    const tokenUrl = 'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(googleAccessToken);
    const tokenResult = await fetchJson(tokenUrl);
    const tokenPayload = tokenResult.payload;
    const expiresIn = Number(tokenPayload.expires_in);

    if (
      !tokenResult.response.ok ||
      tokenAudience(tokenPayload) !== config.googleClientId ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new Error('Google erişim tokenı geçersiz veya istemci uyuşmuyor.');
    }

    const userInfo = await fetchJson(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${googleAccessToken}` } },
      'Google kullanıcı bilgisi servisi'
    );

    if (!userInfo.response.ok || !userInfo.payload.email) {
      throw new Error('Google kullanıcı bilgisi alınamadı.');
    }

    if (!isVerified(userInfo.payload.email_verified)) {
      throw new Error('Google e-posta adresi doğrulanmamış.');
    }

    const tokenEmail = String(tokenPayload.email || '').trim().toLowerCase();
    const userInfoEmail = String(userInfo.payload.email || '').trim().toLowerCase();
    if (tokenEmail && tokenEmail !== userInfoEmail) {
      throw new Error('Google tokenı ile kullanıcı e-posta adresi uyuşmuyor.');
    }

    return {
      email: userInfoEmail,
      name: userInfo.payload.name || '',
      picture: userInfo.payload.picture || ''
    };
  }

  throw new Error('Google tokenı bulunamadı.');
}
