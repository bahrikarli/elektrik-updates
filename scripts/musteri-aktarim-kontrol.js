/**
 * CSV ile DB karsilastir - aktarilmayan / atlanan musterileri listeler
 * node scripts/musteri-aktarim-kontrol.js "C:\path\musteriler.csv"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const sql = require('mssql');

const csvPath = process.argv[2];
if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Kullanim: node scripts/musteri-aktarim-kontrol.js musteriler.csv');
  process.exit(1);
}

function normBaslik(h) {
  return String(h || '').trim().toLowerCase().replace(/\s/g, '');
}

function parseCsv(path) {
  let raw = fs.readFileSync(path, 'utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  let sep = ';';
  if (lines[0].includes(';')) sep = ';';
  else if (lines[0].includes('\t')) sep = '\t';
  else sep = ',';

  const headers = lines[0].split(sep).map(normBaslik);
  let iu = headers.indexOf('unvan');
  if (iu < 0) iu = headers.indexOf('adsoyad');
  if (iu < 0) iu = 0;
  let ib = headers.indexOf('bakiye');
  if (ib < 0) ib = headers.indexOf('borc');
  if (ib < 0 && headers.length >= 2) ib = 1;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep);
    const unvan = (cols[iu] || '').trim();
    if (!unvan) continue;
    rows.push({ unvan, bakiye: cols[ib] || '0', satir: i + 1 });
  }
  return rows;
}

function normAd(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

(async () => {
  const csvRows = parseCsv(csvPath);
  const cfg = {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    },
  };
  const pool = await sql.connect(cfg);
  const dbRes = await pool.request().query('SELECT MusteriID, AdSoyad, FirmaAdi, Bakiye FROM Musteriler');
  const db = dbRes.recordset;

  const dbAdSet = new Set();
  for (const m of db) {
    const ad = normAd(m.AdSoyad);
    const firma = normAd(m.FirmaAdi);
    if (ad) dbAdSet.add(ad.toLocaleLowerCase('tr-TR'));
    if (firma) dbAdSet.add(firma.toLocaleLowerCase('tr-TR'));
  }

  const eksik = [];
  const atlanmis = [];
  for (const row of csvRows) {
    const key = normAd(row.unvan).toLocaleLowerCase('tr-TR');
    if (!dbAdSet.has(key)) {
      eksik.push(row);
      continue;
    }
    const dbRow = db.find(
      (m) =>
        normAd(m.AdSoyad).toLocaleLowerCase('tr-TR') === key ||
        normAd(m.FirmaAdi).toLocaleLowerCase('tr-TR') === key,
    );
    if (dbRow) {
      const imp = await pool
        .request()
        .input('id', sql.Int, dbRow.MusteriID)
        .query(
          "SELECT TOP 1 HareketID FROM MusteriHareketleri WHERE MusteriID = @id AND Referans = N'devir:import'",
        );
      if (!imp.recordset.length && parseFloat(String(row.bakiye).replace(',', '.')) > 0) {
        atlanmis.push({ ...row, dbId: dbRow.MusteriID, dbBakiye: dbRow.Bakiye });
      }
    }
  }

  console.log('CSV satir (unvan dolu):', csvRows.length);
  console.log('DB musteri:', db.length);
  console.log('');

  if (eksik.length) {
    console.log('=== DB DE YOK (aktarilmamis) ===');
    eksik.forEach((r) => console.log(`  Satir ${r.satir}: ${r.unvan} | bakiye: ${r.bakiye}`));
  } else {
    console.log('Tum CSV unvanlari DB de var.');
  }

  if (atlanmis.length) {
    console.log('');
    console.log('=== DB DE VAR ama import atlamis olabilir (once kayitli) ===');
    atlanmis.forEach((r) =>
      console.log(`  Satir ${r.satir}: ${r.unvan} | CSV bakiye: ${r.bakiye} | DB #${r.dbId}`),
    );
  }

  await pool.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
