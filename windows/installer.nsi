; installer.nsi — installateur Windows 11 de Remote Station UBA-LGE (ON5VL / OR0L)
; Construit par windows/build.sh (makensis) : kit du PC du club et/ou serveur Remote Station (service Windows).
;
; Installation silencieuse (essais, déploiement) :
;   RemoteStation-Setup.exe /S [/KIT=0|1] [/SERVEUR=0|1] [/RESEAU=0|1] [/URL=https://remote.op0p.be]

Unicode true
SetCompressor /SOLID lzma

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef STAGE
  !error "STAGE (dossier préparé par build.sh) manquant"
!endif
!ifndef OUTFILE
  !define OUTFILE "RemoteStation-Setup.exe"
!endif

!define APP "Remote Station UBA-LGE"
!define PUBLISHER "UBA-LGE (ON5VL / OR0L)"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RemoteStationUBALGE"
!define DEFAULT_URL "https://remote.op0p.be"
!define PORT "9000"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\RemoteStation"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
BrandingText "${APP} ${VERSION}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${APP}"
VIAddVersionKey /LANG=1036 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de ${APP}"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "GPL v3 (décodeurs WSJT-X) — voir TIERS.md"

Var Url
Var UrlBox
Var Browser
Var Node
Var OptKit
Var OptSrv
Var OptNet

; ------------------------------------------------------------------ pages
!define MUI_ICON "rs.ico"
!define MUI_UNICON "rs.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_WELCOMEPAGE_TITLE "${APP} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "$(TxtWelcome)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
Page custom UrlPage UrlPageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "$(TxtFinish)"
!define MUI_FINISHPAGE_LINK "$(TxtManual)"
!define MUI_FINISHPAGE_LINK_LOCATION "${DEFAULT_URL}/aide"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_RESERVEFILE_LANGDLL

; ------------------------------------------------------------------ textes
LangString TxtWelcome ${LANG_FRENCH} "Cet assistant installe Remote Station sur ce PC Windows :$\r$\n$\r$\n• le kit du PC du club : page Station (liaison avec le TRX) et dashboard, avec les bons réglages de Chrome, lancement au démarrage de Windows ;$\r$\n$\r$\n• et/ou le serveur Remote Station lui-même (service Windows), si le club ne passe pas par le VPS.$\r$\n$\r$\nRien d'autre n'est installé ni modifié."
LangString TxtWelcome ${LANG_ENGLISH} "This wizard installs Remote Station on this Windows PC:$\r$\n$\r$\n• the club PC kit: Station page (link with the transceiver) and dashboard, with the right Chrome settings, started with Windows;$\r$\n$\r$\n• and/or the Remote Station server itself (Windows service), if the club does not use the VPS.$\r$\n$\r$\nNothing else is installed or changed."
LangString TxtFinish ${LANG_FRENCH} "Remote Station est installé.$\r$\n$\r$\nPC du club : ouvrez « Remote Station - Page Station » (bureau), collez le jeton de la station la première fois, choisissez le TRX, son port et « Activer l'audio ».$\r$\n$\r$\nServeur : menu Démarrer → Remote Station → « Ajouter un membre » pour créer les comptes."
LangString TxtFinish ${LANG_ENGLISH} "Remote Station is installed.$\r$\n$\r$\nClub PC: open « Remote Station - Page Station » (desktop), paste the station token the first time, choose the transceiver, its port and « Activer l'audio » (enable audio).$\r$\n$\r$\nServer: Start menu → Remote Station → « Ajouter un membre » (add a member) to create the accounts."
LangString TxtManual ${LANG_FRENCH} "Manuel d'utilisation"
LangString TxtManual ${LANG_ENGLISH} "User manual"
LangString TxtUrlTitle ${LANG_FRENCH} "Adresse du serveur"
LangString TxtUrlTitle ${LANG_ENGLISH} "Server address"
LangString TxtUrlSub ${LANG_FRENCH} "Le serveur Remote Station auquel le PC du club se relie."
LangString TxtUrlSub ${LANG_ENGLISH} "The Remote Station server the club PC connects to."
LangString TxtUrlHelp ${LANG_FRENCH} "Serveur du club sur le VPS : https://remote.op0p.be$\r$\nServeur installé sur ce PC : http://localhost:${PORT}"
LangString TxtUrlHelp ${LANG_ENGLISH} "Club server on the VPS: https://remote.op0p.be$\r$\nServer installed on this PC: http://localhost:${PORT}"
LangString TxtUrlBad ${LANG_FRENCH} "L'adresse doit commencer par https:// (ou http://localhost pour un serveur sur ce PC)."
LangString TxtUrlBad ${LANG_ENGLISH} "The address must start with https:// (or http://localhost for a server on this PC)."
LangString TxtNo64 ${LANG_FRENCH} "Remote Station demande Windows 10 ou 11 en 64 bits."
LangString TxtNo64 ${LANG_ENGLISH} "Remote Station needs 64-bit Windows 10 or 11."
LangString TxtNoBrowser ${LANG_FRENCH} "Google Chrome (ou Microsoft Edge) est introuvable. La page Station en a besoin pour dialoguer avec le TRX (port série).$\r$\n$\r$\nInstallez Google Chrome, puis relancez cette installation. Le dashboard s'ouvrira en attendant dans le navigateur par défaut."
LangString TxtNoBrowser ${LANG_ENGLISH} "Google Chrome (or Microsoft Edge) was not found. The Station page needs it to talk to the transceiver (serial port).$\r$\n$\r$\nInstall Google Chrome, then run this setup again. Meanwhile the dashboard opens in the default browser."
LangString TxtNodeAsk ${LANG_FRENCH} "Le serveur a besoin de Node.js (version 20 ou plus récente), absent de ce PC.$\r$\n$\r$\nL'installer maintenant avec winget (Microsoft) depuis nodejs.org ?"
LangString TxtNodeAsk ${LANG_ENGLISH} "The server needs Node.js (version 20 or later), which is not on this PC.$\r$\n$\r$\nInstall it now with winget (Microsoft) from nodejs.org?"
LangString TxtNodeMissing ${LANG_FRENCH} "Node.js est introuvable : le service Remote Station n'a pas été créé.$\r$\n$\r$\nInstallez Node.js LTS depuis https://nodejs.org, puis relancez cette installation (les fichiers du serveur sont déjà en place)."
LangString TxtNodeMissing ${LANG_ENGLISH} "Node.js was not found: the Remote Station service was not created.$\r$\n$\r$\nInstall Node.js LTS from https://nodejs.org, then run this setup again (the server files are already in place)."
LangString TxtFirstUser ${LANG_FRENCH} "Aucun membre n'est encore enregistré sur ce serveur.$\r$\n$\r$\nCréer maintenant le premier compte (administrateur) ?"
LangString TxtFirstUser ${LANG_ENGLISH} "No member is registered on this server yet.$\r$\n$\r$\nCreate the first (administrator) account now?"
LangString TxtToken ${LANG_FRENCH} "Jeton de la station, à coller une seule fois sur la page Station du PC du club (menu Démarrer → Remote Station → « Jeton de la station » pour le retrouver) :$\r$\n$\r$\n"
LangString TxtToken ${LANG_ENGLISH} "Station token, to paste once on the Station page of the club PC (Start menu → Remote Station → « Jeton de la station » to see it again):$\r$\n$\r$\n"
LangString TxtUnData ${LANG_FRENCH} "Supprimer aussi les données du serveur (configuration, comptes des membres, macros, journaux, images SSTV) ?$\r$\n$\r$\nNon = elles restent dans $INSTDIR\serveur pour une prochaine installation."
LangString TxtUnData ${LANG_ENGLISH} "Also delete the server data (configuration, member accounts, macros, logs, SSTV pictures)?$\r$\n$\r$\nNo = they stay in $INSTDIR\serveur for a later installation."

LangString DescKit ${LANG_FRENCH} "Raccourcis « Page Station » (Chrome, réglages pour le PC du club) et « Dashboard » sur le bureau et dans le menu Démarrer."
LangString DescKit ${LANG_ENGLISH} "« Page Station » (Chrome, settings for the club PC) and « Dashboard » shortcuts on the desktop and in the Start menu."
LangString DescAuto ${LANG_FRENCH} "Ouvre la page Station à chaque démarrage de Windows (le TRX reste joignable après une coupure de courant)."
LangString DescAuto ${LANG_ENGLISH} "Opens the Station page each time Windows starts (the transceiver stays reachable after a power cut)."
LangString DescPower ${LANG_FRENCH} "Le PC ne se met plus en veille sur secteur (sinon la station se coupe)."
LangString DescPower ${LANG_ENGLISH} "The PC no longer sleeps on mains power (otherwise the station goes offline)."
LangString DescSrv ${LANG_FRENCH} "Le serveur Remote Station sur ce PC, en service Windows (port ${PORT}) ; Node.js est installé si besoin. Inutile si le club utilise le VPS."
LangString DescSrv ${LANG_ENGLISH} "The Remote Station server on this PC, as a Windows service (port ${PORT}); Node.js is installed if needed. Not needed if the club uses the VPS."
LangString DescNet ${LANG_FRENCH} "Ouvre le port ${PORT} dans le pare-feu : les membres du réseau local (ou d'internet, avec une redirection du routeur) peuvent se connecter."
LangString DescNet ${LANG_ENGLISH} "Opens port ${PORT} in the firewall: members on the local network (or the internet, with a router port forward) can connect."

; ------------------------------------------------------------------ fonctions utiles
!macro FindNodeM
  StrCpy $Node ""
  nsExec::ExecToStack 'cmd /c where node'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ; première ligne de « where »
    StrCpy $2 0
    ${Do}
      StrCpy $3 $1 1 $2
      ${If} $3 == "$\r"
      ${OrIf} $3 == "$\n"
      ${OrIf} $3 == ""
        ${ExitDo}
      ${EndIf}
      IntOp $2 $2 + 1
    ${Loop}
    StrCpy $Node $1 $2
  ${EndIf}
  ${If} $Node == ""
  ${AndIf} ${FileExists} "$PROGRAMFILES64\nodejs\node.exe"
    StrCpy $Node "$PROGRAMFILES64\nodejs\node.exe"
  ${EndIf}
!macroend

Function FindBrowser
  StrCpy $Browser ""
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${If} $0 == ""
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${EndIf}
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0"
    StrCpy $Browser $0
    Return
  ${EndIf}
  ${If} ${FileExists} "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    StrCpy $Browser "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
    StrCpy $Browser "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
  ${ElseIf} ${FileExists} "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    StrCpy $Browser "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ${Else}
    ; Edge (Chromium) gère aussi le port série
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
    ${If} $0 != ""
    ${AndIf} ${FileExists} "$0"
      StrCpy $Browser $0
    ${ElseIf} ${FileExists} "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
      StrCpy $Browser "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    ${EndIf}
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ sections
Section "-commun" SecCommon
  SetOutPath "$INSTDIR"
  File "rs.ico"
  File /oname=LISEZMOI-WINDOWS.txt "${STAGE}\LISEZMOI-WINDOWS.txt"
  WriteUninstaller "$INSTDIR\Desinstaller.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\rs.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "${DEFAULT_URL}/aide"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstaller.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Desinstaller.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

SectionGroup /e "Serveur Remote Station" GrpSrv
  Section /o "Serveur (service Windows)" SecSrv
    StrCpy $OptSrv 1
    !insertmacro FindNodeM
    ${If} $Node == ""
      ${IfNot} ${Silent}
        MessageBox MB_YESNO|MB_ICONQUESTION "$(TxtNodeAsk)" IDNO nonode
      ${EndIf}
      DetailPrint "winget install OpenJS.NodeJS.LTS"
      nsExec::ExecToLog 'winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements'
      Pop $0
      !insertmacro FindNodeM
      nonode:
    ${EndIf}

    ; Mise à jour : le service est arrêté avant de remplacer les fichiers
    ${If} ${FileExists} "$INSTDIR\service\RemoteStation.exe"
      nsExec::ExecToLog '"$INSTDIR\service\RemoteStation.exe" stop'
      Pop $0
      Sleep 1500
    ${EndIf}
    ; Programme du serveur (config.json, users.json, macros, sessions, logs et sstv ne sont pas dans l'archive : jamais écrasés)
    SetOutPath "$INSTDIR\serveur"
    File /r "${STAGE}\serveur\*.*"
    SetOutPath "$INSTDIR\outils"
    File "${STAGE}\outils\*.cmd"
    SetOutPath "$INSTDIR\service"
    File /oname=RemoteStation.exe "${STAGE}\WinSW-x64.exe"

    ; Raccourcis d'administration (tous les utilisateurs)
    SetShellVarContext all
    CreateDirectory "$SMPROGRAMS\Remote Station"
    CreateShortCut "$SMPROGRAMS\Remote Station\Ajouter un membre.lnk" "$INSTDIR\outils\ajouter-membre.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Liste des membres.lnk" "$INSTDIR\outils\liste-membres.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Supprimer un membre.lnk" "$INSTDIR\outils\supprimer-membre.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Jeton de la station.lnk" "$INSTDIR\outils\jeton-station.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Configuration du serveur.lnk" "$INSTDIR\outils\configuration.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Redémarrer le serveur.lnk" "$INSTDIR\outils\redemarrer.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Journaux du serveur.lnk" "$INSTDIR\outils\journaux.cmd" "" "$INSTDIR\rs.ico"
    CreateShortCut "$SMPROGRAMS\Remote Station\Désinstaller Remote Station.lnk" "$INSTDIR\Desinstaller.exe" "" "$INSTDIR\rs.ico"
    SetShellVarContext current

    ${If} $Node == ""
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(TxtNodeMissing)"
      ${EndIf}
      DetailPrint "Node.js introuvable : service non créé"
      Goto srvdone
    ${EndIf}
    DetailPrint "Node.js : $Node"

    ; Configuration (créée la première fois, adresse d'écoute selon l'option réseau)
    ${If} $OptNet == 1
      nsExec::ExecToLog '"$Node" "$INSTDIR\serveur\windows-setup.js" --reseau'
    ${Else}
      nsExec::ExecToLog '"$Node" "$INSTDIR\serveur\windows-setup.js"'
    ${EndIf}
    Pop $0

    ; Service Windows (WinSW) : démarrage automatique, redémarrage en cas d'arrêt anormal
    ; En UTF-16 (avec BOM) : accents et chemins quelconques lus correctement par WinSW
    FileOpen $9 "$INSTDIR\service\RemoteStation.xml" w
    FileWriteWord $9 0xFEFF
    FileWriteUTF16LE $9 '<?xml version="1.0" encoding="UTF-16"?>$\r$\n'
    FileWriteUTF16LE $9 '<service>$\r$\n'
    FileWriteUTF16LE $9 '  <id>RemoteStation</id>$\r$\n'
    FileWriteUTF16LE $9 '  <name>${APP}</name>$\r$\n'
    FileWriteUTF16LE $9 '  <description>Serveur Remote Station (ON5VL / OR0L) : dashboard des membres, liaison avec la page Station du PC du club, décodage des modes numériques.</description>$\r$\n'
    FileWriteUTF16LE $9 '  <executable>$Node</executable>$\r$\n'
    FileWriteUTF16LE $9 '  <arguments>"$INSTDIR\serveur\server.js"</arguments>$\r$\n'
    FileWriteUTF16LE $9 '  <workingdirectory>$INSTDIR\serveur</workingdirectory>$\r$\n'
    FileWriteUTF16LE $9 '  <startmode>Automatic</startmode>$\r$\n'
    FileWriteUTF16LE $9 '  <delayedAutoStart>true</delayedAutoStart>$\r$\n'
    FileWriteUTF16LE $9 '  <onfailure action="restart" delay="10 sec"/>$\r$\n'
    FileWriteUTF16LE $9 '  <resetfailure>1 hour</resetfailure>$\r$\n'
    FileWriteUTF16LE $9 '  <stoptimeout>10 sec</stoptimeout>$\r$\n'
    FileWriteUTF16LE $9 '  <log mode="roll-by-size"><sizeThreshold>5120</sizeThreshold><keepFiles>5</keepFiles></log>$\r$\n'
    FileWriteUTF16LE $9 '</service>$\r$\n'
    FileClose $9
    nsExec::ExecToLog '"$INSTDIR\service\RemoteStation.exe" install'
    Pop $0
    nsExec::ExecToLog '"$INSTDIR\service\RemoteStation.exe" start'
    Pop $0

    ; Premier compte
    ${IfNot} ${FileExists} "$INSTDIR\serveur\users.json"
    ${AndIfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION "$(TxtFirstUser)" IDNO nofirst
        ExecWait '"$SYSDIR\cmd.exe" /c ""$INSTDIR\outils\ajouter-membre.cmd""'
      nofirst:
    ${EndIf}
    ; Jeton de la station
    ${IfNot} ${Silent}
      nsExec::ExecToStack '"$Node" -e "process.stdout.write(require(process.argv[1]).stationToken)" "$INSTDIR\serveur\config.json"'
      Pop $0
      Pop $1
      ${If} $0 == 0
        MessageBox MB_OK|MB_ICONINFORMATION "$(TxtToken)$1"
      ${EndIf}
    ${EndIf}
    srvdone:
  SectionEnd

  Section /o "Accès depuis le réseau (pare-feu)" SecNet
    StrCpy $OptNet 1
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${APP}"'
    Pop $0
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${APP}" dir=in action=allow protocol=TCP localport=${PORT}'
    Pop $0
    ; (l'adresse d'écoute 0.0.0.0 est réglée par la section serveur, qui connaît déjà cette option)
  SectionEnd
SectionGroupEnd

SectionGroup /e "PC du club" GrpKit
  Section "Page Station et dashboard" SecKit
    StrCpy $OptKit 1
    SetShellVarContext current
    ; Installation silencieuse sans /URL : serveur de ce PC ou VPS du club
    ${If} $Url == ""
      ${If} ${SectionIsSelected} ${SecSrv}
        StrCpy $Url "http://localhost:${PORT}"
      ${Else}
        StrCpy $Url "${DEFAULT_URL}"
      ${EndIf}
    ${EndIf}
    Call CheckUrl
    Call FindBrowser
    CreateDirectory "$SMPROGRAMS\Remote Station"
    ; Dashboard et manuel : navigateur par défaut
    WriteINIStr "$DESKTOP\Remote Station - Dashboard.url" "InternetShortcut" "URL" "$Url/"
    WriteINIStr "$DESKTOP\Remote Station - Dashboard.url" "InternetShortcut" "IconFile" "$INSTDIR\rs.ico"
    WriteINIStr "$DESKTOP\Remote Station - Dashboard.url" "InternetShortcut" "IconIndex" "0"
    WriteINIStr "$SMPROGRAMS\Remote Station\Dashboard.url" "InternetShortcut" "URL" "$Url/"
    WriteINIStr "$SMPROGRAMS\Remote Station\Dashboard.url" "InternetShortcut" "IconFile" "$INSTDIR\rs.ico"
    WriteINIStr "$SMPROGRAMS\Remote Station\Dashboard.url" "InternetShortcut" "IconIndex" "0"
    ${If} $LANGUAGE == ${LANG_FRENCH}
      WriteINIStr "$SMPROGRAMS\Remote Station\Manuel d'utilisation.url" "InternetShortcut" "URL" "$Url/aide"
    ${Else}
      WriteINIStr "$SMPROGRAMS\Remote Station\User manual.url" "InternetShortcut" "URL" "$Url/help"
    ${EndIf}
    ${If} $Browser == ""
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(TxtNoBrowser)"
      ${EndIf}
      DetailPrint "Chrome / Edge introuvable : raccourci Page Station non créé"
    ${Else}
      DetailPrint "Navigateur : $Browser"
      ; Profil séparé : les réglages ci-dessous s'appliquent même si Chrome est déjà ouvert pour autre chose
      CreateDirectory "$LOCALAPPDATA\RemoteStation\Navigateur"
      StrCpy $0 '--app=$Url/station --user-data-dir="$LOCALAPPDATA\RemoteStation\Navigateur" --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --no-first-run --no-default-browser-check'
      CreateShortCut "$DESKTOP\Remote Station - Page Station.lnk" "$Browser" "$0" "$INSTDIR\rs.ico" 0 SW_SHOWMAXIMIZED "" "Page Station du PC du club (liaison avec le TRX)"
      CreateShortCut "$SMPROGRAMS\Remote Station\Page Station (PC du club).lnk" "$Browser" "$0" "$INSTDIR\rs.ico" 0 SW_SHOWMAXIMIZED "" "Page Station du PC du club (liaison avec le TRX)"
      WriteRegStr HKLM "${UNINST_KEY}" "StationArgs" "$0"
    ${EndIf}
    WriteRegStr HKLM "${UNINST_KEY}" "ServerUrl" "$Url"
    CreateShortCut "$SMPROGRAMS\Remote Station\Désinstaller Remote Station.lnk" "$INSTDIR\Desinstaller.exe" "" "$INSTDIR\rs.ico"
  SectionEnd

  Section "Page Station au démarrage de Windows" SecAuto
    SetShellVarContext current
    ${If} $Browser != ""
      ReadRegStr $0 HKLM "${UNINST_KEY}" "StationArgs"
      CreateShortCut "$SMSTARTUP\Remote Station - Page Station.lnk" "$Browser" "$0" "$INSTDIR\rs.ico" 0 SW_SHOWMAXIMIZED
    ${EndIf}
  SectionEnd

  Section "Pas de mise en veille" SecPower
    nsExec::ExecToLog 'powercfg /change standby-timeout-ac 0'
    Pop $0
    nsExec::ExecToLog 'powercfg /change hibernate-timeout-ac 0'
    Pop $0
  SectionEnd
SectionGroupEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecKit} "$(DescKit)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAuto} "$(DescAuto)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPower} "$(DescPower)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecSrv} "$(DescSrv)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecNet} "$(DescNet)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ------------------------------------------------------------------ page « adresse du serveur »
Function UrlPage
  ${IfNot} ${SectionIsSelected} ${SecKit}
    Abort
  ${EndIf}
  ${If} $Url == ""
    ${If} ${SectionIsSelected} ${SecSrv}
      StrCpy $Url "http://localhost:${PORT}"
    ${Else}
      StrCpy $Url "${DEFAULT_URL}"
    ${EndIf}
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "$(TxtUrlTitle)" "$(TxtUrlSub)"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateText} 0 20u 100% 13u "$Url"
  Pop $UrlBox
  ${NSD_CreateLabel} 0 44u 100% 40u "$(TxtUrlHelp)"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function UrlPageLeave
  ${NSD_GetText} $UrlBox $Url
  Call CheckUrl
  ${If} $0 != 1
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(TxtUrlBad)"
    Abort
  ${EndIf}
