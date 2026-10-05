// /api/admin/agents — écran « Propositions des agents » (lot 1, Olivier 05/10/2026).
//   GET  → propositions, agents, journal, validateurs possibles
//   POST { op: 'decide', id, action: 'valider'|'refuser'|'corriger', text? }
//        { op: 'agent', id, active?, validator_user_id? }   (superadmin)
//        { op: 'key', id }  → nouvelle clé, affichée UNE fois  (superadmin)
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sessionAccess } from '@/lib/access'
import { createAdminClient } from '@/lib/supabase'
import { newAgentKey, journal } from '@/lib/agents/core'
import { decideProposal } from '@/lib/agents/proposals'

export const dynamic = 'force-dynamic'

async function who() {
  const session = await getServerSession(authOptions)
  const access = sessionAccess(session, { roles: ['admin', 'superadmin'] })
  if (!access.ok || !access.id) return null
  const u = session!.user as any
  return { id: access.id, name: u?.name || u?.email || 'inconnu', isSuperadmin: access.roles.includes('superadmin') }
}

export async function GET(req: Request) {
  const me = await who()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sb = createAdminClient()
  const statut = new URL(req.url).searchParams.get('statut') || 'to_validate'
  let pq = sb.from('agent_proposals').select('*').order('created_at', { ascending: false }).limit(200)
  if (statut === 'direct') pq = pq.eq('direct', true)
  else if (statut === 'open') pq = pq.in('status', ['to_validate', 'failed', 'executing'])
  else if (statut === 'questions') pq = pq.eq('kind', 'question_olivier')
  else if (statut !== 'all') pq = pq.eq('status', statut)
  const since = new Date(Date.now() - 86400_000).toISOString()
  const [props, agents, jr, validators, open, failed, execToday, direct24] = await Promise.all([
    pq,
    sb.from('agent_accounts').select('id, name, role_label, companies, kinds, direct_kinds, validator_user_id, active, key_prefix, key_created_at').order('name'),
    sb.from('agent_journal').select('*').order('id', { ascending: false }).limit(200),
    sb.from('users').select('id, name').or('role.in.(admin,superadmin),roles.ov.{admin,superadmin}').eq('active', true).order('name'),
    sb.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('status', 'to_validate'),
    sb.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    sb.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('status', 'executed').gte('executed_at', since),
    sb.from('agent_proposals').select('id', { count: 'exact', head: true }).eq('direct', true).gte('created_at', since),
  ])
  if (props.error) return NextResponse.json({ error: props.error.message }, { status: 500 })
  return NextResponse.json({
    me, proposals: props.data, agents: agents.data || [], journal: jr.data || [], validators: validators.data || [],
    counts: { to_validate: open.count || 0, failed: failed.count || 0, executed_24h: execToday.count || 0, direct_24h: direct24.count || 0 },
  })
}

export async function POST(req: Request) {
  const me = await who()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const sb = createAdminClient()
  try {
    if (body.op === 'decide') {
      if (!['valider', 'refuser', 'corriger'].includes(body.action)) throw new Error('Action inconnue')
      return NextResponse.json({ ok: true, ...(await decideProposal(String(body.id), me, body.action, body.text)) })
    }
    if (body.op === 'answer') {
      const { answerAgentQuestion } = await import('@/lib/agents/question')
      const r = await answerAgentQuestion(String(body.id), me.id, me.name, String(body.choix || ''), 'ecran')
      if (!r.ok) throw new Error(r.note)
      return NextResponse.json({ ok: true, note: r.note })
    }
    if (!me.isSuperadmin) throw new Error('Réservé à Mobi (superadmin).')
    if (body.op === 'agent') {
      const patch: any = { updated_at: new Date().toISOString() }
      if (typeof body.active === 'boolean') patch.active = body.active
      if ('validator_user_id' in body) patch.validator_user_id = body.validator_user_id || null
      const { data: a, error } = await sb.from('agent_accounts').update(patch).eq('id', String(body.id)).select('name').single()
      if (error) throw new Error(error.message)
      await journal({ agent: a.name, action: 'droits modifiés', detail: JSON.stringify({ active: patch.active, validateur: patch.validator_user_id }), actor: me.name })
      return NextResponse.json({ ok: true })
    }
    if (body.op === 'key') {
      const k = newAgentKey()
      const { data: a, error } = await sb.from('agent_accounts').update({ key_hash: k.hash, key_prefix: k.prefix, key_created_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', String(body.id)).select('name').single()
      if (error) throw new Error(error.message)
      await journal({ agent: a.name, action: 'nouvelle clé', detail: `clé ${k.prefix}… (l’ancienne ne marche plus)`, actor: me.name })
      return NextResponse.json({ ok: true, key: k.key })
    }
    throw new Error('Opération inconnue')
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 })
  }
}
