const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const src = path.join(__dirname, '..', 'dist', 'elektrik-otomasyon.exe');
const dst = path.join(__dirname, 'Elektrik-Otomasyon.exe');
const pubSrc = path.join(__dirname, '..', 'public');
const pubDst = path.join(__dirname, 'public');

function calisanlariDurdur() {
  if (process.platform !== 'win32') return;
  console.log('Calisan program durduruluyor...');
  const isimler = ['elektrik-otomasyon.exe', 'Elektrik-Otomasyon.exe'];
  for (const ad of isimler) {
    try {
      execSync(`taskkill /F /IM "${ad}"`, { stdio: 'ignore', windowsHide: true });
    } catch (_) {}
  }
  try {
    execSync(
      'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3010 -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }"',
      { stdio: 'ignore', windowsHide: true },
    );
  } catch (_) {}
}

function bekle(ms) {
  const t = Date.now();
  while (Date.now() - t < ms) { /* */ }
}

function guvenliKopyala(kaynak, hedef) {
  for (let i = 0; i < 10; i += 1) {
    try {
      fs.copyFileSync(kaynak, hedef);
      return true;
    } catch (e) {
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
      bekle(500);
    }
  }
  const yedek = hedef.replace(/\.exe$/i, '-YENI.exe');
  fs.copyFileSync(kaynak, yedek);
  console.error('');
  console.error('UYARI: Elektrik-Otomasyon.exe hala kilitli.');
  console.error('1) DURDUR.bat calistirin');
  console.error('2) Gorev Yoneticisinde exe kalmadiysa');
  console.error('3) Su dosyayi eski adiyla degistirin:', yedek);
  return false;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, ent.name);
    const d = path.join(to, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(src)) {
  console.error('Once: npm run build:exe');
  process.exit(1);
}

calisanlariDurdur();
bekle(800);

if (!guvenliKopyala(src, dst)) {
  process.exit(1);
}
console.log('EXE:', dst);

if (fs.existsSync(pubSrc)) {
  copyDir(pubSrc, pubDst);
  console.log('public klasoru kopyalandi:', pubDst);
} else {
  console.warn('UYARI: public klasoru bulunamadi');
}
