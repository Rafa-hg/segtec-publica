const { getPool } = require('./_db');
const { readSession, json } = require('./_auth');
const BUNDLED_CATALOG = require('./catalog_data.json'); // respaldo inicial, hasta la primera publicación desde el panel

const VALID_SHEETS = ['CORREDIZOS', 'LEVADIZOS', 'PIVOTANTES', 'ACCESORIOS'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Método no permitido' });
  }

  const session = readSession(event);
  if (!session || (session.role !== 'public' && session.role !== 'admin')) {
    return json(401, { error: 'No autenticado' });
  }

  const sheet = (event.queryStringParameters || {}).sheet;
  if (!sheet || !VALID_SHEETS.includes(sheet)) {
    return json(400, { error: 'Falta indicar una hoja válida (sheet=CORREDIZOS|LEVADIZOS|PIVOTANTES|ACCESORIOS)' });
  }

  const pool = getPool();
  const { rows } = await pool.query('SELECT data FROM catalog_versions ORDER BY created_at DESC LIMIT 1');

  const catalog = rows.length ? rows[0].data : BUNDLED_CATALOG;
  return json(200, catalog[sheet] || []);
};
