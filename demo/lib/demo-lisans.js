/**
 * Demo / deneme sürümü: süre ve salt okunur mod.
 * .env: DEMO_MODE=1, DEMO_GUN=30 (ilk çalışmadan itibaren) veya DEMO_BITIS=2026-06-30
 */
const fs = require('fs');
const path = require('path');

function envBool(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'evet' || s === 'yes';
}

function demoAktifMi() {
  return envBool(process.env.DEMO_MODE);
}

function sureDosyaYolu(appRoot) {
  return path.join(appRoot || process.cwd(), 'demo-sure.json');
}

function gunEkle(tarih, gun) {
  const d = new Date(tarih.getTime());
  d.setDate(d.getDate() + gun);
  return d;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sureKaydiOku(appRoot) {
  const dosya = sureDosyaYolu(appRoot);
  try {
    if (fs.existsSync(dosya)) {
      return JSON.parse(fs.readFileSync(dosya, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function sureKaydiYaz(appRoot, kayit) {
  try {
    fs.writeFileSync(sureDosyaYolu(appRoot), JSON.stringify(kayit, null, 2), 'utf8');
  } catch (e) {
    console.warn('[DEMO] Sure dosyasi yazilamadi:', e.message || e);
  }
}

/** İlk çalıştırmada baslangic tarihini kaydet */
function ilkCalistirmayiKaydet(appRoot) {
  if (!demoAktifMi()) return;
  const mevcut = sureKaydiOku(appRoot);
  if (mevcut && mevcut.ilkCalistirma) return;
  const bugun = new Date();
  const gun = parseInt(process.env.DEMO_GUN, 10);
  const sabitBitis = parseYmd(process.env.DEMO_BITIS);
  let bitis = sabitBitis;
  if (!bitis && Number.isInteger(gun) && gun > 0) {
    bitis = gunEkle(bugun, gun);
  }
  sureKaydiYaz(appRoot, {
    ilkCalistirma: ymd(bugun),
    bitisTarihi: bitis ? ymd(bitis) : null,
    demoGun: Number.isInteger(gun) && gun > 0 ? gun : null,
  });
}

function bitisTarihiHesapla(appRoot) {
  const sabit = parseYmd(process.env.DEMO_BITIS);
  if (sabit) return sabit;
  const kayit = sureKaydiOku(appRoot);
  if (kayit?.bitisTarihi) {
    const d = parseYmd(kayit.bitisTarihi);
    if (d) return d;
  }
  const gun = parseInt(process.env.DEMO_GUN, 10);
  if (kayit?.ilkCalistirma && Number.isInteger(gun) && gun > 0) {
    const bas = parseYmd(kayit.ilkCalistirma);
    if (bas) return gunEkle(bas, gun);
  }
  return null;
}

function demoOkumaModuMu(appRoot) {
  if (!demoAktifMi()) return false;
  const bitis = bitisTarihiHesapla(appRoot);
  if (!bitis) return false;
  return Date.now() > bitis.getTime();
}

function kalanGun(appRoot) {
  const bitis = bitisTarihiHesapla(appRoot);
  if (!bitis) return null;
  const fark = Math.ceil((bitis.getTime() - Date.now()) / 86400000);
  return Math.max(0, fark);
}

function durum(appRoot) {
  const aktif = demoAktifMi();
  const okuma = aktif && demoOkumaModuMu(appRoot);
  const bitis = bitisTarihiHesapla(appRoot);
  const kalan = aktif ? kalanGun(appRoot) : null;
  let mesaj = '';
  if (aktif && okuma) {
    mesaj = 'Demo süresi doldu. Yalnızca mevcut verileri görüntüleyebilirsiniz; yeni kayıt ve satış yapılamaz.';
  } else if (aktif && kalan != null) {
    mesaj = `Demo sürüm — kalan süre: ${kalan} gün. Süre bitince yalnızca görüntüleme modu açılır.`;
  }
  return {
    demo: aktif,
    okumaModu: okuma,
    bitisTarihi: bitis ? ymd(bitis) : null,
    kalanGun: kalan,
    guncellemeKapali: aktif,
    mesaj,
  };
}

function yazmaEngelliMi(appRoot) {
  return demoOkumaModuMu(appRoot);
}

function yazmaEngelliMesaj(appRoot) {
  const d = durum(appRoot);
  return d.mesaj || 'Demo süresi doldu — salt okunur mod.';
}

const YAZMA_IZINLI = new Set([
  '/api/login',
]);

function istekYazmaIzinliMi(req) {
  const p = req.path || '';
  if (YAZMA_IZINLI.has(p)) return true;
  return false;
}

module.exports = {
  demoAktifMi,
  demoOkumaModuMu,
  ilkCalistirmayiKaydet,
  durum,
  yazmaEngelliMi,
  yazmaEngelliMesaj,
  istekYazmaIzinliMi,
};
