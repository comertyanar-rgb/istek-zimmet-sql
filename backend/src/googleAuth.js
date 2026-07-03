import { config } from './config.js';

async function fetchJson(url, options) {
  const response = await fetch(url, options);
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
    const tokenUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(data.googleToken);
    const { response, payload } = await fetchJson(tokenUrl);

    if (!response.ok || payload.aud !== config.googleClientId || String(payload.email_verified) !== 'true') {
      throw new Error('Google kimligi gecersiz veya istemci uyusmuyor.');
    }

    return {
      email: String(payload.email || '').toLowerCase(),
      name: payload.name || '',
      picture: payload.picture || ''
    };
  }

  if (data.googleAccessToken) {
    const tokenUrl = 'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(data.googleAccessToken);
    const tokenResult = await fetchJson(tokenUrl);
    const tokenPayload = tokenResult.payload;

    if (!tokenResult.response.ok || tokenPayload.aud !== config.googleClientId) {
      throw new Error('Google access token gecersiz veya istemci uyusmuyor.');
    }

    const userInfo = await fetchJson('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${data.googleAccessToken}` }
    });

    if (!userInfo.response.ok || !userInfo.payload.email) {
      throw new Error('Google kullanici bilgisi alinamadi.');
    }

    if (String(userInfo.payload.email_verified) !== 'true') {
      throw new Error('Google e-posta adresi dogrulanmamis.');
    }

    return {
      email: String(userInfo.payload.email || '').toLowerCase(),
      name: userInfo.payload.name || '',
      picture: userInfo.payload.picture || ''
    };
  }

  throw new Error('Google token bulunamadi.');
}
