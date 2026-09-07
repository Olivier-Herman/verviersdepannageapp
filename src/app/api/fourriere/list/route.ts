// src/app/api/fourriere/list/route.ts
//
// GET /api/fourriere/list[?zone=A]
//
// Olivier 2026-06-06 PM : VD Soft = source de verite (decision migration
// fourriere). Avant : lecture depuis Odoo fleet.vehicle par state_id, ce
// qui faisait que la zone affichee venait d Odoo et pas de VD Soft.
// Maintenant : SELECT depuis incoming_missions WHERE status='parked', zone
// vient de parc_zone_key (VD Soft). Odoo reste reference passive : l URL
// du bouton 'Voir fiche Odoo' est construite si odoo_vehicle_id existe.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { FOURRIERE_ZONES }         from '@/lib/fourriere'
import { isPreviewOn }             from '@/lib/feature-flags'

export const dynamic     = 'force-dynamic'
export const maxDuration = 15

const ODOO_URL = process.env.ODOO_URL || 'https://verviers-depannage.odoo.com'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const zoneFilter = (searchParams.get('zone') || '').trim()

  const sb = createAdminClient()

  // Source de verite VD Soft : missions parked (avec zone) sur incoming_missions
  let query = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id,
      vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model,
      parc_zone_key, parc_row_number, parc_slot_index,
      status, source, parked_at, updated_at,
      odoo_vehicle_id, odoo_helpdesk_id,
      client_name, migration_pending, migration_pending_reason
    `)
    .eq('status', 'parked')
    .not('parc_zone_key', 'is', null)
    .order('parc_zone_key', { ascending: true })
    .order('vehicle_plate', { ascending: true })
    .limit(2000)

  if (zoneFilter) {
    query = query.eq('parc_zone_key', zoneFilter)
  }

  // ── Bascule Fourrière (flag fourriere_gardiennage, superadmin d'abord) ──
  // La liste lit les FICHES GARDIENNAGE ouvertes (Vue dossier) au lieu des
  // remorquages figés en 'parked'. Les actions (fiche, QR, transfert,
  // restitution) gardent l'id de la RACINE tant que le REM reste le porteur
  // du parc en base (miroir). Olivier 07/09/2026.
  const gardiennageMode = await isPreviewOn('fourriere_gardiennage', role)
  let missions: any[] | null = null
  let error: any = null
  if (gardiennageMode) {
    let q2 = sb.from('incoming_missions')
      .select(`id, parent_mission_id, mission_type, parc_zone_key, parc_row_number, parc_slot_index, parked_at, updated_at, key_location,
               root:incoming_missions!parent_mission_id(id, mission_number, external_id, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, status, source, odoo_vehicle_id, odoo_helpdesk_id, client_name, migration_pending, migration_pending_reason)`)
      .eq('dossier_leg', true).is('parc_exit_at', null).not('parc_zone_key', 'is', null)
      .order('parc_zone_key', { ascending: true }).limit(2000)
    if (zoneFilter) q2 = q2.eq('parc_zone_key', zoneFilter)
    const r2 = await q2
    error = r2.error
    missions = (r2.data || []).map((g: any) => ({
      ...(g.root || {}),
      id: g.root?.id || g.parent_mission_id,
      parc_zone_key: g.parc_zone_key, parc_row_number: g.parc_row_number, parc_slot_index: g.parc_slot_index,
      parked_at: g.parked_at, updated_at: g.updated_at,
      leg_id: g.id, regime: g.mission_type, key_location: g.key_location,
    })).filter((m: any) => m.vehicle_plate || m.vehicle_vin)
      .sort((a: any, b: any) => String(a.parc_zone_key).localeCompare(String(b.parc_zone_key)) || String(a.vehicle_plate || '').localeCompare(String(b.vehicle_plate || '')))
  } else {
    const r1 = await query
    missions = r1.data; error = r1.error
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = (missions || []).map((m: any) => {
    // Cherche le libelle de zone (pour affichage)
    const zoneConf = FOURRIERE_ZONES.find(z => z.code === m.parc_zone_key)
    return {
      id:               m.odoo_vehicle_id ?? null,    // pour rétrocompat front (col `id`)
      mission_id:       m.id,
      mission_number:   m.mission_number,
      plate:            m.vehicle_plate || null,
      vin:              m.vehicle_vin || null,
      brand:            m.vehicle_brand || '',
      model:            m.vehicle_model || '',
      driver:           m.client_name || null,        // ancienne notion "client" exposee comme driver pour rétrocompat front
      state_id:         zoneConf?.state_id || null,
      zone_code:        m.parc_zone_key,
      zone_label:       zoneConf?.label || m.parc_zone_key,
      parc_row_number:  m.parc_row_number ?? null,
      parc_slot_index:  m.parc_slot_index ?? null,
      last_update:      m.updated_at || m.parked_at || null,
      parked_at:        m.parked_at || null,
      leg_id:           m.leg_id || null,
      regime:           m.regime || null,
      days:             m.parked_at ? Math.max(0, Math.floor((Date.now() - new Date(m.parked_at).getTime()) / 86_400_000)) : null,
      source:           m.source,
      external_id:      m.external_id,
      migration_pending: m.migration_pending || false,
      migration_pending_reason: m.migration_pending_reason || null,
      odoo_url:         m.odoo_vehicle_id
                          ? `${ODOO_URL}/web#id=${m.odoo_vehicle_id}&model=fleet.vehicle&view_type=form`
                          : null,
      odoo_ticket_url:  m.odoo_helpdesk_id
                          ? `${ODOO_URL}/web#id=${m.odoo_helpdesk_id}&model=helpdesk.ticket&view_type=form`
                          : null,
    }
  })

  return NextResponse.json({
    vehicles: enriched,
    zones:    FOURRIERE_ZONES,
    source:   gardiennageMode ? 'gardiennage' : 'vd_soft',
  })
}
