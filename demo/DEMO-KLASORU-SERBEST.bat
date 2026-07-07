@echo off
chcp 65001 >nul
setlocal EnableExtensions

:: Ilk calistirma: demo yolunu kaydet, TEMP'ten tek pencere ac (sonsuz dongu yok).
if /i not "%~1"=="RUN" (
  set "DEMO_KLASOR=%~dp0"
  set "TMPBAT=%TEMP%\elektrik-demo-serbest-%RANDOM%.bat"
  copy /Y "%~f0" "%TMPBAT%" >nul
  start "" /wait cmd.exe /c call "%TMPBAT%" RUN "%DEMO_KLASOR%"
  del "%TMPBAT%" >nul 2>&1
  exit /b 0
)

set "DEMO=%~2"
if not defined DEMO set "DEMO=%~dp0"
if "%DEMO:~-1%"=="\" set "DEMO=%DEMO:~0,-1%"

echo.
echo === Elektrik demo kilidi kaldiriliyor ===
echo Klasor: %DEMO%
echo.

if exist "%DEMO%\DURDUR.bat" call "%DEMO%\DURDUR.bat"
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
taskkill /F /IM "Elektrik Otomasyon.exe" >nul 2>&1
taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3010 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo 3 saniye bekleniyor...
timeout /t 3 /nobreak >nul

echo.
echo Dosya Gezgini penceresinde %DEMO% aciksa KAPATIN.
echo.
choice /C SN /M "Demo klasorunu tamamen silinsin mi (S=evet, N=hayir)"
if errorlevel 2 goto BITIR

cd /d C:\
if exist "%DEMO%" (
  rmdir /s /q "%DEMO%" 2>nul
  if exist "%DEMO%" (
    echo.
    echo SILINEMEDI. Gorev Yoneticisinde Elektrik-Otomasyon.exe kapatin,
    echo bilgisayari yeniden baslatin, sonra klasoru silin.
    pause
    exit /b 1
  )
  echo Klasor silindi: %DEMO%
) else (
  echo Klasor zaten yok.
)

:BITIR
echo.
echo Tamam.
pause
exit /b 0
