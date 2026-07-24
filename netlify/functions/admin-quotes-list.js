const { getPool } = require('./_db');
const { requireRole, json } = require('./_auth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Método no permitido' });
  }

  const session = requireRole(event, 'admin');
  if (!session) {
    return json(401, { error: 'No autenticado' });
  }

  const pool = getPool();

  const params = event.queryStringParameters || {};
  if (params.id) {
    const { rows } = await pool.query(
      `SELECT q.*, u.name AS user_name, u.email AS user_email
       FROM quote_requests q LEFT JOIN public_users u ON u.id = q.user_id
       WHERE q.id = $1`,
      [Number(params.id)]
    );
    if (!rows.length) return json(404, { error: 'No encontrado' });
    return json(200, { quote: rows[0] });
  }

  const { rows } = await pool.query(
    `SELECT q.id, q.nombre, q.telefono, q.email, q.comentario, q.items_json, q.created_at,
            u.name AS user_name, u.email AS user_email
     FROM quote_requests q LEFT JOIN public_users u ON u.id = q.user_id
     ORDER BY q.created_at DESC
     LIMIT 500`
  );

  return json(200, { quotes: rows });
};
