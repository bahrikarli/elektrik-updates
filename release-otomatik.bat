@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "REPO=bahrikarli/elektrik-updates"
cd /d "%ROOT%"

if "%~1"=="" (
  for /f "usebackq delims=" %%i in (`node -e "const p=require('./package.json'); const v=String(p.version||'0.0.0').split('.').map(Number); v[2]=(v[2]||0)+1; console.log(v.join('.'));"`) do set "VER=%%i"
) else (
  set "VER=%~1"
)

if "%VER%"=="" (
  echo HATA: Version hesaplanamadi.
  exit /b 1
)

echo.
echo [1/5] Version %VER% olarak ayarlaniyor...
node "%ROOT%scripts\set-version.js" "%VER%"
if errorlevel 1 (
  echo HATA: package version guncellenemedi.
  exit /b 1
)
set "PKG_VER="
for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "PKG_VER=%%i"
if /I not "%PKG_VER%"=="%VER%" (
  echo HATA: package.json version dogrulamasi basarisiz. Okunan: %PKG_VER%
  exit /b 1
)

echo.
echo [2/5] Release paketi uretiliyor...
call "%ROOT%release.bat" "%VER%"
if errorlevel 1 exit /b 1

echo.
echo [3/5] Ana guncelleme.json guncelleniyor...
(
echo {
echo   "version": "%VER%",
echo   "repo": "%REPO%",
echo   "tag": "v%VER%",
echo   "assetName": "elektrik-otomasyon-%VER%.zip",
echo   "notes": "v%VER% guncellemesi"
echo }
) > "%ROOT%guncelleme.json"

echo.
echo [4/5] GitHub CLI kontrol ediliyor...
where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI ^(gh^) bulunamadi. Paket hazir ama yayinlama manuel yapilacak.
  echo ZIP: "%ROOT%elektrik-otomasyon-%VER%.zip"
  echo Manifest: "%ROOT%guncelleme.json"
  echo Git ile yayinlamak icin: git-yayinla.bat %VER%
  echo Otomatik yayin icin: gh auth login
  goto done
)

echo.
echo [5/5] GitHub Release olusturuluyor/yukleniyor...
gh release view "v%VER%" --repo "%REPO%" >nul 2>nul
if errorlevel 1 (
  gh release create "v%VER%" "%ROOT%elektrik-otomasyon-%VER%.zip" "%ROOT%guncelleme.json" --repo "%REPO%" --title "v%VER%" --notes "v%VER% guncellemesi"
) else (
  gh release upload "v%VER%" "%ROOT%elektrik-otomasyon-%VER%.zip" "%ROOT%guncelleme.json" --repo "%REPO%" --clobber
)
if errorlevel 1 (
  echo HATA: GitHub Release yayinlanamadi.
  exit /b 1
)

:done
echo.
echo BASARILI: v%VER% paketi hazir.
echo Kullanici indirme scripti: kullanici-guncelle.bat
echo.
endlocal
