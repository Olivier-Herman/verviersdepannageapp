'use client'

// « Mettre en vente » — passerelle entre la fiche et le module Ventes.
//
// N'apparaît que si l'abandon est enregistré : sans abandon, le véhicule ne
// nous appartient pas et n'a rien à faire dans une annonce. Les saisies police
// sont exclues en amont (l'abandon y est impossible), et l'API refuse de toute
// façon. Le lot est créé en brouillon, prérempli depuis la fiche — on complète
// et on publie depuis /admin/ventes. Olivier 2026-08-20.

import { useState }  from 'react'
import { useRouter } from 'next/navigation'

export default function MettreEnVenteButton({
  missionId, abandonAt, source,
}: {
  missionId: string
  abandonAt: string | null
  source:    string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState<string | null>(null)

  if (!abandonAt) return null
  if ((source || '').toLowerCase().trim() === 'police_saisie') return null

  const go = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/ventes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: missionId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Création impossible.')
      router.push('/admin/ventes')
    } catch (e: any) { setErr(e?.message || 'Erreur') } finally { setBusy(false) }
  }

  return (
    <div className="w-full space-y-1.5">
      <button type="button" onClick={go} disabled={busy}
        className="w-full py-3 bg-surface-2 hover:bg-surface border border-app text-ink rounded-2xl text-sm font-semibold transition flex items-center justify-center gap-2 disabled:opacity-50">
        🚗 {busy ? 'Création…' : 'Mettre en vente'}
      </button>
      {err && <p className="text-critical text-xs">⚠ {err}</p>}
    </div>
  )
}
