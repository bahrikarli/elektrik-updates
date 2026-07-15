/**
 * Tedarikçi / mal alım / tedarikçi ödemesi tabloları (ilk çalıştırmada oluşturulur).
 * Tarih alanları yerel duvar saati (SYSDATETIME / GETDATE) — SYSUTCDATETIME kullanılmaz.
 */

async function tedarikDefaultYerelYap(pool, tablo, kolon, constraintAd) {
  await pool.request().query(`
    IF EXISTS (
      SELECT 1 FROM sys.default_constraints
      WHERE name = N'${constraintAd}' AND parent_object_id = OBJECT_ID(N'dbo.${tablo}')
    )
      ALTER TABLE dbo.${tablo} DROP CONSTRAINT ${constraintAd};

    IF OBJECT_ID(N'dbo.${tablo}', N'U') IS NOT NULL
      AND COL_LENGTH(N'dbo.${tablo}', N'${kolon}') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sys.default_constraints
        WHERE name = N'${constraintAd}' AND parent_object_id = OBJECT_ID(N'dbo.${tablo}')
      )
      ALTER TABLE dbo.${tablo} ADD CONSTRAINT ${constraintAd} DEFAULT (SYSDATETIME()) FOR ${kolon};
  `);
}

async function tedarikUtcTarihleriYerelleştir(pool) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.ElektrikMeta', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ElektrikMeta (
        Anahtar NVARCHAR(64) NOT NULL PRIMARY KEY,
        Deger NVARCHAR(200) NULL
      );
    END
  `);

  const rs = await pool.request().query(`
    SELECT Deger FROM dbo.ElektrikMeta WHERE Anahtar = N'tedarik_tarih_yerel_v1'
  `);
  if (String(rs.recordset[0]?.Deger || '') === '1') return;

  // Eski default SYSUTCDATETIME idi; kayıtlar UTC — yerel saate kaydır (bir kez).
  await pool.request().query(`
    DECLARE @offsetMin INT = DATEDIFF(MINUTE, GETUTCDATE(), GETDATE());
    IF OBJECT_ID(N'dbo.TedarikAlim', N'U') IS NOT NULL
      UPDATE dbo.TedarikAlim SET Tarih = DATEADD(MINUTE, @offsetMin, Tarih);
    IF OBJECT_ID(N'dbo.TedarikciOdeme', N'U') IS NOT NULL
      UPDATE dbo.TedarikciOdeme SET Tarih = DATEADD(MINUTE, @offsetMin, Tarih);
    IF OBJECT_ID(N'dbo.GenelGider', N'U') IS NOT NULL
      UPDATE dbo.GenelGider SET Tarih = DATEADD(MINUTE, @offsetMin, Tarih);
    IF OBJECT_ID(N'dbo.Tedarikciler', N'U') IS NOT NULL
      UPDATE dbo.Tedarikciler SET KayitTarihi = DATEADD(MINUTE, @offsetMin, KayitTarihi);
  `);

  await pool.request().query(`
    MERGE dbo.ElektrikMeta AS t
    USING (SELECT N'tedarik_tarih_yerel_v1' AS Anahtar, N'1' AS Deger) AS s
    ON t.Anahtar = s.Anahtar
    WHEN MATCHED THEN UPDATE SET Deger = s.Deger
    WHEN NOT MATCHED THEN INSERT (Anahtar, Deger) VALUES (s.Anahtar, s.Deger);
  `);
  console.log('[ELEKTRIK] Tedarikçi / gider tarihleri UTC → yerel saate alındı.');
}

async function ensureTedarikciTablolari(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Tedarikciler' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.Tedarikciler (
        TedarikciID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Unvan NVARCHAR(200) NOT NULL,
        YetkiliAdi NVARCHAR(100) NULL,
        Telefon NVARCHAR(30) NULL,
        Adres NVARCHAR(500) NULL,
        VergiNo NVARCHAR(20) NULL,
        Bakiye DECIMAL(18,2) NOT NULL CONSTRAINT DF_Tedarikci_Bakiye DEFAULT (0),
        KayitTarihi DATETIME2(0) NOT NULL CONSTRAINT DF_Tedarikci_Kayit DEFAULT (SYSDATETIME())
      );
    END

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TedarikAlim' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.TedarikAlim (
        AlimID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TedarikciID INT NOT NULL,
        Tarih DATETIME2(0) NOT NULL CONSTRAINT DF_TedarikAlim_Tarih DEFAULT (SYSDATETIME()),
        ToplamTutar DECIMAL(18,2) NOT NULL,
        OdemeSekli NVARCHAR(20) NOT NULL,
        StogaAktar BIT NOT NULL CONSTRAINT DF_TedarikAlim_Stok DEFAULT (1),
        Kullanici NVARCHAR(50) NULL,
        Aciklama NVARCHAR(500) NULL,
        CONSTRAINT FK_TedarikAlim_Tedarikci FOREIGN KEY (TedarikciID) REFERENCES dbo.Tedarikciler(TedarikciID)
      );
    END

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TedarikAlimSatir' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.TedarikAlimSatir (
        SatirID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        AlimID INT NOT NULL,
        StokID INT NULL,
        UrunAdi NVARCHAR(150) NOT NULL,
        Miktar INT NOT NULL,
        Birim NVARCHAR(20) NOT NULL CONSTRAINT DF_TedSatir_Birim DEFAULT (N'Adet'),
        AlisBirimFiyat DECIMAL(18,2) NOT NULL,
        SatisFiyati DECIMAL(18,2) NOT NULL,
        SatirTutar DECIMAL(18,2) NOT NULL,
        YeniUrun BIT NOT NULL CONSTRAINT DF_TedSatir_Yeni DEFAULT (0),
        CONSTRAINT FK_TedarikAlimSatir_Alim FOREIGN KEY (AlimID) REFERENCES dbo.TedarikAlim(AlimID) ON DELETE CASCADE
      );
    END

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TedarikciOdeme' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.TedarikciOdeme (
        OdemeID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TedarikciID INT NOT NULL,
        Tarih DATETIME2(0) NOT NULL CONSTRAINT DF_TedarikciOdeme_Tarih DEFAULT (SYSDATETIME()),
        Tutar DECIMAL(18,2) NOT NULL,
        OdemeSekli NVARCHAR(20) NOT NULL,
        Kullanici NVARCHAR(50) NULL,
        Aciklama NVARCHAR(255) NULL,
        CONSTRAINT FK_TedarikciOdeme_Tedarikci FOREIGN KEY (TedarikciID) REFERENCES dbo.Tedarikciler(TedarikciID)
      );
    END

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'GenelGider' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.GenelGider (
        GiderID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        Tutar DECIMAL(18,2) NOT NULL,
        OdemeSekli NVARCHAR(20) NOT NULL,
        Kategori NVARCHAR(80) NULL,
        Aciklama NVARCHAR(500) NULL,
        Tarih DATETIME2(0) NOT NULL CONSTRAINT DF_GenelGider_Tarih DEFAULT (SYSDATETIME()),
        Kullanici NVARCHAR(50) NULL
      );
    END
  `);

  await tedarikUtcTarihleriYerelleştir(pool);
  await tedarikDefaultYerelYap(pool, 'TedarikAlim', 'Tarih', 'DF_TedarikAlim_Tarih');
  await tedarikDefaultYerelYap(pool, 'TedarikciOdeme', 'Tarih', 'DF_TedarikciOdeme_Tarih');
  await tedarikDefaultYerelYap(pool, 'GenelGider', 'Tarih', 'DF_GenelGider_Tarih');
  await tedarikDefaultYerelYap(pool, 'Tedarikciler', 'KayitTarihi', 'DF_Tedarikci_Kayit');

  console.log('[ELEKTRIK] Tedarikçi + genel gider tabloları hazır.');
}

module.exports = { ensureTedarikciTablolari };
