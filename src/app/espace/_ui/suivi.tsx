'use client'
// Frise de suivi et pastilles de statut de l'espace client.

export type Ton = 'attente' | 'accepte' | 'route' | 'action' | 'fini' | 'annule'
export interface Etape { cle: string; libelle: string; quand: string | null; faite: boolean; courante: boolean }
export interface MissionEspace {
  id: string; numero: number; plaque: string | null; vehicule: string; adresse: string | null; destination: string | null
  recueLe: string; prevuLe: string | null; reference: string | null
  societe: { id: string; nom: string; couleur: string | null } | null
  commandePar: string | null
  suivi: { statut: string; libelle: string; ton: Ton; etapes: Etape[]; type: 'DSP' | 'REM' | 'REM+REL' | 'AUTRE'; termineeLe: string | null }
  rapport: boolean
  facture: { id: number; numero: string } | null
}

export const TONS: Record<Ton, { fond: string; texte: string; point: string; libelleCourt: string }> = {
  attente: { fond: 'bg-amber-50', texte: 'text-amber-800', point: 'text-amber-500', libelleCourt: 'En attente' },
  accepte: { fond: 'bg-sky-50', texte: 'text-sky-800', point: 'text-sky-500', libelleCourt: 'Acceptée' },
  route: { fond: 'bg-indigo-50', texte: 'text-indigo-800', point: 'text-indigo-500', libelleCourt: 'En route' },
  action: { fond: 'bg-rose-50', texte: 'text-rose-800', point: 'text-rose-500', libelleCourt: 'En cours' },
  fini: { fond: 'bg-emerald-50', texte: 'text-emerald-800', point: 'text-emerald-500', libelleCourt: 'Terminée' },
  annule: { fond: 'bg-slate-100', texte: 'text-slate-700', point: 'text-slate-400', libelleCourt: 'Annulée' },
}

export function Pastille({ ton, libelle }: { ton: Ton; libelle: string }) {
  const t = TONS[ton]
  const enCours = ton === 'route' || ton === 'action' || ton === 'accepte'
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${t.fond} ${t.texte}`}>
      {enCours ? <span className={`esp-live ${t.point}`} /> : <span className={`h-2.5 w-2.5 rounded-full bg-current ${t.point}`} />}
      {libelle}
    </span>
  )
}

export const heure = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) : ''
export const jour = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso), now = new Date()
  const k = (x: Date) => x.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })
  const hier = new Date(now.getTime() - 86400_000)
  if (k(d) === k(now)) return `aujourd’hui à ${heure(iso)}`
  if (k(d) === k(hier)) return `hier à ${heure(iso)}`
  return `${d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long' })} à ${heure(iso)}`
}

export function Progression({ etapes }: { etapes: Etape[] }) {
  const i = Math.max(0, etapes.findIndex(e => e.courante))
  const pct = etapes.length > 1 ? (i / (etapes.length - 1)) * 100 : 100
  return <div className="esp-track"><span style={{ width: `${Math.max(6, pct)}%` }} /></div>
}

/** Frise détaillée : verticale sur téléphone, horizontale sur grand écran. */
export function Frise({ etapes }: { etapes: Etape[] }) {
  return (
    <>
      <ol className="md:hidden relative ml-3 border-l-2 border-dashed border-[#e5ddd4]">
        {etapes.map((e, k) => (
          <li key={e.cle} className="esp-rise relative pl-6 pb-5 last:pb-0" style={{ animationDelay: `${k * 70}ms` }}>
            <Point e={e} className="absolute -left-[11px] top-0" />
            <div className={`text-sm font-bold ${e.faite ? 'text-slate-900' : 'text-slate-400'}`}>{e.libelle}</div>
            {e.faite && e.quand && <div className="text-xs text-slate-500">{jour(e.quand)}</div>}
          </li>
        ))}
      </ol>
      <ol className="hidden md:grid" style={{ gridTemplateColumns: `repeat(${etapes.length}, minmax(0, 1fr))` }}>
        {etapes.map((e, k) => (
          <li key={e.cle} className="esp-rise relative flex flex-col items-center text-center" style={{ animationDelay: `${k * 80}ms` }}>
            {k > 0 && <span className={`absolute right-1/2 top-[10px] h-[3px] w-full -translate-y-1/2 ${e.faite ? 'bg-gradient-to-r from-rose-500 to-amber-400' : 'bg-[#ece6df]'}`} />}
            <Point e={e} className="relative z-10" />
            <div className={`mt-2 px-1 text-[13px] font-bold leading-tight ${e.faite ? 'text-slate-900' : 'text-slate-400'}`}>{e.libelle}</div>
            {e.faite && e.quand && <div className="text-[11px] text-slate-500">{heure(e.quand)}</div>}
          </li>
        ))}
      </ol>
    </>
  )
}

function Point({ e, className }: { e: Etape; className?: string }) {
  if (e.courante && e.cle !== 'terminee' && e.cle !== 'annulee') {
    return <span className={`${className} grid h-[22px] w-[22px] place-items-center rounded-full bg-white ring-4 ring-rose-100`}><span className="esp-live text-rose-600" /></span>
  }
  if (e.faite) {
    return (
      <span className={`${className} grid h-[22px] w-[22px] place-items-center rounded-full ${e.cle === 'annulee' ? 'bg-slate-400' : 'bg-gradient-to-br from-rose-500 to-amber-400'} text-white shadow`}>
        <svg viewBox="0 0 16 16" className="h-3 w-3"><path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    )
  }
  return <span className={`${className} block h-[22px] w-[22px] rounded-full border-2 border-[#e5ddd4] bg-white`} />
}
