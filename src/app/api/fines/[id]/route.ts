// src/app/api/fines/[id]/route.ts
//
// PATCH /api/fines/[id]   body: { driver_id: string | null }
//   Attribue (ou réattribue / retire) manuellement le chauffeur d'une amende
//   depuis la liste des amendes. Accès : admin / superadmin / module facturation.
//
// Olivier 2026-07-01.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const user = session?.user as any
  const role = user?.role || ''
  const modules: string[] = Array.isArray(user?.modules) ? user.modules : []
  if (!user || (!['admin', 'superadmin'].includes(role) && !modules.includes('facturation'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const driverId: string | null = body?.driver_id ? String(body.driver_id) : null

  const sb = createAdminClient()

  // Résoudre le nom du chauffeur (pour retour UI).
  let driverName: string | null = null
  if (driverId) {
    const { data: d } = await sb.from('users').select('name').eq('id', driverId).maybeSingle()
    if (!d) return NextResponse.json({ error: 'Chauffeur introuvable' }, { status: 404 })
    driverName = d.name
  }

  const { error } = await sb
    .from('fines')
    .update({
      driver_id:                driverId,
      driver_match_method:      driverId ? 'manual' : 'none',
      driver_match_confidence:  null,
    })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, driver_id: driverId, driver_name: driverName })
}
