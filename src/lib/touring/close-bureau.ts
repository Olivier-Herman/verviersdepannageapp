// src/lib/touring/close-bureau.ts
//
// Clôture chez Touring (COMEX) d'une mission qui ne passe PAS par l'écran de clôture du chauffeur (Olivier 28/11/2026 :
// « il faut que tout se clôture » — 8 missions terminées chez nous étaient encore ouvertes chez Touring) :
//   - le bureau force « à facturer » ou « au parc » : il donne l'issue et le motif, la clôture part d'ici ;
//   - Touring crée son action de remorquage APRÈS que le chauffeur a déjà déclaré le véhicule livré : l'action de suite
//     est clôturée « livrée » avec les codes de la première clôture.
// Même mécanique que la relivraison (lib/touring/close-relivraison.ts) : action ouverte du dossier, panne de Touring →
// file de reprise, refus → trace sur la fiche + alerte au dispatch.

import { createAdminClient } from '@/lib/supabase'
import { comexKeysOf } from '@/lib/touring/sync'
import { transformTouring, type TransformInput } from '@/lib/cloture/transform/touring'
import { enqueueClose, isRetryable } from '@/lib/cloture/queue'
import { DPR_END_CODES, type Outcome } from '@/lib/cloture/outcomes'

export interface ClotureBureau {
  outcome:   Outcome
  motifKey?: string | null
  dprCode?:  string | null
  prefill?:  { cause: string; desc: string; result: string } | null
  /** Séquence de l'action à clôturer quand elle est connue (action de suite). */
  seq?:      string | null
  /** Dit pourquoi la clôture part d'ici, pour l'historique de la fiche. */
  contexte:  string
}

/** Une clôture est-elle déjà partie (ou en file) chez Touring pour cette fiche ? */
export async function clotureTouringConnue(sb: any, missionId: string): Promise<boolean> {
  const { count } = await sb.from('mission_logs').select('id', { count: 'exact', head: true }).eq('mission_id', missionId)
    .in('action', ['touring_closed', 'flux2_closed', 'flux2_close_failed', 'flux2_retry_ok'])
  return !!count
}

export async function closeComexPourFiche(missionId: string, actorId: string | null, c: ClotureBureau): Promise<{ ok: boolean; note: string }> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, vehicle_plate, source, raw_content, source_format, vehicle_vin, vehicle_vin_partial, vehicle_mileage, destination_address, destination_name, destination_lat, destination_lng')
    .eq('id', missionId).maybeSingle()
  if (!m) return { ok: false, note: 'fiche introuvable' }
  let keys = comexKeysOf(m as any)
  if (!keys) return { ok: true, note: 'pas liée à COMEX' }
  if (c.seq) keys = { CID_DOS: keys.CID_DOS, CID_SEQ_ACTION: String(c.seq) }
  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: (m as any).id, actor_id: actorId, action, notes, metadata }).then(() => {}, () => {})

  // On vise l'action encore OUVERTE du dossier : celle de la fiche d'abord, sinon la seule qui reste.
  try {
    const { loginComex, listComexMissions } = await import('@/lib/touring/comex')
    const ouvertes = (await listComexMissions(await loginComex('dispatch')))
      .filter(x => String(x.CID_DOS).toUpperCase() === keys!.CID_DOS.toUpperCase() && String(x.COD_STATUT_MTR) !== '07')
    if (!ouvertes.length) { await log('touring_synced', `Touring (${c.contexte}) : aucune action ouverte chez eux pour ce dossier — rien à clôturer.`); return { ok: true, note: 'rien à clôturer' } }
    const choix = ouvertes.find(x => String(x.CID_SEQ_ACTION) === keys!.CID_SEQ_ACTION) || ouvertes[0]
    keys = { CID_DOS: keys.CID_DOS, CID_SEQ_ACTION: String(choix.CID_SEQ_ACTION) }
  } catch { /* liste indisponible : on tente avec la séquence connue, la file rejouera si besoin */ }

  const dpr = DPR_END_CODES.find(x => x.code === String(c.dprCode || ''))
  const input: TransformInput = {
    outcome: c.outcome,
    motifKey: c.motifKey || null,
    prefill: c.prefill || null,
    dprCode: dpr?.fin || c.dprCode || null,
    comment: dpr?.remarque || null,
    vin: (m as any).vehicle_vin || (m as any).vehicle_vin_partial || null,
    km: (m as any).vehicle_mileage ?? null,
    nonCouvert: String((m as any).source || '') === 'police_snc',
    ficheDestination: (m as any).destination_address || null,
    ficheDestinationName: (m as any).destination_name || null,
    ficheDestinationLat: (m as any).destination_lat ?? null,
    ficheDestinationLng: (m as any).destination_lng ?? null,
  }
  const r = await transformTouring(keys, input)
  if (r.ok) {
    const codes = r.codes && r.codes.cause ? ` (codes ${r.codes.cause}/${r.codes.desc}/${r.codes.result})` : ''
    await log('touring_closed', `Clôture Touring (${c.contexte}) action ${keys.CID_SEQ_ACTION} — code ${r.finCode}${codes}`, {
      finCode: r.finCode, cause: r.codes?.cause || '', desc: r.codes?.desc || '', result: r.codes?.result || '', seq: keys.CID_SEQ_ACTION,
      statusBefore: r.statusBefore, statusAfter: r.statusAfter, bureau: true, outcome: c.outcome,
    })
    return { ok: true, note: 'clôturée' }
  }
  if (isRetryable(r.error)) {
    await enqueueClose({ missionId: (m as any).id, assistance: 'touring', input, rawContent: (m as any).raw_content, actorId, error: r.error })
    await log('touring_synced', `Touring (${c.contexte}) : injoignable, clôture mise en file (${r.error || '?'})`)
    return { ok: true, note: 'en file' }
  }
  await log('assistance_close_error', `Touring (${c.contexte}) : clôture refusée — ${r.error || '?'}`, { seq: keys.CID_SEQ_ACTION, outcome: c.outcome })
  try {
    const { sendNotificationToRoles } = await import('@/lib/notifications/send')
    await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'touring_close_failed', {
      title: `Touring : ${(m as any).vehicle_plate || 'mission'} non clôturée dans COMEX`,
      body: `Fiche ${(m as any).mission_number || ''} (dossier ${keys.CID_DOS}) : ${r.error || 'clôture refusée'}. Touring la voit encore en cours.`,
      action_url: `/dispatch/${(m as any).id}`,
    })
  } catch { /* la trace reste dans le journal de la fiche */ }
  return { ok: false, note: r.error || 'refusée' }
}
