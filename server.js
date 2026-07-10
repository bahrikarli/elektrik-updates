const { sql, poolPromise } = require('./db');
const { ensureTedarikciTablolari } = require('./tedarikci-schema');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const packageJson = require('./package.json');
const { semverKarsilastir } = require('./lib/version');
const { urlIcerikIndir, githubReleaseAssetUrl, githubReleaseAssetUrlTahmini } = require('./lib/http');
const { yedekKlasorYolu, yedekDosyaAdi } = require('./lib/backup-paths');
const { sifreHashMi, sifreHashUret, sifreHashDogrula } = require('./lib/password');
const { gunlukCariKopukTemizle } = require('./lib/gunluk-cari-kopuk-temizle');
const { registerUpdateRoutes } = require('./routes/updates');
const { registerBackupRoutes } = require('./routes/backups');
require('./lib/env-yukle').envYukle();

const app = express();
const APP_ROOT = process.pkg ? path.dirname(process.execPath) : __dirname;
const demoLisans = require('./lib/demo-lisans');
const PERAKENDE_ISLEM_ETIKET = 'Perakende İşlem';

function perakendeEtiketMi(ad) {
  const a = String(ad || '').trim();
  return a === PERAKENDE_ISLEM_ETIKET || a === 'Müşterisiz işlem' || a === 'Müşterisiz';
}

function publicKlasoruBul() {
  const adaylar = [
    path.join(APP_ROOT, 'public'),
    path.join(__dirname, 'public'),
    path.join(process.cwd(), 'public'),
  ];
  for (const p of adaylar) {
    try {
      if (fs.existsSync(path.join(p, 'index.html'))) return p;
    } catch (_) {}
  }
  return adaylar[0];
}

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const hdr = String(req.get('x-elektrik-kaynak') || '').trim().toLowerCase();
  const ref = String(req.get('referer') || '');
  req.mobilKaynak = hdr === 'mobil' || ref.includes('/mobil');
  next();
});

demoLisans.ilkCalistirmayiKaydet(APP_ROOT);

app.get('/api/demo-durum', (req, res) => {
  res.json(demoLisans.durum(APP_ROOT));
});

app.use((req, res, next) => {
  if (!demoLisans.yazmaEngelliMi(APP_ROOT)) return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (demoLisans.istekYazmaIzinliMi(req)) return next();
  return res.status(403).json({
    success: false,
    okumaModu: true,
    message: demoLisans.yazmaEngelliMesaj(APP_ROOT),
  });
});

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
const PUBLIC_DIR = publicKlasoruBul();
if (process.pkg) {
  console.log('[ELEKTRIK] public klasoru:', PUBLIC_DIR);
}
const TANITIM_IMG_DIR = path.join(PUBLIC_DIR, 'tanitim-img');
try {
  fs.mkdirSync(TANITIM_IMG_DIR, { recursive: true });
} catch (_) {}

function tanitimImgYanitla(req, res, next) {
  let raw;
  try {
    raw = decodeURIComponent(String(req.params.dosya || ''));
  } catch (_) {
    return next();
  }
  if (!raw || raw.includes('..') || /[/\\]/.test(raw)) return next();
  const dosya = path.basename(raw);
  if (dosya !== raw) return next();
  if (!/\.(png|jpe?g|webp|gif)$/i.test(dosya)) return next();
  const dir = path.resolve(TANITIM_IMG_DIR);
  const tamYol = path.resolve(dir, dosya);
  const rel = path.relative(dir, tamYol);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return next();
  if (!fs.existsSync(tamYol)) return next();
  res.sendFile(tamYol, (err) => {
    if (err && !res.headersSent) next();
  });
}

app.get('/api/tanitim-img/:dosya', tanitimImgYanitla);
app.get('/tanitim-img/:dosya', tanitimImgYanitla);
app.get('/api/tanitim-img-list', (req, res) => {
  try {
    const files = fs.readdirSync(TANITIM_IMG_DIR);
    res.json({ ok: true, klasor: TANITIM_IMG_DIR, dosyalar: files });
  } catch (e) {
    res.status(500).json({ ok: false, klasor: TANITIM_IMG_DIR, hata: e.message || String(e) });
  }
});
app.use(express.static(PUBLIC_DIR, {
  index: 'index.html',
  etag: false,
  lastModified: false,
  maxAge: 0,
}));
const MOBIL_DIR = path.join(PUBLIC_DIR, 'mobil');
app.get('/mobil', (req, res, next) => {
  const mobilIndex = path.join(MOBIL_DIR, 'index.html');
  if (!fs.existsSync(mobilIndex)) {
    return res.status(404).type('html').send('<h1>Mobil arayüz bulunamadı</h1><p>public/mobil klasörünü kontrol edin.</p>');
  }
  res.sendFile(mobilIndex, (err) => { if (err) next(err); });
});
app.use('/mobil', express.static(MOBIL_DIR, {
  index: false,
  etag: false,
  lastModified: false,
  maxAge: 0,
}));

app.get('/', (req, res, next) => {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return res.status(503).type('html').send(
      '<h1>public klasoru eksik</h1><p>EXE yanina <code>public</code> klasorunu kopyalayin veya EXE-URET.bat calistirin.</p>'
      + `<p>Aranan: ${indexPath.replace(/</g, '')}</p>`
    );
  }
  res.sendFile(indexPath, (err) => { if (err) next(err); });
});
app.get('/favicon.ico', (req, res) => res.status(204).end());

const YEDEK_TABLOLAR = [
  { name: 'Kullanicilar', identity: true },
  { name: 'SistemAyarlar', identity: false },
  { name: 'Musteriler', identity: true },
  { name: 'Stok', identity: true },
  { name: 'Tedarikciler', identity: true },
  { name: 'Teklifler', identity: true },
  { name: 'TeklifKalemler', identity: true },
  { name: 'MusteriHareketleri', identity: true },
  { name: 'MusteriHareketDetaylari', identity: true },
  { name: 'MusteriTaksitPlanlari', identity: true },
  { name: 'MusteriTaksitler', identity: true },
  { name: 'TedarikAlim', identity: true },
  { name: 'TedarikAlimSatir', identity: true },
  { name: 'TedarikciOdeme', identity: true },
  { name: 'GenelGider', identity: true },
  { name: 'ServisIsleri', identity: true },
  { name: 'KasaHareketleri', identity: true },
  { name: 'IslemGecmisi', identity: true },
];

function varsayilanGuncellemeManifestUrl() {
  const repoUrl = String(packageJson?.repository?.url || packageJson?.repository || '');
  const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/guncelleme.json`;
  }
  return 'https://github.com/bahrikarli/elektrik-updates/releases/latest/download/guncelleme.json';
}

async function guncellemeManifestOku() {
  const currentVersion = String(packageJson?.version || '0.0.0');
  const envUrl = String(process.env.UPDATE_MANIFEST_URL || '').trim();
  if (envUrl === '0' || envUrl.toLowerCase() === 'off') {
    return {
      success: true,
      configured: false,
      currentVersion,
      updateAvailable: false,
      message: 'Güncelleme kontrolü kapalı (UPDATE_MANIFEST_URL=off).',
    };
  }
  const manifestUrl = envUrl || varsayilanGuncellemeManifestUrl();
  let manifestBuffer = null;
  try {
    manifestBuffer = await urlIcerikIndir(manifestUrl);
  } catch (e) {
    return {
      success: false,
      configured: true,
      currentVersion,
      message: `Manifest alınamadı (${e?.message || 'hata'}).`,
    };
  }
  let m = null;
  try {
    m = JSON.parse(String(manifestBuffer || ''));
  } catch (_) {
    m = null;
  }
  const remoteVersion = String(m?.version || '').trim();
  let updateUrl = String(m?.url || '').trim();
  const repo = String(m?.repo || '').trim();
  const tag = String(m?.tag || `v${remoteVersion}`).trim();
  const assetName = String(m?.assetName || `elektrik-otomasyon-${remoteVersion}.zip`).trim();
  if (!updateUrl && repo && tag && assetName) {
    try {
      updateUrl = String(await githubReleaseAssetUrl(repo, tag, assetName) || '').trim();
    } catch (_) {
      updateUrl = '';
    }
    if (!updateUrl) {
      updateUrl = String(githubReleaseAssetUrlTahmini(repo, tag, assetName) || '').trim();
    }
  }
  const notes = String(m?.notes || '').trim();
  if (!remoteVersion) {
    return {
      success: false,
      configured: true,
      currentVersion,
      message: 'Manifest içinde version alanı yok.',
    };
  }
  const cmp = semverKarsilastir(remoteVersion, currentVersion);
  return {
    success: true,
    configured: true,
    currentVersion,
    remoteVersion,
    updateAvailable: cmp > 0,
    updateUrl: updateUrl || null,
    repo: repo || null,
    tag: tag || null,
    assetName: assetName || null,
    updateSource: updateUrl ? (m?.url ? 'manifest-url' : 'github-release-auto') : null,
    notes: notes || null,
    checkedAt: new Date().toISOString(),
  };
}

async function tabloVarMi(pool, tableName) {
  const rs = await pool.request()
    .input('TableName', sql.NVarChar(128), tableName)
    .query(`
      SELECT 1 AS VarMi
      WHERE OBJECT_ID(CONCAT('dbo.', @TableName), 'U') IS NOT NULL
    `);
  return !!rs.recordset.length;
}

async function sifreDogrulaVeGerekirseYukselt(pool, kullaniciID, kayitliSifre, girilenSifre) {
  const stored = String(kayitliSifre || '');
  const plain = String(girilenSifre || '');
  if (!stored || !plain) return false;

  if (sifreHashMi(stored)) return sifreHashDogrula(stored, plain);

  if (stored !== plain) return false;

  // Eski düz şifreli kaydı girişte güvenli hash'e yükselt.
  const yeniHash = sifreHashUret(plain);
  await pool.request()
    .input('KullaniciID', sql.Int, Number(kullaniciID))
    .input('Sifre', sql.NVarChar(255), yeniHash)
    .query('UPDATE Kullanicilar SET Sifre = @Sifre WHERE KullaniciID = @KullaniciID');
  return true;
}

async function ensureMusteriHareketTablosu(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.MusteriHareketleri', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.MusteriHareketleri (
        HareketID INT IDENTITY(1,1) PRIMARY KEY,
        MusteriID INT NOT NULL,
        Tur NVARCHAR(20) NOT NULL,
        ToplamTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_MusteriHareket_Toplam DEFAULT 0,
        OdenenTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_MusteriHareket_Odenen DEFAULT 0,
        KalanTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_MusteriHareket_Kalan DEFAULT 0,
        OdemeSekli NVARCHAR(20) NULL,
        Aciklama NVARCHAR(500) NULL,
        Kullanici NVARCHAR(50) NULL,
        Referans NVARCHAR(40) NULL,
        Tarih DATETIME NOT NULL CONSTRAINT DF_MusteriHareket_Tarih DEFAULT GETDATE()
      );
      CREATE INDEX IX_MusteriHareketleri_MusteriID_Tarih
        ON dbo.MusteriHareketleri (MusteriID, Tarih DESC);
    END
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.MusteriHareketleri', 'MakbuzKalanBakiye') IS NULL
      ALTER TABLE dbo.MusteriHareketleri ADD MakbuzKalanBakiye DECIMAL(18,2) NULL;
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.MusteriHareketleri', 'MakbuzNo') IS NULL
      ALTER TABLE dbo.MusteriHareketleri ADD MakbuzNo INT NULL;
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.MusteriHareketDetaylari', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.MusteriHareketDetaylari (
        DetayID INT IDENTITY(1,1) PRIMARY KEY,
        HareketID INT NOT NULL,
        StokID INT NULL,
        UrunAdi NVARCHAR(150) NOT NULL,
        Miktar INT NOT NULL,
        BirimFiyat DECIMAL(18,2) NOT NULL,
        SatirTutar DECIMAL(18,2) NOT NULL
      );
      CREATE INDEX IX_MusteriHareketDetaylari_HareketID
        ON dbo.MusteriHareketDetaylari (HareketID);
    END
  `);
}

async function ensureHizliSatisKayitTablosu(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.HizliSatisKayitlari', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.HizliSatisKayitlari (
        KayitID INT IDENTITY(1,1) PRIMARY KEY,
        LogID INT NULL,
        MusteriID INT NULL,
        Referans NVARCHAR(40) NULL,
        OdemeSekli NVARCHAR(20) NOT NULL,
        SepetToplam DECIMAL(18,2) NOT NULL,
        TahsilatTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_HSK_Tahsilat DEFAULT 0,
        Kullanici NVARCHAR(50) NULL,
        IptalEdildi BIT NOT NULL CONSTRAINT DF_HSK_Iptal DEFAULT 0,
        IptalTarihi DATETIME NULL,
        IptalKullanici NVARCHAR(50) NULL,
        Tarih DATETIME NOT NULL CONSTRAINT DF_HSK_Tarih DEFAULT GETDATE()
      );
      CREATE INDEX IX_HizliSatisKayitlari_LogID ON dbo.HizliSatisKayitlari (LogID);
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.HizliSatisKayitDetaylari', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.HizliSatisKayitDetaylari (
        DetayID INT IDENTITY(1,1) PRIMARY KEY,
        KayitID INT NOT NULL,
        StokID INT NULL,
        UrunAdi NVARCHAR(150) NOT NULL,
        Miktar INT NOT NULL,
        BirimFiyat DECIMAL(18,2) NOT NULL,
        SatirTutar DECIMAL(18,2) NOT NULL
      );
      CREATE INDEX IX_HizliSatisKayitDetaylari_KayitID ON dbo.HizliSatisKayitDetaylari (KayitID);
    END
  `);
}

async function ensureMusteriEkAlanlari(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Musteriler', 'Il') IS NULL
      ALTER TABLE dbo.Musteriler ADD Il NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'Ilce') IS NULL
      ALTER TABLE dbo.Musteriler ADD Ilce NVARCHAR(60) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'TanimAdi') IS NULL
      ALTER TABLE dbo.Musteriler ADD TanimAdi NVARCHAR(120) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'Mahalle') IS NULL
      ALTER TABLE dbo.Musteriler ADD Mahalle NVARCHAR(120) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'tur') IS NULL
      ALTER TABLE dbo.Musteriler ADD tur NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'tcno') IS NULL
      ALTER TABLE dbo.Musteriler ADD tcno NVARCHAR(11) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'vergino') IS NULL
      ALTER TABLE dbo.Musteriler ADD vergino NVARCHAR(20) NULL;
    IF COL_LENGTH('dbo.Musteriler', 'yetkili') IS NULL
      ALTER TABLE dbo.Musteriler ADD yetkili NVARCHAR(120) NULL;
  `);
}

function musteriTurNormalize(tur) {
  const t = String(tur || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g');
  if (t === 'tuzel' || t === 'kurumsal' || t === 'sirket') return 'Tuzel';
  return 'Gercek';
}

function musteriGorunenAdKayit(row) {
  if (!row) return 'Müşteri';
  if (musteriTurNormalize(row.tur) === 'Tuzel') {
    return String(row.FirmaAdi || row.yetkili || row.AdSoyad || 'Tüzel müşteri').trim();
  }
  return String(row.AdSoyad || row.FirmaAdi || 'Müşteri').trim();
}

function musteriKayitDogrula(body) {
  const tur = musteriTurNormalize(body?.tur);
  let telefonRaw = String(body?.Telefon || '').replace(/\D/g, '').trim();
  if (telefonRaw.startsWith('0')) telefonRaw = telefonRaw.slice(1);
  if (telefonRaw && !/^[1-9][0-9]{9}$/.test(telefonRaw)) {
    return { ok: false, message: 'Cep telefonu 10 haneli olmalı ve 0 ile başlamamalı.' };
  }
  if (tur === 'Tuzel') {
    const firma = String(body?.FirmaAdi || '').trim();
    const vergi = String(body?.vergino || '').replace(/\D/g, '');
    const yetkili = String(body?.yetkili || '').trim();
    if (!firma) return { ok: false, message: 'Tüzel kişi için firma ünvanı zorunludur.' };
    if (!yetkili) return { ok: false, message: 'Tüzel kişi için yetkili kişi zorunludur.' };
    if (vergi && vergi.length !== 10) return { ok: false, message: 'Vergi numarası 10 haneli olmalıdır.' };
    return {
      ok: true,
      tur,
      telefonRaw,
      FirmaAdi: firma,
      AdSoyad: String(body?.yetkili || firma).trim().substring(0, 100),
      yetkili: String(body?.yetkili || '').trim() || null,
      vergino: vergi || null,
      tcno: null,
    };
  }
  const ad = String(body?.AdSoyad || '').trim();
  const tc = String(body?.tcno || '').replace(/\D/g, '');
  if (!ad) return { ok: false, message: 'Gerçek kişi için ad soyad zorunludur.' };
  if (tc && tc.length !== 11) return { ok: false, message: 'T.C. kimlik numarası 11 haneli olmalıdır.' };
  return {
    ok: true,
    tur,
    telefonRaw,
    AdSoyad: ad.substring(0, 100),
    FirmaAdi: null,
    yetkili: null,
    vergino: null,
    tcno: tc || null,
  };
}

async function ensureSistemAyarTablosu(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.SistemAyarlar', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.SistemAyarlar (
        AyarID INT NOT NULL PRIMARY KEY,
        OtomatikMakbuz BIT NOT NULL CONSTRAINT DF_SistemAyarlar_OtoMakbuz DEFAULT 0,
        MakbuzSonNo INT NOT NULL CONSTRAINT DF_SistemAyarlar_MakbuzSonNo DEFAULT 0,
        SirketUnvan NVARCHAR(200) NULL,
        SirketYetkiliAdSoyad NVARCHAR(120) NULL,
        SirketVergiNo NVARCHAR(40) NULL,
        SirketTelefon NVARCHAR(40) NULL,
        SirketAdres NVARCHAR(300) NULL
      );
      INSERT INTO dbo.SistemAyarlar (AyarID, OtomatikMakbuz, MakbuzSonNo)
      VALUES (1, 0, 0);
    END
    IF COL_LENGTH('dbo.SistemAyarlar', 'SirketYetkiliAdSoyad') IS NULL
      ALTER TABLE dbo.SistemAyarlar ADD SirketYetkiliAdSoyad NVARCHAR(120) NULL;
  `);
}

async function ensureStokSeviyeAlanlari(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Stok', 'KritikEsik') IS NULL
      ALTER TABLE dbo.Stok ADD KritikEsik INT NULL;
    IF COL_LENGTH('dbo.Stok', 'HedefEsik') IS NULL
      ALTER TABLE dbo.Stok ADD HedefEsik INT NULL;
  `);
}

/** İşçilik / hizmet cari satışları için varsayılan stok kartı (stok düşmez sayılmaz; yüksek miktar). */
async function ensureIscilikBedeliStokKarti(pool) {
  const urunAdi = 'İŞÇİLİK BEDELİ';
  const barkod = 'ISCILIK';
  const varRs = await pool.request()
    .input('UrunAdi', sql.NVarChar(150), urunAdi)
    .input('Barkod', sql.NVarChar(50), barkod)
    .query(`
      SELECT TOP 1 StokID, UrunAdi, Kategori, MevcutMiktar
      FROM Stok
      WHERE UrunAdi = @UrunAdi OR Barkod = @Barkod
      ORDER BY StokID ASC
    `);
  if (varRs.recordset.length > 0) {
    const row = varRs.recordset[0];
    await pool.request()
      .input('StokID', sql.Int, row.StokID)
      .input('Kategori', sql.NVarChar(50), 'Hizmet')
      .input('Birim', sql.NVarChar(20), 'Adet')
      .query(`
        UPDATE Stok
        SET Kategori = @Kategori,
            Birim = COALESCE(NULLIF(LTRIM(RTRIM(Birim)), N''), @Birim),
            MevcutMiktar = CASE WHEN ISNULL(MevcutMiktar, 0) < 1000 THEN 999999 ELSE MevcutMiktar END
        WHERE StokID = @StokID
      `);
    return row.StokID;
  }
  const ins = await pool.request()
    .input('UrunAdi', sql.NVarChar(150), urunAdi)
    .input('Kategori', sql.NVarChar(50), 'Hizmet')
    .input('Barkod', sql.NVarChar(50), barkod)
    .input('AlisFiyati', sql.Decimal(18, 2), 0)
    .input('SatisFiyati', sql.Decimal(18, 2), 0)
    .input('MevcutMiktar', sql.Int, 999999)
    .input('Birim', sql.NVarChar(20), 'Adet')
    .input('KritikEsik', sql.Int, 0)
    .input('HedefEsik', sql.Int, 0)
    .query(`
      INSERT INTO Stok (UrunAdi, Kategori, Barkod, AlisFiyati, SatisFiyati, MevcutMiktar, Birim, KritikEsik, HedefEsik)
      OUTPUT INSERTED.StokID
      VALUES (@UrunAdi, @Kategori, @Barkod, @AlisFiyati, @SatisFiyati, @MevcutMiktar, @Birim, @KritikEsik, @HedefEsik)
    `);
  const yeniId = ins.recordset[0]?.StokID;
  console.log(`[Stok] "${urunAdi}" kartı oluşturuldu (StokID: ${yeniId}, barkod: ${barkod}).`);
  return yeniId;
}

/** Satışta stok sıfır olsa bile düşürülür; gerekirse eksiye iner. */
async function stokSatisDusurTxn(transaction, stokID, miktar) {
  const rqUpd = new sql.Request(transaction);
  rqUpd.input('ID', sql.Int, stokID);
  rqUpd.input('Miktar', sql.Int, miktar);
  const upd = await rqUpd.query(`
    UPDATE Stok SET MevcutMiktar = MevcutMiktar - @Miktar WHERE StokID = @ID
  `);
  return (upd.rowsAffected[0] || 0) > 0;
}

async function ensureKullaniciSifreKolonu(pool) {
  await pool.request().query(`
    IF COL_LENGTH('dbo.Kullanicilar', 'Sifre') IS NOT NULL
    BEGIN
      DECLARE @len INT = (
        SELECT CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Kullanicilar' AND COLUMN_NAME = 'Sifre'
      );
      IF ISNULL(@len, 0) > 0 AND @len < 255
        ALTER TABLE dbo.Kullanicilar ALTER COLUMN Sifre NVARCHAR(255) NOT NULL;
    END
  `);
}

async function ensureTeklifTablolari(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.Teklifler', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.Teklifler (
        TeklifID INT IDENTITY(1,1) PRIMARY KEY,
        MusteriID INT NULL,
        MusteriAdi NVARCHAR(200) NULL,
        Baslik NVARCHAR(200) NULL,
        Yontem NVARCHAR(20) NOT NULL CONSTRAINT DF_Teklif_Yontem DEFAULT N'Toplu',
        ToplamTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_Teklif_Toplam DEFAULT 0,
        Aciklama NVARCHAR(500) NULL,
        Durum NVARCHAR(30) NOT NULL CONSTRAINT DF_Teklif_Durum DEFAULT N'Hazırlandı',
        Kullanici NVARCHAR(50) NULL,
        Tarih DATETIME NOT NULL CONSTRAINT DF_Teklif_Tarih DEFAULT GETDATE()
      );
      CREATE INDEX IX_Teklifler_MusteriID_Tarih ON dbo.Teklifler(MusteriID, Tarih DESC);
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.TeklifKalemler', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TeklifKalemler (
        KalemID INT IDENTITY(1,1) PRIMARY KEY,
        TeklifID INT NOT NULL,
        UrunAdi NVARCHAR(200) NOT NULL,
        Miktar DECIMAL(18,2) NOT NULL CONSTRAINT DF_TeklifKalem_Miktar DEFAULT 1,
        Birim NVARCHAR(20) NULL,
        BirimFiyat DECIMAL(18,2) NOT NULL CONSTRAINT DF_TeklifKalem_BF DEFAULT 0,
        SatirTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_TeklifKalem_ST DEFAULT 0,
        CONSTRAINT FK_TeklifKalem_Teklif FOREIGN KEY (TeklifID) REFERENCES dbo.Teklifler(TeklifID) ON DELETE CASCADE
      );
      CREATE INDEX IX_TeklifKalem_TeklifID ON dbo.TeklifKalemler(TeklifID);
    END
  `);
  await pool.request().query(`
    IF COL_LENGTH('dbo.Teklifler', 'CariHareketID') IS NULL
      ALTER TABLE dbo.Teklifler ADD CariHareketID INT NULL;
  `);
}

async function nextMakbuzNoTxn(transaction) {
  const rs = await new sql.Request(transaction).query(`
    UPDATE dbo.SistemAyarlar
    SET MakbuzSonNo = ISNULL(MakbuzSonNo, 0) + 1
    OUTPUT INSERTED.MakbuzSonNo AS YeniNo
    WHERE AyarID = 1
  `);
  return Number(rs.recordset[0]?.YeniNo || 0);
}

async function ensureMusteriTaksitTablolari(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.MusteriTaksitPlanlari', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.MusteriTaksitPlanlari (
        PlanID INT IDENTITY(1,1) PRIMARY KEY,
        MusteriID INT NOT NULL,
        BaslangicTarihi DATE NOT NULL,
        TaksitSayisi INT NOT NULL,
        ToplamBorc DECIMAL(18,2) NOT NULL,
        KalanBorc DECIMAL(18,2) NOT NULL,
        Durum NVARCHAR(20) NOT NULL CONSTRAINT DF_MusteriTaksitPlan_Durum DEFAULT N'Aktif',
        Aciklama NVARCHAR(255) NULL,
        Kullanici NVARCHAR(50) NULL,
        OlusturmaTarihi DATETIME NOT NULL CONSTRAINT DF_MusteriTaksitPlan_Tarih DEFAULT GETDATE()
      );
      CREATE INDEX IX_MusteriTaksitPlanlari_MusteriID ON dbo.MusteriTaksitPlanlari (MusteriID, Durum);
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.MusteriTaksitler', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.MusteriTaksitler (
        TaksitID INT IDENTITY(1,1) PRIMARY KEY,
        PlanID INT NOT NULL,
        MusteriID INT NOT NULL,
        TaksitNo INT NOT NULL,
        VadeTarihi DATE NOT NULL,
        Tutar DECIMAL(18,2) NOT NULL,
        OdenenTutar DECIMAL(18,2) NOT NULL CONSTRAINT DF_MusteriTaksit_Odenen DEFAULT 0,
        KalanTutar DECIMAL(18,2) NOT NULL,
        Durum NVARCHAR(20) NOT NULL CONSTRAINT DF_MusteriTaksit_Durum DEFAULT N'Bekliyor',
        SonOdemeTarihi DATETIME NULL
      );
      CREATE INDEX IX_MusteriTaksitler_MusteriID ON dbo.MusteriTaksitler (MusteriID, Durum, VadeTarihi);
    END
  `);
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.MusteriTaksitOdemeDagilimlari', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.MusteriTaksitOdemeDagilimlari (
        DagilimID INT IDENTITY(1,1) PRIMARY KEY,
        HareketID INT NOT NULL,
        PlanID INT NOT NULL,
        TaksitID INT NOT NULL,
        Tutar DECIMAL(18,2) NOT NULL
      );
      CREATE INDEX IX_MusteriTaksitOdemeDagilim_HareketID ON dbo.MusteriTaksitOdemeDagilimlari (HareketID);
      CREATE INDEX IX_MusteriTaksitOdemeDagilim_TaksitID ON dbo.MusteriTaksitOdemeDagilimlari (TaksitID);
    END
  `);
}

async function taksitTahsilatDagitTxn(transaction, musteriID, odemeTutar, odemeSekli, kullanici) {
  let kalan = Number(odemeTutar || 0);
  if (!Number.isFinite(kalan) || kalan <= 0) return { tahsilEdilen: 0, taksitAdedi: 0, detayMetin: '', odemeHareketID: null };

  const planRs = await new sql.Request(transaction)
    .input('MusteriID', sql.Int, musteriID)
    .query(`
      SELECT TOP 1 PlanID
      FROM MusteriTaksitPlanlari
      WHERE MusteriID = @MusteriID AND Durum = N'Aktif' AND KalanBorc > 0
      ORDER BY PlanID DESC
    `);
  const aktifPlanID = planRs.recordset[0]?.PlanID;
  if (!aktifPlanID) return { tahsilEdilen: 0, taksitAdedi: 0, dagilim: [], detayMetin: '', odemeHareketID: null };

  const rs = await new sql.Request(transaction)
    .input('MusteriID', sql.Int, musteriID)
    .input('PlanID', sql.Int, aktifPlanID)
    .query(`
      SELECT TaksitID, PlanID, TaksitNo, KalanTutar
      FROM MusteriTaksitler
      WHERE MusteriID = @MusteriID AND PlanID = @PlanID AND KalanTutar > 0
      ORDER BY VadeTarihi ASC, TaksitNo ASC, TaksitID ASC
    `);
  const taksitler = rs.recordset || [];
  let tahsil = 0;
  let etkilenen = 0;
  const dagilimSatirlari = [];
  const dagilimKayitlari = [];
  const dagilimDetay = [];

  for (const t of taksitler) {
    if (kalan <= 0) break;
    const pay = Math.min(kalan, Number(t.KalanTutar || 0));
    if (pay <= 0) continue;
    const taksitKalanOnce = Number(t.KalanTutar || 0);
    await new sql.Request(transaction)
      .input('TaksitID', sql.Int, t.TaksitID)
      .input('Pay', sql.Decimal(18, 2), pay)
      .query(`
        UPDATE MusteriTaksitler
        SET OdenenTutar = OdenenTutar + @Pay,
            KalanTutar = KalanTutar - @Pay,
            Durum = CASE WHEN (KalanTutar - @Pay) <= 0 THEN N'Odendi' ELSE N'Bekliyor' END,
            SonOdemeTarihi = GETDATE()
        WHERE TaksitID = @TaksitID
      `);
    await new sql.Request(transaction)
      .input('PlanID', sql.Int, t.PlanID)
      .input('Pay', sql.Decimal(18, 2), pay)
      .query(`
        UPDATE MusteriTaksitPlanlari
        SET KalanBorc = KalanBorc - @Pay,
            Durum = CASE WHEN (KalanBorc - @Pay) <= 0 THEN N'Tamamlandi' ELSE N'Aktif' END
        WHERE PlanID = @PlanID
      `);
    kalan = Math.round((kalan - pay) * 100) / 100;
    tahsil += pay;
    etkilenen += 1;
    const kismi = pay < taksitKalanOnce;
    dagilimSatirlari.push(`T${t.TaksitNo}: ${pay.toFixed(2)}₺${kismi ? ' (kalan)' : ''}`);
    dagilimKayitlari.push({ PlanID: t.PlanID, TaksitID: t.TaksitID, Tutar: pay });
    dagilimDetay.push({
      taksitNo: Number(t.TaksitNo || 0),
      once: taksitKalanOnce,
      pay,
      sonra: Math.round((taksitKalanOnce - pay) * 100) / 100,
      kismi,
    });
  }

  let dagilimTxt = '';
  let odemeHareketID = null;
  if (tahsil > 0) {
    const fullNos = dagilimDetay.filter((d) => !d.kismi).map((d) => d.taksitNo).sort((a, b) => a - b);
    const partial = dagilimDetay.find((d) => d.kismi);
    const tlFmt = (n) => Number(n || 0).toFixed(2).replace('.', ',');
    if (fullNos.length) {
      dagilimTxt += `${fullNos.join('/')}.taksit ödendi`;
    }
    if (partial) {
      if (dagilimTxt) dagilimTxt += ', ';
      dagilimTxt += `${partial.taksitNo}.taksit kalan ${tlFmt(partial.sonra)} TL`;
    }
    if (!dagilimTxt) {
      dagilimTxt = `${etkilenen} taksit etkilendi`;
    }
    const odemeIns = await new sql.Request(transaction)
      .input('MusteriID', sql.Int, musteriID)
      .input('Tur', sql.NVarChar(20), 'Odeme')
      .input('ToplamTutar', sql.Decimal(18, 2), 0)
      .input('OdenenTutar', sql.Decimal(18, 2), tahsil)
      .input('KalanTutar', sql.Decimal(18, 2), 0)
      .input('OdemeSekli', sql.NVarChar(20), odemeSekli)
      .input('Aciklama', sql.NVarChar(500), `Taksit tahsilatı: ${dagilimTxt}`.substring(0, 500))
      .input('MakbuzKalanBakiye', sql.Decimal(18, 2), null)
      .input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50))
      .input('Referans', sql.NVarChar(40), `taksit-odeme:${musteriID}:${Date.now()}`.substring(0, 40))
      .query(`
        INSERT INTO MusteriHareketleri
          (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, MakbuzKalanBakiye, Kullanici, Referans)
        OUTPUT INSERTED.HareketID
        VALUES
          (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @MakbuzKalanBakiye, @Kullanici, @Referans)
      `);
    const hareketID = odemeIns.recordset[0]?.HareketID;
    odemeHareketID = hareketID || null;
    if (hareketID && dagilimKayitlari.length) {
      for (const d of dagilimKayitlari) {
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, hareketID)
          .input('PlanID', sql.Int, d.PlanID)
          .input('TaksitID', sql.Int, d.TaksitID)
          .input('Tutar', sql.Decimal(18, 2), d.Tutar)
          .query(`
            INSERT INTO MusteriTaksitOdemeDagilimlari (HareketID, PlanID, TaksitID, Tutar)
            VALUES (@HareketID, @PlanID, @TaksitID, @Tutar)
          `);
      }
    }
  }
  return {
    tahsilEdilen: Math.round(tahsil * 100) / 100,
    taksitAdedi: etkilenen,
    dagilim: dagilimDetay,
    detayMetin: dagilimTxt,
    odemeHareketID,
  };
}

async function taksitPlaniOlusturTxn(transaction, musteriID, baslangicTarihi, adet, toplam, aciklama, kullanici) {
  const rqPlan = new sql.Request(transaction);
  rqPlan.input('MusteriID', sql.Int, musteriID);
  rqPlan.input('BaslangicTarihi', sql.Date, new Date(`${baslangicTarihi}T00:00:00`));
  rqPlan.input('TaksitSayisi', sql.Int, adet);
  rqPlan.input('ToplamBorc', sql.Decimal(18, 2), toplam);
  rqPlan.input('KalanBorc', sql.Decimal(18, 2), toplam);
  rqPlan.input('Aciklama', sql.NVarChar(255), (aciklama || '').trim().substring(0, 255) || null);
  rqPlan.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
  const insPlan = await rqPlan.query(`
    INSERT INTO MusteriTaksitPlanlari
      (MusteriID, BaslangicTarihi, TaksitSayisi, ToplamBorc, KalanBorc, Durum, Aciklama, Kullanici)
    OUTPUT INSERTED.PlanID
    VALUES
      (@MusteriID, @BaslangicTarihi, @TaksitSayisi, @ToplamBorc, @KalanBorc, N'Aktif', @Aciklama, @Kullanici)
  `);
  const planID = insPlan.recordset[0]?.PlanID;
  const aylik = Math.floor((toplam / adet) * 100) / 100;
  let kalanDagit = Math.round((toplam - (aylik * adet)) * 100) / 100;
  for (let i = 1; i <= adet; i += 1) {
    let taksitTutar = aylik;
    if (kalanDagit > 0) {
      taksitTutar = Math.round((taksitTutar + 0.01) * 100) / 100;
      kalanDagit = Math.round((kalanDagit - 0.01) * 100) / 100;
    }
    await new sql.Request(transaction)
      .input('PlanID', sql.Int, planID)
      .input('MusteriID', sql.Int, musteriID)
      .input('TaksitNo', sql.Int, i)
      .input('VadeTarihi', sql.Date, new Date(`${baslangicTarihi}T00:00:00`))
      .input('Tutar', sql.Decimal(18, 2), taksitTutar)
      .input('KalanTutar', sql.Decimal(18, 2), taksitTutar)
      .query(`
        INSERT INTO MusteriTaksitler
          (PlanID, MusteriID, TaksitNo, VadeTarihi, Tutar, OdenenTutar, KalanTutar, Durum)
        VALUES
          (@PlanID, @MusteriID, @TaksitNo, DATEADD(MONTH, @TaksitNo-1, @VadeTarihi), @Tutar, 0, @KalanTutar, N'Bekliyor')
      `);
  }
  return planID;
}

// ==========================================
// --- STOK İŞLEMLERİ ---
// ==========================================

function stokBarkodBosMu(barkod) {
  const s = String(barkod ?? '').trim();
  return !s || s === '-' || s === '—';
}

function stokEan13KontrolHanesi(onIkiHane) {
  const d = String(onIkiHane).replace(/\D/g, '').slice(0, 12).padStart(12, '0');
  let tek = 0;
  let cift = 0;
  for (let i = 0; i < 12; i += 1) {
    if (i % 2 === 0) tek += parseInt(d[i], 10);
    else cift += parseInt(d[i], 10);
  }
  const toplam = tek + cift * 3;
  return String((10 - (toplam % 10)) % 10);
}

/** StokID tabanlı benzersiz EAN-13 (869 Türkiye ön eki). */
function stokEan13BarkodUret(stokID) {
  const govde = `869${String(stokID).padStart(9, '0').slice(-9)}`;
  return govde + stokEan13KontrolHanesi(govde);
}

app.post('/api/stok/barkod-uret', async (req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request().query(`
      SELECT StokID, UrunAdi, Barkod, SatisFiyati, Birim
      FROM Stok
      ORDER BY UrunAdi ASC
    `);
    const kayitlar = rs.recordset || [];
    const kullanilan = new Set(
      kayitlar
        .filter((r) => !stokBarkodBosMu(r.Barkod))
        .map((r) => String(r.Barkod).trim()),
    );
    const guncellenen = [];
    for (const row of kayitlar) {
      if (!stokBarkodBosMu(row.Barkod)) continue;
      let yeni = stokEan13BarkodUret(row.StokID);
      let deneme = 0;
      while (kullanilan.has(yeni) && deneme < 20) {
        deneme += 1;
        yeni = stokEan13BarkodUret(row.StokID + deneme * 97);
      }
      if (kullanilan.has(yeni)) {
        return res.status(409).json({ success: false, message: 'Benzersiz barkod üretilemedi.' });
      }
      await pool.request()
        .input('StokID', sql.Int, row.StokID)
        .input('Barkod', sql.NVarChar(50), yeni)
        .query('UPDATE Stok SET Barkod = @Barkod WHERE StokID = @StokID');
      kullanilan.add(yeni);
      guncellenen.push({
        StokID: row.StokID,
        UrunAdi: row.UrunAdi,
        Barkod: yeni,
        SatisFiyati: row.SatisFiyati,
        Birim: row.Birim,
      });
    }
    if (guncellenen.length) {
      await islemKaydet(
        req.body?.kullanici || 'Sistem',
        'Stok Barkod',
        `${guncellenen.length} ürüne barkod atandı`,
      );
    }
    res.json({ success: true, count: guncellenen.length, urunler: guncellenen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Barkod üretilemedi.' });
  }
});

app.post('/api/stok/:id/barkod-uret', async (req, res) => {
  try {
    const stokID = parseInt(req.params.id, 10);
    if (!Number.isFinite(stokID) || stokID <= 0) {
      return res.status(400).json({ success: false, message: 'Geçersiz stok.' });
    }
    const pool = await poolPromise;
    const rs = await pool.request()
      .input('StokID', sql.Int, stokID)
      .query(`
        SELECT StokID, UrunAdi, Barkod, SatisFiyati, Birim
        FROM Stok WHERE StokID = @StokID
      `);
    const row = rs.recordset[0];
    if (!row) {
      return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }
    if (!stokBarkodBosMu(row.Barkod)) {
      const mevcut = String(row.Barkod).trim();
      return res.json({
        success: true,
        barkod: mevcut,
        zatenVardi: true,
        urun: {
          StokID: row.StokID,
          UrunAdi: row.UrunAdi,
          Barkod: mevcut,
          SatisFiyati: row.SatisFiyati,
          Birim: row.Birim,
        },
      });
    }
    const digerRs = await pool.request()
      .input('StokID', sql.Int, stokID)
      .query(`
        SELECT Barkod FROM Stok
        WHERE StokID <> @StokID AND Barkod IS NOT NULL AND LTRIM(RTRIM(Barkod)) <> ''
      `);
    const kullanilan = new Set(
      (digerRs.recordset || [])
        .map((r) => String(r.Barkod).trim())
        .filter(Boolean),
    );
    let yeni = stokEan13BarkodUret(stokID);
    let deneme = 0;
    while (kullanilan.has(yeni) && deneme < 20) {
      deneme += 1;
      yeni = stokEan13BarkodUret(stokID + deneme * 97);
    }
    if (kullanilan.has(yeni)) {
      return res.status(409).json({ success: false, message: 'Benzersiz barkod üretilemedi.' });
    }
    await pool.request()
      .input('StokID', sql.Int, stokID)
      .input('Barkod', sql.NVarChar(50), yeni)
      .query('UPDATE Stok SET Barkod = @Barkod WHERE StokID = @StokID');
    await islemKaydet(
      req.body?.kullanici || 'Sistem',
      'Stok Barkod',
      `${row.UrunAdi} için barkod: ${yeni}`,
    );
    res.json({
      success: true,
      barkod: yeni,
      urun: {
        StokID: row.StokID,
        UrunAdi: row.UrunAdi,
        Barkod: yeni,
        SatisFiyati: row.SatisFiyati,
        Birim: row.Birim,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Barkod üretilemedi.' });
  }
});

app.get('/api/stok', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Stok ORDER BY StokID DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Stoklar listelenirken hata oluştu.');
  }
});

/** Stok kartı veya geçmiş mal alımından son birim alış fiyatları (mal alım önerisi). */
app.get('/api/stok/son-alis-fiyatlari', async (req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request().query(`
      SELECT StokID, UrunAdi, AlisBirimFiyat, SatirID
      FROM (
        SELECT
          s.StokID,
          s.UrunAdi,
          s.AlisBirimFiyat,
          s.SatirID,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(s.StokID, 0), -1), LTRIM(RTRIM(s.UrunAdi))
            ORDER BY s.SatirID DESC
          ) AS rn
        FROM TedarikAlimSatir s
        WHERE s.AlisBirimFiyat > 0
      ) x
      WHERE rn = 1
    `);
    const byStokID = {};
    const byUrunAdi = {};
    for (const r of rs.recordset || []) {
      const fiyat = Math.round(Number(r.AlisBirimFiyat || 0) * 100) / 100;
      if (!(fiyat > 0)) continue;
      const sid = Number(r.StokID);
      if (Number.isInteger(sid) && sid > 0) byStokID[String(sid)] = fiyat;
      const ad = String(r.UrunAdi || '').trim().toLocaleLowerCase('tr-TR');
      if (ad) byUrunAdi[ad] = fiyat;
    }
    res.json({ byStokID, byUrunAdi });
  } catch (err) {
    console.error(err);
    res.status(500).json({ byStokID: {}, byUrunAdi: {} });
  }
});

app.get('/api/stok/piyasa-fiyat', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, query: q, refs: null });
    const like = `%${q}%`;
    const pool = await poolPromise;
    const [stokRs, alimRs, satisRs] = await Promise.all([
      pool.request()
        .input('Q', sql.NVarChar(150), like)
        .query(`
          SELECT TOP 20 AlisFiyati, SatisFiyati
          FROM Stok
          WHERE UrunAdi LIKE @Q
          ORDER BY StokID DESC
        `),
      pool.request()
        .input('Q', sql.NVarChar(150), like)
        .query(`
          SELECT TOP 50 s.AlisBirimFiyat AS AlisFiyat
          FROM TedarikAlimSatir s
          WHERE s.UrunAdi LIKE @Q
          ORDER BY s.SatirID DESC
        `),
      pool.request()
        .input('Q', sql.NVarChar(150), like)
        .query(`
          SELECT TOP 50 d.BirimFiyat AS SatisFiyat
          FROM MusteriHareketDetaylari d
          INNER JOIN MusteriHareketleri h ON h.HareketID = d.HareketID
          WHERE d.UrunAdi LIKE @Q AND h.Tur = N'Satis'
          ORDER BY d.DetayID DESC
        `),
    ]);

    const toNums = (arr, key) => (arr || []).map((r) => Number(r[key])).filter((n) => Number.isFinite(n) && n >= 0);
    const alisList = [
      ...toNums(stokRs.recordset, 'AlisFiyati'),
      ...toNums(alimRs.recordset, 'AlisFiyat'),
    ];
    const satisList = [
      ...toNums(stokRs.recordset, 'SatisFiyati'),
      ...toNums(satisRs.recordset, 'SatisFiyat'),
    ];
    const agg = (list) => {
      if (!list.length) return null;
      const min = Math.min(...list);
      const max = Math.max(...list);
      const avg = list.reduce((a, b) => a + b, 0) / list.length;
      return {
        min: Math.round(min * 100) / 100,
        max: Math.round(max * 100) / 100,
        avg: Math.round(avg * 100) / 100,
        count: list.length,
      };
    };
    const fetchSourceCanli = async (source) => {
      try {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 5000);
        const url = `${source.searchUrl}${encodeURIComponent(q)}`;
        const r = await fetch(url, {
          signal: ctl.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        clearTimeout(tm);
        if (!r.ok) return null;
        const html = await r.text();
        const fiyatRaw = [];
        const re = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*TL/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          const n = Number(String(m[1] || '').replace(/\./g, '').replace(',', '.'));
          if (Number.isFinite(n) && n > 0 && n < 1000000) fiyatRaw.push(n);
        }
        const items = [];
        const seen = new Set();
        const norm = (s) => String(s || '')
          .toLocaleLowerCase('tr-TR')
          .replace(/[ıİ]/g, 'i')
          .replace(/[şŞ]/g, 's')
          .replace(/[ğĞ]/g, 'g')
          .replace(/[üÜ]/g, 'u')
          .replace(/[öÖ]/g, 'o')
          .replace(/[çÇ]/g, 'c')
          .replace(/\s+/g, ' ')
          .trim();
        const qNorm = norm(q);
        const qTokens = qNorm.split(' ').filter((x) => x.length >= 2);
        const temizMetin = (s) => String(s || '')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&quot;/gi, '"')
          .replace(/&#39;/gi, "'")
          .replace(/\s+/g, ' ')
          .trim();
        const birimBul = (ad) => {
          const t = String(ad || '').toLowerCase();
          const m = t.match(/(\d+(?:[.,]\d+)?)\s*(metre|mt|adet|kutu|top|m)\b/);
          if (m) return `${m[1]} ${m[2]}`;
          if (/\badet\b/.test(t)) return 'Adet';
          if (/\bmetre\b|\bmt\b|\bm\b/.test(t)) return 'Metre';
          if (/\bkutu\b/.test(t)) return 'Kutu';
          if (/\btop\b/.test(t)) return 'Top';
          return null;
        };
        const addItem = (adRaw, fiyatRaw) => {
          const ad = String(adRaw || '').replace(/\s+/g, ' ').trim();
          const fiyat = Number(String(fiyatRaw || '').replace(/\./g, '').replace(',', '.'));
          if (!ad || ad.length < 4 || ad.length > 180) return;
          if (!Number.isFinite(fiyat) || fiyat <= 0 || fiyat > 1000000) return;
          const key = ad.toLowerCase();
          if (seen.has(key)) return;
          const ozellik = ad.includes('-') ? ad.split('-').slice(1).join('-').trim() : ad;
          const full = norm(`${ad} ${ozellik}`);
          let score = 0;
          if (qNorm && full.includes(qNorm)) score += 5;
          qTokens.forEach((t) => { if (full.includes(t)) score += 1; });
          if (score <= 0) return;
          seen.add(key);
          items.push({
            ad,
            ozellik: ozellik.substring(0, 160),
            birim: birimBul(ad) || birimBul(ozellik),
            fiyat: Math.round(fiyat * 100) / 100,
            _score: score,
          });
        };

        const pr1 = new RegExp(`<a[^>]+href="(?:https?:\\\\/\\\\/(?:www\\\\.)?${source.hostRegex}\\\\/|\\\\/)?[^"]+"[^>]*>\\\\s*([^<\\\\n][^<]{3,180})\\\\s*<\\\\/a>[\\\\s\\\\S]{0,450}?(\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\\\s*TL`, 'gi');
        let m1;
        while ((m1 = pr1.exec(html)) !== null && items.length < 24) {
          addItem(m1[1], m1[2]);
        }

        const prAnchor = new RegExp(`<a[^>]+href="((?:https?:\\\\/\\\\/(?:www\\\\.)?${source.hostRegex}\\\\/|\\\\/)?[^"]+)"[^>]*>([\\\\s\\\\S]{1,320}?)<\\\\/a>`, 'gi');
        let ma;
        while ((ma = prAnchor.exec(html)) !== null && items.length < 24) {
          const ad = temizMetin(ma[2]);
          const bad = /^(anasayfa|kampanyalar|sipariş takip|iletişim|markalarımız|kategoriler|ara|sepet|giriş yap|üye ol)$/i;
          if (!ad || ad.length < 4 || bad.test(ad)) continue;
          const around = html.slice(Math.max(0, ma.index - 80), ma.index + 900);
          const fiyatM = around.match(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*TL/i);
          if (fiyatM) addItem(ad, fiyatM[1]);
        }

        const pr2 = /"name"\s*:\s*"([^"]{4,180})"[\s\S]{0,220}?"price"\s*:\s*"(\d+(?:[.,]\d{1,2})?)"/gi;
        let m2;
        while ((m2 = pr2.exec(html)) !== null && items.length < 24) {
          addItem(m2[1], String(m2[2]).includes(',') ? m2[2] : `${m2[2]}`.replace('.', ','));
        }

        const pr3 = /!\[([^\]]{4,180})\][\s\S]{0,260}?(\d{1,3}(?:\.\d{3})*,\d{2})\s*TL/gi;
        let m3;
        while ((m3 = pr3.exec(html)) !== null && items.length < 24) {
          addItem(m3[1], m3[2]);
        }
        const pr4 = /title="([^"]{4,180})"[\s\S]{0,360}?(\d{1,3}(?:\.\d{3})*,\d{2})\s*TL/gi;
        let m4;
        while ((m4 = pr4.exec(html)) !== null && items.length < 24) {
          addItem(m4[1], m4[2]);
        }
        const pr5 = /"(?:title|name|productName)"\s*:\s*"([^"]{4,180})"[\s\S]{0,180}?"(?:price|salePrice|finalPrice|amount)"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)"?/gi;
        let m5;
        while ((m5 = pr5.exec(html)) !== null && items.length < 24) {
          addItem(m5[1], String(m5[2]).includes(',') ? m5[2] : String(m5[2]).replace('.', ','));
        }
        const itemsSorted = items
          .sort((a, b) => (Number(b._score || 0) - Number(a._score || 0)) || (Number(a.fiyat || 0) - Number(b.fiyat || 0)))
          .slice(0, 20)
          .map((x) => ({ ad: x.ad, ozellik: x.ozellik, birim: x.birim, fiyat: x.fiyat }));
        if (!fiyatRaw.length && !itemsSorted.length) return null;
        const fiyatAgg = agg((itemsSorted.length ? itemsSorted.map((x) => x.fiyat) : fiyatRaw).slice(0, 120));
        return { key: source.key, name: source.name, ...fiyatAgg, items: itemsSorted };
      } catch (_) {
        return { key: source.key, name: source.name, error: true, items: [] };
      }
    };
    const sources = [
      { key: 'zeybek', name: 'Zeybek', searchUrl: 'https://zeybekmarket.com/arama?q=', hostRegex: 'zeybekmarket\\.com' },
      { key: 'elektrikdepo', name: 'Elektrik Depo', searchUrl: 'https://www.elektrikdepo.com/arama?q=', hostRegex: 'elektrikdepo\\.com' },
      { key: 'elektromarketim', name: 'Elektromarketim', searchUrl: 'https://www.elektromarketim.com/arama?q=', hostRegex: 'elektromarketim\\.com' },
      { key: 'teknikelektrik', name: 'Teknik Elektrik', searchUrl: 'https://www.teknikelektrik.com/arama?q=', hostRegex: 'teknikelektrik\\.com' },
    ];
    const canliKaynaklar = await Promise.all(sources.map((s) => fetchSourceCanli(s)));
    const zeybek = canliKaynaklar.find((x) => x && x.key === 'zeybek') || null;
    res.json({
      success: true,
      query: q,
      refs: {
        alis: agg(alisList),
        satis: agg(satisList),
        zeybek,
        sources: canliKaynaklar,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Piyasa fiyatı alınamadı.' });
  }
});

app.post('/api/stok', async (req, res) => {
  try {
    const { UrunAdi, Kategori, Barkod, AlisFiyati, SatisFiyati, MevcutMiktar, Birim, KritikEsik, HedefEsik, kullanici } = req.body;

    const pool = await poolPromise;
    const ins = await pool.request()
      .input('UrunAdi', sql.NVarChar(150), UrunAdi)
      .input('Kategori', sql.NVarChar(50), Kategori || null)
      .input('Barkod', sql.NVarChar(50), Barkod || null)
      .input('AlisFiyati', sql.Decimal(18, 2), AlisFiyati || 0)
      .input('SatisFiyati', sql.Decimal(18, 2), SatisFiyati)
      .input('MevcutMiktar', sql.Int, MevcutMiktar || 0)
      .input('Birim', sql.NVarChar(20), Birim || 'Adet')
      .input('KritikEsik', sql.Int, Number.isInteger(Number(KritikEsik)) ? Number(KritikEsik) : null)
      .input('HedefEsik', sql.Int, Number.isInteger(Number(HedefEsik)) ? Number(HedefEsik) : null)
      .query(`
        INSERT INTO Stok (UrunAdi, Kategori, Barkod, AlisFiyati, SatisFiyati, MevcutMiktar, Birim, KritikEsik, HedefEsik) 
        OUTPUT INSERTED.*
        VALUES (@UrunAdi, @Kategori, @Barkod, @AlisFiyati, @SatisFiyati, @MevcutMiktar, @Birim, @KritikEsik, @HedefEsik)
      `);
    await islemKaydet(kullanici || 'Sistem', 'Stok Ekle', `${UrunAdi} ürünü eklendi`);
    res.status(201).json(ins.recordset[0] || { UrunAdi });
  } catch (err) {
    console.error(err);
    res.status(500).send('Stok eklenirken bir hata oluştu.');
  }
});

app.put('/api/stok/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { UrunAdi, Kategori, Barkod, AlisFiyati, SatisFiyati, MevcutMiktar, Birim, KritikEsik, HedefEsik } = req.body;

    const pool = await poolPromise;
    const result = await pool.request()
      .input('StokID', sql.Int, id)
      .input('UrunAdi', sql.NVarChar(150), UrunAdi)
      .input('Kategori', sql.NVarChar(50), Kategori)
      .input('Barkod', sql.NVarChar(50), Barkod)
      .input('AlisFiyati', sql.Decimal(18, 2), AlisFiyati)
      .input('SatisFiyati', sql.Decimal(18, 2), SatisFiyati)
      .input('MevcutMiktar', sql.Int, MevcutMiktar)
      .input('Birim', sql.NVarChar(20), Birim)
      .input('KritikEsik', sql.Int, Number.isInteger(Number(KritikEsik)) ? Number(KritikEsik) : null)
      .input('HedefEsik', sql.Int, Number.isInteger(Number(HedefEsik)) ? Number(HedefEsik) : null)
      .query(`
        UPDATE Stok 
        SET UrunAdi = @UrunAdi, Kategori = @Kategori, Barkod = @Barkod, 
            AlisFiyati = @AlisFiyati, SatisFiyati = @SatisFiyati, 
            MevcutMiktar = @MevcutMiktar, Birim = @Birim,
            KritikEsik = @KritikEsik, HedefEsik = @HedefEsik
        WHERE StokID = @StokID
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).send('Güncellenecek ürün bulunamadı.');
    }
    res.send('Stok başarıyla güncellendi.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Stok güncellenirken bir hata oluştu.');
  }
});

app.delete('/api/stok/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { kullanici } = req.query;
    const pool = await poolPromise;

    const kontrol = await pool.request()
      .input('ID', sql.Int, id)
      .query('SELECT UrunAdi FROM Stok WHERE StokID = @ID');

    if (kontrol.recordset.length === 0) {
      return res.status(200).send('Ürün zaten silinmiş veya bulunamadı.');
    }

    await pool.request().input('ID', sql.Int, id).query('DELETE FROM Stok WHERE StokID = @ID');

    await islemKaydet(kullanici || 'Sistem', 'Stok Sil', `Stok ID: ${id} silindi`);

    res.status(200).send('Başarıyla silindi.');
  } catch (err) {
    console.error('DETAYLI HATA:', err);
    res.status(500).send('Sunucu hatası: ' + err.message);
  }
});

// ==========================================
// --- MÜŞTERİ (CARİ) İŞLEMLERİ ---
// ==========================================

app.get('/api/musteri', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Musteriler ORDER BY MusteriID DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Müşteriler listelenirken hata oluştu.');
  }
});

app.post('/api/musteri', async (req, res) => {
  try {
    const { Adres, Il, Ilce, Mahalle, TanimAdi } = req.body;
    const dogrulama = musteriKayitDogrula(req.body);
    if (!dogrulama.ok) {
      return res.status(400).json({ success: false, message: dogrulama.message });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('AdSoyad', sql.NVarChar(100), dogrulama.AdSoyad)
      .input('FirmaAdi', sql.NVarChar(150), dogrulama.FirmaAdi)
      .input('Telefon', sql.NVarChar(20), dogrulama.telefonRaw || null)
      .input('Adres', sql.NVarChar(255), Adres || null)
      .input('Il', sql.NVarChar(60), (Il || '').trim() || null)
      .input('Ilce', sql.NVarChar(60), (Ilce || '').trim() || null)
      .input('Mahalle', sql.NVarChar(120), (Mahalle || '').trim() || null)
      .input('TanimAdi', sql.NVarChar(120), (TanimAdi || '').trim() || null)
      .input('tur', sql.NVarChar(20), dogrulama.tur)
      .input('tcno', sql.NVarChar(11), dogrulama.tcno)
      .input('vergino', sql.NVarChar(20), dogrulama.vergino)
      .input('yetkili', sql.NVarChar(120), dogrulama.yetkili)
      .query(`
        INSERT INTO Musteriler
          (AdSoyad, FirmaAdi, Telefon, Adres, Il, Ilce, Mahalle, TanimAdi, tur, tcno, vergino, yetkili)
        OUTPUT INSERTED.MusteriID
        VALUES
          (@AdSoyad, @FirmaAdi, @Telefon, @Adres, @Il, @Ilce, @Mahalle, @TanimAdi, @tur, @tcno, @vergino, @yetkili)
      `);

    const musteriID = result.recordset[0]?.MusteriID;
    const etiket = musteriGorunenAdKayit(dogrulama);
    await islemKaydet('admin', 'Müşteri Ekle', `${etiket} müşterisi eklendi (${dogrulama.tur})`);

    res.status(201).json({ success: true, message: 'Müşteri başarıyla eklendi.', musteriID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Müşteri eklenirken hata oluştu.' });
  }
});

app.put('/api/musteri/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { Adres, Il, Ilce, Mahalle, TanimAdi, Bakiye } = req.body;
    const dogrulama = musteriKayitDogrula(req.body);
    if (!dogrulama.ok) {
      return res.status(400).json({ success: false, message: dogrulama.message });
    }
    const pool = await poolPromise;
    const result = await pool.request()
      .input('MusteriID', sql.Int, id)
      .input('AdSoyad', sql.NVarChar(100), dogrulama.AdSoyad)
      .input('FirmaAdi', sql.NVarChar(150), dogrulama.FirmaAdi)
      .input('Telefon', sql.NVarChar(20), dogrulama.telefonRaw || null)
      .input('Adres', sql.NVarChar(255), Adres)
      .input('Il', sql.NVarChar(60), (Il || '').trim() || null)
      .input('Ilce', sql.NVarChar(60), (Ilce || '').trim() || null)
      .input('Mahalle', sql.NVarChar(120), (Mahalle || '').trim() || null)
      .input('TanimAdi', sql.NVarChar(120), (TanimAdi || '').trim() || null)
      .input('tur', sql.NVarChar(20), dogrulama.tur)
      .input('tcno', sql.NVarChar(11), dogrulama.tcno)
      .input('vergino', sql.NVarChar(20), dogrulama.vergino)
      .input('yetkili', sql.NVarChar(120), dogrulama.yetkili)
      .input('Bakiye', sql.Decimal(18, 2), Bakiye)
      .query(`
        UPDATE Musteriler 
        SET AdSoyad = @AdSoyad, FirmaAdi = @FirmaAdi, Telefon = @Telefon, Adres = @Adres,
            Il = @Il, Ilce = @Ilce, Mahalle = @Mahalle, TanimAdi = @TanimAdi,
            tur = @tur, tcno = @tcno, vergino = @vergino, yetkili = @yetkili, Bakiye = @Bakiye
        WHERE MusteriID = @MusteriID
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: 'Güncellenecek müşteri bulunamadı.' });
    }
    res.json({ success: true, message: 'Müşteri başarıyla güncellendi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Müşteri güncellenirken hata oluştu.' });
  }
});

app.delete('/api/musteri/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;

    const musteriKontrol = await pool.request()
      .input('MusteriID', sql.Int, id)
      .query('SELECT AdSoyad FROM Musteriler WHERE MusteriID = @MusteriID');

    if (musteriKontrol.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }

    const musteriAdi = musteriGorunenAdKayit(musteriKontrol.recordset[0]);

    const servisKontrol = await pool.request()
      .input('MusteriID', sql.Int, id)
      .query('SELECT COUNT(*) AS Sayi FROM ServisIsleri WHERE MusteriID = @MusteriID');

    const servisSayisi = servisKontrol.recordset[0].Sayi;

    if (servisSayisi > 0) {
      return res.status(400).json({
        success: false,
        message: `Bu müşterinin ${servisSayisi} adet servis kaydı bulunmaktadır. Önce servis kayıtlarını siliniz veya müşteri silme işlemini iptal edin.`,
      });
    }

    await pool.request()
      .input('MusteriID', sql.Int, id)
      .query('DELETE FROM Musteriler WHERE MusteriID = @MusteriID');

    await islemKaydet('admin', 'Müşteri Sil', `${musteriAdi} (ID: ${id}) silindi`);

    res.json({ success: true, message: 'Müşteri başarıyla silindi.' });
  } catch (err) {
    console.error('Müşteri silme hatası:', err);
    res.status(500).json({ success: false, message: 'Silme işlemi sırasında beklenmeyen bir hata oluştu.' });
  }
});

function sqlTarihGunDegeri(val) {
  if (!val) return null;
  const s = String(val).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Eski satışlarda detay tablosu boşsa Aciklama satırından kalem üretir */
function musteriHareketDetayAciklamadan(hareket) {
  let aciklama = String(hareket.Aciklama || '').replace(/^\[Mobil\]\s*/i, '').trim();
  const tire = aciklama.match(/\s[—–-]\s+(.+)$/);
  if (tire) aciklama = tire[1].trim();
  const parcalar = aciklama.split(',').map((x) => x.trim()).filter(Boolean);
  const fallback = [];
  for (const p of parcalar) {
    const m = p.match(/^(.+?)\s*[x×](\d+)(?:\s*@\s*(\d+(?:[.,]\d+)?))?\s*$/i);
    if (!m) continue;
    const urunAdi = String(m[1] || '').trim();
    const miktar = parseInt(m[2], 10);
    let birimFiyat = m[3] ? Number(String(m[3]).replace(',', '.')) || 0 : 0;
    if ((!Number.isFinite(birimFiyat) || birimFiyat <= 0) && Number.isInteger(miktar) && miktar > 0) {
      birimFiyat = Number(hareket.ToplamTutar || 0) / miktar;
    }
    const satirTutar = Math.round((birimFiyat * miktar) * 100) / 100;
    if (urunAdi && Number.isInteger(miktar) && miktar > 0) {
      fallback.push({
        DetayID: 0,
        HareketID: hareket.HareketID,
        StokID: null,
        UrunAdi: urunAdi,
        Miktar: miktar,
        BirimFiyat: Math.round((birimFiyat || 0) * 100) / 100,
        SatirTutar: satirTutar,
      });
    }
  }
  return fallback;
}

async function musteriHareketDetaylariniEkle(pool, musteriID, hareketler, tarihAraligi) {
  if (!hareketler?.length) return;
  const reqD = pool.request().input('MusteriID', sql.Int, musteriID);
  let tarihFiltre = '';
  if (tarihAraligi?.baslangic && tarihAraligi?.bitis) {
    reqD.input('Baslangic', sql.Date, tarihAraligi.baslangic);
    reqD.input('Bitis', sql.Date, tarihAraligi.bitis);
    tarihFiltre =
      ' AND CAST(h.Tarih AS DATE) >= @Baslangic AND CAST(h.Tarih AS DATE) <= @Bitis';
  }
  const detayRs = await reqD.query(`
    SELECT d.DetayID, d.HareketID, d.StokID, d.UrunAdi, d.Miktar, d.BirimFiyat, d.SatirTutar
    FROM MusteriHareketDetaylari d
    INNER JOIN MusteriHareketleri h ON h.HareketID = d.HareketID
    WHERE h.MusteriID = @MusteriID${tarihFiltre}
    ORDER BY d.HareketID ASC, d.DetayID ASC
  `);
  const byHareket = new Map();
  for (const d of detayRs.recordset || []) {
    const hid = Number(d.HareketID);
    if (!byHareket.has(hid)) byHareket.set(hid, []);
    byHareket.get(hid).push(d);
  }
  for (const h of hareketler) {
    const tur = (h.Tur || '').toLowerCase();
    let detaylar = byHareket.get(Number(h.HareketID)) || [];
    if (!detaylar.length && (tur === 'satis' || tur === 'iade')) {
      detaylar = musteriHareketDetayAciklamadan(h);
    }
    h.detaylar = detaylar;
  }
}

app.get('/api/musteri/:id/hareketler', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ message: 'Geçersiz müşteri.' });
    }
    const baslangic = sqlTarihGunDegeri(req.query.baslangic);
    const bitis = sqlTarihGunDegeri(req.query.bitis);
    if ((req.query.baslangic || req.query.bitis) && (!baslangic || !bitis)) {
      return res.status(400).json({ message: 'Geçersiz tarih aralığı.' });
    }
    if (baslangic && bitis && baslangic > bitis) {
      return res.status(400).json({ message: 'Başlangıç tarihi bitişten sonra olamaz.' });
    }

    const pool = await poolPromise;
    const info = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT MusteriID, AdSoyad, FirmaAdi, Telefon, Adres, Il, Ilce, Mahalle, TanimAdi, Bakiye,
               tur, tcno, vergino, yetkili
        FROM Musteriler
        WHERE MusteriID = @MusteriID
      `);
    if (info.recordset.length === 0) {
      return res.status(404).json({ message: 'Müşteri bulunamadı.' });
    }

    const ilkRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT CONVERT(varchar(10), MIN(CAST(Tarih AS DATE)), 23) AS IlkTarih
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID
      `);
    const ilkHareketTarih = ilkRs.recordset[0]?.IlkTarih || null;

    const reqH = pool.request().input('MusteriID', sql.Int, musteriID);
    let hareketSql;
    if (baslangic && bitis) {
      reqH.input('Baslangic', sql.Date, baslangic);
      reqH.input('Bitis', sql.Date, bitis);
      hareketSql = `
        SELECT HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, MakbuzKalanBakiye, MakbuzNo,
               OdemeSekli, Aciklama, Kullanici, Referans, Tarih
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID
          AND CAST(Tarih AS DATE) >= @Baslangic AND CAST(Tarih AS DATE) <= @Bitis
        ORDER BY Tarih ASC, HareketID ASC`;
    } else {
      hareketSql = `
        SELECT TOP 500 HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, MakbuzKalanBakiye, MakbuzNo,
               OdemeSekli, Aciklama, Kullanici, Referans, Tarih
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID
        ORDER BY Tarih DESC, HareketID DESC`;
    }

    const hareketlerRs = await reqH.query(hareketSql);
    const hareketler = (hareketlerRs.recordset || []).map((h) => ({
      ...h,
      MobilKaynak: hareketMobilMi(h),
    }));
    await musteriHareketDetaylariniEkle(pool, musteriID, hareketler, {
      baslangic,
      bitis,
    });
    const ozet = {
      toplamSatis: 0,
      toplamOdeme: 0,
      kalanBakiye: Number(info.recordset[0].Bakiye || 0),
    };
    const donemOzet = Boolean(baslangic && bitis);
    for (const h of hareketler) {
      const tSatis = Number(h.ToplamTutar || 0);
      const tOdenen = Number(h.OdenenTutar || 0);
      const tur = (h.Tur || '').toLowerCase();
      if (donemOzet) {
        if (tur === 'satis' || tur === 'iade') ozet.toplamSatis += tur === 'iade' ? -tSatis : tSatis;
        if (tur === 'odeme' || tur === 'iadeodeme') ozet.toplamOdeme += tOdenen;
      } else {
        if (tur === 'satis') ozet.toplamSatis += tSatis;
        if (tur === 'odeme') ozet.toplamOdeme += tOdenen;
      }
    }

    res.json({ musteri: info.recordset[0], ozet, hareketler, ilkHareketTarih });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Müşteri hareketleri alınamadı.' });
  }
});

app.post('/api/musteri/:id/odeme', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { tutar, odemeSekli, aciklama, kullanici } = req.body;
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
    const t = Number(tutar);
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    }
    if (!Number.isFinite(t) || t <= 0) {
      return res.status(400).json({ success: false, message: 'Geçerli tutar girin.' });
    }
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const pool = await poolPromise;
    const info = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT MusteriID, AdSoyad, Bakiye
        FROM Musteriler
        WHERE MusteriID = @MusteriID
      `);
    if (info.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }
    const row = info.recordset[0];
    const mevcutBakiye = Number(row.Bakiye || 0);
    const odemeTutar = Math.round(t * 100) / 100;
    const finalBakiye = Math.max(0, Math.round((mevcutBakiye - odemeTutar) * 100) / 100);
    if (odemeTutar > mevcutBakiye) {
      return res.status(400).json({
        success: false,
        message: `Tahsilat bakiyeden büyük olamaz. Güncel bakiye: ${mevcutBakiye.toFixed(2)} ₺`,
      });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let makbuzNo = 0;
    let taksitBilgi = { tahsilEdilen: 0, taksitAdedi: 0, detayMetin: '', odemeHareketID: null };
    let genelOdemeHareketID = null;
    try {
      const rqBakiye = new sql.Request(transaction);
      rqBakiye.input('MusteriID', sql.Int, musteriID);
      rqBakiye.input('Tutar', sql.Decimal(18, 2), odemeTutar);
      const upd = await rqBakiye.query(`
        UPDATE Musteriler
        SET Bakiye = Bakiye - @Tutar
        WHERE MusteriID = @MusteriID AND Bakiye >= @Tutar
      `);
      if (upd.rowsAffected[0] === 0) {
        await transaction.rollback();
        return res.status(409).json({ success: false, message: 'Bakiye güncellenemedi.' });
      }

      taksitBilgi = await taksitTahsilatDagitTxn(transaction, musteriID, odemeTutar, odemeRaw, kullanici || 'Sistem');
      const genelOdeme = Math.round((odemeTutar - Number(taksitBilgi.tahsilEdilen || 0)) * 100) / 100;

      if (genelOdeme > 0) {
        const genelOdemeIns = await new sql.Request(transaction)
          .input('MusteriID', sql.Int, musteriID)
          .input('Tur', sql.NVarChar(20), 'Odeme')
          .input('ToplamTutar', sql.Decimal(18, 2), 0)
          .input('OdenenTutar', sql.Decimal(18, 2), genelOdeme)
          .input('KalanTutar', sql.Decimal(18, 2), 0)
          .input('OdemeSekli', sql.NVarChar(20), odemeRaw)
          .input(
            'Aciklama',
            sql.NVarChar(500),
            hareketAciklamaMobilIsaretle(req.mobilKaynak, (aciklama || '').trim()) || null,
          )
          .input('MakbuzKalanBakiye', sql.Decimal(18, 2), finalBakiye)
          .input('MakbuzNo', sql.Int, null)
          .input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50))
          .input(
            'Referans',
            sql.NVarChar(40),
            (req.mobilKaynak ? `mobil:odeme:${musteriID}:${Date.now()}` : `musteri-odeme:${musteriID}:${Date.now()}`).substring(0, 40),
          )
          .query(`
            INSERT INTO MusteriHareketleri
              (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, MakbuzKalanBakiye, MakbuzNo, Kullanici, Referans)
            OUTPUT INSERTED.HareketID
            VALUES
              (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @MakbuzKalanBakiye, @MakbuzNo, @Kullanici, @Referans)
          `);
        genelOdemeHareketID = genelOdemeIns.recordset[0]?.HareketID || null;
      }
      if (taksitBilgi.odemeHareketID) {
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, taksitBilgi.odemeHareketID)
          .input('MakbuzKalanBakiye', sql.Decimal(18, 2), finalBakiye)
          .query('UPDATE MusteriHareketleri SET MakbuzKalanBakiye = @MakbuzKalanBakiye WHERE HareketID = @HareketID');
      }

      let kasaAciklama = `Müşteri tahsilat — ${row.AdSoyad} [${odemeRaw}]`;
      if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
      await kasayaIsleTxn(transaction, 'Giris', odemeTutar, kasaAciklama, kullanici || 'Sistem');
      makbuzNo = await nextMakbuzNoTxn(transaction);
      if (genelOdemeHareketID) {
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, genelOdemeHareketID)
          .input('MakbuzNo', sql.Int, makbuzNo)
          .query('UPDATE MusteriHareketleri SET MakbuzNo = @MakbuzNo WHERE HareketID = @HareketID');
      }
      if (taksitBilgi.odemeHareketID) {
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, taksitBilgi.odemeHareketID)
          .input('MakbuzNo', sql.Int, makbuzNo)
          .query('UPDATE MusteriHareketleri SET MakbuzNo = @MakbuzNo WHERE HareketID = @HareketID');
      }
      await transaction.commit();
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }

    let logTxt = `${row.AdSoyad}: ${odemeTutar}₺ [${odemeRaw}]`;
    if (taksitBilgi.tahsilEdilen > 0) {
      logTxt += ` — taksit havuzu: ${taksitBilgi.tahsilEdilen}₺ (${taksitBilgi.taksitAdedi} taksit`;
      if (Array.isArray(taksitBilgi.dagilim) && taksitBilgi.dagilim.length) {
        const dagilimTxt = taksitBilgi.dagilim
          .map((d) => {
            const k = Number(d.sonra || 0);
            return d.kismi
              ? `${d.taksitNo}.taksit kalan ${k.toFixed(2).replace('.', ',')} TL`
              : `${d.taksitNo}.taksit ödendi`;
          })
          .join(', ');
        logTxt += `: ${dagilimTxt}`;
      }
      logTxt += ')';
    }
    const odemeLogID = await islemKaydetDonus(
      kullanici || 'Sistem',
      'Müşteri Ödeme',
      aciklamaMobilIsaretle(req, logTxt),
    );
    if (odemeLogID) {
      const refSuffix = `:L${odemeLogID}`.substring(0, 12);
      if (genelOdemeHareketID) {
        await pool.request()
          .input('HID', sql.Int, genelOdemeHareketID)
          .input('Ref', sql.NVarChar(40), `musteri-odeme:${musteriID}${refSuffix}`.substring(0, 40))
          .query('UPDATE MusteriHareketleri SET Referans = @Ref WHERE HareketID = @HID');
      }
      if (taksitBilgi.odemeHareketID) {
        await pool.request()
          .input('HID', sql.Int, taksitBilgi.odemeHareketID)
          .input('Ref', sql.NVarChar(40), `taksit-odeme:${musteriID}${refSuffix}`.substring(0, 40))
          .query('UPDATE MusteriHareketleri SET Referans = @Ref WHERE HareketID = @HID');
      }
    }

    let mesaj = 'Tahsilat kaydedildi.';
    if (taksitBilgi.tahsilEdilen > 0) {
      mesaj = `Bekleyen taksitler vardı; ${taksitBilgi.tahsilEdilen.toFixed(2)} ₺ taksit havuzuna aktarıldı. Kalan ödeme normal tahsilat olarak işlendi.`;
    }
    res.json({
      success: true,
      message: mesaj,
      taksitTahsilati: taksitBilgi.tahsilEdilen || 0,
      makbuz: {
        no: makbuzNo,
        tur: 'Tahsilat',
        musteri: row.AdSoyad,
        odemeSekli: odemeRaw,
        tutar: odemeTutar,
        aciklama: taksitBilgi.tahsilEdilen > 0
          ? `Taksit tahsilatı - ${odemeRaw}${taksitBilgi.detayMetin ? ` (${taksitBilgi.detayMetin})` : ''}`
          : ((aciklama || '').trim() || null),
        kalanBakiye: finalBakiye,
        tarih: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Tahsilat sırasında hata oluştu.' });
  }
});

app.post('/api/musteri/:id/satis', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { urunID, miktar, odemeVarMi, odenenTutar, odemeSekli, aciklama, kullanici } = req.body;
    const stokID = parseInt(urunID, 10);
    const m = parseInt(miktar, 10);
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Kart', 'Havale'];
    const odemeVar = !!odemeVarMi;

    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    }
    if (!Number.isInteger(stokID) || stokID < 1 || !Number.isInteger(m) || m < 1) {
      return res.status(400).json({ success: false, message: 'Ürün veya miktar hatalı.' });
    }
    if (odemeVar && !odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const pool = await poolPromise;
    const musteriRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query('SELECT MusteriID, AdSoyad, Bakiye FROM Musteriler WHERE MusteriID = @MusteriID');
    if (musteriRs.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }

    const stokRs = await pool.request()
      .input('ID', sql.Int, stokID)
      .query('SELECT StokID, UrunAdi, MevcutMiktar, SatisFiyati FROM Stok WHERE StokID = @ID');
    if (stokRs.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }
    const urun = stokRs.recordset[0];

    const birimFiyat = Number(urun.SatisFiyati || 0);
    const toplam = Math.round(m * birimFiyat * 100) / 100;
    let tahsilat = odemeVar ? Number(odenenTutar) : 0;
    if (!Number.isFinite(tahsilat) || tahsilat < 0) tahsilat = 0;
    tahsilat = Math.round(tahsilat * 100) / 100;
    if (tahsilat > toplam) {
      return res.status(400).json({ success: false, message: 'Alınan ödeme satış tutarını geçemez.' });
    }
    const kalan = Math.round((toplam - tahsilat) * 100) / 100;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let makbuzNo = 0;
    try {
      if (!(await stokSatisDusurTxn(transaction, stokID, m))) {
        await transaction.rollback();
        return res.status(409).json({ success: false, message: 'Stok kaydı güncellenemedi.' });
      }

      if (kalan > 0) {
        const rqCari = new sql.Request(transaction);
        rqCari.input('MusteriID', sql.Int, musteriID);
        rqCari.input('Tutar', sql.Decimal(18, 2), kalan);
        const c = await rqCari.query(`
          UPDATE Musteriler
          SET Bakiye = Bakiye + @Tutar
          WHERE MusteriID = @MusteriID
        `);
        if (c.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(400).json({ success: false, message: 'Müşteri bulunamadı.' });
        }
      }

      if (tahsilat > 0) {
        let kasaAciklama = `Müşteri satış tahsilatı — ${musteriRs.recordset[0].AdSoyad} [${odemeRaw}]`;
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
        await kasayaIsleTxn(transaction, 'Giris', tahsilat, kasaAciklama, kullanici || 'Sistem');
        makbuzNo = await nextMakbuzNoTxn(transaction);
      }

      const rqHar = new sql.Request(transaction);
      rqHar.input('MusteriID', sql.Int, musteriID);
      rqHar.input('Tur', sql.NVarChar(20), 'Satis');
      rqHar.input('ToplamTutar', sql.Decimal(18, 2), toplam);
      rqHar.input('OdenenTutar', sql.Decimal(18, 2), tahsilat);
      rqHar.input('KalanTutar', sql.Decimal(18, 2), kalan);
      rqHar.input('OdemeSekli', sql.NVarChar(20), tahsilat > 0 ? odemeRaw : null);
      const aciklamaParca = `${urun.UrunAdi} x${m}`;
      const notParca = (aciklama || '').trim();
      rqHar.input(
        'Aciklama',
        sql.NVarChar(500),
        notParca ? `${aciklamaParca} — ${notParca}`.substring(0, 500) : aciklamaParca.substring(0, 500)
      );
      rqHar.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
      rqHar.input('Referans', sql.NVarChar(40), 'musteri-satis');
      await rqHar.query(`
        INSERT INTO MusteriHareketleri
          (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans)
        VALUES
          (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @Kullanici, @Referans)
      `);

      await transaction.commit();
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw innerErr;
    }

    const adLog = musteriRs.recordset[0].AdSoyad;
    const logSat =
      kalan > 0.009
        ? `${adLog} — satış ${toplam}₺, kalan ${kalan}₺`
        : `${adLog} — satış ${toplam}₺`;
    await islemKaydet(kullanici || 'Sistem', 'Müşteri Satış', logSat);

    res.json({ success: true, message: 'Satış kaydedildi.', toplam, tahsilat, kalan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Müşteri satışı sırasında hata oluştu.' });
  }
});

app.post('/api/musteri/:id/satis-sepet', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { kalemler, odemeVarMi, odenenTutar, odemeSekli, aciklama, kullanici } = req.body;
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Kart', 'Havale'];
    const odemeVar = !!odemeVarMi;

    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    }
    if (!Array.isArray(kalemler) || kalemler.length === 0) {
      return res.status(400).json({ success: false, message: 'Sepet boş.' });
    }
    if (odemeVar && !odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const stokToplamlari = new Map();
    const islenmisKalemler = [];
    for (const k of kalemler) {
      const id = parseInt(k.urunID ?? k.stokID, 10);
      const m = parseInt(k.miktar, 10);
      const bfRaw = Number(k.birimFiyat);
      if (!Number.isInteger(id) || id < 1 || !Number.isInteger(m) || m < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sepet satırı.' });
      }
      const bf = Number.isFinite(bfRaw) && bfRaw >= 0 ? Math.round(bfRaw * 100) / 100 : null;
      stokToplamlari.set(id, (stokToplamlari.get(id) || 0) + m);
      islenmisKalemler.push({ stokID: id, miktar: m, birimFiyat: bf });
    }

    const pool = await poolPromise;
    const musteriRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query('SELECT MusteriID, AdSoyad FROM Musteriler WHERE MusteriID = @MusteriID');
    if (musteriRs.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }

    const satirlar = [];
    let toplam = 0;
    const urunOzetleri = [];
    const stokCache = new Map();
    for (const [stokID, toplamMiktar] of stokToplamlari) {
      const stokRs = await pool.request()
        .input('ID', sql.Int, stokID)
        .query('SELECT StokID, UrunAdi, MevcutMiktar, SatisFiyati FROM Stok WHERE StokID = @ID');
      if (stokRs.recordset.length === 0) {
        return res.status(404).json({ success: false, message: `Ürün bulunamadı (ID: ${stokID}).` });
      }
      const urun = stokRs.recordset[0];
      stokCache.set(stokID, urun);
    }

    for (const k of islenmisKalemler) {
      const urun = stokCache.get(k.stokID);
      const birimFiyat = Number.isFinite(k.birimFiyat) ? k.birimFiyat : Number(urun.SatisFiyati || 0);
      const satirToplam = Math.round(birimFiyat * k.miktar * 100) / 100;
      toplam += satirToplam;
      satirlar.push({ stokID: k.stokID, miktar: k.miktar, urun, satirToplam, birimFiyat });
      urunOzetleri.push(`${urun.UrunAdi} x${k.miktar} @${birimFiyat.toFixed(2)}`);
    }
    toplam = Math.round(toplam * 100) / 100;

    let tahsilat = odemeVar ? Number(odenenTutar) : 0;
    if (!Number.isFinite(tahsilat) || tahsilat < 0) tahsilat = 0;
    tahsilat = Math.round(tahsilat * 100) / 100;
    if (tahsilat > toplam) {
      return res.status(400).json({ success: false, message: 'Alınan ödeme satış toplamını geçemez.' });
    }
    const kalan = Math.round((toplam - tahsilat) * 100) / 100;
    let kaydedilenMakbuzNo = null;
    let kaydedilenFinalBakiye = null;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const s of satirlar) {
        if (!(await stokSatisDusurTxn(transaction, s.stokID, s.miktar))) {
          await transaction.rollback();
          return res.status(409).json({ success: false, message: 'Stok kaydı güncellenemedi.' });
        }
      }

      const rqCariSatis = new sql.Request(transaction);
      rqCariSatis.input('MusteriID', sql.Int, musteriID);
      rqCariSatis.input('Tutar', sql.Decimal(18, 2), toplam);
      const cSatis = await rqCariSatis.query(`
        UPDATE Musteriler
        SET Bakiye = Bakiye + @Tutar
        WHERE MusteriID = @MusteriID
      `);
      if (cSatis.rowsAffected[0] === 0) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: 'Müşteri bulunamadı.' });
      }

      if (tahsilat > 0) {
        const rqCariTah = new sql.Request(transaction);
        rqCariTah.input('MusteriID', sql.Int, musteriID);
        rqCariTah.input('Tutar', sql.Decimal(18, 2), tahsilat);
        const cTah = await rqCariTah.query(`
          UPDATE Musteriler
          SET Bakiye = Bakiye - @Tutar
          WHERE MusteriID = @MusteriID AND Bakiye >= @Tutar
        `);
        if (cTah.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(409).json({ success: false, message: 'Tahsilat için bakiye güncellenemedi.' });
        }

        let kasaAciklama = `Müşteri satış tahsilatı — ${musteriRs.recordset[0].AdSoyad} [${odemeRaw}]`;
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
        await kasayaIsleTxn(transaction, 'Giris', tahsilat, kasaAciklama, kullanici || 'Sistem');
        kaydedilenMakbuzNo = await nextMakbuzNoTxn(transaction);
      }

      const satisRef = `musteri-satis-sepet:${musteriID}:${Date.now()}`;
      const rqHar = new sql.Request(transaction);
      rqHar.input('MusteriID', sql.Int, musteriID);
      rqHar.input('Tur', sql.NVarChar(20), 'Satis');
      rqHar.input('ToplamTutar', sql.Decimal(18, 2), toplam);
      rqHar.input('OdenenTutar', sql.Decimal(18, 2), 0);
      rqHar.input('KalanTutar', sql.Decimal(18, 2), kalan);
      rqHar.input('OdemeSekli', sql.NVarChar(20), null);
      const satirOzet = urunOzetleri.join(', ');
      const notParca = (aciklama || '').trim();
      rqHar.input(
        'Aciklama',
        sql.NVarChar(500),
        notParca ? `${satirOzet} — ${notParca}`.substring(0, 500) : satirOzet.substring(0, 500)
      );
      rqHar.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
      rqHar.input('Referans', sql.NVarChar(40), satisRef.substring(0, 40));
      const harIns = await rqHar.query(`
        INSERT INTO MusteriHareketleri
          (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans)
        OUTPUT INSERTED.HareketID
        VALUES
          (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @Kullanici, @Referans)
      `);
      const satisHareketID = harIns.recordset[0]?.HareketID;
      if (satisHareketID) {
        for (const s of satirlar) {
          await new sql.Request(transaction)
            .input('HareketID', sql.Int, satisHareketID)
            .input('StokID', sql.Int, s.stokID)
            .input('UrunAdi', sql.NVarChar(150), String(s.urun.UrunAdi || '').substring(0, 150))
            .input('Miktar', sql.Int, s.miktar)
            .input('BirimFiyat', sql.Decimal(18, 2), s.birimFiyat)
            .input('SatirTutar', sql.Decimal(18, 2), s.satirToplam)
            .query(`
              INSERT INTO MusteriHareketDetaylari
                (HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
              VALUES
                (@HareketID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
            `);
        }
      }

      if (tahsilat > 0) {
        const bakiyeRs = await new sql.Request(transaction)
          .input('MID', sql.Int, musteriID)
          .query('SELECT Bakiye FROM Musteriler WHERE MusteriID = @MID');
        kaydedilenFinalBakiye = Math.round(Number(bakiyeRs.recordset[0]?.Bakiye || 0) * 100) / 100;
        const rqTahHar = new sql.Request(transaction);
        rqTahHar.input('MusteriID', sql.Int, musteriID);
        rqTahHar.input('Tur', sql.NVarChar(20), 'Odeme');
        rqTahHar.input('ToplamTutar', sql.Decimal(18, 2), 0);
        rqTahHar.input('OdenenTutar', sql.Decimal(18, 2), tahsilat);
        rqTahHar.input('KalanTutar', sql.Decimal(18, 2), 0);
        rqTahHar.input('OdemeSekli', sql.NVarChar(20), odemeRaw);
        rqTahHar.input('MakbuzKalanBakiye', sql.Decimal(18, 2), kaydedilenFinalBakiye);
        rqTahHar.input('MakbuzNo', sql.Int, kaydedilenMakbuzNo);
        rqTahHar.input(
          'Aciklama',
          sql.NVarChar(500),
          `Satış tahsilatı — ${satirOzet}`.substring(0, 500)
        );
        rqTahHar.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
        rqTahHar.input('Referans', sql.NVarChar(40), satisRef.substring(0, 40));
        await rqTahHar.query(`
          INSERT INTO MusteriHareketleri
            (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, MakbuzKalanBakiye, MakbuzNo, Kullanici, Referans)
          VALUES
            (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @MakbuzKalanBakiye, @MakbuzNo, @Kullanici, @Referans)
        `);
      }

      await transaction.commit();
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw innerErr;
    }

    const adLog = musteriRs.recordset[0].AdSoyad;
    const logSep =
      kalan > 0.009
        ? `${adLog} — satış ${toplam}₺, kalan ${kalan}₺`
        : `${adLog} — satış ${toplam}₺`;
    await islemKaydet(kullanici || 'Sistem', 'Müşteri Satış', logSep);

    res.json({
      success: true,
      message: 'Sepet satışı kaydedildi.',
      toplam,
      tahsilat,
      kalan,
      makbuz: tahsilat > 0 ? {
        no: kaydedilenMakbuzNo,
        tur: 'Satış Tahsilatı',
        musteri: musteriRs.recordset[0].AdSoyad,
        odemeSekli: odemeRaw,
        tutar: tahsilat,
        aciklama: `Satış tahsilatı`,
        kalanBakiye:
          kaydedilenFinalBakiye ??
          Math.round((Number(musteriRs.recordset[0].Bakiye || 0) + Number(kalan || 0)) * 100) / 100,
        tarih: new Date().toISOString(),
      } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err?.message ? `Müşteri sepet satışı: ${err.message}` : 'Müşteri sepet satışı sırasında hata oluştu.',
    });
  }
});

async function buildMusteriIadeUrunleri(pool, musteriID) {
  const [detayRs, hareketRs] = await Promise.all([
    pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT h.HareketID, h.Tur, d.StokID, d.UrunAdi, d.Miktar, d.BirimFiyat
        FROM MusteriHareketleri h
        INNER JOIN MusteriHareketDetaylari d ON d.HareketID = h.HareketID
        WHERE h.MusteriID = @MusteriID AND h.Tur IN (N'Satis', N'Iade')
      `),
    pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT HareketID, Tur, Aciklama
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID AND Tur = N'Satis'
        ORDER BY HareketID DESC
      `),
  ]);

  const stokAgg = new Map();
  const keyFrom = (stokID, ad) => (Number.isInteger(stokID) && stokID > 0 ? `id:${stokID}` : `ad:${String(ad || '').toLowerCase()}`);
  const upsert = (stokID, urunAdi, birimFiyat, miktarDelta) => {
    const ad = String(urunAdi || '').trim();
    if (!ad) return;
    const key = keyFrom(stokID, ad);
    if (!stokAgg.has(key)) {
      stokAgg.set(key, {
        StokID: Number.isInteger(stokID) && stokID > 0 ? stokID : null,
        UrunAdi: ad,
        BirimFiyat: Number.isFinite(Number(birimFiyat)) ? Number(birimFiyat) : 0,
        KalanMiktar: 0,
      });
    }
    const row = stokAgg.get(key);
    row.KalanMiktar += Number(miktarDelta || 0);
    if ((!row.BirimFiyat || row.BirimFiyat <= 0) && Number.isFinite(Number(birimFiyat))) {
      row.BirimFiyat = Number(birimFiyat);
    }
  };

  for (const r of detayRs.recordset || []) {
    const tur = String(r.Tur || '').toLowerCase();
    const miktar = Number(r.Miktar || 0);
    if (miktar <= 0) continue;
    if (tur === 'satis') upsert(Number(r.StokID), r.UrunAdi, r.BirimFiyat, miktar);
    else if (tur === 'iade') upsert(Number(r.StokID), r.UrunAdi, r.BirimFiyat, -miktar);
  }

  const detayliHareketIdSet = new Set((detayRs.recordset || []).map((r) => Number(r.HareketID)).filter((n) => Number.isInteger(n)));
  for (const h of hareketRs.recordset || []) {
    if (detayliHareketIdSet.has(Number(h.HareketID))) continue;
    const acik = String(h.Aciklama || '');
    const parcalar = acik.split(',').map((x) => x.trim()).filter(Boolean);
    for (const p of parcalar) {
      const m = p.match(/^(.*?)\s*x(\d+)(?:\s*@\s*(\d+(?:[.,]\d+)?))?/i);
      if (!m) continue;
      const ad = String(m[1] || '').trim();
      const miktar = parseInt(m[2], 10);
      const bf = m[3] ? Number(String(m[3]).replace(',', '.')) : 0;
      if (!ad || !Number.isInteger(miktar) || miktar < 1) continue;
      upsert(null, ad, bf, miktar);
    }
  }

  const outRaw = Array.from(stokAgg.values())
    .filter((x) => x.KalanMiktar > 0 && String(x.UrunAdi || '').trim().length > 0)
    .sort((a, b) => String(a.UrunAdi).localeCompare(String(b.UrunAdi), 'tr'));

  const out = [];
  for (const r of outRaw) {
    let stokID = Number.isInteger(r.StokID) && r.StokID > 0 ? r.StokID : null;
    if (!stokID) {
      const s = await pool.request()
        .input('UrunAdi', sql.NVarChar(150), String(r.UrunAdi).trim())
        .query(`
          SELECT TOP 1 StokID
          FROM Stok
          WHERE LTRIM(RTRIM(UrunAdi)) = LTRIM(RTRIM(@UrunAdi))
          ORDER BY StokID DESC
        `);
      if (s.recordset.length) stokID = Number(s.recordset[0].StokID);
    }
    out.push({
      Key: stokID ? `stok:${stokID}` : `ad:${String(r.UrunAdi).trim().toLowerCase()}`,
      StokID: stokID,
      UrunAdi: r.UrunAdi,
      BirimFiyat: Number(r.BirimFiyat || 0),
      KalanMiktar: Number(r.KalanMiktar || 0),
    });
  }
  return out;
}

app.get('/api/musteri/:id/iade-urunler', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ message: 'Geçersiz müşteri.' });
    }
    const pool = await poolPromise;
    const out = await buildMusteriIadeUrunleri(pool, musteriID);
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'İade ürünleri alınamadı.' });
  }
});

app.post('/api/musteri/:id/iade', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { kalemler, paraIadesiVarMi, iadeTutar, odemeSekli, aciklama, kullanici } = req.body;
    const paraIadesi = !!paraIadesiVarMi;
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Kart', 'Havale'];
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    }
    if (!Array.isArray(kalemler) || !kalemler.length) {
      return res.status(400).json({ success: false, message: 'İade kalemi bulunamadı.' });
    }
    if (paraIadesi && !odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const pool = await poolPromise;
    const birlestir = new Map();
    for (const k of kalemler) {
      const stokID = parseInt(k.stokID ?? k.urunID, 10);
      const urunAdiRaw = String(k.urunAdi || '').trim();
      const miktar = parseInt(k.miktar, 10);
      const bf = Number(k.birimFiyat);
      if ((!Number.isInteger(stokID) || stokID < 1) && !urunAdiRaw) {
        return res.status(400).json({ success: false, message: 'İade ürünü bulunamadı.' });
      }
      if (!Number.isInteger(miktar) || miktar < 1 || !Number.isFinite(bf) || bf < 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz iade satırı.' });
      }
      let finalStokID = stokID;
      if (!Number.isInteger(finalStokID) || finalStokID < 1) {
        const sr = await pool.request()
          .input('UrunAdi', sql.NVarChar(150), urunAdiRaw)
          .query('SELECT TOP 1 StokID FROM Stok WHERE LTRIM(RTRIM(UrunAdi)) = LTRIM(RTRIM(@UrunAdi)) ORDER BY StokID DESC');
        if (!sr.recordset.length) {
          return res.status(404).json({ success: false, message: `Stok bulunamadı: ${urunAdiRaw}` });
        }
        finalStokID = Number(sr.recordset[0].StokID);
      }
      if (!birlestir.has(finalStokID)) birlestir.set(finalStokID, { miktar: 0, birimFiyat: bf });
      const cur = birlestir.get(finalStokID);
      cur.miktar += miktar;
      cur.birimFiyat = bf;
    }

    const musteriRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query('SELECT MusteriID, AdSoyad, Bakiye FROM Musteriler WHERE MusteriID = @MusteriID');
    if (!musteriRs.recordset.length) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }
    const musteri = musteriRs.recordset[0];

    const uygunList = await buildMusteriIadeUrunleri(pool, musteriID);
    const uygunById = new Map((uygunList || []).filter((r) => Number.isInteger(Number(r.StokID))).map((r) => [Number(r.StokID), Number(r.KalanMiktar || 0)]));
    const uygunByAd = new Map((uygunList || []).map((r) => [String(r.UrunAdi || '').trim().toLowerCase(), Number(r.KalanMiktar || 0)]));

    const satirlar = [];
    let iadeToplam = 0;
    for (const [stokID, s] of birlestir.entries()) {
      const stokKayit = await pool.request()
        .input('ID', sql.Int, stokID)
        .query('SELECT StokID, UrunAdi FROM Stok WHERE StokID = @ID');
      if (!stokKayit.recordset.length) {
        return res.status(404).json({ success: false, message: `Ürün bulunamadı (ID: ${stokID}).` });
      }
      const urun = stokKayit.recordset[0];
      const kalanById = uygunById.get(Number(stokID));
      const kalanByAd = uygunByAd.get(String(urun.UrunAdi || '').trim().toLowerCase());
      const kalan = Number.isFinite(kalanById) ? kalanById : (Number.isFinite(kalanByAd) ? kalanByAd : 0);
      if (s.miktar > kalan) {
        return res.status(400).json({ success: false, message: `İade miktarı satış miktarını aşıyor (ID: ${stokID}).` });
      }
      const satirTutar = Math.round(s.miktar * s.birimFiyat * 100) / 100;
      iadeToplam += satirTutar;
      satirlar.push({ stokID, miktar: s.miktar, birimFiyat: s.birimFiyat, satirTutar, urunAdi: urun.UrunAdi });
    }
    iadeToplam = Math.round(iadeToplam * 100) / 100;

    let iadePara = paraIadesi ? Number(iadeTutar) : 0;
    if (!Number.isFinite(iadePara) || iadePara < 0) iadePara = 0;
    iadePara = Math.round(iadePara * 100) / 100;
    if (iadePara > iadeToplam) {
      return res.status(400).json({ success: false, message: 'İade para tutarı iade toplamını geçemez.' });
    }
    const cariAzaltim = Math.min(Number(musteri.Bakiye || 0), iadeToplam);
    const finalBakiyeIade = Math.max(0, Math.round((Number(musteri.Bakiye || 0) - Number(cariAzaltim || 0)) * 100) / 100);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const s of satirlar) {
        await new sql.Request(transaction)
          .input('StokID', sql.Int, s.stokID)
          .input('Miktar', sql.Int, s.miktar)
          .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
      }

      if (cariAzaltim > 0) {
        await new sql.Request(transaction)
          .input('MusteriID', sql.Int, musteriID)
          .input('Tutar', sql.Decimal(18, 2), cariAzaltim)
          .query('UPDATE Musteriler SET Bakiye = Bakiye - @Tutar WHERE MusteriID = @MusteriID AND Bakiye >= @Tutar');
      }

      if (iadePara > 0) {
        let kasaAciklama = `Müşteri iade ödeme — ${musteri.AdSoyad} [${odemeRaw}]`;
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
        await kasayaIsleTxn(transaction, 'Cikis', iadePara, kasaAciklama, kullanici || 'Sistem');
      }

      const ref = `musteri-iade:${musteriID}:${Date.now()}`.substring(0, 40);
      const rqHar = new sql.Request(transaction);
      rqHar.input('MusteriID', sql.Int, musteriID);
      rqHar.input('Tur', sql.NVarChar(20), 'Iade');
      rqHar.input('ToplamTutar', sql.Decimal(18, 2), iadeToplam);
      rqHar.input('OdenenTutar', sql.Decimal(18, 2), 0);
      rqHar.input('KalanTutar', sql.Decimal(18, 2), cariAzaltim);
      rqHar.input('OdemeSekli', sql.NVarChar(20), null);
      const iadeOzet = satirlar.map((s) => `${s.urunAdi} x${s.miktar}`).join(', ');
      const iadeNot = (aciklama || '').trim();
      const iadeAciklama = (iadeNot ? `${iadeOzet} — ${iadeNot}` : iadeOzet).substring(0, 500);
      rqHar.input('Aciklama', sql.NVarChar(500), iadeAciklama || null);
      rqHar.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
      rqHar.input('Referans', sql.NVarChar(40), ref);
      const ins = await rqHar.query(`
        INSERT INTO MusteriHareketleri
          (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans)
        OUTPUT INSERTED.HareketID
        VALUES
          (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @Kullanici, @Referans)
      `);
      const hareketID = ins.recordset[0]?.HareketID;
      if (hareketID) {
        for (const s of satirlar) {
          await new sql.Request(transaction)
            .input('HareketID', sql.Int, hareketID)
            .input('StokID', sql.Int, s.stokID)
            .input('UrunAdi', sql.NVarChar(150), s.urunAdi.substring(0, 150))
            .input('Miktar', sql.Int, s.miktar)
            .input('BirimFiyat', sql.Decimal(18, 2), s.birimFiyat)
            .input('SatirTutar', sql.Decimal(18, 2), s.satirTutar)
            .query(`
              INSERT INTO MusteriHareketDetaylari
                (HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
              VALUES
                (@HareketID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
            `);
        }
      }

      if (iadePara > 0) {
        const rqIadeOdeme = new sql.Request(transaction);
        rqIadeOdeme.input('MusteriID', sql.Int, musteriID);
        rqIadeOdeme.input('Tur', sql.NVarChar(20), 'IadeOdeme');
        rqIadeOdeme.input('ToplamTutar', sql.Decimal(18, 2), 0);
        rqIadeOdeme.input('OdenenTutar', sql.Decimal(18, 2), iadePara);
        rqIadeOdeme.input('KalanTutar', sql.Decimal(18, 2), 0);
        rqIadeOdeme.input('OdemeSekli', sql.NVarChar(20), odemeRaw);
        rqIadeOdeme.input('Aciklama', sql.NVarChar(500), `İade para çıkışı — ${iadeOzet}`.substring(0, 500));
        rqIadeOdeme.input('MakbuzKalanBakiye', sql.Decimal(18, 2), finalBakiyeIade);
        rqIadeOdeme.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
        rqIadeOdeme.input('Referans', sql.NVarChar(40), ref);
        await rqIadeOdeme.query(`
          INSERT INTO MusteriHareketleri
            (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, MakbuzKalanBakiye, Kullanici, Referans)
          VALUES
            (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @MakbuzKalanBakiye, @Kullanici, @Referans)
        `);
      }

      await transaction.commit();
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }

    await islemKaydet(
      kullanici || 'Sistem',
      'Müşteri İade',
      `${musteri.AdSoyad}: iade ${iadeToplam}₺, para iadesi ${iadePara}₺`
    );
    res.json({ success: true, message: 'İade işlemi kaydedildi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: `İade işlemi sırasında hata oluştu: ${err.message || 'Bilinmeyen hata'}` });
  }
});

app.get('/api/musteri/:id/taksitler', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ message: 'Geçersiz müşteri.' });
    }
    const pool = await poolPromise;
    const planlar = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT TOP 20 PlanID, MusteriID, BaslangicTarihi, TaksitSayisi, ToplamBorc, KalanBorc, Durum, Aciklama, Kullanici, OlusturmaTarihi
        FROM MusteriTaksitPlanlari
        WHERE MusteriID = @MusteriID
        ORDER BY PlanID DESC
      `);
    const taksitler = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        ;WITH SonAktifPlan AS (
          SELECT TOP 1 PlanID
          FROM MusteriTaksitPlanlari
          WHERE MusteriID = @MusteriID AND Durum = N'Aktif'
          ORDER BY PlanID DESC
        )
        SELECT TOP 500 t.TaksitID, t.PlanID, t.MusteriID, t.TaksitNo, t.VadeTarihi, t.Tutar, t.OdenenTutar, t.KalanTutar, t.Durum, t.SonOdemeTarihi
        FROM MusteriTaksitler t
        INNER JOIN SonAktifPlan p ON p.PlanID = t.PlanID
        WHERE t.MusteriID = @MusteriID
        ORDER BY VadeTarihi ASC, TaksitNo ASC
      `);
    res.json({ planlar: planlar.recordset || [], taksitler: taksitler.recordset || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Taksitler alınamadı.' });
  }
});

app.post('/api/musteri/:id/taksit-plani', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { baslangicTarihi, taksitSayisi, toplamBorc, aciklama, kullanici } = req.body;
    const adet = parseInt(taksitSayisi, 10);
    const toplam = Number(toplamBorc);
    if (!Number.isInteger(musteriID) || musteriID < 1) return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    if (!baslangicTarihi || !/^\d{4}-\d{2}-\d{2}$/.test(String(baslangicTarihi))) return res.status(400).json({ success: false, message: 'Başlangıç tarihi geçersiz.' });
    if (!Number.isInteger(adet) || adet < 1 || adet > 60) return res.status(400).json({ success: false, message: 'Taksit sayısı 1-60 aralığında olmalı.' });
    if (!Number.isFinite(toplam) || toplam <= 0) return res.status(400).json({ success: false, message: 'Toplam borç geçersiz.' });

    const pool = await poolPromise;
    const musteri = await pool.request().input('MusteriID', sql.Int, musteriID).query('SELECT Bakiye, AdSoyad FROM Musteriler WHERE MusteriID=@MusteriID');
    if (!musteri.recordset.length) return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    const bakiye = Number(musteri.recordset[0].Bakiye || 0);
    if (toplam > bakiye) return res.status(400).json({ success: false, message: `Taksitlendirilecek tutar bakiyeden büyük olamaz (${bakiye.toFixed(2)} ₺).` });
    const aktifPlanKontrol = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT TOP 1 PlanID, KalanBorc, TaksitSayisi
        FROM MusteriTaksitPlanlari
        WHERE MusteriID = @MusteriID AND Durum = N'Aktif' AND KalanBorc > 0
        ORDER BY PlanID DESC
      `);
    if (aktifPlanKontrol.recordset.length > 0) {
      const p = aktifPlanKontrol.recordset[0];
      return res.status(409).json({
        success: false,
        code: 'ACTIVE_PLAN_EXISTS',
        message: `Aktif plan mevcut (#${p.PlanID}). Önce revize edin.`,
      });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await taksitPlaniOlusturTxn(transaction, musteriID, baslangicTarihi, adet, toplam, aciklama, kullanici);
      await transaction.commit();
      await islemKaydet(kullanici || 'Sistem', 'Taksit Planı', `${musteri.recordset[0].AdSoyad}: ${toplam}₺ / ${adet} taksit`);
      res.json({ success: true, message: 'Taksit planı oluşturuldu.' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Taksit planı oluşturulamadı.' });
  }
});

app.post('/api/musteri/:id/taksit-plani-revize', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { baslangicTarihi, taksitSayisi, toplamBorc, aciklama, kullanici } = req.body;
    const adet = parseInt(taksitSayisi, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    if (!baslangicTarihi || !/^\d{4}-\d{2}-\d{2}$/.test(String(baslangicTarihi))) return res.status(400).json({ success: false, message: 'Başlangıç tarihi geçersiz.' });
    if (!Number.isInteger(adet) || adet < 1 || adet > 60) return res.status(400).json({ success: false, message: 'Taksit sayısı 1-60 aralığında olmalı.' });

    const pool = await poolPromise;
    const aktif = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT PlanID, KalanBorc
        FROM MusteriTaksitPlanlari
        WHERE MusteriID = @MusteriID AND Durum = N'Aktif' AND KalanBorc > 0
      `);
    if (!aktif.recordset.length) {
      return res.status(400).json({ success: false, message: 'Revize edilecek aktif plan yok.' });
    }
    const aktifPlanIds = aktif.recordset.map((r) => Number(r.PlanID)).filter((x) => Number.isInteger(x));
    const kalanToplam = aktif.recordset.reduce((a, r) => a + Number(r.KalanBorc || 0), 0);
    const hedefToplam = Number.isFinite(Number(toplamBorc)) && Number(toplamBorc) > 0 ? Number(toplamBorc) : kalanToplam;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const idList = aktifPlanIds.join(',');
      await new sql.Request(transaction).query(`
        UPDATE MusteriTaksitler
        SET Durum = CASE WHEN KalanTutar > 0 THEN N'Devredildi' ELSE Durum END
        WHERE PlanID IN (${idList}) AND KalanTutar > 0
      `);
      await new sql.Request(transaction).query(`
        UPDATE MusteriTaksitPlanlari
        SET Durum = N'RevizeEdildi'
        WHERE PlanID IN (${idList})
      `);
      await taksitPlaniOlusturTxn(transaction, musteriID, baslangicTarihi, adet, hedefToplam, aciklama, kullanici);
      await transaction.commit();
      await islemKaydet(kullanici || 'Sistem', 'Taksit Revize', `Müşteri #${musteriID}: ${hedefToplam}₺ / ${adet} taksit`);
      res.json({ success: true, message: 'Aktif plan revize edildi.' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Taksit planı revize edilemedi.' });
  }
});

app.post('/api/musteri/:id/taksit-bekleyen-sil', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const kullanici = String(req.body?.kullanici || 'Sistem');
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    }

    const pool = await poolPromise;
    const aktif = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query(`
        SELECT TOP 1 PlanID
        FROM MusteriTaksitPlanlari
        WHERE MusteriID = @MusteriID AND Durum = N'Aktif'
        ORDER BY PlanID DESC
      `);
    if (!aktif.recordset.length) {
      return res.status(400).json({ success: false, message: 'Aktif plan bulunamadı.' });
    }
    const planID = Number(aktif.recordset[0].PlanID);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      await new sql.Request(transaction)
        .input('PlanID', sql.Int, planID)
        .query(`
          UPDATE MusteriTaksitler
          SET Durum = CASE WHEN KalanTutar > 0 THEN N'Iptal' ELSE Durum END
          WHERE PlanID = @PlanID AND KalanTutar > 0
        `);

      await new sql.Request(transaction)
        .input('PlanID', sql.Int, planID)
        .query(`
          UPDATE MusteriTaksitPlanlari
          SET Durum = N'Kapatildi', KalanBorc = 0
          WHERE PlanID = @PlanID
        `);

      await transaction.commit();
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }

    await islemKaydet(kullanici, 'Taksit Bekleyen Sil', `Müşteri #${musteriID}, plan #${planID}`);
    res.json({ success: true, message: 'Bekleyen taksitler silindi, ödenenler korundu.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Bekleyen taksitler silinemedi.' });
  }
});

app.get('/api/ayarlar', async (req, res) => {
  try {
    const pool = await poolPromise;
    const rs = await pool.request().query(`
      SELECT TOP 1 AyarID, OtomatikMakbuz, MakbuzSonNo, SirketUnvan, SirketYetkiliAdSoyad, SirketVergiNo, SirketTelefon, SirketAdres
      FROM SistemAyarlar
      WHERE AyarID = 1
    `);
    res.json(rs.recordset[0] || {
      OtomatikMakbuz: 0,
      MakbuzSonNo: 0,
      SirketUnvan: '',
      SirketYetkiliAdSoyad: '',
      SirketVergiNo: '',
      SirketTelefon: '',
      SirketAdres: '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Ayarlar alınamadı.' });
  }
});

app.post('/api/ayarlar', async (req, res) => {
  try {
    const {
      otomatikMakbuz,
      makbuzBaslangicNo,
      sirketUnvan,
      sirketYetkiliAdSoyad,
      sirketVergiNo,
      sirketTelefon,
      sirketAdres,
    } = req.body || {};
    const basNo = parseInt(makbuzBaslangicNo, 10);
    const setSonNo = Number.isInteger(basNo) && basNo > 0 ? basNo - 1 : null;
    const pool = await poolPromise;
    await pool.request()
      .input('OtomatikMakbuz', sql.Bit, otomatikMakbuz ? 1 : 0)
      .input('MakbuzSonNo', sql.Int, setSonNo)
      .input('SirketUnvan', sql.NVarChar(200), String(sirketUnvan || '').trim().substring(0, 200) || null)
      .input('SirketYetkiliAdSoyad', sql.NVarChar(120), String(sirketYetkiliAdSoyad || '').trim().substring(0, 120) || null)
      .input('SirketVergiNo', sql.NVarChar(40), String(sirketVergiNo || '').trim().substring(0, 40) || null)
      .input('SirketTelefon', sql.NVarChar(40), String(sirketTelefon || '').trim().substring(0, 40) || null)
      .input('SirketAdres', sql.NVarChar(300), String(sirketAdres || '').trim().substring(0, 300) || null)
      .query(`
        UPDATE SistemAyarlar
        SET OtomatikMakbuz = @OtomatikMakbuz,
            MakbuzSonNo = CASE WHEN @MakbuzSonNo IS NULL THEN MakbuzSonNo ELSE @MakbuzSonNo END,
            SirketUnvan = @SirketUnvan,
            SirketYetkiliAdSoyad = @SirketYetkiliAdSoyad,
            SirketVergiNo = @SirketVergiNo,
            SirketTelefon = @SirketTelefon,
            SirketAdres = @SirketAdres
        WHERE AyarID = 1
      `);
    res.json({ success: true, message: 'Ayarlar kaydedildi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Ayarlar kaydedilemedi.' });
  }
});

app.post('/api/musteri/:id/taksit-odeme', async (req, res) => {
  try {
    const musteriID = parseInt(req.params.id, 10);
    const { tutar, odemeSekli, kullanici } = req.body;
    const t = Number(tutar);
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    if (!Number.isInteger(musteriID) || musteriID < 1) return res.status(400).json({ success: false, message: 'Geçersiz müşteri.' });
    if (!Number.isFinite(t) || t <= 0) return res.status(400).json({ success: false, message: 'Geçersiz tutar.' });
    const pool = await poolPromise;
    const musteriRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query('SELECT MusteriID, AdSoyad, Bakiye FROM Musteriler WHERE MusteriID = @MusteriID');
    if (musteriRs.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }
    const musteri = musteriRs.recordset[0];
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let makbuzNo = 0;
    try {
      const dagitim = await taksitTahsilatDagitTxn(transaction, musteriID, t, odemeRaw, kullanici || 'Sistem');
      if (dagitim.tahsilEdilen <= 0) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: 'Bekleyen taksit bulunamadı.' });
      }
      await new sql.Request(transaction)
        .input('MusteriID', sql.Int, musteriID)
        .input('Tutar', sql.Decimal(18, 2), dagitim.tahsilEdilen)
        .query('UPDATE Musteriler SET Bakiye = Bakiye - @Tutar WHERE MusteriID = @MusteriID AND Bakiye >= @Tutar');
      const finalBakiye = Math.max(0, Math.round((Number(musteri.Bakiye || 0) - Number(dagitim.tahsilEdilen || 0)) * 100) / 100);
      if (dagitim.odemeHareketID) {
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, dagitim.odemeHareketID)
          .input('MakbuzKalanBakiye', sql.Decimal(18, 2), finalBakiye)
          .query('UPDATE MusteriHareketleri SET MakbuzKalanBakiye = @MakbuzKalanBakiye WHERE HareketID = @HareketID');
      }
      await kasayaIsleTxn(transaction, 'Giris', dagitim.tahsilEdilen, `Taksit tahsilatı [${odemeRaw}]`, kullanici || 'Sistem');
      makbuzNo = await nextMakbuzNoTxn(transaction);
      if (dagitim.odemeHareketID) {
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, dagitim.odemeHareketID)
          .input('MakbuzNo', sql.Int, makbuzNo)
          .query('UPDATE MusteriHareketleri SET MakbuzNo = @MakbuzNo WHERE HareketID = @HareketID');
      }
      await transaction.commit();
      res.json({
        success: true,
        message: 'Taksit ödemesi işlendi.',
        makbuz: {
          no: makbuzNo,
          tur: 'Taksit Tahsilatı',
          musteri: musteri.AdSoyad,
          odemeSekli: odemeRaw,
          tutar: Number(dagitim.tahsilEdilen || 0),
          aciklama: `Taksit tahsilatı - ${odemeRaw}${dagitim.detayMetin ? ` (${dagitim.detayMetin})` : ''}`,
          kalanBakiye: Math.max(0, Math.round((Number(musteri.Bakiye || 0) - Number(dagitim.tahsilEdilen || 0)) * 100) / 100),
          tarih: new Date().toISOString(),
        },
      });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Taksit ödemesi sırasında hata oluştu.' });
  }
});

app.get('/api/musteri/hareket/:hareketID/detay', async (req, res) => {
  try {
    const hareketID = parseInt(req.params.hareketID, 10);
    if (!Number.isInteger(hareketID) || hareketID < 1) {
      return res.status(400).json({ message: 'Geçersiz hareket.' });
    }
    const pool = await poolPromise;
    const hareketRs = await pool.request()
      .input('HareketID', sql.Int, hareketID)
      .query(`
        SELECT HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans, Tarih
        FROM MusteriHareketleri
        WHERE HareketID = @HareketID
      `);
    if (hareketRs.recordset.length === 0) {
      return res.status(404).json({ message: 'Hareket bulunamadı.' });
    }
    const hareket = hareketRs.recordset[0];
    let detaylar = [];
    const detayRs = await pool.request()
      .input('HareketID', sql.Int, hareketID)
      .query(`
        SELECT DetayID, HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
        FROM MusteriHareketDetaylari
        WHERE HareketID = @HareketID
        ORDER BY DetayID ASC
      `);
    detaylar = detayRs.recordset || [];
    const tur = (hareket.Tur || '').toLowerCase();
    if (!detaylar.length && (tur === 'satis' || tur === 'iade')) {
      const fallback = musteriHareketDetayAciklamadan(hareket);
      if (fallback.length) detaylar = fallback;
    }

    res.json({ hareket, detaylar });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Hareket detayı alınamadı.' });
  }
});

async function musteriSatisOdenenToplamTxn(transaction, hareket) {
  const ref = String(hareket.Referans || '').trim();
  if (ref) {
    const odRs = await new sql.Request(transaction)
      .input('MusteriID', sql.Int, hareket.MusteriID)
      .input('Referans', sql.NVarChar(40), ref)
      .query(`
        SELECT SUM(OdenenTutar) AS Toplam
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID AND Referans = @Referans
          AND Tur IN (N'Odeme', N'IadeOdeme')
      `);
    return Math.round(Number(odRs.recordset[0]?.Toplam || 0) * 100) / 100;
  }
  return Math.round(Number(hareket.OdenenTutar || 0) * 100) / 100;
}

async function musteriHareketTaksitDagilimVarMi(transaction, hareketID) {
  const rs = await new sql.Request(transaction)
    .input('HareketID', sql.Int, hareketID)
    .query(`
      SELECT TOP 1 DagilimID
      FROM MusteriTaksitOdemeDagilimlari
      WHERE HareketID = @HareketID
    `);
  return (rs.recordset || []).length > 0;
}

/** Müşteri satış kalemlerini düzenler; stok ve cari bakiyeyi fark kadar günceller */
async function musteriHareketSatisDuzenleTxn(transaction, hareketID, kalemler, kullanici) {
  const hRs = await new sql.Request(transaction)
    .input('HareketID', sql.Int, hareketID)
    .query(`
      SELECT HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, Referans, Aciklama, Kullanici
      FROM MusteriHareketleri
      WHERE HareketID = @HareketID
    `);
  if (!hRs.recordset.length) {
    return { success: false, status: 404, message: 'Hareket bulunamadı.' };
  }
  const hareket = hRs.recordset[0];
  const tur = (hareket.Tur || '').toLowerCase();
  if (tur !== 'satis') {
    return { success: false, status: 400, message: 'Bu işlem satış değil; düzenlenemez.' };
  }
  if (musteriDevirHareketMi(hareket)) {
    return { success: false, status: 409, message: 'Devir bakiyesi kaydı düzenlenemez.' };
  }
  if (!Array.isArray(kalemler) || !kalemler.length) {
    return { success: false, status: 400, message: 'En az bir kalem gerekli.' };
  }

  const detRs = await new sql.Request(transaction)
    .input('HareketID', sql.Int, hareketID)
    .query(`
      SELECT DetayID, HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
      FROM MusteriHareketDetaylari
      WHERE HareketID = @HareketID
      ORDER BY DetayID ASC
    `);
  const eskiDetaylar = detRs.recordset || [];
  const eskiMap = new Map(eskiDetaylar.map((d) => [Number(d.DetayID), d]));
  const oldToplam = Math.round(Number(hareket.ToplamTutar || 0) * 100) / 100;

  const normalizeKalem = (k) => {
    const detayID = parseInt(k.detayID, 10) || 0;
    const stokID = parseInt(k.stokID ?? k.urunID, 10) || 0;
    const miktar = Math.round(Number(k.miktar));
    let birimFiyat = Number(k.birimFiyat);
    let satirTutar = Number(k.satirTutar);
    if ((!Number.isFinite(birimFiyat) || birimFiyat < 0) && Number.isFinite(satirTutar) && miktar > 0) {
      birimFiyat = Math.round((satirTutar / miktar) * 100) / 100;
    }
    if ((!Number.isFinite(satirTutar) || satirTutar <= 0) && Number.isFinite(birimFiyat) && miktar > 0) {
      satirTutar = Math.round(miktar * birimFiyat * 100) / 100;
    }
    birimFiyat = Math.round((Number(birimFiyat) || 0) * 100) / 100;
    satirTutar = Math.round((Number(satirTutar) || 0) * 100) / 100;
    return {
      detayID,
      stokID,
      urunAdi: String(k.urunAdi || '').trim().substring(0, 150),
      miktar,
      birimFiyat,
      satirTutar,
    };
  };

  const yeniKalemler = [];
  for (const raw of kalemler) {
    const k = normalizeKalem(raw);
    if (!Number.isInteger(k.miktar) || k.miktar < 1) {
      return { success: false, status: 400, message: 'Adet en az 1 olmalıdır.' };
    }
    if (!Number.isFinite(k.birimFiyat) || k.birimFiyat < 0) {
      return { success: false, status: 400, message: 'Geçerli birim fiyat girin.' };
    }
    if (!Number.isFinite(k.satirTutar) || k.satirTutar <= 0) {
      return { success: false, status: 400, message: 'Geçerli satır tutarı girin.' };
    }
    if (k.detayID > 0 && !eskiMap.has(k.detayID) && !eskiDetaylar.length) {
      /* eski detaysız satış — aşağıda özel yol */
    } else if (k.detayID > 0 && !eskiMap.has(k.detayID)) {
      return { success: false, status: 400, message: 'Geçersiz kalem seçildi.' };
    }
    if (!(k.detayID > 0) && !(k.stokID > 0) && !k.urunAdi) {
      return { success: false, status: 400, message: 'Yeni kalem için ürün seçin.' };
    }
    yeniKalemler.push(k);
  }

  /** Eski detayı olmayan tek satırlık satışlar */
  if (!eskiDetaylar.length) {
    let newToplam = 0;
    for (const k of yeniKalemler) newToplam += k.satirTutar;
    newToplam = Math.round(newToplam * 100) / 100;
    for (const k of yeniKalemler) {
      let stokID = k.stokID > 0 ? k.stokID : null;
      let urunAdi = k.urunAdi || 'Satış';
      if (stokID) {
        const stokRs = await new sql.Request(transaction)
          .input('StokID', sql.Int, stokID)
          .query('SELECT StokID, UrunAdi FROM Stok WHERE StokID = @StokID');
        if (!stokRs.recordset.length) {
          return { success: false, status: 404, message: 'Ürün bulunamadı.' };
        }
        urunAdi = String(stokRs.recordset[0].UrunAdi || urunAdi).substring(0, 150);
        if (!(await stokSatisDusurTxn(transaction, stokID, k.miktar))) {
          return { success: false, status: 409, message: 'Stok güncellenemedi.' };
        }
      }
      await new sql.Request(transaction)
        .input('HareketID', sql.Int, hareketID)
        .input('StokID', sql.Int, stokID)
        .input('UrunAdi', sql.NVarChar(150), urunAdi)
        .input('Miktar', sql.Int, k.miktar)
        .input('BirimFiyat', sql.Decimal(18, 2), k.birimFiyat)
        .input('SatirTutar', sql.Decimal(18, 2), k.satirTutar)
        .query(`
          INSERT INTO MusteriHareketDetaylari
            (HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
          VALUES
            (@HareketID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
        `);
    }
    const delta = Math.round((newToplam - oldToplam) * 100) / 100;
    if (Math.abs(delta) > 0.009) {
      await new sql.Request(transaction)
        .input('MusteriID', sql.Int, hareket.MusteriID)
        .input('Delta', sql.Decimal(18, 2), delta)
        .query('UPDATE Musteriler SET Bakiye = Bakiye + @Delta WHERE MusteriID = @MusteriID');
    }
    const odenen = await musteriSatisOdenenToplamTxn(transaction, hareket);
    if (odenen > newToplam + 0.009) {
      return {
        success: false,
        status: 409,
        message: `Satış tutarı tahsilattan (${odenen.toFixed(2)} ₺) küçük olamaz.`,
      };
    }
    const kalan = Math.round((newToplam - odenen) * 100) / 100;
    await new sql.Request(transaction)
      .input('HareketID', sql.Int, hareketID)
      .input('ToplamTutar', sql.Decimal(18, 2), newToplam)
      .input('KalanTutar', sql.Decimal(18, 2), kalan)
      .query(`
        UPDATE MusteriHareketleri
        SET ToplamTutar = @ToplamTutar, KalanTutar = @KalanTutar
        WHERE HareketID = @HareketID
      `);
    return { success: true, message: 'Satış güncellendi.', yeniToplam: newToplam };
  }

  const kalanDetayIds = new Set(yeniKalemler.filter((k) => k.detayID > 0).map((k) => k.detayID));

  /** Silinen kalemler — stok iade */
  for (const d of eskiDetaylar) {
    const id = Number(d.DetayID);
    if (kalanDetayIds.has(id)) continue;
    if (d.StokID && Number(d.Miktar) > 0) {
      await new sql.Request(transaction)
        .input('StokID', sql.Int, d.StokID)
        .input('Miktar', sql.Int, Number(d.Miktar))
        .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
    }
    await new sql.Request(transaction)
      .input('DetayID', sql.Int, id)
      .query('DELETE FROM MusteriHareketDetaylari WHERE DetayID = @DetayID');
  }

  let newToplam = 0;
  for (const k of yeniKalemler) {
    if (k.detayID > 0) {
      const d = eskiMap.get(k.detayID);
      const oldMiktar = Number(d.Miktar || 0);
      const deltaMiktar = k.miktar - oldMiktar;
      if (deltaMiktar !== 0 && d.StokID) {
        if (deltaMiktar > 0) {
          if (!(await stokSatisDusurTxn(transaction, d.StokID, deltaMiktar))) {
            return { success: false, status: 409, message: 'Stok güncellenemedi.' };
          }
        } else {
          await new sql.Request(transaction)
            .input('StokID', sql.Int, d.StokID)
            .input('Miktar', sql.Int, -deltaMiktar)
            .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
        }
      }
      await new sql.Request(transaction)
        .input('DetayID', sql.Int, k.detayID)
        .input('Miktar', sql.Int, k.miktar)
        .input('BirimFiyat', sql.Decimal(18, 2), k.birimFiyat)
        .input('SatirTutar', sql.Decimal(18, 2), k.satirTutar)
        .query(`
          UPDATE MusteriHareketDetaylari
          SET Miktar = @Miktar, BirimFiyat = @BirimFiyat, SatirTutar = @SatirTutar
          WHERE DetayID = @DetayID
        `);
      newToplam += k.satirTutar;
      continue;
    }

    /** Yeni kalem */
    let stokID = k.stokID > 0 ? k.stokID : null;
    let urunAdi = k.urunAdi || 'Ürün';
    if (stokID) {
      const stokRs = await new sql.Request(transaction)
        .input('StokID', sql.Int, stokID)
        .query('SELECT StokID, UrunAdi FROM Stok WHERE StokID = @StokID');
      if (!stokRs.recordset.length) {
        return { success: false, status: 404, message: 'Ürün bulunamadı.' };
      }
      urunAdi = String(stokRs.recordset[0].UrunAdi || urunAdi).substring(0, 150);
      if (!(await stokSatisDusurTxn(transaction, stokID, k.miktar))) {
        return { success: false, status: 409, message: 'Stok güncellenemedi.' };
      }
    }
    await new sql.Request(transaction)
      .input('HareketID', sql.Int, hareketID)
      .input('StokID', sql.Int, stokID)
      .input('UrunAdi', sql.NVarChar(150), urunAdi.substring(0, 150))
      .input('Miktar', sql.Int, k.miktar)
      .input('BirimFiyat', sql.Decimal(18, 2), k.birimFiyat)
      .input('SatirTutar', sql.Decimal(18, 2), k.satirTutar)
      .query(`
        INSERT INTO MusteriHareketDetaylari
          (HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
        VALUES
          (@HareketID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
      `);
    newToplam += k.satirTutar;
  }

  newToplam = Math.round(newToplam * 100) / 100;
  const delta = Math.round((newToplam - oldToplam) * 100) / 100;
  if (Math.abs(delta) > 0.009) {
    await new sql.Request(transaction)
      .input('MusteriID', sql.Int, hareket.MusteriID)
      .input('Delta', sql.Decimal(18, 2), delta)
      .query('UPDATE Musteriler SET Bakiye = Bakiye + @Delta WHERE MusteriID = @MusteriID');
  }
  const odenen = await musteriSatisOdenenToplamTxn(transaction, hareket);
  if (odenen > newToplam + 0.009) {
    return {
      success: false,
      status: 409,
      message: `Satış tutarı tahsilattan (${odenen.toFixed(2)} ₺) küçük olamaz. Önce tahsilatı düzenleyin.`,
    };
  }
  const kalan = Math.round((newToplam - odenen) * 100) / 100;
  await new sql.Request(transaction)
    .input('HareketID', sql.Int, hareketID)
    .input('ToplamTutar', sql.Decimal(18, 2), newToplam)
    .input('KalanTutar', sql.Decimal(18, 2), kalan)
    .query(`
      UPDATE MusteriHareketleri
      SET ToplamTutar = @ToplamTutar, KalanTutar = @KalanTutar
      WHERE HareketID = @HareketID
    `);
  return { success: true, message: 'Satış güncellendi.', yeniToplam: newToplam };
}

/** Müşteri tahsilatını düzenler; cari ve kasayı fark kadar günceller */
async function musteriHareketOdemeDuzenleTxn(transaction, hareketID, tutar, odemeSekli, kullanici) {
  const hRs = await new sql.Request(transaction)
    .input('HareketID', sql.Int, hareketID)
    .query(`
      SELECT HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Referans, Aciklama, Kullanici
      FROM MusteriHareketleri
      WHERE HareketID = @HareketID
    `);
  if (!hRs.recordset.length) {
    return { success: false, status: 404, message: 'Hareket bulunamadı.' };
  }
  const hareket = hRs.recordset[0];
  const tur = (hareket.Tur || '').toLowerCase();
  const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
  const odemeRaw = String(odemeSekli || hareket.OdemeSekli || 'Nakit').trim();
  if (!odemeIzinli.includes(odemeRaw)) {
    return { success: false, status: 400, message: 'Geçersiz ödeme şekli.' };
  }
  if (musteriDevirHareketMi(hareket)) {
    return { success: false, status: 409, message: 'Devir bakiyesi kaydı düzenlenemez.' };
  }

  const gomuluSatis = tur === 'satis' && Number(hareket.OdenenTutar || 0) > 0.009;
  if (tur !== 'odeme' && tur !== 'iadeodeme' && !gomuluSatis) {
    return { success: false, status: 400, message: 'Bu işlem tahsilat değil; düzenlenemez.' };
  }
  if (!gomuluSatis && (await musteriHareketTaksitDagilimVarMi(transaction, hareketID))) {
    return { success: false, status: 409, message: 'Taksit dağıtımlı tahsilat düzenlenemez.' };
  }

  const oldTutar = gomuluSatis
    ? Math.round(Number(hareket.OdenenTutar || 0) * 100) / 100
    : Math.round(Number(hareket.OdenenTutar || 0) * 100) / 100;
  const newTutar = Math.round(Number(tutar) * 100) / 100;
  if (!Number.isFinite(newTutar) || newTutar <= 0) {
    return { success: false, status: 400, message: 'Geçerli tutar girin.' };
  }

  const ref = String(hareket.Referans || '').trim();
  if (ref) {
    const satisRs = await new sql.Request(transaction)
      .input('MusteriID', sql.Int, hareket.MusteriID)
      .input('Referans', sql.NVarChar(40), ref)
      .query(`
        SELECT TOP 1 HareketID, ToplamTutar
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID AND Referans = @Referans AND Tur = N'Satis'
        ORDER BY HareketID ASC
      `);
    if (satisRs.recordset.length) {
      const satisToplam = Number(satisRs.recordset[0].ToplamTutar || 0);
      if (newTutar > satisToplam + 0.009) {
        return {
          success: false,
          status: 400,
          message: `Tahsilat satış toplamını (${satisToplam.toFixed(2)} ₺) geçemez.`,
        };
      }
    }
  } else if (gomuluSatis) {
    const satisToplam = Number(hareket.ToplamTutar || 0);
    if (newTutar > satisToplam + 0.009) {
      return {
        success: false,
        status: 400,
        message: `Tahsilat satış toplamını (${satisToplam.toFixed(2)} ₺) geçemez.`,
      };
    }
  }

  const delta = Math.round((newTutar - oldTutar) * 100) / 100;
  if (delta > 0.009) {
    const rqBakiye = new sql.Request(transaction);
    rqBakiye.input('MusteriID', sql.Int, hareket.MusteriID);
    rqBakiye.input('Delta', sql.Decimal(18, 2), delta);
    const upd = await rqBakiye.query(`
      UPDATE Musteriler
      SET Bakiye = Bakiye - @Delta
      WHERE MusteriID = @MusteriID AND Bakiye >= @Delta
    `);
    if (upd.rowsAffected[0] === 0) {
      return {
        success: false,
        status: 409,
        message: 'Tahsilat artırılamadı (müşteri bakiyesi yetersiz).',
      };
    }
  } else if (delta < -0.009) {
    await new sql.Request(transaction)
      .input('MusteriID', sql.Int, hareket.MusteriID)
      .input('Delta', sql.Decimal(18, 2), -delta)
      .query('UPDATE Musteriler SET Bakiye = Bakiye + @Delta WHERE MusteriID = @MusteriID');
  }

  if (Math.abs(delta) > 0.009) {
    const musteriRs = await new sql.Request(transaction)
      .input('MusteriID', sql.Int, hareket.MusteriID)
      .query('SELECT AdSoyad FROM Musteriler WHERE MusteriID = @MusteriID');
    const ad = musteriRs.recordset[0]?.AdSoyad || 'Müşteri';
    let kasaAciklama = `Müşteri tahsilat düzenleme — ${ad} [${odemeRaw}] [#${hareketID}]`;
    if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
    if (delta > 0) {
      await kasayaIsleTxn(transaction, 'Giris', delta, kasaAciklama, kullanici || 'Sistem');
    } else {
      await kasayaIsleTxn(transaction, 'Cikis', -delta, kasaAciklama, kullanici || 'Sistem');
    }
  }

  if (gomuluSatis) {
    const kalan = Math.round((Number(hareket.ToplamTutar || 0) - newTutar) * 100) / 100;
    await new sql.Request(transaction)
      .input('HareketID', sql.Int, hareketID)
      .input('OdenenTutar', sql.Decimal(18, 2), newTutar)
      .input('KalanTutar', sql.Decimal(18, 2), kalan)
      .input('OdemeSekli', sql.NVarChar(20), odemeRaw)
      .query(`
        UPDATE MusteriHareketleri
        SET OdenenTutar = @OdenenTutar, KalanTutar = @KalanTutar, OdemeSekli = @OdemeSekli
        WHERE HareketID = @HareketID
      `);
  } else {
    await new sql.Request(transaction)
      .input('HareketID', sql.Int, hareketID)
      .input('OdenenTutar', sql.Decimal(18, 2), newTutar)
      .input('OdemeSekli', sql.NVarChar(20), odemeRaw)
      .query(`
        UPDATE MusteriHareketleri
        SET OdenenTutar = @OdenenTutar, OdemeSekli = @OdemeSekli
        WHERE HareketID = @HareketID
      `);
    if (ref) {
      const satisRs = await new sql.Request(transaction)
        .input('MusteriID', sql.Int, hareket.MusteriID)
        .input('Referans', sql.NVarChar(40), ref)
        .query(`
          SELECT TOP 1 HareketID, ToplamTutar
          FROM MusteriHareketleri
          WHERE MusteriID = @MusteriID AND Referans = @Referans AND Tur = N'Satis'
          ORDER BY HareketID ASC
        `);
      if (satisRs.recordset.length) {
        const satis = satisRs.recordset[0];
        const kalan = Math.round((Number(satis.ToplamTutar || 0) - newTutar) * 100) / 100;
        await new sql.Request(transaction)
          .input('HareketID', sql.Int, satis.HareketID)
          .input('KalanTutar', sql.Decimal(18, 2), kalan)
          .query('UPDATE MusteriHareketleri SET KalanTutar = @KalanTutar WHERE HareketID = @HareketID');
      }
    }
  }

  return { success: true, message: 'Tahsilat güncellendi.', yeniTutar: newTutar, odemeSekli: odemeRaw };
}

app.patch('/api/musteri/hareket/:hareketID/duzenle', async (req, res) => {
  try {
    const hareketID = parseInt(req.params.hareketID, 10);
    const { tip, kalemler, tutar, odemeSekli, kullanici } = req.body || {};
    const kul = (kullanici || 'Sistem').toString().substring(0, 50);
    if (!Number.isInteger(hareketID) || hareketID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz hareket.' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      let sonuc;
      const tipNorm = String(tip || '').toLowerCase();
      if (tipNorm === 'satis') {
        sonuc = await musteriHareketSatisDuzenleTxn(transaction, hareketID, kalemler, kul);
      } else if (tipNorm === 'odeme') {
        sonuc = await musteriHareketOdemeDuzenleTxn(transaction, hareketID, tutar, odemeSekli, kul);
      } else {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: 'Geçersiz düzenleme türü.' });
      }
      if (!sonuc.success) {
        await transaction.rollback();
        return res.status(sonuc.status || 400).json({ success: false, message: sonuc.message });
      }
      await transaction.commit();
      const logTur = tipNorm === 'satis' ? 'Müşteri Satış Düzenleme' : 'Müşteri Tahsilat Düzenleme';
      await islemKaydet(kul, logTur, `Hareket #${hareketID} düzenlendi`);
      res.json({ success: true, message: sonuc.message });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Hareket düzenlenemedi.' });
  }
});

/** Müşteri hareket grubunu (referanslı satış+tahsilat vb.) geri alır */
async function musteriHareketGrupIptal(pool, hareketID, kullanici) {
  const hedefRs = await pool.request()
    .input('HareketID', sql.Int, hareketID)
    .query(`
      SELECT HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, Referans, Aciklama, Tarih
      FROM MusteriHareketleri
      WHERE HareketID = @HareketID
    `);
  if (hedefRs.recordset.length === 0) {
    return { success: false, status: 404, message: 'Hareket bulunamadı.' };
  }
  const hedef = hedefRs.recordset[0];
  const ref = (hedef.Referans || '').trim();

  let grupRs;
  if (ref) {
    grupRs = await pool.request()
      .input('MusteriID', sql.Int, hedef.MusteriID)
      .input('Referans', sql.NVarChar(40), ref)
      .query(`
        SELECT HareketID, MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, Referans, Aciklama, Tarih
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID AND Referans = @Referans
        ORDER BY HareketID ASC
      `);
  } else {
    grupRs = { recordset: [hedef] };
  }
  const grup = grupRs.recordset || [];
  if (!grup.length) {
    return { success: false, status: 404, message: 'Hareket grubu bulunamadı.' };
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const h of grup) {
        if ((h.Tur || '').toLowerCase() === 'satis') {
          const rqCari = new sql.Request(transaction);
          rqCari.input('MusteriID', sql.Int, h.MusteriID);
          rqCari.input('Tutar', sql.Decimal(18, 2), Number(h.ToplamTutar || 0));
          const upd = await rqCari.query(`
            UPDATE Musteriler
            SET Bakiye = Bakiye - @Tutar
            WHERE MusteriID = @MusteriID AND Bakiye >= @Tutar
          `);
          if (upd.rowsAffected[0] === 0) {
            await transaction.rollback();
            return { success: false, status: 409, message: 'Satış geri alınamadı (bakiye yetersiz).' };
          }

          const detRs = await new sql.Request(transaction)
            .input('HareketID', sql.Int, h.HareketID)
            .query(`
              SELECT StokID, Miktar
              FROM MusteriHareketDetaylari
              WHERE HareketID = @HareketID
            `);
          for (const d of detRs.recordset || []) {
            if (!d.StokID || !d.Miktar) continue;
            await new sql.Request(transaction)
              .input('StokID', sql.Int, d.StokID)
              .input('Miktar', sql.Int, d.Miktar)
              .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
          }
        } else if ((h.Tur || '').toLowerCase() === 'odeme') {
          const odeme = Number(h.OdenenTutar || 0);
          const dagilimRs = await new sql.Request(transaction)
            .input('HareketID', sql.Int, h.HareketID)
            .query(`
              SELECT DagilimID, PlanID, TaksitID, Tutar
              FROM MusteriTaksitOdemeDagilimlari
              WHERE HareketID = @HareketID
            `);
          const dagilimlar = dagilimRs.recordset || [];
          if (dagilimlar.length > 0) {
            const maxPlanID = dagilimlar.reduce((mx, d) => Math.max(mx, Number(d.PlanID || 0)), 0);
            const sonrakiPlan = await new sql.Request(transaction)
              .input('MusteriID', sql.Int, h.MusteriID)
              .input('MaxPlanID', sql.Int, maxPlanID)
              .query(`
                SELECT TOP 1 PlanID
                FROM MusteriTaksitPlanlari
                WHERE MusteriID = @MusteriID
                  AND PlanID > @MaxPlanID
                ORDER BY PlanID DESC
              `);
            if (sonrakiPlan.recordset.length > 0) {
              await transaction.rollback();
              return {
                success: false,
                status: 409,
                message: 'Bu tahsilattan sonra yeni taksit yapılandırması var. İşlem silinemez.',
              };
            }
          }
          if (dagilimlar.length > 0) {
            for (const d of dagilimlar) {
              await new sql.Request(transaction)
                .input('TaksitID', sql.Int, d.TaksitID)
                .input('Tutar', sql.Decimal(18, 2), Number(d.Tutar || 0))
                .query(`
                  UPDATE MusteriTaksitler
                  SET OdenenTutar = OdenenTutar - @Tutar,
                      KalanTutar = KalanTutar + @Tutar,
                      Durum = N'Bekliyor'
                  WHERE TaksitID = @TaksitID
                `);
              await new sql.Request(transaction)
                .input('PlanID', sql.Int, d.PlanID)
                .input('Tutar', sql.Decimal(18, 2), Number(d.Tutar || 0))
                .query(`
                  UPDATE MusteriTaksitPlanlari
                  SET KalanBorc = KalanBorc + @Tutar,
                      Durum = N'Aktif'
                  WHERE PlanID = @PlanID
                `);
            }
          }
          if (odeme > 0) {
            await new sql.Request(transaction)
              .input('MusteriID', sql.Int, h.MusteriID)
              .input('Tutar', sql.Decimal(18, 2), odeme)
              .query('UPDATE Musteriler SET Bakiye = Bakiye + @Tutar WHERE MusteriID = @MusteriID');
            let kasaAciklama = `Müşteri hareket iptali — Tahsilat geri alındı [#${h.HareketID}]`;
            if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
            await kasayaIsleTxn(transaction, 'Cikis', odeme, kasaAciklama, kullanici);
          }
        } else if ((h.Tur || '').toLowerCase() === 'iade') {
          const cariDusum = Number(h.KalanTutar || 0);
          if (cariDusum > 0) {
            await new sql.Request(transaction)
              .input('MusteriID', sql.Int, h.MusteriID)
              .input('Tutar', sql.Decimal(18, 2), cariDusum)
              .query('UPDATE Musteriler SET Bakiye = Bakiye + @Tutar WHERE MusteriID = @MusteriID');
          }
          const detRs = await new sql.Request(transaction)
            .input('HareketID', sql.Int, h.HareketID)
            .query(`
              SELECT StokID, Miktar
              FROM MusteriHareketDetaylari
              WHERE HareketID = @HareketID
            `);
          for (const d of detRs.recordset || []) {
            if (!d.StokID || !d.Miktar) continue;
            await new sql.Request(transaction)
              .input('StokID', sql.Int, d.StokID)
              .input('Miktar', sql.Int, d.Miktar)
              .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar - @Miktar WHERE StokID = @StokID AND MevcutMiktar >= @Miktar');
          }
        } else if ((h.Tur || '').toLowerCase() === 'iadeodeme') {
          const iadePara = Number(h.OdenenTutar || 0);
          if (iadePara > 0) {
            let kasaAciklama = `Müşteri iade ödeme iptali [#${h.HareketID}]`;
            if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
            await kasayaIsleTxn(transaction, 'Giris', iadePara, kasaAciklama, kullanici);
          }
        }
      }

      const ids = grup.map((g) => Number(g.HareketID)).filter((x) => Number.isInteger(x));
      if (ids.length) {
        const inList = ids.join(',');
        await new sql.Request(transaction).query(`DELETE FROM MusteriTaksitOdemeDagilimlari WHERE HareketID IN (${inList})`);
        await new sql.Request(transaction).query(`DELETE FROM MusteriHareketDetaylari WHERE HareketID IN (${inList})`);
        await new sql.Request(transaction).query(`DELETE FROM MusteriHareketleri WHERE HareketID IN (${inList})`);
      }

    await transaction.commit();
  } catch (innerErr) {
    try {
      await transaction.rollback();
    } catch (_) {}
    throw innerErr;
  }

  try {
    await gunlukCariHareketSilSenkron(pool, grup, kullanici);
  } catch (syncErr) {
    console.warn('Günlük işlem senkronu atlandı:', syncErr.message);
  }

  return { success: true, message: 'İşlem geri alındı; günlük kayıt iptal edildi.' };
}

/** Stok/kasa cari silmede zaten geri alındı — yalnızca hızlı satış iptal bayrağı */
async function hizliSatisKayitIptalIsaretle(pool, kayitID, kullanici) {
  if (!Number.isInteger(kayitID) || kayitID < 1) return false;
  try {
    const rs = await pool.request()
      .input('KayitID', sql.Int, kayitID)
      .input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50))
      .query(`
        UPDATE HizliSatisKayitlari
        SET IptalEdildi = 1, IptalTarihi = GETDATE(), IptalKullanici = @Kullanici
        WHERE KayitID = @KayitID AND IptalEdildi = 0
      `);
    return rs.rowsAffected[0] > 0;
  } catch (err) {
    console.warn('Hızlı satış iptal işareti yazılamadı:', err.message);
    return false;
  }
}

/** Günlük listeden düşürülecek (iptal edilmiş) hızlı satış LogID / KayitID seti */
async function gunlukIptalEdilmisLogIdleri(pool, basStr, bitStr) {
  const ids = new Set();
  if (!(await tabloVarMi(pool, 'HizliSatisKayitlari'))) return ids;
  try {
    const rs = await pool.request()
      .input('bas', sql.NVarChar(10), basStr)
      .input('bit', sql.NVarChar(10), bitStr)
      .query(`
        SELECT LogID, KayitID
        FROM HizliSatisKayitlari
        WHERE IptalEdildi = 1
          AND CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
          AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
      `);
    for (const row of rs.recordset || []) {
      const lid = Number(row.LogID);
      const kid = Number(row.KayitID);
      if (lid) ids.add(lid);
      if (kid) ids.add(kid);
    }
  } catch (err) {
    console.warn('İptal hızlı satış listesi okunamadı:', err.message);
  }
  return ids;
}

function musteriSatisIptalLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  return tip === 'Müşteri Satış İptal' || tip === 'Musteri Satis Iptal';
}

function musteriOdemeIptalLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  return tip === 'Müşteri Ödeme İptal' || tip === 'Musteri Odeme Iptal';
}

async function islemLogBulMusteriSatis(pool, musteriAd, tarih, toplam) {
  if (!musteriAd) return null;
  const hRs = await pool.request()
    .input('MusteriAd', sql.NVarChar(120), `${musteriAd}%`.substring(0, 120))
    .input('Tarih', sql.DateTime, tarih)
    .query(`
      SELECT TOP 8 LogID, Aciklama, Tarih FROM IslemGecmisi
      WHERE IslemTipi IN (N'Müşteri Satış', N'Musteri Satis')
        AND Aciklama LIKE @MusteriAd
        AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= 300
      ORDER BY ABS(DATEDIFF(SECOND, Tarih, @Tarih)) ASC
    `);
  const liste = hRs.recordset || [];
  if (!liste.length) return null;
  if (toplam > 0) {
    const eslesen = liste.find((l) => {
      const t = aciklamadanMusteriSatisToplam(l.Aciklama) || aciklamadanTutar(l.Aciklama);
      return Math.abs(t - toplam) < 0.02;
    });
    if (eslesen) return eslesen;
  }
  return liste[0];
}

async function islemLogBulMusteriOdeme(pool, musteriAd, tarih, tutar) {
  if (!musteriAd) return null;
  const adLike = `${musteriAd}%`.substring(0, 120);
  const ara = async (saniyePenceresi) => {
    const hRs = await pool.request()
      .input('MusteriAd', sql.NVarChar(120), adLike)
      .input('Tarih', sql.DateTime, tarih)
      .input('Pencere', sql.Int, saniyePenceresi)
      .query(`
        SELECT TOP 12 LogID, Aciklama, Tarih FROM IslemGecmisi
        WHERE IslemTipi IN (N'Müşteri Ödeme', N'Musteri Odeme')
          AND Aciklama LIKE @MusteriAd
          AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= @Pencere
        ORDER BY ABS(DATEDIFF(SECOND, Tarih, @Tarih)) ASC
      `);
    return hRs.recordset || [];
  };
  let liste = await ara(300);
  if (!liste.length) liste = await ara(86400);
  if (!liste.length) return null;
  if (tutar > 0) {
    const eslesen = liste.find((l) => {
      const t = aciklamadanMusteriOdemeTutar(l.Aciklama) || aciklamadanTutar(l.Aciklama);
      return Math.abs(t - tutar) < 0.02;
    });
    if (eslesen) return eslesen;
  }
  return liste[0];
}

function referansLogIdCikar(ref) {
  const m = String(ref || '').match(/:L(\d+)$/i);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function gunlukLogIptalKaydet(pool, kullanici, iptalTipi, logID, not) {
  if (!logID) return;
  const iptalRs = await pool.request()
    .input('LikePat', sql.NVarChar(50), `%Log #${logID}%`)
    .query(`
      SELECT TOP 1 LogID FROM IslemGecmisi
      WHERE Aciklama LIKE @LikePat
        AND IslemTipi LIKE N'%ptal%'
    `);
  if (iptalRs.recordset.length) return;
  await islemKaydet(
    kullanici,
    iptalTipi,
    String(not || `Log #${logID} cari silme`).substring(0, 500),
  );
}

/** Cari silme sonrası günlük işlem / hızlı satış kaydını iptal eder */
async function gunlukCariHareketSilSenkron(pool, grup, kullanici) {
  if (!grup?.length) return;
  await ensureHizliSatisKayitTablosu(pool);

  const kullaniciEtiket = String(kullanici || 'Sistem').substring(0, 50);
  const iptalLogIds = new Set();

  let musteriAd = '';
  const ilk = grup[0];
  const musteriID = Number(ilk?.MusteriID);
  if (Number.isInteger(musteriID) && musteriID > 0) {
    const mRs = await pool.request()
      .input('MID', sql.Int, musteriID)
      .query('SELECT AdSoyad, FirmaAdi, tur FROM Musteriler WHERE MusteriID = @MID');
    if (mRs.recordset[0]) musteriAd = musteriGorunenAdKayit(mRs.recordset[0]);
  }

  for (const h of grup) {
    const tur = String(h.Tur || '').toLowerCase();
    const ref = String(h.Referans || '').trim();
    const hareketID = Number(h.HareketID);
    const tarih = h.Tarih ? new Date(h.Tarih) : null;
    if (!tarih) continue;

    if (tur === 'satis') {
      if (ref && (await tabloVarMi(pool, 'HizliSatisKayitlari'))) {
        let kayit = null;
        const kRs = await pool.request()
          .input('Ref', sql.NVarChar(40), ref.substring(0, 40))
          .query(`
            SELECT TOP 1 KayitID, LogID, IptalEdildi FROM HizliSatisKayitlari
            WHERE Referans = @Ref
            ORDER BY KayitID DESC
          `);
        kayit = kRs.recordset[0] || null;
        if (!kayit && Number.isInteger(musteriID) && musteriID > 0) {
          const toplam = Number(h.ToplamTutar || 0);
          const kRs2 = await pool.request()
            .input('MID', sql.Int, musteriID)
            .input('Tarih', sql.DateTime, tarih)
            .input('Toplam', sql.Decimal(18, 2), toplam)
            .query(`
              SELECT TOP 1 KayitID, LogID, IptalEdildi FROM HizliSatisKayitlari
              WHERE MusteriID = @MID AND IptalEdildi = 0
                AND ABS(SepetToplam - @Toplam) < 0.02
                AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= 300
              ORDER BY ABS(DATEDIFF(SECOND, Tarih, @Tarih)) ASC
            `);
          kayit = kRs2.recordset[0] || null;
        }
        if (kayit && !kayit.IptalEdildi) {
          await hizliSatisKayitIptalIsaretle(pool, kayit.KayitID, kullaniciEtiket);
          const logID = Number(kayit.LogID);
          if (logID && !iptalLogIds.has(logID)) {
            iptalLogIds.add(logID);
            await gunlukLogIptalKaydet(
              pool,
              kullaniciEtiket,
              'Hızlı Satış İptal',
              logID,
              `Log #${logID} cari silme — Hareket #${hareketID}`,
            );
          }
          continue;
        }
      }

      if (ref.startsWith('musteri-satis') || ref.startsWith('mobil:satis')) {
        const toplam = Number(h.ToplamTutar || 0);
        let logID = referansLogIdCikar(ref);
        if (!logID) {
          const hedefLog = await islemLogBulMusteriSatis(pool, musteriAd, tarih, toplam);
          logID = hedefLog?.LogID;
        }
        if (logID && !iptalLogIds.has(logID)) {
          iptalLogIds.add(logID);
          await gunlukLogIptalKaydet(
            pool,
            kullaniciEtiket,
            'Müşteri Satış İptal',
            logID,
            `Log #${logID} cari silme — Hareket #${hareketID} — ${musteriAd}`,
          );
        }
      }
      continue;
    }

    if (tur === 'odeme') {
      const tutar = Number(h.OdenenTutar || 0);
      let logID = referansLogIdCikar(ref);
      if (!logID) {
        const hedefLog = await islemLogBulMusteriOdeme(pool, musteriAd, tarih, tutar);
        logID = hedefLog?.LogID;
      }
      if (!logID && (ref.startsWith('musteri-satis') || ref.startsWith('mobil:satis'))) {
        const hedefLog = await islemLogBulMusteriSatis(pool, musteriAd, tarih, tutar);
        logID = hedefLog?.LogID;
      }
      if (logID && !iptalLogIds.has(logID)) {
        iptalLogIds.add(logID);
        await gunlukLogIptalKaydet(
          pool,
          kullaniciEtiket,
          'Müşteri Ödeme İptal',
          logID,
          `Log #${logID} cari silme — Hareket #${hareketID} — ${musteriAd}`,
        );
      }
    }
  }
}

async function hizliSatisKayitIptalEt(pool, kayit, kullanici) {
  if (kayit.IptalEdildi) {
    return { success: false, status: 400, message: 'Bu satış zaten iptal edilmiş.' };
  }
  const detRs = await pool.request()
    .input('KayitID', sql.Int, kayit.KayitID)
    .query('SELECT StokID, Miktar FROM HizliSatisKayitDetaylari WHERE KayitID = @KayitID');
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const d of detRs.recordset || []) {
      if (!d.StokID || !d.Miktar) continue;
      await new sql.Request(transaction)
        .input('StokID', sql.Int, d.StokID)
        .input('Miktar', sql.Int, d.Miktar)
        .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
    }
    const tahsilat = Number(kayit.TahsilatTutar || 0);
    if (tahsilat > 0) {
      let kasaAciklama = `Hızlı satış iptali [#${kayit.KayitID}]`;
      if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';
      await kasayaIsleTxn(transaction, 'Cikis', tahsilat, kasaAciklama, kullanici);
    }
    await new sql.Request(transaction)
      .input('KayitID', sql.Int, kayit.KayitID)
      .input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50))
      .query(`
        UPDATE HizliSatisKayitlari
        SET IptalEdildi = 1, IptalTarihi = GETDATE(), IptalKullanici = @Kullanici
        WHERE KayitID = @KayitID
      `);
    await transaction.commit();
    return { success: true, message: 'Satış iptal edildi.' };
  } catch (innerErr) {
    try {
      await transaction.rollback();
    } catch (_) {}
    throw innerErr;
  }
}

/** Müşterisiz hızlı satış kaydını günceller (stok + kasa farkı uygulanır). */
async function hizliSatisKayitGuncelle(pool, kayit, log, opts) {
  if (!kayit || kayit.IptalEdildi) {
    return { success: false, status: 400, message: 'Bu satış düzenlenemez.' };
  }
  if (kayit.MusteriID) {
    return { success: false, status: 400, message: 'Müşterili satış buradan düzenlenemez.' };
  }
  const { satirlar, genelToplam, kasaTutar, odemeRaw, kullanici } = opts;
  if (!satirlar?.length) {
    return { success: false, status: 400, message: 'Sepet boş.' };
  }

  const detRs = await pool.request()
    .input('KayitID', sql.Int, kayit.KayitID)
    .query('SELECT StokID, Miktar FROM HizliSatisKayitDetaylari WHERE KayitID = @KayitID');

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const d of detRs.recordset || []) {
      if (!d.StokID || !d.Miktar) continue;
      await new sql.Request(transaction)
        .input('StokID', sql.Int, d.StokID)
        .input('Miktar', sql.Int, d.Miktar)
        .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
    }

    const eskiTahsilat = Number(kayit.TahsilatTutar || 0);
    if (eskiTahsilat > 0) {
      let kasaAciklama = `Hızlı satış düzenleme (eski) [#${kayit.KayitID}]`;
      if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';
      await kasayaIsleTxn(transaction, 'Cikis', eskiTahsilat, kasaAciklama, kullanici);
    }

    await new sql.Request(transaction)
      .input('KayitID', sql.Int, kayit.KayitID)
      .query('DELETE FROM HizliSatisKayitDetaylari WHERE KayitID = @KayitID');

    for (const s of satirlar) {
      if (!(await stokSatisDusurTxn(transaction, s.stokID, s.miktar))) {
        await transaction.rollback();
        return { success: false, status: 409, message: 'Stok kaydı güncellenemedi (yetersiz stok olabilir).' };
      }
    }

    if (odemeRaw !== 'Veresiye' && kasaTutar > 0) {
      let kasaAciklama = `Hızlı satış düzenleme (${satirlar.length} kalem) [${odemeRaw}]`;
      if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';
      await kasayaIsleTxn(transaction, 'Giris', kasaTutar, kasaAciklama, kullanici);
    }

    await new sql.Request(transaction)
      .input('KayitID', sql.Int, kayit.KayitID)
      .input('SepetToplam', sql.Decimal(18, 2), genelToplam)
      .input('TahsilatTutar', sql.Decimal(18, 2), kasaTutar)
      .input('OdemeSekli', sql.NVarChar(20), String(odemeRaw || 'Nakit').substring(0, 20))
      .query(`
        UPDATE HizliSatisKayitlari
        SET SepetToplam = @SepetToplam, TahsilatTutar = @TahsilatTutar, OdemeSekli = @OdemeSekli
        WHERE KayitID = @KayitID
      `);

    for (const s of satirlar) {
      const birim =
        s.birimFiyat != null && Number.isFinite(s.birimFiyat)
          ? s.birimFiyat
          : s.miktar > 0
            ? Math.round((s.satirTutar / s.miktar) * 100) / 100
            : 0;
      await new sql.Request(transaction)
        .input('KayitID', sql.Int, kayit.KayitID)
        .input('StokID', sql.Int, s.stokID || null)
        .input('UrunAdi', sql.NVarChar(150), String(s.urunAdi || '').substring(0, 150))
        .input('Miktar', sql.Int, s.miktar)
        .input('BirimFiyat', sql.Decimal(18, 2), birim)
        .input('SatirTutar', sql.Decimal(18, 2), s.satirTutar)
        .query(`
          INSERT INTO HizliSatisKayitDetaylari
            (KayitID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
          VALUES (@KayitID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
        `);
    }

    if (log?.LogID) {
      const logAciklama = `Hızlı satış ${genelToplam}₺, tahsilat ${kasaTutar}₺ [${odemeRaw}]`;
      await new sql.Request(transaction)
        .input('LogID', sql.Int, log.LogID)
        .input('Aciklama', sql.NVarChar(500), logAciklama.substring(0, 500))
        .query('UPDATE IslemGecmisi SET Aciklama = @Aciklama WHERE LogID = @LogID');
    }

    await transaction.commit();
    return { success: true, message: 'Perakende satış güncellendi.' };
  } catch (innerErr) {
    try {
      await transaction.rollback();
    } catch (_) {}
    throw innerErr;
  }
}

function sqlRowSayi(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object' && typeof v.valueOf === 'function') {
    const n = Number(v.valueOf());
    return Number.isFinite(n) ? n : 0;
  }
  return parseLiraSayi(v);
}

function gunlukTedarikKalemSatirNormalize(d) {
  const miktar = Math.max(1, Math.round(sqlRowSayi(d.Miktar)));
  let birim = sqlRowSayi(d.BirimFiyat ?? d.AlisBirimFiyat);
  let tutar = sqlRowSayi(d.SatirTutar);
  if (tutar <= 0 && birim > 0 && miktar > 0) {
    tutar = Math.round(miktar * birim * 100) / 100;
  }
  if (birim <= 0 && tutar > 0 && miktar > 0) {
    birim = Math.round((tutar / miktar) * 100) / 100;
  }
  return {
    UrunAdi: String(d.UrunAdi || '-').trim(),
    Miktar: miktar,
    BirimFiyat: birim,
    SatirTutar: tutar,
  };
}

function gunlukTedarikKalemAdNorm(ad) {
  return String(ad || '')
    .trim()
    .toLocaleUpperCase('tr-TR');
}

function gunlukTedarikKalemleriBirlestir(textK, dbK) {
  const used = new Set();
  const out = [];
  for (const t of textK) {
    const key = gunlukTedarikKalemAdNorm(t.UrunAdi);
    const dbIdx = dbK.findIndex((d, i) => !used.has(i) && gunlukTedarikKalemAdNorm(d.UrunAdi) === key);
    if (dbIdx >= 0) {
      used.add(dbIdx);
      const db = dbK[dbIdx];
      out.push(
        gunlukTedarikKalemSatirNormalize({
          UrunAdi: t.UrunAdi || db.UrunAdi,
          Miktar: sqlRowSayi(t.Miktar) || sqlRowSayi(db.Miktar),
          BirimFiyat: db.BirimFiyat,
          SatirTutar: db.SatirTutar,
        })
      );
    } else {
      out.push(gunlukTedarikKalemSatirNormalize(t));
    }
  }
  dbK.forEach((d, i) => {
    if (!used.has(i)) out.push(gunlukTedarikKalemSatirNormalize(d));
  });
  return out;
}

async function gunlukTedarikciIdBul(pool, unvanKisa) {
  const u = String(unvanKisa || '').trim();
  if (!u) return null;
  try {
    const rs = await pool.request()
      .input('U', sql.NVarChar(200), u)
      .input('ULike', sql.NVarChar(210), `${u}%`)
      .query(`
        SELECT TOP 1 TedarikciID FROM Tedarikciler
        WHERE LTRIM(RTRIM(Unvan)) = LTRIM(RTRIM(@U))
           OR LTRIM(RTRIM(Unvan)) LIKE LTRIM(RTRIM(@ULike))
        ORDER BY CASE WHEN LTRIM(RTRIM(Unvan)) = LTRIM(RTRIM(@U)) THEN 0 ELSE 1 END,
                 TedarikciID DESC
      `);
    const id = parseInt(rs.recordset[0]?.TedarikciID, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch (_) {
    return null;
  }
}

function gunlukMalAlimFiyatTamamla(kalemler, toplam) {
  if (!Array.isArray(kalemler) || !kalemler.length) return kalemler;
  const t = sqlRowSayi(toplam);
  if (t <= 0) return kalemler.map((k) => gunlukTedarikKalemSatirNormalize(k));
  const norm = kalemler.map((k) => gunlukTedarikKalemSatirNormalize(k));
  const hepsiBos = norm.every((k) => k.BirimFiyat <= 0 && k.SatirTutar <= 0);
  if (!hepsiBos) return norm;
  let kalan = t;
  return norm.map((k, i) => {
    const miktar = k.Miktar;
    const tutar =
      i === norm.length - 1
        ? Math.round(kalan * 100) / 100
        : Math.round((t / norm.length) * 100) / 100;
    kalan = Math.round((kalan - tutar) * 100) / 100;
    const birim = miktar > 0 ? Math.round((tutar / miktar) * 100) / 100 : tutar;
    return { ...k, BirimFiyat: birim, SatirTutar: tutar };
  });
}

async function gunlukMalAlimSatirlariBul(pool, row) {
  const unvan = aciklamadanTedarikciUnvan(row.Aciklama);
  const tid = unvan ? await gunlukTedarikciIdBul(pool, unvan) : null;
  if (!tid || !(await tabloVarMi(pool, 'TedarikAlim'))) return null;
  const mal = aciklamadanTedarikMalAlim(row.Aciklama);
  const toplamAday =
    mal && mal.toplam > 0
      ? mal.toplam
      : Number(row.AlimToplam) > 0
        ? Number(row.AlimToplam)
        : 0;
  const denemeler = [true, false];
  for (const toplamZorunlu of denemeler) {
    if (toplamZorunlu && toplamAday <= 0) continue;
    try {
      const req = pool.request()
        .input('Tid', sql.Int, tid)
        .input('Tarih', sql.DateTime, row.Tarih);
      let topClause = '';
      if (toplamZorunlu && toplamAday > 0) {
        req.input('Toplam', sql.Decimal(18, 2), toplamAday);
        topClause = 'AND ABS(a.ToplamTutar - @Toplam) < 0.05';
      }
      const alimRs = await req.query(`
        SELECT TOP 1 a.AlimID
        FROM TedarikAlim a
        WHERE a.TedarikciID = @Tid
          ${topClause}
          AND CAST(a.Tarih AS DATE) = CAST(@Tarih AS DATE)
        ORDER BY ABS(DATEDIFF(SECOND, a.Tarih, @Tarih)) ASC
      `);
      if (!alimRs.recordset.length) continue;
      const aid = alimRs.recordset[0].AlimID;
      const satirlar = await gunlukTedarikAlimSatirlari(pool, aid);
      if (satirlar.length) return { alimID: aid, satirlar };
    } catch (err) {
      console.warn('Mal alım satırları bulunamadı:', err.message);
    }
  }
  return null;
}

async function gunlukMalAlimKalemleri(pool, row, tumIslemler = null) {
  const aciklama = row.Aciklama || '';
  const mal = aciklamadanTedarikMalAlim(aciklama);
  const toplamKaynak =
    mal && mal.toplam > 0 ? mal.toplam : Number(row.AlimToplam) > 0 ? Number(row.AlimToplam) : 0;

  let alimID = row.AlimID || aciklamadanAlimID(aciklama);
  if (!alimID && Array.isArray(tumIslemler)) {
    const unvan = aciklamadanTedarikciUnvan(aciklama);
    const rowT = row.Tarih ? new Date(row.Tarih).getTime() : 0;
    for (const diger of tumIslemler) {
      if (diger === row || !diger?.Aciklama) continue;
      const aid = aciklamadanAlimID(diger.Aciklama);
      if (!aid) continue;
      if (unvan && aciklamadanTedarikciUnvan(diger.Aciklama) !== unvan) continue;
      if (rowT && diger.Tarih && Math.abs(new Date(diger.Tarih).getTime() - rowT) > 600000) continue;
      alimID = aid;
      break;
    }
  }

  let dbK = [];
  if (alimID) dbK = await gunlukTedarikAlimSatirlari(pool, alimID);
  if (!dbK.length) {
    const bul = await gunlukMalAlimSatirlariBul(pool, row);
    if (bul) {
      alimID = bul.alimID;
      dbK = bul.satirlar;
    }
  }
  if (alimID) row.AlimID = alimID;

  const textK = aciklamadanKalemler(aciklama);
  let sonuc;
  if (dbK.length && textK.length) sonuc = gunlukTedarikKalemleriBirlestir(textK, dbK);
  else if (dbK.length) sonuc = dbK;
  else sonuc = textK.map((t) => gunlukTedarikKalemSatirNormalize(t));

  return gunlukMalAlimFiyatTamamla(sonuc, toplamKaynak);
}

/** Satış ana satırını kalem kalem düz satırlara böler (alt fatura tablosu yok). */
function gunlukIslemSatisKalemSatirlarinaBol(islemler) {
  const musterisiz = PERAKENDE_ISLEM_ETIKET;
  const cikti = [];
  for (const r of islemler) {
    const satisAna =
      (r.Kaynak === 'satis' || r.Kaynak === 'musteri_satis') && r.SatirTur === 'satis';
    if (!satisAna) {
      cikti.push(r);
      continue;
    }
    let detaylar = Array.isArray(r.detaylar) ? [...r.detaylar] : [];
    if (!detaylar.length) detaylar = aciklamadanKalemler(r.Aciklama);
    if (!detaylar.length) {
      cikti.push(r);
      continue;
    }
    const musteriAd = r.MusteriAd || r.KisaAciklama || musterisiz;
    detaylar.forEach((d, idx) => {
      const miktar = Number(d.Miktar || 0);
      const birim = Number(d.BirimFiyat || 0);
      let tutar = Number(d.SatirTutar || 0);
      if ((!tutar || tutar <= 0) && miktar > 0 && birim > 0) {
        tutar = Math.round(miktar * birim * 100) / 100;
      }
      cikti.push({
        ...r,
        SatirTur: 'satis_kalem',
        KalemSira: idx,
        UrunAdi: String(d.UrunAdi || '-').trim(),
        Miktar: miktar,
        BirimFiyat: birim,
        Tutar: tutar,
        TurEtiket: 'Satış',
        KisaAciklama: musteriAd,
        MusteriAd: musteriAd,
        Odeme: '—',
      });
    });
  }
  return cikti;
}

/** Mal alım ana satırını kalem kalem düz satırlara böler (satış ile aynı mantık). */
function gunlukIslemMalAlimKalemSatirlarinaBol(islemler) {
  const cikti = [];
  for (const r of islemler) {
    const malAna = r.Kaynak === 'mal_alim' && r.SatirTur !== 'mal_alim_kalem';
    if (!malAna) {
      cikti.push(r);
      continue;
    }
    let detaylar = Array.isArray(r.detaylar) ? [...r.detaylar] : [];
    if (!detaylar.length) detaylar = aciklamadanKalemler(r.Aciklama);
    if (!detaylar.length) {
      cikti.push(r);
      continue;
    }
    const malParse = aciklamadanTedarikMalAlim(r.Aciklama);
    const toplamK =
      malParse && malParse.toplam > 0
        ? malParse.toplam
        : Number(r.AlimToplam) > 0
          ? Number(r.AlimToplam)
          : 0;
    detaylar = gunlukMalAlimFiyatTamamla(detaylar, toplamK);
    const tedarikciAd = aciklamadanTedarikciUnvan(r.Aciklama) || 'Tedarikçi';
    detaylar.forEach((d, idx) => {
      const n = gunlukTedarikKalemSatirNormalize(d);
      cikti.push({
        ...r,
        GrupLogID: r.GrupLogID || r.LogID,
        SatirTur: 'mal_alim_kalem',
        KalemSira: idx,
        UrunAdi: n.UrunAdi,
        Miktar: n.Miktar,
        BirimFiyat: n.BirimFiyat,
        Tutar: n.SatirTutar,
        TurEtiket: idx === 0 ? 'Mal alım' : '',
        KisaAciklama: tedarikciAd,
        MusteriAd: tedarikciAd,
        Odeme: '—',
      });
    });
  }
  return cikti;
}

function gunlukMalAlimOdemeSatirOlustur(ref, tutar, odeme, veresiyeMi) {
  return {
    LogID: ref.LogID,
    GrupLogID: ref.GrupLogID || ref.LogID,
    Tarih: ref.Tarih,
    KullaniciAdi: ref.KullaniciAdi,
    IslemTipi: ref.IslemTipi,
    SatirTur: 'mal_alim_odeme',
    TurEtiket: veresiyeMi ? 'Veresiye' : 'Ödeme',
    Odeme: odeme || (veresiyeMi ? 'Veresiye' : '—'),
    Tutar: Math.round(Number(tutar || 0) * 100) / 100,
    AlimToplam: ref.AlimToplam,
    Aciklama: ref.Aciklama,
    MusteriAd: ref.MusteriAd,
    KisaAciklama: ref.KisaAciklama,
    Yon: 'cikis',
    Kaynak: 'mal_alim_odeme',
    MobilKaynak: ref.MobilKaynak,
  };
}

/** Mal alım kalemlerinin altına ödeme / veresiye satırı (müşteri tahsilatı gibi). */
function gunlukIslemMalAlimOdemeSatirlariEkle(islemler) {
  const cikti = [];
  const gruplar = new Map();

  for (const r of islemler) {
    if (r.SatirTur === 'mal_alim_kalem') {
      const key = `mal-${r.GrupLogID || r.LogID}`;
      if (!gruplar.has(key)) gruplar.set(key, []);
      gruplar.get(key).push(r);
      continue;
    }
    if (r.Kaynak === 'mal_alim' && r.SatirTur === 'mal_alim') {
      continue;
    }
    cikti.push(r);
  }

  for (const items of gruplar.values()) {
    if (!items.length) continue;
    items.sort((a, b) => (Number(a.KalemSira) || 0) - (Number(b.KalemSira) || 0));
    const ref = items[0];
    cikti.push(...items);

    const mal = aciklamadanTedarikMalAlim(ref.Aciklama);
    const toplam =
      Number(ref.AlimToplam) > 0 ? Number(ref.AlimToplam) : mal && mal.toplam > 0 ? mal.toplam : 0;
    const kasa = mal ? tedarikMalAlimKasaTutari(mal) : 0;
    const kalan =
      mal && mal.kalan > 0
        ? mal.kalan
        : Math.max(0, Math.round((toplam - kasa) * 100) / 100);
    let odeme = ref.Odeme || aciklamadanOdeme(ref.Aciklama) || '—';
    if (kasa <= 0 && kalan > 0) odeme = 'Veresiye';

    if (kasa > 0.009) {
      cikti.push(gunlukMalAlimOdemeSatirOlustur(ref, kasa, odeme, false));
    }
    if (kalan > 0.009) {
      cikti.push(gunlukMalAlimOdemeSatirOlustur(ref, kalan, 'Veresiye', true));
    }
  }

  return cikti;
}

function gunlukIslemSatirSiraDegeri(r) {
  if (r.SatirTur === 'satis_kalem') return Number(r.KalemSira) || 0;
  if (r.SatirTur === 'mal_alim_kalem') return Number(r.KalemSira) || 0;
  if (r.SatirTur === 'satis') return 40;
  if (r.SatirTur === 'tahsilat' || r.SatirTur === 'mal_alim_odeme') return 90;
  return 50;
}

async function gunlukHizliSatisDetaylari(pool, kayitID) {
  if (!Number.isInteger(kayitID) || kayitID < 1) return [];
  try {
    const dRs = await pool.request()
      .input('KayitID', sql.Int, kayitID)
      .query(`
        SELECT StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
        FROM HizliSatisKayitDetaylari WHERE KayitID = @KayitID ORDER BY DetayID
      `);
    return dRs.recordset || [];
  } catch (err) {
    console.warn('Hızlı satış detayları okunamadı:', err.message);
    return [];
  }
}

async function gunlukIslemFaturaDetaylariEkle(pool, islemler) {
  const hedef = islemler.filter(
    (r) =>
      ['mal_alim', 'musteri_satis', 'satis'].includes(r.Kaynak) &&
      r.SatirTur !== 'tahsilat' &&
      (r.LogID || r.KayitID)
  );
  const CONC = 10;
  for (let i = 0; i < hedef.length; i += CONC) {
    const parca = hedef.slice(i, i + CONC);
    await Promise.all(
      parca.map(async (row) => {
        try {
          if (row.Kaynak === 'mal_alim') {
            row.detaylar = await gunlukMalAlimKalemleri(pool, row, islemler);
          } else if (row.Kaynak === 'musteri_satis' && row.HareketID) {
            const veri = await gunlukIslemDetayVerHareket(pool, Number(row.HareketID));
            row.detaylar = veri?.detaylar || [];
          } else if (row.Kaynak === 'satis' && row.KayitID) {
            row.detaylar = await gunlukHizliSatisDetaylari(pool, Number(row.KayitID));
          } else {
            const veri = await gunlukIslemDetayVer(pool, row.LogID, {
              kaynak: row.Kaynak || '',
              hareketID: row.HareketID ? Number(row.HareketID) : null,
            });
            row.detaylar = veri?.detaylar || [];
          }
        } catch (err) {
          console.warn('Günlük detay yüklenemedi:', row.Kaynak, err.message);
          row.detaylar = [];
        }
      })
    );
  }
}

/** Günlük listede LogID = HareketID olan müşteri cari satış/tahsilat detayı */
async function gunlukIslemDetayVerHareket(pool, hareketID) {
  const hRs = await pool.request()
    .input('HareketID', sql.Int, hareketID)
    .query(`
      SELECT h.HareketID, h.MusteriID, h.Tur, h.ToplamTutar, h.OdenenTutar, h.KalanTutar,
             h.OdemeSekli, h.Aciklama, h.Kullanici, h.Referans, h.Tarih,
             m.AdSoyad, m.FirmaAdi, m.tur AS MusteriTur
      FROM MusteriHareketleri h
      LEFT JOIN Musteriler m ON m.MusteriID = h.MusteriID
      WHERE h.HareketID = @HareketID
    `);
  if (!hRs.recordset.length) return null;
  const h = hRs.recordset[0];
  const tur = String(h.Tur || '').toLowerCase();

  let islemTipi = 'Müşteri Hareket';
  if (tur === 'satis') islemTipi = 'Müşteri Satış';
  else if (tur === 'odeme') islemTipi = 'Müşteri Ödeme';
  else if (tur === 'iade') islemTipi = 'Müşteri İade';
  else if (tur === 'iadeodeme') islemTipi = 'Müşteri İade Ödeme';

  const log = {
    LogID: hareketID,
    KullaniciAdi: h.Kullanici || '—',
    IslemTipi: islemTipi,
    Aciklama: h.Aciklama || '',
    Tarih: h.Tarih,
  };

  let detaylar = [];
  let sepetToplam = 0;
  let tahsilatTutar = 0;
  let odeme = h.OdemeSekli || 'Diğer';
  const musteriID = h.MusteriID ? Number(h.MusteriID) : null;
  let musteriAd = gunlukHareketMusteriAd(h);
  if (musteriAd === 'Müşteri' && musteriID) musteriAd = null;

  if (tur === 'satis' || tur === 'iade') {
    const detRs = await pool.request()
      .input('HareketID', sql.Int, hareketID)
      .query(`
        SELECT StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
        FROM MusteriHareketDetaylari WHERE HareketID = @HareketID ORDER BY DetayID
      `);
    detaylar = detRs.recordset || [];
    sepetToplam = Number(h.ToplamTutar || 0);
    if (!sepetToplam && detaylar.length) {
      sepetToplam = detaylar.reduce((s, d) => s + Number(d.SatirTutar || 0), 0);
    }

    if (tur === 'satis' && h.Referans) {
      const tahRs = await pool.request()
        .input('Ref', sql.NVarChar(40), h.Referans)
        .query(`
          SELECT OdenenTutar, OdemeSekli
          FROM MusteriHareketleri
          WHERE Tur = N'Odeme' AND Referans = @Ref
        `);
      for (const o of tahRs.recordset || []) {
        tahsilatTutar += Number(o.OdenenTutar || 0);
        if (o.OdemeSekli) odeme = o.OdemeSekli;
      }
      tahsilatTutar = Math.round(tahsilatTutar * 100) / 100;
    }
  } else if (tur === 'odeme' || tur === 'iadeodeme') {
    tahsilatTutar = Number(h.OdenenTutar || 0);
    sepetToplam = tahsilatTutar;
    odeme = h.OdemeSekli || odeme;
  }

  let veresiyeTutar = Math.max(0, Number(h.KalanTutar || 0));
  if (tur === 'satis' && veresiyeTutar <= 0 && sepetToplam > tahsilatTutar) {
    veresiyeTutar = Math.round((sepetToplam - tahsilatTutar) * 100) / 100;
  }
  if (tur === 'satis' && tahsilatTutar <= 0 && veresiyeTutar > 0) odeme = 'Veresiye';

  if (musteriID && !musteriAd) {
    const mRs = await pool.request()
      .input('MID', sql.Int, musteriID)
      .query('SELECT AdSoyad, FirmaAdi, tur FROM Musteriler WHERE MusteriID = @MID');
    const mRow = mRs.recordset[0];
    if (mRow) musteriAd = musteriGorunenAdKayit(mRow);
  }
  if (!musteriAd) musteriAd = aciklamadanMusteriAdi(h.Aciklama);

  return {
    log,
    odeme,
    sepetToplam,
    tahsilatTutar,
    veresiyeTutar,
    musteriID,
    musteriAd,
    tedarikciAd: null,
    referans: h.Referans || null,
    hareketID,
    kayitID: null,
    detaylar,
    iptalEdildi: false,
    iptalEdilebilir: false,
    iptalYeri: 'cari',
    musterili: !!(musteriID && musteriID > 0),
    malAlim: false,
  };
}

async function gunlukIslemDetayVerHskKayit(pool, kayit) {
  const detaylar = await gunlukHizliSatisDetaylari(pool, kayit.KayitID);
  const log = {
    LogID: kayit.LogID || kayit.KayitID,
    KullaniciAdi: kayit.Kullanici || '—',
    IslemTipi: 'Hızlı Satış',
    Aciklama: '',
    Tarih: kayit.Tarih,
  };
  const odeme = kayit.OdemeSekli || 'Nakit';
  const sepetToplam = Number(kayit.SepetToplam || 0);
  let tahsilatTutar = Number(kayit.TahsilatTutar || 0);
  if (odeme !== 'Veresiye' && tahsilatTutar <= 0 && sepetToplam > 0) tahsilatTutar = sepetToplam;
  const iptalEdildi = !!(kayit.IptalEdildi);
  const musterili = !!(kayit.MusteriID && Number(kayit.MusteriID) > 0);
  const iptalEdilebilir = !iptalEdildi && !musterili && !!kayit.KayitID;
  let veresiyeTutar = Math.max(0, Math.round((sepetToplam - tahsilatTutar) * 100) / 100);
  if (odeme === 'Veresiye') veresiyeTutar = sepetToplam;

  return {
    log,
    odeme,
    sepetToplam,
    tahsilatTutar,
    veresiyeTutar,
    musteriID: kayit.MusteriID || null,
    musteriAd: musterili ? null : PERAKENDE_ISLEM_ETIKET,
    tedarikciAd: null,
    referans: kayit.Referans || null,
    hareketID: null,
    kayitID: kayit.KayitID,
    detaylar,
    iptalEdildi,
    iptalEdilebilir,
    duzenleEdilebilir: iptalEdilebilir,
    iptalYeri: iptalEdilebilir ? 'gunluk' : 'yok',
    musterili,
    malAlim: false,
  };
}

async function gunlukIslemDetayVerHskBul(pool, logID) {
  if (!(await tabloVarMi(pool, 'HizliSatisKayitlari'))) return null;
  try {
    const kRs = await pool.request()
      .input('ID', sql.Int, logID)
      .query(`
        SELECT TOP 1 * FROM HizliSatisKayitlari
        WHERE LogID = @ID OR KayitID = @ID
      `);
    const kayit = kRs.recordset[0];
    if (!kayit) return null;
    return gunlukIslemDetayVerHskKayit(pool, kayit);
  } catch (err) {
    console.warn('Hızlı satış kaydı okunamadı:', err.message);
    return null;
  }
}

async function gunlukIslemDetayVer(pool, logID, opts = {}) {
  const kaynak = String(opts.kaynak || '').trim();
  let hareketID =
    Number.isInteger(opts.hareketID) && opts.hareketID > 0 ? opts.hareketID : null;
  const cariKaynaklar = [
    'musteri_satis',
    'musteri_tahsilat',
    'musteri_odeme',
    'musteri_iade',
    'musteri_iade_odeme',
  ];
  if (cariKaynaklar.includes(kaynak)) {
    const hid = hareketID || logID;
    const hareketVeri = await gunlukIslemDetayVerHareket(pool, hid);
    if (hareketVeri) return hareketVeri;
  }

  const logRs = await pool.request()
    .input('LogID', sql.Int, logID)
    .query('SELECT LogID, KullaniciAdi, IslemTipi, Aciklama, Tarih FROM IslemGecmisi WHERE LogID = @LogID');
  if (!logRs.recordset.length) {
    const hskVeri = await gunlukIslemDetayVerHskBul(pool, logID);
    if (hskVeri) return hskVeri;
    const hareketVeri = await gunlukIslemDetayVerHareket(pool, hareketID || logID);
    if (hareketVeri) return hareketVeri;
    return null;
  }
  const log = logRs.recordset[0];

  let kayit = null;
  if (await tabloVarMi(pool, 'HizliSatisKayitlari')) {
    const kRs = await pool.request()
      .input('LogID', sql.Int, logID)
      .query('SELECT TOP 1 * FROM HizliSatisKayitlari WHERE LogID = @LogID');
    kayit = kRs.recordset[0] || null;
  }

  let detaylar = [];
  let musteriID = kayit?.MusteriID || aciklamadanMusteriID(log.Aciklama);
  let musteriAd = null;
  let referans = kayit?.Referans || null;
  hareketID = null;

  if (kayit?.KayitID) {
    const dRs = await pool.request()
      .input('KayitID', sql.Int, kayit.KayitID)
      .query(`
        SELECT StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
        FROM HizliSatisKayitDetaylari WHERE KayitID = @KayitID ORDER BY DetayID
      `);
    detaylar = dRs.recordset || [];
  }

  if (!detaylar.length && musteriID) {
    const hRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .input('Tarih', sql.DateTime, log.Tarih)
      .query(`
        SELECT TOP 1 HareketID, Referans
        FROM MusteriHareketleri
        WHERE MusteriID = @MusteriID
          AND Tur = N'Satis'
          AND Referans LIKE N'hizli-satis:%'
          AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= 180
        ORDER BY ABS(DATEDIFF(SECOND, Tarih, @Tarih)) ASC
      `);
    if (hRs.recordset.length) {
      hareketID = hRs.recordset[0].HareketID;
      referans = referans || hRs.recordset[0].Referans;
      const detRs = await pool.request()
        .input('HareketID', sql.Int, hareketID)
        .query(`
          SELECT StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
          FROM MusteriHareketDetaylari WHERE HareketID = @HareketID ORDER BY DetayID
        `);
      detaylar = detRs.recordset || [];
    }
  }

  if (musteriSatisLogMu(log) || musteriOdemeLogMu(log)) {
    if (!musteriID) {
      const ad = aciklamadanMusteriAdi(log.Aciklama);
      musteriID = await musteriAdindanIDBul(pool, ad);
    }
    const turFiltre = musteriSatisLogMu(log) ? "N'Satis'" : "N'Odeme'";
    const refFiltre = musteriSatisLogMu(log)
      ? "AND (Referans LIKE N'musteri-satis%' OR Referans LIKE N'musteri-satis-sepet%')"
      : "AND Referans LIKE N'musteri-odeme%'";
    const hReq = pool.request().input('Tarih', sql.DateTime, log.Tarih);
    let midClause = '';
    if (musteriID) {
      hReq.input('MusteriID', sql.Int, musteriID);
      midClause = 'AND MusteriID = @MusteriID';
    }
    const hRs = await hReq.query(`
      SELECT TOP 1 HareketID, MusteriID, Referans, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli
      FROM MusteriHareketleri
      WHERE Tur = ${turFiltre}
        ${refFiltre}
        ${midClause}
        AND ABS(DATEDIFF(SECOND, Tarih, @Tarih)) <= 300
      ORDER BY ABS(DATEDIFF(SECOND, Tarih, @Tarih)) ASC
    `);
    if (hRs.recordset.length) {
      const h = hRs.recordset[0];
      hareketID = h.HareketID;
      referans = h.Referans;
      musteriID = h.MusteriID || musteriID;
      if (musteriSatisLogMu(log)) {
        const detRs = await pool.request()
          .input('HareketID', sql.Int, hareketID)
          .query(`
            SELECT StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar
            FROM MusteriHareketDetaylari WHERE HareketID = @HareketID ORDER BY DetayID
          `);
        detaylar = detRs.recordset || [];
        if (h.Referans) {
          const tahRs = await pool.request()
            .input('Ref', sql.NVarChar(40), h.Referans)
            .query(`
              SELECT TOP 1 OdenenTutar, OdemeSekli
              FROM MusteriHareketleri
              WHERE Tur = N'Odeme' AND Referans = @Ref
              ORDER BY HareketID DESC
            `);
          if (tahRs.recordset.length) {
            kayit = kayit || {};
            kayit.TahsilatTutar = Number(tahRs.recordset[0].OdenenTutar || 0);
            kayit.OdemeSekli = tahRs.recordset[0].OdemeSekli;
          }
        }
        kayit = kayit || {};
        kayit.SepetToplam = Number(h.ToplamTutar || 0);
        if (kayit.TahsilatTutar == null) {
          kayit.TahsilatTutar = aciklamadanMusteriSatisTahsilat(log.Aciklama);
        }
        if (!kayit.OdemeSekli) kayit.OdemeSekli = h.OdemeSekli;
      } else {
        kayit = kayit || {};
        kayit.TahsilatTutar = Number(h.OdenenTutar || 0);
        kayit.SepetToplam = kayit.TahsilatTutar;
        kayit.OdemeSekli = h.OdemeSekli;
      }
    }
  }

  if (!detaylar.length) {
    detaylar = aciklamadanKalemler(log.Aciklama);
  }

  let tedarikciAd = null;
  if (tedarikciSatirMalAlimMi(log)) {
    const mal = aciklamadanTedarikMalAlim(log.Aciklama);
    const unvanM = String(log.Aciklama || '').match(/Mal alım\s+([^:]+):/i);
    tedarikciAd = unvanM ? unvanM[1].trim() : null;
    detaylar = (await gunlukMalAlimKalemleri(pool, log)) || detaylar;
    if (mal) {
      kayit = kayit || {};
      kayit.SepetToplam = mal.toplam;
      kayit.TahsilatTutar = mal.odeme;
      kayit.KalanTutar = mal.kalan;
    }
  }

  if (musteriID) {
    const mRs = await pool.request()
      .input('MID', sql.Int, musteriID)
      .query('SELECT AdSoyad, FirmaAdi, tur FROM Musteriler WHERE MusteriID = @MID');
    const mRow = mRs.recordset[0];
    if (mRow) {
      musteriAd =
        musteriTurNormalize(mRow.tur) === 'Tuzel'
          ? String(mRow.FirmaAdi || mRow.AdSoyad || '').trim()
          : String(mRow.AdSoyad || mRow.FirmaAdi || '').trim();
    }
  }
  if (!musteriAd) musteriAd = aciklamadanMusteriAdi(log.Aciklama);
  if (!musteriAd && tedarikciAd) musteriAd = tedarikciAd;

  const odeme = kayit?.OdemeSekli || aciklamadanOdeme(log.Aciklama);
  let sepetToplam = kayit?.SepetToplam != null ? Number(kayit.SepetToplam) : 0;
  if (!sepetToplam) {
    sepetToplam =
      detaylar.reduce((s, d) => s + Number(d.SatirTutar || 0), 0) ||
      aciklamadanMusteriSatisToplam(log.Aciklama) ||
      aciklamadanTutar(log.Aciklama);
  }
  let tahsilatTutar = kayit?.TahsilatTutar != null ? Number(kayit.TahsilatTutar) : 0;
  if (!tahsilatTutar && musteriOdemeLogMu(log)) {
    tahsilatTutar = aciklamadanMusteriOdemeTutar(log.Aciklama) || aciklamadanTutar(log.Aciklama);
    if (!sepetToplam) sepetToplam = tahsilatTutar;
  } else if (!tahsilatTutar && musteriSatisLogMu(log)) {
    tahsilatTutar = aciklamadanMusteriSatisTahsilat(log.Aciklama);
  } else if (!tahsilatTutar && odeme !== 'Veresiye') {
    tahsilatTutar = aciklamadanTutar(log.Aciklama);
  }

  const iptalEdildi = !!(kayit && kayit.IptalEdildi);
  const musterili =
    !!(musteriID && Number(musteriID) > 0) || musteriSatisLogMu(log) || musteriOdemeLogMu(log);
  /** Müşterisiz hızlı satışlar günlük işlemlerden; müşterili olanlar cariden iptal edilir */
  const iptalEdilebilir =
    hizliSatisLogMu(log) && !iptalEdildi && !musterili && !!kayit?.KayitID;
  const iptalYeri = musterili ? 'cari' : iptalEdilebilir ? 'gunluk' : 'yok';

  let veresiyeTutar = Math.max(0, Math.round((sepetToplam - tahsilatTutar) * 100) / 100);
  if (kayit?.KalanTutar != null && tedarikciSatirMalAlimMi(log)) {
    veresiyeTutar = Math.max(0, Number(kayit.KalanTutar) || 0);
  }

  return {
    log,
    odeme,
    sepetToplam,
    tahsilatTutar,
    veresiyeTutar,
    musteriID,
    musteriAd,
    tedarikciAd,
    referans,
    hareketID,
    kayitID: kayit?.KayitID || null,
    detaylar,
    iptalEdildi,
    iptalEdilebilir,
    duzenleEdilebilir: iptalEdilebilir,
    iptalYeri,
    musterili,
    malAlim: tedarikciSatirMalAlimMi(log),
  };
}

app.delete('/api/musteri/hareket/:hareketID', async (req, res) => {
  try {
    const hareketID = parseInt(req.params.hareketID, 10);
    const kullanici = (req.query.kullanici || 'Sistem').toString();
    if (!Number.isInteger(hareketID) || hareketID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz hareket.' });
    }
    const pool = await poolPromise;
    const sonuc = await musteriHareketGrupIptal(pool, hareketID, kullanici);
    if (!sonuc.success) {
      return res.status(sonuc.status || 400).json({ success: false, message: sonuc.message });
    }
    res.json({ success: true, message: sonuc.message || 'İşlem silindi; günlük kayıt iptal edildi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Hareket silinemedi.' });
  }
});

// ==========================================
// --- SERVİS / ARIZA İŞLERİ ---
// ==========================================

app.get('/api/servis', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT s.*, m.AdSoyad 
      FROM ServisIsleri s
      LEFT JOIN Musteriler m ON s.MusteriID = m.MusteriID
      ORDER BY s.ServisID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Servis kayıtları listelenirken hata oluştu.');
  }
});

app.post('/api/servis', async (req, res) => {
  try {
    const { MusteriID, ArizaAciklamasi, IscilikUcreti, MalzemeTutari, Durum } = req.body;
    const Toplam = (IscilikUcreti || 0) + (MalzemeTutari || 0);

    const pool = await poolPromise;
    await pool.request()
      .input('MusteriID', sql.Int, MusteriID)
      .input('ArizaAciklamasi', sql.NVarChar(500), ArizaAciklamasi)
      .input('IscilikUcreti', sql.Decimal(18, 2), IscilikUcreti || 0)
      .input('MalzemeTutari', sql.Decimal(18, 2), MalzemeTutari || 0)
      .input('ToplamTutar', sql.Decimal(18, 2), Toplam)
      .input('Durum', sql.NVarChar(20), Durum || 'Açık')
      .query(`
        INSERT INTO ServisIsleri (MusteriID, ArizaAciklamasi, IscilikUcreti, MalzemeTutari, ToplamTutar, Durum)
        VALUES (@MusteriID, @ArizaAciklamasi, @IscilikUcreti, @MalzemeTutari, @ToplamTutar, @Durum)
      `);
    res.status(201).send('Servis kaydı başarıyla oluşturuldu.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Servis eklenirken hata oluştu.');
  }
});

app.put('/api/servis/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ArizaAciklamasi, IscilikUcreti, MalzemeTutari, Durum } = req.body;
    const Toplam = (IscilikUcreti || 0) + (MalzemeTutari || 0);

    let KapanisTarihiSorgusu = '';
    if (Durum === 'Tamamlandı') {
      KapanisTarihiSorgusu = ', KapanisTarihi = GETDATE()';
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input('ServisID', sql.Int, id)
      .input('ArizaAciklamasi', sql.NVarChar(500), ArizaAciklamasi)
      .input('IscilikUcreti', sql.Decimal(18, 2), IscilikUcreti)
      .input('MalzemeTutari', sql.Decimal(18, 2), MalzemeTutari)
      .input('ToplamTutar', sql.Decimal(18, 2), Toplam)
      .input('Durum', sql.NVarChar(20), Durum)
      .query(`
        UPDATE ServisIsleri
        SET ArizaAciklamasi = @ArizaAciklamasi, 
            IscilikUcreti = @IscilikUcreti, 
            MalzemeTutari = @MalzemeTutari, 
            ToplamTutar = @ToplamTutar, 
            Durum = @Durum
            ${KapanisTarihiSorgusu}
        WHERE ServisID = @ServisID
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).send('Güncellenecek servis kaydı bulunamadı.');
    }
    res.send('Servis kaydı güncellendi.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Servis güncellenirken hata oluştu.');
  }
});

app.delete('/api/servis/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ServisID', sql.Int, id)
      .query('DELETE FROM ServisIsleri WHERE ServisID = @ServisID');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).send('Silinecek kayıt bulunamadı.');
    }
    res.send('Servis kaydı silindi.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Kayıt silinirken hata oluştu.');
  }
});

// ==========================================
// --- DASHBOARD / ÖZET İŞLEMLERİ ---
// ==========================================

function bugununTarihiStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function liraMetindenSayi(parca) {
  let s = String(parca || '').trim();
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = parseFloat(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Müşteri cari satış logu — "toplam 25₺, tahsilat …, kalan …" */
function musteriSatisLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  return tip === 'Müşteri Satış' || tip === 'Musteri Satis';
}

/** Müşteri cari tahsilat logu */
function musteriOdemeLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  return tip === 'Müşteri Ödeme' || tip === 'Musteri Odeme';
}

function aciklamadanMusteriSatisToplam(aciklama) {
  const m = String(aciklama || '').match(/toplam\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  return m ? liraMetindenSayi(m[1]) : 0;
}

function aciklamadanMusteriSatisTahsilat(aciklama) {
  const a = String(aciklama || '');
  if (/tahsilat\s+Yok/i.test(a)) return 0;
  const m = a.match(/tahsilat\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  return m ? liraMetindenSayi(m[1]) : 0;
}

function aciklamadanMusteriSatisKalan(aciklama) {
  const m = String(aciklama || '').match(/kalan\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  return m ? liraMetindenSayi(m[1]) : 0;
}

function aciklamadanMusteriOdemeTutar(aciklama) {
  const m = String(aciklama || '').match(/^[^:]+:\s*(\d+(?:[.,]\d+)?)\s*₺/);
  return m ? liraMetindenSayi(m[1]) : 0;
}

/** Hızlı satış logundan toplam / tahsilat (eski ve yeni log formatı). */
function aciklamadanHizliSatisToplam(aciklama) {
  const t = aciklamadanMusteriSatisToplam(aciklama);
  if (t > 0) return t;
  const a = String(aciklama || '');
  const mSepet = a.match(/—\s*(\d+(?:[.,]\d+)?)\s*₺\s*\(/);
  if (mSepet) return liraMetindenSayi(mSepet[1]);
  const mTek = a.match(/,\s*(\d+(?:[.,]\d+)?)\s*₺\s*—\s*Ödeme/i);
  if (mTek) return liraMetindenSayi(mTek[1]);
  const mHs = a.match(/Hızlı satış\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  if (mHs) return liraMetindenSayi(mHs[1]);
  return aciklamadanTutar(aciklama);
}

function aciklamadanHizliSatisTahsilat(aciklama) {
  const t = aciklamadanMusteriSatisTahsilat(aciklama);
  if (t > 0) return t;
  const a = String(aciklama || '');
  if (/veresiye/i.test(a)) return 0;
  const mTah = a.match(/tahsilat\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  if (mTah) return liraMetindenSayi(mTah[1]);
  const mSepet = a.match(/—\s*(\d+(?:[.,]\d+)?)\s*₺\s*\(/);
  if (mSepet) return liraMetindenSayi(mSepet[1]);
  const mTek = a.match(/,\s*(\d+(?:[.,]\d+)?)\s*₺\s*—\s*Ödeme/i);
  if (mTek) return liraMetindenSayi(mTek[1]);
  return 0;
}

/** Günlük liste satırlarında Müşteri #id → ad (yoksa Müşterisiz işlem). */
async function gunlukIslemMusteriAdlariniCoz(pool, islemler) {
  const logToMusteri = new Map();
  const idSet = new Set();

  for (const r of islemler) {
    const midRow = Number(r.MusteriID);
    if (Number.isInteger(midRow) && midRow > 0) idSet.add(midRow);
    const mid = aciklamadanMusteriID(r.Aciklama);
    if (mid) {
      idSet.add(mid);
      if (r.LogID) logToMusteri.set(Number(r.LogID), mid);
    }
  }

  const logIds = [
    ...new Set(
      islemler
        .filter((r) => r.LogID && ['satis', 'satis_tahsilat'].includes(r.Kaynak))
        .map((r) => Number(r.LogID))
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (logIds.length && (await tabloVarMi(pool, 'HizliSatisKayitlari'))) {
    for (let i = 0; i < logIds.length; i += 80) {
      const chunk = logIds.slice(i, i + 80);
      const inList = chunk.map((_, j) => `@L${j}`).join(',');
      const req = pool.request();
      chunk.forEach((id, j) => req.input(`L${j}`, sql.Int, id));
      try {
        const rs = await req.query(`
          SELECT LogID, MusteriID FROM HizliSatisKayitlari
          WHERE LogID IN (${inList}) AND MusteriID IS NOT NULL
        `);
        for (const row of rs.recordset || []) {
          const lid = Number(row.LogID);
          const mid = parseInt(row.MusteriID, 10);
          if (lid && Number.isInteger(mid) && mid > 0) {
            logToMusteri.set(lid, mid);
            idSet.add(mid);
          }
        }
      } catch (err) {
        console.warn('Hızlı satış müşteri eşlemesi atlandı:', err.message);
      }
    }
  }

  const adMap = new Map();
  if (idSet.size) {
    const ids = [...idSet];
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const inList = chunk.map((_, j) => `@M${j}`).join(',');
      const req = pool.request();
      chunk.forEach((id, j) => req.input(`M${j}`, sql.Int, id));
      try {
        const rs = await req.query(`
          SELECT MusteriID, AdSoyad, FirmaAdi, yetkili, tur FROM Musteriler
          WHERE MusteriID IN (${inList})
        `);
        for (const row of rs.recordset || []) {
          adMap.set(Number(row.MusteriID), musteriGorunenAdKayit(row));
        }
      } catch (err) {
        console.warn('Müşteri adları okunamadı:', err.message);
      }
    }
  }

  const musterisiz = PERAKENDE_ISLEM_ETIKET;

  for (const r of islemler) {
    const kaynak = r.Kaynak || '';
    const tahsilatSatir =
      r.SatirTur === 'tahsilat' ||
      kaynak === 'musteri_tahsilat' ||
      kaynak === 'satis_tahsilat' ||
      kaynak === 'musteri_odeme';
    const hizliVeyaCari =
      kaynak === 'musteri_satis' ||
      kaynak === 'satis' ||
      kaynak === 'satis_tahsilat' ||
      tahsilatSatir;

    if (!hizliVeyaCari) continue;

    const mid =
      (Number(r.MusteriID) > 0 ? Number(r.MusteriID) : null) ||
      logToMusteri.get(Number(r.LogID)) ||
      aciklamadanMusteriID(r.Aciklama) ||
      null;
    let ad = mid && adMap.has(mid) ? adMap.get(mid) : null;
    const mevcutAd = mobilOnekKaldir(r.MusteriAd || '');
    if (!ad && mevcutAd && !perakendeEtiketMi(mevcutAd)) ad = mevcutAd;
    if (!ad) ad = aciklamadanMusteriAdi(r.Aciklama);
    if (!ad && (kaynak === 'satis' || kaynak === 'satis_tahsilat')) ad = musterisiz;
    if (!ad && kaynak === 'musteri_satis' && mevcutAd) ad = mevcutAd;

    if (mid) r.MusteriID = mid;

    r.MusteriAd = mobilOnekKaldir(ad || musterisiz) || musterisiz;

    if (tahsilatSatir) {
      r.KisaAciklama = ad && !perakendeEtiketMi(ad) ? `${mobilOnekKaldir(ad)} — tahsilat` : musterisiz;
      continue;
    }

    if (kaynak === 'musteri_satis') {
      const kalan = aciklamadanMusteriSatisKalan(r.Aciklama);
      if (ad && !perakendeEtiketMi(ad)) {
        r.KisaAciklama =
          kalan > 0.009 ? `${ad} — kalan ${kalan.toFixed(2)}₺` : ad;
      } else {
        r.KisaAciklama = gunlukMusteriSatisKisaAciklama(r.Aciklama, kalan);
      }
      continue;
    }

    if (kaynak === 'satis') {
      r.KisaAciklama = ad && !perakendeEtiketMi(ad) ? ad : musterisiz;
    }
  }
}

/** Günlük listede müşteri satışı — ürün listesi fatura satırında; açıklama kısa. */
function gunlukMusteriSatisKisaAciklama(aciklama, kalan) {
  const ad = aciklamadanMusteriAdi(aciklama) || String(aciklama || '').split(' — ')[0].trim();
  if (!ad) return 'Müşteri satışı';
  const k = Number(kalan);
  if (Number.isFinite(k) && k > 0.009) return `${ad} — kalan ${k.toFixed(2)}₺`;
  return ad;
}

/** Kasa yedeği — müşteri/tedarik tahsilatı zaten log satırında sayılıyor; iptal/iade satırları listede gösterilmez. */
function kasaGunlukAtlanacakMi(aciklama) {
  const a = String(aciklama || '');
  if (/iptal/i.test(a)) return true;
  if (/genel\s*gider\s*düzenleme|genel\s*gider\s*duzenleme/i.test(a)) return true;
  if (/müşteri\s*tahsilat|musteri\s*tahsilat/i.test(a)) return true;
  if (/müşteri\s*satış\s*tahsilat|musteri\s*satis\s*tahsilat/i.test(a)) return true;
  if (/hızlı\s*satış|hizli\s*satis/i.test(a) && /\[Nakit\]|\[Kart\]|\[Havale\]/i.test(a)) return true;
  if (/mal\s*alım\s*ödeme|mal\s*alim\s*odeme/i.test(a)) return true;
  if (/tedarikçi\s*ödeme|tedarikci\s*odeme/i.test(a)) return true;
  if (/^genel\s*gider\s*[—-]/i.test(a)) return true;
  return false;
}

function gunlukListedeGizlenecekSatirMi(row) {
  if (row?.Kaynak === 'iptal') return true;
  const acik = String(row?.Aciklama || row?.KisaAciklama || '');
  if (/iptal/i.test(acik)) return true;
  if (row?.Kaynak === 'kasa' && kasaGunlukAtlanacakMi(acik)) return true;
  return false;
}

function mobilOnekKaldir(metin) {
  return String(metin || '').replace(/^\[Mobil\]\s*/i, '').trim();
}

/** Log metninden müşteri adı (satış: "Ad — …", ödeme: "Ad: 25₺ …") */
function aciklamadanMusteriAdi(aciklama) {
  const s = mobilOnekKaldir(String(aciklama || '').trim());
  const mLogAd = s.match(/—\s*(.+?)\s*\(\s*Müşteri\s*#\d+\s*\)\s*$/i);
  if (mLogAd) return mobilOnekKaldir(mLogAd[1]);
  const m1 = s.match(/^([^—:]+)\s*—/);
  if (m1) return mobilOnekKaldir(m1[1]);
  const m2 = s.match(/^([^:]+):\s*\d/);
  if (m2) return mobilOnekKaldir(m2[1]);
  return null;
}

async function musteriAdindanIDBul(pool, ad) {
  const adTrim = String(ad || '').trim();
  if (!adTrim) return null;
  const rs = await pool.request()
    .input('Ad', sql.NVarChar(120), adTrim.substring(0, 120))
    .query(`
      SELECT TOP 1 MusteriID
      FROM Musteriler
      WHERE AdSoyad = @Ad OR FirmaAdi = @Ad
      ORDER BY MusteriID DESC
    `);
  const id = parseInt(rs.recordset[0]?.MusteriID, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseLiraSayi(parca) {
  let s = String(parca || '').trim();
  if (!s) return 0;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = parseFloat(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/** "Mal alım ÖZNUR: …" / "Mal alım ÖZNUR (Alım #5): …" → tedarikçi ünvanı */
function aciklamadanTedarikciUnvan(aciklama) {
  const a = String(aciklama || '');
  let m = a.match(/Mal alım\s+(.+?)\s*\(Alım\s*#\d+\)\s*:/i);
  if (m) return m[1].trim();
  m = a.match(/Mal alım\s+([^:]+):/i);
  if (!m) return null;
  return m[1].replace(/\s*\(Alım\s*#\d+\)\s*$/i, '').trim();
}

/** Tedarik mal alım logu: "Mal alım X: 4590₺, ödeme 4590₺ [Nakit], kalan 0₺" */
function aciklamadanTedarikMalAlim(aciklama) {
  const a = String(aciklama || '');
  if (!/mal\s*al[ıi]m/i.test(a)) return null;
  const toplamM = a.match(/:\s*(\d+(?:[.,]\d+)?)\s*₺/);
  const odemeM = a.match(/ödeme\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  const kalanM = a.match(/kalan\s+(\d+(?:[.,]\d+)?)\s*₺/i);
  const toplam = toplamM ? parseLiraSayi(toplamM[1]) : 0;
  const odeme = odemeM ? parseLiraSayi(odemeM[1]) : 0;
  const kalan = kalanM ? parseLiraSayi(kalanM[1]) : 0;
  if (toplam <= 0 && odeme <= 0 && kalan <= 0) return null;
  return { toplam, odeme, kalan };
}

/** Mal alım satırında kasa çıkışı (ödeme); veresiye kısmı ayrı özetlenir. */
function tedarikMalAlimKasaTutari(mal) {
  if (!mal) return 0;
  if (mal.odeme > 0) return mal.odeme;
  if (mal.kalan > 0) return 0;
  return mal.toplam;
}

/** Log satırından tutarı çeker (₺ / TL). Mal alımda "kalan 0₺" son eşleşmeyi ezmez. */
function aciklamadanTutar(aciklama) {
  if (!aciklama || typeof aciklama !== 'string') return 0;
  const mal = aciklamadanTedarikMalAlim(aciklama);
  if (mal) {
    const kasa = tedarikMalAlimKasaTutari(mal);
    if (kasa > 0) return kasa;
    if (mal.kalan > 0) return mal.kalan;
    return mal.toplam;
  }
  const toplam = aciklamadanMusteriSatisToplam(aciklama);
  if (toplam > 0) return toplam;
  let v = 0;
  const reLira = /(\d+(?:[.,]\d+)?)\s*₺/g;
  const reTl = /(\d+(?:[.,]\d+)?)\s*(?:TL|tl)(?![A-Za-z0-9_])/gi;
  for (const re of [reLira, reTl]) {
    let m;
    while ((m = re.exec(aciklama)) !== null) {
      const oncesi = aciklama.substring(Math.max(0, m.index - 24), m.index);
      if (/kalan\s*$/i.test(oncesi)) continue;
      const n = parseLiraSayi(m[1]);
      if (Number.isFinite(n)) v = n;
    }
  }
  return Number.isFinite(v) ? v : 0;
}

/** Kasa tablosunda Tarih + Tutar varsa günlük satış yedeği (log boşsa). */
async function kasadanGunlukOkuma(pool, basTrim, bitTrim) {
  try {
    const r = await pool.request()
      .input('bas', sql.NVarChar(10), basTrim)
      .input('bit', sql.NVarChar(10), bitTrim)
      .query(`
        SELECT KasaID, Tutar, Aciklama, Kullanici, Tarih
        FROM Kasa
        WHERE IslemTipi = N'Giris'
          AND CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
          AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
        ORDER BY Tarih DESC
      `);
    return r.recordset || [];
  } catch (err) {
    console.warn('Kasa günlük okuma atlandı:', err.message);
    return null;
  }
}

function aciklamadanOdeme(aciklama) {
  if (!aciklama) return 'Diğer';
  const a = String(aciklama);
  if (/veresiye/i.test(a)) return 'Veresiye';
  if (/\[Nakit\]|Ödeme:\s*Nakit|\(Nakit\)|\(Nakit\s/i.test(a)) return 'Nakit';
  if (/\[Kart\]|Ödeme:\s*Kart|\(Kart\)|\(Kart\s/i.test(a)) return 'Kart';
  if (/\[Havale\]|Ödeme:\s*Havale|\(Havale\)|\(Havale\s/i.test(a)) return 'Havale';
  return 'Diğer';
}

function bosGunlukSonuc() {
  return {
    ozet: {
      nakit: 0,
      kart: 0,
      havale: 0,
      veresiye: 0,
      diger: 0,
      toplam: 0,
      toplamVeresiyesiz: 0,
      kasaGiris: 0,
      giderNakit: 0,
      giderKart: 0,
      giderHavale: 0,
      giderDiger: 0,
      malAlimVeresiye: 0,
      giderKasaToplam: 0,
      giderTedarikciKasa: 0,
      giderGenelKasa: 0,
      islemAdedi: 0,
    },
    islemler: [],
  };
}

/** Hızlı satış iptal logu (günlük listede satış sayılmaz). */
function hizliSatisIptalLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  if (!tip) return false;
  if (musteriSatisIptalLogMu(row) || musteriOdemeIptalLogMu(row)) return false;
  if (/iptal/i.test(tip) && (/sat/i.test(tip) || /hızlı|hizli/i.test(tip))) return true;
  return tip === 'Hızlı Satış İptal' || tip === 'Hizli Satis Iptal';
}

function gunlukCariIptalLogMu(row) {
  return hizliSatisIptalLogMu(row) || musteriSatisIptalLogMu(row) || musteriOdemeIptalLogMu(row);
}

/** Günlük liste — satış + ödeme tek satır tür etiketi */
function gunlukSatisVeOdemeTur(odeme) {
  const o = (odeme || '').trim();
  if (o === 'Nakit' || o === 'Kart' || o === 'Havale' || o === 'Veresiye') {
    return `Satış ve Ödeme (${o})`;
  }
  return 'Satış ve Ödeme';
}

/** DB'de tip metni farklı kodlama / yazımla da gelebilir — satış logunu ayıklar. */
function hizliSatisLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  if (!tip) return false;
  if (hizliSatisIptalLogMu(row)) return false;
  if (musteriSatisLogMu(row) || musteriOdemeLogMu(row)) return false;
  const acik = row.Aciklama || '';
  const bilinen = new Set([
    'Hızlı Satış',
    'Hızlı Satış (Sepet)',
    'Hizli Satis',
    'Hizli Satis (Sepet)',
    'HIZLI SATIS',
    'HIZLI SATIS (SEPET)',
  ]);
  if (bilinen.has(tip)) return true;
  try {
    const tr = tip.toLocaleLowerCase('tr-TR');
    if (tr.includes('hızlı') && tr.includes('satış')) return true;
    if (tr.includes('satış') && tr.includes('sepet')) return true;
  } catch (_) {
    /* ignore */
  }
  if (/hizli/i.test(tip) && /satis/i.test(tip)) return true;
  if (/\(sepet\)/i.test(tip) && /sat/i.test(tip)) return true;
  if (/\d/.test(acik) && (/\[Nakit\]|\[Kart\]|\[Havale\]|Ödeme:|Veresiye|\(Nakit\)/i.test(acik))) {
    if (/satış|satis|sepet|hızlı|hizli/i.test(tip) && !/müşteri|musteri/i.test(tip)) return true;
  }
  return false;
}

/** İşlem geçmişindeki tedarikçi mal alım / ödeme satırları. */
function tedarikciGunlukLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  if (!tip) return false;
  const bilinen = new Set(['Tedarik Mal Alım', 'Tedarikçi Ödeme']);
  if (bilinen.has(tip)) return true;
  try {
    const tr = tip.toLocaleLowerCase('tr-TR');
    if (tr.includes('tedarik') && tr.includes('mal')) return true;
    if (tr.includes('tedarikçi') && tr.includes('ödeme')) return true;
  } catch (_) {
    /* ignore */
  }
  if (/tedarik.*mal/i.test(tip)) return true;
  if (/tedarikci.*odeme/i.test(tip)) return true;
  return false;
}

function tedarikciSatirMalAlimMi(row) {
  const tip = (row.IslemTipi || '').trim();
  if (tip === 'Tedarik Mal Alım') return true;
  try {
    const tr = tip.toLocaleLowerCase('tr-TR');
    return tr.includes('mal alım') || (tr.includes('tedarik') && tr.includes('mal'));
  } catch (_) {
    return /mal\s*al/i.test(tip);
  }
}

function genelGiderLogMu(row) {
  const tip = (row.IslemTipi || '').trim();
  if (tip === 'Genel Gider') return true;
  try {
    const tr = tip.toLocaleLowerCase('tr-TR');
    if (tr.includes('genel') && tr.includes('gider')) return true;
  } catch (_) {
    /* ignore */
  }
  return /genel.*gider/i.test(tip);
}

function gunlukLogIptalMi(row, iptalLogIds) {
  if (!iptalLogIds?.size) return false;
  const lid = Number(row.LogID);
  const gid = Number(row.GrupLogID);
  if (lid && iptalLogIds.has(lid)) return true;
  if (gid && iptalLogIds.has(gid)) return true;
  return false;
}

function gunlukHareketMusteriAd(h) {
  if (h.AdSoyad || h.FirmaAdi) return musteriGorunenAdKayit(h);
  return 'Müşteri';
}

function gunlukOzetTahsilatEkle(ozet, odeme, tutar) {
  const t = Number(tutar || 0);
  if (t <= 0) return;
  const o = String(odeme || 'Nakit');
  if (o === 'Nakit') ozet.nakit += t;
  else if (o === 'Kart') ozet.kart += t;
  else if (o === 'Havale') ozet.havale += t;
  else ozet.diger += t;
}

function gunlukOzetGiderEkle(ozet, odeme, tutar) {
  const t = Number(tutar || 0);
  if (t <= 0) return;
  const o = String(odeme || 'Nakit');
  if (o === 'Nakit') ozet.giderNakit += t;
  else if (o === 'Kart') ozet.giderKart += t;
  else if (o === 'Havale') ozet.giderHavale += t;
  else ozet.giderDiger += t;
  if (o === 'Nakit' || o === 'Kart' || o === 'Havale') {
    ozet.giderKasaToplam += t;
  }
}

/** Günlük genel gider — tek kaynak: GenelGider tablosu (sil/düzenle ile uyumlu). */
async function gunlukGenelGiderleriniEkle(pool, basTrim, bitTrim, ozet, islemler) {
  const r = await pool.request()
    .input('bas', sql.NVarChar(10), basTrim)
    .input('bit', sql.NVarChar(10), bitTrim)
    .query(`
      SELECT GiderID, Tutar, OdemeSekli, Kategori, Aciklama, Tarih, Kullanici
      FROM GenelGider
      WHERE CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
        AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
      ORDER BY Tarih DESC, GiderID DESC
    `);
  for (const g of r.recordset || []) {
    const tutar = Number(g.Tutar || 0);
    if (tutar <= 0) continue;
    const odeme = String(g.OdemeSekli || 'Nakit').trim();
    gunlukOzetGiderEkle(ozet, odeme, tutar);
    ozet.giderGenelKasa += odeme === 'Nakit' || odeme === 'Kart' || odeme === 'Havale' ? tutar : 0;
    ozet.islemAdedi += 1;
    const kat = String(g.Kategori || 'Genel gider').trim() || 'Genel gider';
    const ek = String(g.Aciklama || '').trim();
    const acik = ek ? `${kat} — ${ek}` : kat;
    islemler.push({
      LogID: g.GiderID,
      Tarih: g.Tarih,
      KullaniciAdi: g.Kullanici || 'Sistem',
      IslemTipi: 'Genel Gider',
      Odeme: odeme,
      Tutar: tutar,
      Aciklama: acik,
      Yon: 'cikis',
      Kaynak: 'genel_gider',
      MobilKaynak: false,
    });
  }
}

function musteriDevirHareketMi(h) {
  const ref = String(h?.Referans || '').trim().toLowerCase();
  if (ref === 'devir:import') return true;
  if (String(h?.Kullanici || '').trim().toLowerCase() === 'aktarim') return true;
  return /eski programdan devir bakiyesi/i.test(String(h?.Aciklama || ''));
}

/** Müşterili hızlı satış logu — cari listede zaten var, IslemGecmisi satırı atlanır. */
function hizliSatisMusteriliLogMu(row) {
  const mid = aciklamadanMusteriID(row?.Aciklama);
  return Number.isInteger(mid) && mid > 0;
}

/** Tarih aralığında müşterili hızlı satış LogID seti (HizliSatisKayitlari). */
async function gunlukMusteriliHizliSatisLogIdleri(pool, basTrim, bitTrim) {
  const set = new Set();
  if (!(await tabloVarMi(pool, 'HizliSatisKayitlari'))) return set;
  try {
    const rs = await pool.request()
      .input('bas', sql.NVarChar(10), basTrim)
      .input('bit', sql.NVarChar(10), bitTrim)
      .query(`
        SELECT DISTINCT k.LogID
        FROM HizliSatisKayitlari k
        INNER JOIN IslemGecmisi g ON g.LogID = k.LogID
        WHERE k.MusteriID IS NOT NULL AND k.MusteriID > 0
          AND ISNULL(k.IptalEdildi, 0) = 0
          AND CAST(g.Tarih AS DATE) >= CAST(@bas AS DATE)
          AND CAST(g.Tarih AS DATE) <= CAST(@bit AS DATE)
      `);
    for (const r of rs.recordset || []) {
      const id = Number(r.LogID);
      if (Number.isInteger(id) && id > 0) set.add(id);
    }
  } catch (err) {
    console.warn('Müşterili hızlı satış logları okunamadı:', err.message);
  }
  return set;
}

async function gunlukTedarikAlimOdenenTutar(pool, alimID) {
  if (!Number.isInteger(alimID) || alimID < 1) return 0;
  try {
    const rs = await pool.request()
      .input('Bagli', sql.NVarChar(80), `Mal alım ödemesi (Alım #${alimID})%`)
      .query(`SELECT ISNULL(SUM(Tutar), 0) AS Odenen FROM TedarikciOdeme WHERE Aciklama LIKE @Bagli`);
    return Number(rs.recordset[0]?.Odenen || 0);
  } catch (err) {
    return 0;
  }
}

function gunlukMalAlimAciklamaOlustur(unvan, alimID, toplam, odenen, odeme, kalan) {
  let s = `Mal alım ${unvan} (Alım #${alimID}): ${toplam}₺, ödeme ${odenen}₺`;
  if (odenen > 0 && odeme) s += ` [${odeme}]`;
  s += `, kalan ${kalan}₺`;
  return s;
}

/** Perakende hızlı satışlar — tek kaynak: HizliSatisKayitlari (IslemGecmisi değil). */
async function gunlukPerakendeSatislariniEkle(pool, basTrim, bitTrim, ozet, islemler) {
  if (!(await tabloVarMi(pool, 'HizliSatisKayitlari'))) return;
  try {
    const rs = await pool.request()
      .input('bas', sql.NVarChar(10), basTrim)
      .input('bit', sql.NVarChar(10), bitTrim)
      .query(`
        SELECT KayitID, LogID, OdemeSekli, SepetToplam, TahsilatTutar, Kullanici, Tarih, Referans
        FROM HizliSatisKayitlari
        WHERE ISNULL(IptalEdildi, 0) = 0
          AND (MusteriID IS NULL OR MusteriID = 0)
          AND CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
          AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
        ORDER BY Tarih DESC, KayitID DESC
      `);
    for (const k of rs.recordset || []) {
      const toplam = Number(k.SepetToplam || 0);
      let tahsilat = Number(k.TahsilatTutar || 0);
      const odeme = String(k.OdemeSekli || 'Nakit').trim();
      const veresiyeMi = odeme === 'Veresiye';
      if (!veresiyeMi && tahsilat <= 0 && toplam > 0) tahsilat = toplam;
      let kalan = Math.max(0, Math.round((toplam - tahsilat) * 100) / 100);
      if (veresiyeMi) {
        kalan = toplam;
        tahsilat = 0;
      }

      ozet.toplam += toplam;
      if (tahsilat > 0) gunlukOzetTahsilatEkle(ozet, odeme, tahsilat);
      if (kalan > 0) ozet.veresiye += kalan;
      ozet.islemAdedi += 1;

      const grupLogID = k.LogID || k.KayitID;
      const ortak = {
        Tarih: k.Tarih,
        KullaniciAdi: k.Kullanici || '',
        IslemTipi: 'Hızlı Satış',
        GrupLogID: grupLogID,
        KayitID: k.KayitID,
        MobilKaynak: hareketMobilMi({ Referans: k.Referans }),
        MusteriAd: PERAKENDE_ISLEM_ETIKET,
      };
      islemler.push({
        ...ortak,
        LogID: grupLogID,
        TurEtiket: 'Satış',
        SatirTur: 'satis',
        Odeme: veresiyeMi ? 'Veresiye' : '—',
        Tutar: toplam,
        KisaAciklama: PERAKENDE_ISLEM_ETIKET,
        Aciklama: '',
        Yon: 'giris',
        Kaynak: 'satis',
      });
      if (!veresiyeMi && tahsilat > 0.009) {
        islemler.push({
          ...ortak,
          LogID: grupLogID,
          TurEtiket: 'Tahsilat',
          SatirTur: 'tahsilat',
          Odeme: odeme,
          Tutar: tahsilat,
          KisaAciklama: '',
          Aciklama: '',
          Yon: 'giris',
          Kaynak: 'satis_tahsilat',
        });
      }
    }
  } catch (err) {
    console.warn('Günlük perakende satışları okunamadı:', err.message);
  }
}

/** Tedarik mal alım ve ödemeler — tek kaynak: TedarikAlim + TedarikciOdeme (IslemGecmisi değil). */
async function gunlukTedarikciIslemleriniEkle(pool, basTrim, bitTrim, ozet, islemler) {
  if (await tabloVarMi(pool, 'TedarikAlim')) {
    try {
      const alimRs = await pool.request()
        .input('bas', sql.NVarChar(10), basTrim)
        .input('bit', sql.NVarChar(10), bitTrim)
        .query(`
          SELECT a.AlimID, a.Tarih, a.ToplamTutar, a.OdemeSekli, a.Kullanici, t.Unvan
          FROM TedarikAlim a
          INNER JOIN Tedarikciler t ON t.TedarikciID = a.TedarikciID
          WHERE CAST(a.Tarih AS DATE) >= CAST(@bas AS DATE)
            AND CAST(a.Tarih AS DATE) <= CAST(@bit AS DATE)
          ORDER BY a.Tarih DESC, a.AlimID DESC
        `);
      for (const a of alimRs.recordset || []) {
        const alimID = a.AlimID;
        const toplam = Number(a.ToplamTutar || 0);
        const odenen = await gunlukTedarikAlimOdenenTutar(pool, alimID);
        const kalan = Math.max(0, Math.round((toplam - odenen) * 100) / 100);
        let odeme = String(a.OdemeSekli || 'Nakit').trim();
        if (odenen <= 0 && kalan > 0) odeme = 'Veresiye';
        const unvan = String(a.Unvan || '').trim() || 'Tedarikçi';
        const malParse = { toplam, odeme: odenen, kalan };
        const kasaCikis = tedarikMalAlimKasaTutari(malParse);
        const veresiyeKisim =
          malParse.kalan > 0 ? malParse.kalan : kasaCikis <= 0 ? malParse.toplam : 0;
        const tutar = kasaCikis > 0 ? kasaCikis : veresiyeKisim;

        if (kasaCikis > 0) {
          if (odeme === 'Nakit') ozet.giderNakit += kasaCikis;
          else if (odeme === 'Kart') ozet.giderKart += kasaCikis;
          else if (odeme === 'Havale') ozet.giderHavale += kasaCikis;
          else ozet.giderDiger += kasaCikis;
          if (odeme === 'Nakit' || odeme === 'Kart' || odeme === 'Havale') {
            ozet.giderKasaToplam += kasaCikis;
            ozet.giderTedarikciKasa += kasaCikis;
          }
        }
        if (veresiyeKisim > 0) ozet.malAlimVeresiye += veresiyeKisim;
        ozet.islemAdedi += 1;

        const aciklama = gunlukMalAlimAciklamaOlustur(unvan, alimID, toplam, odenen, odeme, kalan);
        islemler.push({
          LogID: alimID,
          GrupLogID: alimID,
          AlimID: alimID,
          Tarih: a.Tarih,
          KullaniciAdi: a.Kullanici || '',
          IslemTipi: 'Tedarik Mal Alım',
          SatirTur: 'mal_alim',
          TurEtiket: 'Mal alım',
          Odeme: odeme,
          Tutar: tutar,
          AlimToplam: toplam,
          Aciklama: aciklama,
          MusteriAd: unvan,
          KisaAciklama: unvan,
          Yon: 'cikis',
          Kaynak: 'mal_alim',
          MobilKaynak: false,
        });
      }
    } catch (err) {
      console.warn('Günlük tedarik alımları okunamadı:', err.message);
    }
  }

  if (await tabloVarMi(pool, 'TedarikciOdeme')) {
    try {
      const odRs = await pool.request()
        .input('bas', sql.NVarChar(10), basTrim)
        .input('bit', sql.NVarChar(10), bitTrim)
        .query(`
          SELECT o.OdemeID, o.Tutar, o.OdemeSekli, o.Kullanici, o.Aciklama, o.Tarih, t.Unvan
          FROM TedarikciOdeme o
          INNER JOIN Tedarikciler t ON t.TedarikciID = o.TedarikciID
          WHERE CAST(o.Tarih AS DATE) >= CAST(@bas AS DATE)
            AND CAST(o.Tarih AS DATE) <= CAST(@bit AS DATE)
            AND ISNULL(o.Aciklama, N'') NOT LIKE N'Mal alım ödemesi%'
          ORDER BY o.Tarih DESC, o.OdemeID DESC
        `);
      for (const o of odRs.recordset || []) {
        const tutar = Number(o.Tutar || 0);
        if (tutar <= 0) continue;
        const odeme = String(o.OdemeSekli || 'Nakit').trim();
        if (odeme === 'Nakit') ozet.giderNakit += tutar;
        else if (odeme === 'Kart') ozet.giderKart += tutar;
        else if (odeme === 'Havale') ozet.giderHavale += tutar;
        else ozet.giderDiger += tutar;
        if (odeme === 'Nakit' || odeme === 'Kart' || odeme === 'Havale') {
          ozet.giderKasaToplam += tutar;
          ozet.giderTedarikciKasa += tutar;
        }
        const unvan = String(o.Unvan || '').trim() || 'Tedarikçi';
        ozet.islemAdedi += 1;
        const aciklama = o.Aciklama || `${unvan}: ${tutar}₺ (${odeme})`;
        islemler.push({
          LogID: o.OdemeID,
          GrupLogID: o.OdemeID,
          Tarih: o.Tarih,
          KullaniciAdi: o.Kullanici || '',
          IslemTipi: 'Tedarikçi Ödeme',
          SatirTur: '',
          TurEtiket: `Tedarikçi ödeme (${odeme})`,
          Odeme: odeme,
          Tutar: tutar,
          Aciklama: aciklama,
          MusteriAd: unvan,
          KisaAciklama: unvan,
          Yon: 'cikis',
          Kaynak: 'tedarikci_odeme',
          MobilKaynak: false,
        });
      }
    } catch (err) {
      console.warn('Günlük tedarik ödemeleri okunamadı:', err.message);
    }
  }
}

/** Günlük müşteri satış/tahsilat/iade — tek kaynak: MusteriHareketleri (cari silinince otomatik düşer). */
async function gunlukMusteriCariHareketleriniEkle(pool, basTrim, bitTrim, ozet, islemler) {
  const rs = await pool.request()
    .input('bas', sql.NVarChar(10), basTrim)
    .input('bit', sql.NVarChar(10), bitTrim)
    .query(`
      SELECT h.HareketID, h.MusteriID, h.Tur, h.ToplamTutar, h.OdenenTutar, h.KalanTutar,
             h.OdemeSekli, h.Aciklama, h.Kullanici, h.Referans, h.Tarih,
             m.AdSoyad, m.FirmaAdi, m.tur AS MusteriTur
      FROM MusteriHareketleri h
      LEFT JOIN Musteriler m ON m.MusteriID = h.MusteriID
      WHERE CAST(h.Tarih AS DATE) >= CAST(@bas AS DATE)
        AND CAST(h.Tarih AS DATE) <= CAST(@bit AS DATE)
        AND h.Tur IN (N'Satis', N'Odeme', N'Iade', N'IadeOdeme')
        AND ISNULL(h.Referans, N'') <> N'devir:import'
        AND ISNULL(h.Kullanici, N'') <> N'aktarim'
      ORDER BY h.Tarih DESC, h.HareketID DESC
    `);
  const liste = (rs.recordset || []).filter((h) => !musteriDevirHareketMi(h));
  if (!liste.length) return;

  const byRef = new Map();
  for (const h of liste) {
    const ref = (h.Referans || '').trim() || `_h${h.HareketID}`;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(h);
  }

  for (const refGrup of byRef.values()) {
    const satisH = refGrup.find((x) => String(x.Tur || '').toLowerCase() === 'satis');
    if (satisH) {
      const musteriAd = gunlukHareketMusteriAd(satisH);
      const mobilMi = /^\[Mobil\]/i.test(String(satisH.Aciklama || ''));
      const toplam = Number(satisH.ToplamTutar || 0);
      const kalan = Number(satisH.KalanTutar || 0);
      let tahsilat = 0;
      let tahOdeme = satisH.OdemeSekli || 'Nakit';
      for (const o of refGrup) {
        if (String(o.Tur || '').toLowerCase() !== 'odeme') continue;
        tahsilat += Number(o.OdenenTutar || 0);
        if (o.OdemeSekli) tahOdeme = o.OdemeSekli;
      }
      tahsilat = Math.round(tahsilat * 100) / 100;

      ozet.toplam += toplam;
      if (tahsilat > 0) gunlukOzetTahsilatEkle(ozet, tahOdeme, tahsilat);
      if (kalan > 0) ozet.veresiye += kalan;
      else if (tahsilat <= 0 && toplam > 0) ozet.veresiye += toplam;
      ozet.islemAdedi += 1;

      const ortak = {
        Tarih: satisH.Tarih,
        KullaniciAdi: satisH.Kullanici || '',
        HareketID: satisH.HareketID,
        MusteriID: satisH.MusteriID,
        LogID: satisH.HareketID,
        GrupLogID: satisH.HareketID,
        MobilKaynak: mobilMi,
        MusteriAd: musteriAd,
        GrupAnahtar: `hareket-${satisH.HareketID}`,
      };
      const kisa = gunlukMusteriSatisKisaAciklama(satisH.Aciklama, kalan) || musteriAd;
      islemler.push({
        ...ortak,
        IslemTipi: 'Müşteri Satış',
        TurEtiket: 'Satış',
        SatirTur: 'satis',
        Odeme: kalan > 0.009 ? 'Veresiye' : '—',
        Tutar: toplam,
        KisaAciklama: kisa,
        Aciklama: satisH.Aciklama || kisa,
        Yon: 'giris',
        Kaynak: 'musteri_satis',
      });
      if (tahsilat > 0.009) {
        islemler.push({
          ...ortak,
          IslemTipi: 'Müşteri Satış',
          TurEtiket: 'Tahsilat',
          SatirTur: 'tahsilat',
          Odeme: tahOdeme,
          Tutar: tahsilat,
          KisaAciklama: `${musteriAd} — tahsilat`,
          Aciklama: satisH.Aciklama,
          Yon: 'giris',
          Kaynak: 'musteri_tahsilat',
        });
      }
      continue;
    }

    const iadeH = refGrup.find((x) => String(x.Tur || '').toLowerCase() === 'iade');
    if (iadeH) {
      const musteriAd = gunlukHareketMusteriAd(iadeH);
      const mobilMi = /^\[Mobil\]/i.test(String(iadeH.Aciklama || ''));
      const iadeToplam = Number(iadeH.ToplamTutar || 0);
      const iadeOdemeH = refGrup.find((x) => String(x.Tur || '').toLowerCase() === 'iadeodeme');
      const iadePara = iadeOdemeH ? Number(iadeOdemeH.OdenenTutar || 0) : 0;
      const iadeOdeme = iadeOdemeH?.OdemeSekli || 'Nakit';

      if (iadeToplam > 0) ozet.toplam = Math.max(0, Math.round((ozet.toplam - iadeToplam) * 100) / 100);
      if (iadePara > 0) gunlukOzetGiderEkle(ozet, iadeOdeme, iadePara);
      ozet.islemAdedi += 1;

      const ortak = {
        Tarih: iadeH.Tarih,
        KullaniciAdi: iadeH.Kullanici || '',
        HareketID: iadeH.HareketID,
        MusteriID: iadeH.MusteriID,
        LogID: iadeH.HareketID,
        GrupLogID: iadeH.HareketID,
        MobilKaynak: mobilMi,
        MusteriAd: musteriAd,
        GrupAnahtar: `hareket-${iadeH.HareketID}`,
      };
      islemler.push({
        ...ortak,
        IslemTipi: 'Müşteri İade',
        TurEtiket: 'İade',
        SatirTur: 'iade',
        Odeme: '—',
        Tutar: iadeToplam,
        KisaAciklama: `${musteriAd} — iade`,
        Aciklama: iadeH.Aciklama || `${musteriAd} — iade ${iadeToplam}₺`,
        Yon: 'cikis',
        Kaynak: 'musteri_iade',
      });
      if (iadePara > 0.009) {
        islemler.push({
          ...ortak,
          HareketID: iadeOdemeH.HareketID,
          LogID: iadeOdemeH.HareketID,
          IslemTipi: 'Müşteri İade',
          TurEtiket: 'İade ödeme',
          SatirTur: 'iade_odeme',
          Odeme: iadeOdeme,
          Tutar: iadePara,
          KisaAciklama: `${musteriAd} — iade ödemesi`,
          Aciklama: iadeOdemeH.Aciklama,
          Yon: 'cikis',
          Kaynak: 'musteri_iade_odeme',
        });
      }
      continue;
    }

    for (const odemeH of refGrup) {
      if (String(odemeH.Tur || '').toLowerCase() !== 'odeme') continue;
      const tutar = Number(odemeH.OdenenTutar || 0);
      if (tutar <= 0) continue;
      const musteriAd = gunlukHareketMusteriAd(odemeH);
      const mobilMi = /^\[Mobil\]/i.test(String(odemeH.Aciklama || ''));
      const odeme = odemeH.OdemeSekli || 'Nakit';

      gunlukOzetTahsilatEkle(ozet, odeme, tutar);
      ozet.toplam += tutar;
      ozet.islemAdedi += 1;

      islemler.push({
        Tarih: odemeH.Tarih,
        KullaniciAdi: odemeH.Kullanici || '',
        HareketID: odemeH.HareketID,
        MusteriID: odemeH.MusteriID,
        LogID: odemeH.HareketID,
        GrupLogID: odemeH.HareketID,
        MobilKaynak: mobilMi,
        MusteriAd: musteriAd,
        IslemTipi: 'Müşteri Ödeme',
        TurEtiket: 'Tahsilat',
        SatirTur: 'tahsilat',
        Odeme: odeme,
        Tutar: tutar,
        KisaAciklama: `${musteriAd} — tahsilat`,
        Aciklama: odemeH.Aciklama || `${musteriAd}: ${tutar}₺ [${odeme}]`,
        Yon: 'giris',
        Kaynak: 'musteri_odeme',
        GrupAnahtar: `hareket-${odemeH.HareketID}`,
      });
    }
  }
}

/**
 * Günlük işlem listesi — IslemGecmisi kullanılmaz.
 * Kaynaklar: HizliSatisKayitlari, MusteriHareketleri, TedarikAlim, TedarikciOdeme, GenelGider.
 */
async function gunlukIslemDetay(pool, basStr, bitStr) {
  const basTrim = String(basStr || '').trim().substring(0, 10);
  const bitTrim = String(bitStr || '').trim().substring(0, 10);
  const ymdOk = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymdOk.test(basTrim) || !ymdOk.test(bitTrim) || basTrim > bitTrim) {
    return bosGunlukSonuc();
  }

  const ozet = {
    nakit: 0,
    kart: 0,
    havale: 0,
    veresiye: 0,
    diger: 0,
    toplam: 0,
    toplamVeresiyesiz: 0,
    kasaGiris: 0,
    giderNakit: 0,
    giderKart: 0,
    giderHavale: 0,
    giderDiger: 0,
    malAlimVeresiye: 0,
    giderKasaToplam: 0,
    giderTedarikciKasa: 0,
    giderGenelKasa: 0,
    islemAdedi: 0,
  };

  const islemler = [];

  await gunlukPerakendeSatislariniEkle(pool, basTrim, bitTrim, ozet, islemler);
  await gunlukMusteriCariHareketleriniEkle(pool, basTrim, bitTrim, ozet, islemler);

  ozet.kasaGiris = ozet.nakit + ozet.kart + ozet.havale;

  await gunlukTedarikciIslemleriniEkle(pool, basTrim, bitTrim, ozet, islemler);
  await gunlukGenelGiderleriniEkle(pool, basTrim, bitTrim, ozet, islemler);

  await gunlukIslemMusteriAdlariniCoz(pool, islemler);
  await gunlukIslemFaturaDetaylariEkle(pool, islemler);
  const genisletilmis = gunlukIslemMalAlimOdemeSatirlariEkle(
    gunlukIslemMalAlimKalemSatirlarinaBol(gunlukIslemSatisKalemSatirlarinaBol(islemler))
  );

  genisletilmis.sort((a, b) => {
    const tb = new Date(b.Tarih) - new Date(a.Tarih);
    if (tb !== 0) return tb;
    const ga = a.GrupLogID || a.LogID;
    const gb = b.GrupLogID || b.LogID;
    if (ga && gb && ga === gb) {
      return gunlukIslemSatirSiraDegeri(a) - gunlukIslemSatirSiraDegeri(b);
    }
    return 0;
  });

  const islemlerGoster = genisletilmis.filter((r) => !gunlukListedeGizlenecekSatirMi(r));

  ozet.toplam = Math.round((Number(ozet.toplam) || 0) * 100) / 100;
  ozet.veresiye = Math.round((Number(ozet.veresiye) || 0) * 100) / 100;
  ozet.toplamVeresiyesiz = Math.round((ozet.toplam - ozet.veresiye) * 100) / 100;
  if (ozet.toplamVeresiyesiz < 0) ozet.toplamVeresiyesiz = 0;

  return { ozet, islemler: islemlerGoster };
}

app.get('/api/gunluk-islemler', async (req, res) => {
  try {
    const bugun = bugununTarihiStr();
    const baslangic = (req.query.baslangic && String(req.query.baslangic).trim()) || bugun;
    const bitis = (req.query.bitis && String(req.query.bitis).trim()) || baslangic;

    const pool = await poolPromise;
    const detay = await gunlukIslemDetay(pool, baslangic, bitis);

    const cari = await pool.request().query('SELECT SUM(Bakiye) AS Toplam FROM Musteriler WHERE Bakiye > 0');

    res.json({
      baslangic,
      bitis,
      ...detay,
      cariAlacakToplam: cari.recordset[0].Toplam || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Günlük işlemler alınamadı.' });
  }
});

app.get('/api/gunluk-islem/:logID/detay', async (req, res) => {
  try {
    const logID = parseInt(req.params.logID, 10);
    if (!Number.isInteger(logID) || logID < 1) {
      return res.status(400).json({ message: 'Geçersiz işlem.' });
    }
    const pool = await poolPromise;
    await ensureHizliSatisKayitTablosu(pool);
    const kaynak = String(req.query.kaynak || '').trim();
    const hareketID = parseInt(req.query.hareketID, 10);
    const veri = await gunlukIslemDetayVer(pool, logID, {
      kaynak,
      hareketID: Number.isInteger(hareketID) && hareketID > 0 ? hareketID : null,
    });
    if (!veri) return res.status(404).json({ message: 'İşlem bulunamadı.' });
    res.json(veri);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Detay alınamadı.' });
  }
});

app.post('/api/gunluk-islem/:logID/iptal', async (req, res) => {
  try {
    const logID = parseInt(req.params.logID, 10);
    const { kullaniciAdi, sifre, kullanici } = req.body || {};
    if (!Number.isInteger(logID) || logID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz işlem.' });
    }
    const pool = await poolPromise;
    await ensureHizliSatisKayitTablosu(pool);

    const sifreSonuc = await kullaniciSifreDogrula(pool, kullaniciAdi, sifre);
    if (!sifreSonuc.ok) {
      return res.status(401).json({ success: false, message: sifreSonuc.message });
    }

    const veri = await gunlukIslemDetayVer(pool, logID);
    if (!veri) return res.status(404).json({ success: false, message: 'İşlem bulunamadı.' });
    const perakendeSatis = hizliSatisLogMu(veri.log) || musteriSatisLogMu(veri.log);
    if (!perakendeSatis) {
      return res.status(400).json({ success: false, message: 'Bu işlem türü günlük listeden iptal edilemez.' });
    }
    if (veri.iptalEdildi) {
      return res.status(400).json({ success: false, message: 'Bu satış zaten iptal edilmiş.' });
    }

    const kullaniciEtiket = String(kullanici || kullaniciAdi || 'Sistem').substring(0, 50);

    if (veri.musterili && veri.hareketID) {
      const sonuc = await musteriHareketGrupIptal(pool, veri.hareketID, kullaniciEtiket);
      if (!sonuc.success) {
        return res.status(sonuc.status || 400).json({ success: false, message: sonuc.message });
      }
      return res.json({
        success: true,
        message: sonuc.message || 'Satış silindi; cari, stok, kasa ve günlük kayıt geri alındı.',
      });
    }

    if (!veri.iptalEdilebilir) {
      return res.status(400).json({
        success: false,
        message: veri.musterili
          ? 'Müşterili satış caride bulunamadı. Müşteri sayfasından silmeyi deneyin.'
          : 'Bu kayıt için güvenli iptal verisi yok (eski satış).',
      });
    }

    let iptalMesaj = '';

    if (veri.kayitID) {
      const kRs = await pool.request()
        .input('KayitID', sql.Int, veri.kayitID)
        .query('SELECT TOP 1 * FROM HizliSatisKayitlari WHERE KayitID = @KayitID');
      const kayit = kRs.recordset[0];
      if (!kayit) return res.status(404).json({ success: false, message: 'Satış kaydı bulunamadı.' });
      const sonuc = await hizliSatisKayitIptalEt(pool, kayit, kullaniciEtiket);
      if (!sonuc.success) {
        return res.status(sonuc.status || 400).json({ success: false, message: sonuc.message });
      }
      iptalMesaj = sonuc.message;
    } else {
      return res.status(400).json({ success: false, message: 'İptal için kayıt bulunamadı.' });
    }

    await islemKaydet(
      kullaniciEtiket,
      'Hızlı Satış İptal',
      `Log #${logID} iptal edildi — ${veri.log.Aciklama || ''}`.substring(0, 500)
    );

    res.json({ success: true, message: iptalMesaj || 'Satış iptal edildi; stok ve kasa/cari geri alındı.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'İptal sırasında hata oluştu.' });
  }
});

app.post('/api/gunluk-islem/:logID/duzenle', async (req, res) => {
  try {
    const logID = parseInt(req.params.logID, 10);
    const { kullaniciAdi, sifre, kullanici, kalemler, odemeTipi, tahsilatTutar } = req.body || {};
    if (!Number.isInteger(logID) || logID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz işlem.' });
    }
    if (!Array.isArray(kalemler) || kalemler.length === 0) {
      return res.status(400).json({ success: false, message: 'Sepet boş.' });
    }
    if (kalemler.length > 100) {
      return res.status(400).json({ success: false, message: 'Çok fazla satır.' });
    }

    const odemeRaw = (odemeTipi || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Kart', 'Havale'];
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Perakende düzenlemede yalnızca Nakit, Kart veya Havale kullanılabilir.' });
    }

    const pool = await poolPromise;
    await ensureHizliSatisKayitTablosu(pool);

    const sifreSonuc = await kullaniciSifreDogrula(pool, kullaniciAdi, sifre);
    if (!sifreSonuc.ok) {
      return res.status(401).json({ success: false, message: sifreSonuc.message });
    }

    const veri = await gunlukIslemDetayVer(pool, logID);
    if (!veri) return res.status(404).json({ success: false, message: 'İşlem bulunamadı.' });
    if (!veri.duzenleEdilebilir) {
      return res.status(400).json({ success: false, message: 'Bu perakende satış düzenlenemez (eski kayıt veya müşterili satış).' });
    }
    if (veri.iptalEdildi) {
      return res.status(400).json({ success: false, message: 'İptal edilmiş satış düzenlenemez.' });
    }

    const birlestir = new Map();
    for (const k of kalemler) {
      const id = parseInt(k.urunID ?? k.stokID, 10);
      const m = parseInt(k.miktar, 10);
      if (!id || !Number.isInteger(m) || m < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sepet satırı.' });
      }
      let birimFiyat = null;
      if (k.birimFiyat != null && k.birimFiyat !== '') {
        birimFiyat = Math.round(Number(k.birimFiyat) * 100) / 100;
        if (!Number.isFinite(birimFiyat) || birimFiyat < 0) {
          return res.status(400).json({ success: false, message: 'Geçersiz birim fiyat.' });
        }
      }
      const prev = birlestir.get(id);
      if (prev) {
        if (birimFiyat != null && prev.birimFiyat != null && birimFiyat !== prev.birimFiyat) {
          return res.status(400).json({ success: false, message: 'Aynı ürün için tutarsız birim fiyat.' });
        }
        prev.miktar += m;
        if (birimFiyat != null) prev.birimFiyat = birimFiyat;
      } else {
        birlestir.set(id, { miktar: m, birimFiyat });
      }
    }

    const satirlar = [];
    let genelToplam = 0;
    for (const [stokID, entry] of birlestir) {
      const miktar = entry.miktar;
      const stokRs = await pool.request()
        .input('ID', sql.Int, stokID)
        .query('SELECT StokID, UrunAdi, MevcutMiktar, SatisFiyati FROM Stok WHERE StokID = @ID');
      if (stokRs.recordset.length === 0) {
        return res.status(404).json({ success: false, message: `Ürün bulunamadı (ID: ${stokID}).` });
      }
      const row = stokRs.recordset[0];
      const birim =
        entry.birimFiyat != null && Number.isFinite(entry.birimFiyat)
          ? entry.birimFiyat
          : Number(row.SatisFiyati);
      const satirTutar = Math.round(miktar * birim * 100) / 100;
      genelToplam += satirTutar;
      satirlar.push({
        stokID,
        miktar,
        urunAdi: row.UrunAdi,
        birimFiyat: birim,
        satirTutar,
      });
    }
    genelToplam = Math.round(genelToplam * 100) / 100;

    let kasaTutar = genelToplam;
    if (tahsilatTutar != null && tahsilatTutar !== '') {
      kasaTutar = Math.round(Number(tahsilatTutar) * 100) / 100;
      if (!Number.isFinite(kasaTutar) || kasaTutar < 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz tahsilat tutarı.' });
      }
    }
    if (kasaTutar > genelToplam) {
      return res.status(400).json({ success: false, message: 'Tahsilat tutarı sepet toplamını geçemez.' });
    }

    const kRs = await pool.request()
      .input('KayitID', sql.Int, veri.kayitID)
      .query('SELECT TOP 1 * FROM HizliSatisKayitlari WHERE KayitID = @KayitID');
    const kayit = kRs.recordset[0];
    if (!kayit) return res.status(404).json({ success: false, message: 'Satış kaydı bulunamadı.' });

    const kullaniciEtiket = String(kullanici || kullaniciAdi || 'Sistem').substring(0, 50);
    const sonuc = await hizliSatisKayitGuncelle(pool, kayit, veri.log, {
      satirlar,
      genelToplam,
      kasaTutar,
      odemeRaw,
      kullanici: kullaniciEtiket,
    });
    if (!sonuc.success) {
      return res.status(sonuc.status || 400).json({ success: false, message: sonuc.message });
    }

    await islemKaydet(
      kullaniciEtiket,
      'Hızlı Satış Düzenleme',
      `Log #${logID} düzenlendi — ${genelToplam}₺ [${odemeRaw}]`.substring(0, 500),
    );

    res.json({ success: true, message: sonuc.message || 'Perakende satış güncellendi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Düzenleme sırasında hata oluştu.' });
  }
});

app.post('/api/bakim/gunluk-kopuk-temizle', async (req, res) => {
  try {
    const { kullaniciAdi, sifre, bas, bit, dryRun, uygula, kullanici, musteriFiltre, musteri } = req.body || {};
    const pool = await poolPromise;
    const sifreSonuc = await kullaniciSifreDogrula(pool, kullaniciAdi, sifre);
    if (!sifreSonuc.ok) {
      return res.status(401).json({ success: false, message: sifreSonuc.message });
    }
    const sonuc = await gunlukCariKopukTemizle(pool, {
      bas,
      bit,
      dryRun: uygula ? false : dryRun !== false,
      kullanici: kullanici || kullaniciAdi || 'Bakim',
      musteriFiltre: musteriFiltre || musteri || null,
    });
    res.json({ success: sonuc.success, ...sonuc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message || 'Kopuk kayıt temizliği başarısız.' });
  }
});

app.get('/api/kar-ozet', async (req, res) => {
  try {
    const bugun = bugununTarihiStr();
    const baslangic = (req.query.baslangic && String(req.query.baslangic).trim()) || bugun;
    const bitis = (req.query.bitis && String(req.query.bitis).trim()) || baslangic;
    const ymdOk = /^\d{4}-\d{2}-\d{2}$/;
    if (!ymdOk.test(baslangic) || !ymdOk.test(bitis) || baslangic > bitis) {
      return res.status(400).json({ success: false, message: 'Geçersiz tarih aralığı.' });
    }

    const pool = await poolPromise;
    const rq = pool.request().input('Baslangic', sql.NVarChar(10), baslangic).input('Bitis', sql.NVarChar(10), bitis);

    const satisRs = await rq.query(`
      SELECT
        ISNULL(SUM(CASE WHEN LOWER(h.Tur) = 'satis' THEN ISNULL(h.ToplamTutar, 0) ELSE 0 END), 0) AS BrutSatis,
        ISNULL(SUM(CASE WHEN LOWER(h.Tur) = 'iade' THEN ISNULL(h.ToplamTutar, 0) ELSE 0 END), 0) AS IadeTutar
      FROM MusteriHareketleri h
      WHERE CAST(h.Tarih AS DATE) >= CAST(@Baslangic AS DATE)
        AND CAST(h.Tarih AS DATE) <= CAST(@Bitis AS DATE)
    `);

    const maliyetRs = await rq.query(`
      SELECT
        ISNULL(SUM(CASE WHEN LOWER(h.Tur) = 'satis' THEN ISNULL(d.Miktar,0) * ISNULL(s.AlisFiyati,0) ELSE 0 END), 0) AS SatisMaliyet,
        ISNULL(SUM(CASE WHEN LOWER(h.Tur) = 'iade' THEN ISNULL(d.Miktar,0) * ISNULL(s.AlisFiyati,0) ELSE 0 END), 0) AS IadeMaliyet
      FROM MusteriHareketleri h
      INNER JOIN MusteriHareketDetaylari d ON d.HareketID = h.HareketID
      LEFT JOIN Stok s ON s.StokID = d.StokID
      WHERE CAST(h.Tarih AS DATE) >= CAST(@Baslangic AS DATE)
        AND CAST(h.Tarih AS DATE) <= CAST(@Bitis AS DATE)
    `);

    const giderRs = await rq.query(`
      SELECT ISNULL(SUM(ISNULL(g.Tutar, 0)), 0) AS ToplamGider
      FROM GenelGider g
      WHERE CAST(g.Tarih AS DATE) >= CAST(@Baslangic AS DATE)
        AND CAST(g.Tarih AS DATE) <= CAST(@Bitis AS DATE)
    `);

    const brutSatis = Number(satisRs.recordset[0]?.BrutSatis || 0);
    const iadeTutar = Number(satisRs.recordset[0]?.IadeTutar || 0);
    const netSatis = Math.round((brutSatis - iadeTutar) * 100) / 100;
    const satisMaliyet = Number(maliyetRs.recordset[0]?.SatisMaliyet || 0);
    const iadeMaliyet = Number(maliyetRs.recordset[0]?.IadeMaliyet || 0);
    const netMaliyet = Math.round((satisMaliyet - iadeMaliyet) * 100) / 100;
    const brutKar = Math.round((netSatis - netMaliyet) * 100) / 100;
    const toplamGider = Number(giderRs.recordset[0]?.ToplamGider || 0);
    const netKar = Math.round((brutKar - toplamGider) * 100) / 100;

    res.json({
      success: true,
      baslangic,
      bitis,
      ozet: {
        brutSatis,
        iadeTutar,
        netSatis,
        satisMaliyet,
        iadeMaliyet,
        netMaliyet,
        brutKar,
        toplamGider,
        netKar,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Kâr özeti alınamadı.' });
  }
});

app.get('/api/ozet', async (req, res) => {
  try {
    const pool = await poolPromise;

    const alacak = await pool.request().query('SELECT SUM(Bakiye) AS Toplam FROM Musteriler WHERE Bakiye > 0');
    const musteri = await pool.request().query('SELECT COUNT(*) AS Sayi FROM Musteriler');

    const servis = await pool.request().query("SELECT COUNT(*) AS Sayi FROM ServisIsleri WHERE Durum = 'Açık'");

    const stokToplam = await pool.request().query('SELECT COUNT(*) AS Sayi FROM Stok');
    const stokKritik = await pool.request().query(
      'SELECT COUNT(*) AS Sayi FROM Stok WHERE MevcutMiktar <= ISNULL(KritikEsik, 5)'
    );

    const bugun = bugununTarihiStr();
    const gunluk = await gunlukIslemDetay(pool, bugun, bugun);

    res.json({
      ToplamAlacak: alacak.recordset[0].Toplam || 0,
      GunlukCiro: gunluk.ozet.toplamVeresiyesiz,
      ToplamMusteri: musteri.recordset[0].Sayi || 0,
      AcikServis: servis.recordset[0].Sayi || 0,
      ToplamStokUrun: stokToplam.recordset[0].Sayi || 0,
      KritikStok: stokKritik.recordset[0].Sayi || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Özet bilgileri çekilirken hata oluştu.');
  }
});

registerUpdateRoutes(app, {
  APP_ROOT,
  packageJson,
  yedekKlasorYolu,
  guncellemeManifestOku,
  urlIcerikIndir,
  githubReleaseAssetUrlTahmini,
});

registerBackupRoutes(app, {
  sql,
  poolPromise,
  YEDEK_TABLOLAR,
  tabloVarMi,
  yedekKlasorYolu,
  yedekDosyaAdi,
});

// ==========================================
// --- GİRİŞ (LOGIN) VE LOG İŞLEMLERİ ---
// ==========================================

app.post('/api/login', async (req, res) => {
  try {
    const { KullaniciAdi, Sifre } = req.body;
    const pool = await poolPromise;
    const result = await pool.request()
      .input('KullaniciAdi', sql.NVarChar(50), KullaniciAdi)
      .query('SELECT TOP 1 KullaniciID, AdSoyad, KullaniciAdi, Yetki, Sifre FROM Kullanicilar WHERE KullaniciAdi = @KullaniciAdi');

    if (result.recordset.length > 0) {
      const row = result.recordset[0];
      const ok = await sifreDogrulaVeGerekirseYukselt(pool, row.KullaniciID, row.Sifre, Sifre);
      if (!ok) {
        return res.status(401).json({ success: false, message: 'Hatalı kullanıcı adı veya şifre!' });
      }
      delete row.Sifre;
      res.json({ success: true, kullanici: row });
    } else {
      res.status(401).json({ success: false, message: 'Hatalı kullanıcı adı veya şifre!' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Giriş yapılırken bir hata oluştu.');
  }
});

app.post('/api/kullanici/profil', async (req, res) => {
  try {
    const { kullaniciAdi, adSoyad, mevcutSifre, yeniSifre } = req.body || {};
    const ka = String(kullaniciAdi || '').trim();
    const ad = String(adSoyad || '').trim().substring(0, 100);
    const ms = String(mevcutSifre || '');
    const ys = String(yeniSifre || '');
    if (!ka || !ad) {
      return res.status(400).json({ success: false, message: 'Kullanıcı adı ve ad soyad zorunlu.' });
    }
    const pool = await poolPromise;
    const mevcut = await pool.request()
      .input('KullaniciAdi', sql.NVarChar(50), ka)
      .query('SELECT TOP 1 KullaniciID, Sifre FROM Kullanicilar WHERE KullaniciAdi = @KullaniciAdi');
    if (!mevcut.recordset.length) {
      return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı.' });
    }
    const kullaniciID = Number(mevcut.recordset[0].KullaniciID);
    if (ys && !ms) {
      return res.status(400).json({ success: false, message: 'Yeni şifre için mevcut şifre gerekli.' });
    }
    if (ys) {
      const ok = await sifreDogrulaVeGerekirseYukselt(pool, kullaniciID, mevcut.recordset[0].Sifre, ms);
      if (!ok) return res.status(400).json({ success: false, message: 'Mevcut şifre hatalı.' });
    }
    const yeniSifreHash = ys ? sifreHashUret(ys) : null;
    await pool.request()
      .input('KullaniciID', sql.Int, kullaniciID)
      .input('AdSoyad', sql.NVarChar(100), ad)
      .input('YeniSifre', sql.NVarChar(255), yeniSifreHash)
      .query(`
        UPDATE Kullanicilar
        SET AdSoyad = @AdSoyad,
            Sifre = CASE WHEN @YeniSifre IS NULL OR LTRIM(RTRIM(@YeniSifre)) = '' THEN Sifre ELSE @YeniSifre END
        WHERE KullaniciID = @KullaniciID
      `);
    await islemKaydet(ka, 'Kullanıcı Profil', `Profil güncellendi: ${ad}`);
    res.json({ success: true, message: 'Profil güncellendi.', kullanici: { KullaniciAdi: ka, AdSoyad: ad } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Profil güncellenemedi.' });
  }
});

app.get('/api/loglar', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT TOP 100 * FROM IslemGecmisi ORDER BY LogID DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).send('Loglar listelenirken hata oluştu.');
  }
});

app.get('/api/servis/detay/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ID', sql.Int, id)
      .query(`
        SELECT s.*, m.AdSoyad 
        FROM ServisIsleri s
        LEFT JOIN Musteriler m ON s.MusteriID = m.MusteriID
        WHERE s.ServisID = @ID
      `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ====================== YARDIMCI LOG FONKSİYONU ======================
const MOBIL_LOG_ONEK = '[Mobil] ';

function logMobilMi(row) {
  return String(row?.Aciklama || '').startsWith(MOBIL_LOG_ONEK);
}

function aciklamaMobilIsaretle(req, aciklama) {
  const s = String(aciklama || '');
  if (!req?.mobilKaynak || s.startsWith(MOBIL_LOG_ONEK)) return s;
  const max = 500 - MOBIL_LOG_ONEK.length;
  return MOBIL_LOG_ONEK + (s.length > max ? `${s.substring(0, max - 1)}…` : s);
}

function hareketMobilMi(h) {
  const a = String(h?.Aciklama || '');
  const r = String(h?.Referans || '');
  if (a.startsWith(MOBIL_LOG_ONEK)) return true;
  if (/^mobil:/i.test(r)) return true;
  if (/mobil tahsilat/i.test(a)) return true;
  return false;
}

function hareketAciklamaMobilIsaretle(mobil, aciklama) {
  const s = String(aciklama || '').trim();
  if (!mobil || s.startsWith(MOBIL_LOG_ONEK)) return s || null;
  const birlesik = s ? `${MOBIL_LOG_ONEK}${s}` : `${MOBIL_LOG_ONEK}Mobil işlem`;
  return birlesik.length > 500 ? birlesik.substring(0, 499) + '…' : birlesik;
}

async function islemKaydet(kullanici, tip, aciklama, req) {
  await islemKaydetDonus(kullanici, tip, aciklamaMobilIsaretle(req, aciklama));
}

async function islemKaydetDonus(kullanici, tip, aciklama) {
  try {
    const pool = await poolPromise;
    const ins = await pool.request()
      .input('KullaniciAdi', sql.NVarChar(100), kullanici || 'Sistem')
      .input('IslemTipi', sql.NVarChar(50), tip)
      .input('Aciklama', sql.NVarChar(500), aciklama)
      .query(`
        INSERT INTO IslemGecmisi (KullaniciAdi, IslemTipi, Aciklama, Tarih) 
        OUTPUT INSERTED.LogID
        VALUES (@KullaniciAdi, @IslemTipi, @Aciklama, GETDATE())
      `);
    const logID = ins.recordset[0]?.LogID;
    console.log(`LOG KAYDEDİLDİ: ${tip} - ${aciklama}`);
    return logID || null;
  } catch (err) {
    console.error('Log kaydetme hatası (devam ediliyor):', err.message);
    return null;
  }
}

/** Log metninden Müşteri #id çeker */
function aciklamadanMusteriID(aciklama) {
  const m = String(aciklama || '').match(/Müşteri\s*#(\d+)/i);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Log / cari metninden ürün×adet kalemleri (YUT×1, ADAD x2 vb.). */
function aciklamadanUrunKalemParcala(urunPart) {
  if (!urunPart) return [];
  return String(urunPart)
    .replace(/…$/g, '')
    .trim()
    .split(',')
    .map((s) => {
      const p = s.trim().match(/^(.+?)\s*[x×]\s*(\d+)(?:\s*@\s*(\d+(?:[.,]\d+)?))?\s*$/i);
      if (!p) return null;
      const miktar = parseInt(p[2], 10);
      if (!Number.isFinite(miktar) || miktar < 1) return null;
      const birimFiyat = p[3] ? Number(String(p[3]).replace(',', '.')) || null : null;
      return { UrunAdi: p[1].trim(), Miktar: miktar, BirimFiyat: birimFiyat, SatirTutar: null, StokID: null };
    })
    .filter(Boolean);
}

function aciklamadanKalemler(aciklama) {
  const metin = String(aciklama || '').replace(/^\[Mobil\]\s*/i, '').trim();
  const malAlim = /mal\s*al[ıi]m/i.test(metin);
  const sonListe = metin.match(/\s[—–-]\s+([^—–-]+)$/);
  if (sonListe) {
    const k = aciklamadanUrunKalemParcala(sonListe[1]);
    if (k.length) return k;
  }
  if (malAlim) return [];
  return aciklamadanUrunKalemParcala(metin);
}

function aciklamadanAlimID(aciklama) {
  const m = String(aciklama || '').match(/Alım\s*#(\d+)/i);
  const id = m ? parseInt(m[1], 10) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function gunlukTedarikAlimSatirlari(pool, alimID) {
  if (!Number.isInteger(alimID) || alimID < 1) return [];
  if (!(await tabloVarMi(pool, 'TedarikAlimSatir'))) return [];
  try {
    const dRs = await pool.request().input('AlimID', sql.Int, alimID).query(`
      SELECT UrunAdi, Miktar, AlisBirimFiyat AS BirimFiyat, SatirTutar
      FROM TedarikAlimSatir WHERE AlimID = @AlimID ORDER BY SatirID
    `);
    return (dRs.recordset || []).map((d) => gunlukTedarikKalemSatirNormalize(d));
  } catch (err) {
    console.warn('TedarikAlimSatir okunamadı:', err.message);
    return [];
  }
}

async function hizliSatisKayitOlustur(pool, opts) {
  const {
    logID,
    musteriID,
    referans,
    odemeSekli,
    sepetToplam,
    tahsilatTutar,
    kullanici,
    satirlar,
  } = opts;
  if (!satirlar || !satirlar.length) return null;
  try {
    const rq = pool.request();
    rq.input('LogID', sql.Int, logID || null);
    rq.input('MusteriID', sql.Int, musteriID || null);
    rq.input('Referans', sql.NVarChar(40), referans ? String(referans).substring(0, 40) : null);
    rq.input('OdemeSekli', sql.NVarChar(20), String(odemeSekli || 'Nakit').substring(0, 20));
    rq.input('SepetToplam', sql.Decimal(18, 2), sepetToplam);
    rq.input('TahsilatTutar', sql.Decimal(18, 2), tahsilatTutar);
    rq.input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50));
    const ins = await rq.query(`
      INSERT INTO HizliSatisKayitlari
        (LogID, MusteriID, Referans, OdemeSekli, SepetToplam, TahsilatTutar, Kullanici)
      OUTPUT INSERTED.KayitID
      VALUES (@LogID, @MusteriID, @Referans, @OdemeSekli, @SepetToplam, @TahsilatTutar, @Kullanici)
    `);
    const kayitID = ins.recordset[0]?.KayitID;
    if (!kayitID) return null;
    for (const s of satirlar) {
      const birim =
        s.birimFiyat != null && Number.isFinite(s.birimFiyat)
          ? s.birimFiyat
          : s.miktar > 0
            ? Math.round((s.satirTutar / s.miktar) * 100) / 100
            : 0;
      await pool.request()
        .input('KayitID', sql.Int, kayitID)
        .input('StokID', sql.Int, s.stokID || null)
        .input('UrunAdi', sql.NVarChar(150), String(s.urunAdi || '').substring(0, 150))
        .input('Miktar', sql.Int, s.miktar)
        .input('BirimFiyat', sql.Decimal(18, 2), birim)
        .input('SatirTutar', sql.Decimal(18, 2), s.satirTutar)
        .query(`
          INSERT INTO HizliSatisKayitDetaylari
            (KayitID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
          VALUES (@KayitID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
        `);
    }
    return kayitID;
  } catch (err) {
    console.error('Hızlı satış kaydı yazılamadı:', err.message);
    return null;
  }
}

async function kullaniciSifreDogrula(pool, kullaniciAdi, sifre) {
  const ka = String(kullaniciAdi || '').trim();
  if (!ka || !sifre) return { ok: false, message: 'Kullanıcı adı ve şifre gerekli.' };
  const result = await pool.request()
    .input('KullaniciAdi', sql.NVarChar(50), ka)
    .query('SELECT TOP 1 KullaniciID, Sifre FROM Kullanicilar WHERE KullaniciAdi = @KullaniciAdi');
  if (!result.recordset.length) return { ok: false, message: 'Hatalı şifre.' };
  const row = result.recordset[0];
  const dogru = await sifreDogrulaVeGerekirseYukselt(pool, row.KullaniciID, row.Sifre, sifre);
  if (!dogru) return { ok: false, message: 'Hatalı şifre.' };
  return { ok: true };
}

// ==========================================
// --- KASA VE HIZLI SATIŞ API ---
// ==========================================

async function kasayaIsle(tip, tutar, aciklama, kullanici) {
  try {
    const pool = await poolPromise;
    await pool.request()
      .input('Tip', sql.NVarChar(20), tip)
      .input('Tutar', sql.Decimal(18, 2), tutar)
      .input('Aciklama', sql.NVarChar(255), aciklama)
      .input('Kullanici', sql.NVarChar(50), kullanici)
      .query('INSERT INTO Kasa (IslemTipi, Tutar, Aciklama, Kullanici) VALUES (@Tip, @Tutar, @Aciklama, @Kullanici)');
  } catch (err) {
    console.error('Kasa Kayıt Hatası:', err);
  }
}

async function kasayaIsleTxn(transaction, tip, tutar, aciklama, kullanici) {
  const rq = new sql.Request(transaction);
  rq.input('Tip', sql.NVarChar(20), tip);
  rq.input('Tutar', sql.Decimal(18, 2), tutar);
  rq.input('Aciklama', sql.NVarChar(255), aciklama);
  rq.input('Kullanici', sql.NVarChar(50), kullanici || 'Sistem');
  await rq.query(`
    INSERT INTO Kasa (IslemTipi, Tutar, Aciklama, Kullanici)
    VALUES (@Tip, @Tutar, @Aciklama, @Kullanici)
  `);
}

/** Hızlı satışta müşteri seçildiyse cari hareket + ürün detayı yazar */
async function hizliSatisMusteriCariKaydet(transaction, opts) {
  const {
    musteriID,
    satirlar,
    genelToplam,
    tahsilatTutar,
    odemeRaw,
    kullanici,
    makbuzNo,
    mobilKaynak,
  } = opts;
  const veresiye = odemeRaw === 'Veresiye';
  let tahsilat = veresiye ? 0 : genelToplam;
  if (!veresiye && tahsilatTutar != null && tahsilatTutar !== '') {
    tahsilat = Math.round(Number(tahsilatTutar) * 100) / 100;
    if (!Number.isFinite(tahsilat) || tahsilat < 0) tahsilat = 0;
    if (tahsilat > genelToplam) tahsilat = genelToplam;
  }
  const cariSatisTutar = genelToplam;

  const mRs = await new sql.Request(transaction)
    .input('MID', sql.Int, musteriID)
    .query('SELECT MusteriID, AdSoyad, Bakiye FROM Musteriler WHERE MusteriID = @MID');
  if (!mRs.recordset.length) return { ok: false, message: 'Müşteri bulunamadı.' };
  const musteri = mRs.recordset[0];

  const cSatis = await new sql.Request(transaction)
    .input('MusteriID', sql.Int, musteriID)
    .input('Tutar', sql.Decimal(18, 2), cariSatisTutar)
    .query('UPDATE Musteriler SET Bakiye = Bakiye + @Tutar WHERE MusteriID = @MusteriID');
  if (cSatis.rowsAffected[0] === 0) return { ok: false, message: 'Müşteri bulunamadı.' };

  const urunOzetleri = satirlar.map((s) => {
    const birim = s.miktar > 0 ? Math.round((s.satirTutar / s.miktar) * 100) / 100 : 0;
    return `${s.row.UrunAdi} x${s.miktar} @${birim.toFixed(2)}`;
  });
  const satirOzet = urunOzetleri.join(', ');
  const satisRef = (
    mobilKaynak ? `mobil:hizli-satis:${musteriID}:${Date.now()}` : `hizli-satis:${musteriID}:${Date.now()}`
  ).substring(0, 40);
  const aciklamaEtiket = veresiye ? 'Hızlı satış (veresiye)' : `Hızlı satış [${odemeRaw}]`;
  const satisAciklama = hareketAciklamaMobilIsaretle(
    mobilKaynak,
    `${aciklamaEtiket} — ${satirOzet}`,
  );

  const rqHar = new sql.Request(transaction);
  rqHar.input('MusteriID', sql.Int, musteriID);
  rqHar.input('Tur', sql.NVarChar(20), 'Satis');
  const satisKalan = veresiye ? genelToplam : Math.round((genelToplam - tahsilat) * 100) / 100;
  rqHar.input('ToplamTutar', sql.Decimal(18, 2), cariSatisTutar);
  /* Tahsilat ayrı «odeme» satırında; satış satırında OdenenTutar=0 (müşteri sepet ile aynı). */
  rqHar.input('OdenenTutar', sql.Decimal(18, 2), 0);
  rqHar.input('KalanTutar', sql.Decimal(18, 2), satisKalan);
  rqHar.input('OdemeSekli', sql.NVarChar(20), null);
  rqHar.input('Aciklama', sql.NVarChar(500), satisAciklama);
  rqHar.input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50));
  rqHar.input('Referans', sql.NVarChar(40), satisRef);
  const harIns = await rqHar.query(`
    INSERT INTO MusteriHareketleri
      (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans)
    OUTPUT INSERTED.HareketID
    VALUES
      (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @Kullanici, @Referans)
  `);
  const hareketID = harIns.recordset[0]?.HareketID;

  if (hareketID) {
    for (const s of satirlar) {
      const birimFiyat = s.miktar > 0 ? Math.round((s.satirTutar / s.miktar) * 100) / 100 : 0;
      await new sql.Request(transaction)
        .input('HareketID', sql.Int, hareketID)
        .input('StokID', sql.Int, s.stokID)
        .input('UrunAdi', sql.NVarChar(150), String(s.row.UrunAdi || '').substring(0, 150))
        .input('Miktar', sql.Int, s.miktar)
        .input('BirimFiyat', sql.Decimal(18, 2), birimFiyat)
        .input('SatirTutar', sql.Decimal(18, 2), s.satirTutar)
        .query(`
          INSERT INTO MusteriHareketDetaylari
            (HareketID, StokID, UrunAdi, Miktar, BirimFiyat, SatirTutar)
          VALUES
            (@HareketID, @StokID, @UrunAdi, @Miktar, @BirimFiyat, @SatirTutar)
        `);
    }
  }

  if (!veresiye && tahsilat > 0) {
    const cTah = await new sql.Request(transaction)
      .input('MusteriID', sql.Int, musteriID)
      .input('Tutar', sql.Decimal(18, 2), tahsilat)
      .query(`
        UPDATE Musteriler
        SET Bakiye = Bakiye - @Tutar
        WHERE MusteriID = @MusteriID AND Bakiye >= @Tutar
      `);
    if (cTah.rowsAffected[0] === 0) {
      return { ok: false, message: 'Tahsilat için bakiye güncellenemedi.' };
    }

    const bakiyeRs = await new sql.Request(transaction)
      .input('MID', sql.Int, musteriID)
      .query('SELECT Bakiye FROM Musteriler WHERE MusteriID = @MID');
    const finalBakiye = Math.round(Number(bakiyeRs.recordset[0]?.Bakiye || 0) * 100) / 100;

    const rqTahHar = new sql.Request(transaction);
    rqTahHar.input('MusteriID', sql.Int, musteriID);
    rqTahHar.input('Tur', sql.NVarChar(20), 'Odeme');
    rqTahHar.input('ToplamTutar', sql.Decimal(18, 2), 0);
    rqTahHar.input('OdenenTutar', sql.Decimal(18, 2), tahsilat);
    rqTahHar.input('KalanTutar', sql.Decimal(18, 2), 0);
    rqTahHar.input('OdemeSekli', sql.NVarChar(20), odemeRaw);
    rqTahHar.input('MakbuzKalanBakiye', sql.Decimal(18, 2), finalBakiye);
    rqTahHar.input('MakbuzNo', sql.Int, makbuzNo || null);
    rqTahHar.input(
      'Aciklama',
      sql.NVarChar(500),
      hareketAciklamaMobilIsaretle(mobilKaynak, `Hızlı satış tahsilatı — ${satirOzet}`),
    );
    rqTahHar.input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50));
    rqTahHar.input('Referans', sql.NVarChar(40), satisRef);
    await rqTahHar.query(`
      INSERT INTO MusteriHareketleri
        (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, MakbuzKalanBakiye, MakbuzNo, Kullanici, Referans)
      VALUES
        (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @MakbuzKalanBakiye, @MakbuzNo, @Kullanici, @Referans)
    `);
    return {
      ok: true,
      hareketID,
      referans: satisRef,
      musteriAd: musteri.AdSoyad,
      finalBakiye,
      tahsilat,
    };
  }

  return { ok: true, hareketID, referans: satisRef, musteriAd: musteri.AdSoyad, finalBakiye: null, tahsilat: 0 };
}

// ==========================================
// --- TEDARİKÇİ ---
// ==========================================

app.get('/api/tedarikci', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Tedarikciler ORDER BY TedarikciID DESC');
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Tedarikçiler listelenemedi.' });
  }
});

app.get('/api/tedarikci/rapor', async (req, res) => {
  try {
    const baslangic = sqlTarihGunDegeri(req.query.baslangic);
    const bitis = sqlTarihGunDegeri(req.query.bitis);
    if ((req.query.baslangic || req.query.bitis) && (!baslangic || !bitis)) {
      return res.status(400).json({ message: 'Geçersiz tarih aralığı.' });
    }
    if (baslangic && bitis && baslangic > bitis) {
      return res.status(400).json({ message: 'Başlangıç tarihi bitişten sonra olamaz.' });
    }

    const pool = await poolPromise;
    const ilkRs = await pool.request().query(`
      SELECT CONVERT(varchar(10), MIN(d), 23) AS IlkTarih
      FROM (
        SELECT CAST(MIN(Tarih) AS DATE) AS d FROM TedarikAlim
        UNION ALL
        SELECT CAST(MIN(Tarih) AS DATE) AS d FROM TedarikciOdeme
      ) t
      WHERE d IS NOT NULL
    `);
    const ilkTarih = ilkRs.recordset[0]?.IlkTarih || null;

    const reqR = pool.request();
    let alimFiltre = '';
    let odemeFiltre = '';
    if (baslangic && bitis) {
      reqR.input('Baslangic', sql.Date, baslangic);
      reqR.input('Bitis', sql.Date, bitis);
      alimFiltre = ' AND CAST(a.Tarih AS DATE) >= @Baslangic AND CAST(a.Tarih AS DATE) <= @Bitis';
      odemeFiltre = ' AND CAST(o.Tarih AS DATE) >= @Baslangic AND CAST(o.Tarih AS DATE) <= @Bitis';
    }

    const listeRs = await reqR.query(`
      SELECT
        t.TedarikciID,
        t.Unvan,
        t.YetkiliAdi,
        t.Telefon,
        ISNULL(t.Bakiye, 0) AS Bakiye,
        ISNULL(a.ToplamAlis, 0) AS ToplamAlis,
        ISNULL(o.ToplamOdeme, 0) AS ToplamOdeme
      FROM Tedarikciler t
      LEFT JOIN (
        SELECT a.TedarikciID, SUM(ISNULL(a.ToplamTutar, 0)) AS ToplamAlis
        FROM TedarikAlim a
        WHERE 1=1${alimFiltre}
        GROUP BY a.TedarikciID
      ) a ON a.TedarikciID = t.TedarikciID
      LEFT JOIN (
        SELECT o.TedarikciID, SUM(ISNULL(o.Tutar, 0)) AS ToplamOdeme
        FROM TedarikciOdeme o
        WHERE 1=1${odemeFiltre}
        GROUP BY o.TedarikciID
      ) o ON o.TedarikciID = t.TedarikciID
      ORDER BY t.Unvan ASC, t.TedarikciID ASC
    `);

    const liste = (listeRs.recordset || []).map((r) => ({
      TedarikciID: r.TedarikciID,
      Unvan: r.Unvan,
      YetkiliAdi: r.YetkiliAdi,
      Telefon: r.Telefon,
      Bakiye: Number(r.Bakiye || 0),
      ToplamAlis: Number(r.ToplamAlis || 0),
      ToplamOdeme: Number(r.ToplamOdeme || 0),
    }));

    const ozet = liste.reduce(
      (acc, r) => {
        acc.toplamAlis += r.ToplamAlis;
        acc.toplamOdeme += r.ToplamOdeme;
        acc.toplamBakiye += r.Bakiye;
        return acc;
      },
      { toplamAlis: 0, toplamOdeme: 0, toplamBakiye: 0 },
    );
    ozet.toplamAlis = Math.round(ozet.toplamAlis * 100) / 100;
    ozet.toplamOdeme = Math.round(ozet.toplamOdeme * 100) / 100;
    ozet.toplamBakiye = Math.round(ozet.toplamBakiye * 100) / 100;

    res.json({
      liste,
      ozet,
      baslangic: baslangic || null,
      bitis: bitis || null,
      ilkTarih,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Tedarikçi raporu alınamadı.' });
  }
});

app.post('/api/tedarikci', async (req, res) => {
  try {
    const { Unvan, YetkiliAdi, Telefon, Adres, VergiNo, kullanici } = req.body;
    if (!Unvan || !String(Unvan).trim()) {
      return res.status(400).json({ success: false, message: 'Firma ünvanı zorunludur.' });
    }
    const pool = await poolPromise;
    await pool.request()
      .input('Unvan', sql.NVarChar(200), String(Unvan).trim())
      .input('YetkiliAdi', sql.NVarChar(100), YetkiliAdi || null)
      .input('Telefon', sql.NVarChar(30), Telefon || null)
      .input('Adres', sql.NVarChar(500), Adres || null)
      .input('VergiNo', sql.NVarChar(20), VergiNo || null)
      .query(`
        INSERT INTO Tedarikciler (Unvan, YetkiliAdi, Telefon, Adres, VergiNo)
        VALUES (@Unvan, @YetkiliAdi, @Telefon, @Adres, @VergiNo)
      `);
    await islemKaydet(kullanici || 'Sistem', 'Tedarikçi Ekle', `Ünvan: ${Unvan}`);
    res.status(201).json({ success: true, message: 'Tedarikçi kaydedildi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Tedarikçi eklenemedi.' });
  }
});

app.delete('/api/tedarikci/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz kayıt.' });
    }
    const pool = await poolPromise;
    const bak = await pool.request()
      .input('ID', sql.Int, id)
      .query('SELECT Bakiye, Unvan FROM Tedarikciler WHERE TedarikciID = @ID');
    if (bak.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Tedarikçi bulunamadı.' });
    }
    const row = bak.recordset[0];
    if (Number(row.Bakiye) !== 0) {
      return res.status(400).json({
        success: false,
        message: 'Cari bakiyesi sıfır olmayan tedarikçi silinemez.',
      });
    }
    const alim = await pool.request()
      .input('ID', sql.Int, id)
      .query('SELECT COUNT(*) AS N FROM TedarikAlim WHERE TedarikciID = @ID');
    const ode = await pool.request()
      .input('ID', sql.Int, id)
      .query('SELECT COUNT(*) AS N FROM TedarikciOdeme WHERE TedarikciID = @ID');
    if (alim.recordset[0].N > 0 || ode.recordset[0].N > 0) {
      return res.status(400).json({
        success: false,
        message: 'Alım veya ödeme kaydı olan tedarikçi silinemez.',
      });
    }
    await pool.request().input('ID', sql.Int, id).query('DELETE FROM Tedarikciler WHERE TedarikciID = @ID');
    const { kullanici } = req.query;
    await islemKaydet(kullanici || 'Sistem', 'Tedarikçi Sil', `${row.Unvan} (#${id})`);
    res.json({ success: true, message: 'Silindi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Silinemedi.' });
  }
});

app.get('/api/tedarikci/:id/hareketler', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ message: 'Geçersiz id.' });
    }
    const pool = await poolPromise;
    const info = await pool.request()
      .input('ID', sql.Int, id)
      .query('SELECT * FROM Tedarikciler WHERE TedarikciID = @ID');
    if (info.recordset.length === 0) {
      return res.status(404).json({ message: 'Bulunamadı.' });
    }
    const alimlar = await pool.request()
      .input('ID', sql.Int, id)
      .query(`
        SELECT a.AlimID AS KayitID, a.Tarih, a.ToplamTutar AS Tutar, a.OdemeSekli, a.StogaAktar, a.Aciklama, a.Kullanici,
               ISNULL(da.UrunDetay, N'') AS UrunDetay,
               N'alim' AS Tur
        FROM TedarikAlim a
        OUTER APPLY (
          SELECT STRING_AGG(CONCAT(LTRIM(RTRIM(s.UrunAdi)), N' x', s.Miktar), N', ') AS UrunDetay
          FROM TedarikAlimSatir s
          WHERE s.AlimID = a.AlimID
        ) da
        WHERE a.TedarikciID = @ID
      `);
    const satirRs = await pool.request()
      .input('ID', sql.Int, id)
      .query(`
        SELECT s.AlimID, s.SatirID, s.UrunAdi, s.Miktar, s.AlisBirimFiyat AS BirimFiyat, s.SatirTutar
        FROM TedarikAlimSatir s
        INNER JOIN TedarikAlim a ON a.AlimID = s.AlimID
        WHERE a.TedarikciID = @ID
        ORDER BY s.AlimID ASC, s.SatirID ASC
      `);
    const satirByAlim = new Map();
    for (const s of satirRs.recordset || []) {
      const aid = Number(s.AlimID);
      if (!satirByAlim.has(aid)) satirByAlim.set(aid, []);
      satirByAlim.get(aid).push({
        SatirID: Number(s.SatirID || 0),
        UrunAdi: s.UrunAdi,
        Miktar: Number(s.Miktar || 0),
        BirimFiyat: Number(s.BirimFiyat || 0),
        SatirTutar: Number(s.SatirTutar || 0),
      });
    }
    const odemeler = await pool.request()
      .input('ID', sql.Int, id)
      .query(`
        SELECT OdemeID AS KayitID, Tarih, Tutar, OdemeSekli, Aciklama, Kullanici, N'' AS UrunDetay,
               N'odeme' AS Tur
        FROM TedarikciOdeme WHERE TedarikciID = @ID
      `);
    const birlesik = [...alimlar.recordset, ...odemeler.recordset].sort((a, b) => {
      const t = new Date(b.Tarih) - new Date(a.Tarih);
      if (t !== 0) return t;
      const aw = String(a.Tur || '').toLowerCase() === 'odeme' ? 0 : 1;
      const bw = String(b.Tur || '').toLowerCase() === 'odeme' ? 0 : 1;
      if (aw !== bw) return aw - bw; // aynı anda ise ödeme üstte
      return Number(b.KayitID || 0) - Number(a.KayitID || 0);
    });
    for (const h of birlesik) {
      if (String(h.Tur || '').toLowerCase() === 'alim') {
        h.satirlar = satirByAlim.get(Number(h.KayitID)) || [];
      }
    }
    res.json({ tedarikci: info.recordset[0], hareketler: birlesik });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Hareketler alınamadı.' });
  }
});

async function tedarikciAlimBagliOdemeToplamTxn(transaction, tedarikciID, alimID) {
  const rs = await new sql.Request(transaction)
    .input('TedarikciID', sql.Int, tedarikciID)
    .input('Bagli', sql.NVarChar(80), `Mal alım ödemesi (Alım #${alimID})%`)
    .query(`
      SELECT SUM(Tutar) AS Toplam
      FROM TedarikciOdeme
      WHERE TedarikciID = @TedarikciID AND Aciklama LIKE @Bagli
    `);
  return Math.round(Number(rs.recordset[0]?.Toplam || 0) * 100) / 100;
}

async function tedarikciAlimDuzenleTxn(transaction, tedarikciID, alimID, kalemler, kullanici) {
  const alimRs = await new sql.Request(transaction)
    .input('TedarikciID', sql.Int, tedarikciID)
    .input('AlimID', sql.Int, alimID)
    .query(`
      SELECT AlimID, TedarikciID, ToplamTutar, StogaAktar
      FROM TedarikAlim
      WHERE TedarikciID = @TedarikciID AND AlimID = @AlimID
    `);
  if (!alimRs.recordset.length) {
    return { success: false, status: 404, message: 'Alım kaydı bulunamadı.' };
  }
  const alim = alimRs.recordset[0];
  const stogaAktar = Number(alim.StogaAktar || 0) === 1;
  const oldToplam = Math.round(Number(alim.ToplamTutar || 0) * 100) / 100;
  if (!Array.isArray(kalemler) || !kalemler.length) {
    return { success: false, status: 400, message: 'Düzenlenecek kalem bulunamadı.' };
  }

  const detRs = await new sql.Request(transaction)
    .input('AlimID', sql.Int, alimID)
    .query(`
      SELECT SatirID, StokID, UrunAdi, Miktar, SatirTutar
      FROM TedarikAlimSatir
      WHERE AlimID = @AlimID
      ORDER BY SatirID ASC
    `);
  const detaylar = detRs.recordset || [];
  if (!detaylar.length) {
    return { success: false, status: 400, message: 'Alım satır detayı bulunamadı.' };
  }

  const kalemMap = new Map();
  for (const k of kalemler) {
    const satirID = parseInt(k.satirID, 10);
    if (!Number.isInteger(satirID) || satirID < 1) continue;
    kalemMap.set(satirID, k);
  }
  if (!kalemMap.size) {
    return { success: false, status: 400, message: 'Geçerli kalem seçilmedi.' };
  }

  let newToplam = 0;
  for (const d of detaylar) {
    const satirID = Number(d.SatirID);
    const k = kalemMap.get(satirID);
    if (!k) {
      newToplam += Number(d.SatirTutar || 0);
      continue;
    }
    const oldMiktar = Number(d.Miktar || 0);
    const newMiktar = Math.round(Number(k.miktar));
    const newSatirTutar = Math.round(Number(k.satirTutar) * 100) / 100;
    if (!Number.isInteger(newMiktar) || newMiktar < 1) {
      return { success: false, status: 400, message: 'Adet en az 1 olmalıdır.' };
    }
    if (!Number.isFinite(newSatirTutar) || newSatirTutar <= 0) {
      return { success: false, status: 400, message: 'Geçerli satır tutarı girin.' };
    }
    const deltaMiktar = newMiktar - oldMiktar;
    if (stogaAktar && deltaMiktar !== 0 && d.StokID) {
      const stokID = Number(d.StokID);
      if (Number.isInteger(stokID) && stokID > 0) {
        const stokVar = await new sql.Request(transaction)
          .input('StokID', sql.Int, stokID)
          .query('SELECT StokID FROM Stok WHERE StokID = @StokID');
        if (stokVar.recordset.length) {
          if (deltaMiktar > 0) {
            await new sql.Request(transaction)
              .input('StokID', sql.Int, stokID)
              .input('Miktar', sql.Int, deltaMiktar)
              .query('UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar WHERE StokID = @StokID');
          } else {
            await stokSatisDusurTxn(transaction, stokID, -deltaMiktar);
          }
        }
      }
    }
    const birimFiyat = Math.round((newSatirTutar / newMiktar) * 100) / 100;
    await new sql.Request(transaction)
      .input('SatirID', sql.Int, satirID)
      .input('Miktar', sql.Int, newMiktar)
      .input('AlisBirimFiyat', sql.Decimal(18, 2), birimFiyat)
      .input('SatirTutar', sql.Decimal(18, 2), newSatirTutar)
      .query(`
        UPDATE TedarikAlimSatir
        SET Miktar = @Miktar, AlisBirimFiyat = @AlisBirimFiyat, SatirTutar = @SatirTutar
        WHERE SatirID = @SatirID
      `);
    newToplam += newSatirTutar;
  }
  newToplam = Math.round(newToplam * 100) / 100;
  const odemeToplam = await tedarikciAlimBagliOdemeToplamTxn(transaction, tedarikciID, alimID);
  if (odemeToplam > newToplam + 0.009) {
    return {
      success: false,
      status: 409,
      message: `Alım tutarı bağlı ödemelerden (${odemeToplam.toFixed(2)} ₺) küçük olamaz.`,
    };
  }
  const delta = Math.round((newToplam - oldToplam) * 100) / 100;
  if (Math.abs(delta) > 0.009) {
    await new sql.Request(transaction)
      .input('TedarikciID', sql.Int, tedarikciID)
      .input('Delta', sql.Decimal(18, 2), delta)
      .query('UPDATE Tedarikciler SET Bakiye = Bakiye + @Delta WHERE TedarikciID = @TedarikciID');
  }
  await new sql.Request(transaction)
    .input('AlimID', sql.Int, alimID)
    .input('ToplamTutar', sql.Decimal(18, 2), newToplam)
    .query('UPDATE TedarikAlim SET ToplamTutar = @ToplamTutar WHERE AlimID = @AlimID');
  return { success: true, message: 'Mal alım güncellendi.', yeniToplam: newToplam };
}

async function tedarikciOdemeDuzenleTxn(transaction, tedarikciID, odemeID, tutar, odemeSekli, kullanici) {
  const odemeRs = await new sql.Request(transaction)
    .input('TedarikciID', sql.Int, tedarikciID)
    .input('OdemeID', sql.Int, odemeID)
    .query(`
      SELECT OdemeID, TedarikciID, Tutar, OdemeSekli, Aciklama
      FROM TedarikciOdeme
      WHERE TedarikciID = @TedarikciID AND OdemeID = @OdemeID
    `);
  if (!odemeRs.recordset.length) {
    return { success: false, status: 404, message: 'Ödeme kaydı bulunamadı.' };
  }
  const odeme = odemeRs.recordset[0];
  const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
  const odemeRaw = String(odemeSekli || odeme.OdemeSekli || 'Nakit').trim();
  if (!odemeIzinli.includes(odemeRaw)) {
    return { success: false, status: 400, message: 'Geçersiz ödeme şekli.' };
  }
  const oldTutar = Math.round(Number(odeme.Tutar || 0) * 100) / 100;
  const newTutar = Math.round(Number(tutar) * 100) / 100;
  if (!Number.isFinite(newTutar) || newTutar <= 0) {
    return { success: false, status: 400, message: 'Geçerli tutar girin.' };
  }

  const m = String(odeme.Aciklama || '').match(/Alım\s*#(\d+)/i);
  if (m) {
    const alimID = Number(m[1]);
    const alimRs = await new sql.Request(transaction)
      .input('AlimID', sql.Int, alimID)
      .query('SELECT ToplamTutar FROM TedarikAlim WHERE AlimID = @AlimID');
    if (alimRs.recordset.length) {
      const alimToplam = Number(alimRs.recordset[0].ToplamTutar || 0);
      if (newTutar > alimToplam + 0.009) {
        return {
          success: false,
          status: 400,
          message: `Ödeme alım toplamını (${alimToplam.toFixed(2)} ₺) geçemez.`,
        };
      }
    }
  }

  const delta = Math.round((newTutar - oldTutar) * 100) / 100;
  if (delta > 0.009) {
    const bakRs = await new sql.Request(transaction)
      .input('TedarikciID', sql.Int, tedarikciID)
      .input('Delta', sql.Decimal(18, 2), delta)
      .query(`
        UPDATE Tedarikciler
        SET Bakiye = Bakiye - @Delta
        WHERE TedarikciID = @TedarikciID AND Bakiye >= @Delta
      `);
    if (bakRs.rowsAffected[0] === 0) {
      return { success: false, status: 409, message: 'Ödeme artırılamadı (bakiye yetersiz).' };
    }
  } else if (delta < -0.009) {
    await new sql.Request(transaction)
      .input('TedarikciID', sql.Int, tedarikciID)
      .input('Delta', sql.Decimal(18, 2), -delta)
      .query('UPDATE Tedarikciler SET Bakiye = Bakiye + @Delta WHERE TedarikciID = @TedarikciID');
  }

  if (Math.abs(delta) > 0.009) {
    const tedRs = await new sql.Request(transaction)
      .input('TedarikciID', sql.Int, tedarikciID)
      .query('SELECT Unvan FROM Tedarikciler WHERE TedarikciID = @TedarikciID');
    const unvan = tedRs.recordset[0]?.Unvan || 'Tedarikçi';
    let kasaAciklama = `Tedarik ödeme düzenleme — ${unvan} [${odemeRaw}] [#${odemeID}]`;
    if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
    if (delta > 0) {
      await kasayaIsleTxn(transaction, 'Cikis', delta, kasaAciklama, kullanici || 'Sistem');
    } else {
      await kasayaIsleTxn(transaction, 'Giris', -delta, kasaAciklama, kullanici || 'Sistem');
    }
  }

  await new sql.Request(transaction)
    .input('OdemeID', sql.Int, odemeID)
    .input('Tutar', sql.Decimal(18, 2), newTutar)
    .input('OdemeSekli', sql.NVarChar(20), odemeRaw)
    .query(`
      UPDATE TedarikciOdeme
      SET Tutar = @Tutar, OdemeSekli = @OdemeSekli
      WHERE OdemeID = @OdemeID
    `);
  return { success: true, message: 'Ödeme güncellendi.', yeniTutar: newTutar, odemeSekli: odemeRaw };
}

app.get('/api/tedarikci/:tedarikciID/hareket/:tur/:kayitID/detay', async (req, res) => {
  try {
    const tedarikciID = parseInt(req.params.tedarikciID, 10);
    const kayitID = parseInt(req.params.kayitID, 10);
    const tur = String(req.params.tur || '').toLowerCase();
    if (!Number.isInteger(tedarikciID) || tedarikciID < 1 || !Number.isInteger(kayitID) || kayitID < 1) {
      return res.status(400).json({ message: 'Geçersiz kayıt.' });
    }
    if (!['alim', 'odeme'].includes(tur)) {
      return res.status(400).json({ message: 'Geçersiz hareket türü.' });
    }
    const pool = await poolPromise;
    if (tur === 'alim') {
      const alimRs = await pool.request()
        .input('TedarikciID', sql.Int, tedarikciID)
        .input('AlimID', sql.Int, kayitID)
        .query(`
          SELECT AlimID AS KayitID, TedarikciID, Tarih, ToplamTutar AS Tutar, OdemeSekli, StogaAktar, Aciklama, Kullanici,
                 N'alim' AS Tur
          FROM TedarikAlim
          WHERE TedarikciID = @TedarikciID AND AlimID = @AlimID
        `);
      if (!alimRs.recordset.length) {
        return res.status(404).json({ message: 'Alım bulunamadı.' });
      }
      const detayRs = await pool.request()
        .input('AlimID', sql.Int, kayitID)
        .query(`
          SELECT SatirID, AlimID, StokID, UrunAdi, Miktar, AlisBirimFiyat AS BirimFiyat, SatirTutar
          FROM TedarikAlimSatir
          WHERE AlimID = @AlimID
          ORDER BY SatirID ASC
        `);
      return res.json({ hareket: alimRs.recordset[0], detaylar: detayRs.recordset || [] });
    }
    const odemeRs = await pool.request()
      .input('TedarikciID', sql.Int, tedarikciID)
      .input('OdemeID', sql.Int, kayitID)
      .query(`
        SELECT OdemeID AS KayitID, TedarikciID, Tarih, Tutar, OdemeSekli, Aciklama, Kullanici, N'odeme' AS Tur
        FROM TedarikciOdeme
        WHERE TedarikciID = @TedarikciID AND OdemeID = @OdemeID
      `);
    if (!odemeRs.recordset.length) {
      return res.status(404).json({ message: 'Ödeme bulunamadı.' });
    }
    res.json({ hareket: odemeRs.recordset[0], detaylar: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Hareket detayı alınamadı.' });
  }
});

app.patch('/api/tedarikci/:tedarikciID/hareket/:tur/:kayitID/duzenle', async (req, res) => {
  try {
    const tedarikciID = parseInt(req.params.tedarikciID, 10);
    const kayitID = parseInt(req.params.kayitID, 10);
    const tur = String(req.params.tur || '').toLowerCase();
    const { kalemler, tutar, odemeSekli, kullanici } = req.body || {};
    const kul = (kullanici || 'Sistem').toString().substring(0, 50);
    if (!Number.isInteger(tedarikciID) || tedarikciID < 1 || !Number.isInteger(kayitID) || kayitID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz kayıt.' });
    }
    if (!['alim', 'odeme'].includes(tur)) {
      return res.status(400).json({ success: false, message: 'Geçersiz düzenleme türü.' });
    }
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      let sonuc;
      if (tur === 'alim') {
        sonuc = await tedarikciAlimDuzenleTxn(transaction, tedarikciID, kayitID, kalemler, kul);
      } else {
        sonuc = await tedarikciOdemeDuzenleTxn(transaction, tedarikciID, kayitID, tutar, odemeSekli, kul);
      }
      if (!sonuc.success) {
        await transaction.rollback();
        return res.status(sonuc.status || 400).json({ success: false, message: sonuc.message });
      }
      await transaction.commit();
      await islemKaydet(kul, tur === 'alim' ? 'Tedarik Mal Alım Düzenleme' : 'Tedarik Ödeme Düzenleme', `${tur} #${kayitID} düzenlendi`);
      res.json({ success: true, message: sonuc.message });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Hareket düzenlenemedi.' });
  }
});

app.delete('/api/tedarikci/:id/hareket/:tur/:kayitID', async (req, res) => {
  try {
    const tedarikciID = parseInt(req.params.id, 10);
    const kayitID = parseInt(req.params.kayitID, 10);
    const tur = String(req.params.tur || '').toLowerCase();
    const kullanici = String(req.query.kullanici || 'Sistem').substring(0, 50);
    if (!Number.isInteger(tedarikciID) || tedarikciID < 1 || !Number.isInteger(kayitID) || kayitID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz kayıt.' });
    }
    if (!['alim', 'odeme'].includes(tur)) {
      return res.status(400).json({ success: false, message: 'Geçersiz hareket türü.' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      if (tur === 'alim') {
        const alimRs = await new sql.Request(transaction)
          .input('TedarikciID', sql.Int, tedarikciID)
          .input('KayitID', sql.Int, kayitID)
          .query(`
            SELECT AlimID, ToplamTutar, OdemeSekli, StogaAktar
            FROM TedarikAlim
            WHERE TedarikciID = @TedarikciID AND AlimID = @KayitID
          `);
        if (!alimRs.recordset.length) {
          await transaction.rollback();
          return res.status(404).json({ success: false, message: 'Alım kaydı bulunamadı.' });
        }
        const alim = alimRs.recordset[0];
        const toplam = Number(alim.ToplamTutar || 0);
        const bagliOdemelerRs = await new sql.Request(transaction)
          .input('TedarikciID', sql.Int, tedarikciID)
          .input('Bagli', sql.NVarChar(80), `Mal alım ödemesi (Alım #${kayitID})%`)
          .query(`
            SELECT OdemeID, Tutar
            FROM TedarikciOdeme
            WHERE TedarikciID = @TedarikciID AND Aciklama LIKE @Bagli
          `);
        const bagliOdemeler = bagliOdemelerRs.recordset || [];
        const bagliOdemeToplam = bagliOdemeler.reduce((a, r) => a + Number(r.Tutar || 0), 0);
        const cariGeriAl = Math.max(0, Math.round((toplam - bagliOdemeToplam) * 100) / 100);
        const satirlar = await new sql.Request(transaction)
          .input('AlimID', sql.Int, kayitID)
          .query('SELECT StokID, Miktar FROM TedarikAlimSatir WHERE AlimID = @AlimID');

        if (Number(alim.StogaAktar || 0) === 1) {
          for (const s of satirlar.recordset || []) {
            const stokID = Number(s.StokID);
            const miktar = Number(s.Miktar || 0);
            if (!Number.isInteger(stokID) || stokID < 1 || miktar <= 0) continue;
            const stokVar = await new sql.Request(transaction)
              .input('StokID', sql.Int, stokID)
              .query('SELECT StokID FROM Stok WHERE StokID = @StokID');
            if (!stokVar.recordset.length) continue;
            await new sql.Request(transaction)
              .input('StokID', sql.Int, stokID)
              .input('Miktar', sql.Int, miktar)
              .query(`
                UPDATE Stok
                SET MevcutMiktar = MevcutMiktar - @Miktar
                WHERE StokID = @StokID
              `);
          }
        }

        if (String(alim.OdemeSekli || '').toLowerCase() === 'veresiye') {
          if (cariGeriAl > 0.009) {
            await new sql.Request(transaction)
              .input('TedarikciID', sql.Int, tedarikciID)
              .input('Tutar', sql.Decimal(18, 2), cariGeriAl)
              .query('UPDATE Tedarikciler SET Bakiye = Bakiye - @Tutar WHERE TedarikciID = @TedarikciID');
          }
        } else {
          await kasayaIsleTxn(transaction, 'Giris', toplam, `Tedarik mal alım iptal #${kayitID}`, kullanici);
        }

        for (const o of bagliOdemeler) {
          const odemeID = Number(o.OdemeID || 0);
          const tutar = Number(o.Tutar || 0);
          if (odemeID > 0 && tutar > 0) {
            await kasayaIsleTxn(transaction, 'Giris', tutar, `Tedarik ödeme iptal #${odemeID}`, kullanici);
            await new sql.Request(transaction)
              .input('KayitID', sql.Int, odemeID)
              .query('DELETE FROM TedarikciOdeme WHERE OdemeID = @KayitID');
          }
        }

        await new sql.Request(transaction)
          .input('KayitID', sql.Int, kayitID)
          .query('DELETE FROM TedarikAlim WHERE AlimID = @KayitID');
      } else {
        const odemeRs = await new sql.Request(transaction)
          .input('TedarikciID', sql.Int, tedarikciID)
          .input('KayitID', sql.Int, kayitID)
          .query(`
            SELECT OdemeID, Tutar, OdemeSekli
            FROM TedarikciOdeme
            WHERE TedarikciID = @TedarikciID AND OdemeID = @KayitID
          `);
        if (!odemeRs.recordset.length) {
          await transaction.rollback();
          return res.status(404).json({ success: false, message: 'Ödeme kaydı bulunamadı.' });
        }
        const odeme = odemeRs.recordset[0];
        const tutar = Number(odeme.Tutar || 0);
        await new sql.Request(transaction)
          .input('TedarikciID', sql.Int, tedarikciID)
          .input('Tutar', sql.Decimal(18, 2), tutar)
          .query('UPDATE Tedarikciler SET Bakiye = Bakiye + @Tutar WHERE TedarikciID = @TedarikciID');
        await kasayaIsleTxn(transaction, 'Giris', tutar, `Tedarik ödeme iptal #${kayitID}`, kullanici);
        await new sql.Request(transaction)
          .input('KayitID', sql.Int, kayitID)
          .query('DELETE FROM TedarikciOdeme WHERE OdemeID = @KayitID');
      }

      await transaction.commit();
      await islemKaydet(kullanici, 'Tedarikçi Hareket Sil', `${tur} #${kayitID} silindi`);
      res.json({ success: true, message: 'Hareket silindi.' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Hareket silinemedi.' });
  }
});

app.post('/api/tedarikci/alim', async (req, res) => {
  try {
    const { tedarikciID, kalemler, odemeVarMi, odenenTutar, odemeSekli, stogaAktar, kullanici, aciklama } = req.body;
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
    const tid = parseInt(tedarikciID, 10);

    if (!Number.isInteger(tid) || tid < 1) {
      return res.status(400).json({ success: false, message: 'Tedarikçi seçin.' });
    }
    const odemeVar = !!odemeVarMi;
    if (odemeVar && !odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }
    if (!Array.isArray(kalemler) || kalemler.length === 0) {
      return res.status(400).json({ success: false, message: 'En az bir kalem ekleyin.' });
    }
    if (kalemler.length > 80) {
      return res.status(400).json({ success: false, message: 'Çok fazla satır.' });
    }

    const stokEkle = stogaAktar !== false;

    const pool = await poolPromise;
    const ted = await pool.request()
      .input('ID', sql.Int, tid)
      .query('SELECT TedarikciID, Unvan FROM Tedarikciler WHERE TedarikciID = @ID');
    if (ted.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Tedarikçi bulunamadı.' });
    }
    const tedUnvan = ted.recordset[0].Unvan;

    const satirlar = [];
    let genelToplam = 0;
    for (const k of kalemler) {
      const miktar = parseInt(k.miktar, 10);
      const alis = Number(k.alisFiyati);
      const satis = Number(k.satisFiyati);
      const urunAdi = String(k.urunAdi || '').trim();
      if (!urunAdi || !Number.isInteger(miktar) || miktar < 1 || !Number.isFinite(alis) || alis < 0 || !Number.isFinite(satis) || satis < 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz kalem bilgisi.' });
      }
      const satirTutar = Math.round(miktar * alis * 100) / 100;
      genelToplam += satirTutar;
      let stokID = k.stokID != null ? parseInt(k.stokID, 10) : null;
      const yeniUrun = !!k.yeniUrun || !Number.isInteger(stokID) || stokID < 1;
      if (!yeniUrun && Number.isInteger(stokID) && stokID > 0) {
        const kontrol = await pool.request()
          .input('SID', sql.Int, stokID)
          .query('SELECT StokID FROM Stok WHERE StokID = @SID');
        if (kontrol.recordset.length === 0) stokID = null;
      }
      satirlar.push({
        stokID: yeniUrun ? null : stokID,
        urunAdi,
        miktar,
        birim: String(k.birim || 'Adet').trim() || 'Adet',
        alisFiyati: alis,
        satisFiyati: satis,
        satirTutar,
        yeniUrun: yeniUrun || !stokID,
      });
    }
    genelToplam = Math.round(genelToplam * 100) / 100;
    let odenen = odemeVar ? Number(odenenTutar || 0) : 0;
    if (!Number.isFinite(odenen) || odenen < 0) odenen = 0;
    odenen = Math.round(odenen * 100) / 100;
    if (odenen > genelToplam) {
      return res.status(400).json({ success: false, message: 'Ödeme tutarı alım toplamını geçemez.' });
    }
    const kalan = Math.round((genelToplam - odenen) * 100) / 100;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let alimID = null;

    try {
      const rqAlim = new sql.Request(transaction);
      rqAlim.input('TedarikciID', sql.Int, tid);
      rqAlim.input('ToplamTutar', sql.Decimal(18, 2), genelToplam);
      rqAlim.input('OdemeSekli', sql.NVarChar(20), 'Veresiye');
      rqAlim.input('StogaAktar', sql.Bit, stokEkle ? 1 : 0);
      rqAlim.input('Kullanici', sql.NVarChar(50), kullanici || 'Sistem');
      rqAlim.input('Aciklama', sql.NVarChar(500), aciklama ? String(aciklama).substring(0, 500) : null);
      const insAlim = await rqAlim.query(`
        INSERT INTO TedarikAlim (TedarikciID, ToplamTutar, OdemeSekli, StogaAktar, Kullanici, Aciklama)
        OUTPUT INSERTED.AlimID
        VALUES (@TedarikciID, @ToplamTutar, @OdemeSekli, @StogaAktar, @Kullanici, @Aciklama)
      `);
      alimID = insAlim.recordset[0].AlimID;

      for (const s of satirlar) {
        let kayitStokID = s.stokID;
        if (stokEkle) {
          if (s.yeniUrun || !kayitStokID) {
            const rqSt = new sql.Request(transaction);
            rqSt.input('UrunAdi', sql.NVarChar(150), s.urunAdi);
            rqSt.input('AlisFiyati', sql.Decimal(18, 2), s.alisFiyati);
            rqSt.input('SatisFiyati', sql.Decimal(18, 2), s.satisFiyati);
            rqSt.input('Miktar', sql.Int, s.miktar);
            rqSt.input('Birim', sql.NVarChar(20), s.birim);
            const insSt = await rqSt.query(`
              INSERT INTO Stok (UrunAdi, Kategori, Barkod, AlisFiyati, SatisFiyati, MevcutMiktar, Birim)
              OUTPUT INSERTED.StokID
              VALUES (@UrunAdi, N'Tedarik', NULL, @AlisFiyati, @SatisFiyati, @Miktar, @Birim)
            `);
            kayitStokID = insSt.recordset[0].StokID;
          } else {
            const rqUp = new sql.Request(transaction);
            rqUp.input('SID', sql.Int, kayitStokID);
            rqUp.input('Miktar', sql.Int, s.miktar);
            rqUp.input('AlisFiyati', sql.Decimal(18, 2), s.alisFiyati);
            rqUp.input('SatisFiyati', sql.Decimal(18, 2), s.satisFiyati);
            const upd = await rqUp.query(`
              UPDATE Stok SET MevcutMiktar = MevcutMiktar + @Miktar,
                AlisFiyati = @AlisFiyati, SatisFiyati = @SatisFiyati
              WHERE StokID = @SID
            `);
            if (upd.rowsAffected[0] === 0) {
              await transaction.rollback();
              return res.status(409).json({ success: false, message: 'Stok güncellenemedi.' });
            }
          }
        }

        const rqSat = new sql.Request(transaction);
        rqSat.input('AlimID', sql.Int, alimID);
        rqSat.input('StokID', sql.Int, kayitStokID || null);
        rqSat.input('UrunAdi', sql.NVarChar(150), s.urunAdi);
        rqSat.input('Miktar', sql.Int, s.miktar);
        rqSat.input('Birim', sql.NVarChar(20), s.birim);
        rqSat.input('AlisBirimFiyat', sql.Decimal(18, 2), s.alisFiyati);
        rqSat.input('SatisFiyati', sql.Decimal(18, 2), s.satisFiyati);
        rqSat.input('SatirTutar', sql.Decimal(18, 2), s.satirTutar);
        rqSat.input('YeniUrun', sql.Bit, s.yeniUrun ? 1 : 0);
        await rqSat.query(`
          INSERT INTO TedarikAlimSatir (AlimID, StokID, UrunAdi, Miktar, Birim, AlisBirimFiyat, SatisFiyati, SatirTutar, YeniUrun)
          VALUES (@AlimID, @StokID, @UrunAdi, @Miktar, @Birim, @AlisBirimFiyat, @SatisFiyati, @SatirTutar, @YeniUrun)
        `);
      }

      const rqB = new sql.Request(transaction);
      rqB.input('Tutar', sql.Decimal(18, 2), genelToplam);
      rqB.input('ID', sql.Int, tid);
      await rqB.query(`UPDATE Tedarikciler SET Bakiye = Bakiye + @Tutar WHERE TedarikciID = @ID`);

      if (odenen > 0) {
        await new sql.Request(transaction)
          .input('TedarikciID', sql.Int, tid)
          .input('Tutar', sql.Decimal(18, 2), odenen)
          .input('OdemeSekli', sql.NVarChar(20), odemeRaw)
          .input('Kullanici', sql.NVarChar(50), kullanici || 'Sistem')
          .input('Aciklama', sql.NVarChar(255), `Mal alım ödemesi (Alım #${alimID})`)
          .query(`
            INSERT INTO TedarikciOdeme (TedarikciID, Tutar, OdemeSekli, Kullanici, Aciklama)
            VALUES (@TedarikciID, @Tutar, @OdemeSekli, @Kullanici, @Aciklama)
          `);
        await new sql.Request(transaction)
          .input('Tutar', sql.Decimal(18, 2), odenen)
          .input('ID', sql.Int, tid)
          .query(`UPDATE Tedarikciler SET Bakiye = Bakiye - @Tutar WHERE TedarikciID = @ID AND Bakiye >= @Tutar`);

        let kasaAciklama = `Mal alım ödeme — ${tedUnvan} [${odemeRaw}]`;
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';
        await kasayaIsleTxn(transaction, 'Cikis', odenen, kasaAciklama, kullanici || 'Sistem');
      }

      await transaction.commit();
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw innerErr;
    }

    const urunOzet = satirlar
      .map((s) => `${String(s.urunAdi || 'Ürün').trim()}×${s.miktar}`)
      .join(', ');
    let logOz = `Mal alım ${tedUnvan} (Alım #${alimID}): ${genelToplam}₺, ödeme ${odenen}₺${odenen > 0 ? ` [${odemeRaw}]` : ''}, kalan ${kalan}₺${stokEkle ? ', stok güncellendi' : ', stok işlenmedi'}`;
    if (urunOzet) logOz += ` — ${urunOzet}`;
    await islemKaydet(kullanici || 'Sistem', 'Tedarik Mal Alım', logOz.substring(0, 500));

    res.json({ success: true, message: 'Mal alım kaydedildi.', toplam: genelToplam, odeme: odenen, kalan });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Mal alım sırasında hata oluştu.' });
  }
});

app.post('/api/tedarikci/odeme', async (req, res) => {
  try {
    const { tedarikciID, tutar, odemeSekli, kullanici, aciklama } = req.body;
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
    const tid = parseInt(tedarikciID, 10);
    const t = Number(tutar);

    if (!Number.isInteger(tid) || tid < 1) {
      return res.status(400).json({ success: false, message: 'Tedarikçi seçin.' });
    }
    if (!Number.isFinite(t) || t <= 0) {
      return res.status(400).json({ success: false, message: 'Geçersiz tutar.' });
    }
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const pool = await poolPromise;
    const ted = await pool.request()
      .input('ID', sql.Int, tid)
      .query('SELECT TedarikciID, Unvan, Bakiye FROM Tedarikciler WHERE TedarikciID = @ID');
    if (ted.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Tedarikçi bulunamadı.' });
    }
    const row = ted.recordset[0];
    const odemeTutar = Math.round(t * 100) / 100;

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const rqO = new sql.Request(transaction);
      rqO.input('TedarikciID', sql.Int, tid);
      rqO.input('Tutar', sql.Decimal(18, 2), odemeTutar);
      rqO.input('OdemeSekli', sql.NVarChar(20), odemeRaw);
      rqO.input('Kullanici', sql.NVarChar(50), kullanici || 'Sistem');
      rqO.input('Aciklama', sql.NVarChar(255), aciklama ? String(aciklama).substring(0, 255) : null);
      await rqO.query(`
        INSERT INTO TedarikciOdeme (TedarikciID, Tutar, OdemeSekli, Kullanici, Aciklama)
        VALUES (@TedarikciID, @Tutar, @OdemeSekli, @Kullanici, @Aciklama)
      `);

      const rqB = new sql.Request(transaction);
      rqB.input('Tutar', sql.Decimal(18, 2), odemeTutar);
      rqB.input('ID', sql.Int, tid);
      await rqB.query(`UPDATE Tedarikciler SET Bakiye = Bakiye - @Tutar WHERE TedarikciID = @ID`);

      let kasaAciklama = `Tedarikçi ödeme — ${row.Unvan} [${odemeRaw}]`;
      if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';
      await kasayaIsleTxn(transaction, 'Cikis', odemeTutar, kasaAciklama, kullanici || 'Sistem');

      await transaction.commit();
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw innerErr;
    }

    await islemKaydet(
      kullanici || 'Sistem',
      'Tedarikçi Ödeme',
      `${row.Unvan}: ${odemeTutar}₺ (${odemeRaw})`
    );

    res.json({ success: true, message: 'Ödeme kaydedildi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Ödeme sırasında hata oluştu.' });
  }
});

app.get('/api/genel-gider', async (req, res) => {
  try {
    const bas = String(req.query.baslangic || '').trim().substring(0, 10);
    const bit = String(req.query.bitis || '').trim().substring(0, 10);
    const pool = await poolPromise;
    const ymdOk = /^\d{4}-\d{2}-\d{2}$/;
    if (bas && bit && ymdOk.test(bas) && ymdOk.test(bit) && bas <= bit) {
      const r = await pool
        .request()
        .input('bas', sql.NVarChar(10), bas)
        .input('bit', sql.NVarChar(10), bit)
        .query(`
          SELECT GiderID, Tutar, OdemeSekli, Kategori, Aciklama, Tarih, Kullanici
          FROM GenelGider
          WHERE CAST(Tarih AS DATE) >= CAST(@bas AS DATE)
            AND CAST(Tarih AS DATE) <= CAST(@bit AS DATE)
          ORDER BY Tarih DESC
        `);
      return res.json(r.recordset || []);
    }
    const r = await pool.request().query(`
      SELECT TOP 500 GiderID, Tutar, OdemeSekli, Kategori, Aciklama, Tarih, Kullanici
      FROM GenelGider
      ORDER BY Tarih DESC
    `);
    res.json(r.recordset || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Genel giderler listelenemedi.' });
  }
});

app.post('/api/genel-gider', async (req, res) => {
  try {
    const { tutar, odemeSekli, kategori, aciklama, kullanici } = req.body;
    const odemeRaw = (odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
    const t = Number(tutar);
    if (!Number.isFinite(t) || t <= 0) {
      return res.status(400).json({ success: false, message: 'Geçerli tutar girin.' });
    }
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const rqIns = new sql.Request(transaction);
      rqIns.input('Tutar', sql.Decimal(18, 2), t);
      rqIns.input('OdemeSekli', sql.NVarChar(20), odemeRaw);
      rqIns.input('Kategori', sql.NVarChar(80), (kategori || '').trim().substring(0, 80) || null);
      rqIns.input('Aciklama', sql.NVarChar(500), (aciklama || '').trim().substring(0, 500) || null);
      rqIns.input('Kullanici', sql.NVarChar(50), (kullanici || 'Sistem').substring(0, 50));
      const insResult = await rqIns.query(`
        INSERT INTO GenelGider (Tutar, OdemeSekli, Kategori, Aciklama, Kullanici)
        OUTPUT INSERTED.GiderID
        VALUES (@Tutar, @OdemeSekli, @Kategori, @Aciklama, @Kullanici)
      `);
      const gid = insResult.recordset[0]?.GiderID;

      const katEtiket = ((kategori || '').trim() || 'Genel gider').substring(0, 60);
      let kasaAciklama = `Genel gider — ${katEtiket} [${odemeRaw}]`;
      if ((aciklama || '').trim()) {
        kasaAciklama += ` — ${String(aciklama).trim().substring(0, 120)}`;
      }
      if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';

      await kasayaIsleTxn(transaction, 'Cikis', t, kasaAciklama, kullanici || 'Sistem');

      await transaction.commit();

      const logTxtParts = [`${katEtiket}: ${t}₺ [${odemeRaw}]`];
      if ((aciklama || '').trim()) logTxtParts.push(String(aciklama).trim().substring(0, 200));
      let logOz = logTxtParts.join(' — ');
      if (logOz.length > 500) logOz = logOz.substring(0, 497) + '…';

      await islemKaydet(kullanici || 'Sistem', 'Genel Gider', logOz);

      res.json({ success: true, message: 'Genel gider kaydedildi.', giderID: gid });
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Genel gider kaydedilirken hata oluştu.' });
  }
});

app.get('/api/genel-gider/:id', async (req, res) => {
  try {
    const giderID = parseInt(req.params.id, 10);
    if (!Number.isInteger(giderID) || giderID < 1) {
      return res.status(400).json({ message: 'Geçersiz kayıt.' });
    }
    const pool = await poolPromise;
    const r = await pool.request()
      .input('GiderID', sql.Int, giderID)
      .query(`
        SELECT GiderID, Tutar, OdemeSekli, Kategori, Aciklama, Tarih, Kullanici
        FROM GenelGider
        WHERE GiderID = @GiderID
      `);
    if (!r.recordset.length) {
      return res.status(404).json({ message: 'Gider bulunamadı.' });
    }
    res.json(r.recordset[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gider alınamadı.' });
  }
});

app.patch('/api/genel-gider/:id', async (req, res) => {
  try {
    const giderID = parseInt(req.params.id, 10);
    const { tutar, odemeSekli, kategori, aciklama, kullanici } = req.body || {};
    const kul = (kullanici || 'Sistem').toString().substring(0, 50);
    if (!Number.isInteger(giderID) || giderID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz kayıt.' });
    }
    const odemeRaw = String(odemeSekli || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Havale', 'Kart'];
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }
    const newTutar = Math.round(Number(tutar) * 100) / 100;
    if (!Number.isFinite(newTutar) || newTutar <= 0) {
      return res.status(400).json({ success: false, message: 'Geçerli tutar girin.' });
    }
    const kat = String(kategori || '').trim().substring(0, 80) || null;
    const acik = String(aciklama || '').trim().substring(0, 500) || null;

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const gRs = await new sql.Request(transaction)
        .input('GiderID', sql.Int, giderID)
        .query(`
          SELECT GiderID, Tutar, OdemeSekli, Kategori, Aciklama
          FROM GenelGider
          WHERE GiderID = @GiderID
        `);
      if (!gRs.recordset.length) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'Gider bulunamadı.' });
      }
      const g = gRs.recordset[0];
      const oldTutar = Math.round(Number(g.Tutar || 0) * 100) / 100;
      const delta = Math.round((newTutar - oldTutar) * 100) / 100;

      await new sql.Request(transaction)
        .input('GiderID', sql.Int, giderID)
        .input('Tutar', sql.Decimal(18, 2), newTutar)
        .input('OdemeSekli', sql.NVarChar(20), odemeRaw)
        .input('Kategori', sql.NVarChar(80), kat)
        .input('Aciklama', sql.NVarChar(500), acik)
        .query(`
          UPDATE GenelGider
          SET Tutar = @Tutar, OdemeSekli = @OdemeSekli, Kategori = @Kategori, Aciklama = @Aciklama
          WHERE GiderID = @GiderID
        `);

      if (Math.abs(delta) > 0.009) {
        const katEtiket = (kat || g.Kategori || 'Genel gider').substring(0, 60);
        let kasaAciklama = `Genel gider düzenleme — ${katEtiket} [#${giderID}]`;
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
        if (delta > 0) {
          await kasayaIsleTxn(transaction, 'Cikis', delta, kasaAciklama, kul);
        } else {
          await kasayaIsleTxn(transaction, 'Giris', -delta, kasaAciklama, kul);
        }
      }

      await transaction.commit();
      await islemKaydet(kul, 'Genel Gider Düzenleme', `Gider #${giderID} güncellendi`);
      res.json({ success: true, message: 'Gider güncellendi.' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gider güncellenemedi.' });
  }
});

app.delete('/api/genel-gider/:id', async (req, res) => {
  try {
    const giderID = parseInt(req.params.id, 10);
    const kullanici = String(req.query.kullanici || 'Sistem').substring(0, 50);
    if (!Number.isInteger(giderID) || giderID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz kayıt.' });
    }
    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const gRs = await new sql.Request(transaction)
        .input('GiderID', sql.Int, giderID)
        .query(`
          SELECT GiderID, Tutar, OdemeSekli, Kategori, Aciklama
          FROM GenelGider
          WHERE GiderID = @GiderID
        `);
      if (!gRs.recordset.length) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'Gider bulunamadı.' });
      }
      const g = gRs.recordset[0];
      const tutar = Math.round(Number(g.Tutar || 0) * 100) / 100;
      const katEtiket = String(g.Kategori || 'Genel gider').trim().substring(0, 60) || 'Genel gider';
      const odemeRaw = String(g.OdemeSekli || 'Nakit').trim();

      await new sql.Request(transaction)
        .input('GiderID', sql.Int, giderID)
        .query('DELETE FROM GenelGider WHERE GiderID = @GiderID');

      if (tutar > 0.009) {
        let kasaAciklama = `Genel gider iptal — ${katEtiket} [${odemeRaw}] [#${giderID}]`;
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '...';
        await kasayaIsleTxn(transaction, 'Giris', tutar, kasaAciklama, kullanici);
      }

      await transaction.commit();
      await islemKaydet(kullanici, 'Genel Gider Sil', `${katEtiket}: ${tutar}₺ silindi`);
      res.json({
        success: true,
        message: tutar > 0.009
          ? `Gider silindi. ${tutar.toFixed(2)} ₺ kasaya iade edildi.`
          : 'Gider silindi.',
      });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gider silinemedi.' });
  }
});

app.get('/api/teklif', async (req, res) => {
  try {
    const musteriID = parseInt(req.query.musteriID, 10);
    const bas = String(req.query.baslangic || '').trim().substring(0, 10);
    const bit = String(req.query.bitis || '').trim().substring(0, 10);
    const ymdOk = /^\d{4}-\d{2}-\d{2}$/;
    const pool = await poolPromise;
    const rq = pool.request();
    let where = 'WHERE 1=1';
    if (Number.isInteger(musteriID) && musteriID > 0) {
      rq.input('MusteriID', sql.Int, musteriID);
      where += ' AND t.MusteriID = @MusteriID';
    }
    if (ymdOk.test(bas) && ymdOk.test(bit) && bas <= bit) {
      rq.input('Bas', sql.NVarChar(10), bas);
      rq.input('Bit', sql.NVarChar(10), bit);
      where += ' AND CAST(t.Tarih AS DATE) >= CAST(@Bas AS DATE) AND CAST(t.Tarih AS DATE) <= CAST(@Bit AS DATE)';
    }
    const rs = await rq.query(`
      SELECT TOP 500 t.TeklifID, t.MusteriID, t.MusteriAdi, t.Baslik, t.Yontem, t.ToplamTutar, t.Aciklama, t.Durum, t.CariHareketID, t.Kullanici, t.Tarih,
             ISNULL(k.KalemAdedi, 0) AS KalemAdedi,
             m.tur, m.tcno, m.vergino
      FROM Teklifler t
      LEFT JOIN Musteriler m ON m.MusteriID = t.MusteriID
      OUTER APPLY (SELECT COUNT(*) AS KalemAdedi FROM TeklifKalemler kk WHERE kk.TeklifID = t.TeklifID) k
      ${where}
      ORDER BY t.Tarih DESC, t.TeklifID DESC
    `);
    res.json(rs.recordset || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Teklif listesi alınamadı.' });
  }
});

app.get('/api/teklif/:id', async (req, res) => {
  try {
    const teklifID = parseInt(req.params.id, 10);
    if (!Number.isInteger(teklifID) || teklifID < 1) {
      return res.status(400).json({ message: 'Geçersiz teklif.' });
    }
    const pool = await poolPromise;
    const [tek, kal] = await Promise.all([
      pool.request().input('TeklifID', sql.Int, teklifID).query(`
        SELECT t.*, m.tur, m.tcno, m.vergino
        FROM Teklifler t
        LEFT JOIN Musteriler m ON m.MusteriID = t.MusteriID
        WHERE t.TeklifID = @TeklifID
      `),
      pool.request().input('TeklifID', sql.Int, teklifID).query('SELECT * FROM TeklifKalemler WHERE TeklifID = @TeklifID ORDER BY KalemID ASC'),
    ]);
    if (!tek.recordset.length) return res.status(404).json({ message: 'Teklif bulunamadı.' });
    res.json({ teklif: tek.recordset[0], kalemler: kal.recordset || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Teklif detayı alınamadı.' });
  }
});

app.post('/api/teklif', async (req, res) => {
  try {
    const { musteriID, musteriAdi, baslik, yontem, toplamTutar, aciklama, kalemler, kullanici } = req.body || {};
    const yRaw = String(yontem || 'Toplu').trim();
    const y = yRaw === 'Kalem' ? 'Kalem' : 'Toplu';
    const musteriIDNum = parseInt(musteriID, 10);
    const musteriAdiTxt = String(musteriAdi || '').trim().substring(0, 200) || null;
    let toplam = Number(toplamTutar || 0);
    if (!Number.isFinite(toplam) || toplam < 0) toplam = 0;
    toplam = Math.round(toplam * 100) / 100;
    const satirlar = Array.isArray(kalemler) ? kalemler : [];
    const kalemTemiz = satirlar.map((k) => {
      const urunAdi = String(k.urunAdi || '').trim();
      const miktar = Number(k.miktar || 0);
      const birim = String(k.birim || '').trim() || null;
      const birimFiyat = Number(k.birimFiyat || 0);
      const satirTutar = Math.round((Number.isFinite(miktar) && Number.isFinite(birimFiyat) ? miktar * birimFiyat : Number(k.satirTutar || 0)) * 100) / 100;
      return { urunAdi, miktar, birim, birimFiyat, satirTutar };
    }).filter((k) => k.urunAdi && Number.isFinite(k.miktar) && k.miktar > 0 && Number.isFinite(k.birimFiyat) && k.birimFiyat >= 0);

    if (!kalemTemiz.length) {
      return res.status(400).json({ success: false, message: 'Teklifte en az bir malzeme satırı girin.' });
    }
    if (y === 'Kalem') {
      toplam = Math.round(kalemTemiz.reduce((a, k) => a + Number(k.satirTutar || 0), 0) * 100) / 100;
    } else if (toplam <= 0) {
      return res.status(400).json({ success: false, message: 'Toplu teklifte toplam tutar girin.' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const ins = await new sql.Request(transaction)
        .input('MusteriID', sql.Int, Number.isInteger(musteriIDNum) && musteriIDNum > 0 ? musteriIDNum : null)
        .input('MusteriAdi', sql.NVarChar(200), musteriAdiTxt)
        .input('Baslik', sql.NVarChar(200), String(baslik || '').trim().substring(0, 200) || null)
        .input('Yontem', sql.NVarChar(20), y)
        .input('ToplamTutar', sql.Decimal(18, 2), toplam)
        .input('Aciklama', sql.NVarChar(500), String(aciklama || '').trim().substring(0, 500) || null)
        .input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50))
        .query(`
          INSERT INTO Teklifler (MusteriID, MusteriAdi, Baslik, Yontem, ToplamTutar, Aciklama, Kullanici)
          OUTPUT INSERTED.TeklifID
          VALUES (@MusteriID, @MusteriAdi, @Baslik, @Yontem, @ToplamTutar, @Aciklama, @Kullanici)
        `);
      const teklifID = ins.recordset[0]?.TeklifID;
      for (const k of kalemTemiz) {
        await new sql.Request(transaction)
          .input('TeklifID', sql.Int, teklifID)
          .input('UrunAdi', sql.NVarChar(200), k.urunAdi.substring(0, 200))
          .input('Miktar', sql.Decimal(18, 2), k.miktar)
          .input('Birim', sql.NVarChar(20), k.birim)
          .input('BirimFiyat', sql.Decimal(18, 2), k.birimFiyat)
          .input('SatirTutar', sql.Decimal(18, 2), k.satirTutar)
          .query(`
            INSERT INTO TeklifKalemler (TeklifID, UrunAdi, Miktar, Birim, BirimFiyat, SatirTutar)
            VALUES (@TeklifID, @UrunAdi, @Miktar, @Birim, @BirimFiyat, @SatirTutar)
          `);
      }
      await transaction.commit();
      await islemKaydet(kullanici || 'Sistem', 'Teklif', `Teklif #${teklifID} — ${toplam}₺`);
      res.status(201).json({ success: true, teklifID, message: 'Teklif kaydedildi.' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Teklif kaydedilemedi.' });
  }
});

app.put('/api/teklif/:id', async (req, res) => {
  try {
    const teklifID = parseInt(req.params.id, 10);
    if (!Number.isInteger(teklifID) || teklifID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz teklif.' });
    }
    const { musteriID, musteriAdi, baslik, yontem, toplamTutar, aciklama, kalemler, kullanici } = req.body || {};
    const yRaw = String(yontem || 'Toplu').trim();
    const y = yRaw === 'Kalem' ? 'Kalem' : 'Toplu';
    const musteriIDNum = parseInt(musteriID, 10);
    const musteriAdiTxt = String(musteriAdi || '').trim().substring(0, 200) || null;
    let toplam = Number(toplamTutar || 0);
    if (!Number.isFinite(toplam) || toplam < 0) toplam = 0;
    toplam = Math.round(toplam * 100) / 100;
    const satirlar = Array.isArray(kalemler) ? kalemler : [];
    const kalemTemiz = satirlar.map((k) => {
      const urunAdi = String(k.urunAdi || '').trim();
      const miktar = Number(k.miktar || 0);
      const birim = String(k.birim || '').trim() || null;
      const birimFiyat = Number(k.birimFiyat || 0);
      const satirTutar = Math.round((Number.isFinite(miktar) && Number.isFinite(birimFiyat) ? miktar * birimFiyat : Number(k.satirTutar || 0)) * 100) / 100;
      return { urunAdi, miktar, birim, birimFiyat, satirTutar };
    }).filter((k) => k.urunAdi && Number.isFinite(k.miktar) && k.miktar > 0 && Number.isFinite(k.birimFiyat) && k.birimFiyat >= 0);

    if (!kalemTemiz.length) {
      return res.status(400).json({ success: false, message: 'Teklifte en az bir malzeme satırı girin.' });
    }
    if (y === 'Kalem') {
      toplam = Math.round(kalemTemiz.reduce((a, k) => a + Number(k.satirTutar || 0), 0) * 100) / 100;
    } else if (toplam <= 0) {
      return res.status(400).json({ success: false, message: 'Toplu teklifte toplam tutar girin.' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const kontrol = await new sql.Request(transaction).input('TeklifID', sql.Int, teklifID).query('SELECT TeklifID FROM Teklifler WHERE TeklifID = @TeklifID');
      if (!kontrol.recordset.length) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'Teklif bulunamadı.' });
      }

      await new sql.Request(transaction)
        .input('TeklifID', sql.Int, teklifID)
        .input('MusteriID', sql.Int, Number.isInteger(musteriIDNum) && musteriIDNum > 0 ? musteriIDNum : null)
        .input('MusteriAdi', sql.NVarChar(200), musteriAdiTxt)
        .input('Baslik', sql.NVarChar(200), String(baslik || '').trim().substring(0, 200) || null)
        .input('Yontem', sql.NVarChar(20), y)
        .input('ToplamTutar', sql.Decimal(18, 2), toplam)
        .input('Aciklama', sql.NVarChar(500), String(aciklama || '').trim().substring(0, 500) || null)
        .query(`
          UPDATE Teklifler
          SET MusteriID = @MusteriID,
              MusteriAdi = @MusteriAdi,
              Baslik = @Baslik,
              Yontem = @Yontem,
              ToplamTutar = @ToplamTutar,
              Aciklama = @Aciklama
          WHERE TeklifID = @TeklifID
        `);

      await new sql.Request(transaction).input('TeklifID', sql.Int, teklifID).query('DELETE FROM TeklifKalemler WHERE TeklifID = @TeklifID');
      for (const k of kalemTemiz) {
        await new sql.Request(transaction)
          .input('TeklifID', sql.Int, teklifID)
          .input('UrunAdi', sql.NVarChar(200), k.urunAdi.substring(0, 200))
          .input('Miktar', sql.Decimal(18, 2), k.miktar)
          .input('Birim', sql.NVarChar(20), k.birim)
          .input('BirimFiyat', sql.Decimal(18, 2), k.birimFiyat)
          .input('SatirTutar', sql.Decimal(18, 2), k.satirTutar)
          .query(`
            INSERT INTO TeklifKalemler (TeklifID, UrunAdi, Miktar, Birim, BirimFiyat, SatirTutar)
            VALUES (@TeklifID, @UrunAdi, @Miktar, @Birim, @BirimFiyat, @SatirTutar)
          `);
      }
      await transaction.commit();
      await islemKaydet(kullanici || 'Sistem', 'Teklif Güncelle', `Teklif #${teklifID} — ${toplam}₺`);
      res.json({ success: true, teklifID, message: 'Teklif güncellendi.' });
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Teklif güncellenemedi.' });
  }
});

app.patch('/api/teklif/:id/durum', async (req, res) => {
  try {
    const teklifID = parseInt(req.params.id, 10);
    if (!Number.isInteger(teklifID) || teklifID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz teklif.' });
    }
    const durumRaw = String(req.body?.durum || '').trim();
    const izinli = ['Hazırlandı', 'Kabul', 'Reddedildi'];
    if (!izinli.includes(durumRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz durum.' });
    }
    const pool = await poolPromise;
    const mevcut = await pool.request()
      .input('TeklifID', sql.Int, teklifID)
      .query('SELECT TeklifID, Durum, CariHareketID FROM Teklifler WHERE TeklifID = @TeklifID');
    if (!mevcut.recordset.length) {
      return res.status(404).json({ success: false, message: 'Teklif bulunamadı.' });
    }
    const row = mevcut.recordset[0];
    if (row.CariHareketID) {
      return res.status(400).json({ success: false, message: 'Cariye eklenmiş teklifin durumu değiştirilemez.' });
    }
    await pool.request()
      .input('TeklifID', sql.Int, teklifID)
      .input('Durum', sql.NVarChar(30), durumRaw)
      .query('UPDATE Teklifler SET Durum = @Durum WHERE TeklifID = @TeklifID');
    const kullanici = String(req.body?.kullanici || 'Sistem').substring(0, 50);
    await islemKaydet(kullanici, 'Teklif Durum', `Teklif #${teklifID} → ${durumRaw}`);
    res.json({ success: true, durum: durumRaw, message: `Teklif durumu: ${durumRaw}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Teklif durumu güncellenemedi.' });
  }
});

app.post('/api/teklif/:id/cariye-ekle', async (req, res) => {
  try {
    const teklifID = parseInt(req.params.id, 10);
    if (!Number.isInteger(teklifID) || teklifID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz teklif.' });
    }
    const { kalemler, kullanici } = req.body || {};
    if (!Array.isArray(kalemler) || !kalemler.length) {
      return res.status(400).json({ success: false, message: 'Satış kalemi yok.' });
    }

    const pool = await poolPromise;
    const tekRs = await pool.request()
      .input('TeklifID', sql.Int, teklifID)
      .query('SELECT * FROM Teklifler WHERE TeklifID = @TeklifID');
    if (!tekRs.recordset.length) {
      return res.status(404).json({ success: false, message: 'Teklif bulunamadı.' });
    }
    const teklif = tekRs.recordset[0];
    const musteriID = parseInt(teklif.MusteriID, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) {
      return res.status(400).json({ success: false, message: 'Cariye eklemek için teklifte müşteri seçili olmalı.' });
    }
    if (teklif.CariHareketID) {
      return res.status(400).json({ success: false, message: 'Bu teklif zaten cariye eklenmiş.' });
    }
    const durum = String(teklif.Durum || '').trim();
    if (durum !== 'Kabul') {
      return res.status(400).json({ success: false, message: 'Önce teklifi “Kabul” olarak işaretleyin.' });
    }

    const stokToplamlari = new Map();
    const islenmisKalemler = [];
    for (const k of kalemler) {
      const id = parseInt(k.urunID ?? k.stokID, 10);
      const mRaw = Number(k.miktar);
      const m = Math.round(mRaw);
      const bfRaw = Number(k.birimFiyat);
      if (!Number.isInteger(id) || id < 1 || !Number.isFinite(mRaw) || m < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz satır (ürün veya adet).' });
      }
      if (Math.abs(mRaw - m) > 0.001) {
        return res.status(400).json({ success: false, message: 'Cari satışta adet tam sayı olmalı.' });
      }
      const bf = Number.isFinite(bfRaw) && bfRaw >= 0 ? Math.round(bfRaw * 100) / 100 : null;
      if (bf === null) {
        return res.status(400).json({ success: false, message: 'Geçersiz birim fiyat.' });
      }
      stokToplamlari.set(id, (stokToplamlari.get(id) || 0) + m);
      islenmisKalemler.push({ stokID: id, miktar: m, birimFiyat: bf });
    }

    const musteriRs = await pool.request()
      .input('MusteriID', sql.Int, musteriID)
      .query('SELECT MusteriID, AdSoyad, Bakiye FROM Musteriler WHERE MusteriID = @MusteriID');
    if (!musteriRs.recordset.length) {
      return res.status(404).json({ success: false, message: 'Müşteri bulunamadı.' });
    }

    const satirlar = [];
    let toplam = 0;
    const urunOzetleri = [];
    const stokCache = new Map();
    for (const [stokID, toplamMiktar] of stokToplamlari) {
      const stokRs = await pool.request()
        .input('ID', sql.Int, stokID)
        .query('SELECT StokID, UrunAdi, MevcutMiktar, SatisFiyati FROM Stok WHERE StokID = @ID');
      if (!stokRs.recordset.length) {
        return res.status(404).json({ success: false, message: `Ürün bulunamadı (ID: ${stokID}).` });
      }
      const urun = stokRs.recordset[0];
      stokCache.set(stokID, urun);
    }

    for (const k of islenmisKalemler) {
      const urun = stokCache.get(k.stokID);
      const satirToplam = Math.round(k.birimFiyat * k.miktar * 100) / 100;
      toplam += satirToplam;
      satirlar.push({ stokID: k.stokID, miktar: k.miktar, urun, satirToplam, birimFiyat: k.birimFiyat });
      urunOzetleri.push(`${urun.UrunAdi} x${k.miktar} @${k.birimFiyat.toFixed(2)}`);
    }
    toplam = Math.round(toplam * 100) / 100;

    const teklifNot = teklif.Baslik ? `Teklif #${teklifID} — ${teklif.Baslik}` : `Teklif #${teklifID}`;
    const satirOzet = urunOzetleri.join(', ');
    const aciklama = `${satirOzet} — ${teklifNot}`.substring(0, 500);

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let hareketID = null;
    try {
      for (const s of satirlar) {
        if (!(await stokSatisDusurTxn(transaction, s.stokID, s.miktar))) {
          await transaction.rollback();
          return res.status(409).json({ success: false, message: 'Stok kaydı güncellenemedi.' });
        }
      }

      const rqCariSatis = new sql.Request(transaction);
      rqCariSatis.input('MusteriID', sql.Int, musteriID);
      rqCariSatis.input('Tutar', sql.Decimal(18, 2), toplam);
      const cSatis = await rqCariSatis.query(`
        UPDATE Musteriler
        SET Bakiye = Bakiye + @Tutar
        WHERE MusteriID = @MusteriID
      `);
      if (cSatis.rowsAffected[0] === 0) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: 'Müşteri bulunamadı.' });
      }

      const satisRef = `teklif:${teklifID}`;
      const rqHar = new sql.Request(transaction);
      rqHar.input('MusteriID', sql.Int, musteriID);
      rqHar.input('Tur', sql.NVarChar(20), 'Satis');
      rqHar.input('ToplamTutar', sql.Decimal(18, 2), toplam);
      rqHar.input('OdenenTutar', sql.Decimal(18, 2), 0);
      rqHar.input('KalanTutar', sql.Decimal(18, 2), toplam);
      rqHar.input('OdemeSekli', sql.NVarChar(20), null);
      rqHar.input('Aciklama', sql.NVarChar(500), aciklama);
      rqHar.input('Kullanici', sql.NVarChar(50), String(kullanici || 'Sistem').substring(0, 50));
      rqHar.input('Referans', sql.NVarChar(40), satisRef.substring(0, 40));
      const harIns = await rqHar.query(`
        INSERT INTO MusteriHareketleri
          (MusteriID, Tur, ToplamTutar, OdenenTutar, KalanTutar, OdemeSekli, Aciklama, Kullanici, Referans)
        OUTPUT INSERTED.HareketID
        VALUES
          (@MusteriID, @Tur, @ToplamTutar, @OdenenTutar, @KalanTutar, @OdemeSekli, @Aciklama, @Kullanici, @Referans)
      `);
      hareketID = harIns.recordset[0]?.HareketID;

      await new sql.Request(transaction)
        .input('TeklifID', sql.Int, teklifID)
        .input('CariHareketID', sql.Int, hareketID)
        .query(`
          UPDATE Teklifler
          SET Durum = N'Cariye Eklendi', CariHareketID = @CariHareketID
          WHERE TeklifID = @TeklifID
        `);

      await transaction.commit();
    } catch (innerErr) {
      try { await transaction.rollback(); } catch (_) {}
      throw innerErr;
    }

    await islemKaydet(
      kullanici || 'Sistem',
      'Teklif → Cari',
      `${musteriRs.recordset[0].AdSoyad} — ${teklifNot}, toplam ${toplam}₺`
    );

    res.json({
      success: true,
      message: 'Teklif müşteri carisine satış olarak eklendi.',
      toplam,
      hareketID,
      musteriID,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Teklif cariye eklenemedi.' });
  }
});

app.delete('/api/teklif/:id', async (req, res) => {
  try {
    const teklifID = parseInt(req.params.id, 10);
    if (!Number.isInteger(teklifID) || teklifID < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz teklif.' });
    }
    const kullanici = String(req.query.kullanici || 'Sistem').substring(0, 50);
    const pool = await poolPromise;
    const rs = await pool.request().input('TeklifID', sql.Int, teklifID).query('DELETE FROM Teklifler OUTPUT DELETED.TeklifID WHERE TeklifID = @TeklifID');
    if (!rs.recordset.length) {
      return res.status(404).json({ success: false, message: 'Teklif bulunamadı.' });
    }
    await islemKaydet(kullanici, 'Teklif Sil', `Teklif #${teklifID}`);
    res.json({ success: true, message: 'Teklif silindi.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Teklif silinemedi.' });
  }
});

app.post('/api/satis-yap', async (req, res) => {
  try {
    const { urunID, miktar, kullanici, urunAdi, odemeTipi, musteriID } = req.body;
    const m = parseInt(miktar, 10);
    const odemeRaw = (odemeTipi || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Kart', 'Havale', 'Veresiye'];

    if (!urunID || !Number.isInteger(m) || m < 1) {
      return res.status(400).json({ success: false, message: 'Geçersiz ürün veya miktar.' });
    }
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const pool = await poolPromise;

    const stokRs = await pool.request()
      .input('ID', sql.Int, urunID)
      .query('SELECT StokID, UrunAdi, MevcutMiktar, SatisFiyati FROM Stok WHERE StokID = @ID');

    if (stokRs.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Ürün bulunamadı.' });
    }

    const row = stokRs.recordset[0];

    let veresiyeMusteri = null;
    if (odemeRaw === 'Veresiye') {
      veresiyeMusteri = parseInt(musteriID, 10);
      if (!Number.isInteger(veresiyeMusteri) || veresiyeMusteri < 1) {
        return res.status(400).json({ success: false, message: 'Veresiye satış için müşteri seçin.' });
      }
    }

    const birimFiyat = Number(row.SatisFiyati);
    const toplamTutar = Math.round(m * birimFiyat * 100) / 100;
    const ad = row.UrunAdi || urunAdi || 'Ürün';

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      if (!(await stokSatisDusurTxn(transaction, urunID, m))) {
        await transaction.rollback();
        return res.status(409).json({
          success: false,
          message: 'Stok kaydı güncellenemedi.',
        });
      }

      if (odemeRaw === 'Veresiye') {
        const rqCari = new sql.Request(transaction);
        rqCari.input('Tutar', sql.Decimal(18, 2), toplamTutar);
        rqCari.input('MusteriID', sql.Int, veresiyeMusteri);
        const cariSonuc = await rqCari.query(`
          UPDATE Musteriler SET Bakiye = Bakiye + @Tutar WHERE MusteriID = @MusteriID
        `);
        if (cariSonuc.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(400).json({ success: false, message: 'Müşteri bulunamadı.' });
        }
      } else {
        const kisaAciklama =
          `Satış: ${ad}`.length > 210 ? `Satış: ${ad.substring(0, 200)}… [${odemeRaw}]` : `Satış: ${ad} [${odemeRaw}]`;
        const rqKasa = new sql.Request(transaction);
        rqKasa.input('Tip', sql.NVarChar(20), 'Giris');
        rqKasa.input('Tutar', sql.Decimal(18, 2), toplamTutar);
        rqKasa.input('Aciklama', sql.NVarChar(255), kisaAciklama);
        rqKasa.input('Kullanici', sql.NVarChar(50), kullanici || 'Sistem');
        await rqKasa.query(`
          INSERT INTO Kasa (IslemTipi, Tutar, Aciklama, Kullanici) 
          VALUES (@Tip, @Tutar, @Aciklama, @Kullanici)
        `);
      }

      await transaction.commit();
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {
        /* ignore */
      }
      throw innerErr;
    }

    const odemeOzeti =
      odemeRaw === 'Veresiye'
        ? `Veresiye (Müşteri #${veresiyeMusteri})`
        : odemeRaw;
    let logHs;
    if (odemeRaw === 'Veresiye') {
      const mRs = await pool.request()
        .input('MID', sql.Int, veresiyeMusteri)
        .query('SELECT AdSoyad, FirmaAdi, yetkili, tur FROM Musteriler WHERE MusteriID = @MID');
      const mAd = mRs.recordset[0] ? musteriGorunenAdKayit(mRs.recordset[0]) : '';
      logHs = mAd
        ? `Hızlı satış ${toplamTutar}₺ veresiye — ${mAd} (Müşteri #${veresiyeMusteri})`
        : `Hızlı satış ${toplamTutar}₺ veresiye (Müşteri #${veresiyeMusteri})`;
    } else {
      logHs = `Hızlı satış ${toplamTutar}₺, tahsilat ${toplamTutar}₺ [${odemeRaw}]`;
    }
    await islemKaydet(kullanici || 'Sistem', 'Hızlı Satış', logHs);

    res.json({ success: true, message: 'Satış başarıyla tamamlandı.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Satış sırasında bir hata oluştu.' });
  }
});

/** Çok ürünlü sepet satışı — tek işlemde stok + kasa / cari */
app.post('/api/satis-sepet', async (req, res) => {
  try {
    const { kalemler, kullanici, odemeTipi, musteriID, tahsilatTutar } = req.body;
    const odemeRaw = (odemeTipi || 'Nakit').trim();
    const odemeIzinli = ['Nakit', 'Kart', 'Havale', 'Veresiye'];

    if (!Array.isArray(kalemler) || kalemler.length === 0) {
      return res.status(400).json({ success: false, message: 'Sepet boş.' });
    }
    if (kalemler.length > 100) {
      return res.status(400).json({ success: false, message: 'Çok fazla satır.' });
    }
    if (!odemeIzinli.includes(odemeRaw)) {
      return res.status(400).json({ success: false, message: 'Geçersiz ödeme şekli.' });
    }

    const birlestir = new Map();
    for (const k of kalemler) {
      const id = parseInt(k.urunID ?? k.stokID, 10);
      const m = parseInt(k.miktar, 10);
      if (!id || !Number.isInteger(m) || m < 1) {
        return res.status(400).json({ success: false, message: 'Geçersiz sepet satırı.' });
      }
      let birimFiyat = null;
      if (k.birimFiyat != null && k.birimFiyat !== '') {
        birimFiyat = Math.round(Number(k.birimFiyat) * 100) / 100;
        if (!Number.isFinite(birimFiyat) || birimFiyat < 0) {
          return res.status(400).json({ success: false, message: 'Geçersiz birim fiyat.' });
        }
      }
      const prev = birlestir.get(id);
      if (prev) {
        if (birimFiyat != null && prev.birimFiyat != null && birimFiyat !== prev.birimFiyat) {
          return res.status(400).json({ success: false, message: 'Aynı ürün için tutarsız birim fiyat.' });
        }
        prev.miktar += m;
        if (birimFiyat != null) prev.birimFiyat = birimFiyat;
      } else {
        birlestir.set(id, { miktar: m, birimFiyat });
      }
    }

    const pool = await poolPromise;

    const satirlar = [];
    let genelToplam = 0;
    const urunOzleri = [];

    for (const [stokID, entry] of birlestir) {
      const miktar = entry.miktar;
      const stokRs = await pool.request()
        .input('ID', sql.Int, stokID)
        .query('SELECT StokID, UrunAdi, MevcutMiktar, SatisFiyati FROM Stok WHERE StokID = @ID');

      if (stokRs.recordset.length === 0) {
        return res.status(404).json({ success: false, message: `Ürün bulunamadı (ID: ${stokID}).` });
      }

      const row = stokRs.recordset[0];

      const birim =
        entry.birimFiyat != null && Number.isFinite(entry.birimFiyat)
          ? entry.birimFiyat
          : Number(row.SatisFiyati);
      const satirTutar = Math.round(miktar * birim * 100) / 100;
      genelToplam += satirTutar;
      satirlar.push({ stokID, miktar, row, satirTutar });
      urunOzleri.push(`${row.UrunAdi}×${miktar}`);
    }

    genelToplam = Math.round(genelToplam * 100) / 100;

    let kasaTutar = genelToplam;
    if (tahsilatTutar != null && tahsilatTutar !== '') {
      kasaTutar = Math.round(Number(tahsilatTutar) * 100) / 100;
      if (!Number.isFinite(kasaTutar) || kasaTutar < 0) {
        return res.status(400).json({ success: false, message: 'Geçersiz tahsilat tutarı.' });
      }
    }

    const cariMusteriID = parseInt(musteriID, 10);
    const cariKayit = Number.isInteger(cariMusteriID) && cariMusteriID > 0;

    if (odemeRaw === 'Veresiye') {
      if (!cariKayit) {
        return res.status(400).json({ success: false, message: 'Veresiye satış için müşteri seçin.' });
      }
    } else if (cariKayit && kasaTutar > genelToplam) {
      return res.status(400).json({ success: false, message: 'Alınan ödeme sepet toplamını geçemez.' });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    let cariReferans = null;
    let kaydedilenMakbuzNo = null;
    let makbuzMusteriAd = null;
    let makbuzFinalBakiye = null;

    try {
      for (const s of satirlar) {
        if (!(await stokSatisDusurTxn(transaction, s.stokID, s.miktar))) {
          await transaction.rollback();
          return res.status(409).json({
            success: false,
            message: 'Stok kaydı güncellenemedi.',
          });
        }
      }

      if (odemeRaw !== 'Veresiye' && kasaTutar > 0) {
        let kasaAciklama = `Hızlı satış (${satirlar.length} kalem) [${odemeRaw}]`;
        if (req.mobilKaynak) kasaAciklama = `Mobil — ${kasaAciklama}`;
        if (cariKayit) {
          const mRs = await new sql.Request(transaction)
            .input('MID', sql.Int, cariMusteriID)
            .query('SELECT AdSoyad FROM Musteriler WHERE MusteriID = @MID');
          const mAd = mRs.recordset[0]?.AdSoyad;
          if (mAd) kasaAciklama += ` — ${mAd}`;
        }
        if (kasaAciklama.length > 255) kasaAciklama = kasaAciklama.substring(0, 252) + '…';
        const rqKasa = new sql.Request(transaction);
        rqKasa.input('Tip', sql.NVarChar(20), 'Giris');
        rqKasa.input('Tutar', sql.Decimal(18, 2), kasaTutar);
        rqKasa.input('Aciklama', sql.NVarChar(255), kasaAciklama);
        rqKasa.input('Kullanici', sql.NVarChar(50), kullanici || 'Sistem');
        await rqKasa.query(`
          INSERT INTO Kasa (IslemTipi, Tutar, Aciklama, Kullanici) 
          VALUES (@Tip, @Tutar, @Aciklama, @Kullanici)
        `);
        kaydedilenMakbuzNo = await nextMakbuzNoTxn(transaction);
      }

      if (cariKayit) {
        const cariSonuc = await hizliSatisMusteriCariKaydet(transaction, {
          musteriID: cariMusteriID,
          satirlar,
          genelToplam,
          tahsilatTutar: kasaTutar,
          odemeRaw,
          kullanici: kullanici || 'Sistem',
          makbuzNo: kaydedilenMakbuzNo,
          mobilKaynak: !!req.mobilKaynak,
        });
        if (!cariSonuc.ok) {
          await transaction.rollback();
          return res.status(400).json({ success: false, message: cariSonuc.message || 'Cari kaydı yazılamadı.' });
        }
        cariReferans = cariSonuc.referans || null;
        makbuzMusteriAd = cariSonuc.musteriAd || null;
        if (cariSonuc.finalBakiye != null) makbuzFinalBakiye = cariSonuc.finalBakiye;
      } else if (odemeRaw !== 'Veresiye' && kasaTutar > 0) {
        makbuzMusteriAd = 'Perakende satış';
      }

      await transaction.commit();
    } catch (innerErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw innerErr;
    }

    const logMusteriAd = (makbuzMusteriAd || '').trim();
    const logMusteriEk = logMusteriAd ? ` — ${logMusteriAd}` : '';
    let logAciklama;
    if (odemeRaw === 'Veresiye') {
      logAciklama = cariKayit
        ? `Hızlı satış ${genelToplam}₺ veresiye${logMusteriEk} (Müşteri #${cariMusteriID})`
        : `Hızlı satış ${genelToplam}₺ veresiye`;
    } else {
      logAciklama = cariKayit
        ? `Hızlı satış ${genelToplam}₺, tahsilat ${kasaTutar}₺ [${odemeRaw}]${logMusteriEk} (Müşteri #${cariMusteriID})`
        : `Hızlı satış ${genelToplam}₺, tahsilat ${kasaTutar}₺ [${odemeRaw}]`;
    }

    const logID = await islemKaydetDonus(
      kullanici || 'Sistem',
      'Hızlı Satış (Sepet)',
      aciklamaMobilIsaretle(req, logAciklama),
    );

    const kayitSatirlar = satirlar.map((s) => ({
      stokID: s.stokID,
      urunAdi: s.row.UrunAdi,
      miktar: s.miktar,
      birimFiyat: s.miktar > 0 ? Math.round((s.satirTutar / s.miktar) * 100) / 100 : 0,
      satirTutar: s.satirTutar,
    }));
    await hizliSatisKayitOlustur(pool, {
      logID,
      musteriID: cariKayit ? cariMusteriID : null,
      referans: cariReferans,
      odemeSekli: odemeRaw,
      sepetToplam: genelToplam,
      tahsilatTutar: odemeRaw === 'Veresiye' ? 0 : kasaTutar,
      kullanici: kullanici || 'Sistem',
      satirlar: kayitSatirlar,
    });

    res.json({
      success: true,
      message: 'Satış başarıyla tamamlandı.',
      makbuz:
        odemeRaw !== 'Veresiye' && kasaTutar > 0 && kaydedilenMakbuzNo
          ? {
              no: kaydedilenMakbuzNo,
              tur: cariKayit ? 'Satış Tahsilatı' : 'Satış Tahsilatı',
              musteri: makbuzMusteriAd || 'Perakende satış',
              odemeSekli: odemeRaw,
              tutar: kasaTutar,
              aciklama: 'Hızlı satış tahsilatı',
              kalanBakiye: makbuzFinalBakiye,
              tarih: new Date().toISOString(),
            }
          : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Satış sırasında bir hata oluştu.' });
  }
});

const PORT = process.env.PORT || 3010;
const HOST = process.env.HOST || '0.0.0.0';
const os = require('os');

function yerelAgIpv4Adresleri() {
  const list = [];
  try {
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
      for (const iface of ifs[name] || []) {
        if (iface && iface.family === 'IPv4' && !iface.internal) list.push(iface.address);
      }
    }
  } catch (_) {}
  return list;
}

const { varsayilanTarayiciAc } = require('./lib/tarayici-ac');

async function sunucuyuBaslat({ exitOnError = true, openBrowser } = {}) {
  try {
    const pool = await poolPromise;
    await ensureTedarikciTablolari(pool);
    await ensureMusteriHareketTablosu(pool);
    await ensureHizliSatisKayitTablosu(pool);
    await ensureMusteriEkAlanlari(pool);
    await ensureMusteriTaksitTablolari(pool);
    await ensureSistemAyarTablosu(pool);
    await ensureStokSeviyeAlanlari(pool);
    await ensureIscilikBedeliStokKarti(pool);
    await ensureKullaniciSifreKolonu(pool);
    await ensureTeklifTablolari(pool);
    const server = app.listen(PORT, HOST, () => {
      console.log(`Sunucu ${HOST}:${PORT} üzerinde çalışıyor.`);
      console.log(`Mobil: http://127.0.0.1:${PORT}/mobil`);
      const lan = yerelAgIpv4Adresleri();
      lan.forEach((ip) => console.log(`Mobil (LAN): http://${ip}:${PORT}/mobil`));
      const tarayiciAc = openBrowser !== undefined
        ? !!openBrowser
        : !!(process.pkg || String(process.env.OPEN_BROWSER || '').trim() === '1');
      if (tarayiciAc) {
        setTimeout(() => varsayilanTarayiciAc(PORT), 600);
      }
    });
    return server;
  } catch (err) {
    console.error('Sunucu başlatılamadı:', err.message || err);
    if (exitOnError) {
      process.exit(1);
      return null;
    }
    throw err;
  }
}

function hataSayfasiSunucusu(hata, envPath) {
  const mesaj = String(hata?.message || hata || 'Bilinmeyen hata').replace(/</g, '&lt;');
  const env = String(envPath || '').replace(/</g, '&lt;');
  const errApp = express();
  errApp.get('*', (req, res) => {
    res.status(503).type('html').send(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>Elektrik - Baglanti</title>
<style>body{font-family:Segoe UI,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.5}
code{background:#f4f4f4;padding:2px 6px;border-radius:4px}</style></head><body>
<h1>Program acildi ama veritabanina baglanamadi</h1>
<p><strong>Hata:</strong> ${mesaj}</p>
<p><strong>.env dosyasi:</strong> <code>${env}</code></p>
<p>SQL Server calisiyor mu? <code>DB_SERVER</code>, <code>DB_NAME</code>, sifre dogru mu?</p>
<p>Ornek: <code>DB_SERVER=localhost\\SQLEXPRESS</code></p>
<p>Duzeltince <code>DURDUR.bat</code> sonra <code>BASLAT.bat</code> tekrar calistirin.</p>
</body></html>`);
  });
  return errApp.listen(PORT, '0.0.0.0', () => {
    console.error('[ELEKTRIK] Yardim sayfasi http://127.0.0.1:' + PORT);
    const tarayiciAc = !!(process.pkg || String(process.env.OPEN_BROWSER || '').trim() === '1');
    if (tarayiciAc) setTimeout(() => varsayilanTarayiciAc(PORT), 600);
  });
}

if (require.main === module) {
  sunucuyuBaslat().catch((err) => {
    const { envDosyaYolu } = require('./lib/env-yukle');
    hataSayfasiSunucusu(err, envDosyaYolu());
  });
}

if (!process.versions?.electron) {
  app.get('/api/desktop-update-status', (req, res) => {
    res.json({
      success: true,
      status: 'exe',
      message: 'EXE sürümü — güncelleme için yeni exe dosyasını kurun.',
    });
  });
  app.post('/api/desktop-update-check', (req, res) => {
    res.json({ success: true, message: 'EXE sürümünde otomatik güncelleme yok.' });
  });
  app.post('/api/desktop-update-install', (req, res) => {
    res.json({ success: false, message: 'EXE sürümünde bu işlem kullanılmaz.' });
  });
}

module.exports = {
  app,
  sunucuyuBaslat,
  varsayilanTarayiciAc,
};
