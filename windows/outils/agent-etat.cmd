@echo off
chcp 65001 >nul
net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Remote Station - etat de l'Agent LoTW
set "AG=%~dp0..\agent-lotw"
set "NODE=node"
where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
"%NODE%" "%AG%\agent-lotw.js" --etat
echo.
"%AG%\RemoteStationAgentLoTW.exe" status
echo.
echo --- dernieres lignes du journal de l'agent ---
powershell -NoProfile -Command "Get-Content -Tail 25 -Encoding UTF8 '%AG%\RemoteStationAgentLoTW.out.log' -ErrorAction SilentlyContinue"
echo.
pause
