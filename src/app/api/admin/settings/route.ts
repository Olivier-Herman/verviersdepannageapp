import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

async function checkAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !['admin', 'superadmin'].includes(session.user.role)) return null
  return session
}

export async function POST(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  if (body.type === 'list_item') {
    const { error } = await supabase.from('list_items').insert({
      list_type: body.list_type,
      label: body.label,
      value: body.value,
      sort_order: body.sort_order,
      active: true
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.type === 'call_shortcut') {
    const { error } = await supabase.from('call_shortcuts').insert({
      label: body.label,
      phone: body.phone,
      category: body.category,
      sort_order: body.sort_order,
      active: true
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id, table, active } = await req.json()
  const supabase = createAdminClient()

  const { error } = await supabase.from(table).update({ active }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const { id, table } = await req.json()
  const supabase = createAdminClient()

  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
