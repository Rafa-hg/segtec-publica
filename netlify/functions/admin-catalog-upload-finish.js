const { getPool } = require('./_db');
const { requireRole, json } = require('./_auth');
const { processCatalogBuffer } = require('./_catalog_process');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido' });
  }

  const session = requireRole(event, 'admin');
  if (!session) {
    return json(401, { error: 'No autenticado' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Cuerpo inválido' });
  }

  const uploadId = body.uploadId;
  const filename = body.filename || 'catalogo.xlsx';
  if (!uploadId) return json(400, { error: 'Falta uploadId' });

  const pool = getPool();

  const { rows } = await pool.query(
    `SELECT chunk_index, chunk_data FROM catalog_upload_chunks
     WHERE upload_id = $1 ORDER BY chunk_index ASC`,
    [uploadId]
  );

  if (!rows.length) {
    return json(404, { error: 'No se encontraron las partes de ese archivo. Subilo de nuevo.' });
  }

  // Verificar que no falte ninguna parte en el medio (0,1,2,3... sin huecos)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].chunk_index !== i) {
      return json(400, { error: 'Faltan partes del archivo (llegaron incompletas). Subilo de nuevo.' });
    }
  }

  const fullBase64 = rows.map((r) => r.chunk_data).join('');
  let fileBuffer;
  try {
    fileBuffer = Buffer.from(fullBase64, 'base64');
  } catch (e) {
    return json(400, { error: 'Archivo inválido' });
  }

  let result;
  try {
    result = await processCatalogBuffer(pool, fileBuffer, filename, session.id);
  } catch (e) {
    return json(400, {
      error: 'No se pudo leer el archivo. ¿Es un .xlsx con las hojas CORREDIZOS/LEVADIZOS/PIVOTANTES/ACCESORIOS?',
      detail: e.message,
    });
  }

  await pool.query('DELETE FROM catalog_upload_chunks WHERE upload_id = $1', [uploadId]);

  return json(200, { ok: true, ...result });
};
