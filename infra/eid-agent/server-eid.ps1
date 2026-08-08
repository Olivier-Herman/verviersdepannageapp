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
$psExe      = (Get-Command powershell.exe).Source

function Read-Eid {
  # Process isolé (bypass policy) → récupère le JSON écrit par read-eid.ps1.
  $out = & $psExe -NoProfile -ExecutionPolicy Bypass -File $readScript 2>$null
  return ($out -join '')
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:7181/')
$listener.Prefixes.Add('http://127.0.0.1:7181/')
try { $listener.Start() }
catch { Write-Host "Impossible d'ecouter sur 7181 : $($_.Exception.Message)"; Start-Sleep 8; exit 1 }
Write-Host "Agent eID VD Soft demarre — http://localhost:7181"

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
