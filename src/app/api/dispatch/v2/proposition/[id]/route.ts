// GET /api/dispatch/v2/proposition/[id] — chauffeur proposé pour une mission (nouveau Dispatch,
// préversion dispatch_v2, Olivier seul). Calcul : src/lib/dispatch/proposition.ts.

import { NextResponse }      from 'next/server'
import { getServerSession }  from 'next-auth'
import { authOptions }       from '@/lib/auth'
import { isPreviewOn }       from '@/lib/feature-flags'
import { proposerChauffeurs } from '@/lib/dispatch/proposition'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const u = session.user as any
  if (!(await isPreviewOn('dispatch_v2', u.role, u.id))) return NextResponse.json({ error: 'Préversion non activée' }, { status: 403 })
  const r = await proposerChauffeurs(params.id)
  if ('erreur' in r) return NextResponse.json({ error: r.erreur }, { status: 404 })
  return NextResponse.json(r)
}
