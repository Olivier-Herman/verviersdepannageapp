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
