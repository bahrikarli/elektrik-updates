/**
 * Tedarikçi / mal alım / tedarikçi ödemesi tabloları (ilk çalıştırmada oluşturulur).
 */
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
        KayitTarihi DATETIME2(0) NOT NULL CONSTRAINT DF_Tedarikci_Kayit DEFAULT (SYSUTCDATETIME())
      );
    END

    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TedarikAlim' AND schema_id = SCHEMA_ID('dbo'))
    BEGIN
      CREATE TABLE dbo.TedarikAlim (
        AlimID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        TedarikciID INT NOT NULL,
        Tarih DATETIME2(0) NOT NULL CONSTRAINT DF_TedarikAlim_Tarih DEFAULT (SYSUTCDATETIME()),
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
        Tarih DATETIME2(0) NOT NULL CONSTRAINT DF_TedarikciOdeme_Tarih DEFAULT (SYSUTCDATETIME()),
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
        Tarih DATETIME2(0) NOT NULL CONSTRAINT DF_GenelGider_Tarih DEFAULT (SYSUTCDATETIME()),
        Kullanici NVARCHAR(50) NULL
      );
    END
  `);
  console.log('[ELEKTRIK] Tedarikçi + genel gider tabloları hazır.');
}

module.exports = { ensureTedarikciTablolari };
