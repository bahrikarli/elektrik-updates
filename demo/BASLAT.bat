@echo off
setlocal
cd /d "%~dp0"

if not exist "Elektrik-Otomasyon.exe" (
  msg * "Elektrik-Otomasyon.exe bulunamadi. ZIP tam mi?" /time:15
  exit /b 1
)
if not exist "baslat-arkaplan.ps1" (
  msg * "baslat-arkaplan.ps1 eksik. Tum demo klasorunu kopyalayin." /time:15
  exit /b 1
)

rem wscript engelliyse dogrudan PowerShell
if exist "%~dp0baslat.vbs" (
  wscript.exe //nologo "%~dp0baslat.vbs" 2>nul
  if not errorlevel 1 exit /b 0
)

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0baslat-arkaplan.ps1"
exit /b %ERRORLEVEL%
