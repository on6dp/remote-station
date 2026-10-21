@echo off
chcp 65001 >nul
call "%~dp0_commun.cmd" "%~f0" || exit /b
title Remote Station - membres
"%NODE%" adduser.js --list
echo.
pause
