// src/app/api/missions/[id]/abandon/route.ts
//
// POST   /api/missions/[id]/abandon  → enregistre un ABANDON VOLONTAIRE de véhicule
// DELETE /api/missions/[id]/abandon  → annule l'abandon (erreur de saisie)
//
// L'identité vient soit de la carte d'identité lue au comptoir (EidImportButton
// → écran client), soit de la saisie manuelle. Le véhicule vient de la fiche :
// on en fige un instantané, parce que la plaque d'un véhicule abandonné finit
// par changer (radiation, revente, destruction) et que le document doit rester
// lisible tel qu'il a été signé.
//
// « En échange des frais de gardiennage » (coché par défaut) → storage_waived :
// le gardiennage cesse de courir sur un véhicule qui ne sortira pas.
// Olivier 2026-08-19.
//
// SAISIE POLICE : refusé. Le propriétaire d'un véhicule saisi doit renoncer au
// véhicule auprès de la zone de police qui a ordonné la saisie — c'est elle qui
// détient le dossier, VD ne peut pas l'acter à sa place. L'abandon chez nous ne
// vaut que pour une panne, un accident ou une mal garée. Le DELETE reste ouvert :
// il faut pouvoir rattraper un abandon enregistré à tort avant ce garde-fou.
// Olivier 2026-08-20.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

const str = (v: any, max = 200) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const lastName  = str(body.last_name, 120)
  const firstName = str(body.first_name, 120)
  const street    = str(body.street, 200)
  const zip       = str(body.zip, 20)
  const city      = str(body.city, 120)

  if (!lastName && !firstName) {
    return NextResponse.json({ error: 'Nom et prénom du client requis.' }, { status: 400 })
  }
  if (!street || !city) {
    return NextResponse.json({ error: 'Adresse du client requise (rue et localité).' }, { status: 400 })
  }

  const sb = createAdminClient()
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('id, mission_number, external_id, dossier_number, source, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, abandon_at')
    .eq('id', params.id)
    .maybeSingle()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  if ((mission.source || '').toLowerCase().trim() === 'police_saisie') {
    return NextResponse.json({
      error: "Véhicule en saisie police : l'abandon se fait auprès de la zone de police "
           + "qui a ordonné la saisie, pas chez nous. L'abandon n'est possible ici que pour "
           + 'une panne, un accident ou une mal garée.',
    }, { status: 400 })
  }

  const waive = body.waive_storage !== false        // coché par défaut
  const now   = new Date().toISOString()

  const abandon = {
    last_name:       lastName,
    first_name:      firstName,
    birth_date:      str(body.birth_date, 40),
    national_number: str(body.national_number, 40),
    street, zip, city,
    country:         str(body.country, 80) || 'Belgique',
    // 'eid' = lu sur la puce au comptoir, 'manual' = saisi par l'opérateur.
    identity_source: body.identity_source === 'eid' ? 'eid' : 'manual',
    waive_storage:   waive,
    // Signature manuscrite capturée à l'écran (facultative : le document peut
    // aussi être imprimé et signé au stylo).
    signature:       typeof body.signature === 'string' && body.signature.startsWith('data:image') ? body.signature : null,
    signed_place:    str(body.signed_place, 120) || 'Pepinster',
    // Instantané véhicule : ce qui a été écrit sur le document signé.
    vehicle: {
      brand: mission.vehicle_brand || null,
      model: mission.vehicle_model || null,
      plate: mission.vehicle_plate || null,
      vin:   mission.vehicle_vin   || null,
    },
    created_at:      now,
    created_by:      actor.id,
    created_by_name: actor.name || actor.email || null,
  }

  // estimated_htva est FIGÉ à la clôture (cron fill-estimated-htva). Sur une
  // fiche déjà clôturée, le CA gelé contient encore le gardiennage : on le
  // remet à null pour que le cron le recalcule avec la remise. Olivier 2026-08-20.
  const { error } = await sb.from('incoming_missions')
    .update({
      abandon_data: abandon, abandon_at: now, storage_waived: waive,
      ...(waive ? { estimated_htva: null, estimated_htva_at: null } : {}),
    })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   actor.id,
    action:     'abandon_vehicule',
    notes:      `Abandon volontaire du véhicule par ${[firstName, lastName].filter(Boolean).join(' ')}`
                + `${waive ? ' — en échange des frais de gardiennage (gardiennage remis à zéro)' : ''}`
                + `${abandon.identity_source === 'eid' ? ' [carte d\'identité]' : ' [saisie manuelle]'}`,
    metadata:   { waive_storage: waive, identity_source: abandon.identity_source, signed: !!abandon.signature },
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true, abandon, doc_url: `/api/missions/${params.id}/abandon-doc` })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { error } = await sb.from('incoming_missions')
    .update({ abandon_data: null, abandon_at: null, storage_waived: false, estimated_htva: null, estimated_htva_at: null })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: params.id,
    actor_id:   actor.id,
    action:     'abandon_vehicule_annule',
    notes:      'Abandon volontaire annulé — le gardiennage repart normalement.',
  }).then(() => {}, () => {})

  return NextResponse.json({ ok: true })
}
