// Purge hebdomadaire des fiches INVISIBLES (Olivier 09/09/2026, après l'audit
// « En attente » : 14 en base, 7 à l'écran).
//
// La liste dispatch masque les fiches dont la lecture du mail est peu sûre
// (parse_confidence < 0,3) et les expéditeurs inconnus (UNKNOWN_SENDER_). Elles
// ne sont dans aucun onglet, personne ne les traite, et rien ne les nettoyait
// dès qu'elles portaient un nom ou une plaque (les « coquilles vides » sont déjà
// archivées par auto-archive ; les erreurs brutes purgées à 72 h).
//
// Règle : une fiche invisible, jamais assignée, sans suite depuis 7 jours est
// ANNULÉE (motif explicite, journal) et archivée — jamais supprimée : la trace
// reste consultable par la recherche globale. Une fiche reliée à Kaze ou parent
// d'une chaîne n'est pas touchée.

import { createAdminClient } from '@/lib/supabase'
import { VHU_SOURCE } from '@/lib/missions/vhu'

export const PURGE_AFTER_DAYS = 7
const CANCELLED_BY = 'Système (purge hebdomadaire)'

export interface PurgeResult {
  at:        string
  dryRun:    boolean
  scanned:   number
  cancelled: number
  skipped:   number
  items:     { mission_number: number | null; source: string | null; status: string; received_at: string; client: string | null; plate: string | null; reason: string }[]
}

export async function purgeInvisibleFiches(opts: { dryRun?: boolean } = {}): Promise<PurgeResult> {
  const sb = createAdminClient()
  const dryRun = !!opts.dryRun
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86_400_000).toISOString()

  const { data: cand, error } = await sb
    .from('incoming_missions')
    .select('id, mission_number, status, source, received_at, client_name, vehicle_plate, parse_confidence, external_id, kaze_job_id, parent_mission_id')
    .eq('dossier_leg', false)
    .is('archived_at', null)
    .is('assigned_to', null)
    .in('status', ['new', 'dispatching'])
    .lt('received_at', cutoff)
    .or('parse_confidence.lt.0.3,external_id.like.UNKNOWN_SENDER_%')
    .neq('source', VHU_SOURCE)
    .order('received_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(error.message)

  const ids = (cand || []).map(m => m.id)
  const parents = new Set<string>()
  if (ids.length) {
    const { data: kids } = await sb.from('incoming_missions').select('parent_mission_id').in('parent_mission_id', ids)
    for (const k of kids || []) if (k.parent_mission_id) parents.add(k.parent_mission_id)
  }

  const res: PurgeResult = { at: now, dryRun, scanned: ids.length, cancelled: 0, skipped: 0, items: [] }
  for (const m of cand || []) {
    if (m.kaze_job_id || parents.has(m.id)) { res.skipped++; continue }
    const days = Math.floor((Date.now() - new Date(m.received_at).getTime()) / 86_400_000)
    const why = /^UNKNOWN_SENDER_/.test(String(m.external_id || '')) ? 'expéditeur inconnu' : `lecture du mail incertaine (${Math.round(Number(m.parse_confidence || 0) * 100)} %)`
    const reason = `Purge hebdomadaire : fiche invisible dans le dispatch (${why}), jamais assignée, sans suite depuis ${days} jours`
    res.items.push({ mission_number: m.mission_number, source: m.source, status: m.status, received_at: m.received_at, client: m.client_name, plate: m.vehicle_plate, reason })
    if (dryRun) continue
    const { error: uErr } = await sb.from('incoming_missions')
      .update({ status: 'cancelled', cancelled_reason: reason, cancelled_at: now, cancelled_by: CANCELLED_BY, archived_at: now, updated_at: now })
      .eq('id', m.id).in('status', ['new', 'dispatching'])
    if (uErr) { res.skipped++; continue }
    await sb.from('mission_logs').insert({ mission_id: m.id, action: 'cancelled', notes: `Fiche annulée — motif : ${reason} (par ${CANCELLED_BY})`, metadata: { reason, cancelled_by: CANCELLED_BY, purge: 'invisible_weekly' } }).then(() => {}, () => {})
    res.cancelled++
  }
  return res
}
