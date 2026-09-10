// src/lib/missions/reserve-rel.ts
//
// REMORQUAGE D'UN VÉHICULE DÉJÀ AU PARC CHEZ NOUS — règle commune à TOUTES les
// assistances (Olivier 09/09/2026, 2JPR337 puis « ce n'est pas que pour VAB,
// toutes les assistances doivent utiliser ce principe »).
//
// Quand une assistance (Touring, VAB, AXA, Allianz/Mondial, Kaze/IMA, Ethias…)
// ouvre un remorquage pour une voiture que nous gardons déjà, ce n'est pas une
// mission à dispatcher maintenant : « la voiture est en parc et pas encore
// prête à partir ; la fiche doit alimenter les informations de dossier et de
// relivraison de la fiche principale ; le dossier reste en parc jusqu'à ce que
// le bureau crée la relivraison et l'assigne ».
//
//   1. la fiche principale (en parc) reçoit l'adresse de relivraison, passe en
//      REM+REL et rejoint la file relivraison (zone K / K1 selon l'adresse),
//      étiquette réimprimée ;
//   2. la fiche de l'assistance ne vit PAS dans « En attente » : elle se met EN
//      RÉSERVE sur le dossier (status ignored, parent_mission_id, type REL,
//      incident_type relivraison). Quand le bureau clique Relivrer depuis
//      « À relivrer », createRelivraisonMission la reprend telle quelle — même
//      n° d'assistance, mêmes identifiants (AssignmentId VAB, job Kaze, COMEX…),
//      même dossier Odoo : clôture chez l'assisteur et facturation inchangées.
//
// Garde-fous (au moindre doute on ne touche à rien, la fiche arrive dans
// « En attente » comme avant) : source taguée « assistance » au catalogue,
// action REMORQUAGE, plaque connue, une fiche EN PARC de la même plaque (jamais
// un volet gardiennage), aucune relivraison déjà active sur ce dossier.
import type { createAdminClient } from '@/lib/supabase'
import { reprintLabelForMission } from '@/lib/missions/reprint-label-helper'
import { sourceHasTag } from '@/lib/missions/source-catalog'
import { sendPushToRole } from '@/lib/push'

type Sb = ReturnType<typeof createAdminClient>

export interface ReserveResult {
  reserved: boolean
  reason?: string
  parentId?: string
  parentNumber?: number | null
  zone?: string
  redelivery?: string | null
}

