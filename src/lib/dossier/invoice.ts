// src/lib/dossier/invoice.ts
//
// Facturation PAR DOSSIER (Olivier 07/09/2026) : on coche des groupes (lettres)
// et l'app crée DIRECTEMENT les factures Odoo en brouillon — une par client de
// facturation — sans passer par un devis. Tout coché = facture totale, sinon
// facture partielle. Référence de la facture = numéro du dossier + lettres
// couvertes (« 10114107 A B E »), une section Odoo par groupe.
//
// Chaque groupe garde la facture qui le couvre (mission_billed_items +
// invoice_odoo_id sur la fiche) ; le numéro définitif arrive par le cron
// verify-invoices quand Odoo poste le brouillon.
//
// Gardiennage en cours coché : la période s'arrête à maintenant (parc_exit_at,
// motif 'facturation') et un nouveau groupe s'ouvre sur la période suivante.

import { nightsBetween, brusselsMidnightAfter } from '@/lib/parc/nights'
import { createAdminClient }        from '@/lib/supabase'
import { buildDossier, type Dossier, type DossierLeg } from '@/lib/dossier/build'
import { buildInterventionDescription } from '@/lib/missions/build-quote-lines'
import { actionLines }              from '@/lib/dossier/lines'
import { createDraftInvoice, createSaleOrder, findFleetVehicleByPlate, type QuoteLine, type QuoteSection } from '@/lib/odoo-quote'
import { withOdooActor, attachFileToInvoice } from '@/lib/odoo'

