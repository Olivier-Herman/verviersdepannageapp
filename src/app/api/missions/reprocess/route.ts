// src/app/api/missions/reprocess/route.ts
//
// Accessible au dispatch (dispatcher/admin/superadmin/fourrière) :
//   GET  → { count }  nombre de missions en erreur (badge dispatch)
//   POST → relance le parsing (lot, ou { id } pour une mission)
//
// Réutilise la lib partagée (même logique que le cron auto et l'admin).
// Olivier 2026-06-16.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { countErrorMissions, reprocessErrorMissions } from '@/lib/missions/reprocess-errors'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const ALLOWED_ROLES = ['admin', 'superadmin', 'dispatcher']
function canAccess(session: any): boolean {
  if (!session) return false
  const role = (session.user as any)?.role || ''
  const modules: string[] = (session.user as any)?.modules || []
  return ALLOWED_ROLES.includes(role) || modules.includes('fourriere')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ count: await countErrorMissions() })
  } catch (e: any) {
    return NextResponse.json({ count: 0, error: e.message })
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!canAccess(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  try {
    const r = await reprocessErrorMissions({ onlyId: body.id ? String(body.id) : null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
