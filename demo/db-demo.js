const path = require('path');
const sql = require('mssql');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const server = (process.env.DB_SERVER || '').trim();
const database = (process.env.DB_NAME || '').trim();
const user = (process.env.DB_USER || '').trim();
const password = process.env.DB_PASSWORD !== undefined ? String(process.env.DB_PASSWORD) : '';

if (!server || !database) {
  console.error('[DEMO] demo/.env içinde DB_SERVER ve DB_NAME gerekli.');
  process.exit(1);
}

const config = {
  user: user || undefined,
  password: password || undefined,
  server,
  database,
  options: {
    encrypt: process.env.DB_ENCRYPT !== 'false',
    trustServerCertificate:
      process.env.DB_TRUST_CERT === 'true' || process.env.DB_ENCRYPT === 'false',
  },
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log('[DEMO] MSSQL bağlantısı OK.');
    return pool;
  })
  .catch((err) => {
    console.error('[DEMO] Veritabanı bağlantı hatası:', err.message || err);
    process.exit(1);
  });

module.exports = { sql, poolPromise };
