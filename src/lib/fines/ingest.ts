// src/lib/fines/ingest.ts — entrée d'un PV scanné dans le module Amendes :
// lecture (extractFineFromScan) → anti-doublon n° de PV → rangement du scan →
// suggestion du chauffeur du jour → amende en BROUILLON (status 'pending').
// Partagé par la capture par lot (/api/fines/batch) et le Courrier (29/09/2026).

import { extractFineFromScan } from '@/lib/fines/extract-fine'
import { suggestDriverForFine } from '@/lib/fines/suggest-driver'
import { parseTowsoftDateUTC } from '@/lib/towsoft-client'

const ONE_YEAR = 60 * 60 * 24 * 365
const normPlate = (p: string | null) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const normFineRef = (s: string | null) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export type FineIngest =
  | { status: 'created'; fine: any; ocr: any }
  | { status: 'duplicate'; ref: string; existing_id: string | null; existing_plate: string | null }

/** `seen` : n° de PV déjà connus (normalisés) → id/plaque ; complété au fil d'un lot. */
export async function ingestFineScan(sb: any, input: { buffer: Buffer; mime: string; ext: string; actorId: string }, seen?: Map<string, { id: string | null; plate: string | null }>): Promise<FineIngest> {
  const { buffer, mime, ext, actorId } = input
  // 1. Lecture d'abord (pour connaître le n° de PV avant tout rangement).
  const ex = await extractFineFromScan(buffer.toString('base64'), mime)
  // 2. Anti-doublon sur le n° de PV.
  const refN = normFineRef(ex.infraction_ref)
  if (refN) {
    let known = seen?.get(refN) || null
    if (!known && !seen) {
      const { data } = await sb.from('fines').select('id, plate, infraction_ref').not('infraction_ref', 'is', null)
      const hit = (data || []).find((r: any) => normFineRef(r.infraction_ref) === refN)
      if (hit) known = { id: hit.id, plate: hit.plate }
    }
    if (known) return { status: 'duplicate', ref: ex.infraction_ref || '', existing_id: known.id, existing_plate: known.plate }
  }
  // 3. Rangement du scan.
  const path = `${actorId}/${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`
  const { error: upErr } = await sb.storage.from('fines').upload(path, buffer, { contentType: mime, upsert: false })
  if (upErr) throw new Error(`upload: ${upErr.message}`)
  const { data: signed } = await sb.storage.from('fines').createSignedUrl(path, ONE_YEAR)
  // 4. Suggestion chauffeur (plaque + date lisibles). Heure du PV = heure LOCALE Belgique.
  let driverId: string | null = null, matchMethod: 'auto' | 'none' = 'none', matchConfidence: string | null = null, missionId: string | null = null
  const infractionDate = parseTowsoftDateUTC(ex.infraction_date) || new Date().toISOString()
  if (ex.plate && ex.infraction_date) {
    try {
      const sug = await suggestDriverForFine(normPlate(ex.plate), new Date(infractionDate))
      if (sug.driver_id) { driverId = sug.driver_id; missionId = sug.mission_id; matchMethod = 'auto'; matchConfidence = sug.confidence }
    } catch { /* best-effort */ }
  }
  // 5. Amende en brouillon (pas d'envoi aux achats).
  const { data: fine, error: insErr } = await sb.from('fines').insert({
    photo_url: signed?.signedUrl || path, infraction_date: infractionDate, infraction_place: ex.infraction_place,
    infraction_type: ex.infraction_type, infraction_ref: ex.infraction_ref, identification_code: ex.identification_code,
    amount: ex.amount, plate: ex.plate ? normPlate(ex.plate) : '—', driver_id: driverId, driver_match_method: matchMethod,
    driver_match_confidence: matchConfidence, mission_id: missionId, status: 'pending', purchase_email_sent: false, created_by: actorId,
  }).select('id, plate, amount, infraction_date, infraction_type, infraction_ref, driver_id').single()
  if (insErr) throw new Error(insErr.message)
  if (refN) seen?.set(refN, { id: fine.id, plate: fine.plate })
  return { status: 'created', fine, ocr: ex }
}
