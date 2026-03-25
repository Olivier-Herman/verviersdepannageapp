// src/app/api/admin/missions/senders/route.ts

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

async function checkAdmin(session: any) {
  return ['admin', 'superadmin'].includes(session?.user?.role)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !await checkAdmin(session))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: senders } = await supabase
    .from('mission_senders')
    .select('*')
    .order('created_at', { ascending: true })

  return NextResponse.json({ senders: senders || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !await checkAdmin(session))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { email_pattern, source, label } = await req.json()
  if (!email_pattern || !source)
    return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('mission_senders')
    .insert({ email_pattern: email_pattern.toLowerCase().trim(), source, label, active: true })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sender: data })
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !await checkAdmin(session))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, active, label, source } = await req.json()
  const supabase = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (active !== undefined) updates.active = active
  if (label  !== undefined) updates.label  = label
  if (source !== undefined) updates.source = source

  const { error } = await supabase
    .from('mission_senders')
    .update(updates)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || !await checkAdmin(session))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  const supabase = createAdminClient()
  const { error } = await supabase.from('mission_senders').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
