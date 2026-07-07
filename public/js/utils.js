function electronOrtamiMi() {
  return !!(window.electronAPI || /Electron/i.test(navigator.userAgent || ''));
}

function modalKapat(modalEl) {
  if (!modalEl) return;
  const inst = bootstrap.Modal.getInstance(modalEl);
  if (inst) inst.hide();
  else bootstrap.Modal.getOrCreateInstance(modalEl).hide();
  setTimeout(modalArtigiTemizle, 0);
  setTimeout(modalArtigiTemizle, 350);
}

/** Modallar ana-uygulama içindeyken backdrop üstte kalır; hepsini body altına taşı. */
function modallariGovdeyeTasi() {
  const kok = document.getElementById('ana-uygulama');
  if (!kok) return;
  const eklenecek = [
    ...kok.querySelectorAll('.modal'),
    document.getElementById('belgeOnizlemeKatman'),
  ].filter(Boolean);
  const ilkScript = document.body.querySelector('script');
  eklenecek.forEach((el) => {
    if (el.parentElement === document.body) return;
    if (ilkScript) document.body.insertBefore(el, ilkScript);
    else document.body.appendChild(el);
  });
}

/** Açık modalların backdrop üstünde kalması (z-index + fazla perde temizliği). */
function modalKatmanlariniDuzelt(ustModal) {
  modallariGovdeyeTasi();

  const ana = document.getElementById('ana-uygulama');
  if (ana) {
    ana.removeAttribute('aria-hidden');
    ana.removeAttribute('inert');
    ana.style.pointerEvents = 'auto';
  }

  const acikModallar = [...document.querySelectorAll('.modal.show')];
  let backdrops = [...document.querySelectorAll('.modal-backdrop')];
  if (backdrops.length > acikModallar.length) {
    for (let i = acikModallar.length; i < backdrops.length; i += 1) {
      backdrops[i].remove();
    }
    backdrops = [...document.querySelectorAll('.modal-backdrop')];
  }

  let z = 1040;
  backdrops.forEach((bd) => {
    bd.style.zIndex = String(z);
    z += 10;
  });

  acikModallar.forEach((m) => {
    m.style.pointerEvents = 'auto';
    z += 20;
    m.style.zIndex = String(z);
    const dlg = m.querySelector('.modal-dialog');
    if (dlg) dlg.style.zIndex = '1';
  });

  if (ustModal?.classList?.contains('show')) {
    z += 20;
    ustModal.style.zIndex = String(z);
    ustModal.style.pointerEvents = 'auto';
  }

  if (acikModallar.length > 0) {
    document.body.classList.add('modal-open');
  }
}

function modalEnUsteGetir(modalEl) {
  modalKatmanlariniDuzelt(modalEl);
}

/** Modal aç — body taşıma, backdrop düzeni, fazla perde temizliği. */
function modalAc(modalEl, oncesiFn) {
  if (!modalEl) return;
  modallariGovdeyeTasi();
  modalArtigiTemizle();
  if (typeof oncesiFn === 'function') oncesiFn();
  const duzelt = () => modalKatmanlariniDuzelt(modalEl);
  modalEl.addEventListener('shown.bs.modal', duzelt, { once: true });
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  setTimeout(duzelt, 80);
  setTimeout(duzelt, 250);
}

function aramaSonuclariniGizle() {
  const el = document.getElementById('aramaSonuclari');
  if (!el) return;
  el.classList.remove('acik');
  el.style.display = 'none';
  el.style.pointerEvents = 'none';
}

