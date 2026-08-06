import ExcelJS from 'exceljs';

const HEADER_FILL = 'FF0066B1';
const HEADER_TEXT = 'FFFFFFFF';
const BORDER_COLOR = 'FFD7E0EA';
const STRIPE_FILL = 'FFF5F9FD';

function safeWorksheetName(value) {
  const name = String(value || 'Dışa Aktarım')
    .replace(/[\\/*?:\[\]]/g, '-')
    .trim()
    .slice(0, 31);
  return name || 'Dışa Aktarım';
}

function displayLength(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .reduce((maximum, part) => Math.max(maximum, part.length), 0);
}

export async function createStyledWorkbookBuffer({ sheetName, headers, rows }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'İSTEK Demirbaş Yönetimi';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(safeWorksheetName(sheetName), {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));

  const lastColumn = Math.max(headers.length, 1);
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(rows.length + 1, 1), column: lastColumn }
  };

  const headerRow = worksheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: HEADER_FILL } },
      left: { style: 'thin', color: { argb: HEADER_FILL } },
      bottom: { style: 'thin', color: { argb: HEADER_FILL } },
      right: { style: 'thin', color: { argb: HEADER_FILL } }
    };
  });

  for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 21;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } }
      };
      if (rowNumber % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL } };
      }
    });
  }

  worksheet.columns.forEach((column, index) => {
    let maximum = displayLength(headers[index]);
    for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber += 1) {
      maximum = Math.max(maximum, displayLength(worksheet.getCell(rowNumber, index + 1).value));
    }
    column.width = Math.min(Math.max(maximum + 3, 12), 48);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
