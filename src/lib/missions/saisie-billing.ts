// src/lib/missions/saisie-billing.ts
//
// Calcul de facturation SAISIE (état de frais / facture) sur une PLAGE de dates,
// avec DÉCOUPAGE ANNUEL du gardiennage (tarif 2025 vs 2026…). Réutilise EXACTEMENT
// les mêmes grilles `source_tariff_lines` (source='police_saisie') que
// l'estimation de la fiche → chiffres identiques. Olivier 2026-08-09.
//
// Destinataires (Olivier) :
//   • parquet / domaine : dépannage + gardiennage, PAS de frais administratifs.
//   • client            : dépannage + gardiennage + frais administratifs (37,67 €).
//
// Le dépannage (PEC + km) n'est facturé qu'UNE fois (1er état de frais). Les états
// de frais suivants (cron bimestriel) = gardiennage seul sur la période écoulée.
//
// Convention gardiennage (identique à estimate-price.ts) : on ne compte JAMAIS le
// jour d'arrivée → chaque NUIT pleine est facturée, rattachée à l'année de sa date.

import { createAdminClient } from '@/lib/supabase'

const SOURCE = 'police_saisie'
const MISSION_TYPE = 'remorquage'   // les saisies sont des remorquages en parc

export type SaisieRecipient = 'parquet' | 'domaine' | 'client'

export interface SaisieBillingLine {
  kind: string          // SERV-PEC | SERV-KM | SERV-PARC | SERV-DIV
  name: string          // libellé affiché sur l'état de frais / la facture
  qty: number           // quantité (jours, km, 1…)
  unitPrice: number     // PU HTVA
  total: number         // qty × unitPrice (arrondi 2 déc.)
  period?: { from: string; to: string; year: number }  // sous-période gardiennage
}

export interface SaisieBillingInput {
  /** Début du gardiennage (parked_at, sinon received_at). Le jour même n'est pas compté. */
  parkedAt: string
  /** Fin de la période à facturer (date de coupe de cet état de frais, incluse). */
  billingTo: string
  /** Début de la période gardiennage à facturer (pour les états suivants = fin du précédent). Défaut = parkedAt. */
  billingFrom?: string | null
  /** Destinataire → conditionne les frais administratifs. */
  recipient: SaisieRecipient
  /** Inclure le dépannage (PEC + km) — vrai seulement sur le 1er état de frais. */
  includeDepannage: boolean
  /** car (défaut) | moto → sélectionne la bonne grille. */
  vehicleClass?: string | null
  /** km facturés (au-delà des 15 inclus) pour la ligne SERV-KM. 0 si inconnu. */
  chargedKmBeyond?: number | null
  /** Date de levée de saisie : après cette date, gardiennage « hors période saisie » 20 €/j. */
  leveeSaisieDate?: string | null
  /** Applique les prix majorés (week-end/nuit) sur PEC/KM (comme estimate-price). */
  majored?: boolean
}

export interface SaisieBillingResult {
  lines: SaisieBillingLine[]
  totalHtva: number
  totalTvac: number
  recipient: SaisieRecipient
}

interface TariffLine {
  position: number
  kind: string
  name: string
  default_qty: number | null
  default_price: number
  default_price_majore: number | null
  vehicle_class: string | null
  effective_from: string
  effective_to: string | null
}

const r2 = (n: number) => Math.round(n * 100) / 100
const dayStart = (iso: string) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d }

