import { GAS_URL } from '../config/appConfig.js';

export const API_SESSION_EXPIRED_EVENT = 'istek:session-expired';
export const OPERATION_QUEUE_REFRESH_EVENT = 'istek:operation-queue-refresh';

const QUEUE_MUTATION_ACTIONS = new Set([
  'enqueueADPasswordReset',
  'createPersonnelSignature',
  'saveZimmetServerSide',
  'returnZimmetServerSide',
  'startTransferServerSide',
  'completeTransferServerSide',
  'createSheet',
]);

const DEFAULT_TIMEOUT_MS = 60000;
const SESSION_ERROR_PATTERNS = [
  /oturum bulunamad/i,
  /oturum s(?:u|ü)resi doldu/i,
  /oturum s(?:u|ü)reniz/i,
  /yetkileriniz iptal/i,
  /yeniden giri(?:s|ş)/i,
];

const getRetryAfterSeconds = (response) => {
  const value = response.headers.get('retry-after');
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
};

const isSessionError = (status, message) =>
  status === 401 ||
  SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(String(message || '')));

const dispatchSessionExpired = (message) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(API_SESSION_EXPIRED_EVENT, {
      detail: { message: message || 'Oturum süreniz doldu. Lütfen yeniden giriş yapın.' },
    })
  );
};

export class ApiActionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiActionError';
    this.action = options.action || '';
    this.status = options.status || 0;
    this.code = options.code || '';
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.retryable = Boolean(options.retryable);
    this.sessionExpired = Boolean(options.sessionExpired);
    this.payload = options.payload || null;
    if (options.cause) this.cause = options.cause;
  }
}

export const isRetryableApiError = (error) =>
  Boolean(error?.retryable || error?.status === 429 || error?.status >= 500);

export async function postApiAction(payload, options = {}) {
  const {
    url = GAS_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    notifySessionExpired = true,
  } = options;

  const action = String(payload?.action || '').trim();
  if (!action) {
    throw new ApiActionError('İşlem türü belirtilmedi.', {
      code: 'ACTION_REQUIRED',
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  let timeoutId = null;

  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-ISTEK-Action': action,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let data = {};

    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch (cause) {
        throw new ApiActionError('Sunucudan geçersiz bir yanıt alındı.', {
          action,
          status: response.status,
          code: 'INVALID_JSON',
          retryable: response.status >= 500,
          cause,
        });
      }
    }

    const serverMessage = String(data?.error || data?.message || '').trim();
    const sessionExpired = isSessionError(response.status, serverMessage);
    const retryAfterSeconds = getRetryAfterSeconds(response);

    if (!response.ok || data?.success === false) {
      const rateLimitMessage = retryAfterSeconds
        ? `Çok fazla işlem denendi. ${retryAfterSeconds} saniye sonra tekrar deneyin.`
        : 'Çok fazla işlem denendi. Lütfen kısa süre sonra tekrar deneyin.';
      const message =
        serverMessage ||
        (response.status === 429
          ? rateLimitMessage
          : `İşlem tamamlanamadı (HTTP ${response.status}).`);

      if (sessionExpired && notifySessionExpired) dispatchSessionExpired(message);

      throw new ApiActionError(message, {
        action,
        status: response.status,
        code: data?.code || (response.status === 429 ? 'RATE_LIMITED' : 'API_ERROR'),
        retryAfterSeconds,
        retryable:
          response.status === 429 ||
          response.status >= 500 ||
          /sistem me(?:s|ş)gul|yo(?:g|ğ)un|tekrar deney/i.test(message),
        sessionExpired,
        payload: data,
      });
    }

    if (typeof window !== 'undefined' && QUEUE_MUTATION_ACTIONS.has(action)) {
      window.dispatchEvent(new Event(OPERATION_QUEUE_REFRESH_EVENT));
    }

    return data;
  } catch (error) {
    if (error instanceof ApiActionError) throw error;

    if (error?.name === 'AbortError') {
      throw new ApiActionError(
        timedOut ? 'Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.' : 'İstek iptal edildi.',
        {
          action,
          code: timedOut ? 'TIMEOUT' : 'ABORTED',
          retryable: timedOut,
          cause: error,
        }
      );
    }

    throw new ApiActionError('Sunucuya ulaşılamadı. İnternet veya ağ bağlantısını kontrol edin.', {
      action,
      code: 'NETWORK_ERROR',
      retryable: true,
      cause: error,
    });
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
  }
}
