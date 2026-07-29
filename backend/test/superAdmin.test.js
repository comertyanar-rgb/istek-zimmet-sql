import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSuperAdminEmail,
  parseSuperAdminEmails,
  requireSuperAdmin
} from '../src/superAdmin.js';

test('süper yönetici e-posta listesini normalize eder ve tekrarları kaldırır', () => {
  assert.deepEqual(
    parseSuperAdminEmails(' Admin@istek.k12.tr,admin@istek.k12.tr, ikinci@istek.k12.tr '),
    ['admin@istek.k12.tr', 'ikinci@istek.k12.tr']
  );
});

test('süper yönetici karşılaştırmasını büyük küçük harften bağımsız yapar', () => {
  assert.equal(
    isSuperAdminEmail('ADMIN@istek.k12.tr', ['admin@istek.k12.tr']),
    true
  );
  assert.equal(isSuperAdminEmail('yetkisiz@istek.k12.tr', ['admin@istek.k12.tr']), false);
});

test('izin listesinde olmayan kullanıcıyı 403 ile reddeder', () => {
  assert.throws(
    () => requireSuperAdmin({ email: 'yetkisiz@istek.k12.tr' }, ['admin@istek.k12.tr']),
    (error) => error.statusCode === 403 && error.code === 'SUPER_ADMIN_REQUIRED'
  );
});

