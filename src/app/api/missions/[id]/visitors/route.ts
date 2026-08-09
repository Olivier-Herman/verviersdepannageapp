// src/app/api/missions/[id]/visitors/route.ts
//
// Registre des VISITES d'un véhicule en parc (module Visiteur).
//   GET             → liste des visites de la fiche (récent en premier).
//   POST { … }      → ajout MANUEL d'une visite (refus de lecture eID) ou
//                     ajout programmatique. source='manual' par défaut.
//   DELETE ?vid=…   → suppression d'une visite (correction).
//
// Personnel comptoir/dispatch/fourrière. Olivier 2026-08-08.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { sessionAccess }     from '@/lib/access'

export const dynamic = 'force-dynamic'

const ALLOWED_ROLES   = ['superadmin', 'admin', 'dispatcher']
const ALLOWED_MODULES = ['facturation', 'fourriere', 'encaissement', 'encaissements']

const guard = (session: any) => sessionAccess(session, { roles: ALLOWED_ROLES, modules: ALLOWED_MODULES })

async function resolveMissionId(sb: any, idParam: string): Promise<string | null> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idParam)
  const q = sb.from('incoming_missions').select('id')
  const { data } = await (isUuid ? q.eq('id', idParam) : q.eq('mission_number', Number(idParam))).maybeSingle()
  return data?.id || null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  const acc = guard(session)
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const missionId = await resolveMissionId(sb, params.id)
  if (!missionId) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const [visitors, motifs, bureaux] = await Promise.all([
    sb.from('mission_visitors').select('*').eq('mission_id', missionId).order('visited_at', { ascending: false }),
    sb.from('visitor_motifs').select('label, is_expert').eq('active', true).order('sort_order').order('label'),
    sb.from('expertise_bureaus').select('name').eq('active', true).order('sort_order').order('name'),
  ])
  if (visitors.error) return NextResponse.json({ error: visitors.error.message }, { status: 500 })
  return NextResponse.json({
    visitors: visitors.data || [],
    motifs:   (motifs.data  || []).map((m: any) => ({ label: m.label, is_expert: !!m.is_expert })),
    bureaux:  (bureaux.data || []).map((b: any) => b.name),
  })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  const acc = guard(session)
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const missionId = await resolveMissionId(sb, params.id)
  if (!missionId) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const b = await req.json().catch(() => ({}))
  const lastName  = String(b.last_name  ?? b.lastName  ?? '').trim()
  const firstName = String(b.first_name ?? b.firstName ?? '').trim()
  const motifs    = Array.isArray(b.motifs) ? b.motifs.map((m: any) => String(m).trim()).filter(Boolean).slice(0, 12) : []
  if (!lastName && !firstName) return NextResponse.json({ error: 'Nom ou prénom requis' }, { status: 400 })
  if (!motifs.length)          return NextResponse.json({ error: 'Au moins un motif requis' }, { status: 400 })

  const row = {
    mission_id:      missionId,
    visited_at:      b.visited_at ? new Date(b.visited_at).toISOString() : new Date().toISOString(),
    last_name:       lastName  || null,
    first_name:      firstName || null,
    birth_date:      b.birth_date ? String(b.birth_date).slice(0, 40) : null,
    motifs,
    expert_bureau:   b.expert_bureau ? String(b.expert_bureau).slice(0, 160) : null,
    note:            b.note ? String(b.note).slice(0, 500) : null,
    national_number: b.national_number ? String(b.national_number).slice(0, 40) : null,
    source:          b.source === 'eid' ? 'eid' : 'manual',
    created_by:      acc.id || null,
  }
  const { data, error } = await sb.from('mission_visitors').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('mission_logs').insert({
    mission_id: missionId, action: 'visitor',
    notes: `Visite : ${[firstName, lastName].filter(Boolean).join(' ')} — ${motifs.join(', ')}${row.expert_bureau ? ` (${row.expert_bureau})` : ''} [${row.source}]`,
    metadata: { motifs, expert_bureau: row.expert_bureau, source: row.source },
  }).then(() => {}, () => {})

  return NextResponse.json({ visitor: data })
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const sb = createAdminClient()
  const session = await getServerSession(authOptions)
  const acc = guard(session)
  if (!acc.ok) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const vid = new URL(req.url).searchParams.get('vid')
  if (!vid) return NextResponse.json({ error: 'vid requis' }, { status: 400 })
  const missionId = await resolveMissionId(sb, params.id)
  if (!missionId) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  const { error } = await sb.from('mission_visitors').delete().eq('id', vid).eq('mission_id', missionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
