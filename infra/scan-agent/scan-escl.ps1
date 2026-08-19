# scan-escl.ps1 — Pilotage d'un scanner reseau via eSCL (AirScan / Mopria).
#
# eSCL est le protocole ouvert qu'utilisent AirPrint Scan et Mopria Scan : du
# HTTP + du XML, aucun pilote a installer. La Canon MF752Cdw II l'expose si
# http://<ip>/eSCL/ScannerCapabilities repond du XML.
#
# Flux : POST /eSCL/ScanJobs (reglages) -> 201 + entete Location
#        GET  <Location>/NextDocument   -> une page (repeter jusqu'au 404)
# Le 404 sur NextDocument n'est PAS une erreur : c'est la fin du travail.

function Get-EsclBase {
  param([string]$PrinterHost)
  # http d'abord (le cas courant sur le LAN), https en repli (certificat auto-signe).
  foreach ($base in @("http://$PrinterHost/eSCL", "https://$PrinterHost/eSCL")) {
    try {
      $r = Invoke-WebRequest -Uri "$base/ScannerCapabilities" -Method GET -TimeoutSec 6 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return @{ base = $base; caps = [string]$r.Content } }
    } catch { }
  }
  return $null
}

function Test-Escl {
  param([string]$PrinterHost)
  return ($null -ne (Get-EsclBase -PrinterHost $PrinterHost))
}

# Le Canon refuse le chargeur quand il est vide — et pas avec une erreur
# parlante : un HTTP 500 sec, le meme que pour « scanner occupe ». On lit donc
# l etat du chargeur AVANT et on choisit la source tout seul : document dans le
# bac -> chargeur, sinon la vitre. L utilisateur pose sa feuille ou il veut.
function Get-EsclAdfLoaded {
  param([string]$Base)
  try {
    $r = Invoke-WebRequest -Uri "$Base/ScannerStatus" -Method GET -TimeoutSec 6 -UseBasicParsing
    $m = [regex]::Match([string]$r.Content, '<scan:AdfState>([^<]+)</scan:AdfState>')
    if (-not $m.Success) { return $null }
    return ($m.Groups[1].Value -match 'Loaded')
  } catch { return $null }
}

# Un travail eSCL laisse ouvert bloque TOUS les suivants : le scanner repond
# alors 500 a chaque nouvelle demande, jusqu a ce qu on le libere. On lit donc
# l etat avant de commencer et on supprime ce qui traine — sinon le premier scan
# de la journee marche et plus jamais aucun autre.
function Clear-EsclStaleJobs {
  param([string]$Base)
  try {
    $r = Invoke-WebRequest -Uri "$Base/ScannerStatus" -Method GET -TimeoutSec 6 -UseBasicParsing
    $xml = [string]$r.Content
    foreach ($m in [regex]::Matches($xml, '<pwg:JobUri>([^<]+)</pwg:JobUri>')) {
      $uri = $m.Groups[1].Value
      if ($uri -notmatch '^https?://') {
        $u = [Uri]$Base
        $uri = "$($u.Scheme)://$($u.Authority)$uri"
      }
      try { Invoke-WebRequest -Uri $uri -Method DELETE -TimeoutSec 6 -UseBasicParsing | Out-Null } catch { }
    }
  } catch { }
}

