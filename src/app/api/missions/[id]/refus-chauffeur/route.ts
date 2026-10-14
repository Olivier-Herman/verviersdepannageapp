// POST /api/missions/[id]/refus-chauffeur  { motif }
// « Je ne peux pas la prendre » (Olivier 14/10/2026) : une mission attribuée mais pas encore acceptée
// reste verrouillée pour le chauffeur ; s'il ne peut pas la faire, il la rend au dispatch avec un motif
// au lieu de l'accepter juste pour voir les détails. Même retour que « Retirer l'assignation » côté dispatch.
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sendNotificationToRoles } from '@/lib/notifications/send'
import { rpcFsm, getFsmStageId, FSM_FIELDS } from '@/lib/odoo-fsm'

export const dynamic = 'force-dynamic'

const MOTIFS: Record<string, string> = {
  autre_mission: 'déjà sur une autre mission',
  camion:        'camion pas adapté',
  indisponible:  'pas disponible',
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!u?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const motif = MOTIFS[String(b?.motif || '')]
  if (!motif) return NextResponse.json({ error: 'Motif manquant' }, { status: 400 })
  const sb = createAdminClient()
  const { data: me } = await sb.from('users').select('id, name').eq('email', u.email).maybeSingle()
  const { data: m } = await sb.from('incoming_missions')
    .select('id, mission_number, status, assigned_to, accepted_at, vehicle_plate, incident_city, odoo_task_id')
    .eq('id', params.id).maybeSingle()
  if (!m || !me) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (m.assigned_to !== me.id) return NextResponse.json({ error: 'Cette mission ne t\'est plus attribuée' }, { status: 409 })
  if (m.status !== 'assigned' || m.accepted_at) return NextResponse.json({ error: 'Mission déjà acceptée : vois avec le dispatch' }, { status: 409 })

  // Garde sur le chauffeur et le statut : un dispatch qui réattribue au même moment garde la main.
  const { data: rendu } = await sb.from('incoming_missions')
    .update({ status: 'dispatching', assigned_to: null, assigned_at: null, truck_id: null, updated_at: new Date().toISOString() })
    .eq('id', m.id).eq('assigned_to', me.id).eq('status', 'assigned')
    .select('id').maybeSingle()
  if (!rendu) return NextResponse.json({ error: 'La mission a changé entre-temps : vois avec le dispatch' }, { status: 409 })

  await sb.from('mission_logs').insert({
    mission_id: m.id, actor_id: me.id, action: 'refus_chauffeur',
    notes: `${me.name || 'Le chauffeur'} ne peut pas la prendre : ${motif}. Mission rendue au dispatch.`,
    metadata: { motif: b.motif },
  }).then(() => {}, () => {})

  await sendNotificationToRoles(['dispatcher', 'admin', 'superadmin'], 'mission_refusee_chauffeur', {
    title: `↩️ ${me.name || 'Un chauffeur'} rend une mission`,
    body: `#${m.mission_number ?? ''} ${m.vehicle_plate || ''} ${m.incident_city ? `à ${m.incident_city}` : ''} : ${motif}. À réattribuer.`.replace(/\s+/g, ' '),
    action_url: `/dispatch/${m.id}`,
    mission_id: m.id,
  }).catch(() => {})

  if (m.odoo_task_id) {
    try {
      const stageId = await getFsmStageId('Nouveau')
      await rpcFsm('project.task', 'write', [[m.odoo_task_id], { stage_id: stageId, [FSM_FIELDS.chauffeur_name]: '', [FSM_FIELDS.chauffeur_id]: '' }])
    } catch (e: any) { console.error('[refus-chauffeur] FSM non mis à jour (non bloquant):', e?.message) }
  }
  return NextResponse.json({ ok: true })
}
