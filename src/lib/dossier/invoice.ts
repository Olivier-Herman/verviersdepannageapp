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
import { createDraftInvoice, findFleetVehicleByPlate, type QuoteLine, type QuoteSection } from '@/lib/odoo-quote'
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
export async function invoiceDossierGroups(input: { anyMissionId: string; missionIds: string[]; actorUserId: string | null; dryRun?: boolean; periodTo?: Record<string, string> }): Promise<DossierInvoiceResult> {
  const sb = createAdminClient()
  const d = await buildDossier(input.anyMissionId)
  if (!d) throw new Error('Dossier introuvable')

  const wanted = new Set(input.missionIds)
  const legs = d.legs.filter(l => wanted.has(l.mission_id))
  if (!legs.length) throw new Error('Aucun groupe sélectionné')
  const missing = input.missionIds.filter(id => !d.legs.some(l => l.mission_id === id))
  if (missing.length) throw new Error('Un groupe sélectionné ne fait pas partie de ce dossier')

  const warnings: string[] = []
  const billable = legs.filter(l => {
    if (l.nothing_to_bill) { warnings.push(`${d.number}${l.letter} : rien à facturer (${l.nothing_to_bill})`); return false }
    if (l.billed_refs.length && l.billed_htva >= l.amount_htva - 0.01) { warnings.push(`${d.number}${l.letter} : déjà facturé (${l.billed_refs.join(', ')})`); return false }
    return true
  })
  if (!billable.length) throw new Error('Rien à facturer dans la sélection')
  const noClient = billable.filter(l => !l.billed_to_id)
  if (noClient.length) throw new Error(`Client de facturation à définir sur ${noClient.map(l => `${d.number}${l.letter}`).join(', ')}`)
  // Le Parquet (frais de justice) ne reçoit pas de facture Odoo : c'est un état
  // de frais bimensuel via JustInvoice / Peppol (module Saisie). On refuse ici
  // plutôt que de créer une facture qui ne partira jamais.
  const parquet = billable.filter(l => /parquet|frais de justice|fdj\b/i.test(String(l.billed_to_name || '')))
  if (parquet.length) throw new Error(`${parquet.map(l => `${d.number}${l.letter}`).join(', ')} : client Parquet — passe par l'état de frais du module Saisie, pas par une facture Odoo`)

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
        const chosen = !m.parc_exit_at && input.periodTo?.[leg.mission_id] ? brusselsMidnightAfter(input.periodTo[leg.mission_id]) : null
        if (chosen && (new Date(chosen).getTime() > Date.now() || new Date(chosen).getTime() <= new Date(from).getTime())) {
          throw new Error(`${d.number}${leg.letter} : la date de fin de gardiennage doit être entre l'entrée (${fmtDay(from)}) et aujourd'hui`)
        }
        const to   = m.parc_exit_at || chosen || nowIso
        // Jours facturables sur la période : nuits(entrée → fin) − jours gratuits du tarif
        // (déduits de ce que le dossier a déjà retiré sur la période complète).
        const rawAll  = nightsBetween(from, m.parc_exit_at || nowIso)
        const freeDays = Math.max(0, rawAll - (leg.days || 0))
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
        sections.push({ section_label: `${d.number}${leg.letter} — Gardiennage${m.parc_zone_key ? ' zone ' + m.parc_zone_key : ''}`, lines })
        perLeg.push({ leg, lines, period_from: from, period_to: to })
      } else {
        const { lines, has_tariff } = await actionLines(m, draftById[leg.mission_id], hasGardLegs)
        if (!has_tariff || !lines.length) { warnings.push(`${d.number}${leg.letter} : tarif introuvable, section à compléter dans Odoo`) }
        sections.push({ section_label: `${d.number}${leg.letter} — ${leg.title} — ${actionDescription(leg, m)}${has_tariff ? '' : ' (à compléter)'}`, lines })
        perLeg.push({ leg, lines, period_from: null, period_to: null })
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
    const created = await withOdooActor(input.actorUserId, () => createDraftInvoice({
      partner_id:       clientId,
      origin,
      client_order_ref: d.dossier_number || root?.external_id || undefined,
      fleet_vehicle_id: fleetVehicleId,
      sections,
      description:      buildInterventionDescription(root || {}),
    }))

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
        if (m.parc_origin_mission_id) {
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
