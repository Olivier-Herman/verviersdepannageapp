// GET  /api/fourriere/destruction-dossiers?q=&from=&to=   → recherche (VIN partiel, marque, modèle, couleur, n° dossier, plaque)
// POST /api/fourriere/destruction-dossiers                → crée le dossier ET sort le véhicule du parc (motif destruction)
import { NextResponse }      from 'next/server'
import bcrypt                from 'bcryptjs'
import { createAdminClient } from '@/lib/supabase'
import { fourriereUser }     from '@/lib/fourriere/destruction-access'
import { assertExitAllowed } from '@/lib/missions/exit-control'
import { releaseParcAndShift } from '@/lib/parc/release'
import { costAtDate, gridSourceFor, nextDossierNumber, epavisteName } from '@/lib/fourriere/destruction-dossier'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const sp = new URL(req.url).searchParams
  const q = (sp.get('q') || '').trim()
  let query = sb.from('destruction_dossiers').select('*').order('exited_at', { ascending: false }).limit(200)
  if (sp.get('from')) query = query.gte('exited_at', sp.get('from') + 'T00:00:00')
  if (sp.get('to'))   query = query.lte('exited_at', sp.get('to') + 'T23:59:59')
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`
    const vinLike = `%${q.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`
    query = query.or(`vin.ilike.${vinLike},plate.ilike.${like},brand.ilike.${like},model.ilike.${like},color.ilike.${like},dossier_number.ilike.${like}`)
  }
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ dossiers: data || [] })
}

export async function POST(req: Request) {
  const u = await fourriereUser(); if (!u) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const photos: string[] = Array.isArray(body.photos) ? body.photos.filter((x: any) => typeof x === 'string' && x) : []
  if (photos.length < 3) return NextResponse.json({ error: 'Au moins 3 photos : le dossier doit prouver l’état du véhicule.' }, { status: 400 })
  const missionId: string | null = body.mission_id || null
  const now = new Date().toISOString()

  let mission: any = null
  if (missionId) {
    const { data } = await sb.from('incoming_missions')
      .select('id, mission_number, source, status, vehicle_plate, vehicle_vin, vehicle_brand, vehicle_model, parc_zone_key, parked_at, intervention_date, received_at, mission_type, dossier_leg')
      .eq('id', missionId).maybeSingle()
    if (!data || data.dossier_leg) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
    mission = data
    if (mission.status !== 'parked') return NextResponse.json({ error: `Cette fiche n’est pas en parc (statut ${mission.status}).` }, { status: 409 })

    // Libérable ? Sinon motif + PIN (même règle que la sortie forcée des épaves).
    const gate = await assertExitAllowed(sb, mission.id)
    if (!gate.ok) {
      const reason = String(body.force?.reason || '').trim(), pin = String(body.force?.pin || '').trim()
      if (!reason || !pin) return NextResponse.json({ error: gate.error, blocked: true, reason: gate.state.reason }, { status: 409 })
      if (reason.length < 5) return NextResponse.json({ error: 'Motif obligatoire (5 caractères minimum).' }, { status: 400 })
      const { data: me } = await sb.from('users').select('verify_pin_hash').eq('id', u.id).maybeSingle()
      if (!me?.verify_pin_hash) return NextResponse.json({ error: 'Aucun PIN configuré. Définis ton PIN dans Mon Profil.' }, { status: 400 })
      if (!/^\d{4}$/.test(pin) || !(await bcrypt.compare(pin, me.verify_pin_hash))) return NextResponse.json({ error: 'PIN incorrect.' }, { status: 403 })
    }
  }

  const gridSource = await gridSourceFor(mission?.source)
  const enteredAt: string | null = body.entered_at || mission?.parked_at || mission?.intervention_date || mission?.received_at || null
  const epaviste = await epavisteName()
  const snapshot = await costAtDate({ entered_at: enteredAt, grid_source: gridSource }, now)
  const forced = !!(mission && !(await assertExitAllowed(sb, mission.id)).ok)
  const row = {
    dossier_number: await nextDossierNumber(sb),
    mission_id: mission?.id || null, qr_scanned: !!body.qr_scanned,
    vin: body.vin ? String(body.vin).toUpperCase().replace(/[^A-Z0-9]/g, '') || null : (mission?.vehicle_vin || null),
    vin_image: body.vin_image ?? null, plate: body.plate || mission?.vehicle_plate || null,
    brand: body.brand || mission?.vehicle_brand || null, model: body.model || mission?.vehicle_model || null, color: body.color || null,
    condition: body.condition || null, photos,
    parc_zone_key: body.parc_zone_key || mission?.parc_zone_key || null,
    entered_at: enteredAt, exited_at: now, grid_source: gridSource, regime: mission?.mission_type || null,
    cost_snapshot: snapshot, epaviste,
    forced, forced_reason: forced ? String(body.force?.reason || '') : null, forced_by: forced ? u.id : null,
    created_by: u.id, created_by_name: u.name, notes: body.notes || null,
  }
  const { data: dossier, error } = await sb.from('destruction_dossiers').insert(row).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sortie du parc : fiche terminée sans frais (Olivier : aucune facture Odoo), volets fermés.
  if (mission) {
    await sb.from('incoming_missions').update({
      status: 'completed', completed_at: now, no_charge_at: now, no_charge_reason: `Destruction — ${epaviste || 'épaviste'} (dossier ${row.dossier_number})`, no_charge_by: u.id,
      parc_exit_at: now, parc_exit_reason: 'destruction', updated_at: now,
      ...(row.vin && !mission.vehicle_vin ? { vehicle_vin: row.vin } : {}),
    }).eq('id', mission.id)
    await sb.from('incoming_missions').update({ parc_exit_at: now, parc_exit_reason: 'destruction', no_charge_at: now, no_charge_reason: `Destruction (dossier ${row.dossier_number})`, updated_at: now })
      .eq('parc_origin_mission_id', mission.id).eq('dossier_leg', true).is('parc_exit_at', null)
    try { await releaseParcAndShift(sb, mission.id) } catch { /* non bloquant */ }
    await sb.from('mission_logs').insert({
      mission_id: mission.id, actor_id: u.id, action: 'destruction',
      notes: `Sortie pour destruction — ${epaviste || 'épaviste'} · dossier ${row.dossier_number} (${photos.length} photos${row.vin ? ', VIN ' + row.vin : ''})${forced ? ` · SORTIE FORCÉE : ${row.forced_reason}` : ''}. Aucun envoi à la commune, aucune facture.`,
      metadata: { dossier_id: dossier.id, dossier_number: row.dossier_number, forced, cost_snapshot: snapshot },
    }).then(() => {}, () => {})
  }
  return NextResponse.json({ ok: true, dossier })
}
