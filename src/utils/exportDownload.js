function extractDownloadFileName(response, fallbackName) {
  const disposition = response.headers.get('content-disposition') || '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  const encodedName = utf8Match?.[1] || plainMatch?.[1] || '';

  if (!encodedName) return fallbackName;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}

export async function downloadGeneratedExport(url, fallbackName = 'disa-aktarim.xlsx') {
  if (typeof window === 'undefined') throw new Error('İndirme yalnızca tarayıcıda başlatılabilir.');

  const parsedUrl = new URL(String(url || ''), window.location.origin);
  if (parsedUrl.origin !== window.location.origin) {
    throw new Error('İndirme bağlantısı beklenmeyen bir adrese yönlendiriyor.');
  }

  const response = await fetch(parsedUrl.href, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  });

  if (!response.ok) {
    let message = 'Excel dosyası indirilemedi.';
    try {
      const errorBody = await response.json();
      if (errorBody?.error) message = errorBody.error;
    } catch {
      // JSON olmayan hata yanıtlarında güvenli genel mesajı kullan.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = extractDownloadFileName(response, fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
