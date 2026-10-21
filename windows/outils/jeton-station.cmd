@echo off
chcp 65001 >nul
call "%~dp0_commun.cmd" "%~f0" || exit /b
title Remote Station - jeton de la station
echo.
echo  Jeton a coller une seule fois sur la page Station du PC du club :
echo.
"%NODE%" -e "process.stdout.write('  ' + require('./config.json').stationToken + '\n')"
echo.
echo  Ne le communiquez a personne d'autre.
pause
