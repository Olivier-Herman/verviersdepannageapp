// src/components/ui/Bandeau.tsx
//
// Habillage commun des écrans Fourrière et Facturation (préversion `ma_journee`,
// Olivier seul, 11/11/2026) : bandeau sombre en dégradé + tuiles-compteurs qui
// filtrent. Même rendu que Ma journée et Touring à valider. Les écrans gardent
// leurs données et leurs boutons : seul l'emballage change quand `habille`.

import type { ReactNode } from 'react'

export type Teinte = 'rouge' | 'vert' | 'violet' | 'ambre' | 'bleu' | 'ardoise'
const TEINTE: Record<Teinte, string> = {
  rouge: '#6d111c', vert: '#0f5953', violet: '#4c1d95', ambre: '#92400e', bleu: '#1e3a8a', ardoise: '#334155',
}

/** Conteneur large, qui ne peut pas élargir la page sur téléphone. */
export const CONTENEUR_HABILLE = 'px-3 lg:px-6 py-5 space-y-4 max-w-[1800px] min-w-0 [contain:inline-size] mx-auto'

export function Bandeau({ titre, sousTitre, teinte = 'rouge', droite, children }: {
  titre: ReactNode; sousTitre?: ReactNode; teinte?: Teinte; droite?: ReactNode; children?: ReactNode
}) {
  return (
    <div className="rounded-3xl text-white shadow-md p-5 lg:p-7 flex items-end justify-between flex-wrap gap-4"
      style={{ background: `radial-gradient(120% 160% at 100% 0%, ${TEINTE[teinte]} 0%, #17110f 62%)` }}>
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="text-2xl lg:text-3xl font-extrabold tracking-tight">{titre}</h1>
        {sousTitre && <p className="text-white/75 text-sm mt-1 [&_b]:text-white [&_strong]:text-white">{sousTitre}</p>}
        {children}
      </div>
      {droite && <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">{droite}</div>}
    </div>
  )
}

/** Champ de recherche et boutons ronds dans le bandeau. */
export const RECHERCHE_BANDEAU = 'w-full sm:w-80 bg-white/10 border border-white/25 rounded-2xl pl-4 pr-9 min-h-[48px] text-base text-white placeholder:text-white/60 focus:outline-none focus:border-white'
export const BOUTON_BANDEAU = 'min-h-[48px] min-w-[48px] px-3 bg-white/10 hover:bg-white/20 border border-white/25 rounded-2xl text-sm font-semibold text-white disabled:opacity-50'

export interface Tuile { key: string; label: ReactNode; n: number | string; dot?: string; cls?: string; help?: string }
/** Compteurs en tuiles : un clic filtre. `cls` = couleurs (ex. 'bg-amber-50 border-amber-300 text-amber-900'). */
export function Tuiles({ items, actif, onChoix, colonnes = 5 }: { items: Tuile[]; actif?: string; onChoix?: (k: string) => void; colonnes?: 3 | 4 | 5 | 6 | 7 }) {
  const lg = { 3: 'lg:grid-cols-[repeat(3,minmax(0,1fr))]', 4: 'lg:grid-cols-[repeat(4,minmax(0,1fr))]', 5: 'lg:grid-cols-[repeat(5,minmax(0,1fr))]', 6: 'lg:grid-cols-[repeat(6,minmax(0,1fr))]', 7: 'lg:grid-cols-[repeat(7,minmax(0,1fr))]' }[colonnes]
  return (
    <div className={`grid grid-cols-[repeat(2,minmax(0,1fr))] sm:grid-cols-[repeat(3,minmax(0,1fr))] ${lg} gap-2 sm:gap-3`}>
      {items.map(t => {
        const Tag = onChoix ? 'button' : 'div'
        return (
          <Tag key={t.key} {...(onChoix ? { onClick: () => onChoix(t.key), type: 'button' as const } : {})} title={t.help}
            className={`text-left rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 min-h-[64px] sm:min-h-[80px] border shadow-sm ${t.cls || 'bg-surface text-ink'} ${actif === t.key ? 'ring-2 ring-current ring-offset-2 ring-offset-surface' : ''}`}>
            <b className="block text-2xl sm:text-3xl font-extrabold leading-none tabular-nums">{t.n}</b>
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold mt-1">{t.dot && <span className={`inline-block w-2 h-2 rounded-full ${t.dot}`} />}{t.label}</span>
          </Tag>
        )
      })}
    </div>
  )
}

/** Couleurs de tuile à partir de la pastille d'un onglet existant (bg-red-500 → tuile rouge claire). */
export function teinteDePastille(dot?: string): string {
  const m = /bg-(\w+)-\d+/.exec(dot || '')
  const c = m?.[1]
  const T: Record<string, string> = {
    amber: 'bg-amber-50 border-amber-300 text-amber-900', red: 'bg-red-50 border-red-300 text-red-800', violet: 'bg-violet-50 border-violet-300 text-violet-900',
    purple: 'bg-purple-50 border-purple-300 text-purple-900', sky: 'bg-sky-50 border-sky-300 text-sky-900', teal: 'bg-teal-50 border-teal-300 text-teal-900',
    green: 'bg-green-50 border-green-300 text-green-900', emerald: 'bg-emerald-50 border-emerald-300 text-emerald-900', blue: 'bg-blue-50 border-blue-300 text-blue-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-700', orange: 'bg-orange-50 border-orange-300 text-orange-900', indigo: 'bg-indigo-50 border-indigo-300 text-indigo-900',
  }
  return (c && T[c]) || 'bg-surface text-ink'
}
