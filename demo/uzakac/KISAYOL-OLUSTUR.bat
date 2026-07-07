@echo off
cd /d "%~dp0"
echo ELEKTRIK kisayolu olusturuluyor...
echo Klasor: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kisayol-olustur.ps1"
if not %errorlevel%==0 (
  echo HATA: Kisayol olusturulamadi.
  pause
  exit /b 1
)
echo Tamam. Masaustundeki ELEKTRIK simgesini kullanin.
pause
