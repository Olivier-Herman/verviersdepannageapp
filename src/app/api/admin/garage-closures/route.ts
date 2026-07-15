// src/app/api/admin/garage-closures/route.ts
//
// CRUD des fermetures de garage (admin/superadmin).
//   GET               → toutes les fermetures (récentes d'abord)
//   POST   {…}        → crée
//   PATCH  {id, …}    → modifie
//   DELETE ?id=…      → supprime
// Olivier 2026-07-15.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return null
  const u = session.user as any
  const roles: string[] = [u.role, ...(Array.isArray(u.roles) ? u.roles : [])].filter(Boolean)
  return roles.some(r => ['admin', 'superadmin'].includes(r)) ? createAdminClient() : null
}

const FIELDS = ['name', 'match_keywords', 'date_from', 'date_to', 'message', 'active']
function pick(body: any) {
  const o: Record<string, any> = {}
  for (const k of FIELDS) if (k in body) o[k] = body[k]
  return o
}

export async function GET() {
  const sb = await requireAdmin()
  if (!sb) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await sb.from('garage_closures').select('*').order('date_from', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ closures: data || [] })
}

export async function POST(req: Request) {
  const sb = await requireAdmin()
  if (!sb) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const payload = pick(body)
  if (!payload.match_keywords || !payload.date_from || !payload.date_to || !payload.message) {
    return NextResponse.json({ error: 'Champs requis : mots-clés, dates, message.' }, { status: 400 })
  }
  const { data, error } = await sb.from('garage_closures').insert(payload).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ closure: data })
}

export async function PATCH(req: Request) {
  const sb = await requireAdmin()
  if (!sb) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const id = String(body?.id || '')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const payload = { ...pick(body), updated_at: new Date().toISOString() }
  const { data, error } = await sb.from('garage_closures').update(payload).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ closure: data })
}

export async function DELETE(req: Request) {
  const sb = await requireAdmin()
  if (!sb) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
  const { error } = await sb.from('garage_closures').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
