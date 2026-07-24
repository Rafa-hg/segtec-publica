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

  const id = Number(body.id);
  const action = body.action; // 'approve' | 'reject'

  if (!id || !['approve', 'reject'].includes(action)) {
    return json(400, { error: 'Faltan datos válidos (id, action)' });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE public_users SET status = $1, reviewed_at = now()
     WHERE id = $2 RETURNING id, name, email, status`,
    [newStatus, id]
  );

  if (!rows.length) {
    return json(404, { error: 'Solicitud no encontrada' });
  }

  // Nota: a propósito NO se envía ningún email al usuario cuando se lo rechaza.
  // Si se aprueba, tampoco se envía aviso automático (se definió así deliberadamente);
  // el usuario puede intentar loguearse y ya tendrá acceso.

  return json(200, { ok: true, registration: rows[0] });
};
