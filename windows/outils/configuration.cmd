@echo off
chcp 65001 >nul
call "%~dp0_commun.cmd" "%~f0" || exit /b
title Remote Station - configuration
echo  Modifiez config.json, enregistrez et fermez le Bloc-notes : le serveur redemarre ensuite.
start /wait notepad "%RS_DIR%\config.json"
"%RS_SVC%" restart
echo.
pause