// Nuits pleines rattachées à leur année, entre deux dates (le jour de `from` n'est
// pas compté ; chaque nuit compte pour l'année de son jour de début).
function nightsByYear(from: string, to: string): Map<number, number> {
  const out = new Map<number, number>()
  const start = dayStart(from), end = dayStart(to)
  const cur = new Date(start)
  cur.setDate(cur.getDate() + 1)   // on ne compte pas le jour d'arrivée
  while (cur <= end) {
    const y = cur.getFullYear()
    out.set(y, (out.get(y) || 0) + 1)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

// Choisit la ligne tarifaire d'un kind, en vigueur pour une année donnée, pour le
// vehicle_class (ligne spécifique prioritaire sur la générique vehicle_class=null).
function pickLine(lines: TariffLine[], kind: string, year: number, vc: string): TariffLine | null {
  const jan1 = `${year}-01-01`, dec31 = `${year}-12-31`
  const cands = lines.filter(l =>
    l.kind === kind &&
    l.effective_from <= dec31 &&
    (!l.effective_to || l.effective_to >= jan1) &&
    (!l.vehicle_class || l.vehicle_class === vc),
  )
  // spécifique (vehicle_class non nul) prioritaire
  cands.sort((a, b) => (a.vehicle_class ? 0 : 1) - (b.vehicle_class ? 0 : 1))
  return cands[0] || null
}

/**
 * Calcule les lignes de facturation Saisie pour une plage de dates.
 * Réutilise les grilles police_saisie → montants identiques à la fiche.
 */
export async function computeSaisieBilling(input: SaisieBillingInput): Promise<SaisieBillingResult> {
  const sb = createAdminClient()
  const vc = (input.vehicleClass || 'car').toLowerCase()

  const { data: raw } = await sb
    .from('source_tariff_lines')
    .select('position, kind, name, default_qty, default_price, default_price_majore, vehicle_class, effective_from, effective_to')
    .eq('source', SOURCE)
    .eq('mission_type', MISSION_TYPE)
    .order('position', { ascending: true })
  const lines = (raw || []) as TariffLine[]

  const out: SaisieBillingLine[] = []
  const priceOf = (l: TariffLine) => (input.majored && l.default_price_majore != null ? l.default_price_majore : l.default_price)

  // ── Dépannage (1er état de frais uniquement) : PEC + km ──────────────────────
  if (input.includeDepannage) {
    const yPec = dayStart(input.parkedAt).getFullYear()
    const pec = pickLine(lines, 'SERV-PEC', yPec, vc)
    if (pec) out.push({ kind: 'SERV-PEC', name: pec.name, qty: 1, unitPrice: r2(priceOf(pec)), total: r2(priceOf(pec)) })
    const km = Number(input.chargedKmBeyond || 0)
    if (km > 0) {
      const kmLine = pickLine(lines, 'SERV-KM', yPec, vc)
      if (kmLine) out.push({ kind: 'SERV-KM', name: kmLine.name, qty: km, unitPrice: r2(priceOf(kmLine)), total: r2(km * priceOf(kmLine)) })
    }
  }

  // ── Gardiennage : nuits pleines de [from → to], découpées par année ──────────
  // La borne de fin « saisie » s'arrête à la levée de saisie si elle tombe avant.
  const gStart = input.billingFrom || input.parkedAt
  const saisieEnd = input.leveeSaisieDate && input.leveeSaisieDate < input.billingTo ? input.leveeSaisieDate : input.billingTo
  const nights = nightsByYear(gStart, saisieEnd)
  for (const [year, days] of [...nights.entries()].sort((a, b) => a[0] - b[0])) {
    if (days <= 0) continue
    const g = pickLine(lines, 'SERV-PARC', year, vc)   // « Gardiennage (par jour) »
    // la ligne générique 20 €/j (hors saisie) porte aussi kind SERV-PARC ; on veut
    // la ligne saisie spécifique au vehicle_class → pickLine la prend en priorité.
    if (!g) continue
    const from = year === [...nights.keys()].sort()[0] ? gStart : `${year}-01-01`
    const to   = `${year}-12-31` < saisieEnd ? `${year}-12-31` : saisieEnd
    out.push({
      kind: 'SERV-PARC', name: g.name, qty: days, unitPrice: r2(g.default_price), total: r2(days * g.default_price),
      period: { from: from.slice(0, 10), to: to.slice(0, 10), year },
    })
  }

  // ── Gardiennage hors période saisie (après levée) : 20 €/j ───────────────────
  if (input.leveeSaisieDate && input.leveeSaisieDate < input.billingTo) {
    const horsNights = nightsByYear(input.leveeSaisieDate, input.billingTo)
    const totalHors = [...horsNights.values()].reduce((s, d) => s + d, 0)
    if (totalHors > 0) {
      const horsLine = lines.find(l => l.kind === 'SERV-PARC' && /hors p[ée]riode/i.test(l.name))
      const pu = horsLine ? horsLine.default_price : 20
      out.push({ kind: 'SERV-PARC', name: horsLine?.name || 'Gardiennage hors période saisie (par jour)', qty: totalHors, unitPrice: r2(pu), total: r2(totalHors * pu) })
    }
  }

  // ── Frais administratifs : CLIENT uniquement ────────────────────────────────
  if (input.recipient === 'client') {
    const yAdm = dayStart(input.billingTo).getFullYear()
    const adm = pickLine(lines, 'SERV-DIV', yAdm, vc)
    if (adm) out.push({ kind: 'SERV-DIV', name: adm.name, qty: 1, unitPrice: r2(adm.default_price), total: r2(adm.default_price) })
  }

  const totalHtva = r2(out.reduce((s, l) => s + l.total, 0))
  return { lines: out, totalHtva, totalTvac: r2(totalHtva * 1.21), recipient: input.recipient }
}
