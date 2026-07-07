/**
 * Cari silinmiş ama günlük işlemlerde kalan kayıtları bulur / iptal eder.
 * CLI: scripts/gunluk-cari-kopuk-temizle.js
 * API: POST /api/bakim/gunluk-kopuk-temizle
 */
const sql = require('mssql');

function bugunStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseLira(s) {
  let t = String(s || '').trim();
  if (!t) return 0;
  if (t.includes('.') && t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

function aciklamadanMusteriID(aciklama) {
  const m = String(aciklama || '').match(/Müşteri\s*#(\d+)/i);
  const id = m ? parseInt(m[1], 10) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function aciklamadanMusteriAdi(aciklama) {
  const s = String(aciklama || '').trim();
  const mLog = s.match(/—\s*(.+?)\s*\(\s*Müşteri\s*#\d+\s*\)\s*$/i);
  if (mLog) return mLog[1].trim();
  const m1 = s.match(/^([^—:]+)\s*—/);
  if (m1) return m1[1].trim();
  const m2 = s.match(/^([^:]+):\s*\d/);
  if (m2) return m2[1].trim();
  return null;
}

function aciklamadanMusteriSatisToplam(aciklama) {
  const m = String(aciklama || '').match(/satış\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  return m ? parseLira(m[1]) : 0;
}

function aciklamadanMusteriOdemeTutar(aciklama) {
  const m = String(aciklama || '').match(/^[^:]+:\s*(\d+(?:[.,]\d+)?)\s*₺/);
  return m ? parseLira(m[1]) : 0;
}

function musteriFiltreEsles(ad, filtre) {
  const f = String(filtre || '').trim();
  if (!f) return true;
  const a = String(ad || '').toLocaleLowerCase('tr-TR');
  const q = f.toLocaleLowerCase('tr-TR');
  if (a.includes(q)) return true;
  return q.split(/\s+/).filter((w) => w.length >= 2).every((w) => a.includes(w));
}

async function tabloVarMi(pool, ad) {
  const rs = await pool.request()
    .input('TableName', sql.NVarChar(128), ad)
    .query(`
      SELECT 1 AS ok
      WHERE OBJECT_ID(CONCAT('dbo.', @TableName), 'U') IS NOT NULL
    `);
  return rs.recordset.length > 0;
}

async function iptalEdilmisLogIdleri(pool, bas, bit) {
  const ids = new Set();
  if (await tabloVarMi(pool, 'HizliSatisKayitlari')) {
    const rs = await pool.request()
      .input('bas', sql.NVarChar(10), bas)
      .input('bit', sql.NVarChar(10), bit)
      .query(`
        SELECT LogID FROM HizliSatisKayitlari
        WHERE IptalEdildi = 1 AND LogID IS NOT NULL
          AND CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
          AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
      `);
    for (const row of rs.recordset || []) {
      if (row.LogID) ids.add(Number(row.LogID));
    }
  }
  const rs2 = await pool.request()
    .input('bas', sql.NVarChar(10), bas)
    .input('bit', sql.NVarChar(10), bit)
    .query(`
      SELECT Aciklama FROM IslemGecmisi
      WHERE CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
        AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
        AND IslemTipi LIKE N'%ptal%'
    `);
  for (const row of rs2.recordset || []) {
    const m = String(row.Aciklama || '').match(/Log\s*#\s*(\d+)/i);
    if (m) ids.add(parseInt(m[1], 10));
  }
  return ids;
}

async function kopukIslemKaydet(pool, kullanici, tip, aciklama) {
  await pool.request()
    .input('KullaniciAdi', sql.NVarChar(100), kullanici)
    .input('IslemTipi', sql.NVarChar(50), tip)
    .input('Aciklama', sql.NVarChar(500), aciklama.substring(0, 500))
    .query(`
      INSERT INTO IslemGecmisi (KullaniciAdi, IslemTipi, Aciklama, Tarih)
      VALUES (@KullaniciAdi, @IslemTipi, @Aciklama, GETDATE())
    `);
}

async function musteriIdAd(pool, musteriID) {
  const rs = await pool.request()
    .input('MID', sql.Int, musteriID)
    .query('SELECT AdSoyad, FirmaAdi FROM Musteriler WHERE MusteriID = @MID');
  const r = rs.recordset[0];
  if (!r) return null;
  return String(r.AdSoyad || r.FirmaAdi || '').trim() || null;
}

async function cariSatisVarMi(pool, musteriID, tarih, toplam, referans) {
  const req = pool.request()
    .input('MID', sql.Int, musteriID)
    .input('Tarih', sql.DateTime, tarih)
    .input('Toplam', sql.Decimal(18, 2), toplam);
  let refClause = '';
  if (referans) {
    req.input('Ref', sql.NVarChar(40), referans.substring(0, 40));
    refClause = 'OR (Referans = @Ref)';
  }
  const rs = await req.query(`
    SELECT TOP 1 HareketID FROM MusteriHareketleri
    WHERE MusteriID = @MID AND LOWER(Tur) = 'satis'
      AND (
        (ABS(ToplamTutar - @Toplam) < 0.02 AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= 300)
        ${refClause}
      )
  `);
  return rs.recordset.length > 0;
}

async function cariOdemeVarMi(pool, musteriID, tarih, tutar) {
  const rs = await pool.request()
    .input('MID', sql.Int, musteriID)
    .input('Tarih', sql.DateTime, tarih)
    .input('Tutar', sql.Decimal(18, 2), tutar)
    .query(`
      SELECT TOP 1 HareketID FROM MusteriHareketleri
      WHERE MusteriID = @MID AND LOWER(Tur) = 'odeme'
        AND ABS(OdenenTutar - @Tutar) < 0.02
        AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= 300
    `);
  return rs.recordset.length > 0;
}

async function gunlukCariKopukKayitlariBul(pool, bas, bit, musteriFiltre) {
  const basTrim = String(bas || bugunStr()).trim().substring(0, 10);
  const bitTrim = String(bit || basTrim).trim().substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(basTrim) || !/^\d{4}-\d{2}-\d{2}$/.test(bitTrim)) {
    throw new Error('Geçersiz tarih. Örnek: 2026-07-06');
  }

  const zatenIptal = await iptalEdilmisLogIdleri(pool, basTrim, bitTrim);
  const yapilacak = [];

  if (await tabloVarMi(pool, 'HizliSatisKayitlari')) {
    const kRs = await pool.request()
      .input('bas', sql.NVarChar(10), basTrim)
      .input('bit', sql.NVarChar(10), bitTrim)
      .query(`
        SELECT k.KayitID, k.LogID, k.MusteriID, k.Referans, k.SepetToplam, k.Tarih
        FROM HizliSatisKayitlari k
        WHERE k.IptalEdildi = 0
          AND k.MusteriID IS NOT NULL
          AND CAST(k.Tarih AS DATE) >= CAST(@bas AS DATE)
          AND CAST(k.Tarih AS DATE) <= CAST(@bit AS DATE)
          AND (
            k.Referans IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM MusteriHareketleri h
              WHERE h.Referans = k.Referans AND LOWER(h.Tur) = 'satis'
            )
          )
      `);
    for (const k of kRs.recordset || []) {
      const logID = Number(k.LogID) || null;
      if (logID && zatenIptal.has(logID)) continue;
      const ad = await musteriIdAd(pool, k.MusteriID);
      yapilacak.push({
        tur: 'hizli_satis_kayit',
        kayitID: k.KayitID,
        logID,
        musteriID: k.MusteriID,
        ad,
        tutar: Number(k.SepetToplam),
        tarih: k.Tarih,
        aciklama: `HSK #${k.KayitID} Log #${logID || '?'} — ${ad || 'Müşteri'} — ${k.SepetToplam} ₺`,
      });
    }
  }

  const logRs = await pool.request()
    .input('bas', sql.NVarChar(10), basTrim)
    .input('bit', sql.NVarChar(10), bitTrim)
    .query(`
      SELECT LogID, IslemTipi, Aciklama, Tarih
      FROM IslemGecmisi
      WHERE CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
        AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
        AND IslemTipi IN (
          N'Hızlı Satış', N'Hızlı Satış (Sepet)',
          N'Hizli Satis', N'Hizli Satis (Sepet)',
          N'Müşteri Satış', N'Musteri Satis',
          N'Müşteri Ödeme', N'Musteri Odeme'
        )
    `);

  for (const row of logRs.recordset || []) {
    const logID = Number(row.LogID);
    if (!logID || zatenIptal.has(logID)) continue;

    const tip = String(row.IslemTipi || '');
    const ac = String(row.Aciklama || '');
    const tarih = row.Tarih;
    let musteriID = aciklamadanMusteriID(ac);
    const ad = aciklamadanMusteriAdi(ac);

    if (!musteriID && ad) {
      const mRs = await pool.request()
        .input('Ad', sql.NVarChar(120), ad.substring(0, 120))
        .query(`
          SELECT TOP 1 MusteriID FROM Musteriler
          WHERE AdSoyad = @Ad OR FirmaAdi = @Ad
          ORDER BY MusteriID DESC
        `);
      musteriID = mRs.recordset[0]?.MusteriID || null;
    }

    if (/müşteri satış|musteri satis/i.test(tip)) {
      const toplam = aciklamadanMusteriSatisToplam(ac) || 0;
      if (musteriID && (await cariSatisVarMi(pool, musteriID, tarih, toplam, null))) continue;
      yapilacak.push({
        tur: 'musteri_satis_log',
        logID,
        musteriID,
        ad,
        tutar: toplam,
        tarih,
        aciklama: `Log #${logID} Müşteri Satış — ${ad || '?'} — ${toplam} ₺`,
      });
      continue;
    }

    if (/müşteri ödeme|musteri odeme/i.test(tip)) {
      const tutar = aciklamadanMusteriOdemeTutar(ac) || 0;
      if (musteriID && (await cariOdemeVarMi(pool, musteriID, tarih, tutar))) continue;
      yapilacak.push({
        tur: 'musteri_odeme_log',
        logID,
        musteriID,
        ad,
        tutar,
        tarih,
        aciklama: `Log #${logID} Müşteri Ödeme — ${ad || '?'} — ${tutar} ₺`,
      });
      continue;
    }

    if (/hızlı|hizli/i.test(tip) && (musteriID || ad)) {
      if (await tabloVarMi(pool, 'HizliSatisKayitlari')) {
        const hsk = await pool.request()
          .input('LogID', sql.Int, logID)
          .query('SELECT TOP 1 KayitID, IptalEdildi FROM HizliSatisKayitlari WHERE LogID = @LogID');
        if (hsk.recordset[0]?.IptalEdildi) continue;
        if (hsk.recordset[0]) continue;
      }
      const toplam = parseLira((ac.match(/(\d+(?:[.,]\d+)?)\s*₺/) || [])[1]) || 0;
      if (musteriID && (await cariSatisVarMi(pool, musteriID, tarih, toplam, null))) continue;
      yapilacak.push({
        tur: 'hizli_satis_log',
        logID,
        musteriID,
        ad,
        tutar: toplam,
        tarih,
        aciklama: `Log #${logID} Hızlı Satış — ${ad || musteriID || '?'} — ${toplam} ₺`,
      });
    }
  }

  let benzersiz = [];
  const seen = new Set();
  for (const item of yapilacak) {
    const key = item.kayitID ? `k${item.kayitID}` : `l${item.logID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    benzersiz.push(item);
  }

  if (musteriFiltre) {
    benzersiz = benzersiz.filter((item) => musteriFiltreEsles(item.ad, musteriFiltre));
  }

  return {
    bas: basTrim,
    bit: bitTrim,
    kayitlar: benzersiz,
    musteriFiltre: musteriFiltre ? String(musteriFiltre).trim() : null,
  };
}

async function gunlukCariKopukTemizle(pool, opts) {
  const dryRun = opts?.dryRun !== false;
  const kullanici = String(opts?.kullanici || 'Bakim').substring(0, 50);
  const musteriFiltre = opts?.musteriFiltre || opts?.musteri || null;
  const { bas, bit, kayitlar, musteriFiltre: filtre } = await gunlukCariKopukKayitlariBul(
    pool,
    opts?.bas,
    opts?.bit,
    musteriFiltre,
  );

  if (!kayitlar.length) {
    return {
      success: true,
      dryRun,
      bas,
      bit,
      musteriFiltre: filtre,
      adet: 0,
      kayitlar: [],
      message: filtre
        ? `"${filtre}" için kopuk kayıt bulunamadı.`
        : 'Kopuk kayıt bulunamadı. Günlük liste zaten senkron görünüyor.',
    };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      bas,
      bit,
      musteriFiltre: filtre,
      adet: kayitlar.length,
      kayitlar: kayitlar.map((k) => k.aciklama),
      message: filtre
        ? `"${filtre}" için ${kayitlar.length} kopuk kayıt bulundu.`
        : `${kayitlar.length} kopuk kayıt bulundu.`,
    };
  }

  let ok = 0;
  const hatalar = [];
  for (const item of kayitlar) {
    try {
      if (item.tur === 'hizli_satis_kayit') {
        await pool.request()
          .input('KayitID', sql.Int, item.kayitID)
          .input('Kullanici', sql.NVarChar(50), kullanici)
          .query(`
            UPDATE HizliSatisKayitlari
            SET IptalEdildi = 1, IptalTarihi = GETDATE(), IptalKullanici = @Kullanici
            WHERE KayitID = @KayitID AND IptalEdildi = 0
          `);
        if (item.logID) {
          await kopukIslemKaydet(
            pool,
            kullanici,
            'Hızlı Satış İptal',
            `Log #${item.logID} kopuk kayıt temizliği — HSK #${item.kayitID}`,
          );
        }
      } else if (item.tur === 'musteri_satis_log') {
        await kopukIslemKaydet(
          pool,
          kullanici,
          'Müşteri Satış İptal',
          `Log #${item.logID} kopuk kayıt temizliği — ${item.ad || ''}`.trim(),
        );
      } else if (item.tur === 'musteri_odeme_log') {
        await kopukIslemKaydet(
          pool,
          kullanici,
          'Müşteri Ödeme İptal',
          `Log #${item.logID} kopuk kayıt temizliği — ${item.ad || ''}`.trim(),
        );
      } else if (item.tur === 'hizli_satis_log') {
        await kopukIslemKaydet(
          pool,
          kullanici,
          'Hızlı Satış İptal',
          `Log #${item.logID} kopuk kayıt temizliği — ${item.ad || ''}`.trim(),
        );
      }
      ok += 1;
    } catch (err) {
      hatalar.push(`${item.aciklama}: ${err.message}`);
    }
  }

  return {
    success: hatalar.length === 0,
    dryRun: false,
    bas,
    bit,
    adet: ok,
    toplam: kayitlar.length,
    kayitlar: kayitlar.map((k) => k.aciklama),
    hatalar,
    message:
      hatalar.length === 0
        ? `${ok}/${kayitlar.length} kayıt iptal edildi. Günlük işlemler ekranını yenileyin.`
        : `${ok}/${kayitlar.length} kayıt iptal edildi; ${hatalar.length} hata.`,
  };
}

module.exports = {
  bugunStr,
  gunlukCariKopukKayitlariBul,
  gunlukCariKopukTemizle,
};
