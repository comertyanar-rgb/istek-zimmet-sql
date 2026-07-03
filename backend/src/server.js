import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { getPool } from './db.js';
import { handleAction } from './actionRouter.js';
import { startPdfQueueWorker } from './pdfQueueWorker.js';

assertConfig();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

const app = express();

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS reddedildi: ${origin}`));
    },
    credentials: false
  })
);
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ limit: '20mb', type: ['text/plain', 'text/*'] }));
app.use(pinoHttp({ logger }));

const defaultExportDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generated-exports');
const exportDir = config.exports.dir || defaultExportDir;
app.use('/exports', express.static(exportDir, {
  fallthrough: false,
  setHeaders(res) {
    res.setHeader('cache-control', 'private, max-age=3600');
  }
}));

app.get('/health', async (_req, res) => {
  try {
    await getPool();
    res.json({ success: true, status: 'ok', database: 'connected' });
  } catch (error) {
    res.status(503).json({ success: false, status: 'error', error: error.message });
  }
});

app.post('/api/action', async (req, res) => {
  try {
    const requestBody =
      typeof req.body === 'string' && req.body.trim()
        ? JSON.parse(req.body)
        : req.body || {};

    const response = await handleAction(requestBody);
    res.status(response.success ? 200 : 400).json(response);
  } catch (error) {
    req.log.error({ err: error }, 'action failed');
    res.status(500).json({ success: false, error: error.message || 'Sunucu hatasi.' });
  }
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint bulunamadi.' });
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'ISTEK Zimmet SQL API basladi');
  startPdfQueueWorker(logger);
});
