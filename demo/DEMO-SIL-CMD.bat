@echo off
:: Bu dosyayi C:\ veya Masaustune kopyalayip calistirin (demo icinden DEGIL).
:: Ornek: demo klasoru C:\demo ise — C:\demo\DURDUR sonra silme.

set "DEMO=C:\demo"
if not "%~1"=="" set "DEMO=%~1"
if "%DEMO:~-1%"=="\" set "DEMO=%DEMO:~0,-1%"

echo Demo durduruluyor: %DEMO%
if exist "%DEMO%\DURDUR.bat" call "%DEMO%\DURDUR.bat"
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3010 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul
cd /d C:\
rmdir /s /q "%DEMO%"
if exist "%DEMO%" (
  echo Silinemedi — PC yeniden baslatin.
) else (
  echo Silindi: %DEMO%
)
pause
