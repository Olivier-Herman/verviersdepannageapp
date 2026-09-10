// src/lib/dossier/todo-count.ts
//
// « À facturer, toutes sources hors Touring » — LE chiffre de la puce de la
// Facturation par dossier, calculé par le même moteur (buildDossier léger,
// mêmes règles de classement que DossiersClient), et mis en cache dans
// app_settings pour la pastille du menu. Olivier 10/09/2026 : « la pastille du
// menu doit refléter la valeur de la puce Toutes (hors Touring) » — la pastille
// comptait des fiches brutes (17) là où la puce comptait des dossiers (3).
//
// Rafraîchi : à chaque ouverture de la page (avec les dossiers qu'elle vient de
// construire) et par le cron facturation-todo-count toutes les 15 minutes.
import type { createAdminClient } from '@/lib/supabase'
import { buildDossier, type Dossier, type DossierLeg } from '@/lib/dossier/build'

type Sb = ReturnType<typeof createAdminClient>
export const TODO_COUNT_KEY = 'facturation_todo_count'
export const MAX_DOSSIERS = 80

export type ComexById = Record<string, { verdict: string | null; montant: number | null; accepted_at: string | null; dossier: string | null }>

/** Racines candidates + construction LÉGÈRE — même sélection que la page. */
export async function loadFacturationDossiers(sb: Sb): Promise<{ dossiers: Dossier[]; roots: string[] }> {
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [{ data: toInv }, { data: legsDone }, { data: recent }, { data: legsOpen }] = await Promise.all([
    sb.from('incoming_missions').select('id, parent_mission_id, completed_at')
      .eq('status', 'to_invoice').eq('dossier_leg', false).is('archived_at', null)
      .not('external_id', 'like', 'PROCESSING_%').order('completed_at', { ascending: false }).limit(300),
    sb.from('incoming_missions').select('id, parent_mission_id, parc_exit_at')
      .eq('dossier_leg', true).not('parc_exit_at', 'is', null).is('invoice_odoo_id', null).is('invoice_number', null)
      .is('no_charge_at', null).is('archived_at', null)
      .order('parc_exit_at', { ascending: false }).limit(200),
    sb.from('incoming_missions').select('id, parent_mission_id, invoiced_at')
      .eq('dossier_leg', false).gte('invoiced_at', since30).order('invoiced_at', { ascending: false }).limit(120),
    sb.from('incoming_missions').select('id, parent_mission_id, parked_at')
      .eq('dossier_leg', true).is('parc_exit_at', null).lte('parked_at', since7).order('parked_at', { ascending: true }).limit(60),
  ])
  const rootOf = (m: any) => m.parent_mission_id || m.id
  const seen = new Set<string>()
  const roots: string[] = []
  for (const m of [...(toInv || []), ...(legsDone || []), ...(recent || []), ...(legsOpen || [])]) {
    const r = rootOf(m); if (seen.has(r)) continue; seen.add(r); roots.push(r)
    if (roots.length >= MAX_DOSSIERS) break
  }
  const dossiers: Dossier[] = []
  for (let i = 0; i < roots.length; i += 40) {
    const built = await Promise.all(roots.slice(i, i + 40).map(id => buildDossier(id, { light: true, cache: true }).catch(() => null)))
    for (const d of built) if (d) dossiers.push(d)
  }
  return { dossiers, roots }
}

/** Dossiers présents dans COMEX BKO (circuit « validation Touring »). */
export async function loadComexById(sb: Sb, dossiers: Dossier[]): Promise<ComexById> {
  const out: ComexById = {}
  if (!dossiers.length) return out
  const { data: cx } = await sb.from('touring_comex_dossiers').select('mission_id, mission_ids, verdict, montant, accepted_at, dossier, in_comex').eq('in_comex', true)
  for (const c of cx || []) {
    const ids = [(c as any).mission_id, ...(Array.isArray((c as any).mission_ids) ? (c as any).mission_ids : [])].filter(Boolean)
    for (const d of dossiers) if (d.legs.some(l => ids.includes(l.mission_id)) || ids.includes(d.root_id)) out[d.root_id] = { verdict: (c as any).verdict || null, montant: (c as any).montant ?? null, accepted_at: (c as any).accepted_at || null, dossier: (c as any).dossier || null }
  }
  return out
}

