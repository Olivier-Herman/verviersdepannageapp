// GET /api/admin/a-facturer — « À facturer — pourquoi ça bloque » (Olivier 28/10/2026). Réservé à ses comptes
// (mêmes comptes que l'interrupteur « Mes assistants »).
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { peutBasculer } from '@/lib/facturation/suspension'
import { blocagesAFacturer } from '@/lib/facturation/a-facturer'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  const me = session?.user as any
  if (!me || !(await peutBasculer(me.id))) return NextResponse.json({ error: 'Accès réservé' }, { status: 403 })
  return NextResponse.json(await blocagesAFacturer(), { headers: { 'Cache-Control': 'no-store' } })
}
