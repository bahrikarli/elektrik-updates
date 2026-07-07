/**
 * Cari'den silinmiş ama günlük işlemlerde kalan kayıtları iptal eder (geliştirme / bakım).
 * Sunucuda: GUNLUK-CARI-TEMIZLE.bat (calisan sunucu API'si — Node gerekmez)
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'lib', 'env-yukle')).envYukle();
const { poolPromise } = require(path.join(ROOT, 'db'));
const { gunlukCariKopukTemizle } = require(path.join(ROOT, 'lib', 'gunluk-cari-kopuk-temizle'));

const args = process.argv.slice(2);
const uygula = args.includes('--uygula');
const dryRun = !uygula || args.includes('--dry-run');

function argVal(prefix) {
  const a = args.find((x) => x.startsWith(`${prefix}=`));
  return a ? a.slice(prefix.length + 1).trim() : null;
}

async function main() {
  const bas = argVal('--bas');
  const bit = argVal('--bit');

  console.log('');
  console.log('Günlük / cari kopuk kayıt temizliği');
  console.log(dryRun ? 'Mod: DRY-RUN (değişiklik yok)' : 'Mod: UYGULA');
  console.log('');

  const pool = await poolPromise;
  const sonuc = await gunlukCariKopukTemizle(pool, {
    bas,
    bit,
    dryRun,
    kullanici: 'Bakim',
    musteriFiltre: argVal('--musteri'),
  });

  console.log(`Tarih aralığı: ${sonuc.bas} — ${sonuc.bit}`);
  console.log(sonuc.message);
  if (sonuc.kayitlar?.length) {
    sonuc.kayitlar.forEach((x, i) => console.log(`  ${i + 1}. ${x}`));
  }
  if (sonuc.hatalar?.length) {
    sonuc.hatalar.forEach((h) => console.error('Hata:', h));
  }
  if (dryRun && sonuc.adet > 0) {
    console.log('');
    console.log('Uygulamak için:');
    console.log(`  node scripts/gunluk-cari-kopuk-temizle.js --uygula --bas=${sonuc.bas} --bit=${sonuc.bit}`);
  }
  process.exit(sonuc.success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
