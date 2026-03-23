import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncInterventionToOdoo } from '@/lib/odoo'
import { sendClientReceipt } from '@/lib/emails'

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

  // 3. Envoi email au client
  if (intervention && body.client_email) {
    try {
      const paymentMode = body.payment_mode || 'unpaid'
      await sendClientReceipt({
        clientEmail: body.client_email,
        clientName: body.client_name || 'Client',
        reference: intervention.reference,
        amount: parseFloat(body.amount || '0'),
        paymentMode,
        plate: body.plate,
        vehicleDisplay: `${body.brand_text || ''} ${body.model_text || ''}`.trim(),
        motifText: body.motif_precision || body.motif_text || 'Intervention',
        locationAddress: body.location_address,
        driverName: session.user.name || undefined,
        sumupTransactionRef: body.payment_reference || undefined,
      })
      console.log(`[Receipt] Email envoyé à ${body.client_email} (mode: ${paymentMode})`)
    } catch (err: any) {
      console.error('[Receipt] Erreur:', err.message)
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

  const supabase    = createAdminClient()
  const isAdmin     = ['admin', 'superadmin', 'dispatcher'].includes(session.user.role)
  const includeAdv  = req.nextUrl.searchParams.get('includeAdvances') === 'true'

  // Résoudre l'utilisateur courant
  const { data: me } = await supabase
    .from('users').select('id, name, email').eq('email', session.user.email).single()

  // ── Interventions ──────────────────────────────────────────
  let intQuery = supabase
    .from('interventions')
    .select('*, driver:users(name, email)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (!isAdmin && me) intQuery = intQuery.eq('driver_id', me.id)

  const { data: interventions } = await intQuery

  const intEntries = (interventions || []).map((i: any) => ({
    id:            i.id,
    type:          'intervention',
    reference:     i.reference,
    created_at:    i.created_at,
    plate:         i.plate,
    brand_text:    i.brand_text,
    model_text:    i.model_text,
    motif_text:    i.motif_text,
    amount:        i.amount || 0,
    payment_mode:  i.payment_mode,
    client_name:   i.client_name,
    client_email:  i.client_email,
    synced_to_odoo: i.synced_to_odoo,
    driver:        i.driver,
    notes:         i.notes,
  }))

  if (!includeAdv) return NextResponse.json(intEntries)

  // ── Avances de fonds ───────────────────────────────────────
  let advQuery = supabase
    .from('fund_advances')
    .select('*, user:users(name, email)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (!isAdmin && me) advQuery = advQuery.eq('user_id', me.id)

  const { data: advances } = await advQuery

  const advEntries = (advances || []).map((a: any) => ({
    id:           a.id,
    type:         'advance',
    created_at:   a.created_at,
    plate:        a.plate,
    amount:       parseFloat(a.amount_htva) || 0,
    payment_mode: a.payment_method,
    odoo_quote_id: a.odoo_quote_id,
    driver:       a.user,
    notes:        a.notes || `Avance de fonds — ${a.plate}`,
    status:       a.status,
  }))

  // ── Fusion + tri par date ──────────────────────────────────
  const all = [...intEntries, ...advEntries]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return NextResponse.json(all)
}
