# installer-poste-club.ps1 — installe d'un coup, sur le PC du club, ce qui accompagne la page Station :
#   1. VSPE (Eterlogic) : partage du port CAT du TRX entre la page Station et les autres logiciels (solution conseillée) ;
#   2. DX Commander (DXLab) : autre façon de partager le TRX, avec moins de fonctions sur la page Station ;
#   3. OmniRig : seulement si un autre logiciel du club en a besoin (la page Station ne l'utilise pas) ;
#   4. l'assistant « carte son du TRX » (relance de la carte son, mise à l'heure de Windows) ;
#   5. le relais DX Commander (seulement pour le modèle « DX Commander » de la page Station) et DX Commander au démarrage ;
#   6. la page Station (Chrome, réglages anti-coupure) au démarrage de Windows ;
#   7. le menu Démarrer « Remote Station » : programmes, journaux, retrait.
# VSPE, DX Commander et OmniRig déjà installés : on choisit de PASSER (garder la version installée) ou d'ÉCRASER
# (réinstaller par-dessus). Leurs programmes d'installation ne sont pas dans ce zip : ils sont cherchés dans ce dossier, son
# sous-dossier « logiciels » et Téléchargements ; sinon leur page officielle de téléchargement est ouverte.
# Chaque étape demande confirmation (Entrée = réponse proposée). Ne règle rien dans l'antivirus : s'il bloque un fichier,
# le message dit quoi faire.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { } # accents des messages des installateurs lancés
$Ici = $PSScriptRoot
$Site = 'https://remote.op0p.be'
$Dest = Join-Path $env:ProgramData 'RemoteStation'
$Kit = Join-Path $Dest 'installation'
$Bilan = New-Object System.Collections.ArrayList
$PF = $env:ProgramFiles
$PF86 = ${env:ProgramFiles(x86)}
if (-not $PF86) { $PF86 = $PF }

