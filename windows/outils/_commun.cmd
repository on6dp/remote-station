@rem Commun aux outils : droits administrateur, dossier du serveur, Node.js
@net session >nul 2>&1 || (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f1' -Verb RunAs"
  exit /b 1
)
@set "RS_DIR=%~dp0..\serveur"
@set "RS_SVC=%~dp0..\service\RemoteStation.exe"
@set "NODE=node"
@where node >nul 2>&1 || set "NODE=%ProgramFiles%\nodejs\node.exe"
@cd /d "%RS_DIR%"
@exit /b 0
