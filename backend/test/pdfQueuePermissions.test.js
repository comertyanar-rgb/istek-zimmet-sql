import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerUrl = new URL('../src/pdfQueueWorker.js', import.meta.url);
const migrationUrl = new URL('../sql/019_finalize_pdf_history.sql', import.meta.url);

test('PDF işçisi geçmiş tablosunu yalnız dar yetkili prosedürle tamamlar', async () => {
  const worker = await readFile(workerUrl, 'utf8');
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(worker, /EXEC dbo\.FinalizeHardwarePdfHistory/);
  assert.doesNotMatch(worker, /UPDATE\s+dbo\.HardwareHistory/i);
  assert.match(migration, /CREATE OR ALTER PROCEDURE dbo\.FinalizeHardwarePdfHistory/);
  assert.match(migration, /WITH EXECUTE AS OWNER/);
  assert.match(migration, /GRANT EXECUTE ON OBJECT::dbo\.FinalizeHardwarePdfHistory TO zimmet_api/);
});