function Titre([string]$t) { Write-Host ''; Write-Host ('== ' + $t) -ForegroundColor Cyan }
function Note([string]$t) { [void]$Bilan.Add($t); Write-Host ('   ' + $t) }
function Oui([string]$q, [bool]$def) {
  $choix = '[o/N]'
  if ($def) { $choix = '[O/n]' }
  $r = Read-Host ('   ' + $q + ' ' + $choix)
  if (-not $r) { return $def }
  return ($r.Trim() -match '^(o|oui|y|yes)$')
}
function Raccourci([string]$lnk, [string]$cible, [string]$arg, [string]$desc, [int]$fenetre = 1) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($lnk)
  $s.TargetPath = $cible
  if ($arg) { $s.Arguments = $arg }
  $s.WorkingDirectory = Split-Path -Parent $cible
  if ($desc) { $s.Description = $desc }
  $s.WindowStyle = $fenetre # 1 normale, 3 agrandie
  $s.Save()
}
function Lancer([string]$ps1) {
  # Installateur d'une partie, dans son propre PowerShell (il se termine par « exit »)
  $o = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Ici $ps1) 2>&1 | Out-String
  foreach ($l in ($o -split "`r?`n")) { if ($l.Trim()) { Write-Host ('   ' + $l.Trim()) } }
  return $o
}
# Programme installé : chemins connus d'abord, puis recherche (3 niveaux) en laissant de côté archives et programmes d'installation
function Chercher([string[]]$exacts, [string[]]$racines, [string]$filtre) {
  foreach ($p in $exacts) { if ($p -and (Test-Path $p)) { return $p } }
  foreach ($r in $racines) {
    if ($r -and (Test-Path $r)) {
      $f = Get-ChildItem -Path $r -Recurse -Depth 3 -Filter $filtre -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch 'Archive|Setup|Install|Uninst|unins' } | Select-Object -First 1
      if ($f) { return $f.FullName }
    }
  }
  return $null
}
# Programme listé dans « Applications installées » de Windows (nom, version)
function Installe([string]$motif) {
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    $e = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.DisplayName -match $motif } | Select-Object -First 1
    if ($e) { return $e }
  }
  return $null
}
# Programme d'installation téléchargé : ce dossier, « logiciels », Téléchargements (le plus récent)
function Setup([string[]]$motifs) {
  $ou = @($Ici, (Join-Path $Ici 'logiciels'), (Join-Path $env:USERPROFILE 'Downloads'))
  $l = @()
  foreach ($d in $ou) {
    if (-not (Test-Path $d)) { continue }
    foreach ($m in $motifs) { $l += @(Get-ChildItem -Path $d -Filter $m -File -ErrorAction SilentlyContinue) }
  }
  $f = $l | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($f) { return $f.FullName }
  return $null
}
function Ouvrir([string]$url) { try { Start-Process -FilePath 'explorer.exe' -ArgumentList $url } catch { Write-Host ('   Ouvrez : ' + $url) } }
function Executer([string]$f) {
  Write-Host ('   Installation : ' + $f + ' (suivez ses fenêtres)')
  if ($f -match '\.msi$') { $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList ('/i "' + $f + '"') -Wait -PassThru }
  else { $p = Start-Process -FilePath $f -Wait -PassThru }
  return $p.ExitCode
}
# Déjà installé : P = passer (garder la version installée), E = écraser (réinstaller par-dessus) ; pas installé : installer ?
function Choix([string]$nom, [string]$deja, [bool]$proposer) {
  if ($deja) {
    Write-Host ('   ' + $nom + ' est déjà installé : ' + $deja)
    $r = Read-Host '   [P]asser (garder la version installée) ou [E]craser (réinstaller par-dessus) ? [P/e]'
    if ($r -and $r.Trim() -match '^(e|é|ecraser|écraser)$') { return 'ecraser' }
    return 'passer'
  }
  if (Oui ($nom + ' n''est pas installé. L''installer maintenant ?') $proposer) { return 'installer' }
  return 'non'
}
# Programme ouvert à fermer avant de l'écraser
function FermerProg([string]$nom, [string]$motifExe, [string]$pourquoi) {
  $p = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -match $motifExe })
  if (-not $p.Count) { return $true }
  if (-not (Oui ($nom + ' est ouvert : le fermer maintenant ? ' + $pourquoi) $true)) { return $false }
  foreach ($x in $p) { try { $x.CloseMainWindow() | Out-Null } catch { } }
  Start-Sleep -Seconds 3
  foreach ($x in $p) { try { if (-not $x.HasExited) { Stop-Process -Id $x.Id -Force } } catch { } }
  return $true
}
# Installe (ou réinstalle) : programme d'installation trouvé, sinon page officielle ouverte puis nouvelle recherche
function Poser([string]$nom, [string[]]$motifs, [string]$page) {
  $f = Setup $motifs
  if (-not $f) {
    Write-Host ('   Programme d''installation de ' + $nom + ' pas trouvé ici ni dans Téléchargements : page officielle ouverte.')
    Ouvrir $page
    $r = Read-Host '   Téléchargez-le, puis appuyez sur Entrée (P puis Entrée : passer)'
    if ($r -and $r.Trim() -match '^p') { return $false }
    $f = Setup $motifs
  }
  if (-not $f) { Write-Host ('   Toujours rien dans Téléchargements : lancez vous-même le programme d''installation de ' + $nom + ', puis relancez ce programme.'); return $false }
  $c = Executer $f
  Write-Host ('   Programme d''installation terminé (code ' + $c + ').')
  return $true
}

Write-Host 'Remote Station UBA-LGE - installation du PC du club' -ForegroundColor Yellow
$Menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Remote Station'
$Demarrage = [Environment]::GetFolderPath('Startup')
$DemarrageTous = [Environment]::GetFolderPath('CommonStartup')
New-Item -ItemType Directory -Force -Path $Menu | Out-Null
New-Item -ItemType Directory -Force -Path $Kit | Out-Null
# Copie de ce dossier (raccourcis « Retirer… » et LISEZMOI valables après suppression du dossier téléchargé)
foreach ($f in Get-ChildItem -Path $Ici -File) {
  try { Copy-Item -Force $f.FullName (Join-Path $Kit $f.Name) } catch { Write-Host ('   copie impossible : ' + $f.Name + ' (antivirus ?)') }
}

