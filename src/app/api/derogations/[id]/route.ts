// src/app/api/derogations/[id]/route.ts
//
// Côté responsable (son téléphone, après la notification) :
//   GET  → la demande (qui, quel véhicule, quoi, pourquoi)
//   POST { decision: 'approve' | 'refuse', pin } → validée avec SON code.
// Effets d'une approbation : blocage police levé (blk), contrôle de sortie
// accident forcé (exit_control) ; les autres dérogations sont lues par la
// restitution. Olivier 28/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import bcrypt                from 'bcryptjs'
import { logRestitution, DEROG_LABELS, type DerogKind } from '@/lib/restitution/server'

export const dynamic = 'force-dynamic'

async function load(sb: any, id: string) {
  const { data: d } = await sb.from('derogation_requests').select('*').eq('id', id).maybeSingle()
  if (!d) return null
  const [{ data: m }, { data: users }] = await Promise.all([
    sb.from('incoming_missions').select('id, mission_number, vehicle_plate, vehicle_brand, vehicle_model, source, parc_zone_key').eq('id', d.mission_id).maybeSingle(),
    sb.from('users').select('id, name').in('id', [d.requested_by, d.responsable_id].filter(Boolean)),
  ])
  const n = Object.fromEntries((users || []).map((u: any) => [u.id, u.name]))
  return { d, m, requested_by_name: n[d.requested_by] || null, responsable_name: n[d.responsable_id] || null }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const x = await load(sb, params.id)
  if (!x) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
  const me = session.user as any
  return NextResponse.json({
    ok: true, mine: x.d.responsable_id === me.id,
    request: { id: x.d.id, kind: x.d.kind, label: DEROG_LABELS[x.d.kind as DerogKind] || x.d.kind, reason: x.d.reason, amount_tvac: x.d.amount_tvac, status: x.d.status, created_at: x.d.created_at, decided_at: x.d.decided_at, requested_by_name: x.requested_by_name, responsable_name: x.responsable_name },
    mission: x.m,
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const sb = createAdminClient()
  const x = await load(sb, params.id)
  if (!x) return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
  if (x.d.responsable_id !== me.id) return NextResponse.json({ error: `Cette demande est adressée à ${x.responsable_name}.` }, { status: 403 })
  if (x.d.status !== 'pending') return NextResponse.json({ error: 'Cette demande est déjà traitée ou annulée.' }, { status: 409 })
  const body = await req.json().catch(() => ({}))
  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'refuse' ? 'refuse' : null
  if (!decision) return NextResponse.json({ error: 'Décision manquante' }, { status: 400 })
  const pin = String(body.pin || '')
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'Code à 4 chiffres requis.' }, { status: 400 })
  const { data: u } = await sb.from('users').select('verify_pin_hash, restitution_responsable').eq('id', me.id).maybeSingle()
  if (!u?.restitution_responsable) return NextResponse.json({ error: 'Vous n’êtes plus habilité à valider.' }, { status: 403 })
  if (!u?.verify_pin_hash || !(await bcrypt.compare(pin, u.verify_pin_hash))) return NextResponse.json({ error: 'Code incorrect.' }, { status: 403 })

  const now = new Date().toISOString()
  const status = decision === 'approve' ? 'approved' : 'refused'
  const { data: upd } = await sb.from('derogation_requests').update({ status, decided_at: now }).eq('id', x.d.id).eq('status', 'pending').select('id')
  if (!upd?.length) return NextResponse.json({ error: 'Cette demande vient d’être traitée ailleurs.' }, { status: 409 })
  const label = DEROG_LABELS[x.d.kind as DerogKind] || x.d.kind

  if (status === 'approved' && x.d.kind === 'blk') {
    await sb.from('incoming_missions').update({ police_blocked: false, updated_at: now }).eq('id', x.d.mission_id)
  }
  if (status === 'approved' && x.d.kind === 'exit_control') {
    await sb.from('mission_exit_control').update({ forced_at: now, forced_by: me.id, forced_reason: `Dérogation restitution : ${x.d.reason}`, updated_at: now }).eq('mission_id', x.d.mission_id)
  }
  await logRestitution(sb, x.d.mission_id, me.id, status === 'approved' ? 'derogation_approved' : 'derogation_refused',
    `Dérogation « ${label} » ${status === 'approved' ? 'autorisée' : 'refusée'} par ${me.name || me.email} avec son code, depuis son téléphone (demandée par ${x.requested_by_name || '?'} : ${x.d.reason}).`,
    { derogation_id: x.d.id, kind: x.d.kind })
  return NextResponse.json({ ok: true, status })
}
