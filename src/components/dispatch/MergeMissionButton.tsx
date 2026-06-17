'use client'

// Bouton + modal de fusion de fiches en double.
// La fiche courante est la PRINCIPALE conservée ; on y fusionne une fiche
// candidate (même plaque). Olivier 2026-06-17.

import { useState } from 'react'

interface Candidate {
  id:              string
  mission_number:  number | null
  source:          string
  status:          string
  mission_type:    string | null
  vehicle_brand:   string | null
  vehicle_model:   string | null
  client_name:     string | null
  billed_to_name:  string | null
  dossier_number:  string | null
  incident_address: string | null
}

export default function MergeMissionButton({ missionId, onMerged }: { missionId: string; onMerged?: () => void }) {
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const [cands, setCands]     = useState<Candidate[] | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [merging, setMerging] = useState<string | null>(null)

  const openModal = async () => {
    setOpen(true); setError(null)
    if (cands) return
    setLoading(true)
    try {
      const r = await fetch(`/api/missions/${missionId}/merge`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setCands(j.candidates || [])
    } catch (e: any) { setError(e.message || 'Erreur de chargement') }
    finally { setLoading(false) }
  }

  const doMerge = async (c: Candidate) => {
    const ref = c.mission_number != null ? `#${c.mission_number}` : c.id.slice(0, 8)
    if (!confirm(`Fusionner la fiche ${ref} dans cette fiche ?\n\nCette fiche est conservée (photos, parc, encaissement). La fiche ${ref} sera annulée et son payeur/dossier rapatriés ici.`)) return
    setMerging(c.id); setError(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secondary_mission_id: c.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Erreur')
      setOpen(false)
      if (onMerged) onMerged(); else window.location.reload()
    } catch (e: any) { setError(e.message || 'Échec de la fusion') }
    finally { setMerging(null) }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="w-full py-2.5 bg-surface-2 hover:bg-surface border rounded-2xl text-ink-secondary text-sm font-medium transition">
        🔗 Fusionner une fiche en double
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-surface border rounded-2xl p-5 max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-ink font-semibold">Fusionner une fiche en double</h3>
              <button onClick={() => setOpen(false)} className="text-ink-muted text-2xl leading-none">×</button>
            </div>
            <p className="text-ink-muted text-xs mb-4">
              Cette fiche est <strong>conservée</strong> (photos, parc, encaissement). La fiche choisie sera annulée ; son <strong>payeur / dossier</strong> et infos manquantes sont rapatriés ici.
            </p>

            {error && <p className="text-error text-sm mb-3">{error}</p>}
            {loading && <p className="text-ink-muted text-sm">⏳ Recherche des fiches en double…</p>}

            {cands && cands.length === 0 && (
              <p className="text-ink-muted text-sm">Aucune autre fiche active avec la même plaque.</p>
            )}

            <div className="space-y-2">
              {cands?.map(c => {
                const ref = c.mission_number != null ? `#${c.mission_number}` : c.id.slice(0, 8)
                return (
                  <button key={c.id} onClick={() => doMerge(c)} disabled={!!merging}
                    className="w-full text-left bg-surface-2 hover:border-brand/50 border rounded-xl p-3 transition disabled:opacity-50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-ink">{ref}</span>
                      <span className="text-xs text-ink-muted uppercase">{c.source}</span>
                    </div>
                    <p className="text-ink-secondary text-xs mt-1">
                      {[c.vehicle_brand, c.vehicle_model].filter(Boolean).join(' ')}
                      {c.client_name ? ` · ${c.client_name}` : ''}
                    </p>
                    {(c.billed_to_name || c.dossier_number) && (
                      <p className="text-ink-faint text-xs mt-0.5">
                        {c.billed_to_name ? `Payeur : ${c.billed_to_name}` : ''}{c.billed_to_name && c.dossier_number ? ' · ' : ''}{c.dossier_number ? `Dossier ${c.dossier_number}` : ''}
                      </p>
                    )}
                    {merging === c.id && <p className="text-brand text-xs mt-1">⏳ Fusion…</p>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
