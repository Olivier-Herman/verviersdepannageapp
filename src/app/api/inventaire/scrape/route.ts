// src/app/api/inventaire/scrape/route.ts
//
// GET /api/inventaire/scrape?num=12345
// Proxy vers Towsoft pour lire une fiche mission. Utilise par la page
// /fourriere/inventaire quand l user scanne un QR Towsoft.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { scrapeTowsoftMission } from '@/lib/towsoft-scrape'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role = user.role || ''
  const modules: string[] = user.modules || []
  if (!['admin', 'superadmin'].includes(role) && !modules.includes('fourriere')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const num = (searchParams.get('num') || '').trim()
  if (!num) return NextResponse.json({ error: 'num requis' }, { status: 400 })

  try {
    const data = await scrapeTowsoftMission(num)
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    console.error('[inventaire/scrape]', e.message)
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 })
  }
}
