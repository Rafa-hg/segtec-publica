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

  const pendingId = Number(body.pendingId);
  if (!pendingId) return json(400, { error: 'Falta pendingId' });

  const pool = getPool();
  const { rows } = await pool.query('SELECT data, stats FROM catalog_pending WHERE id = $1', [pendingId]);
  if (!rows.length) return json(404, { error: 'No se encontró ese catálogo pendiente. Volvé a subir el archivo.' });

  const { data, stats } = rows[0];

  await pool.query(
    `INSERT INTO catalog_versions (data, stats, published_by) VALUES ($1, $2, $3)`,
    [JSON.stringify(data), JSON.stringify(stats), session.id]
  );
  await pool.query('DELETE FROM catalog_pending WHERE id = $1', [pendingId]);

  return json(200, { ok: true, message: 'Catálogo publicado.' });
};
