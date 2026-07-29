export const UI_MESSAGE_REQUEST_EVENT = 'istek:ui-message-request';

let requestSequence = 0;

function nextRequestId() {
  requestSequence += 1;
  return `ui-message-${Date.now()}-${requestSequence}`;
}

function inferMessageType(message) {
  const normalized = String(message || '').toLocaleLowerCase('tr-TR');

  if (
    /hata|başarısız|basarisiz|ulaşılamadı|ulasilamadi|kaydedilemedi|oluşturulamadı|olusturulamadi/.test(
      normalized
    )
  ) {
    return 'error';
  }

  if (
    /uyarı|uyari|dikkat|lütfen|lutfen|süresi doldu|suresi doldu|geçersiz|gecersiz/.test(
      normalized
    )
  ) {
    return 'warning';
  }

  if (/başarıyla|basariyla|tamamlandı|tamamlandi|kaydedildi/.test(normalized)) {
    return 'success';
  }

  return 'info';
}

function getDefaultTitle(type) {
  if (type === 'error') return 'İşlem tamamlanamadı';
  if (type === 'warning') return 'Dikkat';
  if (type === 'success') return 'İşlem başarılı';
  return 'Bilgilendirme';
}

function dispatchUiRequest(detail) {
  if (typeof window === 'undefined') {
    detail.resolve?.(detail.kind === 'confirm' ? false : undefined);
    return;
  }

  window.dispatchEvent(new CustomEvent(UI_MESSAGE_REQUEST_EVENT, { detail }));
}

export function showAppAlert(message, options = {}) {
  const text = String(message || '').trim() || 'İşlem hakkında ayrıntı alınamadı.';
  const type = options.type || inferMessageType(text);

  return new Promise((resolve) => {
    dispatchUiRequest({
      id: nextRequestId(),
      kind: 'alert',
      type,
      title: options.title || getDefaultTitle(type),
      message: text,
      confirmLabel: options.confirmLabel || 'Tamam',
      dedupeKey: options.dedupeKey || `alert:${type}:${options.title || ''}:${text}`,
      resolve,
    });
  });
}

export function confirmAppAction(options) {
  const config = typeof options === 'string' ? { message: options } : options || {};
  const message = String(config.message || '').trim();
  const type = config.type === 'danger' ? 'error' : config.type || 'info';

  return new Promise((resolve) => {
    dispatchUiRequest({
      id: nextRequestId(),
      kind: 'confirm',
      type,
      title: config.title || 'İşlemi onaylayın',
      message: message || 'Bu işleme devam etmek istiyor musunuz?',
      confirmLabel: config.confirmLabel || 'Onayla',
      cancelLabel: config.cancelLabel || 'Vazgeç',
      resolve,
    });
  });
}
