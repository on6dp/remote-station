# rs-carte-son.ps1 — assistant « carte son du TRX » de la Remote Station, sur le PC du club.
#
# Chrome ne peut pas redémarrer un périphérique de Windows. Ce petit service le fait à sa place : la page Station
# (https://remote.op0p.be/station) lui demande de redémarrer la carte son USB du TRX quand elle s'est figée en
# silence (barre de niveau vide, plus de BF), au lieu de devoir éteindre et rallumer le TRX.
#
# - Écoute seulement sur http://127.0.0.1:18099 (le PC lui-même ; rien n'est ouvert sur le réseau).
# - N'obéit qu'aux pages des sites listés dans $Origines (Chrome envoie toujours l'adresse du site appelant).
# - Ne sait faire qu'une chose : redémarrer le périphérique USB dont la page donne l'identifiant (VID:PID, ex. 0d8c:0016),
#   comme « Désactiver / Activer » dans le Gestionnaire de périphériques. Le port série (CAT) du TRX n'est pas touché.
# - Version 3 : si Windows a mis la carte son en erreur (« Périphérique USB composite » en Error, partie son absente),
#   un simple redémarrage ne suffit pas : l'assistant la retire et la fait redétecter (pnputil /remove-device puis
#   /scan-devices), comme « Désinstaller » + « Rechercher les modifications sur le matériel ». Il surveille aussi
#   lui-même cette carte son toutes les 20 s, même page Station fermée, et la répare seul (au plus une fois / 5 min).
# - Version 4 : met l'horloge de Windows à l'heure à la milliseconde près, comme NetTime (service Windows Time réglé
#   sur des serveurs NTP publics, interrogés souvent), au démarrage puis toutes les heures, ou à la demande ; écart
#   mesuré avec w32tm.
# - Lancé au démarrage de Windows par la tâche planifiée « RemoteStation carte son » (voir installer-carte-son.cmd).
# - Journal : rs-carte-son.log, à côté de ce fichier.
param(
  [int]$Port = 18099,
  [string[]]$Origines = @('https://remote.op0p.be')
)
$ErrorActionPreference = 'Stop'
$Version = '4'
# Messages de pnputil / powercfg lus dans la page de codes de la console (sinon « redÚmarrage » au lieu de « redémarrage »)
try { [Console]::OutputEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage) } catch { }
$Journal = Join-Path $PSScriptRoot 'rs-carte-son.log'
$FichierId = Join-Path $PSScriptRoot 'rs-carte-son.id'   # VID:PID de la carte son du TRX, donné par la page Station
$Surveille = ''
try { if (Test-Path $FichierId) { $Surveille = (Get-Content $FichierId -TotalCount 1).Trim().ToLower() } } catch { }
if ($Surveille -notmatch '^[0-9a-f]{4}:[0-9a-f]{4}$') { $Surveille = '' }
$Carte = ''
$Reparation = ''
$Mauvais = 0
$DerniereReparation = [datetime]::MinValue

function Ecrire([string]$t) {
  try {
    if ((Test-Path $Journal) -and (Get-Item $Journal).Length -gt 1MB) { Move-Item -Force $Journal ($Journal + '.ancien') }
    Add-Content -Path $Journal -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $t) -Encoding UTF8
  } catch { }
}

function Repondre($ctx, [int]$code, $obj) {
  $req = $ctx.Request
  $res = $ctx.Response
  $o = $req.Headers['Origin']
  if ($o -and ($Origines -contains $o)) {
    $res.AddHeader('Access-Control-Allow-Origin', $o)
    $res.AddHeader('Vary', 'Origin')
    $res.AddHeader('Access-Control-Allow-Methods', 'GET, POST')
    $res.AddHeader('Access-Control-Allow-Headers', 'Content-Type')
    # Chrome : un site internet qui appelle le PC lui-même (127.0.0.1) doit y être autorisé
    $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
  }
  $res.StatusCode = $code
  $b = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $obj -Compress))
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
  $res.Close()
}

