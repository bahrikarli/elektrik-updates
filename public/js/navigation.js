function menuyuGoster(bolumAdi) {
  aramaSonuclariniGizle();
  if (bolumAdi === 'musteri') {
    musterileriGetir();
    modalAc(document.getElementById('musteriListeModal'));
    return;
  }
  if (bolumAdi === 'stok') {
    modalAc(document.getElementById('stokListeModal'), () => stoklariGetir());
    return;
  }
  if (bolumAdi === 'tedarikci') {
    modalAc(document.getElementById('tedarikciListeModal'), () => tedarikciListele());
    return;
  }
  if (bolumAdi === 'gider') {
    modalAc(document.getElementById('giderListeModal'), () => genelGiderListele());
    return;
  }
  document.querySelectorAll('.bolum').forEach((el) => {
    el.style.display = 'none';
  });
  const el = document.getElementById(bolumAdi + '-bolumu');
  if (el) el.style.display = 'block';
}
