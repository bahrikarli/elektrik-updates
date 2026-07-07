@echo off
echo Program durduruluyor...
taskkill /F /IM "Elektrik-Otomasyon.exe" >nul 2>&1
taskkill /F /IM "Elektrik Otomasyon.exe" >nul 2>&1
taskkill /F /IM "elektrik-otomasyon.exe" >nul 2>&1
taskkill /F /IM electron.exe >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3010 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1
echo Tamam.
timeout /t 2 >nul
