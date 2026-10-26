// src/app/api/missions/driver-create/route.ts
// Missions créées par le chauffeur terrain.
// Status: in_progress → apparaît dans l'onglet "En cours" du dispatch en temps réel.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const {
    source, mission_type, incident_address, incident_city,
    incident_lat, incident_lng, incident_borne_km, incident_sens,
    vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
    remarks_general,
  } = body

  if (!mission_type)     return NextResponse.json({ error: 'Type de mission requis' }, { status: 400 })
  if (!incident_address) return NextResponse.json({ error: "Adresse d'incident requise" }, { status: 400 })

  const now      = new Date().toISOString()
  const supabase = createAdminClient()

  // Olivier 2026-06-04 : anti-doublon. Cas reel : un chauffeur clique 2x
  // sur "Creer" (double-tap, retry reseau lent...) -> 2 missions identiques.
  // On considere doublon = meme chauffeur + meme plaque + < 2 minutes.
  // Retourne la mission existante au lieu d en creer une nouvelle.
  if (vehicle_plate) {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    const { data: existing } = await supabase
      .from('incoming_missions')
      .select('id, external_id, status, vehicle_plate, mission_type, created_at')
      .eq('vehicle_plate', vehicle_plate)
      .eq('assigned_to', session.user.id)
      .gte('created_at', twoMinutesAgo)
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      console.warn(`[DriverCreate] DOUBLON evite : mission ${existing.id} existe deja pour plaque ${vehicle_plate} (chauffeur ${session.user.id}, ${existing.created_at})`)
      return NextResponse.json({
        ok: true,
        mission: existing,
        duplicate_prevented: true,
        message: 'Mission deja creee il y a quelques secondes (anti-doublon).',
      })
    }
  }

  // Pas de mission avec chauffeur sans camion (Olivier 26/10/2026) : son camion du moment. S'il n'en a pas,
  // la fiche lui demande avec quel camion il roule (MissionTruckModal).
  const { data: me } = await supabase.from('users').select('current_truck_id').eq('id', session.user.id).maybeSingle()

  const { data, error } = await supabase
    .from('incoming_missions')
    .insert({
      truck_id:         me?.current_truck_id || null,
      external_id:      `TERRAIN-${Date.now()}`,
      source:           source         || 'prive',
      mission_type,
      incident_address,
      incident_city:    incident_city  || null,
      incident_lat:     incident_lat   || null,
      incident_lng:     incident_lng   || null,
      incident_borne_km: incident_borne_km || null,
      incident_sens:     incident_sens     || null,
      vehicle_plate:    vehicle_plate  || null,
      vehicle_brand:    vehicle_brand  || null,
      vehicle_model:    vehicle_model  || null,
      vehicle_vin:      vehicle_vin    || null,
      remarks_general:  remarks_general|| null,
      // Le chauffeur crée + accepte + est déjà en route → in_progress
      // Apparaît dans l'onglet "En cours" du dispatch
      status:           'in_progress',
      dispatch_mode:    'manual',
      assigned_to:      session.user.id,
      assigned_at:      now,
      accepted_at:      now,
      on_way_at:        now,
      received_at:      now,
      intervention_date: now,
      created_at:       now,
      updated_at:       now,
    })
    .select('id, external_id, status')
    .single()

  if (error) {
    console.error('[DriverCreate]', error)
    // Refus enregistré avec ce que le chauffeur avait encodé (Olivier 26/10/2026 : création de 2FNJ975 ratée
    // le 24/10 sans aucune trace) ; la référence revient à l'écran pour « Signaler à Sam ».
    const { data: log } = await supabase.from('error_logs').insert({
      level: 'error', route: '/api/missions/driver-create', message: error.message.slice(0, 2000),
      metadata: { code: error.code || null, details: error.details || null, hint: error.hint || null, payload: body },
      user_id: session.user.id, user_email: session.user.email || null,
    }).select('id').single()
    return NextResponse.json({ error: 'La mission n’a pas pu être créée. Tes informations ne sont pas perdues : réessaie ou signale-le.', error_id: log?.id || null }, { status: 500 })
  }

  // Log — Olivier 2026-06-03 : bug audit. La table mission_logs utilise
  // actor_id (uuid) + notes (text), pas user_id + details (jsonb). L INSERT
  // plantait silencieusement -> aucun log pour les missions creees chauffeur.
  const { error: logErr } = await supabase.from('mission_logs').insert({
    mission_id: data.id,
    actor_id:   session.user.id,
    action:     'driver_created',
    notes:      `Source=${source}, type=${mission_type}, lieu=${incident_address}`,
    metadata:   { source, mission_type, incident_address },
  })
  if (logErr) {
    console.error('[DriverCreate] mission_logs insert echec:', logErr.message)
    // Non bloquant : la mission est creee, juste le log manque
  }

  return NextResponse.json({ ok: true, mission: data })
}
