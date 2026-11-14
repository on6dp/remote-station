@echo off
chcp 65001 >nul
net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Remote Station - appairer l'Agent LoTW
set "AG=%~dp0..\agent-lotw"
set "NODE=node"
where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
echo Agent LoTW : TQSL de ce PC signe et envoie les QSO du carnet Remote Station.
echo Code d'appairage : carnet de trafic, Operations LoTW, cadre Agent LoTW, bouton "Appairer un PC...".
echo.
"%NODE%" "%AG%\agent-lotw.js" --etat
echo.
set "SRV="
set /p "SRV=Adresse du serveur (Entree = celle ci-dessus) : "
set "CODE="
set /p "CODE=Code d'appairage (ex. ABCD-EFGH) : "
if "%CODE%"=="" goto fin
if "%SRV%"=="" (
  "%NODE%" "%AG%\agent-lotw.js" --appairer "%CODE%"
) else (
  "%NODE%" "%AG%\agent-lotw.js" --serveur "%SRV%" --appairer "%CODE%"
)
echo.
echo Le service de l'agent reprend le nouvel appairage tout seul (dans les 30 secondes).
:fin
echo.
pause
