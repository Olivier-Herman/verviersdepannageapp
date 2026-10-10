'use client'
// Éléments partagés de l'espace client (design du prototype validé le 10/10/2026).

export type Ton = 'attente' | 'accepte' | 'route' | 'action' | 'fini' | 'annule'
export interface Etape { cle: string; libelle: string; faite: boolean; courante: boolean }
export interface Doc { id: number; numero: string }
export interface MissionEspace {
  id: string; numero: number; plaque: string | null; vehicule: string; adresse: string | null; destination: string | null
  recueLe: string; prevuLe: string | null; reference: string | null
  societe: { id: string; nom: string; couleur: string | null } | null
  commandePar: string | null
  panne: string | null
  contact: { nom: string; tel: string | null } | null
  messageChauffeur: { texte: string; confirme: boolean } | null
  photos: string[]
  suivi: { statut: string; libelle: string; ton: Ton; etapes: Etape[]; type: 'DSP' | 'REM' | 'REM+REL' | 'AUTRE'; termineeLe: string | null }
  rapport: boolean
  facture: Doc | null
  avoir: Doc | null
  annulable: boolean
  annulationEnCours: boolean
}

export const IMG = {
  route: '/noprecache/espace/route.jpg', dsp: '/noprecache/espace/dsp.jpg', rem: '/noprecache/espace/rem.jpg',
  vide: '/noprecache/espace/vide.jpg', succes: '/noprecache/espace/succes.jpg', nuit: '/noprecache/espace/nuit.jpg', equipe: '/noprecache/espace/equipe.jpg',
}

export const typeLibelle = (t: string) => t === 'DSP' ? 'Dépannage sur place' : t === 'REM+REL' ? 'Remorquage et livraison' : t === 'REM' ? 'Remorquage' : 'Intervention'

export function Pastille({ ton, libelle }: { ton: Ton; libelle: string }) {
  return <span className={`pill t-${ton}`}>{['route', 'action', 'accepte'].includes(ton) && <span className="live" />}{libelle}</span>
}

export function Plaque({ v }: { v: string | null }) {
  if (!v) return null
  return <span className="plate"><i>B</i><span>{v}</span></span>
}

/** Le jour seulement : le client ne voit pas les heures de pointage. */
export const jour = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso), j = new Date()
  const k = (x: Date) => x.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' })
  if (k(d) === k(j)) return 'aujourd’hui'
  if (k(d) === k(new Date(j.getTime() - 86400_000))) return 'hier'
  return 'le ' + d.toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long' })
}

export function Progression({ etapes, annulee }: { etapes: Etape[]; annulee?: boolean }) {
  const i = Math.max(0, etapes.findIndex(e => e.courante))
  const pct = annulee ? 100 : etapes.length > 1 ? Math.max(6, (i / (etapes.length - 1)) * 100) : 100
  return <div className="track"><span style={{ width: `${pct}%`, ...(annulee ? { background: '#c6cad4' } : {}) }} /></div>
}

export function Frise({ etapes }: { etapes: Etape[] }) {
  return (
    <ol className="frise">
      {etapes.map(e => {
        const cur = e.courante && e.cle !== 'terminee' && e.cle !== 'annulee'
        const done = e.faite && !cur
        return (
          <li key={e.cle} className={`${done ? 'done' : ''} ${cur ? 'cur' : ''}`}>
            <span className="pt">{done ? '✓' : cur ? <span className="live" /> : null}</span>
            <b>{e.libelle}</b>{cur && <small>En cours</small>}
          </li>
        )
      })}
    </ol>
  )
}

export const IcoPin = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="#d42a2a" style={{ flex: 'none', marginTop: 2 }}><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
export const IcoDoc = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 12v6m-3-3 3 3 3-3" /></svg>
export const IcoPlus = ({ s = 18 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
export const Marque = () => (
  <div className="brand">
    <span className="brand-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17h2m12 0h4v-4l-3-4h-5v8M3 17V7h10v10" /><circle cx="17" cy="17" r="2" /><circle cx="7" cy="17" r="2" /></svg></span>
    <span><strong>Verviers Dépannage</strong><small>Espace client</small></span>
  </div>
)
