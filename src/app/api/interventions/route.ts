import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncInterventionToOdoo } from '@/lib/odoo'
import { sendClientReceipt } from '@/lib/receipt'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const body = await req.json()
  const supabase = createAdminClient()

  const { data: driver } = await supabase
    .from('users').select('id').eq('email', session.user.email).single()

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
      motif_precision: body.motif_precision || null,
      location_address: body.location_address,
      amount: body.amount ? parseFloat(body.amount) : null,
      payment_mode: body.payment_mode,
      payment_reference: body.payment_reference || null,
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

  // 2. Entrée caisse si espèces
  if (intervention && body.payment_mode === 'cash' && driver?.id) {
    try {
      await supabase.from('cash_register').insert({
        driver_id: driver.id,
        amount: parseFloat(body.amount || '0'),
        type: 'encaissement',
        intervention_id: intervention.id,
        notes: `Espèces — ${intervention.reference}`,
      })
    } catch (err: any) {
      console.error('[Caisse] Erreur:', err.message)
    }
  }

  // 3. Envoi reçu email au client
  if (intervention && body.client_email) {
    try {
      await sendClientReceipt({
        clientEmail: body.client_email,
        clientName: body.client_name || 'Client',
        reference: intervention.reference,
        amount: parseFloat(body.amount || '0'),
        paymentMode: body.payment_mode || 'unpaid',
        plate: body.plate,
        vehicleDisplay: `${body.brand_text || ''} ${body.model_text || ''}`.trim(),
        motifText: body.motif_precision || body.motif_text || 'Intervention',
        locationAddress: body.location_address,
        driverName: session.user.name || undefined,
        sumupTransactionRef: body.payment_reference || undefined,
      })
      console.log(`[Receipt] Reçu envoyé à ${body.client_email}`)
    } catch (err: any) {
      console.error('[Receipt] Erreur envoi reçu:', err.message)
    }
  }

  // 4. Sync Odoo
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
        clientStreet: body.client_street,
        clientZip: body.client_zip,
        clientCity: body.client_city,
        clientCountryCode: body.client_country_code,
        amount: parseFloat(body.amount || '0'),
        motifText: body.motif_text || body.motif_id || 'Intervention',
        motifPrecision: body.motif_precision,
        locationAddress: body.location_address,
        paymentMode: body.payment_mode,
        paymentReference: body.payment_reference,
        driverName: session.user.name || session.user.email,
        notes: body.notes,
      })

      await supabase.from('interventions').update({
        odoo_invoice_id: result.orderId,
        odoo_partner_id: result.partnerId,
        synced_to_odoo: true,
        synced_at: new Date().toISOString(),
      }).eq('id', intervention.id)

      odooResult = { orderName: result.orderName, orderId: result.orderId }
      console.log(`[Odoo] Sync OK — Devis ${result.orderName}`)
    } catch (err: any) {
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
    .limit(100)

  if (!isAdmin) {
    const { data: driver } = await supabase
      .from('users').select('id').eq('email', session.user.email).single()
    if (driver) query = query.eq('driver_id', driver.id)
  }

  const { data } = await query
  return NextResponse.json(data || [])
}
