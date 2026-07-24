const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('Falta configurar NETLIFY_DATABASE_URL (o DATABASE_URL en local).');
    }
    const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    pool = new Pool({
      connectionString,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

module.exports = { getPool };
