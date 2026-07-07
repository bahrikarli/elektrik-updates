-- İşçilik bedeli stok kartı (sunucu ilk açılışta da otomatik ekler)
IF NOT EXISTS (SELECT 1 FROM Stok WHERE UrunAdi = N'İŞÇİLİK BEDELİ' OR Barkod = N'ISCILIK')
BEGIN
  INSERT INTO Stok (UrunAdi, Kategori, Barkod, AlisFiyati, SatisFiyati, MevcutMiktar, Birim, KritikEsik, HedefEsik)
  VALUES (N'İŞÇİLİK BEDELİ', N'Hizmet', N'ISCILIK', 0, 0, 999999, N'Adet', 0, 0);
END
