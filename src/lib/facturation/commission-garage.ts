// src/lib/facturation/commission-garage.ts — note de commission des garages (Olivier 14/10/2026).
//
// Aujourd'hui pour Car Avenue Star seulement (réglage `commission_garages`, « partenaire|% |depuis »).
// Règle : une fois la facture du garage envoyée, une note de crédit de X % part à son tour. Elle reprend
// les lignes de la facture (intervention, véhicule, trajet) à la quantité X/100 et n'est JAMAIS lettrée
// avec la facture : le lettrage se fait au paiement. Pas d'extourne (reversed_entry_id) pour ne rien
// lettrer d'office ; le lien passe par invoice_origin = n° de facture, qui sert aussi d'anti-doublon.
import { odooRpc } from '@/lib/odoo'
import { getBusinessList } from '@/lib/settings/business'

const r2 = (n: number) => Math.round(n * 100) / 100

export interface CommissionGarage { partnerId: number; pct: number; since: string }

export async function commissionGarages(): Promise<CommissionGarage[]> {
  const rows = await getBusinessList('commission_garages').catch(() => [] as string[])
  return rows.map(r => r.split('|').map(x => x.trim()))
    .map(([p, pct, since]) => ({ partnerId: Number(p), pct: Number(String(pct).replace(',', '.')), since: since || '2000-01-01' }))
    .filter(c => c.partnerId > 0 && c.pct > 0 && c.pct < 100)
}

/** Note de commission d'une facture envoyée ; renvoie son n° (ou celui de la note déjà faite). */
export async function noteCommission(invoiceId: number, pct: number): Promise<{ name: string; created: boolean; note: string }> {
  const [inv] = await odooRpc<any[]>('account.move', 'read', [[invoiceId]], { fields: ['name', 'ref', 'partner_id', 'invoice_line_ids', 'state', 'move_type'] })
  if (!inv || inv.state !== 'posted' || inv.move_type !== 'out_invoice') throw new Error(`Facture ${invoiceId} pas validée`)
  const deja = await odooRpc<any[]>('account.move', 'search_read', [[['move_type', '=', 'out_refund'], ['partner_id', '=', inv.partner_id[0]], ['state', '!=', 'cancel'], '|', ['invoice_origin', '=', inv.name], ['reversed_entry_id', '=', invoiceId]]], { fields: ['name'], limit: 1 })
  if (deja.length) return { name: deja[0].name || 'brouillon', created: false, note: `déjà faite (${deja[0].name})` }
  const ls = await odooRpc<any[]>('account.move.line', 'read', [inv.invoice_line_ids], { fields: ['name', 'product_id', 'quantity', 'price_unit', 'tax_ids', 'display_type', 'sequence'] })
  const q = r2(pct / 100)
  const lines = ls.map((l: any) => l.display_type === 'product'
    ? [0, 0, { name: l.name, product_id: l.product_id ? l.product_id[0] : false, quantity: q, price_unit: r2(l.quantity * l.price_unit), tax_ids: [[6, 0, l.tax_ids]], sequence: l.sequence }]
    : [0, 0, { name: l.name, display_type: l.display_type, sequence: l.sequence }])
  // Plaque du véhicule : lue sur la fiche VD Soft qui porte la facture (la facture ne l'a qu'en texte libre).
  let plaque = ''
  try {
    const { createAdminClient } = await import('@/lib/supabase')
    const { data } = await createAdminClient().from('incoming_missions').select('vehicle_plate').eq('invoice_odoo_id', invoiceId).not('vehicle_plate', 'is', null).limit(1)
    plaque = String((data || [])[0]?.vehicle_plate || '')
  } catch { /* la référence reste sans plaque */ }
  const ncId = await odooRpc<number>('account.move', 'create', [{
    move_type: 'out_refund', partner_id: inv.partner_id[0],
    invoice_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }),
    ref: `Commission ${pct} %${plaque ? ` ${plaque}` : ''} · facture ${inv.name}${inv.ref ? ` · ${inv.ref}` : ''}`,
    invoice_origin: inv.name, invoice_line_ids: lines,
  }])
  const { postAndSendPeppol } = await import('@/lib/mail-agent/odoo')
  const sent = await postAndSendPeppol(ncId)
  return { name: sent.name, created: true, note: sent.note }
}

