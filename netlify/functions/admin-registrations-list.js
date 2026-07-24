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

  const params = event.queryStringParameters || {};
  const status = params.status; // pending | approved | rejected | (vacío = todos)

  const pool = getPool();
  let rows;
  if (status) {
    ({ rows } = await pool.query(
      `SELECT id, name, empresa, email, status, created_at, reviewed_at
       FROM public_users WHERE status = $1 ORDER BY created_at DESC`,
      [status]
    ));
  } else {
    ({ rows } = await pool.query(
      `SELECT id, name, empresa, email, status, created_at, reviewed_at
       FROM public_users ORDER BY created_at DESC`
    ));
  }

  return json(200, { registrations: rows });
};
