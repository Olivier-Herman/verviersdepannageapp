// src/app/api/missions/[id]/reprint-label/route.ts
//
// POST /api/missions/[id]/reprint-label
//
// Reimprime l etiquette parc d une mission existante (Olivier 2026-05-27).
// Utilise par le bouton "🖨 Imprimer etiquette" sur la fiche dispatch.
//
// Compose le ZPL via le template VD Soft (buildParcLabelZPL) avec les vraies
// donnees de la mission, puis envoie au PC Zebra via printZPLRaw.
//
// Acces : admin / superadmin OU module fourriere active (Olivier 2026-05-28 :
// le dispatcher seul n a pas le droit, il faut avoir le module fourriere).

import { NextResponse }              from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { reprintLabelForMission }    from '@/lib/missions/reprint-label-helper'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const roles:   string[] = Array.isArray(user.roles)   ? user.roles   : [user.role].filter(Boolean)
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const isAdmin       = roles.some(r => ['admin', 'superadmin'].includes(r))
  const hasFourriere  = modules.includes('fourriere')
  if (!isAdmin && !hasFourriere) {
    return NextResponse.json({ error: 'Forbidden — module fourriere requis' }, { status: 403 })
  }

  // Accepte UUID OR mission_number numerique (Olivier 2026-05-27).
  // Logique factorisee dans reprintLabelForMission (Olivier 2026-06-03 :
  // partage avec /api/helpdesk/[id]/print).
  const idIsNumeric = /^\d+$/.test(params.id)
  const result = await reprintLabelForMission(
    idIsNumeric
      ? { kind: 'mission_number', value: Number(params.id) }
      : { kind: 'uuid',           value: params.id }
  )

  if (!result.ok) {
    const status = result.error === 'Mission introuvable' ? 404 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ ok: true })
}
