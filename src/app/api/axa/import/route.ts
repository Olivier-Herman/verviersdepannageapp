// src/app/api/axa/import/route.ts
//
// POST /api/axa/import?mode=preview|send
// Bouton « Import AXA » dans /dispatch. Même helper runAxaImport que le cron.
// Accès : admin / superadmin / dispatcher.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { runAxaImport }     from '@/lib/axa/import'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [role].filter(Boolean)
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r => role === r || roles.includes(r))
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'send' ? 'send' : 'preview'

  try {
    const result = await runAxaImport({ mode })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[api/axa/import]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
