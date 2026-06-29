// src/app/api/francofolies/pickup/route.ts
//
// POST /api/francofolies/pickup — enlèvement d'un véhicule (Francofolies de Spa).
// Le client vient récupérer son véhicule mal garé : on encaisse, on passe la
// fiche en to_invoice (la facturation créera le devis Odoo : ligne SERV-DIV
// réquisition + gardiennage), et on envoie un reçu si email fourni.
//
// Modes :
//   - 'invoice'   : client + paiement → encaissement + to_invoice + reçu
//   - 'no_charge' : restitution sans frais (motif obligatoire) → completed
//
// Olivier 2026-06-29.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { withOdooActor, findOrCreatePartner } from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function canAccess(session: any): boolean {
  if (!session) return false
  const u = session.user as any
  const role = u.role || ''
  const roles: string[] = Array.isArray(u.roles) ? u.roles : [role]
  const modules: string[] = u.modules || []
  return ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r))
    || modules.includes('francofolies')
    || roles.includes('driver') || roles.includes('chauffeur')
}

/** Jours de gardiennage facturables : "jour entamé au-delà de 24h" (24h offert). */
function computeGardiennageDays(entryIso: string, exitIso: string): number {
  const entry = new Date(entryIso).getTime()
  const exit  = new Date(exitIso).getTime()
  if (!isFinite(entry) || !isFinite(exit) || exit <= entry) return 0
  const over = (exit - entry) - 24 * 3600 * 1000   // au-delà des premières 24h
  if (over <= 0) return 0
  return Math.ceil(over / (24 * 3600 * 1000))
}

interface PickupBody {
  mission_id:        string
  mode:              'invoice' | 'no_charge'
  // invoice
  client?:           { name?: string; address?: string; zip?: string; city?: string; phone?: string; email?: string; vat?: string }
  payment_mode?:     'cash' | 'bancontact' | 'sumup' | 'qr_transfer' | 'unpaid'
  gardiennage_days?: number        // jours retenus (0 = non comptabilisé)
  police_verified?:  boolean        // si police_blocked : proprio passé au commissariat
  // no_charge
  no_charge_reason?: string
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const user = session!.user as any

