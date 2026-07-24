// Uso: node scripts/seed-admin.js "Rafa" "rafa@segtec.com.ar" "contraseñaSegura123"
// Crea (o actualiza la contraseña de) el usuario administrador inicial.
// Requiere las variables de entorno NETLIFY_DATABASE_URL (o DATABASE_URL) y no depende de JWT_SECRET.

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Uso: node scripts/seed-admin.js "Nombre" "email@dominio.com" "contraseña"');
    process.exit(1);
  }

  const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Falta NETLIFY_DATABASE_URL o DATABASE_URL en el entorno.');
    process.exit(1);
  }

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const pool = new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `INSERT INTO admins (name, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name`,
    [name, email.toLowerCase(), passwordHash]
  );

  console.log(`Listo. Admin "${email}" creado/actualizado.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
