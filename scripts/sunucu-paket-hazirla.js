/**
 * Sunucu kurulum paketi olusturur: dist/sunucu-paket/
 * Calistirma: node scripts/sunucu-paket-hazirla.js
 * Once: npm run build:exe  (veya SUNUCU-PAKET-OLUSTUR.bat)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const VERSIYON = pkg.version || '1.0.0';
const OUT = path.join(ROOT, 'dist', 'sunucu-paket');
const EXE_SRC = path.join(ROOT, 'dist', 'elektrik-otomasyon.exe');

function rmDir(p) {
  if (!fs.existsSync(p)) return;
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
  } catch (err) {
    console.warn(`Klasor temizlenemedi (${err.code || err.message}), uzerine yaziliyor.`);
  }
}

/** Eski paketlerde kalan bakim node_modules / db.js */
function eskiBakimArtiklariniSil(out) {
  for (const name of ['node_modules', 'db.js', 'package.json', 'package-lock.json', 'lib']) {
    const p = path.join(out, name);
    if (!fs.existsSync(p)) continue;
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      console.warn(`Eski dosya silinemedi (${name}):`, err.message || err.code);
    }
  }
  const eskiScript = path.join(out, 'scripts', 'gunluk-cari-kopuk-temizle.js');
  if (fs.existsSync(eskiScript)) {
    try {
      fs.unlinkSync(eskiScript);
    } catch (_) {}
  }
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

