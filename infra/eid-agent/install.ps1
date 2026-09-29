# install.ps1 — mise à niveau UNIQUE de l'agent eID vers la version qui sait se
# mettre à jour toute seule (29/09/2026). À coller dans PowerShell ADMINISTRATEUR :
#   iex ((New-Object Net.WebClient).DownloadString('https://app.verviersdepannage.com/eid-agent/install.ps1'))
# Retrouve le dossier de l'agent installé, y dépose les nouveaux scripts, relance.
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$base = 'https://app.verviersdepannage.com/eid-agent/'
$dir = $null
try {
  $t = Get-ScheduledTask -TaskName 'VDSoft eID Agent' -ErrorAction Stop
  if ($t.Actions[0].Arguments -match '-File\s+"?([^"]+server-eid\.ps1)"?') { $dir = Split-Path -Parent $Matches[1] }
} catch {}
if (-not $dir) { $dir = 'C:\VDSoft\eid-agent' }
New-Item -ItemType Directory -Force -Path $dir | Out-Null
foreach ($f in @('read-eid.ps1', 'server-eid.ps1')) {
  Invoke-WebRequest -Uri ($base + $f + '?t=' + [DateTime]::UtcNow.Ticks) -OutFile (Join-Path $dir $f) -UseBasicParsing
  Write-Host "[OK] $f -> $dir"
}
schtasks /End /TN "VDSoft eID Agent" 2>$null | Out-Null
Get-NetTCPConnection -LocalPort 7181 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
schtasks /Run /TN "VDSoft eID Agent" | Out-Null
Start-Sleep 3
try { Write-Host ("[OK] Agent relancé : " + (Invoke-RestMethod http://localhost:7181/health | ConvertTo-Json -Compress)) } catch { Write-Host "[!] L'agent ne répond pas encore : attendez 10 s puis ouvrez http://localhost:7181/health" }
