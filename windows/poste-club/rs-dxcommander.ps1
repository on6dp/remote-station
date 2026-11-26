# rs-dxcommander.ps1 — relais « DX Commander » de la Remote Station, sur le PC du club.
#
# Pour le modèle « DX Commander (DXLab) » de la page Station : Commander pilote le TRX et le partage avec les autres
# logiciels du PC. Chrome ne peut pas ouvrir de liaison TCP : ce petit programme le fait à sa place.
# - Écoute seulement sur http://127.0.0.1:18098 (le PC lui-même ; rien n'est ouvert sur le réseau).
# - N'obéit qu'aux pages des sites listés dans $Origines (Chrome envoie toujours l'adresse du site appelant).
# - Passe à Commander, sur ce PC (127.0.0.1, port 52002 par défaut : « TCP Network Service » de Commander), une courte
#   liste de ses messages (lectures, fréquence, mode, PTT, séquences de commandes n° 1 à 32 ; pas de SPLIT).
# - Version 2 : le relais lit Commander de son côté, en continu (une question à la fois, réponse attendue 0,6 s au plus),
#   et répond aux lectures de la page tout de suite avec la dernière réponse ; les commandes (émission, fréquence, mode,
#   séquence) partent à Commander dès leur arrivée, sans attendre derrière les lectures. Une lecture à laquelle Commander
#   ne répond pas (selon le TRX) n'est plus demandée pendant 1 min.
# - Sécurité : TRX passé en émission par la page (CmdTX) puis plus de nouvelles d'elle pendant 3 s (page fermée,
#   Chrome planté…) → CmdRX envoyé par le relais lui-même.
# - À part de l'assistant « carte son » (rs-carte-son.ps1) : si un antivirus bloque ce relais, la relance de la carte son
#   et la mise à l'heure du PC continuent de marcher.
# - Lancé au démarrage de Windows par la tâche planifiée « RemoteStation DX Commander » (voir installer-poste-club.cmd).
# - Journal : rs-dxcommander.log, à côté de ce fichier.
param(
  [int]$Port = 18098,
  [string[]]$Origines = @('https://remote.op0p.be')
)
$ErrorActionPreference = 'Stop'
$Version = '2'
$Journal = Join-Path $PSScriptRoot 'rs-dxcommander.log'
# Priorité au-dessus de la normale : l'ordre d'émission ne doit pas attendre derrière le décodage ou l'antivirus
try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = [System.Diagnostics.ProcessPriorityClass]::AboveNormal } catch { }

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
    $res.AddHeader('Access-Control-Allow-Private-Network', 'true')
    $res.AddHeader('Access-Control-Max-Age', '600') # autorisation gardée 10 min par Chrome : pas de demande préalable à chaque envoi
  }
  $res.StatusCode = $code
  $b = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $obj -Compress))
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
  $res.Close()
}

# Horloge en millisecondes (Stopwatch : pas de retour à zéro au bout de 25 jours comme TickCount)
$Horloge = [Diagnostics.Stopwatch]::StartNew()
function Ms { return $Horloge.ElapsedMilliseconds }

$Liaison = $null      # liaison avec Commander
$PortCmdr = 52002
$EnEmission = $false  # CmdTX envoyé par la page, pas encore CmdRX
$Vu = Get-Date        # dernière demande de la page (sécurité d'émission)
$VuMs = [long]-100000 # idem, en ms (lectures de fond seulement quand la page est là)
$Tampon = New-Object byte[] 4096
$Recu = ''            # reçu de Commander, pas encore découpé
# Lectures : nom du message → nom de la réponse de Commander
$Reponse = @{ 'CmdGetFreq' = 'CmdFreq'; 'CmdSendFreq' = 'CmdFreq'; 'CmdGetTXFreq' = 'CmdTXFreq'; 'CmdSendTXFreq' = 'CmdTXFreq';
  'CmdSendMode' = 'CmdMode'; 'CmdSendSplit' = 'CmdSplit'; 'CmdSendTx' = 'CmdTX' }
$Lectures = @('CmdGetFreq', 'CmdSendMode', 'CmdSendTx', 'CmdSendSplit', 'CmdGetTXFreq') # lues en fond, si la page les demande
$Lentes = @('CmdSendSplit', 'CmdGetTXFreq')                                          # relues toutes les 2 s seulement
$Commandes = @('CmdSetFreq', 'CmdSetMode', 'CmdTX', 'CmdRX', 'seqindex')
$Cache = @{}          # nom de la réponse → @{ v = réponse ; at = ms }
$Perime = @{}         # nom de la réponse → ms de la dernière commande qui la change (réponse plus ancienne : oubliée)
$Demande = @{}        # lecture → ms de la dernière demande de la page
$Muet = @{}           # lecture → @{ n = sans réponse de suite ; jusqua = ms }
$Attente = $null      # question en cours : @{ q ; tag ; at ; direct }
$Direct = ''          # réponse à une lecture faite tout de suite (CmdSendFreq, à la connexion de la page)
$Dernier = [long]0    # ms de la dernière question
$Rtt = 0              # temps de réponse moyen de Commander (ms)

