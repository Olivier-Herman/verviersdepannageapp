// src/app/api/odoo/invoice/[id]/route.ts
//
// GET /api/odoo/invoice/[id] → fiche facture enrichie pour <InvoiceSheet>
// Header + lignes + paiements + vehicule lie.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooRpc }          from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

const ODOO_URL = process.env.ODOO_URL || ''

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const invoiceId = parseInt(params.id, 10)
  if (!invoiceId || Number.isNaN(invoiceId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 })
  }

  try {
    // fields_get pour filtrer les champs custom selon ce qui existe vraiment
    const allMoveFields = await odooRpc<Record<string, any>>('account.move', 'fields_get', [], { attributes: ['type'] })
    const wantedMoveFields = [
      'id', 'name', 'state', 'move_type', 'payment_state',
      'invoice_date', 'invoice_date_due', 'amount_untaxed', 'amount_tax',
      'amount_total', 'amount_residual', 'currency_id', 'narration',
      'partner_id', 'invoice_origin', 'ref', 'invoice_user_id',
      'invoice_line_ids', 'x_studio_plaque_1',
    ]
    const safeMoveFields = wantedMoveFields.filter(f => f === 'id' || allMoveFields[f])

    const moves = await odooRpc<any[]>('account.move', 'read', [[invoiceId]], { fields: safeMoveFields })
    const m = moves[0]
    if (!m) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

    // Partner details (telephone + email + adresse)
    let partner: any = null
    if (m.partner_id?.[0]) {
      const partners = await odooRpc<any[]>('res.partner', 'read', [[m.partner_id[0]]], {
        fields: ['id', 'name', 'phone', 'mobile', 'email', 'street', 'street2', 'zip', 'city', 'vat'],
      })
      partner = partners[0] || null
    }

    // Lignes facture
    let lines: any[] = []
    if (Array.isArray(m.invoice_line_ids) && m.invoice_line_ids.length > 0) {
      lines = await odooRpc<any[]>('account.move.line', 'read', [m.invoice_line_ids], {
        fields: ['id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'price_total', 'discount', 'product_id', 'tax_ids'],
      })
    }

    // Paiements lies (best effort — Odoo expose ca via journal items)
    let payments: any[] = []
    try {
      payments = await odooRpc<any[]>('account.payment', 'search_read', [
        [['reconciled_invoice_ids', 'in', [invoiceId]]],
      ], {
        fields: ['id', 'amount', 'date', 'payment_method_line_id', 'journal_id', 'ref'],
        limit:  10,
        order:  'date desc',
      })
    } catch (e: any) {
      console.warn('[invoice] payments n/a:', e.message)
    }

    // Vehicule lie (info plaque)
    let linkedVehicle: any = null
    if (m.x_studio_plaque_1?.[0]) {
      try {
        const veh = await odooRpc<any[]>('fleet.vehicle', 'read', [[m.x_studio_plaque_1[0]]], {
          fields: ['id', 'license_plate', 'brand_id', 'model_id'],
        })
        if (veh[0]) {
          linkedVehicle = {
            id:    veh[0].id,
            plate: veh[0].license_plate || null,
            brand: veh[0].brand_id?.[1] || null,
            model: veh[0].model_id?.[1] || null,
          }
        }
      } catch (e: any) {
        console.warn('[invoice] linked vehicle fetch:', e.message)
      }
    }

    const isRefund = m.move_type === 'out_refund'
    const reportName = isRefund ? 'account.report_invoice_with_payments' : 'account.report_invoice'

    return NextResponse.json({
      invoice: {
        id:             m.id,
        number:         m.name || null,
        state:          m.state,
        moveType:       m.move_type,
        isRefund,
        paymentState:   m.payment_state,
        invoiceDate:    m.invoice_date || null,
        invoiceDateDue: m.invoice_date_due || null,
        amountUntaxed:  m.amount_untaxed || 0,
        amountTax:      m.amount_tax || 0,
        amountTotal:    m.amount_total || 0,
        amountResidual: m.amount_residual || 0,
        currency:       m.currency_id?.[1] || 'EUR',
        reference:      m.ref || null,
        origin:         m.invoice_origin || null,
        notes:          m.narration || null,
        salesperson:    m.invoice_user_id ? { id: m.invoice_user_id[0], name: m.invoice_user_id[1] } : null,
        odooUrl:        `${ODOO_URL}/web#id=${m.id}&model=account.move&view_type=form`,
        pdfUrl:         `${ODOO_URL}/report/pdf/${reportName}/${m.id}`,
      },
      partner: partner ? {
        id:      partner.id,
        name:    partner.name || null,
        phone:   partner.phone || partner.mobile || null,
        email:   partner.email || null,
        vat:     partner.vat || null,
        address: [partner.street, partner.street2, [partner.zip, partner.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      } : null,
      lines: lines.map(l => ({
        id:         l.id,
        label:      l.name || null,
        productName: l.product_id?.[1] || null,
        quantity:   l.quantity || 0,
        unitPrice:  l.price_unit || 0,
        discount:   l.discount || 0,
        subtotal:   l.price_subtotal || 0,
        total:      l.price_total || 0,
      })),
      payments: payments.map(p => ({
        id:     p.id,
        amount: p.amount || 0,
        date:   p.date || null,
        method: p.payment_method_line_id?.[1] || null,
        journal: p.journal_id?.[1] || null,
        ref:    p.ref || null,
      })),
      linkedVehicle,
    })
  } catch (e: any) {
    console.error('[api/odoo/invoice]', e.message)
    return NextResponse.json({ error: e.message || 'Erreur Odoo' }, { status: 502 })
  }
}
