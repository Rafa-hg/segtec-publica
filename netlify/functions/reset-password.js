const { getPool } = require('./_db');
const { hashPassword, json } = require('./_auth');

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
  const password = body.password || '';

  if (!token || !password) return json(400, { error: 'Faltan datos' });
  if (password.length < 8) return json(400, { error: 'La contraseña debe tener al menos 8 caracteres' });

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = $1`,
    [token]
  );
  if (!rows.length) return json(404, { error: 'Link inválido o ya usado' });

  const row = rows[0];
  if (row.used_at) return json(410, { error: 'Este link ya fue usado' });
  if (new Date(row.expires_at) < new Date()) return json(410, { error: 'El link expiró, pedí uno nuevo' });

  const passwordHash = await hashPassword(password);
  await pool.query('UPDATE public_users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
  await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);

  return json(200, { ok: true, message: 'Contraseña actualizada. Ya podés iniciar sesión.' });
};
