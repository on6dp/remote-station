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
# - Lancé au démarrage de Windows par la tâche planifiée « RemoteStation carte son » (voir installer-carte-son.cmd).
# - Journal : rs-carte-son.log, à côté de ce fichier.
param(
  [int]$Port = 18099,
  [string[]]$Origines = @('https://remote.op0p.be')
)
$ErrorActionPreference = 'Stop'
$Version = '1'
$Journal = Join-Path $PSScriptRoot 'rs-carte-son.log'

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

function Relancer([string]$vid, [string]$prod) {
  if ($vid -notmatch '^[0-9a-fA-F]{4}$' -or $prod -notmatch '^[0-9a-fA-F]{4}$') {
    return @{ ok = $false; msg = 'identifiant USB invalide' }
  }
  $id = "${vid}:${prod}".ToLower()
  $motif = 'USB\VID_' + $vid.ToUpper() + '&PID_' + $prod.ToUpper() + '*'
  $tous = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like $motif })
  if ($tous.Count -eq 0) { return @{ ok = $false; msg = "aucun périphérique USB $id branché (TRX éteint ou câble USB débranché ?)" } }
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
        $faits += "$nom : échec ($sortie / $($_.Exception.Message))"
        Ecrire "échec $($d.InstanceId) : $sortie / $($_.Exception.Message)"
        return @{ ok = $false; msg = ($faits -join ' ; ') }
      }
    }
  }
  return @{ ok = $true; msg = ($faits -join ' ; ') }
}

$ecoute = New-Object System.Net.HttpListener
$ecoute.Prefixes.Add("http://127.0.0.1:$Port/")
try { $ecoute.Start() } catch { Ecrire "impossible d'écouter sur le port $Port : $($_.Exception.Message)"; exit 1 }
Ecrire "démarré (version $Version, port $Port, sites autorisés : $($Origines -join ', '))"

while ($ecoute.IsListening) {
  $ctx = $ecoute.GetContext()
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
      Repondre $ctx 200 @{ ok = $true; version = $Version }
    } elseif ($chemin -eq '/relancer' -and $req.HttpMethod -eq 'POST' -and $o) {
      $lu = New-Object System.IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $corps = $lu.ReadToEnd()
      $lu.Close()
      $q = $null
      try { $q = $corps | ConvertFrom-Json } catch { }
      if (-not $q) { Repondre $ctx 400 @{ ok = $false; msg = 'demande illisible' } }
      else {
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