/** Sadece Bootstrap artigi: fazla backdrop, body.modal-open kilidi. Modallari KAPATMAZ. */
function modalArtigiTemizle() {
  const acikModal = document.querySelectorAll('.modal.show').length;
  const backdrops = [...document.querySelectorAll('.modal-backdrop')];

  if (backdrops.length > acikModal) {
    for (let i = acikModal; i < backdrops.length; i += 1) {
      backdrops[i].remove();
    }
  }

  if (acikModal === 0) {
    if (backdrops.length) backdrops.forEach((el) => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
    document.body.removeAttribute('data-bs-overflow');
    document.body.removeAttribute('data-bs-padding-right');
  }

  const ana = document.getElementById('ana-uygulama');
  if (ana) {
    ana.style.pointerEvents = 'auto';
    ana.removeAttribute('inert');
    ana.removeAttribute('aria-hidden');
  }

  if (ana?.style.display === 'block') girisEkraniniKapat();
}

function arayuzuSerbestBirak() {
  modalArtigiTemizle();
  const arama = document.getElementById('aramaSonuclari');
  if (arama && !arama.classList.contains('acik')) aramaSonuclariniGizle();
}

/** F9 veya navbar — kullanici istegiyle tam temizlik. */
function uiKilidiniAc() {
  document.querySelectorAll('.modal').forEach((m) => {
    const inst = bootstrap.Modal.getInstance(m);
    if (inst) {
      try { inst.hide(); } catch (_) {}
    }
    m.classList.remove('show');
    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');
    m.removeAttribute('aria-modal');
    m.style.removeProperty('z-index');
  });
  const giris = document.getElementById('giris-ekrani');
  if (giris) {
    try { giris.remove(); } catch (_) { girisEkraniniKapat(); }
  }
  modalArtigiTemizle();
  aramaSonuclariniGizle();
  setTimeout(() => {
    modalArtigiTemizle();
    hizliSatisAramaOdakla();
  }, 100);
}

function girisEkraniniKapat() {
  const giris = document.getElementById('giris-ekrani');
  if (!giris) return;
  const ana = document.getElementById('ana-uygulama');
  if (ana && ana.style.display === 'block') {
    try {
      giris.remove();
      return;
    } catch (_) {}
  }
  giris.classList.add('d-none', 'kapali');
  giris.style.display = 'none';
  giris.style.pointerEvents = 'none';
  giris.style.visibility = 'hidden';
  giris.style.zIndex = '-1';
  giris.setAttribute('aria-hidden', 'true');
  giris.setAttribute('hidden', '');
}

function anaUygulamayiAc() {
  const ana = document.getElementById('ana-uygulama');
  if (ana) {
    ana.style.display = 'block';
    ana.style.pointerEvents = 'auto';
  }
  modallariGovdeyeTasi();
  girisEkraniniKapat();
  modalArtigiTemizle();
  requestAnimationFrame(modalArtigiTemizle);
  setTimeout(modalArtigiTemizle, 150);
  setTimeout(hizliSatisAramaOdakla, 400);
}

function hizliSatisAramaOdakla() {
  const arama = document.getElementById('hizliSatisArama');
  if (!arama || arama.disabled || arama.readOnly) return;
  if (document.querySelector('.modal.show')) return;
  try { arama.focus({ preventScroll: true }); } catch (_) { arama.focus(); }
}

const BUYUK_HARF_DISLA_TIP = new Set([
  'password', 'email', 'number', 'date', 'datetime-local', 'month', 'week',
  'time', 'file', 'hidden', 'range', 'color', 'checkbox', 'radio', 'submit', 'button',
]);

function metinBuyukHarfMi(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.dataset?.buyukHarf === 'false' || el.classList?.contains('buyuk-harf-kapali')) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  const t = String(el.type || 'text').toLowerCase();
  if (BUYUK_HARF_DISLA_TIP.has(t)) return false;
  return t === 'text' || t === 'search' || t === 'tel' || t === '';
}

function metinBuyukHarfeCevir(val) {
  return String(val ?? '').toLocaleUpperCase('tr-TR');
}

function metinGirisBuyukHarfUygula(el) {
  if (!metinBuyukHarfMi(el) || el.dataset?.composing === '1') return;
  const bas = el.selectionStart;
  const son = el.selectionEnd;
  const yeni = metinBuyukHarfeCevir(el.value);
  if (yeni === el.value) return;
  el.value = yeni;
  if (typeof bas === 'number' && typeof son === 'number') {
    try {
      el.setSelectionRange(bas, son);
    } catch (_) {}
  }
}

/** Tarayicinin "Kaydedilen bilgiler" oneri listesini kapat. */
function tarayiciOneriKapatUygula(el) {
  if (!el || el.nodeType !== 1) return;
  if (el.dataset?.otomatikTamamlama === 'acik') return;

  const giris = el.closest?.('#giris-ekrani, #girisFormu');
  if (giris) {
    const type = String(el.type || '').toLowerCase();
    if (type === 'password') {
      el.setAttribute('autocomplete', 'current-password');
      return;
    }
    if (el.id === 'kullaniciAdi') {
      el.setAttribute('autocomplete', 'username');
      return;
    }
  }

  if (el.tagName === 'FORM') {
    el.setAttribute('autocomplete', 'off');
    return;
  }

  if (!el.matches?.('input, textarea, select')) return;

  const type = String(el.type || 'text').toLowerCase();
  if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'range', 'color'].includes(type)) return;

  if (el.closest?.('#stokEkleModal, #gunlukIslemDetayModal')) {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    if (el.id && !el.getAttribute('name')) {
      el.setAttribute('name', `f_${el.id}_${Date.now().toString(36).slice(-4)}`);
    }
    return;
  }

  if (type === 'password') {
    const ac = el.getAttribute('autocomplete');
    if (!ac || ac === 'on') el.setAttribute('autocomplete', 'off');
    return;
  }

  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocorrect', 'off');
  el.setAttribute('spellcheck', 'false');
  el.setAttribute('data-lpignore', 'true');
  el.setAttribute('data-1p-ignore', 'true');
  el.setAttribute('data-bwignore', 'true');
  el.setAttribute('data-form-type', 'other');

  const modal = el.closest?.('.modal');
  if (modal) {
    el.setAttribute('autocomplete', 'new-password');
  }

  if (el.id && !el.getAttribute('name')) {
    el.setAttribute('name', `f_${el.id}_${Date.now().toString(36).slice(-4)}`);
  }

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    tarayiciOneriReadonlyKilidiAyarla(el);
  }
}

