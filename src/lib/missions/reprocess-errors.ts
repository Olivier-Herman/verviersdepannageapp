// src/lib/missions/reprocess-errors.ts
//
// Récupération des missions en erreur (parse_error / source unknown /
// placeholders PROCESSING_ vides). Deux mécanismes :
//   - re-parse du raw_content stocké (modèle réparé)
//   - re-téléchargement de l'email via son id Graph (placeholder vide)
//
// Utilisé par : le cron auto (/api/cron/reprocess-errors), l'admin
// (/api/admin/missions/errors POST) et le dispatcher (/api/missions/reprocess).
//
// Lot limité car le re-fetch + parse Claude prend ~10s/mission (limite Vercel).
// Olivier 2026-06-16.

import { createAdminClient } from '@/lib/supabase'

export interface ReprocessResult {
  reparsed:  number
  refetched: number
  failed:    number
  processed: number
  more:      boolean
  errors:    string[]
}

const REPROCESS_FILTER = 'status.eq.parse_error,source.eq.unknown,external_id.like.PROCESSING_%,external_id.like.UNKNOWN_SENDER_%'

/** Nombre de missions actuellement en erreur (pour badge dispatch). */
export async function countErrorMissions(): Promise<number> {
  const sb = createAdminClient()
  const { count } = await sb
    .from('incoming_missions')
    .select('id', { count: 'exact', head: true })
    .or(REPROCESS_FILTER)
  return count || 0
}

export async function reprocessErrorMissions(opts: { onlyId?: string | null; batch?: number } = {}): Promise<ReprocessResult> {
  const onlyId = opts.onlyId || null
  const BATCH  = onlyId ? 1 : (opts.batch ?? 4)
  const sb = createAdminClient()

  let q = sb
    .from('incoming_missions')
    .select('id, source, source_format, raw_content, external_id, source_email_id, received_at')
    .or(REPROCESS_FILTER)
    .order('received_at', { ascending: false })
  if (onlyId) q = q.eq('id', onlyId)
  const { data: rows, error } = await q.limit(BATCH + 4)  // marge pour filtrer les in-flight
  if (error) throw new Error(error.message)

  // Ne pas toucher aux placeholders PROCESSING_ encore EN COURS de traitement
  // (créés il y a < 4 min) — sauf si on cible un id précis (action manuelle).
  const inFlightCutoff = Date.now() - 4 * 60 * 1000
  const candidates = (rows || []).filter(m => {
    if (onlyId) return true
    if (String(m.external_id || '').startsWith('PROCESSING_') && m.received_at) {
      return new Date(m.received_at).getTime() < inFlightCutoff
    }
    return true
  }).slice(0, BATCH)

  const { parseMissionContent } = await import('./parser')
  const { processEmailMessage } = await import('./processor')
  let reparsed = 0, refetched = 0, failed = 0
  const errors: string[] = []

  for (const m of candidates) {
    const raw = (m.raw_content || '').trim()
    const isEmptyPlaceholder = String(m.external_id || '').startsWith('PROCESSING_') &&
      (!raw || raw.length < 80 || /placeholder orphelin/i.test(raw))

    // Cas 1 : placeholder vide → re-fetch l'email (delete placeholder + reprocess).
    if (isEmptyPlaceholder && m.source_email_id) {
      try {
        await sb.from('incoming_missions').delete().eq('id', m.id)
        const res: any = await processEmailMessage(m.source_email_id)
        if (res.status === 'inserted' || res.status === 'duplicate') refetched++
        else { failed++; errors.push(`${m.id}: refetch ${res.status} ${res.error || res.reason || ''}`.slice(0, 140)) }
      } catch (e: any) {
        failed++; errors.push(`${m.id}: refetch ${e.message?.slice(0, 100)}`)
      }
      continue
    }

    // Cas 2 : contenu présent → re-parse.
    if (!raw) { failed++; continue }
    try {
      const parsed = await parseMissionContent(
        (m.source as any) || 'unknown',
        { textContent: raw, sourceFormat: (m.source_format as any) || 'email_plain', rawContent: raw },
        'Reprocess parse_error',
      )
      const upd: Record<string, any> = {
        status:           'new',
        parse_confidence: parsed.confidence ?? 0.5,
        updated_at:       new Date().toISOString(),
      }
      for (const f of ['dossier_number','mission_type','incident_type','incident_description',
        'client_name','client_phone','client_address','vehicle_plate','vehicle_brand','vehicle_model',
        'vehicle_vin','vehicle_fuel','vehicle_gearbox','incident_address','incident_city',
        'destination_name','destination_address','amount_guaranteed'] as const) {
        if ((parsed as any)[f] != null && (parsed as any)[f] !== '') upd[f] = (parsed as any)[f]
      }
      // incident_at : valider la date (LLM peut renvoyer un format invalide →
      // rejet timestamptz qui ferait échouer tout l'UPDATE).
      if (parsed.incident_at && !isNaN(Date.parse(String(parsed.incident_at)))) upd.incident_at = parsed.incident_at
      const { error: uErr } = await sb.from('incoming_missions').update(upd).eq('id', m.id)
      if (uErr) { failed++; errors.push(`${m.id}: ${uErr.message}`) } else reparsed++
    } catch (e: any) {
      failed++; errors.push(`${m.id}: ${e.message?.slice(0, 120)}`)
    }
  }

  const processed = (rows || []).length
  return { reparsed, refetched, failed, processed, more: !onlyId && processed >= BATCH, errors: errors.slice(0, 10) }
}
