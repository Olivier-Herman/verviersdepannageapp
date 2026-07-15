// Résolution des documents Odoo (facture + note de crédit) d'une mission, pour
// l'espace garage. Le garage n'a pas d'accès Odoo : on résout les account.move
// via la clé API partagée de l'app, puis on proxifie le PDF (voir
// /api/garage/missions/[id]/document-pdf).
//
// Sources de factures d'une mission :
//   1. Le devis Odoo (sale.order.odoo_quote_id) → invoice_ids (inclut les avoirs
//      liés au bon de commande).
//   2. Fallback : incoming_missions.invoice_odoo_id (facture résolue par cron).
//
// On ne retient que les documents POSTÉS et numérotés (pas les brouillons).
// Olivier 2026-07-15.

import { odooRpc } from '@/lib/odoo'

export interface MoveRef { id: number; number: string | null }
export interface MissionDocs { invoice: MoveRef | null; creditNote: MoveRef | null }

export interface MissionDocInput {
  id:              string
  odoo_quote_id?:  number | null
  invoice_odoo_id?: number | null
}

const asRef = (mv: any): MoveRef => ({ id: mv.id, number: mv.name && mv.name !== '/' ? mv.name : null })

/**
 * Résout, en lots (2 appels Odoo max au total), la facture + l'avoir de chaque
 * mission. Best-effort : en cas d'erreur Odoo, renvoie une map vide (les cartes
 * s'affichent sans documents plutôt que de casser la liste).
 */
export async function resolveMissionDocsBatch(missions: MissionDocInput[]): Promise<Map<string, MissionDocs>> {
  const out = new Map<string, MissionDocs>()
  try {
    // 1) Devis → invoice_ids (un seul read pour tous les devis).
    const quoteIds = [...new Set(missions.map(m => m.odoo_quote_id).filter((x): x is number => !!x))]
    const quoteInvoices = new Map<number, number[]>()
    if (quoteIds.length) {
      const orders = await odooRpc<any[]>('sale.order', 'read', [quoteIds], { fields: ['id', 'invoice_ids'] })
      for (const o of (orders || [])) quoteInvoices.set(o.id, (o.invoice_ids || []).map(Number))
    }

    // 2) Tous les move_ids concernés → un seul read account.move.
    const moveIds = new Set<number>()
    for (const m of missions) {
      if (m.odoo_quote_id) (quoteInvoices.get(m.odoo_quote_id) || []).forEach(id => moveIds.add(id))
      if (m.invoice_odoo_id) moveIds.add(Number(m.invoice_odoo_id))
    }
    const moveById = new Map<number, any>()
    if (moveIds.size) {
      const moves = await odooRpc<any[]>('account.move', 'read', [[...moveIds]], { fields: ['id', 'name', 'move_type', 'state'] })
      for (const mv of (moves || [])) moveById.set(mv.id, mv)
    }

    // 3) Par mission : facture (out_invoice postée) + avoir (out_refund posté).
    for (const m of missions) {
      const relIds = new Set<number>()
      if (m.odoo_quote_id) (quoteInvoices.get(m.odoo_quote_id) || []).forEach(id => relIds.add(id))
      if (m.invoice_odoo_id) relIds.add(Number(m.invoice_odoo_id))
      const rel = [...relIds].map(id => moveById.get(id)).filter(Boolean)
      const inv = rel.find(mv => mv.move_type === 'out_invoice' && mv.state === 'posted' && mv.name && mv.name !== '/')
      const cn  = rel.find(mv => mv.move_type === 'out_refund'  && mv.state === 'posted' && mv.name && mv.name !== '/')
      out.set(m.id, { invoice: inv ? asRef(inv) : null, creditNote: cn ? asRef(cn) : null })
    }
  } catch (e: any) {
    console.error('[garage/mission-documents] résolution Odoo KO (non bloquant):', e?.message)
  }
  return out
}

/** Résout les documents d'une seule mission (proxy PDF). */
export async function resolveMissionDocs(mission: MissionDocInput): Promise<MissionDocs> {
  const map = await resolveMissionDocsBatch([mission])
  return map.get(mission.id) || { invoice: null, creditNote: null }
}
