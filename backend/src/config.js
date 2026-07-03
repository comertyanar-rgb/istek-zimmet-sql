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

export const config = {
  port: Number(process.env.PORT || 8787),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: csv(process.env.CORS_ORIGINS || 'http://localhost:5173'),
  publicBaseUrl: process.env.API_PUBLIC_URL || `http://localhost:${Number(process.env.PORT || 8787)}`,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  appSecret: process.env.APP_SECRET || 'development-only-change-me',
  adAgentSecret: process.env.AD_AGENT_SECRET || '',
  glpiSyncSecret: process.env.GLPI_SYNC_SECRET || process.env.ZIMMET_SYNC_SECRET || '',
  signatureAgentSecret:
    process.env.SIGNATURE_AGENT_SECRET ||
    process.env.ZIMMET_SIGNATURE_AGENT_SECRET ||
    process.env.AD_AGENT_SECRET ||
    process.env.ZIMMET_SYNC_SECRET ||
    '',
  mobildev: {
    apiUrl: process.env.MOBILDEV_SMS_API_URL || 'https://xmlapi.mobildev.com/',
    apiKey: process.env.MOBILDEV_API_KEY || process.env.ZIMMET_MOBILDEV_API_KEY || '',
    apiSecret: process.env.MOBILDEV_API_SECRET || process.env.ZIMMET_MOBILDEV_API_SECRET || '',
    originator: process.env.MOBILDEV_ORIGINATOR || process.env.ZIMMET_MOBILDEV_ORIGINATOR || ''
  },
  googleBridge: {
    url: process.env.GOOGLE_BRIDGE_URL || '',
    secret: process.env.GOOGLE_BRIDGE_SECRET || '',
    uploadAction: process.env.GOOGLE_BRIDGE_UPLOAD_ACTION || 'uploadGeneratedPdf'
  },
  chrome: {
    executablePath: process.env.PDF_CHROME_PATH || process.env.CHROME_PATH || ''
  },
  queue: {
    workerEnabled: bool(process.env.QUEUE_WORKER_ENABLED, false),
    workerIntervalMs: Number(process.env.QUEUE_WORKER_INTERVAL_MS || 30000),
    maxJobsPerRun: Number(process.env.QUEUE_MAX_JOBS_PER_RUN || 2),
    generatedPdfDir: process.env.GENERATED_PDF_DIR || ''
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
  if (missing.length > 0) {
    throw new Error(`Eksik backend ortam degiskenleri: ${missing.join(', ')}`);
  }
}


