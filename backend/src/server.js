import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { closePool, getPool } from './db.js';
import { handleAction } from './actionRouter.js';
import { startGlpiQueueWorker } from './glpiQueueWorker.js';
import { startPdfQueueWorker } from './pdfQueueWorker.js';
import { startQueueRetentionWorker } from './queueRetentionWorker.js';
import { closePdfRenderer } from './pdfRenderer.js';
import { verifyExportDownloadToken } from './exportTokens.js';
import { AgentAuthError, isAgentAction, verifyAgentRequest } from './agentAuth.js';
import { validateActionRequest } from './requestValidation.js';
import {
  assertSessionCookieConfig,
  readCookieValue,
  serializeSessionCookie
} from './sessionCookie.js';

assertConfig();
assertSessionCookieConfig(config.session);

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-zimmet-signature"]',
      'req.headers["x-zimmet-nonce"]',
      'req.headers["x-zimmet-timestamp"]',
      'req.headers.referer',
      'req.headers.referrer',
      'res.headers["set-cookie"]'
    ],
    censor: '[REDACTED]'
  }
});

const app = express();
if (config.trustProxy) app.set('trust proxy', 'loopback');

const SENSITIVE_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'referer',
  'referrer',
  'x-zimmet-nonce',
  'x-zimmet-signature',
  'x-zimmet-timestamp'
]);

function serializeRequestForLog(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers || {})) {
    headers[name] = SENSITIVE_REQUEST_HEADERS.has(name.toLowerCase()) ? '[REDACTED]' : value;
  }

  const requestUrl = String(req.originalUrl || req.url || '');
  return {
    id: req.id,
    method: req.method,
    url: requestUrl.split('?')[0],
    headers,
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort
  };
}

const actionRateLimits = {
  verifyLogin: { windowMs: 5 * 60 * 1000, max: 60 },
  sendOTP: { windowMs: 10 * 60 * 1000, max: 120 },
  verifyOTP: { windowMs: 10 * 60 * 1000, max: 300 },
  enqueueADPasswordReset: { windowMs: 10 * 60 * 1000, max: 60 },
  createPersonnelSignature: { windowMs: 10 * 60 * 1000, max: 60 },
  cancelSignatureJob: { windowMs: 10 * 60 * 1000, max: 120 },
  createSheet: { windowMs: 10 * 60 * 1000, max: 10 },
  runOperationQueue: { windowMs: 60 * 1000, max: 30 },
  adminFetchOverview: { windowMs: 10 * 60 * 1000, max: 120 },
  adminSaveAuthorizedUser: { windowMs: 10 * 60 * 1000, max: 60 },
  adminSavePersonnelOverride: { windowMs: 10 * 60 * 1000, max: 60 },
  adminClearPersonnelOverride: { windowMs: 10 * 60 * 1000, max: 60 },
  adminSaveSignatureTitle: { windowMs: 10 * 60 * 1000, max: 60 },
  syncGLPI: { windowMs: 10 * 60 * 1000, max: 30 },
  syncPersonnel: { windowMs: 10 * 60 * 1000, max: 120 },
  fetchADPasswordJobs: { windowMs: 10 * 60 * 1000, max: 180 },
  completeADPasswordJob: { windowMs: 10 * 60 * 1000, max: 300 },
  fetchSignatureJobs: { windowMs: 10 * 60 * 1000, max: 180 },
  fetchSignatureJobStates: { windowMs: 10 * 60 * 1000, max: 300 },
  completeSignatureJob: { windowMs: 10 * 60 * 1000, max: 300 }
};

const rateLimitBuckets = new Map();
const DEFAULT_ACTION_BODY_LIMIT = 2 * 1024 * 1024;
const actionBodyLimits = {
  manualAssign: 22 * 1024 * 1024,
  uploadMissingDocument: 22 * 1024 * 1024,
  createSheet: 10 * 1024 * 1024,
  syncGLPI: 12 * 1024 * 1024,
  syncPersonnel: 12 * 1024 * 1024
};

function getActionBodyLimit(action) {
  return actionBodyLimits[action] || DEFAULT_ACTION_BODY_LIMIT;
}

function getHintedAction(req) {
  return String(req.headers['x-istek-action'] || req.headers['x-zimmet-action'] || '')
    .trim()
    .slice(0, 120);
}

