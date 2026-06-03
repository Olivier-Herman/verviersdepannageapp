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
  // payment_amount = SOMME de tous les encaissements lies a la mission (un meme
  // dossier peut etre encaisse en plusieurs fois) → on recalcule a chaque insert
  // pour rester coherent avec la table interventions (source de verite).
  //
  // Olivier 2026-05-26 : on auto-lie aussi le client a la mission (billed_to_id +
  // billed_to_name) si la mission n a pas encore de client lie. Permet aux flows
  // SNC dsp/rem_client / Mal Garee restitution / Privé direct de ne pas devoir
  // ressaisir le client cote form chauffeur — la recherche/creation se fait dans
  // /encaissement qui a deja toute la machinerie.
  if (intervention && body.mission_id) {
    try {
      const { data: allPayments } = await supabase
        .from('interventions')
        .select('amount')
        .eq('mission_id', body.mission_id)
      const sum = (allPayments || []).reduce((s, p) => s + Number(p.amount || 0), 0)

      // Lire l etat actuel de la mission pour ne pas ecraser un billed_to existant
      const { data: currentMission } = await supabase
        .from('incoming_missions')
        .select('billed_to_id, billed_to_name')
        .eq('id', body.mission_id)
        .single()

      const updatePayload: Record<string, any> = {
        payment_collected_at: new Date().toISOString(),
        payment_mode:         body.payment_mode || 'unpaid',
        payment_amount:       sum,
      }
      // Auto-link client Odoo (si selectedClient.id remonte) — seulement si pas
      // deja lie. body.client_id vient du selectedClient cote frontend.
      if (body.client_id && !currentMission?.billed_to_id) {
        updatePayload.billed_to_id = Number(body.client_id)
      }
      // Auto-link nom client (memorise meme sans id Odoo) — seulement si vide.
      if (body.client_name && !currentMission?.billed_to_name) {
        updatePayload.billed_to_name = String(body.client_name)
      }

      await supabase
        .from('incoming_missions')
        .update(updatePayload)
        .eq('id', body.mission_id)

      // Olivier 2026-06-03 : auto-finalize si paiement complet sur une mission
      // en draft (awaiting_payment=true). Avant, il fallait que le chauffeur
      // clique "Finaliser la mission" manuellement, ce qui laissait la mission
      // en mode draft (et SncMissionFiche s affichait) entre le paiement et
      // le clic. Maintenant : paiement complet = mission immediatement
      // definitive (ticket Helpdesk Odoo + email + awaiting_payment=false).
      const { data: missionAfterPayment } = await supabase
        .from('incoming_missions')
        .select('id, awaiting_payment, amount_to_collect')
        .eq('id', body.mission_id)
        .single()
      const required = Number(missionAfterPayment?.amount_to_collect || 0)
      const isFullyPaid = required > 0 && sum + 0.01 >= required
      if (missionAfterPayment?.awaiting_payment && isFullyPaid) {
        try {
          const origin = new URL(req.url).origin
          const finRes = await fetch(`${origin}/api/missions/${body.mission_id}/finalize`, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie':       req.headers.get('cookie') || '',
            },
          })
          if (finRes.ok) {
            console.log(`[Mission payment] Auto-finalize OK mission=${body.mission_id}`)
          } else {
            const text = await finRes.text().catch(() => '')
            console.warn(`[Mission payment] Auto-finalize echoue (${finRes.status}) : ${text.slice(0, 200)}`)
          }
        } catch (e: any) {
          console.warn(`[Mission payment] Auto-finalize exception : ${e?.message}`)
        }
      }
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

  // 4. Sync Odoo : SKIP si l intervention est liee a une mission VD Soft.
  // Olivier 2026-06-03 : nouveau process — toutes les missions encaissees
  // passent par /facturation et l equipe facturation cree UN SEUL devis
  // via FacturerModal "Creer le devis Odoo". Cela evite le bug du split
  // paiement (cash + Sumup = 2 devis distincts auparavant).
  // Les encaissements ORPHELINS (sans mission) continuent de creer le devis
  // automatiquement, car ils n ont pas d autre voie. Cas edge depuis que
  // l encaissement chauffeur utilise la recherche de mission.
  let odooResult: { orderName?: string; orderId?: number } = {}
  const skipOdooSync = !!body.mission_id
  if (skipOdooSync) {
    console.log(`[interventions] Skip sync Odoo (mission_id=${body.mission_id} - devis cree par facturation)`)
  }
  if (intervention && body.plate && !skipOdooSync) {
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
