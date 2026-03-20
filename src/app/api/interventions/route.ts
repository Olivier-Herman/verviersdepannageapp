import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  // Récupérer l'ID du chauffeur
  const { data: driver } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .single()

  const { data, error } = await supabase
    .from('interventions')
    .insert({
      service_type: body.service_type || 'encaissement',
      driver_id: driver?.id,
      plate: body.plate,
      brand_id: body.brand_id || null,
      model_id: body.model_id || null,
      brand_text: body.brand_text,
      model_text: body.model_text,
      motif_id: body.motif_id,
      motif_text: body.motif_text,
      location_address: body.location_address,
      amount: body.amount ? parseFloat(body.amount) : null,
      payment_mode: body.payment_mode,
      client_vat: body.client_vat,
      client_name: body.client_name,
      client_address: body.client_address,
      client_phone: body.client_phone,
      client_email: body.client_email,
      notes: body.notes,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const supabase = createAdminClient()
  const isAdmin = ['admin', 'superadmin', 'dispatcher'].includes(session.user.role)

  let query = supabase
    .from('interventions')
    .select(`*, driver:users(name, email)`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!isAdmin) {
    const { data: driver } = await supabase
      .from('users').select('id').eq('email', session.user.email).single()
    if (driver) query = query.eq('driver_id', driver.id)
  }

  const { data } = await query
  return NextResponse.json(data || [])
}
