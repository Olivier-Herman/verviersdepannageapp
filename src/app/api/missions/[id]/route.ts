// src/app/api/missions/[id]/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser }    from '@/lib/push'
import { updateOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { isRelEligibleSource } from '@/lib/missions/rel-eligible'
import { isRemorquage }        from '@/lib/missions/mission-types'

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: mission, error } = await supabase
    .from('incoming_missions')
    .select(`
      *,
      assigned_user:users!assigned_to(id, name, avatar_url),
      logs:mission_logs(id, action, notes, created_at, actor:users!actor_id(name))
    `)
    .eq('id', params.id)
    .single()

  if (error || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  return NextResponse.json({ mission })
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  const allowed = [
    'source',
    'mission_type', 'incident_type', 'incident_description',
    'billed_to_name', 'billed_to_id',
    'odoo_vehicle_id',
    'client_name', 'client_phone', 'client_address',
    'assisted_name', 'assisted_phone',
    'vehicle_plate', 'vehicle_brand', 'vehicle_model', 'vehicle_vin',
    'vehicle_fuel', 'vehicle_gearbox', 'vehicle_mileage',
    'incident_address', 'incident_city', 'incident_country',
    'incident_lat', 'incident_lng',
    'incident_borne_km', 'incident_sens',
    'destination_name', 'destination_address',
    'destination_lat', 'destination_lng',
    'destination_borne_km', 'destination_sens',
    'depot_depart_id',
    'extra_addresses',
    'amount_guaranteed', 'amount_to_collect', 'amount_currency', 'special_tarif_htva',
    'incident_at', 'intervention_date', 'remarks_general',
    // Olivier 2026-06-02 : snc_scenario doit etre modifiable cote dispatch.
    // Bug rapporte : changer source vers police_snc ne propageait pas le
    // comportement SNC car snc_scenario restait NULL → quote, REL eligibility
    // etc. retombaient sur les defauts de l ancienne source.
    'snc_scenario', 'snc_requires_balisage',
  ]

  // On charge l etat actuel pour comparer (notamment la source avant change).
  const { data: before } = await supabase
    .from('incoming_missions')
    .select('source, snc_scenario')
    .eq('id', params.id)
    .maybeSingle()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) {
      // Convertir les strings vides en null pour les champs numériques
      if (['amount_guaranteed', 'amount_to_collect', 'special_tarif_htva', 'incident_lat', 'incident_lng', 'destination_lat', 'destination_lng', 'billed_to_id', 'odoo_vehicle_id'].includes(key)) {
        updates[key] = body[key] === '' || body[key] == null ? null : Number(body[key]) || null
      } else {
        updates[key] = body[key] === '' ? null : body[key]
      }
    }
  }

  // Olivier 2026-06-02 : coherence source ↔ snc_scenario.
  // Si la nouvelle source N EST PAS SNC (police_snc / sia_couvert), on reset
  // snc_scenario a null pour que les helpers (quote, REL, snc-calc) repartent
  // proprement. Sinon le scenario d une ancienne SNC contaminait la nouvelle
  // source.
  // Olivier 2026-06-02 PM : si la nouvelle source EST SNC (police_snc seul,
  // pas SC), on retire AUSSI billed_to_name + billed_to_id. En SNC c est le
  // client final qui paie en direct, pas l assurance/assistance d origine.
  // SC garde billed_to (l assistance facture).
  const SNC_SOURCES = new Set(['police_snc', 'sia_couvert'])
  if ('source' in updates) {
    const newSource = updates.source as string | null
    if (!newSource || !SNC_SOURCES.has(newSource)) {
      updates.snc_scenario        = null
      updates.snc_requires_balisage = false
    } else if (newSource === 'police_snc' && before?.source !== 'police_snc') {
      // Transformation VERS police_snc : on efface le client facture car
      // l ancienne assistance (Touring, IMA, etc.) n est plus le payeur.
      updates.billed_to_name = null
      updates.billed_to_id   = null
    }
  }

  const { data, error } = await supabase
    .from('incoming_missions')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Olivier 2026-06-02 : trace explicite quand la source change. Permet de
  // remonter au dispatcher qui a recategorise une mission (ex: Touring →
  // Siabis non couvert).
  if (before?.source && 'source' in updates && updates.source !== before.source) {
    await supabase.from('mission_logs').insert({
      mission_id: params.id,
      action:     'source_changed',
      notes:      `Source changée : ${before.source} → ${updates.source}${updates.snc_scenario ? ` (scénario ${updates.snc_scenario})` : ''}`,
      metadata:   {
        from_source:   before.source,
        to_source:     updates.source,
        snc_scenario:  updates.snc_scenario ?? null,
        actor:         (session.user as any)?.email || null,
      },
    })
  }

  // Olivier 2026-05-28 : auto-conversion REM -> REM+REL si on vient de saisir
  // une adresse de relivraison sur une mission parquee + REM + source eligible.
  // (Le mecanisme se declenche au update : pas besoin de bouton manuel pour la
  // plupart des cas, il suffit de saisir l adresse.)
  const justGotAddress = ('destination_address' in body || 'redelivery_address' in body)
    && !!(data.destination_address || (data as any).redelivery_address)
  if (
    justGotAddress
    && data.status === 'parked'
    && isRemorquage(data.mission_type)
    && isRelEligibleSource(data.source, (data as any).snc_scenario)
  ) {
    await supabase
      .from('incoming_missions')
      .update({ mission_type: 'REM+REL', updated_at: new Date().toISOString() })
      .eq('id', params.id)
    await supabase.from('mission_logs').insert({
      mission_id: params.id,
      action:     'auto_convert_to_rem_rel',
      notes:      `Conversion auto REM -> REM+REL apres saisie adresse de relivraison`,
      metadata:   { trigger: 'address_set', previous_type: data.mission_type },
    })
    ;(data as any).mission_type = 'REM+REL'
  }

  // Notification push au chauffeur si demandé (modifications dispatcher après assignation).
  // Ne pas spammer pour les changements automatiques (ping silencieux d'adresse, etc).
  // Skippé aussi si la mission n est plus dans le flux du chauffeur : statuts
  // 'parked' / 'to_invoice' / 'completed' / 'cancelled' / 'ignored' = ajustements
  // post-execution (souvent pour facturation) qui ne concernent plus le chauffeur.
  const DRIVER_ACTIVE_STATUSES = ['assigned', 'accepted', 'in_progress', 'delivering']
  if (body._notify_driver && data.assigned_to && DRIVER_ACTIVE_STATUSES.includes(data.status)) {
    sendPushToUser(data.assigned_to, {
      title: '✏️ Mission modifiée',
      body:  `${data.client_name || 'Mission'} — vérifie les nouvelles infos`,
      url:   `/mission/${params.id}`,
      tag:   `mission-updated-${params.id}`,
    }).catch(() => {})
  }

  // Sync vers Odoo (helpdesk + task) : pousse les modifs dispatcher.
  // No-op si pas encore de dossier Odoo créé. Best effort, non bloquant.
  if (body._notify_driver) {
    updateOdooDossierForMission(params.id).catch(e => {
      console.error('[Mission PATCH] Sync Odoo échoué:', e.message)
    })
  }

  return NextResponse.json({ ok: true, mission: data })
}
