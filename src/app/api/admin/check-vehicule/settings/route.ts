import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdmin(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase = createAdminClient()

  const [{ data: vehicles }, { data: items }, { data: users }, { data: setting }] = await Promise.all([
    supabase.from('check_vehicles')
      .select('*, driver:users!check_vehicles_usual_driver_id_fkey(name)')
      .order('created_at'),
    supabase.from('check_template_items').select('*').order('order_index'),
    supabase.from('users').select('id, name, email, role').eq('active', true).order('name'),
    supabase.from('app_settings').select('value').eq('key', 'check_responsible_ids').maybeSingle(),
  ])

  return NextResponse.json({
    vehicles:       vehicles       || [],
    items:          items          || [],
    users:          users          || [],
    responsibleIds: setting ? JSON.parse(setting.value) : [],
  })
}
