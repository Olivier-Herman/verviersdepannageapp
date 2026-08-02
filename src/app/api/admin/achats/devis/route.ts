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
import { generateRfqEmail, getRfqMailbox } from '@/lib/achats/rfq'
import { sendEmail, emailLayout } from '@/lib/emails'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.verviersdepannage.com'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 60

function isSuper(u: any) { return u?.role === 'superadmin' || (u?.roles || []).includes('superadmin') }
const escapeHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!isSuper(session?.user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient()
  const { data: requests } = await sb.from('achats_quote_requests').select('*').order('created_at', { ascending: false })
  const ids = (requests || []).map((r: any) => r.id)
  const { data: quotes } = ids.length
    ? await sb.from('achats_quotes').select('*').in('request_id', ids).order('total_htva', { ascending: true, nullsFirst: false })
    : { data: [] }
  const { data: recipients } = ids.length
    ? await sb.from('achats_rfq_recipients').select('id, request_id, name, email, status, sent_at, opened_at, responded_at, quote_id').in('request_id', ids)
    : { data: [] }
  return NextResponse.json({ requests: requests || [], quotes: quotes || [], recipients: recipients || [] })
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

  // ── Appel d'offre (RFQ) ────────────────────────────────────────────────
  if (action === 'rfq_candidates') {
    // Destinataires possibles : marché validé (avec email) + nos fournisseurs (avec email).
    const { data: market } = await sb.from('achats_market').select('id, name, email, category').eq('status', 'valide').not('email', 'is', null)
    const { data: sup } = await sb.from('achats_suppliers').select('partner_id, email, contact_name').not('email', 'is', null)
    let ours: any[] = []
    if (sup && sup.length) {
      const { data: fx } = await sb.from('achats_factures').select('partner_id, supplier_name').in('partner_id', sup.map((s: any) => s.partner_id))
      const nameById = new Map((fx || []).map((r: any) => [r.partner_id, r.supplier_name]))
      ours = sup.map((s: any) => ({ partner_id: s.partner_id, name: nameById.get(s.partner_id) || `#${s.partner_id}`, email: s.email }))
    }
    return NextResponse.json({ market: market || [], ours })
  }

  if (action === 'rfq_draft') {
    const requestId = String(body.request_id || '')
    const spec = String(body.spec || '').trim() || null
    const { data: reqRow } = await sb.from('achats_quote_requests').select('label').eq('id', requestId).maybeSingle()
    if (!reqRow) return NextResponse.json({ error: 'Besoin introuvable' }, { status: 404 })
    if (spec !== undefined) await sb.from('achats_quote_requests').update({ spec }).eq('id', requestId)
    try {
      const email = await generateRfqEmail(reqRow.label, spec || undefined)
      return NextResponse.json({ ok: true, ...email })
    } catch (e: any) { return NextResponse.json({ error: `Rédaction impossible : ${e.message}` }, { status: 500 }) }
  }

  if (action === 'rfq_send') {
    const requestId = String(body.request_id || '')
    const subject = String(body.subject || '').trim()
    const paragraphs: string[] = Array.isArray(body.paragraphs) ? body.paragraphs.map((p: any) => String(p)) : []
    const recipients: any[] = Array.isArray(body.recipients) ? body.recipients.filter((r: any) => r?.email) : []
    if (!requestId || !subject || !recipients.length) return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })

    const RFQ_FROM = await getRfqMailbox(sb)
    let sent = 0, failed = 0
    for (const rcp of recipients) {
      // Crée la ligne destinataire → récupère le token unique.
      const { data: row, error } = await sb.from('achats_rfq_recipients').insert({
        request_id: requestId, name: rcp.name || null, email: rcp.email,
        market_id: rcp.market_id || null, partner_id: rcp.partner_id || null,
      }).select('id, token').single()
      if (error || !row) { failed++; continue }
      const link = `${APP_URL}/devis/${row.token}`
      const ref = `VD${String(row.token).slice(0, 8).toUpperCase()}`   // réf dans l'objet → matche les réponses par mail
      const subjectRef = `${subject} [réf. ${ref}]`
      const body_html = emailLayout(
        `<p>Bonjour${rcp.name ? ' ' + escapeHtml(rcp.name) : ''},</p>
         ${paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
         <p style="margin:22px 0"><a href="${link}" style="background:#CC2222;color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;display:inline-block">Remettre votre offre en ligne</a></p>
         <p style="color:#666;font-size:13px">Vous pouvez aussi simplement répondre à cet e-mail avec votre devis en pièce jointe (merci de conserver la référence <b>${ref}</b> dans l'objet).</p>
         <p>Bien à vous,<br>Le service achats — Verviers Dépannage</p>
         <img src="${APP_URL}/api/devis/${row.token}/pixel" width="1" height="1" style="display:none" alt="">`,
        subjectRef)
      try {
        await sendEmail(rcp.email, subjectRef, body_html, rcp.name || rcp.email, undefined, undefined, RFQ_FROM)
        await sb.from('achats_rfq_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id)
        sent++
      } catch { await sb.from('achats_rfq_recipients').update({ status: 'failed' }).eq('id', row.id); failed++ }
    }
    return NextResponse.json({ ok: true, sent, failed })
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
