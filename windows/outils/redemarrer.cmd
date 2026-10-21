@echo off
chcp 65001 >nul
call "%~dp0_commun.cmd" "%~f0" || exit /b
title Remote Station - redemarrer le serveur
"%RS_SVC%" restart
"%RS_SVC%" status
echo.
pause
