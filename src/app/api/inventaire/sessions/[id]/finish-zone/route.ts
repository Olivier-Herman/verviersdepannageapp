// src/app/api/inventaire/sessions/[id]/finish-zone/route.ts
//
// POST /api/inventaire/sessions/[id]/finish-zone
// Body: { zone_key: string }
//
// Cloture le scan d UNE zone sans terminer toute la session. Les vehicules
// attendus dans cette zone mais non scannes passent en status='unlocated' :
//   - parc_zone_key reste a l ancienne zone (tracabilite : 'on l attendait ici')
//   - parc_row_number/slot_index → null (le slot est libere)
//   - status                     → 'unlocated' (n apparait plus comme 'parked')
//
// Plus tard, si le vehicule est scanne dans une autre zone via
// /api/inventaire/place-scan, son status revient a 'parked' avec la
// nouvelle position. La transition est automatique (gere par place-scan).
//
// Retour : liste des vehicules passes en unlocated + CSV en plain text dans
// le payload pour download cote client.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PARKED_STATUSES = ['parked', 'delivering']

function escapeCsv(v: any): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const zoneKey = String(body.zone_key || '').trim()
  if (!zoneKey) {
    return NextResponse.json({ error: 'zone_key requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  const { data: sess } = await sb
    .from('inventaire_sessions')
    .select('id, user_id')
    .eq('id', params.id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'Session introuvable' }, { status: 404 })
  if (sess.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 1. Recupere les IDs des vehicules SCANNES dans cette zone pendant la session
  const { data: scanned } = await sb
    .from('inventaire_session_items')
    .select('incoming_mission_id')
    .eq('session_id',    params.id)
    .eq('parc_zone_key', zoneKey)
  const scannedIds: string[] = (scanned || [])
    .map(i => i.incoming_mission_id)
    .filter(Boolean) as string[]

  // 2. Trouve les vehicules attendus dans cette zone, non scannes
  let q = sb
    .from('incoming_missions')
    .select('id, external_id, vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin, client_name, status, parc_zone_key, parc_row_number, parc_slot_index, dossier_number, source, billed_to_name, received_at')
    .eq('parc_zone_key', zoneKey)
    .in('status', PARKED_STATUSES)
  if (scannedIds.length > 0) {
    q = q.not('id', 'in', `(${scannedIds.map(id => `"${id}"`).join(',')})`)
  }
  const { data: missing, error: qErr } = await q
    .order('parc_row_number')
    .order('parc_slot_index')
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 })

  const missingList = missing || []

  // 3. Update status → 'unlocated' + clear row/slot (garde zone d origine
  //    pour la tracabilite). Les vehicules sortent visuellement de la rangee
  //    mais on sait qu on les attendait dans cette zone.
  if (missingList.length > 0) {
    const ids = missingList.map(m => m.id)
    const { error: upErr } = await sb
      .from('incoming_missions')
      .update({
        status:           'unlocated',
        parc_row_number:  null,
        parc_slot_index:  null,
        unlocated_at:     new Date().toISOString(),
        unlocated_zone:   zoneKey,
      })
      .in('id', ids)
    if (upErr) {
      // Si la colonne unlocated_at n existe pas encore (migration pas appliquee),
      // on retry sans elle.
      if (/unlocated_at|unlocated_zone/.test(upErr.message)) {
        await sb
          .from('incoming_missions')
          .update({
            status:           'unlocated',
            parc_row_number:  null,
            parc_slot_index:  null,
          })
          .in('id', ids)
      } else {
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      }
    }

    // Log dans mission_logs pour tracabilite
    const logs = missingList.map(m => ({
      mission_id: m.id,
      actor_id:   user.id,
      action:     'unlocated_after_zone_scan',
      notes:      `Non localisé après scan complet de la zone ${zoneKey}`,
      metadata:   { zone_key: zoneKey, session_id: params.id, was_at: { row: m.parc_row_number, slot: m.parc_slot_index } },
    }))
    await sb.from('mission_logs').insert(logs).then(() => {}, () => {})
  }

  // 4. Genere un CSV simple pour download cote client
  const csvHeader = 'Plaque,Marque,Modele,VIN,Client,Dossier,Source,Facture a,Ancienne position,Recu le'
  const csvRows = missingList.map(m =>
    [
      escapeCsv(m.vehicle_plate),
      escapeCsv(m.vehicle_brand),
      escapeCsv(m.vehicle_model),
      escapeCsv(m.vehicle_vin),
      escapeCsv(m.client_name),
      escapeCsv(m.dossier_number || m.external_id),
      escapeCsv(m.source),
      escapeCsv(m.billed_to_name),
      escapeCsv(`${m.parc_zone_key}${m.parc_row_number || ''}-${m.parc_slot_index || ''}`),
      escapeCsv(m.received_at),
    ].join(',')
  )
  const csv = [csvHeader, ...csvRows].join('\n')

  return NextResponse.json({
    ok:              true,
    zone_key:        zoneKey,
    unlocated_count: missingList.length,
    unlocated:       missingList,
    csv,
  })
}
