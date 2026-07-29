// src/lib/circuit/invoice.ts
//
// Facture auto d'un devis Circuit (Spa-Francorchamps) déjà CONFIRMÉ (sale.order
// state='sale'), une fois que TOUTES ses prestations sont passées.
//   1. Crée la facture via le wizard public sale.advance.payment.inv
//      (la méthode privée _create_invoices est bloquée en RPC).
//   2. La comptabilise (action_post) = confirmée.
// PAS d'envoi : l'équipe facturation enverra depuis Odoo. Olivier 2026-07-29.

import { odooRpc } from '@/lib/odoo'

export interface CircuitInvoiceResult {
  ok: boolean
  invoiceId?: number
  invoiceNumber?: string | null
  posted?: boolean
  error?: string
}

export async function invoiceCircuitOrder(orderId: number): Promise<CircuitInvoiceResult> {
  try {
    // Sécurité : le devis doit être confirmé et pas déjà entièrement facturé.
    const so = (await odooRpc<any[]>('sale.order', 'read', [[orderId]], { fields: ['state', 'invoice_status', 'invoice_ids'] }))?.[0]
    if (!so) return { ok: false, error: `sale.order ${orderId} introuvable` }
    if (so.state === 'cancel') return { ok: false, error: 'devis annulé' }

    let invoiceIds: number[] = (so.invoice_ids || []).map(Number)

    // 1) Crée la facture si pas déjà présente (wizard public "Créer une facture").
    if (!invoiceIds.length) {
      const ctx = { active_model: 'sale.order', active_ids: [orderId], active_id: orderId }
      const wizId = await odooRpc<number>('sale.advance.payment.inv', 'create',
        [{ advance_payment_method: 'delivered' }], { context: ctx })
      await odooRpc('sale.advance.payment.inv', 'create_invoices', [[wizId]], { context: ctx })
      const so2 = (await odooRpc<any[]>('sale.order', 'read', [[orderId]], { fields: ['invoice_ids'] }))?.[0]
      invoiceIds = (so2?.invoice_ids || []).map(Number)
    }
    if (!invoiceIds.length) return { ok: false, error: 'aucune facture créée par le wizard' }

    // Facture cliente la plus récente.
    const moves = await odooRpc<any[]>('account.move', 'read', [invoiceIds], { fields: ['id', 'state', 'name', 'move_type'] })
    const inv = (moves || []).filter(m => m.move_type === 'out_invoice' && m.state !== 'cancel').sort((a, b) => b.id - a.id)[0]
    if (!inv) return { ok: false, error: 'facture out_invoice introuvable' }

    // 2) Comptabilise (post) si brouillon = facture confirmée. PAS d'envoi
    //    (l'équipe facturation fait un envoi de masse depuis Odoo).
    if (inv.state === 'draft') await odooRpc('account.move', 'action_post', [[inv.id]])

    const after = (await odooRpc<any[]>('account.move', 'read', [[inv.id]], { fields: ['name', 'state'] }))?.[0]
    return { ok: true, invoiceId: inv.id, invoiceNumber: after?.name || inv.name || null, posted: after?.state === 'posted' }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 250) }
  }
}
