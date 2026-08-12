'use client'
// src/components/cloture/ActionScreen.tsx
//
// FLUX 2 — la page « Action » (Olivier 2026-08-11).
//
// Une VRAIE page, pas un menu contextuel : une fois sur place, un seul bouton mène
// ici, et le chauffeur y trouve toutes les issues possibles, regroupées par
// RÉSULTAT (« le véhicule repart » / « ne repart pas » / « rien à faire ») plutôt
// que par vocabulaire interne.
//
// La prise en charge (Siabis couvert / non couvert) est EN HAUT : ce n'est pas une
// issue concurrente mais un marqueur de tarif, et un marqueur qu'on ne voit pas
// sans faire défiler ne sera jamais utilisé.

import { useEffect, useState } from 'react'

export type OutcomeKey = 'dsp' | 'rem' | 'rem_vr' | 'rem2dsp' | 'delivered' | 'park' | 'dpr'

interface OutcomeItem { key: OutcomeKey; label: string; icon: string; group: string }

export type PriseEnCharge = 'standard' | 'sia_couvert' | 'police_snc'

const PRISE_OPTIONS: { key: PriseEnCharge; label: string }[] = [
  { key: 'standard',    label: 'Standard' },
  { key: 'sia_couvert', label: 'Siabis couvert' },
  { key: 'police_snc',  label: 'Siabis non couvert' },
]

const GROUP_TITLES: Record<string, string> = {
  repart:      'Le véhicule repart',
  repart_pas:  'Le véhicule ne repart pas',
  charge:      'Le véhicule est chargé',
  rien:        'Rien à faire sur place',
}

export default function ActionScreen({
  missionId, plate, vehicle, prise, onPrise, balisage, onBalisage, onDprCodes, onPick, onBack,
}: {
  missionId: string
  plate?: string | null
  vehicle?: string | null
  prise: PriseEnCharge
  onPrise: (p: PriseEnCharge) => void
  /** Balisage posé sur place — entre dans le tarif Siabis. */
  balisage: boolean
  onBalisage: (v: boolean) => void
  /** Codes d'annulation autorisés par l'assistance (déplacement pour rien). */
  onDprCodes?: (codes: { code: string; label: string }[]) => void
  onPick: (outcome: OutcomeKey) => void
  onBack: () => void
}) {
  const [outcomes, setOutcomes] = useState<OutcomeItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/missions/${missionId}/cloture`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        if (d.error) { setErr(d.error); return }
        setOutcomes(d.outcomes || [])
        if (onDprCodes) onDprCodes(d.dprCodes || [])
      })
      .catch(() => alive && setErr('Impossible de charger les actions'))
    return () => { alive = false }
  }, [missionId])

  const groups = ['repart', 'repart_pas', 'charge', 'rien']
  const btn = (o: OutcomeItem) => {
    const style =
      o.key === 'dsp' || o.key === 'rem2dsp' ? 'bg-green-600 text-white'
      : o.key === 'rem'    ? 'bg-amber-500 text-ink'
      : o.key === 'rem_vr' ? 'bg-surface border border-amber-500/50 text-amber-700 dark:text-amber-300'
      : o.key === 'delivered' ? 'bg-green-600 text-white'
      : o.key === 'park'   ? 'bg-amber-500 text-ink'
      : 'bg-surface border border text-ink-secondary'
    return (
      <button key={o.key} onClick={() => onPick(o.key)}
        className={`w-full py-4 px-4 rounded-2xl font-bold text-base flex items-center gap-2.5 justify-center transition active:scale-[.99] ${style}`}>
        <span>{o.icon}</span>{o.label}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-surface z-40 flex flex-col">
      <div className="bg-surface border-b border px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 flex items-center justify-center bg-surface-hover rounded-xl text-ink">←</button>
          <div className="flex-1 min-w-0">
            <p className="text-ink font-semibold truncate">Que s'est-il passé ?</p>
            <p className="text-ink-muted text-xs truncate">{[vehicle, plate].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {err && <div className="bg-red-500/10 text-red-500 rounded-xl px-3 py-3 text-sm">{err}</div>}
        {!outcomes && !err && <p className="text-ink-muted text-sm py-6 text-center">Chargement…</p>}

        {outcomes && (
          <>
            {/* Prise en charge — marqueur de tarif, toujours visible en premier. */}
            <p className="text-ink-muted text-[11px] uppercase tracking-widest font-bold">
              Prise en charge <span className="normal-case tracking-normal font-medium text-ink-faint">— change le tarif</span>
            </p>
            <div className="flex gap-2">
              {PRISE_OPTIONS.map(p => (
                <button key={p.key} onClick={() => onPrise(p.key)}
                  className={`flex-1 py-2.5 px-1 rounded-xl text-[11px] font-bold leading-tight border transition ${
                    prise === p.key
                      ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300'
                      : 'border bg-surface-2 text-ink-secondary'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Balisage — JUSTE sous les boutons Siabis et AVANT le choix de
                l'issue : posé plus tard, il fausse le montant déjà annoncé au
                client. Aucun euro affiché ici, le chauffeur répond à une question
                de terrain. Non par défaut. Olivier 2026-08-12. */}
            {prise !== 'standard' && (
              <div className="space-y-2 pt-1">
                <p className="text-ink font-bold text-[15px]">🚧 Balisage</p>
                <div className="flex gap-2">
                  {[{ v: true, l: 'Oui' }, { v: false, l: 'Non' }].map(o => (
                    <button key={o.l} onClick={() => onBalisage(o.v)}
                      className={`flex-1 py-3.5 rounded-xl text-base font-extrabold border transition ${
                        balisage === o.v
                          ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-300'
                          : 'border bg-surface-2 text-ink-secondary'
                      }`}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {groups.map(g => {
              const items = outcomes.filter(o => o.group === g)
              if (items.length === 0) return null
              return (
                <div key={g} className="space-y-2 pt-1">
                  <p className="text-ink-muted text-[11px] uppercase tracking-widest font-bold">{GROUP_TITLES[g]}</p>
                  {items.map(btn)}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="px-4 py-4 border-t border">
        <button onClick={onBack} className="w-full py-3 bg-surface-hover text-ink-secondary rounded-2xl text-sm font-semibold">
          ← Retour à la mission
        </button>
      </div>
    </div>
  )
}
