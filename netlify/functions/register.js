const { getPool } = require('./_db');
const { hashPassword, generateToken, json } = require('./_auth');
const { sendVerificationEmail } = require('./_email');

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

  const name = (body.name || '').trim();
  const empresa = (body.empresa || '').trim();
  const whatsapp = (body.whatsapp || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const acceptedTerms = Boolean(body.acceptedTerms);

  if (!name || !email || !password || !whatsapp) {
    return json(400, { error: 'Faltan nombre, WhatsApp, email o contraseña' });
  }
  if (password.length < 8) {
    return json(400, { error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  if (!acceptedTerms) {
    return json(400, { error: 'Tenés que aceptar el uso de tus datos para continuar' });
  }
  // honeypot anti-spam: si este campo oculto viene completo, es un bot
  if (body.website) {
    return json(200, { ok: true, message: 'Tu solicitud quedó registrada.' });
  }

  const pool = getPool();

  const existing = await pool.query('SELECT id, status FROM public_users WHERE email = $1', [email]);
  if (existing.rows.length) {
    const st = existing.rows[0].status;
    if (st === 'pending') return json(409, { error: 'Ya existe una solicitud pendiente con ese email' });
    if (st === 'approved') return json(409, { error: 'Ese email ya tiene acceso. Iniciá sesión.' });
    return json(409, { error: 'Ese email ya fue registrado anteriormente' });
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query(
    `INSERT INTO public_users (name, empresa, whatsapp, email, password_hash, status, accepted_terms_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', now())
     RETURNING id, name, email`,
    [name, empresa, whatsapp, email, passwordHash]
  );
  const user = rows[0];

  const token = generateToken();
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES ($1, $2, now() + interval '48 hours')`,
    [user.id, token]
  );
  await sendVerificationEmail(user, token);

  return json(200, {
    ok: true,
    message: 'Te enviamos un mail para confirmar tu dirección. Una vez confirmada, tu solicitud queda pendiente de aprobación.',
  });
};