export interface DossierInvoiceResult {
  invoices: { odoo_id: number; url: string; client_id: number; client_name: string; covers: string[]; total_htva: number; sections?: QuoteSection[] }[]
  warnings: string[]
  dry_run?: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const fmtDay = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : '?'

function actionDescription(leg: DossierLeg, m: any): string {
  const lieu = m.incident_address || "lieu d'intervention"
  const dest = m.destination_address || m.destination_name || 'lieu de destination'
  if (leg.kind === 'rel') return `Relivraison d'un véhicule dont référence ci-dessus de notre dépôt vers "${dest}"`
  const t = String(m.mission_type || '').toLowerCase()
  if (/d[ée]pannage|reparation|trajet_vide|dsp/.test(t)) return `Dépannage d'un véhicule dont référence ci-dessus à "${lieu}"`
  if (/dpr/.test(t)) return "Déplacement protocolaire d'un véhicule dont référence ci-dessus"
  return m.parked_at || !m.destination_address
    ? `Remorquage d'un véhicule dont référence ci-dessus de "${lieu}" à notre dépôt`
    : `Remorquage d'un véhicule dont référence ci-dessus de "${lieu}" à "${dest}"`
}

// periodTo : pour un gardiennage EN COURS, dernier jour facturé (YYYY-MM-DD,
// inclus) choisi dans la modale ; la période suivante s'ouvre le lendemain à
// minuit (Olivier 08/09/2026 : « on facture du 27/08 au 04/09, un nouveau
// groupe se crée pour la période 05/09 à … »). Absent = jusqu'à maintenant.
// linesOverride : lignes vérifiées/modifiées dans la modale (D1, audit 08/09/2026),
// par fiche ; elles remplacent le calcul et sont purgées des brouillons après envoi.
// asQuote (D11) : un DEVIS Odoo (sale.order) par client au lieu d'une facture ;
// rien n'est marqué facturé, on ne coupe pas le gardiennage, odoo_quote_id est
// posé sur les fiches. La facture partira ensuite d'Odoo ou du dossier.
export async function invoiceDossierGroups(input: { anyMissionId: string; missionIds: string[]; actorUserId: string | null; dryRun?: boolean; periodTo?: Record<string, string>; linesOverride?: Record<string, QuoteLine[]>; asQuote?: boolean }): Promise<DossierInvoiceResult> {
  const sb = createAdminClient()
  const d = await buildDossier(input.anyMissionId)
  if (!d) throw new Error('Dossier introuvable')
  // D7 : un seul « Facturer » à la fois par dossier (double clic, deux utilisateurs).
  if (!input.dryRun) {
    const { data: got, error: lockErr } = await sb.rpc('dossier_lock_acquire', { p_root: d.root_id, p_by: input.actorUserId, p_ttl_seconds: 90 })
    if (lockErr) console.warn('[dossier/invoice] verrou indisponible :', lockErr.message)
    else if (got === false) throw new Error('Une facturation est déjà en cours sur ce dossier (autre onglet ou autre utilisateur) : attends quelques secondes puis recharge.')
  }
  try {
    return await invoiceDossierGroupsLocked(sb, d, input)
  } finally {
    if (!input.dryRun) await sb.rpc('dossier_lock_release', { p_root: d.root_id }).then(() => {}, () => {})
  }
}

async function invoiceDossierGroupsLocked(sb: any, d: Dossier, input: { anyMissionId: string; missionIds: string[]; actorUserId: string | null; dryRun?: boolean; periodTo?: Record<string, string>; linesOverride?: Record<string, QuoteLine[]>; asQuote?: boolean }): Promise<DossierInvoiceResult> {
  const cleanLines = (raw: any[]): QuoteLine[] => raw.map((l: any) => ({ kind: (['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV'].includes(l.kind) ? l.kind : 'SERV-DIV') as any, name: String(l.name || '').trim(), qty: Number(l.qty || 0), price_unit: Number(l.price_unit || 0) })).filter(l => l.name && l.qty > 0)
  const override = (id: string): QuoteLine[] | null => input.linesOverride && Array.isArray(input.linesOverride[id]) ? cleanLines(input.linesOverride[id]) : null

  const wanted = new Set(input.missionIds)
  const legs = d.legs.filter(l => wanted.has(l.mission_id))
  if (!legs.length) throw new Error('Aucun groupe sélectionné')
  const missing = input.missionIds.filter(id => !d.legs.some(l => l.mission_id === id))
  if (missing.length) throw new Error('Un groupe sélectionné ne fait pas partie de ce dossier')

  const warnings: string[] = []
  const billable = legs.filter(l => {
    if (l.nothing_to_bill) { warnings.push(`${d.number ?? d.ref}${l.letter} : rien à facturer (${l.nothing_to_bill})`); return false }
    // D9 : jamais de facture sans ligne pour un groupe dont le tarif n'est pas calculable.
    if (l.amount_unknown) { warnings.push(`${d.number ?? d.ref}${l.letter} : tarif non calculable (${l.amount_note || 'à vérifier sur la fiche'}) — groupe non facturé`); return false }
    // Parquet : état de frais, jamais Odoo — on écarte ce groupe sans bloquer les autres clients.
    if ((l.channel || 'odoo') === 'parquet' || /parquet|frais de justice|fdj\b/i.test(String(l.billed_to_name || ''))) { warnings.push(`${d.number ?? d.ref}${l.letter} : Parquet — passe par l'état de frais du module Saisie`); return false }
    // D10 : intervention autoroute Siabis dont la tarification (couvert / non couvert) n'est pas tranchée.
    if ((l.alerts || []).some(a => /Siabis autoroute/i.test(a))) { warnings.push(`${d.number ?? d.ref}${l.letter} : Siabis autoroute non tranché — décide couvert / non couvert sur la fiche avant de facturer`); return false }
    if (l.billed_refs.length && l.billed_htva >= l.amount_htva - 0.01) { warnings.push(`${d.number}${l.letter} : déjà facturé (${l.billed_refs.join(', ')})`); return false }
    return true
  })
  if (!billable.length) throw new Error('Rien à facturer dans la sélection')
  const noClient = billable.filter(l => !l.billed_to_id)
  if (noClient.length) throw new Error(`Client de facturation à définir sur ${noClient.map(l => `${d.number}${l.letter}`).join(', ')}`)

  // Lignes de la fiche (pour l'estimation) + brouillons persistants.
  const ids = billable.map(l => l.mission_id)
  const [{ data: rows }, { data: drafts }] = await Promise.all([
    sb.from('incoming_missions').select('*').in('id', ids),
    sb.from('mission_invoice_drafts').select('mission_id, lines').in('mission_id', ids),
  ])
  const rowById: Record<string, any> = {}; for (const r of rows || []) rowById[r.id] = r
  const draftById: Record<string, any[]> = {}; for (const dr of drafts || []) if (Array.isArray(dr.lines) && dr.lines.length) draftById[dr.mission_id] = dr.lines
  const hasGardLegs = d.legs.some(l => l.kind === 'gard')
  const root = rowById[d.root_id] || (await sb.from('incoming_missions').select('*').eq('id', d.root_id).maybeSingle()).data

  // Groupes par client → une facture chacun.
  const byClient = new Map<number, DossierLeg[]>()
  for (const l of billable) { const k = Number(l.billed_to_id); (byClient.get(k) || byClient.set(k, []).get(k)!).push(l) }

  const nowIso = new Date().toISOString()
  const result: DossierInvoiceResult = { invoices: [], warnings, dry_run: !!input.dryRun }
  const fleetVehicleId = root?.vehicle_plate
    ? await withOdooActor(input.actorUserId, () => findFleetVehicleByPlate(root.vehicle_plate)).catch(() => null)
    : null

  for (const [clientId, group] of byClient) {
    const sections: QuoteSection[] = []
    const perLeg: { leg: DossierLeg; lines: QuoteLine[]; period_from: string | null; period_to: string | null }[] = []
    for (const leg of group) {
      const m = rowById[leg.mission_id]
      if (leg.kind === 'gard') {
        const from = m.parked_at || m.received_at
        // Fin de période : sortie réelle, sinon la date choisie (minuit belge du lendemain), sinon maintenant.
        // « jusqu'au JJ inclus » = minuit suivant JJ ; si JJ est aujourd'hui, la nuit n'est pas
        // encore passée → on coupe MAINTENANT (audit 08/09 : la date du jour faisait échouer).
        let chosen: string | null = null
        if (!m.parc_exit_at && input.periodTo?.[leg.mission_id]) {
          const midnight = brusselsMidnightAfter(input.periodTo[leg.mission_id])
          chosen = new Date(midnight).getTime() > Date.now() ? nowIso : midnight
          if (new Date(chosen).getTime() <= new Date(from).getTime()) throw new Error(`${d.number ?? d.ref}${leg.letter} : la date de fin de gardiennage doit être après l'entrée (${fmtDay(from)})`)
        }
        const to   = m.parc_exit_at || chosen || nowIso
        // Jours facturables sur la période : nuits(entrée → fin) − jours gratuits du tarif
        // (déduits de ce que le dossier a déjà retiré sur la période complète).
        // Jours gratuits = ceux du tarif (leg.free_days), pas une différence qui se trompe quand la période est bornée par le Domaine.
        const freeDays = leg.free_days ?? Math.max(0, nightsBetween(from, m.parc_exit_at || nowIso) - (leg.days || 0))
        const days = chosen ? Math.max(0, nightsBetween(from, to) - freeDays) : (leg.days || 0)
        const lines: QuoteLine[] = []
        if (Number(m.storage_flat_htva) > 0 && !m.storage_waived) {
          lines.push({ kind: 'SERV-PARC', name: `Forfait gardiennage — zone ${m.parc_zone_key || '?'} du ${fmtDay(from)} au ${fmtDay(to)}`, qty: 1, price_unit: r2(Number(m.storage_flat_htva)) })
        } else if (days > 0 && leg.amount_htva > 0 && (leg.days || 0) > 0) {
          const pu = r2(leg.amount_htva / (leg.days as number))
          lines.push({ kind: 'SERV-PARC', name: `Gardiennage (${leg.regime}) — zone ${m.parc_zone_key || '?'} du ${fmtDay(from)} au ${fmtDay(new Date(new Date(to).getTime() - 1000).toISOString())} : ${days} jour${days > 1 ? 's' : ''}`, qty: days, price_unit: pu })
        } else {
          warnings.push(`${d.number}${leg.letter} : 0 jour facturable, groupe ignoré`); continue
        }
        const ov = override(leg.mission_id); const finalLines = ov ?? lines
        sections.push({ section_label: `${d.number}${leg.letter} — Gardiennage${m.parc_zone_key ? ' zone ' + m.parc_zone_key : ''}`, lines: finalLines, mission_id: leg.mission_id })
        perLeg.push({ leg, lines: finalLines, period_from: from, period_to: to })
      } else {
        const ov = override(leg.mission_id)
        const { lines: calc, has_tariff: calcOk } = ov ? { lines: ov, has_tariff: true } : await actionLines(m, draftById[leg.mission_id], hasGardLegs)
        const lines = calc, has_tariff = calcOk
        if (!has_tariff || !lines.length) { warnings.push(`${d.number}${leg.letter} : tarif introuvable, section à compléter dans Odoo`) }
        sections.push({ section_label: `${d.number}${leg.letter} — ${leg.title} — ${actionDescription(leg, m)}${has_tariff ? '' : ' (à compléter)'}`, lines, mission_id: leg.mission_id })
        perLeg.push({ leg, lines, period_from: null, period_to: null })
      }
    }
    // Gardiennage à 0 nuit facturable, même client, pas encore couvert : ligne à
    // 0 € sur la facture pour qu'il soit « facturé » avec le dossier (Olivier
    // 08/09/2026 : « inclure la ligne gardiennage sur la facture à 0 »).
    if (perLeg.length) {
      for (const z of d.legs) {
        if (z.kind === 'out' || z.open || (z.channel || 'odoo') !== 'odoo' || Number(z.billed_to_id) !== clientId || z.billed_refs.length || perLeg.some(p => p.leg.mission_id === z.mission_id)) continue
        const zeroGard = z.kind === 'gard' && /aucune nuit/i.test(String(z.nothing_to_bill || ''))
        const zeroFiche = z.kind !== 'gard' && !z.nothing_to_bill && !z.amount_unknown && z.amount_htva === 0   // ex. relivraison avortée, 0 km
        if (!zeroGard && !zeroFiche) continue
        const zr = rowById[z.mission_id] || (await sb.from('incoming_missions').select('*').eq('id', z.mission_id).maybeSingle()).data
        if (!zr) continue
        rowById[z.mission_id] = zr
        const zf = zr.parked_at || zr.received_at, zt = zr.parc_exit_at || nowIso
        const zl: QuoteLine[] = z.kind === 'gard'
          ? [{ kind: 'SERV-PARC', name: `Gardiennage (${z.regime}) — zone ${zr.parc_zone_key || '?'} du ${fmtDay(zf)} au ${fmtDay(zt)} : ${z.nothing_to_bill}`, qty: 1, price_unit: 0 }]
          : [{ kind: 'SERV-PEC', name: `${z.title} — ${z.amount_note || 'rien à facturer (0 km)'}`, qty: 1, price_unit: 0 }]
        sections.push({ section_label: z.kind === 'gard' ? `${d.number}${z.letter} — Gardiennage${zr.parc_zone_key ? ' zone ' + zr.parc_zone_key : ''}` : `${d.number}${z.letter} — ${z.title} — 0 €`, lines: zl, mission_id: z.mission_id })
        perLeg.push({ leg: z, lines: zl, period_from: z.kind === 'gard' ? zf : null, period_to: z.kind === 'gard' ? zt : null })
      }
    }
    if (!perLeg.length) continue
    const covers = perLeg.map(p => p.leg.letter)
    const origin = `${d.number ?? d.ref} ${covers.join(' ')}`
    const clientName = group[0].billed_to_name || ''

    if (input.dryRun) {
      result.invoices.push({ odoo_id: 0, url: '', client_id: clientId, client_name: clientName, covers, sections,
        total_htva: r2(perLeg.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.qty * l.price_unit, 0), 0)) })
      continue
    }
    const created = await withOdooActor(input.actorUserId, () => (input.asQuote ? createSaleOrder : createDraftInvoice)({
      partner_id:       clientId,
      origin,
      client_order_ref: d.dossier_number || root?.external_id || undefined,
      fleet_vehicle_id: fleetVehicleId,
      sections,
      description:      buildInterventionDescription(root || {}),
    }))

