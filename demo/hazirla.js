/**
 * Demo hazırlık: demo/.env → proje kökü, demo kullanıcısı oluştur.
 * Çalıştırma: node demo/hazirla.js
 */
const fs = require('fs');
const path = require('path');
const { sql, poolPromise } = require('./db-demo');

const PROJE_KOK = path.join(__dirname, '..');
const DEMO_ENV = path.join(__dirname, '.env');
const KOK_ENV = path.join(PROJE_KOK, '.env');

async function demoKullaniciOlustur(pool) {
  const kontrol = await pool.request()
    .input('KullaniciAdi', sql.NVarChar(50), 'demo')
    .query('SELECT TOP 1 KullaniciID FROM Kullanicilar WHERE KullaniciAdi = @KullaniciAdi');
  if (kontrol.recordset.length) {
    return { olusturuldu: false, mesaj: 'demo kullanıcısı zaten var.' };
  }
  await pool.request()
    .input('AdSoyad', sql.NVarChar(100), 'Demo Kullanıcı')
    .input('KullaniciAdi', sql.NVarChar(50), 'demo')
    .input('Yetki', sql.NVarChar(50), 'Admin')
    .input('Sifre', sql.NVarChar(255), 'demo123')
    .query(`
      INSERT INTO Kullanicilar (AdSoyad, KullaniciAdi, Yetki, Sifre)
      VALUES (@AdSoyad, @KullaniciAdi, @Yetki, @Sifre)
    `);
  return { olusturuldu: true, mesaj: 'demo / demo123 kullanıcısı oluşturuldu.' };
}

async function main() {
  if (!fs.existsSync(DEMO_ENV)) {
    console.error('[DEMO] demo/.env bulunamadı.');
    process.exit(1);
  }
  fs.copyFileSync(DEMO_ENV, KOK_ENV);
  console.log('[DEMO] Ayarlar kopyalandı →', KOK_ENV);

  const pool = await poolPromise;
  const dbAd = process.env.DB_NAME || '?';
  const sunucu = process.env.DB_SERVER || '?';
  console.log(`[DEMO] Veritabanı: ${sunucu} / ${dbAd}`);

  try {
    const sonuc = await demoKullaniciOlustur(pool);
    console.log('[DEMO]', sonuc.mesaj);
  } catch (e) {
    console.error('[DEMO] Kullanıcı oluşturulamadı:', e.message || e);
    console.error('       SSMS ile demo/01-demo-kullanici.sql çalıştırabilirsiniz.');
  }

  await pool.close();
  console.log('[DEMO] Hazır. demo\\BASLAT.bat ile programı açın.');
}

main().catch((e) => {
  console.error('[DEMO] Hata:', e.message || e);
  process.exit(1);
});
