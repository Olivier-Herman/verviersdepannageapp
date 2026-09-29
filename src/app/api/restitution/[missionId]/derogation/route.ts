// src/app/api/restitution/[missionId]/derogation/route.ts
//
// POST { kind, reason, responsable_id, amount_tvac? } — demande de dérogation
// pendant une restitution. Le responsable choisi reçoit une notification et
// valide avec SON code sur SON téléphone (/derogation/[id]). { cancel_id }
// annule une demande en attente. Olivier 28/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { restitutionAccess, loadMission, logRestitution, DEROG_LABELS, type DerogKind } from '@/lib/restitution/server'

export const dynamic = 'force-dynamic'
const KINDS = Object.keys(DEROG_LABELS) as DerogKind[]

export async function POST(req: Request, { params }: { params: { missionId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = session.user as any
  const sb = createAdminClient()
  const m = await loadMission(sb, params.missionId)
  if (!m) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 })
  if (!restitutionAccess(session, m.source).ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { data: rest } = await sb.from('restitutions').select('id').eq('mission_id', m.id).eq('status', 'open').maybeSingle()

  if (body.cancel_id) {
    await sb.from('derogation_requests').update({ status: 'cancelled', decided_at: new Date().toISOString() }).eq('id', body.cancel_id).eq('mission_id', m.id).eq('status', 'pending')
    await logRestitution(sb, m.id, me.id, 'derogation_cancel', `Demande de dérogation annulée par ${me.name || me.email}.`)
    return NextResponse.json({ ok: true })
  }

  const kind = String(body.kind) as DerogKind
  const reason = String(body.reason || '').trim().slice(0, 500)
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'Type de dérogation inconnu' }, { status: 400 })
  if (reason.length < 5) return NextResponse.json({ error: 'Le motif est obligatoire.' }, { status: 400 })
  if (kind !== 'blk' && !rest) return NextResponse.json({ error: 'Commencez la restitution d’abord.' }, { status: 400 })
  const { data: resp } = await sb.from('users').select('id, name, restitution_responsable, verify_pin_hash').eq('id', body.responsable_id).maybeSingle()
  if (!resp?.restitution_responsable) return NextResponse.json({ error: 'Ce responsable n’est pas habilité.' }, { status: 400 })
  if (resp.id === me.id) return NextResponse.json({ error: 'Choisissez un autre responsable que vous-même.' }, { status: 400 })
  if (!resp.verify_pin_hash) return NextResponse.json({ error: `${resp.name} n’a pas encore de code personnel : choisissez un autre responsable.` }, { status: 400 })

  const { data: row, error } = await sb.from('derogation_requests').insert({
    mission_id: m.id, restitution_id: rest?.id || null, kind, reason, amount_tvac: body.amount_tvac ? Number(body.amount_tvac) : null,
    requested_by: me.id, responsable_id: resp.id,
  }).select('id').single()
  if (error || !row) return NextResponse.json({ error: error?.message || 'Demande non enregistrée' }, { status: 500 })

  // Notification DANS l'app (bandeau VD Soft, visible sur PC) + push téléphone / navigateur :
  // un responsable sur PC sans appareil enregistré ne recevait rien (Jona, 29/09/2026).
  const { sendNotification } = await import('@/lib/notifications/send')
  const nres: any = await sendNotification(resp.id, 'restitution_derogation_requested', {
    title: 'Dérogation à valider',
    body: `${me.name || 'Un collègue'} · ${m.vehicle_plate || 'véhicule'} · ${DEROG_LABELS[kind]}`,
    action_url: `/derogation/${row.id}`, mission_id: m.id,
  }).catch((e: any) => ({ ok: false, error: e?.message }))
  const push = { sent: nres?.ok ? 1 : 0 }
  await logRestitution(sb, m.id, me.id, 'derogation_request', `Dérogation « ${DEROG_LABELS[kind]} » demandée à ${resp.name} par ${me.name || me.email}. Motif : ${reason}${push.sent ? '' : ` (notification non délivrée${nres?.skipped ? ' : ' + nres.skipped : ''} — prévenez-le, lien : /derogation/${row.id})`}`, { derogation_id: row.id, kind, responsable_id: resp.id })
  return NextResponse.json({ ok: true, id: row.id, notified: push.sent > 0 })
}
