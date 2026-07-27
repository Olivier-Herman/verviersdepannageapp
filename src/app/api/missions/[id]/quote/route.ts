// src/app/api/missions/[id]/quote/route.ts
//
// POST /api/missions/[id]/quote
//   - Calcule le devis (forfait + km + parc + surcharges) via estimateMissionPrice
//   - Cree ou met a jour un sale.order Odoo via lib/odoo-quote
//   - Stocke odoo_quote_id + odoo_quote_url + odoo_quoted_at sur la mission
//   - Idempotent : si la mission a deja un odoo_quote_id, on UPDATE
//
// Acces : admin / superadmin / module 'facturation'.
// Cf [[facturation-phase2]] pour la vision.

import { NextResponse }          from 'next/server'
import { getServerSession }      from 'next-auth'
import { authOptions }           from '@/lib/auth'
import { createAdminClient }     from '@/lib/supabase'
import { estimateMissionPrice }  from '@/lib/missions/estimate-price'
import { buildOverrideLines, buildInterventionDescription } from '@/lib/missions/build-quote-lines'
import { createSaleOrder, updateSaleOrder, createDraftInvoice, updateDraftInvoice, getInvoiceMove, findFleetVehicleByPlate, QuoteNotFoundError, type QuoteLine, type QuoteSection } from '@/lib/odoo-quote'
import { attachFileToOrder, attachFileToInvoice, postChatterMessage, withOdooActor } from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

