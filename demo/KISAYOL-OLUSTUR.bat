@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  Bu bilgisayar icin BASLAT kisayolu olusturuluyor...
echo  Klasor: %CD%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0baslat-kisayol-olustur.ps1"
if errorlevel 1 (
  echo HATA: Kisayol olusturulamadi.
  pause
  exit /b 1
)
echo.
echo  Tamam.
echo  - Bu klasorde BASLAT.lnk kullanin
echo  - Masaustune de kopyalandi (varsa)
echo.
pause
