@echo off
chcp 65001 >nul
rem retirer le relais DX Commander de la Remote Station (demande les droits administrateur)
net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Remote Station - retirer le relais DX Commander
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-dxcommander.ps1" -Retirer
echo.
pause
