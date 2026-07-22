(function () {
  'use strict';

  const LS_USER = 'elektrik_mobil_kullanici';
  const LS_SIFRE = 'elektrik_mobil_sifre';

  let apiBase = '';
  let aktifKullanici = '';
  let stokCache = [];
  let stokCacheSirali = [];
  let stokIndeksMap = new Map();
  let stokBarkodMap = new Map();
  const STOK_LISTE_GOSTER_LIMIT = 80;
  let stokListeleRaf = 0;
  let musteriCache = [];
  let tedarikciCache = [];
  let sepet = [];
  let detayMusteriID = null;
  let detayMusteriData = null;
  let detayTedarikciID = null;
  let detayTedarikciData = null;
  let tedAlimSepet = [];
  let satisHedefMusteriID = null;
  let _gunlukDuzenleLogID = null;
  let _musteriHareketDuzenleID = null;
  let _musteriHareketDuzenleTip = null;
  let aktifPanel = 'satis';
  let musteriDetayDonusPanel = 'musteri';
  let gunlukSonData = null;
  let gunlukBugunData = null;
  let stokDuzenlemeID = null;
  let stokEkleDonusHedef = null; /* 'satis' | 'musteri-satis' | null */
  let _stokYokOnaylandi = false;
  let musteriSatisSepet = [];
  let _adetGirResolve = null;
  let _adetGirHedef = 'satis';
  let _adetGirIdx = -1;
  let sirketAyarlar = null;
  let musteriEkleKaynak = 'liste';
  const SON_ISLEM_ADET = 7;

  const $ = (id) => document.getElementById(id);

  function apiUrl(path) {
    const base = (apiBase || '').replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(apiUrl(path), {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-Elektrik-Kaynak': 'mobil',
        ...(opts.headers || {}),
      },
    });
    if (res.status === 403) {
      try {
        const p = await res.clone().json();
        if (p.message) toast(p.message);
      } catch (_) {}
    }
    return res;
  }

  function satisPanelHazirla() {
    barkodTaraKapat();
    const arama = $('satisArama');
    if (arama) {
      arama.disabled = false;
      arama.readOnly = false;
    }
  }

  function para(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '0,00 ₺';
    return `${x.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
  }

  /** MSSQL DATETIME: rakamları duvar saati kabul et (Z olsa da +3/-3 yok). */
  function sqlTarihParse(val) {
    if (val == null || val === '') return null;
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
    const s = String(val).trim();
    if (!s) return null;
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?/i,
    );
    if (m) {
      return new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0),
      );
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function tarihTrGoster(val) {
    const d = sqlTarihParse(val);
    if (!d) return '—';
    return d.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function musteriTurDeger(m) {
    const t = String(m?.tur || '').trim();
    if (t === 'Tuzel' || t === 'Tüzel') return 'Tuzel';
    return 'Gercek';
  }

  function musteriTuzelMi(m) {
    return musteriTurDeger(m) === 'Tuzel';
  }

  function musteriGorunenAd(m) {
    if (!m) return 'Müşteri';
    if (musteriTuzelMi(m)) {
      return String(m.FirmaAdi || m.yetkili || m.AdSoyad || 'Tüzel müşteri').trim();
    }
    return String(m.AdSoyad || m.FirmaAdi || 'Müşteri').trim();
  }

  function musteriLakap(m) {
    return String(m?.TanimAdi || '').trim();
  }

  function musteriAltKimlik(m) {
    const lakap = musteriLakap(m);
    return lakap || `#${m?.MusteriID || ''}`;
  }

  function musteriKonum(m) {
    const parcalar = [m?.Adres, m?.Ilce, m?.Il].map((x) => String(x || '').trim()).filter(Boolean);
    return parcalar.join(', ') || '—';
  }

  function hareketTurEtiket(tur) {
    const t = String(tur || '').toLowerCase();
    if (t === 'odeme') return 'Tahsilat';
    if (t === 'iadeodeme') return 'İade ödeme';
    if (t === 'iade') return 'İade';
    return 'Satış';
  }

  function hareketMobilSinif(h) {
    const t = String(h.Tur || '').toLowerCase();
    if (t === 'odeme' || t === 'iadeodeme') return 'hareket-odeme';
    return 'hareket-satis';
  }

  /** Ödemede sadece ödeme şekli; satışta kısa başlık veya düz metin. */
  function hareketMobilNot(h) {
    const turRaw = String(h.Tur || '').toLowerCase();
    if (turRaw === 'odeme' || turRaw === 'iadeodeme') {
      const odeme = String(h.OdemeSekli || '').trim();
      return odeme && odeme !== '—' ? odeme : '';
    }
    if (hareketMobilKalemleri(h).length) return hareketMobilBaslik(h);
    return mobilOnekTemizle(h.Aciklama || '');
  }

  function hareketKalemNormalize(k) {
    const miktar = Number(k.Miktar) || 0;
    let birim = Number(k.BirimFiyat) || 0;
    let tutar = Number(k.SatirTutar ?? k.Tutar) || 0;
    if (tutar <= 0 && miktar > 0 && birim > 0) tutar = Math.round(miktar * birim * 100) / 100;
    if (birim <= 0 && tutar > 0 && miktar > 0) birim = Math.round((tutar / miktar) * 100) / 100;
    return {
      UrunAdi: String(k.UrunAdi || '—').trim(),
      Miktar: miktar,
      BirimFiyat: birim,
      Tutar: tutar,
    };
  }

  function aciklamadanHareketKalemleri(aciklama, toplamTutar) {
    let metin = mobilOnekTemizle(aciklama || '');
    const tire = metin.match(/\s[—–-]\s+(.+)$/);
    if (tire) metin = tire[1].trim();
    const parcalar = metin.split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const p of parcalar) {
      const m = p.match(/^(.+?)\s*[x×](\d+)(?:\s*@\s*(\d+(?:[.,]\d+)?))?\s*$/i);
      if (!m) continue;
      const urunAdi = String(m[1] || '').trim();
      const miktar = parseInt(m[2], 10);
      if (!urunAdi || !Number.isInteger(miktar) || miktar < 1) continue;
      let birim = m[3] ? parseFloat(String(m[3]).replace(',', '.')) : 0;
      if (!Number.isFinite(birim) || birim <= 0) {
        birim = toplamTutar > 0 && parcalar.length === 1
          ? Math.round((toplamTutar / miktar) * 100) / 100
          : 0;
      }
      const tutar = birim > 0
        ? Math.round(miktar * birim * 100) / 100
        : 0;
      out.push({ UrunAdi: urunAdi, Miktar: miktar, BirimFiyat: birim, Tutar: tutar });
    }
    return out;
  }

  function hareketMobilKalemleri(h) {
    const tur = String(h.Tur || '').toLowerCase();
    if (tur !== 'satis' && tur !== 'iade') return [];
    if (Array.isArray(h.detaylar) && h.detaylar.length) {
      return h.detaylar.map(hareketKalemNormalize).filter((k) => k.UrunAdi && k.Miktar > 0);
    }
    const { toplam } = hareketMobilTutarlar(h);
    return aciklamadanHareketKalemleri(h.Aciklama, toplam);
  }

  function hareketMobilBaslik(h) {
    const ac = mobilOnekTemizle(h.Aciklama || '');
    const m = ac.match(/^(.+?)\s[—–-]\s/);
    if (m) return m[1].trim();
    if (/\s[x×]\d+/i.test(ac)) return '';
    return ac;
  }

  function hareketKalemMetin(kalemler) {
    return kalemler.map((k) => {
      const birimStr = k.BirimFiyat > 0 ? para(k.BirimFiyat) : '—';
      return `${k.UrunAdi} · ${k.Miktar} adet × ${birimStr}`;
    }).join(', ');
  }

  function kalemListeHtml(kalemler, etiket = 'Ürünler', opts = {}) {
    if (!kalemler.length) return '';
    const kompakt = opts.kompakt === true;
    const satirlar = kalemler.map((k) => {
      const tutar = Number(k.Tutar) || 0;
      let miktar = Number(k.Miktar) || 0;
      if (miktar <= 0 && tutar > 0) miktar = 1;
      let birim = Number(k.BirimFiyat) || 0;
      if (birim <= 0 && tutar > 0 && miktar > 0) {
        birim = Math.round((tutar / miktar) * 100) / 100;
      }
      const ad = esc(k.UrunAdi || '—');
      const birimStr = birim > 0 ? para(birim) : '—';
      const adetStr = `${miktar} adet × ${birimStr}`;
      if (kompakt) {
        return `<li class="hareket-kalem-satir">${ad} · ${adetStr}</li>`;
      }
      return `<li class="islem-kalem-satir">
        <span class="islem-kalem-ad">${ad}</span>
        <span class="islem-kalem-sag">
          <span class="islem-kalem-birim">${adetStr}</span>
          <span class="islem-kalem-tutar">${para(tutar)}</span>
        </span>
      </li>`;
    }).join('');
    if (kompakt) {
      return `<ul class="hareket-kalem-liste" aria-label="${esc(etiket)}">${satirlar}</ul>`;
    }
    return `<ul class="islem-kalem-liste" aria-label="${esc(etiket)}">${satirlar}</ul>`;
  }

  function aciklamadanSatisTutarCikar(aciklama) {
    const parcalar = String(aciklama || '').match(/@(\d+(?:[.,]\d+)?)/g);
    if (!parcalar?.length) return 0;
    let t = 0;
    parcalar.forEach((p) => {
      const n = parseFloat(p.slice(1).replace(',', '.'));
      if (Number.isFinite(n)) t += n;
    });
    return Math.round(t * 100) / 100;
  }

  function hareketMobilTutarlar(h) {
    const tur = String(h.Tur || '').toLowerCase();
    let toplam = Number(h.ToplamTutar || 0);
    let odenen = Number(h.OdenenTutar || 0);
    const kalan = Number(h.KalanTutar ?? Math.max(0, toplam - odenen));
    if (tur === 'odeme' || tur === 'iadeodeme') {
      return { toplam: 0, odenen };
    }
    if (tur === 'satis' || tur === 'iade') {
      if (toplam <= 0.005) {
        const acik = aciklamadanSatisTutarCikar(h.Aciklama);
        if (acik > 0) toplam = acik;
      }
      if (toplam > 0 && odenen >= toplam - 0.005 && kalan <= 0.005) {
        odenen = 0;
      }
      return { toplam, odenen };
    }
    return { toplam, odenen: 0 };
  }

  /** Satış açıklamasından kullanıcı özel notunu ayıklar. */
  function hareketOzelNot(h) {
    const parts = mobilOnekTemizle(h.Aciklama || h.KisaAciklama || '')
      .split(/\s[—–-]\s/)
      .map((s) => s.trim())
      .filter(Boolean);
    const urunGibi = (s) => /\s[x×]\d+/i.test(s) || /@\d/.test(s);
    if (parts.length >= 3 && urunGibi(parts[parts.length - 1])) {
      const orta = parts.slice(1, -1).join(' — ').trim();
      return urunGibi(orta) ? '' : orta;
    }
    if (parts.length === 2) {
      if (urunGibi(parts[0]) && !urunGibi(parts[1])) return parts[1];
      if (!urunGibi(parts[0]) && !urunGibi(parts[1])) return parts[1];
    }
    return '';
  }

  function hareketMobilHtml(h) {
    const etiket = hareketTurEtiket(h.Tur);
    const { toplam, odenen } = hareketMobilTutarlar(h);
    const turRaw = String(h.Tur || '').toLowerCase();
    const odeme = String(h.OdemeSekli || '').trim();
    const odemeTip = turRaw === 'odeme' || turRaw === 'iadeodeme'
      ? gunlukOdemeTipNorm(odeme)
      : (odenen <= 0.009 && turRaw === 'satis' ? 'veresiye' : gunlukOdemeTipNorm(odeme));
    const veresiyeMi = odemeTip === 'veresiye' || (turRaw === 'satis' && odenen <= 0.009);
    const kalemler = hareketMobilKalemleri(h);
    const kalemHtml = kalemler.length ? gunlukKalemListeHtml(kalemler) : '';
    const ozelNot = hareketOzelNot(h);
    const tarih = tarihTrGoster(h.Tarih);
    const odemeIkon = gunlukOdemeIkonHtml(odemeTip);
    const tahsilatMi = turRaw === 'odeme' || turRaw === 'iadeodeme';
    const tutarCls = tahsilatMi
      ? 'islem-tutar-giris'
      : veresiyeMi
        ? 'islem-tutar-veresiye'
        : 'islem-tutar-giris';
    const turCls = gunlukIslemTurSinif({
      TurEtiket: etiket,
      Yon: 'giris',
      Odeme: veresiyeMi ? 'Veresiye' : odeme,
    });
    const kartOdemeCls = veresiyeMi
      ? ' islem-kart-veresiye'
      : (odemeTip === 'nakit' || odemeTip === 'kart' || odemeTip === 'havale')
        ? ' islem-kart-odendi'
        : '';
    const metaParca = [
      !veresiyeMi && odeme && odeme !== '—' ? odeme : '',
      tarih,
    ].filter(Boolean);
    const metaHtml = metaParca.length
      ? `<span class="islem-meta">${esc(metaParca.join(' · '))}</span>`
      : '';
    let notHtml = '';
    if (veresiyeMi && (turRaw === 'satis' || turRaw === 'iade')) {
      notHtml = `<div class="islem-not islem-not-veresiye"><span class="islem-veresiye-rozet">Veresiye</span>${metaHtml}</div>`;
    } else if (metaHtml) {
      notHtml = `<div class="islem-not islem-not-meta">${metaHtml}</div>`;
    }
    const ozelNotHtml = ozelNot
      ? `<div class="islem-not islem-not-ozel"><span class="islem-ozel-not">${esc(ozelNot)}</span></div>`
      : '';
    const hid = Number(h.HareketID);
    const duzenleTip = turRaw === 'satis' ? 'satis' : (turRaw === 'odeme' ? 'odeme' : '');
    const duzenleBtn = hid && duzenleTip
      ? `<button type="button" class="hareket-duzenle-btn" data-hareket-duzenle="${hid}" data-hareket-tip="${duzenleTip}" title="Düzenle" aria-label="Düzenle">✎</button>`
      : '';
    const silBtn = hid
      ? `<button type="button" class="hareket-sil-btn" data-hareket-sil="${hid}" title="Sil" aria-label="Sil">✕</button>`
      : '';
    const tutarGoster = tahsilatMi ? odenen : toplam;
    const turOdemeIkon = odemeIkon && !veresiyeMi ? ` ${odemeIkon}` : '';
    return `<li class="islem-kart${kalemler.length ? ' islem-kart-satis' : ''}${kartOdemeCls}">
      <div class="islem-ust">
        <span class="islem-tur ${turCls}">${esc(etiket)}${turOdemeIkon}</span>
        <div class="islem-ust-sag">
          <span class="islem-tutar ${tutarCls}">${para(tutarGoster)}</span>
          ${duzenleBtn}
          ${silBtn}
        </div>
      </div>
      ${notHtml}
      ${kalemHtml}
      ${ozelNotHtml}
    </li>`;
  }

  function stokSeviyeBilgi(urun) {
    const miktar = Number(urun?.MevcutMiktar || 0);
    const kritik = Number.isFinite(Number(urun?.KritikEsik)) ? Number(urun.KritikEsik) : 5;
    const hedef = Number.isFinite(Number(urun?.HedefEsik)) ? Number(urun.HedefEsik) : Math.max(kritik + 1, 20);
    if (miktar < 0) return { metin: 'Eksi stok', sinif: 'rozet-eksi' };
    if (miktar < kritik) return { metin: 'Tehlikeli', sinif: 'rozet-tehlikeli' };
    if (miktar >= hedef) return { metin: 'Yeterli', sinif: 'rozet-yeterli' };
    return { metin: 'Orta', sinif: 'rozet-orta' };
  }

  function kartListeHtml(opts) {
    const { baslik, alt, tutar, tutarCls, rozet, tikla } = opts;
    const rozetHtml = rozet
      ? `<span class="durum-rozet ${rozet.sinif}">${esc(rozet.metin)}</span>`
      : '';
    const li = document.createElement('li');
    li.className = 'kart-item';
    li.innerHTML = `
      <div class="kart-govde">
        <div class="kart-metin">
          <div class="kart-ust-satir">
            <span class="kart-baslik">${esc(baslik)}</span>
            ${rozetHtml}
          </div>
          ${alt ? `<div class="kart-alt">${alt}</div>` : ''}
        </div>
        <div class="kart-tutar ${tutarCls || ''}">${tutar}</div>
      </div>`;
    if (tikla) li.onclick = tikla;
    return li;
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, wait);
    };
  }

  function stokCacheIndeksle() {
    stokIndeksMap = new Map();
    stokBarkodMap = new Map();
    stokCacheSirali = [...stokCache].sort((a, b) =>
      String(a.UrunAdi || '').localeCompare(String(b.UrunAdi || ''), 'tr'));
    for (const s of stokCache) {
      const barkod = String(s.Barkod || '').trim();
      const kayit = {
        stok: s,
        ad: String(s.UrunAdi || '').toLocaleLowerCase('tr-TR'),
        barkod,
        id: String(s.StokID),
      };
      stokIndeksMap.set(Number(s.StokID), kayit);
      const bn = barkodNorm(barkod);
      if (bn && !stokBarkodMap.has(bn)) stokBarkodMap.set(bn, s);
    }
  }

  function stokIndeksEsles(kayit, raw, lower, sayisal) {
    if (!kayit) return false;
    if (sayisal && kayit.barkod === raw) return true;
    if (kayit.ad.includes(lower)) return true;
    if (kayit.barkod && kayit.barkod.includes(raw)) return true;
    return kayit.id === raw;
  }

  /** Önceden sıralı/indeksli stokta hızlı arama; liste çiziminde üst sınır. */
  function stokAraFiltrele(q, limit = STOK_LISTE_GOSTER_LIMIT, opts = {}) {
    const hizmetHaric = opts.hizmetHaric === true;
    const raw = String(q || '').trim();
    if (!raw) {
      const kaynak = hizmetHaric ? stokCacheSirali.filter((s) => !stokHizmetMi(s)) : stokCacheSirali;
      const toplam = kaynak.length;
      return {
        liste: kaynak.slice(0, limit),
        toplam,
        sinirli: toplam > limit,
      };
    }
    const lower = raw.toLocaleLowerCase('tr-TR');
    const sayisal = /^\d+$/.test(raw);
    const liste = [];
    let toplam = 0;
    for (const s of stokCacheSirali) {
      if (hizmetHaric && stokHizmetMi(s)) continue;
      const kayit = stokIndeksMap.get(Number(s.StokID));
      if (!stokIndeksEsles(kayit, raw, lower, sayisal)) continue;
      toplam += 1;
      if (liste.length < limit) liste.push(s);
    }
    return { liste, toplam, sinirli: toplam > limit };
  }

  function barkodNorm(s) {
    return String(s || '').trim().replace(/\s/g, '');
  }

  function stokAraEsles(stok, q) {
    const kayit = stokIndeksMap.get(Number(stok.StokID));
    if (kayit) {
      const raw = String(q || '').trim();
      if (!raw) return false;
      return stokIndeksEsles(kayit, raw, raw.toLocaleLowerCase('tr-TR'), /^\d+$/.test(raw));
    }
    const raw = String(q || '').trim();
    if (!raw) return false;
    const lower = raw.toLocaleLowerCase('tr-TR');
    const ad = String(stok.UrunAdi || '').toLocaleLowerCase('tr-TR');
    const barkod = String(stok.Barkod || '').trim();
    if (/^\d+$/.test(raw) && barkod === raw) return true;
    if (ad.includes(lower)) return true;
    if (barkod && barkod.includes(raw)) return true;
    return String(stok.StokID) === raw;
  }

  function stokBulBarkod(kod) {
    const raw = barkodNorm(kod);
    if (!raw) return null;
    if (stokBarkodMap.has(raw)) return stokBarkodMap.get(raw);
    const tam = stokCache.filter((s) => barkodNorm(s.Barkod) === raw);
    if (tam.length >= 1) return tam[0];
    const kismi = stokCache.filter((s) => {
      const b = barkodNorm(s.Barkod);
      return b && (b.includes(raw) || raw.includes(b));
    });
    if (kismi.length === 1) return kismi[0];
    return null;
  }

  let barkodQr = null;
  let barkodTaramaAcik = false;
  let barkodTaramaModu = 'satis';
  let barkodStream = null;
  let barkodRaf = 0;
  let barkodDetector = null;
  let barkodSonTespitMs = 0;
  let sonBarkodKod = '';
  let sonBarkodZaman = 0;

  function barkodCanliKameraMumkun() {
    return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  }

  function barkodUiGuncelle() {
    const canli = barkodCanliKameraMumkun();
    document.querySelectorAll('.btn-scan:not(.btn-scan-manuel) .btn-scan-metin').forEach((el) => {
      el.textContent = canli ? 'Okut' : 'Fotoğraf';
    });
    document.querySelectorAll('.btn-scan:not(.btn-scan-manuel)').forEach((btn) => {
      btn.title = canli ? 'Kamera ile barkod okut' : 'Barkodu fotoğrafla';
      btn.setAttribute('aria-label', canli ? 'Barkod okut' : 'Barkod fotoğrafı');
    });
    const ipucu = document.querySelector('.satis-barkod-ipucu');
    if (ipucu) {
      ipucu.textContent = canli
        ? 'Kamera ile barkod okutun veya barkodu yazın — okunan ürün sepete eklenir'
        : '«Fotoğraf» ile barkodu çekin veya yazın — okunan ürün sepete eklenir';
    }
    const fotoBtn = $('btnBarkodFoto');
    if (fotoBtn) fotoBtn.textContent = canli ? 'Yedek: fotoğraf çek' : 'Fotoğraf çek';
  }

  function barkodTarayiciBaslikGuncelle() {
    const el = $('barkodTarayiciBaslik');
    if (!el) return;
    const foto = !barkodCanliKameraMumkun();
    if (barkodTaramaModu === 'stok') {
      el.textContent = foto ? 'Barkod fotoğrafı' : 'Ürün barkodu okut';
    } else if (barkodTaramaModu === 'musteri-satis') {
      el.textContent = foto ? 'Satış — barkod fotoğrafı' : 'Satış — barkod okut';
    } else {
      el.textContent = foto ? 'Satış — barkod fotoğrafı' : 'Satış — barkod okut';
    }
  }

  function barkodCanliDurumMetni() {
    return barkodTaramaModu === 'stok'
      ? 'Barkodu çerçeveye tutun — alana yazılır'
      : 'Barkodu çerçeveye tutun — otomatik okunur, fotoğraf çekmeyin';
  }

  function barkodFotoVarsayilanMetin() {
    return barkodTaramaModu === 'stok'
      ? 'Fotoğraf çek — barkod alana yazılır'
      : 'Fotoğraf çek — barkod sepete eklenir';
  }

  function barkodStokAlanaYaz(kod) {
    const n = barkodNorm(kod);
    if (!n) return false;
    const inp = $('stokBarkod');
    if (inp) inp.value = n;
    const mevcut = stokCache.find(
      (s) => barkodNorm(s.Barkod) === n && Number(s.StokID) !== Number(stokDuzenlemeID),
    );
    if (mevcut) {
      toast(`Uyarı: barkod «${mevcut.UrunAdi}» ürününde kayıtlı`);
    } else {
      toast('Barkod alana yazıldı');
    }
    barkodTaraKapat();
    setTimeout(() => {
      if (!$('stokUrunAdi')?.value?.trim()) $('stokUrunAdi')?.focus();
      else $('stokSatis')?.focus();
    }, 120);
    return true;
  }

  function barkodDurumYaz(msg) {
    const el = $('barkodTarayiciDurum');
    if (el) el.textContent = msg;
  }

  function barkodFormatlari() {
    if (typeof Html5QrcodeSupportedFormats === 'undefined') return undefined;
    return [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF,
    ];
  }

  function barkodHataMesaji(err) {
    const ad = String(err?.name || '');
    if (ad === 'NotAllowedError' || ad === 'PermissionDeniedError') {
      return 'Kamera izni kapalı. Tarayıcıda bu site için Kamera → İzin ver, sayfayı yenile.';
    }
    if (ad === 'NotFoundError' || ad === 'DevicesNotFoundError') {
      return 'Kamera bulunamadı.';
    }
    if (ad === 'NotReadableError' || ad === 'TrackStartError') {
      return 'Kamera başka uygulama tarafından kullanılıyor olabilir.';
    }
    const msg = String(err?.message || err || '').trim();
    if (/secure|https|insecure/i.test(msg)) {
      return 'http:// adresinde kamera engellenir. HTTPS gerekir veya barkodu arama kutusuna yazın.';
    }
    if (/multiformat readers|unable to detect/i.test(msg)) {
      return 'Barkod fotoğrafta okunamadı. Yakından, düz ve net çekin — veya barkodu üstteki arama kutusuna yazın.';
    }
    return msg || 'Kamera açılamadı';
  }

  function barkodFotoModuAc(altMetin, opts = {}) {
    const wrap = $('barkodTarayici');
    if (!wrap) return;
    wrap.hidden = false;
    barkodTaramaAcik = true;
    barkodTarayiciBaslikGuncelle();
    const readerEl = $('barkodReader');
    const httpMod = opts.httpMod ?? !barkodCanliKameraMumkun();
    if (readerEl) {
      if (httpMod) {
        const ipucu = barkodTaramaModu === 'stok'
          ? 'Barkodu net çerçeveleyin — okunan kod alana yazılır.'
          : 'Barkodu net çerçeveleyin — okunan ürün sepete eklenir.';
        readerEl.innerHTML =
          `<div class="barkod-foto-placeholder barkod-foto-http"><span class="barkod-foto-ikon">📷</span><p>Fotoğrafla barkod oku</p><p class="barkod-foto-alt">${ipucu}</p></div>`;
      } else {
        const ipucu = barkodTaramaModu === 'stok'
          ? 'Barkodu elle yazabilir veya aşağıdan yedek fotoğraf çekebilirsiniz.'
          : 'Önce üstteki arama kutusuna barkodu yazın; olmazsa aşağıdan yedek fotoğraf.';
        readerEl.innerHTML =
          `<div class="barkod-foto-placeholder"><span class="barkod-foto-ikon">📷</span><p>Canlı okuma açılamadı.</p><p class="barkod-foto-alt">${ipucu}</p></div>`;
      }
    }
    barkodDurumYaz(altMetin || barkodFotoVarsayilanMetin());
  }

  function barkodFotoSecAc() {
    barkodFotoModuAc();
    setTimeout(() => $('barkodFotoInput')?.click(), 300);
  }

  async function barkodKameraIdBul() {
    try {
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) return null;
      const arka = cams.find((c) => /back|rear|environment|arka|wide|tele/i.test(c.label || ''));
      return (arka || cams[cams.length - 1]).id;
    } catch (_) {
      return null;
    }
  }

  function barkodKameraDurdur() {
    if (barkodRaf) {
      cancelAnimationFrame(barkodRaf);
      barkodRaf = 0;
    }
    barkodDetector = null;
    if (barkodStream) {
      barkodStream.getTracks().forEach((t) => t.stop());
      barkodStream = null;
    }
    const video = $('barkodVideo');
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    if (barkodQr) {
      try { barkodQr.stop(); } catch (_) {}
      try { barkodQr.clear(); } catch (_) {}
      barkodQr = null;
    }
  }

  async function barkodTaraKapat() {
    barkodTaramaAcik = false;
    barkodTaramaModu = 'satis';
    barkodKameraDurdur();
    const wrap = $('barkodTarayici');
    if (wrap) wrap.hidden = true;
    const reader = $('barkodReader');
    if (reader) reader.innerHTML = '';
  }

  function barkodCanliDomHazirla() {
    const readerEl = $('barkodReader');
    if (!readerEl) return null;
    readerEl.innerHTML = `
      <div class="barkod-live-wrap">
        <video id="barkodVideo" class="barkod-video" playsinline muted autoplay></video>
        <div class="barkod-scan-frame" aria-hidden="true"></div>
      </div>
      <div id="barkodHtml5Sink" class="barkod-html5-sink"></div>`;
    return $('barkodVideo');
  }

  async function barkodDetectorOlustur() {
    if (typeof BarcodeDetector === 'undefined') return null;
    const formatSets = [
      ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf'],
      ['ean_13', 'code_128'],
    ];
    for (const formats of formatSets) {
      try {
        return new BarcodeDetector({ formats });
      } catch (_) {}
    }
    return null;
  }

  function barkodCanliTespitDongusu() {
    const video = $('barkodVideo');
    if (!barkodTaramaAcik || !barkodDetector || !video) return;

    const simdi = performance.now();
    if (simdi - barkodSonTespitMs >= 120) {
      barkodSonTespitMs = simdi;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        barkodDetector
          .detect(video)
          .then((codes) => {
            if (!codes?.length || !barkodTaramaAcik) return;
            const v = barkodNorm(codes[0].rawValue);
            if (v) barkodTaramaSonucu(v);
          })
          .catch(() => {});
      }
    }
    barkodRaf = requestAnimationFrame(barkodCanliTespitDongusu);
  }

  async function barkodCanliVideoBaslat() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Kamera API yok');
    }
    const video = barkodCanliDomHazirla();
    if (!video) throw new Error('Video alanı yok');

    const denemeler = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
    ];

    let stream = null;
    let sonHata = null;
    for (const kisit of denemeler) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(kisit);
        break;
      } catch (e) {
        sonHata = e;
      }
    }
    if (!stream) throw sonHata || new Error('Kamera açılamadı');

    barkodStream = stream;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.srcObject = stream;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video başlatılamadı'));
      setTimeout(resolve, 2500);
    });
    await video.play();

    barkodDetector = await barkodDetectorOlustur();
    if (!barkodDetector) throw new Error('Barkod okuyucu yok');

    barkodSonTespitMs = 0;
    barkodRaf = requestAnimationFrame(barkodCanliTespitDongusu);
    return true;
  }

  function barkodIleSepeteEkle(kod) {
    const urun = stokBulBarkod(kod);
    if (urun) {
      sepeteEkle(urun);
      toast(`${urun.UrunAdi} sepete eklendi`);
      return true;
    }
    toast(`Barkod bulunamadı: ${barkodNorm(kod)}`);
    return false;
  }

  function barkodTaramaSonucu(kod) {
    const n = barkodNorm(kod);
    if (!n || !barkodTaramaAcik) return;
    const now = Date.now();
    if (n === sonBarkodKod && now - sonBarkodZaman < 1800) return;
    sonBarkodKod = n;
    sonBarkodZaman = now;
    if (navigator.vibrate) {
      try { navigator.vibrate(50); } catch (_) {}
    }
    if (barkodTaramaModu === 'stok') {
      barkodStokAlanaYaz(n);
      return;
    }
    if (barkodTaramaModu === 'musteri-satis') {
      const urun = stokBulBarkod(n);
      if (urun) {
        musteriSatisSepeteEkle(urun);
        toast(`${urun.UrunAdi} eklendi`);
      } else {
        toast(`Barkod bulunamadı: ${n}`);
      }
      barkodDurumYaz('Okundu — bir sonraki ürünü okutun');
      return;
    }
    barkodIleSepeteEkle(n);
    barkodDurumYaz('Okundu — bir sonraki ürünü okutun');
  }

  async function barkodQrBaslat(hedefId) {
    const formatlar = barkodFormatlari();
    barkodQr = formatlar
      ? new Html5Qrcode(hedefId, { formatsToSupport: formatlar, verbose: false })
      : new Html5Qrcode(hedefId, { verbose: false });

    const kameraCfg = {
      fps: 12,
      aspectRatio: 1.7777778,
      qrbox: (w, h) => ({
        width: Math.min(Math.floor(w * 0.92), 340),
        height: Math.min(Math.floor(h * 0.38), 160),
      }),
    };

    const deviceId = await barkodKameraIdBul();
    const denemeler = [];
    if (deviceId) denemeler.push(deviceId);
    denemeler.push({ facingMode: 'environment' }, { facingMode: 'user' });

    let sonHata = null;
    for (const kamera of denemeler) {
      try {
        await barkodQr.start(
          kamera,
          kameraCfg,
          (metin) => barkodTaramaSonucu(metin),
          () => {},
        );
        return true;
      } catch (e) {
        sonHata = e;
        try { await barkodQr.stop(); } catch (_) {}
      }
    }
    throw sonHata || new Error('Kamera başlatılamadı');
  }

  async function barkodFotoCanvasHazirla(file) {
    const bmp = await createImageBitmap(file);
    const maxKenar = 1920;
    let w = bmp.width;
    let h = bmp.height;
    const oran = Math.min(1, maxKenar / Math.max(w, h, 1));
    w = Math.max(1, Math.round(w * oran));
    h = Math.max(1, Math.round(h * oran));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    return canvas;
  }

  async function barkodFotoNativeOku(file) {
    if (typeof BarcodeDetector === 'undefined') return null;
    const formatSets = [
      ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
      ['ean_13', 'code_128'],
    ];
    let canvas = null;
    try {
      canvas = await barkodFotoCanvasHazirla(file);
      for (const formats of formatSets) {
        try {
          const det = new BarcodeDetector({ formats });
          const codes = await det.detect(canvas);
          if (codes?.length) {
            const v = String(codes[0].rawValue || '').trim();
            if (v) return v;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  async function barkodFotoKitaplikOku(file, geciciId) {
    const formatlar = barkodFormatlari();
    const qr = formatlar
      ? new Html5Qrcode(geciciId, { formatsToSupport: formatlar, verbose: false })
      : new Html5Qrcode(geciciId, { verbose: false });
    try {
      if (typeof qr.scanFileV2 === 'function') {
        const sonuc = await qr.scanFileV2(file, false, {
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });
        if (typeof sonuc === 'string') return sonuc;
        return sonuc?.decodedText || sonuc?.text || null;
      }
      return await qr.scanFile(file, false);
    } finally {
      try { await qr.clear(); } catch (_) {}
    }
  }

  async function barkodFotoDosyaOku(file) {
    if (!file) return;
    barkodDurumYaz('Fotoğraf okunuyor…');
    const geciciId = 'barkodFotoGecici';
    const readerEl = $('barkodReader');
    if (readerEl) {
      readerEl.innerHTML = `<div id="${geciciId}" style="position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden"></div>`;
    }
    try {
      let metin = null;
      if (typeof Html5Qrcode !== 'undefined') {
        metin = await barkodFotoNativeOku(file);
        if (!metin) metin = await barkodFotoKitaplikOku(file, geciciId);
      } else {
        metin = await barkodFotoNativeOku(file);
      }
      if (metin) {
        barkodTaramaSonucu(metin);
        return;
      }
      throw new Error('No MultiFormat Readers were able to detect the code.');
    } catch (e) {
      const msg = barkodHataMesaji(e);
      toast(msg);
      const ek = barkodTaramaModu === 'stok'
        ? ' — Tekrar «Fotoğraf çek» veya barkodu elle yazın.'
        : ' — Tekrar «Fotoğraf çek» veya barkodu arama kutusuna yazın.';
      barkodDurumYaz(`${msg}${ek}`);
      if (barkodTaramaModu === 'stok') {
        $('stokBarkod')?.focus();
      } else {
        const arama = $('satisArama');
        if (arama) {
          arama.focus();
          arama.placeholder = 'Barkodu buraya yazın…';
        }
      }
    } finally {
      if (readerEl && !barkodQr) {
        readerEl.innerHTML =
          '<div class="barkod-foto-placeholder"><span class="barkod-foto-ikon">📷</span><p>Okunamadı — tekrar deneyin</p></div>';
      }
    }
  }

  async function barkodTaraAc(mod = 'satis') {
    if (!stokCache.length) {
      toast('Stok listesi yükleniyor…');
      await veriYukle();
    }
    if (barkodTaramaAcik) {
      if (barkodTaramaModu === mod) return;
      await barkodTaraKapat();
    }

    barkodTaramaModu = mod === 'stok' ? 'stok' : mod === 'musteri-satis' ? 'musteri-satis' : 'satis';
    if (barkodTaramaModu === 'satis') satisPanelHazirla();

    const wrap = $('barkodTarayici');
    if (!wrap) return;

    wrap.hidden = false;
    barkodTaramaAcik = true;
    barkodTarayiciBaslikGuncelle();

    if (!barkodCanliKameraMumkun()) {
      barkodFotoModuAc(null, { httpMod: true });
      setTimeout(() => $('barkodFotoInput')?.click(), 400);
      return;
    }

    barkodDurumYaz('Kamera açılıyor…');

    let canliHata = null;
    try {
      await barkodCanliVideoBaslat();
      barkodDurumYaz(barkodCanliDurumMetni());
      return;
    } catch (e1) {
      canliHata = e1;
      console.warn('Canlı video tarama:', e1);
      barkodKameraDurdur();
    }

    if (typeof Html5Qrcode !== 'undefined') {
      try {
        const readerEl = $('barkodReader');
        if (readerEl) {
          readerEl.innerHTML = '<div id="barkodHtml5Sink" class="barkod-html5-sink barkod-html5-full"></div>';
        }
        await barkodQrBaslat('barkodHtml5Sink');
        barkodDurumYaz(barkodCanliDurumMetni());
        return;
      } catch (e2) {
        console.warn('Html5Qrcode tarama:', e2);
        barkodKameraDurdur();
      }
    }

    const msg = !barkodCanliKameraMumkun()
      ? barkodFotoVarsayilanMetin()
      : barkodHataMesaji(canliHata);
    barkodFotoModuAc(msg);
    if (!barkodCanliKameraMumkun()) {
      setTimeout(() => $('barkodFotoInput')?.click(), 400);
    } else {
      toast(barkodTaramaModu === 'stok' ? 'Canlı okuma yok — elle yazın veya fotoğraf' : 'Canlı okuma yok — barkodu yazın veya yedek fotoğraf');
    }
  }

  function stokBarkodTaraAc() {
    barkodTaraAc('stok');
  }

  function toast(msg, ms = 2800) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms);
  }

  let _silOnayResolve = null;

  function silmeSifreOnayla(mesaj) {
    return new Promise((resolve) => {
      _silOnayResolve = resolve;
      const msgEl = $('dlgSilMesaj');
      if (msgEl) msgEl.textContent = mesaj || 'Bu işlem için şifrenizi girin.';
      const inp = $('silOnaySifre');
      if (inp) inp.value = '';
      $('dlgSilOnay')?.showModal();
      setTimeout(() => inp?.focus(), 80);
    });
  }

  function silOnayKapat(onaylandi, sifre) {
    const fn = _silOnayResolve;
    _silOnayResolve = null;
    if (fn) fn(onaylandi && sifre ? sifre : false);
  }

  async function silmeSifreDogrula(sifre) {
    const kullanici = localStorage.getItem(LS_USER);
    if (!kullanici || !sifre) return false;
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ KullaniciAdi: kullanici, Sifre: sifre }),
      });
      if (res.status === 401) return false;
      const sonuc = await res.json().catch(() => ({}));
      return Boolean(sonuc.success);
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async function silOnayFormGonder(ev) {
    ev.preventDefault();
    const sifre = $('silOnaySifre')?.value || '';
    if (!sifre) {
      toast('Şifre girin');
      return;
    }
    const ok = await silmeSifreDogrula(sifre);
    if (!ok) {
      toast('Hatalı şifre');
      $('silOnaySifre')?.focus();
      return;
    }
    silOnayKapat(true, sifre);
    $('dlgSilOnay')?.close();
  }

  function showView(name) {
    $('view-login').hidden = name !== 'login';
    $('view-app').hidden = name !== 'app';
  }

  function anaSayfaGoster() {
    barkodTaraKapat();
    aktifPanel = 'satis';
    const ana = $('anaSayfa');
    const main = $('mainPanels');
    const fab = $('btnAnaGeri');
    if (ana) ana.hidden = false;
    if (main) {
      main.hidden = true;
      main.querySelectorAll('.panel').forEach((p) => {
        p.hidden = true;
        p.classList.remove('panel-active');
      });
    }
    if (fab) fab.hidden = true;
    $('headerBaslik').textContent = 'Satış';
    document.querySelectorAll('.nav-kart').forEach((b) => {
      b.classList.remove('nav-active');
    });
    satisPanelHazirla();
    sonIslemCiz();
  }

  function navKartAktifYap(nav) {
    document.querySelectorAll('.nav-kart').forEach((b) => {
      b.classList.toggle('nav-active', b.dataset.nav === nav);
    });
  }

  function panelGoster(id) {
    if (id === 'ana' || id === 'satis') {
      anaSayfaGoster();
      return;
    }
    barkodTaraKapat();
    yeniSatisModalKapat();
    const ana = $('anaSayfa');
    const main = $('mainPanels');
    const fab = $('btnAnaGeri');
    if (ana) ana.hidden = true;
    if (main) main.hidden = false;
    if (fab) fab.hidden = false;
    if (id !== 'musteri-detay' && id !== 'tedarikci-cari') aktifPanel = id;

    document.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === `panel-${id}`;
      p.hidden = !on;
      p.classList.toggle('panel-active', on);
    });
    const baslik = {
      bugun: 'Bugün',
      stok: 'Stok',
      musteri: 'Müşteri',
      'musteri-detay': 'Müşteri detay',
      tedarikci: 'Tedarikçi',
      'tedarikci-cari': 'Tedarikçi cari',
    };
    $('headerBaslik').textContent = baslik[id] || 'ELEKTRIK';
    if (id === 'tedarikci-cari') navKartAktifYap('tedarikci');
    else if (id === 'musteri-detay') navKartAktifYap('musteri');
    else navKartAktifYap(id);
    if (id === 'bugun') bugunPanelYukle();
    if (id === 'stok') stokListele();
    if (id === 'musteri') musteriListele();
    if (id === 'tedarikci') tedarikciListele();
  }

  /* ——— Giriş ——— */
  function varsayilanApiBase() {
    return `${location.protocol}//${location.host}`;
  }

  function girisButonPasif(pasif) {
    const btn = $('btnGiris');
    if (btn) btn.disabled = pasif;
  }

  async function girisYap() {
    const hata = $('loginHata');
    hata.hidden = true;
    apiBase = varsayilanApiBase();
    const KullaniciAdi = $('kullaniciAdi').value.trim();
    const Sifre = $('sifre').value;
    if (!KullaniciAdi || !Sifre) {
      hata.textContent = 'Kullanıcı adı ve şifre girin.';
      hata.hidden = false;
      return;
    }
    girisButonPasif(true);
    try {
      const res = await apiFetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ KullaniciAdi, Sifre }),
      });
      if (res.status === 401) {
        hata.textContent = 'Hatalı kullanıcı veya şifre.';
        hata.hidden = false;
        return;
      }
      const sonuc = await res.json();
      if (!sonuc.success) {
        hata.textContent = sonuc.message || 'Giriş başarısız.';
        hata.hidden = false;
        return;
      }
      localStorage.setItem(LS_USER, KullaniciAdi);
      localStorage.setItem(LS_SIFRE, Sifre);
      aktifKullanici = sonuc.kullanici.AdSoyad || sonuc.kullanici.KullaniciAdi || KullaniciAdi;
      $('aktifKullanici').textContent = aktifKullanici;
      showView('app');
      barkodUiGuncelle();
      anaSayfaGoster();
      await veriYukle();
    } catch (e) {
      console.error(e);
      hata.textContent = 'Sunucuya bağlanılamadı. Ağı kontrol edin.';
      hata.hidden = false;
    } finally {
      girisButonPasif(false);
    }
  }

  function bugunTarihStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const g = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${g}`;
  }

  function mobilOnekTemizle(metin) {
    return String(metin || '').replace(/^\[Mobil\]\s*/i, '').trim();
  }

  const PERAKENDE_ISLEM = 'Perakende İşlem';

  function perakendeEtiketMi(ad) {
    const a = String(ad || '').trim();
    return a === PERAKENDE_ISLEM || a === 'Müşterisiz işlem' || a === 'Müşterisiz';
  }

  function gunlukIslemAciklama(row) {
    if (row.KisaAciklama) return mobilOnekTemizle(row.KisaAciklama);
    if (row.MusteriAd) return mobilOnekTemizle(row.MusteriAd);
    const k = row.Kaynak || '';
    if (k === 'musteri_satis' || k === 'musteri_tahsilat' || k === 'musteri_odeme') {
      const ad = mobilOnekTemizle(row.MusteriAd || row.KisaAciklama || '');
      if (ad && !perakendeEtiketMi(ad)) return ad;
    }
    const det = Array.isArray(row.detaylar) ? row.detaylar : [];
    const satisKalemSatir =
      row.SatirTur === 'satis' || (k === 'satis' && row.SatirTur !== 'tahsilat');
    if (det.length && satisKalemSatir && k !== 'musteri_satis') return PERAKENDE_ISLEM;
    const ac = String(row.Aciklama || '').trim();
    if (ac.length > 90) return `${ac.slice(0, 87)}…`;
    return ac;
  }

  function gunlukMalAlimTedarikciAd(row) {
    let ad = row.MusteriAd || row.KisaAciklama || null;
    if (ad) {
      ad = String(ad).replace(/^Mal alım\s+/i, '').trim();
      if (ad && !perakendeEtiketMi(ad)) return ad;
    }
    const m = String(row.Aciklama || '').match(/Mal alım\s+([^:]+):/i);
    return m ? m[1].trim() : null;
  }

  function gunlukIslemGrupAnahtar(row) {
    if (row.GrupLogID != null) return `g:${row.GrupLogID}`;
    if (row.LogID != null) return `l:${row.LogID}`;
    return `t:${row.Tarih}:${row.TurEtiket}:${row.Tutar}`;
  }

  function gunlukIslemGruplari(liste) {
    const out = [];
    let cur = null;
    let curKey = null;
    for (const row of liste || []) {
      const key = gunlukIslemGrupAnahtar(row);
      if (curKey !== key) {
        if (cur) out.push(cur);
        cur = [row];
        curKey = key;
      } else {
        cur.push(row);
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function gunlukSatisKalemleri(grupRows) {
    return (grupRows || []).filter((r) => {
      const st = r.SatirTur || '';
      return st === 'satis_kalem' || st === 'iade_kalem';
    });
  }

  function gunlukGrupToplam(grupRows, kalemler) {
    if (kalemler.length) {
      return kalemler.reduce((t, k) => t + (Number(k.Tutar) || 0), 0);
    }
    const satis = grupRows.find(
      (r) => r.SatirTur === 'satis' || r.Kaynak === 'satis' || r.Kaynak === 'musteri_satis',
    );
    if (satis) return Number(satis.Tutar) || 0;
    return Number(grupRows[0]?.Tutar) || 0;
  }

  function gunlukGrupTurEtiket(grupRows, kalemler) {
    if ((grupRows || []).some((r) => r.SatirTur === 'eksik_odeme' || r.Kaynak === 'satis_eksik')) {
      return 'Eksik ödeme';
    }
    if (kalemler.some((k) => (k.SatirTur || '') === 'iade_kalem')) return 'İade';
    if (kalemler.length) return 'Satış';
    const ust = grupRows.find((r) => r.TurEtiket && r.SatirTur !== 'tahsilat');
    return ust?.TurEtiket || grupRows[0]?.TurEtiket || 'İşlem';
  }

  function gunlukGrupNot(grupRows) {
    for (const r of grupRows) {
      if (r.Kaynak === 'mal_alim' || r.SatirTur === 'mal_alim_kalem') {
        const ted = gunlukMalAlimTedarikciAd(r);
        if (ted) return ted;
      }
      if (r.Kaynak === 'musteri_satis' || r.Kaynak === 'musteri_tahsilat' || r.Kaynak === 'musteri_odeme') {
        const ad = mobilOnekTemizle(r.MusteriAd || '');
        if (ad && !perakendeEtiketMi(ad)) return ad;
      }
      if (r.MusteriAd) {
        const ad = mobilOnekTemizle(r.MusteriAd);
        if (ad && !perakendeEtiketMi(ad)) return ad;
      }
      if (r.KisaAciklama) {
        const k = mobilOnekTemizle(String(r.KisaAciklama).replace(/\s*—\s*tahsilat\s*$/i, '').trim());
        if (k && !perakendeEtiketMi(k)) return k;
      }
    }
    const not = gunlukIslemAciklama(grupRows[0]);
    return not && !perakendeEtiketMi(not) ? not : '';
  }

  function gunlukKalemListeHtml(kalemler) {
    return kalemListeHtml(kalemler, 'Satılan ürünler');
  }

  function gunlukPerakendeGrupMu(grupRows) {
    const satisSatiri = (grupRows || []).some((r) => {
      const kaynak = r.Kaynak || '';
      if (kaynak !== 'satis') return false;
      if (Number(r.MusteriID) > 0) return false;
      const st = r.SatirTur || '';
      return st === 'satis' || st === 'satis_kalem' || st === '';
    });
    if (!satisSatiri) return false;
    if ((grupRows || []).some((r) => Number(r.MusteriID) > 0)) return false;
    for (const r of grupRows) {
      const ad = mobilOnekTemizle(String(r.MusteriAd || r.KisaAciklama || '').trim());
      if (ad && !perakendeEtiketMi(ad)) return false;
    }
    return true;
  }

  function gunlukMusterisizPerakendeGrupMu(grupRows) {
    return gunlukPerakendeGrupMu(grupRows);
  }

  function gunlukGrupLogID(grupRows) {
    const satis = grupRows.find(
      (r) =>
        (r.Kaynak === 'satis' || r.Kaynak === 'musteri_satis') &&
        (r.SatirTur === 'satis' || r.SatirTur === 'satis_kalem' || !r.SatirTur),
    ) || grupRows.find((r) => r.GrupLogID || r.LogID);
    return Number(satis?.GrupLogID || satis?.LogID) || 0;
  }

  function gunlukSilGosterMi() {
    const bas = $('gunlukBas')?.value;
    const bit = $('gunlukBit')?.value || bas;
    if (!bas) return true;
    return bas === bit;
  }

  function gunlukGrupKalemleri(grupRows) {
    let kalemler = gunlukSatisKalemleri(grupRows);
    if (kalemler.length) return kalemler;
    const satis = grupRows.find(
      (r) => r.SatirTur === 'satis' || r.Kaynak === 'satis' || r.Kaynak === 'musteri_satis',
    ) || grupRows[0];
    if (!satis) return [];
    const tutar = Number(satis.Tutar) || Number(satis.ToplamTutar) || 0;
    return aciklamadanHareketKalemleri(satis.Aciklama || satis.KisaAciklama, tutar).map((k) => ({
      UrunAdi: k.UrunAdi,
      Miktar: k.Miktar,
      BirimFiyat: k.BirimFiyat,
      Tutar: k.Tutar,
    }));
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
      return '<span class="islem-odeme-ikon islem-odeme-nakit" title="Nakit" aria-label="Nakit">💵</span>';
    }
    if (tip === 'kart') {
      return '<span class="islem-odeme-ikon islem-odeme-kart" title="Kart" aria-label="Kart">💳</span>';
    }
    if (tip === 'havale') {
      return '<span class="islem-odeme-ikon islem-odeme-havale" title="Havale" aria-label="Havale">🏦</span>';
    }
    if (tip === 'veresiye') {
      return '<span class="islem-odeme-ikon islem-odeme-veresiye" title="Veresiye" aria-label="Veresiye">📒</span>';
    }
    return '';
  }

  function gunlukGrupOdeme(grupRows) {
    const rows = grupRows || [];
    const tahsilatSatir = rows.find(
      (r) => r.SatirTur === 'tahsilat' || String(r.TurEtiket || '').toLowerCase().includes('tahsilat'),
    );
    for (const r of rows) {
      const tip = gunlukOdemeTipNorm(r.Odeme);
      if (tip === 'veresiye') return 'Veresiye';
    }
    for (const r of rows) {
      const metin = `${r.Aciklama || ''} ${r.KisaAciklama || ''} ${r.IslemTipi || ''}`;
      if (/veresiye/i.test(metin)) return 'Veresiye';
    }
    if (tahsilatSatir?.Odeme && tahsilatSatir.Odeme !== '—') return String(tahsilatSatir.Odeme);
    for (const r of rows) {
      if (r.Odeme && r.Odeme !== '—') return String(r.Odeme);
    }
    const musteriSatis = rows.some(
      (r) =>
        r.Kaynak === 'musteri_satis' ||
        (Number(r.MusteriID) > 0 && (r.SatirTur === 'satis' || r.SatirTur === 'satis_kalem')),
    );
    if (musteriSatis && !tahsilatSatir) return 'Veresiye';
    return '';
  }

  function gunlukGrupKartHtml(grupRows, silGoster) {
    const kalemler = gunlukGrupKalemleri(grupRows);
    const ilk = grupRows[0];
    const tur = esc(gunlukGrupTurEtiket(grupRows, kalemler));
    const tutar = gunlukGrupToplam(grupRows, kalemler);
    const logID = gunlukGrupLogID(grupRows);
    const perakende = gunlukPerakendeGrupMu(grupRows);
    const duzenleBtn =
      silGoster && perakende && logID
        ? `<button type="button" class="hareket-duzenle-btn" data-gunluk-duzenle="${logID}" title="Düzenle" aria-label="Düzenle">✎</button>`
        : '';
    const silBtn =
      silGoster && perakende && logID
        ? `<button type="button" class="hareket-sil-btn" data-gunluk-sil="${logID}" title="Sil" aria-label="Sil">✕</button>`
        : '';
    const odeme = gunlukGrupOdeme(grupRows);
    const odemeTip = gunlukOdemeTipNorm(odeme);
    const odemeIkon = gunlukOdemeIkonHtml(odemeTip);
    const veresiyeMi = odemeTip === 'veresiye';
    const yon = grupRows.some((r) => r.Yon === 'cikis');
    const paraAlindiMi = !yon && (odemeTip === 'nakit' || odemeTip === 'kart' || odemeTip === 'havale');
    const kartOdemeCls = veresiyeMi
      ? ' islem-kart-veresiye'
      : paraAlindiMi
        ? ' islem-kart-odendi'
        : '';
    const tutarCls = yon
      ? 'islem-tutar-cikis'
      : veresiyeMi
        ? 'islem-tutar-veresiye'
        : 'islem-tutar-giris';
    const turCls = gunlukIslemTurSinif({
      ...ilk,
      TurEtiket: tur,
      Yon: yon ? 'cikis' : ilk.Yon,
      Odeme: odeme,
    });
    const tarihRow = grupRows.find((r) => r.GunlukTarihGoster !== false) || ilk;
    const altParca = [odeme && !veresiyeMi ? odeme : '', tarihTrGoster(tarihRow.Tarih)].filter(Boolean);
    let not = gunlukGrupNot(grupRows);
    if (perakende) not = PERAKENDE_ISLEM;
    else if (kalemler.length && not && (/\s[x×]\d+/i.test(not) || /@\d/.test(not))) {
      const satis = grupRows.find(
        (r) => r.SatirTur === 'satis' || r.Kaynak === 'satis' || r.Kaynak === 'musteri_satis',
      ) || grupRows[0];
      not = hareketMobilBaslik({ Aciklama: satis?.Aciklama || satis?.KisaAciklama || '' }) || '';
    }
    const ozelNotSatir = (() => {
      const satis = grupRows.find(
        (r) => r.SatirTur === 'satis' || r.Kaynak === 'satis' || r.Kaynak === 'musteri_satis',
      ) || grupRows[0];
      return satis ? hareketOzelNot(satis) : '';
    })();
    const kalemHtml = kalemler.length ? gunlukKalemListeHtml(kalemler) : '';
    const mobilIkon = grupRows.some((r) => r.MobilKaynak)
      ? ' <span class="islem-mobil-ikon" title="Mobil">📱</span>'
      : '';
    const turOdemeIkon = odemeIkon && !veresiyeMi ? ` ${odemeIkon}` : '';
    const metaMetin = altParca.join(' · ');
    const metaHtml = metaMetin
      ? `<span class="islem-meta">${esc(metaMetin)}</span>`
      : '';
    let notHtml = '';
    if (not) {
      if (perakende) {
        notHtml = `<div class="islem-not islem-not-perakende"><span class="islem-perakende-rozet">${esc(not)}</span>${metaHtml}</div>`;
      } else if (veresiyeMi) {
        notHtml = `<div class="islem-not islem-not-veresiye"><span class="islem-musteri-ikon" aria-hidden="true">👤</span><span class="islem-musteri-ad">${esc(not)}</span><span class="islem-veresiye-rozet">Veresiye</span>${metaHtml}</div>`;
      } else {
        notHtml = `<div class="islem-not islem-not-musteri"><span class="islem-musteri-ikon" aria-hidden="true">👤</span><span class="islem-musteri-ad">${esc(not)}</span>${metaHtml}</div>`;
      }
    } else if (metaHtml) {
      notHtml = `<div class="islem-not islem-not-meta">${metaHtml}</div>`;
    }
    const ozelNotHtml = ozelNotSatir
      ? `<div class="islem-not islem-not-ozel"><span class="islem-ozel-not">${esc(ozelNotSatir)}</span></div>`
      : '';
    return `<li class="islem-kart${kalemler.length ? ' islem-kart-satis' : ''}${perakende ? ' islem-kart-perakende' : ''}${kartOdemeCls}">
      <div class="islem-ust">
        <span class="islem-tur ${turCls}">${tur}${turOdemeIkon}${mobilIkon}</span>
        <div class="islem-ust-sag">
          <span class="islem-tutar ${tutarCls}">${para(tutar)}</span>
          ${duzenleBtn}
          ${silBtn}
        </div>
      </div>
      ${notHtml}
      ${kalemHtml}
      ${ozelNotHtml}
    </li>`;
  }

  function gunlukIslemTurSinif(row) {
    const tur = String(row.TurEtiket || '').toLowerCase();
    const odemeTip = gunlukOdemeTipNorm(row.Odeme);
    if (row.Yon === 'cikis') return 'islem-tur-gider';
    if (tur.includes('eksik')) return 'islem-tur-eksik';
    if (tur.includes('tahsilat') || tur.includes('ödeme') || tur.includes('odeme')) return 'islem-tur-tahsilat';
    if (odemeTip === 'veresiye') return 'islem-tur-veresiye';
    if (odemeTip === 'nakit') return 'islem-tur-nakit';
    if (odemeTip === 'kart') return 'islem-tur-kart';
    if (odemeTip === 'havale') return 'islem-tur-havale';
    return '';
  }

  function gunlukIslemSonN(islemler, n) {
    return gunlukIslemGruplari(islemler).slice(0, n);
  }

  function gunlukListeCiz(liste, ulId, bosId, limit, opts) {
    const ul = $(ulId);
    const bos = $(bosId);
    if (!ul) return;
    const silGoster = opts?.silGoster === true;
    let gruplar = gunlukIslemGruplari(liste);
    if (limit) gruplar = gruplar.slice(0, limit);
    if (!gruplar.length) {
      ul.innerHTML = '';
      if (bos) bos.hidden = false;
      return;
    }
    if (bos) bos.hidden = true;
    ul.innerHTML = gruplar.map((g) => gunlukGrupKartHtml(g, silGoster)).join('');
  }

  function sonIslemCiz() {
    const liste = gunlukBugunData?.islemler || [];
    gunlukListeCiz(liste, 'sonIslemListe', 'sonIslemBos', SON_ISLEM_ADET, { silGoster: true });
  }

  function navKartOzetGuncelle() {
    const oz = gunlukBugunData?.ozet || {};
    const islemSay = Number(oz.islemAdedi) || gunlukIslemGruplari(gunlukBugunData?.islemler || []).length;
    const islemEl = $('navBugunIslem');
    const ciroEl = $('navBugunCiro');
    if (islemEl) islemEl.textContent = `${islemSay} işlem`;
    const veresiyesiz =
      oz.toplamVeresiyesiz != null
        ? oz.toplamVeresiyesiz
        : Math.max(0, (Number(oz.toplam) || 0) - (Number(oz.veresiye) || 0));
    if (ciroEl) ciroEl.textContent = para(veresiyesiz || 0);

    const sepetEl = $('navSatisSepet');
    if (sepetEl) {
      if (!sepet.length) sepetEl.textContent = 'Sepet boş';
      else {
        const adet = sepet.reduce((t, s) => t + s.miktar, 0);
        sepetEl.textContent = `${adet} ürün · ${para(sepetToplamHesapla())}`;
      }
    }

    const tedSayEl = $('navTedarikciSayi');
    const tedBorcEl = $('navTedarikciBorc');
    const tedAdet = tedarikciCache.length;
    const tedBorc = tedarikciCache.reduce((t, x) => {
      const b = Number(x.Bakiye) || 0;
      return b > 0 ? t + b : t;
    }, 0);
    if (tedSayEl) tedSayEl.textContent = `${tedAdet} tedarikçi`;
    if (tedBorcEl) tedBorcEl.textContent = para(tedBorc);

    const stokEl = $('navStokSayi');
    const stokToplamEl = $('navStokToplam');
    const stokAdet = stokCache.length;
    const stokDeger = stokCache.reduce((t, s) => {
      const m = Number(s.MevcutMiktar) || 0;
      const f = Number(s.SatisFiyati) || 0;
      return t + m * f;
    }, 0);
    if (stokEl) stokEl.textContent = `${stokAdet} ürün`;
    if (stokToplamEl) stokToplamEl.textContent = para(stokDeger);

    const musEl = $('navMusteriSayi');
    const musBorcEl = $('navMusteriBorc');
    const musAdet = musteriCache.length;
    const toplamBorc = musteriCache.reduce((t, m) => {
      const b = Number(m.Bakiye) || 0;
      return b > 0 ? t + b : t;
    }, 0);
    if (musEl) musEl.textContent = `${musAdet} müşteri`;
    if (musBorcEl) musBorcEl.textContent = para(toplamBorc);
  }

  function kasaOzetGuncelle(oz) {
    const o = oz || {};
    const set = (id, val) => {
      const el = $(id);
      if (el) el.textContent = para(val);
    };
    const veresiyesiz =
      o.toplamVeresiyesiz != null
        ? o.toplamVeresiyesiz
        : Math.max(0, (Number(o.toplam) || 0) - (Number(o.veresiye) || 0));
    set('kzNakit', o.nakit);
    set('kzKart', o.kart);
    set('kzHavale', o.havale);
    set('kzToplamVeresiyesiz', veresiyesiz);
    set('kzToplam', o.toplam);
    set('kzKasaGiris', o.kasaGiris);
    navKartOzetGuncelle();
  }

  async function gunlukBugunYenile() {
    const bugun = bugunTarihStr();
    try {
      const qs = `?baslangic=${encodeURIComponent(bugun)}&bitis=${encodeURIComponent(bugun)}`;
      const res = await apiFetch(`/api/gunluk-islemler${qs}`);
      if (!res.ok) return;
      gunlukBugunData = await res.json();
      sonIslemCiz();
      const panelBugun = $('panel-bugun');
      const bugunAcik = panelBugun && !panelBugun.hidden;
      const bas = $('gunlukBas')?.value;
      const bit = $('gunlukBit')?.value;
      if (bugunAcik && bas === bugun && bit === bugun) {
        gunlukSonData = gunlukBugunData;
        kasaOzetGuncelle(gunlukBugunData.ozet);
        const sayEl = $('gunlukIslemSayi');
        const n = gunlukIslemGruplari(gunlukBugunData.islemler || []).length;
        if (sayEl) sayEl.textContent = n ? `${n} işlem` : '';
        gunlukListeCiz(gunlukBugunData.islemler, 'gunlukIslemListe', 'gunlukIslemBos', null, {
          silGoster: gunlukSilGosterMi(),
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  function gunlukTarihInputlariHazirla() {
    const bugun = bugunTarihStr();
    const bas = $('gunlukBas');
    const bit = $('gunlukBit');
    if (bas && !bas.value) bas.value = bugun;
    if (bit && !bit.value) bit.value = bugun;
  }

  async function gunlukVeriYukle(baslangic, bitis) {
    const bas = baslangic || $('gunlukBas')?.value || bugunTarihStr();
    const bit = bitis || $('gunlukBit')?.value || bas;
    try {
      const qs = `?baslangic=${encodeURIComponent(bas)}&bitis=${encodeURIComponent(bit)}`;
      const res = await apiFetch(`/api/gunluk-islemler${qs}`);
      if (!res.ok) return null;
      gunlukSonData = await res.json();
      kasaOzetGuncelle(gunlukSonData.ozet);
      return gunlukSonData;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async function bugunPanelYukle() {
    gunlukTarihInputlariHazirla();
    const bas = $('gunlukBas')?.value;
    const bit = $('gunlukBit')?.value;
    const ul = $('gunlukIslemListe');
    if (ul) ul.innerHTML = '<li class="bos-metin">Yükleniyor…</li>';
    const data = await gunlukVeriYukle(bas, bit);
    const liste = data?.islemler || [];
    const sayEl = $('gunlukIslemSayi');
    if (sayEl) {
      const n = gunlukIslemGruplari(liste).length;
      sayEl.textContent = n ? `${n} işlem` : '';
    }
    gunlukListeCiz(liste, 'gunlukIslemListe', 'gunlukIslemBos', null, { silGoster: gunlukSilGosterMi() });
  }

  async function gunlukSatisSil(logID) {
    const sifre = await silmeSifreOnayla(
      'Bu perakende satış silinecek. Stok ve kasa geri alınır.',
    );
    if (!sifre) return;
    try {
      const res = await apiFetch(`/api/gunluk-islem/${logID}/iptal`, {
        method: 'POST',
        body: JSON.stringify({
          kullaniciAdi: localStorage.getItem(LS_USER) || aktifKullanici,
          sifre,
          kullanici: aktifKullanici || 'Sistem',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Silinemedi');
        return;
      }
      toast(payload.message || 'Satış silindi');
      if (gunlukBugunData?.islemler) {
        gunlukBugunData.islemler = gunlukBugunData.islemler.filter(
          (r) => ![Number(r.LogID), Number(r.GrupLogID)].includes(logID),
        );
        sonIslemCiz();
        const panelBugun = $('panel-bugun');
        if (panelBugun && !panelBugun.hidden) {
          const n = gunlukIslemGruplari(gunlukBugunData.islemler).length;
          const sayEl = $('gunlukIslemSayi');
          if (sayEl) sayEl.textContent = n ? `${n} işlem` : '';
          gunlukListeCiz(
            gunlukBugunData.islemler,
            'gunlukIslemListe',
            'gunlukIslemBos',
            null,
            { silGoster: gunlukSilGosterMi() },
          );
        }
      }
      await veriYukle();
      if (detayMusteriID) await musteriDetayAc(detayMusteriID, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function gunlukPerakendeDuzenle(logID) {
    const id = parseInt(logID, 10);
    if (!Number.isInteger(id) || id < 1) return;
    try {
      const res = await apiFetch(`/api/gunluk-islem/${id}/detay`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || 'Detay alınamadı');
        return;
      }
      if (!data.duzenleEdilebilir && !data.iptalEdilebilir) {
        toast(data.musterili ? 'Müşteri carisinden düzenleyin' : 'Bu perakende satış düzenlenemez');
        return;
      }
      const detaylar = data.detaylar || [];
      if (!detaylar.length) {
        toast('Kalem detayı bulunamadı');
        return;
      }
      sepet = detaylar.map((d) => ({
        stokID: Number(d.StokID) || 0,
        stokDisi: !(Number(d.StokID) > 0),
        urunAdi: d.UrunAdi || '-',
        birimFiyat: Number(d.BirimFiyat) || 0,
        miktar: Math.max(1, Number(d.Miktar) || 1),
      }));
      _gunlukDuzenleLogID = id;
      sepetCiz();
      const toplam = Math.round(sepetToplamHesapla() * 100) / 100;
      $('dlgSatisToplam').textContent = para(toplam);
      const tah = data.tahsilatTutar != null ? Number(data.tahsilatTutar) : toplam;
      $('satisTahsilat').value = tah.toFixed(2);
      satisMusteriTemizle();
      document.querySelector('#formSatis input[name="satisMusteriModu"][value="perakende"]').checked = true;
      const odeme = data.odeme || 'Nakit';
      const odemeRadio = document.querySelector(`#formSatis input[name="odemeTipi"][value="${odeme}"]`);
      if (odemeRadio) odemeRadio.checked = true;
      satisMusteriModuUygula();
      const baslik = $('dlgSatisBaslik');
      if (baslik) baslik.textContent = 'Perakende düzenle';
      const kaydetBtn = $('btnSatisKaydet');
      if (kaydetBtn) kaydetBtn.textContent = 'Kaydet';
      anaSayfaGoster();
      $('dlgSatis').showModal();
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function gunlukPerakendeDuzenleSifirla() {
    _gunlukDuzenleLogID = null;
    const baslik = $('dlgSatisBaslik');
    if (baslik) baslik.textContent = 'Satışı onayla';
    const kaydetBtn = $('btnSatisKaydet');
    if (kaydetBtn) kaydetBtn.textContent = 'Kaydet';
  }

  async function gunlukKasaYukle() {
    await gunlukBugunYenile();
  }

  function cikisYap() {
    barkodTaraKapat();
    sepet = [];
    stokCache = [];
    stokCacheSirali = [];
    stokIndeksMap = new Map();
    stokBarkodMap = new Map();
    musteriCache = [];
    tedarikciCache = [];
    detayMusteriID = null;
    detayTedarikciID = null;
    detayTedarikciData = null;
    tedAlimSepet = [];
    satisHedefMusteriID = null;
    sirketAyarlar = null;
    sepetCiz();
    showView('login');
  }

  async function sirketAyarlarYukle() {
    if (sirketAyarlar) return sirketAyarlar;
    try {
      const res = await apiFetch('/api/ayarlar');
      if (res.ok) sirketAyarlar = await res.json();
    } catch (e) {
      console.error(e);
    }
    return sirketAyarlar || {};
  }

  function isletmeKurumAdi() {
    return String(sirketAyarlar?.SirketUnvan || 'Elektrik Otomasyon').trim() || 'Elektrik Otomasyon';
  }

  async function veriYukle() {
    try {
      const [stokRes, musRes, tedRes] = await Promise.all([
        apiFetch('/api/stok'),
        apiFetch('/api/musteri'),
        apiFetch('/api/tedarikci'),
      ]);
      await sirketAyarlarYukle();
      stokCache = stokRes.ok ? await stokRes.json() : [];
      stokCacheIndeksle();
      musteriCache = musRes.ok ? await musRes.json() : [];
      tedarikciCache = tedRes.ok ? await tedRes.json() : [];
      stokListele();
      musteriListele();
      await gunlukKasaYukle();
      navKartOzetGuncelle();
    } catch (e) {
      console.error(e);
      toast('Veri yüklenemedi');
    }
  }

  /* ——— Sepet ——— */
  function sepetToplamHesapla() {
    return sepet.reduce((t, s) => t + s.birimFiyat * s.miktar, 0);
  }

  function satisAramaTemizle() {
    const arama = $('satisArama');
    if (arama) arama.value = '';
    const box = $('satisAramaSonuc');
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  function sepeteEkle(urun) {
    const id = Number(urun.StokID) || 0;
    const bf = Number(urun.SatisFiyati) || 0;
    if (!id || urun.stokDisi) {
      sepet.push({
        stokID: 0,
        stokDisi: true,
        urunAdi: String(urun.UrunAdi || '').trim() || 'Stok dışı',
        miktar: Math.max(1, Math.round(Number(urun.miktar) || 1)),
        birimFiyat: Math.round(bf * 100) / 100,
        birim: 'Adet',
      });
      satisAramaTemizle();
      sepetCiz();
      return;
    }
    const mevcut = sepet.find((s) => s.stokID === id && !s.stokDisi);
    if (mevcut) {
      mevcut.miktar += 1;
    } else {
      sepet.push({
        stokID: id,
        urunAdi: urun.UrunAdi,
        miktar: 1,
        birimFiyat: bf,
        birim: urun.Birim || 'Adet',
      });
    }
    satisAramaTemizle();
    sepetCiz();
  }

  const ISCILIK_ACIKLAMA = 'İŞÇİLİK BEDELİ';

  function stokHizmetMi(stok) {
    const kat = String(stok?.Kategori || '').trim().toLocaleLowerCase('tr-TR');
    const ad = String(stok?.UrunAdi || stok?.urunAdi || '').trim().toLocaleLowerCase('tr-TR');
    if (kat === 'hizmet') return true;
    return ad.includes('işçilik') || ad.includes('iscilik') || ad === 'işçilik bedeli';
  }

  function sepetDisiRozetHtml(s) {
    if (!(s?.stokDisi || !(Number(s?.stokID) > 0))) return '';
    if (stokHizmetMi(s)) {
      return ' <span class="sepet-ad-stok-disi sepet-ad-hizmet">Hizmet</span>';
    }
    return ' <span class="sepet-ad-stok-disi">Stok dışı</span>';
  }

  let _stokDisiHedef = 'sepet';

  function stokDisiSablonUygula(sablon) {
    const ad = $('stokDisiAciklama');
    const tutar = $('stokDisiTutar');
    const baslik = $('dlgStokDisiBaslik');
    const alt = $('dlgStokDisiAlt');
    if (sablon === 'iscilik') {
      if (ad) ad.value = ISCILIK_ACIKLAMA;
      if (baslik) baslik.textContent = 'İşçilik ekle';
      if (alt) alt.textContent = 'Stoka yazılmaz — sadece tutarı girin.';
      setTimeout(() => tutar?.focus(), 120);
    } else {
      if (ad) ad.value = '';
      if (baslik) baslik.textContent = 'Stok dışı ekle';
      if (alt) alt.textContent = 'Stoka yazılmaz; sadece satışa eklenir.';
      setTimeout(() => ad?.focus(), 120);
    }
    if (tutar && sablon === 'iscilik') tutar.value = '';
  }

  function stokDisiDialogAc(hedef = 'sepet', sablon = '') {
    _stokDisiHedef = hedef === 'musteri' ? 'musteri' : 'sepet';
    const tutar = $('stokDisiTutar');
    if (tutar) tutar.value = '';
    $('dlgStokDisi')?.showModal();
    stokDisiSablonUygula(sablon === 'iscilik' ? 'iscilik' : (sablon === 'diger' ? 'diger' : ''));
    if (!sablon) {
      const baslik = $('dlgStokDisiBaslik');
      const alt = $('dlgStokDisiAlt');
      const ad = $('stokDisiAciklama');
      if (baslik) baslik.textContent = 'Manuel ekle';
      if (alt) alt.textContent = 'İşçilik veya stok dışı — stoka yazılmaz.';
      if (ad) ad.value = '';
      setTimeout(() => $('stokDisiKisayol')?.querySelector('[data-stok-disi-sablon="iscilik"]')?.focus(), 120);
    }
  }

  function stokDisiKaydet(ev) {
    ev.preventDefault();
    const ad = ($('stokDisiAciklama')?.value || '').trim();
    const tutar = parseFloat(String($('stokDisiTutar')?.value || '').replace(',', '.'));
    if (!ad) {
      toast('Açıklama girin');
      $('stokDisiAciklama')?.focus();
      return;
    }
    if (!Number.isFinite(tutar) || tutar < 0) {
      toast('Geçerli tutar girin');
      $('stokDisiTutar')?.focus();
      return;
    }
    const kalem = {
      StokID: 0,
      stokDisi: true,
      UrunAdi: ad.substring(0, 150),
      SatisFiyati: Math.round(tutar * 100) / 100,
      miktar: 1,
    };
    if (_stokDisiHedef === 'musteri') musteriSatisSepeteEkle(kalem);
    else sepeteEkle(kalem);
    $('dlgStokDisi')?.close();
    toast(ad.toLocaleUpperCase('tr-TR').includes('İŞÇİLİK') || ad.toLocaleUpperCase('tr-TR').includes('ISCILIK')
      ? 'İşçilik sepete eklendi'
      : 'Stok dışı sepete eklendi');
  }

  function sepetSatirFiyatGuncelle(idx, val) {
    const f = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(f) || f < 0 || !sepet[idx]) return;
    sepet[idx].birimFiyat = Math.round(f * 100) / 100;
    sepetCiz();
  }

  function musteriSatisSepetSatirFiyatGuncelle(idx, val) {
    const f = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(f) || f < 0 || !musteriSatisSepet[idx]) return;
    musteriSatisSepet[idx].birimFiyat = Math.round(f * 100) / 100;
    musteriSatisSepetCiz();
    musteriSatisTahsilatGuncelle();
  }

  function sepetCiz() {
    const ul = $('sepetListe');
    const bos = $('sepetBos');
    const toplam = Math.round(sepetToplamHesapla() * 100) / 100;
    ul.innerHTML = '';
    if (sepet.length === 0) {
      bos.hidden = false;
      $('btnSatisTamamla').disabled = true;
    } else {
      bos.hidden = true;
      $('btnSatisTamamla').disabled = false;
      sepet.forEach((s, idx) => {
        const li = document.createElement('li');
        li.className = 'sepet-satir';
        const satirTutar = Math.round(s.birimFiyat * s.miktar * 100) / 100;
        const disiRozet = sepetDisiRozetHtml(s);
        li.innerHTML = `
          <span class="sepet-ad">${esc(s.urunAdi)}${disiRozet}</span>
          <div class="sepet-satir-kontroller">
            <label class="sepet-fiyat-wrap">
              <span class="sepet-fiyat-label">₺</span>
              <input type="number" class="sepet-fiyat-input" min="0" step="0.01" inputmode="decimal"
                value="${s.birimFiyat.toFixed(2)}" data-fiyat="${idx}" aria-label="Birim fiyat">
            </label>
            <div class="sepet-miktar-wrap">
              <button type="button" class="sepet-miktar-btn" data-az="${idx}">−</button>
              <span class="sepet-miktar">${s.miktar}</span>
              <button type="button" class="sepet-miktar-btn" data-art="${idx}">+</button>
              <button type="button" class="sepet-miktar-duzenle" data-mik-duz="${idx}" title="Adet gir" aria-label="Adet gir">✎</button>
            </div>
            <span class="sepet-satir-tutar">${para(satirTutar)}</span>
            <button type="button" class="sepet-sil" data-sil="${idx}" aria-label="Sil">×</button>
          </div>`;
        ul.appendChild(li);
      });
      ul.querySelectorAll('[data-fiyat]').forEach((inp) => {
        const guncelle = () => sepetSatirFiyatGuncelle(+inp.dataset.fiyat, inp.value);
        inp.addEventListener('change', guncelle);
        inp.addEventListener('blur', guncelle);
      });
      ul.querySelectorAll('[data-az]').forEach((btn) => {
        btn.onclick = () => {
          const i = +btn.dataset.az;
          if (sepet[i].miktar > 1) sepet[i].miktar -= 1;
          else sepet.splice(i, 1);
          sepetCiz();
        };
      });
      ul.querySelectorAll('[data-art]').forEach((btn) => {
        btn.onclick = () => { sepet[+btn.dataset.art].miktar += 1; sepetCiz(); };
      });
      ul.querySelectorAll('[data-mik-duz]').forEach((btn) => {
        btn.onclick = () => sepetMiktarManuelAc(+btn.dataset.mikDuz, 'satis');
      });
      ul.querySelectorAll('[data-sil]').forEach((btn) => {
        btn.onclick = () => { sepet.splice(+btn.dataset.sil, 1); sepetCiz(); };
      });
    }
    $('sepetToplam').textContent = para(toplam);
    navKartOzetGuncelle();
  }

  function stokYokSoruKarti(box, kelime, hedef) {
    if (!box) return;
    const k = String(kelime || '').trim();
    box.innerHTML = '';
    if (k.length < 2) {
      box.hidden = true;
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'arama-item arama-item-stok-yok';
    btn.innerHTML = `
      <span class="arama-stok-yok-baslik">Stoğa eklensin mi?</span>
      <span class="arama-item-alt">"${esc(k)}" — kaydedince sepete eklenir</span>`;
    btn.onclick = () => stokYokModalAc(k, hedef);
    box.appendChild(btn);
    box.hidden = false;
  }

  function satisAramaGoster(q) {
    const box = $('satisAramaSonuc');
    const trimmed = String(q || '').trim();
    if (!trimmed) {
      box.hidden = true;
      if ($('dlgStokYok')?.open) $('dlgStokYok').close();
      return;
    }
    const { liste: filtre } = stokAraFiltrele(trimmed, 25, { hizmetHaric: true });
    if (/^\d+$/.test(trimmed) && filtre.length === 1 && String(filtre[0].Barkod || '').trim() === trimmed) {
      sepeteEkle(filtre[0]);
      return;
    }
    if (/^\d+$/.test(trimmed) && filtre.length === 1) {
      sepeteEkle(filtre[0]);
      return;
    }
    box.innerHTML = '';
    if (filtre.length === 0) {
      if ($('dlgStokYok')?.open) $('dlgStokYok').close();
      stokYokSoruKarti(box, trimmed, 'satis');
      return;
    }
    if ($('dlgStokYok')?.open) $('dlgStokYok').close();
    filtre.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arama-item';
      btn.innerHTML = `<span><span>${esc(u.UrunAdi)}</span><span class="arama-item-alt">Stok: ${u.MevcutMiktar} ${esc(u.Birim || 'Adet')}</span></span><span class="arama-item-fiyat">${para(u.SatisFiyati)}</span>`;
      btn.onclick = () => sepeteEkle(u);
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function satisMusteriModuMu() {
    const el = document.querySelector('#formSatis input[name="satisMusteriModu"]:checked');
    return el ? el.value === 'musteri' : false;
  }

  function satisMusteriModuUygula() {
    const musteriMod = satisMusteriModuMu();
    const blok = $('satisMusteriBlok');
    const tahsilatBlok = $('satisTahsilatBlok');
    if (blok) blok.hidden = !musteriMod;
    if (!musteriMod) satisMusteriTemizle();
    const odemeEl = document.querySelector('#formSatis input[name="odemeTipi"]:checked');
    const veresiye = odemeEl && odemeEl.value === 'Veresiye';
    if (tahsilatBlok) tahsilatBlok.hidden = veresiye;
  }

  function satisMusteriSec(m) {
    if (!m) return;
    $('satisMusteriID').value = m.MusteriID;
    $('satisMusteriAra').value = musteriGorunenAd(m);
    $('satisMusteriSecili').textContent = `Seçili: ${musteriGorunenAd(m)}`;
    $('satisMusteriSecili').hidden = false;
    $('satisMusteriSonuc').hidden = true;
    document.querySelector('#formSatis input[name="satisMusteriModu"][value="musteri"]').checked = true;
    satisMusteriModuUygula();
  }

  function satisMusteriTemizle() {
    $('satisMusteriID').value = '';
    $('satisMusteriAra').value = '';
    $('satisMusteriSecili').hidden = true;
    $('satisMusteriSonuc').hidden = true;
  }

  function yeniSatisModalAc() {
    const dlg = $('dlgYeniSatis');
    if (!dlg) return;
    satisPanelHazirla();
    sepetCiz();
    if (!dlg.open) dlg.showModal();
    setTimeout(() => $('satisArama')?.focus(), 80);
  }

  function yeniSatisModalKapat() {
    barkodTaraKapat();
    const dlg = $('dlgYeniSatis');
    if (dlg?.open) dlg.close();
  }

  function satisDialogAc() {
    if (sepet.length === 0) return;
    const toplam = Math.round(sepetToplamHesapla() * 100) / 100;
    $('dlgSatisToplam').textContent = para(toplam);
    $('satisTahsilat').value = toplam.toFixed(2);
    const notEl = $('satisOzelNot');
    if (notEl) notEl.value = '';
    satisMusteriTemizle();
    document.querySelector('#formSatis input[name="satisMusteriModu"][value="perakende"]').checked = true;
    document.querySelector('#formSatis input[name="odemeTipi"][value="Nakit"]').checked = true;
    satisMusteriModuUygula();
    if (satisHedefMusteriID) {
      const m = musteriCache.find((x) => x.MusteriID === satisHedefMusteriID)
        || (detayMusteriData?.musteri?.MusteriID === satisHedefMusteriID ? detayMusteriData.musteri : null);
      if (m) satisMusteriSec(m);
      satisHedefMusteriID = null;
    }
    $('dlgSatis').showModal();
  }

  function musteriSatisSepetToplam() {
    return musteriSatisSepet.reduce((t, s) => t + s.birimFiyat * s.miktar, 0);
  }

  function musteriSatisSepetCiz() {
    const ul = $('musteriSatisSepetListe');
    const bos = $('musteriSatisSepetBos');
    const btn = $('btnMusteriSatisKaydet');
    const toplam = Math.round(musteriSatisSepetToplam() * 100) / 100;
    if (!ul) return;
    ul.innerHTML = '';
    if (!musteriSatisSepet.length) {
      if (bos) bos.hidden = false;
      if (btn) btn.disabled = true;
    } else {
      if (bos) bos.hidden = true;
      if (btn) btn.disabled = false;
      musteriSatisSepet.forEach((s, idx) => {
        const li = document.createElement('li');
        li.className = 'sepet-satir';
        const satirTutar = Math.round(s.birimFiyat * s.miktar * 100) / 100;
        const disiRozet = sepetDisiRozetHtml(s);
        li.innerHTML = `
          <span class="sepet-ad">${esc(s.urunAdi)}${disiRozet}</span>
          <div class="sepet-satir-kontroller">
            <label class="sepet-fiyat-wrap">
              <span class="sepet-fiyat-label">₺</span>
              <input type="number" class="sepet-fiyat-input" min="0" step="0.01" inputmode="decimal"
                value="${s.birimFiyat.toFixed(2)}" data-ms-fiyat="${idx}" aria-label="Birim fiyat">
            </label>
            <div class="sepet-miktar-wrap">
              <button type="button" class="sepet-miktar-btn" data-ms-az="${idx}">−</button>
              <span class="sepet-miktar">${s.miktar}</span>
              <button type="button" class="sepet-miktar-btn" data-ms-art="${idx}">+</button>
              <button type="button" class="sepet-miktar-duzenle" data-ms-mik-duz="${idx}" title="Adet gir" aria-label="Adet gir">✎</button>
            </div>
            <span class="sepet-satir-tutar">${para(satirTutar)}</span>
            <button type="button" class="sepet-sil" data-ms-sil="${idx}" aria-label="Sil">×</button>
          </div>`;
        ul.appendChild(li);
      });
      ul.querySelectorAll('[data-ms-fiyat]').forEach((inp) => {
        const guncelle = () => musteriSatisSepetSatirFiyatGuncelle(+inp.dataset.msFiyat, inp.value);
        inp.addEventListener('change', guncelle);
        inp.addEventListener('blur', guncelle);
      });
      ul.querySelectorAll('[data-ms-az]').forEach((b) => {
        b.onclick = () => {
          const i = +b.dataset.msAz;
          if (musteriSatisSepet[i].miktar > 1) musteriSatisSepet[i].miktar -= 1;
          else musteriSatisSepet.splice(i, 1);
          musteriSatisSepetCiz();
          musteriSatisTahsilatGuncelle();
        };
      });
      ul.querySelectorAll('[data-ms-art]').forEach((b) => {
        b.onclick = () => { musteriSatisSepet[+b.dataset.msArt].miktar += 1; musteriSatisSepetCiz(); musteriSatisTahsilatGuncelle(); };
      });
      ul.querySelectorAll('[data-ms-mik-duz]').forEach((b) => {
        b.onclick = () => sepetMiktarManuelAc(+b.dataset.msMikDuz, 'musteri');
      });
      ul.querySelectorAll('[data-ms-sil]').forEach((b) => {
        b.onclick = () => { musteriSatisSepet.splice(+b.dataset.msSil, 1); musteriSatisSepetCiz(); musteriSatisTahsilatGuncelle(); };
      });
    }
    const topEl = $('musteriSatisToplam');
    if (topEl) topEl.textContent = para(toplam);
  }

  function musteriSatisSepeteEkle(urun) {
    const id = Number(urun.StokID) || 0;
    const bf = Number(urun.SatisFiyati) || 0;
    if (!id || urun.stokDisi) {
      musteriSatisSepet.push({
        stokID: 0,
        stokDisi: true,
        urunAdi: String(urun.UrunAdi || '').trim() || 'Stok dışı',
        miktar: Math.max(1, Math.round(Number(urun.miktar) || 1)),
        birimFiyat: Math.round(bf * 100) / 100,
        birim: 'Adet',
      });
    } else {
      const mevcut = musteriSatisSepet.find((s) => s.stokID === id && !s.stokDisi);
      if (mevcut) mevcut.miktar += 1;
      else {
        musteriSatisSepet.push({
          stokID: id,
          urunAdi: urun.UrunAdi,
          miktar: 1,
          birimFiyat: bf,
          birim: urun.Birim || 'Adet',
        });
      }
    }
    $('musteriSatisArama').value = '';
    const box = $('musteriSatisAramaSonuc');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    musteriSatisSepetCiz();
    musteriSatisTahsilatGuncelle();
  }

  function musteriSatisAramaGoster(q) {
    const box = $('musteriSatisAramaSonuc');
    const trimmed = String(q || '').trim();
    if (!box) return;
    if (!trimmed) {
      box.hidden = true;
      box.innerHTML = '';
      if ($('dlgStokYok')?.open) $('dlgStokYok').close();
      return;
    }
    const { liste: filtre } = stokAraFiltrele(trimmed, 15, { hizmetHaric: true });
    box.innerHTML = '';
    if (!filtre.length) {
      if ($('dlgStokYok')?.open) $('dlgStokYok').close();
      stokYokSoruKarti(box, trimmed, 'musteri-satis');
      return;
    }
    if ($('dlgStokYok')?.open) $('dlgStokYok').close();
    filtre.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arama-item';
      btn.innerHTML = `<span><span>${esc(u.UrunAdi)}</span><span class="arama-item-alt">${para(u.SatisFiyati)}</span></span>`;
      btn.onclick = () => musteriSatisSepeteEkle(u);
      box.appendChild(btn);
    });
    box.hidden = false;
  }

  function musteriSatisTahsilatGuncelle() {
    const odemeEl = document.querySelector('#formMusteriSatis input[name="musteriSatisOdeme"]:checked');
    const odemeTipi = odemeEl ? odemeEl.value : 'Nakit';
    const veresiye = odemeTipi === 'Veresiye';
    const blok = $('musteriSatisTahsilatBlok');
    if (blok) blok.hidden = veresiye;
    const toplam = Math.round(musteriSatisSepetToplam() * 100) / 100;
    const t = $('musteriSatisTahsilat');
    if (!t) return;
    if (veresiye) t.value = '0';
    else if (toplam > 0) t.value = toplam.toFixed(2);
  }

  function musteriHareketDuzenleSifirla() {
    _musteriHareketDuzenleID = null;
    _musteriHareketDuzenleTip = null;
    const baslik = $('dlgMusteriSatisBaslik');
    if (baslik) baslik.textContent = 'Müşteriye satış';
    const odemeBaslik = $('dlgOdemeBaslik');
    if (odemeBaslik) odemeBaslik.textContent = 'Tahsilat';
    const odemeGrup = document.querySelector('#formMusteriSatis .odeme-grup');
    if (odemeGrup) odemeGrup.hidden = false;
    const tahBlok = $('musteriSatisTahsilatBlok');
    if (tahBlok) tahBlok.hidden = false;
  }

  function musteriSatisOdemeAlanGoster(goster) {
    const odemeGrup = document.querySelector('#formMusteriSatis .odeme-grup');
    if (odemeGrup) odemeGrup.hidden = !goster;
    const tahBlok = $('musteriSatisTahsilatBlok');
    if (tahBlok) tahBlok.hidden = !goster;
  }

  async function musteriHareketDuzenleAc(hareketID, tip) {
    const id = Number(hareketID);
    const tipNorm = String(tip || '').toLowerCase();
    if (!Number.isInteger(id) || id < 1) return;
    if (tipNorm !== 'satis' && tipNorm !== 'odeme') return;
    try {
      const res = await apiFetch(`/api/musteri/hareket/${id}/detay`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || 'Hareket bilgisi alınamadı');
        return;
      }
      const h = data.hareket || {};
      const detaylar = data.detaylar || [];
      const m = musteriCache.find((x) => x.MusteriID === detayMusteriID) || detayMusteriData?.musteri;

      if (tipNorm === 'satis') {
        musteriSatisSepet = (detaylar.length ? detaylar : []).map((d) => ({
          detayID: Number(d.DetayID) || 0,
          stokID: Number(d.StokID) || 0,
          stokDisi: !(Number(d.StokID) > 0),
          urunAdi: d.UrunAdi || '—',
          birimFiyat: Math.round((Number(d.BirimFiyat) || 0) * 100) / 100,
          miktar: Math.max(1, Math.round(Number(d.Miktar) || 1)),
        }));
        if (!musteriSatisSepet.length) {
          const toplam = Number(h.ToplamTutar) || 0;
          musteriSatisSepet = [{
            detayID: 0,
            stokID: 0,
            urunAdi: 'Satış',
            birimFiyat: Math.round(toplam * 100) / 100,
            miktar: 1,
          }];
        }
        _musteriHareketDuzenleID = id;
        _musteriHareketDuzenleTip = 'satis';
        $('dlgMusteriSatisAd').textContent = musteriGorunenAd(m || { AdSoyad: 'Müşteri' });
        $('musteriSatisArama').value = '';
        const box = $('musteriSatisAramaSonuc');
        if (box) { box.hidden = true; box.innerHTML = ''; }
        const notEl = $('musteriSatisOzelNot');
        if (notEl) notEl.value = hareketOzelNot(h);
        const baslik = $('dlgMusteriSatisBaslik');
        if (baslik) baslik.textContent = 'Satışı düzenle';
        musteriSatisOdemeAlanGoster(false);
        musteriSatisSepetCiz();
        $('dlgMusteriSatis').showModal();
        return;
      }

      _musteriHareketDuzenleID = id;
      _musteriHareketDuzenleTip = 'odeme';
      $('dlgOdemeMusteri').textContent = musteriGorunenAd(m || { AdSoyad: 'Müşteri' });
      const borcEl = $('dlgOdemeBorc');
      if (borcEl) borcEl.textContent = 'Tahsilat tutarını düzenleyin';
      $('odemeTutar').value = Number(h.OdenenTutar || h.ToplamTutar || 0).toFixed(2);
      const sekil = String(h.OdemeSekli || 'Nakit');
      const sekilEl = $('odemeSekli');
      if (sekilEl) sekilEl.value = ['Nakit', 'Kart', 'Havale'].includes(sekil) ? sekil : 'Nakit';
      const notEl = $('odemeAciklama');
      if (notEl) notEl.value = '';
      const odemeBaslik = $('dlgOdemeBaslik');
      if (odemeBaslik) odemeBaslik.textContent = 'Tahsilatı düzenle';
      $('dlgOdeme').showModal();
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function musteriDetaySatisAc() {
    const m = musteriCache.find((x) => x.MusteriID === detayMusteriID) || detayMusteriData?.musteri;
    if (!m) {
      toast('Müşteri bilgisi yüklenemedi');
      return;
    }
    musteriHareketDuzenleSifirla();
    musteriSatisSepet = [];
    $('dlgMusteriSatisAd').textContent = musteriGorunenAd(m);
    $('musteriSatisArama').value = '';
    const box = $('musteriSatisAramaSonuc');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const nakit = document.querySelector('#formMusteriSatis input[name="musteriSatisOdeme"][value="Nakit"]');
    if (nakit) nakit.checked = true;
    musteriSatisOdemeAlanGoster(true);
    musteriSatisSepetCiz();
    musteriSatisTahsilatGuncelle();
    const notEl = $('musteriSatisOzelNot');
    if (notEl) notEl.value = '';
    $('dlgMusteriSatis').showModal();
    setTimeout(() => $('musteriSatisArama')?.focus(), 200);
  }

  async function musteriSatisKaydet(ev) {
    ev.preventDefault();
    if (!detayMusteriID) return;
    if (!musteriSatisSepet.length) {
      toast('Sepete ürün ekleyin');
      return;
    }
    const duzenleMod = Number.isInteger(_musteriHareketDuzenleID)
      && _musteriHareketDuzenleID > 0
      && _musteriHareketDuzenleTip === 'satis';
    const ozelNot = ($('musteriSatisOzelNot')?.value || '').trim();

    if (duzenleMod) {
      const kalemler = musteriSatisSepet.map((s) => {
        const miktar = Math.max(1, Math.round(Number(s.miktar) || 1));
        const birimFiyat = Math.round((Number(s.birimFiyat) || 0) * 100) / 100;
        return {
          detayID: Number(s.detayID) || 0,
          stokID: Number(s.stokID) || 0,
          urunID: Number(s.stokID) || 0,
          urunAdi: s.urunAdi || '',
          miktar,
          birimFiyat,
          satirTutar: Math.round(miktar * birimFiyat * 100) / 100,
        };
      });
      try {
        const res = await apiFetch(`/api/musteri/hareket/${_musteriHareketDuzenleID}/duzenle`, {
          method: 'PATCH',
          body: JSON.stringify({
            tip: 'satis',
            kalemler,
            ozelNot,
            kullanici: aktifKullanici,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.success) {
          $('dlgMusteriSatis').close();
          musteriSatisSepet = [];
          musteriHareketDuzenleSifirla();
          toast(payload.message || 'Satış güncellendi');
          await veriYukle();
          await gunlukKasaYukle();
          await musteriDetayAc(detayMusteriID, true);
        } else {
          toast(payload.message || 'Güncellenemedi');
        }
      } catch (e) {
        console.error(e);
        toast('Bağlantı hatası');
      }
      return;
    }

    const odemeEl = document.querySelector('#formMusteriSatis input[name="musteriSatisOdeme"]:checked');
    const odemeTipi = odemeEl ? odemeEl.value : 'Nakit';
    const sepetToplam = Math.round(musteriSatisSepetToplam() * 100) / 100;
    let tahsilatTutar = parseFloat($('musteriSatisTahsilat').value);
    if (!Number.isFinite(tahsilatTutar) || tahsilatTutar < 0) {
      toast('Geçerli tahsilat tutarı girin');
      return;
    }
    tahsilatTutar = Math.round(tahsilatTutar * 100) / 100;
    if (odemeTipi === 'Veresiye') tahsilatTutar = 0;
    else if (tahsilatTutar > sepetToplam) {
      toast('Tahsilat sepet toplamını geçemez');
      return;
    }
    const kalemler = musteriSatisSepet.map((s) => ({
      urunID: s.stokID > 0 ? s.stokID : 0,
      miktar: s.miktar,
      birimFiyat: s.birimFiyat,
      urunAdi: s.urunAdi,
      stokDisi: !!(s.stokDisi || !(s.stokID > 0)),
    }));
    try {
      const res = await apiFetch('/api/satis-sepet', {
        method: 'POST',
        body: JSON.stringify({
          kalemler,
          kullanici: aktifKullanici,
          odemeTipi,
          tahsilatTutar,
          musteriID: detayMusteriID,
          ozelNot: ozelNot || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success) {
        $('dlgMusteriSatis').close();
        musteriSatisSepet = [];
        toast('Satış kaydedildi');
        await veriYukle();
        await gunlukKasaYukle();
        await musteriDetayAc(detayMusteriID, true);
      } else {
        toast(payload.message || 'Satış tamamlanamadı');
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function satisMusteriAraGoster(q) {
    const box = $('satisMusteriSonuc');
    const trimmed = String(q || '').trim();
    const trimmedLo = trimmed.toLocaleLowerCase('tr-TR');
    $('satisMusteriID').value = '';
    $('satisMusteriSecili').hidden = true;
    if (!trimmed) {
      box.hidden = true;
      return;
    }
    const filtre = musteriCache.filter((m) => {
      const ad = musteriGorunenAd(m).toLocaleLowerCase('tr-TR');
      const tel = String(m.Telefon || '').toLowerCase();
      const lakap = musteriLakap(m).toLocaleLowerCase('tr-TR');
      return ad.includes(trimmedLo) || tel.includes(trimmedLo) || lakap.includes(trimmedLo) || String(m.MusteriID).includes(trimmed);
    }).slice(0, 15);
    box.innerHTML = '';
    filtre.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arama-item';
      btn.innerHTML = `<span>${esc(musteriGorunenAd(m))}<span class="arama-item-alt">${esc(musteriAltKimlik(m))}</span></span>`;
      btn.onclick = () => satisMusteriSec(m);
      box.appendChild(btn);
    });
    if (filtre.length === 0 && trimmed.length >= 2) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arama-item arama-item-yeni';
      btn.textContent = `+ "${trimmed}" yeni müşteri olarak ekle`;
      btn.onclick = () => {
        $('yeniMusteriAd').value = trimmed.replace(/^\d+$/, '') ? trimmed : '';
        $('yeniMusteriTel').value = /^\d{10,11}$/.test(trimmed.replace(/\D/g, ''))
          ? trimmed.replace(/\D/g, '').replace(/^0/, '')
          : '';
        musteriEkleDialogAc('satis');
      };
      box.appendChild(btn);
    }
    box.hidden = filtre.length === 0 && trimmed.length < 2;
    if (filtre.length > 0 || trimmed.length >= 2) box.hidden = false;
  }

  function musteriEkleDialogAc(kaynak = 'liste') {
    musteriEkleKaynak = kaynak === 'satis' ? 'satis' : 'liste';
    $('yeniMusteriAd').value = '';
    $('yeniMusteriTel').value = '';
    const btn = $('btnMusteriEkleKaydet');
    if (btn) btn.textContent = musteriEkleKaynak === 'satis' ? 'Kaydet ve seç' : 'Kaydet';
    $('dlgMusteriEkle').showModal();
    setTimeout(() => $('yeniMusteriAd')?.focus(), 200);
  }

  async function musteriHizliEkle(ev) {
    ev.preventDefault();
    const ad = ($('yeniMusteriAd').value || '').trim();
    let tel = ($('yeniMusteriTel').value || '').replace(/\D/g, '');
    if (tel.startsWith('0')) tel = tel.slice(1);
    if (!ad) {
      toast('Ad soyad girin');
      return;
    }
    if (tel && !/^[1-9][0-9]{9}$/.test(tel)) {
      toast('Telefon 10 hane olmalı (0 olmadan)');
      return;
    }
    try {
      const res = await apiFetch('/api/musteri', {
        method: 'POST',
        body: JSON.stringify({ AdSoyad: ad, Telefon: tel || null, tur: 'Gercek' }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) {
        toast(payload.message || 'Müşteri eklenemedi');
        return;
      }
      const musRes = await apiFetch('/api/musteri');
      musteriCache = musRes.ok ? await musRes.json() : musteriCache;
      let yeni = null;
      if (payload.musteriID) {
        yeni = musteriCache.find((m) => m.MusteriID === payload.musteriID);
      }
      if (!yeni) {
        yeni = musteriCache.find((m) => musteriGorunenAd(m) === ad)
          || (tel ? musteriCache.find((m) => String(m.Telefon || '') === tel) : null);
      }
      $('dlgMusteriEkle').close();
      musteriListele();
      navKartOzetGuncelle();
      if (musteriEkleKaynak === 'satis') {
        if (yeni) {
          satisMusteriSec(yeni);
          toast('Müşteri eklendi');
        } else {
          toast('Müşteri eklendi — listeden seçin');
          satisMusteriAraGoster(ad);
        }
      } else {
        toast('Müşteri eklendi');
        const yeniId = Number(payload.musteriID || yeni?.MusteriID);
        if (Number.isInteger(yeniId) && yeniId > 0) {
          musteriDetayDonusPanel = 'musteri';
          await musteriDetayAc(yeniId);
        } else {
          panelGoster('musteri');
        }
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function musteriDuzenleDialogAc() {
    const m = detayMusteriData?.musteri;
    if (!m || !detayMusteriID) {
      toast('Müşteri bulunamadı');
      return;
    }
    const tuzel = musteriTuzelMi(m);
    $('duzenleMusteriID').value = String(m.MusteriID || detayMusteriID);
    $('duzenleGercekAlan').hidden = tuzel;
    $('duzenleTuzelAlan').hidden = !tuzel;
    $('duzenleMusteriAd').value = m.AdSoyad || '';
    $('duzenleMusteriAd').required = !tuzel;
    $('duzenleMusteriFirma').value = m.FirmaAdi || '';
    $('duzenleMusteriFirma').required = tuzel;
    $('duzenleMusteriYetkili').value = m.yetkili || '';
    $('duzenleMusteriYetkili').required = tuzel;
    $('duzenleMusteriLakap').value = m.TanimAdi || '';
    let tel = String(m.Telefon || '').replace(/\D/g, '');
    if (tel.startsWith('0')) tel = tel.slice(1);
    $('duzenleMusteriTel').value = tel;
    const silAlan = $('duzenleMusteriSilAlan');
    if (silAlan) silAlan.hidden = !detayMusteriData?.silinebilir;
    $('dlgMusteriDuzenle').showModal();
    setTimeout(() => {
      (tuzel ? $('duzenleMusteriFirma') : $('duzenleMusteriAd'))?.focus();
    }, 200);
  }

  async function musteriDuzenleKaydet(ev) {
    ev.preventDefault();
    const id = Number($('duzenleMusteriID').value || detayMusteriID || 0);
    const m = detayMusteriData?.musteri;
    if (!id || !m) {
      toast('Müşteri bulunamadı');
      return;
    }
    let tel = ($('duzenleMusteriTel').value || '').replace(/\D/g, '');
    if (tel.startsWith('0')) tel = tel.slice(1);
    if (tel && !/^[1-9][0-9]{9}$/.test(tel)) {
      toast('Telefon 10 hane olmalı (0 olmadan)');
      return;
    }
    const tuzel = musteriTuzelMi(m);
    const lakap = ($('duzenleMusteriLakap').value || '').trim() || null;
    let body;
    if (tuzel) {
      const firma = ($('duzenleMusteriFirma').value || '').trim();
      const yetkili = ($('duzenleMusteriYetkili').value || '').trim();
      if (!firma) {
        toast('Firma ünvanı girin');
        return;
      }
      if (!yetkili) {
        toast('Yetkili kişi girin');
        return;
      }
      body = {
        tur: 'Tuzel',
        FirmaAdi: firma,
        yetkili,
        vergino: m.vergino || '',
        AdSoyad: '',
        tcno: '',
        Telefon: tel || null,
        TanimAdi: lakap,
        Adres: m.Adres || null,
        Il: m.Il || null,
        Ilce: m.Ilce || null,
        Mahalle: m.Mahalle || null,
        Bakiye: Number(m.Bakiye) || 0,
      };
    } else {
      const ad = ($('duzenleMusteriAd').value || '').trim();
      if (!ad) {
        toast('Ad soyad girin');
        return;
      }
      body = {
        tur: 'Gercek',
        AdSoyad: ad,
        tcno: m.tcno || '',
        FirmaAdi: '',
        yetkili: '',
        vergino: '',
        Telefon: tel || null,
        TanimAdi: lakap,
        Adres: m.Adres || null,
        Il: m.Il || null,
        Ilce: m.Ilce || null,
        Mahalle: m.Mahalle || null,
        Bakiye: Number(m.Bakiye) || 0,
      };
    }
    try {
      const res = await apiFetch(`/api/musteri/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Güncellenemedi');
        return;
      }
      $('dlgMusteriDuzenle').close();
      toast('Müşteri güncellendi');
      const musRes = await apiFetch('/api/musteri');
      if (musRes.ok) musteriCache = await musRes.json();
      musteriListele();
      navKartOzetGuncelle();
      await musteriDetayAc(id, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function musteriMobilSil() {
    const id = Number($('duzenleMusteriID').value || detayMusteriID || 0);
    const m = detayMusteriData?.musteri;
    if (!id || !m) return;
    if (!detayMusteriData?.silinebilir) {
      toast('Hareketi olan müşteri silinemez');
      return;
    }
    const ad = musteriGorunenAd(m);
    $('dlgMusteriDuzenle')?.close();
    const sifre = await silmeSifreOnayla(`"${ad}" silinecek. Şifrenizi girin.`);
    if (!sifre) return;
    try {
      const res = await apiFetch(`/api/musteri/${id}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Silinemedi');
        return;
      }
      toast(payload.message || 'Müşteri silindi');
      musteriCache = musteriCache.filter((x) => Number(x.MusteriID) !== id);
      detayMusteriID = null;
      detayMusteriData = null;
      musteriListele();
      navKartOzetGuncelle();
      musteriDetayDonusPanel = 'musteri';
      panelGoster('musteri');
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function satisKaydet(ev) {
    ev.preventDefault();
    const duzenleMod = Number.isInteger(_gunlukDuzenleLogID) && _gunlukDuzenleLogID > 0;
    const odemeEl = document.querySelector('#formSatis input[name="odemeTipi"]:checked');
    const odemeTipi = odemeEl ? odemeEl.value : 'Nakit';
    let musteriID = parseInt($('satisMusteriID').value, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) musteriID = null;

    if (!duzenleMod) {
      if (satisMusteriModuMu() && !musteriID) {
        toast('Müşteri seçin veya yeni ekleyin');
        return;
      }
      if (odemeTipi === 'Veresiye' && !musteriID) {
        toast('Veresiye için müşteri seçin');
        return;
      }
    } else if (odemeTipi === 'Veresiye') {
      toast('Perakende düzenlemede veresiye kullanılamaz');
      return;
    }

    const sepetToplam = Math.round(sepetToplamHesapla() * 100) / 100;
    let tahsilatTutar = parseFloat($('satisTahsilat').value);
    if (!Number.isFinite(tahsilatTutar) || tahsilatTutar < 0) {
      toast('Geçerli tahsilat tutarı girin');
      return;
    }
    tahsilatTutar = Math.round(tahsilatTutar * 100) / 100;
    if (odemeTipi === 'Veresiye') tahsilatTutar = 0;
    else if (!musteriID && !duzenleMod) tahsilatTutar = sepetToplam;
    else if (duzenleMod && tahsilatTutar > sepetToplam) {
      toast('Tahsilat sepet toplamını geçemez');
      return;
    }
    if (musteriID && odemeTipi !== 'Veresiye' && tahsilatTutar > sepetToplam) {
      toast('Tahsilat sepet toplamını geçemez');
      return;
    }

    const kalemler = sepet.map((s) => ({
      urunID: s.stokID,
      miktar: s.miktar,
      birimFiyat: s.birimFiyat,
      urunAdi: s.urunAdi,
      stokDisi: !!(s.stokDisi || !(s.stokID > 0)),
    }));

    const body = {
      kalemler,
      kullanici: aktifKullanici,
      odemeTipi,
      tahsilatTutar,
    };
    if (!duzenleMod && musteriID) body.musteriID = musteriID;
    const ozelNot = ($('satisOzelNot')?.value || '').trim();
    if (ozelNot) body.ozelNot = ozelNot;

    if (duzenleMod) {
      const sifre = await silmeSifreOnayla('Perakende satışı güncellemek için şifrenizi girin.');
      if (!sifre) return;
      body.kullaniciAdi = localStorage.getItem(LS_USER) || aktifKullanici;
      body.sifre = sifre;
    }

    try {
      const url = duzenleMod ? `/api/gunluk-islem/${_gunlukDuzenleLogID}/duzenle` : '/api/satis-sepet';
      const res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success) {
        $('dlgSatis').close();
        yeniSatisModalKapat();
        gunlukPerakendeDuzenleSifirla();
        sepet = [];
        sepetCiz();
        toast(payload.message || (duzenleMod ? 'Satış güncellendi' : 'Satış kaydedildi'));
        await veriYukle();
        if (duzenleMod && gunlukBugunData?.islemler) {
          await gunlukBugunYenile();
        }
        if (detayMusteriID) await musteriDetayAc(detayMusteriID, true);
      } else {
        toast(payload.message || (duzenleMod ? 'Güncellenemedi' : 'Satış tamamlanamadı'));
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  /* ——— Stok ——— */
  function stokKartHtml(s) {
    const miktar = Number(s.MevcutMiktar) || 0;
    const seviye = stokSeviyeBilgi(s);
    const rozetHtml = `<span class="durum-rozet ${seviye.sinif}">${esc(seviye.metin)}</span>`;
    const alt = `Stok: <strong>${miktar}</strong> ${esc(s.Birim || 'Adet')}${s.Barkod ? ` · ${esc(s.Barkod)}` : ''}`;
    const id = s.StokID;
    return `<li class="kart-item kart-item-stok">
      <div class="kart-govde kart-govde-stok">
        <div class="kart-ust-stok">
          <div class="kart-ust-sol">
            <span class="kart-baslik">${esc(s.UrunAdi)}</span>
            ${rozetHtml}
          </div>
          <div class="kart-ust-sag">
            <button type="button" class="kart-mini-btn" data-stok-duzenle="${id}" title="Düzenle" aria-label="Düzenle">✎</button>
            <button type="button" class="kart-mini-btn kart-mini-sil" data-stok-sil="${id}" title="Sil" aria-label="Sil">✕</button>
            <span class="kart-tutar">${para(s.SatisFiyati)}</span>
          </div>
        </div>
        <div class="kart-alt">${alt}</div>
      </div>
    </li>`;
  }

  function stokFormTemizle() {
    stokDuzenlemeID = null;
    $('dlgStokBaslik').textContent = 'Yeni ürün';
    $('formStok').reset();
    $('stokMiktar').value = '0';
    $('stokAlis').value = '0';
    $('stokKritik').value = '5';
    $('stokHedef').value = '20';
    $('stokBirim').value = 'Adet';
  }

  function stokYokModalAc(kelime, hedef) {
    const k = String(kelime || '').trim();
    if (k.length < 2) return;
    stokEkleDonusHedef = hedef === 'musteri-satis' ? 'musteri-satis' : 'satis';
    const inp = $('stokYokUrunAdi');
    if (inp) inp.value = k;
    const dlg = $('dlgStokYok');
    if (!dlg) return;
    const ilkAcilis = !dlg.open;
    if (ilkAcilis) dlg.showModal();
    if (ilkAcilis) {
      setTimeout(() => {
        inp?.focus();
        inp?.select?.();
      }, 80);
    }
  }

  function stokEkleSatistanAc(kelime) {
    const hedef = stokEkleDonusHedef;
    stokFormTemizle();
    stokEkleDonusHedef = hedef;
    $('dlgStokBaslik').textContent = 'Yeni ürün (satışa ekle)';
    const k = String(kelime || '').trim();
    if (k) {
      const sadeceRakam = /^\d{6,}$/.test(k);
      if (sadeceRakam) $('stokBarkod').value = k;
      else $('stokUrunAdi').value = k;
    }
    $('dlgStok').showModal();
    setTimeout(() => {
      const odak = ($('stokUrunAdi')?.value || '').trim() ? $('stokSatis') : $('stokUrunAdi');
      odak?.focus();
    }, 80);
  }

  function stokYokOnayla(ev) {
    ev.preventDefault();
    const ad = ($('stokYokUrunAdi').value || '').trim();
    if (!ad) {
      toast('Ürün adı girin');
      return;
    }
    _stokYokOnaylandi = true;
    $('dlgStokYok')?.close();
    stokEkleSatistanAc(ad);
  }

  function sepetMiktarManuelAc(idx, hedef) {
    const liste = hedef === 'musteri' ? musteriSatisSepet : sepet;
    const s = liste[idx];
    if (!s) return;
    _adetGirHedef = hedef === 'musteri' ? 'musteri' : 'satis';
    _adetGirIdx = idx;
    const adEl = $('dlgAdetGirUrun');
    if (adEl) adEl.textContent = s.urunAdi || '';
    const inp = $('adetGirInput');
    if (inp) inp.value = String(s.miktar || 1);
    $('dlgAdetGir')?.showModal();
    setTimeout(() => {
      inp?.focus();
      inp?.select?.();
    }, 80);
  }

  function adetGirDegistir(delta) {
    const inp = $('adetGirInput');
    if (!inp) return;
    let v = parseInt(inp.value, 10);
    if (!Number.isFinite(v)) v = 0;
    v = Math.max(0, v + delta);
    inp.value = String(v);
    inp.focus();
    inp.select?.();
  }

  function adetGirKaydet(ev) {
    ev.preventDefault();
    const raw = String($('adetGirInput')?.value || '').trim();
    const v = parseInt(raw, 10);
    if (!Number.isFinite(v) || v < 0) {
      toast('Geçerli adet girin');
      return;
    }
    const liste = _adetGirHedef === 'musteri' ? musteriSatisSepet : sepet;
    if (!liste[_adetGirIdx]) {
      $('dlgAdetGir')?.close();
      return;
    }
    if (v === 0) {
      liste.splice(_adetGirIdx, 1);
    } else {
      liste[_adetGirIdx].miktar = v;
    }
    $('dlgAdetGir')?.close();
    if (_adetGirHedef === 'musteri') {
      musteriSatisSepetCiz();
      musteriSatisTahsilatGuncelle();
    } else {
      sepetCiz();
    }
  }

  function stokEkleDialogAc() {
    stokEkleDonusHedef = null;
    stokFormTemizle();
    $('dlgStok').showModal();
    setTimeout(() => $('stokUrunAdi')?.focus(), 80);
  }

  function stokDuzenleDialogAc(id) {
    const s = stokCache.find((x) => Number(x.StokID) === Number(id));
    if (!s) return;
    stokEkleDonusHedef = null;
    stokDuzenlemeID = Number(id);
    $('dlgStokBaslik').textContent = 'Stok düzenle';
    $('stokUrunAdi').value = s.UrunAdi || '';
    $('stokKategori').value = s.Kategori || '';
    $('stokBarkod').value = s.Barkod || '';
    $('stokAlis').value = Number(s.AlisFiyati || 0);
    $('stokSatis').value = Number(s.SatisFiyati || 0);
    $('stokMiktar').value = Number(s.MevcutMiktar || 0);
    $('stokBirim').value = s.Birim || 'Adet';
    $('stokKritik').value = Number.isFinite(Number(s.KritikEsik)) ? Number(s.KritikEsik) : 5;
    $('stokHedef').value = Number.isFinite(Number(s.HedefEsik)) ? Number(s.HedefEsik) : 20;
    $('dlgStok').showModal();
  }

  async function stokKaydet(ev) {
    ev.preventDefault();
    const ad = ($('stokUrunAdi').value || '').trim();
    const satis = parseFloat($('stokSatis').value);
    if (!ad) {
      toast('Ürün adı girin');
      return;
    }
    if (!Number.isFinite(satis) || satis <= 0) {
      toast('Satış fiyatı girin');
      return;
    }
    const body = {
      UrunAdi: ad,
      Kategori: ($('stokKategori').value || '').trim() || null,
      Barkod: ($('stokBarkod').value || '').trim() || null,
      AlisFiyati: parseFloat($('stokAlis').value) || 0,
      SatisFiyati: satis,
      MevcutMiktar: parseInt($('stokMiktar').value, 10) || 0,
      Birim: $('stokBirim').value || 'Adet',
      KritikEsik: parseInt($('stokKritik').value, 10),
      HedefEsik: parseInt($('stokHedef').value, 10),
      kullanici: aktifKullanici,
    };
    const duzenle = Number.isInteger(stokDuzenlemeID) && stokDuzenlemeID > 0;
    const donus = stokEkleDonusHedef;
    try {
      const res = await apiFetch(duzenle ? `/api/stok/${stokDuzenlemeID}` : '/api/stok', {
        method: duzenle ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        let yeniKayit = null;
        if (!duzenle) {
          yeniKayit = await res.json().catch(() => null);
        } else {
          await res.text().catch(() => '');
        }
        stokEkleDonusHedef = null;
        $('dlgStok').close();
        stokFormTemizle();
        const stokRes = await apiFetch('/api/stok');
        stokCache = stokRes.ok ? await stokRes.json() : stokCache;
        stokCacheIndeksle();
        stokListele();
        navKartOzetGuncelle();
        if (donus && !duzenle) {
          let urun = yeniKayit && yeniKayit.StokID ? yeniKayit : null;
          if (!urun && yeniKayit?.UrunAdi) {
            const adNorm = String(yeniKayit.UrunAdi).toLocaleLowerCase('tr-TR');
            urun = stokCache.find((s) => String(s.UrunAdi || '').toLocaleLowerCase('tr-TR') === adNorm);
          }
          if (!urun) {
            const adNorm = ad.toLocaleLowerCase('tr-TR');
            urun = stokCache.find((s) => String(s.UrunAdi || '').toLocaleLowerCase('tr-TR') === adNorm);
          }
          if (urun) {
            if (donus === 'musteri-satis') musteriSatisSepeteEkle(urun);
            else sepeteEkle(urun);
            toast('Ürün eklendi ve sepete kondu');
          } else {
            toast('Ürün eklendi');
          }
        } else {
          toast(duzenle ? 'Stok güncellendi' : 'Ürün eklendi');
        }
      } else {
        const msg = await res.text().catch(() => '');
        toast(msg || 'Kayıt başarısız');
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function stokSil(id) {
    const urun = stokCache.find((s) => Number(s.StokID) === Number(id));
    const ad = urun ? urun.UrunAdi : 'ürün';
    const onay = await silmeSifreOnayla(`"${ad}" silinecek. Şifrenizi girin.`);
    if (!onay) return;
    try {
      const q = encodeURIComponent(aktifKullanici || 'Sistem');
      const res = await apiFetch(`/api/stok/${id}?kullanici=${q}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Ürün silindi');
        stokCache = stokCache.filter((s) => Number(s.StokID) !== Number(id));
        stokCacheIndeksle();
        stokListele();
        navKartOzetGuncelle();
      } else {
        const msg = await res.text().catch(() => '');
        toast(msg || 'Silinemedi');
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function stokListeleOzetGuncelle(toplam, sinirli, q) {
    const el = $('stokListeOzet');
    if (!el) return;
    if (!toplam) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    if (sinirli) {
      el.textContent = q
        ? `${toplam} eşleşme — ilk ${STOK_LISTE_GOSTER_LIMIT} gösteriliyor`
        : `${toplam} ürün — ilk ${STOK_LISTE_GOSTER_LIMIT} gösteriliyor, arama ile daraltın`;
    } else {
      el.textContent = q ? `${toplam} sonuç` : `${toplam} ürün`;
    }
  }

  function stokListeleCiz() {
    const q = ($('stokArama')?.value || '').trim();
    const ul = $('stokListe');
    if (!ul) return;
    const { liste, toplam, sinirli } = stokAraFiltrele(q, STOK_LISTE_GOSTER_LIMIT);
    const bos = $('stokBos');
    stokListeleOzetGuncelle(toplam, sinirli, q);
    if (!liste.length) {
      ul.innerHTML = '';
      if (bos) {
        bos.hidden = false;
        bos.textContent = q ? 'Aramaya uygun ürün yok' : 'Kayıt yok';
      }
      return;
    }
    if (bos) bos.hidden = true;
    ul.innerHTML = liste.map((s) => stokKartHtml(s)).join('');
  }

  function stokListele() {
    if (stokListeleRaf) cancelAnimationFrame(stokListeleRaf);
    stokListeleRaf = requestAnimationFrame(() => {
      stokListeleRaf = 0;
      stokListeleCiz();
    });
  }

  const stokListeleGecikmeli = debounce(stokListele, 160);
  const satisAramaGecikmeli = debounce((q) => satisAramaGoster(q), 140);
  const musteriSatisAramaGecikmeli = debounce((q) => musteriSatisAramaGoster(q), 140);

  async function musteriHareketSil(hareketID) {
    const sifre = await silmeSifreOnayla(
      'Bu cari işlemi silinecek. Stok, kasa, bakiye ve günlük kayıt geri alınır. Şifrenizi girin.',
    );
    if (!sifre) return;
    try {
      const q = encodeURIComponent(aktifKullanici || 'Sistem');
      const res = await apiFetch(`/api/musteri/hareket/${hareketID}?kullanici=${q}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Silinemedi');
        return;
      }
      toast(payload.message || 'İşlem silindi');
      await veriYukle();
      await gunlukKasaYukle();
      if (detayMusteriID) await musteriDetayAc(detayMusteriID, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  /* ——— Müşteri ——— */
  function musteriListele() {
    const q = ($('musteriArama').value || '').trim().toLocaleLowerCase('tr-TR');
    const sadeceBorc = $('musteriSadeceBorc').checked;
    const ul = $('musteriListe');
    let liste = musteriCache;
    if (sadeceBorc) liste = liste.filter((m) => Number(m.Bakiye) > 0.005);
    if (q) {
      liste = liste.filter((m) => {
        const ad = musteriGorunenAd(m).toLocaleLowerCase('tr-TR');
        const tel = String(m.Telefon || '').toLowerCase();
        const lakap = musteriLakap(m).toLocaleLowerCase('tr-TR');
        return ad.includes(q) || tel.includes(q) || lakap.includes(q) || String(m.MusteriID).includes(q);
      });
    }
    liste = [...liste].sort((a, b) => Number(b.Bakiye || 0) - Number(a.Bakiye || 0));
    ul.innerHTML = '';
    $('musteriBos').hidden = liste.length > 0;
    liste.forEach((m) => {
      const bakiye = Number(m.Bakiye) || 0;
      const bakiyeCls = bakiye > 0 ? 'bakiye-borc' : bakiye < 0 ? 'bakiye-alacak' : '';
      let rozet = null;
      if (bakiye > 0.005) rozet = { metin: 'Borçlu', sinif: 'rozet-tehlikeli' };
      else if (bakiye < -0.005) rozet = { metin: 'Alacaklı', sinif: 'rozet-yeterli' };
      ul.appendChild(
        kartListeHtml({
          baslik: musteriGorunenAd(m),
          alt: `${m.Telefon ? esc(m.Telefon) + ' · ' : ''}${esc(musteriAltKimlik(m))}`,
          tutar: bakiye < 0 ? para(Math.abs(bakiye)) : para(bakiye),
          tutarCls: bakiyeCls,
          rozet,
          tikla: () => musteriDetayAc(m.MusteriID),
        }),
      );
    });
  }

  function musteriDetayGeri() {
    const hedef = musteriDetayDonusPanel || 'musteri';
    if (hedef === 'satis' || hedef === 'ana') anaSayfaGoster();
    else panelGoster(hedef);
    if (hedef === 'musteri') musteriListele();
  }

  function anaGeriTikla() {
    const tedCari = $('panel-tedarikci-cari');
    if (tedCari && !tedCari.hidden) {
      tedarikciCariGeri();
      return;
    }
    const tedListe = $('panel-tedarikci');
    if (tedListe && !tedListe.hidden) {
      anaSayfaGoster();
      return;
    }
    const detayPanel = $('panel-musteri-detay');
    if (detayPanel && !detayPanel.hidden) {
      musteriDetayGeri();
      return;
    }
    anaSayfaGoster();
  }

  async function musteriDetayAc(id, yenile = false) {
    if (!yenile) {
      if (aktifPanel !== 'musteri-detay') {
        musteriDetayDonusPanel = aktifPanel || 'musteri';
      }
      detayMusteriID = id;
      panelGoster('musteri-detay');
    } else {
      detayMusteriID = id;
    }
    const ozet = $('musteriDetayOzet');
    const ul = $('musteriHareketListe');
    ozet.innerHTML = '<p>Yükleniyor…</p>';
    ul.innerHTML = '';
    try {
      const res = await apiFetch(`/api/musteri/${id}/hareketler`);
      if (!res.ok) throw new Error('Detay alınamadı');
      const data = await res.json();
      const m = data.musteri;
      const bakiye = Number(m.Bakiye) || 0;
      const bakiyeCls = bakiye > 0 ? 'bakiye-borc' : bakiye < 0 ? 'bakiye-alacak' : '';
      const hareketYok = !(data.hareketler || []).length;
      ozet.innerHTML = `
        <div class="detay-ozet-baslik">
          <h2>${esc(musteriGorunenAd(m))}</h2>
          <button type="button" class="detay-ozet-duzenle" data-musteri-duzenle="${m.MusteriID}" title="Düzenle" aria-label="Müşteriyi düzenle">✎</button>
        </div>
        <p class="kart-alt">${m.Telefon ? esc(m.Telefon) : ''} ${m.Il ? '· ' + esc(m.Il) : ''}</p>
        <p class="detay-bakiye ${bakiyeCls}">${bakiye < 0 ? para(Math.abs(bakiye)) : para(bakiye)}</p>
        <p class="kart-alt">${bakiye > 0 ? 'Müşteri borcu' : bakiye < 0 ? 'Müşteri alacağı (ön ödeme)' : 'Bakiye sıfır'}</p>`;
      $('btnMusteriOdeme').disabled = false;
      detayMusteriData = {
        musteri: m,
        hareketler: data.hareketler || [],
        silinebilir: hareketYok,
      };
      const html = (data.hareketler || []).map((h) => hareketMobilHtml(h)).join('');
      ul.innerHTML = html || '<li class="bos-metin">Hareket yok</li>';
    } catch (e) {
      console.error(e);
      ozet.innerHTML = '<p class="bakiye-borc">Yüklenemedi</p>';
    }
  }

  function ekstreTarihParcala(val) {
    const tam = tarihTrGoster(val);
    const p = tam.split(' ');
    return { gun: p[0] || '—', saat: p[1] || '—', sort: sqlTarihParse(val)?.getTime() || 0 };
  }

  function ekstreRaporSatir(h) {
    const tur = String(h.Tur || '').toLowerCase();
    const { gun, saat, sort } = ekstreTarihParcala(h.Tarih);
    let borc = 0;
    let odeme = 0;
    if (tur === 'satis') borc = Number(h.ToplamTutar || 0);
    else if (tur === 'iade') odeme = Number(h.ToplamTutar || 0);
    else if (tur === 'odeme' || tur === 'iadeodeme') odeme = Number(h.OdenenTutar || 0);
    const islemTipi = hareketTurEtiket(h.Tur);
    const kalemler = hareketMobilKalemleri(h);
    const aciklama = kalemler.length
      ? hareketKalemMetin(kalemler)
      : (hareketMobilBaslik(h) || hareketMobilNot(h) || String(h.Aciklama || '—').replace(/^\[Mobil\]\s*/i, '').trim() || '—');
    const islemSira = tur === 'satis' ? 1 : tur === 'iade' ? 2 : 3;
    return {
      sort,
      saat,
      gun,
      islemTipi,
      islemSira,
      siraId: Number(h.HareketID || 0),
      aciklama: aciklama || '—',
      borc,
      odeme,
    };
  }

  function ekstreToplamlariHesapla(data) {
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

  function cariEkstreHtmlOlustur(data) {
    const m = data.musteri;
    const ad = musteriGorunenAd(m);
    const lakap = musteriLakap(m);
    const tel = m.Telefon || '—';
    const konum = musteriKonum(m);
    const { toplamSatis, toplamOdeme, kalan } = ekstreToplamlariHesapla(data);
    const satirlar = [...(data.hareketler || [])].map(ekstreRaporSatir).sort((a, b) => {
      if (a.sort !== b.sort) return a.sort - b.sort;
      if (a.islemSira !== b.islemSira) return a.islemSira - b.islemSira;
      return a.siraId - b.siraId;
    });

    const tabloSatir = satirlar.map((s) => `
      <tr>
        <td style="white-space:nowrap;">
          <div style="font-weight:700;color:#111;">${esc(s.gun)}</div>
          <div style="font-size:9px;color:#666;margin-top:2px;">${esc(s.saat)}</div>
        </td>
        <td style="color:#111;">${esc(s.islemTipi)}</td>
        <td style="color:#111;">${esc(s.aciklama)}</td>
        <td style="text-align:right;color:#c0392b;font-weight:700;">${s.borc > 0 ? para(s.borc) : '—'}</td>
        <td style="text-align:right;color:#27ae60;font-weight:700;">${s.odeme > 0 ? para(s.odeme) : '—'}</td>
      </tr>`).join('');

    const kalanRenk = kalan > 0 ? '#c0392b' : (kalan < 0 ? '#27ae60' : '#333');
    const kalanMetin = `${para(Math.abs(kalan))}${kalan < 0 ? ' (Alacak)' : ''}`;
    const kurum = isletmeKurumAdi();
    const isletmeYetkili = String(sirketAyarlar?.SirketYetkiliAdSoyad || '').trim();
    const isletmeVergi = String(sirketAyarlar?.SirketVergiNo || '').trim();
    const isletmeTel = String(sirketAyarlar?.SirketTelefon || '').trim();
    const isletmeSatirlar = [
      isletmeYetkili ? `<div style="font-size:11px;margin:2px 0;color:#444;"><b>Yetkili</b> ${esc(isletmeYetkili)}</div>` : '',
      isletmeVergi ? `<div style="font-size:11px;margin:2px 0;color:#444;"><b>Vergi no</b> ${esc(isletmeVergi)}</div>` : '',
      isletmeTel ? `<div style="font-size:11px;margin:2px 0;color:#444;"><b>Telefon</b> ${esc(isletmeTel)}</div>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="ekstre-print-root" style="font-family:Segoe UI,Arial,sans-serif;color:#111;padding:4px;background:#fff;">
        <div style="text-align:center;margin:0 0 10px;padding-bottom:8px;border-bottom:2px solid #0d47a1;">
          <div style="font-size:18px;font-weight:800;color:#0d47a1;text-transform:uppercase;">${esc(kurum)}</div>
          ${isletmeSatirlar}
          <div style="font-size:13px;font-weight:700;color:#333;margin-top:8px;letter-spacing:0.04em;">CARİ EKSTRE</div>
        </div>
        <p style="text-align:right;font-size:10px;color:#555;margin:0 0 12px;">
          ${esc(new Date().toLocaleString('tr-TR'))}
        </p>
        <div style="margin:0 0 14px;padding:10px 12px;background:#f8f9fa;border:1px solid #dee2e6;border-radius:6px;">
          <div style="font-size:20px;font-weight:800;color:#0d47a1;text-transform:uppercase;">${esc(ad)}</div>
          ${lakap ? `<div style="font-size:13px;font-weight:600;color:#495057;margin:6px 0 8px;">${esc(lakap)}</div>` : ''}
          <div style="font-size:12px;margin:4px 0;color:#111;"><b>Telefon</b> ${esc(tel)}</div>
          <div style="font-size:12px;margin:4px 0;color:#111;"><b>Adres</b> ${esc(konum)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:11px;">
          <tr>
            <td style="border:1px solid #ccc;padding:8px;background:#fde8e8;text-align:center;color:#111;"><b>Toplam satış</b><br><span style="color:#c0392b;font-weight:800;font-size:14px;">${para(toplamSatis)}</span></td>
            <td style="border:1px solid #ccc;padding:8px;background:#e8f8ee;text-align:center;color:#111;"><b>Toplam tahsilat</b><br><span style="color:#27ae60;font-weight:800;font-size:14px;">${para(toplamOdeme)}</span></td>
            <td style="border:1px solid #ccc;padding:8px;background:#e3f2fd;text-align:center;color:#111;"><b>Güncel bakiye</b><br><span style="color:${kalanRenk};font-weight:800;font-size:14px;">${kalanMetin}</span></td>
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
              <td style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#c0392b;">${para(toplamSatis)}</td>
              <td style="border:1px solid #bdc3c7;padding:6px;text-align:right;color:#27ae60;">${para(toplamOdeme)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin-top:16px;font-size:9px;color:#888;text-align:center;">${esc(kurum)} · Bu belge bilgilendirme amaçlıdır.</p>
      </div>`;
  }

  function ekstreDosyaAdi(m) {
    const ad = musteriGorunenAd(m).replace(/[^\w\u00C0-\u024F\s-]/gi, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'musteri';
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `ekstre-${ad}-${ts}.jpg`;
  }

  async function ekstreGorselBlobUret(data) {
    const host = $('ekstreRenderHost');
    if (!host) throw new Error('Ekstre alanı yok');
    if (typeof html2canvas === 'undefined') throw new Error('Resim kütüphanesi yüklenemedi');
    await sirketAyarlarYukle();
    host.innerHTML = cariEkstreHtmlOlustur(data);
    const root = host.querySelector('.ekstre-print-root');
    if (!root) throw new Error('Ekstre oluşturulamadı');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    host.innerHTML = '';
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Görsel oluşmadı'))), 'image/jpeg', 0.92);
    });
  }

  async function musteriCariGorselIndir(blob, dosyaAd) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = dosyaAd;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function musteriWhatsappPaylas() {
    if (!detayMusteriData?.musteri) {
      toast('Müşteri bilgisi yok');
      return;
    }
    try {
      const blob = await ekstreGorselBlobUret(detayMusteriData);
      const dosyaAd = ekstreDosyaAdi(detayMusteriData.musteri);
      await musteriCariGorselIndir(blob, dosyaAd);
      toast('Ekstre indirildi — WhatsApp\'ta kişiyi seçin, ekle → son indirilenler');
      setTimeout(() => {
        window.open('https://wa.me/', '_blank', 'noopener');
      }, 400);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Ekstre oluşturulamadı');
    }
  }

  function odemeDialogAc() {
    const m = musteriCache.find((x) => x.MusteriID === detayMusteriID)
      || detayMusteriData?.musteri;
    if (!m) return;
    musteriHareketDuzenleSifirla();
    $('dlgOdemeMusteri').textContent = musteriGorunenAd(m);
    const bakiye = Number(m.Bakiye) || 0;
    const borcEl = $('dlgOdemeBorc');
    if (borcEl) {
      if (bakiye > 0.005) {
        borcEl.style.color = '#c62828';
        borcEl.textContent = `Kalan borç: ${para(bakiye)}`;
      } else if (bakiye < -0.005) {
        borcEl.style.color = '#2e7d32';
        borcEl.textContent = `Müşteri alacağı: ${para(Math.abs(bakiye))} — ön ödeme eklenebilir`;
      } else {
        borcEl.style.color = '#546e7a';
        borcEl.textContent = 'Borç yok — ön ödeme / avans alınabilir';
      }
    }
    const notEl = $('odemeAciklama');
    if (notEl) {
      notEl.value = '';
      notEl.placeholder = bakiye <= 0.005 ? 'Örn: Ön ödeme / avans' : 'İsteğe bağlı';
    }
    $('odemeTutar').value = '';
    const baslik = $('dlgOdemeBaslik');
    if (baslik) baslik.textContent = bakiye <= 0.005 ? 'Ön ödeme / tahsilat' : 'Tahsilat';
    $('dlgOdeme').showModal();
  }

  async function odemeKaydet(ev) {
    ev.preventDefault();
    const tutar = parseFloat($('odemeTutar').value);
    if (!Number.isFinite(tutar) || tutar <= 0) {
      toast('Geçerli tutar girin');
      return;
    }
    const duzenleMod = Number.isInteger(_musteriHareketDuzenleID)
      && _musteriHareketDuzenleID > 0
      && _musteriHareketDuzenleTip === 'odeme';
    try {
      if (duzenleMod) {
        const res = await apiFetch(`/api/musteri/hareket/${_musteriHareketDuzenleID}/duzenle`, {
          method: 'PATCH',
          body: JSON.stringify({
            tip: 'odeme',
            tutar,
            odemeSekli: $('odemeSekli').value,
            kullanici: aktifKullanici,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (res.ok && payload.success) {
          $('dlgOdeme').close();
          musteriHareketDuzenleSifirla();
          toast(payload.message || 'Tahsilat güncellendi');
          await veriYukle();
          await gunlukKasaYukle();
          await musteriDetayAc(detayMusteriID, true);
        } else {
          toast(payload.message || 'Güncellenemedi');
        }
        return;
      }
      const not = ($('odemeAciklama')?.value || '').trim();
      const res = await apiFetch(`/api/musteri/${detayMusteriID}/odeme`, {
        method: 'POST',
        body: JSON.stringify({
          tutar,
          odemeSekli: $('odemeSekli').value,
          kullanici: aktifKullanici,
          aciklama: not || 'Mobil tahsilat',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success !== false) {
        $('dlgOdeme').close();
        toast('Tahsilat kaydedildi');
        await veriYukle();
        await gunlukKasaYukle();
        await musteriDetayAc(detayMusteriID, true);
      } else {
        toast(payload.message || 'Tahsilat kaydedilemedi');
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  /* ——— Tedarikçi ——— */
  function tedarikciListele() {
    const q = ($('tedarikciArama')?.value || '').trim().toLocaleLowerCase('tr-TR');
    const ul = $('tedarikciListe');
    if (!ul) return;
    let liste = [...(tedarikciCache || [])];
    if (q) {
      liste = liste.filter((t) => {
        const u = String(t.Unvan || '').toLocaleLowerCase('tr-TR');
        const y = String(t.YetkiliAdi || '').toLocaleLowerCase('tr-TR');
        const tel = String(t.Telefon || '').toLowerCase();
        return u.includes(q) || y.includes(q) || tel.includes(q) || String(t.TedarikciID).includes(q);
      });
    }
    liste.sort((a, b) => Number(b.Bakiye || 0) - Number(a.Bakiye || 0));
    ul.innerHTML = '';
    const bos = $('tedarikciBos');
    if (bos) bos.hidden = liste.length > 0;
    liste.forEach((t) => {
      const bakiye = Number(t.Bakiye) || 0;
      const bakiyeCls = bakiye > 0 ? 'bakiye-borc' : bakiye < 0 ? 'bakiye-alacak' : '';
      let rozet = null;
      if (bakiye > 0.005) rozet = { metin: 'Borç', sinif: 'rozet-tehlikeli' };
      else if (bakiye < -0.005) rozet = { metin: 'Alacak', sinif: 'rozet-yeterli' };
      ul.appendChild(
        kartListeHtml({
          baslik: t.Unvan || 'Tedarikçi',
          alt: `${t.Telefon ? esc(t.Telefon) + ' · ' : ''}#${t.TedarikciID}`,
          tutar: para(bakiye),
          tutarCls: bakiyeCls,
          rozet,
          tikla: () => tedarikciCariAc(t.TedarikciID),
        }),
      );
    });
  }

  function tedarikciCariGeri() {
    panelGoster('tedarikci');
    tedarikciListele();
  }

  async function tedarikciCariAc(id, yenile = false) {
    detayTedarikciID = id;
    if (!yenile) panelGoster('tedarikci-cari');
    const ozet = $('tedarikciCariOzet');
    const ul = $('tedarikciHareketListe');
    if (ozet) ozet.innerHTML = '<p>Yükleniyor…</p>';
    if (ul) ul.innerHTML = '';
    try {
      const res = await apiFetch(`/api/tedarikci/${id}/hareketler`);
      if (!res.ok) throw new Error('Detay alınamadı');
      const data = await res.json();
      const t = data.tedarikci || {};
      const bakiye = Number(t.Bakiye) || 0;
      const bakiyeCls = bakiye > 0 ? 'bakiye-borc' : bakiye < 0 ? 'bakiye-alacak' : '';
      detayTedarikciData = data;
      if (ozet) {
        ozet.innerHTML = `
          <h2>${esc(t.Unvan || 'Tedarikçi')}</h2>
          <p class="kart-alt">${t.YetkiliAdi ? esc(t.YetkiliAdi) + ' · ' : ''}${t.Telefon ? esc(t.Telefon) : ''}</p>
          <p class="detay-bakiye ${bakiyeCls}">${para(bakiye)}</p>
          <p class="kart-alt">Bakiye ${bakiye > 0 ? '(borç)' : bakiye < 0 ? '(alacak)' : ''}</p>`;
      }
      const btnOd = $('btnTedarikOdeme');
      if (btnOd) btnOd.disabled = bakiye <= 0.005;
      if (ul) {
        const rows = data.hareketler || [];
        ul.innerHTML = rows.length
          ? rows.map((h) => tedarikciHareketHtml(h)).join('')
          : '<li class="bos-metin">Hareket yok</li>';
      }
    } catch (e) {
      console.error(e);
      if (ozet) ozet.innerHTML = '<p class="bos-metin">Cari yüklenemedi</p>';
      toast('Tedarikçi cari alınamadı');
    }
  }

  function tedarikciHareketHtml(h) {
    const tur = String(h.Tur || '').toLowerCase();
    const alimMi = tur === 'alim';
    const etiket = alimMi ? 'Mal alım' : 'Ödeme';
    const tutar = Number(h.Tutar) || 0;
    const tarih = tarihTrGoster(h.Tarih);
    const sinif = alimMi ? 'hareket-satis' : 'hareket-odeme';
    const kayitID = Number(h.KayitID) || 0;
    let kalem = '';
    if (alimMi && Array.isArray(h.satirlar) && h.satirlar.length) {
      kalem = `<ul class="hareket-kalem-liste">${h.satirlar
        .map((s) => {
          const ad = esc(s.UrunAdi || '—');
          const mik = Number(s.Miktar) || 0;
          const bf = Number(s.BirimFiyat) || 0;
          return `<li class="hareket-kalem-satir">${ad} · ${mik} × ${para(bf)}</li>`;
        })
        .join('')}</ul>`;
    }
    const odeme = h.OdemeSekli ? esc(h.OdemeSekli) : '';
    const aksiyon =
      kayitID > 0
        ? `<div class="hareket-aksiyon">
            <button type="button" class="hareket-duzenle-btn" data-ted-duzenle="${tur}" data-ted-id="${kayitID}" title="Düzenle" aria-label="Düzenle">✎</button>
            <button type="button" class="hareket-sil-btn" data-ted-sil="${tur}" data-ted-id="${kayitID}" title="Sil" aria-label="Sil">✕</button>
          </div>`
        : '';
    return `<li class="hareket-item ${sinif}">
      <div class="hareket-ust">
        <span class="hareket-tur">${etiket}</span>
        <div class="hareket-ust-sag">
          <span class="hareket-toplam-deger">${para(tutar)}</span>
          ${aksiyon}
        </div>
      </div>
      <div class="hareket-alt">${[odeme, tarih].filter(Boolean).join(' · ')}</div>
      ${kalem}
    </li>`;
  }

  async function tedarikciHareketSil(tur, kayitID) {
    if (!detayTedarikciID || !kayitID) return;
    const turRaw = String(tur || '').toLowerCase();
    const mesaj =
      turRaw === 'alim'
        ? 'Bu mal alımı silinecek. Stok/cari/kasa geri alınır. Şifrenizi girin.'
        : 'Bu ödeme silinecek. Cari ve kasa geri alınır. Şifrenizi girin.';
    const sifre = await silmeSifreOnayla(mesaj);
    if (!sifre) return;
    if (!(await silmeSifreDogrula(sifre))) {
      toast('Şifre hatalı');
      return;
    }
    try {
      const q = encodeURIComponent(aktifKullanici || 'Sistem');
      const res = await apiFetch(
        `/api/tedarikci/${detayTedarikciID}/hareket/${encodeURIComponent(turRaw)}/${kayitID}?kullanici=${q}`,
        { method: 'DELETE' },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Silinemedi');
        return;
      }
      toast(payload.message || 'Silindi');
      const [tedRes, stokRes] = await Promise.all([apiFetch('/api/tedarikci'), apiFetch('/api/stok')]);
      tedarikciCache = tedRes.ok ? await tedRes.json() : tedarikciCache;
      if (stokRes.ok) {
        stokCache = await stokRes.json();
        stokCacheIndeksle();
      }
      await gunlukKasaYukle();
      navKartOzetGuncelle();
      await tedarikciCariAc(detayTedarikciID, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function tedarikciHareketDuzenleAc(tur, kayitID) {
    if (!detayTedarikciID || !kayitID) return;
    const tip = String(tur || '').toLowerCase();
    try {
      const res = await apiFetch(
        `/api/tedarikci/${detayTedarikciID}/hareket/${encodeURIComponent(tip)}/${kayitID}/detay`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.message || 'Hareket alınamadı');
        return;
      }
      const h = data.hareket || {};
      const detaylar = data.detaylar || [];
      $('tedHrkKayitID').value = String(kayitID);
      $('tedHrkTip').value = tip;
      $('dlgTedHrkBaslik').textContent = tip === 'alim' ? 'Mal alım düzenle' : 'Ödeme düzenle';
      $('tedHrkMeta').textContent = `${detayTedarikciData?.tedarikci?.Unvan || ''} · ${tarihTrGoster(h.Tarih)}`;
      const alimAlani = $('tedHrkAlimAlani');
      const odemeAlani = $('tedHrkOdemeAlani');
      if (tip === 'alim') {
        alimAlani.hidden = false;
        odemeAlani.hidden = true;
        const ul = $('tedHrkAlimListe');
        const satirlar = detaylar.length
          ? detaylar
          : [{ SatirID: 0, UrunAdi: 'Mal alım', Miktar: 1, SatirTutar: Number(h.Tutar) || 0 }];
        ul.innerHTML = satirlar
          .map(
            (d) => `<li class="ted-alim-satir" data-satir-id="${Number(d.SatirID || 0)}">
              <div class="sepet-satir-ust"><strong>${esc(d.UrunAdi || '—')}</strong></div>
              <div class="sepet-satir-alt">
                <label>Adet <input type="number" min="1" step="1" class="ted-hrk-miktar" value="${Number(d.Miktar || 1)}"></label>
                <label>Tutar <input type="number" min="0.01" step="0.01" class="ted-hrk-tutar" value="${Number(d.SatirTutar || 0).toFixed(2)}"></label>
              </div>
            </li>`,
          )
          .join('');
      } else {
        alimAlani.hidden = true;
        odemeAlani.hidden = false;
        $('tedHrkOdemeTutar').value = Number(h.Tutar || 0).toFixed(2);
        $('tedHrkOdemeSekli').value = h.OdemeSekli || 'Nakit';
      }
      $('dlgTedarikHareketDuzenle').showModal();
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function tedarikciHareketDuzenleKaydet(ev) {
    ev.preventDefault();
    if (!detayTedarikciID) return;
    const kayitID = parseInt($('tedHrkKayitID').value, 10);
    const tip = ($('tedHrkTip').value || '').toLowerCase();
    if (!Number.isInteger(kayitID) || kayitID < 1) return;
    const body = { kullanici: aktifKullanici || 'Sistem' };
    if (tip === 'alim') {
      const kalemler = [];
      $('tedHrkAlimListe')?.querySelectorAll('li[data-satir-id]').forEach((li) => {
        kalemler.push({
          satirID: parseInt(li.getAttribute('data-satir-id') || '0', 10) || 0,
          miktar: Number(li.querySelector('.ted-hrk-miktar')?.value || 0),
          satirTutar: Number(li.querySelector('.ted-hrk-tutar')?.value || 0),
        });
      });
      body.kalemler = kalemler;
    } else if (tip === 'odeme') {
      body.tutar = Number($('tedHrkOdemeTutar').value || 0);
      body.odemeSekli = $('tedHrkOdemeSekli').value || 'Nakit';
    } else return;

    try {
      const res = await apiFetch(
        `/api/tedarikci/${detayTedarikciID}/hareket/${encodeURIComponent(tip)}/${kayitID}/duzenle`,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Düzenleme kaydedilemedi');
        return;
      }
      $('dlgTedarikHareketDuzenle').close();
      toast(payload.message || 'Güncellendi');
      const [tedRes, stokRes] = await Promise.all([apiFetch('/api/tedarikci'), apiFetch('/api/stok')]);
      tedarikciCache = tedRes.ok ? await tedRes.json() : tedarikciCache;
      if (stokRes.ok) {
        stokCache = await stokRes.json();
        stokCacheIndeksle();
      }
      await gunlukKasaYukle();
      navKartOzetGuncelle();
      await tedarikciCariAc(detayTedarikciID, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function tedarikciEkleDialogAc() {
    $('tedYeniUnvan').value = '';
    $('tedYeniYetkili').value = '';
    $('tedYeniTel').value = '';
    $('dlgTedarikciEkle').showModal();
  }

  async function tedarikciEkleKaydet(ev) {
    ev.preventDefault();
    const Unvan = ($('tedYeniUnvan').value || '').trim();
    if (!Unvan) {
      toast('Unvan girin');
      return;
    }
    try {
      const res = await apiFetch('/api/tedarikci', {
        method: 'POST',
        body: JSON.stringify({
          Unvan,
          YetkiliAdi: ($('tedYeniYetkili').value || '').trim() || null,
          Telefon: ($('tedYeniTel').value || '').trim() || null,
          kullanici: aktifKullanici,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Kayıt başarısız');
        return;
      }
      $('dlgTedarikciEkle').close();
      toast('Tedarikçi eklendi');
      const tedRes = await apiFetch('/api/tedarikci');
      tedarikciCache = tedRes.ok ? await tedRes.json() : tedarikciCache;
      tedarikciListele();
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function tedarikOdemeDialogAc() {
    const t = detayTedarikciData?.tedarikci;
    if (!t || !detayTedarikciID) return;
    const bakiye = Number(t.Bakiye) || 0;
    $('dlgTedarikOdemeAd').textContent = t.Unvan || 'Tedarikçi';
    $('dlgTedarikOdemeBorc').textContent = `Borç: ${para(bakiye)}`;
    $('tedOdemeTutar').value = '';
    $('tedOdemeNot').value = '';
    $('tedOdemeSekli').value = 'Nakit';
    $('dlgTedarikOdeme').showModal();
  }

  async function tedarikOdemeKaydet(ev) {
    ev.preventDefault();
    const tutar = parseFloat($('tedOdemeTutar').value);
    if (!Number.isFinite(tutar) || tutar <= 0) {
      toast('Geçerli tutar girin');
      return;
    }
    try {
      const res = await apiFetch('/api/tedarikci/odeme', {
        method: 'POST',
        body: JSON.stringify({
          tedarikciID: detayTedarikciID,
          tutar,
          odemeSekli: $('tedOdemeSekli').value,
          kullanici: aktifKullanici,
          aciklama: ($('tedOdemeNot').value || '').trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Ödeme kaydedilemedi');
        return;
      }
      $('dlgTedarikOdeme').close();
      toast('Ödeme kaydedildi');
      const tedRes = await apiFetch('/api/tedarikci');
      tedarikciCache = tedRes.ok ? await tedRes.json() : tedarikciCache;
      await gunlukKasaYukle();
      await tedarikciCariAc(detayTedarikciID, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  function tedAlimToplam() {
    return tedAlimSepet.reduce((t, s) => t + (Number(s.miktar) || 0) * (Number(s.alisFiyati) || 0), 0);
  }

  function tedAlimSepetCiz() {
    const ul = $('tedAlimSepet');
    const bos = $('tedAlimSepetBos');
    const top = $('tedAlimToplam');
    if (!ul) return;
    if (!tedAlimSepet.length) {
      ul.innerHTML = '';
      if (bos) bos.hidden = false;
      if (top) top.textContent = para(0);
      return;
    }
    if (bos) bos.hidden = true;
    ul.innerHTML = tedAlimSepet
      .map((s, i) => {
        const satir = (Number(s.miktar) || 0) * (Number(s.alisFiyati) || 0);
        return `<li class="ted-alim-satir">
          <div class="sepet-satir-ust">
            <strong>${esc(s.urunAdi)}</strong>
            <button type="button" class="btn-text" data-ted-alim-sil="${i}">Sil</button>
          </div>
          <div class="sepet-satir-alt">
            <label>Adet <input type="number" min="1" step="1" inputmode="numeric" value="${s.miktar}" data-ted-alim-mik="${i}"></label>
            <label>Alış <input type="number" min="0" step="0.01" inputmode="decimal" value="${s.alisFiyati}" data-ted-alim-alis="${i}"></label>
            <span class="sepet-satir-tutar">${para(satir)}</span>
          </div>
        </li>`;
      })
      .join('');
    if (top) top.textContent = para(tedAlimToplam());
  }

  function tedAlimSatirTutarGuncelle(i) {
    const s = tedAlimSepet[i];
    if (!s) return;
    const satir = (Number(s.miktar) || 0) * (Number(s.alisFiyati) || 0);
    const li = $('tedAlimSepet')?.children?.[i];
    const tutarEl = li?.querySelector('.sepet-satir-tutar');
    if (tutarEl) tutarEl.textContent = para(satir);
    const top = $('tedAlimToplam');
    if (top) top.textContent = para(tedAlimToplam());
    if ($('tedAlimOdemeVar')?.checked && $('tedAlimOdenen')) {
      $('tedAlimOdenen').value = tedAlimToplam().toFixed(2);
    }
  }

  function tedAlimDialogAc() {
    const t = detayTedarikciData?.tedarikci;
    if (!t || !detayTedarikciID) return;
    tedAlimSepet = [];
    $('dlgTedarikAlimAd').textContent = t.Unvan || 'Tedarikçi';
    $('tedAlimArama').value = '';
    $('tedAlimAramaSonuc').hidden = true;
    $('tedAlimAramaSonuc').innerHTML = '';
    $('tedAlimStoga').checked = true;
    $('tedAlimOdemeVar').checked = false;
    $('tedAlimOdemeBlok').hidden = true;
    $('tedAlimOdenen').value = '0';
    $('tedAlimOdemeSekli').value = 'Nakit';
    tedAlimSepetCiz();
    $('dlgTedarikAlim').showModal();
  }

  function tedAlimAramaGoster(q) {
    const kutu = $('tedAlimAramaSonuc');
    if (!kutu) return;
    const s = String(q || '').trim();
    if (!s) {
      kutu.hidden = true;
      kutu.innerHTML = '';
      return;
    }
    const { liste } = stokAraFiltrele(s, 12);
    if (!liste.length) {
      kutu.hidden = false;
      kutu.innerHTML = '<button type="button" class="arama-item" disabled>Ürün bulunamadı</button>';
      return;
    }
    kutu.hidden = false;
    kutu.innerHTML = '';
    liste.forEach((u) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arama-item';
      btn.innerHTML = `<span><span>${esc(u.UrunAdi)}</span><span class="arama-item-alt">Stok: ${u.MevcutMiktar}</span></span><span class="arama-item-fiyat">${para(u.AlisFiyati || u.SatisFiyati || 0)}</span>`;
      btn.onclick = () => {
        tedAlimSepeteEkle(u);
        $('tedAlimArama').value = '';
        kutu.hidden = true;
        kutu.innerHTML = '';
      };
      kutu.appendChild(btn);
    });
  }

  function tedAlimSepeteEkle(u) {
    const mevcut = tedAlimSepet.find((s) => Number(s.stokID) === Number(u.StokID));
    if (mevcut) {
      mevcut.miktar += 1;
    } else {
      tedAlimSepet.push({
        stokID: u.StokID,
        urunAdi: u.UrunAdi,
        miktar: 1,
        birim: u.Birim || 'Adet',
        alisFiyati: Number(u.AlisFiyati) || 0,
        satisFiyati: Number(u.SatisFiyati) || 0,
        yeniUrun: false,
      });
    }
    tedAlimSepetCiz();
  }

  async function tedAlimKaydet(ev) {
    ev.preventDefault();
    if (!detayTedarikciID) return;
    if (!tedAlimSepet.length) {
      toast('En az bir ürün ekleyin');
      return;
    }
    const stoga = !!$('tedAlimStoga')?.checked;
    const odemeVarMi = !!$('tedAlimOdemeVar')?.checked;
    let odenenTutar = odemeVarMi ? parseFloat($('tedAlimOdenen').value) : 0;
    if (!Number.isFinite(odenenTutar) || odenenTutar < 0) odenenTutar = 0;
    const toplam = Math.round(tedAlimToplam() * 100) / 100;
    if (odemeVarMi && odenenTutar > toplam) {
      toast('Ödenen tutar toplamdan büyük olamaz');
      return;
    }
    const stogaMsg = stoga
      ? 'Ürünler stoğa işlenecek.'
      : 'Stok güncellenmeyecek; sadece cari kaydı oluşacak.';
    if (!confirm(`Mal alımı kaydedilsin mi?\n${stogaMsg}`)) return;
    try {
      const res = await apiFetch('/api/tedarikci/alim', {
        method: 'POST',
        body: JSON.stringify({
          tedarikciID: detayTedarikciID,
          kalemler: tedAlimSepet.map((s) => ({
            stokID: s.stokID,
            urunAdi: s.urunAdi,
            miktar: Number(s.miktar) || 1,
            birim: s.birim || 'Adet',
            alisFiyati: Number(s.alisFiyati) || 0,
            satisFiyati: Number(s.satisFiyati) || 0,
            yeniUrun: !!s.yeniUrun,
          })),
          odemeVarMi,
          odenenTutar,
          odemeSekli: $('tedAlimOdemeSekli')?.value || 'Nakit',
          stogaAktar: stoga,
          kullanici: aktifKullanici,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload.success === false) {
        toast(payload.message || 'Kayıt başarısız');
        return;
      }
      $('dlgTedarikAlim').close();
      toast(payload.message || 'Mal alım kaydedildi');
      const [tedRes, stokRes] = await Promise.all([apiFetch('/api/tedarikci'), apiFetch('/api/stok')]);
      tedarikciCache = tedRes.ok ? await tedRes.json() : tedarikciCache;
      if (stokRes.ok) {
        stokCache = await stokRes.json();
        stokCacheIndeksle();
      }
      await gunlukKasaYukle();
      await tedarikciCariAc(detayTedarikciID, true);
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  /* ——— Büyük harf girişi ——— */
  const BUYUK_HARF_DISLA_TIP = new Set([
    'password', 'email', 'number', 'date', 'datetime-local', 'month', 'week',
    'time', 'file', 'hidden', 'range', 'color', 'checkbox', 'radio', 'submit', 'button',
  ]);

  function metinBuyukHarfMi(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.dataset?.buyukHarf === 'false' || el.classList?.contains('buyuk-harf-kapali')) return false;
    if (el.closest?.('#view-login')) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const t = String(el.type || 'text').toLowerCase();
    if (BUYUK_HARF_DISLA_TIP.has(t)) return false;
    return t === 'text' || t === 'search' || t === 'tel' || t === '';
  }

  function metinGirisBuyukHarfUygula(el) {
    if (!metinBuyukHarfMi(el) || el.dataset?.composing === '1') return;
    const bas = el.selectionStart;
    const son = el.selectionEnd;
    const yeni = String(el.value ?? '').toLocaleUpperCase('tr-TR');
    if (yeni === el.value) return;
    el.value = yeni;
    if (typeof bas === 'number' && typeof son === 'number') {
      try { el.setSelectionRange(bas, son); } catch (_) {}
    }
  }

  function buyukHarfGirisBaslat() {
    if (window.__buyukHarfGirisMobil) return;
    window.__buyukHarfGirisMobil = true;
    document.addEventListener('compositionstart', (e) => {
      if (metinBuyukHarfMi(e.target)) e.target.dataset.composing = '1';
    }, true);
    document.addEventListener('compositionend', (e) => {
      const t = e.target;
      if (!metinBuyukHarfMi(t)) return;
      delete t.dataset.composing;
      metinGirisBuyukHarfUygula(t);
    }, true);
    document.addEventListener('input', (e) => metinGirisBuyukHarfUygula(e.target), true);
    document.addEventListener('paste', (e) => {
      const t = e.target;
      if (!metinBuyukHarfMi(t)) return;
      requestAnimationFrame(() => metinGirisBuyukHarfUygula(t));
    }, true);
    document.addEventListener('blur', (e) => metinGirisBuyukHarfUygula(e.target), true);
  }

  /* ——— Olaylar ——— */
  function init() {
    buyukHarfGirisBaslat();
    apiBase = varsayilanApiBase();
    const savedUser = localStorage.getItem(LS_USER);
    const savedSifre = localStorage.getItem(LS_SIFRE);
    if (savedUser) $('kullaniciAdi').value = savedUser;
    if (savedSifre) $('sifre').value = savedSifre;

    $('btnGiris').onclick = girisYap;
    $('sifre').addEventListener('keydown', (e) => { if (e.key === 'Enter') girisYap(); });
    $('kullaniciAdi').addEventListener('keydown', (e) => { if (e.key === 'Enter') girisYap(); });
    $('btnCikis').onclick = () => { if (confirm('Çıkış yapılsın mı?')) cikisYap(); };

    $('btnBarkodTara').onclick = () => barkodTaraAc('satis');
    $('btnTedarikciEkle')?.addEventListener('click', tedarikciEkleDialogAc);
    $('tedarikciArama')?.addEventListener('input', () => tedarikciListele());
    $('btnTedarikciGeri')?.addEventListener('click', tedarikciCariGeri);
    $('btnTedarikAlim')?.addEventListener('click', tedAlimDialogAc);
    $('btnTedarikOdeme')?.addEventListener('click', tedarikOdemeDialogAc);
    $('formTedarikciEkle')?.addEventListener('submit', tedarikciEkleKaydet);
    $('formTedarikOdeme')?.addEventListener('submit', tedarikOdemeKaydet);
    $('formTedarikAlim')?.addEventListener('submit', tedAlimKaydet);
    $('formTedarikHareketDuzenle')?.addEventListener('submit', tedarikciHareketDuzenleKaydet);
    $('tedarikciHareketListe')?.addEventListener('click', (e) => {
      const sil = e.target.closest('[data-ted-sil]');
      if (sil) {
        tedarikciHareketSil(sil.getAttribute('data-ted-sil'), Number(sil.getAttribute('data-ted-id')));
        return;
      }
      const duz = e.target.closest('[data-ted-duzenle]');
      if (duz) {
        tedarikciHareketDuzenleAc(duz.getAttribute('data-ted-duzenle'), Number(duz.getAttribute('data-ted-id')));
      }
    });
    $('tedAlimOdemeVar')?.addEventListener('change', () => {
      const blok = $('tedAlimOdemeBlok');
      if (blok) blok.hidden = !$('tedAlimOdemeVar').checked;
      if ($('tedAlimOdemeVar')?.checked) {
        $('tedAlimOdenen').value = tedAlimToplam().toFixed(2);
      }
    });
    $('tedAlimArama')?.addEventListener('input', (e) => tedAlimAramaGoster(e.target.value));
    $('tedAlimSepet')?.addEventListener('click', (e) => {
      const sil = e.target.closest('[data-ted-alim-sil]');
      if (!sil) return;
      const i = Number(sil.getAttribute('data-ted-alim-sil'));
      if (Number.isInteger(i)) {
        tedAlimSepet.splice(i, 1);
        tedAlimSepetCiz();
      }
    });
    $('tedAlimSepet')?.addEventListener('input', (e) => {
      const mik = e.target.closest('[data-ted-alim-mik]');
      const alis = e.target.closest('[data-ted-alim-alis]');
      if (mik) {
        const i = Number(mik.getAttribute('data-ted-alim-mik'));
        const raw = String(mik.value || '').trim();
        if (raw === '') return;
        const v = parseInt(raw, 10);
        if (tedAlimSepet[i] && Number.isFinite(v) && v > 0) {
          tedAlimSepet[i].miktar = v;
          tedAlimSatirTutarGuncelle(i);
        }
      } else if (alis) {
        const i = Number(alis.getAttribute('data-ted-alim-alis'));
        const raw = String(alis.value || '').trim();
        if (raw === '' || raw === '.') return;
        const v = parseFloat(raw);
        if (tedAlimSepet[i] && Number.isFinite(v) && v >= 0) {
          tedAlimSepet[i].alisFiyati = v;
          tedAlimSatirTutarGuncelle(i);
        }
      }
    });
    $('tedAlimSepet')?.addEventListener('change', (e) => {
      const mik = e.target.closest('[data-ted-alim-mik]');
      const alis = e.target.closest('[data-ted-alim-alis]');
      if (mik) {
        const i = Number(mik.getAttribute('data-ted-alim-mik'));
        let v = parseInt(mik.value, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (tedAlimSepet[i]) tedAlimSepet[i].miktar = v;
        mik.value = String(v);
        tedAlimSatirTutarGuncelle(i);
      } else if (alis) {
        const i = Number(alis.getAttribute('data-ted-alim-alis'));
        let v = parseFloat(alis.value);
        if (!Number.isFinite(v) || v < 0) v = 0;
        if (tedAlimSepet[i]) tedAlimSepet[i].alisFiyati = v;
        alis.value = String(v);
        tedAlimSatirTutarGuncelle(i);
      }
    });

    $('btnBarkodTara').onclick = () => barkodTaraAc('satis');
    $('btnStokBarkodTara')?.addEventListener('click', (e) => {
      e.preventDefault();
      stokBarkodTaraAc();
    });
    $('btnBarkodKapat').onclick = () => barkodTaraKapat();
    $('btnBarkodFoto').onclick = () => barkodFotoSecAc();
    $('barkodFotoInput')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) barkodFotoDosyaOku(f);
    });
    $('satisArama').addEventListener('input', (e) => satisAramaGecikmeli(e.target.value));
    $('satisArama').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = e.target.value.trim();
      const { liste: filtre } = stokAraFiltrele(q, 25, { hizmetHaric: true });
      if (filtre.length === 1) sepeteEkle(filtre[0]);
      else if (filtre.length === 0 && q.length >= 2) {
        stokYokSoruKarti($('satisAramaSonuc'), q, 'satis');
      } else if (filtre.length === 0) toast('Ürün bulunamadı');
    });
    $('btnSepetTemizle').onclick = () => { sepet = []; sepetCiz(); };
    $('btnSatisTamamla').onclick = satisDialogAc;
    $('btnYeniSatis')?.addEventListener('click', () => yeniSatisModalAc());
    $('btnSatisStokDisi')?.addEventListener('click', () => stokDisiDialogAc('sepet'));
    $('btnMusteriSatisStokDisi')?.addEventListener('click', () => stokDisiDialogAc('musteri'));
    $('formStokDisi')?.addEventListener('submit', stokDisiKaydet);
    $('stokDisiKisayol')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-stok-disi-sablon]');
      if (!chip) return;
      stokDisiSablonUygula(chip.getAttribute('data-stok-disi-sablon') || 'diger');
    });
    $('dlgYeniSatis')?.addEventListener('close', () => {
      barkodTaraKapat();
      const sonuc = $('satisAramaSonuc');
      if (sonuc) sonuc.hidden = true;
    });
    $('formSatis').onsubmit = satisKaydet;
    $('dlgSatis')?.addEventListener('close', () => {
      if (_gunlukDuzenleLogID) gunlukPerakendeDuzenleSifirla();
    });
    document.querySelectorAll('#formSatis input[name="satisMusteriModu"]').forEach((el) => {
      el.addEventListener('change', satisMusteriModuUygula);
    });
    document.querySelectorAll('#formSatis input[name="odemeTipi"]').forEach((el) => {
      el.addEventListener('change', () => {
        if (el.value === 'Veresiye' && el.checked) {
          document.querySelector('#formSatis input[name="satisMusteriModu"][value="musteri"]').checked = true;
        }
        satisMusteriModuUygula();
      });
    });
    $('satisMusteriAra').addEventListener('input', (e) => satisMusteriAraGoster(e.target.value));
    $('btnSatisMusteriYeni').onclick = () => {
      document.querySelector('#formSatis input[name="satisMusteriModu"][value="musteri"]').checked = true;
      satisMusteriModuUygula();
      musteriEkleDialogAc('satis');
      const q = ($('satisMusteriAra').value || '').trim();
      if (q) {
        $('yeniMusteriAd').value = /^\d+$/.test(q.replace(/\D/g, '')) ? '' : q;
        $('yeniMusteriTel').value = /^\d{10,11}$/.test(q.replace(/\D/g, ''))
          ? q.replace(/\D/g, '').replace(/^0/, '')
          : '';
      }
    };
    $('formMusteriEkle').onsubmit = musteriHizliEkle;
    $('formMusteriDuzenle')?.addEventListener('submit', musteriDuzenleKaydet);
    $('formStokYok')?.addEventListener('submit', stokYokOnayla);
    $('formAdetGir')?.addEventListener('submit', adetGirKaydet);
    $('btnAdetGirAz')?.addEventListener('click', () => adetGirDegistir(-1));
    $('btnAdetGirArt')?.addEventListener('click', () => adetGirDegistir(1));
    $('dlgStokYok')?.addEventListener('close', () => {
      if (!_stokYokOnaylandi) stokEkleDonusHedef = null;
      _stokYokOnaylandi = false;
    });
    $('dlgStok')?.addEventListener('close', () => {
      stokEkleDonusHedef = null;
    });
    $('btnMusteriSil')?.addEventListener('click', musteriMobilSil);
    $('musteriDetayOzet')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-musteri-duzenle]');
      if (btn) {
        e.preventDefault();
        musteriDuzenleDialogAc();
      }
    });
    document.querySelectorAll('[data-dialog-close]').forEach((b) => {
      b.onclick = () => b.closest('dialog')?.close();
    });
    $('dlgMusteriSatis')?.addEventListener('close', () => {
      if (_musteriHareketDuzenleTip === 'satis') musteriHareketDuzenleSifirla();
    });
    $('dlgOdeme')?.addEventListener('close', () => {
      if (_musteriHareketDuzenleTip === 'odeme') musteriHareketDuzenleSifirla();
    });

    $('stokArama').addEventListener('input', () => stokListeleGecikmeli());
    $('stokArama').addEventListener('search', stokListele);
    $('btnStokEkle')?.addEventListener('click', stokEkleDialogAc);
    $('formStok')?.addEventListener('submit', stokKaydet);
    $('formSilOnay')?.addEventListener('submit', silOnayFormGonder);
    $('dlgSilOnay')?.addEventListener('close', () => {
      if (_silOnayResolve) silOnayKapat(false);
    });
    $('stokListe')?.addEventListener('click', (e) => {
      const duz = e.target.closest('[data-stok-duzenle]');
      const sil = e.target.closest('[data-stok-sil]');
      if (duz) stokDuzenleDialogAc(+duz.dataset.stokDuzenle);
      if (sil) stokSil(+sil.dataset.stokSil);
    });
    $('musteriHareketListe')?.addEventListener('click', (e) => {
      const duz = e.target.closest('[data-hareket-duzenle]');
      if (duz) {
        e.preventDefault();
        e.stopPropagation();
        musteriHareketDuzenleAc(+duz.dataset.hareketDuzenle, duz.dataset.hareketTip);
        return;
      }
      const btn = e.target.closest('[data-hareket-sil]');
      if (btn) musteriHareketSil(+btn.dataset.hareketSil);
    });
    const gunlukSilTik = (e) => {
      const duz = e.target.closest('[data-gunluk-duzenle]');
      if (duz) {
        e.preventDefault();
        e.stopPropagation();
        gunlukPerakendeDuzenle(+duz.dataset.gunlukDuzenle);
        return;
      }
      const btn = e.target.closest('[data-gunluk-sil]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      gunlukSatisSil(+btn.dataset.gunlukSil);
    };
    $('gunlukIslemListe')?.addEventListener('click', gunlukSilTik);
    $('sonIslemListe')?.addEventListener('click', gunlukSilTik);
    $('musteriArama').addEventListener('input', musteriListele);
    $('musteriSadeceBorc').addEventListener('change', musteriListele);
    $('btnMusteriEkle')?.addEventListener('click', () => musteriEkleDialogAc('liste'));

    document.querySelectorAll('.nav-kart').forEach((btn) => {
      btn.onclick = () => {
        const nav = btn.dataset.nav;
        panelGoster(nav);
      };
    });

    $('btnAnaGeri')?.addEventListener('click', anaGeriTikla);
    $('btnGunlukListele')?.addEventListener('click', () => bugunPanelYukle());
    $('btnSonIslemTum')?.addEventListener('click', () => panelGoster('bugun'));

    $('btnMusteriGeri').onclick = musteriDetayGeri;
    $('btnMusteriSatis').onclick = musteriDetaySatisAc;
    $('formMusteriSatis').onsubmit = musteriSatisKaydet;
    $('musteriSatisArama').addEventListener('input', (e) => musteriSatisAramaGecikmeli(e.target.value));
    $('musteriSatisArama').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = e.target.value.trim();
      const { liste: filtre } = stokAraFiltrele(q, 25, { hizmetHaric: true });
      if (filtre.length === 1) musteriSatisSepeteEkle(filtre[0]);
      else if (filtre.length === 0 && q) toast('Ürün bulunamadı');
    });
    $('btnMusteriSatisBarkod').onclick = () => barkodTaraAc('musteri-satis');
    document.querySelectorAll('#formMusteriSatis input[name="musteriSatisOdeme"]').forEach((el) => {
      el.addEventListener('change', musteriSatisTahsilatGuncelle);
    });
    $('btnMusteriWhatsapp').onclick = musteriWhatsappPaylas;
    $('btnMusteriOdeme').onclick = odemeDialogAc;
    $('formOdeme').onsubmit = odemeKaydet;

    document.querySelectorAll('input[name="odemeTipi"]').forEach((r) => {
      r.addEventListener('change', () => {
        const v = document.querySelector('input[name="odemeTipi"]:checked')?.value;
        const t = $('satisTahsilat');
        const toplam = Math.round(sepetToplamHesapla() * 100) / 100;
        if (v === 'Veresiye') t.value = '0';
        else if (!$('satisMusteriID').value) t.value = toplam.toFixed(2);
      });
    });

    showView('login');
    sepetCiz();
    barkodUiGuncelle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
