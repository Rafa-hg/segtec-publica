const ExcelJS = require('exceljs');
const { Jimp } = require('jimp');

// Mapea el TEXTO del encabezado (fila 3) a la clave interna que usa el resto
// del sistema. No importa en qué columna esté físicamente: se busca por título.
// Usamos includes() en mayúsculas sin acentos para tolerar pequeñas variaciones
// (saltos de línea dentro de la celda, "IVA %" vs "IVA", etc).
const HEADER_ALIASES = {
  marca: ['MARCA'],
  codigo: ['CODIGO'],
  desc: ['DESCRIPCION'],
  tec: ['TECNOLOGIA'],
  peso: ['PESO'],
  vel: ['VEL'],
  accion: ['CREMALLERA', 'CADENA', 'TAMANO', 'ACCIONADOR', 'ANCHO'],
  iva: ['IVA'],
  gremio: ['PRECIO GREMIO', 'GREMIO'],
  precio: ['PRECIO PUBLICO', 'PRECIO ML'],
};

// Por hoja, qué claves de HEADER_ALIASES son obligatorias/esperadas (se usa
// solo para loguear si falta alguna; el parser sigue funcionando igual con
// las que sí encuentre).
const SHEET_KEYS = {
  CORREDIZOS: ['marca', 'codigo', 'desc', 'tec', 'peso', 'vel', 'accion', 'iva', 'gremio', 'precio'],
  LEVADIZOS: ['marca', 'codigo', 'desc', 'tec', 'peso', 'vel', 'accion', 'iva', 'gremio', 'precio'],
  PIVOTANTES: ['marca', 'codigo', 'desc', 'tec', 'peso', 'vel', 'accion', 'iva', 'gremio', 'precio'],
  ACCESORIOS: ['marca', 'codigo', 'desc', 'iva', 'gremio', 'precio'],
};

const HEADER_ROW = 3;
const OVERFLOW_THRESHOLD_EMU = 400000;
const IMG_MAX_WIDTH = 220;

const normalizeHeader = (v) => {
  if (v === null || v === undefined) return '';
  return String(v)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
};

/**
 * Recorre la fila de encabezados (HEADER_ROW) de una hoja y arma un mapa
 * { claveInterna -> numeroDeColumna } buscando cada alias dentro del texto
 * de cada celda. Si dos encabezados matchean el mismo alias (p.ej. "GREMIO"
 * podría matchear tanto la columna del producto como una de benchmark), se
 * queda con la PRIMERA coincidencia de izquierda a derecha.
 */
function detectColumns(ws, sheetName) {
  const row = ws.getRow(HEADER_ROW);
  const headerTexts = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    headerTexts.push(normalizeHeader(row.getCell(c).value));
  }

  const cols = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    let found = null;
    for (let c = 0; c < headerTexts.length; c++) {
      const text = headerTexts[c];
      if (!text) continue;
      if (aliases.some((alias) => text.includes(alias))) {
        found = c + 1; // 1-indexado
        // Si el encabezado está combinado (merge) sobre varias columnas
        // (p.ej. "MARCA" en A3:B3), ExcelJS repite el mismo texto en todas
        // las celdas del rango. El dato real del producto vive en la ÚLTIMA
        // columna del combinado (la primera suele quedar vacía, reservada
        // para las franjas de sección "▌ ..."), así que extendemos la
        // detección hasta ahí en vez de quedarnos con la primera columna.
        let lastIdx = c;
        while (lastIdx + 1 < headerTexts.length && headerTexts[lastIdx + 1] === text) {
          lastIdx++;
        }
        found = lastIdx + 1; // 1-indexado, última columna del combinado
        break;
      }
    }
    if (found) cols[key] = found;
  }

  // Caso especial de ACCESORIOS: el encabezado "CATEGORÍA" (columna A) no
  // tiene un título propio de "MARCA" para la marca de cada producto — el
  // dato vive en la columna inmediatamente a la derecha del encabezado
  // "CATEGORÍA". Si no encontramos "MARCA" por título, la inferimos así.
  if (!cols.marca) {
    const catCol = headerTexts.findIndex((t) => t.includes('CATEGORIA'));
    if (catCol !== -1) cols.marca = catCol + 2; // +1 (1-indexado) +1 (columna siguiente)
  }

  const expected = SHEET_KEYS[sheetName] || [];
  const missing = expected.filter((k) => !cols[k]);
  if (missing.length) {
    // No tiramos error: seguimos con lo que se pudo detectar, pero queda
    // registrado en stats para que se vea en el panel de admin.
    cols.__missing = missing;
  }
  return cols;
}

// Pares de productos que, por decisión de SEGTEC, comparten la misma foto porque
// uno de los dos no tiene fotografía propia en el archivo (mismo motor/perfil,
// solo cambia el largo). Si en algún archivo futuro alguno de los dos ya viene
// con foto propia, se respeta esa foto propia y no se pisa.
const SHARED_PHOTO_PAIRS = [
  { from: 'P05186', to: 'F05180' },   // Cremallera Gold Industrial -> Domiciliar 1,00 MT
  { from: 'E01100301', to: 'E01100300' }, // BV Home Robust 2,00mts -> 1,50mts
];

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
  const missingColsBySheet = {};

  for (const sheetName of Object.keys(SHEET_KEYS)) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      stats[sheetName] = { error: 'La hoja no existe en el archivo' };
      continue;
    }

    const cols = detectColumns(ws, sheetName);
    if (!cols.codigo) {
      // Sin columna CÓDIGO no hay forma de identificar productos: se aborta
      // esta hoja puntual (las demás hojas se siguen procesando normalmente).
      stats[sheetName] = { error: 'No se encontró la columna "CÓDIGO" en la fila de encabezados (fila 3)' };
      continue;
    }
    if (cols.__missing) missingColsBySheet[sheetName] = cols.__missing;
    const codigoCol = cols.codigo;
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
      for (const [key, colNum] of Object.entries(cols)) {
        if (key === '__missing') continue;
        const cell = row.getCell(colNum);
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
    if (stats[sheetName] && stats[sheetName].error) continue; // hoja que falló antes
    const nProd = items.filter((x) => x.type === 'product').length;
    const nImg = items.filter((x) => x.type === 'product' && x.img).length;
    stats[sheetName] = { productos: nProd, conImagen: nImg };
    if (missingColsBySheet[sheetName] && missingColsBySheet[sheetName].length) {
      stats[sheetName].columnasNoEncontradas = missingColsBySheet[sheetName];
    }
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
