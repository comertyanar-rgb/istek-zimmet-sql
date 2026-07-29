const FALLBACK_BASE_URL = 'https://local.invalid/';

function currentBaseUrl() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return FALLBACK_BASE_URL;
}

export function toSafeExternalUrl(value, { allowBlob = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u001F\u007F]/.test(raw)) return '';

  if (allowBlob && raw.startsWith('blob:')) return raw;

  try {
    const parsed = new URL(raw, currentBaseUrl());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    if (parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

export function toSafeDriveEmbedUrl(value) {
  const safeUrl = toSafeExternalUrl(value);
  if (!safeUrl) return '';

  const parsed = new URL(safeUrl);
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'drive.google.com') return '';

  const pathMatch = parsed.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]{10,200})(?:\/|$)/);
  const fileId = pathMatch?.[1] || parsed.searchParams.get('id') || '';
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(fileId)) return '';

  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function openSafeExternalUrl(value) {
  const safeUrl = toSafeExternalUrl(value);
  if (!safeUrl || typeof window === 'undefined') return false;

  const opened = window.open(safeUrl, '_blank', 'noopener,noreferrer');
  if (opened) opened.opener = null;
  return true;
}
