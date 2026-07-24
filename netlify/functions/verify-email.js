const { getPool } = require('./_db');
const { json } = require('./_auth');
const { notifyAdminNewRegistration } = require('./_email');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Cuerpo inválido' });
  }

  const token = (body.token || '').trim();
  if (!token) return json(400, { error: 'Falta el token' });

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT t.id AS token_id, t.user_id, t.expires_at, t.used_at, u.name, u.email, u.empresa, u.whatsapp, u.status
     FROM email_verification_tokens t
     JOIN public_users u ON u.id = t.user_id
     WHERE t.token = $1`,
    [token]
  );

  if (!rows.length) return json(404, { error: 'Link inválido o ya usado' });
  const row = rows[0];

  if (row.used_at) return json(200, { ok: true, message: 'Este email ya estaba confirmado.' });
  if (new Date(row.expires_at) < new Date()) return json(410, { error: 'El link expiró. Registrate de nuevo.' });

  await pool.query('UPDATE email_verification_tokens SET used_at = now() WHERE id = $1', [row.token_id]);
  await pool.query('UPDATE public_users SET email_verified = true WHERE id = $1', [row.user_id]);

  await notifyAdminNewRegistration({ name: row.name, email: row.email, empresa: row.empresa, whatsapp: row.whatsapp });

  return json(200, { ok: true, message: 'Email confirmado. Tu solicitud quedó pendiente de aprobación.' });
};
