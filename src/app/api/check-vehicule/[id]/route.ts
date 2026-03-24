import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()

  const { data: check, error } = await supabase
    .from('vehicle_checks')
    .select(`
      *,
      vehicle:check_vehicles(id, name, plate, usual_driver_id),
      triggered_by_user:users!vehicle_checks_triggered_by_fkey(id, name, email),
      claimed_by_user:users!vehicle_checks_claimed_by_fkey(id, name, email)
    `)
    .eq('id', params.id)
    .single()

  if (error || !check) return NextResponse.json({ error: 'Contrôle introuvable' }, { status: 404 })

  const { data: templateItems } = await supabase
    .from('check_template_items').select('*').eq('active', true).order('order_index')

  return NextResponse.json({ check, templateItems: templateItems || [] })
}
