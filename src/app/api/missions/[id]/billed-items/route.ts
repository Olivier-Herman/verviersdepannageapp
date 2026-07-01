// src/app/api/missions/[id]/billed-items/route.ts
//
// GET /api/missions/[id]/billed-items
//   → postes déjà facturés de la mission (facture partielle fourrière).
//     Sert à griser ces postes et à ne proposer que le solde au final.
//
// Réservé au staff (admin/superadmin/dispatcher/facturation/fourrière).
// Olivier 2026-06-17. Cf project_facture_partielle.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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
  // select('*') pour rester résilient si la migration invoice_number n'est pas
  // encore appliquée (une colonne absente ferait planter un select explicite).
  const { data, error } = await sb
    .from('mission_billed_items')
    .select('*')
    .eq('mission_id', params.id)
    .order('billed_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const items = data || []
  const totalHtva = items.reduce((s, i) => s + Number(i.amount_htva || 0), 0)
  // Dernière période de gardiennage déjà facturée (pour proposer la suivante).
  const lastParcTo = items
    .filter(i => i.kind === 'SERV-PARC' && i.period_to)
    .map(i => i.period_to as string)
    .sort()
    .pop() || null

  // Olivier 2026-06-30 : récupération AUTOMATIQUE du n° de facture Odoo par
  // facture partielle (devis = odoo_quote_id). Le devis, une fois facturé dans
  // Odoo, porte une facture (account.move) avec un numéro → on le ramène pour
  // l'afficher dans le bandeau (plus besoin de l'encoder à la main). Best-effort.
  const quoteIds = [...new Set(items.map((i: any) => i.odoo_quote_id).filter((x: any): x is number => x != null))]
  const quotesInfo: Record<number, {
    invoice_number: string | null; state: string | null; quote_url: string; invoice_url: string | null
    amount_untaxed?: number | null; amount_total?: number | null
    lines?: { name: string; subtotal: number }[]
  }> = {}
  if (quoteIds.length > 0) {
    try {
      const { odooRpc } = await import('@/lib/odoo')
      const ODOO_URL = process.env.ODOO_URL || ''
      const orders = await odooRpc<any[]>('sale.order', 'read', [quoteIds], { fields: ['id', 'invoice_ids'] })
      const moveByQuote = new Map<number, number[]>()
      const allMoveIds = new Set<number>()
      for (const o of orders || []) {
        const ids = (o.invoice_ids || []).map(Number)
        moveByQuote.set(o.id, ids)
        for (const id of ids) allMoveIds.add(id)
      }
      const moves = allMoveIds.size > 0
        ? await odooRpc<any[]>('account.move', 'read', [[...allMoveIds]],
            { fields: ['id', 'name', 'state', 'move_type', 'amount_untaxed', 'amount_total', 'invoice_line_ids'] })
        : []
      const moveById = new Map((moves || []).map((m: any) => [m.id, m]))

      // Choix de la facture par devis, puis lecture des VRAIES lignes Odoo.
      const invByQuote = new Map<number, any>()
      const allLineIds = new Set<number>()
      for (const qid of quoteIds) {
        const moveIds = moveByQuote.get(qid) || []
        const inv = moveIds.map(id => moveById.get(id)).find((m: any) => m && m.move_type === 'out_invoice' && m.state !== 'cancel')
        if (inv) { invByQuote.set(qid, inv); for (const lid of (inv.invoice_line_ids || [])) allLineIds.add(Number(lid)) }
      }
      const lines = allLineIds.size > 0
        ? await odooRpc<any[]>('account.move.line', 'read', [[...allLineIds]],
            { fields: ['id', 'name', 'price_subtotal', 'display_type'] })
        : []
      const lineById = new Map((lines || []).map((l: any) => [l.id, l]))

      for (const qid of quoteIds) {
        const inv = invByQuote.get(qid)
        const invLines = inv
          ? (inv.invoice_line_ids || []).map((lid: number) => lineById.get(lid))
              // Garde les lignes produit ; exclut uniquement les sections et notes.
              .filter((l: any) => l && l.display_type !== 'line_section' && l.display_type !== 'line_note')
              .map((l: any) => ({
                name: String(l.name || '').split('\n')[0].replace(/^\[[^\]]*\]\s*/, '').trim(),
                subtotal: Number(l.price_subtotal || 0),
              }))
          : []
        quotesInfo[qid] = {
          invoice_number: inv && inv.name && inv.name !== '/' ? inv.name : null,
          state:          inv ? inv.state : null,
          quote_url:      `${ODOO_URL}/web#id=${qid}&model=sale.order&view_type=form`,
          invoice_url:    inv ? `${ODOO_URL}/web#id=${inv.id}&model=account.move&view_type=form` : null,
          amount_untaxed: inv ? Number(inv.amount_untaxed) : null,
          amount_total:   inv ? Number(inv.amount_total) : null,
          lines:          invLines,
        }
      }
    } catch (e: any) {
      console.warn('[billed-items] enrich Odoo KO:', e?.message)
    }
  }

  return NextResponse.json({ items, count: items.length, total_htva: totalHtva, last_parc_period_to: lastParcTo, quotes_info: quotesInfo })
}

// PATCH : enregistre le n° de facture d'une facture partielle (lot odoo_quote_id).
//   body: { odoo_quote_id: number, invoice_number: string }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const quoteId = body.odoo_quote_id != null ? Number(body.odoo_quote_id) : null
  const invoiceNumber = String(body.invoice_number || '').trim()
  if (!quoteId)        return NextResponse.json({ error: 'odoo_quote_id requis' }, { status: 400 })
  if (!invoiceNumber)  return NextResponse.json({ error: 'Numéro de facture requis' }, { status: 400 })

  const sb = createAdminClient()
  const { error } = await sb
    .from('mission_billed_items')
    .update({ invoice_number: invoiceNumber })
    .eq('mission_id', params.id)
    .eq('odoo_quote_id', quoteId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
