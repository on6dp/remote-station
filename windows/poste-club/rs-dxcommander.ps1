# rs-dxcommander.ps1 — relais « DX Commander » de la Remote Station, sur le PC du club.
#
# Pour le modèle « DX Commander (DXLab) » de la page Station : Commander pilote le TRX et le partage avec les autres
# logiciels du PC. Chrome ne peut pas ouvrir de liaison TCP : ce petit programme le fait à sa place.
# - Écoute seulement sur http://127.0.0.1:18098 (le PC lui-même ; rien n'est ouvert sur le réseau).
# - N'obéit qu'aux pages des sites listés dans $Origines (Chrome envoie toujours l'adresse du site appelant).
# - Passe à Commander, sur ce PC (127.0.0.1, port 52002 par défaut : « TCP Network Service » de Commander), une courte
#   liste de ses messages (lectures, fréquence, mode, PTT ; pas de SPLIT) et rend ses réponses à la page.
# - Sécurité : TRX passé en émission par la page (CmdTX) puis plus de nouvelles d'elle pendant 3 s (page fermée,
#   Chrome planté…) → CmdRX envoyé par le relais lui-même.
# - À part de l'assistant « carte son » (rs-carte-son.ps1) : si un antivirus bloque ce relais, la relance de la carte son
#   et la mise à l'heure du PC continuent de marcher.
# - Lancé au démarrage de Windows par la tâche planifiée « RemoteStation DX Commander » (voir installer-dxcommander.cmd).
# - Journal : rs-dxcommander.log, à côté de ce fichier.
param(
  [int]$Port = 18098,
  [string[]]$Origines = @('https://remote.op0p.be')
)
$ErrorActionPreference = 'Stop'
$Version = '1'
$Journal = Join-Path $PSScriptRoot 'rs-dxcommander.log'

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
  }
  $res.StatusCode = $code
  $b = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $obj -Compress))
  $res.ContentType = 'application/json; charset=utf-8'
  $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
  $res.Close()
}

$Liaison = $null      # liaison avec Commander
$PortCmdr = 52002
$EnEmission = $false  # CmdTX envoyé par la page, pas encore CmdRX
$Vu = Get-Date        # dernière demande de la page
$Permis = @('CmdGetFreq', 'CmdGetTXFreq', 'CmdSendFreq', 'CmdSendMode', 'CmdSendSplit', 'CmdSendTx', 'CmdSetFreq', 'CmdSetMode', 'CmdTX', 'CmdRX')

function Fermer { try { if ($script:Liaison) { $script:Liaison.Close() } } catch { }; $script:Liaison = $null }
function Joindre([int]$p) {
  if ($script:Liaison -and $script:Liaison.Connected -and $p -eq $script:PortCmdr) { return $true }
  Fermer
  $script:PortCmdr = $p
  $l = New-Object System.Net.Sockets.Socket([System.Net.Sockets.AddressFamily]::InterNetwork, [System.Net.Sockets.SocketType]::Stream, [System.Net.Sockets.ProtocolType]::Tcp)
  $a = $l.BeginConnect('127.0.0.1', $p, $null, $null)
  if (-not $a.AsyncWaitHandle.WaitOne(1500)) { try { $l.Close() } catch { }; return $false }
  try { $l.EndConnect($a) } catch { try { $l.Close() } catch { }; return $false }
  $l.NoDelay = $true
  $script:Liaison = $l
  Ecrire "DX Commander joint sur le port $p"
  return $true
}
# Un message à Commander ; sa réponse pour les lectures (CmdGet…, CmdSend…) : <CmdXxx:n>valeur, 0,8 s au plus
function Echanger([string]$m) {
  $l = $script:Liaison
  $tampon = New-Object byte[] 4096
  while ($l.Available -gt 0) { $null = $l.Receive($tampon) } # reste d'une réponse précédente
  $null = $l.Send([Text.Encoding]::ASCII.GetBytes($m))
  if ($m -match '^<command:\d+>CmdTX<') { $script:EnEmission = $true }
  if ($m -match '^<command:\d+>CmdRX<') { $script:EnEmission = $false }
  if ($m -notmatch '^<command:\d+>Cmd(Get|Send)') { return '' }
  $t0 = [Environment]::TickCount
  $txt = ''
  while ([Environment]::TickCount - $t0 -lt 800) {
    if ($l.Poll(20000, [System.Net.Sockets.SelectMode]::SelectRead)) {
      if ($l.Available -eq 0) { throw 'liaison fermée par Commander' }
      $n = $l.Receive($tampon)
      $txt += [Text.Encoding]::Default.GetString($tampon, 0, $n)
      if ($txt -match '^<(\w+):(\d+)>') {
        $besoin = $Matches[0].Length + [int]$Matches[2]
        if ($txt.Length -ge $besoin) { return $txt.Substring(0, $besoin) }
      }
    }
  }
  return $txt
}
# Sécurité : émission demandée par la page, puis plus de nouvelles d'elle depuis 3 s → retour en réception
function Veiller {
  if ($script:EnEmission -and ((Get-Date) - $script:Vu).TotalSeconds -ge 3) {
    $script:EnEmission = $false
    Ecrire 'plus de nouvelles de la page Station pendant une émission : CmdRX envoyé à Commander'
    try { if (Joindre $script:PortCmdr) { Echanger '<command:5>CmdRX<parameters:0>' | Out-Null } } catch { Fermer }
  }
}

$ecoute = New-Object System.Net.HttpListener
$ecoute.Prefixes.Add("http://127.0.0.1:$Port/")
try { $ecoute.Start() } catch { Ecrire "impossible d'écouter sur le port $Port : $($_.Exception.Message)"; exit 1 }
Ecrire "démarré (version $Version, port $Port, sites autorisés : $($Origines -join ', '))"

while ($ecoute.IsListening) {
  $att = $ecoute.BeginGetContext($null, $null)
  while (-not $att.AsyncWaitHandle.WaitOne(500)) { Veiller }
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
      Repondre $ctx 200 @{ ok = $true; version = $Version; joint = [bool]($Liaison -and $Liaison.Connected); port = $PortCmdr }
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
      $lignes = @($corps -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
      $mal = $null
      foreach ($l in $lignes) {
        if (-not ($l -match '^<command:\d+>(Cmd\w+)<parameters:\d+>' -and ($Permis -contains $Matches[1]))) { $mal = $l; break }
      }
      if ($lignes.Count -gt 20) {
        Repondre $ctx 400 @{ ok = $false; msg = 'trop de messages' }
      } elseif ($mal) {
        Ecrire ('message refusé : ' + $mal.Substring(0, [Math]::Min(40, $mal.Length)))
        Repondre $ctx 400 @{ ok = $false; msg = 'message refusé par le relais' }
      } elseif (-not (Joindre $script:PortCmdr)) {
        Repondre $ctx 200 @{ ok = $false; msg = "DX Commander ne répond pas sur le port $($script:PortCmdr)" }
      } else {
        $rep = @()
        $err = $null
        foreach ($l in $lignes) { try { $rep += (Echanger $l) } catch { $err = $_.Exception.Message; Fermer; break } }
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
}
