'use client'
// Clôture forcée par le bureau d'une mission Touring jamais clôturée chez eux (Olivier 28/11/2026 : « il faut que tout
// se clôture »). Le bureau dit ce qui s'est passé et choisit le motif ; la clôture part chez Touring avec le forçage.
import { useState } from 'react'

export interface ChoixTouring { outcome: 'dsp' | 'delivered' | 'dpr'; motifKey?: string; dprCode?: string }
type Opt = { key: string; label: string; icon?: string }

const ISSUES: { key: ChoixTouring['outcome']; label: string }[] = [
  { key: 'dsp', label: '🔧 Dépanné sur place, le véhicule est reparti' },
  { key: 'delivered', label: '🚛 Remorqué et livré à destination' },
  { key: 'dpr', label: '❌ Déplacement pour rien' },
]

export default function ClotureTouringBureau({ motifsDsp, motifsRem, motifsDpr, busy, onChoix, onAnnuler }: {
  motifsDsp: Opt[]; motifsRem: Opt[]; motifsDpr: Opt[]; busy?: boolean
  onChoix: (c: ChoixTouring) => void; onAnnuler: () => void
}) {
  const [issue, setIssue] = useState<ChoixTouring['outcome'] | ''>('')
  const [motif, setMotif] = useState('')
  const liste = issue === 'dsp' ? motifsDsp : issue === 'delivered' ? motifsRem : issue === 'dpr' ? motifsDpr : []
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-amber-900 text-sm font-semibold">Touring attend la clôture de cette mission
          <span className="block text-amber-800 text-xs font-normal">Le chauffeur ne l’a pas clôturée. Dis ce qui s’est passé et choisis le motif : la clôture part chez Touring en même temps.</span>
        </p>
        <button type="button" onClick={onAnnuler} aria-label="Fermer" className="w-11 h-11 rounded-lg border border-amber-300 text-amber-900">✕</button>
      </div>
      {ISSUES.map(i => (
        <button key={i.key} type="button" onClick={() => { setIssue(i.key); setMotif('') }}
          className={`w-full min-h-[44px] px-3 rounded-lg border text-left text-sm ${issue === i.key ? 'bg-amber-200 border-amber-500 text-amber-900 font-semibold' : 'bg-white border-amber-300 text-amber-900'}`}>{i.label}</button>
      ))}
      {issue && (
        <select value={motif} onChange={e => setMotif(e.target.value)}
          className="w-full bg-white border border-amber-300 rounded-lg px-3 min-h-[44px] text-amber-900 text-sm">
          <option value="">— Choisir le motif —</option>
          {liste.map(x => <option key={x.key} value={x.key}>{x.icon ? `${x.icon} ` : ''}{x.label}</option>)}
        </select>
      )}
      {issue && !liste.length && <p className="text-amber-800 text-xs">Aucun motif disponible : préviens Mobi.</p>}
      <button type="button" disabled={busy || !issue || !motif}
        onClick={() => issue && motif && onChoix(issue === 'dpr' ? { outcome: 'dpr', dprCode: motif } : { outcome: issue, motifKey: motif })}
        className="w-full min-h-[44px] rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold">
        {busy ? '⏳ Clôture en cours…' : 'Forcer la clôture et clôturer chez Touring'}
      </button>
    </div>
  )
}
