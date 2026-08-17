const KNOWN_ACTIONS = new Set([
  'verifyLogin',
  'fetchADPasswordJobs',
  'completeADPasswordJob',
  'syncGLPI',
  'syncPersonnel',
  'fetchSignatureJobs',
  'fetchSignatureJobStates',
  'completeSignatureJob',
  'logout',
  'sendOTP',
  'verifyOTP',
  'fetchOperationQueue',
  'dismissQueueNotifications',
  'fetchADPasswordQueue',
  'enqueueADPasswordReset',
  'fetchSignatureMeta',
  'fetchSignatureQueue',
  'cancelSignatureJob',
  'createPersonnelSignature',
  'runOperationQueue',
  'adminFetchOverview',
  'adminFetchAuditLogs',
  'adminSaveAuthorizedUser',
  'adminSavePersonnelOverride',
  'adminClearPersonnelOverride',
  'adminSaveSignatureTitle',
  'fetchData',
  'fetchHardwareHistory',
  'fetchPersonDocumentHistory',
  'fetchMissingGLPIDevices',
  'importMissingGLPIDevices',
  'createSheet',
  'addHardware',
  'bulkAddHardware',
  'lookupPersonnelByNationalId',
  'bulkInitialAssignment',
  'updateHardware',
  'bulkUpdateGroup',
  'bulkStatusUpdate',
  'recordInventoryScan',
  'manualAssign',
  'uploadMissingDocument',
  'saveZimmetServerSide',
  'returnZimmetServerSide',
  'startTransferServerSide',
  'completeTransferServerSide',
  'cancelTransfer'
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 500_000;
const MAX_OBJECT_KEYS = 120;
const MAX_FIELD_NAME_LENGTH = 160;
const MAX_DEFAULT_STRING_LENGTH = 1_000_000;
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil((15 * 1024 * 1024) / 3) * 4;

const ROOT_ARRAY_LIMITS = {
  hardwareIds: 5000,
  hardwareList: 5000,
  glpiIds: 5000,
  signatureIds: 25,
  scans: 5000
};

const ACTION_ARRAY_LIMITS = {
  syncGLPI: { items: 20_000 },
  syncPersonnel: { items: 5000 },
  createSheet: { data: 10_000 },
  bulkAddHardware: { items: 1000 },
  bulkInitialAssignment: { items: 5000 },
  dismissQueueNotifications: { items: 100 }
};

export class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestValidationError';
    this.statusCode = 400;
    this.code = 'INVALID_REQUEST';
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function maxStringLength(path) {
  const field = path[path.length - 1] || '';
  if (field === 'pdfData') return MAX_UPLOAD_BASE64_LENGTH;
  if (
    field === 'personSignature' ||
    field === 'itSignature' ||
    field === 'transferSignature' ||
    field === 'personStatement' ||
    field === 'itStatement' ||
    field === 'transferStatement'
  ) {
    return 300_000;
  }
  if (field === 'googleToken' || field === 'googleAccessToken') return 16_384;
  if (field === 'authToken') return 250;
  return MAX_DEFAULT_STRING_LENGTH;
}

function maxArrayLength(action, path) {
  if (path.length !== 1) return 20_000;
  const field = path[0];
  return ACTION_ARRAY_LIMITS[action]?.[field] || ROOT_ARRAY_LIMITS[field] || 20_000;
}

function validateScalarIdArray(value, field, maxItems) {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${field} alanı liste biçiminde olmalıdır.`);
  }
  if (value.length > maxItems) {
    throw new RequestValidationError(`${field} alanı en fazla ${maxItems} kayıt içerebilir.`);
  }
  for (const item of value) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      throw new RequestValidationError(`${field} alanında geçersiz bir kimlik var.`);
    }
    if (!String(item).trim() || String(item).length > 160) {
      throw new RequestValidationError(`${field} alanında geçersiz bir kimlik var.`);
    }
  }
}

function validateActionSpecificShape(data) {
  if (Object.hasOwn(data, 'hardwareIds')) validateScalarIdArray(data.hardwareIds, 'hardwareIds', 5000);
  if (Object.hasOwn(data, 'glpiIds')) validateScalarIdArray(data.glpiIds, 'glpiIds', 5000);
  if (Object.hasOwn(data, 'signatureIds')) validateScalarIdArray(data.signatureIds, 'signatureIds', 25);

  if (Object.hasOwn(data, 'scans')) {
    if (!Array.isArray(data.scans) || data.scans.length > 5000) {
      throw new RequestValidationError('scans alanı en fazla 5000 kayıt içeren bir liste olmalıdır.');
    }
    if (data.scans.some((scan) => !isPlainObject(scan))) {
      throw new RequestValidationError('scans alanında geçersiz bir kayıt var.');
    }
  }

  if (data.action === 'syncGLPI') {
    if (!Array.isArray(data.items)) {
      throw new RequestValidationError('Senkronizasyon kayıtları liste biçiminde olmalıdır.');
    }
  }

  if (
    data.action === 'syncPersonnel' &&
    !Array.isArray(data.items) &&
    !isPlainObject(data.person)
  ) {
    throw new RequestValidationError('Personel senkronizasyon kaydı bulunamadı.');
  }

  if (data.action === 'fetchSignatureJobStates' && !Array.isArray(data.signatureIds)) {
    throw new RequestValidationError('İmza kimlikleri liste biçiminde olmalıdır.');
  }

  if (
    data.action === 'cancelSignatureJob' &&
    (typeof data.queueId !== 'string' || !data.queueId.trim() || data.queueId.length > 80)
  ) {
    throw new RequestValidationError('İptal edilecek imza kuyruğu kimliği geçersiz.');
  }

  if (data.action === 'createSheet') {
    if (!Array.isArray(data.data)) {
      throw new RequestValidationError('Dışa aktarım verisi liste biçiminde olmalıdır.');
    }
    if (
      data.templateHeaders !== undefined &&
      (!Array.isArray(data.templateHeaders) ||
        data.templateHeaders.length > 100 ||
        data.templateHeaders.some(
          (header) => typeof header !== 'string' || !header.trim() || header.length > 240
        ))
    ) {
      throw new RequestValidationError('Şablon başlıkları geçersiz.');
    }
    if (data.format !== undefined && !['xlsx', 'google-sheet'].includes(data.format)) {
      throw new RequestValidationError('Dışa aktarım biçimi geçersiz.');
    }
  }

  if (data.action === 'adminSaveSignatureTitle') {
    if (
      typeof data.titleTr !== 'string' ||
      !data.titleTr.trim() ||
      data.titleTr.length > 240
    ) {
      throw new RequestValidationError('Türkçe ünvan 1-240 karakter olmalıdır.');
    }
    if (data.titleEn !== undefined && (typeof data.titleEn !== 'string' || data.titleEn.length > 240)) {
      throw new RequestValidationError('İngilizce ünvan en fazla 240 karakter olmalıdır.');
    }
    if (!/^[1-4](?:-w)?$/.test(String(data.templateKey || ''))) {
      throw new RequestValidationError('İmza şablonu 1-4 veya 1-w ile 4-w arasında olmalıdır.');
    }
    if (data.titleId !== null && data.titleId !== undefined) {
      const titleId = Number(data.titleId);
      if (!Number.isInteger(titleId) || titleId <= 0) {
        throw new RequestValidationError('İmza ünvanı kimliği geçersiz.');
      }
    }
    if (data.active !== undefined && typeof data.active !== 'boolean') {
      throw new RequestValidationError('İmza ünvanı durumu geçersiz.');
    }
  }

  if (data.action === 'bulkAddHardware') {
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new RequestValidationError('İçe aktarılacak donanım kayıtları bulunamadı.');
    }
    if (data.items.some((item) => !isPlainObject(item))) {
      throw new RequestValidationError('Donanım içe aktarma listesinde geçersiz bir kayıt var.');
    }
  }

  if (data.action === 'lookupPersonnelByNationalId') {
    if (typeof data.nationalId !== 'string' || !/^\d{11}$/.test(data.nationalId)) {
      throw new RequestValidationError('T.C. kimlik numarası 11 haneli olmalıdır.');
    }
  }

  if (data.action === 'bulkInitialAssignment') {
    if (
      data.source !== undefined &&
      !['excel', 'device-profile'].includes(data.source)
    ) {
      throw new RequestValidationError('İlk migrasyon zimmeti kaynağı geçersiz.');
    }
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 5000) {
      throw new RequestValidationError(
        'İlk migrasyon zimmeti 1-5000 kayıt içeren bir liste olmalıdır.'
      );
    }
    for (const item of data.items) {
      if (
        !isPlainObject(item) ||
        typeof item.serial !== 'string' ||
        item.serial.trim().length === 0 ||
        item.serial.length > 161 ||
        typeof item.personEmail !== 'string' ||
        item.personEmail.trim().length === 0 ||
        item.personEmail.length > 320
      ) {
        throw new RequestValidationError(
          'İlk migrasyon zimmet listesinde geçersiz seri no veya personel e-posta alanı var.'
        );
      }
      if (
        item.rowNumber !== undefined &&
        (!Number.isInteger(Number(item.rowNumber)) || Number(item.rowNumber) < 2)
      ) {
        throw new RequestValidationError('İlk migrasyon zimmet listesinde satır numarası geçersiz.');
      }
      if (item.driveLink !== undefined && typeof item.driveLink !== 'string') {
        throw new RequestValidationError('İlk migrasyon zimmet listesinde Drive linki geçersiz.');
      }
      if (typeof item.driveLink === 'string' && item.driveLink.trim()) {
        if (item.driveLink.length > 2048) {
          throw new RequestValidationError('Drive linki en fazla 2048 karakter olabilir.');
        }
        let driveUrl;
        try {
          driveUrl = new URL(item.driveLink.trim());
        } catch {
          throw new RequestValidationError('Drive linki geçerli bir HTTPS adresi olmalıdır.');
        }
        if (
          driveUrl.protocol !== 'https:' ||
          !['drive.google.com', 'docs.google.com'].includes(driveUrl.hostname.toLowerCase())
        ) {
          throw new RequestValidationError('Yalnızca Google Drive veya Google Docs bağlantısı kullanılabilir.');
        }
      }
    }
    if (data.confirmMigration !== true) {
      throw new RequestValidationError('İlk migrasyon işlemi açıkça onaylanmalıdır.');
    }
  }

  if (data.action === 'dismissQueueNotifications') {
    const allowedKinds = new Set(['operation', 'ad-password', 'signature']);
    if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 100) {
      throw new RequestValidationError(
        'Gizlenecek kuyruk bildirimleri 1-100 kayıt içeren bir liste olmalıdır.'
      );
    }
    for (const item of data.items) {
      if (
        !isPlainObject(item) ||
        !allowedKinds.has(item.kind) ||
        typeof item.queueId !== 'string' ||
        !item.queueId.trim() ||
        item.queueId.length > 80
      ) {
        throw new RequestValidationError('Gizlenecek kuyruk bildirimlerinden biri geçersiz.');
      }
    }
  }

  if (
    (data.action === 'manualAssign' || data.action === 'uploadMissingDocument') &&
    typeof data.pdfData !== 'string'
  ) {
    throw new RequestValidationError('Yüklenecek dosya verisi bulunamadı.');
  }
}

function assertSafeJsonTree(data, action) {
  const stack = [{ value: data, path: [], depth: 0 }];
  let visitedNodes = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    visitedNodes += 1;
    if (visitedNodes > MAX_JSON_NODES) {
      throw new RequestValidationError('İstek yapısı izin verilen karmaşıklığı aşıyor.');
    }
    if (current.depth > MAX_JSON_DEPTH) {
      throw new RequestValidationError('İstek yapısı çok fazla iç içe alan içeriyor.');
    }

    const { value, path, depth } = current;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') continue;

    if (typeof value === 'string') {
      if (value.length > maxStringLength(path)) {
        throw new RequestValidationError(`${path.join('.') || 'Metin'} alanı izin verilen boyutu aşıyor.`);
      }
      continue;
    }

    if (Array.isArray(value)) {
      const limit = maxArrayLength(action, path);
      if (value.length > limit) {
        throw new RequestValidationError(`${path.join('.') || 'Liste'} alanı en fazla ${limit} kayıt içerebilir.`);
      }
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: [...path, String(index)], depth: depth + 1 });
      }
      continue;
    }

    if (!isPlainObject(value)) {
      throw new RequestValidationError(`${path.join('.') || 'İstek'} alanı geçersiz bir veri türü içeriyor.`);
    }

    const entries = Object.entries(value);
    if (entries.length > MAX_OBJECT_KEYS) {
      throw new RequestValidationError(`${path.join('.') || 'İstek'} alanı çok fazla özellik içeriyor.`);
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (FORBIDDEN_KEYS.has(key) || key.length > MAX_FIELD_NAME_LENGTH) {
        throw new RequestValidationError('İstek içinde güvenli olmayan bir alan adı var.');
      }
      stack.push({ value: child, path: [...path, key], depth: depth + 1 });
    }
  }
}

export function isKnownAction(action) {
  return KNOWN_ACTIONS.has(String(action || ''));
}

export function validateActionRequest(data) {
  if (!isPlainObject(data)) {
    throw new RequestValidationError('İstek gövdesi JSON nesnesi olmalıdır.');
  }

  const action = typeof data.action === 'string' ? data.action.trim() : '';
  if (!action || action.length > 80 || !/^[A-Za-z][A-Za-z0-9]*$/.test(action)) {
    throw new RequestValidationError('İşlem türü geçersiz.');
  }
  if (!KNOWN_ACTIONS.has(action)) {
    throw new RequestValidationError('Bu işlem türü desteklenmiyor.');
  }

  data.action = action;
  assertSafeJsonTree(data, action);
  validateActionSpecificShape(data);
  return data;
}
