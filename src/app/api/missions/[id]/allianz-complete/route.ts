// src/app/api/missions/[id]/allianz-complete/route.ts
//
// POST /api/missions/[id]/allianz-complete
// Relance la complétion d'une fiche Allianz/Mondial (Hexalite) : remplit les
// champs vides depuis l'API Hexalite (non destructif). Olivier 2026-06-22.
//
// Réservé staff (admin/superadmin/dispatcher/facturation).

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin', 'dispatcher'].includes(role) && !modules.includes('facturation')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { completeAllianzMissionFromApi } = await import('@/lib/allianz/intake')
    const r = await completeAllianzMissionFromApi(params.id)
    return NextResponse.json(r, { status: r.ok ? 200 : 502 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, filled: [], reason: e?.message || 'erreur' }, { status: 500 })
  }
}
