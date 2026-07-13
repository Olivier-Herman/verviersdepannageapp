// src/app/api/missions/[id]/request-relivraison/route.ts
//
// POST /api/missions/[id]/request-relivraison
//   { redelivery_address, redelivery_lat?, redelivery_lng? }
//
// Olivier 2026-06-14 : depuis une fiche HORS zone K, le bureau indique que le
// véhicule nécessite une relivraison. On encode l'adresse de relivraison et on
// bascule le véhicule en zone K (file d'attente relivraison) — ce qui imprime
// l'étiquette REL avec l'adresse. On NE crée PAS encore la fiche de relivraison
// (elle sera créée depuis la zone K quand un chauffeur la prend).
//
// Accès : tout utilisateur authentifié ayant accès à la fiche dispatch
// (dispatcher / admin / superadmin / fourrière).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { reprintLabelForMission } from '@/lib/missions/reprint-label-helper'
import { relivraisonZoneFor } from '@/lib/parc/relivraison-zone'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any

  const body = await req.json().catch(() => ({}))
  const address = String(body.redelivery_address || '').trim()
  if (!address) return NextResponse.json({ error: 'Adresse de relivraison requise' }, { status: 400 })
  const lat = body.redelivery_lat != null ? Number(body.redelivery_lat) : null
  const lng = body.redelivery_lng != null ? Number(body.redelivery_lng) : null

  const sb = createAdminClient()
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select('id, status, parc_zone_key')
    .eq('id', params.id)
    .single()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Le véhicule doit être en parc (status=${mission.status}).` }, { status: 400 })
  }

  // K1 « en attente d'adresse » si la destination est un de nos dépôts, sinon K.
  const REL_ZONE = await relivraisonZoneFor(sb, address)

  // Zone cible active ?
  const { data: zone } = await sb.from('parc_zones').select('key, active').eq('key', REL_ZONE).maybeSingle()
  if (zone && zone.active === false) {
    return NextResponse.json({ error: `Zone ${REL_ZONE} inactive` }, { status: 400 })
  }

  const upd: Record<string, any> = {
    redelivery_address: address,
    parc_zone_key:      REL_ZONE,
    parc_row_number:    null,
    parc_slot_index:    null,
    updated_at:         new Date().toISOString(),
  }
  if (lat != null && Number.isFinite(lat)) upd.redelivery_lat = lat
  if (lng != null && Number.isFinite(lng)) upd.redelivery_lng = lng

  const { error: upErr } = await sb.from('incoming_missions').update(upd).eq('id', params.id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   user.id,
    action:     'request_relivraison',
    notes:      `Relivraison demandée → zone ${REL_ZONE} · ${address} (par ${user.name || user.email || 'bureau'})`,
    metadata:   { from_zone: mission.parc_zone_key, to_zone: REL_ZONE, redelivery_address: address },
  }).then(() => {}, () => {})

  // Impression étiquette REL (best-effort, non bloquant)
  let labelPrinted = false
  try {
    const r = await reprintLabelForMission({ kind: 'uuid', value: params.id })
    labelPrinted = !!r.ok
  } catch { /* non bloquant */ }

  return NextResponse.json({ ok: true, zone: REL_ZONE, label_printed: labelPrinted })
}
