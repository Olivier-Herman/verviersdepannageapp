// src/app/api/missions/[id]/restitute/route.ts
//
// POST /api/missions/[id]/restitute
//
// Orchestre la restitution d un vehicule fourriere (Mal Garee pour l instant).
//
// Branche en 3 modes :
//   - 'invoice'      : user a un odoo_api_key -> crée le devis Odoo direct + status=completed
//   - 'driver_cash'  : user sans odoo_api_key -> mission passe to_invoice, devis sera
//                      cree plus tard via le module Encaissement Chauffeur
//   - 'no_charge'    : Restitution sans frais (motif obligatoire) -> status=completed
//
// Verifications :
//   - mission existe, status='parked', source='police_mg'
//   - police_blocked=true exige body.police_verified=true (proprio passe au commissariat)
//   - mode invoice/driver_cash : exige partner_id + payments[] couvrant le total
//
// Apres update :
//   - releaseParcAndShift libere la position + shift les voitures en aval

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { createAdminClient }       from '@/lib/supabase'
import { releaseParcAndShift }     from '@/lib/parc/release'
import { createSaleOrder, type QuoteLine } from '@/lib/odoo-quote'
import { withOdooActor }            from '@/lib/odoo'
import { buildOverrideLines, buildInterventionDescription } from '@/lib/missions/build-quote-lines'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const GARDIENNAGE_PRICE_HTVA = 20       // EUR/jour (commun a tous les types fourriere)

// Configuration par source fourriere : forfait + min jours gardiennage + produit Odoo.
// A etendre pour chaque nouveau type police (SIABIS, AVP, etc.)
interface SourceConfig {
  label:           string
  forfaitHtva:     number          // forfait enlevement HTVA
  forfaitOdooCode: string          // default_code produit Odoo pour le forfait
  forfaitName:     (ref: string) => string
  minDays:         number          // minimum jours gardiennage factures
}
const SOURCE_CONFIGS: Record<string, SourceConfig> = {
  police_mg: {
    label:           'Mal Garée',
    forfaitHtva:     165.29,                      // = 200 EUR TVAC
    forfaitOdooCode: 'PECMG',
    forfaitName:     (ref) => `Forfait enlèvement Mal Garée — ${ref}`,
    minDays:         0,
  },
  police_rodeo: {
    label:           'Rodéo',
    forfaitHtva:     165.29,                      // = 200 EUR TVAC (a confirmer)
    forfaitOdooCode: 'PECRODEO',
    forfaitName:     (ref) => `Forfait enlèvement Rodéo — ${ref}`,
    minDays:         3,                           // minimum 3 jours factures
  },
  police_avp: {
    label:           'AVP',
    forfaitHtva:     165.29,                      // = 200 EUR TVAC (tarif identique MG)
    forfaitOdooCode: 'PECAVP',
    forfaitName:     (ref) => `Forfait enlèvement AVP — ${ref}`,
    minDays:         0,
    // AVP : police_blocked=true par defaut a la creation, donc la modal
    // restitution forcera la verification "Proprio est-il passe a la police ?"
  },
}

interface PaymentLine {
  mode:      'cash' | 'bancontact' | 'driver_encaissement'
  amount:    number
  driver_id?: string  // si mode = driver_encaissement
}

interface RestituteBody {
  mode:              'invoice' | 'driver_cash' | 'no_charge'
  // invoice / driver_cash
  partner_id?:       number   // res.partner Odoo
  partner_name?:     string   // pour stocker billed_to_name
  payments?:         PaymentLine[]
  // police_blocked
  police_verified?:  boolean
  // police_rodeo : levee de saisie validee
  levee_saisie_verified?: boolean
  // no_charge
  no_charge_reason?: string
}

/** Nombre de jours de gardiennage : 1 jour par 24h effective ecoulee. */
function computeGardiennageDays(entryIso: string, exitIso: string): number {
  const entry = new Date(entryIso).getTime()
  const exit  = new Date(exitIso).getTime()
  if (!isFinite(entry) || !isFinite(exit) || exit < entry) return 0
  const diffMs = exit - entry
  const days   = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  return days
}

