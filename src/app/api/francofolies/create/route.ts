// src/app/api/francofolies/create/route.ts
//
// POST /api/francofolies/create — encodage simplifié à l'arrivée d'un véhicule
// (mal garée évènementiel Francofolies de Spa). Crée une fiche mission
// source='francofolies', statut 'parked'. Client + paiement viendront à
// l'enlèvement. Olivier 2026-06-24.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const roles: string[] = Array.isArray(u.roles) ? u.roles : [role]
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r))
    || modules.includes('francofolies')
    || roles.includes('driver') || roles.includes('chauffeur')
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    plate?: string; brand?: string; model?: string; remarks?: string; photo_url?: string
    driver_id?: string; driver_name?: string
  }
  const plate = String(body.plate || '').trim().toUpperCase()
  const driverId = body.driver_id && /^[0-9a-f-]{36}$/i.test(body.driver_id) ? body.driver_id : null
  // Chauffeur "Autre" (pas un user enregistré) → on garde son nom en remarque.
  const driverNameFree = !driverId ? String(body.driver_name || '').trim() : ''
  const brand = String(body.brand || '').trim()
  const model = String(body.model || '').trim()
  if (!plate)            return NextResponse.json({ error: 'Immatriculation requise' }, { status: 400 })
  if (!brand && !model)  return NextResponse.json({ error: 'Marque / Modèle requis' }, { status: 400 })

  const sb  = createAdminClient()
  const now = new Date().toISOString()

  // Prix de base (info ; le calcul définitif se fait à l'enlèvement).
  const { data: priceRow } = await sb.from('app_settings').select('value').eq('key', 'francofolies_price').maybeSingle()
  const price = Number(priceRow?.value || 220)

  // external_id requis (NOT NULL) — identifiant interne unique pour Francofolies.
  const externalId = `FF-${plate}-${Date.now().toString(36).toUpperCase()}`

  const { data: created, error } = await sb
    .from('incoming_missions')
    .insert({
      external_id:       externalId,
      source:            'francofolies',
      source_format:     'francofolies_arrival',
      mission_type:      'remorquage',
      incident_type:     'mal_garee',
      vehicle_plate:     plate,
      vehicle_brand:     brand || null,
      vehicle_model:     model || null,
      incident_address:  'Francofolies de Spa',
      incident_city:     'Spa',
      remarks_general:   [body.remarks?.trim(), driverNameFree ? `Ramené par : ${driverNameFree}` : '']
                           .filter(Boolean).join(' · ') || null,
      driver_photos:     body.photo_url ? [body.photo_url] : null,
      status:            'parked',
      dispatch_mode:     'manual',
      // Chauffeur qui a ramené le véhicule (traçabilité dégâts + stats).
      assigned_to:       driverId,
      assigned_at:       driverId ? now : null,
      parked_at:         now,
      received_at:       now,
      intervention_date: now,
      amount_to_collect: price,
      parse_confidence:  1.0,
    })
    .select('id, mission_number')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: created.id,
    action:     'francofolies_arrival',
    notes:      `Véhicule encodé à l'arrivée (Francofolies) — ${plate} ${[brand, model].filter(Boolean).join(' ')}`,
  }).then(() => {}, () => {})

  // Olivier 2026-06-24 : on crée le véhicule dans Odoo DÈS l'arrivée (pas d'attente
  // du devis). findOrCreateVehicle crée marque/modèle/véhicule si absent. En
  // arrière-plan pour ne pas ralentir l'encodage.
  const ensureVehicle = (async () => {
    try {
      const { findOrCreateVehicle } = await import('@/lib/odoo')
      const vid = await findOrCreateVehicle({ licensePlate: plate, brandName: brand, modelName: model || brand })
      if (vid) await sb.from('incoming_missions').update({ odoo_vehicle_id: vid }).eq('id', created.id)
    } catch (e: any) {
      console.error('[francofolies] findOrCreateVehicle KO:', e?.message)
    }
  })()
  try { const { waitUntil } = await import('@vercel/functions'); waitUntil(ensureVehicle) }
  catch { /* dev/local : on n'attend pas */ ensureVehicle.catch(() => {}) }

  return NextResponse.json({ ok: true, id: created.id, mission_number: created.mission_number })
}