function Motif([string]$vid, [string]$prod) { 'USB\VID_' + $vid.ToUpper() + '&PID_' + $prod.ToUpper() + '*' }

# État de la carte son du TRX : ok, erreur (périphérique USB en erreur), son absent (partie son pas démarrée), absente
function EtatCarte([string]$vid, [string]$prod) {
  $motif = Motif $vid $prod
  $tous = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like $motif })
  if ($tous.Count -eq 0) { return 'absente' }
  if (@($tous | Where-Object { $_.Status -eq 'Error' -and $_.InstanceId -notmatch '&MI_' }).Count -gt 0) { return 'erreur' }
  $son = @($tous | Where-Object { $_.Class -eq 'MEDIA' })
  if ($son.Count -eq 0 -or @($son | Where-Object { $_.Status -ne 'OK' }).Count -gt 0) { return 'son absent' }
  return 'ok'
}

# Réparation : retirer le périphérique USB et ses fonctions (même les traces laissées par Windows), puis redétection
function Reparer([string]$vid, [string]$prod) {
  $motif = Motif $vid $prod
  $tous = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like $motif })
  if ($tous.Count -eq 0) { return @{ ok = $false; msg = 'carte son introuvable dans Windows (TRX éteint ou câble USB débranché ?)' } }
  # Fonctions (&MI_) d'abord, le périphérique « parent » ensuite
  $ordre = @($tous | Where-Object { $_.InstanceId -match '&MI_' }) + @($tous | Where-Object { $_.InstanceId -notmatch '&MI_' })
  foreach ($d in $ordre) {
    $o = (& pnputil.exe /remove-device "$($d.InstanceId)" 2>&1 | Out-String).Trim()
    Ecrire "retrait $($d.InstanceId) ($($d.Status)) : $LASTEXITCODE $o"
  }
  Start-Sleep -Seconds 2
  $o = (& pnputil.exe /scan-devices 2>&1 | Out-String).Trim()
  Ecrire "redétection : $LASTEXITCODE $o"
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 2
    if ((EtatCarte $vid $prod) -eq 'ok') { return @{ ok = $true; msg = 'carte son réparée (retirée puis redétectée par Windows)' } }
  }
  $e = EtatCarte $vid $prod
  return @{ ok = $false; msg = "carte son toujours $e après réparation : éteindre le TRX, débrancher son câble USB 15 s, rallumer et rebrancher (sinon autre câble ou autre prise USB du PC)" }
}

