@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ===== Sadece sunucu IP ve portu yazin =====
set ELEKTRIK_IP=213.142.134.104
set ELEKTRIK_PORT=3010
rem ==========================================

set "URL=http://%ELEKTRIK_IP%:%ELEKTRIK_PORT%/"

if exist "%~dp0pencere-ac.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pencere-ac.ps1" -Url "%URL%"
  exit /b 0
)

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL%
  exit /b 0
)

set "CHR=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHR%" set "CHR=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHR%" (
  start "" "%CHR%" --app=%URL%
  exit /b 0
)

start "" "%URL%"
pause
