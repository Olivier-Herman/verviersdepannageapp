// src/app/api/fourriere/search/route.ts
//
// GET /api/fourriere/search
//   ?plate=...       (ilike vehicle_plate)
//   ?vin=...         (ilike vehicle_vin)
//   ?pv=...          (ilike police_pv_number)
//   ?vehicle=...     (ilike vehicle_brand OR vehicle_model)
//   ?address=...     (ilike incident_address OR client_address)
//   ?date_from=YYYY-MM-DD
//   ?date_to=YYYY-MM-DD
//   ?depot_id=...    (filtre via parc_zones.depot_id)
//   ?include_history=1   (par defaut : seulement vehicules ACTUELLEMENT en parc)
//
// Olivier 2026-06-03 : ecran de recherche /fourriere refondu.
// Cherche dans incoming_missions, retourne cards compactes pour ouverture
// d une fiche vehicule complete.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ACTIVE_PARC_STATUSES = ['parked', 'delivering', 'unlocated', 'awaiting_payment']

function escapeIlike(s: string): string {
  // Echappe % et _ pour eviter qu un utilisateur casse la requete
  return s.replace(/[\\%_]/g, m => `\\${m}`)
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const plate   = (url.searchParams.get('plate')   || '').trim()
  const vin     = (url.searchParams.get('vin')     || '').trim()
  const pv      = (url.searchParams.get('pv')      || '').trim()
  const vehicle = (url.searchParams.get('vehicle') || '').trim()
  const address = (url.searchParams.get('address') || '').trim()
  const dateFrom = (url.searchParams.get('date_from') || '').trim()
  const dateTo   = (url.searchParams.get('date_to')   || '').trim()
  const depotId  = (url.searchParams.get('depot_id')  || '').trim()
  const includeHistory = url.searchParams.get('include_history') === '1'

  const hasAnyFilter = !!(plate || vin || pv || vehicle || address || dateFrom || dateTo || depotId)
  if (!hasAnyFilter) {
    // Pas de critere → retour vide pour eviter de charger 50k missions
    return NextResponse.json({ results: [], total: 0, hint: 'no_filter' })
  }

  const sb = createAdminClient()

  // Si depot_id filtre, on resout d abord les parc_zone_key concernees
  let zoneKeys: string[] | null = null
  if (depotId) {
    const { data: zones } = await sb
      .from('parc_zones')
      .select('key')
      .eq('depot_id', depotId)
    zoneKeys = (zones || []).map(z => z.key)
    if (zoneKeys.length === 0) {
      return NextResponse.json({ results: [], total: 0, hint: 'no_zones_in_depot' })
    }
  }

  let q = sb
    .from('incoming_missions')
    .select(`
      id, mission_number, external_id, dossier_number, source, status,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      client_name, client_address,
      incident_address, incident_city,
      police_pv_number, officer_name, police_zone,
      parc_zone_key, parc_row_number, parc_slot_index,
      parked_at, loaded_at, received_at, intervention_date, updated_at
    `)
    .order('parked_at',  { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(100)

  if (!includeHistory) {
    q = q.in('status', ACTIVE_PARC_STATUSES)
  }
  if (zoneKeys) q = q.in('parc_zone_key', zoneKeys)
  if (plate)    q = q.ilike('vehicle_plate', `%${escapeIlike(plate.toUpperCase())}%`)
  if (vin)      q = q.ilike('vehicle_vin',   `%${escapeIlike(vin.toUpperCase())}%`)
  if (pv)       q = q.ilike('police_pv_number', `%${escapeIlike(pv)}%`)
  if (vehicle) {
    const v = escapeIlike(vehicle)
    q = q.or(`vehicle_brand.ilike.%${v}%,vehicle_model.ilike.%${v}%`)
  }
  if (address) {
    const a = escapeIlike(address)
    q = q.or(`incident_address.ilike.%${a}%,client_address.ilike.%${a}%,incident_city.ilike.%${a}%`)
  }
  if (dateFrom) q = q.gte('parked_at', `${dateFrom}T00:00:00`)
  if (dateTo)   q = q.lte('parked_at', `${dateTo}T23:59:59`)

  const { data, error } = await q
  if (error) {
    console.error('[fourriere/search]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrichir avec le label du depot (via parc_zone_key → parc_zones → depot_id → depots.name)
  const allZoneKeys = Array.from(new Set((data || []).map(r => r.parc_zone_key).filter(Boolean) as string[]))
  let zoneToDepot: Record<string, { depot_id: string | null; depot_name: string | null; zone_label: string | null }> = {}
  if (allZoneKeys.length > 0) {
    const { data: zr } = await sb
      .from('parc_zones')
      .select('key, label, depot_id, depots:depot_id (id, name)')
      .in('key', allZoneKeys)
    for (const z of (zr || []) as any[]) {
      zoneToDepot[z.key] = {
        depot_id:   z.depot_id || null,
        depot_name: z.depots?.name || null,
        zone_label: z.label || null,
      }
    }
  }

  const results = (data || []).map(r => {
    const z = r.parc_zone_key ? zoneToDepot[r.parc_zone_key] : null
    return {
      id:               r.id,
      mission_number:   r.mission_number,
      dossier_number:   r.dossier_number,
      external_id:      r.external_id,
      source:           r.source,
      status:           r.status,
      plate:            r.vehicle_plate,
      brand:            r.vehicle_brand,
      model:            r.vehicle_model,
      vin:              r.vehicle_vin,
      client_name:      r.client_name,
      client_address:   r.client_address,
      incident_address: r.incident_address,
      incident_city:    r.incident_city,
      police_pv_number: r.police_pv_number,
      officer_name:     r.officer_name,
      police_zone:      r.police_zone,
      parc_zone_key:    r.parc_zone_key,
      parc_row_number:  r.parc_row_number,
      parc_slot_index:  r.parc_slot_index,
      parked_at:        r.parked_at,
      loaded_at:        r.loaded_at,
      received_at:      r.received_at,
      depot_id:         z?.depot_id || null,
      depot_name:       z?.depot_name || null,
      zone_label:       z?.zone_label || null,
    }
  })

  return NextResponse.json({ results, total: results.length })
}
