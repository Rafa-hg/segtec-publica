const { parseCatalogXlsx } = require('./_xlsx_parser');

const SHEETS = ['CORREDIZOS', 'LEVADIZOS', 'PIVOTANTES', 'ACCESORIOS'];

function computeDiff(oldCatalog, newCatalog) {
  const diff = {};
  for (const sn of SHEETS) {
    const oldItems = ((oldCatalog && oldCatalog[sn]) || []).filter((x) => x.type === 'product');
    const newItems = (newCatalog[sn] || []).filter((x) => x.type === 'product');
    const oldByCode = new Map(oldItems.map((x) => [x.codigo, x]));
    const newByCode = new Map(newItems.map((x) => [x.codigo, x]));

    const nuevos = [];
    const eliminados = [];
    const precioCambiado = [];
    const fotoAgregada = [];
    const fotoQuitada = [];

    for (const [codigo, item] of newByCode) {
      if (!oldByCode.has(codigo)) {
        nuevos.push({ codigo, desc: item.desc });
      } else {
        const old = oldByCode.get(codigo);
        if (Number(old.precio) !== Number(item.precio)) {
          precioCambiado.push({ codigo, desc: item.desc, antes: old.precio, ahora: item.precio });
        }
        if (!old.img && item.img) fotoAgregada.push({ codigo, desc: item.desc });
        if (old.img && !item.img) fotoQuitada.push({ codigo, desc: item.desc });
      }
    }
    for (const [codigo, item] of oldByCode) {
      if (!newByCode.has(codigo)) eliminados.push({ codigo, desc: item.desc });
    }

    diff[sn] = {
      totalAntes: oldItems.length,
      totalAhora: newItems.length,
      nuevos, eliminados, precioCambiado, fotoAgregada, fotoQuitada,
    };
  }
  return diff;
}

/** Parsea el buffer del xlsx, calcula el diff contra el catálogo actualmente
 * publicado, guarda el resultado en catalog_pending y devuelve todo listo
 * para que el panel admin lo muestre. */
async function processCatalogBuffer(pool, fileBuffer, filename, adminId) {
  const parsed = await parseCatalogXlsx(fileBuffer);

  const currentRes = await pool.query('SELECT data FROM catalog_versions ORDER BY created_at DESC LIMIT 1');
  const currentCatalog = currentRes.rows.length ? currentRes.rows[0].data : null;

  const diff = computeDiff(currentCatalog, parsed.catalog);

  const insertRes = await pool.query(
    `INSERT INTO catalog_pending (data, stats, filename, uploaded_by)
     VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [JSON.stringify(parsed.catalog), JSON.stringify(parsed.stats), filename, adminId]
  );

  return {
    pendingId: insertRes.rows[0].id,
    stats: parsed.stats,
    diff,
    hasCurrentCatalog: !!currentCatalog,
  };
}

module.exports = { computeDiff, processCatalogBuffer };
