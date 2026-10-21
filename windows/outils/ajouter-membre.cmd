@echo off
chcp 65001 >nul
call "%~dp0_commun.cmd" "%~f0" || exit /b
title Remote Station - ajouter ou modifier un membre
echo.
echo  Ajouter ou modifier un membre (son mot de passe sera demande)
echo.
set /p CALL=  Indicatif : 
if "%CALL%"=="" exit /b
set "OPT="
set /p ADM=  Administrateur (peut reprendre la main) ? (o/N) : 
if /i "%ADM%"=="o" set "OPT=--admin"
set /p NOTX=  Ecoute et reglages seulement, sans emission ? (o/N) : 
if /i "%NOTX%"=="o" set "OPT=%OPT% --no-tx"
"%NODE%" adduser.js %CALL% %OPT%
echo.
pause
