export class UpstreamRequestError extends Error {
  constructor(message, statusCode, cause) {
    super(message);
    this.name = 'UpstreamRequestError';
    this.statusCode = statusCode;
    this.code = statusCode === 504 ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE';
    if (cause) this.cause = cause;
  }
}

export async function fetchWithTimeout(url, options = {}, settings = {}) {
  const timeoutMs = Math.max(1000, Number(settings.timeoutMs) || 15000);
  const label = String(settings.label || 'Dış servis');
  const controller = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  let timedOut = false;

  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError' && timedOut) {
      throw new UpstreamRequestError(`${label} zamanında yanıt vermedi.`, 504, error);
    }
    if (error?.name === 'AbortError') throw error;
    throw new UpstreamRequestError(`${label} servisine ulaşılamadı.`, 502, error);
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal) callerSignal.removeEventListener('abort', abortFromCaller);
  }
}
