// src/lib/facturation/garantie.ts
//
// FACTURER UN DOSSIER COUVERT PAR UNE GARANTIE DE PAIEMENT (Olivier 04/11/2026, maquette
// https://claude.ai/artifact/8df26ViTihidGtRiuJmN2q validée).
//
// L'assistance garantit le remorquage jusqu'à un plafond TVAC ; le solde est à charge du client.
//   1. La part de l'assistance = min(groupes couverts, plafond) part sur SA facture : référence de
//      dossier de l'assistance, garantie jointe. Le gardiennage est couvert ou non selon la garantie
//      (« ça dépend » : case « gardiennage inclus »).
//   2. Cette part est inscrite au registre `mission_billed_items` (kind GARANTIE) des groupes
//      couverts : le dossier, la facture du client et la restitution ne voient plus que le SOLDE,
//      et la facture du client porte la ligne « Pris en charge par … » (lignesGarantie).
//   3. La sortie du parc reste bloquée tant que ce solde n'est pas payé : c'est la règle normale
//      de la restitution (le client paie ce qui reste dû).
// Une relivraison commandée ensuite par l'assistance est une autre prise en charge : jamais couverte.

import { buildDossier, invalidateDossierCache, type Dossier, type DossierLeg } from '@/lib/dossier/build'
import { createDraftInvoice, updateDraftInvoice, getInvoiceMove, type QuoteLine } from '@/lib/odoo-quote'
import { attachFileToInvoice, withOdooActor } from '@/lib/odoo'
import { resolveTargetPartner } from '@/lib/mail-agent/odoo'

const r2 = (n: number) => Math.round(n * 100) / 100
const BUCKET = 'mission-remarks'
export const GARANTIE_KIND = 'GARANTIE'

export type Garantie = {
  id: string; mission_id: string | null; assistance: string; dossier_ref: string | null; assistance_mission: string | null
  plate: string | null; amount_ttc: number | null; client_name: string | null; client_address: string | null; client_phone: string | null
  doc_path: string | null; gardiennage_inclus: boolean; assistance_vat: string | null; assistance_partner_id: number | null
  invoice_odoo_id: number | null; invoice_number: string | null; billed_htva: number | null; billed_at: string | null; created_at: string
}

export type PlanGarantie = {
  couvert_htva: number            // groupes couverts, au prix du dossier
  assistance_htva: number         // part de l'assistance (plafonnée)
  assistance_ttc: number
  client_htva: number             // ce qui reste au client sur tout le dossier (couvert − part + non couvert)
  client_ttc: number
  plafond_atteint: boolean
  parts: { mission_id: string; letter: string; kind: string; title: string; montant_htva: number; part_htva: number }[]
  hors_garantie: { letter: string; title: string; montant_htva: number; raison: string }[]
}

/** Garanties posées sur l'une des fiches du dossier. */
export async function garantiesDuDossier(sb: any, d: Dossier): Promise<Garantie[]> {
  const ids = d.legs.map(l => l.mission_id)
  if (!ids.length) return []
  const { data } = await sb.from('mission_guarantees').select('*').in('mission_id', ids).eq('status', 'placed').order('created_at')
  return (data || []) as Garantie[]
}

/** Groupes couverts : la fiche garantie (et ses actions hors relivraison) + le gardiennage si inclus. */
function couvert(g: Garantie, l: DossierLeg): { ok: boolean; raison: string } {
  if (l.kind === 'out') return { ok: false, raison: 'sortie' }
  if (l.kind === 'rel') return { ok: false, raison: 'relivraison : autre prise en charge' }
  if (l.kind === 'gard') return g.gardiennage_inclus ? { ok: true, raison: '' } : { ok: false, raison: 'gardiennage exclu : à charge du client' }
  if (l.mission_id !== g.mission_id) return { ok: false, raison: 'autre intervention' }
  return { ok: true, raison: '' }
}