function fmtEur(n: number): string {
  return `${n.toFixed(2).replace('.', ',')} €`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Auth INTERNE (facturation auto depuis driver-action) : header secret, pas de
  // session. Sinon auth session classique. Olivier 2026-07-27.
  const isInternal = req.headers.get('x-internal-secret') === (process.env.NEXTAUTH_SECRET || '__none__')
  const session = isInternal ? null : await getServerSession(authOptions)
  if (!isInternal) {
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const u = session.user as any
    const role: string = u.role || ''
    const modules: string[] = Array.isArray(u.modules) ? u.modules : []
    const isDriverFlow = modules.includes('driver_missions') || modules.includes('encaissement')
    if (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation') && !isDriverFlow) {
      return NextResponse.json({ error: 'Accès réservé à la facturation.' }, { status: 403 })
    }
  }
  const user = (session?.user as any) || {}

  // Body optionnel : { lines: [{ kind, name, qty, price_unit }], mode }
  // mode 'quote' (défaut) → sale.order brouillon (devis) ; mode 'invoice' →
  // account.move out_invoice brouillon (facture directe, sans devis).
  const body = await req.json().catch(() => ({}))
  const mode: 'quote' | 'invoice' = body.mode === 'invoice' ? 'invoice' : 'quote'
  // requireTariff : pour la facturation AUTO — on ne crée RIEN si aucun vrai
  // tarif n'est calculé (pas de facture « coquille vide »). Olivier 2026-07-27.
  const requireTariff = !!body.requireTariff
  let customLines: QuoteLine[] | null = Array.isArray(body.lines) && body.lines.length > 0
    ? body.lines.map((l: any): QuoteLine => ({
        kind:       (['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'].includes(l.kind) ? l.kind : 'SERV-DIV') as any,
        name:       String(l.name || ''),
        qty:        Number(l.qty || 0),
        price_unit: Number(l.price_unit || 0),
      })).filter((l: QuoteLine) => l.name && l.qty > 0)
    : null

  const sb = createAdminClient()

  // Si pas de customLines dans le body, on lit le brouillon persistant en BDD
  // (l employe a peut-etre fait des modifs + sauvegarde mais ferme le modal
  // avant de pousser, ou pousse depuis un autre flow qui ne forward pas les lines).
  if (!customLines) {
    const { data: draft } = await sb
      .from('mission_invoice_drafts')
      .select('lines')
      .eq('mission_id', params.id)
      .maybeSingle()
    if (draft?.lines && Array.isArray(draft.lines) && draft.lines.length > 0) {
      customLines = draft.lines.map((l: any): QuoteLine => ({
        kind:       (['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'].includes(l.kind) ? l.kind : 'SERV-DIV') as any,
        name:       String(l.name || ''),
        qty:        Number(l.qty || 0),
        price_unit: Number(l.price_unit || 0),
      })).filter((l: QuoteLine) => l.name && l.qty > 0)
      console.log(`[quote] Draft persistant utilise pour mission ${params.id} (${customLines.length} lignes)`)
    }
  }
  const { data: mission, error: missionErr } = await sb
    .from('incoming_missions')
    .select(`
      id, external_id, dossier_number, source, mission_type, status,
      client_name, vehicle_plate, vehicle_mileage, vehicle_class,
      incident_address, destination_address, redelivery_address,
      parked_at, intervention_date, received_at, incident_type, parent_mission_id,
      levee_saisie_date, temp_returned_at, domaine_remise_date,
      billed_to_id, billed_to_name, payment_method,
      amount_to_collect, special_tarif_htva, amount_guaranteed,
      ff_base_htva, ff_gardiennage_days, ff_gardiennage_pu,
      incident_lat, incident_lng, destination_lat, destination_lng,
      snc_scenario, snc_requires_balisage, extra_addresses,
      odoo_quote_id, odoo_quote_url, invoice_odoo_id
    `)
    .eq('id', params.id)
    .single()

  if (missionErr || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  if (!mission.billed_to_id) {
    return NextResponse.json({
      error: `Pas de client à facturer renseigné sur la mission (billed_to_id manquant). Renseigne-le d'abord sur la fiche dispatch.`,
    }, { status: 400 })
  }

  const missionRef = mission.external_id || mission.dossier_number || `M-${mission.id.slice(0, 8)}`

  // Si l employe a personnalise les lignes cote UI, on les utilise directement.
  let lines: QuoteLine[] = []
  let totalForResponse = 0

  // Olivier 2026-06-04 : helper centralise pour les overrides (tarif special
  // OU amount_guaranteed + amount_to_collect = 2 lignes). S applique pour
  // TOUTES les sources (y compris SNC/SC). Retourne null si rien d applicable.
  const override = buildOverrideLines(mission as any)
  if (customLines) {
    lines = customLines
    totalForResponse = customLines.reduce((s, l) => s + l.qty * l.price_unit, 0)
  } else if (override) {
    lines = override
    totalForResponse = override.reduce((s, l) => s + l.qty * l.price_unit, 0)
  } else if ((mission.source === 'police_snc' || mission.source === 'sia_couvert') && (mission as any).snc_scenario) {
    // SNC / SC : tarification specifique (SIAREM/SIAKIL/SIABAL + MAJ si plage horaire).
    // SC = variant 'sc' (pas de km, forfait + balisage seulement).
    const variant = mission.source === 'sia_couvert' ? 'sc' : 'snc'
    const { computeSncMetrics, buildSncQuoteLines } = await import('@/lib/snc/pricing')
    // Stops chauffeur (extra_addresses) ordonnes
    const rawStops = Array.isArray((mission as any).extra_addresses) ? (mission as any).extra_addresses : []
    const stops    = [...rawStops].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((s: any) => ({ lat: s.lat, lng: s.lng, label: s.label || s.address }))
    const metrics = await computeSncMetrics({
      scenario:          (mission as any).snc_scenario,
      requiresBalisage:  Boolean((mission as any).snc_requires_balisage),
      interventionLat:   (mission as any).incident_lat,
      interventionLng:   (mission as any).incident_lng,
      destinationLat:    (mission as any).destination_lat,
      destinationLng:    (mission as any).destination_lng,
      interventionAt:    mission.intervention_date || mission.received_at,
      variant,
      billedToId:        (mission as any).billed_to_id,
      billedToName:      (mission as any).billed_to_name,
      stops,
    })
    if (metrics) {
      const sncLines = buildSncQuoteLines({
        metrics,
        requiresBalisage:  Boolean((mission as any).snc_requires_balisage),
        missionRef,
        variant,
      })
      lines = sncLines.map(l => ({
        kind:       l.kind as any,
        name:       l.name,
        qty:        l.qty,
        price_unit: l.price_unit,
      }))
      totalForResponse = sncLines.reduce((s, l) => s + l.qty * l.price_unit, 0)
    } else {
      totalForResponse = 0  // pas de coordonnees -> devis shell
    }
  } else {
    // 1) Calcule le devis via le module estimate-price existant.
    //    Si pas de tarif applicable, on pousse un devis SHELL (sans lignes) :
    //    l employe completera les lignes manuellement dans Odoo. L app sert
    //    au moins a pre-remplir partner + ref dossier + vehicule.
    const estimate = await estimateMissionPrice(mission as any)
    if (!estimate.ok) {
      // Pas de tarif -> devis vide (shell), on saute le calcul des lignes
      totalForResponse = 0
    } else {
    totalForResponse = estimate.total_eur

  // 2) Construit les lignes a partir du breakdown

  if (estimate.forfait && estimate.forfait > 0) {
    lines.push({
      kind:       'SERV-PEC',
      name:       `Prise en charge ${mission.source ? `(${mission.source.toUpperCase()}) ` : ''}— ${missionRef}`,
      qty:        1,
      price_unit: estimate.forfait,
    })
  }

  if (estimate.km_extra > 0 && estimate.km_extra_eur > 0) {
    const pu = estimate.km_extra_eur / estimate.km_extra
    lines.push({
      kind:       'SERV-KM',
      name:       `Km supplémentaires (${estimate.km_extra} km au-delà de ${estimate.km_inclus} inclus)`,
      qty:        estimate.km_extra,
      price_unit: Math.round(pu * 100) / 100,
    })
  }

  if (estimate.parc_jours > 0 && estimate.parc_eur > 0) {
    const pu = estimate.parc_eur / estimate.parc_jours
    lines.push({
      kind:       'SERV-PARC',
      name:       `Frais de parc (${estimate.parc_jours} jour${estimate.parc_jours > 1 ? 's' : ''})`,
      qty:        estimate.parc_jours,
      price_unit: Math.round(pu * 100) / 100,
    })
  }

  if (estimate.surcharge_pct > 0 && estimate.surcharge_eur > 0) {
    // Majoration : qty = % en decimal (ex 0.30), PU = total HT majorable
    lines.push({
      kind:       'SERV-MAJ',
      name:       `Majoration ${estimate.surcharge_pct}%`,
      qty:        Math.round(estimate.surcharge_pct) / 100,
      price_unit: Math.round(estimate.subtotal_eur * 100) / 100,
    })
  }
    }  // fin else (estimate.ok)
  }  // fin else (pas de customLines)

  // Note : on accepte de pousser un devis VIDE (lines=[]) si pas de tarif et
  // pas de customLines. L employe completera dans Odoo (cf Olivier 2026-05-20).

  // Facturation AUTO : si aucun vrai tarif calculé, on N'ÉMET RIEN (pas de
  // coquille vide) et on laisse la fiche en facturation manuelle.
  if (requireTariff && (lines.length === 0 || totalForResponse <= 0)) {
    return NextResponse.json({ ok: false, reason: 'no_tariff', skipped: true })
  }

  // 3+4) Lookup fleet.vehicle + Push Odoo (create/update). Olivier 2026-06-04 :
  // wrap dans withOdooActor pour tracer au user connecte (cle perso).
  // Mode facture directe : gère la facture existante selon son état Odoo.
  //   - BROUILLON  → on MET À JOUR ses lignes (recliquer Facturer = recalcul).
  //   - POSTÉE/annulée → non modifiable, on renvoie l'existante (verrouillée).
  //   - SUPPRIMÉE  → on nettoie la réf morte et on recrée plus bas.
  // Olivier 2026-07-26.
  let invoiceUpdateId: number | null = null
  if (mode === 'invoice' && (mission as any).invoice_odoo_id) {
    const existing = await withOdooActor(user?.id, () => getInvoiceMove((mission as any).invoice_odoo_id)).catch(() => null)
    if (existing) {
      if (existing.state === 'draft') {
        invoiceUpdateId = existing.id   // brouillon → mise à jour des lignes plus bas
      } else {
        return NextResponse.json({ ok: true, mode, invoice: existing, already_exists: true, locked: existing.state })
      }
    } else {
      await sb.from('incoming_missions').update({ invoice_odoo_id: null }).eq('id', mission.id)
      console.log(`[quote] invoice_odoo_id ${(mission as any).invoice_odoo_id} introuvable (supprimée) → recréation`)
    }
  }

  let result: { id: number; url: string }
  try {
    result = await withOdooActor(user?.id, async () => {
      let fleetVehicleId: number | null = null
      if (mission.vehicle_plate) {
        fleetVehicleId = await findFleetVehicleByPlate(mission.vehicle_plate)
      }
      const sections: QuoteSection[] = [{ lines }]
      const commonInput = {
        partner_id:       mission.billed_to_id as number,
        origin:           missionRef,
        client_order_ref: mission.dossier_number || mission.external_id || undefined,
        fleet_vehicle_id: fleetVehicleId,
        sections,
        description:      buildInterventionDescription(mission as any),
      }
      // Facture directe (account.move brouillon) — véhicule + réf inclus.
      // Brouillon existant → on remplace ses lignes ; sinon on en crée une.
      if (mode === 'invoice') {
        return invoiceUpdateId
          ? await updateDraftInvoice(invoiceUpdateId, commonInput)
          : await createDraftInvoice(commonInput)
      }
      // Devis (sale.order) — création/mise à jour idempotente.
      if (mission.odoo_quote_id) {
        try {
          return await updateSaleOrder(mission.odoo_quote_id, commonInput)
        } catch (e: any) {
          if (e instanceof QuoteNotFoundError) {
            console.warn(`[quote] Devis ${mission.odoo_quote_id} introuvable, recreate from scratch`)
            return await createSaleOrder(commonInput)
          }
          throw e
        }
      }
      return await createSaleOrder(commonInput)
    })
  } catch (e: any) {
    console.error(`[quote] Odoo push failed (mode=${mode}):`, e.message)
    return NextResponse.json({ error: `Erreur Odoo : ${e.message}` }, { status: 500 })
  }

  // 5) Persiste la trace cote VD Soft (selon le mode).
  const nowIso = new Date().toISOString()
  const traceUpd: Record<string, any> = mode === 'invoice'
    ? { invoice_odoo_id: result.id }   // lu par /invoices → récup auto du n° au « Facturation OK »
    : { odoo_quote_id: result.id, odoo_quote_url: result.url, odoo_quoted_at: nowIso }
  // Attribution (stats couverture) : cron = auto ; humain = user (Jona…).
  traceUpd.invoice_created_at = nowIso
  if (isInternal) traceUpd.auto_invoiced = true
  else { traceUpd.auto_invoiced = false; traceUpd.invoice_created_by = (user as any)?.id || null }
  const { error: updErr } = await sb.from('incoming_missions').update(traceUpd).eq('id', mission.id)

  if (updErr) {
    console.error(`[quote] update mission failed (mode=${mode}):`, updErr.message)
    // On a deja cree l'objet Odoo, on retourne quand meme l info
  }

  // 5b) Chatter Odoo : mode de paiement + date + user qui a encaissé (VD Soft).
  //     Depuis interventions (encaissement chauffeur) ; fallback payment_method.
  try {
    const { data: encs } = await sb.from('interventions')
      .select('payment_mode, amount, driver_id, created_at')
      .eq('mission_id', mission.id)
      .order('created_at', { ascending: true })
    const drvIds = [...new Set((encs || []).map((e: any) => e.driver_id).filter(Boolean))]
    const { data: us } = drvIds.length
      ? await sb.from('users').select('id, name').in('id', drvIds)
      : { data: [] as any[] }
    const nameById = new Map((us || []).map((u: any) => [u.id, u.name]))
    const PM: Record<string, string> = {
      cash: 'Espèces', bancontact: 'Bancontact', sumup: 'Sumup', terminal: 'Sumup Terminal',
      qr: 'QR Code', qr_transfer: 'QR virement', tap: 'Tap to Pay', sumup_manual: 'Sumup',
      email: 'Lien email', unpaid: 'Non payé', a_verifier: 'À vérifier',
    }
    const fmtDT = (iso: string | null) => {
      if (!iso) return '—'
      try { return new Date(iso).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
      catch { return String(iso).slice(0, 16) }
    }
    let body: string
    if (encs && encs.length) {
      const items = encs.map((e: any) =>
        `<li><b>${PM[e.payment_mode] || e.payment_mode || '—'}</b> — ${Number(e.amount || 0).toFixed(2)} € · ${fmtDT(e.created_at)}${e.driver_id ? ` · encaissé par ${nameById.get(e.driver_id) || '—'}` : ''}</li>`
      ).join('')
      body = `<p>💳 <b>Paiement (VD Soft)</b></p><ul>${items}</ul>`
    } else {
      const pmLabel = (mission as any).payment_method ? (PM[(mission as any).payment_method] || (mission as any).payment_method) : '—'
      body = `<p>💳 <b>Paiement (VD Soft)</b> : ${pmLabel}${(mission as any).payment_method === 'unpaid' ? ' — à facturer' : ''}</p>`
    }
    const chatterModel = mode === 'invoice' ? 'account.move' : 'sale.order'
    await withOdooActor(user?.id, () => postChatterMessage(chatterModel, result.id, body))
  } catch (e: any) {
    console.error('[quote] chatter paiement KO:', e?.message)
  }

  // 6) Attach les PDF des avances de fonds liees au devis Odoo.
  //    Olivier 2026-06-01 : la facture d achat de chaque avance doit etre
  //    jointe au devis facturation final pour que la compta ait le PJ a portee
  //    de clic dans le sale.order. Best-effort : si une attache echoue, on log
  //    sans bloquer la creation du devis.
  let advancesAttached = 0
  const advanceAttachIds: string[] = []
  try {
    const { data: advances } = await sb
      .from('fund_advances')
      .select('id, invoice_url, plate, amount_htva')
      .eq('mission_id', mission.id)
      .not('invoice_url', 'is', null)

    for (const adv of (advances || [])) {
      if (!adv.invoice_url) continue
      try {
        const fileRes = await fetch(adv.invoice_url)
        if (!fileRes.ok) {
          console.error(`[quote] fetch invoice failed for advance ${adv.id}: HTTP ${fileRes.status}`)
          continue
        }
        const buffer      = await fileRes.arrayBuffer()
        const base64      = Buffer.from(buffer).toString('base64')
        const contentType = fileRes.headers.get('content-type') ?? 'image/jpeg'
        const ext         = contentType.includes('pdf') ? 'pdf' : 'jpg'
        const filename    = `avance-${adv.plate}-${Number(adv.amount_htva).toFixed(2)}.${ext}`
        await withOdooActor(user?.id, () => mode === 'invoice'
          ? attachFileToInvoice(result.id, base64, filename, contentType)
          : attachFileToOrder(result.id, base64, filename, contentType))
        advancesAttached++
        advanceAttachIds.push(adv.id)
      } catch (attachErr: any) {
        console.error(`[quote] attach advance ${adv.id} failed:`, attachErr?.message)
      }
    }

    // Log activite : attachement des avances au devis
    if (advancesAttached > 0) {
      await sb.from('activity_logs').insert({
        user_id:     user.id || null,
        action:      'advances_attached_to_quote',
        entity_type: 'incoming_mission',
        entity_id:   mission.id,
        details: {
          mission_ref:    missionRef,
          quote_id:       result.id,
          quote_url:      result.url,
          advance_ids:    advanceAttachIds,
          attached_count: advancesAttached,
        },
      })
    }
  } catch (e: any) {
    console.error('[quote] attach advances bloc failed:', e?.message)
  }

  return NextResponse.json({
    ok:    true,
    mode,
    // 'quote' → devis ; 'invoice' → facture directe (mêmes champs id/url).
    ...(mode === 'invoice'
      ? { invoice: { id: result.id, url: result.url } }
      : { quote:   { id: result.id, url: result.url } }),
    summary: {
      mission_ref:        missionRef,
      partner_id:         mission.billed_to_id,
      partner_name:       mission.billed_to_name,
      total_eur:          totalForResponse,
      lines_count:        lines.length,
      total_label:        fmtEur(totalForResponse),
      advances_attached:  advancesAttached,
    },
  })
}
