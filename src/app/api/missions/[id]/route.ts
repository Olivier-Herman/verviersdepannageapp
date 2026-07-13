// src/app/api/missions/[id]/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendPushToUser }    from '@/lib/push'
import { updateOdooDossierForMission } from '@/lib/missions/odoo-dossier'
import { withOdooActor }       from '@/lib/odoo'
import { isRelEligibleSource } from '@/lib/missions/rel-eligible'
import { isRemorquage }        from '@/lib/missions/mission-types'
import { KEY_LOCATION_LABELS }  from '@/lib/key-location'

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
    'dossier_number',
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
    // Olivier 2026-06-12 : adresse de relivraison editable seule (sans creer la
    // REL). Permet d enregistrer l adresse pour qu elle apparaisse sur l etiquette
    // parc K (sinon "En attente d info adresse de relivraison").
    'redelivery_address',
    // Olivier 2026-06-22 : coords de l'adresse de relivraison (géocodées côté
    // navigateur par le dispatch) → tri par tournée de l'onglet À Relivrer.
    'redelivery_lat', 'redelivery_lng',
    'depot_depart_id', 'depot_depart_locked',
    'extra_addresses',
    'amount_guaranteed', 'amount_to_collect', 'amount_currency', 'special_tarif_htva',
    'incident_at', 'intervention_date', 'remarks_general',
    // Olivier 2026-07-07 : « Remarque de facturation » éditable par le dispatch,
    // rappelée en haut de la fiche + blocage à la facturation.
    'remarks_billing',
    'incident_info', 'destination_info', 'redelivery_info',
    // Olivier 2026-06-02 PM : dates parc modifiables (correction gardiennage post-coup).
    'parked_at', 'delivering_at',
    // Olivier 2026-06-02 : snc_scenario doit etre modifiable cote dispatch.
    // Bug rapporte : changer source vers police_snc ne propageait pas le
    // comportement SNC car snc_scenario restait NULL → quote, REL eligibility
    // etc. retombaient sur les defauts de l ancienne source.
    'snc_scenario', 'snc_requires_balisage',
    // Olivier 2026-06-14 : bloc police éditable depuis la fiche dispatch.
    'police_zone', 'officer_name', 'officer_partner_id',
    // Olivier 2026-06-18 : clés (emplacement chauffeur + crochet boîte saisie bureau).
    'key_location', 'saisie_key_hook',
    // Olivier 2026-07-05 : roulant / non roulant modifiable depuis la fiche (picto).
    'is_rollable',
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

  // Olivier 2026-06-18 : historiser les modifications de clés.
  const keyActorId = (session.user as any)?.id as string | undefined
  if ('key_location' in updates) {
    await supabase.from('mission_logs').insert({
      mission_id: params.id, actor_id: keyActorId || null, action: 'key_location',
      notes: `Emplacement clé : ${KEY_LOCATION_LABELS[String(updates.key_location)] || updates.key_location || '—'}`,
      metadata: { key_location: updates.key_location, actor: (session.user as any)?.email || null },
    })
  }
  if ('saisie_key_hook' in updates) {
    await supabase.from('mission_logs').insert({
      mission_id: params.id, actor_id: keyActorId || null, action: 'key_hook',
      notes: updates.saisie_key_hook ? `Crochet boîte à clés : n° ${updates.saisie_key_hook}` : 'Crochet boîte à clés retiré',
      metadata: { saisie_key_hook: updates.saisie_key_hook ?? null, actor: (session.user as any)?.email || null },
    })
  }

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

  // Olivier 2026-06-22 / 2026-07-13 : quand l'adresse de relivraison change sur une
  // fiche en parc, on route vers la BONNE zone de relivraison :
  //   - K1 « En attente d'adresse » : pas d'adresse OU adresse = un de nos dépôts.
  //   - K  : vraie destination connue.
  // Se déclenche si la fiche est déjà en zone relivraison (K/K1 → recalcul) OU si
  // une adresse non vide est saisie sur une fiche en parc (hors zones relivraison).
  {
    const REL_SET = new Set(['K', 'K1'])
    const curZone = (data as any).parc_zone_key
    const addrInBody = 'redelivery_address' in body
    if (
      addrInBody
      && data.status === 'parked'
      && curZone
      && (REL_SET.has(curZone) || !!(data as any).redelivery_address)
    ) {
      const { relivraisonZoneFor } = await import('@/lib/parc/relivraison-zone')
      const target = await relivraisonZoneFor(supabase, (data as any).redelivery_address)
      if (target !== curZone) {
        await supabase
          .from('incoming_missions')
          .update({
            parc_zone_key:   target,
            parc_row_number: null,
            parc_slot_index: null,
            updated_at:      new Date().toISOString(),
          })
          .eq('id', params.id)
        ;(data as any).parc_zone_key = target
        await supabase.from('mission_logs').insert({
          mission_id: params.id,
          action:     'auto_transfer_zone_k',
          notes:      target === 'K1'
            ? `Bascule auto en K1 (en attente d'adresse) — depuis ${curZone}`
            : `Bascule auto en zone K (relivraison) après saisie de l'adresse — depuis ${curZone}`,
          metadata:   { from_zone: curZone, to_zone: target, trigger: 'redelivery_address_set' },
        })
        // Étiquette relivraison uniquement pour K (vraie destination). En K1 il n'y
        // a pas encore d'adresse → pas d'étiquette REL. Non bloquant.
        if (target === 'K') {
          try {
            const { reprintLabelForMission } = await import('@/lib/missions/reprint-label-helper')
            await reprintLabelForMission({ kind: 'uuid', value: params.id })
          } catch (e: any) {
            console.warn(`[mission PATCH] impression étiquette relivraison KO mission=${params.id}:`, e?.message)
          }
        }
      }
    }
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
  // Olivier 2026-06-04 : wrap dans withOdooActor pour que le sync utilise
  // la cle API personnelle du user (tracabilite Odoo) au lieu de tomber
  // sur le fallback VD App. Le contexte AsyncLocalStorage est propage aux
  // promises non-awaited par construction.
  if (body._notify_driver) {
    const actorId = (session.user as any)?.id as string | undefined
    withOdooActor(actorId, () => updateOdooDossierForMission(params.id)).catch(e => {
      console.error('[Mission PATCH] Sync Odoo échoué:', e.message)
    })
  }

  return NextResponse.json({ ok: true, mission: data })
}
