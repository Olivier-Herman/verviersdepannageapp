// src/app/api/cron/mg-to-avp/route.ts
//
// Cron quotidien (4h UTC). Bascule automatique des Mal Garees > 60 jours
// (non recuperees par le proprietaire) en AVP.
//
// Regle metier (brief Olivier 2026-05-22) :
//   Si une mission source='police_mg' status='parked' depuis > 60 jours :
//   - source -> 'police_avp'
//   - intervention_date INCHANGEE (important pour les calculs ulterieurs
//     de gardiennage et de delai 60j AVP -> destruction)
//   - police_blocked -> true (force verif police a la restitution comme
//     toutes les AVP)
//   - Log mission_logs action='auto_mg_to_avp' avec metadata.original_source
//
// Auth : header Bearer CRON_SECRET (Vercel Cron)

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

import { NextResponse }      from 'next/server'
import { createAdminClient } from '@/lib/supabase'

const MG_TO_AVP_DAYS = 60

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createAdminClient()
  const cutoff = new Date(Date.now() - MG_TO_AVP_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  // Mal Garees parked depuis > 60 jours
  const { data: candidates, error } = await sb
    .from('incoming_missions')
    .select('id, vehicle_plate, intervention_date, received_at, parc_zone_key, parc_row_number, parc_slot_index')
    .eq('source', 'police_mg')
    .in('status', ['parked', 'delivering'])
    .lt('intervention_date', cutoff)

  if (error) {
    console.error('[cron/mg-to-avp]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ ok: true, switched: 0, message: 'Aucune MG > 60j a basculer' })
  }

  const ids = candidates.map(c => c.id)

  // Update bulk : source -> police_avp + police_blocked=true
  // IMPORTANT : on ne touche PAS intervention_date ni received_at (la date
  // initiale est conservee pour les calculs futurs).
  const { error: upErr } = await sb
    .from('incoming_missions')
    .update({
      source:         'police_avp',
      police_blocked: true,
      updated_at:     now,
    })
    .in('id', ids)
  if (upErr) {
    console.error('[cron/mg-to-avp] update echec', upErr.message)
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  // Logs mission_logs (audit + tracabilite)
  const logs = candidates.map(c => ({
    mission_id: c.id,
    actor_id:   null,  // systeme
    action:     'auto_mg_to_avp',
    notes:      `Bascule automatique Mal Garée → AVP (60 jours sans récupération). Date d entrée initiale conservée : ${c.intervention_date || c.received_at || '?'}.`,
    metadata:   {
      original_source:    'police_mg',
      new_source:         'police_avp',
      intervention_date:  c.intervention_date,
      received_at:        c.received_at,
      parc_zone_key:      c.parc_zone_key,
      parc_row_number:    c.parc_row_number,
      parc_slot_index:    c.parc_slot_index,
      days_in_parc:       Math.floor((Date.now() - new Date(c.intervention_date || c.received_at).getTime()) / (24 * 60 * 60 * 1000)),
    },
  }))
  await sb.from('mission_logs').insert(logs).then(() => {}, () => {})

  console.log(`[cron/mg-to-avp] ${candidates.length} Mal Garée(s) basculée(s) en AVP`)

  return NextResponse.json({
    ok:       true,
    switched: candidates.length,
    plates:   candidates.map(c => c.vehicle_plate).filter(Boolean),
  })
}
