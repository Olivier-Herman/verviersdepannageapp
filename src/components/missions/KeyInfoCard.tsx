'use client'

// Carte « Clés » de la fiche d'intervention :
//   - Emplacement de la clé (choisi par le chauffeur à la mise en parc).
//   - Pour les SAISIES : n° du crochet de la boîte à clés du bureau, saisi ici
//     et affiché comme une étiquette porte-clé bien visible.
// Olivier 2026-06-18.

import { useState } from 'react'
import { KEY_LOCATION_LABELS, keyTagValue } from '@/lib/key-location'

export default function KeyInfoCard({ missionId, source, keyLocation, saisieKeyHook }: {
  missionId:     string
  source:        string
  keyLocation?:  string | null
  saisieKeyHook?: string | null
}) {
  const isSaisie = source === 'police_saisie'
  const [hook, setHook]       = useState(saisieKeyHook || '')
  const [saved, setSaved]     = useState(saisieKeyHook || '')
  const [saving, setSaving]   = useState(false)

  const saveHook = async () => {
    const val = hook.trim()
    if (val === saved) return
    setSaving(true)
    try {
      const r = await fetch(`/api/missions/${missionId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saisie_key_hook: val || null }),
      })
      if (r.ok) setSaved(val)
    } finally { setSaving(false) }
  }

  // Rien à afficher si pas d'info clé et pas une saisie (pas de crochet à saisir).
  if (!keyLocation && !isSaisie) return null

  return (
    <div className="bg-surface border rounded-2xl p-5 md-card-enter">
      <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">🔑 Clés</h3>

      {keyLocation && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-ink-muted text-sm">Emplacement</span>
          <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 text-sm font-semibold">
            {KEY_LOCATION_LABELS[keyLocation] || keyLocation}
          </span>
        </div>
      )}

      {isSaisie && (
        <div>
          <p className="text-ink-muted text-sm mb-2">Crochet boîte à clés (bureau)</p>
          <div className="flex items-center gap-3">
            {/* Étiquette porte-clé design */}
            <div className="relative flex items-center justify-center w-20 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-md">
              <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white/70 border border-amber-700/40" />
              <span className="mt-2 text-white font-extrabold text-2xl tabular-nums leading-none">
                {keyTagValue(keyLocation, saved)}
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
                <button onClick={saveHook} disabled={saving || hook.trim() === saved}
                  className="px-3 py-2 bg-brand hover:bg-brand/80 text-white rounded-xl text-sm font-semibold disabled:opacity-40">
                  {saving ? '…' : 'OK'}
                </button>
              </div>
              <p className="text-ink-faint text-xs mt-1">Numéro du crochet où la clé est rangée.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