// ── Mêmes règles que DossiersClient (fonctions pures sur les postes) ─────────
const isOdoo       = (l: DossierLeg) => (l.channel || 'odoo') === 'odoo'
const isLegBilled  = (l: DossierLeg) => l.billed_refs.length > 0 && l.billed_htva >= l.amount_htva - 0.01
const canPickLeg   = (l: DossierLeg) => !l.nothing_to_bill && !isLegBilled(l) && l.amount_htva > 0
  && (isOdoo(l) || (!!l.billed_to_id && !/parquet|frais de justice|fdj\b/i.test(String(l.billed_to_name || ''))))
const ready        = (d: Dossier) => d.legs.filter(l => isOdoo(l) && (canPickLeg(l) || (l.amount_unknown && !isLegBilled(l) && !l.nothing_to_bill)) && !(l.kind === 'gard' && l.open))
const isCircuitLegs = (d: Dossier) => d.legs.some(l => !isOdoo(l) && !isLegBilled(l) && !l.nothing_to_bill) && ready(d).length === 0
const isDone       = (d: Dossier) => !d.state.open && d.legs.every(l => isLegBilled(l) || !!l.nothing_to_bill || (l.amount_htva === 0 && !l.amount_unknown))
const isTouringBilled = (d: Dossier) => /touring/i.test(String(d.billed_to.name || '')) || d.legs.some(l => /touring/i.test(String(l.billed_to_name || '')))
const isTouring    = (d: Dossier) => { const s = (d.source || '').toLowerCase(); return s === 'touring' || s === 'tgr_touring' || isTouringBilled(d) }

/** Onglet « À facturer » × puce « Toutes (hors Touring) ». */
export function countTodoHorsTouring(dossiers: Dossier[], comexById: ComexById): number {
  const inComex = (d: Dossier) => { const c = comexById[d.root_id]; return !!c && !c.accepted_at && !isDone(d) }
  return dossiers.filter(d => !isDone(d) && !(isCircuitLegs(d) || inComex(d)) && !isTouring(d)).length
}

export async function saveTodoCount(sb: Sb, count: number): Promise<void> {
  await sb.from('app_settings').upsert({ key: TODO_COUNT_KEY, value: JSON.stringify({ count, at: new Date().toISOString() }), updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

export async function readTodoCount(sb: Sb): Promise<{ count: number; at: string } | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', TODO_COUNT_KEY).maybeSingle()
  if (!data?.value) return null
  try { const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value; return Number.isFinite(Number(v?.count)) ? { count: Number(v.count), at: String(v.at || '') } : null } catch { return null }
}

/**
 * Comptage PRÉCIS : les candidats retenus par la construction légère sont
 * reconstruits en complet (montants tarifés, postes facturés à jour) avant
 * d'être comptés — c'est ce que fait la page quand elle re-tarife ses lignes.
 * Le 10/09, 1DXX318 facturé le matin restait « à facturer » en léger (cache).
 * Peu de candidats (3 à 20), donc peu de constructions complètes.
 */
export async function countTodoHorsTouringPrecise(dossiers: Dossier[], comexById: ComexById): Promise<number> {
  const candidates = dossiers.filter(d => countTodoHorsTouring([d], comexById) === 1)
  const full = await Promise.all(candidates.map(d => buildDossier(d.root_id, { light: false, cache: false }).catch(() => d)))
  return countTodoHorsTouring(full.filter((d): d is Dossier => !!d), comexById)
}

/** À partir des dossiers déjà construits par la page : compte précis + cache. */
export async function refreshTodoCountFrom(sb: Sb, dossiers: Dossier[], comexById: ComexById): Promise<number> {
  const count = await countTodoHorsTouringPrecise(dossiers, comexById)
  await saveTodoCount(sb, count)
  return count
}

/** Tout en un (cron) : construit, classe, met en cache. */
export async function refreshFacturationTodoCount(sb: Sb): Promise<{ count: number; dossiers: number }> {
  const { dossiers } = await loadFacturationDossiers(sb)
  const comexById = await loadComexById(sb, dossiers)
  const count = await refreshTodoCountFrom(sb, dossiers, comexById)
  return { count, dossiers: dossiers.length }
}
