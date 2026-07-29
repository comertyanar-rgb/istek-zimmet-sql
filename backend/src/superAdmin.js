function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function parseSuperAdminEmails(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(source.map(normalizeEmail).filter(Boolean)));
}

export function isSuperAdminEmail(email, allowedEmails) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const allowed = Array.isArray(allowedEmails)
    ? allowedEmails
    : parseSuperAdminEmails(allowedEmails);
  return allowed.some((item) => normalizeEmail(item) === normalized);
}

export function requireSuperAdmin(user, allowedEmails) {
  if (isSuperAdminEmail(user?.email, allowedEmails)) return;

  const error = new Error('Bu işlem için süper yönetici yetkisi gerekiyor.');
  error.statusCode = 403;
  error.code = 'SUPER_ADMIN_REQUIRED';
  throw error;
}

