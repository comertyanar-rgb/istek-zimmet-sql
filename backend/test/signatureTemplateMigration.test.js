import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const freshInstallUrl = new URL('../sql/018_signature_title_admin.sql', import.meta.url);
const upgradeUrl = new URL('../sql/020_signature_wide_templates.sql', import.meta.url);

async function assertWideTemplateSupport(url) {
  const migration = await readFile(url, 'utf8');

  assert.match(migration, /CREATE OR ALTER PROCEDURE dbo\.AdminSaveSignatureTitle/);
  for (const templateKey of ['1-w', '2-w', '3-w', '4-w']) {
    assert.match(migration, new RegExp(`N'${templateKey}'`));
  }
  assert.match(migration, /GRANT EXECUTE ON OBJECT::dbo\.AdminSaveSignatureTitle TO zimmet_api/);
}

test('temiz kurulum imza prosedürü uzun ad şablonlarını kabul eder', async () => {
  await assertWideTemplateSupport(freshInstallUrl);
});

test('mevcut kurulum migrationı uzun ad şablonlarını kabul eder', async () => {
  await assertWideTemplateSupport(upgradeUrl);
});
