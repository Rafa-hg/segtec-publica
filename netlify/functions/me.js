const { readSession, json } = require('./_auth');

exports.handler = async (event) => {
  const session = readSession(event);
  if (!session) {
    return json(401, { error: 'No autenticado' });
  }
  return json(200, {
    role: session.role,
    id: session.id,
    name: session.name,
    email: session.email,
    whatsapp: session.whatsapp,
  });
};
