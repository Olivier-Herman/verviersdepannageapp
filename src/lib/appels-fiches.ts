// src/lib/appels-fiches.ts — appels Teams rattachés aux fiches (Olivier 24/11/2026).
// Trois chemins :
//   1. au décroché, Teams ouvre /appel?tel=… : une seule fiche → elle s'ouvre ; plusieurs → choix ; aucune → recherche.
//      Le choix retient le numéro pour la fiche (fiche_numeros) ;
//   2. toutes les 15 minutes (cron appels-fiches), chaque appel relevé se rattache tout seul quand son numéro désigne
//      une seule fiche (numéro retenu d'abord, sinon numéro du client sur une seule fiche en cours) ;
//   3. le reste attend sur /appels (« Appels à rattacher »), où le bureau choisit la fiche ou « Pas lié ».
// Microsoft livre un appel 25 à 35 minutes après la fin : le rattachement n'est jamais instantané, l'ouverture si.

import type { createAdminClient } from '@/lib/supabase'
import type { Appel } from '@/lib/supervision/appels'

type Sb = ReturnType<typeof createAdminClient>

/** Rôles qui voient les appels (mêmes droits que la fiche du dispatch). */
export const ROLES_APPELS = ['admin', 'superadmin', 'dispatcher']
export const peutVoirAppels = (u: any) => ROLES_APPELS.some(r => (u?.roles || [u?.role]).includes(r))

/** Statuts d'une fiche terminée : un appel ne s'y rattache plus tout seul (sauf numéro retenu récent). */
const TERMINES = ['completed', 'cancelled', 'ignored', 'parse_error']
const JOURS_RECENTE = 7
const JOURS_RETENU = 30

/** Motif de comparaison : 8 derniers caractères, chiffres masqués (« * ») → « _ ». null si trop court. */
export function motifNumero(n: string | null | undefined): string | null {
  const s = String(n || '').replace(/\*/g, '_').replace(/[^\d_]/g, '')
  return s.replace(/_/g, '').length >= 6 && s.length >= 8 ? s.slice(-8) : null
}

/** Numéro lisible : +32 479 12 34 56, 087 60 06 09… */
export function numeroLisible(n: string | null | undefined): string {
  const s = String(n || '').trim()
  const m = s.match(/^\+32(\d+|[\d*]+)$/)
  if (!m) return s || 'Numéro masqué'
  const r = m[1]
  if (r.startsWith('4') && r.length === 9) return `+32 ${r.slice(0, 3)} ${r.slice(3, 5)} ${r.slice(5, 7)} ${r.slice(7)}`
  if (r.length === 8) return `+32 ${r.slice(0, 2)} ${r.slice(2, 4)} ${r.slice(4, 6)} ${r.slice(6)}`
  return s
}

export const COLS_FICHE = 'id, mission_number, dossier_number, vehicle_plate, vehicle_brand, vehicle_model, client_name, client_phone, status, mission_type, source, received_at, created_at, dossier_leg, parent_mission_id'

export interface FicheCourte {
  id: string; mission_number: number | null; dossier_number: string | null; vehicle_plate: string | null
  vehicle_brand: string | null; vehicle_model: string | null; client_name: string | null; client_phone: string | null
  status: string; mission_type: string | null; source: string | null; received_at: string | null; created_at: string
  parent_mission_id?: string | null; dossier_leg?: boolean | null
  retenu?: boolean; retenu_at?: string | null; en_cours?: boolean
}

const recente = (f: FicheCourte) => !TERMINES.includes(f.status) || +new Date(f.received_at || f.created_at) > Date.now() - JOURS_RECENTE * 864e5

/** Fiches liées à un numéro : numéros retenus d'abord, puis fiches en cours, puis les plus récentes. */
export async function fichesDuNumero(sb: Sb, numero: string | null | undefined): Promise<FicheCourte[]> {
  const motif = motifNumero(numero)
  if (!motif) return []
  const { data, error } = await sb.rpc('fiches_par_numero', { motif })
  if (error) throw new Error(`Recherche par numéro : ${error.message}`)
  const ret = new Map<string, string | null>(), ids = new Set<string>()
  for (const r of (data || []) as any[]) { ids.add(r.mission_id); if (r.retenu && (!ret.has(r.mission_id) || r.retenu_at > (ret.get(r.mission_id) || ''))) ret.set(r.mission_id, r.retenu_at) }
  if (!ids.size) return []
  const { data: f, error: e2 } = await sb.from('incoming_missions').select(COLS_FICHE).in('id', [...ids].slice(0, 200))
  if (e2) throw new Error(`Fiches : ${e2.message}`)
  return ((f || []) as any[]).map(x => ({ ...x, retenu: ret.has(x.id), retenu_at: ret.get(x.id) || null, en_cours: recente(x) }))
    .sort((a, b) => Number(!!b.retenu) - Number(!!a.retenu) || String(b.retenu_at || '').localeCompare(String(a.retenu_at || ''))
      || Number(!!b.en_cours) - Number(!!a.en_cours) || String(b.received_at || b.created_at).localeCompare(String(a.received_at || a.created_at)))
}

