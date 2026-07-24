const ExcelJS = require('exceljs');
const { Jimp } = require('jimp');

const SHEET_CONFIGS = {
  CORREDIZOS: { cols: { marca: 'B', codigo: 'C', desc: 'D', tec: 'E', peso: 'F', vel: 'G', accion: 'H', iva: 'I', precio: 'J' } },
  LEVADIZOS: { cols: { marca: 'B', codigo: 'C', desc: 'D', tec: 'E', peso: 'F', vel: 'G', accion: 'H', iva: 'I', precio: 'J' } },
  PIVOTANTES: { cols: { marca: 'B', codigo: 'C', desc: 'D', tec: 'E', peso: 'F', vel: 'G', accion: 'H', iva: 'I', precio: 'J' } },
  ACCESORIOS: { cols: { marca: 'B', codigo: 'C', desc: 'D', iva: 'E', precio: 'F' } },
};

const OVERFLOW_THRESHOLD_EMU = 400000;
const IMG_MAX_WIDTH = 220;

// Pares de productos que, por decisión de SEGTEC, comparten la misma foto porque
// uno de los dos no tiene fotografía propia en el archivo (mismo motor/perfil,
// solo cambia el largo). Si en algún archivo futuro alguno de los dos ya viene
// con foto propia, se respeta esa foto propia y no se pisa.
const SHARED_PHOTO_PAIRS = [
  { from: 'P05186', to: 'F05180' },   // Cremallera Gold Industrial -> Domiciliar 1,00 MT
  { from: 'E01100301', to: 'E01100300' }, // BV Home Robust 2,00mts -> 1,50mts
];

const COL_LETTER_TO_NUM = (letter) => letter.charCodeAt(0) - 64; // A=1, B=2...

async function resizeImageToBase64(buffer) {
  try {
    const img = await Jimp.read(buffer);
    if (img.width > IMG_MAX_WIDTH) {
      img.resize({ w: IMG_MAX_WIDTH });
    }
    const b64 = await img.getBase64('image/png');
    return b64.replace(/^data:image\/png;base64,/, '');
  } catch (e) {
    return null; // imagen corrupta o formato no soportado: se omite, no se rompe todo el proceso
  }
}

function buildImageMap(ws, productRowsSet, mediaList) {
  const byRow = new Map();
  ws.getImages().forEach((imgRef) => {
    const row = imgRef.range.tl.nativeRow + 1; // 1-indexado, igual que openpyxl
    const rowOff = imgRef.range.tl.nativeRowOff;
    const media = mediaList[imgRef.imageId];
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push({ rowOff, buffer: media.buffer });
  });

  const normal = new Map();
  const overflow = []; // [filaOrigen, buffer], en orden

  [...byRow.keys()].sort((a, b) => a - b).forEach((row) => {
    const items = byRow.get(row).sort((a, b) => a.rowOff - b.rowOff);
    normal.set(row, items[0].buffer);
    items.slice(1).forEach((it) => {
      if (it.rowOff > OVERFLOW_THRESHOLD_EMU) overflow.push([row, it.buffer]);
    });
  });

  const result = new Map();
  let oi = 0;
  const sortedProductRows = [...productRowsSet].sort((a, b) => a - b);
  sortedProductRows.forEach((pr) => {
    if (normal.has(pr)) {
      result.set(pr, normal.get(pr));
    } else if (oi < overflow.length && overflow[oi][0] <= pr) {
      result.set(pr, overflow[oi][1]);
      oi++;
    }
  });
  return result;
}

/**
 * Parsea un archivo xlsx (Buffer) con el mismo formato que "Lista de Difusión SEGTEC"
 * y devuelve el catálogo en el mismo formato que ya usa /api/catalog.
 */
async function parseCatalogXlsx(fileBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fileBuffer);

  const result = {};
  const stats = {};

  for (const [sheetName, cfg] of Object.entries(SHEET_CONFIGS)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      stats[sheetName] = { error: 'La hoja no existe en el archivo' };
      continue;
    }

    const codigoCol = COL_LETTER_TO_NUM(cfg.cols.codigo);
    const isSectionRow = (row) => {
      const aVal = row.getCell(1).value;
      const bVal = row.getCell(2).value;
      const text = [aVal, bVal].find((v) => typeof v === 'string' && v.includes('▌'));
      return text || null;
    };

    const productRows = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row.hidden) continue;
      if (isSectionRow(row)) continue;
      const codeVal = row.getCell(codigoCol).value;
      if (codeVal && codeVal !== 'CÓDIGO') productRows.push(r);
    }

    const imgMap = buildImageMap(ws, new Set(productRows), wb.model.media);

    const rowsOut = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (row.hidden) continue;
      const sectionText = isSectionRow(row);
      if (sectionText) {
        rowsOut.push({ type: 'section', label: sectionText.replace(/▌/g, '').trim() });
        continue;
      }
      const codeVal = row.getCell(codigoCol).value;
      if (codeVal === 'CÓDIGO') continue;
      if (codeVal === null || codeVal === undefined) continue;
      const item = { type: 'product' };
      for (const [key, colLetter] of Object.entries(cfg.cols)) {
        const cell = row.getCell(COL_LETTER_TO_NUM(colLetter));
        item[key] = cell.value === null || cell.value === undefined ? null : cell.value;
      }
      if (imgMap.has(r)) {
        const b64 = await resizeImageToBase64(imgMap.get(r));
        if (b64) item.img = b64;
      }
      rowsOut.push(item);
    }

    if (sheetName === 'ACCESORIOS') {
      for (const item of rowsOut) {
        if (item.type === 'section' && item.label.toUpperCase().startsWith('FOTOCÉLULAS')) {
          item.label = 'FOTOCÉLULA';
        }
      }
    }

    result[sheetName] = rowsOut;
  }

  applySharedPhotoOverrides(result);

  for (const [sheetName, items] of Object.entries(result)) {
    const nProd = items.filter((x) => x.type === 'product').length;
    const nImg = items.filter((x) => x.type === 'product' && x.img).length;
    stats[sheetName] = { productos: nProd, conImagen: nImg };
  }

  return { catalog: result, stats };
}

function applySharedPhotoOverrides(catalog) {
  const byCode = new Map();
  for (const items of Object.values(catalog)) {
    for (const it of items) {
      if (it.type === 'product' && it.codigo) byCode.set(it.codigo, it);
    }
  }
  for (const { from, to } of SHARED_PHOTO_PAIRS) {
    const source = byCode.get(from);
    const target = byCode.get(to);
    if (source && source.img && target) {
      target.img = source.img;
    }
  }
}

module.exports = { parseCatalogXlsx };
