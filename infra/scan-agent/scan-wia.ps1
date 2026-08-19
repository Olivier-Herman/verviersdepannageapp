# scan-wia.ps1 — Repli quand le scanner ne parle pas eSCL.
#
# WIA (Windows Image Acquisition) est integre a Windows : il passe par le pilote
# Canon installe sur le PC. Moins universel qu'eSCL (il FAUT le pilote), mais il
# marche avec a peu pres tout ce qui se branche ou se declare sur le reseau.
#
# Renvoie une liste de pages JPEG (le PDF multipage n'existe pas cote WIA).

# Constantes WIA
$script:WIA_FORMAT_JPEG   = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
$script:WIA_DPS_DOC_HANDLING_SELECT = 3088   # 1 = chargeur (feeder), 2 = recto-verso
$script:WIA_DPS_DOC_HANDLING_STATUS = 3087   # bit 1 = du papier est present
$script:WIA_IPS_CUR_INTENT          = 6146   # 1 = couleur, 4 = niveaux de gris
$script:WIA_IPS_XRES                = 6147
$script:WIA_IPS_YRES                = 6148

function Get-WiaScanner {
  param([string]$NameLike)
  $dm = New-Object -ComObject WIA.DeviceManager
  foreach ($info in $dm.DeviceInfos) {
    if ($info.Type -ne 1) { continue }                       # 1 = ScannerDeviceType
    $name = ''
    try { $name = [string]$info.Properties.Item('Name').Value } catch { }
    if (-not $NameLike -or $name -like "*$NameLike*") { return $info.Connect() }
  }
  return $null
}

function Set-WiaProp {
  param($Properties, [int]$Id, $Value)
  foreach ($p in $Properties) {
    if ($p.PropertyID -eq $Id) { try { $p.Value = $Value } catch { }; return }
  }
}

function Invoke-WiaScan {
  param(
    [string]$NameLike = '',
    [string]$Source   = 'adf',
    [string]$Color    = 'color',
    [int]$Dpi         = 300,
    [bool]$Duplex     = $false
  )

  $device = Get-WiaScanner -NameLike $NameLike
  if (-not $device) { throw 'WIA_NO_DEVICE' }

  if ($Source -ne 'flatbed') {
    $mode = 1; if ($Duplex) { $mode = $mode -bor 2 }
    Set-WiaProp -Properties $device.Properties -Id $script:WIA_DPS_DOC_HANDLING_SELECT -Value $mode
  }

  $pages = @()
  for ($i = 1; $i -le 60; $i++) {
    $item = $device.Items.Item(1)
    Set-WiaProp -Properties $item.Properties -Id $script:WIA_IPS_CUR_INTENT -Value $(if ($Color -eq 'gray') { 4 } else { 1 })
    Set-WiaProp -Properties $item.Properties -Id $script:WIA_IPS_XRES -Value $Dpi
    Set-WiaProp -Properties $item.Properties -Id $script:WIA_IPS_YRES -Value $Dpi

    try   { $img = $item.Transfer($script:WIA_FORMAT_JPEG) } catch { if ($pages.Count -gt 0) { break } else { throw 'WIA_TRANSFER_FAILED' } }

    $tmp = [System.IO.Path]::GetTempFileName() + '.jpg'
    $img.SaveFile($tmp)
    $pages += ,@{ mime = 'image/jpeg'; bytes = [System.IO.File]::ReadAllBytes($tmp) }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue

    if ($Source -eq 'flatbed') { break }                     # la vitre ne fait qu'une page
    # Encore du papier dans le chargeur ?
    $status = 0
    foreach ($p in $device.Properties) { if ($p.PropertyID -eq $script:WIA_DPS_DOC_HANDLING_STATUS) { $status = [int]$p.Value } }
    if (($status -band 1) -eq 0) { break }
  }

  if ($pages.Count -eq 0) { throw 'WIA_NO_PAGE' }
  return $pages
}