function Relancer([string]$vid, [string]$prod) {
  if ($vid -notmatch '^[0-9a-fA-F]{4}$' -or $prod -notmatch '^[0-9a-fA-F]{4}$') {
    return @{ ok = $false; msg = 'identifiant USB invalide' }
  }
  $id = "${vid}:${prod}".ToLower()
  $motif = Motif $vid $prod
  $tous = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like $motif })
  if ($tous.Count -eq 0) { return @{ ok = $false; msg = "aucun périphérique USB $id branché (TRX éteint ou câble USB débranché ?)" } }
  # Carte son mise en erreur par Windows : un redémarrage ne suffit pas, réparation directe
  $avant = EtatCarte $vid $prod
  if ($avant -eq 'erreur' -or $avant -eq 'son absent') {
    $r = Reparer $vid $prod
    $r.msg = "carte son $avant ; " + $r.msg
    $script:Reparation = (Get-Date -Format 'dd/MM HH:mm') + ' ' + $r.msg
    return $r
  }
  # Périphérique USB « parent » (sans &MI_) : le redémarrer relance toutes ses fonctions (son en entrée et en sortie)
  $parents = @($tous | Where-Object { $_.InstanceId -notmatch '&MI_' })
  $cibles = if ($parents.Count -gt 0) { $parents } else { $tous }
  $faits = @()
  foreach ($d in $cibles) {
    $nom = if ($d.FriendlyName) { $d.FriendlyName } else { $d.InstanceId }
    $sortie = (& pnputil.exe /restart-device "$($d.InstanceId)" 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    if ($code -eq 0) {
      $faits += "$nom : redémarré"
    } elseif ($code -eq 3010) {
      $faits += "$nom : Windows demande un redémarrage du PC pour le relancer"
    } else {
      # Windows sans « pnputil /restart-device » (avant Windows 10 version 2004) : désactiver puis réactiver
      try {
        Disable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false
        Start-Sleep -Seconds 2
        Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false
        $faits += "$nom : désactivé puis réactivé"
      } catch {
        # Windows attend un redémarrage du PC (opération précédente sur ce périphérique pas terminée) : seule issue
        if ($sortie -match 'attente de red|pending.*restart|reboot' -or $code -eq 3010) {
          $faits += "$nom : Windows attend un redémarrage du PC du club (une opération précédente sur la carte son n'est pas terminée) — redémarrer le PC"
        } else { $faits += "$nom : échec ($sortie / $($_.Exception.Message))" }
        Ecrire "échec $($d.InstanceId) : $sortie / $($_.Exception.Message)"
        return @{ ok = $false; msg = ($faits -join ' ; ') }
      }
    }
  }
  # Redémarrage fait : la partie son doit revenir ; sinon (Windows l'a mise en erreur) réparation
  for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Seconds 2
    if ((EtatCarte $vid $prod) -eq 'ok') { return @{ ok = $true; msg = ($faits -join ' ; ') } }
  }
  $r = Reparer $vid $prod
  $r.msg = ($faits -join ' ; ') + ' ; carte son pas revenue : ' + $r.msg
  $script:Reparation = (Get-Date -Format 'dd/MM HH:mm') + ' ' + $r.msg
  return $r
}

# Surveillance (toutes les 20 s) de la carte son du TRX : en erreur deux fois de suite → réparation, au plus une fois / 5 min.
# Carte son « absente » (TRX éteint, câble débranché) : rien à faire.
function Surveiller {
  if (-not $script:Surveille) { return }
  $v = $script:Surveille.Substring(0, 4); $p = $script:Surveille.Substring(5, 4)
  $e = EtatCarte $v $p
  $script:Carte = $e
  if ($e -eq 'erreur' -or $e -eq 'son absent') { $script:Mauvais++ } else { $script:Mauvais = 0 }
  if ($script:Mauvais -ge 2 -and ((Get-Date) - $script:DerniereReparation).TotalMinutes -ge 5) {
    $script:DerniereReparation = Get-Date
    $r = Reparer $v $p
    $script:Reparation = (Get-Date -Format 'dd/MM HH:mm') + " carte son $e ; " + $r.msg
    Ecrire "surveillance : carte son $($script:Surveille) $e → $($r.msg)"
    $script:Carte = EtatCarte $v $p
    $script:Mauvais = 0
  }
}
function Retenir([string]$vid, [string]$prod) {
  $id = "${vid}:${prod}".ToLower()
  if ($id -notmatch '^[0-9a-f]{4}:[0-9a-f]{4}$' -or $id -eq $script:Surveille) { return }
  $script:Surveille = $id
  $script:Mauvais = 0
  try { Set-Content -Path $FichierId -Value $id -Encoding ASCII } catch { }
  Ecrire "carte son du TRX surveillée : $id"
}

