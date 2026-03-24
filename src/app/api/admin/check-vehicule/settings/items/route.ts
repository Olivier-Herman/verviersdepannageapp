import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const supabase = createAdminClient()
  const body     = await req.json()
  const { data: item, error } = await supabase
    .from('check_template_items')
    .insert({ label: body.label, category: body.category, order_index: body.order_index, active: true })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item })
}
