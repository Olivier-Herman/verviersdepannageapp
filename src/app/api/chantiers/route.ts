// src/app/api/chantiers/route.ts
//
// Module « Chantiers » — le tableau des chantiers VD Soft, superadmin.
//   GET  → la liste + les 40 dernières lignes de journal
//   POST → créer un chantier { title, tag?, status?, note? }
// Tables server-only (service_role) : la page interroge cette API, jamais
// Supabase en direct. Olivier 09/09/2026.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { CHANTIER_STATUSES, isSuperadminSession, type ChantierStatus } from '@/lib/chantiers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuperadminSession(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const [{ data: chantiers, error: e1 }, { data: logs, error: e2 }] = await Promise.all([
    sb.from('chantiers').select('id, key, title, tag, status, note, position, created_at, updated_at, updated_by')
      .order('status').order('position').order('created_at'),
    sb.from('chantier_logs').select('id, chantier_id, at, actor, text').order('at', { ascending: false }).limit(40),
  ])
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ chantiers: chantiers || [], logs: logs || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!isSuperadminSession(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'Intitulé requis' }, { status: 400 })
  const status: ChantierStatus = (CHANTIER_STATUSES as readonly string[]).includes(body.status) ? body.status : 'attente'
  const actor = (session!.user as any)?.name || (session!.user as any)?.email || null

  const sb = createAdminClient()
  // En bas de sa colonne.
  const { data: last } = await sb.from('chantiers').select('position').eq('status', status).order('position', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await sb.from('chantiers').insert({
    title, tag: String(body.tag || '').trim() || null, status, note: String(body.note || '').trim() || null,
    position: ((last as any)?.position ?? 0) + 10, updated_by: actor,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await sb.from('chantier_logs').insert({ chantier_id: data.id, actor, text: `Ajouté : ${title}` }).then(() => {}, () => {})
  return NextResponse.json({ ok: true, chantier: data })
}
