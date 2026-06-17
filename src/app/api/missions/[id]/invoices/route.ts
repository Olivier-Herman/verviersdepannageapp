// src/app/api/missions/[id]/invoices/route.ts
//
// GET /api/missions/[id]/invoices
//   → factures Odoo (account.move) liées à la mission, pour le bandeau de la
//     fiche d'intervention (numéro + montant + état + lien PDF + lien Odoo).
//
// Sources :
//   1. Le devis Odoo de la mission (sale.order.odoo_quote_id) → invoice_ids.
//   2. Fallback : incoming_missions.invoice_odoo_id (facture résolue par cron).
//
// Olivier 2026-06-17.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { odooRpc }           from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

const ODOO_URL = process.env.ODOO_URL || ''

function canAccess(session: any): boolean {
  if (!session) return false
  const role = (session.user as any)?.role || ''
  const modules: string[] = (session.user as any)?.modules || []
  return ['admin', 'superadmin', 'dispatcher'].includes(role)
    || modules.includes('facturation') || modules.includes('fourriere')
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sb = createAdminClient()
  const { data: mission } = await sb
    .from('incoming_missions')
    .select('odoo_quote_id, invoice_odoo_id, invoice_number')
    .eq('id', params.id)
    .single()
  if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

  try {
    const moveIds = new Set<number>()

    // 1) Factures issues du devis de la mission
    if (mission.odoo_quote_id) {
      const orders = await odooRpc<any[]>('sale.order', 'read', [[mission.odoo_quote_id]], { fields: ['invoice_ids'] })
      for (const id of (orders?.[0]?.invoice_ids || [])) moveIds.add(Number(id))
    }
    // 2) Fallback facture résolue par cron
    if (mission.invoice_odoo_id) moveIds.add(Number(mission.invoice_odoo_id))

    if (moveIds.size === 0) return NextResponse.json({ invoices: [] })

    const moves = await odooRpc<any[]>('account.move', 'read', [[...moveIds]], {
      fields: ['id', 'name', 'state', 'move_type', 'payment_state', 'amount_total', 'invoice_date'],
    })

    const invoices = (moves || [])
      // On ne garde que les factures/avoirs clients (pas les éventuels brouillons annulés)
      .filter(m => m.move_type === 'out_invoice' || m.move_type === 'out_refund')
      .map(m => {
        const isRefund   = m.move_type === 'out_refund'
        const reportName = isRefund ? 'account.report_invoice_with_payments' : 'account.report_invoice'
        return {
          id:           m.id,
          number:       m.name && m.name !== '/' ? m.name : null,  // '/' = brouillon non numéroté
          state:        m.state,                                   // draft | posted | cancel
          isRefund,
          paymentState: m.payment_state || null,                   // not_paid | partial | paid
          amountTotal:  m.amount_total || 0,
          invoiceDate:  m.invoice_date || null,
          odooUrl:      `${ODOO_URL}/web#id=${m.id}&model=account.move&view_type=form`,
          pdfUrl:       `${ODOO_URL}/report/pdf/${reportName}/${m.id}`,
        }
      })
      .sort((a, b) => (a.invoiceDate || '').localeCompare(b.invoiceDate || ''))

    return NextResponse.json({ invoices })
  } catch (e: any) {
    console.error('[api/missions/invoices]', e.message)
    return NextResponse.json({ invoices: [], error: e.message }, { status: 200 })
  }
}