function getActionErrorResponse(error) {
  const message = String(error?.message || 'Sunucu hatası.');
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599) {
    return { status: error.statusCode, message };
  }
  if (/oturum bulunamadı|oturum süresi doldu/i.test(message)) {
    return { status: 401, message };
  }
  if (/yetki|yetkisiz|erişim izn/i.test(message)) {
    return { status: 403, message };
  }

  const internalCodes = new Set([
    'EREQUEST',
    'ELOGIN',
    'ETIMEOUT',
    'ESOCKET',
    'ECONNCLOSED',
    'ENOTOPEN',
    'EINSTLOOKUP'
  ]);
  const internal = internalCodes.has(error?.code) || error instanceof TypeError;
  return {
    status: internal ? 500 : 400,
    message:
      internal && config.nodeEnv === 'production'
        ? 'Sunucuda beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'
        : message
  };
}

function normalizeClientIp(value) {
  return String(value || '')
    .split(',')[0]
    .trim()
    .replace(/^::ffff:/i, '')
    .slice(0, 120);
}

function getRequestClientIp(req) {
  const remoteAddress = normalizeClientIp(req.socket?.remoteAddress);
  const isLoopbackProxy = remoteAddress === '127.0.0.1' || remoteAddress === '::1';
  if (config.trustProxy && isLoopbackProxy) {
    const cloudflareIp = normalizeClientIp(req.headers['cf-connecting-ip']);
    if (cloudflareIp) return cloudflareIp;
    const proxyIp = normalizeClientIp(req.ip);
    if (proxyIp) return proxyIp;
  }
  return normalizeClientIp(req.socket?.remoteAddress) || 'unknown';
}

function getRateLimitClientKey(req) {
  return getRequestClientIp(req);
}

function checkRateLimitBucket(key, rule) {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (rateLimitBuckets.size >= config.rateLimit.maxBuckets) {
      for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
        if (bucket.resetAt <= now) rateLimitBuckets.delete(bucketKey);
      }
      if (rateLimitBuckets.size >= config.rateLimit.maxBuckets) {
        return { retryAfterSeconds: 60 };
      }
    }

    rateLimitBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return null;
  }

  existing.count = Math.min(existing.count + 1, rule.max + 1);
  if (existing.count <= rule.max) return null;

  return {
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  };
}

function checkActionRateLimit(req, action) {
  const rule = actionRateLimits[action];
  if (!rule) return null;
  return checkRateLimitBucket(`action:${action}:${getRateLimitClientKey(req)}`, rule);
}

