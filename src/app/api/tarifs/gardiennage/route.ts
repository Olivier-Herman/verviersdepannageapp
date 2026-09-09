// GET /api/tarifs/gardiennage — tarifs journaliers par régime (grille source_tariff_lines).
import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { getGardiennageRegimes } from '@/lib/tarifs/gardiennage-regimes'
export const dynamic = 'force-dynamic'
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ regimes: await getGardiennageRegimes() })
}
