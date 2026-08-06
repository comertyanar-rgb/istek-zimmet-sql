import 'dotenv/config';

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'evet'].includes(String(value).toLowerCase());
};

const csv = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const boundedNumber = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
};

const parseSqlTarget = () => {
  const rawServer = process.env.SQL_SERVER || 'localhost';
  const explicitInstance = process.env.SQL_INSTANCE;
  const portText = process.env.SQL_PORT;
  const target = {
    server: rawServer,
    instanceName: explicitInstance || ''
  };

  if (rawServer.includes('\\') && !explicitInstance) {
    const parts = rawServer.split('\\');
    target.server = parts[0] || 'localhost';
    target.instanceName = parts.slice(1).join('\\');
  }

  if (portText !== undefined && portText !== '') {
    target.port = Number(portText);
  }

  return target;
};

const sqlTarget = parseSqlTarget();
const nodeEnv = process.env.NODE_ENV || 'development';
const cookieSameSiteValue = String(process.env.SESSION_COOKIE_SAME_SITE || 'Lax');
const cookieSameSite =
  cookieSameSiteValue.charAt(0).toUpperCase() + cookieSameSiteValue.slice(1).toLowerCase();
const allowDevAgentSecretFallback =
  nodeEnv !== 'production' && bool(process.env.AGENT_SECRET_ALLOW_DEV_FALLBACK, false);
