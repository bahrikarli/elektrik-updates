@echo off
setlocal EnableDelayedExpansion

if "%~1"=="" (
  echo Kullanim: release.bat 1.0.2
  exit /b 1
)

set VER=%~1
set ROOT=%~dp0
set RELEASE_DIR=%ROOT%release-v%VER%
set ZIP_FILE=%ROOT%elektrik-otomasyon-%VER%.zip
set GUNCELLEME_TEMPLATE=%ROOT%guncelleme-%VER%.json
set REPO=bahrikarli/elektrik-updates

echo.
echo [1/6] Proje klasoru: %ROOT%
cd /d "%ROOT%"
set "PKG_VER="
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "PKG_VER=%%i"
if "%PKG_VER%"=="" (
  echo HATA: package.json version okunamadi.
  exit /b 1
)
if /I not "%PKG_VER%"=="%VER%" (
  echo HATA: package.json version ^(%PKG_VER%^) ile release parametresi ^(%VER%^) ayni degil.
  echo Once package.json icindeki version degerini %VER% yapin.
  exit /b 1
)

echo.
echo [2/6] EXE build aliniyor...
call npm run build:exe
if errorlevel 1 (
  echo HATA: EXE build basarisiz.
  exit /b 1
)

echo.
echo [3/6] Release klasoru hazirlaniyor...
if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\public"

echo.
echo [4/6] Dosyalar kopyalaniyor...
copy /y "%ROOT%dist\elektrik-otomasyon.exe" "%RELEASE_DIR%\" >nul
if errorlevel 1 (
  echo HATA: EXE kopyalanamadi.
  exit /b 1
)
xcopy "%ROOT%public" "%RELEASE_DIR%\public" /E /I /Y >nul
if errorlevel 1 (
  echo HATA: public klasoru kopyalanamadi.
  exit /b 1
)
if exist "%ROOT%kullanici-guncelle.bat" (
  copy /y "%ROOT%kullanici-guncelle.bat" "%RELEASE_DIR%\" >nul
)

echo.
echo [5/6] ZIP olusturuluyor...
if exist "%ZIP_FILE%" del /f /q "%ZIP_FILE%"
powershell -NoProfile -Command "Compress-Archive -Path '%RELEASE_DIR%\*' -DestinationPath '%ZIP_FILE%' -Force"
if errorlevel 1 (
  echo HATA: ZIP olusturulamadi.
  exit /b 1
)

echo.
echo [6/6] Guncelleme manifest taslagi olusturuluyor...
(
echo {
echo   "version": "%VER%",
echo   "repo": "%REPO%",
echo   "tag": "v%VER%",
echo   "assetName": "elektrik-otomasyon-%VER%.zip",
echo   "notes": "v%VER% guncellemesi"
echo }
) > "%GUNCELLEME_TEMPLATE%"

echo.
echo BASARILI!
echo ZIP: %ZIP_FILE%
echo MANIFEST TASLAK: %GUNCELLEME_TEMPLATE%
echo.
echo Sonraki adim:
echo 1^) ZIP dosyasini GitHub Releases'ta v%VER% tag'i ile yayinla
echo 2^) guncelleme.json dosyanda version/repo/tag/assetName/notes alanlarini guncelle
echo.
endlocal