# server-scan.ps1 — Agent Scan VD Soft : serveur HTTP 100% PowerShell (SANS Node).
#
# Ecoute sur http://localhost:7182 et expose :
#   GET /health  -> { ok, printer, escl, wia }
#   GET /scan    -> lance un scan et renvoie les pages en base64
#                   ?source=adf|flatbed  &color=color|gray  &dpi=300  &duplex=0|1
#
# Pourquoi un agent local : la fiche VD Soft est servie en HTTPS depuis Vercel et
# ne peut pas parler a une imprimante en HTTP sur le LAN. Le navigateur, lui, a
# le droit d'appeler http://localhost (origine consideree comme sure). Meme
# principe que l'agent eID (port 7181).
#
# Deux chemins de scan, dans cet ordre :
#   1. eSCL / AirScan  : HTTP + XML, aucun pilote (cf. scan-escl.ps1)
#   2. WIA             : pilote Canon installe sur ce PC (cf. scan-wia.ps1)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $here 'agent-log.txt'
. (Join-Path $here 'scan-escl.ps1')
. (Join-Path $here 'scan-wia.ps1')

function Log($m) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

# ── Configuration (config.json a cote du script) ────────────────────────────
$cfgPath = Join-Path $here 'config.json'
$cfg = @{ printerHost = ''; wiaNameLike = 'Canon'; defaultSource = 'adf'; defaultDpi = 300 }
if (Test-Path $cfgPath) {
  try {
    $j = Get-Content $cfgPath -Raw | ConvertFrom-Json
    foreach ($k in @('printerHost','wiaNameLike','defaultSource','defaultDpi')) {
      if ($null -ne $j.$k -and "$($j.$k)" -ne '') { $cfg[$k] = $j.$k }
    }
  } catch { Log "config.json illisible : $($_.Exception.Message)" }
}
Log "=== Demarrage agent Scan (PID $PID) — imprimante '$($cfg.printerHost)' ==="

# Libere le port si un ancien agent traine (zombie QuickEdit).
try {
  $conns = Get-NetTCPConnection -LocalPort 7182 -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) { if ($c.OwningProcess -and $c.OwningProcess -ne $PID) { Log "Port 7182 pris par PID $($c.OwningProcess) -> kill"; Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue } }
} catch {}

$listener = $null; $ok = $false
foreach ($p in @('http://+:7182/','http://127.0.0.1:7182/','http://localhost:7182/')) {
  try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add($p); $l.Start(); $listener = $l; Log "Ecoute OK sur $p"; $ok = $true; break }
  catch { Log "Echec bind $p : $($_.Exception.Message)" }
}
if (-not $ok) { Log "AUCUN prefixe n'a pu ecouter -> arret."; Start-Sleep 3; exit 1 }

# Sonde eSCL mise en cache 60 s : /health doit repondre vite (le navigateur ne
# l'attend qu'une seconde et demie avant de masquer le bouton Scanner).
$script:esclCache = $null
$script:esclCacheAt = [DateTime]::MinValue
function Get-EsclState {
  if (-not $cfg.printerHost) { return $false }
  if ($null -ne $script:esclCache -and ((Get-Date) - $script:esclCacheAt).TotalSeconds -lt 60) { return $script:esclCache }
  $v = $false
  try { $v = Test-Escl -PrinterHost $cfg.printerHost } catch { }
  $script:esclCache = $v; $script:esclCacheAt = Get-Date
  return $v
}

function Get-Q($req, [string]$name, $def) {
  $v = $req.QueryString[$name]
  if ($null -eq $v -or "$v" -eq '') { return $def }
  return $v
}

function Do-Scan($req) {
  $source = [string](Get-Q $req 'source' $cfg.defaultSource)
  $color  = [string](Get-Q $req 'color'  'color')
  $dpi    = [int](Get-Q $req 'dpi' $cfg.defaultDpi)
  $duplex = ([string](Get-Q $req 'duplex' '0')) -in @('1','true','yes')

  $pages = $null; $via = ''
  if ($cfg.printerHost) {
    try { $pages = Invoke-EsclScan -PrinterHost $cfg.printerHost -Source $source -Color $color -Dpi $dpi -Duplex $duplex; $via = 'escl' }
    catch { Log "eSCL KO ($($_.Exception.Message)) -> repli WIA" }
  }
  if (-not $pages) {
    $pages = Invoke-WiaScan -NameLike $cfg.wiaNameLike -Source $source -Color $color -Dpi $dpi -Duplex $duplex
    $via = 'wia'
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $files = @()
  $n = 0
  foreach ($p in $pages) {
    $n++
    $ext  = if ($p.mime -eq 'application/pdf') { 'pdf' } else { 'jpg' }
    $name = if ($pages.Count -eq 1) { "scan-$stamp.$ext" } else { "scan-$stamp-p$n.$ext" }
    $files += ,@{ name = $name; mime = $p.mime; b64 = [Convert]::ToBase64String($p.bytes) }
  }
  Log "Scan OK via $via : $($files.Count) fichier(s), source=$source dpi=$dpi"
  return (@{ ok = $true; via = $via; files = $files } | ConvertTo-Json -Depth 4 -Compress)
}

while ($listener.IsListening) {
  $res = $null
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    $res.Headers.Add('Access-Control-Allow-Origin',  '*')
    $res.Headers.Add('Access-Control-Allow-Methods', 'GET, OPTIONS')
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.ContentType = 'application/json; charset=utf-8'

    $path = $req.Url.AbsolutePath.ToLower()
    $body = ''
    if ($req.HttpMethod -eq 'OPTIONS') {
      $res.StatusCode = 204
    } elseif ($path -eq '/health') {
      $escl = Get-EsclState
      $wia = $false
      try { $wia = ($null -ne (Get-WiaScanner -NameLike $cfg.wiaNameLike)) } catch { }
      $body = (@{ ok = $true; agent = 'scan'; printer = $cfg.printerHost; escl = $escl; wia = $wia } | ConvertTo-Json -Compress)
    } elseif ($path -eq '/scan') {
      try { $body = Do-Scan $req }
      catch {
        $res.StatusCode = 500
        Log "Scan KO : $($_.Exception.Message)"
        $body = (@{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress)
      }
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
    try { if ($res) { $res.StatusCode = 500; $res.OutputStream.Close() } } catch {}
  }
}
