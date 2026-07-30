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
  ];

  for (const request of requests) {
    assert.equal(validateActionRequest({ ...request }).action, request.action);
  }
});
