// GET /api/fines/suggest-driver?plate=ABC123&date=2026-06-01T14:30:00.000Z
// Retourne le chauffeur le plus probable au volant a cette date sur ce vehicule
// (via les missions actives a ce moment) + tous les candidats pour edit manuel.
//
// Olivier 2026-06-01. Reserve facturation / admin / superadmin.

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { suggestDriverForFine } from '@/lib/fines/suggest-driver'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = session.user as any
  const role: string = user.role || ''
  const modules: string[] = Array.isArray(user.modules) ? user.modules : []
  const hasAccess = ['admin', 'superadmin'].includes(role) || modules.includes('facturation')
  if (!hasAccess) return NextResponse.json({ error: 'Acces refuse' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const plate = (searchParams.get('plate') || '').trim()
  const dateStr = (searchParams.get('date') || '').trim()

  if (!plate)   return NextResponse.json({ error: 'plate requise' }, { status: 400 })
  if (!dateStr) return NextResponse.json({ error: 'date requise (ISO 8601)' }, { status: 400 })

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: 'date invalide' }, { status: 400 })
  }

  const result = await suggestDriverForFine(plate, date)
  return NextResponse.json(result)
}
