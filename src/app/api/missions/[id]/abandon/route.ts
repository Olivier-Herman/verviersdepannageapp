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
import { exitParcNow }       from '@/lib/parc/exit-parc'
import { printZPLRaw }       from '@/lib/print/zebra-raw'
import { buildAbandonLabelZPL } from '@/lib/print/zpl-templates/abandon-label'

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

// ── ÉTIQUETTE « ABANDON » (Olivier 26/11/2026) ─────────────────────────────
// Sort en même temps que le document : logo de recyclage, marque, modèle, châssis, date de l'abandon, et
// « CPR » / « AXEL » à entourer au marqueur. Le n° affiché est celui de la fiche principale (l'abandon peut
// être posé sur le volet Gardiennage). Imprimante hors ligne : l'étiquette part en file et ressort toute seule.
async function imprimerEtiquette(sb: ReturnType<typeof createAdminClient>, missionId: string, actorId: string | null): Promise<{ ok: boolean; enFile: boolean; erreur: string | null }> {
  try {
    const { data: m } = await sb.from('incoming_missions')
      .select('id, mission_number, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, abandon_at, abandon_data, dossier_leg, parent_mission_id')
      .eq('id', missionId).maybeSingle()
    if (!m || !(m as any).abandon_at) return { ok: false, enFile: false, erreur: 'pas d’abandon enregistré sur cette fiche' }
    const parent = (m as any).dossier_leg && (m as any).parent_mission_id
      ? (await sb.from('incoming_missions').select('mission_number').eq('id', (m as any).parent_mission_id).maybeSingle()).data
      : null
    const v = (m as any).abandon_data?.vehicle || {}
    const zpl = buildAbandonLabelZPL({
      missionNumber: (parent as any)?.mission_number ?? (m as any).mission_number ?? null,
      brand: v.brand || (m as any).vehicle_brand, model: v.model || (m as any).vehicle_model,
      plate: v.plate || (m as any).vehicle_plate, vin: v.vin || (m as any).vehicle_vin,
      abandonAt: (m as any).abandon_at,
    })
    const r = await printZPLRaw(zpl, { missionId, context: 'abandon_label' })
    await sb.from('mission_logs').insert({
      mission_id: missionId, actor_id: actorId,
      action: r.ok ? 'label_printed' : 'label_print_failed',
      notes: r.ok ? 'Étiquette « Abandon – recyclage » imprimée'
        : r.queued ? 'Étiquette « Abandon – recyclage » en attente : imprimante injoignable, elle sortira dès qu’elle répond'
        : `Étiquette « Abandon – recyclage » NON imprimée : ${r.error || 'erreur inconnue'}`,
      metadata: { kind: 'abandon', ok: r.ok, queued: !!r.queued, error: r.ok ? null : (r.error || null) },
    }).then(() => {}, () => {})
    return { ok: r.ok, enFile: !!r.queued, erreur: r.ok ? null : (r.error || 'erreur inconnue') }
  } catch (e: any) {
    return { ok: false, enFile: false, erreur: e?.message || 'erreur inconnue' }
  }
}

// PUT /api/missions/[id]/abandon → réimprime l'étiquette « Abandon – recyclage ».
export async function PUT(_req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const etiquette = await imprimerEtiquette(createAdminClient(), params.id, actor.id)
  if (!etiquette.ok && !etiquette.enFile) return NextResponse.json({ error: `Étiquette non imprimée : ${etiquette.erreur}` }, { status: 500 })
  return NextResponse.json({ ok: true, etiquette })
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
    .select('id, mission_number, external_id, dossier_number, source, vehicle_brand, vehicle_model, vehicle_plate, vehicle_vin, abandon_at, status, dossier_leg, parent_mission_id')
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

  // ── ABANDON = SORTIE DU PARC (Olivier 14/09/2026) : « vu qu'on a un abandon,
  // il n'y a plus de raison d'avoir un gardiennage en cours. Le véhicule passe
  // en sortie de parc et le dépannage passe à facturer. » Même mécanique que
  // « Clôturer et facturer » : fiche → to_invoice, volet Gardiennage fermé
  // (motif « abandon »), place libérée. Si la sortie est refusée (scénario SNC
  // manquant, contrôle de sortie), l'abandon reste enregistré et on le dit.
  // Le bouton vit sur le VOLET Gardiennage du dossier : l'abandon est posé sur
  // le volet, la sortie se fait sur la fiche principale (parent).
  let exitWarning: string | null = null
  const rootId: string = (mission as any).dossier_leg ? String((mission as any).parent_mission_id || '') : params.id
  const { data: root } = rootId ? await sb.from('incoming_missions').select('id, status').eq('id', rootId).maybeSingle() : { data: null as any }
  if (root?.status === 'parked') {
    const ex = await exitParcNow(sb, root.id, { id: actor.id, name: actor.name }, 'abandon', 'abandon volontaire du véhicule')
    if (!ex.ok) exitWarning = `Abandon enregistré, mais le véhicule n'a pas pu sortir du parc : ${ex.error}`
  }

  const etiquette = await imprimerEtiquette(sb, params.id, actor.id)

  return NextResponse.json({ ok: true, abandon, doc_url: `/api/missions/${params.id}/abandon-doc`, exit_warning: exitWarning, etiquette })
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
