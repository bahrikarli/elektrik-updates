@echo off
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo  Kullanim:
  echo    MUSTERI-AKTAR.bat musteriler.csv
  echo    MUSTERI-AKTAR.bat musteriler.csv dry-run
  echo.
  echo  CSV dosyasi bu klasorde olmali: C:\ELEKTRIK\musteriler.csv
  echo  Baslik: Unvan;Bakiye;SonIslem
  echo.
  pause
  exit /b 1
)

set "CSV=%~1"
set "EXTRA="
if /i "%~2"=="dry-run" set "EXTRA=-DryRun"

set "PS1=%~dp0scripts\musteri-csv-aktar.ps1"
if not exist "%PS1%" set "PS1=%~dp0musteri-csv-aktar.ps1"

if not exist "%PS1%" (
  echo HATA: musteri-csv-aktar.ps1 bulunamadi.
  echo scripts klasorunu kontrol edin.
  pause
  exit /b 1
)

echo.
echo  Musteri aktarimi basliyor...
echo  Klasor: %CD%
echo  CSV: %CSV%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -CsvDosya "%CSV%" %EXTRA%
set ERR=%ERRORLEVEL%
echo.
if %ERR% NEQ 0 (
  echo HATA olustu.
) else (
  echo Bitti.
)
pause
exit /b %ERR%
