const DEFAULT_BASE_URL = 'http://localhost:8787';
const REQUEST_TIMEOUT_MS = 8000;

const baseUrl = String(process.env.API_BASE_URL || process.argv[2] || DEFAULT_BASE_URL)
  .trim()
  .replace(/\/+$/, '');

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl}${path}`, {
      redirect: 'error',
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON yaniti bekleniyordu (${response.status}): ${text.slice(0, 160)}`);
  }
}

async function check(name, callback) {
  try {
    const detail = await callback();
    record(name, true, detail || 'Tamam');
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

await check('Saglik ve veritabani baglantisi', async () => {
  const response = await request('/health', { headers: { Accept: 'application/json' } });
  assert(response.status === 200, `HTTP ${response.status}`);
  const body = await readJson(response);
  assert(body?.success === true, 'success=true donmedi');
  assert(body?.status === 'ok', `Beklenmeyen durum: ${body?.status || 'bos'}`);
  assert(body?.database === 'connected', `Veritabani durumu: ${body?.database || 'bos'}`);
  return 'API ve SQL baglantisi hazir';
});

await check('Temel HTTP guvenlik basliklari', async () => {
  const response = await request('/health', { headers: { Accept: 'application/json' } });
  const expected = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer'
  };

  for (const [header, value] of Object.entries(expected)) {
    const actual = response.headers.get(header);
    assert(actual?.toLowerCase() === value.toLowerCase(), `${header}: ${actual || 'eksik'}`);
  }

  assert(response.headers.has('content-security-policy'), 'content-security-policy eksik');
  assert(!response.headers.has('x-powered-by'), 'x-powered-by sunucu bilgisini sizdiriyor');
  assert(response.headers.get('cache-control') === 'no-store', 'health yaniti no-store degil');
  return 'Helmet basliklari etkin';
});

await check('Bozuk JSON reddi', async () => {
  const response = await request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{"action":"fetchData"'
  });
  assert(response.status === 400, `HTTP ${response.status}; 400 bekleniyordu`);
  return 'Bozuk govde HTTP 400 ile reddedildi';
});

await check('Bilinmeyen eylem reddi', async () => {
  const response = await request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: '__codex_smoke_unknown_action__' })
  });
  assert(response.status === 400, `HTTP ${response.status}; 400 bekleniyordu`);
  const body = await readJson(response);
  assert(body?.success === false, 'success=false donmedi');
  return 'Eylem izin listesi etkin';
});

await check('Eylem basligi ve govde uyusmazligi reddi', async () => {
  const response = await request('/api/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Istek-Action': 'fetchHardwareHistory'
    },
    body: JSON.stringify({ action: 'fetchData' })
  });
  assert(response.status === 400, `HTTP ${response.status}; 400 bekleniyordu`);
  return 'Parser boyut ipucu govdeyle eslesmek zorunda';
});

await check('Asiri derin JSON reddi', async () => {
  let nested = { value: 'test' };
  for (let index = 0; index < 20; index += 1) nested = { child: nested };

  const response = await request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'fetchData', nested })
  });
  assert(response.status === 400, `HTTP ${response.status}; 400 bekleniyordu`);
  return 'JSON derinlik siniri etkin';
});

await check('Prototype pollution reddi', async () => {
  const response = await request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{"action":"fetchData","__proto__":{"polluted":true}}'
  });
  assert(response.status === 400, `HTTP ${response.status}; 400 bekleniyordu`);
  return 'Tehlikeli nesne anahtarlari reddediliyor';
});

await check('Korunan eylemde oturum zorunlulugu', async () => {
  const response = await request('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action: 'fetchData' })
  });
  assert([401, 403].includes(response.status), `HTTP ${response.status}; 401/403 bekleniyordu`);
  const body = await readJson(response);
  assert(body?.success === false, 'success=false donmedi');
  return 'Yetkisiz veri okuma reddedildi';
});

await check('Izin verilmeyen Origin reddi', async () => {
  const response = await request('/health', {
    headers: { Accept: 'application/json', Origin: 'https://untrusted.invalid' }
  });
  assert(response.status === 403, `HTTP ${response.status}; 403 bekleniyordu`);
  const body = await readJson(response);
  assert(body?.success === false, 'success=false donmedi');
  assert(!response.headers.has('access-control-allow-origin'), 'Guvenilmeyen Origin CORS izni aldi');
  return 'CORS izin listesi etkin';
});

await check('Imzasiz export baglantisi reddi', async () => {
  const response = await request('/exports/codex-smoke.xlsx', {
    headers: { Accept: 'application/json' }
  });
  assert(response.status === 403, `HTTP ${response.status}; 403 bekleniyordu`);
  return 'Export indirme imzasi zorunlu';
});

await check('Bilinmeyen endpoint reddi', async () => {
  const response = await request('/__codex_smoke_not_found__', {
    headers: { Accept: 'application/json' }
  });
  assert(response.status === 404, `HTTP ${response.status}; 404 bekleniyordu`);
  const body = await readJson(response);
  assert(body?.success === false, 'success=false donmedi');
  return 'Bilinmeyen endpoint HTTP 404 donuyor';
});

console.log(`\nISTEK Zimmet API smoke testi: ${baseUrl}\n`);
for (const result of results) {
  console.log(`${result.passed ? 'OK' : 'HATA'}  ${result.name}: ${result.detail}`);
}

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} kontrol basarili.`);
if (failed.length > 0) process.exitCode = 1;
