@echo off
setlocal EnableDelayedExpansion

set "ROOT=%~dp0"
set "REPO=bahrikarli/elektrik-updates"
set "REPO_URL=https://github.com/%REPO%.git"
set "UPDATE_DIR=%USERPROFILE%\elektrik-updates"
set "VER=%~1"
set "GIT_AUTHOR_NAME=bahrikarli"
set "GIT_AUTHOR_EMAIL=bahrikarli@gmail.com"
set "GIT_COMMITTER_NAME=bahrikarli"
set "GIT_COMMITTER_EMAIL=bahrikarli@gmail.com"

cd /d "%ROOT%"

if "%VER%"=="" (
  for /f "usebackq delims=" %%i in (`node -p "require('./package.json').version"`) do set "VER=%%i"
)

if "%VER%"=="" (
  echo HATA: Version okunamadi.
  exit /b 1
)

set "ZIP_FILE=%ROOT%elektrik-otomasyon-%VER%.zip"
if not exist "%ZIP_FILE%" (
  echo HATA: ZIP bulunamadi: "%ZIP_FILE%"
  echo Once release-otomatik.bat %VER% calistirin.
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo HATA: Git bulunamadi.
  echo Git kurun: https://git-scm.com/download/win
  exit /b 1
)

echo.
echo [1/5] Guncelleme repo klasoru hazirlaniyor...
if exist "%UPDATE_DIR%\.git" (
  git -C "%UPDATE_DIR%" pull
) else (
  if exist "%UPDATE_DIR%" rmdir /s /q "%UPDATE_DIR%"
  git clone "%REPO_URL%" "%UPDATE_DIR%"
)
if errorlevel 1 (
  echo HATA: Guncelleme reposu hazirlanamadi.
  echo Repo public/private durumunu ve GitHub yetkinizi kontrol edin: %REPO_URL%
  exit /b 1
)

echo.
echo [2/5] Dosyalar kopyalaniyor...
copy /y "%ZIP_FILE%" "%UPDATE_DIR%\" >nul
if errorlevel 1 exit /b 1

(
echo {
echo   "version": "%VER%",
echo   "repo": "%REPO%",
echo   "tag": "v%VER%",
echo   "assetName": "elektrik-otomasyon-%VER%.zip",
echo   "url": "https://github.com/%REPO%/releases/download/v%VER%/elektrik-otomasyon-%VER%.zip",
echo   "notes": "v%VER% guncellemesi"
echo }
) > "%UPDATE_DIR%\guncelleme.json"

copy /y "%UPDATE_DIR%\guncelleme.json" "%UPDATE_DIR%\guncelleme-%VER%.json" >nul

echo.
echo [3/5] Git commit hazirlaniyor...
git -C "%UPDATE_DIR%" add "elektrik-otomasyon-%VER%.zip" "guncelleme.json" "guncelleme-%VER%.json"
git -C "%UPDATE_DIR%" diff --cached --quiet
if not errorlevel 1 (
  echo Degisiklik yok, commit atlanacak.
  goto push
)

git -C "%UPDATE_DIR%" commit -m "Release v%VER%"
if errorlevel 1 (
  echo HATA: Commit olusturulamadi.
  exit /b 1
)

:push
echo.
echo [4/5] GitHub'a push ediliyor...
git -C "%UPDATE_DIR%" push
if errorlevel 1 (
  echo HATA: Push basarisiz.
  echo.
  echo Muhtemel neden: GitHub oturumu yok veya eski sifre/token.
  echo Cozum ^(bir kez^):
  echo   1. gh auth login
  echo   2. gh auth setup-git
  echo   3. Tekrar: git-yayinla.bat %VER%
  echo.
  echo Alternatif: Windows "Kimlik Bilgisi Yoneticisi" ^> Windows Kimlik Bilgileri
  echo   ^> git:https://github.com kaydini silin, push sirasinda yeni PAT girin.
  echo   PAT: github.com/settings/tokens ^(repo yetkisi^)
  echo.
  echo Not: Release yuklendiyse guncelleme yine calisir:
  echo   https://github.com/%REPO%/releases/latest/download/guncelleme.json
  exit /b 1
)

echo.
echo [5/5] Tamamlandi.
echo Manifest: https://raw.githubusercontent.com/%REPO%/main/guncelleme.json
echo ZIP: https://raw.githubusercontent.com/%REPO%/main/elektrik-otomasyon-%VER%.zip
echo.
endlocal
