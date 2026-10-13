// POST /api/missions/[id]/vab-vr — ordre de la livraison du véhicule de remplacement VAB, décidé par le
// dispatch ou le chauffeur quand la demande arrive alors qu'il est déjà chez le client (Olivier 13/10/2026).
//   { placement: 'before' }   → prise du VR avant la prise en charge (cas normal)
//   { placement: 'after' }    → après le dépôt de la voiture : destination → concession → client
//   { placement: 'separate' } → mission à part (forfait VR + tous les km), retirée de cette fiche
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const placement = String(b?.placement || '')
  if (!['before', 'after', 'separate'].includes(placement)) return NextResponse.json({ error: 'placement : before, after ou separate' }, { status: 400 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name, role, roles').eq('email', u.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, assigned_to, vab_vr, vab_assignment_ids, dossier_number, source, billed_to_id, billed_to_name, vehicle_plate')
    .eq('id', params.id).maybeSingle()
  if (!m || !me) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  const bureau = [me.role, ...(me.roles || [])].some((r: string) => ['dispatcher', 'admin', 'superadmin'].includes(r))
  if (m.assigned_to !== me.id && !bureau) return NextResponse.json({ error: 'Mission non attribuée' }, { status: 403 })
  const vr: any = m.vab_vr
  if (!vr || vr.standalone) return NextResponse.json({ error: 'Pas de livraison de véhicule de remplacement sur cette mission' }, { status: 409 })
  const now = new Date().toISOString()
  const qui = me.name || 'le dispatch'

  if (placement !== 'separate') {
    await sb.from('incoming_missions').update({ vab_vr: { ...vr, placement }, updated_at: now }).eq('id', m.id)
    await sb.from('mission_logs').insert({ mission_id: m.id, actor_id: me.id, action: 'vab_vr_ordre',
      notes: placement === 'before' ? `Véhicule de remplacement : pris AVANT la prise en charge (${qui}).` : `Véhicule de remplacement : livré APRÈS le dépôt de la voiture (${qui}).`,
      metadata: { placement } }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, placement })
  }

  // Mission séparée : nouvelle fiche « livraison VR » (transport, tous les km + forfait VR).
  const { data: nouv, error } = await sb.from('incoming_missions').insert({
    external_id: vr.aid, dossier_number: m.dossier_number, source: m.source, source_format: 'vab-scraper', status: 'new',
    mission_type: 'transport', vehicle_plate: vr.plate, client_name: vr.deliver?.name || null, client_phone: vr.deliver?.phone || null,
    incident_address: vr.pickup?.address || null, incident_lat: vr.pickup?.lat ?? null, incident_lng: vr.pickup?.lng ?? null,
    destination_name: vr.deliver?.name || null, destination_address: vr.deliver?.address || null,
    billed_to_id: m.billed_to_id, billed_to_name: m.billed_to_name, vab_assignment_ids: [vr.aid],
    vab_vr: { ...vr, standalone: true, placement: 'before' }, received_at: now, intervention_date: now,
    remarks_general: `Livraison du véhicule de remplacement séparée de la mission #${m.mission_number ?? '?'} (${qui}).`,
  }).select('id, mission_number').single()
  if (error || !nouv) return NextResponse.json({ error: error?.message || 'Création impossible' }, { status: 500 })
  const ids = (Array.isArray(m.vab_assignment_ids) ? m.vab_assignment_ids : []).filter((a: string) => a !== vr.aid)
  await sb.from('incoming_missions').update({ vab_vr: null, vab_assignment_ids: ids, updated_at: now }).eq('id', m.id)
  await sb.from('mission_logs').insert([
    { mission_id: m.id, actor_id: me.id, action: 'vab_vr_ordre', notes: `Véhicule de remplacement : mission séparée #${nouv.mission_number ?? '?'} (${qui}).`, metadata: { placement, into: nouv.id } },
    { mission_id: nouv.id, actor_id: me.id, action: 'received', notes: `Livraison du véhicule de remplacement ${vr.plate || ''} séparée de la mission #${m.mission_number ?? '?'}.`, metadata: { from: m.id } },
  ]).then(() => {}, () => {})
  return NextResponse.json({ ok: true, placement, mission_id: nouv.id, mission_number: nouv.mission_number })
}