/** La fiche à ouvrir ou à rattacher sans demander, s'il n'y a pas de doute. */
export function ficheEvidente(fiches: FicheCourte[]): FicheCourte | null {
  const ret = fiches.filter(f => f.retenu && (f.en_cours || +new Date(f.retenu_at || 0) > Date.now() - JOURS_RETENU * 864e5))
  if (ret.length) return ret[0]                       // le numéro retenu le plus récent
  // Les étapes d'un même dossier portent le même numéro : un seul dossier en cours = pas de doute (on ouvre sa tête).
  const cours = fiches.filter(f => f.en_cours)
  const dossiers = new Set(cours.map(f => f.parent_mission_id || f.id))
  if (dossiers.size !== 1) return null
  return cours.find(f => !f.parent_mission_id) || cours[0]
}

/** Au-delà, un numéro est celui d'une organisation (assisteur, police, garage) : jamais proposé ni rattaché seul. */
export const SEUIL_ORGANISATION = 6
export const estOrganisation = (fiches: FicheCourte[]) => !fiches.some(f => f.retenu) && fiches.length >= SEUIL_ORGANISATION

/** Numéros « ne plus proposer » (motifs de 8 chiffres). */
export async function numerosIgnores(sb: Sb): Promise<Set<string>> {
  const { data, error } = await sb.from('numeros_ignores').select('numero8')
  if (error) throw new Error(`Numéros ignorés : ${error.message}`)
  return new Set(((data || []) as any[]).map(r => r.numero8))
}

/** Retient un numéro pour une fiche (ses prochains appels s'y rattachent). */
export async function retenirNumero(sb: Sb, numero: string, missionId: string, par: string | null) {
  const numero8 = motifNumero(numero)
  if (!numero8 || numero8.includes('_')) return       // un numéro masqué ne se retient pas
  const { error } = await sb.from('fiche_numeros').upsert({ numero8, mission_id: missionId, numero, par, at: new Date().toISOString() }, { onConflict: 'numero8,mission_id' })
  if (error) throw new Error(`Numéro retenu : ${error.message}`)
}

/** Numéros du personnel (appels aux chauffeurs, au bureau) : jamais à rattacher. */
export async function numerosPersonnel(sb: Sb): Promise<Set<string>> {
  const out = new Set<string>()
  for (const t of ['users', 'personnel']) {
    const { data } = await sb.from(t).select('phone').not('phone', 'is', null)
    for (const r of (data || []) as any[]) { const m = motifNumero(r.phone); if (m) out.add(m) }
  }
  return out
}

/** Un appel à proposer au bureau ? (pas un robot, pas le personnel, quelqu'un a parlé). */
export function appelUtile(a: Appel, perso: Set<string>, ignores?: Set<string>): boolean {
  if (a.sens === 'interne' || !a.numero) return false
  if (String(a.service || '').startsWith('Robot')) return false
  if (a.parts.some(p => p.qui === 'Agents')) return false
  const m = motifNumero(a.numero)
  if (!m) return false
  if (ignores?.has(m)) return false
  if (perso.has(m) || (m.includes('_') && [...perso].some(p => new RegExp('^' + m.replace(/_/g, '\\d') + '$').test(p)))) return false
  return true
}

/** Rattache tout seul les appels des dernières `heures` heures qui n'ont pas encore de fiche. */
export async function lierAppels(sb: Sb, heures = 48): Promise<{ lies: number; restants: number }> {
  const d1 = new Date(Date.now() - heures * 3600e3).toISOString()
  const { data: appels, error } = await sb.from('supervision_appels').select('*').gte('debut', d1).in('sens', ['entrant', 'sortant']).order('id')
  if (error) throw new Error(`Appels : ${error.message}`)
  const ids = ((appels || []) as Appel[]).map(a => a.id)
  const deja = new Set<string>()
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from('appel_fiches').select('appel_id').in('appel_id', ids.slice(i, i + 300))
    for (const r of (data || []) as any[]) deja.add(r.appel_id)
  }
  const perso = await numerosPersonnel(sb)
  const ignores = await numerosIgnores(sb)
  const cache = new Map<string, FicheCourte[]>()
  let lies = 0, restants = 0
  for (const a of (appels || []) as Appel[]) {
    if (deja.has(a.id) || !appelUtile(a, perso, ignores)) continue
    const motif = motifNumero(a.numero)!
    if (!cache.has(motif)) cache.set(motif, await fichesDuNumero(sb, a.numero))
    const fiches = cache.get(motif)!
    if (estOrganisation(fiches)) {
      await sb.from('appel_fiches').upsert({ appel_id: a.id, mission_id: null, mode: 'organisation', par: null }, { onConflict: 'appel_id', ignoreDuplicates: true })
      continue
    }
    const f = ficheEvidente(fiches)
    if (!f) { if (!a.perdu) restants++; continue }
    const { error: e } = await sb.from('appel_fiches').upsert({ appel_id: a.id, mission_id: f.id, mode: f.retenu ? 'retenu' : 'auto', par: null }, { onConflict: 'appel_id', ignoreDuplicates: true })
    if (!e) lies++
  }
  return { lies, restants }
}

/** Libellé court d'une fiche pour les listes. */
export function libelleFiche(f: FicheCourte): { titre: string; detail: string } {
  const vehicule = [f.vehicle_brand, f.vehicle_model].filter(Boolean).join(' ')
  const quand = new Date(f.received_at || f.created_at).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: '2-digit' })
  return {
    titre: f.vehicle_plate || (f.mission_number ? `Fiche ${f.mission_number}` : f.dossier_number || 'Fiche sans plaque'),
    detail: [vehicule, f.client_name, `du ${quand}`, f.en_cours === false ? 'terminée' : null].filter(Boolean).join(' · '),
  }
}
