// server.js — PC Windows zebra-serveur (Verviers Dépannage)
// ============================================================
// Tourne sur le PC Windows local (IP 192.168.129.54) via tâche planifiée
// "ZebraServer" qui auto-démarre au boot. Exposé en ngrok sur
// https://palaeobiologic-carola-steeply.ngrok-free.dev
//
// Endpoints :
//   - GET  /           : healthcheck
//   - POST /print      : flow LEGACY, le PC compose le ZPL depuis des champs métier
//                        (utilisé par lib/print/zebra.ts dans VD Soft)
//   - POST /print-raw  : flow NOUVEAU, le PC reçoit du ZPL déjà composé par VD Soft
//                        (utilisé par lib/print/zebra-raw.ts dans VD Soft).
//                        Permet d'avoir N designs côté VD Soft sans modifier ce serveur.
//
// Imprimante : Zebra ZD421, 203dpi, USB.
// Driver Windows : "ZDesigner ZD421-203dpi ZPL" en mode passthrough/raw.
//
// Versioning : ce fichier est versionné dans le repo verviers-app
// (infra/zebra-server/server.js). Toute modif doit y être faite, puis
// déployée sur le PC. Pour redémarrer : Planificateur de tâches Windows
// → tâche "ZebraServer" → Fin + Démarrer.

const express = require("express");
const { exec } = require("child_process");
const fs       = require("fs");
const path     = require("path");
const cors     = require("cors");

const app  = express();
const PORT = 3000;
const PRINTER_NAME = "ZDesigner ZD421-203dpi ZPL"; // nom exact dans Windows

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ─────────────────────────────────────────────────────────────────────
// Helper commun : envoie un ZPL à l'imprimante via spouleur Windows
// ─────────────────────────────────────────────────────────────────────
function sendZplToPrinter(zpl, res, label = "label") {
  try {
    const tmpFile = path.join(process.env.TEMP, `${label}_${Date.now()}.zpl`);
    fs.writeFileSync(tmpFile, zpl, "binary");

    const ps  = `Get-Content -Raw '${tmpFile}' | Out-Printer -Name '${PRINTER_NAME}'`;
    const cmd = `powershell -Command "${ps}"`;

    exec(cmd, (err) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err) {
        console.error("Erreur impression:", err.message);
        return res.status(500).json({ ok: false, error: err.message });
      }
      return res.json({ ok: true });
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helper LEGACY : compose le ZPL côté PC depuis les champs métier
// Utilisé par l'endpoint /print uniquement (compat ascendante).
// Le template ZPL équivalent côté VD Soft est dans
// src/lib/print/zpl-templates/parc-label.ts du repo verviers-app.
// ─────────────────────────────────────────────────────────────────────
function buildZPL({ qrUrl, motif, date, note }) {
  // Note : "TDC" hardcode supprime (etait un bug de l initialisation
  // du script — TDC est un motif possible, pas une signature fixe).
  return `^XA
^CI28
^PW812
^LL609
^LH0,0
^PR2
~SD30

^FO30,30
^A0N,70,70
^FD${escapeZPL(motif)}^FS

^FO500,40
^A0N,40,40
^FD${escapeZPL(date)}^FS

^FO180,140
^BQN,2,14
^FDLA,${escapeZPL(qrUrl)}^FS

^FO30,520
^A0N,28,28
^FB752,2,0,L,0
^FD${escapeZPL(note)}^FS

^XZ`;
}

function escapeZPL(s) {
  if (!s) return "";
  return String(s)
    .replace(/\^/g, " ")
    .replace(/~/g, " ")
    .replace(/\\/g, "/");
}

// ─────────────────────────────────────────────────────────────────────
// LEGACY : POST /print
// Body attendu : { qrUrl, motif, date, note }
// → le PC compose le ZPL puis imprime
// ─────────────────────────────────────────────────────────────────────
app.post("/print", (req, res) => {
  const { qrUrl, motif, date, note } = req.body;
  if (!qrUrl) {
    return res.status(400).json({ ok: false, error: "qrUrl requis" });
  }
  const zpl = buildZPL({
    qrUrl,
    motif: motif || "",
    date:  date  || "",
    note:  note  || "",
  });
  return sendZplToPrinter(zpl, res, "label");
});

// ─────────────────────────────────────────────────────────────────────
// NOUVEAU : POST /print-raw
// Body attendu : { zpl: "^XA...^XZ" } déjà composé par VD Soft.
// → le PC fait juste le forwarding à l'imprimante.
//
// Permet N designs différents côté VD Soft sans modifier ce serveur :
// étiquettes parc, restitution, AVP, destruction, transfert, etc.
// Chaque template ZPL est versionné dans le repo verviers-app sous
// src/lib/print/zpl-templates/.
// ─────────────────────────────────────────────────────────────────────
app.post("/print-raw", (req, res) => {
  const { zpl } = req.body;
  if (!zpl || typeof zpl !== "string" || !zpl.includes("^XA")) {
    return res.status(400).json({
      ok: false,
      error: "zpl manquant ou invalide (doit contenir ^XA)",
    });
  }
  return sendZplToPrinter(zpl, res, "label_raw");
});

// ─────────────────────────────────────────────────────────────────────
// Healthcheck
// ─────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Zebra Print Server (Verviers Dépannage)",
    endpoints: [
      "POST /print       — legacy, body { qrUrl, motif, date, note }",
      "POST /print-raw   — body { zpl }",
      "GET  /            — this healthcheck",
    ],
    printer: PRINTER_NAME,
  });
});

app.listen(PORT, () => console.log(`Zebra server listening on ${PORT}`));
