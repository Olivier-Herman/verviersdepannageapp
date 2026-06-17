'use client'

// Carte « Clés » de la fiche d'intervention :
//   - Emplacement de la clé (choisi par le chauffeur à la mise en parc, modifiable
//     ici par le bureau).
//   - Pour les appels police / privé : n° du crochet de la boîte à clés du bureau,
//     affiché comme une étiquette porte-clé bien visible.
// Olivier 2026-06-18.

import { useState } from 'react'
import { KEY_LOCATIONS, KEY_LOCATION_LABELS, keyTagValue } from '@/lib/key-location'

export default function KeyInfoCard({ missionId, source, status, keyLocation, saisieKeyHook, embedded }: {
  missionId:      string
  source:         string
  status?:        string
  keyLocation?:   string | null
  saisieKeyHook?: string | null
  embedded?:      boolean   // intégré dans un bandeau parent (pas de carte propre)
}) {
  // « Saisie » au sens large = tout appel police + appel privé.
  const isSaisie = source.startsWith('police') || source === 'prive' || source === 'sia_couvert'

  const [loc, setLoc]       = useState(keyLocation || '')
  const [hook, setHook]     = useState(saisieKeyHook || '')
  const [savedHook, setSavedHook] = useState(saisieKeyHook || '')
  const [busy, setBusy]     = useState(false)

  // Pertinent pour les véhicules en parc ou les appels police/privé.
  if (!keyLocation && !isSaisie && status !== 'parked') return null

  const patch = async (body: Record<string, any>) => {
    setBusy(true)
    try {
      await fetch(`/api/missions/${missionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
    } finally { setBusy(false) }
  }

  const chooseLocation = (v: string) => { setLoc(v); patch({ key_location: v }) }
  const saveHook = async () => {
    const val = hook.trim()
    if (val === savedHook) return
    await patch({ saisie_key_hook: val || null })
    setSavedHook(val)
  }

  const wrapClass = embedded
    ? 'w-full mt-4 pt-4 border-t border-amber-500/30'
    : 'bg-surface border rounded-2xl p-5 md-card-enter'

  return (
    <div className={wrapClass}>
      <h3 className={`text-xs font-medium uppercase tracking-wide mb-3 ${embedded ? 'text-amber-500 font-bold' : 'text-ink-muted'}`}>🔑 Clés</h3>

      {/* Emplacement — boutons (choix chauffeur, modifiable bureau) */}
      <p className="text-ink-muted text-sm mb-2">Emplacement de la clé</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-1">
        {KEY_LOCATIONS.map(k => {
          const selected = loc === k.value
          return (
            <button key={k.value} onClick={() => chooseLocation(k.value)} disabled={busy}
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-left text-xs transition disabled:opacity-50 ${
                selected ? 'bg-amber-500/15 border border-amber-500/60 text-amber-700 dark:text-amber-300 font-semibold'
                         : 'bg-surface-2 border text-ink-secondary hover:border-amber-500/40'
              }`}>
              <span className="text-base flex-shrink-0">{k.icon}</span>
              <span className="leading-tight">{k.label}</span>
            </button>
          )
        })}
      </div>

      {/* Crochet boîte à clés bureau — appels police / privé */}
      {isSaisie && (
        <div className="mt-4">
          <p className="text-ink-muted text-sm mb-2">Crochet boîte à clés (bureau)</p>
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-20 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-md flex-shrink-0">
              <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white/70 border border-amber-700/40" />
              <span className="mt-2 text-white font-extrabold text-2xl tabular-nums leading-none">
                {keyTagValue(loc, savedHook)}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex gap-2">
                <input
                  value={hook}
                  onChange={e => setHook(e.target.value)}
                  onBlur={saveHook}
                  placeholder="N° crochet"
                  inputMode="numeric"
                  className="flex-1 bg-surface border rounded-xl px-3 py-2 text-ink text-sm focus:border-brand outline-none"
                />
                <button onClick={saveHook} disabled={busy || hook.trim() === savedHook}
                  className="px-3 py-2 bg-brand hover:bg-brand/80 text-white rounded-xl text-sm font-semibold disabled:opacity-40">
                  OK
                </button>
              </div>
              <p className="text-ink-faint text-xs mt-1">Vide → étiquette « IN » (clé dans le véhicule) ou « NO » (pas de clé).</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