# ---------------------------------------------------------------- 1. VSPE
Titre '1. VSPE (Eterlogic) : partage du port CAT du TRX avec les autres logiciels — solution conseillée'
Write-Host '   La page Station parle directement au TRX : S-mètre, filtres, DSP, menus, spectre, passage en émission rapide.'
function TrouverVspe {
  return (Chercher @((Join-Path $PF 'Eterlogic.com\Virtual Serial Ports Emulator\VSPEmulator.exe'), (Join-Path $PF86 'Eterlogic.com\Virtual Serial Ports Emulator\VSPEmulator.exe')) `
    @((Join-Path $PF 'Eterlogic.com'), (Join-Path $PF86 'Eterlogic.com')) 'VSPEmulator*.exe')
}
$vspe = TrouverVspe
$e = Installe 'Virtual Serial Ports? Emulator|VSPE'
$deja = $null
if ($vspe -or $e) { $deja = $vspe; if ($e) { $deja = $e.DisplayName + ' ' + $e.DisplayVersion } }
$auto = Join-Path $env:ProgramData 'Eterlogic\VSPE\autostart.vspe'
$c = Choix 'VSPE' $deja $true
if ($c -eq 'passer') { Note 'VSPE : déjà installé, gardé tel quel' }
elseif ($c -eq 'non') { Note 'VSPE : pas installé' }
else {
  if ($c -eq 'ecraser') { Write-Host '   VSPE 64 bits : gardez votre clé de licence sous la main, elle peut être redemandée.' }
  # Configuration des ports (chargée au démarrage de Windows) gardée de côté pendant la réinstallation
  $sauve = Join-Path $Dest 'vspe-autostart-sauvegarde.vspe'
  if (Test-Path $auto) { Copy-Item -Force $auto $sauve }
  if (FermerProg 'VSPE' 'VSPEmulator' '(les ports COM virtuels disparaissent jusqu''à sa relance)') {
    if (Poser 'VSPE' @('*VSPE*.msi', '*VSPE*.exe', 'SetupVSPE*') 'https://eterlogic.com/Products.VSPE_Download.html') {
      if ((Test-Path $sauve) -and -not (Test-Path $auto)) { Copy-Item -Force $sauve $auto; Write-Host '   Configuration des ports de VSPE remise en place.' }
      Note ('VSPE : ' + $(if ($c -eq 'ecraser') { 'réinstallé' } else { 'installé' }))
    } else { Note 'VSPE : installation pas faite' }
  } else { Note 'VSPE : gardé (pas fermé)' }
  $vspe = TrouverVspe
}
if ($vspe) {
  Raccourci (Join-Path $Menu 'VSPE (ports COM partagés).lnk') $vspe '' 'VSPE : partage des ports COM des TRX'
  if (Test-Path $auto) { Note 'VSPE : configuration chargée au démarrage de Windows (autostart.vspe présent)' }
  else { Note 'VSPE : PAS de configuration au démarrage — dans VSPE : File, Autostart, « Save as autostart configuration file… »' }
  Write-Host '   Rappels : vitesse du port source = celle du TRX (IC-7300 : 115200) ; un logiciel par port virtuel ;'
  Write-Host '   page Station : choisir le modèle du TRX (pas « DX Commander ») et l''un des ports virtuels de VSPE.'
}

# ---------------------------------------------------------------- 2. DX Commander
Titre '2. DX Commander (DXLab) — fonctionne aussi, avec moins de fonctions sur la page Station'
Write-Host '   Par DX Commander : fréquence, mode, émission et séquences de Commander ; pas de S-mètre, filtres, DSP, menus ni spectre.'
function TrouverCmdr {
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -match 'Commander\.exe$' } | Select-Object -First 1
  if ($p) { return $p.Path }
  return (Chercher @('C:\DXLab\CI-V Commander\CI-V Commander.exe', 'C:\DXLab\Commander\CI-V Commander.exe', (Join-Path $PF86 'DXLab\CI-V Commander\CI-V Commander.exe')) `
    @('C:\DXLab', (Join-Path $PF86 'DXLab'), (Join-Path $PF 'DXLab')) '*Commander*.exe')
}
function TrouverLauncher {
  return (Chercher @('C:\DXLab\Launcher\DXLabLauncher.exe') @('C:\DXLab', (Join-Path $PF86 'DXLab'), (Join-Path $PF 'DXLab')) 'DXLabLauncher*.exe')
}
$cmdr = TrouverCmdr
$c = Choix 'DX Commander' $cmdr $false
if ($c -eq 'passer') { Note 'DX Commander : déjà installé, gardé tel quel' }
elseif ($c -eq 'non') { Note 'DX Commander : pas installé' }
else {
  # Les programmes DXLab s'installent et se mettent à jour par DXLab Launcher
  $lan = TrouverLauncher
  if (-not $lan) {
    Write-Host '   DXLab Launcher pas trouvé : page officielle ouverte. Suivez-la (dossier C:\DXLab\Launcher, archive décompressée, setup.exe).'
    Ouvrir 'https://dxlabsuite.com/Launcher/download.htm'
    $null = Read-Host '   Une fois DXLab Launcher installé, appuyez sur Entrée'
    $lan = TrouverLauncher
  }
  if ($lan) {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $lan + '"') # lancé comme d'habitude (pas en administrateur)
    Write-Host '   Dans DXLab Launcher : Configuration, onglet « DXLab Apps », ligne Commander :' -ForegroundColor Yellow
    if ($c -eq 'ecraser') { Write-Host '   « Upgrade » (nouvelle version) ou « Restore » (réinstaller la même version) ; fermez Commander avant.' -ForegroundColor Yellow }
    else { Write-Host '   « Install » (dossier proposé : C:\DXLab\CI-V Commander).' -ForegroundColor Yellow }
    $null = Read-Host '   Une fois fini, appuyez sur Entrée'
    $cmdr = TrouverCmdr
    if ($cmdr) { Note ('DX Commander : ' + $(if ($c -eq 'ecraser') { 'réinstallé par DXLab Launcher' } else { 'installé' }) + ' (' + $cmdr + ')') } else { Note 'DX Commander : pas trouvé après l''installation' }
  } else { Note 'DX Commander : DXLab Launcher absent, rien installé' }
}
if ($cmdr) {
  Write-Host '   Dans Commander : Configuration, Ports, « TCP Network Service » : « Accept commands » coché (port de base 52000).'
}

