'use client'

import { useState } from 'react'
import { Printer, Eye, AlertTriangle } from 'lucide-react'

interface LabelData {
  qrUrl: string
  motif: string
  date:  string
  note:  string
}

interface TestResponse {
  ok:          boolean
  error?:      string
  label_data?: LabelData
  zpl?:        string
  preview_url?: string
}

export default function TestPrintClient() {
  const [ticketId, setTicketId]   = useState('')
  const [preview,  setPreview]    = useState<TestResponse | null>(null)
  const [loading,  setLoading]    = useState<'preview' | 'old' | 'new' | null>(null)
  const [oldResult, setOldResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [newResult, setNewResult] = useState<{ ok: boolean; error?: string } | null>(null)

  async function doPreview() {
    if (!ticketId) return
    setLoading('preview'); setPreview(null); setOldResult(null); setNewResult(null)
    try {
      const r = await fetch(`/api/admin/labels/test-print?ticket_id=${ticketId}`)
      const j = await r.json()
      setPreview(j)
    } finally {
      setLoading(null)
    }
  }

  async function printOld() {
    if (!ticketId) return
    setLoading('old'); setOldResult(null)
    try {
      const r = await fetch(`/api/helpdesk/${ticketId}/print`, { method: 'POST' })
      const j = await r.json()
      setOldResult({ ok: !!j.ok, error: j.error })
    } catch (e: any) {
      setOldResult({ ok: false, error: e.message })
    } finally {
      setLoading(null)
    }
  }

  async function printNew() {
    if (!ticketId) return
    setLoading('new'); setNewResult(null)
    try {
      const r = await fetch('/api/admin/labels/test-print', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticket_id: parseInt(ticketId) }),
      })
      const j = await r.json()
      setNewResult({ ok: !!j.ok, error: j.error })
    } catch (e: any) {
      setNewResult({ ok: false, error: e.message })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-ink font-bold text-2xl">🧪 Test impression étiquette</h1>
        <p className="text-ink-muted text-sm mt-1">
          Compare l'ancien flow (PC compose ZPL) et le nouveau (VD Soft compose ZPL).
          Lance les deux pour le même ticket et vérifie que les deux étiquettes physiques sont identiques.
        </p>
      </header>

      {/* Bandeau d'avertissement */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex gap-3">
        <AlertTriangle className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
        <div className="text-sm text-ink">
          <p className="font-semibold">Phase de test parallèle</p>
          <p className="text-ink-muted mt-1">
            Le bouton "Imprimer (nouveau)" envoie au endpoint <code className="bg-surface-2 px-1 rounded">/print-raw</code> du PC zebra-serveur.
            Si ce endpoint n'a pas encore été ajouté sur le PC, l'impression échouera (le flow prod n'est PAS affecté).
          </p>
        </div>
      </div>

      {/* Saisie ticket */}
      <div className="bg-surface border rounded-2xl p-5">
        <label className="block text-ink-muted text-xs mb-1.5">ID Ticket Helpdesk Odoo</label>
        <div className="flex gap-2">
          <input value={ticketId}
            onChange={e => setTicketId(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="ex: 1346"
            className="flex-1 bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-base font-mono focus:outline-none focus:border-brand" />
          <button onClick={doPreview} disabled={!ticketId || loading !== null}
            className="px-4 py-2.5 bg-brand text-white rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-40 transition flex items-center gap-2">
            <Eye size={16} />
            {loading === 'preview' ? '...' : 'Aperçu ZPL'}
          </button>
        </div>
      </div>

      {/* Erreur preview */}
      {preview && !preview.ok && (
        <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm">
          ⚠ {preview.error}
        </div>
      )}

      {/* Preview ZPL + rendu PNG via labelary */}
      {preview?.ok && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Rendu visuel via labelary */}
          <div className="bg-surface border rounded-2xl p-5">
            <h2 className="text-ink font-semibold text-sm mb-3">📐 Rendu attendu (via labelary.com)</h2>
            {preview.preview_url && (
              <img src={preview.preview_url}
                alt="Rendu ZPL"
                className="w-full border bg-white rounded-xl" />
            )}
            <p className="text-ink-faint text-xs mt-2">
              Rendu serveur, peut légèrement différer du tirage physique (densité d'encre, etc.) mais le layout doit correspondre.
            </p>
          </div>

          {/* Donnees + ZPL brut */}
          <div className="bg-surface border rounded-2xl p-5 space-y-3">
            <h2 className="text-ink font-semibold text-sm">📋 Données envoyées</h2>
            <dl className="grid grid-cols-2 gap-y-1 text-xs">
              <dt className="text-ink-muted">Motif</dt>
              <dd className="text-ink font-mono">{preview.label_data?.motif || '—'}</dd>
              <dt className="text-ink-muted">Date</dt>
              <dd className="text-ink font-mono">{preview.label_data?.date || '—'}</dd>
              <dt className="text-ink-muted">Note</dt>
              <dd className="text-ink font-mono break-all">{preview.label_data?.note || '—'}</dd>
              <dt className="text-ink-muted">QR URL</dt>
              <dd className="text-ink font-mono break-all">{preview.label_data?.qrUrl}</dd>
            </dl>
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-muted hover:text-ink">Voir le ZPL brut</summary>
              <pre className="mt-2 bg-surface-2 p-3 rounded-xl overflow-x-auto text-[11px] leading-tight">
                {preview.zpl}
              </pre>
            </details>
          </div>
        </div>
      )}

      {/* Boutons d'impression cote a cote */}
      {preview?.ok && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Ancien flow */}
          <div className="bg-surface border rounded-2xl p-5">
            <h2 className="text-ink font-semibold text-sm mb-1">🟢 Ancien flow (production)</h2>
            <p className="text-ink-muted text-xs mb-3">
              POST <code className="bg-surface-2 px-1 rounded">/api/helpdesk/{ticketId || 'X'}/print</code><br />
              → PC reçoit les champs métier et compose le ZPL côté PC.
            </p>
            <button onClick={printOld} disabled={loading !== null}
              className="w-full py-2.5 bg-green-600 hover:opacity-90 text-white rounded-xl font-medium text-sm disabled:opacity-40 transition flex items-center justify-center gap-2">
              <Printer size={16} />
              {loading === 'old' ? '...' : 'Imprimer (ancien)'}
            </button>
            {oldResult && (
              <p className={`mt-3 text-xs ${oldResult.ok ? 'text-success' : 'text-critical'}`}>
                {oldResult.ok ? '✓ Imprimé' : `⚠ ${oldResult.error}`}
              </p>
            )}
          </div>

          {/* Nouveau flow */}
          <div className="bg-surface border-2 border-brand/40 rounded-2xl p-5">
            <h2 className="text-ink font-semibold text-sm mb-1">🆕 Nouveau flow (test)</h2>
            <p className="text-ink-muted text-xs mb-3">
              POST <code className="bg-surface-2 px-1 rounded">/api/admin/labels/test-print</code><br />
              → VD Soft compose le ZPL et l'envoie au PC via <code className="bg-surface-2 px-1 rounded">/print-raw</code>.
            </p>
            <button onClick={printNew} disabled={loading !== null}
              className="w-full py-2.5 bg-brand hover:opacity-90 text-white rounded-xl font-medium text-sm disabled:opacity-40 transition flex items-center justify-center gap-2">
              <Printer size={16} />
              {loading === 'new' ? '...' : 'Imprimer (nouveau)'}
            </button>
            {newResult && (
              <p className={`mt-3 text-xs ${newResult.ok ? 'text-success' : 'text-critical'}`}>
                {newResult.ok ? '✓ Imprimé' : `⚠ ${newResult.error}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Instructions pour le snippet PC */}
      <details className="bg-surface border rounded-2xl p-5">
        <summary className="cursor-pointer text-ink font-semibold text-sm">
          📦 Snippet à ajouter sur le PC zebra-serveur pour activer <code>/print-raw</code>
        </summary>
        <pre className="mt-3 bg-surface-2 p-4 rounded-xl overflow-x-auto text-[11px] leading-relaxed">{`// A ajouter dans server.js, AVANT app.listen(...) :

app.post("/print-raw", (req, res) => {
  const { zpl } = req.body;
  if (!zpl || !zpl.includes("^XA")) {
    return res.status(400).json({ ok: false, error: "zpl manquant ou invalide" });
  }
  try {
    const tmpFile = path.join(process.env.TEMP, \`label_raw_\${Date.now()}.zpl\`);
    fs.writeFileSync(tmpFile, zpl, "binary");
    const ps = \`Get-Content -Raw '\${tmpFile}' | Out-Printer -Name '\${PRINTER_NAME}'\`;
    const cmd = \`powershell -Command "\${ps}"\`;
    exec(cmd, (err) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err) {
        console.error("Erreur impression raw:", err.message);
        return res.status(500).json({ ok: false, error: err.message });
      }
      return res.json({ ok: true });
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});`}</pre>
        <p className="text-ink-muted text-xs mt-3">
          Une fois le snippet ajouté et le service ZebraServer redémarré (via Planificateur de tâches Windows),
          le bouton "Imprimer (nouveau)" fonctionne.
        </p>
      </details>
    </div>
  )
}