# Mise en veille USB coupée (cause fréquente d'une carte son figée en silence) : au démarrage, à chaque fois
#  - « Suspension sélective USB » désactivée dans le mode d'alimentation actif (secteur et batterie) ;
#  - « Autoriser l'ordinateur à éteindre ce périphérique » décoché pour les concentrateurs USB et les cartes son USB.
$Veille = 'non vérifiée'
function CouperVeilleUsb {
  $faits = @()
  try {
    $usb = '2a737441-1930-4402-8d77-b2bebba308a3'; $sel = '48e6b7a6-50f5-4782-a5d4-53bb8f07e226'
    & powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT $usb $sel 0 | Out-Null
    & powercfg.exe /SETDCVALUEINDEX SCHEME_CURRENT $usb $sel 0 | Out-Null
    & powercfg.exe /SETACTIVE SCHEME_CURRENT | Out-Null
    $faits += 'suspension sélective USB désactivée'
  } catch { Ecrire "powercfg : $($_.Exception.Message)" }
  try {
    $cibles = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB\ROOT_HUB*' -or $_.InstanceId -like 'USB\VID_*' -and ($_.Class -eq 'USB' -or $_.Class -eq 'MEDIA') })
    $n = 0
    foreach ($p in @(Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction Stop)) {
      foreach ($d in $cibles) {
        if ($p.InstanceName -like ($d.InstanceId + '*') -and $p.Enable) {
          Set-CimInstance -InputObject $p -Property @{ Enable = $false } -ErrorAction SilentlyContinue
          $n++
        }
      }
    }
    $faits += "économie d'énergie coupée sur $n périphérique(s) USB"
  } catch { Ecrire "économie d'énergie USB : $($_.Exception.Message)" }
  $script:Veille = if ($faits.Count) { $faits -join ', ' } else { 'échec (voir le journal)' }
  Ecrire "veille USB : $script:Veille"
}
CouperVeilleUsb

# ------------------------------------------------------------------ heure de Windows (comme NetTime)
$NtpServeurs = 'be.pool.ntp.org,0x8 0.europe.pool.ntp.org,0x8 time.cloudflare.com,0x8'
$Heure = @{ ecart = $null; quand = ''; msg = 'pas encore mesurée' }
$DerniereHeure = [datetime]::MinValue
# Écart de l'horloge de ce PC avec un serveur NTP (ms ; positif : ce PC est en retard), médiane de 3 mesures
function MesurerHeure {
  $o = (& w32tm.exe /stripchart /computer:be.pool.ntp.org /dataonly /samples:3 2>&1 | Out-String)
  $v = @()
  # Windows en français : virgule décimale possible
  foreach ($m in [regex]::Matches($o, '([+-]\d+[.,]\d+)s')) { $v += [double]($m.Groups[1].Value -replace ',', '.') }
  if ($v.Count -eq 0) { return $null }
  $v = @($v | Sort-Object)
  return [math]::Round($v[[int][math]::Floor($v.Count / 2)] * 1000, 1)
}
function ReglerHeure([bool]$config) {
  try {
    if ($config) {
      Set-Service -Name w32time -StartupType Automatic -ErrorAction SilentlyContinue
      if ((Get-Service w32time).Status -ne 'Running') { Start-Service w32time }
      # Interrogation fréquente (64 s à 256 s) au lieu d'une fois par semaine par défaut
      $cfg = 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\Config'
      Set-ItemProperty -Path $cfg -Name MinPollInterval -Value 6 -Type DWord -ErrorAction SilentlyContinue
      Set-ItemProperty -Path $cfg -Name MaxPollInterval -Value 8 -Type DWord -ErrorAction SilentlyContinue
      Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpClient' -Name SpecialPollInterval -Value 256 -Type DWord -ErrorAction SilentlyContinue
      & w32tm.exe /config /manualpeerlist:"$NtpServeurs" /syncfromflags:manual /update 2>&1 | Out-Null
    }
    $avant = MesurerHeure
    & w32tm.exe /resync /force 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    $apres = MesurerHeure
    $script:DerniereHeure = Get-Date
    $script:Heure = @{ ecart = $apres; quand = (Get-Date -Format 'dd/MM HH:mm'); msg = 'avant ' + $(if ($avant -ne $null) { "$avant ms" } else { '?' }) + ', après ' + $(if ($apres -ne $null) { "$apres ms" } else { '?' }) }
    Ecrire "heure : $($script:Heure.msg)"
    return @{ ok = ($apres -ne $null); avant = $avant; apres = $apres; msg = 'horloge du PC du club : écart ' + $script:Heure.msg + ' (serveurs ' + ($NtpServeurs -replace ',0x8', '') + ')' }
  } catch {
    Ecrire "heure : $($_.Exception.Message)"
    return @{ ok = $false; msg = 'mise à l''heure impossible : ' + $_.Exception.Message }
  }
}
try { ReglerHeure $true | Out-Null } catch { }

