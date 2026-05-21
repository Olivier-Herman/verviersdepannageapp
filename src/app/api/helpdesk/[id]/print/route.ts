// src/app/api/helpdesk/[id]/print/route.ts
//
// POST /api/helpdesk/[id]/print
// Demande au PC Windows (imprimante Zebra via ngrok) d imprimer une etiquette
// pour ce ticket helpdesk. Delegue a /lib/print/zebra.ts qui contient la
// logique partagee avec /api/towsoft/callback.

import { NextResponse }            from 'next/server'
import { getServerSession }        from 'next-auth'
import { authOptions }             from '@/lib/auth'
import { withOdooActor }           from '@/lib/odoo'
import { printZebraLabelForTicket } from '@/lib/print/zebra'

export const dynamic     = 'force-dynamic'
export const maxDuration = 20

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  const hasAccess =
    ['admin', 'superadmin'].includes(role) ||
    modules.includes('fourriere')
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ticketId = parseInt(params.id, 10)

  return withOdooActor(user.id as string | undefined, async () => {
    const result = await printZebraLabelForTicket(ticketId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json({ ok: true, qrUrl: result.qrUrl, plate: result.plate, motif: result.motif })
  })
}
