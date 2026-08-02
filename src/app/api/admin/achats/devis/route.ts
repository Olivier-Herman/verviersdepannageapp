// src/app/api/admin/achats/devis/route.ts
//
// Comparateur de devis (brique 3 Achat IA). Superadmin.
// GET                          → besoins + devis
// POST create_request {label}  → nouveau besoin
// POST add_quote {request_id, file_b64, filename, mimetype} → extrait (Claude) + enregistre
// POST delete_quote {id} / delete_request {id}
// POST compare {request_id}     → recommandation IA (stockée sur le besoin)

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'
import { parseQuoteDoc, compareQuotes } from '@/lib/achats/parse-quote'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 60

function isSuper(u: any) { return u?.role === 'superadmin' || (u?.roles || []).includes('superadmin') }

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: requests } = await sb.from('achats_quote_requests').select('*').order('created_at', { ascending: false })
  const ids = (requests || []).map((r: any) => r.id)
  const { data: quotes } = ids.length
    ? await sb.from('achats_quotes').select('*').in('request_id', ids).order('total_htva', { ascending: true, nullsFirst: false })
    : { data: [] }
  return NextResponse.json({ requests: requests || [], quotes: quotes || [] })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const u = session?.user as any
  if (!isSuper(u)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'create_request') {
    const label = String(body.label || '').trim()
    if (!label) return NextResponse.json({ error: 'Intitulé requis' }, { status: 400 })
    const { data, error } = await sb.from('achats_quote_requests').insert({ label, notes: String(body.notes || '').trim() || null, created_by: u.id }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: data.id })
  }

  if (action === 'add_quote') {
    const requestId = String(body.request_id || '')
    const b64 = String(body.file_b64 || '')
    if (!requestId || !b64) return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    try {
      const q = await parseQuoteDoc({ docBase64: b64, mimetype: String(body.mimetype || 'application/pdf') })
      const { data, error } = await sb.from('achats_quotes').insert({
        request_id: requestId, supplier_name: q.supplier_name, total_htva: q.total_htva, currency: q.currency,
        delivery_days: q.delivery_days, payment_terms: q.payment_terms, validity: q.validity,
        items: q.items, summary: q.summary, file_name: String(body.filename || '').slice(0, 200) || null,
      }).select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, quote: data })
    } catch (e: any) {
      return NextResponse.json({ error: `Lecture du devis impossible : ${e.message}` }, { status: 500 })
    }
  }

  if (action === 'delete_quote') {
    await sb.from('achats_quotes').delete().eq('id', String(body.id || ''))
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete_request') {
    await sb.from('achats_quote_requests').delete().eq('id', String(body.id || ''))
    return NextResponse.json({ ok: true })
  }

  if (action === 'compare') {
    const requestId = String(body.request_id || '')
    const { data: reqRow } = await sb.from('achats_quote_requests').select('label').eq('id', requestId).maybeSingle()
    const { data: quotes } = await sb.from('achats_quotes').select('*').eq('request_id', requestId)
    if (!reqRow || !quotes || quotes.length < 2) return NextResponse.json({ error: 'Ajoute au moins 2 devis pour comparer.' }, { status: 400 })
    const reco = await compareQuotes(reqRow.label, quotes as any)
    await sb.from('achats_quote_requests').update({ reco }).eq('id', requestId)
    return NextResponse.json({ ok: true, reco })
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
