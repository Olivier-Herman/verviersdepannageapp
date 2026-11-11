'use client'

// Raison demandée quand on force une fiche « à facturer » (R6, Olivier 11/11/2026) :
// la raison s'affiche dans « Pourquoi ça bloque » et dans le journal, pour corriger
// les causes à la source. Forcer reste toujours possible.

import { useState } from 'react'

export const RAISONS_FORCAGE = [
  'Clôture chauffeur oubliée',
  'L’assistance ne répond pas',
  'Facturé autrement',
] as const

export default function RaisonForcage({ onChoix, onAnnuler, busy }: { onChoix: (raison: string) => void; onAnnuler: () => void; busy?: boolean }) {
  const [autre, setAutre] = useState(false)
  const [texte, setTexte] = useState('')
  return (
    <div className="rounded-xl border-2 border-success/40 bg-success/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-ink text-sm font-semibold">Pourquoi forcer « à facturer » ?<span className="block text-ink-muted text-xs font-normal">La fiche passe à facturer sans pointage ni photos. La raison aide à corriger la cause.</span></p>
        <button type="button" onClick={onAnnuler} aria-label="Fermer" className="w-9 h-9 rounded-lg border text-ink-secondary">✕</button>
      </div>
      {RAISONS_FORCAGE.map(r => (
        <button key={r} type="button" disabled={busy} onClick={() => onChoix(r)} className="w-full min-h-[44px] px-3 rounded-lg border bg-surface text-left text-sm text-ink hover:border-success disabled:opacity-50">{r}</button>
      ))}
      {!autre
        ? <button type="button" disabled={busy} onClick={() => setAutre(true)} className="w-full min-h-[44px] px-3 rounded-lg border bg-surface text-left text-sm text-ink hover:border-success disabled:opacity-50">Autre…</button>
        : <div className="flex gap-2 flex-wrap">
            <input autoFocus value={texte} onChange={e => setTexte(e.target.value)} placeholder="Précise en quelques mots" aria-label="Autre raison" className="flex-1 min-w-[180px] min-h-[44px] border rounded-lg px-3 text-sm bg-surface text-ink" />
            <button type="button" disabled={busy || !texte.trim()} onClick={() => onChoix(`Autre : ${texte.trim()}`)} className="min-h-[44px] px-4 rounded-lg bg-success text-white text-sm font-bold disabled:opacity-40">Forcer</button>
          </div>}
    </div>
  )
}
