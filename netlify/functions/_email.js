const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function fromAddress() {
  return process.env.FROM_EMAIL || process.env.SMTP_USER;
}

function siteUrl() {
  return process.env.SITE_URL || 'https://listadeprecios.segtec.com.ar';
}

async function sendMailSafe(opts) {
  const transport = getTransport();
  if (!transport) {
    console.log('[email] SMTP no configurado. No se envió:', opts.subject, '->', opts.to);
    return false;
  }
  try {
    await transport.sendMail({ from: fromAddress(), ...opts });
    return true;
  } catch (e) {
    console.error('[email] Error enviando mail:', e.message);
    return false;
  }
}

async function sendVerificationEmail(user, token) {
  const link = `${siteUrl()}/verificar.html?token=${encodeURIComponent(token)}`;
  return sendMailSafe({
    to: user.email,
    subject: 'SEGTEC — Confirmá tu email',
    text:
      `Hola ${user.name},\n\n` +
      'Para completar tu solicitud de acceso a la lista de precios de SEGTEC, confirmá tu email haciendo clic en este link:\n\n' +
      link + '\n\n' +
      'Una vez confirmado, tu solicitud queda pendiente de aprobación por nuestro equipo.\n\n' +
      'Si no solicitaste esto, podés ignorar este mensaje.',
  });
}

async function notifyAdminNewRegistration(registration) {
  const to = process.env.ADMIN_NOTIFY_EMAIL;
  if (!to) { console.log('[email] Falta ADMIN_NOTIFY_EMAIL, aviso no enviado.'); return false; }
  return sendMailSafe({
    to,
    subject: 'SEGTEC — Nueva solicitud de acceso a la lista de precios',
    text:
      'Se registró y confirmó su email una nueva solicitud de acceso.\n\n' +
      'Nombre: ' + registration.name + '\n' +
      'Empresa: ' + (registration.empresa || '—') + '\n' +
      'WhatsApp: ' + (registration.whatsapp || '—') + '\n' +
      'Email: ' + registration.email + '\n\n' +
      'Ingresá al panel de administración para aprobarla o rechazarla.',
  });
}

async function sendPasswordResetEmail(user, token) {
  const link = `${siteUrl()}/restablecer.html?token=${encodeURIComponent(token)}`;
  return sendMailSafe({
    to: user.email,
    subject: 'SEGTEC — Restablecer tu contraseña',
    text:
      `Hola ${user.name},\n\n` +
      'Recibimos un pedido para restablecer tu contraseña. Hacé clic en este link (válido por 1 hora):\n\n' +
      link + '\n\n' +
      'Si no lo pediste vos, podés ignorar este mensaje — tu contraseña actual sigue funcionando.',
  });
}

async function sendQuoteRequest(data) {
  const to = process.env.QUOTES_EMAIL || 'ventas02@segtec.com.ar';
  const lines = data.items.map(
    it => `- ${it.marca || ''} ${it.desc || ''} (${it.codigo || ''}) — ${it.precio != null ? '$ ' + Math.round(it.precio).toLocaleString('es-AR') : 'Consultar'}`
  );
  return sendMailSafe({
    to,
    replyTo: data.email || undefined,
    subject: `Solicitud de presupuesto — ${data.nombre}`,
    text:
      'Nombre: ' + data.nombre + '\n' +
      'Teléfono / WhatsApp: ' + data.telefono + '\n' +
      'Email: ' + (data.email || '—') + '\n' +
      (data.comentario ? ('Comentario: ' + data.comentario + '\n') : '') +
      '\nProductos consultados:\n' + lines.join('\n'),
  });
}

module.exports = {
  sendVerificationEmail,
  notifyAdminNewRegistration,
  sendPasswordResetEmail,
  sendQuoteRequest,
};
