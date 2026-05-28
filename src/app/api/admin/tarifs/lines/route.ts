// src/app/api/admin/tarifs/lines/route.ts
//
// POST /api/admin/tarifs/lines
// Cree une nouvelle ligne pre-configuree pour un tarif en mode 'lines'.
// Body : { source, mission_type, position?, kind, name, default_qty?, default_price?, apply_surcharges? }
//
// Acces : superadmin uniquement.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const VALID_KINDS = ['SERV-PEC', 'SERV-KM', 'SERV-PARC', 'SERV-MAJ', 'SERV-DIV']

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  if (user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Accès superadmin requis' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const source      = String(body.source || '').trim()
  const missionType = String(body.mission_type || '').trim()
  const kind        = String(body.kind || '').trim()
  const name        = String(body.name || '').trim()

  if (!source || !missionType) {
    return NextResponse.json({ error: 'source et mission_type requis' }, { status: 400 })
  }
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind invalide (attendu : ${VALID_KINDS.join(', ')})` }, { status: 400 })
  }
  if (!name) {
    return NextResponse.json({ error: 'name requis' }, { status: 400 })
  }

  const position    = body.position != null ? Number(body.position) : 0
  const defaultQty  = body.default_qty === null || body.default_qty === undefined ? null : Number(body.default_qty)
  const defaultPrice = body.default_price === null || body.default_price === undefined ? null : Number(body.default_price)
  const applySurch  = body.apply_surcharges !== undefined ? Boolean(body.apply_surcharges) : true
  const freeDays    = body.free_days != null ? Math.max(0, Math.floor(Number(body.free_days))) : 0

  const sb = createAdminClient()
  const { data, error } = await sb
    .from('source_tariff_lines')
    .insert({
      source,
      mission_type:    missionType,
      position:        Number.isFinite(position) ? position : 0,
      kind,
      name,
      default_qty:     defaultQty,
      default_price:   defaultPrice,
      apply_surcharges: applySurch,
      free_days:       freeDays,
      created_by:      user.id || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ line: data })
}
