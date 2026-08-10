// src/app/api/missions/[id]/force-status/route.ts
//
// POST /api/missions/[id]/force-status { status }
//
// Action dispatcher : force le statut d'une mission sans passer par le
// pointage chauffeur. Utile pour debloquer une mission abandonnee, la
// reinitialiser, ou la cloturer sans photos.
//
// Reserve admin/superadmin/dispatcher.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { isRelEligibleSource } from '@/lib/missions/rel-eligible'
import { isRemorquage }        from '@/lib/missions/mission-types'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60   // clôture Kaze en arrière-plan peut prendre ~10s

const ALLOWED_STATUS = ['new', 'dispatching', 'assigned', 'in_progress', 'parked', 'delivering', 'completed', 'to_invoice'] as const

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = (session.user as any).role || ''
  if (!['admin', 'superadmin', 'dispatcher'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userId = (session.user as any).id

  const body = await req.json() as {
    status?:           string
    reset_assignment?: boolean
    // Olivier 2026-05-28 : pour "Forcer en parc", le dispatcher choisit
    // explicitement le depot de depart et la zone du parc.
    depot_depart_id?:  string | null
    parc_zone_key?:    string | null
    parc_row_number?:  number | null
    parc_slot_index?:  number | null
  }
  if (!body.status || !(ALLOWED_STATUS as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: `Status invalide. Allowed: ${ALLOWED_STATUS.join(', ')}` }, { status: 400 })
  }

  const sb = createAdminClient()
  const now = new Date().toISOString()

  const update: any = {
    status:     body.status,
    updated_at: now,
  }

  // Si on réinitialise à "dispatching" ou "new" → désassigner le chauffeur
  if (body.status === 'dispatching' || body.status === 'new' || body.reset_assignment) {
    update.assigned_to = null
    update.assigned_at = null
    update.accepted_at = null
    update.on_way_at   = null
    update.on_site_at  = null
    update.loaded_at   = null
    update.parked_at   = null
    update.completed_at = null
  }

  // Si on force "completed" ou "to_invoice" → set completed_at si pas déjà.
  // GARDE : une clôture forcée doit quand même avoir le SCÉNARIO (SNC), sinon la
  // mission est incomplète / non facturable. Olivier 2026-08-10 (cas 2ENY965).
  if (body.status === 'completed' || body.status === 'to_invoice') {
    const { data: m } = await sb.from('incoming_missions').select('source, snc_scenario').eq('id', params.id).maybeSingle()
    if (['police_snc', 'sia_couvert'].includes(m?.source || '') && !m?.snc_scenario) {
      return NextResponse.json({ error: 'Scénario SNC requis avant de clôturer (dépannage sur place / REM…). Choisis le scénario sur la fiche, puis réessaie.' }, { status: 400 })
    }
    update.completed_at = now
  }

  // Si on force "parked" → set parked_at + (optionnel) depot + zone parc
  let m: any = null
  if (body.status === 'parked') {
    update.parked_at = now

    // Olivier 2026-05-28 : depot et zone parc obligatoires pour "Forcer en parc".
    if (body.depot_depart_id !== undefined) {
      update.depot_depart_id = body.depot_depart_id || null
    }
    if (body.parc_zone_key !== undefined) {
      update.parc_zone_key = body.parc_zone_key || null
    }
    if (body.parc_row_number !== undefined) {
      update.parc_row_number = body.parc_row_number != null ? Number(body.parc_row_number) : null
    }
    if (body.parc_slot_index !== undefined) {
      update.parc_slot_index = body.parc_slot_index != null ? Number(body.parc_slot_index) : null
    }

    // Auto-conversion REM -> REM+REL si source eligible ET adresse de
    // relivraison deja connue. Sans adresse, attente saisie.
    const { data: mRow } = await sb
      .from('incoming_missions')
      .select('source, mission_type, snc_scenario, destination_address, redelivery_address, depot_depart_id')
      .eq('id', params.id)
      .maybeSingle()
    m = mRow

    // Olivier 2026-06-18 : si aucun depot/zone n'a ete choisi explicitement, on
    // applique le parc + zone par defaut configures pour la source (admin /sources).
    if ((!update.depot_depart_id || !update.parc_zone_key) && m?.source) {
      const { data: cat } = await sb
        .from('mission_source_catalog')
        .select('default_depot_id, default_parc_zone_key')
        .eq('key', m.source)
        .maybeSingle()
      if (!update.depot_depart_id && cat?.default_depot_id) update.depot_depart_id = cat.default_depot_id
      if (!update.parc_zone_key && cat?.default_parc_zone_key) update.parc_zone_key = cat.default_parc_zone_key
    }
    const hasAddr = !!((m as any)?.redelivery_address || (m as any)?.destination_address)
    if (m && hasAddr && isRemorquage(m.mission_type) && isRelEligibleSource(m.source, (m as any).snc_scenario)) {
      update.mission_type = 'REM+REL'
    }

    // Olivier 2026-07-05 : appliquer la règle métier « véhicule en parc » comme le
    // pointage chauffeur (driver-action) — que le forcing dispatch oubliait :
    //   - destination = adresse du PARC (dépôt où le véhicule est déposé),
    //   - l'ancienne destination (garage) devient l'adresse de RELIVRAISON
    //     (sauf si une relivraison est déjà définie).
    let parcAddress: string | null = null
    const depotForAddr = update.depot_depart_id || (m as any)?.depot_depart_id || null
    if (depotForAddr) {
      const { data: d } = await sb.from('depots').select('address').eq('id', depotForAddr).maybeSingle()
      parcAddress = (d?.address || '').trim() || null
    }
    if (!parcAddress) {
      const { data: d } = await sb.from('depots').select('address').eq('is_default', true).eq('active', true).maybeSingle()
      parcAddress = (d?.address || '').trim() || null
    }
    const plannedDest  = ((m as any)?.destination_address || '').trim() || null
    const alreadyReliv = ((m as any)?.redelivery_address  || '').trim() || null
    if (!alreadyReliv && plannedDest && (!parcAddress || plannedDest !== parcAddress)) {
      update.redelivery_address = plannedDest
    }
    if (parcAddress) update.destination_address = parcAddress
  }

  const { error } = await sb.from('incoming_missions').update(update).eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Parc Odoo : véhicule → Terminé si le dossier est bouclé (idempotent, non bloquant).
  if (body.status === 'to_invoice' || body.status === 'completed') {
    const { syncParcVehicleTerminated } = await import('@/lib/missions/parc-fleet-state')
    await syncParcVehicleTerminated(sb, params.id)
  }

  // Log
  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   userId,
    action:     `force_status_${body.status}`,
    notes:      `Statut force par dispatcher → ${body.status}`,
    metadata:   { forced_by_role: role, ...(update.assigned_to === null ? { assignment_reset: true } : {}) },
  })

  // Olivier 2026-06-18 : clôture FORCÉE par le dispatch d'une mission Kaze →
  // clôturer AUSSI le job Kaze automatiquement (étapes + photos), comme le ferait
  // le pointage chauffeur. Sans ça, une mission Kaze "forcée à facturer" restait
  // "pas encore commencé" côté Kaze. En arrière-plan, non bloquant.
  if (body.status === 'completed' || body.status === 'to_invoice') {
    const { data: km } = await sb
      .from('incoming_missions')
      .select('kaze_job_id, driver_photos, client_signature')
      .eq('id', params.id)
      .maybeSingle()
    if (km?.kaze_job_id) {
      const kazeBg = (async () => {
        try {
          const { advanceKazeMissionForAction } = await import('@/lib/kaze/outbound')
          const r = await advanceKazeMissionForAction({
            id:               params.id,
            kaze_job_id:      km.kaze_job_id,
            driver_photos:    Array.isArray((km as any).driver_photos) ? (km as any).driver_photos : null,
            client_signature: (km as any).client_signature || null,
          } as any, 'completed')
          await sb.from('mission_logs').insert({
            mission_id: params.id, actor_id: userId,
            action: r.ok !== false ? 'kaze_synced' : 'kaze_sync_error',
            notes:  r.ok !== false
              ? `Kaze ↗ clôture forcée : workflow avancé${r.status ? ` (statut ${r.status})` : ''}`
              : `Kaze ↗ clôture forcée : échec — ${r.error || 'inconnue'}`,
            metadata: { forced: true, advance_ok: r.ok, advance_status: r.status ?? null, advance_error: r.error ?? null },
          }).then(() => {}, () => {})
        } catch (e: any) {
          await sb.from('mission_logs').insert({
            mission_id: params.id, actor_id: userId, action: 'kaze_sync_error',
            notes: `Kaze ↗ clôture forcée : exception — ${e?.message || 'inconnue'}`,
            metadata: { forced: true },
          }).then(() => {}, () => {})
        }
      })()
      try { const { waitUntil } = await import('@vercel/functions'); waitUntil(kazeBg) }
      catch { await kazeBg }
    }
  }

  return NextResponse.json({ ok: true, new_status: body.status })
}
