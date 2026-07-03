import React from 'react';
import { Printer, X, QrCode } from 'lucide-react';

const QR_VERSION_INFO = [
  null,
  { size: 21, dataCodewords: 19, eccCodewords: 7, align: [] },
  { size: 25, dataCodewords: 34, eccCodewords: 10, align: [6, 18] },
  { size: 29, dataCodewords: 55, eccCodewords: 15, align: [6, 22] },
  { size: 33, dataCodewords: 80, eccCodewords: 20, align: [6, 26] },
  { size: 37, dataCodewords: 108, eccCodewords: 26, align: [6, 30] },
];

const QR_GF = (() => {
  const exp = new Array(512);
  const log = new Array(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) exp[i] = exp[i - 255];
  return { exp, log };
})();

const qrGfMul = (a, b) => {
  if (a === 0 || b === 0) return 0;
  return QR_GF.exp[QR_GF.log[a] + QR_GF.log[b]];
};

const qrGeneratorPoly = (degree) => {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= qrGfMul(poly[j], QR_GF.exp[i]);
    }
    poly = next;
  }
  return poly;
};

const qrReedSolomonRemainder = (data, eccCodewords) => {
  const generator = qrGeneratorPoly(eccCodewords);
  const result = new Array(eccCodewords).fill(0);

  data.forEach((byte) => {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < eccCodewords; i += 1) {
      result[i] ^= qrGfMul(generator[i + 1], factor);
    }
  });

  return result;
};

const qrAppendBits = (bits, value, length) => {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
};

const qrChooseVersion = (byteLength) => {
  for (let version = 1; version < QR_VERSION_INFO.length; version += 1) {
    if (4 + 8 + byteLength * 8 <= QR_VERSION_INFO[version].dataCodewords * 8) return version;
  }
  throw new Error('QR verisi fazla uzun.');
};

const qrFormatBits = (mask) => {
  const eclBits = 1;
  let data = (eclBits << 3) | mask;
  let bits = data << 10;
  const generator = 0x537;
  for (let i = 14; i >= 10; i -= 1) {
    if (((bits >>> i) & 1) !== 0) bits ^= generator << (i - 10);
  }
  return ((data << 10) | (bits & 0x3ff)) ^ 0x5412;
};

const qrMask = (mask, x, y) => {
  if (mask === 0) return (x + y) % 2 === 0;
  return false;
};

const createQrMatrix = (text) => {
  const bytes = Array.from(new TextEncoder().encode(String(text || '')));
  const version = qrChooseVersion(bytes.length);
  const info = QR_VERSION_INFO[version];
  const size = info.size;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setModule = (x, y, dark, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = Boolean(dark);
    if (reserve) reserved[y][x] = true;
  };

  const drawFinder = (x, y) => {
    for (let dy = -1; dy <= 7; dy += 1) {
      for (let dx = -1; dx <= 7; dx += 1) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const dark =
          dx >= 0 &&
          dx <= 6 &&
          dy >= 0 &&
          dy <= 6 &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setModule(xx, yy, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  for (let i = 8; i < size - 8; i += 1) {
    setModule(i, 6, i % 2 === 0);
    setModule(6, i, i % 2 === 0);
  }

  info.align.forEach((x) => {
    info.align.forEach((y) => {
      if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6)) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          setModule(x + dx, y + dy, dark);
        }
      }
    });
  });

  setModule(8, 4 * version + 9, true);

  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  const bits = [];
  qrAppendBits(bits, 0x4, 4);
  qrAppendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => qrAppendBits(bits, byte, 8));

  const capacityBits = info.dataCodewords * 8;
  qrAppendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }
  for (let pad = 0; dataCodewords.length < info.dataCodewords; pad += 1) {
    dataCodewords.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  const ecc = qrReedSolomonRemainder(dataCodewords, info.eccCodewords);
  const finalBits = [];
  [...dataCodewords, ...ecc].forEach((byte) => qrAppendBits(finalBits, byte, 8));

  const mask = 0;
  let bitIndex = 0;
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x -= 1;
    for (let yStep = 0; yStep < size; yStep += 1) {
      const y = upward ? size - 1 - yStep : yStep;
      for (let dx = 0; dx < 2; dx += 1) {
        const xx = x - dx;
        if (reserved[y][xx]) continue;
        const bit = bitIndex < finalBits.length ? finalBits[bitIndex] === 1 : false;
        bitIndex += 1;
        setModule(xx, y, bit !== qrMask(mask, xx, y), false);
      }
    }
    upward = !upward;
  }

  const format = qrFormatBits(mask);
  for (let i = 0; i <= 5; i += 1) setModule(8, i, ((format >>> i) & 1) !== 0);
  setModule(8, 7, ((format >>> 6) & 1) !== 0);
  setModule(8, 8, ((format >>> 7) & 1) !== 0);
  setModule(7, 8, ((format >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i += 1) setModule(14 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i += 1) setModule(size - 1 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i += 1) setModule(8, size - 15 + i, ((format >>> i) & 1) !== 0);

  return modules;
};

const qrMatrixPath = (matrix) => {
  let path = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run += 1;
      path += `M${x} ${y}h${run}v1H${x}z`;
      x += run;
    }
  });
  return path;
};

