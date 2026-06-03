// src/app/api/missions/[id]/quote-status/route.ts
//
// GET /api/missions/[id]/quote-status
//
// Verifie l etat reel du devis Odoo associe a la mission. Le `odoo_quote_id`
// stocke en BDD VD Soft peut etre stale (devis supprime ou annule cote Odoo).
// On RPC Odoo pour confirmer l etat reel et cleanup si necessaire.
//
// Reponse :
//   { status: 'not_created' }                        - jamais cree
//   { status: 'deleted' }                            - cree mais supprime cote Odoo
//   { status: 'cancelled', name, url }               - state='cancel'
//   { status: 'draft', name, url }                   - state='draft' ou 'sent'
//   { status: 'confirmed', name, url, fully_invoiced } - state='sale' ou 'done'
//
// Cote UI : on n affiche le bouton "Ouvrir le devis Odoo" QUE quand le devis
// est confirme (status='confirmed'). Sinon on propose "Creer le devis"
// (qui fera UPDATE en draft ou CREATE si inexistant).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const ODOO_URL     = process.env.ODOO_URL!
const ODOO_DB      = process.env.ODOO_DB!
const ODOO_UID     = parseInt(process.env.ODOO_UID || '8')
const ODOO_API_KEY = process.env.ODOO_API_KEY!

async function rpc<T = any>(model: string, method: string, args: any[] = [], kwargs: object = {}): Promise<T> {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'call', id: Date.now(),
      params: { service: 'object', method: 'execute_kw',
        args: [ODOO_DB, ODOO_UID, ODOO_API_KEY, model, method, args, kwargs] },
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Odoo ${model}.${method}: ${JSON.stringify(data.error)}`)
  return data.result
}

function buildQuoteUrl(quoteId: number): string {
  return `${ODOO_URL}/web#id=${quoteId}&model=sale.order&view_type=form`
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createAdminClient()
  const { data: mission, error: missionErr } = await sb
    .from('incoming_missions')
    .select('id, odoo_quote_id, odoo_quote_url, odoo_ticket_id, external_id, dossier_number')
    .eq('id', params.id)
    .single()

  if (missionErr || !mission) {
    return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })
  }

  // Olivier 2026-06-03 : si pas de odoo_quote_id en BDD mais un odoo_ticket_id
  // existe (ticket Helpdesk Odoo), un workflow Odoo a peut-etre cree un devis
  // attache automatiquement. On le cherche par origin = dossier (ex FINALIZED-XXX
  // / MAL_GAREE-XXX) ou via la relation helpdesk_ticket_id sur sale.order.
  // Si trouve → on l attache retroactivement a la mission.
  if (!mission.odoo_quote_id && mission.odoo_ticket_id) {
    try {
      // Cherche par origin = external_id / dossier_number / FINALIZED-{ticketId}
      const candidates: string[] = []
      if (mission.external_id)    candidates.push(mission.external_id)
      if (mission.dossier_number) candidates.push(mission.dossier_number)
      // Recherche sale.order WHERE origin IN (...) (origin = champ libre Odoo)
      const ids = await rpc<number[]>(
        'sale.order', 'search',
        [[['origin', 'in', candidates]]],
        { limit: 1 },
      )
      if (ids && ids.length > 0) {
        const foundId = ids[0]
        const url = buildQuoteUrl(foundId)
        await sb.from('incoming_missions').update({
          odoo_quote_id:  foundId,
          odoo_quote_url: url,
          odoo_quoted_at: new Date().toISOString(),
        }).eq('id', mission.id)
        // Continue avec le devis trouve
        mission.odoo_quote_id  = foundId
        mission.odoo_quote_url = url
        console.log(`[quote-status] Devis Odoo ${foundId} attache retroactivement a mission ${mission.id} via origin lookup`)
      }
    } catch (e: any) {
      console.warn(`[quote-status] Lookup retroactif echoue : ${e?.message}`)
    }
  }

  if (!mission.odoo_quote_id) {
    return NextResponse.json({ status: 'not_created' })
  }

  // RPC Odoo : verifier l existence et l etat du sale.order
  try {
    const res = await rpc<any[]>('sale.order', 'read',
      [[mission.odoo_quote_id], ['name', 'state', 'invoice_status']],
    )
    if (!res || res.length === 0) {
      // Devis supprime cote Odoo : cleanup la trace cote app
      await sb.from('incoming_missions').update({
        odoo_quote_id: null, odoo_quote_url: null, odoo_quoted_at: null,
      }).eq('id', mission.id)
      return NextResponse.json({ status: 'deleted' })
    }
    const so = res[0]
    const url = buildQuoteUrl(mission.odoo_quote_id)
    const name = so.name as string

    if (so.state === 'cancel') {
      return NextResponse.json({ status: 'cancelled', name, url })
    }
    if (so.state === 'draft' || so.state === 'sent') {
      return NextResponse.json({ status: 'draft', name, url })
    }
    // 'sale' ou 'done' = confirme
    return NextResponse.json({
      status:          'confirmed',
      name,
      url,
      fully_invoiced:  so.invoice_status === 'invoiced',
    })
  } catch (e: any) {
    // Erreur RPC (devis inexistant lance souvent une exception) -> on traite
    // comme deleted et on cleanup.
    const msg = String(e.message || '')
    if (msg.includes('does not exist') || msg.includes('Missing') || msg.includes('AccessError')) {
      await sb.from('incoming_missions').update({
        odoo_quote_id: null, odoo_quote_url: null, odoo_quoted_at: null,
      }).eq('id', mission.id)
      return NextResponse.json({ status: 'deleted' })
    }
    console.error('[quote-status] RPC error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
