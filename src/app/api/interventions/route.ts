import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncInterventionToOdoo, withOdooActor } from '@/lib/odoo'
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
      // mission_id : lien optionnel vers la mission qui a declenche l'encaissement
      // (encaissement standalone reste null, comportement inchange)
      mission_id: body.mission_id || null,
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

  // 1.bis. Si lie a une mission : annoter la mission (Payee / Facture a envoyer)
  if (intervention && body.mission_id) {
    try {
      await supabase
        .from('incoming_missions')
        .update({
          payment_collected_at: new Date().toISOString(),
          payment_mode:         body.payment_mode || 'unpaid',
        })
        .eq('id', body.mission_id)
    } catch (err: any) {
      console.error('[Mission payment] Erreur update annotation:', err.message)
    }
  }

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

  // 4. Sync Odoo (signe au nom du chauffeur si sa cle Odoo est encodee)
  let odooResult: { orderName?: string; orderId?: number } = {}
  if (intervention && body.plate) {
    try {
      const actorId = driver?.id || (session.user as any).id
      const result = await withOdooActor(actorId, () => syncInterventionToOdoo({
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
      }))

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
    client_email:   i.client_email,
    client_address: i.client_address,
    synced_to_odoo: i.synced_to_odoo,
    driver:        i.driver,
    notes:         i.notes,
  }))

  // ── Paiements Odoo espèces (cash_register avec odoo_payment_id) ─────────
  // Encaissements directs encodés au bureau, sync via cron sync-cash-payments.
  let cashQuery = supabase
    .from('cash_register')
    .select('*, driver:users!cash_register_driver_id_fkey(name, email)')
    .not('odoo_payment_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200)
  if (!isAdmin && me) cashQuery = cashQuery.eq('driver_id', me.id)
  const { data: odooPayments } = await cashQuery

  const odooEntries = (odooPayments || []).map((c: any) => ({
    id:               c.id,
    type:             'odoo_payment',
    created_at:       c.created_at,
    amount:           c.amount || 0,
    payment_mode:     'cash',
    driver:           c.driver,
    notes:            c.notes,            // = numéro facture / référence Odoo
    odoo_payment_id:  c.odoo_payment_id,
    odoo_status:      c.odoo_status,
  }))

  // ── Transferts entre collegues (cash_transfers) ────────────────────────
  // Confirmes uniquement. Genere 2 entries virtuelles par transfert :
  //   - transfer_out : ligne negative cote sender
  //   - transfer_in  : ligne positive cote receveur
  // Pour un user non-admin, on ne retourne que les lignes qui le concernent.
  let transferQuery = supabase
    .from('cash_transfers')
    .select(`
      id, sender_id, receiver_id, amount, notes, created_at,
      sender:users!cash_transfers_sender_id_fkey(name, email),
      receiver:users!cash_transfers_receiver_id_fkey(name, email)
    `)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(200)
  if (!isAdmin && me) {
    transferQuery = transferQuery.or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`)
  }
  const { data: transfers } = await transferQuery

  const transferEntries: any[] = []
  for (const t of (transfers || [])) {
    const senderName   = (t.sender   as any)?.name || '?'
    const receiverName = (t.receiver as any)?.name || '?'
    const noteSuffix   = t.notes ? ` — ${t.notes}` : ''
    const senderEntry = {
      id:           `${t.id}-out`,
      type:         'transfer_out',
      created_at:   t.created_at,
      amount:       t.amount || 0,
      payment_mode: 'transfer',
      driver:       t.sender,
      notes:        `Transfert vers ${receiverName}${noteSuffix}`,
    }
    const receiverEntry = {
      id:           `${t.id}-in`,
      type:         'transfer_in',
      created_at:   t.created_at,
      amount:       t.amount || 0,
      payment_mode: 'transfer',
      driver:       t.receiver,
      notes:        `Transfert de ${senderName}${noteSuffix}`,
    }
    if (isAdmin) {
      transferEntries.push(senderEntry, receiverEntry)
    } else if (me) {
      if (t.sender_id   === me.id) transferEntries.push(senderEntry)
      if (t.receiver_id === me.id) transferEntries.push(receiverEntry)
    }
  }

  // Tri par date desc avec tie-break : pour un meme created_at (cas typique
  // des transferts, RPC atomic cree les 2 entries en meme temps), on affiche
  // transfer_out (-) AVANT transfer_in (+) — narratif "sort caisse A, rentre
  // caisse B" naturel a lire de haut en bas.
  const TYPE_ORDER: Record<string, number> = { transfer_out: 0, transfer_in: 1 }
  const sortByDateThenType = (a: any, b: any) => {
    const t = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    if (t !== 0) return t
    return (TYPE_ORDER[a.type] ?? 99) - (TYPE_ORDER[b.type] ?? 99)
  }

  if (!includeAdv) {
    const merged = [...intEntries, ...odooEntries, ...transferEntries].sort(sortByDateThenType)
    return NextResponse.json(merged)
  }

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
    invoice_url:  a.invoice_url,
    driver:       a.user,
    notes:        a.notes || `Avance de fonds — ${a.plate}`,
    status:       a.status,
  }))

  // ── Fusion + tri par date avec tie-break transfer_out avant transfer_in ──
  const all = [...intEntries, ...advEntries, ...odooEntries, ...transferEntries]
    .sort(sortByDateThenType)

  return NextResponse.json(all)
}