  const body = await req.json().catch(() => ({})) as PickupBody
  const missionId = String(body.mission_id || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })
  if (!['invoice', 'no_charge'].includes(body.mode)) {
    return NextResponse.json({ error: 'mode invalide (invoice | no_charge)' }, { status: 400 })
  }

  const sb  = createAdminClient()
  const now = new Date().toISOString()

  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, source, status, vehicle_plate, vehicle_brand, vehicle_model,
      parked_at, received_at, intervention_date, police_blocked, assigned_to
    `)
    .eq('id', missionId)
    .maybeSingle()
  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  if (mission.source !== 'francofolies') {
    return NextResponse.json({ error: 'Cette fiche n\'est pas une fiche Francofolies' }, { status: 409 })
  }
  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Véhicule déjà enlevé (statut=${mission.status})` }, { status: 409 })
  }
  if (mission.police_blocked && body.mode === 'invoice' && !body.police_verified) {
    return NextResponse.json({
      error: 'Blocage police : confirmer que le propriétaire est passé au commissariat.',
      requires_police_check: true,
    }, { status: 409 })
  }

  // ── Mode sans frais ──────────────────────────────────────────────────────
  if (body.mode === 'no_charge') {
    const reason = String(body.no_charge_reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'Motif requis pour la restitution sans frais' }, { status: 400 })
    // NB : `released_at`/`released_by` n'existent PAS sur incoming_missions → on
    // ne les met pas. Et Supabase ne *rejette* pas sur erreur SQL (il résout avec
    // {error}) → on vérifie explicitement l'erreur et on renvoie un 500 si ça
    // échoue (avant, l'échec passait silencieux et la fiche restait 'parked').
    const { error: ncErr } = await sb.from('incoming_missions').update({
      status:           'completed',
      no_charge_at:     now,
      no_charge_reason: reason,
      no_charge_by:     user.id,
      completed_at:     now,
    }).eq('id', missionId)
    if (ncErr) {
      console.error('[francofolies pickup] no_charge update KO:', ncErr.message)
      return NextResponse.json({ error: `Échec restitution sans frais : ${ncErr.message}` }, { status: 500 })
    }
    await sb.from('mission_logs').insert({
      mission_id: missionId, actor_id: user.id, action: 'francofolies_no_charge',
      notes: `Enlèvement sans frais (Francofolies) : ${reason}`,
    }).then(() => {}, () => {})
    return NextResponse.json({ ok: true, mode: 'no_charge', mission_id: missionId })
  }

  // ── Mode facturé : client + paiement ─────────────────────────────────────
  const client = body.client || {}
  const clientName = String(client.name || '').trim()
  if (!clientName) return NextResponse.json({ error: 'Nom du client requis' }, { status: 400 })
  const PAY_MODES = ['cash', 'bancontact', 'sumup', 'qr_transfer', 'unpaid'] as const
  const paymentMode = PAY_MODES.includes(body.payment_mode as any) ? body.payment_mode! : 'cash'
  const isUnpaid = paymentMode === 'unpaid'   // "À facturer" : rien d'encaissé sur place

  // Réglages tarifaires (figés sur la fiche pour la facturation).
  const { data: settings } = await sb.from('app_settings').select('key, value')
    .in('key', ['francofolies_price', 'francofolies_gardiennage_price'])
  const priceMap = new Map((settings || []).map((s: any) => [s.key, Number(s.value)]))
  // francofolies_price = prix réquisition TVAC (220) ; gardiennage = HTVA/jour (20).
  const baseTvac   = priceMap.get('francofolies_price') || 220
  const gardienPu  = priceMap.get('francofolies_gardiennage_price') || 20   // HTVA/jour
  // PU HTVA de la ligne Odoo (4 déc. pour que HTVA×1,21 = TVAC exact).
  const baseHtva   = Math.round((baseTvac / 1.21) * 10000) / 10000

  // Jours de gardiennage : on borne ce que l'opérateur demande au calcul réel.
  const entry      = mission.parked_at || mission.received_at || mission.intervention_date || now
  const maxDays    = computeGardiennageDays(entry, now)
  const gDays      = Math.max(0, Math.min(Number(body.gardiennage_days || 0), maxDays))

  const gardTvac   = Math.round(gardienPu * 1.21 * gDays * 100) / 100
  const totalTvac  = Math.round((baseTvac + gardTvac) * 100) / 100

  // 1. Partner Odoo (créé/retrouvé) — actor-aware (clé perso si présente).
  let partnerId: number | null = null
  try {
    partnerId = await withOdooActor(user?.id, () => findOrCreatePartner({
      name:   clientName,
      phone:  client.phone || undefined,
      email:  client.email || undefined,
      vat:    client.vat || undefined,
      street: client.address || undefined,
      zip:    client.zip || undefined,
      city:   client.city || undefined,
      countryCode: 'BE',
    }))
  } catch (e: any) {
    console.error('[francofolies pickup] findOrCreatePartner KO:', e?.message)
    // Non bloquant : on facturera quand même, le partner sera à compléter.
  }

  // 2. Encaissement (interventions) — sauf "À facturer" (rien encaissé sur place).
  if (!isUnpaid) {
    const { data: actorRow } = await sb.from('users').select('id').eq('email', user.email).maybeSingle()
    await sb.from('interventions').insert({
      service_type:    'encaissement',
      driver_id:       actorRow?.id || user.id || null,
      mission_id:      missionId,
      plate:           mission.vehicle_plate,
      brand_text:      mission.vehicle_brand,
      model_text:      mission.vehicle_model,
      motif_text:      'Véhicule mal garé — Francofolies de Spa',
      location_address:'Francofolies de Spa',
      amount:          totalTvac,
      payment_mode:    paymentMode,
      client_name:     clientName,
      client_address:  client.address || null,
      client_phone:    client.phone || null,
      client_email:    client.email || null,
      client_vat:      client.vat || null,
      notes:           `Francofolies — base ${baseHtva}€ HTVA${gDays > 0 ? ` + gardiennage ${gDays}j × ${gardienPu}€` : ''}`,
    }).then(() => {}, (e) => console.error('[francofolies pickup] intervention KO:', e?.message))
  }

  // 3. Mission → to_invoice + tarification figée + client.
  const update: Record<string, any> = {
    status:              'to_invoice',
    billed_to_id:        partnerId,
    billed_to_name:      clientName,
    client_name:         clientName,
    client_phone:        client.phone || null,
    client_email:        client.email || null,
    client_address:      client.address || null,
    client_city:         client.city || null,
    client_vat:          client.vat || null,
    payment_method:      paymentMode,
    amount_to_collect:   totalTvac,
    amount_collected:    isUnpaid ? 0 : totalTvac,
    ff_base_htva:        baseHtva,
    ff_gardiennage_days: gDays,
    ff_gardiennage_pu:   gardienPu,
    // NB : released_at/released_by n'existent pas sur incoming_missions.
  }
  const { error: updErr } = await sb.from('incoming_missions').update(update).eq('id', missionId)
  if (updErr) {
    console.error('[francofolies pickup] update KO:', updErr.message)
    return NextResponse.json({ error: `Échec mise à jour : ${updErr.message}` }, { status: 500 })
  }

  await sb.from('mission_logs').insert({
    mission_id: missionId, actor_id: user.id, action: 'francofolies_pickup',
    notes: `Enlèvement Francofolies — ${clientName} · ${totalTvac.toFixed(2)} € TVAC (${paymentMode})${gDays > 0 ? ` · gardiennage ${gDays}j` : ''}`,
    metadata: { partner_id: partnerId, base_htva: baseHtva, gardiennage_days: gDays, total_tvac: totalTvac, payment_mode: paymentMode },
  }).then(() => {}, () => {})

  // 4. Reçu client (best-effort, si email).
  let receiptSent = false
  if (client.email) {
    try {
      const { sendClientReceipt } = await import('@/lib/receipt')
      await sendClientReceipt({
        clientEmail:    client.email,
        clientName,
        reference:      mission.external_id || `FF-${mission.vehicle_plate}`,
        amount:         totalTvac,
        paymentMode,
        plate:          mission.vehicle_plate || '',
        vehicleDisplay: [mission.vehicle_brand, mission.vehicle_model].filter(Boolean).join(' ') || '—',
        motifText:      'Véhicule mal garé — Francofolies de Spa',
        locationAddress:'Francofolies de Spa',
      })
      receiptSent = true
    } catch (e: any) {
      console.error('[francofolies pickup] reçu KO:', e?.message)
    }
  }

  return NextResponse.json({
    ok: true, mode: 'invoice', mission_id: missionId,
    partner_id: partnerId, total_tvac: totalTvac, gardiennage_days: gDays,
    base_htva: baseHtva, receipt_sent: receiptSent,
  })
}