function QrLabelSvg({ value, className = '' }) {
  try {
    const matrix = createQrMatrix(value);
    const size = matrix.length;
    return (
      <svg className={className} viewBox={`-4 -4 ${size + 8} ${size + 8}`} role="img" aria-label="Cihaz QR">
        <rect x="-4" y="-4" width={size + 8} height={size + 8} fill="#fff" />
        <path d={qrMatrixPath(matrix)} fill="#000" />
      </svg>
    );
  } catch (error) {
    return (
      <div className={`${className} flex items-center justify-center bg-red-50 text-red-600 text-[8px] font-bold text-center`}>
        QR üretilemedi
      </div>
    );
  }
}

function QrLabelCard({ item, payload }) {
  return (
    <div className="qr-label-card bg-white border border-gray-300 rounded-lg shadow-sm p-3 flex items-center gap-3 min-h-[96px]">
      <QrLabelSvg value={payload} className="w-[72px] h-[72px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black text-[#0066b1] tracking-wider uppercase">
          İSTEK Demirbaş
        </div>
        <div className="text-[13px] font-black text-gray-900 leading-tight truncate">
          {item.deviceName || item.glpiComputerName || item.serial}
        </div>
        <div className="text-[11px] font-bold text-gray-700 truncate">
          S/N: {item.serial || item.id}
        </div>
        <div className="text-[10px] text-gray-500 truncate">
          {[item.type, item.campus].filter(Boolean).join(' · ')}
        </div>
        <div className="text-[8px] text-gray-400 mt-1 truncate">
          {payload}
        </div>
      </div>
    </div>
  );
}

export function QrLabelModal({ items, getPayload, onClose }) {
  if (!items || items.length === 0) return null;
  const firstItem = items[0];
  const firstPayload = getPayload(firstItem);
  const isSingle = items.length === 1;

  return (
    <div
      className="fixed inset-0 z-[9999999] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-3 md:p-6 print:block print:bg-white print:p-0"
      onClick={onClose}
    >
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #qr-label-print-area, #qr-label-print-area * { visibility: visible !important; }
          #qr-label-print-area {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            max-width: none !important;
            height: auto !important;
            overflow: visible !important;
            background: #fff !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
          }
          @page { size: A4; margin: 8mm; }
          .qr-print-toolbar { display: none !important; }
          .qr-label-preview { display: none !important; }
          .qr-label-sheet {
            display: grid !important;
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 4mm !important;
          }
          .qr-label-card {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            border: 1px solid #111 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div
        id="qr-label-print-area"
        className="bg-white rounded-3xl shadow-2xl border border-gray-200 w-full max-w-md md:max-w-3xl max-h-[92vh] overflow-hidden flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="qr-print-toolbar p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#0066b1] flex items-center justify-center shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-gray-900 truncate">QR Etiket</h2>
              <p className="text-xs text-gray-500 font-semibold truncate">
                {items.length} cihaz hazır. QR sadece seri noyu taşır.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full border border-gray-200 bg-white text-gray-400 hover:text-gray-700 hover:bg-gray-50 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 md:p-5 overflow-y-auto">
          {isSingle ? (
            <div className="qr-label-preview flex flex-col items-center text-center">
              <div className="w-56 h-56 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                <QrLabelSvg value={firstPayload} className="w-full h-full" />
              </div>
              <div className="mt-4 max-w-full">
                <p className="text-xs font-black text-[#0066b1] uppercase tracking-wider">İSTEK Demirbaş</p>
                <h3 className="text-lg font-black text-gray-900 truncate">
                  {firstItem.deviceName || firstItem.glpiComputerName || firstItem.serial}
                </h3>
                <p className="text-sm font-bold text-gray-600 truncate">S/N: {firstItem.serial || firstItem.id}</p>
                <p className="text-xs text-gray-400 truncate">{firstPayload}</p>
              </div>
            </div>
          ) : null}

          <div className={`qr-label-sheet ${isSingle ? 'hidden print:grid' : 'grid'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`}>
            {items.map((item) => (
              <QrLabelCard key={`${item.id}-${item.serial}`} item={item} payload={getPayload(item)} />
            ))}
          </div>
        </div>

        <div className="qr-print-toolbar p-4 border-t border-gray-100 flex items-center gap-2 bg-slate-50">
          <button
            onClick={() => window.print()}
            className="flex-1 h-11 px-4 rounded-xl bg-[#0066b1] text-white hover:bg-[#005595] font-bold text-sm flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Yazdır
          </button>
          <button
            onClick={onClose}
            className="h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold text-sm"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