$ecoute = New-Object System.Net.HttpListener
$ecoute.Prefixes.Add("http://127.0.0.1:$Port/")
try { $ecoute.Start() } catch { Ecrire "impossible d'écouter sur le port $Port : $($_.Exception.Message)"; exit 1 }
Ecrire "démarré (version $Version, port $Port, sites autorisés : $($Origines -join ', '))"

while ($ecoute.IsListening) {
  # Attente d'une demande de la page Station, avec un tour de surveillance de la carte son toutes les 20 s
  $att = $ecoute.BeginGetContext($null, $null)
  while (-not $att.AsyncWaitHandle.WaitOne(20000)) {
    try { Surveiller } catch { Ecrire "surveillance : $($_.Exception.Message)" }
    if (((Get-Date) - $DerniereHeure).TotalMinutes -ge 60) { try { ReglerHeure $false | Out-Null } catch { } }
  }
  $ctx = $ecoute.EndGetContext($att)
  try {
    $req = $ctx.Request
    $o = $req.Headers['Origin']
    $chemin = $req.Url.AbsolutePath.ToLower()
    if ($req.HttpMethod -eq 'OPTIONS') {
      Repondre $ctx 200 @{ ok = $true }
    } elseif ($o -and -not ($Origines -contains $o)) {
      Ecrire "refusé : $($req.HttpMethod) $chemin depuis $o"
      Repondre $ctx 403 @{ ok = $false; msg = 'site non autorisé' }
    } elseif ($chemin -eq '/etat') {
      if ($Surveille) { try { $script:Carte = EtatCarte $Surveille.Substring(0, 4) $Surveille.Substring(5, 4) } catch { } }
      Repondre $ctx 200 @{ ok = $true; version = $Version; veille = $Veille; surveille = $Surveille; carte = $Carte; reparation = $Reparation; heure = $Heure }
    } elseif ($chemin -eq '/heure' -and $req.HttpMethod -eq 'POST' -and $o) {
      Repondre $ctx 200 (ReglerHeure $true)
    } elseif ($chemin -eq '/surveiller' -and $req.HttpMethod -eq 'POST' -and $o) {
      $lu = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $q = $null
      try { $q = $lu.ReadToEnd() | ConvertFrom-Json } catch { }
      $lu.Close()
      if ($q -and ([string]$q.vid) -match '^[0-9a-fA-F]{4}$' -and ([string]$q.pid) -match '^[0-9a-fA-F]{4}$') {
        Retenir ([string]$q.vid) ([string]$q.pid)
        Repondre $ctx 200 @{ ok = $true; surveille = $Surveille }
      } else { Repondre $ctx 400 @{ ok = $false; msg = 'identifiant USB invalide' } }
    } elseif ($chemin -eq '/relancer' -and $req.HttpMethod -eq 'POST' -and $o) {
      $lu = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $corps = $lu.ReadToEnd()
      $lu.Close()
      $q = $null
      try { $q = $corps | ConvertFrom-Json } catch { }
      if (-not $q) { Repondre $ctx 400 @{ ok = $false; msg = 'demande illisible' } }
      else {
        if (([string]$q.vid) -match '^[0-9a-fA-F]{4}$' -and ([string]$q.pid) -match '^[0-9a-fA-F]{4}$') { Retenir ([string]$q.vid) ([string]$q.pid) }
        $r = Relancer ([string]$q.vid) ([string]$q.pid)
        Ecrire ("relance demandée par " + ([string]$q.by) + " (" + ([string]$q.vid) + ":" + ([string]$q.pid) + ") : " + $r.msg)
        Repondre $ctx 200 $r
      }
    } else {
      Repondre $ctx 404 @{ ok = $false; msg = 'inconnu' }
    }
  } catch {
    Ecrire "erreur : $($_.Exception.Message)"
    try { Repondre $ctx 500 @{ ok = $false; msg = $_.Exception.Message } } catch { }
  }
}
