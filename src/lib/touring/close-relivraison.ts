// src/lib/touring/close-relivraison.ts
//
// Clôture chez Touring (COMEX) d'une RELIVRAISON (Olivier 13/10/2026 : « si COMEX a une mission créée, ils attendent
// une clôture »). Une relivraison se termine par l'ancien écran (driver-action « completed »), qui ne parlait jamais à
// COMEX : 28 actions de transfert sur 60 jours sont restées ouvertes chez Touring, clôturées à la main par eux quand ils
// y pensaient. Ici : fin 00 « livré », codes de panne repris du remorquage d'origine, destination de la fiche. Une
// panne de Touring met la clôture en file (cron assistance-close-retry) ; un refus métier est tracé pour le dispatch.

import { createAdminClient } from '@/lib/supabase'
import { comexKeysOf } from '@/lib/touring/sync'
import { transformTouring, type TransformInput } from '@/lib/cloture/transform/touring'
import { enqueueClose, isRetryable } from '@/lib/cloture/queue'
import { prefillCodes } from '@/lib/cloture/prefill'
import { isRelivraison } from '@/lib/missions/mission-types'


export async function closeComexRelivraison(missionId: string, actorId: string | null): Promise<{ ok: boolean; note: string }> {
  const sb = createAdminClient()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, parent_mission_id, raw_content, source_format, mission_type, vehicle_vin, vehicle_vin_partial, vehicle_mileage, destination_address, destination_name, destination_lat, destination_lng')
    .eq('id', missionId).maybeSingle()
  if (!m || !isRelivraison((m as any).mission_type)) return { ok: false, note: 'pas une relivraison' }
  let keys = comexKeysOf(m as any)
  if (!keys) return { ok: false, note: 'pas liée à COMEX' }
  const log = (action: string, notes: string, metadata: any = {}) =>
    sb.from('mission_logs').insert({ mission_id: m.id, actor_id: actorId, action, notes, metadata }).then(() => {}, () => {})

  // Déjà clôturée (clôture définitive : on ne rejoue jamais).
  const { count } = await sb.from('mission_logs').select('id', { count: 'exact', head: true }).eq('mission_id', m.id).eq('action', 'touring_closed')
  if (count) return { ok: true, note: 'déjà clôturée' }

  // L'action de transfert n'a pas toujours la séquence héritée du parent (1GPB143 : 204 contre 205) : on prend
  // l'action OUVERTE du même dossier, de préférence le transfert (COD_ADRESSE TRF).
  try {
    const { loginComex, listComexMissions } = await import('@/lib/touring/comex')
    const ouvertes = (await listComexMissions(await loginComex('dispatch')))
      .filter(x => String(x.CID_DOS).toUpperCase() === keys!.CID_DOS.toUpperCase() && String(x.COD_STATUT_MTR) !== '07')
    const choix = ouvertes.find(x => String(x.CID_SEQ_ACTION) === keys!.CID_SEQ_ACTION)
      || ouvertes.find(x => String(x.COD_ADRESSE).toUpperCase() === 'TRF') || ouvertes[0]
    if (!choix) { await log('touring_synced', 'Relivraison : aucune action ouverte chez Touring pour ce dossier — rien à clôturer.'); return { ok: true, note: 'rien à clôturer' } }
    keys = { CID_DOS: keys.CID_DOS, CID_SEQ_ACTION: String(choix.CID_SEQ_ACTION) }
  } catch { /* liste indisponible : on tente avec la séquence de la fiche, la file rejouera si besoin */ }

  const input: TransformInput = {
    outcome: 'delivered',
    prefill: await prefillCodes(sb, m),
    vin: (m as any).vehicle_vin || (m as any).vehicle_vin_partial || null,
    km: (m as any).vehicle_mileage ?? null,
    ficheDestination: (m as any).destination_address || null,
    ficheDestinationName: (m as any).destination_name || null,
    ficheDestinationLat: (m as any).destination_lat ?? null,
    ficheDestinationLng: (m as any).destination_lng ?? null,
  }
  const r = await transformTouring(keys, input)
  if (r.ok && r.codes) {
    await log('touring_closed', `Clôture Touring (relivraison) action ${keys.CID_SEQ_ACTION} — code ${r.finCode} (codes ${r.codes.cause}/${r.codes.desc}/${r.codes.result})`, {
      finCode: r.finCode, cause: r.codes.cause, desc: r.codes.desc, result: r.codes.result, seq: keys.CID_SEQ_ACTION,
      statusBefore: r.statusBefore, statusAfter: r.statusAfter, relivraison: true,
    })
    return { ok: true, note: 'clôturée' }
  }
  if (isRetryable(r.error)) {
    await enqueueClose({ missionId: m.id, assistance: 'touring', input, rawContent: (m as any).raw_content, actorId, error: r.error })
    await log('touring_synced', `Relivraison : Touring injoignable, clôture mise en file (${r.error || '?'})`)
    return { ok: true, note: 'en file' }
  }
  await log('assistance_close_error', `Relivraison : clôture Touring refusée — ${r.error || '?'}`, { seq: keys.CID_SEQ_ACTION })
  return { ok: false, note: r.error || 'refusée' }
}
