import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { syncInterventionToOdoo, withOdooActor, findOrCreatePartner } from '@/lib/odoo'
import { sendClientReceipt, sendEmail, emailLayout } from '@/lib/emails'
import { releaseParcAndShift } from '@/lib/parc/release'

// Olivier 2026-06-03 : sources fourriere qui declenchent l auto-restitution
// quand un encaissement est fait sur une mission en parked.
const FOURRIERE_AUTO_RESTITUTE_SOURCES = [
  'police_mg', 'police_avp', 'police_rodeo', 'police_accident',
  'police_saisie', 'police_snc', 'sia_couvert', 'prive',
]

/**
 * Parse une adresse texte au format BE/FR vers les champs Odoo res.partner.
 * Formats supportes :
 *   "Pl. du Sablon 65, 4820 Dison, Belgique"
 *   "Rue de la Paix 12, 4800 Verviers"
 *   "12 Rue Foo, 75001 Paris, France"
 * Fallback : tout dans street si pattern non reconnu.
 */
export function parseAddressForOdoo(addr: string | null | undefined): {
  street: string
  zip:    string
  city:   string
} {
  if (!addr) return { street: '', zip: '', city: '' }
  const trimmed = addr.trim().replace(/\s+/g, ' ')
  // Pattern : "<street>, <zip 4-5 digits> <city>[, <country>]"
  const m = trimmed.match(/^(.+?),?\s*(\d{4,5})\s+([^,]+?)(?:,\s*[^,]+)?$/)
  if (m) {
    return { street: m[1].trim().replace(/,$/, ''), zip: m[2], city: m[3].trim() }
  }
  return { street: trimmed, zip: '', city: '' }
}

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

  // Olivier 2026-06-04 : encaissement chauffeur SANS mission liee = email
  // d alerte administration pour creer la facture manuellement (cas hors
  // dossier classique). Non bloquant : si l email plante, on continue.
  if (intervention && !body.mission_id && (body.service_type || 'encaissement') === 'encaissement') {
    try {
      await sendAdminOrphanReceiptEmail({
        reference:      intervention.reference,
        plate:          body.plate,
        brandText:      body.brand_text,
        modelText:      body.model_text,
        clientName:     body.client_name,
        clientPhone:    body.client_phone,
        clientEmail:    body.client_email,
        clientVat:      body.client_vat,
        clientAddress:  body.client_address,
        clientStreet:   body.client_street,
        clientZip:      body.client_zip,
        clientCity:     body.client_city,
        clientCountryCode: body.client_country_code,
        amount:         parseFloat(body.amount || '0'),
        motifText:      body.motif_text || body.motif_id,
        motifPrecision: body.motif_precision,
        locationAddress: body.location_address,
        paymentMode:    body.payment_mode,
        paymentReference: body.payment_reference,
        driverName:     session.user.name || session.user.email || 'Chauffeur',
        notes:          body.notes,
        createdAt:      new Date().toISOString(),
      })
      console.log(`[interventions] Email admin envoye pour encaissement orphelin ${intervention.reference}`)
    } catch (e: any) {
      console.error('[interventions] Email admin echec (non bloquant):', e?.message)
    }
  }

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
        .select('billed_to_id, billed_to_name, client_name, client_phone, client_address, status, source, parc_zone_key')
        .eq('id', body.mission_id)
        .single()

      const updatePayload: Record<string, any> = {
        payment_collected_at: new Date().toISOString(),
        payment_mode:         body.payment_mode || 'unpaid',
        payment_amount:       sum,
      }
      // Le client encodé au paiement DEVIENT le payeur (billed_to). Olivier
      // 2026-07-13 : un client qui paie en direct REMPLACE un payeur source-défaut
      // (ex. « Siabis ») — car c'est bien lui qui règle, pas l'assistance. On
      // n'écrase QUE si un client est effectivement encodé (sinon on ne touche à rien).
      const hasEncodedClient = !!(body.client_name && String(body.client_name).trim())
      if (hasEncodedClient) {
        updatePayload.billed_to_name = String(body.client_name)
        if (body.client_id) updatePayload.billed_to_id = Number(body.client_id)
        else                updatePayload.billed_to_id = null   // recréé/relié via Odoo ci-dessous
      }

      // Olivier 2026-07-13 : reporter les COORDONNÉES du client encodé sur la fiche
      // (nom/téléphone/adresse) — avant, seul billed_to_name/id était posé, donc le
      // dispatch ne voyait pas les coords saisies au paiement. Remplissage des
      // champs VIDES uniquement (jamais d'écrasement d'une info existante).
      const composedAddr = String(body.client_address
        || [body.client_street, [body.client_zip, body.client_city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
        || '').trim()
      if (body.client_name    && !currentMission?.client_name)    updatePayload.client_name    = String(body.client_name)
      if (body.client_phone   && !currentMission?.client_phone)   updatePayload.client_phone   = String(body.client_phone)
      if (composedAddr        && !currentMission?.client_address) updatePayload.client_address = composedAddr

      // Si on a un client encodé mais pas d'id Odoo propagé par le frontend, on
      // crée/lie le partner Odoo via findOrCreatePartner (le client encodé devient
      // le payeur, y compris en remplacement d'un ancien billed_to). Olivier 2026-07-13.
      if (hasEncodedClient && !updatePayload.billed_to_id) {
        try {
          const addr = parseAddressForOdoo(body.client_address)
          // Olivier 2026-06-05 : wrap dans withOdooActor (cle perso chauffeur)
          // pour que le partner Odoo soit cree au nom de l'utilisateur connecte.
          const actorIdForPartner = driver?.id || (session.user as any).id
          const partnerId = await withOdooActor(actorIdForPartner, () => findOrCreatePartner({
            name:    body.client_name,
            phone:   body.client_phone,
            email:   body.client_email,
            street:  addr.street,
            zip:     addr.zip,
            city:    addr.city,
            countryCode: 'BE',
          }))
          if (partnerId) updatePayload.billed_to_id = partnerId
        } catch (e: any) {
          console.warn('[interventions] findOrCreatePartner Odoo echec:', e?.message)
        }
      }

      await supabase
        .from('incoming_missions')
        .update(updatePayload)
        .eq('id', body.mission_id)

      // Olivier 2026-06-03 : auto-restitution si mission en parked + source
      // fourriere (police_*, sia_couvert, prive). L encaissement equivaut a
      // une restitution : on passe en to_invoice + libere la position parc.
      // Sinon la mission restait bloquee en parked apres encaissement (bug
      // 10009032 : il fallait fixer en SQL manuellement).
      if (currentMission?.status === 'parked'
          && FOURRIERE_AUTO_RESTITUTE_SOURCES.includes(currentMission?.source || '')) {
        try {
          await supabase
            .from('incoming_missions')
            .update({
              status:       'to_invoice',
              completed_at: new Date().toISOString(),
            })
            .eq('id', body.mission_id)
          if (currentMission.parc_zone_key) {
            await releaseParcAndShift(supabase, body.mission_id)
          }
          console.log(`[interventions] Auto-restitution OK mission=${body.mission_id} (source=${currentMission.source})`)
        } catch (e: any) {
          console.warn(`[interventions] Auto-restitution KO mission=${body.mission_id}:`, e?.message)
        }
      }

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

  // N° de facture (+ n° mission) depuis les missions liées → colonne « Facture »
  // du module Mouvements. Olivier 2026-07-08.
  const intMissionIds = [...new Set((interventions || []).map((i: any) => i.mission_id).filter(Boolean))] as string[]
  const missionInfo = new Map<string, { invoice_number: string | null; mission_number: number | null; invoice_url: string | null }>()
  if (intMissionIds.length > 0) {
    const { data: ms } = await supabase.from('incoming_missions')
      .select('id, invoice_number, mission_number, invoice_url')
      .in('id', intMissionIds)
    for (const m of (ms || []) as any[]) {
      missionInfo.set(m.id, { invoice_number: m.invoice_number ?? null, mission_number: m.mission_number ?? null, invoice_url: m.invoice_url ?? null })
    }
  }

  const intEntries = (interventions || []).map((i: any) => {
    const mi = i.mission_id ? missionInfo.get(i.mission_id) : null
    return {
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
      mission_id:    i.mission_id || null,   // lien vers la fiche mission (bouton détail)
      invoice_number: mi?.invoice_number || null,
      mission_number: mi?.mission_number ?? null,
      invoice_url:    i.invoice_url || mi?.invoice_url || null,
    }
  })

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

// ────────────────────────────────────────────────────────────────────
// Olivier 2026-06-04 : email administration sur encaissement chauffeur
// SANS mission liee (cas hors dossier). Sert a creer la facture
// manuellement par l equipe administration.
// ────────────────────────────────────────────────────────────────────
async function sendAdminOrphanReceiptEmail(d: {
  reference:       string
  plate:           string
  brandText?:      string
  modelText?:      string
  clientName?:     string
  clientPhone?:    string
  clientEmail?:    string
  clientVat?:      string
  clientAddress?:  string
  clientStreet?:   string
  clientZip?:      string
  clientCity?:     string
  clientCountryCode?: string
  amount:          number
  motifText?:      string
  motifPrecision?: string
  locationAddress?: string
  paymentMode?:    string
  paymentReference?: string
  driverName:      string
  notes?:          string
  createdAt:       string
}): Promise<void> {
  const tvac = d.amount
  const htva = Math.round((tvac / 1.21) * 100) / 100
  const tva  = Math.round((tvac - htva) * 100) / 100
  const row = (label: string, value: string | undefined | null) => value
    ? `<tr><td style="padding:6px 12px;color:#666;font-size:13px;">${label}</td><td style="padding:6px 12px;font-size:13px;color:#111;font-weight:500;">${value}</td></tr>`
    : ''
  const content = `
    <h2 style="margin:0 0 16px;color:#CC2222;font-size:20px;">💳 Encaissement chauffeur — Facture à créer</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;">
      Un encaissement vient d'être effectué <strong>sans dossier mission lié</strong>.
      Toutes les infos ci-dessous pour créer la facture côté administration.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;margin:16px 0;">
      <thead><tr><th colspan="2" style="text-align:left;padding:10px 12px;background:#CC2222;color:#fff;border-radius:8px 8px 0 0;font-size:14px;">RÉFÉRENCE</th></tr></thead>
      <tbody>
        ${row('Référence', d.reference)}
        ${row('Date', new Date(d.createdAt).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' }))}
        ${row('Chauffeur', d.driverName)}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;margin:16px 0;">
      <thead><tr><th colspan="2" style="text-align:left;padding:10px 12px;background:#374151;color:#fff;border-radius:8px 8px 0 0;font-size:14px;">VÉHICULE & INTERVENTION</th></tr></thead>
      <tbody>
        ${row('Plaque', d.plate)}
        ${row('Véhicule', [d.brandText, d.modelText].filter(Boolean).join(' '))}
        ${row("Motif d'intervention", [d.motifText, d.motifPrecision].filter(Boolean).join(' — ') || '— (non spécifié)')}
        ${row('Lieu intervention', d.locationAddress)}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;margin:16px 0;">
      <thead><tr><th colspan="2" style="text-align:left;padding:10px 12px;background:#374151;color:#fff;border-radius:8px 8px 0 0;font-size:14px;">CLIENT À FACTURER</th></tr></thead>
      <tbody>
        ${row('Nom', d.clientName)}
        ${row('TVA', d.clientVat)}
        ${row('Adresse', d.clientAddress || [d.clientStreet, d.clientZip, d.clientCity, d.clientCountryCode].filter(Boolean).join(', '))}
        ${row('Téléphone', d.clientPhone)}
        ${row('Email', d.clientEmail)}
      </tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;background:#fff7ed;border:2px solid #f59e0b;border-radius:8px;margin:16px 0;">
      <thead><tr><th colspan="2" style="text-align:left;padding:10px 12px;background:#f59e0b;color:#fff;border-radius:6px 6px 0 0;font-size:14px;">PAIEMENT</th></tr></thead>
      <tbody>
        ${row('Mode de paiement', d.paymentMode)}
        ${row('Référence transaction', d.paymentReference)}
        ${row('Montant TVAC', `<strong style="color:#CC2222;font-size:16px;">${tvac.toFixed(2)} €</strong>`)}
        ${row('Montant HTVA', `${htva.toFixed(2)} €`)}
        ${row('TVA 21%', `${tva.toFixed(2)} €`)}
      </tbody>
    </table>
    ${d.notes ? `
    <div style="background:#f3f4f6;padding:12px;border-radius:8px;margin:16px 0;">
      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Notes chauffeur</p>
      <p style="margin:0;font-size:13px;color:#111;white-space:pre-wrap;">${d.notes}</p>
    </div>
    ` : ''}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">
      Email envoyé automatiquement à chaque encaissement chauffeur sans dossier mission lié.
    </p>
  `
  await sendEmail(
    'administration@verviersdepannage.com',
    `[Encaissement sans dossier] ${d.reference} · ${d.plate} · ${tvac.toFixed(2)} €`,
    emailLayout(content, 'Encaissement sans dossier mission'),
    'Administration Verviers Dépannage',
  )
}
