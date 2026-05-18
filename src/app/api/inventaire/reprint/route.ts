// src/app/api/inventaire/reprint/route.ts
//
// POST /api/inventaire/reprint
// Body : { ticketId, tagName?, stateId? }
//
// Reimpression pour un QR Verviers-QR existant (ticket helpdesk deja
// connu). Met a jour state_id sur le vehicule + ajoute tag mensuel
// (si fourni) + reimprime l etiquette.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { withOdooActor }    from '@/lib/odoo'
import { reprintInventoryLabel } from '@/lib/odoo-fourriere-flows'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    ticketId?: number | string
    tagName?:  string
    stateId?:  number | string
    print?:    boolean
  }
  const ticketId = parseInt(String(body.ticketId), 10)
  if (!ticketId || isNaN(ticketId)) {
    return NextResponse.json({ error: 'ticketId requis' }, { status: 400 })
  }
  const stateId = body.stateId ? Number(body.stateId) : undefined

  return withOdooActor(user.id as string | undefined, async () => {
    try {
      const result = await reprintInventoryLabel({
        ticketId,
        tagName: body.tagName,
        stateId,
        print:   Boolean(body.print),
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      console.error('[inventaire/reprint]', e.message)
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
  })
}
