const { getPool } = require('./_db');
const { verifyPassword, setSessionCookieHeader, json } = require('./_auth');

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
  const password = body.password || '';

  if (!email || !password) {
    return json(400, { error: 'Faltan email o contraseña' });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id, name, empresa, whatsapp, email, password_hash, status, email_verified FROM public_users WHERE email = $1',
    [email]
  );

  const user = rows[0];
  if (!user) {
    return json(401, { error: 'Usuario o contraseña incorrectos' });
  }

  if (!user.email_verified) {
    return json(403, { error: 'Todavía no confirmaste tu email. Revisá tu bandeja de entrada.' });
  }
  if (user.status === 'pending') {
    return json(403, { error: 'Tu solicitud todavía está en revisión.' });
  }
  if (user.status === 'rejected') {
    return json(401, { error: 'Usuario o contraseña incorrectos' });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return json(401, { error: 'Usuario o contraseña incorrectos' });
  }

  const cookieHeader = setSessionCookieHeader({
    role: 'public',
    id: user.id,
    name: user.name,
    email: user.email,
    whatsapp: user.whatsapp,
  });

  return json(200, { ok: true, name: user.name }, { 'Set-Cookie': cookieHeader });
};