/** À appeler juste après l'INSERT d'une fiche d'assistance (status new). Best-effort, ne jette jamais. */
export async function reserveTowForParkedVehicle(opts: { sb: Sb; missionId: string; actorId?: string | null; actorName: string }): Promise<ReserveResult> {
  const { sb, missionId, actorName } = opts
  const actorId = opts.actorId ?? null
  try {
    const { data: m } = await sb.from('incoming_missions')
      .select('id, mission_number, source, source_format, billed_to_name, status, mission_type, vehicle_plate, dossier_leg, parent_mission_id, external_id, destination_name, destination_address, destination_lat, destination_lng')
      .eq('id', missionId).maybeSingle()
    if (!m) return { reserved: false, reason: 'fiche introuvable' }
    if (m.status !== 'new' || m.dossier_leg || m.parent_mission_id) return { reserved: false, reason: 'pas une commande neuve' }
    if (!['remorquage', 'REM+REL'].includes(String(m.mission_type || ''))) return { reserved: false, reason: 'pas un remorquage' }
    const plate = String(m.vehicle_plate || '').replace(/\s/g, '').toUpperCase()
    if (!plate) return { reserved: false, reason: 'plaque inconnue' }
    // Assistance = source taguée « assistance » au catalogue, OU dossier COMEX (Touring
    // couvre aussi les Siabis couverts, source sia_couvert), OU fiche facturée à une
    // assistance. Cas 2EMF957 (10/09/2026) : l'action Touring de livraison depuis notre
    // parc arrivait en sia_couvert, non taguée → elle échappait à la réserve.
    const assistanceLike = (await sourceHasTag(m.source, 'assistance'))
      || String((m as any).source_format || '') === 'comex'
      || /touring|vab|axa|allianz|mondial|ethias|kaze|europ|ima\b/i.test(String((m as any).billed_to_name || ''))
    if (!assistanceLike) return { reserved: false, reason: 'source hors assistance' }

    const { data: parked } = await sb.from('incoming_missions')
      .select('id, mission_number, depot_depart_id, redelivery_address')
      .eq('vehicle_plate', plate).eq('status', 'parked').eq('dossier_leg', false).neq('id', m.id)
      .order('parked_at', { ascending: false }).limit(1).maybeSingle()
    if (!parked?.id) return { reserved: false, reason: 'véhicule pas au parc' }

    const { data: kids } = await sb.from('incoming_missions').select('id, status')
      .eq('parent_mission_id', parked.id).eq('dossier_leg', false).eq('mission_type', 'REL')
      .neq('status', 'cancelled').limit(1)
    if ((kids || []).length) return { reserved: false, reason: 'relivraison déjà rattachée', parentId: parked.id }

    const now = new Date().toISOString()
    let parcAddr: string | null = null
    if (parked.depot_depart_id) {
      const { data: d } = await sb.from('depots').select('address').eq('id', parked.depot_depart_id).maybeSingle()
      parcAddr = (d?.address || '').trim() || null
    }
    if (!parcAddr) {
      const { data: d } = await sb.from('depots').select('address').eq('is_default', true).eq('active', true).maybeSingle()
      parcAddr = (d?.address || '').trim() || null
    }
    const redelivery = (m.destination_address || '').trim() || (m.destination_name || '').trim() || parked.redelivery_address || null
    const { relivraisonZoneFor } = await import('@/lib/parc/relivraison-zone')
    const zone = await relivraisonZoneFor(sb, redelivery)
    const updParent: Record<string, any> = { parc_zone_key: zone, parc_row_number: null, parc_slot_index: null, mission_type: 'REM+REL', updated_at: now }
    if (redelivery) updParent.redelivery_address = redelivery
    if (parcAddr)   updParent.destination_address = parcAddr
    if (m.destination_lat != null) updParent.redelivery_lat = m.destination_lat
    if (m.destination_lng != null) updParent.redelivery_lng = m.destination_lng
    await sb.from('incoming_missions').update(updParent).eq('id', parked.id)
    const srcLabel = String(m.source || '').toUpperCase()
    await sb.from('mission_logs').insert({
      mission_id: parked.id, actor_id: actorId, action: 'request_relivraison',
      notes: `Remorquage ${srcLabel} ${m.external_id || ''} rattaché → zone ${zone}${redelivery ? ' · ' + redelivery : ''} (${actorName}). `
           + `La fiche ${srcLabel} reste en réserve : elle deviendra la relivraison quand le bureau la créera depuis « À relivrer ».`,
      metadata: { reserved_rel: m.id, redelivery_address: redelivery, source: m.source },
    }).then(() => {}, () => {})

    await sb.from('incoming_missions')
      .update({ status: 'ignored', parent_mission_id: parked.id, mission_type: 'REL', incident_type: 'relivraison', assigned_to: null, updated_at: now })
      .eq('id', m.id)
    await sb.from('mission_logs').insert({
      mission_id: m.id, actor_id: actorId, action: 'rel_reserved',
      notes: `Remorquage ${srcLabel} mis en réserve sur la fiche en parc #${parked.mission_number ?? ''} : il sera repris tel quel à la création de la relivraison (procédure « À relivrer »).`,
      metadata: { parent_mission_id: parked.id },
    }).then(() => {}, () => {})

    try { await reprintLabelForMission({ kind: 'uuid', value: parked.id }) } catch { /* non bloquant */ }
    await sendPushToRole(['admin', 'superadmin', 'dispatcher'], {
      title: `🅿️ Remorquage ${srcLabel} pour un véhicule au parc`,
      body:  `${plate} : la fiche principale #${parked.mission_number ?? ''} est en zone ${zone}, relivraison à créer depuis « À relivrer » quand le véhicule est prêt.`,
      url:   '/relivraison',
    }).catch(() => {})
    console.log(`[REL-RESERVE] ${plate} (${m.source}) : réserve sur #${parked.mission_number ?? parked.id}, zone ${zone}`)
    return { reserved: true, parentId: parked.id, parentNumber: parked.mission_number, zone, redelivery }
  } catch (e: any) {
    console.error('[REL-RESERVE] échec (fiche laissée en commande) :', e?.message || e)
    return { reserved: false, reason: e?.message || String(e) }
  }
}
