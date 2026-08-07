param([switch]$Dump)

# read-eid.ps1 — Lit la carte d'identité belge via WinSCard (intégré à Windows).
# Sort un JSON compact sur stdout : { lastName, firstName, street, zip, city,
# country, nationalNumber, birthDate, nationality }  ou  { error: "..." }.
# Gère T=0 (6CXX → relecture avec la bonne longueur, 61XX → GET RESPONSE).
# -Dump : ajoute un champ _debug avec les APDU/réponses en hex.

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

$script:dbg = New-Object System.Collections.Generic.List[string]
function Hex($b) { if ($b -and $b.Length) { (($b | ForEach-Object { $_.ToString('X2') }) -join ' ') } else { '' } }

function Fail($code) { [Console]::Out.Write((@{ error = $code } | ConvertTo-Json -Compress)); exit 0 }

$ctx = [IntPtr]::Zero
if ([WinSCard]::SCardEstablishContext(0, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$ctx) -ne 0) { Fail "NO_PCSC" }

$buf = New-Object byte[] 2048
$blen = 2048
if ([WinSCard]::SCardListReadersA($ctx, $null, $buf, [ref]$blen) -ne 0) { [WinSCard]::SCardReleaseContext($ctx) | Out-Null; Fail "NO_READER" }
$reader = ''
for ($i = 0; $i -lt $blen; $i++) { if ($buf[$i] -eq 0) { break }; $reader += [char]$buf[$i] }
if (-not $reader) { [WinSCard]::SCardReleaseContext($ctx) | Out-Null; Fail "NO_READER" }

$card = [IntPtr]::Zero; $active = 0
if ([WinSCard]::SCardConnectA($ctx, $reader, 2, 3, [ref]$card, [ref]$active) -ne 0) { [WinSCard]::SCardReleaseContext($ctx) | Out-Null; Fail "NO_CARD" }

# Transmet un APDU brut ; renvoie le buffer complet (data + SW1 SW2).
function Raw($apdu) {
  $io = New-Object WinSCard+IORequest
  $io.dwProtocol = $active
  $io.cbPciLength = 8
  $rbuf = New-Object byte[] 512
  $rlen = 512
  $rc = [WinSCard]::SCardTransmit($card, [ref]$io, [byte[]]$apdu, $apdu.Length, [IntPtr]::Zero, $rbuf, [ref]$rlen)
  if ($rc -ne 0) { throw "transmit_$rc" }
  $out = $rbuf[0..($rlen - 1)]
  if ($Dump) { $script:dbg.Add(("-> " + (Hex $apdu) + "  <- " + (Hex $out))) }
  return , $out
}

# Transmet en gérant T=0 : 6CXX (relire avec Le=XX) et 61XX (GET RESPONSE).
function Xmit($apdu) {
  $resp = Raw $apdu
  $sw1 = $resp[$resp.Length - 2]; $sw2 = $resp[$resp.Length - 1]
  if ($sw1 -eq 0x6C) {
    $a2 = @($apdu[0], $apdu[1], $apdu[2], $apdu[3], $sw2)
    $resp = Raw $a2
    $sw1 = $resp[$resp.Length - 2]; $sw2 = $resp[$resp.Length - 1]
  }
  $acc = New-Object System.Collections.Generic.List[byte]
  if ($resp.Length -gt 2) { for ($j = 0; $j -lt $resp.Length - 2; $j++) { $acc.Add($resp[$j]) } }
  while ($sw1 -eq 0x61) {
    $resp = Raw @(0x00, 0xC0, 0x00, 0x00, $sw2)
    $sw1 = $resp[$resp.Length - 2]; $sw2 = $resp[$resp.Length - 1]
    if ($resp.Length -gt 2) { for ($j = 0; $j -lt $resp.Length - 2; $j++) { $acc.Add($resp[$j]) } }
  }
  return , @{ data = $acc.ToArray(); sw1 = $sw1; sw2 = $sw2 }
}

function ReadFile($path) {
  $sel = @(0x00, 0xA4, 0x08, 0x0C, $path.Length) + $path
  $r = Xmit $sel
  if ($Dump) { $script:dbg.Add("SELECT " + (Hex $path) + " -> SW " + $r.sw1.ToString('X2') + $r.sw2.ToString('X2')) }
  $out = New-Object System.Collections.Generic.List[byte]
  $off = 0
  for ($k = 0; $k -lt 64; $k++) {
    $rb = @(0x00, 0xB0, [byte](($off -shr 8) -band 0xFF), [byte]($off -band 0xFF), 0xFF)
    $r = Xmit $rb
    $body = $r.data
    if ($body.Length -gt 0) { foreach ($x in $body) { $out.Add($x) } }
    if ($body.Length -lt 0xFF) { break }
    $off += $body.Length
    if ($r.sw1 -ne 0x90) { break }
  }
  return $out.ToArray()
}

function ParseTlv($b) {
  $m = @{}
  $i = 0
  while ($i + 1 -lt $b.Length) {
    $tag = $b[$i]; $len = $b[$i + 1]
    if ($tag -eq 0 -or ($i + 2 + $len) -gt $b.Length) { break }
    # Clé en [int] : sinon lookup $id[7] (int) ≠ clé stockée en [byte] → vide.
    if ($len -eq 0) { $m[[int]$tag] = @() } else { $m[[int]$tag] = $b[($i + 2)..($i + 1 + $len)] }
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
  if ($Dump) { $out._debug = @{ idLen = $idBuf.Length; adLen = $adBuf.Length; steps = $script:dbg.ToArray() } }
  [Console]::Out.Write(($out | ConvertTo-Json -Compress -Depth 5))
}
catch {
  $o = @{ error = 'READ_FAILED'; detail = "$_" }
  if ($Dump) { $o._debug = $script:dbg.ToArray() }
  [Console]::Out.Write(($o | ConvertTo-Json -Compress -Depth 5))
}
finally {
  [WinSCard]::SCardDisconnect($card, 0) | Out-Null
  [WinSCard]::SCardReleaseContext($ctx) | Out-Null
}
