@echo off
chcp 65001 >nul
rem Retire l'assistant "carte son du TRX" de la Remote Station (demande les droits administrateur)
net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Remote Station - retirer l'assistant carte son
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-carte-son.ps1" -Retirer
echo.
pause
