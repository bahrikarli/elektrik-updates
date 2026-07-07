/**
 * Eski programdan müşteri (cari) aktarımı — CSV → SQL
 *
 * CSV sütunları (Excel'den ; ile kaydedin):
 *   Unvan     — müşteri adı / ünvan (zorunlu)
 *   Bakiye    — borç tutarı (ör. 1250,50 veya 1250.50)
 *   SonIslem  — son işlem tarihi (isteğe bağlı, gg.aa.yyyy)
 *   Telefon   — yoksa otomatik placeholder atanır (5320000001, 5320000002…)
 *
 * Kullanım (sunucuda, C:\ELEKTRIK):
 *   node scripts/musteri-csv-aktar.js C:\yol\musteriler.csv
 *   node scripts/musteri-csv-aktar.js musteriler.csv --dry-run
 */
const fs = require('fs');
const path = require('path');
const { sql, poolPromise } = require('../db');

const dryRun = process.argv.includes('--dry-run');
const csvPath = process.argv.find((a) => !a.startsWith('-') && a.endsWith('.csv'));

if (!csvPath) {
  console.error('Kullanım: node scripts/musteri-csv-aktar.js dosya.csv [--dry-run]');
  process.exit(1);
}

const absCsv = path.resolve(csvPath);
if (!fs.existsSync(absCsv)) {
  console.error('Dosya bulunamadı:', absCsv);
  process.exit(1);
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function parseCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (!q && c === sep) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function detectSep(headerLine) {
  if (headerLine.includes(';')) return ';';
  if (headerLine.includes('\t')) return '\t';
  return ',';
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '');
}

function parseTutar(s) {
  const t = String(s || '').trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseTarih(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(t);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function csvOku(filePath) {
  const raw = stripBom(fs.readFileSync(filePath, 'utf8'));
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const sep = detectSep(lines[0]);
  const headers = parseCsvLine(lines[0], sep).map(normHeader);
  const idx = {
    unvan: headers.findIndex((h) => h === 'unvan' || h === 'adsoyad' || h === 'musteri' || h === 'ad'),
    bakiye: headers.findIndex((h) => h === 'bakiye' || h === 'borc' || h === 'kalan'),
    sonIslem: headers.findIndex((h) => h === 'sonislem' || h === 'sonislem' || h === 'tarih' || h === 'son'),
    telefon: headers.findIndex((h) => h === 'telefon' || h === 'tel' || h === 'cep'),
  };
  if (idx.unvan < 0 && headers.length >= 1) idx.unvan = 0;
  if (idx.bakiye < 0 && headers.length >= 2) idx.bakiye = 1;
  if (idx.sonIslem < 0 && headers.length >= 3) idx.sonIslem = 2;

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i], sep);
    const unvan = (cols[idx.unvan] || '').trim();
    if (!unvan) continue;
    rows.push({
      unvan,
      bakiye: idx.bakiye >= 0 ? parseTutar(cols[idx.bakiye]) : 0,
      sonIslem: idx.sonIslem >= 0 ? parseTarih(cols[idx.sonIslem]) : null,
      telefon: idx.telefon >= 0 ? String(cols[idx.telefon] || '').replace(/\D/g, '') : '',
    });
  }
  return rows;
}

async function mevcutTelefonlar(pool) {
  const rs = await pool.request().query('SELECT Telefon FROM Musteriler WHERE Telefon IS NOT NULL');
  return new Set((rs.recordset || []).map((r) => String(r.Telefon || '').trim()).filter(Boolean));
}

function yeniTelefon(mevcut, seri) {
  for (let n = seri; n < seri + 100000; n += 1) {
    const tel = `532${String(n).padStart(7, '0')}`.slice(0, 10);
    if (!mevcut.has(tel)) {
      mevcut.add(tel);
      return tel;
    }
  }
  throw new Error('Bos telefon numarasi bulunamadi.');
}

async function main() {
  const rows = csvOku(absCsv);
  if (!rows.length) {
    console.error('CSV bos veya okunamadi.');
    process.exit(1);
  }

  console.log(`Dosya: ${absCsv}`);
  console.log(`Satir: ${rows.length}${dryRun ? ' (DRY-RUN — kayit yok)' : ''}`);

  const pool = await poolPromise;
  const telSet = await mevcutTelefonlar(pool);
  let telSeri = 1;
  let ok = 0;
  let atla = 0;

  for (const row of rows) {
    const dup = await pool.request()
      .input('Ad', sql.NVarChar(150), row.unvan)
      .query(`
        SELECT TOP 1 MusteriID FROM Musteriler
        WHERE LTRIM(RTRIM(AdSoyad)) = @Ad OR LTRIM(RTRIM(FirmaAdi)) = @Ad
      `);
    if (dup.recordset.length) {
      console.log(`  ATLA (zaten var): ${row.unvan}`);
      atla += 1;
      continue;
    }

    let tel = row.telefon.replace(/^0/, '');
    if (tel && !/^[1-9][0-9]{9}$/.test(tel)) tel = '';
    if (!tel) tel = yeniTelefon(telSet, telSeri++);

    const tarih = row.sonIslem || new Date();

    if (dryRun) {
      console.log(`  EKLE: ${row.unvan} | bakiye=${row.bakiye} | tel=${tel}`);
      ok += 1;
      continue;
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const ins = await new sql.Request(tx)
        .input('AdSoyad', sql.NVarChar(100), row.unvan.substring(0, 100))
        .input('Telefon', sql.NVarChar(20), tel)
        .input('Bakiye', sql.Decimal(18, 2), row.bakiye)
        .input('Tur', sql.NVarChar(20), 'Gercek')
        .query(`
          INSERT INTO Musteriler (AdSoyad, Telefon, tur, Bakiye)
          OUTPUT INSERTED.MusteriID
          VALUES (@AdSoyad, @Telefon, @Tur, @Bakiye)
        `);
      const musteriID = ins.recordset[0]?.MusteriID;

      if (musteriID && row.bakiye > 0.005) {
        await new sql.Request(tx)
          .input('MusteriID', sql.Int, musteriID)
          .input('Toplam', sql.Decimal(18, 2), row.bakiye)
          .input('Kalan', sql.Decimal(18, 2), row.bakiye)
          .input('Tarih', sql.DateTime, tarih)
          .query(`
            INSERT INTO MusteriHareketleri
              (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans, Tarih)
            VALUES
              (@MusteriID, N'Satis', @Toplam, 0, @Kalan, NULL,
               N'Eski programdan devir bakiyesi', N'aktarim', N'devir:import', @Tarih)
          `);
      }

      await tx.commit();
      console.log(`  OK: ${row.unvan} (#${musteriID}, ${row.bakiye} TL)`);
      ok += 1;
    } catch (e) {
      await tx.rollback();
      console.error(`  HATA: ${row.unvan} — ${e.message || e}`);
    }
  }

  console.log(`\nTamam. Eklenen: ${ok}, atlanan: ${atla}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
