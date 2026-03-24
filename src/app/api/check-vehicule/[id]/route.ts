import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, isAdminOrDispatcher } from '@/lib/auth'
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

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isAdminOrDispatcher(session.user)) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const supabase = createAdminClient()

  // Seuls les checks scheduled ou pending_claim peuvent être supprimés
  const { data: check } = await supabase
    .from('vehicle_checks')
    .select('id, status')
    .eq('id', params.id)
    .single()

  if (!check) return NextResponse.json({ error: 'Contrôle introuvable' }, { status: 404 })

  if (!['scheduled', 'pending_claim'].includes(check.status)) {
    return NextResponse.json(
      { error: 'Seuls les contrôles planifiés ou en attente peuvent être supprimés.' },
      { status: 400 }
    )
  }

  await supabase.from('vehicle_checks').delete().eq('id', params.id)

  return NextResponse.json({ ok: true })
}
