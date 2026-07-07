const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const ver = process.argv[2] || require(path.join(root, 'package.json')).version;
const outZip = path.join(root, `elektrik-otomasyon-${ver}.zip`);
const staging = path.join(root, `release-v${ver}`);

const demoDosyalar = [
  'BASLAT.bat',
  'KISAYOL-OLUSTUR.bat',
  'baslat.vbs',
  'baslat-arkaplan.ps1',
  'sunucu-gizli.vbs',
  'elektrik-baslat.ico',
  'DURDUR.bat',
  'PENCERE-AC.bat',
  'pencere-ac.ps1',
  'OKU-BENI.txt',
  '01-demo-kullanici.sql',
  '.env.ornek',
  'GUNCELLE.bat',
  'BASLAT-DENETLE.bat',
];

const kokDosyalar = ['GUNCELLE.bat', 'GUNCELLEME.txt'];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const exeSrc = path.join(root, 'dist', 'elektrik-otomasyon.exe');
if (!fs.existsSync(exeSrc)) {
  console.error('Once: npm run build:exe');
  process.exit(1);
}
fs.copyFileSync(exeSrc, path.join(staging, 'Elektrik-Otomasyon.exe'));
copyDir(path.join(root, 'public'), path.join(staging, 'public'));

for (const f of demoDosyalar) {
  const src = path.join(root, 'demo', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, f));
}
for (const f of kokDosyalar) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, f));
}

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);
const ps = `Compress-Archive -Path '${staging.replace(/'/g, "''")}\\*' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force`;
execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });

console.log('ZIP:', outZip);
console.log('Klasor:', staging);
