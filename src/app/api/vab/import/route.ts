// src/app/api/vab/import/route.ts
//
// POST /api/vab/import?mode=preview|send
//
// Endpoint manuel declenche par le bouton "Import VAB" dans /dispatch.
// Utilise le meme helper runVabImport que le cron auto -> mapping unique
// garanti (cf lib/vab/import.ts).
//
// Acces : admin / superadmin / dispatcher uniquement.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { runVabImport }     from '@/lib/vab/import'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = session.user as any
  const role: string = user.role || ''
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [role].filter(Boolean)
  const hasAccess = ['admin', 'superadmin', 'dispatcher'].some(r =>
    role === r || roles.includes(r),
  )
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'send' ? 'send' : 'preview'

  try {
    const result = await runVabImport({ mode })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[api/vab/import]', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
