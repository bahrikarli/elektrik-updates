@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ELEKTRIK DEMO - DENETLE
echo  =======================
echo  Klasor: %CD%
echo.

set OK=1

if exist "Elektrik-Otomasyon.exe" (echo  [OK] Elektrik-Otomasyon.exe) else (echo  [EKSIK] Elektrik-Otomasyon.exe & set OK=0)
if exist "public\index.html" (echo  [OK] public\index.html) else (echo  [EKSIK] public\index.html & set OK=0)
if exist ".env" (echo  [OK] .env) else (echo  [EKSIK] .env - .env.ornek kopyalayin & set OK=0)
if exist "baslat-arkaplan.ps1" (echo  [OK] baslat-arkaplan.ps1) else (echo  [EKSIK] baslat-arkaplan.ps1 & set OK=0)
if exist "baslat.vbs" (echo  [OK] baslat.vbs) else (echo  [UYARI] baslat.vbs yok)
if exist "sunucu-gizli.vbs" (echo  [OK] sunucu-gizli.vbs) else (echo  [EKSIK] sunucu-gizli.vbs & set OK=0)
if exist "pencere-ac.ps1" (echo  [OK] pencere-ac.ps1) else (echo  [UYARI] pencere-ac.ps1 yok)

echo.
echo  Port 3010:
netstat -ano 2>nul | findstr ":3010" | findstr LISTENING
if errorlevel 1 echo    (bos - program kapali)

echo.
if exist "son-calistirma.log" (
  echo  son-calistirma.log son satirlar:
  powershell -NoProfile -Command "Get-Content '%CD%\son-calistirma.log' -Tail 8 -ErrorAction SilentlyContinue"
) else (
  echo  son-calistirma.log henuz yok
)

echo.
if "%OK%"=="0" (
  echo  EKSIK DOSYA VAR - ZIP veya kopyalamayi tamamlayin.
) else (
  echo  Dosyalar tamam. Simdi BASLAT.lnk veya BASLAT.bat deneyin.
)
echo.
pause