function tarayiciOneriReadonlyKilidiAyarla(el) {
  if (!el || el.dataset?.tarayiciReadonlyKilidi === '1') return;
  if (el.dataset?.otomatikTamamlama === 'acik') return;
  if (el.closest?.('#giris-ekrani, #girisFormu, #stokEkleModal, #gunlukIslemDetayModal')) return;
  const type = String(el.type || 'text').toLowerCase();
  if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'range', 'color', 'password'].includes(type)) return;

  el.dataset.tarayiciReadonlyKilidi = '1';

  const kilidiAc = () => {
    if (!el.readOnly) return;
    el.readOnly = false;
  };

  el.readOnly = true;
  el.addEventListener('mousedown', kilidiAc, true);
  el.addEventListener('touchstart', kilidiAc, { capture: true, passive: true });
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab' || ev.key === 'Enter') kilidiAc();
  }, true);
}

function tarayiciOneriModalYenile(modalEl) {
  if (!modalEl) return;
  modalEl.querySelectorAll('form').forEach((f) => f.setAttribute('autocomplete', 'off'));
  modalEl.querySelectorAll('input, textarea, select').forEach((el) => {
    tarayiciOneriKapatUygula(el);
  });
}

/** Modal görünür olunca yazılabilir yap (readonly kilidi programatik odakta takılı kalmasın). */
function tarayiciOneriModalGirdileriAc(modalEl) {
  if (!modalEl) return;
  const kasitliReadonly = new Set(['pfKullaniciAdi', 'mrMusteriAd']);
  modalEl.querySelectorAll('input, textarea, select').forEach((el) => {
    const type = String(el.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button'].includes(type)) return;
    if (kasitliReadonly.has(el.id)) return;
    if (el.dataset?.tarayiciReadonlyKilidi === '1' || el.closest?.('[data-tarayici-kilit-kapali]')) {
      el.readOnly = false;
      el.removeAttribute('readonly');
    } else if (!el.hasAttribute('readonly')) {
      el.readOnly = false;
    }
    if (type !== 'password' && el.disabled && el.dataset?.kilitleme !== '1') {
      el.disabled = false;
    }
  });
}

function tarayiciOneriKapatBaslat() {
  if (window.__tarayiciOneriKapali) return;
  window.__tarayiciOneriKapali = true;

  document.querySelectorAll('form, input, textarea, select').forEach(tarayiciOneriKapatUygula);

  document.addEventListener(
    'show.bs.modal',
    (e) => {
      const modal = e.target;
      if (modal?.classList?.contains('modal')) tarayiciOneriModalYenile(modal);
    },
    true
  );

  document.addEventListener(
    'shown.bs.modal',
    (e) => {
      const modal = e.target;
      if (!modal?.classList?.contains('modal')) return;
      tarayiciOneriModalGirdileriAc(modal);
      modalKatmanlariniDuzelt(modal);
      requestAnimationFrame(() => modalKatmanlariniDuzelt(modal));
    },
    true
  );

  const obs = new MutationObserver((list) => {
    list.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.('form, input, textarea, select')) tarayiciOneriKapatUygula(node);
        node.querySelectorAll?.('form, input, textarea, select').forEach(tarayiciOneriKapatUygula);
      });
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

/** Barkod: sadece rakam yazıldıysa yalnızca tam eşleşme (içerir / baştan yok). */
function stokBarkodAramaEslesir(barkod, kelime) {
  const b = String(barkod ?? '').trim();
  const q = String(kelime ?? '').trim();
  if (!q) return false;
  if (!b) return false;
  if (/^\d+$/.test(q)) return b === q;
  if (b === q) return true;
  return b.toLocaleLowerCase('tr-TR').includes(q.toLocaleLowerCase('tr-TR'));
}

function stokMetinAramaEslesir(urun, kelime) {
  const raw = String(kelime ?? '').trim();
  if (!raw) return true;
  const q = raw.toLocaleLowerCase('tr-TR');
  if (String(urun?.UrunAdi || '').toLocaleLowerCase('tr-TR').includes(q)) return true;
  if (String(urun?.Kategori || '').toLocaleLowerCase('tr-TR').includes(q)) return true;
  return stokBarkodAramaEslesir(urun?.Barkod, raw);
}

function buyukHarfGirisBaslat() {
  if (window.__buyukHarfGiris) return;
  window.__buyukHarfGiris = true;

  document.addEventListener(
    'compositionstart',
    (e) => {
      if (metinBuyukHarfMi(e.target)) e.target.dataset.composing = '1';
    },
    true
  );
  document.addEventListener(
    'compositionend',
    (e) => {
      const t = e.target;
      if (!metinBuyukHarfMi(t)) return;
      delete t.dataset.composing;
      metinGirisBuyukHarfUygula(t);
    },
    true
  );
  document.addEventListener(
    'input',
    (e) => {
      metinGirisBuyukHarfUygula(e.target);
    },
    true
  );
  document.addEventListener(
    'paste',
    (e) => {
      const t = e.target;
      if (!metinBuyukHarfMi(t)) return;
      requestAnimationFrame(() => metinGirisBuyukHarfUygula(t));
    },
    true
  );
  document.addEventListener(
    'blur',
    (e) => {
      metinGirisBuyukHarfUygula(e.target);
    },
    true
  );
}

function arayuzuKorumaBaslat() {
  if (window.__arayuzKoruma) return;
  window.__arayuzKoruma = true;
  modallariGovdeyeTasi();
  buyukHarfGirisBaslat();
  tarayiciOneriKapatBaslat();

  document.addEventListener(
    'hidden.bs.modal',
    (e) => {
      const m = e.target;
      if (m?.classList?.contains('modal')) {
        m.style.removeProperty('z-index');
        m.style.removeProperty('pointer-events');
        m.querySelector('.modal-dialog')?.style.removeProperty('z-index');
      }
      setTimeout(modalArtigiTemizle, 0);
      setTimeout(modalArtigiTemizle, 300);
    },
    true
  );

  document.addEventListener('keydown', (e) => {
    if (e.key === 'F9') {
      e.preventDefault();
      uiKilidiniAc();
    }
  });

  // Tarayici: agresif otomatik mudahale yok (tiklamalari bozuyordu).
  // Electron: sadece gercek modal artigi varsa, seyrek temizlik.
  if (electronOrtamiMi()) {
    setInterval(() => {
      if (document.getElementById('ana-uygulama')?.style.display !== 'block') return;
      const acik = document.querySelectorAll('.modal.show').length;
      const bd = document.querySelectorAll('.modal-backdrop').length;
      if (bd > acik || (document.body.classList.contains('modal-open') && acik === 0)) {
        modalArtigiTemizle();
      }
    }, 2500);
  }
}

function paraTr(n) {
  return `${Number(n || 0).toFixed(2)} ₺`;
}

function gunlukBugunInputVal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function gunlukParaFmt(n) {
  const x = Number(n);
  return (Number.isFinite(x) ? x : 0).toFixed(2) + ' ₺';
}

function gunlukMetinEsc(s) {
  const t = s == null ? '' : String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * MSSQL / API tarihleri: ISO+Z → tarayici yerel saat; timezone'suz "2025-05-16 15:00:00" → duvar saati.
 */
function sqlTarihParse(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val;
  }
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
      Number(m[6] || 0)
    );
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function tarihTrGoster(val, secenekler) {
  const d = sqlTarihParse(val);
  if (!d) return '—';
  return d.toLocaleString('tr-TR', secenekler || { dateStyle: 'short', timeStyle: 'short' });
}

function tarihTrTarih(val) {
  const d = sqlTarihParse(val);
  if (!d) return '—';
  return d.toLocaleDateString('tr-TR');
}

let _demoDurumCache = null;

async function demoDurumYukle() {
  try {
    const res = await fetch('/api/demo-durum');
    if (!res.ok) return null;
    _demoDurumCache = await res.json();
    return _demoDurumCache;
  } catch (_) {
    return null;
  }
}

function demoOkumaModuMu() {
  return !!(_demoDurumCache && _demoDurumCache.demo && _demoDurumCache.okumaModu);
}

function demoAktifMi() {
  return !!(_demoDurumCache && _demoDurumCache.demo);
}

