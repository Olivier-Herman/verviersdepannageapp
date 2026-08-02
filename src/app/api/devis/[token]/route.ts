// src/app/api/devis/[token]/route.ts
//
// Dépôt d'offre PUBLIC (appel d'offre) — authentifié par le token du destinataire.
// GET  → infos du besoin (+ marque « ouvert »)
// POST → dépôt du devis (PDF parsé par Claude, ou saisie manuelle) → crée le quote

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { parseQuoteDoc } from '@/lib/achats/parse-quote'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 60

async function recipient(sb: any, token: string) {
  const { data } = await sb.from('achats_rfq_recipients').select('*').eq('token', token).maybeSingle()
  return data
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const rcp = await recipient(sb, params.token)
  if (!rcp) return NextResponse.json({ error: 'Lien invalide ou expiré' }, { status: 404 })
  if (!rcp.opened_at) await sb.from('achats_rfq_recipients').update({ opened_at: new Date().toISOString(), status: rcp.status === 'sent' ? 'opened' : rcp.status }).eq('id', rcp.id)
  const { data: reqRow } = await sb.from('achats_quote_requests').select('label, spec').eq('id', rcp.request_id).maybeSingle()
  return NextResponse.json({ label: reqRow?.label || '', spec: reqRow?.spec || '', supplier: rcp.name || '', responded: !!rcp.responded_at })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const sb = createAdminClient()
  const rcp = await recipient(sb, params.token)
  if (!rcp) return NextResponse.json({ error: 'Lien invalide' }, { status: 404 })
  const body = await req.json().catch(() => ({}))

  let quote: any = {
    request_id: rcp.request_id, supplier_name: rcp.name || null, supplier_partner_id: rcp.partner_id || null,
    file_name: String(body.filename || '').slice(0, 200) || null,
  }
  if (body.file_b64) {
    try {
      const p = await parseQuoteDoc({ docBase64: String(body.file_b64), mimetype: String(body.mimetype || 'application/pdf') })
      quote = { ...quote, supplier_name: quote.supplier_name || p.supplier_name, total_htva: p.total_htva, currency: p.currency, delivery_days: p.delivery_days, payment_terms: p.payment_terms, validity: p.validity, items: p.items, summary: p.summary }
    } catch (e: any) { return NextResponse.json({ error: `Lecture du devis impossible : ${e.message}` }, { status: 500 }) }
  } else {
    // Saisie manuelle minimale
    const num = (x: any) => { const n = Number(x); return isFinite(n) ? n : null }
    quote = { ...quote, total_htva: num(body.total_htva), delivery_days: body.delivery_days ? Math.round(Number(body.delivery_days)) || null : null, payment_terms: String(body.payment_terms || '').trim() || null, summary: String(body.note || '').trim() || null, items: [] }
    if (quote.total_htva == null) return NextResponse.json({ error: 'Indique un montant ou joins un PDF.' }, { status: 400 })
  }

  const { data: qrow, error } = await sb.from('achats_quotes').insert(quote).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await sb.from('achats_rfq_recipients').update({ status: 'responded', responded_at: new Date().toISOString(), quote_id: qrow.id }).eq('id', rcp.id)
  return NextResponse.json({ ok: true })
}
