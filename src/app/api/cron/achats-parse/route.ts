// src/app/api/cron/achats-parse/route.ts
//
// Catégorisation IA des factures fournisseurs.
//   ?sync=1   → synchronise les métadonnées des factures Odoo dans achats_factures
//   (toujours) → parse un LOT de factures non encore catégorisées (Claude Opus)
// Params : months (fenêtre sync, def 12), limit (taille du lot parse, def 8).
// Auth : cron (Bearer CRON_SECRET) OU superadmin. Olivier 2026-08-01.

import { NextResponse }         from 'next/server'
import { getServerSession }     from 'next-auth'
import { authOptions }          from '@/lib/auth'
import { createAdminClient }    from '@/lib/supabase'
import { achatsRpc as odooRpc, getGroupCompanyPartnerIds } from '@/lib/achats/odoo-rpc'   // connecteur multi-société dédié Achats
import { categorizeInvoiceDoc } from '@/lib/achats/parse-invoice'
import { ANTHROPIC_MODEL }      from '@/lib/anthropic-model'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function iso(monthsBack: number): string {
  const d = new Date(); d.setMonth(d.getMonth() - (monthsBack - 1)); d.setDate(1)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`
  if (!okCron) {
    const session = await getServerSession(authOptions)
    const u = session?.user as any
    if (!(u?.role === 'superadmin' || (u?.roles || []).includes('superadmin'))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const sp     = new URL(req.url).searchParams
  const doSync = sp.get('sync') === '1'
  const months = Math.min(Math.max(parseInt(sp.get('months') || '12'), 1), 24)
  const limit  = Math.min(Math.max(parseInt(sp.get('limit') || '8'), 1), 40)
  const sb = createAdminClient()

  // Re-parsing : réinitialise parsed_at → les factures repasseront à l'IA.
  //   ?reset=all     → toutes (ex. changement de prompt)
  //   ?reset=plaques → seulement celles sans plaques
  const resetMode = sp.get('reset')
  if (resetMode) {
    let q = sb.from('achats_factures').update({ parsed_at: null }).not('parsed_at', 'is', null)
    if (resetMode === 'plaques') q = q.is('plaques', null)
    await q
    return NextResponse.json({ ok: true, reset: resetMode })
  }

  let synced = 0
  if (doSync) {
    const companyPartners = await getGroupCompanyPartnerIds()   // neutralise l'intercompagnie
    const bills = await odooRpc<any[]>('account.move', 'search_read', [
      [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['invoice_date', '>=', iso(months)],
        ...(companyPartners.length ? [['commercial_partner_id', 'not in', companyPartners]] : [])],
      ['id', 'partner_id', 'invoice_date', 'amount_untaxed', 'amount_total', 'ref', 'message_main_attachment_id'],
    ], { limit: 6000 })
    const rows = (bills || []).map(b => ({
      odoo_move_id: b.id,
      partner_id:   b.partner_id ? b.partner_id[0] : null,
      supplier_name: b.partner_id ? b.partner_id[1] : null,
      invoice_date: b.invoice_date || null,
      amount_htva:  b.amount_untaxed || 0,
      amount_total: b.amount_total || 0,
      ref:          b.ref || null,
      attachment_id: b.message_main_attachment_id ? b.message_main_attachment_id[0] : null,
      synced_at:    new Date().toISOString(),
    }))
    // Upsert métadonnées uniquement → les colonnes IA (categorie…) sont préservées.
    for (let i = 0; i < rows.length; i += 500) {
      await sb.from('achats_factures').upsert(rows.slice(i, i + 500), { onConflict: 'odoo_move_id' })
    }
    synced = rows.length
  }

  // Lot à catégoriser : non parsées, avec pièce jointe, sans erreur récente.
  const { data: todo } = await sb.from('achats_factures')
    .select('odoo_move_id, supplier_name, ref, amount_htva, attachment_id')
    .is('parsed_at', null).not('attachment_id', 'is', null).is('parse_error', null)
    .order('invoice_date', { ascending: false })
    .limit(limit)

  const one = async (f: any): Promise<'ok' | 'fail'> => {
    try {
      const att = await odooRpc<any[]>('ir.attachment', 'read', [[f.attachment_id], ['datas', 'mimetype']])
      const a = att?.[0]
      if (!a?.datas) { await sb.from('achats_factures').update({ parse_error: 'pièce jointe vide' }).eq('odoo_move_id', f.odoo_move_id); return 'fail' }
      const cat = await categorizeInvoiceDoc({
        supplierName: f.supplier_name || '?', ref: f.ref, amountHtva: f.amount_htva,
        docBase64: a.datas, mimetype: a.mimetype || 'application/pdf',
      })
      await sb.from('achats_factures').update({
        categorie: cat.categorie, resume: cat.resume,
        items: cat.items,
        plaques: cat.items.filter(i => i.plaque).map(i => ({ plaque: i.plaque, montant: i.montant })),
        confidence: cat.confidence, model: ANTHROPIC_MODEL,
        doc_mimetype: a.mimetype || null, parsed_at: new Date().toISOString(), parse_error: null,
      }).eq('odoo_move_id', f.odoo_move_id)
      return 'ok'
    } catch (e: any) {
      await sb.from('achats_factures').update({ parse_error: (e.message || 'erreur').slice(0, 300) }).eq('odoo_move_id', f.odoo_move_id)
      return 'fail'
    }
  }
  // Traitement concurrent (5 en parallèle) pour tenir dans maxDuration.
  const CONC = 5
  let parsed = 0, failed = 0
  const list = todo || []
  for (let i = 0; i < list.length; i += CONC) {
    const results = await Promise.all(list.slice(i, i + CONC).map(one))
    parsed += results.filter(r => r === 'ok').length
    failed += results.filter(r => r === 'fail').length
  }

  const { count: remaining } = await sb.from('achats_factures')
    .select('*', { count: 'exact', head: true }).is('parsed_at', null).not('attachment_id', 'is', null).is('parse_error', null)

  return NextResponse.json({ ok: true, synced, parsed, failed, remaining: remaining ?? null })
}
