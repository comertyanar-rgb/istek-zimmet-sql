const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function assertSessionCookieConfig(sessionConfig) {
  if (!sessionConfig?.cookieEnabled) return;

  if (!COOKIE_NAME_PATTERN.test(sessionConfig.cookieName || '')) {
    throw new Error('SESSION_COOKIE_NAME geçersiz karakter içeriyor.');
  }

  if (!['Lax', 'Strict', 'None'].includes(sessionConfig.cookieSameSite)) {
    throw new Error('SESSION_COOKIE_SAME_SITE yalnız Lax, Strict veya None olabilir.');
  }

  if (sessionConfig.cookieSameSite === 'None' && !sessionConfig.cookieSecure) {
    throw new Error('SameSite=None cookie için SESSION_COOKIE_SECURE=true zorunludur.');
  }

  if (sessionConfig.cookieName.startsWith('__Host-')) {
    if (!sessionConfig.cookieSecure) {
      throw new Error('__Host- önekli cookie için Secure zorunludur.');
    }
    if (sessionConfig.cookieDomain) {
      throw new Error('__Host- önekli cookie için SESSION_COOKIE_DOMAIN boş olmalıdır.');
    }
  }

  if (
    sessionConfig.cookieDomain &&
    !/^\.?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/.test(sessionConfig.cookieDomain)
  ) {
    throw new Error('SESSION_COOKIE_DOMAIN geçersiz.');
  }
}

export function readCookieValue(cookieHeader, cookieName) {
  if (!cookieHeader || !cookieName) return '';

  for (const part of String(cookieHeader).split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name !== cookieName) continue;

    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return '';
    }
  }

  return '';
}

export function serializeSessionCookie(value, sessionConfig, { clear = false } = {}) {
  assertSessionCookieConfig(sessionConfig);

  const encodedValue = clear ? '' : encodeURIComponent(String(value || ''));
  const parts = [
    `${sessionConfig.cookieName}=${encodedValue}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sessionConfig.cookieSameSite}`,
    `Max-Age=${clear ? 0 : sessionConfig.cookieMaxAgeSeconds}`,
    'Priority=High',
  ];

  if (clear) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (sessionConfig.cookieSecure) parts.push('Secure');
  if (sessionConfig.cookieDomain) parts.push(`Domain=${sessionConfig.cookieDomain}`);

  return parts.join('; ');
}
