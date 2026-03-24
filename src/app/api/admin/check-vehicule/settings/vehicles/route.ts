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

  const { data: vehicle, error } = await supabase
    .from('check_vehicles')
    .insert({ name: body.name, plate: body.plate, usual_driver_id: body.usual_driver_id || null, active: true })
    .select('*, driver:users!check_vehicles_usual_driver_id_fkey(name)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ vehicle })
}
