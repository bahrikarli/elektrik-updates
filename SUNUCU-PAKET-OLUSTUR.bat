@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ELEKTRIK sunucu paketi olusturuluyor...
echo.

if /i not "%~1"=="--atla-exe" (
  echo  [1/2] EXE uretiliyor...
  call npm run build:exe
  if errorlevel 1 (
    echo HATA: EXE uretilemedi.
    pause
    exit /b 1
  )
) else (
  echo  [1/2] EXE atlandi (--atla-exe)
)

echo.
echo  [2/2] Sunucu paketi hazirlaniyor...
node "%~dp0scripts\sunucu-paket-hazirla.js"
if errorlevel 1 (
  echo HATA: Paket olusturulamadi.
  pause
  exit /b 1
)

echo.
echo  Bitti. dist\sunucu-paket klasorunu sunucuya kopyalayin.
echo.
pause
