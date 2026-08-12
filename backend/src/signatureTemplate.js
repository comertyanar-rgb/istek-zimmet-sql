const VALID_TEMPLATE_KEY = /^[1-4](?:-w)?$/;
const LEGACY_TEMPLATE_KEYS = {
  normal: '1',
  compact: '2',
  small: '3',
  tiny: '4',
};

export function normalizeSignatureTemplateKey(value) {
  let key = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!key) return '';
  key = key.replace(/^imza-template-/i, '');
  key = key.replace(/^template-/i, '');
  key = key.replace(/^tpl/i, '');
  key = LEGACY_TEMPLATE_KEYS[key] || key;
  return VALID_TEMPLATE_KEY.test(key) ? key : '';
}

export function getSignatureNameWidth(name) {
  const normalized = String(name || '').replace(/\s+/g, ' ').trim();
  let width = 0;

  for (const character of normalized) {
    if (/\s|-/.test(character)) width += 0.45;
    else if (/[iıİIljtfr1]/u.test(character)) width += 0.55;
    else if (/[MWĞŞÜÖÇQ@]/u.test(character)) width += 1.3;
    else if (character === character.toLocaleUpperCase('tr-TR') && /\p{L}/u.test(character)) width += 1.05;
    else width += 0.9;
  }

  return Math.round(width * 100) / 100;
}

export function isWideSignatureName(name) {
  const normalized = String(name || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 25 || getSignatureNameWidth(normalized) > 22;
}

export function getSignatureTitleTemplateVariant(titleTr, titleEn, explicitTemplateKey) {
  const requestedKey = normalizeSignatureTemplateKey(explicitTemplateKey);
  if (requestedKey) return requestedKey;

  const tr = String(titleTr || '').replace(/\s+/g, ' ').trim();
  const en = String(titleEn || '').replace(/\s+/g, ' ').trim();
  const maxLength = Math.max(tr.length, en.length);
  const combinedLength = tr.length + en.length;

  if (maxLength > 62 || combinedLength > 118) return '4';
  if (maxLength > 48 || combinedLength > 96) return '3';
  if (maxLength > 36 || combinedLength > 76) return '2';
  return '1';
}

export function getSignatureTemplateVariant(titleTr, titleEn, explicitTemplateKey, personName) {
  const titleVariant = getSignatureTitleTemplateVariant(titleTr, titleEn, explicitTemplateKey);
  if (titleVariant.endsWith('-w') || !isWideSignatureName(personName)) return titleVariant;
  return `${titleVariant}-w`;
}
