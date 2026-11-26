# installer-dxcommander.ps1 — installe (ou retire avec -Retirer) le relais « DX Commander » sur le PC du club.
# Copie rs-dxcommander.ps1 dans C:\ProgramData\RemoteStation et le fait démarrer avec Windows (tâche planifiée,
# compte SYSTEM, sans limite de durée, relancée si elle s'arrête). Seulement pour le modèle « DX Commander » de la
# page Station ; l'assistant « carte son » (installer-carte-son.cmd) est à part.
param([switch]$Retirer)
$ErrorActionPreference = 'Stop'
$Nom = 'RemoteStation DX Commander'
$Dest = Join-Path $env:ProgramData 'RemoteStation'
$Script = Join-Path $Dest 'rs-dxcommander.ps1'

$t = Get-ScheduledTask -TaskName $Nom -ErrorAction SilentlyContinue
if ($t) {
  Stop-ScheduledTask -TaskName $Nom -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Nom -Confirm:$false
}
if ($Retirer) {
  Remove-Item -Force $Script -ErrorAction SilentlyContinue
  Write-Host 'Relais DX Commander retiré.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
try { Copy-Item -Force (Join-Path $PSScriptRoot 'rs-dxcommander.ps1') $Script }
catch {
  Write-Host "Copie impossible vers $Script : $($_.Exception.Message)"
  Write-Host "Un antivirus bloque sans doute ce fichier : ajoutez une exception pour le dossier $Dest et pour ce dossier-ci, puis recommencez."
  exit 1
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"')
$quand = New-ScheduledTaskTrigger -AtStartup
$qui = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$regl = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Nom -Action $action -Trigger $quand -Principal $qui -Settings $regl `
  -Description 'Remote Station : relais vers DX Commander (DXLab) pour la page Station (http://127.0.0.1:18098)' | Out-Null
Start-ScheduledTask -TaskName $Nom
$r = $null
for ($i = 0; $i -lt 10 -and -not $r; $i++) {
  Start-Sleep -Seconds 2
  try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:18098/etat' -TimeoutSec 3 } catch { $r = $null }
}
if ($r -and $r.ok) { Write-Host "Relais DX Commander installé et en marche (version $($r.version))." }
else { Write-Host "Installé, mais le relais ne répond pas. Un antivirus le bloque peut-être. Journal : $Dest\rs-dxcommander.log" }
