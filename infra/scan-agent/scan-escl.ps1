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

  # Format : PDF si le scanner l'annonce, sinon JPEG page par page.
  $fmt  = if ($probe.caps -match 'application/pdf') { 'application/pdf' } else { 'image/jpeg' }
  $inp  = if ($Source -eq 'flatbed') { 'Platen' } else { 'Feeder' }
  $cm   = if ($Color  -eq 'gray')    { 'Grayscale8' } else { 'RGB24' }
  # A4 exprime en 1/300e de pouce (l'unite eSCL), quelle que soit la resolution.
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

  $post = Invoke-WebRequest -Uri "$base/ScanJobs" -Method POST -TimeoutSec 30 -UseBasicParsing `
            -ContentType 'text/xml; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($xml))
  $job = $post.Headers['Location']
  if (-not $job) { throw 'ESCL_NO_JOB' }
  # Certains firmwares renvoient un Location relatif (/eSCL/ScanJobs/xxx).
  if ($job -notmatch '^https?://') {
    $u = [Uri]$base
    $job = "$($u.Scheme)://$($u.Authority)$job"
  }

  $pages = @()
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
    if ($fmt -eq 'application/pdf') { break } # le PDF contient deja toutes les pages
  }

  if ($pages.Count -eq 0) { throw 'ESCL_NO_PAGE' }
  return $pages
}