export function planGarantie(d: Dossier, g: Garantie): PlanGarantie {
  const plafondHt = g.amount_ttc != null ? r2(Number(g.amount_ttc) / 1.21) : 0
  const parts: PlanGarantie['parts'] = []
  const hors: PlanGarantie['hors_garantie'] = []
  let reste = plafondHt, couvertHt = 0, autres = 0
  for (const l of d.legs) {
    const c = couvert(g, l)
    const montant = r2(l.amount_htva || 0)
    if (!c.ok) { if (l.kind !== 'out' && montant > 0 && c.raison !== 'relivraison : autre prise en charge') { hors.push({ letter: l.letter, title: l.title, montant_htva: montant, raison: c.raison }); autres += montant } continue }
    couvertHt += montant
    const part = r2(Math.min(montant, Math.max(0, reste)))
    reste = r2(reste - part)
    parts.push({ mission_id: l.mission_id, letter: l.letter, kind: l.kind, title: l.title, montant_htva: montant, part_htva: part })
  }
  const assistanceHt = r2(parts.reduce((s, p) => s + p.part_htva, 0))
  const clientHt = r2(couvertHt - assistanceHt + autres)
  return {
    couvert_htva: r2(couvertHt), assistance_htva: assistanceHt, assistance_ttc: r2(assistanceHt * 1.21),
    client_htva: clientHt, client_ttc: r2(clientHt * 1.21), plafond_atteint: couvertHt >= plafondHt - 0.01,
    parts, hors_garantie: hors,
  }
}

const jour = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('fr-BE', { timeZone: 'Europe/Brussels' }) : ''

/**
 * Crée (ou recalcule, tant qu'elle est en brouillon) la facture de la part de l'assistance et
 * l'inscrit au registre des groupes couverts. Une facture déjà validée n'est plus touchée.
 */
