@echo off
setlocal

set "DEMO=%~dp0"
set "PROJE=%DEMO%.."
cd /d "%PROJE%"

echo.
echo  EXE URETIMI
echo  Proje: %CD%
echo.

if not exist "%CD%\package.json" (
  echo HATA: package.json yok.
  echo.
  echo Bu dosya SADECE gelistirici PC'de calisir:
  echo   C:\ELEKTRIK\demo\YENI-EXE-AL.bat
  echo.
  echo C:\demo veya musteri klasorunde EXE URETILEMEZ.
  echo Orada sadece BASLAT.bat kullanin.
  echo.
  pause
  exit /b 1
)

findstr /C:"build:exe" "%CD%\package.json" >nul 2>&1
if errorlevel 1 (
  echo HATA: package.json icinde build:exe script yok.
  echo Tum C:\ELEKTRIK projesini guncel surumle degistirin.
  pause
  exit /b 1
)

if not exist "%CD%\server.js" (
  echo HATA: server.js yok - yanlis klasor.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo HATA: Node.js kurulu degil. https://nodejs.org
  pause
  exit /b 1
)

if not exist "%CD%\node_modules\pkg" (
  echo node_modules eksik - npm install calisiyor...
  call npm install
  if errorlevel 1 pause & exit /b 1
)

echo Calisan program kapatiliyor...
call "%DEMO%DURDUR.bat" >nul 2>&1
taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo EXE olusturuluyor (1-2 dk)...
call npm run build:exe
if errorlevel 1 (
  echo.
  echo BUILD HATA - yukaridaki npm mesajina bakin.
  pause
  exit /b 1
)

node "%DEMO%exe-kopyala.js"
if errorlevel 1 pause & exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -File "%DEMO%baslat-kisayol-olustur.ps1" >nul 2>&1

echo.
echo  TAMAM: %DEMO%Elektrik-Otomasyon.exe
echo  Musteriye demo klasorunu zip ile gonderin.
echo  Acilis: BASLAT.lnk (simsek ikonu)
echo.
pause
exit /b 0
