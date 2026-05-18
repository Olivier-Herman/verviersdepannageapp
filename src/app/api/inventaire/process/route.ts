// src/app/api/inventaire/process/route.ts
//
// POST /api/inventaire/process
// Body : { towsoftData, stateId, tagName? }
//
// Workflow complet pour un vehicule scanne via QR Towsoft :
// 1. Find or create fleet.vehicle (par plaque/VIN)
// 2. MAJ state_id si different
// 3. Ajoute le tag mensuel si fourni
// 4. Get or create helpdesk.ticket
// 5. Print etiquette Zebra
//
// Egalement utilisable pour l entree d un nouveau vehicule (sans tag).

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { withOdooActor }    from '@/lib/odoo'
import { processTowsoftInventory } from '@/lib/odoo-fourriere-flows'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

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
    towsoftData?: any
    stateId?:     number | string
    tagName?:     string
  }
  if (!body.towsoftData) {
    return NextResponse.json({ error: 'towsoftData requis' }, { status: 400 })
  }

  const stateId = body.stateId ? Number(body.stateId) : undefined

  return withOdooActor(user.id as string | undefined, async () => {
    try {
      const result = await processTowsoftInventory({
        towsoftData: body.towsoftData,
        stateId,
        tagName: body.tagName,
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (e: any) {
      console.error('[inventaire/process]', e.message)
      return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
    }
  })
}
