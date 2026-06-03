// src/app/api/admin/odoo-helpdesk-debug/route.ts
//
// GET /api/admin/odoo-helpdesk-debug?id=2033
// Dump TOUS les champs disponibles d un ticket helpdesk Odoo pour
// identifier ce qu on peut utiliser pour enrichir incoming_missions.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { odooRpc }          from '@/lib/odoo'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (!['admin', 'superadmin'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const id = parseInt(url.searchParams.get('id') || '0', 10)
  if (!id) return NextResponse.json({ error: 'id requis (?id=2033)' }, { status: 400 })

  try {
    // Etape 1 : liste tous les champs disponibles sur helpdesk.ticket
    const fields = await odooRpc<Record<string, any>>('helpdesk.ticket', 'fields_get', [], {
      attributes: ['string', 'type', 'help'],
    })
    // Filtre uniquement les x_studio_* (custom fields) + champs standard utiles
    const interestingNames = Object.keys(fields).filter(n =>
      n.startsWith('x_studio_') ||
      ['id', 'name', 'partner_id', 'partner_name', 'partner_email', 'partner_phone',
       'description', 'tag_ids', 'stage_id', 'team_id', 'create_date', 'write_date',
       'user_id', 'priority', 'kanban_state'].includes(n)
    )

    // Etape 2 : read le ticket avec tous ces champs
    const tickets = await odooRpc<any[]>('helpdesk.ticket', 'read', [[id]], {
      fields: interestingNames,
    })
    if (!tickets || tickets.length === 0) {
      return NextResponse.json({ error: `Ticket ${id} introuvable` }, { status: 404 })
    }
    const ticket = tickets[0]

    // Filtre les champs avec valeur (pour pas etre noye dans les nulls)
    const populated: Record<string, any> = {}
    const empty: string[] = []
    for (const [k, v] of Object.entries(ticket)) {
      if (v === false || v === null || v === undefined || v === '') empty.push(k)
      else populated[k] = v
    }

    // Resolve tag names si tag_ids present
    let tagNames: string[] = []
    if (Array.isArray(ticket.tag_ids) && ticket.tag_ids.length > 0) {
      const tags = await odooRpc<any[]>('helpdesk.tag', 'read', [ticket.tag_ids], { fields: ['name'] })
      tagNames = tags.map((t: any) => t.name)
    }

    return NextResponse.json({
      ok:                 true,
      ticket_id:          id,
      populated_fields:   populated,
      empty_fields:       empty,
      tag_names:          tagNames,
      // Schemas des champs custom pour comprendre leur usage
      x_studio_fields_schema: Object.fromEntries(
        Object.entries(fields).filter(([k]) => k.startsWith('x_studio_'))
      ),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}