export async function facturerPartAssistance(sb: any, garantieId: string, actorUserId: string | null): Promise<{ ok: true; invoice_id: number; url: string; plan: PlanGarantie } | { ok: false; error: string }> {
  const { data: g } = await sb.from('mission_guarantees').select('*').eq('id', garantieId).maybeSingle() as { data: Garantie | null }
  if (!g?.mission_id) return { ok: false, error: 'Garantie introuvable ou pas encore placée sur une fiche' }
  if (g.amount_ttc == null || Number(g.amount_ttc) <= 0) return { ok: false, error: 'Montant garanti inconnu : complète-le d’abord' }
  const d = await buildDossier(g.mission_id, { cache: false })
  if (!d) return { ok: false, error: 'Dossier introuvable' }
  const plan = planGarantie(d, g)
  const parts = plan.parts.filter(p => p.part_htva > 0)
  if (!parts.length) return { ok: false, error: 'Rien à facturer à l’assistance : le tarif du remorquage n’est pas encore calculé' }

  // Payeur : l'entité désignée par la garantie (n° d'entreprise lu sur le document).
  let partnerId = g.assistance_partner_id
  if (!partnerId && g.assistance_vat) partnerId = (await resolveTargetPartner({ vat: g.assistance_vat, label: g.assistance }))?.id ?? null
  if (!partnerId) return { ok: false, error: `Client « ${g.assistance} » introuvable dans la comptabilité (n° d’entreprise ${g.assistance_vat || 'non lu'})` }

  if (g.invoice_odoo_id) {
    const mv = await getInvoiceMove(g.invoice_odoo_id).catch(() => null)
    if (mv && mv.state !== 'draft' && mv.state !== 'cancel') return { ok: false, error: 'Part de l’assistance déjà facturée et validée : on ne la modifie plus' }
  }

  const lignes: QuoteLine[] = parts.map(p => ({
    kind: (p.kind === 'gard' ? 'SERV-PARC' : 'SERV-PEC') as any,
    name: p.kind === 'gard'
      ? `Gardiennage du véhicule ${d.vehicle.plate || ''} — garantie de paiement, votre dossier ${g.dossier_ref || ''}`
      : `${p.kind === 'rem' ? 'Remorquage' : p.title} du ${jour(d.legs.find(l => l.mission_id === p.mission_id)?.started_at || null)} — véhicule ${d.vehicle.plate || ''} — garantie de paiement, votre dossier ${g.dossier_ref || ''}`,
    qty: 1, price_unit: p.part_htva,
  }))
  const input = {
    partner_id: partnerId,
    origin: `${d.number ?? d.ref} garantie`,
    client_order_ref: g.dossier_ref || undefined,
    sections: [{ section_label: `Garantie de paiement — plafond ${Number(g.amount_ttc).toFixed(2).replace('.', ',')} € TVAC${g.assistance_mission ? ` — mission ${g.assistance_mission}` : ''}`, lines: lignes }],
    description: `Dossier ${g.dossier_ref || ''} — ${d.vehicle.plate || ''}${g.client_name ? ` — assuré ${g.client_name}` : ''}`,
  }
  const reuse = g.invoice_odoo_id ? await getInvoiceMove(g.invoice_odoo_id).catch(() => null) : null
  const inv = await withOdooActor(actorUserId, () => reuse && reuse.state === 'draft' ? updateDraftInvoice(g.invoice_odoo_id!, input as any) : createDraftInvoice(input as any))
  if (!reuse && g.doc_path) {
    const { data: blob } = await sb.storage.from(BUCKET).download(g.doc_path)
    if (blob) await attachFileToInvoice(inv.id, Buffer.from(await blob.arrayBuffer()).toString('base64'), `Justificatif - Garantie de paiement ${g.dossier_ref || ''}.pdf`, 'application/pdf').catch(() => {})
  }

  // Registre : la part de l'assistance, groupe par groupe (remplace un calcul précédent).
  await sb.from('mission_billed_items').delete().eq('kind', GARANTIE_KIND).eq('invoice_odoo_id', inv.id)
  const now = new Date().toISOString()
  await sb.from('mission_billed_items').insert(parts.map(p => ({
    mission_id: p.mission_id, kind: GARANTIE_KIND, label: `Pris en charge par ${g.assistance} — garantie de paiement, dossier ${g.dossier_ref || ''}`,
    qty: 1, price_unit: p.part_htva, amount_htva: p.part_htva, invoice_odoo_id: inv.id, dossier_letter: p.letter,
    billed_by: actorUserId, billed_to_id: partnerId, billed_to_name: g.assistance,
  })))
  await sb.from('mission_guarantees').update({ assistance_partner_id: partnerId, invoice_odoo_id: inv.id, billed_htva: plan.assistance_htva, billed_at: now }).eq('id', g.id)
  await sb.from('mission_logs').insert({ mission_id: g.mission_id, actor_id: actorUserId, action: 'invoiced',
    notes: `Part de l’assistance facturée en brouillon : ${plan.assistance_ttc.toFixed(2).replace('.', ',')} € TVAC à ${g.assistance} (dossier ${g.dossier_ref || ''}). Reste au client : ${plan.client_ttc.toFixed(2).replace('.', ',')} € TVAC.`,
    metadata: { invoice_odoo_id: inv.id, garantie_id: g.id } })
  invalidateDossierCache(d.root_id)
  return { ok: true, invoice_id: inv.id, url: inv.url, plan }
}

/** Avant une restitution : la part de l'assistance doit être déduite, sinon le client paierait tout. */
export async function assurerPartsAssistance(sb: any, anyMissionId: string, actorUserId: string | null): Promise<void> {
  const d = await buildDossier(anyMissionId, { light: true })
  if (!d) return
  for (const g of await garantiesDuDossier(sb, d)) {
    if (g.invoice_odoo_id || g.amount_ttc == null) continue
    await facturerPartAssistance(sb, g.id, actorUserId).catch((e: any) => console.warn('[garantie] part assistance KO', e?.message))
  }
}

/** Lignes négatives à porter sur la facture du client : ce que l'assistance paie déjà. */
export async function lignesGarantie(sb: any, missionId: string): Promise<QuoteLine[]> {
  const { data } = await sb.from('mission_billed_items').select('label, amount_htva').eq('mission_id', missionId).eq('kind', GARANTIE_KIND)
  return (data || []).filter((b: any) => Number(b.amount_htva) > 0)
    .map((b: any) => ({ kind: 'SERV-DIV' as any, name: String(b.label), qty: 1, price_unit: -r2(Number(b.amount_htva)) }))
}
