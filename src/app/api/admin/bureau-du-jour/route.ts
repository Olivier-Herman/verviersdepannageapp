// src/app/api/admin/bureau-du-jour/route.ts — vue « Bureau du jour » (Olivier 17/10/2026), Mobi seul.
export const dynamic     = 'force-dynamic'
export const maxDuration = 120

import { NextResponse }     from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions }      from '@/lib/auth'
import { bureauDuJour }     from '@/lib/bureau/jour'

export async function GET() {
  const u = (await getServerSession(authOptions))?.user as any
  const roles: string[] = [u?.role, ...(Array.isArray(u?.roles) ? u.roles : [])]
  if (!roles.includes('superadmin')) return NextResponse.json({ error: 'Réservé à Mobi' }, { status: 403 })
  return NextResponse.json({ blocs: await bureauDuJour(), at: new Date().toISOString() })
}