/** Construit la note paiement pour le devis Odoo : "Paye par 100 EUR especes + 65 EUR Bancontact". */
function formatPaymentNote(payments: PaymentLine[]): string {
  if (!payments || payments.length === 0) return ''
  const parts = payments.map(p => {
    const label = p.mode === 'cash' ? 'espèces'
              : p.mode === 'bancontact' ? 'Bancontact'
              : 'encaissement chauffeur'
    return `${p.amount.toFixed(2)} € ${label}`
  })
  return `Payé par : ${parts.join(' + ')}`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin', 'dispatcher'].includes(role) ||
    modules.includes('fourriere') ||
    modules.includes('facturation')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const missionId = String(params.id || '').trim()
  if (!missionId) return NextResponse.json({ error: 'mission_id requis' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as RestituteBody

  if (!['invoice', 'driver_cash', 'no_charge'].includes(body.mode)) {
    return NextResponse.json({ error: 'mode invalide (invoice | driver_cash | no_charge)' }, { status: 400 })
  }

  const sb = createAdminClient()

  // 1. Lit la mission
  const { data: mission, error: mErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, status, mission_type,
      vehicle_plate, vehicle_brand, vehicle_model, vehicle_vin,
      client_name, client_phone, billed_to_id, billed_to_name,
      incident_address, incident_city, destination_address,
      parc_zone_key, parc_row_number, parc_slot_index,
      received_at, intervention_date, parked_at,
      police_blocked, police_levee_saisie_ok, odoo_quote_id,
      special_tarif_htva, amount_guaranteed, amount_to_collect
    `)
    .eq('id', missionId)
    .maybeSingle()

  if (mErr || !mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  // 2. Verifications business
  const sourceConfig = SOURCE_CONFIGS[mission.source]
  if (!sourceConfig) {
    return NextResponse.json({
      error: `Source mission "${mission.source}" non supportee par la restitution fourriere. Sources possibles : ${Object.keys(SOURCE_CONFIGS).join(', ')}.`,
    }, { status: 409 })
  }
  if (mission.status !== 'parked') {
    return NextResponse.json({ error: `Mission deja restituee (status=${mission.status})` }, { status: 409 })
  }
  if (mission.police_blocked && !body.police_verified) {
    return NextResponse.json({
      error: 'Mission bloquee par la police. Confirmer que le proprietaire est passe au commissariat (police_verified=true).',
      requires_police_check: true,
    }, { status: 409 })
  }
  // Rodeo : la levee de saisie est OBLIGATOIRE avant restitution.
  // Soit cochee au form de creation (police_levee_saisie_ok=true en BDD), soit
  // confirmee a la restitution via body.levee_saisie_verified.
  if (mission.source === 'police_rodeo' && !mission.police_levee_saisie_ok && !body.levee_saisie_verified) {
    return NextResponse.json({
      error: 'Levee de saisie obligatoire pour les Rodeos. Confirmer que le document a ete recu (levee_saisie_verified=true).',
      requires_levee_saisie: true,
    }, { status: 409 })
  }

  // 3. Resolve actor + check odoo access (pour Mode Invoice direct uniquement)
  const { data: actor } = await sb
    .from('users')
    .select('id, name, role, modules, odoo_api_key')
    .eq('id', user.id || '')
    .maybeSingle()
  const userHasOdooKey = Boolean(actor?.odoo_api_key)

  const now      = new Date().toISOString()
  const entry    = mission.parked_at || mission.received_at || mission.intervention_date || now
  const rawDays  = computeGardiennageDays(entry, now)
  // Applique le minimum de jours selon source (3 pour Rodeo, 0 sinon)
  const days     = Math.max(rawDays, sourceConfig.minDays)

  // 4. Branche selon mode
  // ─── 4a. NO_CHARGE : motif requis, status -> completed, pas de devis ────────
  if (body.mode === 'no_charge') {
    const reason = String(body.no_charge_reason || '').trim()
    if (!reason) return NextResponse.json({ error: 'Motif requis pour Restitution sans frais' }, { status: 400 })

    await sb.from('incoming_missions').update({
      status:           'completed',
      no_charge_at:     now,
      no_charge_reason: reason,
      no_charge_by:     user.id,
      released_at:      now,
    }).eq('id', missionId)

    await sb.from('mission_logs').insert({
      mission_id: missionId,
      actor_id:   user.id,
      action:     'no_charge',
      notes:      `Restitution sans frais (${sourceConfig.label}) : ${reason}`,
      metadata:   { reason, source: mission.source },
    })

    await releaseParcAndShift(sb, missionId)
    return NextResponse.json({ ok: true, mode: 'no_charge', mission_id: missionId, days })
  }

  // ─── 4b/c : invoice OR driver_cash : exige partner + payments ────────────────
  if (!body.partner_id || body.partner_id <= 0) {
    return NextResponse.json({ error: 'partner_id Odoo requis' }, { status: 400 })
  }
  const partnerName = String(body.partner_name || '').trim()
  if (!partnerName) {
    return NextResponse.json({ error: 'partner_name requis' }, { status: 400 })
  }
  const payments = Array.isArray(body.payments) ? body.payments : []
  if (payments.length === 0) {
    return NextResponse.json({ error: 'Au moins un mode de paiement requis' }, { status: 400 })
  }

  // Calcul total HTVA et TTC pour validation (utilise config selon source)
  const forfaitHtva  = sourceConfig.forfaitHtva
  const gardienHtva  = GARDIENNAGE_PRICE_HTVA * days
  const totalHtva    = forfaitHtva + gardienHtva
  const totalTvac    = Math.round(totalHtva * 1.21 * 100) / 100
  const sumPaid      = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  // Tolerance 1 cent pour les arrondis
  if (Math.abs(sumPaid - totalTvac) > 0.01) {
    return NextResponse.json({
      error: `Total paiements ${sumPaid.toFixed(2)} EUR != total du ${totalTvac.toFixed(2)} EUR TVAC`,
      total_due_tvac:   totalTvac,
      total_due_htva:   totalHtva,
      forfait_htva:     forfaitHtva,
      gardiennage_htva: gardienHtva,
      days,
    }, { status: 400 })
  }

  const paymentNote = formatPaymentNote(payments)
  const breakdown   = payments.map(p => ({ mode: p.mode, amount: p.amount, driver_id: p.driver_id || null }))

  // ─── 4b. INVOICE : pousse devis Odoo direct ────────────────────────────────
  if (body.mode === 'invoice') {
    if (!userHasOdooKey) {
      return NextResponse.json({
        error: 'Mode invoice reserve aux users avec odoo_api_key. Utilisez driver_cash a la place.',
      }, { status: 403 })
    }

    // Build les lignes devis (config source : PECMG / PECRODEO / ...)
    // Olivier 2026-06-04 : court-circuit centralise via buildOverrideLines
    // (tarif special OU amount_guaranteed + amount_to_collect = 2 lignes).
    // Si applicable, ecrase forfait + gardiennage.
    const ref = mission.external_id || mission.dossier_number || mission.id.slice(0, 8)
    const override = buildOverrideLines(mission as any)
    let lines: QuoteLine[]
    if (override) {
      lines = override
    } else {
      lines = [{
        kind:       sourceConfig.forfaitOdooCode as any,
        name:       sourceConfig.forfaitName(ref),
        qty:        1,
        price_unit: sourceConfig.forfaitHtva,
      }]
      if (days > 0) {
        lines.push({
          kind:       'GARDIENNAGE' as any,
          name:       `Gardiennage parc fourrière (${days} jour${days > 1 ? 's' : ''})`,
          qty:        days,
          price_unit: GARDIENNAGE_PRICE_HTVA,
        })
      }
    }

    let quoteId:  number | null = null
    let quoteUrl: string | null = null
    try {
      // Olivier 2026-06-04 : wrap dans withOdooActor pour tracabilite cle perso
      const result = await withOdooActor(user?.id, () => createSaleOrder({
        partner_id:       body.partner_id as number,
        origin:           ref,
        client_order_ref: mission.dossier_number || mission.external_id || undefined,
        sections: [{
          section_label: paymentNote || undefined,
          lines,
        }],
        description:      buildInterventionDescription(mission as any),
      }))
      quoteId  = result.id
      quoteUrl = result.url
    } catch (e: any) {
      console.error('[restitute] Push devis Odoo echec:', e.message)
      return NextResponse.json({ error: `Push devis Odoo echec : ${e.message}` }, { status: 500 })
    }

    // Update mission : completed direct (le devis est cree, plus rien a faire)
    const updateInvoice: Record<string, any> = {
      status:             'completed',
      billed_to_id:       body.partner_id,
      billed_to_name:     partnerName,
      payment_breakdown:  breakdown,
      odoo_quote_id:      quoteId,
      odoo_quote_url:     quoteUrl,
      odoo_quoted_at:     now,
      released_at:        now,
      released_by:        user.id,
      completed_at:       now,
    }
    if (mission.source === 'police_rodeo' && body.levee_saisie_verified) {
      updateInvoice.police_levee_saisie_ok = true
    }
    await sb.from('incoming_missions').update(updateInvoice).eq('id', missionId).then(() => {}, async () => {
      // Si released_at/by ou completed_at n existent pas en BDD, retry sans
      await sb.from('incoming_missions').update({
        status:             'completed',
        billed_to_id:       body.partner_id,
        billed_to_name:     partnerName,
        payment_breakdown:  breakdown,
        odoo_quote_id:      quoteId,
        odoo_quote_url:     quoteUrl,
        odoo_quoted_at:     now,
      }).eq('id', missionId)
    })

    await sb.from('mission_logs').insert({
      mission_id: missionId,
      actor_id:   user.id,
      action:     'restituted_invoice',
      notes:      `Restitution + devis Odoo #${quoteId} cree. ${paymentNote}`,
      metadata:   { mode: 'invoice', partner_id: body.partner_id, quote_id: quoteId, payments: breakdown, days, total_tvac: totalTvac },
    })

    await releaseParcAndShift(sb, missionId)
    return NextResponse.json({
      ok:       true,
      mode:     'invoice',
      mission_id: missionId,
      quote:    { id: quoteId, url: quoteUrl },
      days,
      total_tvac: totalTvac,
    })
  }

  // ─── 4c. DRIVER_CASH : pas de devis Odoo, mission -> to_invoice ─────────────
  // Le devis sera cree plus tard via le module Encaissement Chauffeur.
  const updateDriverCash: Record<string, any> = {
    status:             'to_invoice',
    billed_to_id:       body.partner_id,
    billed_to_name:     partnerName,
    payment_breakdown:  breakdown,
    released_at:        now,
    released_by:        user.id,
  }
  if (mission.source === 'police_rodeo' && body.levee_saisie_verified) {
    updateDriverCash.police_levee_saisie_ok = true
  }
  await sb.from('incoming_missions').update(updateDriverCash).eq('id', missionId).then(() => {}, async () => {
    await sb.from('incoming_missions').update({
      status:             'to_invoice',
      billed_to_id:       body.partner_id,
      billed_to_name:     partnerName,
      payment_breakdown:  breakdown,
    }).eq('id', missionId)
  })

  await sb.from('mission_logs').insert({
    mission_id: missionId,
    actor_id:   user.id,
    action:     'restituted_driver_cash',
    notes:      `Restitution via encaissement chauffeur. ${paymentNote}. Devis Odoo a creer.`,
    metadata:   { mode: 'driver_cash', partner_id: body.partner_id, payments: breakdown, days, total_tvac: totalTvac },
  })

  // Parc Odoo : véhicule restitué → Terminé si dossier bouclé (idempotent, non bloquant).
  {
    const { syncParcVehicleTerminated } = await import('@/lib/missions/parc-fleet-state')
    await syncParcVehicleTerminated(sb, missionId)
  }

  await releaseParcAndShift(sb, missionId)

  return NextResponse.json({
    ok:           true,
    mode:         'driver_cash',
    mission_id:   missionId,
    days,
    total_tvac:   totalTvac,
    redirect_to:  `/encaissement?mission_id=${encodeURIComponent(missionId)}&plate=${encodeURIComponent(mission.vehicle_plate || '')}&amount=${totalTvac.toFixed(2)}`,
  })
}
