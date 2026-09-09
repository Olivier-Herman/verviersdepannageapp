// GET /api/fourriere/restitution-grid?source=police_mg — la grille de restitution
// (forfait, code Odoo, minimum de jours, €/jour) telle que le serveur la lit.
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { getRestitutionGrid } from '@/lib/fourriere/restitution-grid'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const source = String(new URL(req.url).searchParams.get('source') || '')
  const grid = await getRestitutionGrid(source)
  if (!grid) return NextResponse.json({ error: `Pas de grille de restitution pour « ${source} »` }, { status: 404 })
  return NextResponse.json({ grid })
}
