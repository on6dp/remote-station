@echo off
call "%~dp0_commun.cmd" "%~f0" || exit /b
start "" explorer "%RS_DIR%\logs"
start "" explorer "%~dp0..\service"
