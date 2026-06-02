// src/app/api/helpdesk/[id]/print/route.ts
//
// POST /api/helpdesk/[id]/print
//
// Olivier 2026-06-03 : route migree vers le NOUVEAU format VD Soft.
// On cherche d abord la mission VD Soft liee a ce ticket Odoo. Si trouvee,
// on appelle /api/missions/[id]/reprint-label (printVdSoftParcLabel) qui
// utilise le template ZPL configurable depuis /admin/labels.
// Si pas de mission VD Soft (rare, cas migration), fallback sur l ancien
// printZebraLabelForTicket pour ne pas casser les usages historiques.

import { NextResponse }              from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { withOdooActor }             from '@/lib/odoo'
import { printZebraLabelForTicket }  from '@/lib/print/zebra'
import { reprintLabelForMission }    from '@/lib/missions/reprint-label-helper'

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

  // 1. Essaye d abord le NOUVEAU format via la mission VD Soft liee.
  //    Logique partagee avec /api/missions/[id]/reprint-label.
  const result = await reprintLabelForMission({ kind: 'odoo_ticket_id', value: ticketId })
  if (result.ok) {
    return NextResponse.json({ ok: true, format: 'vdsoft', mission_id: result.mission_id })
  }

  // 2. Fallback : ancien format via Odoo helpdesk (cas legacy ou mission absente)
  console.warn(`[helpdesk/print] Mission VD Soft introuvable pour ticket ${ticketId} (${result.error}), fallback legacy`)
  return withOdooActor(user.id as string | undefined, async () => {
    const r = await printZebraLabelForTicket(ticketId)
    if (!r.ok) {
      return NextResponse.json({ error: r.error }, { status: r.status || 500 })
    }
    return NextResponse.json({ ok: true, format: 'legacy', qrUrl: r.qrUrl, plate: r.plate, motif: r.motif })
  })
}
