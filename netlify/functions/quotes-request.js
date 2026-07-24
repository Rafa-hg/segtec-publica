const { getPool } = require('./_db');
const { readSession, json } = require('./_auth');
const { sendQuoteRequest } = require('./_email');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Método no permitido' });
  }

  const session = readSession(event);
  if (!session || session.role !== 'public') {
    return json(401, { error: 'No autenticado' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Cuerpo inválido' });
  }

  const nombre = (body.nombre || '').trim();
  const telefono = (body.telefono || '').trim();
  const email = (body.email || '').trim();
  const comentario = (body.comentario || '').trim();
  const items = Array.isArray(body.items) ? body.items : [];

  if (!nombre || !telefono) return json(400, { error: 'Faltan nombre y teléfono' });
  if (!items.length) return json(400, { error: 'No hay productos en la consulta' });

  const pool = getPool();
  await pool.query(
    `INSERT INTO quote_requests (user_id, nombre, telefono, email, comentario, items_json)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [session.id, nombre, telefono, email, comentario, JSON.stringify(items)]
  );

  const sent = await sendQuoteRequest({ nombre, telefono, email, comentario, items });

  return json(200, { ok: true, emailSent: sent });
};
