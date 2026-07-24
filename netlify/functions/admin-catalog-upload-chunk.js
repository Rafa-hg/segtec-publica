const { getPool } = require('./_db');
const { requireRole, json } = require('./_auth');

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

  const { uploadId, chunkIndex, chunkData, filename } = body;
  if (!uploadId || chunkIndex === undefined || !chunkData) {
    return json(400, { error: 'Faltan datos de la parte subida' });
  }

  const pool = getPool();

  // Limpieza best-effort de subidas abandonadas de más de 1 día
  await pool.query(`DELETE FROM catalog_upload_chunks WHERE created_at < now() - interval '1 day'`);

  await pool.query(
    `INSERT INTO catalog_upload_chunks (upload_id, chunk_index, chunk_data, filename, uploaded_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (upload_id, chunk_index) DO UPDATE SET chunk_data = EXCLUDED.chunk_data`,
    [uploadId, chunkIndex, chunkData, filename || null, session.id]
  );

  return json(200, { ok: true });
};
