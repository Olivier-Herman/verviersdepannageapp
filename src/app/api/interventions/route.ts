import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncInterventionToOdoo } from '@/lib/odoo'

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

  // 1. Sauvegarder dans Supabase
  const { data: intervention, error } = await supabase
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

  // 2. Sync Odoo — on attend la réponse (Vercel tue les tâches en arrière-plan)
  let odooResult: { orderName?: string; orderId?: number } = {}
  if (intervention && body.plate) {
    try {
      const result = await syncInterventionToOdoo({
        reference: intervention.reference,
        plate: body.plate,
        brandText: body.brand_text || 'Autre',
        modelText: body.model_text || 'Autre',
        clientName: body.client_name,
        clientPhone: body.client_phone,
        clientEmail: body.client_email,
        clientVat: body.client_vat,
        clientAddress: body.client_address,
        amount: parseFloat(body.amount || '0'),
        motifText: body.motif_text || body.motif_id || 'Intervention',
        paymentMode: body.payment_mode,
        driverName: session.user.name || session.user.email,
      })

      // Mettre à jour Supabase avec les IDs Odoo
      await supabase
        .from('interventions')
        .update({
          odoo_invoice_id: result.orderId,
          odoo_partner_id: result.partnerId,
          synced_to_odoo: true,
          synced_at: new Date().toISOString(),
        })
        .eq('id', intervention.id)

      odooResult = { orderName: result.orderName, orderId: result.orderId }
      console.log(`[Odoo] Sync OK — Devis ${result.orderName}`)

    } catch (err: any) {
      // Pas bloquant — l'intervention est quand même sauvegardée
      console.error('[Odoo] Sync échouée:', err.message)
    }
  }

  return NextResponse.json({ ...intervention, odoo: odooResult })
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
