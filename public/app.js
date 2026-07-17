let stokDuzenlemeID = null;
let stokListeCache = [];
let stokListeFiltreleTimer = null;
let stokListeFiltreleRaf = 0;
const STOK_LISTE_GOSTER_LIMIT = 200;

/** Piyasa referans paneli: true yap + index.html #stokPiyasaPanel d-none kaldır */
const STOK_PIYASA_PANEL_AKTIF = false;

let stokPiyasaAraTimer = null;
async function stokPiyasaFiyatAra(q) {
  if (!STOK_PIYASA_PANEL_AKTIF) return;
  const el = document.getElementById('stokPiyasaBilgi');
  if (!el) return;
  const txt = String(q || '').trim();
  if (stokPiyasaAraTimer) clearTimeout(stokPiyasaAraTimer);
  if (txt.length < 2) {
    el.innerHTML = '<span class="text-muted">En az 2 harf yazın.</span>';
    return;
  }
  stokPiyasaAraTimer = setTimeout(async () => {
    try {
      el.innerHTML = '<span class="text-muted">Referanslar aranıyor…</span>';
      const res = await fetch(`/api/stok/piyasa-fiyat?q=${encodeURIComponent(txt)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        el.innerHTML = '<span class="text-danger">Referans verisi alınamadı.</span>';
        return;
      }
      const sources = (Array.isArray(data?.refs?.sources) ? data.refs.sources : []).filter((s) => s && typeof s === 'object');
      if (!sources.length) {
        el.innerHTML = '<span class="text-muted">Canlı kaynak bulunamadı.</span>';
        return;
      }
      el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">${sources.map((src) => `
        <div class="border rounded p-2 bg-white">
          <div class="small fw-bold text-primary mb-1">${gunlukMetinEsc(src.name || 'Kaynak')}</div>
          <div class="small mb-1">Ort: <b>${Number.isFinite(Number(src?.avg)) ? paraTr(src.avg) : '-'}</b> · Min: ${Number.isFinite(Number(src?.min)) ? paraTr(src.min) : '-'} · Max: ${Number.isFinite(Number(src?.max)) ? paraTr(src.max) : '-'} ${Number.isFinite(Number(src?.count)) ? `(${src.count} fiyat)` : '(erişilemedi)'}</div>
          <div class="small" style="max-height:110px;overflow:auto;">
            ${
              Array.isArray(src?.items) && src.items.length
                ? src.items.slice(0, 8).map((it) => `<div class="mb-1">• <b>${gunlukMetinEsc(it.ad || '-')}</b>${it?.birim ? ` <span class="badge bg-info-subtle text-info-emphasis">${gunlukMetinEsc(it.birim)}</span>` : ''} — ${gunlukMetinEsc(it.ozellik || '-')} <span class="text-success">(${paraTr(it.fiyat)})</span></div>`).join('')
                : '<span class="text-muted">Ürün listesi bulunamadı.</span>'
            }
          </div>
        </div>
      `).join('')}</div>`;
    } catch (e) {
      console.error(e);
      el.innerHTML = '<span class="text-danger">Piyasa bilgisi getirilemedi.</span>';
    }
  }, 300);
}

function stokToplamUrunSayisi() {
  return (stokListeCache || []).length;
}

function stokSeviyeFiltreDegeri() {
  return document.getElementById('stokSeviyeFiltre')?.value || 'tumu';
}

function stokSeviyeFiltreEtiket(filtre) {
  if (filtre === 'tehlikeli') return 'Tehlikeli';
  if (filtre === 'orta') return 'Orta';
  if (filtre === 'yeterli') return 'Yeterli';
  return '';
}

function stokSeviyeFiltreEslesir(urun, filtre) {
  const f = filtre || 'tumu';
  if (f === 'tumu') return true;
  const durum = stokSeviyeMetinDuz(urun);
  if (f === 'tehlikeli') return durum === 'Tehlikeli' || durum === 'Eksi stok';
  if (f === 'orta') return durum === 'Orta';
  if (f === 'yeterli') return durum === 'Yeterli';
  return true;
}

function stokListeSeviyeFiltrele() {
  stokListeFiltrele(document.getElementById('stokAraInput')?.value || '');
}

function stokOzetPanelleriniGuncelle(listelenenAdet, sinirli) {
  const toplam = stokToplamUrunSayisi();
  const st = document.getElementById('kutuStok');
  if (st) st.textContent = String(toplam);
  const metin = document.getElementById('stokListeToplamMetin');
  if (!metin) return;
  const ara = String(document.getElementById('stokAraInput')?.value || '').trim();
  const seviye = stokSeviyeFiltreDegeri();
  const seviyeAd = stokSeviyeFiltreEtiket(seviye);
  const gosterilen = Number.isFinite(listelenenAdet) ? listelenenAdet : toplam;
  const n = String(toplam);
  const sinirEk = sinirli ? ` — ilk ${STOK_LISTE_GOSTER_LIMIT} gösteriliyor` : '';
  if (ara || seviye !== 'tumu') {
    const parcalar = [];
    if (seviyeAd) parcalar.push(`<strong class="text-dark">${seviyeAd}</strong> stok`);
    if (ara) parcalar.push(`"${gunlukMetinEsc(ara)}" araması`);
    const filtreMetin = parcalar.join(' + ');
    metin.innerHTML = `<strong class="text-dark">${gosterilen}</strong> ürün (${filtreMetin}, ${n} içinde)${sinirEk}`;
    return;
  }
  if (sinirli) {
    metin.innerHTML = `Toplam <strong class="text-dark">${n}</strong> ürün — ilk <strong class="text-dark">${STOK_LISTE_GOSTER_LIMIT}</strong> gösteriliyor, arama ile daraltın.`;
    return;
  }
  metin.innerHTML = `Toplam <strong class="text-dark">${n}</strong> ürün bulunmaktadır.`;
}

async function stoklariGetir() {
  try {
    const response = await fetch('/api/stok');
    const stoklar = await response.json();
    stokListeCache = Array.isArray(stoklar) ? stoklar : [];
    stokAramaIndeksiniGuncelle();
    stokListeFiltrele(document.getElementById('stokAraInput')?.value || '');
    stokOzetPanelleriniGuncelle();
  } catch (hata) {
    console.error('Stoklar çekilirken hata:', hata);
  }
}

function stokAramaMetniOlustur(urun) {
  return [
    String(urun?.UrunAdi || '').toLocaleLowerCase('tr-TR'),
    String(urun?.Kategori || '').toLocaleLowerCase('tr-TR'),
    String(urun?.Barkod || '').trim(),
  ].join(' ');
}

function stokAramaIndeksiniGuncelle() {
  for (const u of stokListeCache) {
    u.__ara = stokAramaMetniOlustur(u);
  }
}

function stokAramaIndeksiniGuncelleTek(urun) {
  if (urun) urun.__ara = stokAramaMetniOlustur(urun);
}

function stokAraEsles(urun, q) {
  const raw = String(q ?? '').trim();
  if (!raw) return true;
  const ara = raw.toLocaleLowerCase('tr-TR');
  if (urun?.__ara) return urun.__ara.includes(ara);
  return stokMetinAramaEslesir(urun, raw);
}

function stokTabloSatirHtml(urun) {
  return `<tr>
        <td class="text-muted" style="font-size:0.8rem;">${urun.Barkod || '-'}</td>
        <td class="fw-semibold">${urun.UrunAdi}</td>
        <td class="text-muted">${urun.Kategori || '-'}</td>
        <td class="text-end">${urun.AlisFiyati ? Number(urun.AlisFiyati).toFixed(2) + ' ₺' : '-'}</td>
        <td class="text-end fw-semibold text-success">${Number(urun.SatisFiyati || 0).toFixed(2)} ₺</td>
        <td class="text-center"><span class="badge bg-secondary bg-opacity-75">${urun.MevcutMiktar} ${urun.Birim}</span> ${stokSeviyeMetni(urun)}</td>
        <td class="text-end text-nowrap">
          <button type="button" class="btn btn-sm btn-light border" onclick="stokDuzenleModalAc(${urun.StokID})" title="Düzenle"><i class="fa-solid fa-pen text-primary"></i></button>
          <button type="button" class="btn btn-sm btn-light border ms-1" onclick="stokSil(${urun.StokID})" title="Sil"><i class="fa-solid fa-trash text-danger"></i></button>
        </td>
      </tr>`;
}

function stokListeFiltreleHemen(q) {
  const tb = document.getElementById('stokTabloGovdesi');
  if (!tb) return;
  const ara = String(q ?? document.getElementById('stokAraInput')?.value ?? '').trim();
  const seviye = stokSeviyeFiltreDegeri();
  let rows = stokListeCache || [];
  if (seviye !== 'tumu') rows = rows.filter((u) => stokSeviyeFiltreEslesir(u, seviye));
  if (ara) rows = rows.filter((u) => stokAraEsles(u, ara));
  const toplam = rows.length;
  const sinirli = !!ara && toplam > STOK_LISTE_GOSTER_LIMIT;
  if (sinirli) rows = rows.slice(0, STOK_LISTE_GOSTER_LIMIT);
  stokOzetPanelleriniGuncelle(toplam, sinirli);
  if (!toplam) {
    tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">Kayıt bulunamadı.</td></tr>';
    return;
  }
  tb.innerHTML = rows.map(stokTabloSatirHtml).join('');
}

function stokListeFiltrele(q) {
  if (stokListeFiltreleRaf) cancelAnimationFrame(stokListeFiltreleRaf);
  stokListeFiltreleRaf = requestAnimationFrame(() => {
    stokListeFiltreleRaf = 0;
    stokListeFiltreleHemen(q);
  });
}

function stokListeFiltreleGecikmeli(q) {
  if (stokListeFiltreleTimer) clearTimeout(stokListeFiltreleTimer);
  stokListeFiltreleTimer = setTimeout(() => stokListeFiltrele(q), 90);
}

function stokSeviyeMetni(urun) {
  const miktar = Number(urun?.MevcutMiktar || 0);
  const kritik = Number.isFinite(Number(urun?.KritikEsik)) ? Number(urun.KritikEsik) : 5;
  const hedef = Number.isFinite(Number(urun?.HedefEsik)) ? Number(urun.HedefEsik) : Math.max(kritik + 1, 20);
  if (miktar < 0) return '<span class="badge bg-dark">Eksi stok</span>';
  if (miktar < kritik) return '<span class="badge bg-danger">Tehlikeli</span>';
  if (miktar >= hedef) return '<span class="badge bg-success">Yeterli</span>';
  return '<span class="badge bg-warning text-dark">Orta</span>';
}

function stokSeviyeMetinDuz(urun) {
  const miktar = Number(urun?.MevcutMiktar || 0);
  const kritik = Number.isFinite(Number(urun?.KritikEsik)) ? Number(urun.KritikEsik) : 5;
  const hedef = Number.isFinite(Number(urun?.HedefEsik)) ? Number(urun.HedefEsik) : Math.max(kritik + 1, 20);
  if (miktar < 0) return 'Eksi stok';
  if (miktar < kritik) return 'Tehlikeli';
  if (miktar >= hedef) return 'Yeterli';
  return 'Orta';
}

function stokAlfabetikSirala(liste) {
  return [...(liste || [])].sort((a, b) =>
    String(a.UrunAdi || '').localeCompare(String(b.UrunAdi || ''), 'tr', { sensitivity: 'base' }),
  );
}

function stokAlfabetikRaporDokumaniOlustur(rows) {
  const company = {
    unvan: gunlukMetinEsc(uygulamaAyarlari?.SirketUnvan || 'ŞİRKET BİLGİSİ'),
    tel: gunlukMetinEsc(uygulamaAyarlari?.SirketTelefon || '-'),
  };
  const tarih = new Date().toLocaleString('tr-TR', { dateStyle: 'long', timeStyle: 'short' });
  let toplamAlisDeger = 0;
  let toplamSatisDeger = 0;
  const satirlar = rows
    .map((urun, i) => {
      const miktar = Number(urun.MevcutMiktar || 0);
      const alis = Number(urun.AlisFiyati || 0);
      const satis = Number(urun.SatisFiyati || 0);
      toplamAlisDeger += miktar * alis;
      toplamSatisDeger += miktar * satis;
      const kritik = Number.isFinite(Number(urun.KritikEsik)) ? Number(urun.KritikEsik) : 5;
      const hedef = Number.isFinite(Number(urun.HedefEsik)) ? Number(urun.HedefEsik) : Math.max(kritik + 1, 20);
      const durum = stokSeviyeMetinDuz(urun);
      const durumCls = durum === 'Tehlikeli' || durum === 'Eksi stok'
        ? 'risk'
        : durum === 'Yeterli'
          ? 'ok'
          : 'warn';
      return `<tr>
        <td class="c nw">${i + 1}</td>
        <td class="urun">${gunlukMetinEsc(urun.UrunAdi || '-')}</td>
        <td class="nw">${gunlukMetinEsc(urun.Barkod || '-')}</td>
        <td>${gunlukMetinEsc(urun.Kategori || '-')}</td>
        <td class="c">${gunlukMetinEsc(urun.Birim || 'Adet')}</td>
        <td class="r b">${miktar}</td>
        <td class="r">${alis ? paraTr(alis) : '-'}</td>
        <td class="r">${paraTr(satis)}</td>
        <td class="r">${paraTr(miktar * alis)}</td>
        <td class="r">${paraTr(miktar * satis)}</td>
        <td class="c ${durumCls}">${gunlukMetinEsc(durum)}</td>
        <td class="c">${kritik}</td>
        <td class="c">${hedef}</td>
      </tr>`;
    })
    .join('');
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Stok Alfabetik Rapor</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; font-size: 10px; }
    h1 { font-size: 17px; margin: 0 0 4px; }
    .firm { font-size: 10px; color: #444; margin-bottom: 8px; }
    .meta { margin-bottom: 8px; line-height: 1.45; font-size: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 4px 5px; vertical-align: top; }
    th { background: #e8f5e9; text-align: left; font-size: 9px; }
    td.r { text-align: right; white-space: nowrap; }
    td.c { text-align: center; }
    td.b { font-weight: 700; }
    td.nw { white-space: nowrap; }
    td.urun { font-weight: 600; min-width: 140px; }
    td.risk { color: #b91c1c; font-weight: 700; }
    td.warn { color: #a16207; font-weight: 600; }
    td.ok { color: #15803d; font-weight: 600; }
    .ozet { margin-top: 10px; text-align: right; line-height: 1.55; font-size: 11px; }
    .ozet b { font-size: 12px; }
  </style>
</head>
<body>
  <h1>Stok Listesi — Alfabetik Sıra</h1>
  <div class="firm">${company.unvan}${company.tel !== '-' ? ` · Tel: ${company.tel}` : ''}</div>
  <div class="meta">
    <div>Rapor tarihi: <b>${gunlukMetinEsc(tarih)}</b></div>
    <div>Toplam <b>${rows.length}</b> ürün · Sıralama: ürün adına göre (A→Z)</div>
  </div>
  <table>
    <thead>
      <tr>
        <th class="c">#</th>
        <th>Ürün adı</th>
        <th>Barkod</th>
        <th>Kategori</th>
        <th class="c">Birim</th>
        <th class="r">Miktar</th>
        <th class="r">Alış (₺)</th>
        <th class="r">Satış (₺)</th>
        <th class="r">Stok alış değeri</th>
        <th class="r">Stok satış değeri</th>
        <th class="c">Durum</th>
        <th class="c">Kritik</th>
        <th class="c">Hedef</th>
      </tr>
    </thead>
    <tbody>${satirlar || '<tr><td colspan="13" class="c">Kayıt yok.</td></tr>'}</tbody>
  </table>
  <div class="ozet">
    <div>Toplam stok alış değeri: <b>${paraTr(toplamAlisDeger)}</b></div>
    <div>Toplam stok satış değeri: <b>${paraTr(toplamSatisDeger)}</b></div>
  </div>
</body>
</html>`;
}

async function stokAlfabetikRaporYazdir() {
  try {
    if (!Array.isArray(stokListeCache) || !stokListeCache.length) await stoklariGetir();
    const rows = stokAlfabetikSirala(stokListeCache);
    if (!rows.length) {
      alert('Yazdırılacak stok kaydı yok.');
      return;
    }
    const html = stokAlfabetikRaporDokumaniOlustur(rows);
    belgeOnizlemeAcHtml(html, '<i class="fa-solid fa-boxes-stacked me-2"></i>Stok Alfabetik Rapor');
  } catch (e) {
    console.error(e);
    alert('Stok raporu oluşturulamadı.');
  }
}

function stokBarkodBosMu(barkod) {
  const s = String(barkod ?? '').trim();
  return !s || s === '-' || s === '—';
}

/** A4 — 3×8 = 24 etiket; 70×35 mm; kenar: üst/alt 5 mm, sol/sağ 0 mm (PRATİK A4 24\'lü). */
const STOK_ETIKET_KONUM = {
  sol: 0,
  ust: 5,
  alt: 5,
  genislik: 70,
  yukseklik: 35,
  sutunAraligi: 70,
  satirAraligi: 35,
  sutun: 3,
  satir: 8,
  sayfa: 24,
};

function stokBarkodEtiketKonum(sira) {
  const col = sira % STOK_ETIKET_KONUM.sutun;
  const row = Math.floor(sira / STOK_ETIKET_KONUM.sutun);
  return {
    left: STOK_ETIKET_KONUM.sol + col * STOK_ETIKET_KONUM.sutunAraligi,
    top: STOK_ETIKET_KONUM.ust + row * STOK_ETIKET_KONUM.satirAraligi,
  };
}

function stokBarkodEtiketHtmlOlustur(urunler, opts = {}) {
  const ham = Array.isArray(urunler) ? urunler : [];
  const liste = opts.sirala === false ? ham : stokAlfabetikSirala(ham);
  const sayfaSayisi = opts.tekSayfa
    ? 1
    : Math.max(1, Math.ceil(liste.length / STOK_ETIKET_KONUM.sayfa));
  let sayfalarHtml = '';

  for (let p = 0; p < sayfaSayisi; p += 1) {
    const dilim = opts.tekSayfa
      ? liste.slice(0, STOK_ETIKET_KONUM.sayfa)
      : liste.slice(p * STOK_ETIKET_KONUM.sayfa, (p + 1) * STOK_ETIKET_KONUM.sayfa);
    let etiketler = '';
    for (let i = 0; i < STOK_ETIKET_KONUM.sayfa; i += 1) {
      const u = dilim[i];
      const { left, top } = stokBarkodEtiketKonum(i);
      const stil = `left:${left}mm;top:${top}mm;width:${STOK_ETIKET_KONUM.genislik}mm;height:${STOK_ETIKET_KONUM.yukseklik}mm`;
      if (!u) {
        etiketler += `<div class="etiket bos" style="${stil}"></div>`;
        continue;
      }
      const ad = gunlukMetinEsc(String(u.UrunAdi || '-').slice(0, 48));
      const kod = String(u.Barkod || '').trim();
      const kodEsc = gunlukMetinEsc(kod);
      const fiyat = paraTr(Number(u.SatisFiyati || 0));
      const birim = gunlukMetinEsc(u.Birim || 'Adet');
      etiketler += `
        <div class="etiket" style="${stil}">
          <div class="urun-ad">${ad}</div>
          <svg class="bc" data-kod="${kodEsc}"></svg>
          <div class="kod">${kodEsc}</div>
          <div class="alt"><span class="fiyat">${fiyat}</span><span class="birim"> / ${birim}</span></div>
        </div>`;
    }
    sayfalarHtml += `<div class="sayfa">${etiketler}</div>`;
  }

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Stok Barkod Etiketleri</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .sayfa {
      position: relative;
      width: 210mm;
      height: 297mm;
      page-break-after: always;
      overflow: hidden;
    }
    .sayfa:last-child { page-break-after: auto; }
    .etiket {
      position: absolute;
      padding: 1.5mm 2mm 1mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4mm;
      text-align: center;
      overflow: hidden;
    }
    .etiket.bos { visibility: hidden; }
    .urun-ad {
      font: 700 7.5pt/1.1 Arial, sans-serif;
      width: 100%;
      max-height: 8mm;
      overflow: hidden;
      flex-shrink: 0;
    }
    .bc { width: 100%; max-width: 64mm; height: 14mm; flex-shrink: 0; }
    .kod { font: 600 8pt/1 Consolas, monospace; letter-spacing: 0.4px; flex-shrink: 0; }
    .alt { font: 700 8pt/1 Arial, sans-serif; white-space: nowrap; flex-shrink: 0; }
    .birim { font-weight: 400; font-size: 7pt; color: #333; }
    .no-print {
      position: fixed; top: 8px; right: 8px; z-index: 9;
      padding: 8px 14px; font-size: 14px; cursor: pointer;
    }
    @media print {
      .no-print { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${sayfalarHtml}
  <button type="button" class="no-print" onclick="window.print()">Yazdır</button>
  <script>
    (function () {
      function ciz() {
        document.querySelectorAll('svg.bc').forEach(function (svg) {
          var kod = svg.getAttribute('data-kod') || '';
          if (!kod) return;
          try {
            JsBarcode(svg, kod, {
              format: 'EAN13',
              width: 1.35,
              height: 36,
              displayValue: false,
              margin: 0,
              flat: true
            });
          } catch (e) {
            try {
              JsBarcode(svg, kod, { format: 'CODE128', width: 1.2, height: 36, displayValue: false, margin: 0 });
            } catch (e2) { console.warn(e2); }
          }
        });
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          ciz();
          setTimeout(function () { window.print(); }, 450);
        });
      } else {
        ciz();
        setTimeout(function () { window.print(); }, 450);
      }
    })();
  <\/script>
</body>
</html>`;
}

function stokBarkodEtiketPenceresiAc(urunler, opts) {
  const html = stokBarkodEtiketHtmlOlustur(urunler, opts);
  const pencere = window.open('', '_blank');
  if (!pencere) {
    alert('Yazdırma penceresi açılamadı. Tarayıcı açılır pencereyi engelliyor olabilir.');
    return;
  }
  pencere.document.open();
  pencere.document.write(html);
  pencere.document.close();
}

async function stokBarkodEtiketYazdir() {
  try {
    await stoklariGetir();
    const tum = stokListeCache || [];
    const barkodlu = stokAlfabetikSirala(tum.filter((u) => !stokBarkodBosMu(u.Barkod)));
    const barkodsuzSay = tum.length - barkodlu.length;
    if (!barkodlu.length) {
      alert('Yazdırılacak ürün yok. Barkodsuz ürünler için stok düzenleme ekranından "Barkod oluştur" kullanın.');
      return;
    }
    let mesaj = `${barkodlu.length} ürün alfabetik sırada yazdırılacak (her üründen 1 etiket, A4 24\'lü düzen).`;
    if (barkodsuzSay > 0) {
      mesaj += `\n\n${barkodsuzSay} barkodsuz ürün atlanacak — barkod için Düzenle → Barkod oluştur.`;
    }
    mesaj += '\n\nDevam edilsin mi?';
    if (!confirm(mesaj)) return;
    stokBarkodEtiketPenceresiAc(barkodlu, { sirala: false });
  } catch (e) {
    console.error(e);
    alert('Barkod etiketleri hazırlanamadı.');
  }
}

let stokListeModalGeriAc = false;

function stokEkleModalGirdileriSerbest(modalEl) {
  const root = modalEl || document.getElementById('stokEkleModal');
  if (!root) return;
  root.querySelectorAll('input, textarea, select').forEach((el) => {
    const type = String(el.type || '').toLowerCase();
    if (type === 'hidden') return;
    el.readOnly = false;
    el.disabled = false;
    el.removeAttribute('readonly');
  });
}

function stokListeModalGeciciKapat() {
  const listeEl = document.getElementById('stokListeModal');
  if (!listeEl?.classList.contains('show')) {
    stokListeModalGeriAc = false;
    return Promise.resolve();
  }
  stokListeModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    listeEl.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(listeEl);
    setTimeout(bitti, 450);
  });
}

function stokEkleModalGoster(hazirlikFn) {
  return stokListeModalGeciciKapat().then(() => {
    if (typeof hazirlikFn === 'function') hazirlikFn();
    const modalEl = document.getElementById('stokEkleModal');
    if (!modalEl) return;
    stokEkleModalGirdileriSerbest(modalEl);
    const onShown = () => {
      stokEkleModalGirdileriSerbest(modalEl);
      modalKatmanlariniDuzelt(modalEl);
      stokEkleModalUrunAdiOdakla();
    };
    modalEl.addEventListener('shown.bs.modal', onShown, { once: true });
    bootstrap.Modal.getOrCreateInstance(modalEl, { focus: true }).show();
  });
}

function stokEkleModalUrunAdiOdakla() {
  const modalEl = document.getElementById('stokEkleModal');
  if (!modalEl?.classList.contains('show')) return;
  stokEkleModalGirdileriSerbest(modalEl);
  const el = document.getElementById('urunAdi');
  if (!el) return;
  el.readOnly = false;
  try {
    el.focus({ preventScroll: true });
  } catch (_) {
    el.focus();
  }
}

function stokEkleModalAc(barkodOnDoldur) {
  stokEkleModalGoster(() => {
    stokDuzenlemeID = null;
    document.getElementById('stokModalBaslik').innerHTML = '<i class="fa-solid fa-plus"></i> Yeni Ürün Ekle';
    document.getElementById('stokEkleForm').reset();
    document.getElementById('kritikEsik').value = 5;
    document.getElementById('hedefEsik').value = 20;
    if (barkodOnDoldur) {
      document.getElementById('barkod').value = String(barkodOnDoldur).trim();
    }
    const bilgi = document.getElementById('stokPiyasaBilgi');
    if (bilgi) bilgi.innerHTML = 'Henüz sorgu yok.';
    stokDuzenleBarkodAksiyonGuncelle();
  });
}

function stokDuzenleBarkodAksiyonGuncelle() {
  const wrap = document.getElementById('stokBarkodAksiyonWrap');
  const olustur = document.getElementById('stokBarkodOlusturBtn');
  const yazdir = document.getElementById('stokBarkodYazdirBtn');
  const ipucu = document.getElementById('stokBarkodEtiketIpucu');
  if (!wrap) return;
  const duzenle = Number.isInteger(stokDuzenlemeID) && stokDuzenlemeID > 0;
  if (!duzenle) {
    wrap.classList.add('d-none');
    wrap.classList.remove('d-flex');
    ipucu?.classList.add('d-none');
    return;
  }
  wrap.classList.remove('d-none');
  wrap.classList.add('d-flex');
  ipucu?.classList.remove('d-none');
  const bos = stokBarkodBosMu(document.getElementById('barkod')?.value);
  if (olustur) olustur.classList.toggle('d-none', !bos);
  if (yazdir) {
    yazdir.disabled = bos;
    yazdir.title = bos ? 'Önce barkod oluşturun' : "A4 kağıdına 24 adet etiket yazdır";
  }
}

async function stokDuzenleBarkodOlustur() {
  const id = stokDuzenlemeID;
  if (!Number.isInteger(id) || id <= 0) return;
  if (!stokBarkodBosMu(document.getElementById('barkod')?.value)) {
    stokDuzenleBarkodAksiyonGuncelle();
    return;
  }
  try {
    const res = await fetch(`/api/stok/${id}/barkod-uret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kullanici: aktifKullanici || 'Sistem' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Barkod oluşturulamadı.');
      return;
    }
    const kod = String(data.barkod || data.urun?.Barkod || '').trim();
    if (kod) document.getElementById('barkod').value = kod;
    stokDuzenleBarkodAksiyonGuncelle();
    await stoklariGetir();
  } catch (e) {
    console.error(e);
    alert('Barkod oluşturulamadı.');
  }
}

function stokDuzenleEtiketUrunOku() {
  return {
    UrunAdi: document.getElementById('urunAdi')?.value?.trim() || 'Ürün',
    Barkod: String(document.getElementById('barkod')?.value || '').trim(),
    SatisFiyati: parseFloat(document.getElementById('satisFiyati')?.value) || 0,
    Birim: document.getElementById('birim')?.value || 'Adet',
  };
}

function stokEtiketYerlesimDizisi(urun, baslangicEtiket, kopyaSayisi) {
  const bas = Math.min(
    STOK_ETIKET_KONUM.sayfa,
    Math.max(1, parseInt(String(baslangicEtiket ?? 1), 10) || 1),
  );
  const kopya = Math.max(1, parseInt(String(kopyaSayisi ?? 1), 10) || 1);
  const sonPoz = bas + kopya - 1;
  const hucreSayisi = Math.ceil(sonPoz / STOK_ETIKET_KONUM.sayfa) * STOK_ETIKET_KONUM.sayfa;
  const dizi = [];
  for (let poz = 1; poz <= hucreSayisi; poz += 1) {
    if (poz >= bas && poz < bas + kopya) dizi.push(urun);
    else dizi.push(null);
  }
  return dizi;
}

function stokDuzenleEtiketYazdir() {
  const id = stokDuzenlemeID;
  if (!Number.isInteger(id) || id <= 0) return;
  const urun = stokDuzenleEtiketUrunOku();
  if (stokBarkodBosMu(urun.Barkod)) {
    alert('Önce barkod oluşturun.');
    return;
  }
  const bas = document.getElementById('stokEtiketBaslangic')?.value;
  const kopya = document.getElementById('stokEtiketKopya')?.value;
  const yerlesim = stokEtiketYerlesimDizisi(urun, bas, kopya);
  stokBarkodEtiketPenceresiAc(yerlesim, { sirala: false, tekSayfa: false });
}

function stokDuzenleEtiketAlanlariSifirla() {
  const bas = document.getElementById('stokEtiketBaslangic');
  const kopya = document.getElementById('stokEtiketKopya');
  if (bas) bas.value = '1';
  if (kopya) kopya.value = '1';
}

function stokDuzenleModalAc(stokID) {
  const urun = (stokListeCache || []).find((x) => Number(x.StokID) === Number(stokID));
  if (!urun) return;
  stokEkleModalGoster(() => {
    stokDuzenlemeID = Number(stokID);
    document.getElementById('stokModalBaslik').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Stok Düzenle';
    document.getElementById('urunAdi').value = urun.UrunAdi || '';
    document.getElementById('kategori').value = urun.Kategori || '';
    document.getElementById('barkod').value = urun.Barkod || '';
    document.getElementById('alisFiyati').value = Number(urun.AlisFiyati || 0);
    document.getElementById('satisFiyati').value = Number(urun.SatisFiyati || 0);
    document.getElementById('miktar').value = Number(urun.MevcutMiktar || 0);
    document.getElementById('birim').value = urun.Birim || 'Adet';
    document.getElementById('kritikEsik').value = Number.isFinite(Number(urun.KritikEsik)) ? Number(urun.KritikEsik) : 5;
    document.getElementById('hedefEsik').value = Number.isFinite(Number(urun.HedefEsik)) ? Number(urun.HedefEsik) : 20;
    if (STOK_PIYASA_PANEL_AKTIF) stokPiyasaFiyatAra(urun.UrunAdi || '');
    stokDuzenleEtiketAlanlariSifirla();
    stokDuzenleBarkodAksiyonGuncelle();
  });
}

async function stokKaydet(event) {
  event.preventDefault();

  const yeniUrun = {
    UrunAdi: document.getElementById('urunAdi').value,
    Kategori: document.getElementById('kategori').value,
    Barkod: document.getElementById('barkod').value,
    AlisFiyati: parseFloat(document.getElementById('alisFiyati').value) || 0,
    SatisFiyati: parseFloat(document.getElementById('satisFiyati').value),
    MevcutMiktar: parseInt(document.getElementById('miktar').value, 10) || 0,
    Birim: document.getElementById('birim').value,
    KritikEsik: parseInt(document.getElementById('kritikEsik').value, 10),
    HedefEsik: parseInt(document.getElementById('hedefEsik').value, 10),
    kullanici: aktifKullanici,
  };

  const musteriSatisKayitModu = musteriSatisStokEkleDonus;
  if (musteriSatisKayitModu) {
    const ad = String(yeniUrun.UrunAdi || '').trim();
    const sf = Number(yeniUrun.SatisFiyati);
    if (!ad) {
      alert('Ürün adı girin.');
      document.getElementById('urunAdi')?.focus();
      return;
    }
    if (!Number.isFinite(sf) || sf <= 0) {
      alert('Satış fiyatı girin.');
      document.getElementById('satisFiyati')?.focus();
      return;
    }
  }

  try {
    const duzenleme = Number.isInteger(stokDuzenlemeID) && stokDuzenlemeID > 0;
    const response = await fetch(duzenleme ? `/api/stok/${stokDuzenlemeID}` : '/api/stok', {
      method: duzenleme ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(yeniUrun),
    });

    if (response.ok) {
      const duzenlemeSon = duzenleme;
      const kaydedilenId = duzenlemeSon ? stokDuzenlemeID : null;
      let yeniKayit = null;
      stokDuzenlemeID = null;
      document.getElementById('stokEkleForm').reset();
      const bilgi = document.getElementById('stokPiyasaBilgi');
      if (bilgi) bilgi.innerHTML = 'Henüz sorgu yok.';
      const musteriSatisDonusAktif = musteriSatisStokEkleDonus;
      if (musteriSatisDonusAktif) {
        musteriSatisStokEkleSonKayit = {
          urunAdi: String(yeniUrun.UrunAdi || '').trim(),
          barkod: String(yeniUrun.Barkod || '').trim(),
        };
        musteriSatisStokEkleDonus = false;
      }

      if (duzenlemeSon) {
        const hedefIdx = stokListeCache.findIndex((s) => Number(s.StokID) === Number(kaydedilenId));
        if (hedefIdx >= 0) {
          Object.assign(stokListeCache[hedefIdx], yeniUrun, { StokID: kaydedilenId });
          stokAramaIndeksiniGuncelleTek(stokListeCache[hedefIdx]);
        }
      } else {
        try {
          yeniKayit = await response.json();
        } catch (_) {
          yeniKayit = null;
        }
        if (yeniKayit && yeniKayit.StokID) {
          stokListeCache.unshift(yeniKayit);
          stokAramaIndeksiniGuncelleTek(yeniKayit);
        }
      }
      stokListeFiltreleHemen(document.getElementById('stokAraInput')?.value || '');
      stokOzetPanelleriniGuncelle();

      modalKapat(document.getElementById('stokEkleModal'));
      ozetBilgileriniGetir();
      if (!duzenlemeSon && !(yeniKayit && yeniKayit.StokID)) stoklariGetir();
      await tedAlimStokEkleDonusYap();
      if (musteriSatisDonusAktif) await musteriSatisStokEkleDonusYap();
    } else {
      const t = await response.text();
      alert('Ürün eklenirken bir hata oluştu: ' + t);
    }
  } catch (hata) {
    console.error('Kayıt hatası:', hata);
    alert('Sunucuya ulaşılamadı.');
  }
}

async function tedAlimStokEkleDonusYap() {
  if (!tedAlimStokEkleDonus) return;
  const taslak = tedAlimTaslak;
  tedAlimStokEkleDonus = false;
  tedAlimTaslak = null;
  const alimEl = document.getElementById('tedarikciAlimModal');
  const alimAcik = alimEl?.classList.contains('show');
  await tedAlimModalHazirla(taslak?.tedarikciID || null);
  tedAlimDurumYukle(taslak);
  if (!alimAcik && alimEl) modalAc(alimEl);
  else modalKatmanlariniDuzelt(alimEl);
}

function musteriTurDeger(m) {
  const t = String((m && (m.tur || m.Tur)) || '')
    .trim()
    .toLocaleLowerCase('tr-TR');
  if (t === 'tuzel' || t === 'tüzel' || t === 'kurumsal') return 'Tuzel';
  return 'Gercek';
}

function musteriTuzelMi(m) {
  return musteriTurDeger(m) === 'Tuzel';
}

function musteriTurEtiket(m) {
  return musteriTuzelMi(m) ? 'Tüzel kişi' : 'Gerçek kişi';
}

function musteriTurBadgeSinif(tuzel) {
  return tuzel ? 'badge badge-musteri-tuzel' : 'badge badge-musteri-gercek';
}

function musteriTurBadgeHtml(tuzel, kisa) {
  const metin = kisa ? (tuzel ? 'Tüzel' : 'Gerçek') : musteriTurEtiket({ tur: tuzel ? 'Tuzel' : 'Gercek' });
  return `<span class="${musteriTurBadgeSinif(tuzel)}">${metin}</span>`;
}

function musteriGorunenAd(m) {
  if (!m) return 'Müşteri';
  if (musteriTuzelMi(m)) {
    return String(m.FirmaAdi || m.yetkili || m.AdSoyad || 'Tüzel müşteri').trim();
  }
  return String(m.AdSoyad || m.FirmaAdi || 'Müşteri').trim();
}

function musteriGorunenAlt(m) {
  if (!m || !musteriTuzelMi(m)) return String(m.FirmaAdi || m.TanimAdi || '').trim();
  const y = String(m.yetkili || '').trim();
  const t = String(m.TanimAdi || '').trim();
  return [y && `Yetkili: ${y}`, t && `Tanım: ${t}`].filter(Boolean).join(' · ');
}

function musteriKimlikNo(m) {
  if (!m) return '—';
  if (musteriTuzelMi(m)) return String(m.vergino || m.VergiNo || '').trim() || '—';
  return String(m.tcno || m.TcNo || '').trim() || '—';
}

function musteriFormTurSec(mod, tur) {
  const t = musteriTurDeger({ tur });
  const gercekId = mod === 'ekle' ? 'musteriTurGercek' : 'mdDuzenleTurGercek';
  const tuzelId = mod === 'ekle' ? 'musteriTurTuzel' : 'mdDuzenleTurTuzel';
  const gEl = document.getElementById(gercekId);
  const tEl = document.getElementById(tuzelId);
  if (gEl) gEl.checked = t === 'Gercek';
  if (tEl) tEl.checked = t === 'Tuzel';
  musteriFormTurDegisti(mod);
}

function musteriDuzenleTurKilit(kayitliTur) {
  const tuzelMi = musteriTurDeger({ tur: kayitliTur }) === 'Tuzel';
  const gEl = document.getElementById('mdDuzenleTurGercek');
  const tEl = document.getElementById('mdDuzenleTurTuzel');
  const gLbl = document.querySelector('label[for="mdDuzenleTurGercek"]');
  const tLbl = document.querySelector('label[for="mdDuzenleTurTuzel"]');
  if (gEl) gEl.disabled = tuzelMi;
  if (tEl) tEl.disabled = !tuzelMi;
  [gLbl, tLbl].forEach((lbl) => {
    if (!lbl) return;
    lbl.classList.remove('disabled', 'opacity-50', 'pe-none');
    lbl.removeAttribute('title');
  });
  const kilitliLbl = tuzelMi ? gLbl : tLbl;
  if (kilitliLbl) {
    kilitliLbl.classList.add('disabled', 'opacity-50', 'pe-none');
    kilitliLbl.title = 'Kayıt türü değiştirilemez';
  }
}

function musteriDuzenleTurKilidiKaldir() {
  const gEl = document.getElementById('mdDuzenleTurGercek');
  const tEl = document.getElementById('mdDuzenleTurTuzel');
  const gLbl = document.querySelector('label[for="mdDuzenleTurGercek"]');
  const tLbl = document.querySelector('label[for="mdDuzenleTurTuzel"]');
  if (gEl) gEl.disabled = false;
  if (tEl) tEl.disabled = false;
  [gLbl, tLbl].forEach((lbl) => {
    if (!lbl) return;
    lbl.classList.remove('disabled', 'opacity-50', 'pe-none');
    lbl.removeAttribute('title');
  });
}

function musteriFormTurDegisti(mod) {
  const ekleMi = mod === 'ekle';
  const tuzel = ekleMi
    ? document.getElementById('musteriTurTuzel')?.checked
    : document.getElementById('mdDuzenleTurTuzel')?.checked;
  const gercekWrap = document.getElementById(ekleMi ? 'musteriGercekAlanlariEkle' : 'mdDuzenleGercekAlanlari');
  const tuzelWrap = document.getElementById(ekleMi ? 'musteriTuzelAlanlariEkle' : 'mdDuzenleTuzelAlanlari');
  if (gercekWrap) gercekWrap.classList.toggle('d-none', !!tuzel);
  if (tuzelWrap) tuzelWrap.classList.toggle('d-none', !tuzel);
  const adInp = document.getElementById(ekleMi ? 'musteriAdSoyad' : 'mdDuzenleAdSoyad');
  const firmaInp = document.getElementById(ekleMi ? 'musteriFirma' : 'mdDuzenleFirma');
  const telInp = document.getElementById(ekleMi ? 'musteriTelefon' : 'mdDuzenleTelefon');
  const yetkiliInp = document.getElementById(ekleMi ? 'musteriYetkili' : 'mdDuzenleYetkili');
  if (adInp) adInp.required = !tuzel;
  if (firmaInp) firmaInp.required = !!tuzel;
  if (telInp) telInp.required = false;
  if (yetkiliInp) yetkiliInp.required = !!tuzel;
}

function musteriFormDogrulaClient(mod) {
  const data = musteriFormVeriTopla(mod);
  const tuzel = data.tur === 'Tuzel';
  let telefon = String(data.Telefon || '').replace(/\D/g, '');
  if (telefon.startsWith('0')) telefon = telefon.slice(1);
  if (telefon && !/^[1-9][0-9]{9}$/.test(telefon)) {
    alert('Cep telefonu 10 haneli olmalı ve 0 ile başlamamalı.');
    return false;
  }
  if (tuzel) {
    if (!String(data.FirmaAdi || '').trim()) {
      alert('Firma ünvanı zorunludur.');
      return false;
    }
    if (!String(data.yetkili || '').trim()) {
      alert('Yetkili kişi zorunludur.');
      return false;
    }
  } else if (!String(data.AdSoyad || '').trim()) {
    alert('Ad soyad zorunludur.');
    return false;
  }
  return true;
}

function musteriFormVeriTopla(mod) {
  const ekleMi = mod === 'ekle';
  const tuzel = ekleMi
    ? document.getElementById('musteriTurTuzel')?.checked
    : document.getElementById('mdDuzenleTurTuzel')?.checked;
  const telefon = String(
    document.getElementById(ekleMi ? 'musteriTelefon' : 'mdDuzenleTelefon')?.value || ''
  ).replace(/\D/g, '').replace(/^0/, '');
  const ortak = {
    tur: tuzel ? 'Tuzel' : 'Gercek',
    Telefon: telefon,
    TanimAdi: document.getElementById(ekleMi ? 'musteriTanimAdi' : 'mdDuzenleTanimAdi')?.value?.trim() || null,
    Il: document.getElementById(ekleMi ? 'musteriIl' : 'mdDuzenleIl')?.value?.trim() || null,
    Ilce: document.getElementById(ekleMi ? 'musteriIlce' : 'mdDuzenleIlce')?.value?.trim() || null,
    Mahalle: document.getElementById(ekleMi ? 'musteriMahalle' : 'mdDuzenleMahalle')?.value?.trim() || null,
    Adres: document.getElementById(ekleMi ? 'musteriAdres' : 'mdDuzenleAdres')?.value?.trim() || null,
  };
  if (tuzel) {
    return {
      ...ortak,
      FirmaAdi: document.getElementById(ekleMi ? 'musteriFirma' : 'mdDuzenleFirma')?.value?.trim() || '',
      vergino: document.getElementById(ekleMi ? 'musteriVergiNo' : 'mdDuzenleVergiNo')?.value?.trim() || '',
      yetkili: document.getElementById(ekleMi ? 'musteriYetkili' : 'mdDuzenleYetkili')?.value?.trim() || '',
      AdSoyad: '',
      tcno: '',
    };
  }
  return {
    ...ortak,
    AdSoyad: document.getElementById(ekleMi ? 'musteriAdSoyad' : 'mdDuzenleAdSoyad')?.value?.trim() || '',
    tcno: document.getElementById(ekleMi ? 'musteriTcNo' : 'mdDuzenleTcNo')?.value?.trim() || '',
    FirmaAdi: '',
    vergino: '',
    yetkili: '',
  };
}

const MUSTERI_LISTE_GOSTER_MAX = 200;
let _musteriListeFiltreTimer = null;

function musteriListeCacheAyarla(liste) {
  window._musteriListeCache = Array.isArray(liste) ? liste : [];
  window._musteriListeIndeks = window._musteriListeCache.map((m) => {
    const no = String(m.MusteriID || '');
    const ara = [
      no,
      m.AdSoyad,
      m.FirmaAdi,
      m.Telefon,
      m.tcno,
      m.vergino,
      m.yetkili,
      m.TanimAdi,
      m.tur,
      musteriGorunenAd(m),
      musteriTurEtiket(m),
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('tr-TR');
    return { m, ara };
  });
}

function musteriListeOzetGuncelle(filtreli, gosterilen, aranan) {
  let toplamAlacak = 0;
  let alacakliBakiye = 0;
  let borcluSay = 0;
  for (let i = 0; i < filtreli.length; i++) {
    const b = Number(filtreli[i].Bakiye) || 0;
    if (b > 0) {
      toplamAlacak += b;
      borcluSay++;
    } else if (b < 0) {
      alacakliBakiye += Math.abs(b);
    }
  }
  const sayEl = document.getElementById('mlOzetMusteriSayi');
  const borcluEl = document.getElementById('mlOzetBorcluSayi');
  const alacakEl = document.getElementById('mlOzetToplamAlacak');
  const alacakliEl = document.getElementById('mlOzetAlacakliBakiye');
  const n = filtreli.length;
  const g = gosterilen.length;
  if (sayEl) {
    if (!n) sayEl.textContent = aranan ? '0 eşleşme' : '0 kayıt';
    else if (g < n) sayEl.textContent = `${n} eşleşme (${g} gösteriliyor)`;
    else sayEl.textContent = `${n} kayıt`;
  }
  if (borcluEl) borcluEl.textContent = n ? String(borcluSay) : '—';
  if (alacakEl) alacakEl.textContent = n ? musteriDetayParaFmt(toplamAlacak) : '—';
  if (alacakliEl) alacakliEl.textContent = n ? musteriDetayParaFmt(alacakliBakiye) : '—';
}

function musteriListeFiltreleDebounced(q) {
  clearTimeout(_musteriListeFiltreTimer);
  _musteriListeFiltreTimer = setTimeout(() => musteriListeFiltrele(q), 100);
}

async function musterileriGetir() {
  try {
    const response = await fetch('/api/musteri');
    const musteriler = await response.json();
    musteriListeCacheAyarla(musteriler);
    musteriListeFiltrele(document.getElementById('musteriAraInput')?.value || '');
  } catch (hata) {
    console.error('Müşteriler çekilirken hata:', hata);
  }
}

function musteriListeFiltrele(q) {
  const indeks = Array.isArray(window._musteriListeIndeks) ? window._musteriListeIndeks : [];
  const aranan = String(q || '').trim().toLocaleLowerCase('tr-TR');
  const tabloGovdesi = document.getElementById('musteriTabloGovdesi');
  if (!tabloGovdesi) return;

  let filtreli = aranan
    ? indeks.filter((x) => x.ara.includes(aranan)).map((x) => x.m)
    : indeks.map((x) => x.m);

  if (!filtreli.length) {
    tabloGovdesi.innerHTML =
      `<tr><td colspan="7" class="text-center text-muted p-4">${aranan ? 'Aramaya uygun müşteri bulunamadı.' : 'Henüz hiç müşteri eklenmemiş.'}</td></tr>`;
    musteriListeOzetGuncelle([], [], aranan);
    return;
  }

  const sinirli = filtreli.length > MUSTERI_LISTE_GOSTER_MAX;
  const gosterilen = sinirli ? filtreli.slice(0, MUSTERI_LISTE_GOSTER_MAX) : filtreli;
  musteriListeOzetGuncelle(filtreli, gosterilen, aranan);

  const satirlar = gosterilen.map((musteri) => {
    const bakiye = Number(musteri.Bakiye) || 0;
    let bakiyeRenk = 'text-secondary';
    if (bakiye > 0) bakiyeRenk = 'text-success';
    if (bakiye < 0) bakiyeRenk = 'text-danger';
    const tuzel = musteriTuzelMi(musteri);
    const turBadge = musteriTurBadgeHtml(tuzel, true);
    const gorunenAd = musteriGorunenAd(musteri);
    const alt = musteriGorunenAlt(musteri);
    const adHucre = alt
      ? `<div class="fw-bold text-dark">${gunlukMetinEsc(gorunenAd)}</div><div class="small text-muted">${gunlukMetinEsc(alt)}</div>`
      : `<span class="fw-bold text-dark">${gunlukMetinEsc(gorunenAd)}</span>`;
    return `<tr onclick="musteriDetayModalAc(${musteri.MusteriID})" style="cursor: pointer;" title="Tıkla: cari hareketler">
          <td class="align-middle fw-bold text-muted">#${musteri.MusteriID}</td>
          <td class="align-middle">${turBadge}</td>
          <td class="align-middle">${adHucre}</td>
          <td class="align-middle text-nowrap">${gunlukMetinEsc(musteriKimlikNo(musteri))}</td>
          <td class="align-middle">${musteri.Telefon || '-'}</td>
          <td class="align-middle fw-bold ${bakiyeRenk}">${bakiye.toFixed(2)}</td>
          <td class="align-middle text-end">
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); musteriSil(${musteri.MusteriID})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
  });
  if (sinirli) {
    satirlar.push(
      `<tr><td colspan="7" class="text-center text-muted small py-2">${filtreli.length} eşleşme — ilk ${MUSTERI_LISTE_GOSTER_MAX} kayıt gösteriliyor. Aramayı daraltın.</td></tr>`,
    );
  }
  tabloGovdesi.innerHTML = satirlar.join('');
}

async function musteriKaydet(event) {
  event.preventDefault();
  if (!musteriFormDogrulaClient('ekle')) return;
  const yeniMusteri = musteriFormVeriTopla('ekle');

  try {
    const response = await fetch('/api/musteri', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(yeniMusteri),
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      document.getElementById('musteriEkleForm').reset();
      musteriFormTurSec('ekle', 'Gercek');
      modalKapat(document.getElementById('musteriEkleModal'));
      await musterileriGetir();
      await ozetBilgileriniGetir();
      const yeniId = Number(data.musteriID);
      if (Number.isInteger(yeniId) && yeniId > 0) {
        musteriListeModalGeriAc = true;
        await musteriDetayModalAc(yeniId);
      } else {
        modalAc(document.getElementById('musteriListeModal'));
      }
    } else {
      alert(data.message || 'Müşteri eklenirken hata oluştu.');
    }
  } catch (hata) {
    console.error('Kayıt hatası:', hata);
  }
}

async function musteriSil(id) {
  if (!confirm('Bu müşteriyi silmek istediğinize emin misiniz?')) return;

  try {
    const response = await fetch(`/api/musteri/${id}`, { method: 'DELETE' });
    const result = await response.json();

    if (response.ok && result.success) {
      alert('Müşteri başarıyla silindi.');
      musterileriGetir();
      ozetBilgileriniGetir();
    } else {
      alert((result && result.message) || 'Müşteri silinirken bir hata oluştu.');
    }
  } catch (hata) {
    console.error('Silme hatası:', hata);
    alert('Bağlantı hatası! Sunucu ile iletişim kurulamadı.');
  }
}

let aktifMusteriDetayID = null;
let musteriSatisSepet = [];
let musteriSatisStokCache = [];
let musteriSatisStokEkleDonus = false;
let musteriSatisStokEkleSonKayit = null;
let mdSatisAktifAramaInp = null;

function musteriSatisAramaKatmanKapat() {
  const kat = document.getElementById('mdSatisAramaKatman');
  if (kat) {
    kat.innerHTML = '';
    kat.classList.remove('acik');
  }
  mdSatisAktifAramaInp = null;
}

function musteriSatisAramaKatmanKonumla(inp) {
  const kat = document.getElementById('mdSatisAramaKatman');
  if (!kat || !inp) return;
  const r = inp.getBoundingClientRect();
  const genislik = Math.max(r.width, 300);
  let sol = r.left;
  let ust = r.bottom + 4;
  if (sol + genislik > window.innerWidth - 8) sol = Math.max(8, window.innerWidth - genislik - 8);
  const maxH = Math.min(280, window.innerHeight * 0.42);
  if (ust + maxH > window.innerHeight - 8) ust = Math.max(8, r.top - maxH - 4);
  kat.style.left = `${sol}px`;
  kat.style.top = `${ust}px`;
  kat.style.width = `${genislik}px`;
  kat.style.maxHeight = `${maxH}px`;
}

function musteriSatisAramaKatmanGoster(inp, html) {
  const kat = document.getElementById('mdSatisAramaKatman');
  if (!kat || !inp) return;
  mdSatisAktifAramaInp = inp;
  kat.innerHTML = html;
  kat.classList.add('acik');
  musteriSatisAramaKatmanKonumla(inp);
}

function musteriSatisSepetKutuKaydirGuncelle() {
  const kutu = document.querySelector('.md-satis-sepet-kutu');
  if (!kutu) return;
  kutu.classList.toggle('md-satis-kutu-kaydir', musteriSatisSepet.length > 4);
}

function musteriSatisMevcutAlacakOku() {
  const el = document.getElementById('mdKalanBakiye');
  if (el) {
    const t = el.textContent.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(t);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  const b = Number(aktifMusteriDetayData?.Bakiye);
  return Number.isFinite(b) ? Math.max(0, b) : 0;
}

function musteriSatisOzetGuncelle() {
  const toplam = Math.round(musteriSatisSepetToplam() * 100) / 100;
  const kalem = musteriSatisSepet.length;
  const topEl = document.getElementById('mdSatisToplam');
  const adetEl = document.getElementById('mdSatisKalemSayisi');
  if (topEl) topEl.textContent = musteriDetayParaFmt(toplam);
  if (adetEl) adetEl.textContent = `${kalem} kalem`;

  const mevcut = musteriSatisMevcutAlacakOku();
  const mevcutEl = document.getElementById('mdSatisMevcutAlacak');
  if (mevcutEl) mevcutEl.textContent = musteriDetayParaFmt(mevcut);

  const odemeVar = !!document.getElementById('mdOdemeVarMi')?.checked;
  const odenenInp = document.getElementById('mdSatisOdenen');
  if (odemeVar && odenenInp && odenenInp.dataset.manual !== '1') {
    odenenInp.value = toplam > 0 ? toplam.toFixed(2) : '0';
  }
  const odenen = odemeVar ? Number(odenenInp?.value || 0) : 0;
  const kalanSatis = Math.round((toplam - odenen) * 100) / 100;
  const ongoru = Math.round((mevcut + kalanSatis) * 100) / 100;
  const wrap = document.getElementById('mdSatisAlacakOngoruWrap');
  const ongoruEl = document.getElementById('mdSatisAlacakOngoru');
  if (wrap && ongoruEl) {
    const goster = toplam > 0 || mevcut > 0;
    wrap.classList.toggle('d-none', !goster);
    ongoruEl.textContent = musteriDetayParaFmt(Math.max(0, ongoru));
  }
  const ipucu = document.getElementById('mdSatisOdemeIpucu');
  if (ipucu) {
    ipucu.textContent = odemeVar
      ? `Öneri: ${musteriDetayParaFmt(toplam)} (sepet toplamı). İsterseniz değiştirin.`
      : 'Tahsilat işaretlenince sepet toplamı önerilir.';
  }
}

function musteriSatisOdenenManuelGirildi() {
  const inp = document.getElementById('mdSatisOdenen');
  if (inp) inp.dataset.manual = '1';
  musteriSatisOzetGuncelle();
}
let aktifMusteriDetayData = null;
let aktifMusteriHareketler = [];
let musteriIadeSepet = [];
let musteriIadeUrunCache = [];
const musteriAdresMap = {
  Konya: {
    'Sarayönü': [
      'Bahçesaray Mahallesi',
      'Başhüyük Mahallesi',
      'Batı İstasyon Mahallesi',
      'Boyalı Mahallesi',
      'Büyükzengi Mahallesi',
      'Çeşmelisebil Mahallesi',
      'Değirmenli Mahallesi',
      'Doğu İstasyon Mahallesi',
      'Ertuğrul Mahallesi',
      'Fatih Mahallesi',
      'Gözlü Mahallesi',
      'Hatip Mahallesi',
      'İnli Mahallesi',
      'Kadıoğlu Mahallesi',
      'Karabıyık Mahallesi',
      'Karatepe Mahallesi',
      'Kayıören Mahallesi',
      'Konar Mahallesi',
      'Kurşunlu Mahallesi',
      'Kuyulusebil Mahallesi',
      'Ladik Mahallesi',
      'Özkent Mahallesi',
      'Saraç Mahallesi',
      'Selimiye Mahallesi',
      'Yenicekaya Mahallesi',
      'Yukarı Mahallesi',
    ],
  },
};

function musteriDetayParaFmt(n) {
  const v = Number(n);
  const s = (Number.isFinite(v) ? v : 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${s} ₺`;
}

function musteriAdresBagimliSecimler(mod, seciliMahalle) {
  const ekleMi = mod === 'ekle';
  const ilEl = document.getElementById(ekleMi ? 'musteriIl' : 'mdDuzenleIl');
  const ilceEl = document.getElementById(ekleMi ? 'musteriIlce' : 'mdDuzenleIlce');
  const mahEl = document.getElementById(ekleMi ? 'musteriMahalle' : 'mdDuzenleMahalle');
  if (!ilEl || !ilceEl || !mahEl) return;
  const il = ilEl.value || 'Konya';
  const ilce = ilceEl.value || 'Sarayönü';
  const mahalleler = ((musteriAdresMap[il] || {})[ilce] || []);
  mahEl.innerHTML = '<option value="">— Mahalle seçin —</option>';
  mahalleler.forEach((m) => {
    mahEl.innerHTML += `<option value="${m}">${m}</option>`;
  });
  if (seciliMahalle && mahalleler.includes(seciliMahalle)) mahEl.value = seciliMahalle;
}

function musteriDetaySatisOdemeAlaniGuncelle() {
  const c = document.getElementById('mdOdemeVarMi');
  const a = document.getElementById('mdSatisOdemeAlani');
  if (!c || !a) return;
  if (c.checked) {
    a.style.display = '';
    const odemeInp = document.getElementById('mdSatisOdenen');
    if (odemeInp && odemeInp.dataset.manual !== '1') {
      odemeInp.value = musteriSatisSepetToplam().toFixed(2);
    }
  } else {
    a.style.display = 'none';
  }
  musteriSatisOzetGuncelle();
}

function musteriIadeSepetToplam() {
  return musteriIadeSepet.reduce((acc, s) => acc + (Number(s.miktar) * Number(s.birimFiyat)), 0);
}

function musteriIadeSepetCiz() {
  const tb = document.getElementById('mdIadeSepetGovde');
  const top = document.getElementById('mdIadeToplam');
  if (!tb || !top) return;
  if (!musteriIadeSepet.length) {
    tb.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Sepet boş</td></tr>';
  } else {
    tb.innerHTML = musteriIadeSepet
      .map((s) => `<tr>
        <td class="small">${gunlukMetinEsc(s.urunAdi)}</td>
        <td class="text-center">${s.miktar}</td>
        <td class="text-end">${musteriDetayParaFmt(Number(s.miktar) * Number(s.birimFiyat))}</td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" onclick="musteriIadeSepettenSil('${String(s.key).replace(/'/g, "\\'")}')"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`)
      .join('');
  }
  top.textContent = musteriDetayParaFmt(musteriIadeSepetToplam());
  const odemeInp = document.getElementById('mdIadePara');
  if (odemeInp && odemeInp.dataset.manual !== '1') odemeInp.value = musteriIadeSepetToplam().toFixed(2);
}

function musteriIadeOdemeAlaniGuncelle() {
  const c = document.getElementById('mdParaIadesiVar');
  const a = document.getElementById('mdIadeOdemeAlani');
  if (!c || !a) return;
  if (c.checked) {
    a.classList.remove('d-none');
    const odemeInp = document.getElementById('mdIadePara');
    if (odemeInp && odemeInp.dataset.manual !== '1') odemeInp.value = musteriIadeSepetToplam().toFixed(2);
  } else {
    a.classList.add('d-none');
  }
}

function musteriIadeSeciliFiyatVarsayilan() {
  const key = String(document.getElementById('mdIadeUrun').value || '');
  const fiyatInp = document.getElementById('mdIadeBirimFiyat');
  const urun = musteriIadeUrunCache.find((u) => String(u.Key || `stok:${u.StokID}`) === key);
  if (fiyatInp) fiyatInp.value = urun ? Number(urun.BirimFiyat || 0).toFixed(2) : '0';
}

function musteriIadeUrunSecimiDegisti() {
  musteriIadeSeciliFiyatVarsayilan();
}

async function musteriIadeUrunleriYukle() {
  if (!aktifMusteriDetayID) return;
  const sel = document.getElementById('mdIadeUrun');
  if (!sel) return;
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/iade-urunler`);
  const data = await res.json().catch(() => []);
  musteriIadeUrunCache = (Array.isArray(data) ? data : []).filter((u) => {
    const ad = String(u?.UrunAdi || '').trim();
    return ad.length > 0;
  });
  sel.innerHTML = '<option value="">— Ürün seçin —</option>';
  musteriIadeUrunCache.forEach((u) => {
    const key = String(u.Key || `stok:${u.StokID}`);
    sel.innerHTML += `<option value="${key}">${u.UrunAdi} (Kalan: ${u.KalanMiktar})</option>`;
  });
  sel.onchange = musteriIadeUrunSecimiDegisti;
  musteriIadeUrunSecimiDegisti();
}

function musteriIadeSepeteEkle() {
  const secimKey = String(document.getElementById('mdIadeUrun').value || '');
  const miktar = parseInt(document.getElementById('mdIadeMiktar').value, 10);
  let birimFiyat = Number(document.getElementById('mdIadeBirimFiyat').value);
  if (!secimKey) return alert('İade ürünü seçin.');
  if (!Number.isInteger(miktar) || miktar < 1) return alert('Miktar en az 1 olmalı.');
  if (!Number.isFinite(birimFiyat) || birimFiyat < 0) return alert('Birim fiyat geçersiz.');
  birimFiyat = Math.round(birimFiyat * 100) / 100;
  const urun = musteriIadeUrunCache.find((u) => String(u.Key || `stok:${u.StokID}`) === secimKey);
  if (!urun) return alert('Ürün bulunamadı.');
  const satir = musteriIadeSepet.find((s) => String(s.key) === secimKey);
  const yeniMiktar = (satir ? satir.miktar : 0) + miktar;
  if (yeniMiktar > Number(urun.KalanMiktar || 0)) return alert(`En fazla ${urun.KalanMiktar} adet iade alınabilir.`);
  if (satir) {
    satir.miktar = yeniMiktar;
    satir.birimFiyat = birimFiyat;
  } else {
    musteriIadeSepet.push({
      key: secimKey,
      stokID: Number.isInteger(Number(urun.StokID)) ? Number(urun.StokID) : null,
      urunAdi: urun.UrunAdi,
      miktar,
      birimFiyat,
    });
  }
  document.getElementById('mdIadeMiktar').value = 1;
  musteriIadeSepetCiz();
}

function musteriIadeSepettenSil(key) {
  musteriIadeSepet = musteriIadeSepet.filter((s) => String(s.key) !== String(key));
  musteriIadeSepetCiz();
}

let musteriListeModalGeriAc = false;
let musteriDetayModalGeriAc = false;

function musteriListeModalGeciciKapat() {
  const listeEl = document.getElementById('musteriListeModal');
  if (!listeEl?.classList.contains('show')) {
    return Promise.resolve();
  }
  musteriListeModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    listeEl.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(listeEl);
    setTimeout(bitti, 450);
  });
}

function musteriDetayModalGeciciKapat() {
  const detayEl = document.getElementById('musteriDetayModal');
  if (!detayEl?.classList.contains('show')) {
    musteriDetayModalGeriAc = false;
    return Promise.resolve();
  }
  musteriDetayModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    detayEl.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(detayEl);
    setTimeout(bitti, 450);
  });
}

async function musteriAltModalAc(modalEl, hazirlikFn) {
  if (typeof hazirlikFn === 'function') await hazirlikFn();
  await musteriDetayModalGeciciKapat();
  modalAc(modalEl);
}

function musteriDetayModalGeriAcPlanla() {
  if (!musteriDetayModalGeriAc) return;
  musteriDetayModalGeriAc = false;
  setTimeout(() => {
    modalArtigiTemizle();
    modalAc(document.getElementById('musteriDetayModal'));
  }, 100);
}

let teklifModalGeriAc = false;

function teklifModalGeciciKapat() {
  const el = document.getElementById('teklifModal');
  if (!el?.classList.contains('show')) {
    teklifModalGeriAc = false;
    return Promise.resolve();
  }
  teklifModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    el.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(el);
    setTimeout(bitti, 450);
  });
}

async function teklifAltModalAc(modalEl, hazirlikFn) {
  if (typeof hazirlikFn === 'function') await hazirlikFn();
  await teklifModalGeciciKapat();
  modalAc(modalEl);
}

function teklifModalGeriAcPlanla() {
  if (!teklifModalGeriAc) return;
  teklifModalGeriAc = false;
  setTimeout(() => {
    modalArtigiTemizle();
    modalAc(document.getElementById('teklifModal'));
  }, 100);
}

async function musteriIadeModalAc() {
  await musteriAltModalAc(document.getElementById('musteriIadeModal'), async () => {
    const ad = document.getElementById('mdAdSoyad')?.textContent || 'Müşteri';
    const el = document.getElementById('mdIadeMusteri');
    if (el) el.textContent = ad;
    musteriIadeSepet = [];
    document.getElementById('musteriIadeForm').reset();
    document.getElementById('mdIadeMiktar').value = 1;
    document.getElementById('mdIadePara').dataset.manual = '0';
    musteriIadeSepetCiz();
    musteriIadeOdemeAlaniGuncelle();
    await musteriIadeUrunleriYukle();
  });
}

function musteriTahsilatModalAc() {
  musteriAltModalAc(document.getElementById('musteriTahsilatModal'), () => {
    const ad = document.getElementById('mdAdSoyad')?.textContent || 'Müşteri';
    const el = document.getElementById('mdTahsilatMusteri');
    if (el) el.textContent = ad;

    const bakiye = musteriSatisMevcutAlacakOku();
    const bakiyeTxt = musteriDetayParaFmt(bakiye);
    const borcEl = document.getElementById('mdTahsilatBorc');
    if (borcEl) borcEl.textContent = bakiyeTxt;

    const notEl = document.getElementById('mdOdemeAciklama');
    if (notEl) notEl.value = '';

    const tutarEl = document.getElementById('mdOdemeTutar');
    if (tutarEl) tutarEl.value = '';
  });
}

async function musteriTaksitModalAc() {
  if (!aktifMusteriDetayID) return;
  await musteriAltModalAc(document.getElementById('musteriTaksitModal'), async () => {
    const bugun = new Date();
    const yyyy = bugun.getFullYear();
    const mm = String(bugun.getMonth() + 1).padStart(2, '0');
    const dd = String(bugun.getDate()).padStart(2, '0');
    const bas = `${yyyy}-${mm}-${dd}`;
    const bakiyeTxt = document.getElementById('mdKalanBakiye')?.textContent || '0';
    const bakiye = Number(String(bakiyeTxt).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0;
    document.getElementById('mtBaslangic').value = bas;
    document.getElementById('mtToplam').value = bakiye > 0 ? bakiye.toFixed(2) : '';
    document.getElementById('mtOdemeTutar').value = '';
    await musteriTaksitListeYukle();
  });
}

async function musteriTaksitListeYukle() {
  if (!aktifMusteriDetayID) return;
  const tb = document.getElementById('mtGovde');
  const toplamInp = document.getElementById('mtToplam');
  if (tb) tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Yükleniyor…</td></tr>';
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/taksitler`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (tb) tb.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-3">Liste alınamadı.</td></tr>';
    return;
  }
  const rows = (data.taksitler || []).filter((t) => Number(t.KalanTutar || 0) > 0 && String(t.Durum || '').toLowerCase() !== 'devredildi');
  const toplamKalan = rows.reduce((acc, r) => acc + Number(r.KalanTutar || 0), 0);
  // Bekleyen taksit varsa planın kalanını göster; yoksa modal açılırken set edilen cari borcu koru.
  if (toplamInp && rows.length > 0) toplamInp.value = Number(toplamKalan || 0).toFixed(2);
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Bekleyen taksit yok.</td></tr>';
    return;
  }
  tb.innerHTML = rows.map((t) => {
    const vade = tarihTrTarih(t.VadeTarihi);
    const durum = Number(t.KalanTutar || 0) > 0 ? '<span class="badge bg-warning text-dark">Bekliyor</span>' : '<span class="badge bg-success">Ödendi</span>';
    return `<tr>
      <td class="small text-nowrap">${gunlukMetinEsc(vade)}</td>
      <td>${t.TaksitNo}</td>
      <td class="text-end">${musteriDetayParaFmt(t.Tutar)}</td>
      <td class="text-end text-success">${musteriDetayParaFmt(t.OdenenTutar)}</td>
      <td class="text-end text-danger">${musteriDetayParaFmt(t.KalanTutar)}</td>
      <td>${durum}</td>
    </tr>`;
  }).join('');
}

async function musteriTaksitPlanKaydet(event) {
  event.preventDefault();
  if (!aktifMusteriDetayID) return;
  const body = {
    baslangicTarihi: document.getElementById('mtBaslangic').value,
    taksitSayisi: parseInt(document.getElementById('mtSayi').value, 10),
    toplamBorc: parseFloat(document.getElementById('mtToplam').value),
    aciklama: document.getElementById('mtNot').value.trim() || null,
    kullanici: aktifKullanici,
  };
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/taksit-plani`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    if (data.code === 'ACTIVE_PLAN_EXISTS') {
      alert(`${data.message}\nRevize etmek için "Planı Revize Et" butonunu kullanın.`);
      return;
    }
    return alert(data.message || 'Plan oluşturulamadı.');
  }
  alert(data.message || 'Taksit planı oluşturuldu.');
  await musteriTaksitListeYukle();
}

async function musteriTaksitPlanRevizeKaydet() {
  if (!aktifMusteriDetayID) return;
  const body = {
    baslangicTarihi: document.getElementById('mtBaslangic').value,
    taksitSayisi: parseInt(document.getElementById('mtSayi').value, 10),
    toplamBorc: parseFloat(document.getElementById('mtToplam').value || '0'),
    aciklama: document.getElementById('mtNot').value.trim() || null,
    kullanici: aktifKullanici,
  };
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/taksit-plani-revize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || 'Revize başarısız.');
  alert(data.message || 'Plan revize edildi.');
  await musteriTaksitListeYukle();
}

async function musteriTaksitBekleyenSil() {
  if (!aktifMusteriDetayID) return;
  if (!confirm('Bekleyen taksitleri silmek istiyor musunuz? Ödenen taksitler korunacaktır.')) return;
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/taksit-bekleyen-sil`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kullanici: aktifKullanici }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || 'Bekleyenler silinemedi.');
  alert(data.message || 'Bekleyen taksitler silindi.');
  await musteriTaksitListeYukle();
  await musteriDetayYukle();
}

async function musteriTaksitOdemeKaydet(event) {
  event.preventDefault();
  if (!aktifMusteriDetayID) return;
  const body = {
    tutar: parseFloat(document.getElementById('mtOdemeTutar').value),
    odemeSekli: document.getElementById('mtOdemeSekli').value,
    kullanici: aktifKullanici,
  };
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/taksit-odeme`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || 'Taksit ödemesi başarısız.');
  const taksitModalEl = document.getElementById('musteriTaksitModal');
  const taksitModal = taksitModalEl ? bootstrap.Modal.getInstance(taksitModalEl) : null;
  const taksitSonrasi = () => {
    odemeSonrasiBildir(data.message || 'Taksit ödemesi işlendi.', data?.makbuz);
    document.getElementById('mtOdemeTutar').value = '';
    musteriTaksitListeYukle();
    musteriDetayYukle();
    musterileriGetir();
  };
  if (taksitModal && taksitModalEl) {
    taksitModalEl.addEventListener('hidden.bs.modal', taksitSonrasi, { once: true });
    taksitModal.hide();
  } else {
    taksitSonrasi();
  }
}

function musteriSatisModalAc() {
  musteriAltModalAc(document.getElementById('musteriSatisModal'), () => {
    const ad = document.getElementById('mdAdSoyad')?.textContent || 'Müşteri';
    const el = document.getElementById('mdSatisMusteri');
    if (el) el.textContent = ad;
    const arama = document.getElementById('mdSatisArama');
    if (arama) arama.value = '';
    musteriSatisAramaKatmanKapat();
    const odemeInp = document.getElementById('mdSatisOdenen');
    if (odemeInp) odemeInp.dataset.manual = '0';
    musteriSatisSepetKutuKaydirGuncelle();
    musteriSatisOzetGuncelle();
    setTimeout(() => document.getElementById('mdSatisArama')?.focus(), 200);
  });
}

async function musteriDetayUrunleriDoldur() {
  try {
    const response = await fetch('/api/stok');
    const stoklar = await response.json();
    musteriSatisStokCache = Array.isArray(stoklar) ? stoklar : [];
  } catch (e) {
    console.error(e);
  }
}

function musteriSatisStokFiltrele(kelime) {
  const raw = String(kelime || '').trim();
  if (!raw) return [];
  return musteriSatisStokCache.filter((s) => stokMetinAramaEslesir(s, raw)).slice(0, 20);
}

function musteriSatisAramaSonuclariniGizle() {
  musteriSatisAramaKatmanKapat();
}

function musteriSatisAraGuncelle(deger) {
  const aramaInp = document.getElementById('mdSatisArama');
  if (!aramaInp) return;
  const kelime = String(deger ?? aramaInp.value ?? '').trim();
  if (kelime.length < 1) {
    musteriSatisAramaKatmanKapat();
    return;
  }
  const filtreli = musteriSatisStokFiltrele(kelime);
  if (filtreli.length > 0) {
    const html = filtreli
      .map((urun) => {
        const fiyat = musteriDetayParaFmt(urun.SatisFiyati);
        const barkod = String(urun.Barkod || '').trim();
        const bk = barkod ? `<small class="text-muted ms-1">${gunlukMetinEsc(barkod)}</small>` : '';
        return `<button type="button" class="list-group-item list-group-item-action py-2"
          onclick="musteriSatisListedenSepeteById(${Number(urun.StokID)})">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <span class="fw-semibold">${gunlukMetinEsc(urun.UrunAdi || '')}${bk}</span>
            <span class="badge rounded-pill bg-primary">${gunlukMetinEsc(fiyat)}</span>
          </div>
          <small class="text-muted">Stok: ${Number(urun.MevcutMiktar || 0)} ${gunlukMetinEsc(urun.Birim || 'Adet')}</small>
        </button>`;
      })
      .join('');
    musteriSatisAramaKatmanGoster(aramaInp, html);
    return;
  }
  musteriSatisAramaKatmanGoster(
    aramaInp,
    `<button type="button" class="list-group-item list-group-item-action py-2 text-primary fw-semibold"
      onclick="musteriSatisAramaStokEkleTikla()">
      <i class="fa-solid fa-plus me-2"></i>Stokta yok — stoka ekle
    </button>`,
  );
}

function musteriSatisListedenSepeteById(stokID) {
  const urun = musteriSatisStokCache.find((s) => Number(s.StokID) === Number(stokID));
  if (urun) musteriSatisListedenSepete(urun);
}

function musteriSatisAramaStokEkleTikla() {
  const kelime = document.getElementById('mdSatisArama')?.value?.trim() || '';
  musteriSatisAramaKatmanKapat();
  musteriSatisStokEkleModalAc(kelime);
}

function musteriSatisHizmetMi(stok) {
  if (!stok) return false;
  const kat = String(stok.Kategori || '').toLocaleLowerCase('tr-TR');
  const ad = String(stok.UrunAdi || '').toLocaleLowerCase('tr-TR');
  return kat === 'hizmet' || ad.includes('işçilik') || ad.includes('iscilik');
}

function musteriSatisSayiOku(val) {
  if (val == null || val === '') return NaN;
  const s = String(val).trim().replace(/\s/g, '').replace(',', '.');
  return Number(s);
}

function musteriSatisListedenSepete(urun) {
  musteriSatisSepeteEkle(Number(urun.StokID));
  const arama = document.getElementById('mdSatisArama');
  if (arama) arama.value = '';
  musteriSatisAramaSonuclariniGizle();
  setTimeout(() => document.getElementById('mdSatisArama')?.focus(), 50);
}

async function musteriSatisAramaKeydown(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  ev.stopPropagation();
  const input = document.getElementById('mdSatisArama');
  const kelime = input ? input.value : '';
  const trimmed = String(kelime).trim();
  if (!trimmed) return;
  const filtreli = musteriSatisStokFiltrele(kelime);
  const exact = filtreli.find((s) => String(s.Barkod || '').trim() === trimmed);
  if (exact) {
    musteriSatisListedenSepete(exact);
    return;
  }
  if (filtreli.length === 1) {
    musteriSatisListedenSepete(filtreli[0]);
    return;
  }
  if (filtreli.length === 0) {
    musteriSatisStokEkleModalAc(trimmed);
  }
}

/** Müşteri satıştan: sadece stok ekle modalını açar (satış modalı açık kalır) */
function musteriSatisStokEkleModalAc(kelime) {
  const k = String(kelime || '').trim();
  musteriSatisStokEkleDonus = true;
  musteriSatisStokEkleSonKayit = null;
  stokEkleModalGoster(() => {
    stokDuzenlemeID = null;
    document.getElementById('stokModalBaslik').innerHTML =
      '<i class="fa-solid fa-plus"></i> Yeni Ürün Ekle';
    document.getElementById('stokEkleForm').reset();
    document.getElementById('kritikEsik').value = 5;
    document.getElementById('hedefEsik').value = 20;
    if (k) {
      if (hizliSatisBarkodGirisiMi(k)) document.getElementById('barkod').value = k;
      else document.getElementById('urunAdi').value = k;
    }
    const bilgi = document.getElementById('stokPiyasaBilgi');
    if (bilgi) bilgi.innerHTML = 'Henüz sorgu yok.';
    stokDuzenleBarkodAksiyonGuncelle();
  }).then(() => {
    const stokEl = document.getElementById('stokEkleModal');
    if (!stokEl) return;
    stokEl.style.zIndex = '1095';
    const backs = document.querySelectorAll('.modal-backdrop');
    const son = backs[backs.length - 1];
    if (son) son.style.zIndex = '1090';
  });
}

async function musteriSatisStokEkleDonusYap() {
  const kayit = musteriSatisStokEkleSonKayit;
  musteriSatisStokEkleSonKayit = null;
  if (!kayit) return;

  await musteriDetayUrunleriDoldur();
  let urun = null;
  if (kayit.barkod) {
    urun = musteriSatisStokCache.find(
      (s) => String(s.Barkod || '').trim() === kayit.barkod,
    );
  }
  if (!urun && kayit.urunAdi) {
    const adNorm = kayit.urunAdi.toLocaleLowerCase('tr-TR');
    urun = musteriSatisStokCache.find(
      (s) => String(s.UrunAdi || '').trim().toLocaleLowerCase('tr-TR') === adNorm,
    );
  }

  const arama = document.getElementById('mdSatisArama');
  if (arama) arama.value = '';
  musteriSatisAramaSonuclariniGizle();
  const eklenecekID = urun ? Number(urun.StokID) : 0;
  if (eklenecekID > 0) {
    musteriSatisSepeteEkle(eklenecekID);
  } else {
    alert('Ürün stoka eklendi. Listeden tekrar seçerek sepete ekleyin.');
  }
  setTimeout(() => arama?.focus(), 150);
}

function musteriSatisSepetSonEklenenOdak(urunID) {
  const stok = musteriSatisSepetStokBul(urunID);
  const satir = musteriSatisSepet.find((x) => Number(x.urunID) === Number(urunID));
  if (!musteriSatisHizmetMi(stok) || !satir || Number(satir.fiyat) > 0) return;
  setTimeout(() => {
    const tb = document.getElementById('mdSatisSepetGovde');
    if (!tb) return;
    const inp = tb.querySelector(`input[data-satis-fiyat="${urunID}"]`);
    inp?.focus();
    inp?.select();
  }, 60);
}

function musteriSatisSepetToplam() {
  return musteriSatisSepet.reduce((acc, s) => acc + (Number(s.miktar) * Number(s.fiyat)), 0);
}

function musteriSatisSepetStokBul(urunID) {
  return musteriSatisStokCache.find((s) => Number(s.StokID) === Number(urunID));
}

function musteriSatisSepetSatirTutarGuncelle(urunID) {
  const s = musteriSatisSepet.find((x) => Number(x.urunID) === Number(urunID));
  const tb = document.getElementById('mdSatisSepetGovde');
  if (!s || !tb) return;
  const row = tb.querySelector(`tr[data-satis-urun="${urunID}"]`);
  if (!row) return;
  const tutarEl = row.querySelector('[data-satis-tutar]');
  if (tutarEl) {
    tutarEl.textContent = musteriDetayParaFmt(Number(s.miktar) * Number(s.fiyat));
  }
}

function musteriSatisSepetMiktarInput(urunID, el) {
  const s = musteriSatisSepet.find((x) => Number(x.urunID) === Number(urunID));
  if (!s || !el) return;
  let miktar = parseInt(el.value, 10);
  if (!Number.isInteger(miktar) || miktar < 1) return;
  s.miktar = miktar;
  musteriSatisSepetSatirTutarGuncelle(urunID);
  musteriSatisOzetGuncelle();
}

function musteriSatisSepetMiktarDegisti(urunID, el) {
  const s = musteriSatisSepet.find((x) => Number(x.urunID) === Number(urunID));
  if (!s || !el) return;
  let miktar = parseInt(el.value, 10);
  if (!Number.isInteger(miktar) || miktar < 1) miktar = 1;
  s.miktar = miktar;
  el.value = String(miktar);
  musteriSatisSepetSatirTutarGuncelle(urunID);
  musteriSatisOzetGuncelle();
}

function musteriSatisSepetFiyatInput(urunID, el) {
  const s = musteriSatisSepet.find((x) => Number(x.urunID) === Number(urunID));
  if (!s || !el) return;
  const fiyat = musteriSatisSayiOku(el.value);
  if (!Number.isFinite(fiyat) || fiyat < 0) return;
  s.fiyat = Math.round(fiyat * 100) / 100;
  musteriSatisSepetSatirTutarGuncelle(urunID);
  musteriSatisOzetGuncelle();
}

function musteriSatisSepetFiyatDegisti(urunID, el) {
  const s = musteriSatisSepet.find((x) => Number(x.urunID) === Number(urunID));
  if (!s || !el) return;
  let fiyat = musteriSatisSayiOku(el.value);
  if (!Number.isFinite(fiyat) || fiyat < 0) {
    alert('Birim fiyat geçersiz.');
    el.value = Number(s.fiyat || 0).toFixed(2);
    return;
  }
  const stok = musteriSatisSepetStokBul(urunID);
  if (musteriSatisHizmetMi(stok) && fiyat <= 0) {
    alert('İşçilik / hizmet için birim fiyat girin.');
    el.value = Number(s.fiyat || 0).toFixed(2);
    el.focus();
    return;
  }
  s.fiyat = Math.round(fiyat * 100) / 100;
  el.value = s.fiyat.toFixed(2);
  musteriSatisSepetSatirTutarGuncelle(urunID);
  musteriSatisOzetGuncelle();
}

function musteriSatisSepetCiz() {
  const tb = document.getElementById('mdSatisSepetGovde');
  if (!tb) return;
  if (!musteriSatisSepet.length) {
    tb.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Sepet boş — üstten ürün ekleyin</td></tr>';
  } else {
    tb.innerHTML = musteriSatisSepet
      .map((s) => {
        const satirTutar = Number(s.miktar) * Number(s.fiyat);
        return `<tr data-satis-urun="${s.urunID}">
        <td class="small fw-semibold">${gunlukMetinEsc(s.urunAdi)}</td>
        <td class="text-center">
          <input type="number" min="1" step="1" class="form-control form-control-sm text-center" autocomplete="off"
            value="${s.miktar}" data-satis-miktar="${s.urunID}" data-otomatik-tamamlama="acik"
            oninput="musteriSatisSepetMiktarInput(${s.urunID}, this)"
            onchange="musteriSatisSepetMiktarDegisti(${s.urunID}, this)">
        </td>
        <td class="text-end">
          <input type="text" inputmode="decimal" autocomplete="off" class="form-control form-control-sm text-end buyuk-harf-kapali"
            value="${Number(s.fiyat || 0).toFixed(2)}" data-satis-fiyat="${s.urunID}" data-otomatik-tamamlama="acik"
            oninput="musteriSatisSepetFiyatInput(${s.urunID}, this)"
            onchange="musteriSatisSepetFiyatDegisti(${s.urunID}, this)">
        </td>
        <td class="text-end text-nowrap small fw-semibold" data-satis-tutar>${musteriDetayParaFmt(satirTutar)}</td>
        <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" onclick="musteriSatisSepettenSil(${s.urunID})" title="Sil"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`;
      })
      .join('');
  }
  musteriSatisSepetKutuKaydirGuncelle();
  musteriSatisOzetGuncelle();
}

function musteriSatisSepeteEkle(urunIDArg) {
  const urunID = Number(urunIDArg);
  const miktar = 1;
  if (!Number.isInteger(urunID) || urunID < 1) return;
  const stok = musteriSatisStokCache.find((s) => Number(s.StokID) === urunID);
  if (!stok) {
    alert('Ürün bulunamadı.');
    return;
  }
  const birimFiyat = Math.round(Number(stok.SatisFiyati || 0) * 100) / 100;
  const satir = musteriSatisSepet.find((s) => s.urunID === urunID);
  const yeniMiktar = (satir ? satir.miktar : 0) + miktar;
  if (satir) satir.miktar = yeniMiktar;
  else {
    musteriSatisSepet.push({
      urunID,
      urunAdi: stok.UrunAdi,
      fiyat: birimFiyat,
      miktar,
    });
  }
  musteriSatisSepetCiz();
  musteriSatisSepetSonEklenenOdak(urunID);
}

function musteriSatisSepettenSil(urunID) {
  musteriSatisSepet = musteriSatisSepet.filter((s) => s.urunID !== Number(urunID));
  musteriSatisSepetCiz();
}

function musteriHareketBakiyeDelta(h) {
  const tur = String(h.Tur || '').toLowerCase();
  const toplam = Number(h.ToplamTutar || 0);
  const odenen = Number(h.OdenenTutar || 0);
  const kalan = Number(h.KalanTutar || 0);
  if (tur === 'satis') {
    // Tek satırda tahsilat (müşteri satış): net borç = kalan
    if (odenen > 0) return Math.max(0, kalan);
    // Hızlı satış / sepet: satış + ayrı tahsilat satırı → brüt satış tutarı
    return Math.max(0, toplam);
  }
  if (tur === 'odeme') return -Math.max(0, odenen);
  if (tur === 'iade') return -(kalan > 0 ? kalan : toplam);
  if (tur === 'iadeodeme') return -Math.max(0, odenen);
  return 0;
}

function musteriHareketleriKronolojik(hareketler) {
  return [...(hareketler || [])].sort((a, b) => {
    const ta = new Date(a.Tarih).getTime();
    const tb = new Date(b.Tarih).getTime();
    if (ta !== tb) return ta - tb;
    return Number(a.HareketID || 0) - Number(b.HareketID || 0);
  });
}

/** Hareket sonrası kümülatif borç (makbuz alanından bağımsız, tutarlı yürüyen). */
function musteriYuruyenBakiyeMap(hareketler) {
  const asc = musteriHareketleriKronolojik(hareketler);
  let bakiye = 0;
  const map = new Map();
  for (const h of asc) {
    bakiye += musteriHareketBakiyeDelta(h);
    bakiye = Math.round(bakiye * 100) / 100;
    map.set(Number(h.HareketID), bakiye);
  }
  return map;
}

/** Cari tablo grupları — satış + bağlı tahsilat sonrası bakiye. */
function musteriCariGrupYuruyenMap(hareketler) {
  const list = hareketler || [];
  const asc = musteriHareketleriKronolojik(list);
  const hareketSon = musteriYuruyenBakiyeMap(list);
  const refOdeme = new Map();
  const refSatisSayisi = new Map();
  for (const h of list) {
    const ref = String(h.Referans || '').trim();
    const tur = (h.Tur || '').toLowerCase();
    if (!ref) continue;
    if (tur === 'odeme' || tur === 'iadeodeme') {
      if (!refOdeme.has(ref)) refOdeme.set(ref, []);
      refOdeme.get(ref).push(Number(h.HareketID));
    }
    if (tur === 'satis' || tur === 'iade') {
      refSatisSayisi.set(ref, (refSatisSayisi.get(ref) || 0) + 1);
    }
  }
  const grupSirasiBakiye = (ids) => {
    let son = null;
    const idSet = new Set(ids);
    for (const h of asc) {
      if (idSet.has(Number(h.HareketID))) {
        son = hareketSon.get(Number(h.HareketID));
      }
    }
    return son;
  };
  const grupMap = new Map();
  for (const h of list) {
    const tur = (h.Tur || '').toLowerCase();
    const hid = Number(h.HareketID);
    if (tur === 'satis' || tur === 'iade') {
      const ref = String(h.Referans || '').trim();
      const ids = [hid];
      if (ref && refSatisSayisi.get(ref) === 1 && refOdeme.has(ref)) {
        ids.push(...refOdeme.get(ref));
      }
      grupMap.set(`satis-${hid}`, grupSirasiBakiye(ids));
    } else if (tur === 'odeme' || tur === 'iadeodeme') {
      const ref = String(h.Referans || '').trim();
      if (ref && (refSatisSayisi.get(ref) || 0) > 0) continue;
      grupMap.set(`odeme-${hid}`, hareketSon.get(hid));
    }
  }
  return grupMap;
}

const MD_CARI_TABLO_KOLON = 8;
const MR_CARI_TABLO_KOLON = 7;

function musteriCariTahsilatSatirMi(row) {
  return (row.SatirTur || '') === 'tahsilat' || row.Kaynak === 'musteri_tahsilat';
}

function musteriCariKalemSatirMi(row) {
  const st = row.SatirTur || '';
  return st === 'satis_kalem' || st === 'iade_kalem';
}

/** Grup anahtarına göre satış/iade kalem toplamları (çok kalemli gruplarda ilk satırda gösterilir). */
function musteriCariGrupSatisToplamMap(satirlar) {
  const map = new Map();
  for (const row of satirlar || []) {
    if (!musteriCariKalemSatirMi(row)) continue;
    const key = row.GrupAnahtar || gunlukIslemGrupAnahtari(row);
    if (!key) continue;
    const prev = map.get(key) || { toplam: 0, adet: 0 };
    prev.toplam = Math.round((prev.toplam + Number(row.Tutar || 0)) * 100) / 100;
    prev.adet += 1;
    map.set(key, prev);
  }
  return map;
}

function musteriCariUrunAdiFallback(h) {
  let metin = String(h.Aciklama || '').trim();
  if (metin.startsWith('[Mobil]')) metin = metin.slice(7).trim();
  if (metin) return metin;
  return 'Satış';
}

function musteriCariTahsilatSatiriOlustur(h, grupKey, anaHareketID) {
  const tur = (h.Tur || '').toLowerCase();
  const iadeOdeme = tur === 'iadeodeme';
  return {
    Tarih: h.Tarih,
    AnaHareketID: anaHareketID || h.HareketID,
    HareketID: h.HareketID,
    TahsilatHareketID: h.HareketID,
    Kullanici: h.Kullanici,
    MobilKaynak: h.MobilKaynak,
    Tur: h.Tur,
    SatirTur: 'tahsilat',
    Kaynak: 'musteri_tahsilat',
    GrupAnahtar: grupKey,
    TurEtiket: iadeOdeme ? 'İade Ödeme' : 'Tahsilat',
    Odeme: h.OdemeSekli || '—',
    Tutar: Number(h.OdenenTutar || 0),
    YuruyenHareketID: h.HareketID,
  };
}

function musteriCariTahsilatGomuluOlustur(h, grupKey) {
  const tur = (h.Tur || '').toLowerCase();
  const iade = tur === 'iade';
  return {
    Tarih: h.Tarih,
    AnaHareketID: h.HareketID,
    HareketID: h.HareketID,
    TahsilatHareketID: h.HareketID,
    Kullanici: h.Kullanici,
    MobilKaynak: h.MobilKaynak,
    Tur: h.Tur,
    SatirTur: 'tahsilat',
    Kaynak: 'musteri_tahsilat',
    GrupAnahtar: grupKey,
    TurEtiket: iade ? 'İade Ödeme' : 'Tahsilat',
    Odeme: h.OdemeSekli || '—',
    Tutar: Number(h.OdenenTutar || 0),
    YuruyenHareketID: h.HareketID,
    GomuluTahsilat: true,
  };
}

function musteriCariGenelSatiri(h) {
  const tur = (h.Tur || '').toLowerCase();
  const odemeMi = tur === 'odeme';
  const iadeOdemeMi = tur === 'iadeodeme';
  const iadeMi = tur === 'iade';
  const satisMi = tur === 'satis';
  let turEtiket = 'Hareket';
  if (odemeMi) turEtiket = 'Tahsilat';
  else if (iadeOdemeMi) turEtiket = 'İade Ödeme';
  else if (iadeMi) turEtiket = 'İade';
  else if (satisMi) turEtiket = 'Satış';
  const tutar = odemeMi || iadeOdemeMi ? Number(h.OdenenTutar || 0) : Number(h.ToplamTutar || 0);
  return {
    Tarih: h.Tarih,
    AnaHareketID: h.HareketID,
    HareketID: h.HareketID,
    TahsilatHareketID: h.HareketID,
    Kullanici: h.Kullanici,
    MobilKaynak: h.MobilKaynak,
    Tur: h.Tur,
    SatirTur: odemeMi || iadeOdemeMi ? 'tahsilat' : satisMi || iadeMi ? 'satis_kalem' : 'genel',
    Kaynak: odemeMi || iadeOdemeMi ? 'musteri_tahsilat' : 'musteri_satis',
    GrupAnahtar: `hareket-${h.HareketID}`,
    TurEtiket: turEtiket,
    Odeme: h.OdemeSekli || '—',
    UrunAdi: musteriCariUrunAdiFallback(h),
    Miktar: 1,
    BirimFiyat: tutar,
    Tutar: tutar,
    KalemSira: 0,
    YuruyenHareketID: h.HareketID,
  };
}

/** Müşteri cari — günlük işlemler ile aynı kalem + tahsilat alt satırı düzeni. */
function musteriCariOdemeEslestir(hareketler) {
  const refOdeme = new Map();
  const refSatislari = new Map();
  for (const h of hareketler || []) {
    const ref = String(h.Referans || '').trim();
    const tur = (h.Tur || '').toLowerCase();
    if (!ref) continue;
    if (tur === 'odeme' || tur === 'iadeodeme') {
      if (!refOdeme.has(ref)) refOdeme.set(ref, []);
      refOdeme.get(ref).push(h);
    }
    if (tur === 'satis' || tur === 'iade') {
      if (!refSatislari.has(ref)) refSatislari.set(ref, []);
      refSatislari.get(ref).push(h);
    }
  }
  for (const arr of refOdeme.values()) {
    arr.sort((a, b) => Number(a.HareketID) - Number(b.HareketID));
  }
  for (const arr of refSatislari.values()) {
    arr.sort((a, b) => Number(a.HareketID) - Number(b.HareketID));
  }

  const odemeAtananSatis = new Map();
  const satisOdemeleri = new Map();
  for (const [ref, odemeler] of refOdeme) {
    const satislar = refSatislari.get(ref) || [];
    for (const o of odemeler) {
      const oid = Number(o.HareketID);
      let enYakinSatis = null;
      for (const s of satislar) {
        const sid = Number(s.HareketID);
        if (sid <= oid && (!enYakinSatis || sid > Number(enYakinSatis.HareketID))) {
          enYakinSatis = s;
        }
      }
      if (enYakinSatis) {
        const sid = Number(enYakinSatis.HareketID);
        odemeAtananSatis.set(oid, sid);
        if (!satisOdemeleri.has(sid)) satisOdemeleri.set(sid, []);
        satisOdemeleri.get(sid).push(o);
      }
    }
  }
  return { odemeAtananSatis, satisOdemeleri };
}

function musteriCariListeSatirlari(hareketler) {
  const list = hareketler || [];
  const { odemeAtananSatis, satisOdemeleri } = musteriCariOdemeEslestir(list);
  const cikti = [];

  for (const h of list) {
    const tur = (h.Tur || '').toLowerCase();

    if (tur === 'odeme' || tur === 'iadeodeme') {
      if (odemeAtananSatis.has(Number(h.HareketID))) continue;
      cikti.push(musteriCariTahsilatSatiriOlustur(h, `odeme-${h.HareketID}`));
      continue;
    }

    if (tur === 'satis' || tur === 'iade') {
      const iade = tur === 'iade';
      const grupKey = `satis-${h.HareketID}`;
      const detaylar =
        Array.isArray(h.detaylar) && h.detaylar.length
          ? h.detaylar
          : [
              {
                UrunAdi: musteriCariUrunAdiFallback(h),
                Miktar: 1,
                BirimFiyat: Number(h.ToplamTutar || 0),
                SatirTutar: Number(h.ToplamTutar || 0),
              },
            ];
      detaylar.forEach((d, i) => {
        cikti.push({
          Tarih: h.Tarih,
          AnaHareketID: h.HareketID,
          HareketID: h.HareketID,
          Kullanici: h.Kullanici,
          MobilKaynak: h.MobilKaynak,
          Tur: h.Tur,
          SatirTur: iade ? 'iade_kalem' : 'satis_kalem',
          Kaynak: 'musteri_satis',
          GrupAnahtar: grupKey,
          KalemSira: i,
          UrunAdi: d.UrunAdi || '-',
          Miktar: Number(d.Miktar || 0),
          BirimFiyat: Number(d.BirimFiyat || 0),
          Tutar: Number(d.SatirTutar || 0),
          TurEtiket: iade ? 'İade' : 'Satış',
          Odeme: h.OdemeSekli,
          YuruyenHareketID: h.HareketID,
        });
      });
      const odemeler = satisOdemeleri.get(Number(h.HareketID)) || [];
      for (const o of odemeler) {
        cikti.push(musteriCariTahsilatSatiriOlustur(o, grupKey, h.HareketID));
      }
      if (Number(h.OdenenTutar || 0) > 0.009 && !odemeler.length) {
        cikti.push(musteriCariTahsilatGomuluOlustur(h, grupKey));
      }
      continue;
    }

    cikti.push(musteriCariGenelSatiri(h));
  }
  return cikti;
}

function musteriCariTabloSatirHtml(row, grupYuruyenMap, opts = {}) {
  const rapor = !!opts.rapor;
  const yazdir = !!opts.yazdir;
  const grupSatisMap = opts.grupSatisMap || null;
  const tarihStr = tarihTrGoster(row.Tarih);
  const kalem = musteriCariKalemSatirMi(row);
  const tahsilat = musteriCariTahsilatSatirMi(row);
  const iadeKalem = (row.SatirTur || '') === 'iade_kalem';
  const turRaw = (row.Tur || '').toLowerCase();
  const turEtiket = row.TurEtiket || 'Satış';
  const mobilIkon =
    !yazdir && row.MobilKaynak
      ? ' <i class="fa-solid fa-mobile-screen-button text-info" title="Mobil"></i>'
      : '';
  const etiketMetin = gunlukIslemTurEtiketMetin(row, turEtiket);

  let turBadge = 'bg-danger';
  if (tahsilat) {
    turBadge = turEtiket === 'İade Ödeme' ? 'bg-warning text-dark' : 'bg-success';
  } else if (iadeKalem || turRaw === 'iade') {
    turBadge = 'bg-warning text-dark';
  }

  const miktar = Number(row.Miktar || 0);
  const satirTutar = Number(row.Tutar || 0);
  let birimSayi = Number(row.BirimFiyat || 0);
  if (birimSayi <= 0 && satirTutar > 0 && miktar > 0) {
    birimSayi = Math.round((satirTutar / miktar) * 100) / 100;
  }
  const birimFmt = birimSayi > 0 ? musteriDetayParaFmt(birimSayi) : '—';
  const tutarStr = musteriDetayParaFmt(satirTutar);

  const grupKey = row.GrupAnahtar || gunlukIslemGrupAnahtari(row);
  const grupBilgi = grupKey && grupSatisMap ? grupSatisMap.get(grupKey) : null;
  const grupToplamGoster =
    kalem &&
    row.GunlukTurBaslikGoster !== false &&
    grupBilgi &&
    grupBilgi.adet > 1 &&
    grupBilgi.toplam > 0.009;
  const grupToplamStr = grupToplamGoster
    ? musteriDetayParaFmt(grupBilgi.toplam)
    : '';
  const turAlt = grupToplamGoster
    ? `<div class="small fw-bold text-danger mt-1" title="Bu satışın toplamı">${gunlukMetinEsc(grupToplamStr)}</div>`
    : '';

  const yuruyen =
    row.GunlukGrupSon && row.GrupAnahtar ? grupYuruyenMap.get(row.GrupAnahtar) : null;

  if (yazdir) {
    const tarihHucre =
      row.GunlukTarihGoster === false
        ? '<td></td>'
        : `<td class="nw">${gunlukMetinEsc(tarihStr)}</td>`;
    const turHucre =
      row.GunlukTurBaslikGoster === false
        ? '<td></td>'
        : `<td>${gunlukMetinEsc(etiketMetin)}${grupToplamGoster ? `<br><b>${gunlukMetinEsc(grupToplamStr)}</b>` : ''}</td>`;
    const yuruyenHucre =
      row.GunlukGrupSon && yuruyen != null
        ? `<td class="r b">${gunlukMetinEsc(musteriDetayParaFmt(yuruyen))}</td>`
        : '<td></td>';
    if (kalem) {
      return `<tr>${tarihHucre}${turHucre}<td>${gunlukMetinEsc(row.UrunAdi || '-')}</td><td class="c">${miktar}</td><td class="r">${gunlukMetinEsc(birimFmt)}</td><td class="r">${gunlukMetinEsc(tutarStr)}</td>${yuruyenHucre}</tr>`;
    }
    return `<tr>${tarihHucre}${turHucre}<td>—</td><td class="c">—</td><td class="r">—</td><td class="r">${gunlukMetinEsc(tutarStr)}</td>${yuruyenHucre}</tr>`;
  }

  const anaId = Number(row.AnaHareketID || row.HareketID);
  const tahsilatId = Number(row.TahsilatHareketID || row.HareketID);
  const ilkSatir = row.GunlukTurBaslikGoster !== false;
  const duzenleBtnSatis =
    !rapor && ilkSatir && kalem && turRaw === 'satis'
      ? `<button type="button" class="btn btn-sm btn-warning text-dark me-1" title="Düzenle" onclick="musteriHareketDuzenleAc(${anaId}, 'satis')"><i class="fa-solid fa-pencil"></i></button>`
      : '';
  const duzenleBtnTahsilat =
    !rapor && tahsilat && satirTutar > 0.009
      ? `<button type="button" class="btn btn-sm btn-warning text-dark me-1" title="Düzenle" onclick="musteriHareketDuzenleAc(${tahsilatId}, 'odeme')"><i class="fa-solid fa-pencil"></i></button>`
      : '';
  const makbuzBtn = '';
  const silBtn =
    !rapor && ilkSatir
      ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="musteriHareketSil(${anaId})">Sil</button>`
      : '';
  const islemHucre = rapor
    ? ''
    : `<td class="text-end text-nowrap">${makbuzBtn}${duzenleBtnTahsilat}${duzenleBtnSatis}${silBtn || '<span class="text-muted small">—</span>'}</td>`;

  const yuruyenHucre =
    row.GunlukGrupSon && yuruyen != null
      ? `<td class="text-end text-nowrap small fw-semibold text-dark">${musteriDetayParaFmt(yuruyen)}</td>`
      : '<td class="gunluk-hucre-bos"></td>';

  if (kalem) {
    const kalemCls = iadeKalem ? ' gunluk-kalem-satir gunluk-mal-alim-kalem' : ' gunluk-kalem-satir';
    const tutarCls = iadeKalem ? 'gunluk-mal-alim-tutar' : 'gunluk-kalem-tutar';
    return `<tr class="${gunlukIslemSatirSiniflari(row, kalemCls)}">
      ${gunlukIslemTarihHucre(row, tarihStr)}
      ${gunlukIslemTurHucre(row, turBadge, turEtiket, mobilIkon, '', turAlt)}
      <td class="gunluk-kalem-urun">${gunlukMetinEsc(row.UrunAdi || '-')}</td>
      <td class="text-center text-nowrap">${miktar}</td>
      <td class="text-end text-nowrap">${birimFmt}</td>
      <td class="text-end text-nowrap ${tutarCls}">${tutarStr}</td>
      ${yuruyenHucre}
      ${islemHucre}
    </tr>`;
  }

  let tutClass = tahsilat ? 'text-success' : 'text-dark';
  if (iadeKalem) tutClass = 'text-danger';

  return `<tr class="${gunlukIslemSatirSiniflari(row)}">
    ${gunlukIslemTarihHucre(row, tarihStr)}
    ${gunlukIslemTurHucre(row, turBadge, turEtiket, mobilIkon)}
    <td><span class="text-muted">—</span></td>
    <td class="text-center text-muted">—</td>
    <td class="text-end text-muted">—</td>
    <td class="text-end fw-semibold text-nowrap ${tutClass}">${tutarStr}</td>
    ${yuruyenHucre}
    ${islemHucre}
  </tr>`;
}

function musteriCariHareketTabloHtml(hareketler, opts = {}) {
  const grupYuruyenMap = musteriCariGrupYuruyenMap(hareketler);
  const satirlar = gunlukIslemGruplariIsaretle(musteriCariListeSatirlari(hareketler));
  const grupSatisMap = musteriCariGrupSatisToplamMap(satirlar);
  return satirlar
    .map((row) => musteriCariTabloSatirHtml(row, grupYuruyenMap, { ...opts, grupSatisMap }))
    .join('');
}

function musteriDetayHareketTabloDoldur(hareketler) {
  const tb = document.getElementById('mdHareketGovde');
  if (!tb) return;
  if (!hareketler || !hareketler.length) {
    tb.innerHTML = `<tr><td colspan="${MD_CARI_TABLO_KOLON}" class="text-center text-muted py-4">Hareket yok.</td></tr>`;
    return;
  }
  tb.innerHTML = musteriCariHareketTabloHtml(hareketler);
}

async function musteriDetayYukle() {
  if (!aktifMusteriDetayID) return;
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/hareketler`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Müşteri hareketleri alınamadı.');

  const m = data.musteri || {};
  aktifMusteriDetayData = m;
  const o = data.ozet || {};
  const tuzel = musteriTuzelMi(m);
  const gorunenAd = musteriGorunenAd(m);
  document.getElementById('mdAdSoyad').textContent = gorunenAd;
  document.getElementById('mdVurguluAd').textContent = gorunenAd;
  const turBadge = document.getElementById('mdTurBadge');
  if (turBadge) {
    turBadge.textContent = musteriTurEtiket(m);
    turBadge.className = musteriTurBadgeSinif(tuzel);
  }
  const gercekAd = String(m.AdSoyad || '').trim();
  const firma = String(m.FirmaAdi || '').trim();
  const yetkili = String(m.yetkili || '').trim();
  const tc = String(m.tcno || '').trim();
  const vergi = String(m.vergino || '').trim();
  const tanim = String(m.TanimAdi || '').trim();
  const adGoster = document.getElementById('mdAdSoyadGoster');
  if (adGoster) adGoster.textContent = gercekAd || '-';
  document.getElementById('mdFirma').textContent = firma || '-';
  document.getElementById('mdYetkili').textContent = yetkili || '-';
  document.getElementById('mdTcNo').textContent = tc || '-';
  document.getElementById('mdVergiNo').textContent = vergi || '-';
  document.getElementById('mdTanimAdi').textContent = tanim || '-';
  document.getElementById('mdGercekAdSatir')?.classList.toggle('d-none', tuzel);
  document.getElementById('mdFirmaSatir').classList.toggle('d-none', !tuzel || !firma);
  document.getElementById('mdYetkiliSatir').classList.toggle('d-none', !tuzel || !yetkili);
  document.getElementById('mdTcSatir').classList.toggle('d-none', tuzel || !tc);
  document.getElementById('mdVergiSatir').classList.toggle('d-none', !tuzel || !vergi);
  document.getElementById('mdTanimAdiSatir').classList.toggle('d-none', !tanim);
  document.getElementById('mdTelefon').textContent = m.Telefon || '-';
  const ilIlce = [m.Il || '', m.Ilce || ''].filter(Boolean).join(' / ');
  document.getElementById('mdIlIlce').textContent = ilIlce || '-';
  document.getElementById('mdMahalle').textContent = m.Mahalle || '-';
  document.getElementById('mdAdres').textContent = m.Adres || '-';
  document.getElementById('mdToplamSatis').textContent = musteriDetayParaFmt(o.toplamSatis);
  document.getElementById('mdToplamOdeme').textContent = musteriDetayParaFmt(o.toplamOdeme);
  document.getElementById('mdKalanBakiye').textContent = musteriDetayParaFmt(o.kalanBakiye);
  aktifMusteriHareketler = data.hareketler || [];
  musteriDetayHareketTabloDoldur(aktifMusteriHareketler);
}

async function musteriDetayModalAc(id) {
  aktifMusteriDetayID = id;
  musteriDetayModalGeriAc = false;
  if (document.getElementById('musteriListeModal')?.classList.contains('show')) {
    musteriListeModalGeriAc = true;
  }
  document.getElementById('mdHareketGovde').innerHTML =
    `<tr><td colspan="${MD_CARI_TABLO_KOLON}" class="text-center text-muted py-4">Yükleniyor…</td></tr>`;
  document.getElementById('musteriDetayOdemeForm').reset();
  document.getElementById('musteriDetaySatisForm').reset();
  musteriSatisSepet = [];
  document.getElementById('mdSatisOdenen').value = 0;
  document.getElementById('mdSatisOdenen').dataset.manual = '0';
  musteriSatisSepetCiz();
  musteriDetaySatisOdemeAlaniGuncelle();
  await musteriDetayUrunleriDoldur();
  await musteriDetayYukle();
  await musteriListeModalGeciciKapat();
  modalAc(document.getElementById('musteriDetayModal'));
}

function musteriDuzenleModalAc() {
  const id = aktifMusteriDetayID;
  if (!id) return;
  musteriAltModalAc(document.getElementById('musteriDuzenleModal'), () => {
    const m = aktifMusteriDetayData || {};
    document.getElementById('mdDuzenleMusteriID').value = String(id);
    musteriFormTurSec('duzenle', m.tur);
    musteriDuzenleTurKilit(m.tur);
    document.getElementById('mdDuzenleAdSoyad').value = m.AdSoyad || '';
    document.getElementById('mdDuzenleFirma').value = m.FirmaAdi || '';
    document.getElementById('mdDuzenleYetkili').value = m.yetkili || '';
    document.getElementById('mdDuzenleTcNo').value = m.tcno || '';
    document.getElementById('mdDuzenleVergiNo').value = m.vergino || '';
    document.getElementById('mdDuzenleTanimAdi').value = m.TanimAdi || '';
    document.getElementById('mdDuzenleTelefon').value = m.Telefon || '';
    document.getElementById('mdDuzenleIl').value = m.Il || 'Konya';
    document.getElementById('mdDuzenleIlce').value = m.Ilce || 'Sarayönü';
    musteriAdresBagimliSecimler('duzenle', m.Mahalle || '');
    document.getElementById('mdDuzenleAdres').value = m.Adres || '';
  });
}

async function musteriDuzenleKaydet(event) {
  event.preventDefault();
  const id = parseInt(document.getElementById('mdDuzenleMusteriID').value, 10);
  if (!id) return;
  if (!musteriFormDogrulaClient('duzenle')) return;
  const body = {
    ...musteriFormVeriTopla('duzenle'),
    Bakiye: Number((document.getElementById('mdKalanBakiye').textContent || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0,
  };
  const res = await fetch(`/api/musteri/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.message || (await res.text().catch(() => '')) || 'Müşteri güncellenemedi.');
    return;
  }
  const inst = bootstrap.Modal.getInstance(document.getElementById('musteriDuzenleModal'));
  if (inst) inst.hide();
  await musteriDetayYukle();
  musterileriGetir();
}

async function musteriDetayOdemeKaydet(event) {
  event.preventDefault();
  if (!aktifMusteriDetayID) return;
  const body = {
    tutar: parseFloat(document.getElementById('mdOdemeTutar').value),
    odemeSekli: document.getElementById('mdOdemeSekli').value,
    aciklama: document.getElementById('mdOdemeAciklama').value.trim() || null,
    kullanici: aktifKullanici,
  };
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/odeme`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'Tahsilat kaydedilemedi.');
    return;
  }
  const tahsilatModalEl = document.getElementById('musteriTahsilatModal');
  const tahsilatModal = tahsilatModalEl ? bootstrap.Modal.getInstance(tahsilatModalEl) : null;
  const tahsilatSonrasi = async () => {
    odemeSonrasiBildir(data.message || 'Tahsilat kaydedildi.', data?.makbuz);
    document.getElementById('musteriDetayOdemeForm').reset();
    await musteriDetayYukle();
    musterileriGetir();
    ozetBilgileriniGetir();
  };
  if (tahsilatModal && tahsilatModalEl) {
    tahsilatModalEl.addEventListener('hidden.bs.modal', tahsilatSonrasi, { once: true });
    tahsilatModal.hide();
  } else {
    await tahsilatSonrasi();
  }
}

async function musteriDetaySatisKaydet(event) {
  event.preventDefault();
  if (!aktifMusteriDetayID) return;
  if (!musteriSatisSepet.length) {
    alert('Sepete en az bir ürün ekleyin.');
    return;
  }
  const hataliHizmet = musteriSatisSepet.find((s) => {
    const stok = musteriSatisSepetStokBul(s.urunID);
    return musteriSatisHizmetMi(stok) && Number(s.fiyat) <= 0;
  });
  if (hataliHizmet) {
    alert('İşçilik satırında birim fiyat girin.');
    musteriSatisSepetSonEklenenOdak(hataliHizmet.urunID);
    return;
  }
  if (musteriSatisSepetToplam() <= 0) {
    alert('Sepet toplamı sıfır olamaz. Birim fiyatları kontrol edin.');
    return;
  }
  const odemeVar = document.getElementById('mdOdemeVarMi').checked;
  const body = {
    kalemler: musteriSatisSepet.map((s) => ({ urunID: s.urunID, miktar: s.miktar, birimFiyat: s.fiyat })),
    odemeVarMi: odemeVar,
    odenenTutar: odemeVar ? parseFloat(document.getElementById('mdSatisOdenen').value || '0') : 0,
    odemeSekli: document.getElementById('mdSatisOdemeSekli').value,
    aciklama: document.getElementById('mdSatisAciklama').value.trim() || null,
    kullanici: aktifKullanici,
  };
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/satis-sepet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'Satış kaydedilemedi.');
    return;
  }
  const satisModalEl = document.getElementById('musteriSatisModal');
  const satisModal = satisModalEl ? bootstrap.Modal.getInstance(satisModalEl) : null;
  const satisSonrasi = async () => {
    odemeSonrasiBildir(data.message || 'Satış kaydedildi.', data?.makbuz);
    document.getElementById('musteriDetaySatisForm').reset();
    musteriSatisSepet = [];
    document.getElementById('mdSatisOdenen').value = 0;
    document.getElementById('mdSatisOdenen').dataset.manual = '0';
    musteriSatisSepetCiz();
    musteriDetaySatisOdemeAlaniGuncelle();
    await musteriDetayUrunleriDoldur();
    await musteriDetayYukle();
    musterileriGetir();
    stoklariGetir();
    ozetBilgileriniGetir();
  };
  if (satisModal && satisModalEl) {
    satisModalEl.addEventListener('hidden.bs.modal', satisSonrasi, { once: true });
    satisModal.hide();
  } else {
    await satisSonrasi();
  }
}

async function musteriIadeKaydet(event) {
  event.preventDefault();
  if (!aktifMusteriDetayID) return;
  if (!musteriIadeSepet.length) {
    alert('İade sepetine en az bir ürün ekleyin.');
    return;
  }
  const paraIadesiVarMi = document.getElementById('mdParaIadesiVar').checked;
  const body = {
    kalemler: musteriIadeSepet.map((s) => ({
      stokID: s.stokID,
      urunAdi: s.urunAdi,
      miktar: s.miktar,
      birimFiyat: s.birimFiyat,
    })),
    paraIadesiVarMi,
    iadeTutar: paraIadesiVarMi ? parseFloat(document.getElementById('mdIadePara').value || '0') : 0,
    odemeSekli: document.getElementById('mdIadeOdemeSekli').value,
    aciklama: document.getElementById('mdIadeAciklama').value.trim() || null,
    kullanici: aktifKullanici,
  };
  const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/iade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'İade kaydedilemedi.');
    return;
  }
  alert(data.message || 'İade kaydedildi.');
  const inst = bootstrap.Modal.getInstance(document.getElementById('musteriIadeModal'));
  if (inst) inst.hide();
  await musteriDetayYukle();
  await musteriDetayUrunleriDoldur();
  musterileriGetir();
  stoklariGetir();
  ozetBilgileriniGetir();
}

let sonIslemDetayYazdirVeri = null;

function hareketTurEtiket(tur) {
  const t = (tur || '').toLowerCase();
  if (t === 'odeme') return 'Tahsilat';
  if (t === 'iade') return 'İade';
  if (t === 'iadeodeme') return 'İade Ödeme';
  return 'Satış';
}

function musteriHareketMobilMi(h) {
  if (!h) return false;
  if (h.MobilKaynak) return true;
  const a = String(h.Aciklama || '');
  const r = String(h.Referans || '');
  if (a.startsWith('[Mobil]')) return true;
  if (/^mobil:/i.test(r)) return true;
  if (/mobil tahsilat/i.test(a)) return true;
  return false;
}

function musteriMobilIkonHtml(h) {
  return musteriHareketMobilMi(h)
    ? ' <i class="fa-solid fa-mobile-screen-button text-info" title="Mobil"></i>'
    : '';
}

function musteriHareketAltAciklama(h) {
  const turRaw = (h.Tur || '').toLowerCase();
  if (turRaw === 'odeme' || turRaw === 'iadeodeme') {
    const odeme = String(h.OdemeSekli || '').trim();
    return odeme && odeme !== '—' ? odeme : '';
  }
  let metin = String(h.Aciklama || '').trim();
  if (metin.startsWith('[Mobil]')) metin = metin.slice(7).trim();
  if (metin) return metin;
  if (turRaw === 'satis') return 'Satış işlemi';
  if (turRaw === 'iade') return 'İade işlemi';
  return '';
}

/** Tahsilat vb. için tür hücresi alt açıklama */
function musteriHareketTurAltHtml(h) {
  const alt = musteriHareketAltAciklama(h);
  return alt ? `<div class="small text-muted mt-1">${gunlukMetinEsc(alt)}</div>` : '';
}

/** Satış / iade: genel satırın altında fatura satırları (Tür / Satış hizasından başlar) */
/** Günlük işlemler tablosu — müşteri cari ile aynı fatura alt satırı */
const GUNLUK_TABLO_KOLON = 8;

function gunlukIslemFaturaAltSatirHtml(row, toplamKolon = GUNLUK_TABLO_KOLON) {
  const detaylar = Array.isArray(row.detaylar) ? row.detaylar : [];
  if (!detaylar.length) return '';
  const kaynak = row.Kaynak || '';
  const malAlim = kaynak === 'mal_alim';
  const govde = detaylar
    .map((d) => {
      const ad = gunlukMetinEsc(d.UrunAdi || '-');
      const miktar = Number(d.Miktar || 0);
      const birim = musteriDetayParaFmt(d.BirimFiyat);
      const satir = musteriDetayParaFmt(d.SatirTutar);
      return `<tr class="musteri-hareket-fatura-satir">
        <td class="fatura-urun">${ad}</td>
        <td class="fatura-miktar text-center text-nowrap">${miktar}</td>
        <td class="fatura-birim text-end text-nowrap">${birim}</td>
        <td class="fatura-tutar text-end text-nowrap fw-semibold">${satir}</td>
      </tr>`;
    })
    .join('');
  const baslikCls = malAlim ? 'musteri-hareket-fatura-iade' : 'musteri-hareket-fatura-satis';
  const faturaColspan = Math.max(1, toplamKolon - 1);
  return `<tr class="musteri-hareket-fatura-wrap ${baslikCls}">
    <td class="musteri-hareket-fatura-tarih-bos"></td>
    <td colspan="${faturaColspan}" class="p-0 musteri-hareket-fatura-hucre">
      <div class="musteri-hareket-fatura-kutu">
        <table class="table table-sm table-borderless mb-0 musteri-hareket-fatura-tablo">
          <thead>
            <tr class="small text-muted">
              <th>Ürün / hizmet</th>
              <th class="text-center" style="width:4.5rem">Adet</th>
              <th class="text-end" style="width:7.5rem">Birim fiyat</th>
              <th class="text-end" style="width:8rem">Tutar</th>
            </tr>
          </thead>
          <tbody>${govde}</tbody>
        </table>
      </div>
    </td>
  </tr>`;
}

function musteriHareketFaturaAltSatirHtml(h, toplamKolon = 8) {
  const turRaw = (h.Tur || '').toLowerCase();
  if (turRaw !== 'satis' && turRaw !== 'iade') return '';
  const detaylar = Array.isArray(h.detaylar) ? h.detaylar : [];
  let govde = '';
  if (detaylar.length) {
    govde = detaylar
      .map((d) => {
        const ad = gunlukMetinEsc(d.UrunAdi || '-');
        const miktar = Number(d.Miktar || 0);
        const birim = musteriDetayParaFmt(d.BirimFiyat);
        const satir = musteriDetayParaFmt(d.SatirTutar);
        return `<tr class="musteri-hareket-fatura-satir">
          <td class="fatura-urun">${ad}</td>
          <td class="fatura-miktar text-center text-nowrap">${miktar}</td>
          <td class="fatura-birim text-end text-nowrap">${birim}</td>
          <td class="fatura-tutar text-end text-nowrap fw-semibold">${satir}</td>
        </tr>`;
      })
      .join('');
  } else {
    const alt = musteriHareketAltAciklama(h);
    if (!alt || alt === 'Satış işlemi' || alt === 'İade işlemi') return '';
    govde = `<tr><td colspan="4" class="small text-muted py-2">${gunlukMetinEsc(alt)}</td></tr>`;
  }
  const baslikCls = turRaw === 'iade' ? 'musteri-hareket-fatura-iade' : 'musteri-hareket-fatura-satis';
  const faturaColspan = Math.max(1, toplamKolon - 1);
  return `<tr class="musteri-hareket-fatura-wrap ${baslikCls}">
    <td class="musteri-hareket-fatura-tarih-bos"></td>
    <td colspan="${faturaColspan}" class="p-0 musteri-hareket-fatura-hucre">
      <div class="musteri-hareket-fatura-kutu">
        <table class="table table-sm table-borderless mb-0 musteri-hareket-fatura-tablo">
          <thead>
            <tr class="small text-muted">
              <th>Ürün / hizmet</th>
              <th class="text-center" style="width:4.5rem">Adet</th>
              <th class="text-end" style="width:7.5rem">Birim fiyat</th>
              <th class="text-end" style="width:8rem">Tutar</th>
            </tr>
          </thead>
          <tbody>${govde}</tbody>
        </table>
      </div>
    </td>
  </tr>`;
}

function musteriHareketDuzenleTurGoster(tip, h) {
  const turMetin =
    tip === 'odeme' ? hareketTurEtiket(h.Tur) || 'Tahsilat' : hareketTurEtiket(h.Tur) || 'Satış';
  const satisMi = tip === 'satis' && turMetin !== 'İade';
  const iadeMi = tip === 'satis' && turMetin === 'İade';
  const tahsilatMi = tip === 'odeme' && turMetin === 'Tahsilat';

  let badgeClass = 'bg-secondary';
  let bannerClass = 'alert-secondary';
  let aciklama = '';
  if (satisMi) {
    badgeClass = 'bg-danger';
    bannerClass = 'alert-danger';
    aciklama = 'Adet ve birim fiyatı değiştirebilir, üstten yeni ürün ekleyebilirsiniz. Stok otomatik güncellenir.';
  } else if (iadeMi) {
    badgeClass = 'bg-warning text-dark';
    bannerClass = 'alert-warning';
    aciklama = 'İade kalemlerinde adet ve birim fiyatı düzenleyebilirsiniz.';
  } else if (tahsilatMi) {
    badgeClass = 'bg-success';
    bannerClass = 'alert-success';
    aciklama = 'Tahsilatın ödeme türünü ve tutarını düzenleyebilirsiniz.';
  } else {
    badgeClass = 'bg-warning text-dark';
    bannerClass = 'alert-warning';
    aciklama = 'Ödeme türünü ve tutarını düzenleyebilirsiniz.';
  }

  const baslikEl = document.getElementById('mhdDuzenleBaslik');
  const badgeEl = document.getElementById('mhdDuzenleTurBadge');
  const bannerEl = document.getElementById('mhdDuzenleTurBanner');
  const turMetinEl = document.getElementById('mhdDuzenleTurMetin');
  const aciklamaEl = document.getElementById('mhdDuzenleTurAciklama');
  if (baslikEl) baslikEl.textContent = `${turMetin} Düzenle`;
  if (badgeEl) {
    badgeEl.textContent = turMetin;
    badgeEl.className = `badge ${badgeClass}`;
  }
  if (bannerEl) bannerEl.className = `alert py-2 px-3 mb-3 small ${bannerClass}`;
  if (turMetinEl) turMetinEl.textContent = `${turMetin} işlemi düzenleniyor`;
  if (aciklamaEl) aciklamaEl.textContent = aciklama;
}

let mhdDuzenleKalemler = [];
let mhdDuzenleSeciliStok = null;
let mhdDuzenleSatirSayac = 0;

function mhdDuzenleSatirTutarHesapla(k) {
  const m = Math.max(1, Math.round(Number(k.miktar) || 1));
  const bf = Math.round((Number(k.birimFiyat) || 0) * 100) / 100;
  return Math.round(m * bf * 100) / 100;
}

function mhdDuzenleSatisToplamGuncelle() {
  const top = mhdDuzenleKalemler.reduce((s, k) => s + mhdDuzenleSatirTutarHesapla(k), 0);
  const el = document.getElementById('mhdDuzenleSatisToplam');
  if (el) el.textContent = musteriDetayParaFmt(Math.round(top * 100) / 100);
}

function mhdDuzenleSatisTabloCiz() {
  const tb = document.getElementById('mhdDuzenleSatisGovde');
  if (!tb) return;
  if (!mhdDuzenleKalemler.length) {
    tb.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Kalem yok — üstten ürün ekleyin</td></tr>';
    mhdDuzenleSatisToplamGuncelle();
    return;
  }
  tb.innerHTML = mhdDuzenleKalemler
    .map((k, idx) => {
      const satirTutar = mhdDuzenleSatirTutarHesapla(k);
      return `<tr data-mhd-idx="${idx}">
        <td class="small fw-semibold">${gunlukMetinEsc(k.urunAdi || '-')}</td>
        <td class="text-center">
          <div class="input-group input-group-sm justify-content-center" style="max-width:7.5rem;margin:0 auto;">
            <button type="button" class="btn btn-outline-secondary" onclick="mhdDuzenleMiktarDegistir(${idx}, -1)" title="Azalt">−</button>
            <input type="number" min="1" step="1" class="form-control text-center mhd-duzenle-miktar"
              value="${Number(k.miktar) || 1}" oninput="mhdDuzenleMiktarInput(${idx}, this)">
            <button type="button" class="btn btn-outline-secondary" onclick="mhdDuzenleMiktarDegistir(${idx}, 1)" title="Artır">+</button>
          </div>
        </td>
        <td class="text-end">
          <input type="number" min="0" step="0.01" class="form-control form-control-sm text-end mhd-duzenle-birim"
            value="${Number(k.birimFiyat || 0).toFixed(2)}" oninput="mhdDuzenleBirimInput(${idx}, this)">
        </td>
        <td class="text-end text-nowrap small fw-semibold text-danger mhd-duzenle-satir-tutar">${musteriDetayParaFmt(satirTutar)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="mhdDuzenleKalemSil(${idx})" title="Satırı sil"><i class="fa-solid fa-xmark"></i></button>
        </td>
      </tr>`;
    })
    .join('');
  mhdDuzenleSatisToplamGuncelle();
}

function mhdDuzenleMiktarDegistir(idx, delta) {
  const k = mhdDuzenleKalemler[idx];
  if (!k) return;
  k.miktar = Math.max(1, (Number(k.miktar) || 1) + delta);
  mhdDuzenleSatisTabloCiz();
}

function mhdDuzenleMiktarInput(idx, el) {
  const k = mhdDuzenleKalemler[idx];
  if (!k || !el) return;
  let m = parseInt(el.value, 10);
  if (!Number.isInteger(m) || m < 1) return;
  k.miktar = m;
  const tutarEl = el.closest('tr')?.querySelector('.mhd-duzenle-satir-tutar');
  if (tutarEl) tutarEl.textContent = musteriDetayParaFmt(mhdDuzenleSatirTutarHesapla(k));
  mhdDuzenleSatisToplamGuncelle();
}

function mhdDuzenleBirimInput(idx, el) {
  const k = mhdDuzenleKalemler[idx];
  if (!k || !el) return;
  const bf = Number(el.value);
  if (!Number.isFinite(bf) || bf < 0) return;
  k.birimFiyat = Math.round(bf * 100) / 100;
  const tutarEl = el.closest('tr')?.querySelector('.mhd-duzenle-satir-tutar');
  if (tutarEl) tutarEl.textContent = musteriDetayParaFmt(mhdDuzenleSatirTutarHesapla(k));
  mhdDuzenleSatisToplamGuncelle();
}

function mhdDuzenleKalemSil(idx) {
  if (mhdDuzenleKalemler.length <= 1) {
    alert('Satışta en az bir kalem kalmalı.');
    return;
  }
  mhdDuzenleKalemler.splice(idx, 1);
  mhdDuzenleSatisTabloCiz();
}

function mhdDuzenleUrunAraSonucGizle() {
  const el = document.getElementById('mhdDuzenleUrunSonuc');
  if (el) {
    el.classList.add('d-none');
    el.innerHTML = '';
  }
}

function mhdDuzenleUrunAraGuncelle(deger) {
  const q = String(deger || '').trim();
  const kutu = document.getElementById('mhdDuzenleUrunSonuc');
  if (!kutu) return;
  if (q.length < 1) {
    mhdDuzenleUrunAraSonucGizle();
    return;
  }
  const kaynak = (musteriSatisStokCache && musteriSatisStokCache.length)
    ? musteriSatisStokCache
    : (stokListeCache || []);
  const liste = kaynak.filter((s) => stokMetinAramaEslesir(s, q)).slice(0, 15);
  if (!liste.length) {
    kutu.innerHTML = '<div class="list-group-item small text-muted">Ürün bulunamadı</div>';
    kutu.classList.remove('d-none');
    return;
  }
  kutu.innerHTML = liste
    .map((u) => {
      const fiyat = musteriDetayParaFmt(u.SatisFiyati);
      return `<button type="button" class="list-group-item list-group-item-action py-2"
        onclick="mhdDuzenleUrunSec(${Number(u.StokID)})">
        <div class="d-flex justify-content-between gap-2">
          <span class="fw-semibold small">${gunlukMetinEsc(u.UrunAdi || '')}</span>
          <span class="badge bg-primary">${gunlukMetinEsc(fiyat)}</span>
        </div>
        <small class="text-muted">Stok: ${Number(u.MevcutMiktar || 0)}</small>
      </button>`;
    })
    .join('');
  kutu.classList.remove('d-none');
}

function mhdDuzenleUrunSec(stokID) {
  const kaynak = (musteriSatisStokCache && musteriSatisStokCache.length)
    ? musteriSatisStokCache
    : (stokListeCache || []);
  const u = kaynak.find((s) => Number(s.StokID) === Number(stokID));
  if (!u) return;
  mhdDuzenleSeciliStok = u;
  const metin = document.getElementById('mhdDuzenleSeciliUrunMetin');
  if (metin) {
    metin.innerHTML = `Seçili: <strong>${gunlukMetinEsc(u.UrunAdi)}</strong> · ${gunlukMetinEsc(musteriDetayParaFmt(u.SatisFiyati))}`;
  }
  const btn = document.getElementById('mhdDuzenleEkleBtn');
  if (btn) btn.disabled = false;
  const ara = document.getElementById('mhdDuzenleUrunAra');
  if (ara) ara.value = u.UrunAdi || '';
  mhdDuzenleUrunAraSonucGizle();
}

function mhdDuzenleSeciliUrunEkle() {
  if (!mhdDuzenleSeciliStok) {
    alert('Önce listeden ürün seçin.');
    return;
  }
  const adetEl = document.getElementById('mhdDuzenleEkleAdet');
  let miktar = parseInt(adetEl?.value, 10);
  if (!Number.isInteger(miktar) || miktar < 1) miktar = 1;
  const stokID = Number(mhdDuzenleSeciliStok.StokID);
  const mevcut = mhdDuzenleKalemler.find((k) => Number(k.stokID) === stokID && Number(k.stokID) > 0);
  if (mevcut) {
    mevcut.miktar = (Number(mevcut.miktar) || 0) + miktar;
  } else {
    mhdDuzenleSatirSayac += 1;
    mhdDuzenleKalemler.push({
      key: `yeni-${mhdDuzenleSatirSayac}`,
      detayID: 0,
      stokID,
      urunAdi: mhdDuzenleSeciliStok.UrunAdi || 'Ürün',
      miktar,
      birimFiyat: Math.round(Number(mhdDuzenleSeciliStok.SatisFiyati || 0) * 100) / 100,
    });
  }
  mhdDuzenleSeciliStok = null;
  const btn = document.getElementById('mhdDuzenleEkleBtn');
  if (btn) btn.disabled = true;
  const ara = document.getElementById('mhdDuzenleUrunAra');
  if (ara) ara.value = '';
  if (adetEl) adetEl.value = '1';
  const metin = document.getElementById('mhdDuzenleSeciliUrunMetin');
  if (metin) metin.textContent = 'Listeden ürün seçin, adet yazıp Ekle’ye basın.';
  mhdDuzenleSatisTabloCiz();
}

function mhdDuzenleUrunAraKeydown(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  if (mhdDuzenleSeciliStok) mhdDuzenleSeciliUrunEkle();
}

async function musteriHareketDuzenleAc(hareketID, tip) {
  const res = await fetch(`/api/musteri/hareket/${hareketID}/detay`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.message || 'Hareket bilgisi alınamadı.');
    return;
  }
  const h = data.hareket || {};
  const detaylar = data.detaylar || [];
  const musteriAd = aktifMusteriDetayData ? musteriGorunenAd(aktifMusteriDetayData) : '-';

  document.getElementById('mhdDuzenleHareketID').value = String(hareketID);
  document.getElementById('mhdDuzenleTip').value = tip;
  document.getElementById('mhdDuzenleMusteri').textContent = musteriAd;
  document.getElementById('mhdDuzenleTarih').textContent = tarihTrGoster(h.Tarih);
  musteriHareketDuzenleTurGoster(tip, h);

  const satisAlani = document.getElementById('mhdDuzenleSatisAlani');
  const odemeAlani = document.getElementById('mhdDuzenleOdemeAlani');
  if (tip === 'satis') {
    satisAlani.classList.remove('d-none');
    odemeAlani.classList.add('d-none');
    if (!musteriSatisStokCache.length && !(stokListeCache || []).length) {
      try {
        const sr = await fetch('/api/stok');
        const stoklar = await sr.json();
        musteriSatisStokCache = Array.isArray(stoklar) ? stoklar : [];
      } catch (_) {}
    }
    mhdDuzenleSeciliStok = null;
    mhdDuzenleSatirSayac = 0;
    if (!detaylar.length) {
      mhdDuzenleKalemler = [
        {
          key: 'eski-0',
          detayID: 0,
          stokID: 0,
          urunAdi: h.Aciklama || 'Satış',
          miktar: 1,
          birimFiyat: Math.round(Number(h.ToplamTutar || 0) * 100) / 100,
        },
      ];
    } else {
      mhdDuzenleKalemler = detaylar.map((d, i) => ({
        key: `d-${Number(d.DetayID) || i}`,
        detayID: Number(d.DetayID || 0),
        stokID: Number(d.StokID || 0),
        urunAdi: d.UrunAdi || '-',
        miktar: Number(d.Miktar || 1),
        birimFiyat: Math.round(Number(d.BirimFiyat || 0) * 100) / 100,
      }));
    }
    const ara = document.getElementById('mhdDuzenleUrunAra');
    if (ara) ara.value = '';
    const adetEl = document.getElementById('mhdDuzenleEkleAdet');
    if (adetEl) adetEl.value = '1';
    const btn = document.getElementById('mhdDuzenleEkleBtn');
    if (btn) btn.disabled = true;
    const metin = document.getElementById('mhdDuzenleSeciliUrunMetin');
    if (metin) metin.textContent = 'Listeden ürün seçin, adet yazıp Ekle’ye basın.';
    mhdDuzenleUrunAraSonucGizle();
    mhdDuzenleSatisTabloCiz();
  } else {
    satisAlani.classList.add('d-none');
    odemeAlani.classList.remove('d-none');
    const odemeEl = document.getElementById('mhdDuzenleOdemeSekli');
    const tutarEl = document.getElementById('mhdDuzenleTutar');
    if (odemeEl) odemeEl.value = h.OdemeSekli || 'Nakit';
    if (tutarEl) tutarEl.value = Number(h.OdenenTutar || h.ToplamTutar || 0).toFixed(2);
  }

  await musteriDetayModalGeciciKapat();
  modalAc(document.getElementById('musteriHareketDuzenleModal'));
}

async function musteriHareketDuzenleKaydet() {
  const hareketID = parseInt(document.getElementById('mhdDuzenleHareketID').value, 10);
  const tip = document.getElementById('mhdDuzenleTip').value;
  if (!Number.isInteger(hareketID) || hareketID < 1) return;

  let body = { tip, kullanici: aktifKullanici || 'Sistem' };
  if (tip === 'satis') {
    if (!mhdDuzenleKalemler.length) {
      alert('En az bir kalem olmalı.');
      return;
    }
    const kalemler = mhdDuzenleKalemler.map((k) => {
      const miktar = Math.max(1, Math.round(Number(k.miktar) || 1));
      const birimFiyat = Math.round((Number(k.birimFiyat) || 0) * 100) / 100;
      return {
        detayID: Number(k.detayID) || 0,
        stokID: Number(k.stokID) || 0,
        urunAdi: k.urunAdi || '',
        miktar,
        birimFiyat,
        satirTutar: Math.round(miktar * birimFiyat * 100) / 100,
      };
    });
    for (const k of kalemler) {
      if (k.birimFiyat < 0 || k.satirTutar <= 0) {
        alert('Birim fiyat / satır tutarı geçersiz.');
        return;
      }
    }
    body.kalemler = kalemler;
  } else if (tip === 'odeme') {
    body.tutar = Number(document.getElementById('mhdDuzenleTutar')?.value || 0);
    body.odemeSekli = document.getElementById('mhdDuzenleOdemeSekli')?.value || 'Nakit';
  } else {
    return;
  }

  const res = await fetch(`/api/musteri/hareket/${hareketID}/duzenle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'Düzenleme kaydedilemedi.');
    return;
  }
  modalKapat(document.getElementById('musteriHareketDuzenleModal'));
  alert(data.message || 'Kaydedildi.');
  await musteriDetayYukle();
  musterileriGetir();
  stoklariGetir();
  ozetBilgileriniGetir();
}

async function musteriHareketDetayAc(hareketID) {
  const res = await fetch(`/api/musteri/hareket/${hareketID}/detay`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.message || 'Detay alınamadı.');
    return;
  }
  const h = data.hareket || {};
  const detaylar = data.detaylar || [];
  const musteriAd = aktifMusteriDetayData ? musteriGorunenAd(aktifMusteriDetayData) : '-';
  sonIslemDetayYazdirVeri = { h, detaylar, musteriAd };

  const mhdMusteri = document.getElementById('mhdMusteri');
  if (mhdMusteri) mhdMusteri.textContent = musteriAd;
  document.getElementById('mhdTur').textContent = hareketTurEtiket(h.Tur);
  document.getElementById('mhdTarih').textContent = tarihTrGoster(h.Tarih);
  document.getElementById('mhdKullanici').textContent = h.Kullanici || 'Sistem';

  const tb = document.getElementById('mhdGovde');
  if (!detaylar.length) {
    tb.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Bu işlem için satır detayı yok.</td></tr>';
  } else {
    tb.innerHTML = detaylar
      .map((d) => `<tr>
        <td>${gunlukMetinEsc(d.UrunAdi || '-')}</td>
        <td class="text-center">${Number(d.Miktar || 0)}</td>
        <td class="text-end">${musteriDetayParaFmt(d.BirimFiyat)}</td>
        <td class="text-end fw-semibold">${musteriDetayParaFmt(d.SatirTutar)}</td>
      </tr>`)
      .join('');
  }
  await musteriDetayModalGeciciKapat();
  modalAc(document.getElementById('musteriHareketDetayModal'));
}

function islemDetayDokumaniOlustur(h, detaylar, musteriAd) {
  const company = {
    unvan: gunlukMetinEsc(uygulamaAyarlari?.SirketUnvan || 'ŞİRKET BİLGİSİ'),
    tel: gunlukMetinEsc(uygulamaAyarlari?.SirketTelefon || '-'),
  };
  const tur = gunlukMetinEsc(hareketTurEtiket(h.Tur));
  const tarih = gunlukMetinEsc(tarihTrGoster(h.Tarih));
  const kullanici = gunlukMetinEsc(h.Kullanici || 'Sistem');
  const musteri = gunlukMetinEsc(musteriAd || '-');
  const toplam = gunlukMetinEsc(musteriDetayParaFmt(h.ToplamTutar));
  const liste = Array.isArray(detaylar) ? detaylar : [];
  const satirlar = liste.length
    ? liste
        .map(
          (d) => `<tr>
        <td>${gunlukMetinEsc(d.UrunAdi || '-')}</td>
        <td class="c">${Number(d.Miktar || 0)}</td>
        <td class="r">${gunlukMetinEsc(musteriDetayParaFmt(d.BirimFiyat))}</td>
        <td class="r b">${gunlukMetinEsc(musteriDetayParaFmt(d.SatirTutar))}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="c muted">Satır detayı yok.</td></tr>';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>İşlem Detayı</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; font-size: 13px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .firm { font-size: 12px; color: #444; margin-bottom: 14px; }
    .meta { margin-bottom: 14px; line-height: 1.55; }
    .meta b { display: inline-block; min-width: 108px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; }
    th { background: #f1f5f9; text-align: left; font-size: 12px; }
    td.c { text-align: center; }
    td.r { text-align: right; }
    td.b { font-weight: 700; }
    td.muted { color: #666; padding: 12px; }
    .ozet { margin-top: 12px; text-align: right; font-size: 14px; }
    .ozet span { display: inline-block; margin-left: 16px; }
  </style>
</head>
<body>
  <h1>İşlem Detayı</h1>
  <div class="firm">${company.unvan}${company.tel !== '-' ? ` · Tel: ${company.tel}` : ''}</div>
  <div class="meta">
    <div><b>Müşteri:</b> ${musteri}</div>
    <div><b>Tür:</b> ${tur}</div>
    <div><b>Tarih:</b> ${tarih}</div>
    <div><b>İşlemi Yapan:</b> ${kullanici}</div>
  </div>
  <table>
    <thead>
      <tr><th>Ürün</th><th style="text-align:center;width:70px">Adet</th><th style="text-align:right;width:100px">Birim fiyat</th><th style="text-align:right;width:110px">Satır tutar</th></tr>
    </thead>
    <tbody>${satirlar}</tbody>
  </table>
  <div class="ozet"><b>Toplam:</b> ${toplam}</div>
</body>
</html>`;
}

function belgeOnizlemeKapat() {
  const katman = document.getElementById('belgeOnizlemeKatman');
  if (!katman) return;
  katman.classList.add('d-none');
  katman.setAttribute('aria-hidden', 'true');
  const hedef = document.getElementById('belgeOnizlemeIcerik');
  if (hedef) hedef.innerHTML = '';
  if (!document.querySelector('.modal.show')) {
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  }
  modalArtigiTemizle();
}

function belgeOnizlemeAcHtml(html, baslikHtml, opts = {}) {
  sonMakbuzDokumani = html;
  sonCariEkstreModu = !!opts.ekstre;
  const katman = document.getElementById('belgeOnizlemeKatman');
  const baslik = document.getElementById('belgeOnizlemeBaslik');
  const hedef = document.getElementById('belgeOnizlemeIcerik');
  const pdfBtn = document.getElementById('belgeOnizlemePdfBtn');
  if (!katman || !hedef) return;
  if (baslik) baslik.innerHTML = baslikHtml || '<i class="fa-solid fa-file-lines me-2"></i>Önizleme';
  hedef.innerHTML = `<iframe title="Önizleme" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>`;
  if (pdfBtn) pdfBtn.classList.toggle('d-none', !sonCariEkstreModu);
  katman.classList.remove('d-none');
  katman.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function belgeOnizlemeEscDinleyici(e) {
  if (e.key !== 'Escape') return;
  const katman = document.getElementById('belgeOnizlemeKatman');
  if (katman && !katman.classList.contains('d-none')) belgeOnizlemeKapat();
}

if (!window._belgeOnizlemeEscBagli) {
  window._belgeOnizlemeEscBagli = true;
  document.addEventListener('keydown', belgeOnizlemeEscDinleyici);
}

function musteriHareketDetayYazdirOnizle() {
  if (!sonIslemDetayYazdirVeri) return;
  const { h, detaylar, musteriAd } = sonIslemDetayYazdirVeri;
  belgeOnizlemeAcHtml(
    islemDetayDokumaniOlustur(h, detaylar, musteriAd),
    '<i class="fa-solid fa-file-invoice me-2"></i>İşlem Detayı — Yazdır'
  );
}

async function musteriHareketSil(hareketID) {
  if (!confirm('Bu işlemi silmek istiyor musunuz? Stok, cari ve kasa kayıtları geri alınır.')) return;
  const res = await fetch(`/api/musteri/hareket/${hareketID}?kullanici=${encodeURIComponent(aktifKullanici || 'Sistem')}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'İşlem silinemedi.');
    return;
  }
  alert(data.message || 'İşlem silindi.');
  await musteriDetayYukle();
  musterileriGetir();
  stoklariGetir();
  ozetBilgileriniGetir();
}

document.addEventListener('input', (e) => {
  if (e.target && e.target.id === 'mdSatisOdenen') {
    e.target.dataset.manual = '1';
  }
  if (e.target && e.target.id === 'mdIadePara') {
    e.target.dataset.manual = '1';
  }
  if (e.target && e.target.id === 'hizliSatisOdeyecegiTutar') {
    e.target.dataset.manual = '1';
  }
});

async function servisleriGetir() {
  try {
    const response = await fetch('/api/servis');
    const servisler = await response.json();

    const tabloGovdesi = document.getElementById('servisTabloGovdesi');
    tabloGovdesi.innerHTML = '';

    if (servisler.length === 0) {
      tabloGovdesi.innerHTML =
        '<tr><td colspan="6" class="text-center text-muted p-4">Açık veya geçmiş servis kaydı bulunmuyor.</td></tr>';
      return;
    }

    servisler.forEach((servis) => {
      let durumRenk = 'bg-primary';
      if (servis.Durum === 'Tamamlandı') durumRenk = 'bg-success';
      if (servis.Durum === 'İptal') durumRenk = 'bg-danger';

      tabloGovdesi.innerHTML += `
        <tr>
          <td class="align-middle fw-bold text-muted">SRV-${servis.ServisID}</td>
          <td class="align-middle fw-bold text-dark">${servis.AdSoyad || 'Bilinmeyen Müşteri'}</td>
          <td class="align-middle text-truncate" style="max-width: 250px;">${servis.ArizaAciklamasi}</td>
          <td class="align-middle"><span class="badge ${durumRenk}">${servis.Durum}</span></td>
          <td class="align-middle fw-bold text-dark">${servis.ToplamTutar ? servis.ToplamTutar.toFixed(2) : '0.00'}</td>
          <td class="align-middle text-end">
            <button type="button" class="btn btn-sm btn-outline-secondary me-1" onclick="servisFisiYazdir(${servis.ServisID})" title="Fiş"><i class="fa-solid fa-print"></i></button>
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="servisSil(${servis.ServisID})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    });
  } catch (hata) {
    console.error('Servisler çekilirken hata:', hata);
  }
}

async function musteriListesiniDoldur() {
  try {
    const response = await fetch('/api/musteri');
    const musteriler = await response.json();
    const selectEl = document.getElementById('servisMusteriID');

    selectEl.innerHTML = '<option value="">-- Müşteri Seç --</option>' +
      musteriler.map((m) => `<option value="${m.MusteriID}">${gunlukMetinEsc(musteriGorunenAd(m))}</option>`).join('');
  } catch (hata) {
    console.error('Müşteri listesi çekilemedi:', hata);
  }
}

async function servisKaydet(event) {
  event.preventDefault();
  const yeniServis = {
    MusteriID: parseInt(document.getElementById('servisMusteriID').value, 10),
    ArizaAciklamasi: document.getElementById('arizaAciklama').value,
    IscilikUcreti: parseFloat(document.getElementById('iscilik').value) || 0,
    MalzemeTutari: parseFloat(document.getElementById('malzemeTutar').value) || 0,
    Durum: document.getElementById('servisDurum').value,
  };

  try {
    const response = await fetch('/api/servis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(yeniServis),
    });

    if (response.ok) {
      document.getElementById('servisEkleForm').reset();
      modalKapat(document.getElementById('servisEkleModal'));
      servisleriGetir();
      ozetBilgileriniGetir();
    } else {
      alert('Servis eklenirken hata oluştu.');
    }
  } catch (hata) {
    console.error('Kayıt hatası:', hata);
  }
}

async function servisSil(id) {
  if (!confirm('Bu servis kaydını silmek istediğinize emin misiniz?')) return;
  try {
    const response = await fetch(`/api/servis/${id}`, { method: 'DELETE' });
    if (response.ok) {
      servisleriGetir();
      ozetBilgileriniGetir();
    }
  } catch (hata) {
    console.error('Silme hatası:', hata);
  }
}

document.getElementById('servisEkleModal').addEventListener('show.bs.modal', function () {
  musteriListesiniDoldur();
});
const musteriDuzenleModalEl = document.getElementById('musteriDuzenleModal');
if (musteriDuzenleModalEl) {
  musteriDuzenleModalEl.addEventListener('hidden.bs.modal', musteriDuzenleTurKilidiKaldir);
}

const musteriEkleModalEl = document.getElementById('musteriEkleModal');
if (musteriEkleModalEl) {
  musteriEkleModalEl.addEventListener('show.bs.modal', function () {
    const ilEl = document.getElementById('musteriIl');
    const ilceEl = document.getElementById('musteriIlce');
    if (ilEl) ilEl.value = 'Konya';
    if (ilceEl) ilceEl.value = 'Sarayönü';
    musteriAdresBagimliSecimler('ekle');
    musteriFormTurSec('ekle', 'Gercek');
    if (typeof tarayiciOneriModalYenile === 'function') tarayiciOneriModalYenile(musteriEkleModalEl);
  });
}

async function ozetBilgileriniGetir() {
  try {
    const response = await fetch('/api/ozet');
    const ozet = await response.json();

    const ciro = ozet.GunlukCiro != null ? ozet.GunlukCiro : 0;
    const gunEl = document.getElementById('kutuGunlukCiro');
    if (gunEl) gunEl.textContent = ozetParaFmt(ciro);

    const srv = document.getElementById('kutuServis');
    if (srv) srv.textContent = ozetAdetFmt(ozet.ToplamMusteri ?? 0);

    const nAlacak = document.getElementById('kutuNotAlacak');
    if (nAlacak) nAlacak.textContent = ozetParaFmt(ozet.ToplamAlacak);
    const nTed = document.getElementById('kutuNotTedarikci');
    if (nTed) nTed.textContent = ozetParaFmt(ozet.TedarikciBorcToplam);
    const nStok = document.getElementById('kutuNotStok');
    if (nStok) nStok.textContent = ozetParaFmt(ozet.StokDegerToplam);

    const st = document.getElementById('kutuStok');
    if (st) {
      const n = stokToplamUrunSayisi() || Number(ozet.ToplamStokUrun ?? ozet.KritikStok ?? 0);
      st.textContent = ozetAdetFmt(n);
    }
    const ted = document.getElementById('kutuTedarikci');
    if (ted) ted.textContent = ozetAdetFmt(ozet.ToplamTedarikci ?? 0);
    stokOzetPanelleriniGuncelle();
    ozetEnCokSatanYukle();
    ozetRakamlariUygula();
  } catch (hata) {
    console.error('Özet bilgileri çekilirken hata:', hata);
  }
}

const OZET_RAKAM_STORAGE = 'elektrik_ozet_rakam_gizli';

function ozetParaFmt(v) {
  const n = Number(v || 0);
  return `${(Number.isFinite(n) ? n : 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₺`;
}

function ozetAdetFmt(v) {
  const n = Number(v || 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('tr-TR');
}

function ozetRakamlariGizliMi() {
  try {
    return localStorage.getItem(OZET_RAKAM_STORAGE) === '1';
  } catch (_) {
    return false;
  }
}

function ozetRakamlariUygula() {
  const grid = document.getElementById('ozetRozetGrid');
  const ikon = document.getElementById('ozetRakamToggleIkon');
  const btn = document.getElementById('ozetRakamToggle');
  const gizli = ozetRakamlariGizliMi();
  if (grid) grid.classList.toggle('ozet-rakam-gizli', gizli);
  if (ikon) {
    ikon.classList.toggle('fa-eye', !gizli);
    ikon.classList.toggle('fa-eye-slash', gizli);
  }
  if (btn) btn.title = gizli ? 'Parasal değerleri göster' : 'Parasal değerleri gizle';
}

function ozetRakamlariToggle(ev) {
  if (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  }
  let gizli = !ozetRakamlariGizliMi();
  try {
    localStorage.setItem(OZET_RAKAM_STORAGE, gizli ? '1' : '0');
  } catch (_) {}
  ozetRakamlariUygula();
}

function enCokSatanYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function enCokSatanVarsayilanTarihler() {
  const bit = new Date();
  const bas = new Date();
  bas.setDate(bas.getDate() - 30);
  return { baslangic: enCokSatanYmd(bas), bitis: enCokSatanYmd(bit) };
}

function enCokSatanParaFmt(v) {
  return `${Number(v || 0).toFixed(2)} ₺`;
}

function enCokSatanMetinEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function enCokSatanBirim(r) {
  const b = String(r?.Birim || '').trim();
  return b || 'Adet';
}

function enCokSatanMiktarBirimli(miktar, r) {
  const n = Number(miktar);
  const sayi = Number.isFinite(n) ? String(n) : '0';
  return `${sayi} ${enCokSatanMetinEsc(enCokSatanBirim(r))}`;
}

async function enCokSatanApiGetir(opts = {}) {
  const v = enCokSatanVarsayilanTarihler();
  const baslangic = opts.baslangic || v.baslangic;
  const bitis = opts.bitis || v.bitis;
  const limit = opts.limit != null ? opts.limit : 10;
  const perKategori = opts.perKategori != null ? opts.perKategori : 5;
  const u = new URL('/api/stok/en-cok-satilan', window.location.origin);
  u.searchParams.set('baslangic', baslangic);
  u.searchParams.set('bitis', bitis);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('perKategori', String(perKategori));
  const res = await fetch(u);
  if (!res.ok) throw new Error('İstek başarısız');
  return res.json();
}

async function ozetEnCokSatanYukle() {
  const ul = document.getElementById('ozetEnCokSatanListe');
  if (!ul) return;
  try {
    const data = await enCokSatanApiGetir({ limit: 5 });
    const liste = data.urunler || [];
    if (!liste.length) {
      ul.innerHTML = '<li class="text-muted small">Bu dönemde satış yok</li>';
      return;
    }
    ul.innerHTML = liste
      .map(
        (r) => `<li title="${enCokSatanMetinEsc(r.UrunAdi)}">
          <span class="sira">${r.Sira || ''}.</span>
          <span class="urun">${enCokSatanMetinEsc(r.UrunAdi)}</span>
          <span class="adet">${enCokSatanMiktarBirimli(r.ToplamAdet, r)}</span>
        </li>`
      )
      .join('');
  } catch (e) {
    console.error(e);
    ul.innerHTML = '<li class="text-muted small">Yüklenemedi</li>';
  }
}

function enCokSatanTarihVarsayilan() {
  const t = enCokSatanVarsayilanTarihler();
  const bas = document.getElementById('ecsBaslangic');
  const bit = document.getElementById('ecsBitis');
  if (bas) bas.value = t.baslangic;
  if (bit) bit.value = t.bitis;
}

async function enCokSatanTarihVarsayilanVeYukle() {
  enCokSatanTarihVarsayilan();
  await enCokSatanListele();
}

async function enCokSatanModalAc() {
  const el = document.getElementById('enCokSatanModal');
  if (!el) return;
  enCokSatanTarihVarsayilan();
  bootstrap.Modal.getOrCreateInstance(el).show();
  await enCokSatanListele();
}

async function enCokSatanListele() {
  const tbody = document.getElementById('enCokSatanTablosu');
  if (!tbody) return;
  const bas = document.getElementById('ecsBaslangic')?.value || '';
  const bit = document.getElementById('ecsBitis')?.value || '';
  if (!bas || !bit) {
    alert('Başlangıç ve bitiş tarihlerini seçin.');
    return;
  }
  tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Yükleniyor…</td></tr>';
  try {
    const data = await enCokSatanApiGetir({ baslangic: bas, bitis: bit, limit: 30, perKategori: 5 });
    const gruplar = data.gruplar || [];
    if (!gruplar.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Bu tarihler arasında satış yok.</td></tr>';
      return;
    }
    const satirlar = [];
    for (const g of gruplar) {
      satirlar.push(`<tr class="ecs-kat-baslik">
        <td colspan="5"><i class="fa-solid fa-folder-open me-1 opacity-75"></i>${enCokSatanMetinEsc(g.Kategori || 'Diğer')}</td>
      </tr>`);
      for (const r of g.urunler || []) {
        const stok =
          r.MevcutMiktar == null
            ? '<span class="text-muted">—</span>'
            : enCokSatanMiktarBirimli(r.MevcutMiktar, r);
        satirlar.push(`<tr>
          <td class="text-secondary fw-semibold">${r.Sira || ''}</td>
          <td>${enCokSatanMetinEsc(r.UrunAdi)}</td>
          <td class="text-center text-nowrap">${stok}</td>
          <td class="text-end fw-bold text-success text-nowrap">${enCokSatanMiktarBirimli(r.ToplamAdet, r)}</td>
          <td class="text-end text-nowrap">${enCokSatanParaFmt(r.ToplamTutar)}</td>
        </tr>`);
      }
    }
    tbody.innerHTML = satirlar.join('');
  } catch (e) {
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Veriler yüklenemedi.</td></tr>';
  }
}

function karYaziRenkAyarla(el, val) {
  if (!el) return;
  const n = Number(val || 0);
  el.classList.remove('text-success', 'text-danger', 'text-dark');
  if (n > 0) el.classList.add('text-success');
  else if (n < 0) el.classList.add('text-danger');
  else el.classList.add('text-dark');
}

let musteriRaporlarSonData = null;

function musteriRaporTurFiltreDegeri() {
  const v = document.getElementById('mrTurFiltre')?.value;
  return v === 'satis' || v === 'tahsilat' ? v : 'tumu';
}

function musteriRaporHareketTuru(h) {
  return String(h?.Tur || '').toLowerCase();
}

function musteriRaporHareketleriFiltrele(hareketler, filtre) {
  const list = Array.isArray(hareketler) ? hareketler : [];
  const f = filtre || 'tumu';
  if (f === 'tumu') return list;
  if (f === 'satis') {
    return list.filter((h) => {
      const t = musteriRaporHareketTuru(h);
      return t === 'satis' || t === 'iade';
    });
  }
  if (f === 'tahsilat') {
    return list.filter((h) => {
      const t = musteriRaporHareketTuru(h);
      return t === 'odeme' || t === 'iadeodeme';
    });
  }
  return list;
}

function musteriRaporOzetHesapla(hareketler) {
  const ozet = { toplamSatis: 0, toplamOdeme: 0 };
  const { satisOdemeleri } = musteriCariOdemeEslestir(hareketler);
  for (const h of hareketler || []) {
    const tur = musteriRaporHareketTuru(h);
    const tSatis = Number(h.ToplamTutar || 0);
    const tOdenen = Number(h.OdenenTutar || 0);
    if (tur === 'satis' || tur === 'iade') {
      ozet.toplamSatis += tur === 'iade' ? -tSatis : tSatis;
    }
    if (tur === 'odeme' || tur === 'iadeodeme') {
      ozet.toplamOdeme += tOdenen;
    }
    if (tur === 'iade') {
      ozet.toplamOdeme += tSatis;
    }
    if (tur === 'satis') {
      const ayriOdeme = (satisOdemeleri.get(Number(h.HareketID)) || []).length > 0;
      if (!ayriOdeme && tOdenen > 0.009) ozet.toplamOdeme += tOdenen;
    }
  }
  ozet.toplamSatis = Math.round(ozet.toplamSatis * 100) / 100;
  ozet.toplamOdeme = Math.round(ozet.toplamOdeme * 100) / 100;
  return ozet;
}

function musteriRaporFiltreEtiket(f) {
  if (f === 'satis') return 'Sadece satışlar';
  if (f === 'tahsilat') return 'Sadece tahsilatlar';
  return 'Tüm hareketler';
}

function musteriRaporlarGoster() {
  const d = musteriRaporlarSonData;
  if (!d) return;
  const filtre = musteriRaporTurFiltreDegeri();
  const tumu = d.hareketlerTumu || [];
  const filtrelenmis = musteriRaporHareketleriFiltrele(tumu, filtre);
  d.filtre = filtre;
  d.hareketler = filtrelenmis;
  const fo = musteriRaporOzetHesapla(filtrelenmis);
  document.getElementById('mrToplamSatis').textContent = musteriDetayParaFmt(fo.toplamSatis);
  document.getElementById('mrToplamOdeme').textContent = musteriDetayParaFmt(fo.toplamOdeme);
  document.getElementById('mrKalanBakiye').textContent = musteriDetayParaFmt(d.ozetTam?.kalanBakiye ?? d.ozet?.kalanBakiye);
  musteriRaporlarTabloDoldur(filtrelenmis);
}

function musteriRaporlarFiltreDegisti() {
  if (!musteriRaporlarSonData) return;
  musteriRaporlarGoster();
}

function musteriRaporlarMusteriId() {
  const hid = document.getElementById('mrMusteriID')?.value;
  if (hid) {
    const n = parseInt(hid, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const sel = document.getElementById('mrMusteriSec');
  if (sel?.value) {
    const n = parseInt(sel.value, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

function musteriRaporlarTarihGunGoster(ymd) {
  if (!ymd) return '—';
  return tarihTrGoster(`${ymd}T12:00:00`, { dateStyle: 'short' });
}

function musteriRaporlarTabloDoldur(hareketler) {
  const tb = document.getElementById('mrHareketGovde');
  if (!tb) return;
  if (!hareketler?.length) {
    const filtre = musteriRaporTurFiltreDegeri();
    const mesaj =
      filtre === 'tumu'
        ? 'Seçilen aralıkta hareket yok.'
        : 'Seçilen filtreye uygun hareket yok.';
    tb.innerHTML = `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="text-center text-muted py-4">${mesaj}</td></tr>`;
    return;
  }
  tb.innerHTML = musteriCariHareketTabloHtml(hareketler, { rapor: true });
}

function musteriRaporlarDokumaniOlustur() {
  const d = musteriRaporlarSonData;
  if (!d) return '';
  const m = d.musteri || {};
  const musteriAd = musteriGorunenAd(m);
  const company = {
    unvan: gunlukMetinEsc(uygulamaAyarlari?.SirketUnvan || 'ŞİRKET BİLGİSİ'),
    tel: gunlukMetinEsc(uygulamaAyarlari?.SirketTelefon || '-'),
  };
  const bas = musteriRaporlarTarihGunGoster(d.bas);
  const bit = musteriRaporlarTarihGunGoster(d.bit);
  const filtreEtiket = musteriRaporFiltreEtiket(d.filtre || 'tumu');
  const hareketler = Array.isArray(d.hareketler) ? d.hareketler : [];
  const fo = musteriRaporOzetHesapla(hareketler);
  const satirlar = hareketler.length
    ? musteriCariHareketTabloHtml(hareketler, { yazdir: true })
    : `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="c muted">Hareket yok.</td></tr>`;
  const oz = d.ozetTam || d.ozet || {};
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Müşteri Hareket Raporu</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .firm { font-size: 11px; color: #444; margin-bottom: 10px; }
    .meta { margin-bottom: 10px; line-height: 1.5; }
    .meta b { display: inline-block; min-width: 100px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 5px 6px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; font-size: 11px; }
    td.r { text-align: right; }
    td.b { font-weight: 700; }
    td.c { text-align: center; }
    td.nw { white-space: nowrap; }
    .muted { font-size: 10px; color: #555; margin-top: 2px; }
    .ozet { margin-top: 10px; text-align: right; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Müşteri Hareket Raporu</h1>
  <div class="firm">${company.unvan}${company.tel !== '-' ? ` · Tel: ${company.tel}` : ''}</div>
  <div class="meta">
    <div><b>Müşteri:</b> ${gunlukMetinEsc(musteriAd)}</div>
    <div><b>Dönem:</b> ${bas} – ${bit}</div>
    <div><b>Filtre:</b> ${gunlukMetinEsc(filtreEtiket)}</div>
    <div><b>Dönem satış:</b> ${gunlukMetinEsc(musteriDetayParaFmt(fo.toplamSatis))}</div>
    <div><b>Dönem tahsilat:</b> ${gunlukMetinEsc(musteriDetayParaFmt(fo.toplamOdeme))}</div>
    <div><b>Güncel bakiye:</b> ${gunlukMetinEsc(musteriDetayParaFmt(oz.kalanBakiye))}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Tarih</th><th>Tür</th><th>Ürün / hizmet</th>
        <th style="text-align:center">Adet</th>
        <th style="text-align:right">Birim</th>
        <th style="text-align:right">Tutar</th>
        <th style="text-align:right">Yürüyen bakiye</th>
      </tr>
    </thead>
    <tbody>${satirlar}</tbody>
  </table>
</body>
</html>`;
}

async function musteriRaporlarModalHazirlik(forcedMusteriID) {
  await hizliSatisMusteriListesiniHazirla();
  const mid = forcedMusteriID ? Number(forcedMusteriID) : aktifMusteriDetayID || null;
  const selWrap = document.getElementById('mrMusteriSecWrap');
  const sel = document.getElementById('mrMusteriSec');
  const adEl = document.getElementById('mrMusteriAd');
  const idHidden = document.getElementById('mrMusteriID');
  const liste = Array.isArray(window._musteriListeCache) ? window._musteriListeCache : [];
  if (mid) {
    selWrap?.classList.add('d-none');
    const m = liste.find((x) => Number(x.MusteriID) === Number(mid));
    if (adEl) adEl.textContent = m ? musteriGorunenAd(m) : `Müşteri #${mid}`;
    if (idHidden) idHidden.value = String(mid);
  } else {
    selWrap?.classList.remove('d-none');
    if (sel) {
      sel.innerHTML = liste.length
        ? liste
            .map((m) => `<option value="${m.MusteriID}">${gunlukMetinEsc(musteriGorunenAd(m))}</option>`)
            .join('')
        : '<option value="">Müşteri yok</option>';
    }
    const ilk = liste[0];
    if (idHidden) idHidden.value = ilk ? String(ilk.MusteriID) : '';
    if (adEl) adEl.textContent = ilk ? musteriGorunenAd(ilk) : '—';
  }
  musteriRaporlarSonData = null;
  const filtreEl = document.getElementById('mrTurFiltre');
  if (filtreEl) filtreEl.value = 'tumu';
  const tb = document.getElementById('mrHareketGovde');
  if (tb) tb.innerHTML = `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="text-center text-muted py-4">Yükleniyor…</td></tr>`;
}

async function musteriRaporlarModalAc(forcedMusteriID) {
  const raporEl = document.getElementById('musteriRaporlarModal');
  const detayAcik = document.getElementById('musteriDetayModal')?.classList.contains('show');
  if (detayAcik) {
    await musteriAltModalAc(raporEl, () => musteriRaporlarModalHazirlik(forcedMusteriID));
  } else {
    await musteriListeModalGeciciKapat();
    await musteriRaporlarModalHazirlik(forcedMusteriID);
    modalAc(raporEl);
  }
  await musteriRaporlarTarihVarsayilanVeYukle();
}

async function musteriRaporlarMusteriSecildi() {
  const id = musteriRaporlarMusteriId();
  const hid = document.getElementById('mrMusteriID');
  if (hid && id) hid.value = String(id);
  const m = (window._musteriListeCache || []).find((x) => Number(x.MusteriID) === Number(id));
  const adEl = document.getElementById('mrMusteriAd');
  if (adEl && m) adEl.textContent = musteriGorunenAd(m);
  await musteriRaporlarTarihVarsayilanVeYukle();
}

async function musteriRaporlarTarihVarsayilanVeYukle() {
  const id = musteriRaporlarMusteriId();
  const tb = document.getElementById('mrHareketGovde');
  if (!id) {
    if (tb) tb.innerHTML = `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="text-center text-muted py-4">Müşteri seçin.</td></tr>`;
    return;
  }
  try {
    const res = await fetch(`/api/musteri/${id}/hareketler`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Hareketler alınamadı.');
    const basEl = document.getElementById('mrBaslangic');
    const bitEl = document.getElementById('mrBitis');
    if (basEl) basEl.value = data.ilkHareketTarih || gunlukBugunInputVal();
    if (bitEl) bitEl.value = gunlukBugunInputVal();
    await musteriRaporlarYukle();
  } catch (e) {
    console.error(e);
    if (tb) {
      tb.innerHTML = `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="text-center text-danger py-4">${gunlukMetinEsc(e.message || 'Yüklenemedi.')}</td></tr>`;
    }
    alert(e.message || 'Rapor yüklenemedi.');
  }
}

async function musteriRaporlarYukle() {
  const id = musteriRaporlarMusteriId();
  const bas = document.getElementById('mrBaslangic')?.value;
  const bit = document.getElementById('mrBitis')?.value;
  if (!id) return alert('Müşteri seçin.');
  if (!bas || !bit) return alert('Başlangıç ve bitiş tarihini seçin.');
  if (bas > bit) return alert('Başlangıç tarihi bitişten sonra olamaz.');
  const tb = document.getElementById('mrHareketGovde');
  if (tb) tb.innerHTML = `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="text-center text-muted py-4">Yükleniyor…</td></tr>`;
  try {
    const u = new URL(`/api/musteri/${id}/hareketler`, window.location.origin);
    u.searchParams.set('baslangic', bas);
    u.searchParams.set('bitis', bit);
    const res = await fetch(u);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Rapor alınamadı.');
    const m = data.musteri || {};
    musteriRaporlarSonData = {
      musteri: m,
      hareketlerTumu: data.hareketler || [],
      ozetTam: data.ozet || {},
      ozet: data.ozet || {},
      bas,
      bit,
      filtre: musteriRaporTurFiltreDegeri(),
    };
    const adEl = document.getElementById('mrMusteriAd');
    if (adEl) adEl.textContent = musteriGorunenAd(m);
    musteriRaporlarGoster();
  } catch (e) {
    console.error(e);
    musteriRaporlarSonData = null;
    if (tb) {
      tb.innerHTML = `<tr><td colspan="${MR_CARI_TABLO_KOLON}" class="text-center text-danger py-4">${gunlukMetinEsc(e.message || 'Hata')}</td></tr>`;
    }
    alert(e.message || 'Rapor yüklenemedi.');
  }
}

function musteriRaporlarYazdir() {
  const html = musteriRaporlarDokumaniOlustur();
  if (!html) return alert('Önce raporu listele.');
  belgeOnizlemeAcHtml(html, '<i class="fa-solid fa-file-lines me-2"></i>Müşteri Hareket Raporu');
}

function musteriLakap(m) {
  return String(m?.TanimAdi || '').trim();
}

function musteriKonum(m) {
  const parcalar = [m?.Adres, m?.Ilce, m?.Il].map((x) => String(x || '').trim()).filter(Boolean);
  return parcalar.join(', ') || '—';
}

function isletmeKurumAdi() {
  return String(uygulamaAyarlari?.SirketUnvan || 'Elektrik Otomasyon').trim() || 'Elektrik Otomasyon';
}

function cariEkstreTurEtiket(tur) {
  const t = String(tur || '').toLowerCase();
  if (t === 'odeme') return 'Tahsilat';
  if (t === 'iadeodeme') return 'İade ödeme';
  if (t === 'iade') return 'İade';
  return 'Satış';
}

function cariEkstreTahsilatAciklama(h) {
  const odeme = String(h.OdemeSekli || '').trim();
  const tur = String(h.Tur || '').toLowerCase();
  if (tur === 'iadeodeme') return odeme ? `${odeme} iade ödemesi` : 'İade ödemesi';
  return odeme ? `${odeme} tahsilat` : 'Tahsilat';
}

function cariEkstreSatisKalemSatirlari(h, iadeMi = false) {
  const kalemler = Array.isArray(h.detaylar) ? h.detaylar : [];
  if (kalemler.length) {
    return kalemler.map((d) => {
      const ad = String(d.UrunAdi || '-').trim();
      const m = Number(d.Miktar || 0) || 1;
      let birim = Number(d.BirimFiyat || 0);
      let tutar = Number(d.SatirTutar || 0);
      if (birim <= 0 && tutar > 0 && m > 0) birim = Math.round((tutar / m) * 100) / 100;
      if (tutar <= 0 && birim > 0) tutar = Math.round(birim * m * 100) / 100;
      const birimStr = birim > 0 ? musteriDetayParaFmt(birim) : '—';
      const tutarStr = musteriDetayParaFmt(tutar);
      return { ad, m, birimStr, tutarStr, iadeMi };
    });
  }
  let metin = String(h.Aciklama || '').trim();
  if (metin.startsWith('[Mobil]')) metin = metin.slice(7).trim();
  metin = metin
    .replace(/^(Hızlı satış|Satış)\s*(\(veresiye\))?\s*(\[[^\]]+\])?\s*[—-]\s*/i, '')
    .replace(/^(Hızlı satış tahsilatı|Satış tahsilatı)\s*[—-]\s*/i, '')
    .trim();
  if (!metin) {
    const tutar = Number(h.ToplamTutar || 0);
    if (tutar > 0) {
      return [{ ad: iadeMi ? 'İade' : 'Satış', m: 1, birimStr: musteriDetayParaFmt(tutar), tutarStr: musteriDetayParaFmt(tutar), iadeMi }];
    }
    return [];
  }
  return metin.split(',').map((parca) => {
    const p = parca.trim();
    if (!p) return null;
    const m = p.match(/^(.+?)\s*x(\d+)(?:\s*@([\d.,]+))?$/i);
    if (m) {
      const ad = m[1].trim();
      const adet = Number(m[2]) || 1;
      const bf = m[3] ? Number(String(m[3]).replace(',', '.')) : 0;
      const tutar = bf > 0 ? Math.round(bf * adet * 100) / 100 : 0;
      return {
        ad,
        m: adet,
        birimStr: bf > 0 ? musteriDetayParaFmt(bf) : '—',
        tutarStr: tutar > 0 ? musteriDetayParaFmt(tutar) : '—',
        iadeMi,
      };
    }
    return { ad: p, m: 1, birimStr: '—', tutarStr: '—', iadeMi };
  }).filter(Boolean);
}

function cariEkstreSatisAciklamaHtml(h) {
  const tur = String(h.Tur || '').toLowerCase();
  const iadeMi = tur === 'iade';
  const kalemler = cariEkstreSatisKalemSatirlari(h, iadeMi);
  if (!kalemler.length) return '—';
  return kalemler
    .map((k) => {
      const renk = k.iadeMi ? '#997404' : '#c0392b';
      return `<div style="margin:2px 0;line-height:1.4;padding:1px 0;border-bottom:1px dotted #e9ecef;">
        <span style="font-weight:700;color:#111;">${gunlukMetinEsc(k.ad)}</span>
        <span style="color:#555;"> · ${k.m} ad × ${gunlukMetinEsc(k.birimStr)}</span>
        <span style="color:${renk};font-weight:700;"> = ${gunlukMetinEsc(k.tutarStr)}</span>
      </div>`;
    })
    .join('');
}

function cariEkstreAciklamaHtml(h) {
  const tur = String(h.Tur || '').toLowerCase();
  if (tur === 'odeme' || tur === 'iadeodeme') {
    return gunlukMetinEsc(cariEkstreTahsilatAciklama(h));
  }
  if (tur === 'satis' || tur === 'iade') {
    return cariEkstreSatisAciklamaHtml(h);
  }
  let metin = String(h.Aciklama || '').trim();
  if (metin.startsWith('[Mobil]')) metin = metin.slice(7).trim();
  return gunlukMetinEsc(metin || '—');
}

function cariEkstreRaporSatir(h) {
  const tur = String(h.Tur || '').toLowerCase();
  const tam = tarihTrGoster(h.Tarih);
  const p = tam.split(' ');
  let borc = 0;
  let odeme = 0;
  if (tur === 'satis') borc = Number(h.ToplamTutar || 0);
  else if (tur === 'iade') odeme = Number(h.ToplamTutar || 0);
  else if (tur === 'odeme' || tur === 'iadeodeme') odeme = Number(h.OdenenTutar || 0);
  const islemSira = tur === 'satis' ? 1 : tur === 'iade' ? 2 : 3;
  return {
    sort: sqlTarihParse(h.Tarih)?.getTime() || 0,
    gun: p[0] || '—',
    saat: p[1] || '—',
    islemTipi: cariEkstreTurEtiket(h.Tur),
    islemSira,
    siraId: Number(h.HareketID || 0),
    aciklamaHtml: cariEkstreAciklamaHtml(h),
    borc,
    odeme,
  };
}

function cariEkstreToplamlariHesapla(data) {
  const rows = data.hareketler || [];
  let toplamSatis = 0;
  let toplamOdeme = 0;
  rows.forEach((h) => {
    const tur = String(h.Tur || '').toLowerCase();
    if (tur === 'satis') toplamSatis += Number(h.ToplamTutar || 0);
    if (tur === 'odeme' || tur === 'iadeodeme') toplamOdeme += Number(h.OdenenTutar || 0);
    if (tur === 'iade') toplamOdeme += Number(h.ToplamTutar || 0);
  });
  const kalan = Number(data.musteri?.Bakiye) || 0;
  return { toplamSatis, toplamOdeme, kalan };
}

function cariEkstreDokumaniOlustur(data) {
  const m = data.musteri || {};
  const ad = musteriGorunenAd(m);
  const lakap = musteriLakap(m);
  const tel = m.Telefon || '—';
  const konum = musteriKonum(m);
  const { toplamSatis, toplamOdeme, kalan } = cariEkstreToplamlariHesapla(data);
  const satirlar = [...(data.hareketler || [])].map(cariEkstreRaporSatir).sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    if (a.islemSira !== b.islemSira) return a.islemSira - b.islemSira;
    return a.siraId - b.siraId;
  });
  const tabloSatir = satirlar
    .map(
      (s) => `<tr>
        <td style="white-space:nowrap;">
          <div style="font-weight:700;color:#111;">${gunlukMetinEsc(s.gun)}</div>
          <div style="font-size:9px;color:#666;margin-top:2px;">${gunlukMetinEsc(s.saat)}</div>
        </td>
        <td style="color:#111;">${gunlukMetinEsc(s.islemTipi)}</td>
        <td style="color:#111;vertical-align:top;">${s.aciklamaHtml}</td>
        <td style="text-align:right;color:#c0392b;font-weight:700;">${s.borc > 0 ? gunlukMetinEsc(musteriDetayParaFmt(s.borc)) : '—'}</td>
        <td style="text-align:right;color:#27ae60;font-weight:700;">${s.odeme > 0 ? gunlukMetinEsc(musteriDetayParaFmt(s.odeme)) : '—'}</td>
      </tr>`
    )
    .join('');
  const kalanRenk = kalan > 0 ? '#c0392b' : kalan < 0 ? '#27ae60' : '#333';
  const kalanMetin = `${musteriDetayParaFmt(Math.abs(kalan))}${kalan < 0 ? ' (Alacak)' : ''}`;
  const kurum = isletmeKurumAdi();
  const isletmeYetkili = String(uygulamaAyarlari?.SirketYetkiliAdSoyad || '').trim();
  const isletmeVergi = String(uygulamaAyarlari?.SirketVergiNo || '').trim();
  const isletmeTel = String(uygulamaAyarlari?.SirketTelefon || '').trim();
  const isletmeSatirlar = [
    isletmeYetkili
      ? `<div style="font-size:11px;margin:2px 0;color:#444;"><b>Yetkili</b> ${gunlukMetinEsc(isletmeYetkili)}</div>`
      : '',
    isletmeVergi
      ? `<div style="font-size:11px;margin:2px 0;color:#444;"><b>Vergi no</b> ${gunlukMetinEsc(isletmeVergi)}</div>`
      : '',
    isletmeTel
      ? `<div style="font-size:11px;margin:2px 0;color:#444;"><b>Telefon</b> ${gunlukMetinEsc(isletmeTel)}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
  <title>Cari Ekstre — ${gunlukMetinEsc(ad)}</title>
  <style>@page{size:A4;margin:12mm}body{margin:0;background:#fff}</style></head><body>
  <div class="ekstre-print-root" style="font-family:Segoe UI,Arial,sans-serif;color:#111;padding:4px;background:#fff;">
    <div style="text-align:center;margin:0 0 10px;padding-bottom:8px;border-bottom:2px solid #0d47a1;">
      <div style="font-size:18px;font-weight:800;color:#0d47a1;text-transform:uppercase;">${gunlukMetinEsc(kurum)}</div>
      ${isletmeSatirlar}
      <div style="font-size:13px;font-weight:700;color:#333;margin-top:8px;letter-spacing:0.04em;">CARİ EKSTRE</div>
    </div>
    <p style="text-align:right;font-size:10px;color:#555;margin:0 0 12px;">${gunlukMetinEsc(new Date().toLocaleString('tr-TR'))}</p>
    <div style="margin:0 0 14px;padding:10px 12px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;">
      <div style="font-size:20px;font-weight:800;color:#0d47a1;text-transform:uppercase;">${gunlukMetinEsc(ad)}</div>
      ${lakap ? `<div style="font-size:13px;font-weight:600;color:#495057;margin:6px 0 8px;">${gunlukMetinEsc(lakap)}</div>` : ''}
      <div style="font-size:12px;margin:4px 0;color:#111;"><b>Telefon</b> ${gunlukMetinEsc(tel)}</div>
      <div style="font-size:12px;margin:4px 0;color:#111;"><b>Adres</b> ${gunlukMetinEsc(konum)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:11px;">
      <tr>
        <td style="border:1px solid #ccc;padding:8px;background:#fde8e8;text-align:center;color:#111;"><b>Toplam satış</b><br><span style="color:#c0392b;font-weight:800;font-size:14px;">${gunlukMetinEsc(musteriDetayParaFmt(toplamSatis))}</span></td>
        <td style="border:1px solid #ccc;padding:8px;background:#e8f8ee;text-align:center;color:#111;"><b>Toplam tahsilat</b><br><span style="color:#27ae60;font-weight:800;font-size:14px;">${gunlukMetinEsc(musteriDetayParaFmt(toplamOdeme))}</span></td>
        <td style="border:1px solid #ccc;padding:8px;background:#e3f2fd;text-align:center;color:#111;"><b>Güncel bakiye</b><br><span style="color:${kalanRenk};font-weight:800;font-size:14px;">${gunlukMetinEsc(kalanMetin)}</span></td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr style="background:#ecf0f1;">
          <th style="border:1px solid #bdc3c7;padding:5px;color:#111;text-align:left;">Tarih</th>
          <th style="border:1px solid #bdc3c7;padding:5px;color:#111;text-align:left;">İşlem</th>
          <th style="border:1px solid #bdc3c7;padding:5px;color:#111;text-align:left;">Açıklama</th>
          <th style="border:1px solid #bdc3c7;padding:5px;color:#111;text-align:right;">Borç</th>
          <th style="border:1px solid #bdc3c7;padding:5px;color:#111;text-align:right;">Alacak</th>
        </tr>
      </thead>
      <tbody>${tabloSatir || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#111;">Hareket kaydı yok</td></tr>'}</tbody>
      <tfoot>
        <tr style="background:#f1f3f5;font-weight:800;">
          <td colspan="3" style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#111;">TOPLAM</td>
          <td style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#c0392b;">${gunlukMetinEsc(musteriDetayParaFmt(toplamSatis))}</td>
          <td style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#27ae60;">${gunlukMetinEsc(musteriDetayParaFmt(toplamOdeme))}</td>
        </tr>
      </tfoot>
    </table>
    <p style="margin-top:16px;font-size:9px;color:#888;text-align:center;">${gunlukMetinEsc(kurum)} · Bu belge bilgilendirme amaçlıdır.</p>
  </div></body></html>`;
}

let sonCariEkstreData = null;

async function musteriCariEkstreAc() {
  if (!aktifMusteriDetayID) {
    alert('Önce müşteri carisini açın.');
    return;
  }
  try {
    const res = await fetch(`/api/musteri/${aktifMusteriDetayID}/hareketler`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Hareketler alınamadı.');
    sonCariEkstreData = { musteri: data.musteri, hareketler: data.hareketler || [] };
    const html = cariEkstreDokumaniOlustur(sonCariEkstreData);
    belgeOnizlemeAcHtml(html, '<i class="fa-solid fa-file-invoice me-2"></i>Cari Ekstre', { ekstre: true });
  } catch (e) {
    console.error(e);
    alert(e.message || 'Ekstre oluşturulamadı.');
  }
}

async function cariEkstrePdfIndir() {
  const host = document.getElementById('ekstreRenderHost');
  if (!host || !sonCariEkstreData) return alert('Önce cari ekstre açın.');
  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
    return alert('PDF kütüphanesi yüklenemedi. Sayfayı yenileyin.');
  }
  try {
    host.innerHTML = cariEkstreDokumaniOlustur(sonCariEkstreData);
    const root = host.querySelector('.ekstre-print-root');
    if (!root) throw new Error('Ekstre içeriği oluşturulamadı.');
    const canvas = await html2canvas(root, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const img = canvas.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const imgW = pw - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    let y = margin;
    let remaining = imgH;
    let page = 0;
    while (remaining > 0) {
      if (page > 0) pdf.addPage();
      const offset = page * (ph - margin * 2);
      pdf.addImage(img, 'JPEG', margin, margin - offset, imgW, imgH);
      remaining -= ph - margin * 2;
      page += 1;
    }
    const ad =
      musteriGorunenAd(sonCariEkstreData.musteri)
        .replace(/[^\w\u00C0-\u024F\s-]/gi, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40) || 'musteri';
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    pdf.save(`ekstre-${ad}-${ts}.pdf`);
  } catch (e) {
    console.error(e);
    alert(e.message || 'PDF oluşturulamadı.');
  } finally {
    host.innerHTML = '';
  }
}

let karSonOzet = null;
let karSonBaslangic = '';
let karSonBitis = '';

async function karModalAc() {
  const b = gunlukBugunInputVal();
  const bas = document.getElementById('karBaslangic');
  const bit = document.getElementById('karBitis');
  if (bas && !bas.value) bas.value = b;
  if (bit && !bit.value) bit.value = b;
  await karVeriYukle();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('karModal')).show();
}

async function karVeriYukle() {
  const bas = document.getElementById('karBaslangic')?.value;
  const bit = document.getElementById('karBitis')?.value;
  if (!bas || !bit) return alert('Başlangıç ve bitiş tarihini seçin.');
  try {
    const u = new URL('/api/kar-ozet', window.location.origin);
    u.searchParams.set('baslangic', bas);
    u.searchParams.set('bitis', bit);
    const res = await fetch(u);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Kâr verisi alınamadı.');
      return;
    }
    const o = data.ozet || {};
    karSonOzet = o;
    karSonBaslangic = bas;
    karSonBitis = bit;
    document.getElementById('karBrutSatis').textContent = gunlukParaFmt(o.brutSatis);
    document.getElementById('karIadeTutar').textContent = gunlukParaFmt(o.iadeTutar);
    document.getElementById('karNetSatis').textContent = gunlukParaFmt(o.netSatis);
    document.getElementById('karSatisMaliyet').textContent = gunlukParaFmt(o.satisMaliyet);
    document.getElementById('karNetMaliyet').textContent = gunlukParaFmt(o.netMaliyet);
    document.getElementById('karToplamGider').textContent = gunlukParaFmt(o.toplamGider);
    document.getElementById('karBrutKar').textContent = gunlukParaFmt(o.brutKar);
    document.getElementById('karNetKar').textContent = gunlukParaFmt(o.netKar);
    karYaziRenkAyarla(document.getElementById('karBrutKar'), o.brutKar);
    karYaziRenkAyarla(document.getElementById('karNetKar'), o.netKar);
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

function karRaporCsvIndir() {
  if (!karSonOzet) {
    alert('Önce hesaplama yapın.');
    return;
  }
  const o = karSonOzet;
  const rows = [
    ['Baslangic', karSonBaslangic || ''],
    ['Bitis', karSonBitis || ''],
    [],
    ['Kalem', 'Tutar'],
    ['Brut Satis', Number(o.brutSatis || 0).toFixed(2)],
    ['Iade Tutar', Number(o.iadeTutar || 0).toFixed(2)],
    ['Net Satis', Number(o.netSatis || 0).toFixed(2)],
    ['Satis Maliyet', Number(o.satisMaliyet || 0).toFixed(2)],
    ['Iade Maliyet', Number(o.iadeMaliyet || 0).toFixed(2)],
    ['Net Maliyet', Number(o.netMaliyet || 0).toFixed(2)],
    ['Brut Kar', Number(o.brutKar || 0).toFixed(2)],
    ['Toplam Gider', Number(o.toplamGider || 0).toFixed(2)],
    ['Net Kar', Number(o.netKar || 0).toFixed(2)],
  ];
  const csv = rows
    .map((r) => r.map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kar-raporu-${karSonBaslangic || 'tarih'}-${karSonBitis || 'tarih'}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}

async function gunlukIslemModalAc() {
  const modalEl = document.getElementById('gunlukIslemModal');
  const bas = document.getElementById('gunlukBaslangic');
  const bit = document.getElementById('gunlukBitis');
  const b = gunlukBugunInputVal();
  bas.value = b;
  bit.value = b;
  await gunlukIslemleriYukle();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function mobilOnekTemizle(metin) {
  return String(metin || '').replace(/^\[Mobil\]\s*/i, '').trim();
}

const PERAKENDE_ISLEM = 'Perakende İşlem';

function perakendeEtiketMi(ad) {
  const a = String(ad || '').trim();
  return a === PERAKENDE_ISLEM || a === 'Müşterisiz işlem' || a === 'Müşterisiz';
}

function gunlukPerakendeSatirMi(row) {
  const k = row.Kaynak || '';
  if (k !== 'satis') return false;
  if (Number(row.MusteriID) > 0) return false;
  if (row.SatirTur === 'tahsilat') return false;
  const ad = mobilOnekTemizle(row.MusteriAd || row.KisaAciklama || '');
  if (ad && !perakendeEtiketMi(ad)) return false;
  return true;
}

function gunlukPerakendeAksiyonSatirMi(row) {
  if (!gunlukPerakendeSatirMi(row)) return false;
  if (row.SatirTur === 'satis_kalem') return Number(row.KalemSira) === 0;
  if (row.SatirTur === 'tahsilat') return false;
  return row.SatirTur === 'satis' || !row.SatirTur;
}

function gunlukIslemAciklamaGoster(row) {
  if (row.KisaAciklama) return mobilOnekTemizle(row.KisaAciklama);
  if (row.MusteriAd) return mobilOnekTemizle(row.MusteriAd);
  const det = Array.isArray(row.detaylar) ? row.detaylar : [];
  const k = row.Kaynak || '';
  const satisKalemSatir =
    row.SatirTur === 'satis' || k === 'musteri_satis' || (k === 'satis' && row.SatirTur !== 'tahsilat');
  if (det.length && satisKalemSatir && k !== 'musteri_satis') return PERAKENDE_ISLEM;
  if (det.length && (k === 'kasa' || k === 'mal_alim')) {
    const ad = String(row.Aciklama || '').split(' — ')[0].trim();
    return ad || '—';
  }
  return row.Aciklama || '—';
}

function gunlukMalAlimTedarikciAd(row) {
  let ad = row.MusteriAd || row.KisaAciklama || null;
  if (ad) {
    ad = String(ad).replace(/^Mal alım\s+/i, '').trim();
    if (ad) return ad;
  }
  const m = String(row.Aciklama || '').match(/Mal alım\s+([^:]+):/i);
  return m ? m[1].trim() : null;
}

function gunlukKaynakEtiket(k, odeme, turEtiket) {
  if (turEtiket) return turEtiket;
  if (k === 'iptal') return odeme && odeme !== 'Diğer' ? `İptal (${odeme})` : 'İptal';
  if (k === 'musteri_satis' || k === 'satis') return 'Satış';
  if (k === 'musteri_tahsilat' || k === 'musteri_odeme' || k === 'satis_tahsilat') return 'Tahsilat';
  if (k === 'mal_alim') return 'Mal alım';
  if (k === 'tedarikci_odeme') return 'Tedarik ödeme';
  if (k === 'genel_gider') return 'Genel gider';
  if (k === 'satis' || k === 'kasa') {
    const o = odeme || '';
    if (o === 'Nakit' || o === 'Kart' || o === 'Havale' || o === 'Veresiye') {
      return `Satış ve Ödeme (${o})`;
    }
    return 'Satış ve Ödeme';
  }
  return 'Satış ve Ödeme';
}

/** Aynı satış grubunda müşteri yalnızca ilk satırda; grup sonunda ayırıcı çizgi. */
function gunlukIslemGrupAnahtari(row) {
  if (row.GrupAnahtar) return row.GrupAnahtar;
  const gid = row.GrupLogID || row.LogID;
  if (!gid) return null;
  const k = row.Kaynak || '';
  const st = row.SatirTur || '';
  if (
    st === 'satis_kalem' ||
    st === 'satis' ||
    st === 'eksik_odeme' ||
    k === 'musteri_satis' ||
    k === 'satis' ||
    k === 'satis_tahsilat' ||
    k === 'satis_eksik' ||
    k === 'musteri_tahsilat' ||
    k === 'musteri_odeme'
  ) {
    return `satis-${gid}`;
  }
  if (st === 'mal_alim_kalem' || st === 'mal_alim_odeme' || k === 'mal_alim' || k === 'mal_alim_odeme') {
    return `mal-${gid}`;
  }
  return null;
}

function gunlukIslemTahsilatSatirMi(row) {
  const st = row.SatirTur || '';
  const k = row.Kaynak || '';
  return (
    st === 'tahsilat' ||
    st === 'eksik_odeme' ||
    st === 'mal_alim_odeme' ||
    k === 'satis_tahsilat' ||
    k === 'satis_eksik' ||
    k === 'musteri_tahsilat' ||
    k === 'musteri_odeme' ||
    k === 'mal_alim_odeme'
  );
}

function gunlukIslemMalAlimOdemeSatirMi(row) {
  return row.SatirTur === 'mal_alim_odeme' || row.Kaynak === 'mal_alim_odeme';
}

function gunlukGrupOdemeBul(items) {
  for (const r of items) {
    if (gunlukIslemTahsilatSatirMi(r) && r.Odeme && r.Odeme !== '—') return r.Odeme;
  }
  for (const r of items) {
    if (r.Odeme === 'Veresiye') return 'Veresiye';
  }
  for (const r of items) {
    if (r.Odeme && r.Odeme !== '—') return r.Odeme;
  }
  return '—';
}

function gunlukOdemeTipNorm(odeme) {
  const o = String(odeme || '')
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i');
  if (!o || o === '—' || o === '-') return '';
  if (o.includes('veresiye')) return 'veresiye';
  if (o.includes('nakit')) return 'nakit';
  if (o.includes('kart') || o.includes('pos')) return 'kart';
  if (o.includes('havale') || o.includes('eft')) return 'havale';
  return '';
}

function gunlukOdemeIkonHtml(tip) {
  if (tip === 'nakit') {
    return '<span class="gunluk-odeme-ikon" title="Nakit" aria-label="Nakit">💵</span>';
  }
  if (tip === 'kart') {
    return '<span class="gunluk-odeme-ikon" title="Kart" aria-label="Kart">💳</span>';
  }
  if (tip === 'havale') {
    return '<span class="gunluk-odeme-ikon" title="Havale" aria-label="Havale">🏦</span>';
  }
  if (tip === 'veresiye') {
    return '<span class="gunluk-odeme-ikon" title="Veresiye" aria-label="Veresiye">📒</span>';
  }
  return '';
}

function gunlukIslemGrupTemaSinif(row) {
  const k = String(row?.Kaynak || '');
  if (
    k === 'mal_alim' ||
    k === 'mal_alim_odeme' ||
    row?.SatirTur === 'mal_alim_kalem' ||
    row?.SatirTur === 'mal_alim_odeme'
  ) {
    return 'gunluk-tema-mal-alim';
  }
  if (
    k === 'tedarikci_odeme' ||
    k === 'genel_gider' ||
    k === 'gider' ||
    k === 'musteri_iade' ||
    k === 'musteri_iade_odeme'
  ) {
    return 'gunluk-tema-gider';
  }
  if (
    k === 'satis' ||
    k === 'satis_tahsilat' ||
    k === 'satis_eksik' ||
    k === 'musteri_satis' ||
    k === 'musteri_tahsilat' ||
    k === 'musteri_odeme'
  ) {
    return 'gunluk-tema-satis';
  }
  if (row?.Yon === 'cikis') return 'gunluk-tema-gider';
  return 'gunluk-tema-diger';
}

function gunlukIslemGruplariIsaretle(liste) {
  const gruplar = new Map();
  liste.forEach((row) => {
    const key = gunlukIslemGrupAnahtari(row);
    if (!key) {
      row.GunlukMusteriGoster = true;
      row.GunlukOdemeGoster = true;
      row.GunlukTarihGoster = true;
      row.GunlukTurBaslikGoster = true;
      row.GunlukGrupSon = true;
      row.GunlukGrupTema = gunlukIslemGrupTemaSinif(row);
      return;
    }
    if (!gruplar.has(key)) gruplar.set(key, []);
    gruplar.get(key).push(row);
  });
  for (const items of gruplar.values()) {
    const coklu = items.length > 1;
    const grupOdeme = coklu ? gunlukGrupOdemeBul(items) : null;
    const tema = gunlukIslemGrupTemaSinif(items[0]);
    let kalemToplam = 0;
    let kalemAdet = 0;
    for (const r of items) {
      const st = r.SatirTur || '';
      if (st === 'satis_kalem' || st === 'mal_alim_kalem' || st === 'iade_kalem') {
        kalemToplam += Number(r.Tutar || 0);
        kalemAdet += 1;
      }
    }
    kalemToplam = Math.round(kalemToplam * 100) / 100;
    items.forEach((row, i) => {
      const tahsilat = gunlukIslemTahsilatSatirMi(row);
      const ust = !coklu || i === 0;
      row.GunlukMusteriGoster = !coklu || i === 0;
      row.GunlukOdemeGoster = !coklu || i === 0;
      row.GunlukTarihGoster = !coklu || i === 0;
      /* Satış üst satırda; tahsilat/ödeme rozeti tutar satırının karşısında */
      row.GunlukTurBaslikGoster = !coklu || i === 0 || tahsilat;
      row.GunlukGrupUst = ust;
      row.GunlukGrupTahsilat = coklu && tahsilat;
      row.GunlukGrupSon = i === items.length - 1;
      row.GunlukGrupIc = coklu && i > 0 && i < items.length - 1;
      row.GunlukTahsilatOncesi =
        coklu && i < items.length - 1 && gunlukIslemTahsilatSatirMi(items[i + 1]);
      row.GunlukGrupTema = tema;
      if (grupOdeme != null && grupOdeme !== '—') row.GunlukGrupOdeme = grupOdeme;
      if (kalemAdet > 0) {
        row.GunlukGrupKalemAdet = kalemAdet;
        row.GunlukGrupKalemToplam = kalemToplam;
      }
    });
  }
  return liste;
}

function gunlukOdemeBadgeHtml(od) {
  const o = od || '—';
  let badgeClass = 'bg-secondary';
  if (o === 'Nakit') badgeClass = 'bg-success';
  else if (o === 'Kart') badgeClass = 'bg-primary';
  else if (o === 'Havale') badgeClass = 'bg-warning text-dark';
  else if (o === 'Veresiye') badgeClass = 'bg-danger';
  else if (o === 'Diğer') badgeClass = 'bg-dark';
  else if (o === '—') return '<span class="text-muted small">—</span>';
  return `<span class="badge ${badgeClass}">${gunlukMetinEsc(o)}</span>`;
}

function gunlukIslemMusteriHucre(row, metin) {
  if (row.GunlukMusteriGoster === false) {
    return '<td class="gunluk-hucre-bos"></td>';
  }
  const cls = row.SatirTur === 'satis_kalem' ? 'gunluk-kalem-musteri' : 'gunluk-aciklama-hucre';
  const temiz = mobilOnekTemizle(metin);
  if (gunlukPerakendeSatirMi(row) || perakendeEtiketMi(temiz)) {
    return `<td class="${cls}"><span class="gunluk-perakende-etiket">${PERAKENDE_ISLEM}</span></td>`;
  }
  const tedarikciMi =
    row.Kaynak === 'mal_alim' ||
    row.Kaynak === 'mal_alim_odeme' ||
    row.Kaynak === 'tedarikci_odeme' ||
    row.SatirTur === 'mal_alim_kalem' ||
    row.SatirTur === 'mal_alim_odeme' ||
    Number(row.TedarikciID) > 0;
  const musteriMi =
    !tedarikciMi &&
    (Number(row.MusteriID) > 0 ||
      row.Kaynak === 'musteri_satis' ||
      row.Kaynak === 'musteri_tahsilat' ||
      row.Kaynak === 'musteri_odeme' ||
      row.Kaynak === 'satis_tahsilat');
  const ad = gunlukMetinEsc(temiz);
  let icerik = ad;
  if (tedarikciMi && temiz) {
    icerik = `<span class="gunluk-kisi-ikon" aria-hidden="true">🚚</span><span class="gunluk-tedarikci-ad">${ad}</span>`;
  } else if (musteriMi && temiz) {
    icerik = `<span class="gunluk-kisi-ikon" aria-hidden="true">👤</span><span class="gunluk-musteri-ad">${ad}</span>`;
  }
  return `<td class="${cls}">${icerik}</td>`;
}

function gunlukIslemTurEtiketMetin(row, turEtiket) {
  if (gunlukIslemMalAlimOdemeSatirMi(row)) {
    const od = row.GunlukGrupOdeme != null ? row.GunlukGrupOdeme : row.Odeme;
    if (od === 'Veresiye') return 'Veresiye';
    if (od && od !== '—') return `Ödeme — ${od}`;
    return turEtiket || 'Ödeme';
  }
  if ((row.SatirTur || '') === 'mal_alim_kalem') {
    const od = row.GunlukGrupOdeme != null ? row.GunlukGrupOdeme : row.Odeme;
    if (od === 'Veresiye') return 'Mal alım — Veresiye';
  }
  if (gunlukIslemTahsilatSatirMi(row) && !gunlukIslemMalAlimOdemeSatirMi(row)) {
    if ((row.SatirTur || '') === 'eksik_odeme' || row.Kaynak === 'satis_eksik') {
      return 'Eksik ödeme';
    }
    const od = row.GunlukGrupOdeme != null ? row.GunlukGrupOdeme : row.Odeme;
    if (turEtiket === 'İade Ödeme') {
      if (od && od !== '—') return `İade Ödeme — ${od}`;
      return 'İade Ödeme';
    }
    if (od && od !== '—') return `Tahsilat — ${od}`;
    return turEtiket || 'Tahsilat';
  }
  const od = row.Odeme;
  const satisKaynak =
    (row.SatirTur || '') === 'satis_kalem' ||
    (row.SatirTur || '') === 'iade_kalem' ||
    (row.SatirTur || '') === 'satis' ||
    row.Kaynak === 'musteri_satis' ||
    row.Kaynak === 'satis';
  const malAlimKalem = (row.SatirTur || '') === 'mal_alim_kalem';
  if ((satisKaynak || malAlimKalem) && od && od !== '—') return turEtiket;
  if (row.GunlukOdemeGoster !== false && od && od !== '—') {
    return `${turEtiket} — ${od}`;
  }
  return turEtiket;
}

function gunlukIslemTarihHucre(row, tarihStr) {
  if (row.GunlukTarihGoster === false) {
    return '<td class="gunluk-hucre-bos"></td>';
  }
  return `<td class="text-nowrap small text-secondary">${gunlukMetinEsc(tarihStr)}</td>`;
}

function gunlukIslemTurHucre(row, turBadge, turEtiket, mobilIkon, ek = '', alt = '') {
  if (row.GunlukTurBaslikGoster === false) {
    return '<td class="gunluk-hucre-bos gunluk-tur-bos"></td>';
  }
  const etiket = gunlukIslemTurEtiketMetin(row, turEtiket);
  const tahsilatTur = gunlukIslemTahsilatSatirMi(row) ? ' gunluk-tur-tahsilat' : '';
  const nowrap = alt ? '' : ' text-nowrap';
  const odTip = gunlukOdemeTipNorm(
    row.GunlukGrupOdeme != null && gunlukIslemTahsilatSatirMi(row)
      ? row.GunlukGrupOdeme
      : row.Odeme,
  );
  const odemeIkon =
    gunlukIslemTahsilatSatirMi(row) || row.SatirTur === 'mal_alim_kalem' || row.Kaynak === 'tedarikci_odeme'
      ? gunlukOdemeIkonHtml(odTip)
      : '';
  return `<td class="gunluk-tur-hucre${nowrap}${tahsilatTur}">${ek}<span class="badge ${turBadge}">${gunlukMetinEsc(etiket)}</span>${odemeIkon}${mobilIkon}${alt}</td>`;
}

function gunlukIslemSatirSiniflari(row, ek = '') {
  let cls = `musteri-hareket-ana${ek}`;
  if (row.GunlukGrupTema) cls += ` ${row.GunlukGrupTema}`;
  if (row.GunlukGrupUst) cls += ' gunluk-grup-ust';
  if (row.GunlukGrupTahsilat) cls += ' gunluk-grup-tahsilat';
  if (gunlukIslemTahsilatSatirMi(row)) cls += ' gunluk-tahsilat-satir';
  if (row.GunlukTahsilatOncesi) cls += ' gunluk-tahsilat-oncesi';
  if (row.GunlukGrupSon) cls += ' gunluk-islem-grup-son';
  if (row.GunlukGrupIc) cls += ' gunluk-islem-grup-ic';

  const odTip = gunlukOdemeTipNorm(row.GunlukGrupOdeme || row.Odeme);
  const malAlim =
    row.Kaynak === 'mal_alim' ||
    row.Kaynak === 'mal_alim_odeme' ||
    row.Kaynak === 'tedarikci_odeme' ||
    row.SatirTur === 'mal_alim_kalem' ||
    row.SatirTur === 'mal_alim_odeme';
  const yonCikis = row.Yon === 'cikis' || malAlim;
  if (odTip === 'veresiye') cls += ' gunluk-satir-veresiye';
  else if (odTip === 'nakit' || odTip === 'kart' || odTip === 'havale') {
    cls += yonCikis ? ' gunluk-satir-kasa-cikis' : ' gunluk-satir-odendi';
  }
  if (malAlim && (row.SatirTur === 'mal_alim_kalem' || row.Kaynak === 'mal_alim')) {
    cls += ' gunluk-satir-mal-alim';
  }
  return cls;
}

let _gunlukOzetSon = null;

function gunlukOzetDetayDoldur() {
  const oz = (_gunlukOzetSon && _gunlukOzetSon.ozet) || {};
  const veresiyesiz =
    oz.toplamVeresiyesiz != null
      ? oz.toplamVeresiyesiz
      : Math.max(0, (Number(oz.toplam) || 0) - (Number(oz.veresiye) || 0));

  const set = (id, val) => {
    const n = document.getElementById(id);
    if (n) n.textContent = gunlukParaFmt(val);
  };
  set('godNakit', oz.nakit);
  set('godKart', oz.kart);
  set('godHavale', oz.havale);
  set('godVeresiye', oz.veresiye);
  set('godCiro', veresiyesiz);
  set('godCiroVeresiyeli', oz.toplam);
  set('godKasaGiris', oz.kasaGiris);
  set('godGiderNakit', oz.giderNakit);
  set('godGiderKart', oz.giderKart);
  set('godGiderHavale', oz.giderHavale);
  set('godMalAlimVeresiye', oz.malAlimVeresiye);
  set('godTedarikciKasa', oz.giderTedarikciKasa);
  set('godGenelKasa', oz.giderGenelKasa);
  set('godGiderKasa', oz.giderKasaToplam);
}

function gunlukOzetDetayAc(_kaynak) {
  const el = document.getElementById('gunlukOzetDetayModal');
  if (!el) return;
  const bas = document.getElementById('gunlukBaslangic')?.value || '';
  const bit = document.getElementById('gunlukBitis')?.value || '';
  const godBas = document.getElementById('godBaslangic');
  const godBit = document.getElementById('godBitis');
  if (godBas) godBas.value = bas;
  if (godBit) godBit.value = bit;
  gunlukOzetDetayDoldur();
  bootstrap.Modal.getOrCreateInstance(el).show();
}

async function gunlukOzetDetayListele() {
  const godBas = document.getElementById('godBaslangic')?.value || '';
  const godBit = document.getElementById('godBitis')?.value || '';
  if (!godBas || !godBit) {
    alert('Başlangıç ve bitiş tarihlerini seçin.');
    return;
  }
  const mainBas = document.getElementById('gunlukBaslangic');
  const mainBit = document.getElementById('gunlukBitis');
  if (mainBas) mainBas.value = godBas;
  if (mainBit) mainBit.value = godBit;
  await gunlukIslemleriYukle();
  gunlukOzetDetayDoldur();
}

async function gunlukIslemleriYukle() {
  const bas = document.getElementById('gunlukBaslangic').value;
  const bit = document.getElementById('gunlukBitis').value;
  const tbody = document.getElementById('gunlukIslemTablosu');
  if (!bas || !bit) {
    alert('Başlangıç ve bitiş tarihlerini seçin.');
    return;
  }
  tbody.innerHTML = `<tr><td colspan="${GUNLUK_TABLO_KOLON}" class="text-center text-muted py-4">Yükleniyor…</td></tr>`;
  try {
    const u = new URL('/api/gunluk-islemler', window.location.origin);
    u.searchParams.set('baslangic', bas);
    u.searchParams.set('bitis', bit);
    const res = await fetch(u);
    if (!res.ok) throw new Error('İstek başarısız');
    const data = await res.json();
    const oz = data.ozet || {};
    _gunlukOzetSon = {
      bas,
      bit,
      ozet: oz,
      cariAlacakToplam: data.cariAlacakToplam,
    };

    document.getElementById('ozNakit').textContent = gunlukParaFmt(oz.nakit);
    document.getElementById('ozKart').textContent = gunlukParaFmt(oz.kart);
    document.getElementById('ozHavale').textContent = gunlukParaFmt(oz.havale);
    document.getElementById('ozVeresiye').textContent = gunlukParaFmt(oz.veresiye);
    const veresiyesiz =
      oz.toplamVeresiyesiz != null
        ? oz.toplamVeresiyesiz
        : Math.max(0, (Number(oz.toplam) || 0) - (Number(oz.veresiye) || 0));
    const ozVeresiyesizEl = document.getElementById('ozToplamVeresiyesiz');
    if (ozVeresiyesizEl) ozVeresiyesizEl.textContent = gunlukParaFmt(veresiyesiz);
    document.getElementById('ozToplam').textContent = gunlukParaFmt(oz.toplam);
    document.getElementById('gunlukKasaGirisOzet').textContent = gunlukParaFmt(oz.kasaGiris);
    document.getElementById('gunlukCariAlacak').textContent = gunlukParaFmt(data.cariAlacakToplam);

    const gn = document.getElementById('ozGiderNakit');
    const gk = document.getElementById('ozGiderKart');
    const gh = document.getElementById('ozGiderHavale');
    const mv = document.getElementById('ozMalAlimVeresiye');
    const gkt = document.getElementById('ozGiderKasaToplam');
    if (gn) gn.textContent = gunlukParaFmt(oz.giderNakit);
    if (gk) gk.textContent = gunlukParaFmt(oz.giderKart);
    if (gh) gh.textContent = gunlukParaFmt(oz.giderHavale);
    if (mv) mv.textContent = gunlukParaFmt(oz.malAlimVeresiye);
    if (gkt) gkt.textContent = gunlukParaFmt(oz.giderKasaToplam);

    const gtk = document.getElementById('ozGiderTedarikciKasa');
    const ggk = document.getElementById('ozGiderGenelKasa');
    if (gtk) gtk.textContent = gunlukParaFmt(oz.giderTedarikciKasa);
    if (ggk) ggk.textContent = gunlukParaFmt(oz.giderGenelKasa);

    const detayEl = document.getElementById('gunlukOzetDetayModal');
    if (detayEl?.classList.contains('show')) {
      const godBas = document.getElementById('godBaslangic');
      const godBit = document.getElementById('godBitis');
      if (godBas) godBas.value = bas;
      if (godBit) godBit.value = bit;
      gunlukOzetDetayDoldur();
    }

    const liste = gunlukIslemGruplariIsaretle(data.islemler || []);
    if (liste.length === 0) {
      tbody.innerHTML =
        `<tr><td colspan="${GUNLUK_TABLO_KOLON}" class="text-center text-muted py-4">Bu tarihler arasında kayıt yok.</td></tr>`;
      return;
    }

    tbody.innerHTML = liste
      .map((row) => {
        const tarihStr = tarihTrGoster(row.Tarih);
        const kaynak = row.Kaynak || 'satis';
        const satirTur = row.SatirTur || '';
        const od = row.Odeme || 'Diğer';
        const kalemSatir =
          satirTur === 'satis_kalem' || (satirTur === 'mal_alim_kalem' && !gunlukIslemMalAlimOdemeSatirMi(row));
        const malAlimKalem = satirTur === 'mal_alim_kalem';
        const satisSatir =
          satirTur === 'satis_kalem' ||
          satirTur === 'satis' ||
          kaynak === 'musteri_satis' ||
          kaynak === 'satis';
        const tahsilatSatir = gunlukIslemTahsilatSatirMi(row);

        const yon = row.Yon === 'cikis' ? 'cikis' : 'giris';

        const turEtiket = gunlukKaynakEtiket(kaynak, od, row.TurEtiket);
        const mobilIkon = row.MobilKaynak
          ? ' <i class="fa-solid fa-mobile-screen-button text-info" title="Mobil"></i>'
          : '';

        const malOdemeSatir = gunlukIslemMalAlimOdemeSatirMi(row);
        const eksikOdemeSatir =
          satirTur === 'eksik_odeme' || kaynak === 'satis_eksik';
        let turBadge = 'bg-secondary';
        if (satisSatir) turBadge = 'bg-danger';
        else if (malOdemeSatir && row.Odeme === 'Veresiye') turBadge = 'bg-danger';
        else if (eksikOdemeSatir) turBadge = 'bg-warning text-dark';
        else if (tahsilatSatir) turBadge = 'bg-success';
        else if (kaynak === 'kasa') turBadge = 'bg-primary';
        else if (kaynak === 'iptal') turBadge = 'bg-danger';
        else if (kaynak === 'mal_alim' || malAlimKalem) turBadge = 'bg-warning text-dark';
        else if (kaynak === 'tedarikci_odeme') turBadge = 'bg-danger';
        else if (kaynak === 'genel_gider') turBadge = 'bg-dark';

        let tutClass = yon === 'cikis' ? 'text-danger' : 'text-dark';
        if (satisSatir) tutClass = 'text-danger';
        else if (malAlimKalem) tutClass = 'text-danger';
        else if (eksikOdemeSatir) tutClass = 'gunluk-tutar-veresiye';
        else if (tahsilatSatir) {
          const odTip = gunlukOdemeTipNorm(row.GunlukGrupOdeme || row.Odeme);
          tutClass = odTip === 'veresiye' ? 'gunluk-tutar-veresiye' : 'text-success';
        }

        const detayGoster =
          row.LogID &&
          !String(row.IslemTipi || '').toLowerCase().includes('iptal') &&
          !tahsilatSatir &&
          (!kalemSatir || Number(row.KalemSira) === 0) &&
          ['satis', 'kasa', 'musteri_satis', 'mal_alim', 'tedarikci_odeme'].includes(
            kaynak === 'mal_alim' || malAlimKalem
              ? 'mal_alim'
              : kaynak === 'tedarikci_odeme'
                ? 'tedarikci_odeme'
                : kaynak
          );
        const perakendeAksiyon = gunlukPerakendeAksiyonSatirMi(row);
        let detayBtn = '<span class="text-muted small">—</span>';
        if (perakendeAksiyon) {
          const lid = Number(row.GrupLogID || row.LogID);
          detayBtn = `<div class="gunluk-islem-aksiyon d-inline-flex gap-1">
              <button type="button" class="btn btn-sm btn-warning text-dark" onclick="gunlukPerakendeDuzenleAc(${lid})" title="Düzenle">
                <i class="fa-solid fa-pencil"></i>
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger" onclick="gunlukPerakendeSil(${lid})" title="Sil">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>`;
        } else if (detayGoster) {
          const tid = Number(row.TedarikciID) || 0;
          const tedarikciDetay =
            kaynak === 'mal_alim' || malAlimKalem || kaynak === 'tedarikci_odeme';
          if (tedarikciDetay && tid > 0) {
            detayBtn = `<button type="button" class="btn btn-sm btn-outline-secondary" onclick="gunlukIslemTedarikciCarisineGit(${tid})" title="Tedarikçi cari">
                <i class="fa-solid fa-circle-info"></i>
              </button>`;
          } else if (!tedarikciDetay) {
            detayBtn = `<button type="button" class="btn btn-sm btn-outline-secondary" onclick="gunlukIslemDetayAc(${Number(row.LogID)}, '${String(kaynak).replace(/'/g, "\\'")}', ${Number(row.HareketID || row.LogID)})" title="Detay">
                <i class="fa-solid fa-circle-info"></i>
              </button>`;
          }
        }

        const faturaAlt = '';
        const grupCls = '';

        let musteriAdMetin = mobilOnekTemizle(
          row.MusteriAd || row.KisaAciklama || gunlukIslemAciklamaGoster(row),
        );
        if (kaynak === 'mal_alim' || malAlimKalem) {
          const tedAd = gunlukMalAlimTedarikciAd(row);
          if (tedAd) musteriAdMetin = tedAd;
        }
        if (tahsilatSatir) {
          musteriAdMetin = String(musteriAdMetin)
            .replace(/\s*—\s*tahsilat\s*$/i, '')
            .trim() || musteriAdMetin;
        }
        const miktar = Number(row.Miktar || 0);
        const satirTutar = Number(row.Tutar || 0);
        let birimSayi = Number(row.BirimFiyat || 0);
        if (birimSayi <= 0 && satirTutar > 0 && miktar > 0) {
          birimSayi = Math.round((satirTutar / miktar) * 100) / 100;
        }
        const birimFmt = birimSayi > 0 ? gunlukParaFmt(birimSayi) : '—';
        if (kalemSatir) {
          const kalemCls = malAlimKalem ? ' gunluk-kalem-satir gunluk-mal-alim-kalem' : ' gunluk-kalem-satir';
          const tutarCls = malAlimKalem ? 'gunluk-mal-alim-tutar' : 'gunluk-kalem-tutar';
          const grupKalemAdet = Number(row.GunlukGrupKalemAdet || 0);
          const grupKalemToplam = Number(row.GunlukGrupKalemToplam || 0);
          const grupToplamGoster =
            row.GunlukTurBaslikGoster !== false &&
            grupKalemAdet > 1 &&
            grupKalemToplam > 0.009;
          const turAlt = grupToplamGoster
            ? `<div class="gunluk-grup-toplam" title="Bu işlemin toplamı">Toplam ${gunlukMetinEsc(gunlukParaFmt(grupKalemToplam))}</div>`
            : '';
          const sonKalem =
            kalemSatir &&
            (row.GunlukGrupSon || row.GunlukTahsilatOncesi) &&
            grupKalemAdet > 1 &&
            grupKalemToplam > 0.009;
          const tutarHucre = sonKalem
            ? `<td class="text-end text-nowrap gunluk-tutar-hucre">
                <div class="${tutarCls}">${satirTutar.toFixed(2)} ₺</div>
                <div class="gunluk-grup-toplam-satir" title="Bu işlemin toplamı">Σ ${gunlukMetinEsc(gunlukParaFmt(grupKalemToplam))}</div>
              </td>`
            : `<td class="text-end text-nowrap gunluk-tutar-hucre ${tutarCls}">${satirTutar.toFixed(2)} ₺</td>`;
          return `<tr class="${gunlukIslemSatirSiniflari(row, kalemCls)}">
          ${gunlukIslemTarihHucre(row, tarihStr)}
          ${gunlukIslemMusteriHucre(row, musteriAdMetin)}
          ${gunlukIslemTurHucre(row, turBadge, turEtiket, mobilIkon, '', turAlt)}
          <td class="gunluk-kalem-urun">${gunlukMetinEsc(row.UrunAdi || '-')}</td>
          <td class="text-center text-nowrap">${miktar}</td>
          <td class="text-end text-nowrap">${birimFmt}</td>
          ${tutarHucre}
          <td class="text-end">${detayBtn}</td>
        </tr>`;
        }

        const aciklamaMetin = gunlukIslemAciklamaGoster(row);
        const musteriHucreMetin =
          tahsilatSatir || kaynak === 'mal_alim' || malAlimKalem ? musteriAdMetin : aciklamaMetin;
        const urunHucre = tahsilatSatir
          ? '<span class="text-muted">—</span>'
          : '<span class="text-muted">—</span>';
        const adetHucre = '—';
        const birimHucre = '—';

        return `<tr class="${gunlukIslemSatirSiniflari(row, grupCls)}">
          ${gunlukIslemTarihHucre(row, tarihStr)}
          ${gunlukIslemMusteriHucre(row, musteriHucreMetin)}
          ${gunlukIslemTurHucre(row, turBadge, turEtiket, mobilIkon)}
          <td>${urunHucre}</td>
          <td class="text-center text-muted">${adetHucre}</td>
          <td class="text-end text-muted">${birimHucre}</td>
          <td class="text-end text-nowrap gunluk-tutar-hucre ${tutClass}">${Number(row.Tutar || 0).toFixed(2)} ₺</td>
          <td class="text-end">${detayBtn}</td>
        </tr>${faturaAlt}`;
      })
      .join('');
  } catch (hata) {
    console.error(hata);
    tbody.innerHTML =
      `<tr><td colspan="${GUNLUK_TABLO_KOLON}" class="text-center text-danger py-4">Veriler yüklenemedi.</td></tr>`;
  }
}

let gunlukAktifLogID = null;
let gunlukAktifMusteriID = null;
let gunlukAktifHareketID = null;
let gunlukIslemModalGeriAc = false;

function gunlukIslemModalGeciciKapat() {
  const listeEl = document.getElementById('gunlukIslemModal');
  if (!listeEl?.classList.contains('show')) {
    gunlukIslemModalGeriAc = false;
    return Promise.resolve();
  }
  gunlukIslemModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    listeEl.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(listeEl);
    setTimeout(bitti, 450);
  });
}

function gunlukIslemDetaySifreOdakla() {
  const blok = document.getElementById('gidIptalBlok');
  const sifre = document.getElementById('gidIptalSifre');
  if (!sifre || blok?.classList.contains('d-none')) return;
  sifre.readOnly = false;
  sifre.disabled = false;
  try {
    sifre.focus({ preventScroll: true });
  } catch (_) {
    sifre.focus();
  }
}

async function gunlukIslemTedarikciCarisineGit(tedarikciID) {
  const tid = Number(tedarikciID);
  if (!Number.isInteger(tid) || tid < 1) {
    alert('Tedarikçi bilgisi bulunamadı.');
    return;
  }
  await gunlukIslemModalGeciciKapat();
  await tedarikciCariModalAc(tid);
}

async function gunlukIslemDetayAc(logID, kaynak, hareketID) {
  const id = parseInt(logID, 10);
  if (!Number.isInteger(id) || id < 1) return;
  const k = String(kaynak || '').trim();
  if (k === 'mal_alim' || k === 'mal_alim_kalem' || k === 'mal_alim_odeme' || k === 'tedarikci_odeme') {
    return;
  }
  gunlukAktifLogID = id;
  const uyari = document.getElementById('gidIptalUyari');
  const iptalBlok = document.getElementById('gidIptalBlok');
  const cariBlok = document.getElementById('gidCariYonlendir');
  const sifreEl = document.getElementById('gidIptalSifre');
  gunlukAktifMusteriID = null;
  gunlukAktifHareketID = null;
  if (sifreEl) sifreEl.value = '';
  if (uyari) uyari.classList.add('d-none');
  if (cariBlok) cariBlok.classList.add('d-none');
  if (iptalBlok) iptalBlok.classList.add('d-none');

  const u = new URL(`/api/gunluk-islem/${id}/detay`, window.location.origin);
  if (kaynak) u.searchParams.set('kaynak', String(kaynak));
  const hid = parseInt(hareketID, 10);
  if (Number.isInteger(hid) && hid > 0) u.searchParams.set('hareketID', String(hid));

  const res = await fetch(u);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.message || 'Detay alınamadı.');
    return;
  }

  const log = data.log || {};
  document.getElementById('gidTarih').textContent = tarihTrGoster(log.Tarih);
  document.getElementById('gidKullanici').textContent = log.KullaniciAdi || '—';

  const odeme = data.odeme || 'Diğer';
  const odemeEl = document.getElementById('gidOdeme');
  odemeEl.textContent = odeme;
  odemeEl.className = 'badge';
  if (odeme === 'Nakit') odemeEl.classList.add('bg-success');
  else if (odeme === 'Kart') odemeEl.classList.add('bg-primary');
  else if (odeme === 'Havale') odemeEl.classList.add('bg-warning', 'text-dark');
  else if (odeme === 'Veresiye') odemeEl.classList.add('bg-danger');
  else odemeEl.classList.add('bg-secondary');

  const malAlim = !!data.malAlim;
  const musteriBaslik = document.getElementById('gidMusteriBaslik');
  if (musteriBaslik) musteriBaslik.textContent = malAlim ? 'Tedarikçi:' : 'Müşteri:';
  document.getElementById('gidMusteri').textContent = data.musteriAd
    ? data.musteriAd
    : data.musteriID
      ? `Müşteri #${data.musteriID}`
        : malAlim
        ? '—'
        : PERAKENDE_ISLEM;
  document.getElementById('gidSepetToplam').textContent = gunlukParaFmt(data.sepetToplam);
  document.getElementById('gidTahsilat').textContent = gunlukParaFmt(data.tahsilatTutar);
  document.getElementById('gidVeresiye').textContent = gunlukParaFmt(data.veresiyeTutar);

  const detaylar = data.detaylar || [];
  const tb = document.getElementById('gidKalemler');
  if (!detaylar.length) {
    tb.innerHTML =
      '<tr><td colspan="4" class="text-center text-muted py-3">Kalem detayı bulunamadı (eski kayıt).</td></tr>';
  } else {
    tb.innerHTML = detaylar
      .map((d) => {
        const birim =
          d.BirimFiyat != null && Number(d.BirimFiyat) > 0
            ? gunlukParaFmt(d.BirimFiyat)
            : '—';
        const satir =
          d.SatirTutar != null && Number(d.SatirTutar) > 0
            ? gunlukParaFmt(d.SatirTutar)
            : '—';
        return `<tr>
          <td>${gunlukMetinEsc(d.UrunAdi || '-')}</td>
          <td class="text-center">${Number(d.Miktar || 0)}</td>
          <td class="text-end">${birim}</td>
          <td class="text-end fw-semibold">${satir}</td>
        </tr>`;
      })
      .join('');
  }

  gunlukAktifMusteriID = data.musteriID || null;
  gunlukAktifHareketID = data.hareketID || null;

  if (malAlim) {
    if (iptalBlok) iptalBlok.classList.add('d-none');
    if (cariBlok) cariBlok.classList.add('d-none');
    if (uyari) {
      uyari.textContent = 'Mal alım düzeltme veya silme işlemi tedarikçi carisinden yapılır.';
      uyari.classList.remove('d-none');
    }
  } else if (data.iptalEdildi) {
    if (uyari) {
      uyari.textContent = 'Bu satış iptal edilmiş.';
      uyari.classList.remove('d-none');
    }
  } else if (data.iptalYeri === 'cari' || data.musterili) {
    if (uyari) {
      const logTip = String(log.IslemTipi || '');
      uyari.textContent = /ödeme|odeme/i.test(logTip)
        ? 'Müşteri tahsilatı — iptal veya düzeltme için müşteri carisine gidin.'
        : 'Müşteri cari satışı — iptal için müşteri carisinde ilgili satırı silin (günlük kayıt da iptal edilir).';
      uyari.classList.remove('d-none');
    }
    if (cariBlok) cariBlok.classList.remove('d-none');
  } else if (!data.iptalEdilebilir) {
    if (uyari) {
      uyari.textContent =
        'Bu kayıt için güvenli iptal verisi yok (eski perakende satış). Yeni perakende satışlarda günlük iptal kullanılabilir.';
      uyari.classList.remove('d-none');
    }
  } else if (iptalBlok) {
    iptalBlok.classList.remove('d-none');
  }

  await gunlukIslemModalGeciciKapat();

  const detayEl = document.getElementById('gunlukIslemDetayModal');
  const onShown = () => {
    tarayiciOneriModalGirdileriAc(detayEl);
    modalEnUsteGetir(detayEl);
    modalArtigiTemizle();
    gunlukIslemDetaySifreOdakla();
    setTimeout(gunlukIslemDetaySifreOdakla, 50);
  };
  detayEl.addEventListener('shown.bs.modal', onShown, { once: true });
  bootstrap.Modal.getOrCreateInstance(detayEl, { focus: true }).show();
}

function gunlukIslemMusteriCarisineGit() {
  const mid = gunlukAktifMusteriID;
  if (!mid) return;
  gunlukIslemModalGeriAc = false;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('gunlukIslemDetayModal')).hide();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('gunlukIslemModal')).hide();
  musteriDetayModalAc(mid);
}

async function gunlukIslemIptalEt() {
  if (!gunlukAktifLogID) return;
  const sifre = document.getElementById('gidIptalSifre')?.value || '';
  if (!sifre) {
    alert('İptal için şifrenizi girin.');
    return;
  }
  if (!confirm('Bu perakende satışı iptal etmek istiyor musunuz? Stok ve kasa geri alınır.')) return;

  const btn = document.getElementById('gidIptalBtn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`/api/gunluk-islem/${gunlukAktifLogID}/iptal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kullaniciAdi: aktifKullaniciLogin || aktifKullanici,
        sifre,
        kullanici: aktifKullanici || 'Sistem',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'İptal başarısız.');
      return;
    }
    alert(data.message || 'Satış iptal edildi.');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('gunlukIslemDetayModal')).hide();
    await gunlukIslemleriYukle();
    stoklariGetir();
    ozetBilgileriniGetir();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function gunlukPerakendeSil(logID) {
  const id = parseInt(logID, 10);
  if (!Number.isInteger(id) || id < 1) return;
  const sifre = window.prompt('Perakende satışı silmek için giriş şifrenizi girin:');
  if (!sifre) return;
  if (!confirm('Bu perakende satış silinsin mi? Stok ve kasa geri alınır.')) return;
  try {
    const res = await fetch(`/api/gunluk-islem/${id}/iptal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kullaniciAdi: aktifKullaniciLogin || aktifKullanici,
        sifre,
        kullanici: aktifKullanici || 'Sistem',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Silme başarısız.');
      return;
    }
    alert(data.message || 'Satış silindi.');
    await gunlukIslemleriYukle();
    stoklariGetir();
    ozetBilgileriniGetir();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

let _gunlukDuzenleLogID = null;

async function gunlukPerakendeDuzenleAc(logID) {
  const id = parseInt(logID, 10);
  if (!Number.isInteger(id) || id < 1) return;
  try {
    const res = await fetch(`/api/gunluk-islem/${id}/detay`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.message || 'Detay alınamadı.');
      return;
    }
    if (!data.duzenleEdilebilir && !data.iptalEdilebilir) {
      if (data.musterili) {
        alert('Bu satış müşteri carisine kayıtlı. Düzenleme ve silme müşteri carisinden yapılır.');
      } else {
        alert('Bu perakende satış düzenlenemez (eski kayıt veya detay eksik).');
      }
      return;
    }
    const detaylar = data.detaylar || [];
    if (!detaylar.length) {
      alert('Kalem detayı bulunamadı; düzenleme yapılamaz.');
      return;
    }
    hizliSatisSepet = [];
    hizliSatisSatirSayac = 0;
    for (const d of detaylar) {
      hizliSatisSatirSayac += 1;
      hizliSatisSepet.push({
        satirId: hizliSatisSatirSayac,
        stokID: d.StokID,
        urunAdi: d.UrunAdi || '-',
        birim: 'Adet',
        birimFiyat: Number(d.BirimFiyat) || 0,
        miktar: Math.max(1, Number(d.Miktar) || 1),
        mevcutStok: 9999,
      });
    }
    _gunlukDuzenleLogID = id;
    sepetiYenidenCiz();
    modalSepetTablosunuDoldur();

    const odeme = data.odeme || 'Nakit';
    const radio = document.querySelector(`#hizliSatisOnayModal input[name="odemeTipi"][value="${odeme}"]`);
    if (radio) radio.checked = true;
    const panel = document.getElementById('hizliSatisMusteriPanel');
    if (panel) panel.classList.add('d-none');
    hizliSatisMusteriTemizle();
    _hizliSatisMusteriMod = 'yok';
    hizliSatisMusteriModuSifirla();
    const odeyecegi = document.getElementById('hizliSatisOdeyecegiTutar');
    if (odeyecegi) {
      odeyecegi.dataset.manual = '0';
      const tah = data.tahsilatTutar != null ? Number(data.tahsilatTutar) : hizliSatisSepetToplamHesapla();
      odeyecegi.value = tah.toFixed(2);
    }
    const baslik = document.getElementById('hizliSatisOnayModalLabel');
    if (baslik) {
      baslik.innerHTML = '<i class="fa-solid fa-pencil me-2 text-warning"></i>Perakende düzenle';
    }
    const btn = document.getElementById('btnHizliKesinlestir');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i>Kaydet';

    await gunlukIslemModalGeciciKapat();
    const modalEl = document.getElementById('hizliSatisOnayModal');
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    hizliSatisOdemeGuncelle();
    hizliSatisKesinlestirBtnGuncelle();
    if (btn) btn.disabled = false;
  } catch (e) {
    console.error(e);
    alert('Detay yüklenemedi.');
  }
}

function gunlukPerakendeDuzenleSifirla() {
  _gunlukDuzenleLogID = null;
  const baslik = document.getElementById('hizliSatisOnayModalLabel');
  if (baslik) {
    baslik.innerHTML = '<i class="fa-solid fa-receipt me-2 text-warning"></i>Ödeme';
  }
  const btn = document.getElementById('btnHizliKesinlestir');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-check me-1"></i>Tamamla';
}

let aktifKullanici = '';
let aktifKullaniciLogin = '';
let uygulamaAyarlari = {
  OtomatikMakbuz: 0,
  MakbuzSonNo: 0,
  SirketUnvan: '',
  SirketYetkiliAdSoyad: '',
  SirketVergiNo: '',
  SirketTelefon: '',
  SirketAdres: '',
};
let sonMakbuzDokumani = '';
let sonCariEkstreModu = false;

function uygulamaBasliklariniGuncelle() {
  const unvan = String(uygulamaAyarlari?.SirketUnvan || '').trim() || 'Elektrikçi Otomasyonu';
  const yetkili = String(uygulamaAyarlari?.SirketYetkiliAdSoyad || '').trim();
  const alt = yetkili ? `Yetkili: ${yetkili}` : 'Kullanıcı Girişi';
  const navbarAlt = yetkili ? `Yetkili: ${yetkili}` : 'Yetkili: -';

  const elNavbar = document.getElementById('appBaslikNavbar');
  const elGiris = document.getElementById('appBaslikGiris');
  const elGirisAlt = document.getElementById('appAltBaslikGiris');
  const elNavbarAlt = document.getElementById('appAltBaslikNavbar');

  if (elNavbar) elNavbar.textContent = unvan;
  if (elGiris) elGiris.textContent = unvan;
  if (elGirisAlt) elGirisAlt.textContent = alt;
  if (elNavbarAlt) elNavbarAlt.textContent = navbarAlt;
  document.title = unvan;
}

function ayarlarModalAc() {
  const oto = document.getElementById('ayrOtomatikMakbuz');
  const no = document.getElementById('ayrMakbuzBaslangicNo');
  const unvan = document.getElementById('ayrSirketUnvan');
  const yetkili = document.getElementById('ayrSirketYetkiliAdSoyad');
  const vergi = document.getElementById('ayrSirketVergiNo');
  const tel = document.getElementById('ayrSirketTelefon');
  const adres = document.getElementById('ayrSirketAdres');
  if (oto) oto.checked = !!Number(uygulamaAyarlari?.OtomatikMakbuz || 0);
  if (no) no.value = Number(uygulamaAyarlari?.MakbuzSonNo || 0) + 1;
  if (unvan) unvan.value = uygulamaAyarlari?.SirketUnvan || '';
  if (yetkili) yetkili.value = uygulamaAyarlari?.SirketYetkiliAdSoyad || '';
  if (vergi) vergi.value = uygulamaAyarlari?.SirketVergiNo || '';
  if (tel) tel.value = uygulamaAyarlari?.SirketTelefon || '';
  if (adres) adres.value = uygulamaAyarlari?.SirketAdres || '';
  ayarYedekListele();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('ayarlarModal')).show();
}

async function ayarlariYukle() {
  try {
    const res = await fetch('/api/ayarlar');
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      uygulamaAyarlari = { ...uygulamaAyarlari, ...(data || {}) };
      uygulamaBasliklariniGuncelle();
    }
  } catch (e) {
    console.error('Ayarlar yüklenemedi:', e);
  }
}

// Giriş ekranı dahil başlıkların sayfa açılışında şirket bilgileriyle gelmesi için.
uygulamaBasliklariniGuncelle();
document.addEventListener('DOMContentLoaded', () => {
  ayarlariYukle();
  arayuzuKorumaBaslat();
  if (document.getElementById('ana-uygulama')?.style.display === 'block') {
    anaUygulamayiAc();
    setTimeout(guncellemeOtomatikKontrol, 800);
  }
});

async function ayarlarKaydet(event) {
  event.preventDefault();
  const body = {
    otomatikMakbuz: document.getElementById('ayrOtomatikMakbuz')?.checked ? 1 : 0,
    makbuzBaslangicNo: parseInt(document.getElementById('ayrMakbuzBaslangicNo')?.value || '0', 10),
    sirketUnvan: document.getElementById('ayrSirketUnvan')?.value?.trim() || '',
    sirketYetkiliAdSoyad: document.getElementById('ayrSirketYetkiliAdSoyad')?.value?.trim() || '',
    sirketVergiNo: document.getElementById('ayrSirketVergiNo')?.value?.trim() || '',
    sirketTelefon: document.getElementById('ayrSirketTelefon')?.value?.trim() || '',
    sirketAdres: document.getElementById('ayrSirketAdres')?.value?.trim() || '',
  };
  const res = await fetch('/api/ayarlar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'Ayarlar kaydedilemedi.');
    return;
  }
  await ayarlariYukle();
  alert(data.message || 'Ayarlar kaydedildi.');
  const inst = bootstrap.Modal.getInstance(document.getElementById('ayarlarModal'));
  if (inst) inst.hide();
}

async function ayarYedekListele() {
  const el = document.getElementById('ayrYedekListe');
  if (!el) return;
  el.innerHTML = '<span class="text-muted">Yükleniyor…</span>';
  try {
    const res = await fetch('/api/yedekler');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      el.innerHTML = '<span class="text-danger">Yedek listesi alınamadı.</span>';
      return;
    }
    const rows = Array.isArray(data.backups) ? data.backups : [];
    if (!rows.length) {
      el.innerHTML = '<span class="text-muted">Henüz yedek yok.</span>';
      return;
    }
    el.innerHTML = rows.map((r) => {
      const dt = tarihTrGoster(r.tarih);
      const kb = Math.round((Number(r.boyut || 0) / 1024) * 10) / 10;
      const dosya = gunlukMetinEsc(r.dosyaAdi || '');
      return `<div class="d-flex justify-content-between align-items-center border-bottom py-1">
        <div class="small">
          <div class="fw-semibold">${dosya}</div>
          <div class="text-muted">${gunlukMetinEsc(dt)} · ${kb} KB</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error(e);
    el.innerHTML = '<span class="text-danger">Yedek listesi alınamadı.</span>';
  }
}

async function ayarYedekAl() {
  try {
    const res = await fetch('/api/yedek-al', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Yedek alınamadı.');
      return;
    }
    alert(data.message || 'Yedek oluşturuldu.');
    ayarYedekListele();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function ayarYedekGeriYukle(dosyaAdi) {
  if (!dosyaAdi) return;
  const ok = confirm(`"${dosyaAdi}" yedeği geri yüklensin mi?\nMevcut veriler bununla değiştirilecektir.`);
  if (!ok) return;
  try {
    const res = await fetch('/api/yedek-geri-yukle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dosyaAdi }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Geri yükleme başarısız.');
      return;
    }
    alert(data.message || 'Yedek geri yüklendi. Sayfa yenilenecek.');
    window.location.reload();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

function gelenOdemeMakbuzunuIsle(makbuz) {
  if (!makbuz || !Number(uygulamaAyarlari?.OtomatikMakbuz || 0)) return false;
  setTimeout(() => makbuzOnizlemeAc(makbuz), 150);
  return true;
}

/** Ödeme kaydı sonrası: ayar açıksa makbuz önizleme, değilse alert */
function odemeSonrasiBildir(mesaj, makbuz) {
  if (gelenOdemeMakbuzunuIsle(makbuz)) return;
  if (mesaj) alert(mesaj);
}

function paraFmtTr(n) {
  return Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sayiYaziyaCevirTr(n) {
  const birler = ['', 'Bir', 'Iki', 'Uc', 'Dort', 'Bes', 'Alti', 'Yedi', 'Sekiz', 'Dokuz'];
  const onlar = ['', 'On', 'Yirmi', 'Otuz', 'Kirk', 'Elli', 'Altmis', 'Yetmis', 'Seksen', 'Doksan'];
  const binlikler = ['', 'Bin', 'Milyon', 'Milyar', 'Trilyon'];
  const ucHane = (num) => {
    const y = Math.floor(num / 100);
    const o = Math.floor((num % 100) / 10);
    const b = num % 10;
    let s = '';
    if (y > 0) s += (y === 1 ? 'Yuz' : `${birler[y]}Yuz`);
    if (o > 0) s += onlar[o];
    if (b > 0) s += birler[b];
    return s;
  };
  let x = Math.floor(Number(n || 0));
  if (!Number.isFinite(x) || x <= 0) return 'Sifir TL';
  let i = 0;
  let out = '';
  while (x > 0 && i < binlikler.length) {
    const part = x % 1000;
    if (part) {
      const txt = ucHane(part);
      if (i === 1 && part === 1) out = `Bin${out}`;
      else out = `${txt}${binlikler[i]}${out}`;
    }
    x = Math.floor(x / 1000);
    i += 1;
  }
  return `${out} TL`;
}

function makbuzDokumaniOlustur(makbuz) {
  const tarih = makbuz?.tarih ? new Date(makbuz.tarih) : new Date();
  const tarihKisa = Number.isNaN(tarih.getTime())
    ? new Date().toLocaleDateString('tr-TR')
    : tarih.toLocaleDateString('tr-TR');
  const company = {
    unvan: gunlukMetinEsc(uygulamaAyarlari?.SirketUnvan || 'ŞİRKET BİLGİSİ'),
    yetkili: gunlukMetinEsc(uygulamaAyarlari?.SirketYetkiliAdSoyad || '-'),
    vergi: gunlukMetinEsc(uygulamaAyarlari?.SirketVergiNo || '-'),
    tel: gunlukMetinEsc(uygulamaAyarlari?.SirketTelefon || '-'),
    adres: gunlukMetinEsc(uygulamaAyarlari?.SirketAdres || '-'),
  };
  const no = Number(makbuz?.no || 0);
  const tutarNum = Number(makbuz?.tutar || 0);
  const tutar = paraFmtTr(tutarNum);
  const musteri = gunlukMetinEsc(makbuz?.musteri || '-');
  const tur = gunlukMetinEsc(makbuz?.tur || 'Tahsilat');
  const odemeSekli = gunlukMetinEsc(makbuz?.odemeSekli || '-');
  const aciklama = gunlukMetinEsc(makbuz?.aciklama || '-');
  const kalan = paraFmtTr(makbuz?.kalanBakiye || 0);
  const yalniz = gunlukMetinEsc(sayiYaziyaCevirTr(tutarNum));
  const nakit = makbuz?.odemeSekli === 'Nakit' ? `${tutar} ₺` : '';
  const kart = makbuz?.odemeSekli === 'Kart' ? `${tutar} ₺` : '';
  const havale = makbuz?.odemeSekli === 'Havale' ? `${tutar} ₺` : '';
  const govde = `
    <div class="copy">
      <div class="row top">
        <div class="left">
          <div class="firm">${company.unvan}</div>
          <div class="meta">Yetkili: ${company.yetkili}</div>
          <div class="meta">${company.adres}</div>
          <div class="meta">Tel: ${company.tel}</div>
          <div class="meta">V.D / V.No: ${company.vergi}</div>
        </div>
        <div class="right">
          <div class="title">PARA MAKBUZU</div>
          <div class="line">NO: <b>${String(no).padStart(5, '0')}</b></div>
          <div class="line">Tarih: <b>${gunlukMetinEsc(tarihKisa)}</b></div>
          <div class="pay">Nakit : <b>${nakit}</b></div>
          <div class="pay">Kart  : <b>${kart}</b></div>
          <div class="pay">Havale: <b>${havale}</b></div>
        </div>
      </div>
      <div class="person">Sayın <b>${musteri}</b>'dan</div>
      <div class="amount">Yalnız <b>${yalniz}</b> alınmıştır.</div>
      <div class="desc">${tur} - ${odemeSekli}${aciklama && aciklama !== '-' ? ` (${aciklama})` : ''}</div>
      <div class="bottom">
        <div class="kalan">KALAN: ${kalan} ₺</div>
        <div class="imza">
          <div class="line-sign">TESLİM ALAN</div>
          <div class="name">${gunlukMetinEsc(aktifKullanici || 'Sistem')}</div>
        </div>
      </div>
    </div>`;
  return `
    <html>
      <head>
        <title>Makbuz #${no}</title>
        <style>
          @page { size: A4 portrait; margin: 8mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #111; }
          .page { height: 280mm; display: flex; flex-direction: column; position: relative; }
          .copy { flex: 1 1 0; border: 2px solid #111; border-radius: 12px; padding: 6mm 7mm; box-sizing: border-box; overflow: hidden; }
          .row.top { display: flex; justify-content: space-between; gap: 8mm; }
          .left { width: 62%; }
          .right { width: 36%; text-align: left; }
          .firm { font-size: 28px; font-weight: 900; letter-spacing: 0.3px; line-height: 1.05; }
          .meta { font-size: 13px; margin-top: 1px; }
          .title { font-size: 20px; font-weight: 900; text-align: right; margin-bottom: 2px; }
          .line { font-size: 18px; text-align: right; margin: 2px 0; }
          .pay { font-size: 24px; font-weight: 800; line-height: 1.05; margin-top: 2px; }
          .person { margin-top: 6mm; font-size: 22px; }
          .amount { margin-top: 2mm; font-size: 20px; border-bottom: 2px solid #222; padding-bottom: 1.5mm; }
          .desc { margin-top: 6mm; border-left: 4px solid #777; padding-left: 8px; font-size: 14px; font-weight: 700; }
          .bottom { margin-top: 6mm; display: flex; justify-content: space-between; align-items: flex-end; }
          .kalan { font-size: 24px; font-weight: 900; }
          .imza { width: 42%; text-align: center; }
          .line-sign { border-top: 3px solid #111; padding-top: 4px; font-size: 15px; font-weight: 800; }
          .name { margin-top: 3px; font-size: 17px; font-weight: 900; }
          .cutline { position: absolute; left: 0; right: 0; top: 50%; border-top: 2px dashed #888; transform: translateY(-1px); }
        </style>
      </head>
      <body>
        <div class="page">${govde}<div class="cutline"></div>${govde}</div>
      </body>
    </html>
  `;
}

function makbuzOnizlemeAc(makbuz) {
  belgeOnizlemeAcHtml(makbuzDokumaniOlustur(makbuz), '<i class="fa-solid fa-receipt me-2"></i>Makbuz Önizleme');
}

function makbuzOnizlemeYazdir() {
  if (!sonMakbuzDokumani) return;
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(sonMakbuzDokumani);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 150);
}

async function harekettenMakbuzOnizle(hareketID) {
  if (!aktifMusteriDetayID || !Number.isInteger(Number(hareketID))) return;
  const h = (aktifMusteriHareketler || []).find((x) => Number(x.HareketID) === Number(hareketID));
  if (!h) {
    alert('Hareket kaydı bulunamadı.');
    return;
  }
  const turRaw = String(h.Tur || '').toLowerCase();
  const tur = turRaw === 'iadeodeme' ? 'İade Ödemesi' : 'Tahsilat';
  const tutar = Number(h.OdenenTutar || h.ToplamTutar || 0);
  const mkz = {
    no: Number(h.MakbuzNo || h.HareketID || 0),
    tur,
    musteri: document.getElementById('mdAdSoyad')?.textContent || 'Müşteri',
    odemeSekli: h.OdemeSekli || '-',
    tutar,
    aciklama: h.Aciklama || '',
    kalanBakiye: Number(
      h.MakbuzKalanBakiye
      ?? (Number((document.getElementById('mdKalanBakiye')?.textContent || '0').replace(/[^\d,.-]/g, '').replace(',', '.')) || 0)
    ),
    tarih: h.Tarih || new Date().toISOString(),
  };
  makbuzOnizlemeAc(mkz);
}

function hizliGiris() {
  const ka = document.getElementById('kullaniciAdi');
  const sf = document.getElementById('sifre');
  if (ka) ka.value = 'admin';
  if (sf) sf.value = '1234';
  sistemeGiris();
}

async function sistemeGiris(event) {
  if (event && typeof event.preventDefault === 'function') event.preventDefault();
  const KullaniciAdi = document.getElementById('kullaniciAdi').value;
  const Sifre = document.getElementById('sifre').value;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ KullaniciAdi, Sifre }),
    });

    if (response.status === 401) {
      alert('Hatalı kullanıcı adı veya şifre!');
      return;
    }

    const sonuc = await response.json();

    if (sonuc.success) {
      girisEkraniniKapat();
      anaUygulamayiAc();
      setTimeout(guncellemeOtomatikKontrol, 800);

      aktifKullaniciLogin = sonuc.kullanici.KullaniciAdi;
      aktifKullanici = sonuc.kullanici.AdSoyad || sonuc.kullanici.KullaniciAdi;
      document.getElementById('aktifKullaniciIsmi').innerText = aktifKullanici;
      await ayarlariYukle();
      await demoDurumYukle();

      ozetBilgileriniGetir();
      stoklariGetir();
      musterileriGetir();
      servisleriGetir();
    }
  } catch (hata) {
    console.error('Giriş hatası:', hata);
    alert('Bağlantı hatası!');
  }
}

function profilModalAc() {
  if (!aktifKullaniciLogin) return;
  document.getElementById('pfKullaniciAdi').value = aktifKullaniciLogin || '';
  document.getElementById('pfAdSoyad').value = aktifKullanici || '';
  document.getElementById('pfMevcutSifre').value = '';
  document.getElementById('pfYeniSifre').value = '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('profilModal')).show();
}

async function profilKaydet(event) {
  event.preventDefault();
  const body = {
    kullaniciAdi: aktifKullaniciLogin,
    adSoyad: document.getElementById('pfAdSoyad').value.trim(),
    mevcutSifre: document.getElementById('pfMevcutSifre').value,
    yeniSifre: document.getElementById('pfYeniSifre').value,
  };
  try {
    const res = await fetch('/api/kullanici/profil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Profil güncellenemedi.');
      return;
    }
    aktifKullanici = data?.kullanici?.AdSoyad || body.adSoyad || aktifKullanici;
    document.getElementById('aktifKullaniciIsmi').innerText = aktifKullanici;
    modalKapat(document.getElementById('profilModal'));
    alert(data.message || 'Profil güncellendi.');
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

function cikisYap() {
  window.location.reload();
}

async function surumModalAc() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val == null ? '-' : String(val);
  };
  set('surumAppName', 'Yükleniyor…');
  set('surumVersion', 'Yükleniyor…');
  set('surumDesc', 'Yükleniyor…');
  set('surumNode', 'Yükleniyor…');
  set('surumBackupPath', 'Yükleniyor…');
  set('surumGeneratedAt', 'Yükleniyor…');
  set('surumGuncellemeDurum', 'Henüz kontrol edilmedi.');
  const demoWrap = document.getElementById('surumDemoWrap');
  const demoMesaj = document.getElementById('surumDemoMesaj');
  if (demoWrap) demoWrap.classList.add('d-none');
  try {
    const demoRes = await fetch('/api/demo-durum');
    if (demoRes.ok) {
      const demo = await demoRes.json().catch(() => ({}));
      if (demo.demo && demoWrap && demoMesaj) {
        demoMesaj.textContent = demo.mesaj || 'Demo sürüm aktif.';
        demoWrap.classList.remove('d-none');
        if (demo.okumaModu) {
          demoWrap.classList.remove('alert-warning');
          demoWrap.classList.add('alert-danger');
        } else {
          demoWrap.classList.remove('alert-danger');
          demoWrap.classList.add('alert-warning');
        }
      }
    }
  } catch (_) {}
  try {
    const res = await fetch('/api/surum');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'Sürüm alınamadı.');
    set('surumAppName', data.appName || '-');
    set('surumVersion', data.version || '-');
    set('surumDesc', data.description || '-');
    set('surumNode', data.node || '-');
    set('surumBackupPath', data.backupPath || '-');
    set('surumGeneratedAt', data.generatedAt ? new Date(data.generatedAt).toLocaleString('tr-TR') : '-');
  } catch (e) {
    console.error(e);
    set('surumAppName', 'Hata');
    set('surumVersion', '-');
    set('surumDesc', 'Sürüm bilgisi alınamadı.');
    set('surumNode', '-');
    set('surumBackupPath', '-');
    set('surumGeneratedAt', '-');
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('surumModal')).show();
  desktopGuncellemeKontrolBaslat();
}

let _guncellemePollTimer = null;
let _guncellemeSonra = false;

function guncellemeSonraHatirlat() {
  _guncellemeSonra = true;
  sessionStorage.setItem('guncellemeSonra', '1');
  const box = document.getElementById('guncellemeBildirim');
  if (box) box.classList.add('d-none');
}

function surumGuncellemeIlerlemeGuncelle(d) {
  const durumEl = document.getElementById('surumGuncellemeDurum');
  const progWrap = document.getElementById('surumGuncellemeProgressWrap');
  const progBar = document.getElementById('surumGuncellemeProgress');
  const detayEl = document.getElementById('surumGuncellemeDetay');
  const yeni = d.remoteVersion || d.version || '?';
  const mevcut = d.currentVersion || '?';
  const pct = Math.max(0, Math.min(100, Number(d.percent || 0)));

  if (d.status === 'downloading') {
    if (durumEl) {
      durumEl.innerHTML = `<span class="text-primary fw-semibold">v${gunlukMetinEsc(yeni)} indiriliyor…</span> <span class="text-muted">(mevcut v${gunlukMetinEsc(mevcut)})</span>`;
    }
    if (progWrap) progWrap.style.display = '';
    if (progBar) {
      progBar.style.width = `${pct}%`;
      progBar.classList.add('progress-bar-animated', 'progress-bar-striped');
    }
    if (detayEl) {
      const tr = formatBytes(d.transferred);
      const tot = d.total > 0 ? formatBytes(d.total) : 'hesaplanıyor';
      detayEl.textContent = `${tr} / ${tot} — %${pct}`;
    }
  } else if (d.status === 'installing') {
    if (durumEl) durumEl.innerHTML = '<span class="text-warning fw-semibold">Kuruluyor, program yeniden başlıyor…</span>';
    if (progWrap) progWrap.style.display = '';
    if (progBar) {
      progBar.style.width = '100%';
      progBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
    }
    if (detayEl) detayEl.textContent = 'Lütfen pencereyi kapatmayın.';
  } else if (d.status === 'ready') {
    if (durumEl) {
      durumEl.innerHTML = `<span class="text-success fw-semibold">v${gunlukMetinEsc(yeni)} hazır!</span> <span class="text-muted">(mevcut v${gunlukMetinEsc(mevcut)})</span><br><button type="button" class="btn btn-sm btn-success mt-2" onclick="guncellemeSimdiKur()">Güncelle ve yeniden başlat</button>`;
    }
    if (progWrap) progWrap.style.display = 'none';
    if (detayEl) detayEl.textContent = 'İndirme tamamlandı.';
  } else if (d.status === 'idle' && yeni !== '?') {
    if (durumEl) {
      durumEl.innerHTML = `<span class="text-success fw-semibold">Yeni sürüm: v${gunlukMetinEsc(yeni)}</span> <span class="text-muted">· Mevcut: v${gunlukMetinEsc(mevcut)}</span>`;
    }
    if (progWrap) progWrap.style.display = 'none';
    if (detayEl) detayEl.textContent = 'İndirme başlatılıyor…';
  } else if (d.status === 'error') {
    if (durumEl) {
      durumEl.innerHTML = `<span class="text-danger">Güncelleme hatası: ${gunlukMetinEsc(d.message || 'bilinmiyor')}</span>`;
    }
    if (progWrap) progWrap.style.display = 'none';
    if (detayEl) detayEl.textContent = '';
  }
}

function guncellemePollBaslat() {
  if (!_guncellemePollTimer) {
    _guncellemePollTimer = setInterval(guncellemeIndirDurumPoll, 800);
  }
}

function guncellemeBildirimGuncelle(d) {
  const box = document.getElementById('guncellemeBildirim');
  const metin = document.getElementById('guncellemeBildirimMetin');
  const yuzdeEl = document.getElementById('guncellemeBildirimYuzde');
  const detayEl = document.getElementById('guncellemeBildirimDetay');
  const progWrap = document.getElementById('guncellemeBildirimProgressWrap');
  const progBar = document.getElementById('guncellemeBildirimProgress');
  const simdiBtn = document.getElementById('guncellemeSimdiBtn');
  if (!box || !metin) return;

  const yeni = d.remoteVersion || d.version || '?';
  const mevcut = d.currentVersion || '?';
  const pct = Math.max(0, Math.min(100, Number(d.percent || 0)));

  surumGuncellemeIlerlemeGuncelle(d);

  if (d.status === 'downloading') guncellemePollBaslat();

  const sonraGizle = _guncellemeSonra || sessionStorage.getItem('guncellemeSonra') === '1';
  if (sonraGizle && d.status !== 'ready') return;

  if (d.status === 'downloading') {
    metin.textContent = `v${yeni} arka planda indiriliyor… (sizde v${mevcut})`;
    if (yuzdeEl) yuzdeEl.textContent = `%${pct}`;
    if (detayEl) {
      const tr = formatBytes(d.transferred);
      const tot = d.total > 0 ? formatBytes(d.total) : 'hesaplanıyor';
      detayEl.textContent = `${tr} / ${tot}`;
    }
    if (progWrap) progWrap.style.display = '';
    if (progBar) {
      progBar.style.width = `${pct}%`;
      progBar.classList.add('progress-bar-animated', 'progress-bar-striped');
    }
    if (simdiBtn) simdiBtn.classList.add('d-none');
    box.className = 'alert alert-info shadow-sm mx-3 mt-2 mb-0';
  } else if (d.status === 'installing') {
    metin.textContent = 'Kuruluyor, program yeniden başlıyor…';
    if (yuzdeEl) yuzdeEl.textContent = '';
    if (detayEl) detayEl.textContent = 'Lütfen pencereyi kapatmayın.';
    if (progWrap) progWrap.style.display = '';
    if (progBar) {
      progBar.style.width = '100%';
      progBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
    }
    if (simdiBtn) simdiBtn.classList.add('d-none');
    box.className = 'alert alert-warning shadow-sm mx-3 mt-2 mb-0';
  } else if (d.status === 'ready') {
    metin.textContent = `v${yeni} hazır! Yeniden başlatarak kurun. (şu an v${mevcut})`;
    if (yuzdeEl) yuzdeEl.textContent = '';
    if (detayEl) detayEl.textContent = 'İndirme tamamlandı.';
    if (progWrap) progWrap.style.display = 'none';
    if (simdiBtn) simdiBtn.classList.remove('d-none');
    box.className = 'alert alert-success shadow-sm mx-3 mt-2 mb-0';
  } else if (d.status === 'error') {
    metin.textContent = `Güncelleme hatası: ${d.message || 'bilinmiyor'}`;
    if (yuzdeEl) yuzdeEl.textContent = '';
    if (detayEl) detayEl.textContent = '';
    if (progWrap) progWrap.style.display = 'none';
    if (simdiBtn) simdiBtn.classList.add('d-none');
    box.className = 'alert alert-danger shadow-sm mx-3 mt-2 mb-0';
  } else {
    metin.textContent = `Yeni sürüm: v${yeni} (sizde v${mevcut})`;
    if (yuzdeEl) yuzdeEl.textContent = '';
    if (detayEl) detayEl.textContent = 'İndirme başlatılıyor…';
    if (progWrap) progWrap.style.display = 'none';
    if (simdiBtn) simdiBtn.classList.add('d-none');
    box.className = 'alert alert-info shadow-sm mx-3 mt-2 mb-0';
  }
  box.classList.remove('d-none');
}

async function guncellemeIndirDurumPoll() {
  try {
    const res = await fetch('/api/guncelleme-indir-durum');
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) return;
    guncellemeBildirimGuncelle(d);
    if (d.status === 'downloading') return;
    if (_guncellemePollTimer) {
      clearInterval(_guncellemePollTimer);
      _guncellemePollTimer = null;
    }
  } catch (_) {}
}

async function guncellemeArkaPlanIndir() {
  try {
    const dur = await fetch('/api/guncelleme-indir-durum').then((r) => r.json()).catch(() => ({}));
    if (dur.status === 'ready') {
      guncellemeBildirimGuncelle(dur);
      return;
    }
    if (dur.status !== 'downloading') {
      await fetch('/api/guncelleme-indir', { method: 'POST' });
    }
    guncellemePollBaslat();
    guncellemeIndirDurumPoll();
  } catch (_) {}
}

async function guncellemeDurumSayfaAcilis() {
  try {
    const dur = await fetch('/api/guncelleme-indir-durum').then((r) => r.json()).catch(() => ({}));
    if (!dur.success) return;
    if (dur.status === 'downloading' || dur.status === 'ready') {
      if (dur.status === 'downloading') guncellemePollBaslat();
      guncellemeBildirimGuncelle(dur);
    }
  } catch (_) {}
}

async function guncellemeOtomatikKontrol() {
  try {
    await guncellemeDurumSayfaAcilis();

    const res = await fetch('/api/guncelleme-kontrol');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success || !data.configured) return;

    const durRes = await fetch('/api/guncelleme-indir-durum');
    const dur = await durRes.json().catch(() => ({}));

    if (dur.status === 'ready') {
      guncellemeBildirimGuncelle({ ...dur, currentVersion: data.currentVersion, remoteVersion: dur.remoteVersion || data.remoteVersion });
      return;
    }

    if (dur.status === 'downloading') {
      guncellemeBildirimGuncelle({
        ...dur,
        currentVersion: data.currentVersion,
        remoteVersion: dur.remoteVersion || data.remoteVersion,
      });
      guncellemePollBaslat();
      return;
    }

    if (data.updateAvailable) {
      guncellemeBildirimGuncelle({
        status: 'idle',
        remoteVersion: data.remoteVersion,
        currentVersion: data.currentVersion,
        percent: dur.percent || 0,
        transferred: dur.transferred || 0,
        total: dur.total || 0,
      });
      guncellemeArkaPlanIndir();
    }
  } catch (_) {}
}

function guncellemeBekle(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function guncellemeHazirBekle(maxSn = 180) {
  for (let i = 0; i < maxSn; i += 1) {
    const res = await fetch('/api/guncelleme-indir-durum');
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.success) throw new Error(d.message || 'Durum alınamadı');
    guncellemeBildirimGuncelle(d);
    if (d.status === 'ready') return d;
    if (d.status === 'error') throw new Error(d.message || 'İndirme hatası');
    if (d.status !== 'downloading') {
      await fetch('/api/guncelleme-indir', { method: 'POST' });
    }
    await guncellemeBekle(1000);
  }
  throw new Error('İndirme zaman aşımı');
}

async function guncellemeSimdiKur() {
  if (!confirm('Program güncellenecek, indirilecek ve yeniden başlatılacak. Devam edilsin mi?')) return;
  const simdiBtn = document.getElementById('guncellemeSimdiBtn');
  if (simdiBtn) {
    simdiBtn.disabled = true;
    simdiBtn.textContent = 'Güncelleniyor…';
  }
  try {
    guncellemeBildirimGuncelle({ status: 'downloading', remoteVersion: '?', currentVersion: '?', percent: 0, transferred: 0, total: 0 });
    let dur = await fetch('/api/guncelleme-indir-durum').then((r) => r.json()).catch(() => ({}));
    if (dur.status !== 'ready') {
      await fetch('/api/guncelleme-indir', { method: 'POST' });
      await guncellemeHazirBekle(180);
    }
    guncellemeBildirimGuncelle({ status: 'installing', remoteVersion: dur.remoteVersion, currentVersion: dur.currentVersion, percent: 100 });
    const res = await fetch('/api/guncelleme-kur', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Kurulum başarısız.');
      if (simdiBtn) { simdiBtn.disabled = false; simdiBtn.textContent = 'Şimdi yeniden başlat'; }
      return;
    }
  } catch (e) {
    alert(e.message || 'Güncelleme tamamlanamadı.');
    if (simdiBtn) { simdiBtn.disabled = false; simdiBtn.textContent = 'Şimdi yeniden başlat'; }
  }
}

async function guncellemeKontrolEt() {
  const el = document.getElementById('surumGuncellemeDurum');
  if (el) el.innerHTML = '<span class="text-muted">Kontrol ediliyor…</span>';
  try {
    const res = await fetch('/api/guncelleme-kontrol');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      if (el) el.innerHTML = `<span class="text-danger">${gunlukMetinEsc(data.message || 'Güncelleme kontrolü başarısız.')}</span>`;
      return;
    }
    if (!data.configured) {
      if (el) el.innerHTML = '<span class="text-muted">Uzaktan güncelleme henüz yapılandırılmamış.</span>';
      return;
    }
    if (data.updateAvailable) {
      guncellemeBildirimGuncelle({
        status: data.downloadStatus || 'idle',
        remoteVersion: data.remoteVersion,
        currentVersion: data.currentVersion,
        percent: data.downloadPercent || 0,
        transferred: data.transferred || 0,
        total: data.total || 0,
      });
      if (data.downloadStatus === 'downloading') guncellemePollBaslat();
      else if (data.downloadStatus !== 'ready') guncellemeArkaPlanIndir();
    } else {
      if (el) el.innerHTML = `<span class="text-success">Uygulama güncel (${gunlukMetinEsc(data.currentVersion || '-')}).</span>`;
    }
  } catch (e) {
    console.error(e);
    if (el) el.innerHTML = '<span class="text-danger">Sunucu hatası.</span>';
  }
}

let _desktopUpdateInterval = null;

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function desktopGuncellemeKontrolBaslat() {
  try {
    const res = await fetch('/api/desktop-update-status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;
    const area = document.getElementById('desktopUpdateArea');
    if (area) area.style.display = '';
    desktopGuncellemeDurumGuncelle(data);
    if (data.status === 'downloading' || data.status === 'checking') {
      if (!_desktopUpdateInterval) {
        _desktopUpdateInterval = setInterval(desktopGuncellemePollEt, 1500);
      }
    }
  } catch (_) {}
}

async function desktopGuncellemePollEt() {
  try {
    const res = await fetch('/api/desktop-update-status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success) return;
    desktopGuncellemeDurumGuncelle(data);
    if (data.status !== 'downloading' && data.status !== 'checking') {
      clearInterval(_desktopUpdateInterval);
      _desktopUpdateInterval = null;
    }
  } catch (_) {}
}

function desktopGuncellemeDurumGuncelle(data) {
  const statusEl = document.getElementById('desktopUpdateStatus');
  const progressWrap = document.getElementById('desktopUpdateProgressWrap');
  const progressBar = document.getElementById('desktopUpdateProgress');
  const detailsEl = document.getElementById('desktopUpdateDetails');
  const installBtn = document.getElementById('desktopUpdateInstallBtn');
  if (!statusEl) return;

  switch (data.status) {
    case 'idle':
      statusEl.innerHTML = '<span class="text-muted">Bekleniyor...</span>';
      if (progressWrap) progressWrap.style.display = 'none';
      if (detailsEl) detailsEl.textContent = '';
      if (installBtn) installBtn.style.display = 'none';
      break;
    case 'checking':
      statusEl.innerHTML = '<span class="text-info"><i class="fa-solid fa-spinner fa-spin me-1"></i>Güncelleme kontrol ediliyor...</span>';
      if (progressWrap) progressWrap.style.display = 'none';
      if (detailsEl) detailsEl.textContent = '';
      if (installBtn) installBtn.style.display = 'none';
      break;
    case 'downloading':
      const pct = Number(data.percent || 0).toFixed(1);
      statusEl.innerHTML = `<span class="text-primary"><i class="fa-solid fa-download me-1"></i>v${data.version || '?'} indiriliyor... %${pct}</span>`;
      if (progressWrap) progressWrap.style.display = '';
      if (progressBar) progressBar.style.width = pct + '%';
      if (detailsEl) {
        const transferred = formatBytes(data.transferred);
        const total = formatBytes(data.total);
        const speed = formatBytes(data.bytesPerSecond) + '/s';
        detailsEl.textContent = `${transferred} / ${total} — ${speed}`;
      }
      if (installBtn) installBtn.style.display = 'none';
      break;
    case 'ready':
      statusEl.innerHTML = `<span class="text-success fw-semibold"><i class="fa-solid fa-circle-check me-1"></i>v${data.version || '?'} indirildi, yeniden başlatmaya hazır!</span>`;
      if (progressWrap) progressWrap.style.display = 'none';
      if (detailsEl) detailsEl.textContent = '';
      if (installBtn) installBtn.style.display = '';
      break;
    case 'up-to-date':
      statusEl.innerHTML = '<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i>Uygulama güncel.</span>';
      if (progressWrap) progressWrap.style.display = 'none';
      if (detailsEl) detailsEl.textContent = '';
      if (installBtn) installBtn.style.display = 'none';
      break;
    case 'error':
      statusEl.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark me-1"></i>Hata: ${data.error || 'Bilinmeyen'}</span>`;
      if (progressWrap) progressWrap.style.display = 'none';
      if (detailsEl) detailsEl.textContent = '';
      if (installBtn) installBtn.style.display = 'none';
      break;
    case 'exe':
      statusEl.innerHTML = '<span class="text-muted">EXE sürümü — güncelleme: yeni exe dosyasını kurun.</span>';
      if (progressWrap) progressWrap.style.display = 'none';
      if (detailsEl) detailsEl.textContent = '';
      if (installBtn) installBtn.style.display = 'none';
      break;
  }
}

async function desktopGuncellemKur() {
  if (!confirm('Uygulama yeniden başlatılacak. Devam edilsin mi?')) return;
  try {
    await fetch('/api/desktop-update-install', { method: 'POST' });
  } catch (_) {}
}

async function guncellemeUygula() {
  const el = document.getElementById('surumGuncellemeDurum');
  if (!confirm('Yeni sürüm indirilsin ve uygulansın mı? Uygulama yeniden başlatılacaktır.')) return;
  if (el) el.innerHTML += '<br><span class="text-muted">İndiriliyor ve hazırlanıyor…</span>';
  try {
    const res = await fetch('/api/guncelleme-uygula', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Güncelleme uygulanamadı.');
      return;
    }
    alert(data.message || 'Güncelleme başlatıldı.');
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function loglariGetir() {
  try {
    const response = await fetch('/api/loglar');
    const loglar = await response.json();
    const tabloGovdesi = document.getElementById('logTabloGovdesi');
    tabloGovdesi.innerHTML = '';

    loglar.forEach((log) => {
      const tarih = tarihTrGoster(log.Tarih);
      const mobilIkon = String(log.Aciklama || '').startsWith('[Mobil]')
        ? ' <i class="fa-solid fa-mobile-screen-button text-info" title="Mobil"></i>'
        : '';

      tabloGovdesi.innerHTML += `
        <tr>
          <td class="text-muted small">${tarih}</td>
          <td><span class="badge bg-info text-dark">${log.KullaniciAdi}</span></td>
          <td><span class="fw-bold">${log.IslemTipi}</span>${mobilIkon}</td>
          <td class="text-secondary">${log.Aciklama}</td>
        </tr>`;
    });
  } catch (hata) {
    console.error('Loglar çekilemedi:', hata);
  }
}

async function stokSil(id) {
  if (!confirm('Seçili ürünü silmek istediğinize emin misiniz?')) return;

  try {
    const q = encodeURIComponent(aktifKullanici || '');
    const response = await fetch(`/api/stok/${id}?kullanici=${q}`, { method: 'DELETE' });

    if (response.ok) {
      await stoklariGetir();
      await ozetBilgileriniGetir();
    } else {
      const mesaj = await response.text();
      alert('İşlem başarısız: ' + mesaj);
    }
  } catch (hata) {
    console.error('Silme işlemi sırasında hata oluştu:', hata);
  }
}

function servisFisiYazdir(servisID) {
  fetch(`/api/servis/detay/${servisID}`)
    .then((res) => res.json())
    .then((data) => {
      if (!data || !data.ServisID) {
        alert('Servis detayı alınamadı.');
        return;
      }
      const yazdirPenceresi = window.open('', '_blank');
      yazdirPenceresi.document.write(`
        <html>
        <head>
          <title>Servis Fişi - SRV-${data.ServisID}</title>
          <style>
            body { font-family: sans-serif; padding: 30px; }
            .baslik { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .detay { margin-top: 20px; }
            .tablo { width: 100%; border-collapse: collapse; margin-top: 20px; }
            .tablo td { padding: 10px; border: 1px solid #ddd; }
            .toplam { text-align: right; margin-top: 20px; font-weight: bold; font-size: 1.2em; }
            @media print { .no-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="baslik">
            <h2>ELEKTRİKÇİ OTOMASYONU</h2>
            <p>Servis & Arıza Teslim Fişi</p>
          </div>
          <div class="detay">
            <p><strong>Fiş No:</strong> SRV-${data.ServisID}</p>
            <p><strong>Müşteri:</strong> ${data.AdSoyad || '-'}</p>
            <p><strong>Tarih:</strong> ${new Date().toLocaleString('tr-TR')}</p>
          </div>
          <table class="tablo">
            <tr><td><strong>Yapılan İş / Arıza</strong></td><td>${data.ArizaAciklamasi || ''}</td></tr>
            <tr><td><strong>İşçilik Ücreti</strong></td><td>${Number(data.IscilikUcreti || 0).toFixed(2)} ₺</td></tr>
            <tr><td><strong>Malzeme Tutarı</strong></td><td>${Number(data.MalzemeTutari || 0).toFixed(2)} ₺</td></tr>
          </table>
          <div class="toplam text-end">TOPLAM TUTAR: ${Number(data.ToplamTutar || 0).toFixed(2)} ₺</div>
          <br><br>
          <p style="text-align:center;">İmzayı atan personel: ${aktifKullanici}</p>
          <button class="no-print" onclick="window.print()">Yazdır</button>
        </body>
        </html>`);
      yazdirPenceresi.document.close();
    })
    .catch(() => alert('Servis detayı yüklenemedi.'));
}

/** Satır: { satirId, stokID, urunAdi, birim, birimFiyat, miktar, mevcutStok } */
let hizliSatisSepet = [];
let hizliSatisSatirSayac = 0;

function hizliSatisSepetToplamHesapla() {
  let t = 0;
  hizliSatisSepet.forEach((s) => {
    t += s.miktar * s.birimFiyat;
  });
  return Math.round(t * 100) / 100;
}

function hizliSatisSepettekiAdet(stokID) {
  const satir = hizliSatisSepet.find((x) => x.stokID === stokID);
  return satir ? satir.miktar : 0;
}

function sepetiYenidenCiz() {
  const tbody = document.getElementById('hizliSatisSepetGovdesi');
  const bos = document.getElementById('hizliSatisSepetBos');
  const toplamEl = document.getElementById('hizliSatisSepetToplam');
  if (!tbody || !toplamEl) return;

  tbody.querySelectorAll('tr[data-sepet-satir]').forEach((r) => r.remove());

  if (hizliSatisSepet.length === 0) {
    if (bos) bos.classList.remove('d-none');
    toplamEl.textContent = '0.00 ₺';
    return;
  }
  if (bos) bos.classList.add('d-none');

  hizliSatisSepet.forEach((s) => {
    const tr = document.createElement('tr');
    tr.setAttribute('data-sepet-satir', String(s.satirId));
    const tutar = (s.miktar * s.birimFiyat).toFixed(2);
    tr.innerHTML = `
      <td>
        <div class="fw-semibold text-dark">${s.urunAdi}</div>
        <small class="text-muted d-xl-none d-md-none">${s.birim} · stok ${s.mevcutStok}</small>
        <div class="d-md-none mt-1">
          <label class="small text-muted me-1">Birim fiyat</label>
          <input type="number" step="0.01" min="0" class="form-control form-control-sm d-inline-block"
                 style="max-width: 96px;" value="${s.birimFiyat.toFixed(2)}"
                 data-sepet-fiyat="${s.satirId}">
        </div>
        <small class="text-muted d-none d-xl-inline">Rafta: ${s.mevcutStok} ${s.birim}</small>
      </td>
      <td class="text-center text-muted d-none d-xl-table-cell">${s.birim}</td>
      <td class="text-end d-none d-md-table-cell">
        <input type="number" step="0.01" min="0" class="form-control form-control-sm text-end ms-auto"
               style="max-width: 96px;" value="${s.birimFiyat.toFixed(2)}"
               data-sepet-fiyat="${s.satirId}" title="Birim fiyat">
      </td>
      <td class="text-center">
        <input type="number" min="1" class="form-control form-control-sm text-center mx-auto"
               style="max-width: 88px;" value="${s.miktar}"
               data-sepet-input="${s.satirId}">
      </td>
      <td class="text-end fw-bold text-success text-nowrap">${tutar} ₺</td>
      <td class="text-end p-1">
        <button type="button" class="btn btn-sm btn-outline-danger" title="Satırı sil" data-sepet-sil="${s.satirId}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('input[data-sepet-input]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const id = parseInt(inp.getAttribute('data-sepet-input'), 10);
      let v = parseInt(inp.value, 10);
      if (!Number.isInteger(v) || v < 1) v = 1;
      hizliSatisSepetSatirMiktarGuncelle(id, v);
    });
  });
  tbody.querySelectorAll('input[data-sepet-fiyat]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const id = parseInt(inp.getAttribute('data-sepet-fiyat'), 10);
      hizliSatisSepetSatirFiyatGuncelle(id, inp.value);
    });
  });
  tbody.querySelectorAll('button[data-sepet-sil]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-sepet-sil'), 10);
      hizliSatisSepetSatirSil(id);
    });
  });

  toplamEl.textContent = hizliSatisSepetToplamHesapla().toFixed(2) + ' ₺';
}

function hizliSatisSepetSatirSil(satirId) {
  hizliSatisSepet = hizliSatisSepet.filter((x) => x.satirId !== satirId);
  sepetiYenidenCiz();
}

function hizliSatisSepetSatirFiyatGuncelle(satirId, yeniFiyat) {
  const satir = hizliSatisSepet.find((x) => x.satirId === satirId);
  if (!satir) return;
  let f = parseFloat(yeniFiyat);
  if (!Number.isFinite(f) || f < 0) f = 0;
  satir.birimFiyat = Math.round(f * 100) / 100;
  sepetiYenidenCiz();
}

function hizliSatisSepetSatirMiktarGuncelle(satirId, yeniMiktar) {
  const satir = hizliSatisSepet.find((x) => x.satirId === satirId);
  if (!satir) return;
  let m = parseInt(yeniMiktar, 10);
  if (!Number.isInteger(m) || m < 1) m = 1;
  satir.miktar = m;
  sepetiYenidenCiz();
}

function hizliSatisSepetiTemizle() {
  if (hizliSatisSepet.length === 0) return;
  if (!confirm('Sepetteki tüm satırları silmek istiyor musunuz?')) return;
  hizliSatisSepet = [];
  sepetiYenidenCiz();
}

function sepeteUrunEkle(urun) {
  const miktarRaw = document.getElementById('hizliSatisMiktar').value;
  let miktarEkle = parseInt(miktarRaw, 10);
  if (!Number.isInteger(miktarEkle) || miktarEkle < 1) miktarEkle = 1;

  const mevcutStok = parseInt(urun.MevcutMiktar, 10) || 0;
  const birimFiyat = Number(urun.SatisFiyati);
  const mevcut = hizliSatisSepet.find((x) => x.stokID === urun.StokID);
  if (mevcut) {
    mevcut.miktar += miktarEkle;
    mevcut.mevcutStok = mevcutStok;
    mevcut.birimFiyat = birimFiyat;
  } else {
    hizliSatisSatirSayac += 1;
    hizliSatisSepet.push({
      satirId: hizliSatisSatirSayac,
      stokID: urun.StokID,
      urunAdi: urun.UrunAdi,
      birim: urun.Birim || 'Adet',
      birimFiyat,
      miktar: miktarEkle,
      mevcutStok,
    });
  }

  aramaSonuclariniGizle();
  document.getElementById('hizliSatisArama').value = '';
  sepetiYenidenCiz();
}

function hizliSatisAramaFocus() {
  const v = document.getElementById('hizliSatisArama').value;
  if (!v || v.length < 1) return;
  if (hizliSatisRakamAramasiMi(v)) {
    aramaSonuclariniGizle();
    return;
  }
  hizliSatisAra(v);
}

function hizliSatisStokFiltrele(tumStoklar, kelime) {
  const raw = String(kelime || '').trim();
  if (!raw) return [];
  return tumStoklar.filter((s) => stokMetinAramaEslesir(s, raw)).slice(0, 20);
}

/** Sadece rakam — açılır liste hiç açılmasın (barkod okuyucu dahil) */
function hizliSatisRakamAramasiMi(kelime) {
  const t = String(kelime || '').trim();
  return t.length >= 1 && /^\d+$/.test(t);
}

/** Barkod Enter: en az 3 hane — sepete / stok modalı */
function hizliSatisBarkodGirisiMi(kelime) {
  const t = String(kelime || '').trim();
  return t.length >= 3 && /^\d+$/.test(t);
}

let _hizliSatisAraSeq = 0;

function hizliSatisAraGuncelMi(kelime) {
  const input = document.getElementById('hizliSatisArama');
  return input && String(input.value).trim() === String(kelime || '').trim();
}

function hizliSatisAramaKeyup(ev) {
  if (ev.key === 'Enter') return;
  const v = ev.target.value;
  if (hizliSatisRakamAramasiMi(v)) {
    aramaSonuclariniGizle();
    return;
  }
  hizliSatisAra(v);
}

/** Barkod tam eşleşirse sepete (sadece Enter ile; keyup Enter tekrar tetiklemesin diye burada kullanılır). */
function hizliSatisBarkodTamEslesmeSepete(kelime, filtreli) {
  const trimmed = String(kelime || '').trim();
  if (!trimmed || !filtreli || !filtreli.length) return false;
  const exact = filtreli.find((s) => String(s.Barkod || '').trim() === trimmed);
  if (!exact) return false;
  sepeteUrunEkle(exact);
  return true;
}

async function hizliSatisAramaKeydown(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  aramaSonuclariniGizle();
  const input = document.getElementById('hizliSatisArama');
  const kelime = (input && input.value) ? input.value : '';
  const trimmed = String(kelime).trim();
  if (!trimmed) return;
  try {
    const response = await fetch('/api/stok');
    const tumStoklar = await response.json();
    const filtreli = hizliSatisStokFiltrele(tumStoklar, kelime);
    if (hizliSatisBarkodTamEslesmeSepete(kelime, filtreli)) return;
    if (filtreli.length === 1) {
      sepeteUrunEkle(filtreli[0]);
      return;
    }
    if (hizliSatisBarkodGirisiMi(trimmed)) {
      stokEkleModalAc(trimmed);
      if (input) input.value = '';
      return;
    }
    if (filtreli.length === 0) {
      alert('Ürün bulunamadı. İsim veya barkod kontrol edin.');
    }
  } catch (e) {
    console.error(e);
  }
}

async function hizliSatisAra(kelime) {
  const sonuclarDiv = document.getElementById('aramaSonuclari');

  if (kelime.length < 1) {
    aramaSonuclariniGizle();
    return;
  }

  if (hizliSatisRakamAramasiMi(kelime)) {
    aramaSonuclariniGizle();
    return;
  }

  const seq = ++_hizliSatisAraSeq;

  try {
    const response = await fetch('/api/stok');
    const tumStoklar = await response.json();

    if (seq !== _hizliSatisAraSeq || !hizliSatisAraGuncelMi(kelime) || hizliSatisRakamAramasiMi(kelime)) {
      aramaSonuclariniGizle();
      return;
    }

    const filtreli = hizliSatisStokFiltrele(tumStoklar, kelime);

    sonuclarDiv.innerHTML = '';
    filtreli.forEach((urun) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className =
        'list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3 px-3 border-0 border-bottom';
      item.style.fontSize = '0.95rem';
      const fiyat = Number(urun.SatisFiyati).toFixed(2);
      item.innerHTML = `
        <div class="text-start pe-2">
          <span class="fw-semibold text-dark d-block">${urun.UrunAdi}</span>
          <small class="text-muted">Stok: ${urun.MevcutMiktar} ${urun.Birim || 'Adet'}</small>
        </div>
        <span class="badge rounded-pill bg-primary">${fiyat} ₺</span>`;
      item.onclick = (e) => {
        e.preventDefault();
        sepeteUrunEkle(urun);
      };
      sonuclarDiv.appendChild(item);
    });

    if (filtreli.length > 0) {
      sonuclarDiv.classList.add('acik');
      sonuclarDiv.style.display = 'block';
      sonuclarDiv.style.pointerEvents = 'auto';
    } else {
      aramaSonuclariniGizle();
    }
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('hizliSatisAramaWrap');
  const sonuclarDiv = document.getElementById('aramaSonuclari');
  if (wrap && sonuclarDiv && !wrap.contains(e.target)) aramaSonuclariniGizle();

  const mdWrap = document.getElementById('mdSatisAramaWrap');
  if (mdWrap && !mdWrap.contains(e.target)) musteriSatisAramaSonuclariniGizle();

  const mWrap = document.getElementById('hizliSatisMusteriAramaAlani');
  if (mWrap && !mWrap.contains(e.target)) hizliSatisMusteriSonuclariniGizle();
});

let _hizliSatisMusteriMod = null;

function hizliSatisMusteriTemizle() {
  const hid = document.getElementById('hizliSatisMusteriID');
  const ara = document.getElementById('hizliSatisMusteriAra');
  const ozet = document.getElementById('hizliSatisMusteriSeciliOzet');
  const sonuc = document.getElementById('hizliSatisMusteriSonuclari');
  if (hid) hid.value = '';
  if (ara) ara.value = '';
  if (ozet) {
    ozet.textContent = '';
    ozet.classList.add('d-none');
  }
  if (sonuc) {
    sonuc.innerHTML = '';
    sonuc.classList.add('d-none');
  }
}

function hizliSatisMusteriSonuclariniGizle() {
  const sonuc = document.getElementById('hizliSatisMusteriSonuclari');
  if (sonuc) sonuc.classList.add('d-none');
}

function hizliSatisMusteriFiltrele(q) {
  const liste = Array.isArray(window._musteriListeCache) ? window._musteriListeCache : [];
  const aranan = String(q || '').trim().toLocaleLowerCase('tr-TR');
  if (!aranan) return liste.slice(0, 40);
  return liste.filter((m) => {
    const no = String(m.MusteriID || '');
    const ad = String(m.AdSoyad || '').toLocaleLowerCase('tr-TR');
    const firma = String(m.FirmaAdi || '').toLocaleLowerCase('tr-TR');
    const tel = String(m.Telefon || '').toLocaleLowerCase('tr-TR');
    const tc = String(m.tcno || '').toLocaleLowerCase('tr-TR');
    const vergi = String(m.vergino || '').toLocaleLowerCase('tr-TR');
    const yetkili = String(m.yetkili || '').toLocaleLowerCase('tr-TR');
    const gorunen = musteriGorunenAd(m).toLocaleLowerCase('tr-TR');
    return (
      no.includes(aranan) ||
      ad.includes(aranan) ||
      firma.includes(aranan) ||
      tel.includes(aranan) ||
      tc.includes(aranan) ||
      vergi.includes(aranan) ||
      yetkili.includes(aranan) ||
      gorunen.includes(aranan)
    );
  }).slice(0, 40);
}

function hizliSatisMusteriSec(m) {
  const hid = document.getElementById('hizliSatisMusteriID');
  const ozet = document.getElementById('hizliSatisMusteriSeciliOzet');
  const ara = document.getElementById('hizliSatisMusteriAra');
  if (!m || !hid) return;
  hid.value = String(m.MusteriID);
  const tur = musteriTuzelMi(m) ? 'Tüzel' : 'Gerçek';
  if (ozet) {
    ozet.textContent = `Seçili: ${musteriGorunenAd(m)} (${tur}, #${m.MusteriID})`;
    ozet.classList.remove('d-none');
  }
  if (ara) ara.value = musteriGorunenAd(m);
  hizliSatisMusteriSonuclariniGizle();
  _hizliSatisMusteriMod = 'sec';
  hizliSatisKesinlestirBtnGuncelle();
}

function hizliSatisMusteriAraGuncelle(deger) {
  const sonuc = document.getElementById('hizliSatisMusteriSonuclari');
  const hid = document.getElementById('hizliSatisMusteriID');
  if (!sonuc) return;
  if (hid) hid.value = '';
  const ozet = document.getElementById('hizliSatisMusteriSeciliOzet');
  if (ozet) ozet.classList.add('d-none');
  hizliSatisKesinlestirBtnGuncelle();

  const filtreli = hizliSatisMusteriFiltrele(deger);
  sonuc.innerHTML = '';
  if (!String(deger || '').trim() || filtreli.length === 0) {
    sonuc.classList.add('d-none');
    return;
  }
  filtreli.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'list-group-item list-group-item-action py-2';
    const ek = m.FirmaAdi ? ` · ${m.FirmaAdi}` : '';
    const tur = musteriTuzelMi(m) ? 'Tüzel' : 'Gerçek';
    btn.innerHTML = `<span class="fw-semibold">${gunlukMetinEsc(musteriGorunenAd(m))}</span><small class="text-muted ms-2">${tur} · #${m.MusteriID}</small>`;
    btn.onclick = () => hizliSatisMusteriSec(m);
    sonuc.appendChild(btn);
  });
  sonuc.classList.remove('d-none');
}

function hizliSatisMusteriAraKeydown(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  const filtreli = hizliSatisMusteriFiltrele(ev.target.value);
  if (filtreli.length === 1) hizliSatisMusteriSec(filtreli[0]);
}

function hizliSatisMusteriModuSifirla() {
  const aramaAlani = document.getElementById('hizliSatisMusteriAramaAlani');
  const secBtn = document.getElementById('hizliSatisMusteriSecBtn');
  const yokBtn = document.getElementById('hizliSatisMusterisizBtn');
  if (aramaAlani) aramaAlani.classList.add('d-none');
  if (secBtn) {
    secBtn.classList.add('btn-outline-primary');
    secBtn.classList.remove('btn-primary');
  }
  if (yokBtn) {
    yokBtn.classList.add('btn-outline-secondary');
    yokBtn.classList.remove('btn-secondary');
  }
}

function hizliSatisKesinlestirBtnGuncelle() {
  const btn = document.getElementById('btnHizliKesinlestir');
  if (!btn) return;
  const odemeEl = document.querySelector('#hizliSatisOnayModal input[name="odemeTipi"]:checked');
  const odemeTipi = odemeEl ? odemeEl.value : 'Nakit';
  if (odemeTipi === 'Veresiye') {
    const hidVal = document.getElementById('hizliSatisMusteriID')?.value;
    const mid = parseInt(hidVal, 10);
    btn.disabled = !(Number.isInteger(mid) && mid > 0);
    return;
  }
  btn.disabled = _hizliSatisMusteriMod !== 'sec' && _hizliSatisMusteriMod !== 'yok';
}

function hizliSatisMusteriModu(mod) {
  _hizliSatisMusteriMod = mod;
  const aramaAlani = document.getElementById('hizliSatisMusteriAramaAlani');
  const secBtn = document.getElementById('hizliSatisMusteriSecBtn');
  const yokBtn = document.getElementById('hizliSatisMusterisizBtn');
  if (mod === 'sec') {
    if (aramaAlani) aramaAlani.classList.remove('d-none');
    if (secBtn) {
      secBtn.classList.add('btn-primary');
      secBtn.classList.remove('btn-outline-primary');
    }
    if (yokBtn) {
      yokBtn.classList.add('btn-outline-secondary');
      yokBtn.classList.remove('btn-secondary');
    }
    setTimeout(() => document.getElementById('hizliSatisMusteriAra')?.focus(), 100);
  } else {
    hizliSatisMusteriTemizle();
    if (aramaAlani) aramaAlani.classList.add('d-none');
    if (secBtn) {
      secBtn.classList.add('btn-outline-primary');
      secBtn.classList.remove('btn-primary');
    }
    if (yokBtn) {
      yokBtn.classList.add('btn-secondary');
      yokBtn.classList.remove('btn-outline-secondary');
    }
  }
  hizliSatisKesinlestirBtnGuncelle();
}

function hizliSatisOdemeGuncelle() {
  const secilen = document.querySelector('input[name="odemeTipi"]:checked');
  const panel = document.getElementById('hizliSatisMusteriPanel');
  const baslik = document.getElementById('hizliSatisMusteriBaslik');
  const aciklama = document.getElementById('hizliSatisMusteriAciklama');
  const modBtns = document.getElementById('hizliSatisMusteriModBtns');
  const yokBtn = document.getElementById('hizliSatisMusterisizBtn');
  if (!secilen || !panel) return;

  panel.classList.remove('d-none');
  hizliSatisMusteriTemizle();
  _hizliSatisMusteriMod = null;
  hizliSatisMusteriModuSifirla();

  if (secilen.value === 'Veresiye') {
    if (baslik) baslik.innerHTML = '<i class="fa-solid fa-user-tag me-2 text-danger"></i> Veresiye — müşteri seçin';
    if (aciklama) aciklama.textContent = 'Ödeyeceği tutar seçilen müşterinin cari bakiyesine yazılır.';
    if (modBtns) modBtns.classList.add('d-none');
    if (yokBtn) yokBtn.classList.add('d-none');
    hizliSatisMusteriModu('sec');
  } else {
    if (baslik) baslik.innerHTML = '<i class="fa-solid fa-user-tag me-2 text-primary"></i> Müşteri';
    if (aciklama) aciklama.textContent = 'Devam etmek için «Müşteri seç» veya «Müşteri seçmeden bitir» seçeneklerinden birini işaretleyin.';
    if (modBtns) modBtns.classList.remove('d-none');
    if (yokBtn) yokBtn.classList.remove('d-none');
  }
  hizliSatisKesinlestirBtnGuncelle();
}

async function hizliSatisMusteriListesiniHazirla() {
  if (Array.isArray(window._musteriListeCache) && window._musteriListeCache.length) return;
  try {
    const r = await fetch('/api/musteri');
    const list = await r.json();
    musteriListeCacheAyarla(list);
  } catch (e) {
    console.error(e);
    musteriListeCacheAyarla([]);
  }
}

function hizliSatisBasariToastGoster() {
  const el = document.getElementById('hizliSatisBasariToast');
  if (!el || typeof bootstrap === 'undefined') return;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 5000 }).show();
}

async function hizliSatisKesinlestirSonrasi(kaydedilenMusteriID) {
  document.getElementById('hizliSatisArama').value = '';
  document.getElementById('hizliSatisMiktar').value = '1';
  hizliSatisSepet = [];
  sepetiYenidenCiz();
  ozetBilgileriniGetir();
  stoklariGetir();
  musterileriGetir();

  if (Number.isInteger(kaydedilenMusteriID) && kaydedilenMusteriID > 0) {
    await musteriDetayModalAc(kaydedilenMusteriID);
  } else {
    hizliSatisBasariToastGoster();
  }
}

function modalSepetOzetGuncelle() {
  const toplamEl = document.getElementById('modalSatisToplam');
  const toplam = hizliSatisSepetToplamHesapla();
  if (toplamEl) toplamEl.textContent = toplam.toFixed(2) + ' ₺';
  const odeyecegi = document.getElementById('hizliSatisOdeyecegiTutar');
  if (odeyecegi && odeyecegi.dataset.manual !== '1') {
    odeyecegi.value = toplam.toFixed(2);
  }
}

function modalSepetSatirTutarGuncelle(satirId) {
  const satir = hizliSatisSepet.find((x) => x.satirId === satirId);
  const tr = document.querySelector(`#modalSepetGovdesi tr[data-modal-satir="${satirId}"]`);
  if (!satir || !tr) return;
  const tutarEl = tr.querySelector('[data-modal-tutar]');
  if (tutarEl) tutarEl.textContent = (satir.miktar * satir.birimFiyat).toFixed(2) + ' ₺';
}

function modalSepetSatirFiyatGuncelle(satirId, yeniFiyat) {
  const satir = hizliSatisSepet.find((x) => x.satirId === satirId);
  if (!satir) return;
  let f = parseFloat(yeniFiyat);
  if (!Number.isFinite(f) || f < 0) f = 0;
  satir.birimFiyat = Math.round(f * 100) / 100;
  modalSepetSatirTutarGuncelle(satirId);
  modalSepetOzetGuncelle();
  sepetiYenidenCiz();
}

function modalSepetTablosunuDoldur() {
  const tbody = document.getElementById('modalSepetGovdesi');
  if (!tbody) return;
  tbody.innerHTML = '';
  hizliSatisSepet.forEach((s) => {
    const tutar = (s.miktar * s.birimFiyat).toFixed(2);
    const tr = document.createElement('tr');
    tr.setAttribute('data-modal-satir', String(s.satirId));
    tr.innerHTML = `
      <td class="py-1">${gunlukMetinEsc(s.urunAdi)}</td>
      <td class="text-center py-1 text-nowrap">${s.miktar} ${gunlukMetinEsc(s.birim || '')}</td>
      <td class="text-end py-1">
        <input type="number" step="0.01" min="0" class="form-control form-control-sm text-end ms-auto"
               value="${s.birimFiyat.toFixed(2)}" data-modal-fiyat="${s.satirId}" title="Birim fiyat">
      </td>
      <td class="text-end py-1 fw-semibold text-nowrap" data-modal-tutar>${tutar} ₺</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input[data-modal-fiyat]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const id = parseInt(inp.getAttribute('data-modal-fiyat'), 10);
      modalSepetSatirFiyatGuncelle(id, inp.value);
    });
  });
  modalSepetOzetGuncelle();
}

function hizliSatisOnayModalAc() {
  if (hizliSatisSepet.length === 0) {
    alert('Sepete ürün ekleyin: arama kutusundan yazıp listeden seçin.');
    return;
  }

  gunlukPerakendeDuzenleSifirla();
  modalSepetTablosunuDoldur();

  const nakit = document.getElementById('odemeNakit');
  if (nakit) nakit.checked = true;
  const panel = document.getElementById('hizliSatisMusteriPanel');
  if (panel) panel.classList.add('d-none');
  hizliSatisMusteriTemizle();
  _hizliSatisMusteriMod = null;
  hizliSatisMusteriModuSifirla();
  const odeyecegi = document.getElementById('hizliSatisOdeyecegiTutar');
  if (odeyecegi) {
    odeyecegi.dataset.manual = '0';
    odeyecegi.value = hizliSatisSepetToplamHesapla().toFixed(2);
  }
  hizliSatisMusteriListesiniHazirla();

  const modalEl = document.getElementById('hizliSatisOnayModal');
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  hizliSatisOdemeGuncelle();
}

async function hizliSatisKesinlestir() {
  if (hizliSatisSepet.length === 0) {
    alert('Sepet boş.');
    return;
  }

  const duzenleMod = Number.isInteger(_gunlukDuzenleLogID) && _gunlukDuzenleLogID > 0;
  const odemeEl = document.querySelector('#hizliSatisOnayModal input[name="odemeTipi"]:checked');
  let odemeTipi = odemeEl ? odemeEl.value : 'Nakit';

  let musteriID = null;
  if (!duzenleMod) {
    const hidVal = document.getElementById('hizliSatisMusteriID')?.value;
    if (hidVal) musteriID = parseInt(hidVal, 10);

    if (odemeTipi === 'Veresiye') {
      if (!Number.isInteger(musteriID) || musteriID < 1) {
        alert('Veresiye satış için listeden bir müşteri seçmelisiniz.');
        return;
      }
    } else if (_hizliSatisMusteriMod !== 'sec' && _hizliSatisMusteriMod !== 'yok') {
      alert('Devam etmek için «Müşteri seç» veya «Müşteri seçmeden bitir» seçeneklerinden birini işaretleyin.');
      return;
    } else if (_hizliSatisMusteriMod === 'sec' && (!Number.isInteger(musteriID) || musteriID < 1)) {
      alert('Müşteri seç modundasınız — listeden bir müşteri seçin.');
      return;
    } else if (_hizliSatisMusteriMod === 'yok') {
      musteriID = null;
    }
  } else {
    if (odemeTipi === 'Veresiye') {
      alert('Perakende düzenlemede veresiye kullanılamaz.');
      return;
    }
    musteriID = null;
  }

  const sepetToplam = hizliSatisSepetToplamHesapla();
  let tahsilatTutar = parseFloat(document.getElementById('hizliSatisOdeyecegiTutar')?.value || '0');
  if (!Number.isFinite(tahsilatTutar) || tahsilatTutar < 0) {
    alert('Ödeyeceği tutar geçerli bir sayı olmalıdır.');
    return;
  }
  tahsilatTutar = Math.round(tahsilatTutar * 100) / 100;
  if (duzenleMod && tahsilatTutar > sepetToplam) {
    alert('Tahsilat tutarı sepet toplamını geçemez.');
    return;
  }
  if (
    !duzenleMod &&
    odemeTipi !== 'Veresiye' &&
    Number.isInteger(musteriID) &&
    musteriID > 0 &&
    tahsilatTutar > sepetToplam
  ) {
    alert('Alınan ödeme sepet toplamını geçemez.');
    return;
  }

  const kalemler = hizliSatisSepet.map((s) => ({
    urunID: s.stokID,
    miktar: s.miktar,
    birimFiyat: s.birimFiyat,
  }));

  const body = {
    kalemler,
    kullanici: aktifKullanici,
    odemeTipi,
    tahsilatTutar,
  };
  if (!duzenleMod && Number.isInteger(musteriID) && musteriID > 0) body.musteriID = musteriID;

  let sifre = null;
  if (duzenleMod) {
    sifre = window.prompt('Değişiklikleri kaydetmek için giriş şifrenizi girin:');
    if (!sifre) return;
    body.kullaniciAdi = aktifKullaniciLogin || aktifKullanici;
    body.sifre = sifre;
  }

  const kaydedilenMusteriID = !duzenleMod && Number.isInteger(musteriID) && musteriID > 0 ? musteriID : null;
  const btn = document.getElementById('btnHizliKesinlestir');
  if (btn) btn.disabled = true;

  const url = duzenleMod ? `/api/gunluk-islem/${_gunlukDuzenleLogID}/duzenle` : '/api/satis-sepet';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch (_) {}

  if (res.ok && payload && payload.success) {
    const duzenleModKayit = duzenleMod;
    gunlukPerakendeDuzenleSifirla();
    const modalEl = document.getElementById('hizliSatisOnayModal');
    const inst = bootstrap.Modal.getInstance(modalEl);
    const sonrasi = async () => {
      if (duzenleModKayit) {
        hizliSatisSepet = [];
        sepetiYenidenCiz();
        await gunlukIslemleriYukle();
        stoklariGetir();
        ozetBilgileriniGetir();
        if (gunlukIslemModalGeriAc) {
          bootstrap.Modal.getOrCreateInstance(document.getElementById('gunlukIslemModal')).show();
          gunlukIslemModalGeriAc = false;
        }
        alert(payload.message || 'Perakende satış güncellendi.');
      } else {
        await hizliSatisKesinlestirSonrasi(kaydedilenMusteriID);
        odemeSonrasiBildir(null, payload?.makbuz);
      }
    };
    if (inst && modalEl) {
      modalEl.addEventListener('hidden.bs.modal', sonrasi, { once: true });
      inst.hide();
    } else {
      await sonrasi();
    }
  } else {
    const msg = (payload && payload.message) || raw || (duzenleMod ? 'Düzenleme başarısız.' : 'Satış tamamlanamadı.');
    alert(msg);
    hizliSatisKesinlestirBtnGuncelle();
  }
}

document.querySelectorAll('input[name="odemeTipi"]').forEach((el) => {
  el.addEventListener('change', hizliSatisOdemeGuncelle);
});

document.getElementById('hizliSatisOnayModal')?.addEventListener('hidden.bs.modal', () => {
  if (_gunlukDuzenleLogID) gunlukPerakendeDuzenleSifirla();
});

// ---------- TEDARİKÇİ ----------
let tedStokCache = [];
let tedTedarikciListeCache = [];
let aktifTedarikciCariID = null;
let tedCariModalGeriAc = false;
let tedAlimStokEkleDonus = false;
let tedAlimTaslak = null;
let tedAlimOdenenManuel = false;
let tedAlimSonAlisMap = { byStokID: {}, byUrunAdi: {} };
let tedAlimAktifAramaInp = null;

function tedAlimKutuKaydirGuncelle() {
  const kutu = document.querySelector('.ted-alim-kalem-kutu');
  if (!kutu) return;
  const n = document.querySelectorAll('#tedAlimKalemGovde tr').length;
  kutu.classList.toggle('ted-alim-kutu-kaydir', n > 4);
}

function tedAlimAramaKatmanKapat() {
  const kat = document.getElementById('tedAlimAramaKatman');
  if (kat) {
    kat.innerHTML = '';
    kat.classList.remove('acik');
  }
  tedAlimAktifAramaInp = null;
}

function tedAlimAramaKatmanKonumla(inp) {
  const kat = document.getElementById('tedAlimAramaKatman');
  if (!kat || !inp) return;
  const r = inp.getBoundingClientRect();
  const genislik = Math.max(r.width, 300);
  let sol = r.left;
  let ust = r.bottom + 4;
  if (sol + genislik > window.innerWidth - 8) sol = Math.max(8, window.innerWidth - genislik - 8);
  const maxH = Math.min(280, window.innerHeight * 0.42);
  if (ust + maxH > window.innerHeight - 8) {
    ust = Math.max(8, r.top - maxH - 4);
  }
  kat.style.left = `${sol}px`;
  kat.style.top = `${ust}px`;
  kat.style.width = `${genislik}px`;
  kat.style.maxHeight = `${maxH}px`;
}

function tedAlimAramaKatmanGoster(inp, html) {
  const kat = document.getElementById('tedAlimAramaKatman');
  if (!kat || !inp) return;
  tedAlimAktifAramaInp = inp;
  kat.innerHTML = html;
  kat.classList.add('acik');
  tedAlimAramaKatmanKonumla(inp);
}

function sayiAlanDeger(inp) {
  if (!inp) return NaN;
  const ham = String(inp.value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const n = parseFloat(ham);
  return Number.isFinite(n) ? n : NaN;
}

function tedAlimOnerilenAlisFiyati(stok) {
  if (!stok) return 0;
  const kart = Number(stok.AlisFiyati || 0);
  if (kart > 0) return Math.round(kart * 100) / 100;
  const sid = String(stok.StokID || '');
  const sonStok = tedAlimSonAlisMap.byStokID?.[sid];
  if (Number(sonStok) > 0) return Number(sonStok);
  const ad = String(stok.UrunAdi || '')
    .trim()
    .toLocaleLowerCase('tr-TR');
  const sonAd = tedAlimSonAlisMap.byUrunAdi?.[ad];
  if (Number(sonAd) > 0) return Number(sonAd);
  return 0;
}

function tedCariModalGeciciKapat() {
  const el = document.getElementById('tedarikciCariModal');
  if (!el?.classList.contains('show')) {
    tedCariModalGeriAc = false;
    return Promise.resolve();
  }
  tedCariModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    el.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(el);
    setTimeout(bitti, 450);
  });
}

function tedCariModalGeriAcPlanla() {
  if (!tedCariModalGeriAc) return;
  tedCariModalGeriAc = false;
  setTimeout(() => {
    modalArtigiTemizle();
    const cariEl = document.getElementById('tedarikciCariModal');
    if (cariEl) modalAc(cariEl);
  }, 100);
}

async function tedAltModalAc(modalEl, hazirlikFn) {
  if (typeof hazirlikFn === 'function') await hazirlikFn();
  await tedCariModalGeciciKapat();
  modalAc(modalEl);
}

let tedarikciRaporlarSonData = null;

function tedarikciRaporlarTarihGoster(ymd) {
  if (!ymd) return '—';
  return tarihTrGoster(`${ymd}T12:00:00`, { dateStyle: 'short' });
}

function tedarikciRaporlarTabloDoldur(liste) {
  const tb = document.getElementById('trTabloGovde');
  if (!tb) return;
  const rows = Array.isArray(liste) ? liste : [];
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Kayıt yok.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map((t) => {
      const bakiye = Number(t.Bakiye || 0);
      const bakiyeCls = bakiye > 0 ? 'text-danger fw-semibold' : 'text-secondary';
      return `<tr>
        <td class="fw-semibold">${gunlukMetinEsc(t.Unvan || '—')}</td>
        <td>${gunlukMetinEsc(t.YetkiliAdi || '—')}</td>
        <td class="text-nowrap">${gunlukMetinEsc(t.Telefon || '—')}</td>
        <td class="text-end text-nowrap">${musteriDetayParaFmt(t.ToplamAlis)}</td>
        <td class="text-end text-nowrap text-success">${musteriDetayParaFmt(t.ToplamOdeme)}</td>
        <td class="text-end text-nowrap ${bakiyeCls}">${musteriDetayParaFmt(bakiye)}</td>
      </tr>`;
    })
    .join('');
}

function tedarikciRaporlarOzetGoster(ozet) {
  const o = ozet || {};
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = musteriDetayParaFmt(val);
  };
  set('trToplamAlis', o.toplamAlis);
  set('trToplamOdeme', o.toplamOdeme);
  set('trToplamBakiye', o.toplamBakiye);
}

function tedarikciRaporlarDokumaniOlustur() {
  const d = tedarikciRaporlarSonData;
  if (!d) return '';
  const company = {
    unvan: gunlukMetinEsc(uygulamaAyarlari?.SirketUnvan || 'ŞİRKET BİLGİSİ'),
    tel: gunlukMetinEsc(uygulamaAyarlari?.SirketTelefon || '-'),
  };
  const bas = tedarikciRaporlarTarihGoster(d.baslangic);
  const bit = tedarikciRaporlarTarihGoster(d.bitis);
  const liste = Array.isArray(d.liste) ? d.liste : [];
  const oz = d.ozet || {};
  const satirlar = liste.length
    ? liste
        .map(
          (t) => `<tr>
        <td>${gunlukMetinEsc(t.Unvan || '—')}</td>
        <td>${gunlukMetinEsc(t.YetkiliAdi || '—')}</td>
        <td class="nw">${gunlukMetinEsc(t.Telefon || '—')}</td>
        <td class="r">${gunlukMetinEsc(musteriDetayParaFmt(t.ToplamAlis))}</td>
        <td class="r">${gunlukMetinEsc(musteriDetayParaFmt(t.ToplamOdeme))}</td>
        <td class="r b">${gunlukMetinEsc(musteriDetayParaFmt(t.Bakiye))}</td>
      </tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="c muted">Kayıt yok.</td></tr>';
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Tedarikçi Raporu</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .firm { font-size: 11px; color: #444; margin-bottom: 10px; }
    .meta { margin-bottom: 10px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ccc; padding: 5px 6px; }
    th { background: #f1f5f9; text-align: left; font-size: 11px; }
    td.r { text-align: right; }
    td.b { font-weight: 700; }
    td.c { text-align: center; }
    td.nw { white-space: nowrap; }
    .ozet { margin-top: 10px; text-align: right; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Tedarikçi Raporu</h1>
  <div class="firm">${company.unvan}${company.tel !== '-' ? ` · Tel: ${company.tel}` : ''}</div>
  <div class="meta"><b>Dönem:</b> ${bas} – ${bit}</div>
  <table>
    <thead>
      <tr>
        <th>Firma / Ünvan</th><th>Yetkili</th><th>Telefon</th>
        <th style="text-align:right">Toplam alış</th>
        <th style="text-align:right">Toplam ödeme</th>
        <th style="text-align:right">Bakiye</th>
      </tr>
    </thead>
    <tbody>${satirlar}</tbody>
  </table>
  <div class="ozet">
    <div><b>Dönem toplam alış:</b> ${gunlukMetinEsc(musteriDetayParaFmt(oz.toplamAlis))}</div>
    <div><b>Dönem toplam ödeme:</b> ${gunlukMetinEsc(musteriDetayParaFmt(oz.toplamOdeme))}</div>
    <div><b>Güncel borç toplamı:</b> ${gunlukMetinEsc(musteriDetayParaFmt(oz.toplamBakiye))}</div>
  </div>
</body>
</html>`;
}

function tedarikciRaporlarYazdir() {
  const html = tedarikciRaporlarDokumaniOlustur();
  if (!html) {
    alert('Önce raporu listeleyin.');
    return;
  }
  const w = window.open('', '_blank');
  if (!w) {
    alert('Yazdırma penceresi açılamadı.');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

async function tedarikciRaporlarYukle() {
  const bas = document.getElementById('trBaslangic')?.value;
  const bit = document.getElementById('trBitis')?.value;
  if (!bas || !bit) return alert('Başlangıç ve bitiş tarihini seçin.');
  if (bas > bit) return alert('Başlangıç tarihi bitişten sonra olamaz.');
  const tb = document.getElementById('trTabloGovde');
  if (tb) tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Yükleniyor…</td></tr>';
  try {
    const u = new URL('/api/tedarikci/rapor', window.location.origin);
    u.searchParams.set('baslangic', bas);
    u.searchParams.set('bitis', bit);
    const res = await fetch(u);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Rapor alınamadı.');
    tedarikciRaporlarSonData = {
      liste: data.liste || [],
      ozet: data.ozet || {},
      baslangic: bas,
      bitis: bit,
    };
    tedarikciRaporlarTabloDoldur(data.liste);
    tedarikciRaporlarOzetGoster(data.ozet);
  } catch (e) {
    console.error(e);
    tedarikciRaporlarSonData = null;
    if (tb) {
      tb.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${gunlukMetinEsc(e.message || 'Hata')}</td></tr>`;
    }
    alert(e.message || 'Rapor yüklenemedi.');
  }
}

async function tedarikciRaporlarTarihVarsayilanVeYukle() {
  const tb = document.getElementById('trTabloGovde');
  try {
    const res = await fetch('/api/tedarikci/rapor');
    const data = await res.json().catch(() => ({}));
    const basEl = document.getElementById('trBaslangic');
    const bitEl = document.getElementById('trBitis');
    if (basEl) basEl.value = data.ilkTarih || gunlukBugunInputVal();
    if (bitEl) bitEl.value = gunlukBugunInputVal();
    await tedarikciRaporlarYukle();
  } catch (e) {
    console.error(e);
    if (tb) {
      tb.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${gunlukMetinEsc(e.message || 'Yüklenemedi')}</td></tr>`;
    }
  }
}

function tedarikciRaporlarModalAc() {
  const el = document.getElementById('tedarikciRaporlarModal');
  if (!el) return;
  tedarikciRaporlarSonData = null;
  const tb = document.getElementById('trTabloGovde');
  if (tb) tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Yükleniyor…</td></tr>';
  bootstrap.Modal.getOrCreateInstance(el).show();
  el.style.zIndex = '1085';
  setTimeout(() => {
    const backs = document.querySelectorAll('.modal-backdrop');
    const son = backs[backs.length - 1];
    if (son) son.style.zIndex = '1080';
  }, 80);
  tedarikciRaporlarTarihVarsayilanVeYukle();
}

async function tedarikciListele() {
  try {
    const r = await fetch('/api/tedarikci');
    const list = await r.json();
    const tb = document.getElementById('tedarikciTabloGovdesi');
    if (!tb) return;
    tb.innerHTML = '';
    if (!list.length) {
      tb.innerHTML =
        '<tr><td colspan="6" class="text-center text-muted p-4">Kayıt yok. Yeni tedarikçi ekleyin.</td></tr>';
      return;
    }
    list.forEach((t) => {
      const borc = Number(t.Bakiye) || 0;
      const borcText = borc > 0 ? `${borc.toFixed(2)}` : '0.00';
      tb.innerHTML += `
        <tr ondblclick="tedarikciCariModalAc(${t.TedarikciID})" style="cursor: pointer;" title="Çift tık: cari kartı">
          <td class="align-middle text-muted">#${t.TedarikciID}</td>
          <td class="align-middle fw-bold text-dark">${gunlukMetinEsc(t.Unvan)}</td>
          <td class="align-middle">${gunlukMetinEsc(t.YetkiliAdi || '—')}</td>
          <td class="align-middle">${gunlukMetinEsc(t.Telefon || '—')}</td>
          <td class="align-middle text-end fw-bold ${borc > 0 ? 'text-danger' : 'text-secondary'}">${gunlukMetinEsc(borcText)}</td>
          <td class="align-middle text-end text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); tedarikciSil(${t.TedarikciID})"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`;
    });
  } catch (e) {
    console.error(e);
  }
}

async function tedarikciKaydet(event) {
  event.preventDefault();
  const body = {
    Unvan: document.getElementById('tedarikciUnvan').value.trim(),
    YetkiliAdi: document.getElementById('tedarikciYetkili').value.trim(),
    Telefon: document.getElementById('tedarikciTelefon').value.trim(),
    Adres: document.getElementById('tedarikciAdres').value.trim(),
    VergiNo: document.getElementById('tedarikciVergi').value.trim(),
    kullanici: aktifKullanici,
  };
  try {
    const res = await fetch('/api/tedarikci', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      modalKapat(document.getElementById('tedarikciEkleModal'));
      document.getElementById('tedarikciEkleForm').reset();
      tedarikciListele();
    } else {
      alert(data.message || 'Kayıt başarısız.');
    }
  } catch (e) {
    console.error(e);
    alert('Bağlantı hatası.');
  }
}

async function tedarikciSil(id) {
  if (!confirm('Bu tedarikçiyi silmek istiyor musunuz? (Bakiye sıfır ve hareket kaydı olmamalı.)')) return;
  try {
    const res = await fetch(`/api/tedarikci/${id}?kullanici=${encodeURIComponent(aktifKullanici)}`, {
      method: 'DELETE',
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) tedarikciListele();
    else alert(data.message || 'Silinemedi.');
  } catch (e) {
    console.error(e);
  }
}

function tedAlimSeciliTedarikciBakiye() {
  const id = parseInt(document.getElementById('tedAlimTedarikci')?.value, 10);
  if (!Number.isInteger(id) || id < 1) return 0;
  const t = (tedTedarikciListeCache || []).find((x) => Number(x.TedarikciID) === id);
  return Number(t?.Bakiye || 0);
}

function tedAlimSatirUrunAdi(tr) {
  return String(tr?.querySelector('.ted-alim-urun-ara')?.value || '').trim();
}

function tedAlimSatirSonucKapat(tr) {
  if (tr && tedAlimAktifAramaInp && tr.contains(tedAlimAktifAramaInp)) tedAlimAramaKatmanKapat();
  else if (!tr) tedAlimAramaKatmanKapat();
}

function tedAlimSatirStokUygula(tr, s) {
  if (!tr || !s) return;
  const hid = tr.querySelector('.ted-alim-stok');
  const inp = tr.querySelector('.ted-alim-urun-ara');
  if (hid) {
    hid.value = String(s.StokID || '');
    hid.dataset.urunAdi = s.UrunAdi || '';
  }
  if (inp) inp.value = s.UrunAdi || '';
  const mevcutMik = parseInt(tr.querySelector('.ted-alim-mik')?.value, 10);
  if (!Number.isInteger(mevcutMik) || mevcutMik < 1) {
    tr.querySelector('.ted-alim-mik').value = 1;
  }
  tr.querySelector('.ted-alim-birim').value = s.Birim || 'Adet';
  const alis = tedAlimOnerilenAlisFiyati(s);
  tr.querySelector('.ted-alim-alis').value = alis.toFixed(2);
  tr.querySelector('.ted-alim-satis').value = Number(s.SatisFiyati || 0).toFixed(2);
  tedAlimSatirSonucKapat(tr);
  tedAlimSatirTutarGuncelle(tr);
  tedAlimOzetGuncelle();
}

function tedAlimSatirAraGuncelle(inp) {
  const tr = inp?.closest('tr');
  if (!tr) return;
  const hid = tr.querySelector('.ted-alim-stok');
  const kelime = String(inp.value || '').trim();
  if (hid?.dataset?.urunAdi && kelime !== hid.dataset.urunAdi) {
    hid.value = '';
    delete hid.dataset.urunAdi;
  }
  if (!kelime) {
    tedAlimSatirSonucKapat(tr);
    tedAlimOzetGuncelle();
    return;
  }
  const list = (tedStokCache || []).filter((s) => stokMetinAramaEslesir(s, kelime)).slice(0, 20);
  if (!list.length) {
    tedAlimAramaKatmanGoster(
      inp,
      '<div class="list-group-item small text-muted py-2">Sonuç yok — yazdığınız ad yeni ürün olarak kaydedilir</div>',
    );
    tedAlimOzetGuncelle();
    return;
  }
  const html = list
    .map((s) => {
      const barkod = String(s.Barkod || '').trim();
      const bk = barkod ? `<small class="text-muted ms-1">${gunlukMetinEsc(barkod)}</small>` : '';
      return `<button type="button" class="list-group-item list-group-item-action py-2"
        onclick="tedAlimSatirListedenSec(this, ${Number(s.StokID)})">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <span class="fw-semibold">${gunlukMetinEsc(s.UrunAdi || '')}${bk}</span>
          <small class="text-muted text-nowrap">Stok: ${Number(s.MevcutMiktar || 0)}</small>
        </div>
      </button>`;
    })
    .join('');
  tedAlimAramaKatmanGoster(inp, html);
  tedAlimOzetGuncelle();
}

function tedAlimSatirListedenSec(btn, stokID) {
  const tr = tedAlimAktifAramaInp?.closest('tr');
  const s = tedStokCache.find((x) => Number(x.StokID) === Number(stokID));
  if (!tr || !s) return;
  tedAlimSatirStokUygula(tr, s);
  tr.querySelector('.ted-alim-mik')?.focus();
}

function tedAlimSatirAraKeydown(ev) {
  if (!ev || !ev.target?.classList?.contains('ted-alim-urun-ara')) return;
  const tr = ev.target.closest('tr');
  const kelime = String(ev.target.value || '').trim();
  if (ev.key === 'Escape') {
    tedAlimSatirSonucKapat(tr);
    return;
  }
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  if (!kelime) return;
  const list = (tedStokCache || []).filter((s) => stokMetinAramaEslesir(s, kelime));
  const exact = list.find((s) => String(s.Barkod || '').trim() === kelime);
  if (exact) {
    tedAlimSatirStokUygula(tr, exact);
    tr.querySelector('.ted-alim-mik')?.focus();
    return;
  }
  if (list.length === 1) {
    tedAlimSatirStokUygula(tr, list[0]);
    tr.querySelector('.ted-alim-mik')?.focus();
  }
}

function tedAlimKalemToplamHesapla() {
  let toplam = 0;
  let adet = 0;
  document.querySelectorAll('#tedAlimKalemGovde tr').forEach((tr) => {
    const urunAdi = tedAlimSatirUrunAdi(tr);
    const miktar = parseInt(tr.querySelector('.ted-alim-mik')?.value, 10);
    const alis = sayiAlanDeger(tr.querySelector('.ted-alim-alis'));
    if (!urunAdi || !Number.isInteger(miktar) || miktar < 1) return;
    const birim = Number.isFinite(alis) && alis >= 0 ? alis : 0;
    toplam += miktar * birim;
    adet += 1;
  });
  return { toplam: Math.round(toplam * 100) / 100, adet };
}

function tedAlimSatirTutarGuncelle(tr) {
  if (!tr) return;
  const miktar = parseInt(tr.querySelector('.ted-alim-mik')?.value, 10);
  const alis = sayiAlanDeger(tr.querySelector('.ted-alim-alis'));
  const el = tr.querySelector('.ted-alim-satir-tutar');
  const alisInp = tr.querySelector('.ted-alim-alis');
  if (!el) return;
  const m = Number.isInteger(miktar) && miktar > 0 ? miktar : 0;
  const f = Number.isFinite(alis) && alis >= 0 ? alis : 0;
  const tutar = Math.round(m * f * 100) / 100;
  el.textContent = musteriDetayParaFmt(tutar);
  if (alisInp) {
    alisInp.classList.toggle('is-invalid', f <= 0 && m > 0);
    alisInp.title = f <= 0 && m > 0 ? 'Alış fiyatı girin; 0 ise tutar ve borç yansımaz' : '';
  }
}

function tedAlimOzetGuncelle() {
  const { toplam, adet } = tedAlimKalemToplamHesapla();
  const topEl = document.getElementById('tedAlimToplamTutar');
  const adetEl = document.getElementById('tedAlimKalemSayisi');
  if (topEl) topEl.textContent = musteriDetayParaFmt(toplam);
  if (adetEl) adetEl.textContent = `${adet} kalem`;

  const mevcutBorc = tedAlimSeciliTedarikciBakiye();
  const mevcutEl = document.getElementById('tedAlimMevcutBorc');
  if (mevcutEl) mevcutEl.textContent = musteriDetayParaFmt(mevcutBorc);

  const odemeVar = !!document.getElementById('tedAlimOdemeVar')?.checked;
  const odenenInp = document.getElementById('tedAlimOdenenTutar');
  if (odemeVar && odenenInp && !tedAlimOdenenManuel) {
    odenenInp.value = toplam > 0 ? toplam.toFixed(2) : '0';
  }
  const odenen = odemeVar ? Number(odenenInp?.value || 0) : 0;
  const borcOngoru = Math.round((mevcutBorc + toplam - odenen) * 100) / 100;
  const ongoruWrap = document.getElementById('tedAlimBorcOngoruWrap');
  const ongoruEl = document.getElementById('tedAlimBorcOngoru');
  if (ongoruWrap && ongoruEl) {
    const goster = toplam > 0 || mevcutBorc > 0;
    ongoruWrap.classList.toggle('d-none', !goster);
    ongoruEl.textContent = musteriDetayParaFmt(Math.max(0, borcOngoru));
  }
  const ipucu = document.getElementById('tedAlimOdemeIpucu');
  if (ipucu) {
    ipucu.textContent = odemeVar
      ? `Öneri: ${musteriDetayParaFmt(toplam)} (alım tutarı). İsterseniz değiştirin.`
      : 'Ödeme işaretlenince alım tutarı önerilir.';
  }
}

function tedAlimTedarikciDegisti() {
  tedAlimOdenenManuel = false;
  tedAlimOzetGuncelle();
}

function tedAlimOdenenManuelGirildi() {
  tedAlimOdenenManuel = true;
  tedAlimOzetGuncelle();
}

async function tedAlimModalHazirla(preselectId) {
  const [tedR, stokR, sonAlisR] = await Promise.all([
    fetch('/api/tedarikci'),
    fetch('/api/stok'),
    fetch('/api/stok/son-alis-fiyatlari'),
  ]);
  tedStokCache = await stokR.json();
  tedTedarikciListeCache = await tedR.json();
  tedAlimSonAlisMap = (await sonAlisR.json().catch(() => ({}))) || {};
  if (!tedAlimSonAlisMap.byStokID) tedAlimSonAlisMap.byStokID = {};
  if (!tedAlimSonAlisMap.byUrunAdi) tedAlimSonAlisMap.byUrunAdi = {};
  const tedarikciler = tedTedarikciListeCache;
  const sel = document.getElementById('tedAlimTedarikci');
  sel.innerHTML = '<option value="">— Seçin —</option>';
  tedarikciler.forEach((x) => {
    sel.innerHTML += `<option value="${x.TedarikciID}">${gunlukMetinEsc(x.Unvan)}</option>`;
  });
  if (preselectId) sel.value = String(preselectId);
  document.getElementById('tedAlimStoga').checked = true;
  const odemeVar = document.getElementById('tedAlimOdemeVar');
  if (odemeVar) odemeVar.checked = false;
  const odenen = document.getElementById('tedAlimOdenenTutar');
  if (odenen) odenen.value = '0';
  const odemeSekli = document.getElementById('tedAlimOdemeSekli');
  if (odemeSekli) odemeSekli.value = 'Nakit';
  tedAlimOdemeVarDegisti();
  tedAlimOdenenManuel = false;
  document.getElementById('tedAlimAciklama').value = '';
  const tb = document.getElementById('tedAlimKalemGovde');
  tb.innerHTML = '';
  tedAlimKalemEkle();
  tedAlimKutuKaydirGuncelle();
  tedAlimOzetGuncelle();
}

function tedAlimOdemeVarDegisti() {
  const chk = document.getElementById('tedAlimOdemeVar');
  const alan = document.getElementById('tedAlimOdemeAlan');
  if (!chk || !alan) return;
  alan.style.display = chk.checked ? '' : 'none';
  if (chk.checked) tedAlimOdenenManuel = false;
  tedAlimOzetGuncelle();
}

function tedAlimDurumOku() {
  const satirlar = [];
  document.querySelectorAll('#tedAlimKalemGovde tr').forEach((tr) => {
    satirlar.push({
      stokID: tr.querySelector('.ted-alim-stok')?.value || '',
      urunAdi: tedAlimSatirUrunAdi(tr),
      miktar: tr.querySelector('.ted-alim-mik')?.value || '1',
      birim: tr.querySelector('.ted-alim-birim')?.value || 'Adet',
      alis: tr.querySelector('.ted-alim-alis')?.value || '0',
      satis: tr.querySelector('.ted-alim-satis')?.value || '0',
    });
  });
  return {
    tedarikciID: document.getElementById('tedAlimTedarikci')?.value || '',
    stoga: !!document.getElementById('tedAlimStoga')?.checked,
    odemeVar: !!document.getElementById('tedAlimOdemeVar')?.checked,
    odenen: document.getElementById('tedAlimOdenenTutar')?.value || '0',
    odemeSekli: document.getElementById('tedAlimOdemeSekli')?.value || 'Nakit',
    aciklama: document.getElementById('tedAlimAciklama')?.value || '',
    satirlar,
  };
}

function tedAlimDurumYukle(t) {
  if (!t) return;
  const tedSel = document.getElementById('tedAlimTedarikci');
  if (tedSel) tedSel.value = t.tedarikciID || '';
  const stoga = document.getElementById('tedAlimStoga');
  if (stoga) stoga.checked = !!t.stoga;
  const odemeVar = document.getElementById('tedAlimOdemeVar');
  if (odemeVar) odemeVar.checked = !!t.odemeVar;
  const odenen = document.getElementById('tedAlimOdenenTutar');
  if (odenen) odenen.value = t.odenen || '0';
  const odemeSekli = document.getElementById('tedAlimOdemeSekli');
  if (odemeSekli) odemeSekli.value = t.odemeSekli || 'Nakit';
  const aciklama = document.getElementById('tedAlimAciklama');
  if (aciklama) aciklama.value = t.aciklama || '';
  tedAlimOdemeVarDegisti();
  tedAlimOdenenManuel = false;

  const tb = document.getElementById('tedAlimKalemGovde');
  if (!tb) return;
  tb.innerHTML = '';
  const ss = Array.isArray(t.satirlar) && t.satirlar.length ? t.satirlar : [{}];
  ss.forEach((s) => {
    tedAlimKalemEkle();
    const tr = tb.lastElementChild;
    if (!tr) return;
    const stokHid = tr.querySelector('.ted-alim-stok');
    const urunInp = tr.querySelector('.ted-alim-urun-ara');
    if (stokHid) {
      stokHid.value = s.stokID || '';
      if (s.urunAdi) stokHid.dataset.urunAdi = s.urunAdi;
    }
    if (urunInp) urunInp.value = s.urunAdi || '';
    if (tr.querySelector('.ted-alim-mik')) tr.querySelector('.ted-alim-mik').value = s.miktar || '1';
    if (tr.querySelector('.ted-alim-birim')) tr.querySelector('.ted-alim-birim').value = s.birim || 'Adet';
    if (tr.querySelector('.ted-alim-alis')) tr.querySelector('.ted-alim-alis').value = s.alis || '0';
    if (tr.querySelector('.ted-alim-satis')) tr.querySelector('.ted-alim-satis').value = s.satis || '0';
    tedAlimSatirTutarGuncelle(tr);
  });
  tedAlimKutuKaydirGuncelle();
  tedAlimOzetGuncelle();
}

function tedAlimHizliStokEkleAc() {
  tedAlimTaslak = tedAlimDurumOku();
  tedAlimStokEkleDonus = true;
  stokEkleModalGoster(() => {
    stokDuzenlemeID = null;
    document.getElementById('stokModalBaslik').innerHTML = '<i class="fa-solid fa-plus"></i> Yeni Ürün Ekle';
    document.getElementById('stokEkleForm').reset();
    document.getElementById('kritikEsik').value = 5;
    document.getElementById('hedefEsik').value = 20;
  });
}

async function tedAlimModalAc(preselectId) {
  const alimEl = document.getElementById('tedarikciAlimModal');
  await tedAltModalAc(alimEl, () => tedAlimModalHazirla(preselectId));
}

function tedAlimKalemEkle(odakUrun) {
  const tb = document.getElementById('tedAlimKalemGovde');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <input type="hidden" class="ted-alim-stok" value="">
      <input type="text" class="form-control form-control-sm ted-alim-urun-ara" placeholder="Ürün veya barkod ara…" autocomplete="off"
        oninput="tedAlimSatirAraGuncelle(this)" onfocus="tedAlimSatirAraGuncelle(this)" onkeydown="tedAlimSatirAraKeydown(event)">
    </td>
    <td><input type="number" min="1" class="form-control form-control-sm ted-alim-mik" value="1" oninput="tedAlimSatirTutarGuncelle(this.closest('tr')); tedAlimOzetGuncelle()"></td>
    <td><input type="text" class="form-control form-control-sm ted-alim-birim" value="Adet"></td>
    <td><input type="number" step="0.01" min="0" class="form-control form-control-sm ted-alim-alis" value="0" oninput="tedAlimSatirTutarGuncelle(this.closest('tr')); tedAlimOzetGuncelle()"></td>
    <td><input type="number" step="0.01" min="0" class="form-control form-control-sm ted-alim-satis" value="0"></td>
    <td class="text-end text-nowrap small fw-semibold ted-alim-satir-tutar">0,00 ₺</td>
    <td><button type="button" class="btn btn-sm btn-outline-danger" onclick="const r=this.closest('tr'); if(tedAlimAktifAramaInp&&r.contains(tedAlimAktifAramaInp))tedAlimAramaKatmanKapat(); r.remove(); tedAlimKutuKaydirGuncelle(); tedAlimOzetGuncelle()" title="Sil"><i class="fa-solid fa-xmark"></i></button></td>`;
  tb.appendChild(tr);
  tedAlimSatirTutarGuncelle(tr);
  tedAlimKutuKaydirGuncelle();
  tedAlimOzetGuncelle();
  if (odakUrun !== false) {
    setTimeout(() => tr.querySelector('.ted-alim-urun-ara')?.focus(), 30);
  }
}

async function tedAlimGonder() {
  const tid = parseInt(document.getElementById('tedAlimTedarikci').value, 10);
  if (!tid) {
    alert('Tedarikçi seçin.');
    return;
  }
  const stoga = document.getElementById('tedAlimStoga').checked;
  const stogaMsg = stoga
    ? 'Satın alınan ürünler stoğa işlenecek.'
    : 'Stok miktarları güncellenmeyecek; sadece cari ve ödeme kaydı oluşturulacak.';
  if (!confirm(`İşlemi onaylıyor musunuz?\n${stogaMsg}`)) return;

  const odemeVarMi = !!document.getElementById('tedAlimOdemeVar')?.checked;
  const odemeSekli = document.getElementById('tedAlimOdemeSekli')?.value || 'Nakit';
  const odenenTutar = odemeVarMi ? Number(document.getElementById('tedAlimOdenenTutar')?.value || 0) : 0;

  const kalemler = [];
  document.querySelectorAll('#tedAlimKalemGovde tr').forEach((tr) => {
    const stokHid = tr.querySelector('.ted-alim-stok');
    const stokID = stokHid && stokHid.value ? parseInt(stokHid.value, 10) : null;
    const urunAdi = tedAlimSatirUrunAdi(tr);
    const miktar = parseInt((tr.querySelector('.ted-alim-mik') || {}).value, 10);
    const birim = ((tr.querySelector('.ted-alim-birim') || {}).value || 'Adet').trim();
    const alis = sayiAlanDeger(tr.querySelector('.ted-alim-alis'));
    const satis = sayiAlanDeger(tr.querySelector('.ted-alim-satis'));
    if (!urunAdi || !Number.isInteger(miktar) || miktar < 1) return;
    kalemler.push({
      stokID,
      urunAdi,
      miktar,
      birim,
      alisFiyati: Number.isFinite(alis) && alis >= 0 ? alis : 0,
      satisFiyati: Number.isFinite(satis) && satis >= 0 ? satis : 0,
      yeniUrun: !stokID,
    });
  });

  if (kalemler.length === 0) {
    alert('En az bir geçerli satır girin (ürün adı + miktar).');
    return;
  }

  const sifirAlisSatir = kalemler.filter((k) => !(Number(k.alisFiyati) > 0));
  if (sifirAlisSatir.length) {
    const isimler = sifirAlisSatir
      .map((k) => k.urunAdi)
      .slice(0, 4)
      .join(', ');
    const ek = sifirAlisSatir.length > 4 ? '…' : '';
    if (
      !confirm(
        `${sifirAlisSatir.length} satırda alış fiyatı 0 veya boş (${isimler}${ek}).\nBu satırların tutarı borca yansımaz. Yine de kaydedilsin mi?`,
      )
    ) {
      return;
    }
  }

  const body = {
    tedarikciID: tid,
    kalemler,
    odemeVarMi,
    odenenTutar,
    odemeSekli,
    stogaAktar: stoga,
    kullanici: aktifKullanici,
    aciklama: document.getElementById('tedAlimAciklama').value.trim() || null,
  };

  try {
    const res = await fetch('/api/tedarikci/alim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      const modalEl = document.getElementById('tedarikciAlimModal');
      const inst = bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
      alert(data.message || 'Kaydedildi.');
      tedarikciListele();
      if (aktifTedarikciCariID && String(aktifTedarikciCariID) === String(tid)) tedarikciCariIcerikYenile();
      tedCariModalGeriAcPlanla();
      stoklariGetir();
      ozetBilgileriniGetir();
    } else {
      alert(data.message || 'Kayıt başarısız.');
    }
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function tedarikciOdemeModalAc(id) {
  document.getElementById('tedOdemeTedarikciId').value = id;
  document.getElementById('tedOdemeTutar').value = '';
  document.getElementById('tedOdemeNot').value = '';
  document.getElementById('tedOdemeSekil').value = 'Nakit';
  try {
    const r = await fetch('/api/tedarikci');
    const list = await r.json();
    const t = list.find((x) => x.TedarikciID === id);
    document.getElementById('tedOdemeBaslik').textContent = t
      ? `${t.Unvan} — Güncel borç: ${Number(t.Bakiye || 0).toFixed(2)} ₺`
      : '';
  } catch (_) {
    document.getElementById('tedOdemeBaslik').textContent = '';
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('tedarikciOdemeModal')).show();
}

async function tedarikciOdemeKaydet(event) {
  event.preventDefault();
  const body = {
    tedarikciID: parseInt(document.getElementById('tedOdemeTedarikciId').value, 10),
    tutar: parseFloat(document.getElementById('tedOdemeTutar').value),
    odemeSekli: document.getElementById('tedOdemeSekil').value,
    kullanici: aktifKullanici,
    aciklama: document.getElementById('tedOdemeNot').value.trim() || null,
  };
  try {
    const res = await fetch('/api/tedarikci/odeme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      modalKapat(document.getElementById('tedarikciOdemeModal'));
      tedarikciListele();
      if (aktifTedarikciCariID && String(aktifTedarikciCariID) === String(body.tedarikciID)) tedarikciCariIcerikYenile();
      tedCariModalGeriAcPlanla();
      ozetBilgileriniGetir();
      alert(data.message || 'Ödeme kaydedildi.');
    } else {
      alert(data.message || 'Ödeme kaydedilemedi.');
    }
  } catch (e) {
    console.error(e);
  }
}

async function genelGiderListele() {
  const tb = document.getElementById('genelGiderTabloGovdesi');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Yükleniyor…</td></tr>';
  try {
    const res = await fetch('/api/genel-gider');
    if (!res.ok) throw new Error();
    const rows = await res.json();
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Kayıt yok.</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map((r) => {
        const gid = Number(r.GiderID || 0);
        const tarihStr = tarihTrGoster(r.Tarih);
        const duzenleBtn = gid
          ? `<button type="button" class="btn btn-sm btn-warning text-dark me-1" title="Düzenle" onclick="genelGiderDuzenleAc(${gid})"><i class="fa-solid fa-pencil"></i></button>`
          : '';
        const silBtn = gid
          ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="genelGiderSil(${gid})">Sil</button>`
          : '';
        return `<tr>
        <td class="text-nowrap small">${gunlukMetinEsc(tarihStr)}</td>
        <td>${gunlukMetinEsc(r.Kategori || '—')}</td>
        <td class="text-end fw-semibold">${Number(r.Tutar || 0).toFixed(2)} ₺</td>
        <td><span class="badge bg-secondary">${gunlukMetinEsc(r.OdemeSekli || '')}</span></td>
        <td class="d-none d-md-table-cell small text-muted">${gunlukMetinEsc(r.Aciklama || '—')}</td>
        <td class="d-none d-lg-table-cell small">${gunlukMetinEsc(r.Kullanici || '—')}</td>
        <td class="text-end text-nowrap">${duzenleBtn}${silBtn}</td>
      </tr>`;
      })
      .join('');
  } catch (e) {
    console.error(e);
    tb.innerHTML =
      '<tr><td colspan="7" class="text-center text-danger py-3">Liste alınamadı.</td></tr>';
  }
}

let giderListeModalGeriAc = false;

function giderListeModalGeciciKapat() {
  const el = document.getElementById('giderListeModal');
  if (!el?.classList.contains('show')) {
    giderListeModalGeriAc = false;
    return Promise.resolve();
  }
  giderListeModalGeriAc = true;
  return new Promise((resolve) => {
    const bitti = () => {
      modalArtigiTemizle();
      resolve();
    };
    el.addEventListener('hidden.bs.modal', bitti, { once: true });
    modalKapat(el);
    setTimeout(bitti, 450);
  });
}

function giderListeModalGeriAcPlanla() {
  if (!giderListeModalGeriAc) return;
  giderListeModalGeriAc = false;
  setTimeout(() => {
    modalArtigiTemizle();
    const el = document.getElementById('giderListeModal');
    if (el) modalAc(el, () => genelGiderListele());
  }, 100);
}

async function genelGiderDuzenleAc(giderID) {
  const gid = Number(giderID);
  if (!gid) return;
  const res = await fetch(`/api/genel-gider/${gid}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.message || 'Gider bilgisi alınamadı.');
    return;
  }
  document.getElementById('ggDuzenleGiderID').value = String(gid);
  document.getElementById('ggDuzenleTarih').textContent = tarihTrGoster(data.Tarih);
  document.getElementById('ggDuzenleKullanici').textContent = data.Kullanici || '—';
  document.getElementById('ggDuzenleKategori').value = data.Kategori || '';
  document.getElementById('ggDuzenleTutar').value = Number(data.Tutar || 0).toFixed(2);
  document.getElementById('ggDuzenleOdeme').value = data.OdemeSekli || 'Nakit';
  document.getElementById('ggDuzenleAciklama').value = data.Aciklama || '';
  await giderListeModalGeciciKapat();
  modalAc(document.getElementById('genelGiderDuzenleModal'));
}

async function genelGiderDuzenleKaydet() {
  const gid = Number(document.getElementById('ggDuzenleGiderID').value);
  if (!gid) return;
  const tutar = parseFloat(document.getElementById('ggDuzenleTutar').value);
  if (!Number.isFinite(tutar) || tutar <= 0) {
    alert('Geçerli tutar girin.');
    return;
  }
  const body = {
    tutar,
    odemeSekli: document.getElementById('ggDuzenleOdeme').value,
    kategori: document.getElementById('ggDuzenleKategori').value.trim(),
    aciklama: document.getElementById('ggDuzenleAciklama').value.trim() || null,
    kullanici: aktifKullanici,
  };
  try {
    const res = await fetch(`/api/genel-gider/${gid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Gider güncellenemedi.');
      return;
    }
    modalKapat(document.getElementById('genelGiderDuzenleModal'));
    alert(data.message || 'Gider güncellendi.');
    ozetBilgileriniGetir();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function genelGiderSil(giderID) {
  const gid = Number(giderID);
  if (!gid) return;
  if (!confirm('Bu gider kaydı silinsin mi?\n\nTutar bugün kasaya iade edilir (giriş kaydı). Günlük listede gider satırı kalkar.')) return;
  try {
    const res = await fetch(
      `/api/genel-gider/${gid}?kullanici=${encodeURIComponent(aktifKullanici || 'Sistem')}`,
      { method: 'DELETE' },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Gider silinemedi.');
      return;
    }
    alert(data.message || 'Gider silindi.');
    genelGiderListele();
    ozetBilgileriniGetir();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function genelGiderKaydet(event) {
  event.preventDefault();
  const body = {
    tutar: parseFloat(document.getElementById('genelGiderTutar').value),
    odemeSekli: document.getElementById('genelGiderOdeme').value,
    kategori: document.getElementById('genelGiderKategori').value.trim(),
    aciklama: document.getElementById('genelGiderAciklama').value.trim() || null,
    kullanici: aktifKullanici,
  };
  try {
    const res = await fetch('/api/genel-gider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      document.getElementById('genelGiderTutar').value = '';
      document.getElementById('genelGiderKategori').value = '';
      document.getElementById('genelGiderAciklama').value = '';
      alert(data.message || 'Kaydedildi.');
      genelGiderListele();
      ozetBilgileriniGetir();
    } else {
      alert(data.message || 'Kayıt başarısız.');
    }
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

const TED_CARI_TABLO_KOLON = 7;

function tedarikciAlimOdemeEslestir(hareketler) {
  const map = new Map();
  for (const h of hareketler || []) {
    if (String(h.Tur || '').toLowerCase() !== 'odeme') continue;
    const m = String(h.Aciklama || '').match(/Alım\s*#(\d+)/i);
    if (!m) continue;
    const aid = Number(m[1]);
    if (!map.has(aid)) map.set(aid, []);
    map.get(aid).push(h);
  }
  return map;
}

function tedarikciCariUrunDetayParse(urunDetay, toplamTutar) {
  const parcalar = String(urunDetay || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const fallback = [];
  for (const p of parcalar) {
    const m = p.match(/^(.+?)\s*[x×](\d+)(?:\s*@\s*(\d+(?:[.,]\d+)?))?\s*$/i);
    if (!m) continue;
    const urunAdi = String(m[1] || '').trim();
    const miktar = parseInt(m[2], 10);
    let birimFiyat = m[3] ? Number(String(m[3]).replace(',', '.')) || 0 : 0;
    if ((!Number.isFinite(birimFiyat) || birimFiyat <= 0) && Number.isInteger(miktar) && miktar > 0 && parcalar.length === 1) {
      birimFiyat = Number(toplamTutar || 0) / miktar;
    }
    const satirTutar =
      birimFiyat > 0 ? Math.round(birimFiyat * miktar * 100) / 100 : 0;
    if (urunAdi && Number.isInteger(miktar) && miktar > 0) {
      fallback.push({ UrunAdi: urunAdi, Miktar: miktar, BirimFiyat: birimFiyat, SatirTutar: satirTutar });
    }
  }
  return fallback;
}

/** Tedarikçi cari — mal alım kalemleri + bağlı ödeme satırları (fatura mantığı). */
function tedarikciCariListeSatirlari(hareketler) {
  const list = hareketler || [];
  const alimOdeme = tedarikciAlimOdemeEslestir(list);
  const kullanilanOdeme = new Set();
  const cikti = [];

  for (const h of list) {
    const tur = String(h.Tur || '').toLowerCase();
    if (tur === 'odeme') {
      if (/Alım\s*#\d+/i.test(String(h.Aciklama || ''))) continue;
      cikti.push({
        Tarih: h.Tarih,
        AnaKayitID: h.KayitID,
        KayitID: h.KayitID,
        Tur: 'odeme',
        SatirTur: 'mal_alim_odeme',
        Kaynak: 'mal_alim_odeme',
        GrupAnahtar: `odeme-${h.KayitID}`,
        TurEtiket: 'Ödeme',
        Odeme: h.OdemeSekli || '—',
        Tutar: Number(h.Tutar || 0),
      });
      continue;
    }
    if (tur !== 'alim') continue;

    const grupKey = `alim-${h.KayitID}`;
    let satirlar =
      Array.isArray(h.satirlar) && h.satirlar.length
        ? h.satirlar
        : tedarikciCariUrunDetayParse(h.UrunDetay, h.Tutar);
    if (!satirlar.length) {
      satirlar = [
        {
          UrunAdi: h.Aciklama || 'Mal alım',
          Miktar: 1,
          BirimFiyat: Number(h.Tutar || 0),
          SatirTutar: Number(h.Tutar || 0),
        },
      ];
    }
    satirlar.forEach((d, i) => {
      cikti.push({
        Tarih: h.Tarih,
        AnaKayitID: h.KayitID,
        KayitID: h.KayitID,
        Tur: 'alim',
        SatirTur: 'mal_alim_kalem',
        Kaynak: 'mal_alim',
        GrupAnahtar: grupKey,
        KalemSira: i,
        TurEtiket: 'Mal alım',
        Odeme: i === 0 ? h.OdemeSekli || '—' : '—',
        UrunAdi: d.UrunAdi || '-',
        Miktar: Number(d.Miktar || 0),
        BirimFiyat: Number(d.BirimFiyat || 0),
        Tutar: Number(d.SatirTutar || 0),
      });
    });
    for (const o of alimOdeme.get(Number(h.KayitID)) || []) {
      if (kullanilanOdeme.has(o.KayitID)) continue;
      kullanilanOdeme.add(o.KayitID);
      cikti.push({
        Tarih: o.Tarih,
        AnaKayitID: h.KayitID,
        KayitID: o.KayitID,
        Tur: 'odeme',
        SatirTur: 'mal_alim_odeme',
        Kaynak: 'mal_alim_odeme',
        GrupAnahtar: grupKey,
        TurEtiket: 'Ödeme',
        Odeme: o.OdemeSekli || '—',
        Tutar: Number(o.Tutar || 0),
      });
    }
  }
  return cikti;
}

function tedarikciCariKalemSatirMi(row) {
  return (row.SatirTur || '') === 'mal_alim_kalem';
}

function tedarikciCariOdemeSatirMi(row) {
  return (row.SatirTur || '') === 'mal_alim_odeme';
}

function tedarikciCariTabloSatirHtml(row) {
  const tarihStr = tarihTrGoster(row.Tarih);
  const kalem = tedarikciCariKalemSatirMi(row);
  const odeme = tedarikciCariOdemeSatirMi(row);
  const turEtiket = row.TurEtiket || 'Mal alım';
  let turBadge = kalem ? 'bg-secondary' : 'bg-success';

  const miktar = Number(row.Miktar || 0);
  const satirTutar = Number(row.Tutar || 0);
  let birimSayi = Number(row.BirimFiyat || 0);
  if (birimSayi <= 0 && satirTutar > 0 && miktar > 0) {
    birimSayi = Math.round((satirTutar / miktar) * 100) / 100;
  }
  const birimFmt = birimSayi > 0 ? musteriDetayParaFmt(birimSayi) : '—';
  const tutarStr = `${satirTutar.toFixed(2)} ₺`;

  const ilkSatir = row.GunlukTurBaslikGoster !== false;
  const silTur = odeme ? 'odeme' : 'alim';
  const silId = odeme ? Number(row.KayitID) : Number(row.AnaKayitID || row.KayitID);
  const duzenleBtnAlim =
    ilkSatir && kalem
      ? `<button type="button" class="btn btn-sm btn-warning text-dark me-1" title="Düzenle" onclick="tedarikciHareketDuzenleAc('alim', ${Number(row.AnaKayitID || row.KayitID)})"><i class="fa-solid fa-pencil"></i></button>`
      : '';
  const duzenleBtnOdeme =
    odeme
      ? `<button type="button" class="btn btn-sm btn-warning text-dark me-1" title="Düzenle" onclick="tedarikciHareketDuzenleAc('odeme', ${Number(row.KayitID)})"><i class="fa-solid fa-pencil"></i></button>`
      : '';
  const silBtn = ilkSatir
    ? `<button type="button" class="btn btn-sm btn-outline-danger" onclick="tedarikciHareketSil('${silTur}', ${silId})">Sil</button>`
    : '';
  const islemHucre = `<td class="text-end text-nowrap">${duzenleBtnOdeme}${duzenleBtnAlim}${silBtn || '<span class="text-muted small">—</span>'}</td>`;

  if (kalem) {
    return `<tr class="${gunlukIslemSatirSiniflari(row, ' gunluk-kalem-satir gunluk-mal-alim-kalem')}">
      ${gunlukIslemTarihHucre(row, tarihStr)}
      ${gunlukIslemTurHucre(row, turBadge, turEtiket, '')}
      <td class="gunluk-kalem-urun">${gunlukMetinEsc(row.UrunAdi || '-')}</td>
      <td class="text-center text-nowrap">${miktar}</td>
      <td class="text-end text-nowrap">${birimFmt}</td>
      <td class="text-end text-nowrap gunluk-mal-alim-tutar">${tutarStr}</td>
      ${islemHucre}
    </tr>`;
  }

  return `<tr class="${gunlukIslemSatirSiniflari(row)}">
    ${gunlukIslemTarihHucre(row, tarihStr)}
    ${gunlukIslemTurHucre(row, turBadge, turEtiket, '')}
    <td><span class="text-muted">—</span></td>
    <td class="text-center text-muted">—</td>
    <td class="text-end text-muted">—</td>
    <td class="text-end fw-semibold text-nowrap text-success">${tutarStr}</td>
    ${islemHucre}
  </tr>`;
}

function tedarikciCariHareketTabloHtml(hareketler) {
  const satirlar = gunlukIslemGruplariIsaretle(tedarikciCariListeSatirlari(hareketler));
  return satirlar.map((row) => tedarikciCariTabloSatirHtml(row)).join('');
}

function tedarikciHareketDuzenleTurGoster(tip, h) {
  const alimMi = tip === 'alim';
  const turMetin = alimMi ? 'Mal alım' : 'Ödeme';
  let badgeClass = alimMi ? 'bg-secondary' : 'bg-success';
  let bannerClass = alimMi ? 'alert-secondary' : 'alert-success';
  const aciklama = alimMi
    ? 'Mal alım kalemlerinde adet ve satır tutarını düzenleyebilirsiniz. Stok kaydı varsa otomatik güncellenir.'
    : 'Ödeme türünü ve tutarını düzenleyebilirsiniz. Cari bakiye ve kasa fark kadar ayarlanır.';

  const baslikEl = document.getElementById('thdDuzenleBaslik');
  const badgeEl = document.getElementById('thdDuzenleTurBadge');
  const bannerEl = document.getElementById('thdDuzenleTurBanner');
  const turMetinEl = document.getElementById('thdDuzenleTurMetin');
  const aciklamaEl = document.getElementById('thdDuzenleTurAciklama');
  if (baslikEl) baslikEl.textContent = `${turMetin} Düzenle`;
  if (badgeEl) {
    badgeEl.textContent = turMetin;
    badgeEl.className = `badge ${badgeClass}`;
  }
  if (bannerEl) bannerEl.className = `alert py-2 px-3 mb-3 small ${bannerClass}`;
  if (turMetinEl) turMetinEl.textContent = `${turMetin} işlemi düzenleniyor`;
  if (aciklamaEl) aciklamaEl.textContent = aciklama;
}

async function tedarikciHareketDuzenleAc(tip, kayitID) {
  if (!aktifTedarikciCariID) return;
  const res = await fetch(`/api/tedarikci/${aktifTedarikciCariID}/hareket/${encodeURIComponent(tip)}/${kayitID}/detay`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.message || 'Hareket bilgisi alınamadı.');
    return;
  }
  const h = data.hareket || {};
  const detaylar = data.detaylar || [];
  const unvan = document.getElementById('tedCariUnvan')?.textContent || '-';

  document.getElementById('thdDuzenleKayitID').value = String(kayitID);
  document.getElementById('thdDuzenleTip').value = tip;
  document.getElementById('thdDuzenleUnvan').textContent = unvan;
  document.getElementById('thdDuzenleTarih').textContent = tarihTrGoster(h.Tarih);
  tedarikciHareketDuzenleTurGoster(tip, h);

  const alimAlani = document.getElementById('thdDuzenleAlimAlani');
  const odemeAlani = document.getElementById('thdDuzenleOdemeAlani');
  if (tip === 'alim') {
    alimAlani.classList.remove('d-none');
    odemeAlani.classList.add('d-none');
    const tb = document.getElementById('thdDuzenleAlimGovde');
    if (!detaylar.length) {
      tb.innerHTML = `<tr data-satir-id="0">
        <td>Mal alım</td>
        <td class="text-center"><input type="number" min="1" step="1" class="form-control form-control-sm text-center thd-duzenle-miktar" value="1"></td>
        <td class="text-end"><input type="number" min="0.01" step="0.01" class="form-control form-control-sm text-end thd-duzenle-tutar" value="${Number(h.Tutar || 0).toFixed(2)}"></td>
      </tr>`;
    } else {
      tb.innerHTML = detaylar
        .map(
          (d) => `<tr data-satir-id="${Number(d.SatirID || 0)}">
        <td>${gunlukMetinEsc(d.UrunAdi || '-')}</td>
        <td class="text-center"><input type="number" min="1" step="1" class="form-control form-control-sm text-center thd-duzenle-miktar" value="${Number(d.Miktar || 1)}"></td>
        <td class="text-end"><input type="number" min="0.01" step="0.01" class="form-control form-control-sm text-end thd-duzenle-tutar" value="${Number(d.SatirTutar || 0).toFixed(2)}"></td>
      </tr>`
        )
        .join('');
    }
  } else {
    alimAlani.classList.add('d-none');
    odemeAlani.classList.remove('d-none');
    const odemeEl = document.getElementById('thdDuzenleOdemeSekli');
    const tutarEl = document.getElementById('thdDuzenleTutar');
    if (odemeEl) odemeEl.value = h.OdemeSekli || 'Nakit';
    if (tutarEl) tutarEl.value = Number(h.Tutar || 0).toFixed(2);
  }

  await tedCariModalGeciciKapat();
  modalAc(document.getElementById('tedarikciHareketDuzenleModal'));
}

async function tedarikciHareketDuzenleKaydet() {
  if (!aktifTedarikciCariID) return;
  const kayitID = parseInt(document.getElementById('thdDuzenleKayitID').value, 10);
  const tip = document.getElementById('thdDuzenleTip').value;
  if (!Number.isInteger(kayitID) || kayitID < 1) return;

  let body = { kullanici: aktifKullanici || 'Sistem' };
  if (tip === 'alim') {
    const kalemler = [];
    document.querySelectorAll('#thdDuzenleAlimGovde tr').forEach((tr) => {
      const satirID = parseInt(tr.getAttribute('data-satir-id') || '0', 10);
      const miktarEl = tr.querySelector('.thd-duzenle-miktar');
      const tutarEl = tr.querySelector('.thd-duzenle-tutar');
      kalemler.push({
        satirID: satirID || 0,
        miktar: Number(miktarEl?.value || 0),
        satirTutar: Number(tutarEl?.value || 0),
      });
    });
    body.kalemler = kalemler;
  } else if (tip === 'odeme') {
    body.tutar = Number(document.getElementById('thdDuzenleTutar')?.value || 0);
    body.odemeSekli = document.getElementById('thdDuzenleOdemeSekli')?.value || 'Nakit';
  } else {
    return;
  }

  const res = await fetch(
    `/api/tedarikci/${aktifTedarikciCariID}/hareket/${encodeURIComponent(tip)}/${kayitID}/duzenle`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'Düzenleme kaydedilemedi.');
    return;
  }
  modalKapat(document.getElementById('tedarikciHareketDuzenleModal'));
  alert(data.message || 'Kaydedildi.');
  await tedarikciListele();
  await tedarikciCariIcerikYenile();
  await stoklariGetir();
  await ozetBilgileriniGetir();
}

async function tedarikciCariModalAc(id) {
  aktifTedarikciCariID = id;
  tedCariModalGeriAc = false;
  const cariEl = document.getElementById('tedarikciCariModal');
  await tedarikciCariIcerikYenile();
  if (cariEl) modalAc(cariEl);
}

async function tedarikciCariIcerikYenile() {
  if (!aktifTedarikciCariID) return;
  try {
    const r = await fetch(`/api/tedarikci/${aktifTedarikciCariID}/hareketler`);
    if (!r.ok) throw new Error();
    const data = await r.json();
    const t = data.tedarikci;
    document.getElementById('tedCariUnvan').textContent = t.Unvan || '';
    document.getElementById('tedCariYetkili').textContent = t.YetkiliAdi || '—';
    document.getElementById('tedCariTelefon').textContent = t.Telefon || '—';
    const tb = document.getElementById('tedCariTabloGovde');
    if (!tb) return;
    const har = data.hareketler || [];
    let toplamAlim = 0;
    let toplamOdeme = 0;
    for (const h of har) {
      const tur = String(h.Tur || '').toLowerCase();
      const tut = Number(h.Tutar || 0);
      if (tur === 'alim') toplamAlim += tut;
      if (tur === 'odeme') toplamOdeme += tut;
    }
    if (!har.length) {
      tb.innerHTML = `<tr><td colspan="${TED_CARI_TABLO_KOLON}" class="text-center text-muted">Hareket yok.</td></tr>`;
    } else {
      tb.innerHTML = tedarikciCariHareketTabloHtml(har);
    }
    const oAlim = document.getElementById('tedOzetToplamAlim');
    const oOdeme = document.getElementById('tedOzetToplamOdeme');
    if (oAlim) oAlim.textContent = musteriDetayParaFmt(toplamAlim);
    if (oOdeme) oOdeme.textContent = musteriDetayParaFmt(toplamOdeme);
    document.getElementById('tedCariBakiye').textContent = musteriDetayParaFmt(t.Bakiye);
  } catch (_) {
    alert('Cari listesi yüklenemedi.');
  }
}

async function tedarikciHareketSil(tur, kayitID) {
  if (!aktifTedarikciCariID) return;
  const turRaw = String(tur || '').toLowerCase();
  const onayMetni =
    turRaw === 'alim'
      ? 'Bu mal alımı silinsin mi?\n\nStoktan düşülecek. Ürünlerin bir kısmı satılmışsa stok eksiye inebilir (satışlardaki gibi). Cari, kasa ve günlük kayıt geri alınır.'
      : 'Bu hareket silinsin mi? Cari, kasa, stok ve günlük işlem kaydı geri alınır.';
  if (!confirm(onayMetni)) return;
  const res = await fetch(`/api/tedarikci/${aktifTedarikciCariID}/hareket/${encodeURIComponent(turRaw)}/${Number(kayitID)}?kullanici=${encodeURIComponent(aktifKullanici || 'Sistem')}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    alert(data.message || 'Hareket silinemedi.');
    return;
  }
  alert(data.message || 'Hareket silindi.');
  await tedarikciListele();
  await tedarikciCariIcerikYenile();
  await stoklariGetir();
  await ozetBilgileriniGetir();
}

async function tedarikciCaridenAlimAc() {
  if (!aktifTedarikciCariID) return;
  await tedAlimModalAc(aktifTedarikciCariID);
}

async function tedarikciCaridenOdemeAc() {
  if (!aktifTedarikciCariID) return;
  const odemeEl = document.getElementById('tedarikciOdemeModal');
  await tedAltModalAc(odemeEl, async () => {
    document.getElementById('tedOdemeTedarikciId').value = aktifTedarikciCariID;
    document.getElementById('tedOdemeTutar').value = '';
    document.getElementById('tedOdemeNot').value = '';
    document.getElementById('tedOdemeSekil').value = 'Nakit';
    const t = (tedTedarikciListeCache.length ? tedTedarikciListeCache : await (await fetch('/api/tedarikci')).json()).find(
      (x) => Number(x.TedarikciID) === Number(aktifTedarikciCariID),
    );
    document.getElementById('tedOdemeBaslik').textContent = t
      ? `${t.Unvan} — Güncel borç: ${musteriDetayParaFmt(t.Bakiye)}`
      : '';
  });
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.ted-alim-urun-ara') || e.target.closest('#tedAlimAramaKatman')) return;
  if (e.target.closest('#mdSatisArama') || e.target.closest('#mdSatisAramaKatman')) return;
  tedAlimAramaKatmanKapat();
  musteriSatisAramaKatmanKapat();
});

window.addEventListener(
  'scroll',
  () => {
    if (tedAlimAktifAramaInp) tedAlimAramaKatmanKonumla(tedAlimAktifAramaInp);
    if (mdSatisAktifAramaInp) musteriSatisAramaKatmanKonumla(mdSatisAktifAramaInp);
  },
  true,
);

window.addEventListener('resize', () => {
  if (tedAlimAktifAramaInp) tedAlimAramaKatmanKonumla(tedAlimAktifAramaInp);
  if (mdSatisAktifAramaInp) musteriSatisAramaKatmanKonumla(mdSatisAktifAramaInp);
});

document.getElementById('musteriSatisModal')?.addEventListener('hidden.bs.modal', () => {
  musteriSatisAramaKatmanKapat();
});

document.getElementById('tedarikciAlimModal')?.addEventListener('hidden.bs.modal', () => {
  tedAlimAramaKatmanKapat();
  tedCariModalGeriAcPlanla();
  if (aktifTedarikciCariID) tedarikciCariIcerikYenile();
});

document.getElementById('tedarikciOdemeModal')?.addEventListener('hidden.bs.modal', () => {
  tedCariModalGeriAcPlanla();
  if (aktifTedarikciCariID) tedarikciCariIcerikYenile();
});

document.getElementById('tedarikciCariModal')?.addEventListener('hidden.bs.modal', () => {
  if (tedCariModalGeriAc) return;
});

document.getElementById('tedarikciHareketDuzenleModal')?.addEventListener('hidden.bs.modal', () => {
  tedCariModalGeriAcPlanla();
  if (aktifTedarikciCariID) tedarikciCariIcerikYenile();
});

document.getElementById('giderListeModal')?.addEventListener('hidden.bs.modal', () => {
  if (giderListeModalGeriAc) return;
});

document.getElementById('genelGiderDuzenleModal')?.addEventListener('hidden.bs.modal', () => {
  giderListeModalGeriAcPlanla();
});

document.getElementById('musteriDetayModal')?.addEventListener('hidden.bs.modal', () => {
  if (musteriDetayModalGeriAc) {
    // Alt modal (tahsilat, satış, düzenle vb.) açıldı — geri dönüş alt modal kapanınca yapılır
    return;
  }
  const listeGeriAc = musteriListeModalGeriAc;
  musteriListeModalGeriAc = false;
  modalArtigiTemizle();
  if (listeGeriAc) {
    setTimeout(() => {
      modalArtigiTemizle();
      musterileriGetir();
      modalAc(document.getElementById('musteriListeModal'));
    }, 100);
  }
});

document.getElementById('musteriDetayModal')?.addEventListener('shown.bs.modal', () => {
  musteriDetayModalGeriAc = false;
});

['musteriTahsilatModal', 'musteriSatisModal', 'musteriIadeModal', 'musteriDuzenleModal', 'musteriTaksitModal', 'musteriHareketDetayModal', 'musteriHareketDuzenleModal'].forEach((id) => {
  document.getElementById(id)?.addEventListener('hidden.bs.modal', () => {
    musteriDetayModalGeriAcPlanla();
  });
});

document.getElementById('musteriRaporlarModal')?.addEventListener('hidden.bs.modal', () => {
  const detayGeriAcilacak = musteriDetayModalGeriAc;
  musteriDetayModalGeriAcPlanla();
  if (!detayGeriAcilacak && musteriListeModalGeriAc) {
    musteriListeModalGeriAc = false;
    setTimeout(() => {
      modalArtigiTemizle();
      modalAc(document.getElementById('musteriListeModal'));
    }, 100);
  }
});

['teklifDuzenleModal', 'teklifCariyeEkleModal'].forEach((id) => {
  document.getElementById(id)?.addEventListener('hidden.bs.modal', () => {
    teklifModalGeriAcPlanla();
  });
});

document.getElementById('teklifModal')?.addEventListener('hidden.bs.modal', () => {
  musteriDetayModalGeriAcPlanla();
});

document.getElementById('stokEkleModal')?.addEventListener('hidden.bs.modal', () => {
  if (tedAlimStokEkleDonus) {
    tedAlimStokEkleDonusYap();
    return;
  }
  if (musteriSatisStokEkleDonus) {
    musteriSatisStokEkleDonus = false;
    musteriSatisStokEkleSonKayit = null;
    setTimeout(() => document.getElementById('mdSatisArama')?.focus(), 200);
    return;
  }
  if (stokListeModalGeriAc) {
    stokListeModalGeriAc = false;
    setTimeout(() => {
      modalArtigiTemizle();
      const listeEl = document.getElementById('stokListeModal');
      if (listeEl) modalAc(listeEl);
    }, 100);
  } else {
    modalArtigiTemizle();
  }
});

document.getElementById('gunlukIslemDetayModal')?.addEventListener('hidden.bs.modal', () => {
  if (gunlukIslemModalGeriAc) {
    gunlukIslemModalGeriAc = false;
    setTimeout(() => {
      modalArtigiTemizle();
      const listeEl = document.getElementById('gunlukIslemModal');
      if (listeEl) bootstrap.Modal.getOrCreateInstance(listeEl).show();
    }, 100);
  } else {
    modalArtigiTemizle();
  }
});

let teklifListeCache = [];
let teklifModalMusteriFiltreID = null;
let teklifUrunCache = [];
let teklifDuzenleUrunCache = [];
let teklifCariStokCache = [];
let teklifCariSatirlar = [];

function teklifMusteriKimlikNo(t) {
  if (!t || !t.MusteriID) return { tip: '', no: '' };
  if (musteriTurDeger({ tur: t.tur }) === 'Tuzel') {
    return { tip: 'Vergi No', no: String(t.vergino || '').trim() };
  }
  return { tip: 'T.C. Kimlik No', no: String(t.tcno || '').trim() };
}

function teklifMusteriKimlikMetin(t) {
  const k = teklifMusteriKimlikNo(t);
  return k.no ? `${k.tip}: ${k.no}` : '';
}

function teklifDurumBadge(durum, cariHareketID) {
  if (cariHareketID) return '<span class="badge bg-success">Cariye eklendi</span>';
  const d = String(durum || 'Hazırlandı').trim();
  if (d === 'Kabul') return '<span class="badge bg-primary">Kabul</span>';
  if (d === 'Reddedildi') return '<span class="badge bg-danger">Reddedildi</span>';
  if (d === 'Cariye Eklendi') return '<span class="badge bg-success">Cariye eklendi</span>';
  return '<span class="badge bg-secondary">Hazırlandı</span>';
}

function teklifSayi(v) {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  let temiz = s.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  const sonVirgul = temiz.lastIndexOf(',');
  const sonNokta = temiz.lastIndexOf('.');
  if (sonVirgul >= 0 && sonNokta >= 0) {
    if (sonVirgul > sonNokta) {
      temiz = temiz.replace(/\./g, '').replace(',', '.');
    } else {
      temiz = temiz.replace(/,/g, '');
    }
  } else if (sonVirgul >= 0) {
    temiz = temiz.replace(/\./g, '').replace(',', '.');
  } else {
    temiz = temiz.replace(/,/g, '');
  }
  const n = Number(temiz);
  return Number.isFinite(n) ? n : 0;
}

function teklifYontemDegisti() {
  const y = document.getElementById('teklifYontem')?.value || 'Toplu';
  const toplu = document.getElementById('teklifTopluAlan');
  const kalem = document.getElementById('teklifKalemAlan');
  const fiyatBaslik = document.getElementById('teklifFiyatBaslik');
  if (!toplu || !kalem) return;
  const kalemMi = y === 'Kalem';
  toplu.style.display = kalemMi ? 'none' : '';
  kalem.style.display = kalemMi ? '' : 'none';
  if (fiyatBaslik) fiyatBaslik.style.display = '';
  document.querySelectorAll('.teklif-kalem-fiyat-td').forEach((td) => {
    td.style.display = '';
    const inp = td.querySelector('.teklif-kalem-fiyat');
    if (inp) inp.readOnly = !kalemMi;
  });
  teklifKalemToplamHesapla();
}

function teklifKalemEkle(kalem = {}) {
  const tb = document.getElementById('teklifKalemGovde');
  if (!tb) return;
  tb.insertAdjacentHTML('beforeend', `
    <tr>
      <td><input type="text" class="form-control form-control-sm teklif-kalem-urun" list="teklifUrunDatalist" value="${gunlukMetinEsc(kalem.urunAdi || '')}" placeholder="Ürün ara / yaz"></td>
      <td><input type="number" step="0.01" min="0" class="form-control form-control-sm teklif-kalem-miktar" value="${Number(kalem.miktar || 1)}" oninput="teklifKalemToplamHesapla()"></td>
      <td><input type="text" class="form-control form-control-sm teklif-kalem-birim" value="${gunlukMetinEsc(kalem.birim || 'Adet')}"></td>
      <td class="teklif-kalem-fiyat-td"><input type="number" step="0.01" min="0" class="form-control form-control-sm teklif-kalem-fiyat" value="${Number(kalem.birimFiyat || 0)}" oninput="teklifKalemToplamHesapla()"></td>
      <td><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove();teklifKalemToplamHesapla();"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`);
  teklifKalemToplamHesapla();
  teklifYontemDegisti();
  const son = tb.lastElementChild;
  const urunInp = son?.querySelector('.teklif-kalem-urun');
  if (urunInp) {
    urunInp.addEventListener('change', () => teklifKalemSatiriniUrunleDoldur(urunInp));
    urunInp.addEventListener('blur', () => teklifKalemSatiriniUrunleDoldur(urunInp));
  }
}

function teklifKalemleriOku() {
  const yontem = document.getElementById('teklifYontem')?.value || 'Toplu';
  return Array.from(document.querySelectorAll('#teklifKalemGovde tr')).map((tr) => {
    const urunAdi = tr.querySelector('.teklif-kalem-urun')?.value?.trim() || '';
    const miktar = teklifSayi(tr.querySelector('.teklif-kalem-miktar')?.value || 0);
    const birim = tr.querySelector('.teklif-kalem-birim')?.value?.trim() || 'Adet';
    const birimFiyat = yontem === 'Kalem' ? teklifSayi(tr.querySelector('.teklif-kalem-fiyat')?.value || 0) : teklifSayi(tr.querySelector('.teklif-kalem-fiyat')?.value || 0);
    const satirTutar = Math.round((miktar * birimFiyat) * 100) / 100;
    return { urunAdi, miktar, birim, birimFiyat, satirTutar };
  }).filter((x) => x.urunAdi && Number.isFinite(x.miktar) && x.miktar > 0 && Number.isFinite(x.birimFiyat) && x.birimFiyat >= 0);
}

function teklifKalemToplamHesapla() {
  const toplam = teklifKalemleriOku().reduce((a, k) => a + Number(k.satirTutar || 0), 0);
  const el = document.getElementById('teklifKalemToplam');
  if (el) el.textContent = paraTr(toplam);
  const st = document.getElementById('teklifSistemToplam');
  if (st) st.textContent = paraTr(toplam);
  return toplam;
}

function teklifUrunBul(ad) {
  const q = String(ad || '').trim().toLocaleLowerCase('tr-TR');
  if (!q) return null;
  return (teklifUrunCache || []).find((u) => String(u.UrunAdi || '').trim().toLocaleLowerCase('tr-TR') === q) || null;
}

function teklifKalemSatiriniUrunleDoldur(urunInputEl) {
  const tr = urunInputEl?.closest('tr');
  if (!tr) return;
  const urun = teklifUrunBul(urunInputEl.value);
  if (!urun) return;
  const birimInp = tr.querySelector('.teklif-kalem-birim');
  const fiyatInp = tr.querySelector('.teklif-kalem-fiyat');
  if (birimInp && !String(birimInp.value || '').trim()) birimInp.value = String(urun.Birim || 'Adet');
  if (fiyatInp) {
    const mevcut = Number(fiyatInp.value || 0);
    if (!Number.isFinite(mevcut) || mevcut <= 0 || fiyatInp.readOnly) {
      fiyatInp.value = Number(urun.SatisFiyati || 0).toFixed(2);
    }
  }
  teklifKalemToplamHesapla();
}

function teklifFormTemizle() {
  document.getElementById('teklifBaslik').value = '';
  document.getElementById('teklifYontem').value = 'Toplu';
  document.getElementById('teklifToplam').value = '';
  document.getElementById('teklifAciklama').value = '';
  document.getElementById('teklifKalemGovde').innerHTML = '';
  teklifKalemEkle();
  teklifYontemDegisti();
}

async function teklifUrunleriHazirla() {
  try {
    if (!Array.isArray(stokListeCache) || !stokListeCache.length) {
      await stoklariGetir();
    }
    teklifUrunCache = Array.isArray(stokListeCache) ? stokListeCache : [];
    const dl = document.getElementById('teklifUrunDatalist');
    if (!dl) return;
    const adlar = [...new Set(teklifUrunCache.map((u) => String(u.UrunAdi || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    dl.innerHTML = adlar.map((ad) => `<option value="${gunlukMetinEsc(ad)}"></option>`).join('');
  } catch (e) {
    console.error(e);
  }
}

async function teklifModalAc(secilenMusteriID = null) {
  await musteriAltModalAc(document.getElementById('teklifModal'), async () => {
    await musterileriGetir();
    await teklifUrunleriHazirla();
    teklifModalMusteriFiltreID = Number.isFinite(Number(secilenMusteriID)) && Number(secilenMusteriID) > 0
      ? Number(secilenMusteriID)
      : null;
    const sel = document.getElementById('teklifMusteri');
    if (sel) {
      const must = Array.isArray(window._musteriListeCache) ? window._musteriListeCache : [];
      sel.innerHTML = '<option value="">Müşteri seçiniz</option>' + must
        .map((m) => `<option value="${Number(m.MusteriID)}">${gunlukMetinEsc(musteriGorunenAd(m))}</option>`)
        .join('');
      if (teklifModalMusteriFiltreID) sel.value = String(teklifModalMusteriFiltreID);
    }
    teklifFormTemizle();
    const bugun = new Date();
    const once = new Date();
    once.setMonth(once.getMonth() - 1);
    const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    document.getElementById('teklifBaslangic').value = toYmd(once);
    document.getElementById('teklifBitis').value = toYmd(bugun);
    await teklifleriYukle();
  });
}

async function teklifKaydet(event) {
  event.preventDefault();
  const musteriID = Number(document.getElementById('teklifMusteri').value || 0);
  const musteriAdi = document.getElementById('teklifMusteri').selectedOptions?.[0]?.textContent || '';
  const yontem = document.getElementById('teklifYontem').value;
  const kalemler = teklifKalemleriOku();
  if (!kalemler.length) {
    alert('En az bir malzeme kalemi girin.');
    return;
  }
  const toplamTutar = yontem === 'Kalem'
    ? teklifKalemToplamHesapla()
    : teklifSayi(document.getElementById('teklifToplam').value || 0);
  const body = {
    musteriID: Number.isFinite(musteriID) && musteriID > 0 ? musteriID : null,
    musteriAdi: musteriID > 0 ? musteriAdi : null,
    baslik: document.getElementById('teklifBaslik').value.trim(),
    yontem,
    toplamTutar,
    kalemler,
    aciklama: document.getElementById('teklifAciklama').value.trim(),
    kullanici: aktifKullanici || 'Sistem',
  };
  try {
    const res = await fetch('/api/teklif', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Teklif kaydedilemedi.');
      return;
    }
    alert(data.message || 'Teklif kaydedildi.');
    teklifFormTemizle();
    await teklifleriYukle();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function teklifleriYukle() {
  const tb = document.getElementById('teklifTabloGovde');
  if (!tb) return;
  tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Yükleniyor…</td></tr>';
  try {
    const bas = document.getElementById('teklifBaslangic')?.value || '';
    const bit = document.getElementById('teklifBitis')?.value || '';
    const q = new URLSearchParams();
    if (bas && bit) {
      q.set('baslangic', bas);
      q.set('bitis', bit);
    }
    if (teklifModalMusteriFiltreID) q.set('musteriID', String(teklifModalMusteriFiltreID));
    const res = await fetch(`/api/teklif?${q.toString()}`);
    const rows = await res.json().catch(() => []);
    teklifListeCache = Array.isArray(rows) ? rows : [];
    if (!teklifListeCache.length) {
      tb.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Teklif bulunamadı.</td></tr>';
      return;
    }
    tb.innerHTML = teklifListeCache.map((t) => {
      const tarih = tarihTrGoster(t.Tarih);
      const tid = Number(t.TeklifID);
      const mid = Number(t.MusteriID || 0);
      const cariyeEklendi = !!t.CariHareketID;
      const durum = String(t.Durum || '').trim();
      const kabulBtn = !cariyeEklendi && durum !== 'Kabul'
        ? `<button class="btn btn-sm btn-outline-primary" onclick="teklifDurumAyarla(${tid},'Kabul')" title="Müşteri kabul etti"><i class="fa-solid fa-check"></i></button>`
        : '';
      const cariBtn = !cariyeEklendi && durum === 'Kabul' && mid > 0
        ? `<button class="btn btn-sm btn-success" onclick="teklifCariyeEkleModalAc(${tid})" title="Cariye satış ekle"><i class="fa-solid fa-cart-plus"></i></button>`
        : '';
      const redBtn = !cariyeEklendi && durum !== 'Reddedildi' && durum !== 'Kabul'
        ? `<button class="btn btn-sm btn-outline-danger" onclick="teklifDurumAyarla(${tid},'Reddedildi')" title="Reddedildi"><i class="fa-solid fa-xmark"></i></button>`
        : '';
      return `<tr>
        <td class="small text-nowrap">${gunlukMetinEsc(tarih)}</td>
        <td>${gunlukMetinEsc(t.MusteriAdi || 'Genel teklif')}</td>
        <td>${teklifDurumBadge(t.Durum, t.CariHareketID)}</td>
        <td><span class="badge ${String(t.Yontem) === 'Kalem' ? 'bg-info text-dark' : 'bg-secondary'}">${gunlukMetinEsc(t.Yontem || '-')}</span></td>
        <td class="text-end fw-semibold">${paraTr(Number(t.ToplamTutar || 0))}</td>
        <td class="text-end text-nowrap">
          ${kabulBtn}${cariBtn}
          <button class="btn btn-sm btn-outline-secondary" onclick="teklifDuzenlemeModalAc(${tid})" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
          <button class="btn btn-sm btn-outline-primary" onclick="teklifYazdir(${tid})" title="Yazdır"><i class="fa-solid fa-print"></i></button>
          ${redBtn}
          <button class="btn btn-sm btn-outline-danger" onclick="teklifSil(${tid})" title="Sil"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.error(e);
    tb.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-3">Teklif listesi alınamadı.</td></tr>';
  }
}

async function teklifDurumAyarla(teklifID, durum) {
  const etiket = durum === 'Kabul' ? 'Kabul' : durum === 'Reddedildi' ? 'Reddedildi' : durum;
  if (durum === 'Kabul' && !confirm('Teklif müşteri tarafından kabul edildi olarak işaretlensin mi?')) return;
  if (durum === 'Reddedildi' && !confirm('Teklif reddedildi olarak işaretlensin mi?')) return;
  try {
    const res = await fetch(`/api/teklif/${Number(teklifID)}/durum`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durum: etiket, kullanici: aktifKullanici || 'Sistem' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Durum güncellenemedi.');
      return;
    }
    await teklifleriYukle();
    if (durum === 'Kabul') {
      const row = teklifListeCache.find((t) => Number(t.TeklifID) === Number(teklifID));
      if (row && Number(row.MusteriID) > 0 && !row.CariHareketID) {
        if (confirm('Teklif kabul edildi. Şimdi cariye satış olarak eklemek ister misiniz?')) {
          teklifCariyeEkleModalAc(teklifID);
        }
      }
    }
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

function teklifStokBulUrunAdi(ad) {
  const q = String(ad || '').trim().toLocaleLowerCase('tr-TR');
  if (!q) return null;
  return (teklifCariStokCache || []).find((u) => String(u.UrunAdi || '').trim().toLocaleLowerCase('tr-TR') === q) || null;
}

function teklifCariBirimFiyatlariHesapla(teklif, kalemler) {
  const yontem = String(teklif.Yontem || 'Toplu');
  const toplamTeklif = Number(teklif.ToplamTutar || 0);
  if (yontem === 'Kalem') {
    return kalemler.map((k) => ({
      urunAdi: k.UrunAdi,
      miktar: Math.max(1, Math.round(Number(k.Miktar || 1))),
      birimFiyat: Number(k.BirimFiyat || 0),
    }));
  }
  const kalemToplam = kalemler.reduce((a, k) => a + Number(k.BirimFiyat || 0) * Number(k.Miktar || 0), 0);
  if (kalemToplam > 0) {
    return kalemler.map((k) => ({
      urunAdi: k.UrunAdi,
      miktar: Math.max(1, Math.round(Number(k.Miktar || 1))),
      birimFiyat: Number(k.BirimFiyat || 0),
    }));
  }
  const satirlar = kalemler.map((k) => ({
    urunAdi: k.UrunAdi,
    miktar: Math.max(1, Math.round(Number(k.Miktar || 1))),
    birimFiyat: 0,
  }));
  const miktarTop = satirlar.reduce((a, s) => a + s.miktar, 0);
  if (miktarTop <= 0 || toplamTeklif <= 0) {
    return satirlar;
  }
  const birimOrt = Math.round((toplamTeklif / miktarTop) * 100) / 100;
  return satirlar.map((s) => ({ ...s, birimFiyat: birimOrt }));
}

function teklifCariSatirCiz() {
  const tb = document.getElementById('teklifCariKalemGovde');
  if (!tb) return;
  if (!teklifCariSatirlar.length) {
    tb.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Kalem yok</td></tr>';
    return;
  }
  tb.innerHTML = teklifCariSatirlar.map((s, i) => {
    const stokUyari = s.stokID ? '' : ' <span class="badge bg-warning text-dark">Stokta yok</span>';
    const satirTutar = Math.round(s.miktar * s.birimFiyat * 100) / 100;
    return `<tr data-idx="${i}">
      <td>${gunlukMetinEsc(s.urunAdi)}${stokUyari}</td>
      <td><input type="number" step="1" min="1" class="form-control form-control-sm teklif-cari-miktar" value="${s.miktar}" data-idx="${i}"></td>
      <td><input type="number" step="0.01" min="0" class="form-control form-control-sm teklif-cari-fiyat" value="${Number(s.birimFiyat).toFixed(2)}" data-idx="${i}"></td>
      <td class="text-end teklif-cari-satir-tutar">${paraTr(satirTutar)}</td>
    </tr>`;
  }).join('');
  tb.querySelectorAll('.teklif-cari-miktar, .teklif-cari-fiyat').forEach((inp) => {
    inp.addEventListener('input', teklifCariSatirGuncelle);
  });
  teklifCariToplamGuncelle();
}

function teklifCariSatirGuncelle(ev) {
  const idx = Number(ev.target?.dataset?.idx);
  if (!Number.isFinite(idx) || !teklifCariSatirlar[idx]) return;
  const tr = ev.target.closest('tr');
  const miktar = Math.max(1, Math.round(teklifSayi(tr?.querySelector('.teklif-cari-miktar')?.value || 1)));
  const birimFiyat = Math.max(0, teklifSayi(tr?.querySelector('.teklif-cari-fiyat')?.value || 0));
  teklifCariSatirlar[idx].miktar = miktar;
  teklifCariSatirlar[idx].birimFiyat = birimFiyat;
  const satirEl = tr?.querySelector('.teklif-cari-satir-tutar');
  if (satirEl) satirEl.textContent = paraTr(Math.round(miktar * birimFiyat * 100) / 100);
  teklifCariToplamGuncelle();
}

function teklifCariToplamGuncelle() {
  const toplam = teklifCariSatirlar.reduce((a, s) => a + s.miktar * s.birimFiyat, 0);
  const el = document.getElementById('teklifCariToplam');
  if (el) el.textContent = paraTr(Math.round(toplam * 100) / 100);
}

async function teklifCariyeEkleModalAc(teklifID) {
  try {
    if (!Array.isArray(stokListeCache) || !stokListeCache.length) await stoklariGetir();
    teklifCariStokCache = Array.isArray(stokListeCache) ? stokListeCache : [];
    const res = await fetch(`/api/teklif/${Number(teklifID)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.teklif) {
      alert(data.message || 'Teklif detayı alınamadı.');
      return;
    }
    const t = data.teklif;
    const kalemler = Array.isArray(data.kalemler) ? data.kalemler : [];
    const mid = Number(t.MusteriID || 0);
    if (!mid) {
      alert('Bu teklifte müşteri yok. Önce müşteri seçerek teklifi düzenleyin.');
      return;
    }
    if (t.CariHareketID) {
      alert('Bu teklif zaten cariye eklenmiş.');
      return;
    }
    if (String(t.Durum || '').trim() !== 'Kabul') {
      alert('Önce teklifi “Kabul” olarak işaretleyin (✓ düğmesi).');
      return;
    }
    if (!kalemler.length) {
      alert('Teklifte kalem yok.');
      return;
    }
    const fiyatli = teklifCariBirimFiyatlariHesapla(t, kalemler);
    teklifCariSatirlar = fiyatli.map((k) => {
      const stok = teklifStokBulUrunAdi(k.urunAdi);
      return {
        urunAdi: k.urunAdi,
        stokID: stok ? Number(stok.StokID) : null,
        miktar: Math.max(1, Math.round(Number(k.miktar || 1))),
        birimFiyat: Number(k.birimFiyat || 0) || Number(stok?.SatisFiyati || 0),
      };
    });
    const eksik = teklifCariSatirlar.filter((s) => !s.stokID);
    if (eksik.length) {
      alert(`Stokta eşleşmeyen ürünler var (${eksik.map((e) => e.urunAdi).join(', ')}). Stok kartındaki ürün adı teklifle aynı olmalı.`);
      return;
    }
    document.getElementById('teklifCariTeklifID').value = Number(t.TeklifID);
    document.getElementById('teklifCariMusteriID').value = mid;
    const ozet = document.getElementById('teklifCariOzet');
    if (ozet) {
      ozet.textContent = `${t.MusteriAdi || 'Müşteri'} — Teklif #${t.TeklifID}${t.Baslik ? ` (${t.Baslik})` : ''}`;
    }
    teklifCariSatirCiz();
    await teklifAltModalAc(document.getElementById('teklifCariyeEkleModal'));
  } catch (e) {
    console.error(e);
    alert('Cariye ekleme ekranı açılamadı.');
  }
}

async function teklifCariyeEkleKaydet() {
  const teklifID = Number(document.getElementById('teklifCariTeklifID')?.value || 0);
  const musteriID = Number(document.getElementById('teklifCariMusteriID')?.value || 0);
  if (!teklifID || !musteriID) return;
  const tb = document.getElementById('teklifCariKalemGovde');
  const satirlar = [];
  tb?.querySelectorAll('tr[data-idx]').forEach((tr) => {
    const idx = Number(tr.dataset.idx);
    const kaynak = teklifCariSatirlar[idx];
    if (!kaynak?.stokID) return;
    const miktar = Math.max(1, Math.round(teklifSayi(tr.querySelector('.teklif-cari-miktar')?.value || 0)));
    const birimFiyat = Math.max(0, teklifSayi(tr.querySelector('.teklif-cari-fiyat')?.value || 0));
    satirlar.push({ stokID: kaynak.stokID, miktar, birimFiyat });
  });
  if (!satirlar.length) {
    alert('Geçerli satır yok.');
    return;
  }
  const toplam = satirlar.reduce((a, s) => a + s.miktar * s.birimFiyat, 0);
  if (!confirm(`Toplam ${paraTr(toplam)} tutarında satış müşteri carisine eklensin mi?`)) return;
  try {
    const res = await fetch(`/api/teklif/${teklifID}/cariye-ekle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kalemler: satirlar, kullanici: aktifKullanici || 'Sistem' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Cariye eklenemedi.');
      return;
    }
    modalKapat(document.getElementById('teklifCariyeEkleModal'));
    await teklifleriYukle();
    alert(data.message || 'Cariye eklendi.');
    if (Number(aktifMusteriDetayID) === musteriID) {
      await musteriDetayYukle();
      musterileriGetir();
    }
    stoklariGetir();
    ozetBilgileriniGetir();
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function teklifSil(teklifID) {
  if (!confirm('Teklif silinsin mi?')) return;
  try {
    const res = await fetch(`/api/teklif/${Number(teklifID)}?kullanici=${encodeURIComponent(aktifKullanici || 'Sistem')}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Teklif silinemedi.');
      return;
    }
    await teklifleriYukle();
    alert(data.message || 'Teklif silindi.');
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

function teklifDuzenleYontemDegisti() {
  const kalemMi = (document.getElementById('teklifDuzenleYontem')?.value || 'Toplu') === 'Kalem';
  document.querySelectorAll('.teklif-duz-fiyat').forEach((x) => { x.readOnly = !kalemMi; });
  const toplu = document.getElementById('teklifDuzenleTopluAlan');
  if (toplu) toplu.style.display = kalemMi ? 'none' : '';
  teklifDuzenleToplamHesapla();
}

function teklifDuzenleKalemleriOku() {
  const y = document.getElementById('teklifDuzenleYontem')?.value || 'Toplu';
  return Array.from(document.querySelectorAll('#teklifDuzenleKalemGovde tr')).map((tr) => {
    const urunAdi = tr.querySelector('.teklif-duz-urun')?.value?.trim() || '';
    const miktar = teklifSayi(tr.querySelector('.teklif-duz-miktar')?.value || 0);
    const birim = tr.querySelector('.teklif-duz-birim')?.value?.trim() || 'Adet';
    const birimFiyat = teklifSayi(tr.querySelector('.teklif-duz-fiyat')?.value || 0);
    const satirTutar = Math.round((miktar * birimFiyat) * 100) / 100;
    return { urunAdi, miktar, birim, birimFiyat: y === 'Kalem' ? birimFiyat : birimFiyat, satirTutar };
  }).filter((x) => x.urunAdi && x.miktar > 0 && Number.isFinite(x.birimFiyat) && x.birimFiyat >= 0);
}

function teklifDuzenleToplamHesapla() {
  const toplam = teklifDuzenleKalemleriOku().reduce((a, k) => a + Number(k.satirTutar || 0), 0);
  const el = document.getElementById('teklifDuzenleSistemToplam');
  if (el) el.textContent = paraTr(toplam);
  return toplam;
}

function teklifDuzenleUrunBul(ad) {
  const q = String(ad || '').trim().toLocaleLowerCase('tr-TR');
  if (!q) return null;
  return (teklifDuzenleUrunCache || []).find((u) => String(u.UrunAdi || '').trim().toLocaleLowerCase('tr-TR') === q) || null;
}

function teklifDuzenleSatirUrunDoldur(inputEl) {
  const tr = inputEl?.closest('tr');
  if (!tr) return;
  const urun = teklifDuzenleUrunBul(inputEl.value);
  if (!urun) return;
  const birim = tr.querySelector('.teklif-duz-birim');
  const fiyat = tr.querySelector('.teklif-duz-fiyat');
  if (birim && !String(birim.value || '').trim()) birim.value = String(urun.Birim || 'Adet');
  if (fiyat) {
    const mevcut = teklifSayi(fiyat.value || 0);
    if (!mevcut || fiyat.readOnly) fiyat.value = Number(urun.SatisFiyati || 0).toFixed(2);
  }
  teklifDuzenleToplamHesapla();
}

function teklifDuzenleKalemEkle(k = {}) {
  const tb = document.getElementById('teklifDuzenleKalemGovde');
  if (!tb) return;
  tb.insertAdjacentHTML('beforeend', `
    <tr>
      <td><input type="text" class="form-control form-control-sm teklif-duz-urun" list="teklifDuzenleUrunDatalist" value="${gunlukMetinEsc(k.urunAdi || '')}" placeholder="Ürün ara / yaz"></td>
      <td><input type="number" step="0.01" min="0" class="form-control form-control-sm teklif-duz-miktar" value="${Number(k.miktar || 1)}" oninput="teklifDuzenleToplamHesapla()"></td>
      <td><input type="text" class="form-control form-control-sm teklif-duz-birim" value="${gunlukMetinEsc(k.birim || 'Adet')}"></td>
      <td><input type="number" step="0.01" min="0" class="form-control form-control-sm teklif-duz-fiyat" value="${Number(k.birimFiyat || 0)}" oninput="teklifDuzenleToplamHesapla()"></td>
      <td><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove();teklifDuzenleToplamHesapla();"><i class="fa-solid fa-xmark"></i></button></td>
    </tr>`);
  const son = tb.lastElementChild;
  const urunInp = son?.querySelector('.teklif-duz-urun');
  if (urunInp) {
    urunInp.addEventListener('change', () => teklifDuzenleSatirUrunDoldur(urunInp));
    urunInp.addEventListener('blur', () => teklifDuzenleSatirUrunDoldur(urunInp));
  }
  teklifDuzenleYontemDegisti();
}

async function teklifDuzenlemeModalAc(teklifID) {
  try {
    await musterileriGetir();
    if (!Array.isArray(stokListeCache) || !stokListeCache.length) await stoklariGetir();
    teklifDuzenleUrunCache = Array.isArray(stokListeCache) ? stokListeCache : [];
    const dl = document.getElementById('teklifDuzenleUrunDatalist');
    if (dl) {
      const adlar = [...new Set(teklifDuzenleUrunCache.map((u) => String(u.UrunAdi || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
      dl.innerHTML = adlar.map((ad) => `<option value="${gunlukMetinEsc(ad)}"></option>`).join('');
    }
    const sel = document.getElementById('teklifDuzenleMusteri');
    if (sel) {
      const must = Array.isArray(window._musteriListeCache) ? window._musteriListeCache : [];
      sel.innerHTML = '<option value="">Müşteri seçiniz</option>' + must
        .map((m) => `<option value="${Number(m.MusteriID)}">${gunlukMetinEsc(musteriGorunenAd(m))}</option>`)
        .join('');
    }
    const res = await fetch(`/api/teklif/${Number(teklifID)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.teklif) {
      alert(data.message || 'Teklif detayı alınamadı.');
      return;
    }
    const t = data.teklif;
    const kal = Array.isArray(data.kalemler) ? data.kalemler : [];
    document.getElementById('teklifDuzenleID').value = Number(t.TeklifID);
    document.getElementById('teklifDuzenleMusteri').value = t.MusteriID ? String(t.MusteriID) : '';
    document.getElementById('teklifDuzenleBaslik').value = t.Baslik || '';
    document.getElementById('teklifDuzenleYontem').value = t.Yontem || 'Toplu';
    document.getElementById('teklifDuzenleToplam').value = Number(t.ToplamTutar || 0);
    document.getElementById('teklifDuzenleAciklama').value = t.Aciklama || '';
    const tb = document.getElementById('teklifDuzenleKalemGovde');
    tb.innerHTML = '';
    if (!kal.length) teklifDuzenleKalemEkle();
    else kal.forEach((k) => teklifDuzenleKalemEkle({
      urunAdi: k.UrunAdi,
      miktar: Number(k.Miktar || 1),
      birim: k.Birim || 'Adet',
      birimFiyat: Number(k.BirimFiyat || 0),
    }));
    teklifDuzenleYontemDegisti();
    await teklifAltModalAc(document.getElementById('teklifDuzenleModal'));
  } catch (e) {
    console.error(e);
    alert('Düzenleme ekranı açılamadı.');
  }
}

async function teklifDuzenlemeKaydet(event) {
  event.preventDefault();
  const teklifID = Number(document.getElementById('teklifDuzenleID').value || 0);
  const musteriID = Number(document.getElementById('teklifDuzenleMusteri').value || 0);
  const musteriAdi = document.getElementById('teklifDuzenleMusteri').selectedOptions?.[0]?.textContent || '';
  const yontem = document.getElementById('teklifDuzenleYontem').value || 'Toplu';
  const kalemler = teklifDuzenleKalemleriOku();
  if (!kalemler.length) return alert('En az bir malzeme kalemi girin.');
  const toplamTutar = yontem === 'Kalem'
    ? teklifDuzenleToplamHesapla()
    : teklifSayi(document.getElementById('teklifDuzenleToplam').value || 0);
  const body = {
    musteriID: Number.isFinite(musteriID) && musteriID > 0 ? musteriID : null,
    musteriAdi: musteriID > 0 ? musteriAdi : null,
    baslik: document.getElementById('teklifDuzenleBaslik').value.trim(),
    yontem,
    toplamTutar,
    kalemler,
    aciklama: document.getElementById('teklifDuzenleAciklama').value.trim(),
    kullanici: aktifKullanici || 'Sistem',
  };
  try {
    const res = await fetch(`/api/teklif/${teklifID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      alert(data.message || 'Teklif güncellenemedi.');
      return;
    }
    modalKapat(document.getElementById('teklifDuzenleModal'));
    await teklifleriYukle();
    alert(data.message || 'Teklif güncellendi.');
  } catch (e) {
    console.error(e);
    alert('Sunucu hatası.');
  }
}

async function teklifYazdir(teklifID) {
  try {
    const res = await fetch(`/api/teklif/${Number(teklifID)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.teklif) {
      alert(data.message || 'Teklif detayı alınamadı.');
      return;
    }
    const t = data.teklif;
    const kalemler = Array.isArray(data.kalemler) ? data.kalemler : [];
    const d = tarihTrGoster(t.Tarih);
    const sirketUnvan = String(uygulamaAyarlari?.SirketUnvan || 'İşletme Ünvanı');
    const sirketYetkili = String(uygulamaAyarlari?.SirketYetkiliAdSoyad || '').trim();
    const sirketVergi = String(uygulamaAyarlari?.SirketVergiNo || '').trim();
    const sirketTel = String(uygulamaAyarlari?.SirketTelefon || '').trim();
    const sirketAdres = String(uygulamaAyarlari?.SirketAdres || '').trim();
    const musteriKimlik = teklifMusteriKimlikMetin(t);
    const html = `
      <html><head><meta charset="utf-8"><title>Teklif #${Number(t.TeklifID)}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#000}
        h2{margin:0 0 10px 0;color:#000}
        .hitap{margin:8px 0 14px 0;font-size:14px;line-height:1.45;color:#000}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border:1px solid #444;padding:7px;font-size:12px;color:#000} th{background:#fff}
        .r{text-align:right}
        .toplam{font-size:18px;font-weight:700;margin-top:14px;text-align:right;color:#000}
        .kase-wrap{display:flex;justify-content:flex-end;margin-top:20px}
        .kase{min-width:260px;max-width:340px;border:1px solid #444;padding:10px 12px;font-size:12px;line-height:1.45;color:#000}
        .kase .u{font-weight:700;margin-bottom:4px}
      </style></head><body>
        <h2>Fiyat Teklifi</h2>
        <div class="hitap">
          Sayın <strong>${gunlukMetinEsc(t.MusteriAdi || 'Müşterimiz')}</strong>${musteriKimlik ? ` — ${gunlukMetinEsc(musteriKimlik)}` : ''},<br>
          ${gunlukMetinEsc(d)} tarihli fiyat teklifimiz aşağıda bilgilerinize sunulmuştur.
        </div>
        ${t.Baslik ? `<div><b>Başlık:</b> ${gunlukMetinEsc(t.Baslik)}</div>` : ''}
        ${t.Aciklama ? `<div style="margin-top:6px;"><b>Not:</b> ${gunlukMetinEsc(t.Aciklama)}</div>` : ''}
        ${kalemler.length
          ? (String(t.Yontem) === 'Toplu'
            ? `
              <table><thead><tr><th>Ürün</th><th class="r">Adet</th></tr></thead>
              <tbody>${kalemler.map((k) => `<tr><td>${gunlukMetinEsc(k.UrunAdi || '')}</td><td class="r">${Number(k.Miktar || 0).toFixed(2)}</td></tr>`).join('')}</tbody></table>
            `
            : `
              <table><thead><tr><th>Ürün</th><th class="r">Adet</th><th>Birim</th><th class="r">Birim Fiyat</th><th class="r">Toplam</th></tr></thead>
              <tbody>${kalemler.map((k) => `<tr><td>${gunlukMetinEsc(k.UrunAdi || '')}</td><td class="r">${Number(k.Miktar || 0).toFixed(2)}</td><td>${gunlukMetinEsc(k.Birim || '-')}</td><td class="r">${paraTr(k.BirimFiyat)}</td><td class="r">${paraTr(k.SatirTutar)}</td></tr>`).join('')}</tbody></table>
            `)
          : '<div class="small text-muted">Kalem bilgisi yok.</div>'}
        <div class="toplam">Toplam: ${paraTr(t.ToplamTutar)}</div>
        <div class="kase-wrap">
          <div class="kase">
            <div class="u">${gunlukMetinEsc(sirketUnvan)}</div>
            ${sirketYetkili ? `<div>Yetkili: ${gunlukMetinEsc(sirketYetkili)}</div>` : ''}
            ${sirketVergi ? `<div>Vergi No: ${gunlukMetinEsc(sirketVergi)}</div>` : ''}
            ${sirketTel ? `<div>Tel: ${gunlukMetinEsc(sirketTel)}</div>` : ''}
            ${sirketAdres ? `<div>Adres: ${gunlukMetinEsc(sirketAdres)}</div>` : ''}
          </div>
        </div>
      </body></html>
    `;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 1500);
  } catch (e) {
    console.error(e);
    alert('Yazdırma hazırlanamadı.');
  }
}

function teklifRaporCsvIndir() {
  if (!Array.isArray(teklifListeCache) || !teklifListeCache.length) {
    alert('Rapor için listede veri yok.');
    return;
  }
  const satirlar = [
    ['TeklifNo', 'Tarih', 'Musteri', 'KimlikTip', 'KimlikNo', 'Yontem', 'ToplamTutar'],
    ...teklifListeCache.map((t) => {
      const k = teklifMusteriKimlikNo(t);
      return [
        String(t.TeklifID || ''),
        (() => { const x = tarihTrGoster(t.Tarih); return x === '—' ? '' : x; })(),
        String(t.MusteriAdi || 'Genel teklif'),
        k.tip,
        k.no,
        String(t.Yontem || ''),
        Number(t.ToplamTutar || 0).toFixed(2),
      ];
    }),
  ];
  const csv = satirlar.map((s) => s.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `teklif-raporu-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 0);
}
