// server.js — PC Windows zebra-serveur (Verviers Dépannage)
// ============================================================
// Tourne sur le PC Windows local (IP 192.168.129.54) via tâche planifiée
// "ZebraServer" qui auto-démarre au boot. Exposé en ngrok sur
// https://palaeobiologic-carola-steeply.ngrok-free.dev
//
// Endpoints :
//   - GET  /health     : healthcheck
//   - POST /print      : flow LEGACY, le PC compose le ZPL depuis des champs
//                        métier (qrUrl, motif, date, note, plate, vin, brand,
//                        model). Utilisé par lib/print/zebra.ts dans VD Soft.
//   - POST /print-raw  : flow NOUVEAU, le PC reçoit du ZPL déjà composé par
//                        VD Soft. Utilisé par lib/print/zebra-raw.ts.
//                        Permet N designs côté VD Soft sans modifier ce serveur.
//
// Imprimante : Zebra ZD421, 203dpi, USB.
// Driver Windows : "ZDesigner ZD421-203dpi ZPL" en mode passthrough/raw.
// Méthode d'impression : P/Invoke winspool.drv (RawPrint) pour garantir le
// passage du ZPL brut sans interprétation par le spouler Windows.
//
// Versioning : ce fichier est versionné dans le repo verviers-app
// (infra/zebra-server/server.js). Toute modif doit y être faite, puis
// déployée sur le PC. Pour redémarrer : Planificateur de tâches Windows
// → tâche "ZebraServer" → Fin + Démarrer.

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");

const app = express();
const PRINTER_NAME = "ZDesigner ZD421-203dpi ZPL";
const SERVER_PORT  = 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─────────────────────────────────────────────────────────────────────
// LEGACY : compose le ZPL côté PC depuis les champs métier
// Utilisé par l'endpoint /print (compat ascendante avec lib/print/zebra.ts).
// Template équivalent côté VD Soft : src/lib/print/zpl-templates/parc-label.ts.
// ─────────────────────────────────────────────────────────────────────
function buildZpl({ qrUrl, motif, date, note, plate, vin, brand, model }) {
  const clean = (s) =>
    (s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9 \-\/\.\,\(\)]/g, "")
      .substring(0, 40);

  const motifClean  = clean(motif);
  const dateClean   = clean(date);
  const noteClean   = clean(note);
  const plateClean  = clean(plate);
  const vinClean    = (vin || "").replace(/[^A-Z0-9]/gi, "").substring(0, 17).toUpperCase();
  const brandModel  = clean([brand, model].filter(Boolean).join(" "));

  // ZD421 203dpi - 812x609 dots
  let zpl = `^XA
^POI
^PW812
^LL609
^LS0
~SD30
^PR2

^FO126,5
^BQN,2,12
^FDQA,${qrUrl}^FS

^FO20,415
^A0N,55,55
^FD${motifClean}^FS

^FO400,420
^A0N,50,50
^FD${dateClean}^FS`;

  // Marque / Modele
  if (brandModel) {
    zpl += `
^FO20,472
^A0N,30,30
^FD${brandModel}^FS`;
  }

  // Plaque
  if (plateClean) {
    zpl += `
^FO20,505
^A0N,30,30
^FDImmat: ${plateClean}^FS`;
  }

  // VIN
  if (vinClean) {
    zpl += `
^FO20,538
^A0N,26,26
^FDVIN: ${vinClean}^FS`;
  }

  // Note
  if (noteClean) {
    zpl += `
^FO20,568
^A0N,28,28
^FD${noteClean}^FS`;
  }

  zpl += "\n^XZ\n";
  return zpl;
}