function checkGlobalApiRateLimit(req) {
  return checkRateLimitBucket(`global:${getRateLimitClientKey(req)}`, {
    windowMs: config.rateLimit.globalWindowMs,
    max: config.rateLimit.globalMax
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://*.googleusercontent.com',
          'https://lh3.googleusercontent.com',
          'https://istek.site',
          'https://drive.google.com',
          'https://media1.tenor.com'
        ],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://www.googleapis.com', 'https://oauth2.googleapis.com'],
        frameSrc: ["'self'", 'https://accounts.google.com', 'https://drive.google.com'],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        // Yerel HTTP gelistirme/testinde modullerin HTTPS'e zorlanip beyaz ekran
        // olusturmasini engelle. Cloudflare arkasindaki production yayinda aktif kalir.
        upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null
      }
    },
    crossOriginOpenerPolicy: false
  })
);
function getRequestHost(req) {
  return String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function isAllowedApiOrigin(req, origin) {
  if (!origin || config.corsOrigins.includes(origin)) return true;

  try {
    return new URL(origin).host.toLowerCase() === getRequestHost(req);
  } catch {
    return false;
  }
}

app.use('/api/action', (req, res, next) =>
  cors({
    origin(origin, callback) {
      if (isAllowedApiOrigin(req, origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS reddedildi: ${origin}`));
    },
    credentials: true
  })(req, res, next)
);
app.use(
  pinoHttp({
    logger,
    wrapSerializers: false,
    serializers: {
      req: serializeRequestForLog,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err
    }
  })
);

app.use('/api/action', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const rateLimit = checkGlobalApiRateLimit(req);
  if (!rateLimit) return next();

  res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
  res.status(429).json({
    success: false,
    error: 'Sunucuya çok fazla istek gönderildi. Lütfen kısa bir süre sonra tekrar deneyin.'
  });
  return undefined;
});

const captureRawBody = (req, _res, buffer) => {
  req.rawBody = Buffer.from(buffer);
};

const actionBodyParsers = new Map();
for (const limit of new Set([DEFAULT_ACTION_BODY_LIMIT, ...Object.values(actionBodyLimits)])) {
  actionBodyParsers.set(limit, {
    json: express.json({ limit, verify: captureRawBody }),
    text: express.text({ limit, type: ['text/plain', 'text/*'], verify: captureRawBody })
  });
}

app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const limit = getActionBodyLimit(getHintedAction(req));
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    res.status(413).json({ success: false, error: 'İstek verisi bu işlem için izin verilen boyutu aşıyor.' });
    return undefined;
  }

  const parsers = actionBodyParsers.get(limit) || actionBodyParsers.get(DEFAULT_ACTION_BODY_LIMIT);
  if (/^text\//i.test(String(req.headers['content-type'] || ''))) {
    return parsers.text(req, res, next);
  }
  return parsers.json(req, res, next);
});

const defaultExportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generated-exports');
const exportDir = config.exports.dir || defaultExportDir;
app.get('/exports/:fileName', (req, res, next) => {
  const fileName = String(req.params.fileName || '');
  const hasSafeName = fileName && path.basename(fileName) === fileName;
  const hasValidToken = verifyExportDownloadToken(
    fileName,
    req.query.expires,
    req.query.signature
  );

  if (!hasSafeName || !hasValidToken) {
    res.status(403).json({ success: false, error: 'İndirme bağlantısı geçersiz veya süresi dolmuş.' });
    return;
  }

  res.setHeader('cache-control', 'private, no-store');
  res.download(path.join(exportDir, fileName), fileName, (error) => {
    if (!error) return;
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error.code === 'ENOENT') {
      res.status(404).json({ success: false, error: 'Dışa aktarım dosyası bulunamadı.' });
      return;
    }
    next(error);
  });
});

app.get('/health', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await getPool();
    res.json({ success: true, status: 'ok', database: 'connected' });
  } catch (error) {
    req.log?.error({ err: error }, 'health database check failed');
    res.status(503).json({
      success: false,
      status: 'error',
      error:
        config.nodeEnv === 'production'
          ? 'Veritabanı bağlantısı kullanılamıyor.'
          : String(error?.message || 'Veritabanı bağlantısı kullanılamıyor.')
    });
  }
});

app.post('/api/action', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const requestBody =
      typeof req.body === 'string' && req.body.trim()
        ? JSON.parse(req.body)
        : req.body || {};

    validateActionRequest(requestBody);

    const hintedAction = getHintedAction(req);
    if (hintedAction && hintedAction !== String(requestBody.action || '')) {
      res.status(400).json({ success: false, error: 'İşlem başlığı ile istek gövdesi uyuşmuyor.' });
      return;
    }

    const bodySize = req.rawBody?.length || 0;
    if (bodySize > getActionBodyLimit(requestBody.action)) {
      res.status(413).json({
        success: false,
        error: 'İstek verisi bu işlem için izin verilen boyutu aşıyor.'
      });
      return;
    }

    const actionRateLimit = checkActionRateLimit(req, requestBody.action);
    if (actionRateLimit) {
      res.setHeader('Retry-After', String(actionRateLimit.retryAfterSeconds));
      res.status(429).json({
        success: false,
        error: 'Çok fazla işlem denemesi yapıldı. Lütfen biraz bekleyip tekrar deneyin.'
      });
      return;
    }

    let agentAuth = null;
    if (isAgentAction(requestBody.action)) {
      try {
        agentAuth = await verifyAgentRequest({
          action: requestBody.action,
          headers: req.headers,
          rawBody: req.rawBody
        });
      } catch (error) {
        if (error instanceof AgentAuthError) {
          const logPayload = {
            err: error.statusCode >= 500 ? error : undefined,
            action: requestBody.action,
            statusCode: error.statusCode
          };
          if (error.statusCode >= 500) {
            req.log.error(logPayload, 'agent auth unavailable');
          } else {
            req.log.warn(logPayload, 'agent auth rejected');
          }
          res.status(error.statusCode).json({ success: false, error: error.message });
          return;
        }
        throw error;
      }
    }

    const cookieSessionToken = config.session.cookieEnabled
      ? readCookieValue(req.headers.cookie, config.session.cookieName)
      : '';
    if (
      cookieSessionToken &&
      String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site'
    ) {
      res.status(403).json({ success: false, error: 'Çapraz site cookie isteği reddedildi.' });
      return;
    }
    const bodySessionToken =
      !config.session.cookieEnabled || config.session.allowBodyTokenFallback
        ? requestBody.authToken
        : '';
    const actionData = {
      ...requestBody,
      authToken: cookieSessionToken || bodySessionToken,
      clientIp: getRequestClientIp(req),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 500)
    };
    let response = await handleAction(actionData, { agentAuth });

    if (
      config.session.cookieEnabled &&
      requestBody.action === 'verifyLogin' &&
      response.success &&
      response.sessionToken
    ) {
      res.append('Set-Cookie', serializeSessionCookie(response.sessionToken, config.session));
      const { sessionToken: _sessionToken, ...publicResponse } = response;
      response = {
        ...publicResponse,
        sessionMode: 'cookie',
        expiresInSeconds: config.session.cookieMaxAgeSeconds
      };
    }

    if (config.session.cookieEnabled && requestBody.action === 'logout') {
      res.append('Set-Cookie', serializeSessionCookie('', config.session, { clear: true }));
    }

    res.status(response.success ? 200 : 400).json(response);
  } catch (error) {
    req.log.error({ err: error }, 'action failed');
    const response = getActionErrorResponse(error);
    if (config.session.cookieEnabled && response.status === 401) {
      res.append('Set-Cookie', serializeSessionCookie('', config.session, { clear: true }));
    }
    res.status(response.status).json({ success: false, error: response.message });
  }
});

if (config.frontend.serveEnabled) {
  const defaultDistDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
  const frontendDistDir = config.frontend.distDir
    ? path.resolve(config.frontend.distDir)
    : defaultDistDir;

  app.use(
    express.static(frontendDistDir, {
      index: false,
      setHeaders(res, filePath) {
        const baseName = path.basename(filePath).toLowerCase();
        const relativePath = path.relative(frontendDistDir, filePath);
        const isUpdateMetadata =
          baseName === 'sw.js' ||
          baseName === 'registersw.js' ||
          baseName === 'manifest.webmanifest' ||
          baseName === 'manifest.json';

        if (baseName.endsWith('.html')) {
          res.setHeader('cache-control', 'no-store');
          return;
        }

        if (isUpdateMetadata) {
          res.setHeader('cache-control', 'no-cache');
          if (baseName === 'sw.js') res.setHeader('service-worker-allowed', '/');
          return;
        }

        const isHashedAsset =
          relativePath.split(path.sep)[0] === 'assets' ||
          /(?:^|[.-])[a-f0-9]{8,}(?:[.-]|$)/i.test(baseName);
        res.setHeader(
          'cache-control',
          isHashedAsset
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=3600, must-revalidate'
        );
      }
    })
  );

  app.get('*', (req, res, next) => {
    const isReservedPath =
      req.path === '/health' ||
      req.path.startsWith('/api/') ||
      req.path.startsWith('/exports/');
    if (isReservedPath || !req.accepts('html')) {
      next();
      return;
    }

    res.setHeader('cache-control', 'no-store');
    res.sendFile(path.join(frontendDistDir, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
}

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint bulunamadı.' });
});

app.use((error, req, res, _next) => {
  req.log?.error({ err: error }, 'request failed');
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'İstek verisi sunucu sınırını aşıyor.' });
    return;
  }
  if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
    res.status(400).json({ success: false, error: 'Geçersiz JSON verisi gönderildi.' });
    return;
  }
  if (/^CORS reddedildi:/i.test(String(error?.message || ''))) {
    res.status(403).json({ success: false, error: 'Bu kaynaktan erişime izin verilmiyor.' });
    return;
  }
  res.status(500).json({ success: false, error: 'Sunucuda beklenmeyen bir hata oluştu.' });
});

let glpiQueueWorker = null;
let pdfQueueWorker = null;
let queueRetentionWorker = null;
const server = app.listen(config.port, config.host, () => {
  logger.info(
    {
      host: config.host,
      port: config.port,
      requestTimeoutMs: config.http.requestTimeoutMs,
      headersTimeoutMs: config.http.headersTimeoutMs,
      apiRateLimitWindowMs: config.rateLimit.globalWindowMs,
      apiRateLimitMax: config.rateLimit.globalMax
    },
    'İSTEK Zimmet SQL API başladı'
  );
  glpiQueueWorker = startGlpiQueueWorker(logger);
  pdfQueueWorker = startPdfQueueWorker(logger);
  queueRetentionWorker = startQueueRetentionWorker(logger);
});
server.requestTimeout = config.http.requestTimeoutMs;
server.headersTimeout = config.http.headersTimeoutMs;
server.keepAliveTimeout = config.http.keepAliveTimeoutMs;
server.maxHeadersCount = config.http.maxHeadersCount;
server.maxRequestsPerSocket = config.http.maxRequestsPerSocket;

let shutdownStarted = false;
async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info({ signal }, 'Sunucu kontrollü olarak kapatılıyor');

  const serverClosed = new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  const forceExitTimer = setTimeout(() => {
    logger.error('Kontrollü kapanış zaman aşımına uğradı');
    process.exit(1);
  }, 30000);
  forceExitTimer.unref?.();

  try {
    await glpiQueueWorker?.stop?.();
    await pdfQueueWorker?.stop?.();
    await queueRetentionWorker?.stop?.();
    await serverClosed;
    await closePdfRenderer();
    await closePool();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Kontrollü kapanış sırasında hata oluştu');
    process.exit(1);
  }
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
