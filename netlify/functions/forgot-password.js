const { getPool } = require('./_db');
const { generateToken, json } = require('./_auth');
const { sendPasswordResetEmail } = require('./_email');

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

  const email = (body.email || '').trim().toLowerCase();
  if (!email) return json(400, { error: 'Falta el email' });

  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, name, email FROM public_users WHERE email = $1 AND status = $2',
    [email, 'approved']
  );

  // Respuesta siempre igual, exista o no la cuenta: evita que alguien pueda
  // usar este formulario para descubrir qué emails están registrados.
  const genericResponse = { ok: true, message: 'Si el email está registrado y aprobado, te enviamos un link para restablecer tu contraseña.' };

  if (!rows.length) return json(200, genericResponse);

  const user = rows[0];
  const token = generateToken();
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, now() + interval '1 hour')`,
    [user.id, token]
  );
  await sendPasswordResetEmail(user, token);

  return json(200, genericResponse);
};
