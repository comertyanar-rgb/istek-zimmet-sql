import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { createStyledWorkbookBuffer } from '../src/exportWorkbook.js';

test('Excel dışa aktarımı başlığı sabitlenmiş ve filtreli çalışma kitabı üretir', async () => {
  const buffer = await createStyledWorkbookBuffer({
    sheetName: 'Personel Listesi',
    headers: ['Ad Soyad', 'E-Posta'],
    rows: [['Cömert Yanar', 'comert.yanar@istek.k12.tr']]
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  assert.equal(worksheet.getCell('A1').value, 'Ad Soyad');
  assert.equal(worksheet.getCell('A1').font.bold, true);
  assert.equal(worksheet.getCell('A1').fill.fgColor.argb, 'FF0066B1');
  assert.equal(worksheet.views[0].state, 'frozen');
  assert.equal(worksheet.views[0].ySplit, 1);
  assert.equal(worksheet.autoFilter, 'A1:B2');
  assert.ok(worksheet.getColumn(1).width >= 12);
});

test('boş içe aktarma şablonu başlık biçimini ve filtreyi korur', async () => {
  const buffer = await createStyledWorkbookBuffer({
    sheetName: 'Toplu Donanım Şablonu',
    headers: ['Seri No *', 'Marka *', 'Model *'],
    rows: []
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  assert.equal(worksheet.rowCount, 1);
  assert.equal(worksheet.getCell('A1').value, 'Seri No *');
  assert.equal(worksheet.getCell('A1').font.bold, true);
  assert.equal(worksheet.views[0].ySplit, 1);
  assert.equal(worksheet.autoFilter, 'A1:C1');
});
