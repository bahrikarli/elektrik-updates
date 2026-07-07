@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo.
echo  Kopuk gunluk kayit temizligi (v2 - musteri filtresi)
echo  Sunucu AYRI pencerede acik olmali (BASLAT.bat).
echo.
echo  Ornek: GUNLUK-CARI-TEMIZLE.bat 2026-07-06 Murat
echo.

tasklist /FI "IMAGENAME eq Elektrik-Otomasyon.exe" 2>nul | find /I "Elektrik-Otomasyon.exe" >nul
if errorlevel 1 (
  echo  UYARI: Elektrik-Otomasyon.exe calismiyor.
  echo  Once BASLAT.bat acin.
  pause
  exit /b 1
)

set BAS=
set BIT=
set MUSTERI=
set ELEKTRIK_MUSTERI_FILTRE=

:ARGLOOP
if "%~1"=="" goto ARGDONE
echo %~1| findstr /r "^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$" >nul
if not errorlevel 1 (
  if not defined BAS (set "BAS=%~1") else (set "BIT=%~1")
) else (
  set "MUSTERI=%~1"
)
shift
goto ARGLOOP

:ARGDONE
if not defined MUSTERI (
  echo.
  set /p MUSTERI=Musteri filtresi ^(Murat = sadece Murat, Enter = tumu^):
)
if defined MUSTERI set "ELEKTRIK_MUSTERI_FILTRE=%MUSTERI%"

set PS1=%~dp0scripts\gunluk-kopuk-temizle-api.ps1
if not exist "%PS1%" (
  echo  HATA: scripts\gunluk-kopuk-temizle-api.ps1 yok.
  pause
  exit /b 1
)

echo.
set "KULL="
set /p KULL=Kullanici adi:
set "SIFRE="
set /p SIFRE=Sifre:
if "!KULL!"=="" goto HATA
if "!SIFRE!"=="" goto HATA

echo.
if defined ELEKTRIK_MUSTERI_FILTRE echo   Musteri filtresi: !ELEKTRIK_MUSTERI_FILTRE!
if defined BAS (
  if defined BIT (echo  Tarih: !BAS! - !BIT!) else (echo  Tarih: !BAS!)
)
echo  [1/2] Kontrol (dry-run)...

if defined BAS (
  if defined BIT (
    powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" -DryRun -Bas "!BAS!" -Bit "!BIT!" -KullaniciAdi "!KULL!" -Sifre "!SIFRE!"
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" -DryRun -Bas "!BAS!" -Bit "!BAS!" -KullaniciAdi "!KULL!" -Sifre "!SIFRE!"
  )
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" -DryRun -KullaniciAdi "!KULL!" -Sifre "!SIFRE!"
)
if errorlevel 1 goto HATA

echo.
set /p ONAY=Listeyi onayliyor musunuz? Uygulamak icin E yazin:
if /i not "!ONAY!"=="E" (
  echo Iptal.
  pause
  exit /b 0
)

echo.
echo  [2/2] Uygulaniyor...
if defined BAS (
  if defined BIT (
    powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" -Uygula -Bas "!BAS!" -Bit "!BIT!" -KullaniciAdi "!KULL!" -Sifre "!SIFRE!"
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" -Uygula -Bas "!BAS!" -Bit "!BAS!" -KullaniciAdi "!KULL!" -Sifre "!SIFRE!"
  )
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "!PS1!" -Uygula -KullaniciAdi "!KULL!" -Sifre "!SIFRE!"
)
if errorlevel 1 goto HATA

echo.
echo  Bitti. Gunluk islemler ekranini yenileyin.
pause
exit /b 0

:HATA
echo.
echo  HATA. BASLAT.bat acik mi? EXE v1.0.69+ mi?
pause
exit /b 1
