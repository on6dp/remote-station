@echo off
chcp 65001 >nul
rem Installe l'assistant "carte son du TRX" de la Remote Station (demande les droits administrateur)
net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Remote Station - assistant carte son du TRX
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-carte-son.ps1"
echo.
pause