function Invoke-EsclScan {
  param(
    [string]$PrinterHost,
    [string]$Source = 'adf',      # adf | flatbed
    [string]$Color  = 'color',    # color | gray
    [int]$Dpi       = 300,
    [bool]$Duplex   = $false
  )

  $probe = Get-EsclBase -PrinterHost $PrinterHost
  if (-not $probe) { throw 'ESCL_UNAVAILABLE' }
  $base = $probe.base

  # Format : PDF si le scanner l annonce, sinon JPEG page par page.
  $fmt  = if ($probe.caps -match 'application/pdf') { 'application/pdf' } else { 'image/jpeg' }

  # Source reelle : ce que demande l appelant, corrige par l etat du chargeur.
  $loaded = Get-EsclAdfLoaded -Base $base
  $realSource = $Source
  if ($Source -ne 'flatbed' -and $loaded -eq $false) { $realSource = 'flatbed' }
  $inp  = if ($realSource -eq 'flatbed') { 'Platen' } else { 'Feeder' }
  $cm   = if ($Color  -eq 'gray')    { 'Grayscale8' } else { 'RGB24' }
  # A4 exprime en 1/300e de pouce (l unite eSCL), quelle que soit la resolution.
  $w = 2480; $h = 3508

  $xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.63</pwg:Version>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>$w</pwg:Width>
      <pwg:Height>$h</pwg:Height>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>$inp</pwg:InputSource>
  <scan:ColorMode>$cm</scan:ColorMode>
  <scan:XResolution>$Dpi</scan:XResolution>
  <scan:YResolution>$Dpi</scan:YResolution>
  <scan:Duplex>$($Duplex.ToString().ToLower())</scan:Duplex>
  <pwg:DocumentFormat>$fmt</pwg:DocumentFormat>
  <scan:DocumentFormatExt>$fmt</scan:DocumentFormatExt>
</scan:ScanSettings>
"@

  Clear-EsclStaleJobs -Base $base

  # Une imprimante qui sort de veille refuse parfois la premiere demande : on
  # insiste deux fois avant d abandonner, en liberant les travaux entre-temps.
  $job = $null
  $lastStatus = 0
  for ($attempt = 1; $attempt -le 3 -and -not $job; $attempt++) {
    try {
      $post = Invoke-WebRequest -Uri "$base/ScanJobs" -Method POST -TimeoutSec 30 -UseBasicParsing `
                -ContentType 'text/xml; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($xml))
      $lastStatus = [int]$post.StatusCode
      $job = $post.Headers['Location']
    } catch {
      $lastStatus = 500
      try { $lastStatus = [int]$_.Exception.Response.StatusCode } catch { }
    }
    if (-not $job -and $attempt -lt 3) {
      Start-Sleep -Seconds 2
      Clear-EsclStaleJobs -Base $base
    }
  }
  if (-not $job) { if ($lastStatus -ge 500) { throw 'ESCL_BUSY' } else { throw 'ESCL_NO_JOB' } }
  # Certains firmwares renvoient un Location relatif (/eSCL/ScanJobs/xxx).
  if ($job -notmatch '^https?://') {
    $u = [Uri]$base
    $job = "$($u.Scheme)://$($u.Authority)$job"
  }

  $pages = @()
  try {
    for ($i = 1; $i -le 60; $i++) {          # 60 pages max : garde-fou anti-boucle
      try {
        $tmp = [System.IO.Path]::GetTempFileName()
        Invoke-WebRequest -Uri "$job/NextDocument" -Method GET -TimeoutSec 180 -UseBasicParsing -OutFile $tmp
        $bytes = [System.IO.File]::ReadAllBytes($tmp)
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        if ($bytes.Length -lt 128) { break }  # page vide -> fin
        $pages += ,@{ mime = $fmt; bytes = $bytes }
      } catch {
        break                                 # 404 = plus de page : travail termine
      }
      if ($fmt -eq 'application/pdf') {
        # Meme en PDF (tout est dans le premier document), on redemande une fois :
        # c est ce 404 final qui ferme le travail cote scanner.
        try { Invoke-WebRequest -Uri "$job/NextDocument" -Method GET -TimeoutSec 20 -UseBasicParsing | Out-Null } catch { }
        break
      }
    }
  } finally {
    try { Invoke-WebRequest -Uri $job -Method DELETE -TimeoutSec 10 -UseBasicParsing | Out-Null } catch { }
  }

  if ($pages.Count -eq 0) { throw 'ESCL_NO_PAGE' }
  return $pages
}
