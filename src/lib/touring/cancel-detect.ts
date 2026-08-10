// src/lib/touring/cancel-detect.ts
//
// Surveillance ANNULATION Touring COMEX. Une mission Touring non validée à temps
// est annulée + réattribuée par Touring → elle DISPARAÎT de listComexMissions
// (dispatch ET user) alors que notre fiche reste active. On détecte, on confirme
// (fenêtre), puis on tranche selon la règle « Mondial » :
//   • chauffeur PAS parti (pas de touring_onroad_at) → annulée SANS FRAIS.
//   • chauffeur PARTI                                → DÉPLACEMENT (trajet à vide facturable).
// Olivier 2026-08-09. Cf [[project_touring_annulation_non_validation]].

import { loginComex, listComexMissions } from './comex'
import { sendNotificationToRoles } from '@/lib/notifications/send'

const ACTIVE_STATUSES  = ['assigned', 'accepted', 'in_progress', 'delivering']
const CONFIRM_MIN      = 14   // fenêtre de confirmation (≈7 poll cycles) avant de trancher

export interface CancelDetectSummary {
  checked: number; missingNew: number; recovered: number
  confirmed: number; deplacement: number; sansFrais: number
  actions: { plate: string; kind: string }[]
}

// Union des dossiers vivants sur les 2 comptes COMEX. null = échec (on n'agit pas).
async function liveDossiers(): Promise<Set<string> | null> {
  const set = new Set<string>()
  let anyOk = false
  for (const acc of ['dispatch', 'user'] as const) {
    try {
      const session = await loginComex(acc)
      const list = await listComexMissions(session)
      for (const m of (list || [])) set.add(String(m.CID_DOS || '').toUpperCase())
      anyOk = true
    } catch { /* compte indispo → on ne le compte pas comme vivant, mais on ne bloque pas */ }
  }
  return anyOk ? set : null   // si AUCUN compte n'a répondu, on ne tranche pas (évite faux positifs)
}

export async function runTouringCancelDetect(sb: any): Promise<CancelDetectSummary> {
  const out: CancelDetectSummary = { checked: 0, missingNew: 0, recovered: 0, confirmed: 0, deplacement: 0, sansFrais: 0, actions: [] }

  const { data: fiches } = await sb.from('incoming_missions')
    .select('id, mission_number, dossier_number, vehicle_plate, status, touring_onroad_at, touring_missing_since')
    .eq('source_format', 'comex')
    .in('status', ACTIVE_STATUSES)
    .not('dossier_number', 'is', null)
    .limit(500)
  if (!fiches || !fiches.length) return out

  const live = await liveDossiers()
  if (!live) return out   // les 2 comptes COMEX sont KO → on ne fait rien ce tour

  const now = Date.now()
  for (const f of fiches) {
    out.checked++
    const cid = String(f.dossier_number || '').toUpperCase()
    if (!cid) continue

    if (live.has(cid)) {                                   // toujours vivante
      if (f.touring_missing_since) { await sb.from('incoming_missions').update({ touring_missing_since: null }).eq('id', f.id); out.recovered++ }
      continue
    }

    // Absente des listes COMEX.
    if (!f.touring_missing_since) {                         // 1re détection → on démarre le chrono
      await sb.from('incoming_missions').update({ touring_missing_since: new Date().toISOString() }).eq('id', f.id)
      out.missingNew++
      continue
    }
    if (now - Date.parse(f.touring_missing_since) < CONFIRM_MIN * 60000) continue   // fenêtre pas écoulée

    // Confirmé annulé → règle « Mondial ».
    const departed = !!f.touring_onroad_at
    const patch: any = { touring_missing_since: null, updated_at: new Date().toISOString() }
    if (departed) {
      patch.mission_type = 'trajet_vide'
      patch.status = 'to_invoice'
      patch.completed_at = new Date().toISOString()
      out.deplacement++
    } else {
      patch.status = 'cancelled'
      out.sansFrais++
    }
    await sb.from('incoming_missions').update(patch).eq('id', f.id)
    out.confirmed++
    out.actions.push({ plate: f.vehicle_plate || '—', kind: departed ? 'déplacement' : 'sans frais' })
    await sb.from('mission_logs').insert({
      mission_id: f.id, action: 'touring_cancelled_detected',
      notes: `Touring a annulé/réattribué (dossier ${f.dossier_number} absent des listes COMEX). Règle Mondial : ${departed ? 'DÉPLACEMENT — chauffeur parti → trajet à vide à facturer' : 'annulée SANS FRAIS — chauffeur non parti'}.`,
    }).then(() => {}, () => {})
  }

  if (out.confirmed > 0) {
    await sendNotificationToRoles(['admin', 'superadmin', 'dispatcher'], 'touring_cancelled', {
      title: `Touring : ${out.confirmed} annulation(s) détectée(s)`,
      body: `${out.deplacement} déplacement(s) à facturer · ${out.sansFrais} sans frais — ${out.actions.map(a => a.plate).slice(0, 6).join(', ')}`,
      action_url: '/dispatch',
    }).catch(() => {})
  }
  return out
}