function Fermer {
  try { if ($script:Liaison) { $script:Liaison.Close() } } catch { }
  $script:Liaison = $null
  $script:Attente = $null
  $script:Recu = ''
  $script:Cache = @{}
}
function Joindre([int]$p) {
  if ($script:Liaison -and $p -eq $script:PortCmdr) { return $true }
  Fermer
  $script:PortCmdr = $p
  $l = New-Object System.Net.Sockets.Socket([System.Net.Sockets.AddressFamily]::InterNetwork, [System.Net.Sockets.SocketType]::Stream, [System.Net.Sockets.ProtocolType]::Tcp)
  $a = $l.BeginConnect('127.0.0.1', $p, $null, $null)
  if (-not $a.AsyncWaitHandle.WaitOne(1500)) { try { $l.Close() } catch { }; return $false }
  try { $l.EndConnect($a) } catch { try { $l.Close() } catch { }; return $false }
  $l.NoDelay = $true
  $script:Liaison = $l
  $script:Muet = @{}
  Ecrire "DX Commander joint sur le port $p"
  return $true
}
function Envoyer([string]$m) {
  $null = $script:Liaison.Send([Text.Encoding]::ASCII.GetBytes($m))
}
# Une réponse complète de Commander : rangée (ou donnée à la lecture faite tout de suite)
function Classer([string]$tag, [string]$rep) {
  $now = Ms
  $a = $script:Attente
  $envoi = $now
  if ($a -and $a.tag -eq $tag) {
    $envoi = $a.at
    $script:Attente = $null
    $script:Rtt = [int](($script:Rtt * 7 + ($now - $a.at)) / 8)
    if ($script:Muet.ContainsKey($a.q)) { $script:Muet.Remove($a.q) }
    if ($a.direct) { $script:Direct = $rep; return }
  }
  # Réponse à une question posée avant une commande qui change cette valeur : périmée
  if ($script:Perime.ContainsKey($tag) -and $envoi -lt $script:Perime[$tag]) { return }
  $script:Cache[$tag] = @{ v = $rep; at = $now }
}
# Lit ce que Commander a envoyé, sans attendre, et le découpe en réponses <Nom:longueur>valeur
function Recevoir {
  $l = $script:Liaison
  if (-not $l) { return }
  try {
    while ($l.Poll(0, [System.Net.Sockets.SelectMode]::SelectRead)) {
      if ($l.Available -eq 0) { throw 'liaison fermée par DX Commander' }
      $n = $l.Receive($script:Tampon)
      $script:Recu += [Text.Encoding]::Default.GetString($script:Tampon, 0, $n)
    }
  } catch {
    Ecrire ('liaison avec DX Commander perdue : ' + $_.Exception.Message)
    Fermer
    return
  }
  if ($script:Recu.Length -gt 65536) { $script:Recu = '' }
  while ($script:Recu.Length) {
    $i = $script:Recu.IndexOf('<')
    if ($i -lt 0) { $script:Recu = ''; break }
    if ($i -gt 0) { $script:Recu = $script:Recu.Substring($i) }
    $m = [regex]::Match($script:Recu, '^<(\w+):(\d+)>')
    if (-not $m.Success) {
      if ($script:Recu -match '^<\w*(:\d*)?$' -and $script:Recu.Length -lt 40) { break } # début de réponse : la suite arrive
      $script:Recu = $script:Recu.Substring(1)
      continue
    }
    $besoin = $m.Length + [int]$m.Groups[2].Value
    if ($script:Recu.Length -lt $besoin) { break }
    $rep = $script:Recu.Substring(0, $besoin)
    $script:Recu = $script:Recu.Substring($besoin)
    Classer $m.Groups[1].Value $rep
  }
}
# Lectures de fond : la plus ancienne des lectures que la page demande, une à la fois
function Sonder {
  if (-not $script:Liaison) { return }
  Recevoir
  if (-not $script:Liaison) { return }
  $now = Ms
  $a = $script:Attente
  if ($a) {
    if ($now - $a.at -lt 600) { return }
    # Pas de réponse : 3 fois de suite → lecture plus demandée pendant 1 min (Commander ne la prend pas en charge pour ce TRX)
    $script:Attente = $null
    if (-not $a.direct) {
      $mu = $script:Muet[$a.q]
      if (-not $mu) { $mu = @{ n = 0; jusqua = [long]0 }; $script:Muet[$a.q] = $mu }
      $mu.n++
      if ($mu.n -ge 3) { $mu.n = 0; $mu.jusqua = $now + 60000; Ecrire ('DX Commander ne répond pas à ' + $a.q + ' : plus demandé pendant 1 min') }
    }
  }
  if ($now - $script:Dernier -lt 30) { return }
  if ($now - $script:VuMs -gt 10000) { return } # page Station absente : Commander laissé tranquille
  $choix = $null
  $vieux = [long]-1
  foreach ($q in $script:Lectures) {
    if (-not $script:Demande.ContainsKey($q) -or $now - $script:Demande[$q] -gt 10000) { continue }
    $mu = $script:Muet[$q]
    if ($mu -and $mu.jusqua -gt $now) { continue }
    $tag = $script:Reponse[$q]
    $c = $script:Cache[$tag]
    $age = [long]1000000000
    if ($c -and -not ($script:Perime.ContainsKey($tag) -and $script:Perime[$tag] -gt $c.at)) { $age = $now - $c.at }
    $min = 250
    if ($script:Lentes -contains $q) { $min = 2000 }
    if ($age -lt $min) { continue }
    if ($age -gt $vieux) { $choix = $q; $vieux = $age }
  }
  if (-not $choix) { return }
  try { Envoyer ('<command:' + $choix.Length + '>' + $choix + '<parameters:0>') } catch { Ecrire ('envoi à DX Commander impossible : ' + $_.Exception.Message); Fermer; return }
  $script:Attente = @{ q = $choix; tag = $script:Reponse[$choix]; at = $now; direct = $false }
  $script:Dernier = $now
}
# Lecture faite tout de suite (CmdSendFreq : fréquence écrite à la façon de Windows, séparateur décimal de Commander)
function LireDirect([string]$m, [string]$q) {
  $t0 = Ms
  while ($script:Attente -and $script:Liaison -and (Ms) - $t0 -lt 700) { Start-Sleep -Milliseconds 10; Recevoir }
  if (-not $script:Liaison) { return '' }
  $script:Direct = ''
  Envoyer $m
  $script:Attente = @{ q = $q; tag = $script:Reponse[$q]; at = (Ms); direct = $true }
  $t0 = Ms
  while ($script:Attente -and $script:Liaison -and (Ms) - $t0 -lt 800) { Start-Sleep -Milliseconds 10; Recevoir }
  $script:Attente = $null
  return $script:Direct
}
# Sécurité : émission demandée par la page, puis plus de nouvelles d'elle depuis 3 s → retour en réception
function Veiller {
  if ($script:EnEmission -and ((Get-Date) - $script:Vu).TotalSeconds -ge 3) {
    $script:EnEmission = $false
    Ecrire 'plus de nouvelles de la page Station pendant une émission : CmdRX envoyé à Commander'
    try { if (Joindre $script:PortCmdr) { Envoyer '<command:5>CmdRX<parameters:0>' } } catch { Fermer }
  }
}
# Message de la page accepté ? (liste courte ; séquence : n° 0 à 31 seulement)
function Permis([string]$l) {
  if ($l.Length -gt 200) { return $null }
  $m = [regex]::Match($l, '^<command:\d+>(\w+)<parameters:\d+>(.*)$')
  if (-not $m.Success) { return $null }
  $nom = $m.Groups[1].Value
  if ($nom -ceq 'seqindex') {
    $p = [regex]::Match($m.Groups[2].Value, '^<1:[12]>(\d{1,2})$')
    if (-not $p.Success -or [int]$p.Groups[1].Value -gt 31) { return $null }
    return $nom
  }
  if ($script:Reponse.ContainsKey($nom) -or ($script:Commandes -contains $nom)) { return $nom }
  return $null
}