# ---------------------------------------------------------------- 3. OmniRig
Titre '3. OmniRig — seulement si un autre logiciel du club en a besoin'
Write-Host '   La page Station n''utilise pas OmniRig. OmniRig et la page Station ne peuvent pas ouvrir le même port COM :'
Write-Host '   avec VSPE, donnez à chacun son port virtuel.'
$omni = Chercher @((Join-Path $PF86 'Afreet\OmniRig\OmniRig.exe'), (Join-Path $PF 'Afreet\OmniRig\OmniRig.exe')) @((Join-Path $PF86 'Afreet'), (Join-Path $PF86 'Omni-Rig V2'), (Join-Path $PF 'Omni-Rig V2')) 'OmniRig*.exe'
$e = Installe 'Omni-?Rig'
$deja = $null
if ($omni -or $e) { $deja = $omni; if ($e) { $deja = $e.DisplayName + ' ' + $e.DisplayVersion } }
$c = Choix 'OmniRig' $deja $false
if ($c -eq 'passer') { Note 'OmniRig : déjà installé, gardé tel quel' }
elseif ($c -eq 'non') { Note 'OmniRig : pas installé' }
else {
  Write-Host '   OmniRig (VE3NEA) : dxatlas.com ; OmniRig v2 (HB9RYZ), pour les logiciels qui le demandent : hb9ryz.ch/omnirig'
  if (FermerProg 'OmniRig' 'OmniRig' '(les logiciels qui l''utilisent perdent le TRX un instant)') {
    if (Poser 'OmniRig' @('OmniRig*.exe', 'OmniRig*.msi', 'Omni-Rig*.exe', 'Omni-Rig*.msi') 'https://www.dxatlas.com/OmniRig/') { Note ('OmniRig : ' + $(if ($c -eq 'ecraser') { 'réinstallé' } else { 'installé' })) }
    else { Note 'OmniRig : installation pas faite' }
  } else { Note 'OmniRig : gardé (pas fermé)' }
}

# ---------------------------------------------------------------- 4. assistant carte son
Titre '4. Assistant carte son du TRX (relance de la carte son, heure de Windows)'
$o = Lancer 'installer-carte-son.ps1'
if ($o -match 'en marche') { Note 'Assistant carte son : en marche' } else { Note 'Assistant carte son : NE RÉPOND PAS (voir le journal C:\ProgramData\RemoteStation\rs-carte-son.log)' }

# ---------------------------------------------------------------- 5. relais DX Commander
Titre '5. Relais DX Commander (seulement pour le modèle « DX Commander » de la page Station)'
$relaisAvant = $null
try { $relaisAvant = Invoke-RestMethod -Uri 'http://127.0.0.1:18098/etat' -TimeoutSec 2 } catch { }
if (Oui 'Installer le relais DX Commander ?' ([bool]$cmdr -or [bool]$relaisAvant)) {
  $o = Lancer 'installer-dxcommander.ps1'
  if ($o -match 'en marche') { Note 'Relais DX Commander : en marche' }
  else {
    Note 'Relais DX Commander : NE RÉPOND PAS — sans doute bloqué par l''antivirus (AVG : « IDP.Generic »)'
    Write-Host '   Dans l''antivirus : exception pour le dossier C:\ProgramData\RemoteStation\ et pour ce dossier-ci,' -ForegroundColor Yellow
    Write-Host '   fichier rs-dxcommander.ps1 à sortir de la quarantaine, puis relancer ce programme.' -ForegroundColor Yellow
  }
} else { Note 'Relais DX Commander : pas installé' }
if ($cmdr) {
  Raccourci (Join-Path $Menu 'DX Commander.lnk') $cmdr '' 'DX Commander (DXLab)'
  $lnk = Join-Path $Demarrage 'DX Commander.lnk'
  if ((Test-Path $lnk) -or (Test-Path (Join-Path $DemarrageTous 'DX Commander.lnk'))) { Note 'DX Commander au démarrage de Windows : déjà en place' }
  elseif (Oui 'Démarrer DX Commander avec Windows (la page Station s''y connecte toute seule) ?' $true) {
    Raccourci $lnk $cmdr '' 'DX Commander (DXLab) au démarrage de Windows'
    Note 'DX Commander au démarrage de Windows : ajouté'
  }
}