    if (input.asQuote) {
      // Devis : trace sur les fiches + log, rien d'autre (pas de poste facturé, pas de coupe de gardiennage).
      for (const p of perLeg) {
        await sb.from('incoming_missions').update({ odoo_quote_id: created.id, odoo_quote_url: created.url, odoo_quoted_at: nowIso, updated_at: nowIso }).eq('id', p.leg.mission_id)
        await sb.from('mission_logs').insert({ mission_id: p.leg.mission_id, actor_id: input.actorUserId, action: 'dossier_quote', notes: `Devis Odoo créé depuis le dossier ${d.ref} (${origin}) → ${clientName}`, metadata: { odoo_quote_id: created.id, url: created.url, covers, client_id: clientId } }).then(() => {}, () => {})
      }
      result.invoices.push({ odoo_id: created.id, url: created.url, client_id: clientId, client_name: clientName, covers, sections, total_htva: r2(perLeg.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.qty * l.price_unit, 0), 0)) })
      continue
    }
    // D1 : les brouillons de lignes des fiches facturées sont purgés (comme le module classique).
    await sb.from('mission_invoice_drafts').delete().in('mission_id', perLeg.map(p => p.leg.mission_id)).then(() => {}, () => {})
    // D6 (audit 08/09/2026) : mêmes pièces et même chatter que le module classique.
    try {
      const realRows = perLeg.filter(p => p.leg.kind !== 'gard').map(p => rowById[p.leg.mission_id]).filter(Boolean)
      // Grille officielle (Siabis, saisie) : seulement si TOUTES les fiches de la facture y ont droit.
      const { grilleAJoindre, lireGrilleBase64, nomFichier } = await import('@/lib/tarifs/grille-officielle')
      const grilles = realRows.map(r => grilleAJoindre(r as any))
      if (realRows.length && grilles.every(Boolean)) {
        const g = grilles[0]!
        const b64 = await lireGrilleBase64(g)
        if (b64) { const { attachToOdoo } = await import('@/lib/odoo-attachment'); await attachToOdoo({ resModel: 'account.move', resId: created.id, filename: nomFichier(g), base64Data: b64, description: g.mention }) }
      }
      // Chatter : paiements encaissés sur place (mode, montant, date, chauffeur).
      const { postChatterMessage } = await import('@/lib/odoo')
      const PM: Record<string, string> = { cash: 'Espèces', bancontact: 'Bancontact', sumup: 'Sumup', terminal: 'Sumup Terminal', qr: 'QR Code', qr_transfer: 'QR virement', tap: 'Tap to Pay', sumup_manual: 'Sumup', email: 'Lien email', unpaid: 'Non payé', a_verifier: 'À vérifier' }
      const pays = perLeg.flatMap(p => (p.leg.payments || []).map(pz => `<li><b>${PM[String(pz.mode || '')] || pz.mode || '—'}</b> — ${Number(pz.amount || 0).toFixed(2)} € · ${pz.at ? new Date(pz.at).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' }) : '—'}${pz.driver ? ` · encaissé par ${pz.driver}` : ''} · groupe ${p.leg.letter}</li>`))
      await postChatterMessage('account.move', created.id, pays.length ? `<p>💳 <b>Paiement (VD Soft)</b></p><ul>${pays.join('')}</ul>` : `<p>💳 <b>Paiement (VD Soft)</b> : aucun encaissement sur place enregistré.</p>`)
      // PDF de mission → helpdesk + véhicule Odoo (jamais sur la facture : l'export comptable prendrait le rapport).
      const { attachMissionPdf } = await import('@/lib/missions/attach-mission-pdf')
      for (const r of realRows) attachMissionPdf(r.id, { targets: ['helpdesk', 'vehicle'] }).catch((e: any) => console.warn('[dossier/invoice] PDF mission KO (non bloquant):', e?.message))
    } catch (e: any) { console.warn('[dossier/invoice] pièces / chatter KO (non bloquant):', e?.message) }

    // Justificatifs des avances de fonds joints à la facture (best-effort,
    // comme la route /quote).
    try {
      const { data: advs } = await sb.from('fund_advances').select('id, invoice_url, plate, amount_htva')
        .in('mission_id', perLeg.map(p => p.leg.mission_id)).not('invoice_url', 'is', null)
      for (const adv of advs || []) {
        try {
          const fileRes = await fetch((adv as any).invoice_url); if (!fileRes.ok) continue
          const base64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64')
          const contentType = fileRes.headers.get('content-type') ?? 'image/jpeg'
          const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg'
          await withOdooActor(input.actorUserId, () => attachFileToInvoice(created.id, base64, `Justificatif avance ${(adv as any).plate} ${Number((adv as any).amount_htva).toFixed(2)}€.${ext}`, contentType))
        } catch (e: any) { console.error('[dossier/invoice] justificatif avance KO:', e?.message) }
      }
    } catch {}

    // Trace par groupe : postes facturés + facture Odoo sur chaque fiche couverte.
    const items = perLeg.flatMap(p => p.lines.map(l => ({
      mission_id: p.leg.mission_id, kind: l.kind, label: l.name, qty: l.qty, price_unit: l.price_unit,
      amount_htva: r2(l.qty * l.price_unit), period_from: p.period_from, period_to: p.period_to,
      invoice_odoo_id: created.id, dossier_letter: p.leg.letter,
      billed_by: input.actorUserId, billed_to_id: clientId, billed_to_name: clientName || null,
    })))
    if (items.length) {
      const { error: insErr } = await sb.from('mission_billed_items').insert(items)
      if (insErr) console.error('[dossier/invoice] billed_items KO:', insErr.message)
    }
    for (const p of perLeg) {
      const m = rowById[p.leg.mission_id]
      const upd: Record<string, any> = { invoice_created_at: nowIso, updated_at: nowIso }
      if (!m.invoice_odoo_id) upd.invoice_odoo_id = created.id
      if (!m.invoice_method) upd.invoice_method = 'dossier'   // D14 : facture issue du dossier (la vérification Odoo ne clôture la fiche que si tout est couvert)
      await sb.from('incoming_missions').update(upd).eq('id', p.leg.mission_id)
      await sb.from('mission_logs').insert({
        mission_id: p.leg.mission_id, actor_id: input.actorUserId, action: 'dossier_invoice',
        notes: `Facture Odoo brouillon créée depuis le dossier ${d.ref} (${origin}) → ${clientName}`,
        metadata: { invoice_odoo_id: created.id, url: created.url, covers, client_id: clientId },
      }).then(() => {}, () => {})
      // Gardiennage en cours : la période s'arrête ici, une nouvelle s'ouvre.
      if (p.leg.kind === 'gard' && !m.parc_exit_at) {
        const cutIso = p.period_to || nowIso   // fin choisie (minuit belge) ou maintenant
        await sb.from('incoming_missions').update({ parc_exit_at: cutIso, parc_exit_reason: 'facturation', updated_at: nowIso }).eq('id', p.leg.mission_id)
        // On ne rouvre une période que si le véhicule est encore au parc (la RPC le vérifie aussi).
        const { data: origin } = m.parc_origin_mission_id ? await sb.from('incoming_missions').select('status').eq('id', m.parc_origin_mission_id).maybeSingle() : { data: null }
        if (m.parc_origin_mission_id && origin?.status === 'parked') {
          const { error: rpcErr } = await sb.rpc('dossier_gardiennage_open', { p_mission_id: m.parc_origin_mission_id, p_from: cutIso })
          if (rpcErr) { console.error('[dossier/invoice] réouverture gardiennage KO:', rpcErr.message); warnings.push(`${d.number}${p.leg.letter} : période clôturée mais la suivante n'a pas pu s'ouvrir (${rpcErr.message})`) }
        }
      }
    }
    if (root?.id) {
      await sb.from('mission_logs').insert({
        mission_id: root.id, actor_id: input.actorUserId, action: 'dossier_invoice',
        notes: `Dossier ${d.ref} : facture Odoo brouillon ${origin} → ${clientName} (${covers.length} groupe${covers.length > 1 ? 's' : ''})`,
        metadata: { invoice_odoo_id: created.id, url: created.url, covers, client_id: clientId },
      }).then(() => {}, () => {})
    }
    result.invoices.push({
      odoo_id: created.id, url: created.url, client_id: clientId, client_name: clientName, covers,
      total_htva: r2(perLeg.reduce((s, p) => s + p.lines.reduce((t, l) => t + l.qty * l.price_unit, 0), 0)),
    })
  }
  if (!result.invoices.length) throw new Error(warnings.join(' · ') || 'Aucune facture créée')
  return result
}
