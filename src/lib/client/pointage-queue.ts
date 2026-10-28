// Pointages faits sans réseau (Olivier 28/10/2026 : « Load failed » en zone blanche ou en sous-sol de garage).
// Seuls les pointages simples attendent sur le téléphone, avec leur heure réelle (client_at) : en route, sur place,
// véhicule chargé. Clôture, encaissement, mise en parc restent en ligne (trop de contrôles pour être rejoués).
// Envoi dans l'ordre dès que le réseau revient ; un refus du serveur est gardé pour être montré au chauffeur.

export const POINTAGES_DIFFERABLES = new Set(['on_way', 'on_site', 'load_vehicle'])

export type PointageAttente = { id: string; mission_id: string; action: string; extra: Record<string, any>; client_at: string; erreur?: string | null }

const KEY = 'vd_pointages_attente'
const EVT = 'vd-pointages-attente'

export function lirePointages(): PointageAttente[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function ecrire(l: PointageAttente[]) {
  try { localStorage.setItem(KEY, JSON.stringify(l)) } catch { /* stockage plein ou bloqué */ }
  try { window.dispatchEvent(new Event(EVT)) } catch { /* rien */ }
}
export function surChangement(fn: () => void): () => void {
  const h = () => fn()
  window.addEventListener(EVT, h); window.addEventListener('storage', h)
  return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h) }
}

export function mettreEnAttente(p: Omit<PointageAttente, 'id'>): PointageAttente {
  const item = { ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
  ecrire([...lirePointages(), item])
  return item
}
export function oublierPointage(id: string) { ecrire(lirePointages().filter(x => x.id !== id)) }

/** Panne de réseau (pas un refus du serveur). */
export function estErreurReseau(e: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return e instanceof TypeError || /load failed|failed to fetch|network ?error|networkerror|internet connection|timed? ?out/i.test(String(e?.message || e || ''))
}

let enCours = false
/** Envoie les pointages en attente, dans l'ordre. Renvoie le nombre envoyé. S'arrête à la première panne de réseau. */
export async function envoyerPointages(): Promise<number> {
  if (enCours) return 0
  enCours = true
  let n = 0
  try {
    for (const p of lirePointages()) {
      if (p.erreur) continue
      let r: Response
      try {
        r = await fetch('/api/missions/driver-action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission_id: p.mission_id, action: p.action, ...p.extra, client_at: p.client_at }),
        })
      } catch { break }   // toujours pas de réseau : on réessaiera
      if (r.ok) { oublierPointage(p.id); n++; continue }
      const j = await r.json().catch(() => ({}))
      // Déjà fait par ailleurs (dispatch, autre écran) : rien à signaler.
      if (r.status === 422 && /non permise/.test(String(j.error || ''))) { oublierPointage(p.id); continue }
      ecrire(lirePointages().map(x => x.id === p.id ? { ...x, erreur: String(j.error || `Erreur ${r.status}`) } : x))
    }
  } finally { enCours = false }
  return n
}
