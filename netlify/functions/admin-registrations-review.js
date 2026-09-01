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
  // 'approve' | 'reject' revisan una solicitud pendiente.
  // 'block' / 'unblock' se usan sobre usuarios ya aprobados para cortarles
  // el acceso sin borrar su cuenta ni su historial de presupuestos.
  // 'delete' borra la cuenta definitivamente (solo si no tiene presupuestos
  // asociados; si los tiene, se sugiere bloquear en su lugar).
  const action = body.action;

  if (!id || !['approve', 'reject', 'block', 'unblock', 'delete'].includes(action)) {
    return json(400, { error: 'Faltan datos válidos (id, action)' });
  }

  const pool = getPool();

  if (action === 'delete') {
    try {
      const { rows } = await pool.query(
        'DELETE FROM public_users WHERE id = $1 RETURNING id, name, email',
        [id]
      );
      if (!rows.length) return json(404, { error: 'Usuario no encontrado' });
      return json(200, { ok: true, deleted: rows[0] });
    } catch (e) {
      // 23503 = violación de foreign key (el usuario tiene presupuestos u otros registros asociados)
      if (e.code === '23503') {
        return json(409, {
          error: 'Este usuario tiene presupuestos u otros registros asociados y no se puede eliminar. Podés bloquearlo en su lugar.',
        });
      }
      throw e;
    }
  }

  const newStatus = { approve: 'approved', reject: 'rejected', block: 'blocked', unblock: 'approved' }[action];

  const { rows } = await pool.query(
    `UPDATE public_users SET status = $1, reviewed_at = now()
     WHERE id = $2 RETURNING id, name, email, status`,
    [newStatus, id]
  );

  if (!rows.length) {
    return json(404, { error: 'Solicitud no encontrada' });
  }

  // Nota: a propósito NO se envía ningún email al usuario en ninguno de estos
  // casos (rechazo, bloqueo, desbloqueo). El usuario se entera al intentar
  // loguearse, con el mensaje correspondiente.

  return json(200, { ok: true, registration: rows[0] });
};
