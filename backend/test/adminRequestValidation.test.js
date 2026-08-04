import test from 'node:test';
import assert from 'node:assert/strict';
import { validateActionRequest } from '../src/requestValidation.js';

test('süper yönetici aksiyonlarını bilinen ve güvenli istekler olarak kabul eder', () => {
  const requests = [
    { action: 'adminFetchOverview' },
    {
      action: 'adminFetchAuditLogs',
      page: 1,
      pageSize: 25,
      search: 'şifre',
      category: 'PASSWORD',
    },
    {
      action: 'adminSaveAuthorizedUser',
      email: 'it@istek.k12.tr',
      role: 'IT',
      campusId: '4cbda168-d230-4580-8b6c-cf0dbe4a5df5',
      active: true,
    },
    {
      action: 'adminSavePersonnelOverride',
      personId: '123',
      campusId: '4cbda168-d230-4580-8b6c-cf0dbe4a5df5',
      status: 'Aktif',
      reason: 'Kampüs kaydı düzeltildi.',
    },
    { action: 'adminClearPersonnelOverride', personId: '123' },
    {
      action: 'adminSaveSignatureTitle',
      titleId: 12,
      titleTr: 'Bilgi İşlem Uzmanı',
      titleEn: 'IT Specialist',
      templateKey: '2',
      active: true,
    },
  ];

  for (const request of requests) {
    assert.equal(validateActionRequest({ ...request }).action, request.action);
  }
});

test('imza ünvanı yönetim isteğinde geçersiz şablonu reddeder', () => {
  assert.throws(
    () =>
      validateActionRequest({
        action: 'adminSaveSignatureTitle',
        titleTr: 'Bilgi İşlem Uzmanı',
        titleEn: 'IT Specialist',
        templateKey: '7',
        active: true,
      }),
    /şablonu yalnızca 1, 2, 3 veya 4/i
  );
});
