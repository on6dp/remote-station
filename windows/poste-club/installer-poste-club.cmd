@echo off
chcp 65001 >nul
rem Installe tout ce qui accompagne la page Station sur le PC du club (demande les droits administrateur)
net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Remote Station - installation du PC du club
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer-poste-club.ps1"
echo.
pause
