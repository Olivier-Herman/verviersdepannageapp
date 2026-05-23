// src/app/api/admin/labels/test-print/route.ts
//
// Route admin de test pour le nouveau flow d impression : VD Soft compose
// le ZPL et l envoie au PC via /print-raw. Coexiste avec le flow actuel
// (/api/helpdesk/[id]/print) qui reste intact pendant la phase de test.
//
// Endpoints :
//   GET  ?ticket_id=X         -> lit le ticket Odoo, retourne le ZPL genere
//                                (pour preview / debug, sans imprimer)
//   POST { ticket_id }        -> lit + compose + envoie a /print-raw
//
// Reservee admin/superadmin.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { odooRpc }           from '@/lib/odoo'
import { buildParcLabelZPL, labelaryPreviewUrl } from '@/lib/print/zpl-templates/parc-label'
import { printZPLRaw }       from '@/lib/print/zebra-raw'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 } as const
  const user = session.user as any
  const role: string = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : []
  const isAdmin = ['admin', 'superadmin'].includes(role) ||
                  roles.some(r => ['admin', 'superadmin'].includes(r))
  if (!isAdmin) return { error: 'Forbidden', status: 403 } as const
  return null
}

const QR_BASE = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/v`
  : 'https://verviers-qr.vercel.app/v'

/**
 * Lit un ticket Helpdesk Odoo et compose les donnees label.
 * Reproduit exactement la logique de lib/print/zebra.ts pour rester equivalent.
 */
async function buildLabelDataFromTicket(ticketId: number) {
  const tickets = await odooRpc<any[]>('helpdesk.ticket', 'search_read', [
    [['id', '=', ticketId]],
  ], {
    fields: [
      'id', 'tag_ids',
      'x_studio_vehicule',
      'x_studio_date_dentree',
      'x_studio_note_sur_etiquette',
    ],
    limit: 1,
  })
  if (!tickets || tickets.length === 0) {
    throw new Error(`Ticket ${ticketId} introuvable`)
  }
  const t = tickets[0]

  // Motif = 1er tag
  let motif = ''
  if (t.tag_ids?.length > 0) {
    const tags = await odooRpc<any[]>('helpdesk.tag', 'search_read', [
      [['id', 'in', t.tag_ids]],
    ], { fields: ['name'], limit: 5 })
    motif = tags?.[0]?.name || ''
  }

  // Date d entree formatee DD/MM/YY
  let date = ''
  if (t.x_studio_date_dentree) {
    const d = new Date(t.x_studio_date_dentree)
    date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
  }

  // Note libre (champ texte etiquette)
  const note = (t.x_studio_note_sur_etiquette && t.x_studio_note_sur_etiquette !== false)
    ? String(t.x_studio_note_sur_etiquette)
    : ''

  return {
    qrUrl: `${QR_BASE}/${ticketId}`,
    motif,
    date,
    note,
  }
}

// GET : preview du ZPL sans imprimer
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(req.url)
  const ticketId = parseInt(searchParams.get('ticket_id') || '0')
  if (!ticketId) return NextResponse.json({ error: 'ticket_id requis' }, { status: 400 })

  try {
    const data = await buildLabelDataFromTicket(ticketId)
    const zpl = buildParcLabelZPL(data)
    return NextResponse.json({
      ok:           true,
      label_data:   data,
      zpl,
      preview_url:  labelaryPreviewUrl(zpl),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}

// POST : compose + imprime via /print-raw
export async function POST(req: Request) {
  const auth = await requireAdmin()
  if (auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const ticketId = parseInt(body.ticket_id || '0')
  if (!ticketId) return NextResponse.json({ error: 'ticket_id requis' }, { status: 400 })

  try {
    const data = await buildLabelDataFromTicket(ticketId)
    const zpl = buildParcLabelZPL(data)
    const result = await printZPLRaw(zpl)
    return NextResponse.json({
      ok:          result.ok,
      error:       result.error,
      label_data:  data,
      zpl,
      preview_url: labelaryPreviewUrl(zpl),
    }, { status: result.ok ? 200 : (result.status || 500) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
