# server-eid.ps1 — Agent eID VD Soft : serveur HTTP 100% PowerShell (SANS Node).
#
# Écoute sur http://localhost:7181 et expose :
#   GET /read   → lit la carte d'identité belge (via read-eid.ps1) → JSON
#   GET /health → { ok, cardPresent }
# CORS ouvert (la page écran comptoir peut l'appeler). Aucune dépendance.
#
# Lancé par start-eid-agent.bat / la tâche planifiée avec -ExecutionPolicy Bypass
# (contourne la stratégie « Restricted » sans rien changer au système).

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$readScript = Join-Path $here 'read-eid.ps1'
$logFile    = Join-Path $here 'agent-log.txt'
$psExe      = (Get-Command powershell.exe).Source

function Log($m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

function Read-Eid {
  # Process isolé (bypass policy) → récupère le JSON écrit par read-eid.ps1.
  $out = & $psExe -NoProfile -ExecutionPolicy Bypass -File $readScript 2>$null
  return ($out -join '')
}

Log "=== Demarrage agent eID (PID $PID) ==="

# Si un ancien agent tient deja le port 7181, on le libere (evite le zombie
# QuickEdit qui bloque le nouveau). On tue les autres powershell qui ecoutent 7181.
try {
  $conns = Get-NetTCPConnection -LocalPort 7181 -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) { if ($c.OwningProcess -and $c.OwningProcess -ne $PID) { Log "Port 7181 deja pris par PID $($c.OwningProcess) -> kill"; Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }
} catch {}

$listener = New-Object System.Net.HttpListener
# On tente plusieurs prefixes ; le plus permissif d'abord (marche si admin),
# sinon les loopback (marchent sans admin). On garde ceux qui passent.
$ok = $false
foreach ($p in @('http://+:7181/','http://127.0.0.1:7181/','http://localhost:7181/')) {
  try { $l2 = New-Object System.Net.HttpListener; $l2.Prefixes.Add($p); $l2.Start(); $listener = $l2; Log "Ecoute OK sur $p"; $ok = $true; break }
  catch { Log "Echec bind $p : $($_.Exception.Message)" }
}
if (-not $ok) { Log "AUCUN prefixe n'a pu ecouter -> arret."; Start-Sleep 3; exit 1 }
Log "Agent eID VD Soft demarre."

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers.Add('Access-Control-Allow-Origin',  '*')
    $res.Headers.Add('Access-Control-Allow-Methods', 'GET, OPTIONS')
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.ContentType = 'application/json; charset=utf-8'

    $body = ''
    $path = $req.Url.AbsolutePath.ToLower()
    if ($req.HttpMethod -eq 'OPTIONS') {
      $res.StatusCode = 204
    } elseif ($path -eq '/read') {
      $body = Read-Eid
      if (-not $body) { $body = '{"error":"NO_OUTPUT"}' }
    } elseif ($path -eq '/health') {
      $j = Read-Eid
      $present = ($j -and -not ($j -match '"error"'))
      $body = (@{ ok = $true; agent = 'ps'; cardPresent = [bool]$present } | ConvertTo-Json -Compress)
    } else {
      $res.StatusCode = 404
      $body = '{"error":"NOT_FOUND"}'
    }

    if ($body) {
      $buf = [System.Text.Encoding]::UTF8.GetBytes($body)
      $res.ContentLength64 = $buf.Length
      $res.OutputStream.Write($buf, 0, $buf.Length)
    }
    $res.OutputStream.Close()
  } catch {
    # Une requête foireuse ne doit jamais tuer le serveur.
    try { $res.StatusCode = 500; $res.OutputStream.Close() } catch {}
  }
}
