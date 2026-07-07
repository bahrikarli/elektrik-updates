@echo off
set "DEMO=%~dp0"
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%DEMO%pencere-ac.ps1" -EnvPath "%DEMO%.env"
exit /b %ERRORLEVEL%
