'use client'

import { useEffect, useState } from 'react'

export default function TowsoftCreateToggle({ canEdit }: { canEdit: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/admin/towsoft-create').then(r => r.json()).then(j => setEnabled(j.enabled !== false)).catch(() => setEnabled(true))
  }, [])

  async function toggle() {
    if (!canEdit || enabled == null) return
    const next = !enabled
    if (!next && !confirm('Couper la création de fiche dans TowSoft ?\n\nLes missions continueront d\'être créées dans VD Soft (+ ticket Odoo), mais ne seront plus poussées dans TowSoft. La lecture/recherche TowSoft reste active. Réversible.')) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/towsoft-create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const j = await r.json()
      if (r.ok) setEnabled(j.enabled)
    } finally { setBusy(false) }
  }

  return (
    <div className={`rounded-2xl border-2 p-4 flex items-center justify-between gap-4 ${
      enabled === false ? 'bg-amber-50 border-amber-300' : 'bg-surface border'
    }`}>
      <div>
        <p className="text-ink font-semibold text-sm flex items-center gap-2">
          🔌 Création de fiche dans TowSoft
          {enabled === false && <span className="px-2 py-0.5 bg-amber-500 text-white text-[11px] rounded font-bold uppercase">Coupée</span>}
        </p>
        <p className="text-ink-muted text-xs mt-0.5">
          {enabled === false
            ? 'Les missions sont créées dans VD Soft uniquement (ticket Odoo conservé). Push TowSoft désactivé. Lecture TowSoft toujours active.'
            : 'Les missions sont aussi poussées dans TowSoft (double-écriture / backup).'}
        </p>
      </div>
      <button type="button" onClick={toggle} disabled={!canEdit || busy || enabled == null}
        title={canEdit ? '' : 'Réservé au superadmin'}
        className={`relative w-14 h-8 rounded-full transition flex-shrink-0 disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-ink-faint'}`}>
        <span className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-6' : ''}`} />
      </button>
    </div>
  )
}
