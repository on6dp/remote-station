@echo off
chcp 65001 >nul
call "%~dp0_commun.cmd" "%~f0" || exit /b
title Remote Station - supprimer un membre
set /p CALL=  Indicatif a supprimer : 
if "%CALL%"=="" exit /b
"%NODE%" adduser.js --del %CALL%
echo.
pause
