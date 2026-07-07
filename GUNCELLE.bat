@echo off
rem Proje veya demo klasorunden calisir - GitHub'dan son surumu indirir
setlocal EnableDelayedExpansion

set "REPO=bahrikarli/elektrik-updates"
set "APP_DIR=%~dp0"
set "WORK_DIR=%TEMP%\elektrik-guncelleme"
set "MANIFEST_URL=https://raw.githubusercontent.com/%REPO%/main/guncelleme.json"
set "VER=%~1"
set "ZIP_URL="
set "CACHE_BUST=%RANDOM%%RANDOM%"

echo.
echo  ELEKTRIK - GUNCELLEME
echo  Klasor: %APP_DIR%
echo.

if exist "%WORK_DIR%" rmdir /s /q "%WORK_DIR%"
mkdir "%WORK_DIR%"

if not "%VER%"=="" (
  set "ZIP_URL=https://github.com/%REPO%/releases/download/v%VER%/elektrik-otomasyon-%VER%.zip"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{'Cache-Control'='no-cache'}; Invoke-WebRequest -Uri '%MANIFEST_URL%?cb=%CACHE_BUST%' -Headers $h -OutFile '%WORK_DIR%\guncelleme.json' -UseBasicParsing"
  if errorlevel 1 (
    echo HATA: guncelleme.json indirilemedi.
    exit /b 1
  )
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$m=Get-Content '%WORK_DIR%\guncelleme.json' -Raw | ConvertFrom-Json; $m.version"`) do set "VER=%%i"
  for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$m=Get-Content '%WORK_DIR%\guncelleme.json' -Raw | ConvertFrom-Json; if ($m.url){$m.url}else{'https://github.com/'+$m.repo+'/releases/download/'+$m.tag+'/'+$m.assetName}"`) do set "ZIP_URL=%%i"
)

if "%ZIP_URL%"=="" set "ZIP_URL=https://github.com/%REPO%/releases/download/v%VER%/elektrik-otomasyon-%VER%.zip"
echo Indirilecek surum: v%VER%

powershell -NoProfile -Command "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%WORK_DIR%\paket.zip' -UseBasicParsing"
if errorlevel 1 ( echo HATA: ZIP indirilemedi. & exit /b 1 )

powershell -NoProfile -Command "Expand-Archive -Path '%WORK_DIR%\paket.zip' -DestinationPath '%WORK_DIR%\paket' -Force"

if exist "%APP_DIR%DURDUR.bat" call "%APP_DIR%DURDUR.bat" >nul 2>&1
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

xcopy "%WORK_DIR%\paket\*" "%APP_DIR%" /E /I /Y >nul
echo.
echo  TAMAM: v%VER% kuruldu.
if exist "%APP_DIR%BASLAT.bat" (
  echo  BASLAT.bat ile acin.
) else if exist "%APP_DIR%dist\elektrik-otomasyon.exe" (
  echo  dist\elektrik-otomasyon.exe veya npm start ile acin.
)
pause
endlocal
