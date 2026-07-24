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
    'SELECT id, name, email, password_hash FROM admins WHERE email = $1',
    [email]
  );

  const admin = rows[0];
  if (!admin) {
    return json(401, { error: 'Usuario o contraseña incorrectos' });
  }

  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) {
    return json(401, { error: 'Usuario o contraseña incorrectos' });
  }

  const cookieHeader = setSessionCookieHeader({
    role: 'admin',
    id: admin.id,
    name: admin.name,
    email: admin.email,
  });

  return json(200, { ok: true, name: admin.name }, { 'Set-Cookie': cookieHeader });
};
