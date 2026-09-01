const { getPool } = require('./_db');
const { generateToken, json } = require('./_auth');
const { sendVerificationEmail } = require('./_email');

// Reenvía el link de confirmación de email a una solicitud que ya se registró
// pero todavía no confirmó (o perdió/no encontró el mail original).
// Por seguridad, la respuesta es siempre la misma se encuentre o no el email,
// para no permitir que alguien use este endpoint para "adivinar" emails
// registrados.
const GENERIC_OK = {
  ok: true,
  message: 'Si el email está registrado y pendiente de confirmación, te reenviamos el link. Revisá tu bandeja de entrada (y spam).',
};

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
  if (!email) {
    return json(400, { error: 'Falta el email' });
  }
  // honeypot anti-spam, igual que en register.js
  if (body.website) {
    return json(200, GENERIC_OK);
  }

  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, name, email, email_verified, status FROM public_users WHERE email = $1',
    [email]
  );
  const user = rows[0];

  // No existe, ya está verificado, o fue rechazado/bloqueado: no hacemos nada,
  // pero devolvemos el mismo mensaje genérico igual.
  if (!user || user.email_verified || !['pending'].includes(user.status)) {
    return json(200, GENERIC_OK);
  }

  // Invalida cualquier token viejo sin usar y crea uno nuevo (evita que
  // queden múltiples links "vivos" para la misma cuenta).
  await pool.query(
    `UPDATE email_verification_tokens SET used_at = now()
     WHERE user_id = $1 AND used_at IS NULL`,
    [user.id]
  );

  const token = generateToken();
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES ($1, $2, now() + interval '48 hours')`,
    [user.id, token]
  );
  await sendVerificationEmail(user, token);

  return json(200, GENERIC_OK);
};
