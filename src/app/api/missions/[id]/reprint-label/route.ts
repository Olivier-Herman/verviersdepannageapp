// src/app/api/missions/[id]/reprint-label/route.ts
//
// POST /api/missions/[id]/reprint-label
//
// Reimprime l etiquette parc d une mission existante (Olivier 2026-05-27).
// Utilise par le bouton "🖨 Imprimer etiquette" sur la fiche dispatch.
//
// Compose le ZPL via le template VD Soft (buildParcLabelZPL) avec les vraies
// donnees de la mission, puis envoie au PC Zebra via printZPLRaw.
//
// Acces : admin / superadmin OU module fourriere active (Olivier 2026-05-28 :
// le dispatcher seul n a pas le droit, il faut avoir le module fourriere).

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { printVdSoftParcLabel }    from '@/lib/missions/print-parc-label'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const roles:   string[] = Array.isArray(user.roles)   ? user.roles   : [user.role].filter(Boolean)
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isAdmin       = roles.some(r => ['admin', 'superadmin'].includes(r))
  const hasFourriere  = modules.includes('fourriere')
  if (!isAdmin && !hasFourriere) {
    return NextResponse.json({ error: 'Forbidden — module fourriere requis' }, { status: 403 })
  }

  // Accepte UUID OR mission_number numerique (Olivier 2026-05-27).
  const idIsNumeric = /^\d+$/.test(params.id)
  const sb = createAdminClient()
  const baseQuery = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, source, intervention_date, received_at,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      destination_address, redelivery_address, snc_scenario,
      odoo_ticket_id
    `)
  const { data: mission, error } = idIsNumeric
    ? await baseQuery.eq('mission_number', Number(params.id)).maybeSingle()
    : await baseQuery.eq('id', params.id).maybeSingle()

  if (error || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  // Mapping source -> motif label affiche sur l etiquette
  const MOTIF_LABELS: Record<string, string> = {
    'police_mg':       'MAL GAREE',
    'police_rodeo':    'RODEO',
    'police_avp':      'AVP',
    'police_accident': 'ACCIDENT',
    'police_saisie':   'SAISIE',
    'police_snc':      'SIABIS NON COUVERT',
    'sia_couvert':     'SIABIS COUVERT',
    'prive':           'APPEL PRIVE',
  }
  const motif = MOTIF_LABELS[mission.source] || String(mission.source || '').toUpperCase()

  // Adresse de relivraison si pertinent : pour les sources qui passent en parc
  // en vue d une relivraison ulterieure (Prive depot, SNC rem_depot).
  // On utilise redelivery_address en priorite, sinon destination_address.
  const isRedelivery =
    (mission.source === 'prive') ||
    (mission.source === 'police_snc' && mission.snc_scenario === 'rem_depot') ||
    (mission.source === 'sia_couvert')
  const redeliveryAddr = isRedelivery
    ? (mission.redelivery_address || mission.destination_address || null)
    : null

  // AVP : note speciale (date + 60j eligibilite destruction)
  const isAvp = mission.source === 'police_avp'

  const result = await printVdSoftParcLabel({
    missionId:        mission.id,
    missionNumber:    mission.mission_number ?? null,
    odooTicketId:     mission.odoo_ticket_id ?? null,
    source:           mission.source,
    motif,
    interventionDate: mission.intervention_date || mission.received_at,
    plate:            mission.vehicle_plate,
    brand:            mission.vehicle_brand,
    model:            mission.vehicle_model,
    vin:              mission.vehicle_vin,
    redeliveryAddr,
    isAvp,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Impression echec' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
