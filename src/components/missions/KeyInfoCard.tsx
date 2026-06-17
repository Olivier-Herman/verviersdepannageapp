'use client'

// Clés de la fiche d'intervention, en 2 morceaux contrôlés par le parent :
//   - <KeyTag>      : l'étiquette porte-clé (dessin) affichée dans le bandeau
//                     Position parc (n° crochet, sinon IN / NO).
//   - <KeyControls> : emplacement (boutons) + champ n° crochet, dans un bloc
//                     dédié au-dessus des Remarques. Champ crochet masqué si
//                     « Pas de clé ».
// Olivier 2026-06-18.

import { KEY_LOCATIONS, keyTagValue } from '@/lib/key-location'

export function isSaisieSource(source: string): boolean {
  return source.startsWith('police') || source === 'prive' || source === 'sia_couvert'
}

// ── Étiquette porte-clé (dessin) ────────────────────────────────────────────
export function KeyTag({ keyLocation, hook }: { keyLocation?: string | null; hook?: string | null }) {
  return (
    <div className="relative flex items-center justify-center w-16 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-md flex-shrink-0"
      title="Clé : n° crochet, sinon IN (dans le véhicule) / NO (pas de clé)">
      <span className="absolute top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white/70 border border-amber-700/40" />
      <span className="mt-1.5 text-white font-extrabold text-xl tabular-nums leading-none">
        {keyTagValue(keyLocation, hook)}
      </span>
    </div>
  )
}

// ── Contrôles clé (emplacement + crochet) ───────────────────────────────────
export function KeyControls({ source, keyLocation, hookInput, savedHook, busy, onPick, onHookChange, onHookSave }: {
  source:       string
  keyLocation:  string
  hookInput:    string
  savedHook:    string
  busy?:        boolean
  onPick:       (v: string) => void
  onHookChange: (v: string) => void
  onHookSave:   () => void
}) {
  const isSaisie = isSaisieSource(source)
  const showHook = isSaisie && keyLocation !== 'no_key'

  return (
    <div className="bg-surface border rounded-2xl p-5 md-card-enter">
      <h3 className="text-ink-muted text-xs font-medium uppercase tracking-wide mb-3">🔑 Clés</h3>

      <p className="text-ink-muted text-sm mb-2">Emplacement de la clé</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {KEY_LOCATIONS.map(k => {
          const selected = keyLocation === k.value
          return (
            <button key={k.value} onClick={() => onPick(k.value)} disabled={busy}
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

      {showHook && (
        <div className="mt-4">
          <p className="text-ink-muted text-sm mb-2">Crochet boîte à clés (bureau)</p>
          <div className="flex gap-2">
            <input
              value={hookInput}
              onChange={e => onHookChange(e.target.value)}
              onBlur={onHookSave}
              placeholder="N° crochet"
              inputMode="numeric"
              className="flex-1 bg-surface border rounded-xl px-3 py-2 text-ink text-sm focus:border-brand outline-none"
            />
            <button onClick={onHookSave} disabled={busy || hookInput.trim() === savedHook}
              className="px-4 py-2 bg-brand hover:bg-brand/80 text-white rounded-xl text-sm font-semibold disabled:opacity-40">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
