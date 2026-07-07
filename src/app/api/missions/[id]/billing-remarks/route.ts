// src/app/api/missions/[id]/billing-remarks/route.ts
//
// GET  /api/missions/[id]/billing-remarks → liste des remarques de facturation
// POST /api/missions/[id]/billing-remarks → crée une remarque { text }
//
// Même modèle que /api/missions/[id]/remarks, dédié à la facturation (table
// mission_billing_remarks, sans pièces jointes).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

async function getActor() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  const sb = createAdminClient()
  const { data } = await sb.from('users').select('id, name, email').eq('email', session.user.email).maybeSingle()
  return data ?? null
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: remarks, error } = await sb
    .from('mission_billing_remarks')
    .select(`
      id, text, created_at, updated_at, edit_history,
      author:users!created_by(id, name, email),
      editor:users!updated_by(id, name, email)
    `)
    .eq('mission_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, remarks: remarks || [] })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const actor = await getActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const text = String(body?.text || '').trim()
  if (!text) return NextResponse.json({ error: 'Texte requis' }, { status: 400 })

  const sb = createAdminClient()
  const { data: remark, error } = await sb
    .from('mission_billing_remarks')
    .insert({ mission_id: params.id, text, created_by: actor.id })
    .select(`
      id, text, created_at, updated_at, edit_history,
      author:users!created_by(id, name, email),
      editor:users!updated_by(id, name, email)
    `)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, remark })
}
