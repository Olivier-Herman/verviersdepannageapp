'use client'

import { useState } from 'react'

/**
 * Bouton « Relancer la complétion » pour les missions Allianz/Mondial (Hexalite).
 * Re-remplit les champs vides de la fiche depuis l'API Hexalite (non destructif).
 */
export default function AllianzCompleteButton({ missionId, onDone }: {
  missionId: string
  onDone?:   () => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState<string | null>(null)

  async function run() {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch(`/api/missions/${missionId}/allianz-complete`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        setMsg(`⚠ ${j.reason || 'Échec de la complétion'}`)
      } else if ((j.filled || []).length === 0) {
        setMsg('✅ Fiche déjà complète (rien à compléter)')
      } else {
        setMsg(`✅ Complétée : ${(j.filled || []).join(', ')}`)
        onDone?.()
      }
    } catch {
      setMsg('⚠ Erreur réseau')
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(null), 6000)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="w-full py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-2xl text-sm font-bold shadow-lg shadow-sky-600/20 transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {busy ? '⏳ Complétion…' : '🔄 Relancer la complétion (Hexalite)'}
      </button>
      {msg && <p className="text-ink-secondary text-xs mt-1.5 text-center">{msg}</p>}
    </div>
  )
}