/** Facture annulée = commission annulée (Olivier 21/10/2026, Car Avenue 2026-0160 sur 2026/06/334). Une note de
 *  commission dont la facture d'origine a été extournée est annulée à son tour par une facture qui la reprend
 *  à l'identique (référence « Annulation de la note de commission … »), envoyée comme la note. */
export async function annulerCommissionsFacturesAnnulees(): Promise<{ done: string[]; errors: string[] }> {
  const out = { done: [] as string[], errors: [] as string[] }
  for (const g of await commissionGarages()) {
    const ncs = await odooRpc<any[]>('account.move', 'search_read', [[
      ['move_type', '=', 'out_refund'], ['state', '=', 'posted'], ['partner_id', '=', g.partnerId],
      ['invoice_date', '>=', g.since], ['ref', '=like', 'Commission%'], ['invoice_origin', '!=', false],
    ]], { fields: ['id', 'name', 'invoice_origin', 'invoice_line_ids'], limit: 200 })
    for (const nc of ncs) {
      try {
        const [inv] = await odooRpc<any[]>('account.move', 'search_read', [[['name', '=', nc.invoice_origin], ['move_type', '=', 'out_invoice']]], { fields: ['id', 'name'], limit: 1 })
        if (!inv) continue
        // Facture d'origine extournée par une note de crédit qui n'est pas une commission ?
        const ext = await odooRpc<any[]>('account.move', 'search_read', [[['move_type', '=', 'out_refund'], ['state', '=', 'posted'], ['reversed_entry_id', '=', inv.id]]], { fields: ['name', 'ref'], limit: 5 })
        const annulee = ext.filter(e => !/^Commission/.test(String(e.ref || '')))
        if (!annulee.length) continue
        // Déjà annulée (à la main, en extourne, ou par ce passage) ?
        const deja = await odooRpc<any[]>('account.move', 'search_read', [[['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel'], '|', ['reversed_entry_id', '=', nc.id], ['invoice_origin', '=', nc.name]]], { fields: ['name'], limit: 1 })
        if (deja.length) continue
        const ls = await odooRpc<any[]>('account.move.line', 'read', [nc.invoice_line_ids], { fields: ['name', 'product_id', 'quantity', 'price_unit', 'tax_ids', 'display_type', 'sequence'] })
        const lines = ls.map((l: any) => l.display_type === 'product'
          ? [0, 0, { name: l.name, product_id: l.product_id ? l.product_id[0] : false, quantity: l.quantity, price_unit: l.price_unit, tax_ids: [[6, 0, l.tax_ids]], sequence: l.sequence }]
          : [0, 0, { name: l.name, display_type: l.display_type, sequence: l.sequence }])
        const id = await odooRpc<number>('account.move', 'create', [{
          move_type: 'out_invoice', partner_id: g.partnerId,
          invoice_date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }),
          ref: `Annulation de la note de commission ${nc.name} (facture ${inv.name} annulée par ${annulee[0].name})`,
          invoice_origin: nc.name, invoice_line_ids: lines,
        }])
        const { postAndSendPeppol } = await import('@/lib/mail-agent/odoo')
        const sent = await postAndSendPeppol(id)
        out.done.push(`${nc.name} annulée par ${sent.name}`)
      } catch (e: any) { out.errors.push(`${nc.name} : ${String(e?.message || e).slice(0, 160)}`) }
    }
  }
  return out
}

/** Passe du cron : factures envoyées des garages commissionnés, sans note de commission. */
export async function notesCommissionDues(): Promise<{ done: string[]; errors: string[] }> {
  const out = { done: [] as string[], errors: [] as string[] }
  for (const g of await commissionGarages()) {
    const invs = await odooRpc<any[]>('account.move', 'search_read', [[
      ['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['partner_id', '=', g.partnerId],
      ['invoice_date', '>=', g.since], '|', ['is_move_sent', '=', true], ['peppol_move_state', 'in', ['processing', 'done']],
    ]], { fields: ['id', 'name'], limit: 50 })
    for (const i of invs) {
      try {
        const r = await noteCommission(i.id, g.pct)
        if (r.created) out.done.push(`${i.name} → ${r.name}`)
      } catch (e: any) { out.errors.push(`${i.name} : ${String(e?.message || e).slice(0, 160)}`) }
    }
  }
  return out
}