# ---------------------------------------------------------------- 6. page Station
Titre '6. Page Station (Chrome)'
$nav = $null
foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe')) {
  try { $v = (Get-ItemProperty -Path $k -ErrorAction Stop).'(default)'; if ($v -and (Test-Path $v)) { $nav = $v; break } } catch { }
}
if (-not $nav) { Note 'Page Station : Chrome / Edge introuvable, raccourci pas créé' }
else {
  $profil = Join-Path $env:LOCALAPPDATA 'RemoteStation\Navigateur'
  New-Item -ItemType Directory -Force -Path $profil | Out-Null
  # Mêmes réglages que l'installateur Windows : profil à part, son sans clic, pas de mise en pause en arrière-plan
  $arg = '--app=' + $Site + '/station --user-data-dir="' + $profil + '" --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --no-first-run --no-default-browser-check'
  $menuLnk = Join-Path $Menu 'Page Station (PC du club).lnk'
  if (-not (Test-Path $menuLnk)) { Raccourci $menuLnk $nav $arg 'Page Station du PC du club (liaison avec le TRX)' 3; Note 'Page Station : raccourci ajouté au menu Démarrer' }
  else { Note 'Page Station : raccourci déjà dans le menu Démarrer' }
  $lnk = Join-Path $Demarrage 'Remote Station - Page Station.lnk'
  if ((Test-Path $lnk) -or (Test-Path (Join-Path $DemarrageTous 'Remote Station - Page Station.lnk'))) { Note 'Page Station au démarrage de Windows : déjà en place' }
  elseif (Oui 'Ouvrir la page Station au démarrage de Windows (la station revient seule après une coupure) ?' $true) {
    Raccourci $lnk $nav $arg 'Page Station au démarrage de Windows' 3
    Note 'Page Station au démarrage de Windows : ajoutée'
  }
}

# ---------------------------------------------------------------- 7. menu Démarrer
Titre '7. Menu Démarrer « Remote Station »'
$np = Join-Path $env:WINDIR 'notepad.exe'
Raccourci (Join-Path $Menu 'Journal de l''assistant carte son.lnk') $np (Join-Path $Dest 'rs-carte-son.log') 'Journal de l''assistant carte son'
Raccourci (Join-Path $Menu 'Journal du relais DX Commander.lnk') $np (Join-Path $Dest 'rs-dxcommander.log') 'Journal du relais DX Commander'
Raccourci (Join-Path $Menu 'Installer le PC du club (tout).lnk') (Join-Path $Kit 'installer-poste-club.cmd') '' 'Réinstaller ou compléter le PC du club'
Raccourci (Join-Path $Menu 'Retirer l''assistant carte son.lnk') (Join-Path $Kit 'retirer-carte-son.cmd') '' 'Retirer l''assistant carte son'
Raccourci (Join-Path $Menu 'Retirer le relais DX Commander.lnk') (Join-Path $Kit 'retirer-dxcommander.cmd') '' 'Retirer le relais DX Commander'
Raccourci (Join-Path $Menu 'Lisez-moi du PC du club.lnk') $np (Join-Path $Kit 'LISEZMOI.txt') 'Lisez-moi'
Note ('Menu Démarrer : ' + $Menu)

Write-Host ''
Write-Host '== Bilan' -ForegroundColor Green
foreach ($b in $Bilan) { Write-Host (' - ' + $b) }
Write-Host ''
Write-Host 'Ensuite : recharger la page Station (Ctrl+F5). Avec VSPE : modèle du TRX et port virtuel ; avec DX Commander :'
Write-Host 'modèle « DX Commander (DXLab) », puis « Se connecter à DX Commander ».'
