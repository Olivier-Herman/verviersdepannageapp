'use client'

import { useState } from 'react'
import { Printer, X, Loader2, Eye } from 'lucide-react'

interface Template {
  key:         string
  name:        string
  icon:        string
  category:    string
  description: string
  data_source: string
}

interface PrintResponse {
  ok:           boolean
  error?:       string
  qty?:         number
  ok_count?:    number
  template_key?: string
  label_data?:  any
  zpl?:         string
  preview_url?: string
  errors?:      string[]
}

const CATEGORY_LABEL: Record<string, string> = {
  mission: 'Lié à une mission',
  fixe:    'Étiquette statique',
  societe: 'Société récurrente',
}

const DATA_SOURCE_LABEL: Record<string, string> = {
  odoo_ticket: 'Ticket Helpdesk Odoo',
  mission:     'Mission VD Soft',
  static:      'Aucune donnée requise',
}

export default function LabelsLibraryClient({ templates }: { templates: Template[] }) {
  const [openTemplate, setOpenTemplate] = useState<Template | null>(null)

  // Grouper par catégorie pour l affichage
  const groups: Record<string, Template[]> = {}
  for (const t of templates) {
    if (!groups[t.category]) groups[t.category] = []
    groups[t.category].push(t)
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="text-ink font-bold text-2xl">🏷️ Bibliothèque d'étiquettes</h1>
        <p className="text-ink-muted text-sm mt-1">
          Templates ZPL pour l'imprimante Zebra. Cliquer un template pour le configurer + imprimer.
        </p>
      </header>

      {Object.entries(groups).map(([category, list]) => (
        <section key={category} className="space-y-3">
          <h2 className="text-ink-muted text-xs uppercase tracking-wider font-semibold">
            {CATEGORY_LABEL[category] || category}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {list.map(t => (
              <button key={t.key} type="button"
                onClick={() => setOpenTemplate(t)}
                className="text-left bg-surface border rounded-2xl p-4 hover:border-brand/40 hover:shadow-md transition">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center text-2xl flex-shrink-0">
                    {t.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-ink font-semibold text-sm">{t.name}</h3>
                    <p className="text-ink-muted text-xs mt-0.5 line-clamp-2">{t.description}</p>
                    <p className="text-ink-faint text-[10px] uppercase tracking-wider mt-1">
                      {DATA_SOURCE_LABEL[t.data_source]}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {openTemplate && (
        <PrintModal template={openTemplate} onClose={() => setOpenTemplate(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Modal d impression : preview + qty + bouton imprimer
// ─────────────────────────────────────────────────────────────────────
function PrintModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const [ticketId,  setTicketId]  = useState('')
  const [missionId, setMissionId] = useState('')
  const [qty,       setQty]       = useState('1')
  const [preview,   setPreview]   = useState<PrintResponse | null>(null)
  const [printing,  setPrinting]  = useState(false)
  const [printRes,  setPrintRes]  = useState<PrintResponse | null>(null)

  const needsTicket  = template.data_source === 'odoo_ticket'
  const needsMission = template.data_source === 'mission'
  const sourceReady  = (needsTicket && ticketId) || (needsMission && missionId) || template.data_source === 'static'

  async function doPreview() {
    setPreview(null); setPrintRes(null)
    const params = new URLSearchParams({ template_key: template.key })
    if (needsTicket)  params.set('ticket_id',  ticketId)
    if (needsMission) params.set('mission_id', missionId)
    const r = await fetch(`/api/admin/labels/print?${params}`)
    const j = await r.json()
    setPreview(j)
  }

  async function doPrint() {
    if (!sourceReady) return
    setPrinting(true); setPrintRes(null)
    try {
      const body: any = { template_key: template.key, qty: parseInt(qty) || 1 }
      if (needsTicket)  body.ticket_id  = parseInt(ticketId)
      if (needsMission) body.mission_id = missionId
      const r = await fetch('/api/admin/labels/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      setPrintRes(await r.json())
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}>
      <div className="bg-surface border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <header className="px-5 py-4 border-b flex items-center justify-between sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center text-2xl">
              {template.icon}
            </div>
            <div>
              <h2 className="text-ink font-bold text-base">{template.name}</h2>
              <p className="text-ink-muted text-xs">{DATA_SOURCE_LABEL[template.data_source]}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-ink-muted hover:text-ink p-1.5 rounded-md hover:bg-surface-hover">
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-ink-muted text-sm">{template.description}</p>

          {/* Saisie de la donnée source */}
          {needsTicket && (
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">ID Ticket Helpdesk Odoo</label>
              <input value={ticketId}
                onChange={e => setTicketId(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="ex: 1346"
                className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-base font-mono focus:outline-none focus:border-brand" />
            </div>
          )}
          {needsMission && (
            <div>
              <label className="block text-ink-muted text-xs mb-1.5">ID Mission VD Soft (UUID)</label>
              <input value={missionId}
                onChange={e => setMissionId(e.target.value)}
                placeholder="ex: 7b3e8c2a-..."
                className="w-full bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-sm font-mono focus:outline-none focus:border-brand" />
            </div>
          )}

          {/* Bouton aperçu */}
          <button onClick={doPreview} disabled={!sourceReady || printing}
            className="w-full py-2.5 bg-surface-2 hover:bg-surface-hover border text-ink rounded-xl text-sm font-medium disabled:opacity-40 transition flex items-center justify-center gap-2">
            <Eye size={14} />
            Aperçu (sans imprimer)
          </button>

          {/* Erreur preview */}
          {preview && !preview.ok && (
            <div className="bg-critical-soft border border-critical rounded-xl p-3 text-critical text-sm">
              ⚠ {preview.error}
            </div>
          )}

          {/* Preview + impression */}
          {preview?.ok && (
            <>
              <div className="bg-surface-2 border rounded-2xl p-4">
                <p className="text-ink-muted text-xs mb-2">Rendu attendu (via labelary.com)</p>
                {preview.preview_url && (
                  <img src={preview.preview_url} alt="Rendu ZPL"
                    className="w-full border bg-white rounded-xl" />
                )}
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-ink-muted hover:text-ink">Voir les données + ZPL brut</summary>
                <pre className="mt-2 bg-surface-2 p-3 rounded-xl overflow-x-auto text-[11px] leading-tight">
{JSON.stringify(preview.label_data, null, 2)}

{preview.zpl}
                </pre>
              </details>

              <div className="flex items-end gap-3 pt-2 border-t">
                <div className="flex-shrink-0">
                  <label className="block text-ink-muted text-xs mb-1.5">Quantité</label>
                  <input type="number" min="1" max="20"
                    value={qty}
                    onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ''))}
                    className="w-20 bg-surface-2 border rounded-xl px-3 py-2.5 text-ink text-base font-mono text-center focus:outline-none focus:border-brand" />
                </div>
                <button onClick={doPrint} disabled={!sourceReady || printing}
                  className="flex-1 py-2.5 bg-brand hover:opacity-90 text-white rounded-xl text-sm font-bold disabled:opacity-40 transition flex items-center justify-center gap-2">
                  {printing
                    ? <><Loader2 size={16} className="animate-spin" /> Impression...</>
                    : <><Printer size={16} /> Imprimer {parseInt(qty) > 1 ? `× ${qty}` : ''}</>}
                </button>
              </div>

              {printRes && (
                <div className={`rounded-xl p-3 text-sm ${printRes.ok ? 'bg-success-soft text-success border border-success/30' : 'bg-critical-soft text-critical border border-critical/30'}`}>
                  {printRes.ok
                    ? `✓ ${printRes.ok_count}/${printRes.qty} étiquette${(printRes.qty || 1) > 1 ? 's' : ''} imprimée${(printRes.qty || 1) > 1 ? 's' : ''}`
                    : <>⚠ {printRes.error || (printRes.errors || []).join(' / ') || 'Erreur impression'}</>}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