const httpRequestTimeoutMs = boundedNumber(
  process.env.HTTP_REQUEST_TIMEOUT_MS,
  120_000,
  30_000,
  600_000
);
const httpHeadersTimeoutMs = boundedNumber(
  process.env.HTTP_HEADERS_TIMEOUT_MS,
  15_000,
  5_000,
  httpRequestTimeoutMs - 1_000
);

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv,
  corsOrigins: csv(process.env.CORS_ORIGINS || 'http://localhost:5173'),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  publicBaseUrl: process.env.API_PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 8787)}`,
  http: {
    requestTimeoutMs: httpRequestTimeoutMs,
    headersTimeoutMs: httpHeadersTimeoutMs,
    keepAliveTimeoutMs: boundedNumber(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS, 5_000, 1_000, 30_000),
    maxHeadersCount: boundedNumber(process.env.HTTP_MAX_HEADERS_COUNT, 100, 20, 500),
    maxRequestsPerSocket: boundedNumber(process.env.HTTP_MAX_REQUESTS_PER_SOCKET, 1_000, 10, 10_000)
  },
  rateLimit: {
    globalWindowMs: boundedNumber(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000, 10_000, 600_000),
    globalMax: boundedNumber(process.env.API_RATE_LIMIT_MAX, 600, 60, 10_000),
    maxBuckets: boundedNumber(process.env.API_RATE_LIMIT_MAX_BUCKETS, 50_000, 1_000, 250_000)
  },
  session: {
    cookieEnabled: bool(process.env.SESSION_COOKIE_ENABLED, false),
    cookieName: process.env.SESSION_COOKIE_NAME || 'istek_session',
    cookieSecure: bool(process.env.SESSION_COOKIE_SECURE, nodeEnv === 'production'),
    cookieSameSite,
    cookieDomain: String(process.env.SESSION_COOKIE_DOMAIN || '').trim(),
    cookieMaxAgeSeconds: 6 * 60 * 60,
    allowBodyTokenFallback: bool(process.env.SESSION_COOKIE_ALLOW_BODY_TOKEN_FALLBACK, false)
  },
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  superAdminEmails: csv(process.env.SUPER_ADMIN_EMAILS).map((email) => email.toLowerCase()),
  appSecret: process.env.APP_SECRET || 'development-only-change-me',
  personnelIdHmacSecret: process.env.PERSONNEL_ID_HMAC_SECRET || '',
  adAgentSecret: process.env.AD_AGENT_SECRET || '',
  glpiSyncSecret:
    process.env.GLPI_SYNC_SECRET ||
    process.env.ZIMMET_SYNC_SECRET ||
    (allowDevAgentSecretFallback ? process.env.AD_AGENT_SECRET : '') ||
    '',
  personnelSyncSecret:
    process.env.PERSONNEL_SYNC_SECRET ||
    process.env.ZIMMET_PERSONNEL_SYNC_SECRET ||
    (allowDevAgentSecretFallback ? process.env.AD_AGENT_SECRET || process.env.ZIMMET_SYNC_SECRET : '') ||
    '',
  signatureAgentSecret:
    process.env.SIGNATURE_AGENT_SECRET ||
    process.env.ZIMMET_SIGNATURE_AGENT_SECRET ||
    (allowDevAgentSecretFallback ? process.env.AD_AGENT_SECRET || process.env.ZIMMET_SYNC_SECRET : '') ||
    '',
  agentAuth: {
    allowLegacySecret: bool(process.env.AGENT_AUTH_ALLOW_LEGACY, false),
    maxSkewSeconds: Number(process.env.AGENT_AUTH_MAX_SKEW_SECONDS || 300)
  },
  mobildev: {
    apiUrl: process.env.MOBILDEV_SMS_API_URL || 'https://xmlapi.mobildev.com/',
    apiKey: process.env.MOBILDEV_API_KEY || process.env.ZIMMET_MOBILDEV_API_KEY || '',
    apiSecret: process.env.MOBILDEV_API_SECRET || process.env.ZIMMET_MOBILDEV_API_SECRET || '',
    originator: process.env.MOBILDEV_ORIGINATOR || process.env.ZIMMET_MOBILDEV_ORIGINATOR || ''
  },
  googleBridge: {
    url: String(process.env.GOOGLE_BRIDGE_URL || '').trim(),
    secret: String(process.env.GOOGLE_BRIDGE_SECRET || '').trim(),
    uploadAction: String(process.env.GOOGLE_BRIDGE_UPLOAD_ACTION || 'uploadGeneratedPdf').trim()
  },
  chrome: {
    executablePath: process.env.PDF_CHROME_PATH || process.env.CHROME_PATH || '',
    launchTimeoutMs: Math.max(5000, Number(process.env.PDF_CHROME_LAUNCH_TIMEOUT_MS || 30000)),
    renderTimeoutMs: Math.max(5000, Number(process.env.PDF_RENDER_TIMEOUT_MS || 45000)),
    maxConcurrentPages: Math.max(1, Math.min(Number(process.env.PDF_MAX_CONCURRENT_PAGES || 2), 4))
  },
  queue: {
    workerEnabled: bool(process.env.QUEUE_WORKER_ENABLED, false),
    workerIntervalMs: Number(process.env.QUEUE_WORKER_INTERVAL_MS || 30000),
    maxJobsPerRun: Number(process.env.QUEUE_MAX_JOBS_PER_RUN || 2),
    workerConcurrency: Math.max(1, Math.min(Number(process.env.QUEUE_WORKER_CONCURRENCY || 2), 4)),
    leaseSeconds: Number(process.env.QUEUE_LEASE_SECONDS || 1800),
    maxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS || 5),
    generatedPdfDir: process.env.GENERATED_PDF_DIR || '',
    cleanup: {
      enabled: bool(process.env.QUEUE_CLEANUP_ENABLED, true),
      intervalMs: Math.max(60 * 60 * 1000, Number(process.env.QUEUE_CLEANUP_INTERVAL_MS || 21600000)),
      operationRetentionDays: Math.max(7, Math.min(Number(process.env.OPERATION_QUEUE_RETENTION_DAYS || 30), 3650)),
      adRetentionDays: Math.max(7, Math.min(Number(process.env.AD_QUEUE_RETENTION_DAYS || 30), 3650)),
      signatureRetentionDays: Math.max(7, Math.min(Number(process.env.SIGNATURE_QUEUE_RETENTION_DAYS || 30), 3650)),
      batchSize: Math.max(1, Math.min(Number(process.env.QUEUE_CLEANUP_BATCH_SIZE || 500), 5000))
    }
  },
  frontend: {
    serveEnabled: bool(process.env.SERVE_FRONTEND, false),
    distDir: process.env.FRONTEND_DIST_DIR || ''
  },
  exports: {
    dir: process.env.GENERATED_EXPORT_DIR || ''
  },
  sql: {
    server: sqlTarget.server,
    ...(sqlTarget.port ? { port: sqlTarget.port } : {}),
    database: process.env.SQL_DATABASE || 'IstekZimmet',
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    connectionTimeout: boundedNumber(process.env.SQL_CONNECTION_TIMEOUT_MS, 15_000, 1_000, 60_000),
    requestTimeout: boundedNumber(process.env.SQL_REQUEST_TIMEOUT_MS, 60_000, 5_000, 300_000),
    options: {
      ...(sqlTarget.instanceName ? { instanceName: sqlTarget.instanceName } : {}),
      encrypt: bool(process.env.SQL_ENCRYPT, false),
      trustServerCertificate: bool(process.env.SQL_TRUST_SERVER_CERTIFICATE, true)
    },
    pool: {
      max: Number(process.env.SQL_POOL_MAX || 10),
      min: Number(process.env.SQL_POOL_MIN || 0),
      idleTimeoutMillis: Number(process.env.SQL_POOL_IDLE_MS || 30000)
    }
  }
};

export function assertConfig() {
  const missing = [];
  if (!config.googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (!config.sql.user) missing.push('SQL_USER');
  if (!config.sql.password) missing.push('SQL_PASSWORD');
  if (!process.env.APP_SECRET || config.appSecret.length < 32 || config.appSecret === 'development-only-change-me') {
    missing.push('APP_SECRET (en az 32 karakter)');
  }
  if (!config.personnelIdHmacSecret || config.personnelIdHmacSecret.length < 32) {
    missing.push('PERSONNEL_ID_HMAC_SECRET (en az 32 karakter)');
  } else if (config.personnelIdHmacSecret === config.appSecret) {
    missing.push('PERSONNEL_ID_HMAC_SECRET, APP_SECRET değerinden farklı olmalı');
  }
  if (config.session.cookieEnabled && config.nodeEnv === 'production' && !config.session.cookieSecure) {
    missing.push('SESSION_COOKIE_SECURE=true (production cookie modu)');
  }
  if (config.nodeEnv === 'production') {
    const agentSecrets = [
      ['AD_AGENT_SECRET', config.adAgentSecret],
      ['GLPI_SYNC_SECRET', config.glpiSyncSecret],
      ['PERSONNEL_SYNC_SECRET', config.personnelSyncSecret],
      ['SIGNATURE_AGENT_SECRET', config.signatureAgentSecret]
    ];
    for (const [name, value] of agentSecrets) {
      if (!value || value.length < 32) missing.push(`${name} (en az 32 karakter)`);
    }
    const configuredSecrets = agentSecrets.map(([, value]) => value).filter(Boolean);
    if (new Set(configuredSecrets).size !== configuredSecrets.length) {
      missing.push('Agent secret değerleri birbirinden farklı olmalı');
    }
  }
  if (missing.length > 0) {
    throw new Error(`Eksik backend ortam değişkenleri: ${missing.join(', ')}`);
  }
}


