/**
 * Ana projeden demo klasörüne mobil + demo lisans dosyalarını kopyalar.
 * Çalıştırma: node scripts/senkron-demo.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const demo = path.join(root, 'demo');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const jobs = [
  ['lib/demo-lisans.js', 'lib/demo-lisans.js'],
  ['public/mobil', 'public/mobil'],
  ['public/js/utils.js', 'public/js/utils.js'],
];

for (const [relFrom, relTo] of jobs) {
  const src = path.join(root, relFrom);
  const dst = path.join(demo, relTo);
  if (!fs.existsSync(src)) {
    console.warn('Atlandi (yok):', relFrom);
    continue;
  }
  if (fs.statSync(src).isDirectory()) {
    if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true, force: true });
    copyDir(src, dst);
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  console.log('OK:', relTo);
}

console.log('\nNot: server.js ve app.js demo giris satiri elle veya tam kopya ile senkron tutun.');
console.log('EXE icin: C:\\ELEKTRIK\\EXE-URET.bat (ana projeden uretilir, demo .env ile calisir).');
