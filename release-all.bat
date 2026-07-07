@echo off
setlocal EnableDelayedExpansion

rem EXE yayini (Electron varsayilan KAPALI)
set "SKIP_ELECTRON=1"

set "ROOT=%~dp0"
set "REPO=bahrikarli/elektrik-updates"
cd /d "%ROOT%"

if "%~1"=="" (
  for /f "usebackq delims=" %%i in (`node -e "const p=require('./package.json');const v=String(p.version||'0.0.0').split('.').map(Number);v[2]=(v[2]||0)+1;console.log(v.join('.'));"`) do set "VER=%%i"
) else (
  set "VER=%~1"
)

if "%VER%"=="" ( echo HATA: Surum hesaplanamadi. & exit /b 1 )

echo.
echo ============================================
echo   RELEASE v%VER%  (EXE + GitHub)
echo ============================================

echo.
echo [1/5] Surum %VER% + program kapat...
call "%ROOT%demo\DURDUR.bat" >nul 2>&1
taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
node "%ROOT%scripts\set-version.js" "%VER%"
if errorlevel 1 exit /b 1

echo.
echo [2/5] EXE + musteri ZIP...
call npm run build:exe
if errorlevel 1 exit /b 1
node "%ROOT%demo\exe-kopyala.js"
if errorlevel 1 exit /b 1
node "%ROOT%scripts\paket-musteri-zip.js" "%VER%"
if errorlevel 1 exit /b 1

set "ZIP_FILE=%ROOT%elektrik-otomasyon-%VER%.zip"

echo.
echo [3/5] guncelleme.json...
(
echo {
echo   "version": "%VER%",
echo   "repo": "%REPO%",
echo   "tag": "v%VER%",
echo   "assetName": "elektrik-otomasyon-%VER%.zip",
echo   "notes": "v%VER% guncellemesi"
echo }
) > "%ROOT%guncelleme.json"
copy /y "%ROOT%guncelleme.json" "%ROOT%guncelleme-%VER%.json" >nul
copy /y "%ROOT%guncelleme.json" "%ROOT%demo\guncelleme.json" >nul

echo.
echo [4/5] GitHub Release (ZIP + manifest)...
where gh >nul 2>nul
if errorlevel 1 (
  echo UYARI: gh CLI yok. Manuel: %ZIP_FILE%
  goto manifest_repo
)
if "%GH_TOKEN%"=="" echo NOT: gh auth login onerilir
gh release view "v%VER%" --repo "%REPO%" >nul 2>nul
if errorlevel 1 (
  gh release create "v%VER%" "%ZIP_FILE%" "%ROOT%guncelleme.json" --repo "%REPO%" --title "v%VER%" --notes "v%VER% guncellemesi"
) else (
  gh release upload "v%VER%" "%ZIP_FILE%" "%ROOT%guncelleme.json" --repo "%REPO%" --clobber
)
if errorlevel 1 (
  echo UYARI: GitHub Release yukleme hatasi.
) else (
  echo OK: https://github.com/%REPO%/releases/tag/v%VER%
)

:manifest_repo
echo.
echo [5/5] Manifest -^> elektrik-updates main (git-yayinla)...
if exist "%ROOT%git-yayinla.bat" (
  call "%ROOT%git-yayinla.bat" "%VER%"
  if errorlevel 1 (
    echo UYARI: git-yayinla basarisiz. Release'teki manifest yine calisir:
    echo https://github.com/%REPO%/releases/latest/download/guncelleme.json
  )
) else (
  echo UYARI: git-yayinla.bat yok.
)

if /I not "%WITH_ELECTRON%"=="1" goto done
echo.
echo [Ek] Electron (WITH_ELECTRON=1)...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win nsis --publish always
if errorlevel 1 echo UYARI: Electron hatali - program acik olabilir, dist-desktop silin.

:done
echo.
echo ============================================
echo   TAMAM: v%VER%
echo ============================================
echo   ZIP: %ZIP_FILE%
echo   Release manifest:
echo   https://github.com/%REPO%/releases/latest/download/guncelleme.json
echo   (veya main: raw.githubusercontent.com/%REPO%/main/guncelleme.json)
echo.
echo   Electron icin: set WITH_ELECTRON=1 ^& release-all.bat
echo.
pause
endlocal
