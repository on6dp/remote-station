# installer-carte-son.ps1 — installe (ou retire avec -Retirer) l'assistant « carte son du TRX » sur le PC du club.
# Copie rs-carte-son.ps1 dans C:\ProgramData\RemoteStation et le fait démarrer avec Windows (tâche planifiée,
# compte SYSTEM, sans limite de durée, relancée si elle s'arrête).
param([switch]$Retirer)
$ErrorActionPreference = 'Stop'
$Nom = 'RemoteStation carte son'
$Dest = Join-Path $env:ProgramData 'RemoteStation'
$Script = Join-Path $Dest 'rs-carte-son.ps1'

$t = Get-ScheduledTask -TaskName $Nom -ErrorAction SilentlyContinue
if ($t) {
  Stop-ScheduledTask -TaskName $Nom -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $Nom -Confirm:$false
}
if ($Retirer) {
  Remove-Item -Force $Script -ErrorAction SilentlyContinue
  Write-Host 'Assistant carte son retiré.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'rs-carte-son.ps1') $Script
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"')
$quand = New-ScheduledTaskTrigger -AtStartup
$qui = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$regl = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $Nom -Action $action -Trigger $quand -Principal $qui -Settings $regl `
  -Description 'Remote Station : redémarre la carte son USB du TRX à la demande de la page Station (http://127.0.0.1:18099)' | Out-Null
Start-ScheduledTask -TaskName $Nom
Start-Sleep -Seconds 3
try {
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:18099/etat' -TimeoutSec 5
  if ($r.ok) { Write-Host "Assistant carte son installé et en marche (version $($r.version))." }
} catch {
  Write-Host "Installé, mais l'assistant ne répond pas encore. Voir le journal : $Dest\rs-carte-son.log"
}