$ecoute = New-Object System.Net.HttpListener
$ecoute.Prefixes.Add("http://127.0.0.1:$Port/")
try { $ecoute.Start() } catch { Ecrire "impossible d'écouter sur le port $Port : $($_.Exception.Message)"; exit 1 }
Ecrire "démarré (version $Version, port $Port, sites autorisés : $($Origines -join ', '))"

while ($ecoute.IsListening) {
  $att = $ecoute.BeginGetContext($null, $null)
  while (-not $att.AsyncWaitHandle.WaitOne(15)) { Veiller; Sonder }
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
      $mu = @($Muet.Keys | Where-Object { $Muet[$_].jusqua -gt (Ms) })
      Repondre $ctx 200 @{ ok = $true; version = $Version; joint = [bool]$Liaison; port = $PortCmdr; rtt = $Rtt; muets = $mu }
    } elseif ($chemin -eq '/dxc/hello' -and $o) {
      $p = 52002
      try { $p = [int]$req.QueryString['port'] } catch { }
      if ($p -lt 1 -or $p -gt 65535) { $p = 52002 }
      $ok = $false
      try { $ok = Joindre $p } catch { $ok = $false }
      $dec = [Globalization.CultureInfo]::CurrentCulture.NumberFormat.NumberDecimalSeparator
      $txt = 'DX Commander joint'
      if (-not $ok) { $txt = "DX Commander ne répond pas sur le port $p de ce PC : lancé ? Configuration, Ports, TCP Network Service : « Accept commands » coché (port de base 52000, commandes sur 52002)" }
      Repondre $ctx 200 @{ ok = $ok; version = $Version; dec = $dec; port = $p; msg = $txt }
    } elseif ($chemin -eq '/dxc' -and $req.HttpMethod -eq 'POST' -and $o) {
      $lu = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $corps = $lu.ReadToEnd()
      $lu.Close()
      $script:Vu = Get-Date
      $script:VuMs = Ms
      $lignes = @($corps -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
      $mal = $null
      $noms = @()
      foreach ($l in $lignes) { $n = Permis $l; if (-not $n) { $mal = $l; break }; $noms += $n }
      if ($lignes.Count -gt 20) {
        Repondre $ctx 400 @{ ok = $false; msg = 'trop de messages' }
      } elseif ($mal) {
        Ecrire ('message refusé : ' + $mal.Substring(0, [Math]::Min(40, $mal.Length)))
        Repondre $ctx 400 @{ ok = $false; msg = 'message refusé par le relais' }
      } elseif (-not (Joindre $script:PortCmdr)) {
        Repondre $ctx 200 @{ ok = $false; msg = "DX Commander ne répond pas sur le port $($script:PortCmdr)" }
      } else {
        Recevoir
        $rep = @()
        $err = $null
        for ($i = 0; $i -lt $lignes.Count -and -not $err; $i++) {
          $l = $lignes[$i]
          $nom = $noms[$i]
          try {
            if (-not $script:Liaison) { throw 'liaison fermée par DX Commander' }
            if ($Reponse.ContainsKey($nom)) {
              # Lecture : dernière réponse de Commander (2 s au plus), sinon rien cette fois-ci
              $script:Demande[$nom] = Ms
              if ($nom -eq 'CmdSendFreq' -or $nom -eq 'CmdSendTXFreq') { $rep += (LireDirect $l $nom); continue }
              $tag = $Reponse[$nom]
              $c = $script:Cache[$tag]
              if ($c -and (Ms) - $c.at -lt 2000 -and -not ($script:Perime.ContainsKey($tag) -and $script:Perime[$tag] -gt $c.at)) { $rep += $c.v } else { $rep += '' }
            } else {
              # Commande : envoyée tout de suite ; les valeurs qu'elle change sont relues avant d'être rendues à la page
              Envoyer $l
              $now = Ms
              if ($nom -eq 'CmdTX') { $script:EnEmission = $true; $script:Perime['CmdTX'] = $now }
              elseif ($nom -eq 'CmdRX') { $script:EnEmission = $false; $script:Perime['CmdTX'] = $now }
              elseif ($nom -eq 'CmdSetFreq') { $script:Perime['CmdFreq'] = $now; $script:Perime['CmdTXFreq'] = $now }
              elseif ($nom -eq 'CmdSetMode') { $script:Perime['CmdMode'] = $now }
              else { foreach ($t in @('CmdFreq', 'CmdTXFreq', 'CmdMode', 'CmdSplit', 'CmdTX')) { $script:Perime[$t] = $now } } # séquence : tout peut changer
              $rep += ''
            }
          } catch { $err = $_.Exception.Message; Fermer }
        }
        if ($err) { Repondre $ctx 200 @{ ok = $false; msg = "liaison avec DX Commander coupée : $err" } }
        else { Repondre $ctx 200 @{ ok = $true; r = $rep } }
      }
    } else {
      Repondre $ctx 404 @{ ok = $false; msg = 'inconnu' }
    }
  } catch {
    Ecrire "erreur : $($_.Exception.Message)"
    try { Repondre $ctx 500 @{ ok = $false; msg = $_.Exception.Message } } catch { }
  }
  Veiller
  Sonder
}
