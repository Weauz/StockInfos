@echo off
chcp 65001 >nul
title StockInfos
setlocal
set "APP=%~dp0"
set "RT=%LOCALAPPDATA%\StockInfos\moteur-33.4.11"
set "ZIP=%~dp0moteur\electron-runtime-33.4.11.zip"

if exist "%RT%\electron.exe" goto :run
if not exist "%ZIP%" goto :nozip

echo Premiere utilisation : preparation du moteur de lapp (environ 1 minute)...
if exist "%RT%" rmdir /s /q "%RT%"
mkdir "%RT%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:RT -Force"
if not exist "%RT%\electron.exe" goto :error

:run
start "" "%RT%\electron.exe" "%APP%."
exit /b

:nozip
echo.
echo   Le fichier moteur\electron-runtime-33.4.11.zip est introuvable.
echo   Sil est en ligne seulement (OneDrive), fais clic droit sur le dossier
echo   "moteur" puis "Toujours conserver sur cet appareil", et relance.
pause
exit /b

:error
echo.
echo   La preparation a echoue (antivirus ?). Envoie une capture de cette fenetre.
pause