FunctionEnd

; $Url : retire le « / » final ; $0 = 1 si l'adresse est acceptable (https://… ou http://localhost…)
Function CheckUrl
  StrCpy $0 $Url 1 -1
  ${If} $0 == "/"
    StrCpy $Url $Url -1
  ${EndIf}
  StrCpy $0 0
  StrCpy $1 $Url 8
  ${If} $1 == "https://"
    StrCpy $0 1
  ${EndIf}
  StrCpy $1 $Url 16
  ${If} $1 == "http://localhost"
    StrCpy $0 1
  ${EndIf}
  StrCpy $1 $Url 16
  ${If} $1 == "http://127.0.0.1"
    StrCpy $0 1
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ démarrage
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "$(TxtNo64)"
    Abort
  ${EndIf}
  SetRegView 64
  !insertmacro MUI_LANGDLL_DISPLAY
  StrCpy $OptKit 0
  StrCpy $OptSrv 0
  StrCpy $OptNet 0
  ; Options de la ligne de commande (installation silencieuse)
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/URL=" $R1
  ${IfNot} ${Errors}
    StrCpy $Url $R1
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/SERVEUR=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == 1
      !insertmacro SelectSection ${SecSrv}
    ${Else}
      !insertmacro UnselectSection ${SecSrv}
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/RESEAU=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == 1
      !insertmacro SelectSection ${SecNet}
    ${Else}
      !insertmacro UnselectSection ${SecNet}
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/KIT=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 == 0
    !insertmacro UnselectSection ${SecKit}
    !insertmacro UnselectSection ${SecAuto}
    !insertmacro UnselectSection ${SecPower}
  ${EndIf}
  ; L'option réseau est appliquée par la section serveur : on la connaît avant
  ${If} ${SectionIsSelected} ${SecNet}
    StrCpy $OptNet 1
  ${EndIf}
