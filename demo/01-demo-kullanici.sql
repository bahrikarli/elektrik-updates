-- ElektrikTrial değil: mevcut veritabanınızda (demo/.env → DB_NAME) çalıştırın.
USE elektrik;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Kullanicilar WHERE KullaniciAdi = N'demo')
BEGIN
  INSERT INTO dbo.Kullanicilar (AdSoyad, KullaniciAdi, Yetki, Sifre)
  VALUES (N'Demo Kullanıcı', N'demo', N'Admin', N'demo123');
  PRINT N'demo kullanıcısı eklendi.';
END
ELSE
  PRINT N'demo kullanıcısı zaten var.';

IF NOT EXISTS (SELECT 1 FROM dbo.Kullanicilar WHERE KullaniciAdi = N'admin')
BEGIN
  INSERT INTO dbo.Kullanicilar (AdSoyad, KullaniciAdi, Yetki, Sifre)
  VALUES (N'Yönetici', N'admin', N'Admin', N'1234');
  PRINT N'admin kullanıcısı eklendi (hızlı giriş: admin / 1234).';
END
ELSE
  PRINT N'admin kullanıcısı zaten var.';
GO