// ─────────────────────────────────────────────────────────────────────
// Helper commun : envoie un ZPL brut a l'imprimante via P/Invoke winspool.drv
// Garantit le mode RAW (pas d'interpretation du spouler Windows).
// Utilise par /print ET /print-raw.
// ─────────────────────────────────────────────────────────────────────
function printZpl(zpl) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `zebra_${Date.now()}.zpl`);
    fs.writeFileSync(tmpFile, zpl, "ascii");

    const ps = `
$printerName = "${PRINTER_NAME}"
$file = "${tmpFile.replace(/\\/g, "\\\\")}"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DOCINFO {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr h, int l, ref DOCINFO d);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
}
"@
$bytes = [System.IO.File]::ReadAllBytes($file)
$h = [IntPtr]::Zero
[RawPrint]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero) | Out-Null
$di = New-Object RawPrint+DOCINFO
$di.pDocName = "ZPL"
$di.pDataType = "RAW"
[RawPrint]::StartDocPrinter($h, 1, [ref]$di) | Out-Null
[RawPrint]::StartPagePrinter($h) | Out-Null
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$w = 0
[RawPrint]::WritePrinter($h, $ptr, $bytes.Length, [ref]$w) | Out-Null
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
[RawPrint]::EndPagePrinter($h) | Out-Null
[RawPrint]::EndDocPrinter($h) | Out-Null
[RawPrint]::ClosePrinter($h) | Out-Null
Write-Output "OK"
`;

    const psFile = path.join(os.tmpdir(), `print_${Date.now()}.ps1`);
    fs.writeFileSync(psFile, ps, "utf8");

    exec(`powershell -ExecutionPolicy Bypass -File "${psFile}"`, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      try { fs.unlinkSync(psFile); } catch (_) {}
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// Healthcheck
// ─────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Zebra Print Server (Verviers Depannage)",
    endpoints: [
      "GET  /health     - healthcheck",
      "POST /print      - legacy, body { qrUrl, motif, date, note, plate, vin, brand, model }",
      "POST /print-raw  - body { zpl }",
    ],
    printer: PRINTER_NAME,
  });
});

// ─────────────────────────────────────────────────────────────────────
// LEGACY : POST /print
// Body : { qrUrl, motif, date, note, plate, vin, brand, model }
// → le PC compose le ZPL via buildZpl() puis imprime
// ─────────────────────────────────────────────────────────────────────
app.post("/print", async (req, res) => {
  const { qrUrl, motif, date, note, plate, vin, brand, model } = req.body;
  if (!qrUrl) return res.status(400).json({ ok: false, error: "qrUrl requis" });
  console.log(`[PRINT] ${new Date().toLocaleTimeString()} - ${motif} ${date} ${plate || ""}`);
  console.log(`[QR] ${qrUrl}`);
  try {
    await printZpl(buildZpl({ qrUrl, motif, date, note, plate, vin, brand, model }));
    console.log("[OK] Imprime");
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ERR] ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// NOUVEAU : POST /print-raw
// Body : { zpl: "^XA...^XZ" } deja compose par VD Soft.
// → le PC fait juste le forwarding a l'imprimante via la meme methode P/Invoke.
//
// Permet N designs differents cote VD Soft sans modifier ce serveur :
// etiquettes parc, restitution, AVP, destruction, transfert, etc.
// Chaque template ZPL est versionne dans le repo verviers-app sous
// src/lib/print/zpl-templates/.
// ─────────────────────────────────────────────────────────────────────
app.post("/print-raw", async (req, res) => {
  const { zpl } = req.body;
  if (!zpl || typeof zpl !== "string" || !zpl.includes("^XA")) {
    return res.status(400).json({ ok: false, error: "zpl manquant ou invalide (doit contenir ^XA)" });
  }
  console.log(`[PRINT-RAW] ${new Date().toLocaleTimeString()} - ${zpl.length} chars`);
  try {
    await printZpl(zpl);
    console.log("[OK] Imprime (raw)");
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ERR] ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(SERVER_PORT, "0.0.0.0", () => {
  console.log("========================================");
  console.log(" Serveur Zebra ZD421 - Verviers Depannage");
  console.log(`  http://192.168.129.54:${SERVER_PORT}`);
  console.log(" Endpoints : GET /health, POST /print, POST /print-raw");
  console.log("========================================");
});
