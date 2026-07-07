(function () {
  'use strict';

  const LS_USER = 'elektrik_mobil_kullanici';
  const LS_SIFRE = 'elektrik_mobil_sifre';

  let apiBase = '';
  let aktifKullanici = '';
  let stokCache = [];
  let musteriCache = [];
  let sepet = [];
  let detayMusteriID = null;

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

  /** MSSQL/API: Z veya offset varsa yerel saate; timezone yoksa duvar saati (masaüstü ile aynı). */
  function sqlTarihParse(val) {
    if (val == null || val === '') return null;
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
    const s = String(val).trim();
    if (!s) return null;
    if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
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

  /** Ödemede sadece ödeme şekli; satışta açıklama (not). */
  function hareketMobilNot(h) {
    const turRaw = String(h.Tur || '').toLowerCase();
    if (turRaw === 'odeme' || turRaw === 'iadeodeme') {
      const odeme = String(h.OdemeSekli || '').trim();
      return odeme && odeme !== '—' ? odeme : '';
    }
    return String(h.Aciklama || '').trim();
  }

  function hareketMobilTutarlar(h) {
    const tur = String(h.Tur || '').toLowerCase();
    const toplam = Number(h.ToplamTutar || 0);
    let odenen = Number(h.OdenenTutar || 0);
    const kalan = Number(h.KalanTutar ?? Math.max(0, toplam - odenen));
    if (tur === 'odeme' || tur === 'iadeodeme') {
      return { toplam: 0, odenen };
    }
    if (tur === 'satis' || tur === 'iade') {
      if (toplam > 0 && odenen >= toplam - 0.005 && kalan <= 0.005) {
        odenen = 0;
      }
      return { toplam, odenen };
    }
    return { toplam, odenen: 0 };
  }

  function hareketMobilHtml(h) {
    const sinif = hareketMobilSinif(h);
    const etiket = hareketTurEtiket(h.Tur);
    const { toplam, odenen } = hareketMobilTutarlar(h);
    const tarih = esc(tarihTrGoster(h.Tarih));
    const not = hareketMobilNot(h);
    const notHtml = not
      ? `<div class="hareket-not">${esc(not)}</div>`
      : '';
    return `
      <li class="hareket-item ${sinif}">
        <div class="hareket-ust">
          <span class="hareket-tur">${esc(etiket)}</span>
          <div class="hareket-tutarlar">
            <div class="hareket-tutar-satir">
              <span class="hareket-tutar-etiket">Toplam</span>
              <span class="hareket-toplam-deger">${para(toplam)}</span>
            </div>
            <div class="hareket-tutar-satir">
              <span class="hareket-tutar-etiket">Ödeme</span>
              <span class="hareket-odeme-deger${odenen > 0 ? ' hareket-odeme-dolu' : ''}">${para(odenen)}</span>
            </div>
          </div>
        </div>
        <div class="hareket-alt">
          <span class="hareket-tarih">${tarih}</span>
          ${notHtml}
        </div>
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

  function barkodNorm(s) {
    return String(s || '').trim().replace(/\s/g, '');
  }

  function stokAraEsles(stok, q) {
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
  let barkodStream = null;
  let barkodRaf = 0;
  let barkodDetector = null;
  let barkodSonTespitMs = 0;
  let sonBarkodKod = '';
  let sonBarkodZaman = 0;

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

  function barkodFotoModuAc(altMetin) {
    const wrap = $('barkodTarayici');
    if (!wrap) return;
    wrap.hidden = false;
    barkodTaramaAcik = true;
    const readerEl = $('barkodReader');
    if (readerEl) {
      readerEl.innerHTML =
        '<div class="barkod-foto-placeholder"><span class="barkod-foto-ikon">📷</span><p>Canlı okuma açılamadı.</p><p class="barkod-foto-alt">Önce üstteki arama kutusuna barkodu yazın; olmazsa aşağıdan yedek fotoğraf.</p></div>';
    }
    barkodDurumYaz(altMetin || 'Fotoğraf çek — barkod sepete eklenir');
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
      barkodDurumYaz(`${msg} — Tekrar «Fotoğraf çek» veya barkodu arama kutusuna yazın.`);
      const arama = $('satisArama');
      if (arama) {
        arama.focus();
        arama.placeholder = 'Barkodu buraya yazın…';
      }
    } finally {
      if (readerEl && !barkodQr) {
        readerEl.innerHTML =
          '<div class="barkod-foto-placeholder"><span class="barkod-foto-ikon">📷</span><p>Okunamadı — tekrar deneyin</p></div>';
      }
    }
  }

  async function barkodTaraAc() {
    if (!stokCache.length) {
      toast('Stok listesi yükleniyor…');
      await veriYukle();
    }
    if (barkodTaramaAcik) return;

    const wrap = $('barkodTarayici');
    if (!wrap) return;

    wrap.hidden = false;
    barkodTaramaAcik = true;
    barkodDurumYaz('Kamera açılıyor…');

    let canliHata = null;
    try {
      await barkodCanliVideoBaslat();
      barkodDurumYaz('Barkodu çerçeveye tutun — otomatik okunur, fotoğraf çekmeyin');
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
        barkodDurumYaz('Barkodu çerçeveye hizalayın — otomatik okunur');
        return;
      } catch (e2) {
        console.warn('Html5Qrcode tarama:', e2);
        barkodKameraDurdur();
      }
    }

    const msg = !navigator.mediaDevices?.getUserMedia
      ? 'Bu adreste canlı kamera açılmıyor (http). Barkodu arama kutusuna yazın veya yedek fotoğraf.'
      : barkodHataMesaji(canliHata);
    barkodFotoModuAc(msg);
    toast('Canlı okuma yok — barkodu yazın veya yedek fotoğraf');
  }

  function toast(msg, ms = 2800) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, ms);
  }

  function showView(name) {
    $('view-login').hidden = name !== 'login';
    $('view-app').hidden = name !== 'app';
  }

  function panelGoster(id) {
    if (id !== 'satis') barkodTaraKapat();
    document.querySelectorAll('.panel').forEach((p) => {
      const on = p.id === `panel-${id}`;
      p.hidden = !on;
      p.classList.toggle('panel-active', on);
    });
    const baslik = { satis: 'Satış', stok: 'Stok', musteri: 'Cari', 'musteri-detay': 'Cari detay' };
    $('headerBaslik').textContent = baslik[id] || 'ELEKTRIK';
    $('bottomNav').hidden = id === 'musteri-detay';
    if (id !== 'musteri-detay') {
      document.querySelectorAll('.nav-btn').forEach((b) => {
        b.classList.toggle('nav-active', b.dataset.nav === id);
      });
    }
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
      panelGoster('satis');
      satisPanelHazirla();
      await veriYukle();
    } catch (e) {
      console.error(e);
      hata.textContent = 'Sunucuya bağlanılamadı. Ağı kontrol edin.';
      hata.hidden = false;
    } finally {
      girisButonPasif(false);
    }
  }

  async function gunlukKasaYukle() {
    const bar = $('kasaOzetBar');
    if (!bar) return;
    try {
      const res = await apiFetch('/api/gunluk-islemler');
      if (!res.ok) return;
      const data = await res.json();
      const oz = data.ozet || {};
      const set = (id, val) => {
        const el = $(id);
        if (el) el.textContent = para(val);
      };
      set('kzNakit', oz.nakit);
      set('kzKart', oz.kart);
      set('kzHavale', oz.havale);
      set('kzToplam', oz.toplam);
      set('kzKasaGiris', oz.kasaGiris);
    } catch (e) {
      console.error(e);
    }
  }

  function cikisYap() {
    barkodTaraKapat();
    sepet = [];
    stokCache = [];
    musteriCache = [];
    detayMusteriID = null;
    sepetCiz();
    showView('login');
  }

  async function veriYukle() {
    try {
      const [stokRes, musRes] = await Promise.all([
        apiFetch('/api/stok'),
        apiFetch('/api/musteri'),
      ]);
      stokCache = stokRes.ok ? await stokRes.json() : [];
      musteriCache = musRes.ok ? await musRes.json() : [];
      stokListele();
      musteriListele();
      await gunlukKasaYukle();
    } catch (e) {
      console.error(e);
      toast('Veri yüklenemedi');
    }
  }

  /* ——— Sepet ——— */
  function sepetToplamHesapla() {
    return sepet.reduce((t, s) => t + s.birimFiyat * s.miktar, 0);
  }

  function sepeteEkle(urun) {
    const id = urun.StokID;
    const bf = Number(urun.SatisFiyati) || 0;
    const mevcut = sepet.find((s) => s.stokID === id);
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
    $('satisArama').value = '';
    $('satisAramaSonuc').hidden = true;
    sepetCiz();
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
        li.innerHTML = `
          <span class="sepet-ad">${esc(s.urunAdi)}</span>
          <div class="sepet-miktar-wrap">
            <button type="button" class="sepet-miktar-btn" data-az="${idx}">−</button>
            <span class="sepet-miktar">${s.miktar}</span>
            <button type="button" class="sepet-miktar-btn" data-art="${idx}">+</button>
          </div>
          <span class="sepet-satir-tutar">${para(satirTutar)}</span>
          <button type="button" class="sepet-sil" data-sil="${idx}" aria-label="Sil">×</button>`;
        ul.appendChild(li);
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
      ul.querySelectorAll('[data-sil]').forEach((btn) => {
        btn.onclick = () => { sepet.splice(+btn.dataset.sil, 1); sepetCiz(); };
      });
    }
    $('sepetToplam').textContent = para(toplam);
  }

  function satisAramaGoster(q) {
    const box = $('satisAramaSonuc');
    const trimmed = String(q || '').trim();
    if (!trimmed) {
      box.hidden = true;
      return;
    }
    const filtre = stokCache.filter((s) => stokAraEsles(s, trimmed)).slice(0, 25);
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
      box.hidden = true;
      return;
    }
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

  function satisDialogAc() {
    if (sepet.length === 0) return;
    const toplam = Math.round(sepetToplamHesapla() * 100) / 100;
    $('dlgSatisToplam').textContent = para(toplam);
    $('satisTahsilat').value = toplam.toFixed(2);
    satisMusteriTemizle();
    document.querySelector('#formSatis input[name="satisMusteriModu"][value="perakende"]').checked = true;
    document.querySelector('#formSatis input[name="odemeTipi"][value="Nakit"]').checked = true;
    satisMusteriModuUygula();
    $('dlgSatis').showModal();
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
      return ad.includes(trimmedLo) || tel.includes(trimmedLo) || String(m.MusteriID).includes(trimmed);
    }).slice(0, 15);
    box.innerHTML = '';
    filtre.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'arama-item';
      btn.innerHTML = `<span>${esc(musteriGorunenAd(m))}<span class="arama-item-alt">#${m.MusteriID}</span></span>`;
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
        $('dlgMusteriEkle').showModal();
      };
      box.appendChild(btn);
    }
    box.hidden = filtre.length === 0 && trimmed.length < 2;
    if (filtre.length > 0 || trimmed.length >= 2) box.hidden = false;
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
    if (!/^[1-9][0-9]{9}$/.test(tel)) {
      toast('Telefon 10 hane olmalı (0 olmadan)');
      return;
    }
    try {
      const res = await apiFetch('/api/musteri', {
        method: 'POST',
        body: JSON.stringify({ AdSoyad: ad, Telefon: tel, tur: 'Gercek' }),
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
        yeni = musteriCache.find((m) => String(m.Telefon || '') === tel && musteriGorunenAd(m) === ad)
          || musteriCache.find((m) => String(m.Telefon || '') === tel);
      }
      $('dlgMusteriEkle').close();
      if (yeni) {
        satisMusteriSec(yeni);
        toast('Müşteri eklendi');
      } else {
        toast('Müşteri eklendi — listeden seçin');
        satisMusteriAraGoster(ad);
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  async function satisKaydet(ev) {
    ev.preventDefault();
    const odemeEl = document.querySelector('#formSatis input[name="odemeTipi"]:checked');
    const odemeTipi = odemeEl ? odemeEl.value : 'Nakit';
    let musteriID = parseInt($('satisMusteriID').value, 10);
    if (!Number.isInteger(musteriID) || musteriID < 1) musteriID = null;

    if (satisMusteriModuMu() && !musteriID) {
      toast('Müşteri seçin veya yeni ekleyin');
      return;
    }
    if (odemeTipi === 'Veresiye' && !musteriID) {
      toast('Veresiye için müşteri seçin');
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
    else if (!musteriID) tahsilatTutar = sepetToplam;
    if (musteriID && odemeTipi !== 'Veresiye' && tahsilatTutar > sepetToplam) {
      toast('Tahsilat sepet toplamını geçemez');
      return;
    }

    const kalemler = sepet.map((s) => ({
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
    if (musteriID) body.musteriID = musteriID;

    try {
      const res = await apiFetch('/api/satis-sepet', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success) {
        $('dlgSatis').close();
        sepet = [];
        sepetCiz();
        toast('Satış kaydedildi');
        await veriYukle();
      } else {
        toast(payload.message || 'Satış tamamlanamadı');
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  /* ——— Stok ——— */
  function stokListele() {
    const q = ($('stokArama').value || '').trim();
    const ul = $('stokListe');
    let liste = stokCache;
    if (q) liste = liste.filter((s) => stokAraEsles(s, q));
    liste = [...liste].sort((a, b) =>
      String(a.UrunAdi || '').localeCompare(String(b.UrunAdi || ''), 'tr'));
    ul.innerHTML = '';
    $('stokBos').hidden = liste.length > 0;
    liste.forEach((s) => {
      const miktar = Number(s.MevcutMiktar) || 0;
      const seviye = stokSeviyeBilgi(s);
      const alt = `Stok: <strong>${miktar}</strong> ${esc(s.Birim || 'Adet')}${s.Barkod ? ` · ${esc(s.Barkod)}` : ''}`;
      ul.appendChild(
        kartListeHtml({
          baslik: s.UrunAdi,
          alt,
          tutar: para(s.SatisFiyati),
          rozet: seviye,
        }),
      );
    });
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
        return ad.includes(q) || tel.includes(q) || String(m.MusteriID).includes(q);
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
          alt: `${m.Telefon ? esc(m.Telefon) + ' · ' : ''}#${m.MusteriID}`,
          tutar: para(bakiye),
          tutarCls: bakiyeCls,
          rozet,
          tikla: () => musteriDetayAc(m.MusteriID),
        }),
      );
    });
  }

  async function musteriDetayAc(id) {
    detayMusteriID = id;
    panelGoster('musteri-detay');
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
      ozet.innerHTML = `
        <h2>${esc(musteriGorunenAd(m))}</h2>
        <p class="kart-alt">${m.Telefon ? esc(m.Telefon) : ''} ${m.Il ? '· ' + esc(m.Il) : ''}</p>
        <p class="detay-bakiye ${bakiyeCls}">${para(bakiye)}</p>
        <p class="kart-alt">Bakiye ${bakiye > 0 ? '(borç)' : bakiye < 0 ? '(alacak)' : ''}</p>`;
      $('btnMusteriOdeme').disabled = bakiye <= 0;
      const html = (data.hareketler || []).map((h) => hareketMobilHtml(h)).join('');
      ul.innerHTML = html || '<li class="bos-metin">Hareket yok</li>';
    } catch (e) {
      console.error(e);
      ozet.innerHTML = '<p class="bakiye-borc">Yüklenemedi</p>';
    }
  }

  function odemeDialogAc() {
    const m = musteriCache.find((x) => x.MusteriID === detayMusteriID);
    if (!m) return;
    $('dlgOdemeMusteri').textContent = musteriGorunenAd(m);
    const bakiye = Number(m.Bakiye) || 0;
    $('odemeTutar').value = bakiye > 0 ? bakiye.toFixed(2) : '';
    $('dlgOdeme').showModal();
  }

  async function odemeKaydet(ev) {
    ev.preventDefault();
    const tutar = parseFloat($('odemeTutar').value);
    if (!Number.isFinite(tutar) || tutar <= 0) {
      toast('Geçerli tutar girin');
      return;
    }
    try {
      const res = await apiFetch(`/api/musteri/${detayMusteriID}/odeme`, {
        method: 'POST',
        body: JSON.stringify({
          tutar,
          odemeSekli: $('odemeSekli').value,
          kullanici: aktifKullanici,
          aciklama: 'Mobil tahsilat',
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success !== false) {
        $('dlgOdeme').close();
        toast('Tahsilat kaydedildi');
        await veriYukle();
        await gunlukKasaYukle();
        await musteriDetayAc(detayMusteriID);
      } else {
        toast(payload.message || 'Tahsilat kaydedilemedi');
      }
    } catch (e) {
      console.error(e);
      toast('Bağlantı hatası');
    }
  }

  /* ——— Olaylar ——— */
  function init() {
    apiBase = varsayilanApiBase();
    const savedUser = localStorage.getItem(LS_USER);
    const savedSifre = localStorage.getItem(LS_SIFRE);
    if (savedUser) $('kullaniciAdi').value = savedUser;
    if (savedSifre) $('sifre').value = savedSifre;

    $('btnGiris').onclick = girisYap;
    $('sifre').addEventListener('keydown', (e) => { if (e.key === 'Enter') girisYap(); });
    $('kullaniciAdi').addEventListener('keydown', (e) => { if (e.key === 'Enter') girisYap(); });
    $('btnCikis').onclick = () => { if (confirm('Çıkış yapılsın mı?')) cikisYap(); };

    $('btnBarkodTara').onclick = () => barkodTaraAc();
    $('btnBarkodKapat').onclick = () => barkodTaraKapat();
    $('btnBarkodFoto').onclick = () => barkodFotoSecAc();
    $('barkodFotoInput')?.addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) barkodFotoDosyaOku(f);
    });
    $('satisArama').addEventListener('input', (e) => satisAramaGoster(e.target.value));
    $('satisArama').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const q = e.target.value.trim();
      const filtre = stokCache.filter((s) => stokAraEsles(s, q));
      if (filtre.length === 1) sepeteEkle(filtre[0]);
      else if (filtre.length === 0) toast('Ürün bulunamadı');
    });
    $('btnSepetTemizle').onclick = () => { sepet = []; sepetCiz(); };
    $('btnSatisTamamla').onclick = satisDialogAc;
    $('formSatis').onsubmit = satisKaydet;
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
      const q = ($('satisMusteriAra').value || '').trim();
      $('yeniMusteriAd').value = q.replace(/^\d+$/, '') ? q : '';
      $('yeniMusteriTel').value = /^\d+$/.test(q.replace(/\D/g, '')) ? q.replace(/\D/g, '').replace(/^0/, '') : '';
      document.querySelector('#formSatis input[name="satisMusteriModu"][value="musteri"]').checked = true;
      satisMusteriModuUygula();
      $('dlgMusteriEkle').showModal();
    };
    $('formMusteriEkle').onsubmit = musteriHizliEkle;
    document.querySelectorAll('[data-dialog-close]').forEach((b) => {
      b.onclick = () => b.closest('dialog')?.close();
    });

    $('stokArama').addEventListener('input', stokListele);
    $('musteriArama').addEventListener('input', musteriListele);
    $('musteriSadeceBorc').addEventListener('change', musteriListele);

    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.onclick = () => {
        const nav = btn.dataset.nav;
        panelGoster(nav);
        if (nav === 'stok') stokListele();
        if (nav === 'musteri') musteriListele();
      };
    });

    $('btnMusteriGeri').onclick = () => {
      panelGoster('musteri');
      musteriListele();
    };
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
