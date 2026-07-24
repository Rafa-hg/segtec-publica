process.env.DATABASE_URL = 'postgres://postgres:localtest123@localhost:5432/segtec_publica';
process.env.JWT_SECRET = 'local-test-secret-not-for-prod';
// Sin SMTP configurado a propósito: los emails deben "no-opear" sin romper el flujo,
// y en su lugar debemos poder leer los tokens directo de la base para probar.

function mockEvent({ method = 'GET', body = null, cookieHeader = '', query = {} }) {
  return {
    httpMethod: method,
    body: body ? JSON.stringify(body) : null,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    queryStringParameters: query,
  };
}
function extractCookie(setCookieHeader) {
  return setCookieHeader.split(';')[0];
}

async function main() {
  const results = [];
  const assert = (name, cond, extra) => {
    results.push({ name, ok: !!cond, extra });
    console.log((cond ? 'OK  ' : 'FAIL') + '  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : ''));
  };

  const { getPool } = require('../netlify/functions/_db');
  const pool = getPool();

  // 0. Seed admin directo (simula scripts/seed-admin.js)
  const { hashPassword } = require('../netlify/functions/_auth');
  const adminHash = await hashPassword('adminpass123');
  await pool.query(
    `INSERT INTO admins (name, email, password_hash) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    ['Rafa', 'rafa@segtec.com.ar', adminHash]
  );

  // 1. Registro de un cliente nuevo
  const register = require('../netlify/functions/register');
  const r1 = await register.handler(mockEvent({
    method: 'POST',
    body: {
      name: 'Juan Pérez', empresa: 'Consorcio Los Alamos', whatsapp: '+54 9 11 5555-1234',
      email: 'juan@cliente.com', password: 'clientepass123', acceptedTerms: true,
    },
  }));
  assert('registro ok', r1.statusCode === 200, JSON.parse(r1.body));

  // 1b. Honeypot: si "website" viene completo, debe responder ok pero NO crear usuario
  const r1b = await register.handler(mockEvent({
    method: 'POST',
    body: {
      name: 'Bot', whatsapp: '123', email: 'bot@spam.com', password: 'aaaaaaaaaaa',
      acceptedTerms: true, website: 'http://spam.com',
    },
  }));
  const botCheck = await pool.query('SELECT id FROM public_users WHERE email = $1', ['bot@spam.com']);
  assert('honeypot bloquea creación real', r1b.statusCode === 200 && botCheck.rows.length === 0);

  // 1c. Sin aceptar términos, debe rechazar
  const r1c = await register.handler(mockEvent({
    method: 'POST',
    body: { name: 'X', whatsapp: '123', email: 'x@x.com', password: 'aaaaaaaaaaa', acceptedTerms: false },
  }));
  assert('rechaza registro sin aceptar términos', r1c.statusCode === 400);

  // 2. Intentar loguearse ANTES de verificar el email -> debe fallar
  const publicLogin = require('../netlify/functions/public-login');
  const r2 = await publicLogin.handler(mockEvent({
    method: 'POST', body: { email: 'juan@cliente.com', password: 'clientepass123' },
  }));
  assert('login rechazado antes de verificar email', r2.statusCode === 403, JSON.parse(r2.body));

  // 3. Verificar el email (leemos el token directo de la base, como haría el link del mail)
  const tokenRow = await pool.query(
    `SELECT t.token FROM email_verification_tokens t
     JOIN public_users u ON u.id = t.user_id WHERE u.email = $1`,
    ['juan@cliente.com']
  );
  assert('token de verificación se creó', tokenRow.rows.length === 1);
  const verifyEmail = require('../netlify/functions/verify-email');
  const r3 = await verifyEmail.handler(mockEvent({ method: 'POST', body: { token: tokenRow.rows[0].token } }));
  assert('verificación de email ok', r3.statusCode === 200, JSON.parse(r3.body));

  // 3b. Login sigue fallando: falta aprobación del admin
  const r3b = await publicLogin.handler(mockEvent({
    method: 'POST', body: { email: 'juan@cliente.com', password: 'clientepass123' },
  }));
  assert('login rechazado mientras está pendiente de aprobación', r3b.statusCode === 403, JSON.parse(r3b.body));

  // 4. Admin se loguea
  const adminLogin = require('../netlify/functions/admin-login');
  const r4 = await adminLogin.handler(mockEvent({
    method: 'POST', body: { email: 'rafa@segtec.com.ar', password: 'adminpass123' },
  }));
  assert('login admin ok', r4.statusCode === 200);
  const adminCookie = extractCookie(r4.headers['Set-Cookie']);

  // 5. Admin ve la solicitud pendiente
  const listRegs = require('../netlify/functions/admin-registrations-list');
  const r5 = await listRegs.handler(mockEvent({ method: 'GET', cookieHeader: adminCookie, query: { status: 'pending' } }));
  const regsBody = JSON.parse(r5.body);
  assert('admin ve la solicitud pendiente', regsBody.registrations.some(x => x.email === 'juan@cliente.com'), { count: regsBody.registrations.length });
  const regId = regsBody.registrations.find(x => x.email === 'juan@cliente.com').id;

  // 5b. Un cliente NO puede ver el listado de solicitudes (solo admin)
  const r5b = await listRegs.handler(mockEvent({ method: 'GET', cookieHeader: '', query: {} }));
  assert('rechaza listado de solicitudes sin sesión admin', r5b.statusCode === 401);

  // 6. Admin aprueba
  const reviewReg = require('../netlify/functions/admin-registrations-review');
  const r6 = await reviewReg.handler(mockEvent({
    method: 'POST', cookieHeader: adminCookie, body: { id: regId, action: 'approve' },
  }));
  assert('aprobación ok', r6.statusCode === 200, JSON.parse(r6.body));

  // 7. Ahora sí, el cliente puede loguearse
  const r7 = await publicLogin.handler(mockEvent({
    method: 'POST', body: { email: 'juan@cliente.com', password: 'clientepass123' },
  }));
  assert('login del cliente aprobado ok', r7.statusCode === 200, JSON.parse(r7.body));
  const clientCookie = extractCookie(r7.headers['Set-Cookie']);

  // 8. Cliente pide el catálogo
  const catalog = require('../netlify/functions/catalog');
  const r8 = await catalog.handler(mockEvent({ method: 'GET', cookieHeader: clientCookie }));
  const catBody = JSON.parse(r8.body);
  assert('catálogo accesible logueado', r8.statusCode === 200 && Array.isArray(catBody.CORREDIZOS), { productos: catBody.CORREDIZOS ? catBody.CORREDIZOS.length : 0 });

  // 8b. Sin sesión, el catálogo NO se entrega
  const r8b = await catalog.handler(mockEvent({ method: 'GET', cookieHeader: '' }));
  assert('catálogo bloqueado sin sesión', r8b.statusCode === 401);

  // 9. Cliente pide un presupuesto
  const quotesRequest = require('../netlify/functions/quotes-request');
  const r9 = await quotesRequest.handler(mockEvent({
    method: 'POST', cookieHeader: clientCookie,
    body: {
      nombre: 'Juan Pérez', telefono: '+54 9 11 5555-1234', email: 'juan@cliente.com',
      comentario: 'Para un edificio de 3 pisos',
      items: [{ marca: 'PPA', desc: 'CONJ. DZ HUB 300', codigo: 'E02138301', precio: 155788 }],
    },
  }));
  assert('solicitud de presupuesto guardada ok', r9.statusCode === 200, JSON.parse(r9.body));

  // 10. Admin ve el presupuesto
  const adminQuotes = require('../netlify/functions/admin-quotes-list');
  const r10 = await adminQuotes.handler(mockEvent({ method: 'GET', cookieHeader: adminCookie, query: {} }));
  const quotesBody = JSON.parse(r10.body);
  assert('admin ve el presupuesto solicitado', quotesBody.quotes.length >= 1, { count: quotesBody.quotes.length });

  // 11. Recupero de contraseña: solicitar link
  const forgotPassword = require('../netlify/functions/forgot-password');
  const r11 = await forgotPassword.handler(mockEvent({ method: 'POST', body: { email: 'juan@cliente.com' } }));
  assert('solicitud de recupero responde ok', r11.statusCode === 200);
  const resetTokenRow = await pool.query(
    `SELECT t.token FROM password_reset_tokens t JOIN public_users u ON u.id = t.user_id WHERE u.email = $1 ORDER BY t.id DESC LIMIT 1`,
    ['juan@cliente.com']
  );
  assert('token de recupero se generó', resetTokenRow.rows.length === 1);

  // 11b. Recupero para un email que no existe también responde 200 (no filtra info)
  const r11b = await forgotPassword.handler(mockEvent({ method: 'POST', body: { email: 'noexiste@nadie.com' } }));
  assert('recupero no revela si el email existe', r11b.statusCode === 200);

  // 12. Cambiar la contraseña con el token
  const resetPassword = require('../netlify/functions/reset-password');
  const r12 = await resetPassword.handler(mockEvent({
    method: 'POST', body: { token: resetTokenRow.rows[0].token, password: 'nuevaClave123' },
  }));
  assert('reset de contraseña ok', r12.statusCode === 200, JSON.parse(r12.body));

  // 12b. Login con la contraseña vieja ya no funciona
  const r12b = await publicLogin.handler(mockEvent({
    method: 'POST', body: { email: 'juan@cliente.com', password: 'clientepass123' },
  }));
  assert('contraseña vieja ya no funciona', r12b.statusCode === 401);

  // 12c. Login con la contraseña nueva sí funciona
  const r12c = await publicLogin.handler(mockEvent({
    method: 'POST', body: { email: 'juan@cliente.com', password: 'nuevaClave123' },
  }));
  assert('contraseña nueva funciona', r12c.statusCode === 200);

  // 12d. El mismo token de reset no se puede reusar
  const r12d = await resetPassword.handler(mockEvent({
    method: 'POST', body: { token: resetTokenRow.rows[0].token, password: 'otraClave456' },
  }));
  assert('token de reset no se puede reusar', r12d.statusCode === 410);

  // 13. Admin rechaza una segunda solicitud, y esa persona no puede loguearse
  const r13reg = await register.handler(mockEvent({
    method: 'POST',
    body: { name: 'Pedro Malo', whatsapp: '123456', email: 'pedro@cliente.com', password: 'clientepass123', acceptedTerms: true },
  }));
  assert('segundo registro ok', r13reg.statusCode === 200);
  const tokenRow2 = await pool.query(
    `SELECT t.token FROM email_verification_tokens t JOIN public_users u ON u.id = t.user_id WHERE u.email = $1`,
    ['pedro@cliente.com']
  );
  await verifyEmail.handler(mockEvent({ method: 'POST', body: { token: tokenRow2.rows[0].token } }));
  const regs2 = await listRegs.handler(mockEvent({ method: 'GET', cookieHeader: adminCookie, query: { status: 'pending' } }));
  const pedroId = JSON.parse(regs2.body).registrations.find(x => x.email === 'pedro@cliente.com').id;
  await reviewReg.handler(mockEvent({ method: 'POST', cookieHeader: adminCookie, body: { id: pedroId, action: 'reject' } }));
  const r13login = await publicLogin.handler(mockEvent({
    method: 'POST', body: { email: 'pedro@cliente.com', password: 'clientepass123' },
  }));
  assert('cliente rechazado no puede loguearse', r13login.statusCode === 401);

  // 14. Flujo de actualización de catálogo: subir por partes, ver diff, publicar
  const fs = require('fs');
  const xlsxPath = '/mnt/user-data/uploads/Lista_Difusio_n_SEGTEC__2_.xlsx';
  if (fs.existsSync(xlsxPath)) {
    const uploadChunk = require('../netlify/functions/admin-catalog-upload-chunk');
    const uploadFinish = require('../netlify/functions/admin-catalog-upload-finish');
    const catalogPublish = require('../netlify/functions/admin-catalog-publish');
    const catalogFn = require('../netlify/functions/catalog');

    async function uploadInChunks(cookie, filePath, uploadId, chunkSize = 3 * 1024 * 1024) {
      const fullBase64 = fs.readFileSync(filePath).toString('base64');
      const charChunkSize = Math.ceil(chunkSize * 4 / 3);
      const totalChunks = Math.ceil(fullBase64.length / charChunkSize);
      for (let i = 0; i < totalChunks; i++) {
        const chunkData = fullBase64.slice(i * charChunkSize, (i + 1) * charChunkSize);
        const r = await uploadChunk.handler(mockEvent({
          method: 'POST', cookieHeader: cookie,
          body: { uploadId, chunkIndex: i, chunkData, filename: 'test.xlsx' },
        }));
        if (r.statusCode !== 200) throw new Error('chunk ' + i + ' falló: ' + r.body);
      }
      return totalChunks;
    }

    const uploadId1 = 'test_upload_1';
    const nChunks = await uploadInChunks(adminCookie, xlsxPath, uploadId1);
    assert('archivo grande se partió en varias partes', nChunks > 1, { partes: nChunks });

    const r14 = await uploadFinish.handler(mockEvent({
      method: 'POST', cookieHeader: adminCookie, body: { uploadId: uploadId1, filename: 'test.xlsx' },
    }));
    const uploadBody = JSON.parse(r14.body);
    assert('ensamblado y análisis de catálogo por partes ok', r14.statusCode === 200, { stats: uploadBody.stats });

    // 14b. Sin sesión admin, no se puede subir una parte
    const r14b = await uploadChunk.handler(mockEvent({ method: 'POST', cookieHeader: '', body: { uploadId: 'x', chunkIndex: 0, chunkData: 'YQ==' } }));
    assert('rechaza subida de parte sin sesión admin', r14b.statusCode === 401);

    // 14c. Terminar sin haber subido ninguna parte da error prolijo
    const r14c = await uploadFinish.handler(mockEvent({ method: 'POST', cookieHeader: adminCookie, body: { uploadId: 'no_existe' } }));
    assert('finish sin partes previas da error controlado', r14c.statusCode === 404);

    // 14d. El catálogo público TODAVÍA sirve el bundle viejo (no se publicó nada aún)
    const beforePublish = await catalogFn.handler(mockEvent({ method: 'GET', cookieHeader: clientCookie }));
    const beforeBody = JSON.parse(beforePublish.body);
    assert('catálogo público sin cambios antes de publicar', Array.isArray(beforeBody.CORREDIZOS));

    // 14e. Publicar
    const r14e = await catalogPublish.handler(mockEvent({
      method: 'POST', cookieHeader: adminCookie, body: { pendingId: uploadBody.pendingId },
    }));
    assert('publicación de catálogo ok', r14e.statusCode === 200, JSON.parse(r14e.body));

    // 14f. Ahora el catálogo público sirve la versión recién publicada
    const afterPublish = await catalogFn.handler(mockEvent({ method: 'GET', cookieHeader: clientCookie }));
    const afterBody = JSON.parse(afterPublish.body);
    const nCorredizos = afterBody.CORREDIZOS.filter(x => x.type === 'product').length;
    assert('catálogo público refleja la nueva publicación', nCorredizos === 66, { productos: nCorredizos });

    // 14g. Publicar de nuevo el mismo archivo (otro uploadId): el diff no debería mostrar cambios
    const uploadId2 = 'test_upload_2';
    await uploadInChunks(adminCookie, xlsxPath, uploadId2);
    const r14g = await uploadFinish.handler(mockEvent({
      method: 'POST', cookieHeader: adminCookie, body: { uploadId: uploadId2, filename: 'test.xlsx' },
    }));
    const diffBody = JSON.parse(r14g.body);
    const sinCambios = Object.values(diffBody.diff).every(d => !d.nuevos.length && !d.eliminados.length && !d.precioCambiado.length);
    assert('subir el mismo archivo de nuevo no muestra cambios', sinCambios);
  } else {
    console.log('SKIP: pruebas de actualización de catálogo (no se encontró un .xlsx de prueba en este entorno)');
  }

  const failed = results.filter(r => !r.ok);
  console.log('\n' + (failed.length === 0 ? `TODOS LOS TESTS PASARON (${results.length})` : `${failed.length} TESTS FALLARON de ${results.length}`));
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