function write(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

/** Windows cmd uyumu: ASCII + CRLF (UTF-8/em-dash parantez bloklarini bozar) */
function writeBat(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ascii = content
    .replace(/\u2014/g, '-')
    .replace(/[^\n\r\t\x20-\x7E]/g, '');
  fs.writeFileSync(p, ascii.replace(/\r?\n/g, '\r\n'), 'latin1');
}

if (!fs.existsSync(EXE_SRC)) {
  console.error('EXE yok. Once calistirin: npm run build:exe');
  console.error('  veya: SUNUCU-PAKET-OLUSTUR.bat');
  process.exit(1);
}

console.log('Sunucu paketi hazirlaniyor...');
rmDir(OUT);
eskiBakimArtiklariniSil(OUT);
fs.mkdirSync(OUT, { recursive: true });

fs.copyFileSync(EXE_SRC, path.join(OUT, 'Elektrik-Otomasyon.exe'));
copyDir(path.join(ROOT, 'public'), path.join(OUT, 'public'));

const scriptsOut = path.join(OUT, 'scripts');
fs.mkdirSync(scriptsOut, { recursive: true });
fs.copyFileSync(
  path.join(ROOT, 'scripts', 'musteri-csv-aktar.ps1'),
  path.join(scriptsOut, 'musteri-csv-aktar.ps1'),
);

copyDir(path.join(ROOT, 'demo', 'uzakac'), path.join(OUT, 'istemci-uzakac'));

if (fs.existsSync(path.join(ROOT, 'demo', '01-demo-kullanici.sql'))) {
  fs.copyFileSync(
    path.join(ROOT, 'demo', '01-demo-kullanici.sql'),
    path.join(OUT, '01-kullanici-ornek.sql'),
  );
}
if (fs.existsSync(path.join(ROOT, 'GUNCELLE.bat'))) {
  fs.copyFileSync(path.join(ROOT, 'GUNCELLE.bat'), path.join(OUT, 'GUNCELLE.bat'));
}
if (fs.existsSync(path.join(ROOT, 'GUNLUK-CARI-TEMIZLE.bat'))) {
  writeBat(
    path.join(OUT, 'GUNLUK-CARI-TEMIZLE.bat'),
    fs.readFileSync(path.join(ROOT, 'GUNLUK-CARI-TEMIZLE.bat'), 'utf8'),
  );
}
if (fs.existsSync(path.join(ROOT, 'scripts', 'gunluk-kopuk-temizle-api.ps1'))) {
  fs.copyFileSync(
    path.join(ROOT, 'scripts', 'gunluk-kopuk-temizle-api.ps1'),
    path.join(scriptsOut, 'gunluk-kopuk-temizle-api.ps1'),
  );
}
if (fs.existsSync(path.join(ROOT, 'scripts', 'firewall-3010-ac.bat'))) {
  writeBat(
    path.join(OUT, 'FIREWALL-3010-AC.bat'),
    fs.readFileSync(path.join(ROOT, 'scripts', 'firewall-3010-ac.bat'), 'utf8'),
  );
}

write(path.join(OUT, '.env.ornek'), `HOST=0.0.0.0
PORT=3010
OPEN_BROWSER=0
OPEN_APP=0
DEMO_MODE=0
DB_SERVER=localhost
DB_NAME=elektrik
DB_USER=sa
DB_PASSWORD=BURAYA_SQL_SIFRE
DB_ENCRYPT=false
DB_TRUST_CERT=true
`);

writeBat(path.join(OUT, 'BASLAT.bat'), `@echo off
cd /d "%~dp0"
title ELEKTRIK Sunucu

if not exist "Elektrik-Otomasyon.exe" goto HATA_EXE
if not exist "public\\index.html" goto HATA_PUBLIC
if not exist ".env" goto ENV_KUR
goto SUNUCU_BASLAT

:HATA_EXE
echo HATA: Elektrik-Otomasyon.exe bulunamadi.
pause
exit /b 1

:HATA_PUBLIC
echo HATA: public klasoru eksik.
pause
exit /b 1

:ENV_KUR
echo .env yok - .env.ornek kopyalaniyor...
copy /Y ".env.ornek" ".env" >nul
echo.
echo  ONEMLI: Not Defteri ile .env acin, SQL sifresini yazin.
echo  Sonra bu dosyayi tekrar calistirin.
echo.
pause
exit /b 0

:SUNUCU_BASLAT
echo ========================================
echo  ELEKTRIK SUNUCU  v${VERSIYON}
echo ========================================
echo  Bu pencereyi KAPATMAYIN - sunucu calisir.
echo  Durdurmak: DURDUR.bat
echo.
echo  Bu PC:     http://127.0.0.1:3010
echo  Mobil:     http://SUNUCU-IP:3010/mobil
echo ========================================
echo.

Elektrik-Otomasyon.exe
echo.
echo Sunucu kapandi.
pause
`);

writeBat(path.join(OUT, 'DURDUR.bat'), `@echo off
cd /d "%~dp0"
echo Program durduruluyor...
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3010 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo Tamam.
timeout /t 2 >nul
`);

writeBat(path.join(OUT, 'MUSTERI-AKTAR.bat'), `@echo off
cd /d "%~dp0"
if "%~1"=="" goto YARDIM
set "CSV=%~1"
set "EXTRA="
if /i "%~2"=="dry-run" set "EXTRA=-DryRun"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\musteri-csv-aktar.ps1" -CsvDosya "%CSV%" %EXTRA%
pause
exit /b %ERRORLEVEL%

:YARDIM
echo.
echo  Kullanim:
echo    MUSTERI-AKTAR.bat musteriler.csv
echo    MUSTERI-AKTAR.bat musteriler.csv dry-run
echo.
pause
exit /b 1
`);

write(path.join(OUT, 'OKU-BENI.txt'), `ELEKTRIK — SUNUCU PAKETI (v${VERSIYON})
================================

Bu paket MUSTERI SUNUCUSU icindir (dukkan ana bilgisayar).
Demo suresi YOK (DEMO_MODE=0).


ILK KURULUM (bir kez)
--------------------
1) SQL Server + veritabani "elektrik" hazir olsun.
2) Bu klasoru sunucuya kopyalayin: ornek C:\\ELEKTRIK
3) .env.ornek dosyasini .env yapin (veya ilk BASLAT.bat kopyalar).
4) .env icinde DB_SERVER, DB_PASSWORD duzenleyin.
5) FIREWALL-3010-AC.bat — sag tik Yonetici (telefon/LAN icin).
6) BASLAT.bat — sunucu acilir (siyah pencere acik kalsin).


GUNLUK KULLANIM
---------------
  BASLAT.bat     → sunucuyu ac
  DURDUR.bat     → sunucuyu kapat

  Masaustu/kasa PC: istemci-uzakac klasoru + KISAYOL-OLUSTUR.bat
  Telefon: Safari → http://SUNUCU-IP:3010/mobil → Ana ekrana ekle


ESKI PROGRAMDAN MUSTERI AKTARIM
-------------------------------
  1) Excel → CSV (noktali virgul): Unvan;Bakiye;SonIslem
  2) musteriler.csv bu klasore
  3) DURDUR.bat
  4) MUSTERI-AKTAR.bat musteriler.csv dry-run
  5) MUSTERI-AKTAR.bat musteriler.csv
  6) BASLAT.bat


KOPUK GUNLUK KAYIT TEMIZLIGI (tek seferlik)
------------------------------------------
  Cari silinmis ama gunlukta kalan satislar icin:
  1) BASLAT.bat ile sunucuyu acin
  2)   GUNLUK-CARI-TEMIZLE.bat 2026-07-06
  GUNLUK-CARI-TEMIZLE.bat 2026-07-06 Murat
  (Ikinci ornek: sadece Murat Ulker kayitlari)
  (Node.js gerekmez — calisan sunucu uzerinden calisir)


SORUN
-----
  Sayfa acilmaz → SQL calisiyor mu? .env dogru mu?
  Port mesgul   → DURDUR.bat sonra BASLAT
  Demo uyarisi  → .env icinde DEMO_MODE=0 olmali
  Kopuk temizlik → Once BASLAT.bat, sonra GUNLUK-CARI-TEMIZLE.bat
`);

// istemci readme
write(path.join(OUT, 'istemci-uzakac', 'OKU-BENI.txt'), `KASA / DIGER PC BAGLANTISI
=========================

1) Bu klasoru kasa PC'ye kopyalayin.
2) Uzak-Ac.bat icinde SUNUCU IP yazin.
3) KISAYOL-OLUSTUR.bat calistirin.
4) Masaustundeki ELEKTRIK simgesini kullanin.

Sunucuda program acik olmali (BASLAT.bat).
`);

// Zip optional
const zipPath = path.join(ROOT, 'dist', `elektrik-sunucu-${VERSIYON}.zip`);
try {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const ps = `Compress-Archive -Path '${OUT.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
  execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit', windowsHide: true });
  console.log('ZIP:', zipPath);
} catch (e) {
  console.warn('ZIP olusturulamadi (klasor yine hazir):', e.message || e);
}

console.log('');
console.log('TAMAM:', OUT);
console.log('Sunucuya ZIP veya klasoru kopyalayin → BASLAT.bat');