FunctionEnd

; Le pare-feu n'a de sens qu'avec le serveur ; « au démarrage » seulement avec le kit
Function .onSelChange
  ${If} ${SectionIsSelected} ${SecNet}
    StrCpy $OptNet 1
    !insertmacro SelectSection ${SecSrv}
  ${Else}
    StrCpy $OptNet 0
  ${EndIf}
  ${IfNot} ${SectionIsSelected} ${SecKit}
    !insertmacro UnselectSection ${SecAuto}
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ désinstallation
Function un.onInit
  SetRegView 64
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd

Section "Uninstall"
  ${If} ${FileExists} "$INSTDIR\service\RemoteStation.exe"
    nsExec::ExecToLog '"$INSTDIR\service\RemoteStation.exe" stop'
    Pop $0
    Sleep 1500
    nsExec::ExecToLog '"$INSTDIR\service\RemoteStation.exe" uninstall'
    Pop $0
  ${EndIf}
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${APP}"'
  Pop $0

  ; Raccourcis (utilisateur courant et tous les utilisateurs)
  SetShellVarContext current
  Delete "$DESKTOP\Remote Station - Page Station.lnk"
  Delete "$DESKTOP\Remote Station - Dashboard.url"
  Delete "$SMSTARTUP\Remote Station - Page Station.lnk"
  RMDir /r "$SMPROGRAMS\Remote Station"
  SetShellVarContext all
  RMDir /r "$SMPROGRAMS\Remote Station"
  SetShellVarContext current

  ; Données du serveur : gardées sauf demande contraire
  StrCpy $1 0
  ${If} ${FileExists} "$INSTDIR\serveur\config.json"
    ${IfNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(TxtUnData)" IDNO keepdata
      StrCpy $1 1
      keepdata:
    ${EndIf}
  ${Else}
    StrCpy $1 1
  ${EndIf}
  ${If} $1 == 1
    RMDir /r "$INSTDIR\serveur"
  ${Else}
    ; Programme seulement : config.json, users.json, sessions.json, macros.json, logs, sstv restent
    RMDir /r "$INSTDIR\serveur\lib"
    RMDir /r "$INSTDIR\serveur\public"
    RMDir /r "$INSTDIR\serveur\native"
    RMDir /r "$INSTDIR\serveur\deploy"
    Delete "$INSTDIR\serveur\*.js"
    Delete "$INSTDIR\serveur\*.md"
    Delete "$INSTDIR\serveur\package.json"
    Delete "$INSTDIR\serveur\config.example.json"
  ${EndIf}
  RMDir /r "$INSTDIR\service"
  RMDir /r "$INSTDIR\outils"
  Delete "$INSTDIR\rs.ico"
  Delete "$INSTDIR\LISEZMOI-WINDOWS.txt"
  Delete "$INSTDIR\Desinstaller.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
SectionEnd
