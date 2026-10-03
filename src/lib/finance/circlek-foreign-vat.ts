// Circle K étranger (Luxembourg 17 %, France 20 %, Allemagne 19 %…) : l'import
// automatique des factures dans Odoo ne garde que le montant HT, sans la TVA
// étrangère — le prélèvement (TTC) ne correspond alors à rien. Cette TVA n'est
// pas déductible en Belgique : elle fait partie du coût d'achat du carburant
// (Olivier 30/09/2026). Chaque matin, on relit le PDF, on ajoute la ligne de TVA
// étrangère sur le compte du carburant, puis on lettre avec le prélèvement.
import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODELS, createWithModelFallback } from '@/lib/anthropic-model'
import { odooRpc } from '@/lib/odoo'
import { aiClient } from '@/lib/ai/usage'

const SUSPENSE = 265
const r2 = (n: number) => Math.round(n * 100) / 100
const LINE_TAG = '(non déductible)'

interface Totals { ht: number; tva: number; ttc: number; rate: number | null; country: string | null }

/** Lit les totaux sur le PDF de la facture (Claude, document PDF). */
export async function readTotals(pdfBase64: string): Promise<Totals | null> {
  const client = aiClient('finance/circlek-foreign-vat', { apiKey: process.env.ANTHROPIC_API_KEY })
  const resp = await createWithModelFallback(client, ANTHROPIC_MODELS, {
    max_tokens: 300,
    system: 'Tu lis une facture de carburant Circle K. Réponds UNIQUEMENT par un JSON strict, sans markdown.',
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } } as any,
      { type: 'text', text: 'Donne le « Total Général » : {"ht": nombre, "tva": nombre, "ttc": nombre, "rate": taux de TVA en % ou null, "country": pays de la société émettrice (ex. "Luxembourg") ou null}.' },
    ] }],
  })
  const text = (resp.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s < 0 || e < s) return null
  try {
    const j = JSON.parse(text.slice(s, e + 1))
    const t = { ht: Number(j.ht), tva: Number(j.tva), ttc: Number(j.ttc), rate: j.rate == null ? null : Number(j.rate), country: j.country || null }
    return [t.ht, t.tva, t.ttc].every(Number.isFinite) ? t : null
  } catch { return null }
}

async function note(moveId: number, html: string) {
  await odooRpc('account.move', 'message_post', [[moveId]], { body: html, body_is_html: true, message_type: 'comment', subtype_id: 2 })
}

/** Lettre la facture avec son prélèvement (même montant TTC, référence citée). */
async function reconcileWithDebit(bill: any, ttc: number): Promise<boolean> {
  const debits = await odooRpc<any[]>('account.bank.statement.line', 'search_read', [[
    ['is_reconciled', '=', false], ['amount', '=', -ttc], ['payment_ref', 'ilike', bill.ref],
  ]], { fields: ['id', 'move_id'], limit: 2 })
  if (debits.length !== 1) return false
  const [bm] = await odooRpc<any[]>('account.move', 'read', [[debits[0].move_id[0]]], { fields: ['line_ids', 'journal_id'] })
  const [j] = await odooRpc<any[]>('account.journal', 'read', [[bm.journal_id[0]]], { fields: ['default_account_id'] })
  const ls = await odooRpc<any[]>('account.move.line', 'read', [bm.line_ids], { fields: ['account_id'] })
  const cp = ls.filter(l => l.account_id[0] !== j.default_account_id[0])
  if (cp.length !== 1 || cp[0].account_id[0] !== SUSPENSE) return false
  const [pl] = await odooRpc<any[]>('account.move.line', 'search_read', [[['move_id', '=', bill.id], ['account_id.account_type', '=', 'liability_payable']]], { fields: ['id', 'account_id', 'partner_id'] })
  await odooRpc('account.move', 'button_draft', [[bm.id]])
  try { await odooRpc('account.move', 'write', [[bm.id], { line_ids: [[1, cp[0].id, { account_id: pl.account_id[0], partner_id: pl.partner_id[0], name: `${bill.name} — Circle K ${bill.ref}` }]] }]) }
  finally { await odooRpc('account.move', 'action_post', [[bm.id]]) }
  await odooRpc('account.move.line', 'reconcile', [[cp[0].id, pl.id]])
  return true
}

export async function fixCircleKForeignVat(): Promise<{ fixed: string[]; reconciled: string[]; flagged: string[] }> {
  const out = { fixed: [] as string[], reconciled: [] as string[], flagged: [] as string[] }
  const bills = await odooRpc<any[]>('account.move', 'search_read', [[
    ['partner_id.name', 'ilike', 'Circle K'], ['move_type', '=', 'in_invoice'], ['state', '=', 'posted'],
    ['payment_state', '=', 'not_paid'], ['ref', '=like', 'C%'], ['invoice_date', '>=', '2026-08-01'],
  ]], { fields: ['id', 'name', 'ref', 'amount_total', 'amount_tax', 'invoice_line_ids'], limit: 30 })
  for (const b of bills) {
    const lines = await odooRpc<any[]>('account.move.line', 'read', [b.invoice_line_ids], { fields: ['name', 'account_id'] })
    const done = lines.some(l => String(l.name || '').includes(LINE_TAG))
    let ttc = b.amount_total
    if (!done && b.amount_tax === 0) {
      const [att] = await odooRpc<any[]>('ir.attachment', 'search_read', [[['res_model', '=', 'account.move'], ['res_id', '=', b.id], ['mimetype', '=', 'application/pdf']]], { fields: ['datas'], limit: 1 })
      const t = att ? await readTotals(att.datas) : null
      if (!t) { out.flagged.push(`${b.name} : PDF illisible`); continue }
      if (t.tva <= 0.005) continue                          // pas de TVA étrangère : facture juste
      if (Math.abs(t.ht - b.amount_total) > 0.02 || Math.abs(r2(t.ht + t.tva) - t.ttc) > 0.02) {
        out.flagged.push(`${b.name} : montants à vérifier (Odoo ${b.amount_total}, PDF ${t.ht} + ${t.tva} = ${t.ttc})`)
        await note(b.id, `<p>⚠️ TVA étrangère non ajoutée : montants à vérifier (Odoo ${b.amount_total} €, PDF ${t.ht} + ${t.tva} = ${t.ttc} €).</p>`)
        continue
      }
      const label = `TVA ${t.country ? t.country.toLowerCase().replace(/^\w/, c => c.toUpperCase()) + ' ' : 'étrangère '}${t.rate != null ? t.rate + ' % ' : ''}${LINE_TAG}`
      await odooRpc('account.move', 'button_draft', [[b.id]])
      try { await odooRpc('account.move', 'write', [[b.id], { invoice_line_ids: [[0, 0, { name: label, quantity: 1, price_unit: r2(t.tva), account_id: lines[0].account_id[0], tax_ids: [[6, 0, []]] }]] }]) }
      finally { await odooRpc('account.move', 'action_post', [[b.id]]) }
      await note(b.id, `<p>${label} ajoutée : ${t.tva.toFixed(2)} € — total ${t.ttc.toFixed(2)} € comme sur la facture et le prélèvement.</p>`)
      out.fixed.push(`${b.name} +${t.tva.toFixed(2)} €`)
      ttc = t.ttc
    }
    if (await reconcileWithDebit(b, r2(ttc))) out.reconciled.push(b.name)
  }
  return out
}
