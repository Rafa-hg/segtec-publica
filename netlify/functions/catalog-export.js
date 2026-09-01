const ExcelJS = require('exceljs');
const { getPool } = require('./_db');
const { readSession } = require('./_auth');
const BUNDLED_CATALOG = require('./catalog_data.json'); // mismo respaldo que usa catalog.js

const SHEETS = ['CORREDIZOS', 'LEVADIZOS', 'PIVOTANTES', 'ACCESORIOS'];

// Columnas visibles en la exportación, por hoja. "key" es el campo del catálogo
// ya parseado (ver _xlsx_parser.js), "label" es lo que se ve en el Excel.
const COLUMNS_BY_SHEET = {
  CORREDIZOS: [
    { key: 'marca', label: 'Marca' }, { key: 'codigo', label: 'Código' }, { key: 'desc', label: 'Descripción / Modelo' },
    { key: 'tec', label: 'Tecnología' }, { key: 'peso', label: 'Peso máx (Kg)' }, { key: 'vel', label: 'Vel. (seg)' },
    { key: 'accion', label: 'Cremallera / Cadena' }, { key: 'iva', label: 'IVA %' },
    { key: 'gremio', label: 'Precio gremio' }, { key: 'precio', label: 'Precio público' },
  ],
  LEVADIZOS: [
    { key: 'marca', label: 'Marca' }, { key: 'codigo', label: 'Código' }, { key: 'desc', label: 'Descripción / Modelo' },
    { key: 'tec', label: 'Tecnología' }, { key: 'peso', label: 'Peso máx (Kg)' }, { key: 'vel', label: 'Vel. (seg)' },
    { key: 'accion', label: 'Tamaño accionador' }, { key: 'iva', label: 'IVA %' },
    { key: 'gremio', label: 'Precio gremio' }, { key: 'precio', label: 'Precio público' },
  ],
  PIVOTANTES: [
    { key: 'marca', label: 'Marca' }, { key: 'codigo', label: 'Código' }, { key: 'desc', label: 'Descripción / Modelo' },
    { key: 'tec', label: 'Tecnología' }, { key: 'peso', label: 'Peso máx (Kg)' }, { key: 'vel', label: 'Vel. (seg)' },
    { key: 'accion', label: 'Ancho máx por hoja' }, { key: 'iva', label: 'IVA %' },
    { key: 'gremio', label: 'Precio gremio' }, { key: 'precio', label: 'Precio público' },
  ],
  ACCESORIOS: [
    { key: 'marca', label: 'Marca' }, { key: 'codigo', label: 'Código' }, { key: 'desc', label: 'Descripción' },
    { key: 'iva', label: 'IVA %' }, { key: 'gremio', label: 'Precio gremio' }, { key: 'precio', label: 'Precio público' },
  ],
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const session = readSession(event);
  if (!session || (session.role !== 'public' && session.role !== 'admin')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'No autenticado' }) };
  }

  const pool = getPool();
  const { rows } = await pool.query('SELECT data FROM catalog_versions ORDER BY created_at DESC LIMIT 1');
  const catalog = rows.length ? rows[0].data : BUNDLED_CATALOG;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'SEGTEC';
  wb.created = new Date();

  for (const sheetName of SHEETS) {
    const items = catalog[sheetName] || [];
    const cols = COLUMNS_BY_SHEET[sheetName];
    const ws = wb.addWorksheet(sheetName);

    ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: c.key === 'desc' ? 45 : 16 }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const item of items) {
      if (item.type === 'section') {
        const row = ws.addRow({ [cols[0].key]: item.label });
        ws.mergeCells(row.number, 1, row.number, cols.length);
        row.font = { bold: true };
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECF7' } };
        continue;
      }
      if (item.type !== 'product') continue;
      const rowData = {};
      for (const c of cols) {
        let v = item[c.key];
        if ((c.key === 'gremio' || c.key === 'precio') && typeof v === 'number') v = Math.round(v);
        if (c.key === 'iva' && typeof v === 'number') v = v; // se deja como número (0.1 = 10%), formateado abajo
        rowData[c.key] = v === undefined ? null : v;
      }
      const row = ws.addRow(rowData);
      cols.forEach((c, idx) => {
        if (c.key === 'gremio' || c.key === 'precio') row.getCell(idx + 1).numFmt = '#,##0';
        if (c.key === 'iva') row.getCell(idx + 1).numFmt = '0%';
      });
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `SEGTEC_Lista_Precios_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
    body: Buffer.from(buffer).toString('base64'),
  };
};
