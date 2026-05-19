// src/app/api/parc/place/route.ts
//
// POST /api/parc/place
// Body: { mission_id, zone_key?, row_number?, slot_index? }
//   - Si zone_key/row_number/slot_index sont fournis -> place le vehicule
//   - Si zone_key=null -> retire le vehicule du parc (revient en "a placer")
//
// Permissions :
//   - admin / superadmin / dispatcher : peuvent placer dans toutes les zones
//   - chauffeur (driver)              : limite a A et Transit (cf. memoire equipe)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const DRIVER_ALLOWED_ZONES = ['A', 'Transit']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user  = session.user as any
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [user.role].filter(Boolean)
  const normalized = roles.map(r => String(r ?? '').toLowerCase())
  const isSuperadmin = normalized.includes('superadmin')
  const isDispatcher = isSuperadmin || normalized.some(r => r === 'admin' || r === 'dispatcher')
  const isDriver     = isSuperadmin || normalized.includes('chauffeur') || normalized.includes('driver')

  if (!isDriver && !isDispatcher) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  let   missionId = String(body.mission_id || '')
  const zoneKey   = body.zone_key != null ? String(body.zone_key).trim() : null
  const rowNumber = body.row_number != null ? Number(body.row_number) : null
  const slotIndex = body.slot_index != null ? Number(body.slot_index) : null
  // Pour les drops d entrees virtuelles "odoo-<id>" : on attend la plaque +
  // marque + modele pour pouvoir creer le incoming_missions stub.
  const vehiclePlate = body.vehicle_plate != null ? String(body.vehicle_plate).trim().toUpperCase() : null
  const vehicleBrand = body.vehicle_brand != null ? String(body.vehicle_brand).trim() : null
  const vehicleModel = body.vehicle_model != null ? String(body.vehicle_model).trim() : null

  if (!missionId) {
    return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  }

  const sb = createAdminClient()

  // Detect drop d une entree virtuelle Odoo -> on cree la mission VD Soft
  // a la volee avant de la placer normalement.
  if (missionId.startsWith('odoo-')) {
    if (!zoneKey) {
      return NextResponse.json({ error: 'Ce véhicule doit être placé sur le plan (zone requise).' }, { status: 400 })
    }
    if (!vehiclePlate) {
      return NextResponse.json({ error: 'vehicle_plate requis pour un drop Odoo virtuel.' }, { status: 400 })
    }
    const odooId = parseInt(missionId.slice(5), 10)
    if (!Number.isFinite(odooId)) {
      return NextResponse.json({ error: 'ID Odoo invalide.' }, { status: 400 })
    }
    const externalId = `odoo-${odooId}`
    // Idempotent : si une mission stub existe deja (drop precedent), on la reutilise.
    const { data: existing } = await sb
      .from('incoming_missions')
      .select('id')
      .eq('external_id', externalId)
      .maybeSingle()
    if (existing) {
      missionId = existing.id
    } else {
      const { data: created, error: createErr } = await sb
        .from('incoming_missions')
        .insert({
          external_id:    externalId,
          source:         'fourriere_parc',
          source_format:  'odoo_parc',
          mission_type:   'fourriere',
          status:         'parked',
          vehicle_plate:  vehiclePlate,
          vehicle_brand:  vehicleBrand || null,
          vehicle_model:  vehicleModel || null,
        })
        .select('id')
        .single()
      if (createErr || !created) {
        return NextResponse.json({ error: `Création mission échouée : ${createErr?.message}` }, { status: 500 })
      }
      missionId = created.id
    }
  }

  // Validation des coordonnees si placement (zoneKey != null)
  let finalZone = zoneKey
  let finalRow  = rowNumber
  let finalSlot = slotIndex
  if (zoneKey) {
    // Verifier d abord si la zone cible est de type pool (Bordel) : dans ce cas
    // pas de rangee/slot, on attache juste a la zone.
    const { data: targetZone } = await sb
      .from('parc_zones')
      .select('is_pool, pool_capacity, strict_capacity')
      .eq('key', zoneKey)
      .maybeSingle()
    const isPool = !!targetZone?.is_pool
    if (isPool) {
      // Force row/slot a null en pool
      finalRow  = null
      finalSlot = null
    } else {
      if (!Number.isInteger(rowNumber) || rowNumber == null || rowNumber <= 0 ||
          !Number.isInteger(slotIndex) || slotIndex == null || slotIndex <= 0) {
        return NextResponse.json({ error: 'row_number et slot_index requis si zone_key' }, { status: 400 })
      }
    }

    // Permission chauffeur restreinte (vaut pour grille + pool)
    if (!isDispatcher && isDriver && !DRIVER_ALLOWED_ZONES.includes(zoneKey as string)) {
      return NextResponse.json({
        error: `Les chauffeurs ne peuvent placer que dans ${DRIVER_ALLOWED_ZONES.join(' ou ')}`,
      }, { status: 403 })
    }

    // Zone pool (Bordel) : pas de validation row/slot/swap. On laisse passer
    // (overflow tolere par design).
    if (!isPool) {
    const { data: groupHit } = await sb
      .from('parc_slot_groups')
      .select('group_uuid')
      .eq('zone_key',   zoneKey)
      .eq('row_number', rowNumber)
      .eq('slot_index', slotIndex)
      .maybeSingle()
    if (groupHit) {
      const { data: primary } = await sb
        .from('parc_slot_groups')
        .select('zone_key, row_number, slot_index')
        .eq('group_uuid', groupHit.group_uuid)
        .eq('selection_order', 1)
        .maybeSingle()
      if (primary) {
        finalZone = primary.zone_key
        finalRow  = primary.row_number
        finalSlot = primary.slot_index
      }
    }

    // Verifier que la ligne existe
    const { data: row } = await sb
      .from('parc_rows')
      .select('id, capacity')
      .eq('zone_key', finalZone)
      .eq('row_number', finalRow)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: `Ligne ${finalZone}${finalRow} inexistante` }, { status: 400 })
    }

    // Si la zone est strict_capacity, refuse tout depassement de capacite.
    // Sinon (mode flexible), tolere UN seul slot d overflow : on plafonne
    // a capacity + 1 (au-dela, l affichage limite et la cible devient
    // invisible -> refus pour eviter les vehicules fantomes).
    const { data: zone } = await sb
      .from('parc_zones')
      .select('strict_capacity')
      .eq('key', finalZone)
      .maybeSingle()
    const maxSlot = zone?.strict_capacity ? row.capacity : row.capacity + 1
    if ((finalSlot as number) > maxSlot) {
      const msg = zone?.strict_capacity
        ? `Zone ${finalZone} en mode strict : capacité ${row.capacity}, pas d overflow.`
        : `Zone ${finalZone} : 1 seul overflow autorisé (capacité ${row.capacity} + 1).`
      return NextResponse.json({ error: msg }, { status: 409 })
    }

    // Refuse si le slot est marque bloque par un gestionnaire fourriere
    const { data: blocked } = await sb
      .from('parc_blocked_slots')
      .select('reason')
      .eq('zone_key',   finalZone)
      .eq('row_number', finalRow)
      .eq('slot_index', finalSlot)
      .maybeSingle()
    if (blocked) {
      const motif = blocked.reason ? ` (${blocked.reason})` : ''
      return NextResponse.json({
        error: `Emplacement ${finalZone}${finalRow}-${finalSlot} bloqué${motif}.`,
      }, { status: 409 })
    }

    // Si un autre vehicule occupe deja exactement ce slot : swap UNIQUEMENT
    // si la mission qu on bouge a deja une position complete (vrai deplacement
    // intra-canvas). Sinon (sidebar -> slot occupe) on REFUSE pour ne pas
    // ejecter le vehicule existant dans le vide.
    const { data: currentOccupant } = await sb
      .from('incoming_missions')
      .select('id, vehicle_plate, parc_zone_key, parc_row_number, parc_slot_index')
      .eq('parc_zone_key', finalZone)
      .eq('parc_row_number', finalRow)
      .eq('parc_slot_index', finalSlot)
      .neq('id', missionId)
      .maybeSingle()

    if (currentOccupant) {
      const { data: moving } = await sb
        .from('incoming_missions')
        .select('parc_zone_key, parc_row_number, parc_slot_index')
        .eq('id', missionId)
        .maybeSingle()

      const movingHasFullPos = !!(moving?.parc_zone_key && moving?.parc_row_number && moving?.parc_slot_index)
      if (!movingHasFullPos) {
        return NextResponse.json({
          error: `Emplacement ${finalZone}${finalRow}-${finalSlot} occupé par ${currentOccupant.vehicle_plate || 'un véhicule'}. Choisis un slot libre ou retire-le d'abord.`,
        }, { status: 409 })
      }

      // Swap : l'occupant prend l'ancienne position de moving
      await sb.from('incoming_missions').update({
        parc_zone_key:   moving!.parc_zone_key,
        parc_row_number: moving!.parc_row_number,
        parc_slot_index: moving!.parc_slot_index,
      }).eq('id', currentOccupant.id)
    }
    }  // fin if (!isPool)
  }

  // Mise a jour du placement. Si on place (zoneKey != null), force status='parked'
  // pour qu une mission delivering / completed devienne reellement en parc.
  const updates: Record<string, any> = {
    parc_zone_key:   finalZone,
    parc_row_number: finalZone ? finalRow : null,
    parc_slot_index: finalZone ? finalSlot : null,
  }
  if (finalZone) updates.status = 'parked'

  const { error } = await sb.from('incoming_missions').update(updates).eq('id', missionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
