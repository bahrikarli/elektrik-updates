@echo off
setlocal EnableDelayedExpansion

set "REPO=bahrikarli/elektrik-updates"
set "APP_DIR=%~dp0"
set "WORK_DIR=%TEMP%\elektrik-guncelleme"
set "MANIFEST_URL=https://raw.githubusercontent.com/%REPO%/main/guncelleme.json"
set "VER=%~1"
set "ZIP_URL="
set "CACHE_BUST=%RANDOM%%RANDOM%%RANDOM%"

echo.
echo [1/5] Guncelleme bilgisi indiriliyor...
if exist "%WORK_DIR%" rmdir /s /q "%WORK_DIR%"
mkdir "%WORK_DIR%"

if not "%VER%"=="" (
  set "ZIP_URL=https://raw.githubusercontent.com/%REPO%/main/elektrik-otomasyon-%VER%.zip?cb=%CACHE_BUST%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$headers=@{'Cache-Control'='no-cache';'Pragma'='no-cache'}; Invoke-WebRequest -Uri '%MANIFEST_URL%?cb=%CACHE_BUST%' -Headers $headers -OutFile '%WORK_DIR%\guncelleme.json' -UseBasicParsing"
  if errorlevel 1 (
    echo HATA: Guncelleme bilgisi indirilemedi.
    echo Muhtemel sebep: elektrik-updates reposuna guncelleme.json push edilmedi ya da repo private.
    echo Once gelistirici bilgisayarinda git-yayinla.bat calistirin.
    echo Alternatif: belirli surum icin kullanici-guncelle.bat 1.0.13
    exit /b 1
  )

  for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=Get-Content '%WORK_DIR%\guncelleme.json' -Raw | ConvertFrom-Json; $m.version"`) do set "VER=%%i"
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=Get-Content '%WORK_DIR%\guncelleme.json' -Raw | ConvertFrom-Json; if ($m.url) { $m.url } elseif ($m.repo -and $m.tag -and $m.assetName) { 'https://github.com/' + $m.repo + '/releases/download/' + $m.tag + '/' + $m.assetName }"`) do set "ZIP_URL=%%i"
)

if "%VER%"=="" (
  echo HATA: Manifest icinde version okunamadi.
  exit /b 1
)
if "%ZIP_URL%"=="" (
  echo HATA: Manifest icinde indirme adresi bulunamadi.
  exit /b 1
)

echo Bulunan surum: %VER%

echo.
echo [2/5] Paket indiriliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$headers=@{'Cache-Control'='no-cache';'Pragma'='no-cache'}; Invoke-WebRequest -Uri '%ZIP_URL%' -Headers $headers -OutFile '%WORK_DIR%\elektrik-otomasyon-%VER%.zip' -UseBasicParsing"
if errorlevel 1 (
  echo HATA: Guncelleme paketi indirilemedi.
  exit /b 1
)

echo.
echo [3/5] Paket aciliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '%WORK_DIR%\elektrik-otomasyon-%VER%.zip' -DestinationPath '%WORK_DIR%\paket' -Force"
if errorlevel 1 (
  echo HATA: Paket acilamadi.
  exit /b 1
)

echo.
echo [4/5] Uygulama kapatilmaya calisiliyor...
taskkill /IM elektrik-otomasyon.exe /F >nul 2>nul

echo.
echo [5/5] Dosyalar guncelleniyor...
xcopy "%WORK_DIR%\paket\*" "%APP_DIR%" /E /I /Y >nul
if errorlevel 1 (
  echo HATA: Dosyalar kopyalanamadi.
  exit /b 1
)

echo.
echo BASARILI: Elektrik Otomasyon v%VER% kuruldu.
if exist "%APP_DIR%elektrik-otomasyon.exe" (
  start "" "%APP_DIR%elektrik-otomasyon.exe"
)

endlocal
