// src/app/api/cron/achats-rfq-poll/route.ts
//
// Poll de la boîte achats@ : récupère les RÉPONSES aux appels d'offre reçues par
// mail (pour les fournisseurs qui répondent au lieu d'utiliser le lien), matche
// via la référence [réf. VDxxxxxxxx] dans l'objet (ou l'email expéditeur), parse
// le PDF joint et crée le devis dans le comparateur.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getAppToken } from '@/lib/emails'
import { parseQuoteDoc } from '@/lib/achats/parse-quote'
import { getRfqMailbox } from '@/lib/achats/rfq'

export const dynamic     = 'force-dynamic'
export const fetchCache   = 'force-no-store'
export const maxDuration  = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sb = createAdminClient()
  const BOX = await getRfqMailbox(sb)
  let token: string
  try { token = await getAppToken() } catch (e: any) { return NextResponse.json({ error: `Graph token: ${e.message}` }, { status: 500 }) }
  const g = (url: string, init?: any) => fetch(`https://graph.microsoft.com/v1.0${url}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } })

  // Messages non lus de la boîte achats@ (les réponses aux appels d'offre).
  const listRes = await g(`/users/${BOX}/mailFolders/inbox/messages?$filter=isRead eq false&$top=25&$select=id,subject,from,hasAttachments,receivedDateTime`)
  if (!listRes.ok) return NextResponse.json({ error: `Graph list (${listRes.status}) — la boîte ${BOX} est-elle accessible à l'app ?`, detail: (await listRes.text()).slice(0, 300) }, { status: 500 })
  const messages = (await listRes.json()).value || []

  let matched = 0, created = 0, skipped = 0
  const results: any[] = []
  for (const m of messages) {
    const subject: string = m.subject || ''
    const fromEmail: string = (m.from?.emailAddress?.address || '').toLowerCase()
    const refMatch = subject.match(/VD([0-9A-Fa-f]{8})/)
    let rcp: any = null
    if (refMatch) {
      const { data } = await sb.from('achats_rfq_recipients').select('*').ilike('token', `${refMatch[1].toLowerCase()}%`).limit(1).maybeSingle()
      rcp = data
    }
    if (!rcp && fromEmail) {
      // Fallback : dernier destinataire avec cet email, pas encore répondu.
      const { data } = await sb.from('achats_rfq_recipients').select('*').ilike('email', fromEmail).is('responded_at', null).order('sent_at', { ascending: false }).limit(1).maybeSingle()
      rcp = data
    }
    if (!rcp) { skipped++; continue }
    matched++

    // Marque « ouvert » a minima
    if (!rcp.opened_at) await sb.from('achats_rfq_recipients').update({ opened_at: new Date().toISOString(), status: rcp.status === 'sent' ? 'opened' : rcp.status }).eq('id', rcp.id)

    if (rcp.responded_at) { await g(`/users/${BOX}/messages/${m.id}`, { method: 'PATCH', body: JSON.stringify({ isRead: true }) }); results.push({ ref: refMatch?.[1], note: 'déjà répondu' }); continue }

    // Cherche une pièce jointe PDF
    if (m.hasAttachments) {
      const attRes = await g(`/users/${BOX}/messages/${m.id}/attachments?$select=id,name,contentType,contentBytes`)
      const atts = attRes.ok ? ((await attRes.json()).value || []) : []
      const pdf = atts.find((a: any) => (a.contentType || '').includes('pdf') || String(a.name || '').toLowerCase().endsWith('.pdf'))
      if (pdf?.contentBytes) {
        try {
          const p = await parseQuoteDoc({ docBase64: pdf.contentBytes, mimetype: 'application/pdf' })
          const { data: qrow } = await sb.from('achats_quotes').insert({
            request_id: rcp.request_id, supplier_name: rcp.name || p.supplier_name, supplier_partner_id: rcp.partner_id || null,
            total_htva: p.total_htva, currency: p.currency, delivery_days: p.delivery_days, payment_terms: p.payment_terms,
            validity: p.validity, items: p.items, summary: p.summary, file_name: pdf.name || null,
          }).select('id').single()
          await sb.from('achats_rfq_recipients').update({ status: 'responded', responded_at: new Date().toISOString(), quote_id: qrow?.id || null }).eq('id', rcp.id)
          created++
          results.push({ ref: refMatch?.[1], supplier: rcp.name, total: p.total_htva })
        } catch (e: any) { results.push({ ref: refMatch?.[1], error: e.message?.slice(0, 120) }) }
      }
    }
    // Marque le message lu (traité)
    await g(`/users/${BOX}/messages/${m.id}`, { method: 'PATCH', body: JSON.stringify({ isRead: true }) })
  }

  return NextResponse.json({ ok: true, scanned: messages.length, matched, created, skipped, results })
}
