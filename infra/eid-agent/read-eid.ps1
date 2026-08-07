# read-eid.ps1 — Lit la carte d'identité belge via WinSCard (intégré à Windows).
# Sort un JSON compact sur stdout : { lastName, firstName, street, zip, city,
# country, nationalNumber, birthDate, nationality }  ou  { error: "NO_CARD" }.
# Aucune dépendance à compiler : utilise l'API PC/SC native de Windows.

$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
public class WinSCard {
  [DllImport("winscard.dll")] public static extern int SCardEstablishContext(uint scope, IntPtr r1, IntPtr r2, out IntPtr ctx);
  [DllImport("winscard.dll")] public static extern int SCardReleaseContext(IntPtr ctx);
  [DllImport("winscard.dll", CharSet=CharSet.Ansi)] public static extern int SCardListReadersA(IntPtr ctx, byte[] groups, byte[] readers, ref int len);
  [DllImport("winscard.dll", CharSet=CharSet.Ansi)] public static extern int SCardConnectA(IntPtr ctx, string reader, uint share, uint proto, out IntPtr card, out uint active);
  [DllImport("winscard.dll")] public static extern int SCardDisconnect(IntPtr card, uint disp);
  [StructLayout(LayoutKind.Sequential)] public struct IORequest { public uint dwProtocol; public int cbPciLength; }
  [DllImport("winscard.dll")] public static extern int SCardTransmit(IntPtr card, ref IORequest send, byte[] sbuf, int slen, IntPtr rpci, byte[] rbuf, ref int rlen);
}
"@

function Fail($code) { [Console]::Out.Write((@{ error = $code } | ConvertTo-Json -Compress)); exit 0 }

$ctx = [IntPtr]::Zero
$r = [WinSCard]::SCardEstablishContext(0, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$ctx)   # 0 = SCARD_SCOPE_USER
if ($r -ne 0) { Fail "NO_PCSC" }

# Liste des lecteurs (buffer unique de 2048 octets, noms ANSI séparés par \0)
$buf = New-Object byte[] 2048
$blen = 2048
$r = [WinSCard]::SCardListReadersA($ctx, $null, $buf, [ref]$blen)
if ($r -ne 0) { [WinSCard]::SCardReleaseContext($ctx) | Out-Null; Fail "NO_READER" }
$reader = ''
for ($i = 0; $i -lt $blen; $i++) { if ($buf[$i] -eq 0) { break }; $reader += [char]$buf[$i] }
if (-not $reader) { [WinSCard]::SCardReleaseContext($ctx) | Out-Null; Fail "NO_READER" }

# Connexion à la carte
$card = [IntPtr]::Zero; $active = 0
$r = [WinSCard]::SCardConnectA($ctx, $reader, 2, 3, [ref]$card, [ref]$active)   # 2=SHARED, 3=T0|T1
if ($r -ne 0) { [WinSCard]::SCardReleaseContext($ctx) | Out-Null; Fail "NO_CARD" }

function Transmit($apdu) {
  $io = New-Object WinSCard+IORequest
  $io.dwProtocol = $active
  $io.cbPciLength = 8
  $rbuf = New-Object byte[] 512
  $rlen = 512
  $rc = [WinSCard]::SCardTransmit($card, [ref]$io, [byte[]]$apdu, $apdu.Length, [IntPtr]::Zero, $rbuf, [ref]$rlen)
  if ($rc -ne 0) { throw "transmit_$rc" }
  return ,($rbuf[0..($rlen - 1)])
}

function ReadFile($path) {
  $sel = @(0x00, 0xA4, 0x08, 0x0C, $path.Length) + $path
  [void](Transmit $sel)
  $out = New-Object System.Collections.Generic.List[byte]
  $off = 0
  for ($k = 0; $k -lt 32; $k++) {
    $rb = @(0x00, 0xB0, [byte](($off -shr 8) -band 0xFF), [byte]($off -band 0xFF), 0xFF)
    $resp = Transmit $rb
    $bodyLen = $resp.Length - 2
    if ($bodyLen -gt 0) { for ($j = 0; $j -lt $bodyLen; $j++) { $out.Add($resp[$j]) } }
    if ($bodyLen -lt 0xFF) { break }
    $off += $bodyLen
    if ($resp[$resp.Length - 2] -ne 0x90) { break }
  }
  return $out.ToArray()
}

function ParseTlv($b) {
  $m = @{}
  $i = 0
  while ($i + 1 -lt $b.Length) {
    $tag = $b[$i]; $len = $b[$i + 1]
    if ($tag -eq 0 -or ($i + 2 + $len) -gt $b.Length) { break }
    if ($len -eq 0) { $m[$tag] = @() } else { $m[$tag] = $b[($i + 2)..($i + 1 + $len)] }
    $i += 2 + $len
  }
  return $m
}
function S($bytes) { if ($bytes -and $bytes.Length) { [System.Text.Encoding]::UTF8.GetString([byte[]]$bytes).Trim() } else { '' } }

try {
  $idBuf = ReadFile @(0x3F, 0x00, 0xDF, 0x01, 0x40, 0x31)   # identité
  $adBuf = ReadFile @(0x3F, 0x00, 0xDF, 0x01, 0x40, 0x33)   # adresse
  $id = ParseTlv $idBuf   # 6=NN, 7=nom, 8=prénoms, 10=nationalité, 12=naissance
  $ad = ParseTlv $adBuf   # 1=rue+n°, 2=CP, 3=commune
  $nat = S $id[10]; if (-not $nat) { $nat = 'Belge' }
  $out = [ordered]@{
    lastName       = S $id[7]
    firstName      = S $id[8]
    nationalNumber = S $id[6]
    birthDate      = S $id[12]
    nationality    = $nat
    street         = S $ad[1]
    zip            = S $ad[2]
    city           = S $ad[3]
    country        = 'Belgique'
  }
  [Console]::Out.Write(($out | ConvertTo-Json -Compress))
}
catch {
  [Console]::Out.Write((@{ error = 'READ_FAILED'; detail = "$_" } | ConvertTo-Json -Compress))
}
finally {
  [WinSCard]::SCardDisconnect($card, 0) | Out-Null
  [WinSCard]::SCardReleaseContext($ctx) | Out-Null
}
