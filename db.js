const path = require('path');
const sql = require('mssql');
const { envYukle } = require('./lib/env-yukle');

envYukle();

const server = (process.env.DB_SERVER || '').trim();
const database = (process.env.DB_NAME || '').trim();
const user = (process.env.DB_USER || '').trim();
const password = process.env.DB_PASSWORD !== undefined ? String(process.env.DB_PASSWORD) : '';

if (!server) {
  console.error(`
[ELEKTRIK] DB_SERVER tanımlı değil.

1) Proje klasöründe ".env" dosyası oluşturun (örnek: ".env.example" dosyasını kopyalayıp ".env" yapın).
2) Şu satırları gerçek SQL Server bilgilerinizle doldurun:
   DB_SERVER=SunucuAdi\\\\SQLEXPRESS   veya   localhost
   DB_NAME=VeritabaniAdi
   DB_USER=...
   DB_PASSWORD=...
`);
  process.exit(1);
}

if (!database) {
  console.error('[ELEKTRIK] .env içinde DB_NAME zorunludur.');
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
    useUTC: false,
  },
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then((pool) => {
    console.log('MSSQL bağlantısı hazır.');
    return pool;
  })
  .catch((err) => {
    console.error('Veritabanı bağlantı hatası:', err.message || err);
    return Promise.reject(err);
  });

module.exports = { sql, poolPromise };
